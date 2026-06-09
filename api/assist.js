// /api/assist.js
// Main Learning Assist endpoint.
//
// Flow:
//   1. CORS / preflight
//   2. Validate inputs (requestType, language, text length)
//   3. Rate limit (per-IP, per-session)
//   4. Build per-mode system prompt and call OpenAI
//   5. Run response through leak classifier (tier 1 + tier 2 for risky modes)
//   6. If flagged, return graceful fallback; else return model output
//   7. Log structured event for telemetry

const { getOpenAI } = require('../lib/openai-client');
const { buildSystemPrompt, buildUserMessage, PROMPTS_BY_TYPE } = require('../lib/prompts');
const { classifyResponse } = require('../lib/leak-classifier');
const { checkAndRecord, getClientIp } = require('../lib/rate-limit');
const { applyCors, handlePreflight } = require('../lib/cors');
const { sanitizeSvgsInText } = require('../lib/svg-sanitizer');
const storage = require('../lib/storage');

// Modes that may produce visual SVG diagrams. We use gpt-4o for these because
// gpt-4o-mini's SVG output is unreliable (broken paths, mislabeled axes, drift).
// Cost goes from ~$0.0007 to ~$0.007 per response — acceptable for the
// quality jump in visual examples.
const VISUAL_MODES = new Set(['worked_example', 'concept_summary']);

const VALID_TYPES = new Set(Object.keys(PROMPTS_BY_TYPE));
const VALID_LANGS = new Set(['english', 'spanish']);
const MAX_TEXT_CHARS = 6000;     // server-side hard cap (client caps at 4000)
const MAX_BODY_BYTES = 32 * 1024;

