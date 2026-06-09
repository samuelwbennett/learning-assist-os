// /api/telemetry.js
// Receives telemetry events from the Learning Assist OS content script.
//
// The client fires events via navigator.sendBeacon, which:
//   - Sends a small POST in the background (does not block page unload)
//   - Expects a 200 or 204 response with an empty body
//   - Drops the request silently if the endpoint errors
//
// V1 storage is console.log via lib/storage.js. Swap that module's body for
// Vercel KV / Supabase / Postgres / etc. when ready — no changes here.

const storage = require('../lib/storage');
const { applyCors, handlePreflight } = require('../lib/cors');
const { checkAndRecord, getClientIp } = require('../lib/rate-limit');

const ALLOWED_EVENTS = new Set([
  'extension_loaded',
  'launcher_clicked',
  'launcher_shortcut',
  'language_changed',
  'hint_requested',
  'hint_received',
  'hint_error',
  'hint_accepted',
  'hint_escalated',
  'popup_minimized',
  'popup_closed',
  'stuck_prompt_shown',
  'stuck_prompt_accepted',
  'stuck_prompt_dismissed',
  'problem_changed',
  'request_skipped_no_text',
  // Personalization & video events
  'student_setup_completed',
  'video_topic_received',
  'video_opened',
  'video_dismissed',
  // Outcome capture
  'hint_rated',
  // Misconception diagnostic
  'misconceptions_shown',
  'misconception_selected',
  'misconception_skipped',
  'misconceptions_failed_client',
]);

// Fields we explicitly accept from the client. Anything not in this list is
// dropped silently — defense against the client (or an attacker) shoving
// arbitrary data into our logs.
const ALLOWED_FIELDS = [
  'level', 'requestType', 'source', 'textLen', 'truncated',
  'latencyMs', 'replyLen', 'status', 'error', 'lang',
  'fromLevel', 'toLevel', 'collapsed', 'idleMs', 'timeOnProblemMs',
  'previous', 'next',
  // Personalization fields (no PII — name stays on device)
  'gradeLevel', 'hasStudent', 'topic', 'hasUrl', 'degraded',
  // Rating fields
  'value',
  // Misconception fields
  'count', 'idx', 'label', 'hasContext',
];

const MAX_BODY_BYTES = 8 * 1024;

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);

  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) { res.status(413).end(); return; }
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).end();
    return;
  }

  // Coarse rate limit so beacon storms can't hammer the function.
  // Use a separate key namespace so this doesn't share quota with /api/assist.
  const ip = getClientIp(req);
  const rl = checkAndRecord({ ip: `tel:${ip}`, sessionId: body.sessionId ? `tel:${body.sessionId}` : null });
  if (!rl.ok) { res.status(204).end(); return; } // silently drop

  if (!ALLOWED_EVENTS.has(body.event)) {
    // Unknown event name. Drop silently with a 204 so the beacon retries
    // don't pile up.
    res.status(204).end();
    return;
  }

  const safe = {
    event: body.event,
    ts: typeof body.ts === 'number' ? body.ts : Date.now(),
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : undefined,
    host: typeof body.host === 'string' ? body.host.slice(0, 200) : undefined,
    path: typeof body.path === 'string' ? body.path.slice(0, 200) : undefined,
    problemKey: typeof body.problemKey === 'string' ? body.problemKey.slice(0, 64) : undefined,
    lang: typeof body.lang === 'string' ? body.lang.slice(0, 16) : undefined,
  };
  for (const k of ALLOWED_FIELDS) {
    if (k in body) safe[k] = body[k];
  }

  try {
    await storage.write(safe);
  } catch (err) {
    console.warn('[LA telemetry] storage.write failed:', err && err.message);
  }

  // sendBeacon is happiest with 204.
  res.status(204).end();
};