// New canonical mapping after the simplification:
//   1 = nudge (clarify)
//   2 = hint (strategy)
//   3 = worked_example (Explain — formerly level 4)
//   4 = concept_summary (Concept tools)
//   5 = video_topic     (Concept tools — new)
// `requestType` is the source of truth; `level` is just for ladder gating in the UI.
const LEVEL_TO_TYPE = {
  1: 'nudge',
  2: 'hint',
  3: 'worked_example',
  4: 'concept_summary',
  5: 'video_topic',
};

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) {
      res.status(413).json({ message: 'Body too large' });
      return;
    }
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ message: 'Invalid body' });
    return;
  }

  let {
    text,
    level,
    requestType,
    language,
    sessionId,
    problemKey,
    truncated,
    source,
    url,
    path,
    student,         // { id, name, gradeLevel } — set after first-run setup
    studentProfile,  // rolling behavior summary built on the client
    studentContext,  // optional "what's tricky?" note from the student
  } = body;

  // Hard guard against junk client input
  if (student && typeof student !== 'object') student = null;
  if (studentProfile && typeof studentProfile !== 'object') studentProfile = null;

  // The student-typed context is UNTRUSTED input. We:
  //   1) Coerce to string and trim
  //   2) Cap at 200 chars (client caps at 120; small server-side margin)
  //   3) Strip the delimiter tags themselves so the student can't break out
  //      of the <student_context> wrapper that the system prompt is taught
  //      to treat as data, not instructions
  if (typeof studentContext === 'string') {
    studentContext = studentContext
      .replace(/<\/?student_context\b[^>]*>/gi, '')
      .replace(/<\/?student_page_content\b[^>]*>/gi, '')
      .trim()
      .slice(0, 200);
    if (!studentContext) studentContext = null;
  } else {
    studentContext = null;
  }

  language = VALID_LANGS.has(String(language || '').toLowerCase())
    ? String(language).toLowerCase()
    : 'english';

  // Backward compat: if requestType is missing, derive it from level.
  if (!requestType) {
    requestType = LEVEL_TO_TYPE[Number(level)] || 'nudge';
  }
  if (!VALID_TYPES.has(requestType)) {
    res.status(400).json({ message: 'Invalid requestType' });
    return;
  }

  if (typeof text !== 'string' || text.trim().length < 5) {
    res.status(400).json({
      message: language === 'spanish'
        ? 'No vi un problema. Selecciona el problema y vuelve a tocar el botón.'
        : "I didn't see a problem. Highlight the problem you're working on, then tap me again.",
    });
    return;
  }
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);

  const ip = getClientIp(req);
  const rl = checkAndRecord({ ip, sessionId });
  if (!rl.ok) {
    if (rl.retryAfter) res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({
      message: language === 'spanish'
        ? 'Espera un momento e intenta de nuevo.'
        : 'Take a breath — try again in a moment.',
    });
    return;
  }

  const startTs = Date.now();
  let raw = '';
  const isVideoTopic = requestType === 'video_topic';
  const isMisconceptions = requestType === 'misconceptions';
  const isJsonMode = isVideoTopic || isMisconceptions;
  const usesVisuals = VISUAL_MODES.has(requestType);
  // Model selection: visual modes need gpt-4o for usable SVG quality. Hints
  // and nudges stay on gpt-4o-mini. video_topic and misconceptions are
  // structured-output extraction and run fine on mini.
  const model = usesVisuals ? 'gpt-4o' : 'gpt-4o-mini';
  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt(requestType, language, { student, studentProfile }) },
        { role: 'user', content: buildUserMessage(text, { studentContext }) },
      ],
      temperature: isJsonMode ? 0 : (requestType === 'worked_example' ? 0.55 : 0.3),
      max_tokens: isJsonMode
        ? (isMisconceptions ? 240 : 60)
        : (usesVisuals ? 900 : 320),
      ...(isJsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    raw = completion.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('[LA] OpenAI error:', err && err.message);
    storage.write({
      event: 'assist_error',
      ts: Date.now(),
      sessionId,
      problemKey,
      requestType,
      latencyMs: Date.now() - startTs,
      error: String(err && err.message || err).slice(0, 300),
    }).catch(() => {});
    res.status(502).json({
      message: language === 'spanish'
        ? 'No pude conectarme. Intenta de nuevo en un momento.'
        : "I couldn't think for a second there. Try again in a moment.",
    });
    return;
  }

  if (!raw) {
    res.status(502).json({
      message: language === 'spanish' ? 'Sin respuesta del modelo.' : 'No response from the model.',
    });
    return;
  }

  // misconceptions short-circuit: parse the JSON list, validate, and return.
  // No leak classification — we're returning structured tap-targets, not tutoring.
  if (isMisconceptions) {
    let labels = [];
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.misconceptions)) {
        labels = parsed.misconceptions
          .map((m) => (m && typeof m.label === 'string') ? m.label.trim() : '')
          .filter((s) => s.length >= 4 && s.length <= 120)
          .slice(0, 3);
      }
    } catch { /* malformed — fall through to fallback below */ }

    const latencyMs = Date.now() - startTs;
    if (labels.length === 0) {
      storage.write({
        event: 'misconceptions_failed',
        ts: Date.now(),
        sessionId,
        problemKey,
        latencyMs,
        rawPreview: raw.slice(0, 200),
      }).catch(() => {});
      res.status(200).json({
        message: language === 'spanish'
          ? 'No pude generar sugerencias en este momento.'
          : "I couldn't generate suggestions right now.",
        requestType,
        misconceptions: [],
      });
      return;
    }

    storage.write({
      event: 'misconceptions_resolved',
      ts: Date.now(),
      sessionId,
      problemKey,
      latencyMs,
      count: labels.length,
    }).catch(() => {});

    res.status(200).json({
      requestType,
      misconceptions: labels.map((label) => ({ label })),
      latencyMs,
    });
    return;
  }

  // Sanitize any inline SVG before the response leaves our server. The client
  // renders the message as HTML for visual modes, so unsanitized SVG would be
  // an XSS hole on every host page Learning Assist runs on. Modes that don't
  // produce SVG skip this for free (no <svg> match, no work).
  if (usesVisuals) {
    raw = sanitizeSvgsInText(raw);
  }

  // video_topic short-circuit: parse the topic JSON, construct a Khan Academy
  // search URL, and return. No leak classification needed — we're not tutoring,
  // just routing the student to a known-safe educational domain.
  if (isVideoTopic) {
    let topic = '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.topic === 'string') topic = parsed.topic.trim();
    } catch {
      topic = '';
    }
    // Last-ditch fallback: strip braces/quotes from raw if JSON parse failed
    if (!topic) {
      const m = raw.match(/"topic"\s*:\s*"([^"]+)"/);
      if (m) topic = m[1].trim();
    }

    const latencyMs = Date.now() - startTs;
    if (!topic || topic.length < 3) {
      storage.write({
        event: 'video_topic_failed',
        ts: Date.now(),
        sessionId,
        problemKey,
        latencyMs,
        rawPreview: raw.slice(0, 200),
      }).catch(() => {});
      res.status(200).json({
        message: language === 'spanish'
          ? 'No pude identificar un tema claro para un video.'
          : "I couldn't identify a clear topic for a video.",
        requestType,
        topic: '',
      });
      return;
    }

    const searchUrl = 'https://www.khanacademy.org/search?page_search_query=' + encodeURIComponent(topic);
    storage.write({
      event: 'video_topic_resolved',
      ts: Date.now(),
      sessionId,
      problemKey,
      topic,
      latencyMs,
    }).catch(() => {});

    res.status(200).json({
      message: language === 'spanish'
        ? `Encontré una lección de Khan Academy sobre: ${topic}`
        : `Found a Khan Academy lesson on: ${topic}`,
      requestType,
      topic,
      searchUrl,
      latencyMs,
    });
    return;
  }

  // Leak classification
  const verdict = await classifyResponse({
    response: raw,
    requestType,
    pageText: text,
  });
  const latencyMs = Date.now() - startTs;

  if (verdict.flagged) {
    // Log a preview of the flagged response so we can actually debug why the
    // classifier rejected it. Truncated to keep log lines reasonable.
    storage.write({
      event: 'leak_caught',
      ts: Date.now(),
      sessionId,
      problemKey,
      requestType,
      tier: verdict.tier,
      reason: verdict.reason,
      overlap: verdict.overlap,
      latencyMs,
      replyLen: raw.length,
      responsePreview: raw.slice(0, 400),
      pageTextPreview: text.slice(0, 200),
      language,
      url,
      path,
    }).catch(() => {});

    res.status(200).json({
      message: fallbackMessage(language),
      level,
      requestType,
      degraded: true,
    });
    return;
  }

  storage.write({
    event: 'assist_served',
    ts: Date.now(),
    sessionId,
    problemKey,
    requestType,
    language,
    latencyMs,
    replyLen: raw.length,
    truncated: !!truncated,
    source,
    url,
    path,
    studentId: student && student.id,
    gradeLevel: student && student.gradeLevel,
    personalized: !!(studentProfile),
    hasStuckOn: !!studentContext,
    stuckOnLen: studentContext ? studentContext.length : 0,
  }).catch(() => {});

  res.status(200).json({
    message: raw,
    level,
    requestType,
    latencyMs,
  });
};

function fallbackMessage(language) {
  return language === 'spanish'
    ? 'Pensemos juntos: ¿qué parte del problema te resulta más confusa? Cuéntame y damos un paso pequeño.'
    : "Let's think together — what part of this is feeling tricky? Tell me that and we'll take one small step.";
}
