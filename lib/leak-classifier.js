// /lib/leak-classifier.js
// Two-tier output classifier that catches responses leaking the answer.
//
//   Tier 1: regex / heuristic sweep       (fast, free, catches obvious leaks)
//   Tier 2: small LLM judge call          (smarter, only used for high-risk modes)
//
// On flag, /api/assist returns a graceful fallback message instead of the
// model output, and logs a 'leak_caught' event for later prompt tuning.

const { getOpenAI } = require('./openai-client');

const ANSWER_PHRASES = [
  /\bthe answer is\b/i,
  /\bla respuesta es\b/i,
  /\bel resultado es\b/i,
  /\btherefore\s+[a-z]\s*=/i,
  /\bso\s+[a-z]\s*=\s*-?\d/i,
  /\bfinal answer\b/i,
  /\brespuesta final\b/i,
  /\bso the (final )?answer\b/i,
  /\bentonces la respuesta\b/i,
];

const HIGH_RISK_MODES = new Set(['worked_example']);

function extractNumberTokens(text) {
  // Pull out numeric tokens of length >= 2 so we ignore noise like "1" or "0".
  // We keep them as strings so "12" and "1.2" don't false-match.
  const matches = String(text).match(/-?\d+(?:[.,]\d+)?/g) || [];
  return matches.map((m) => m.replace(/,/g, '.')).filter((m) => m.replace('-', '').replace('.', '').length >= 2);
}

function tier1Sweep({ response, requestType, pageText }) {
  // nudge / hint: no equations, no answer phrases, no specific numbers.
  if (requestType === 'nudge' || requestType === 'hint') {
    if (/=\s*-?\d/.test(response)) {
      return { flagged: true, reason: 'equation_in_low_level_mode', tier: 1 };
    }
    if (ANSWER_PHRASES.some((re) => re.test(response))) {
      return { flagged: true, reason: 'answer_phrase', tier: 1 };
    }
  }

  // worked_example: response should not reuse a substantial set of DISTINCTIVE
  // multi-digit numbers from the page.
  //
  // Two important refinements:
  //
  // 1. Dedupe response numbers before counting. Saying "10" three times in a
  //    partial-quotients walkthrough is one piece of evidence, not three.
  //
  // 2. Exclude "common reference" round numbers (10, 100, 1000, etc.) that
  //    appear in essentially every math operation — using "10" as an anchor
  //    in division is universal, not page-specific. False-positive city.
  //
  // Tier 2's LLM judge handles the structural-mirroring cases this regex
  // can't see (e.g. same scenario, same operation order, different numbers).
  if (requestType === 'worked_example') {
    const COMMON_REFERENCE_NUMBERS = new Set([
      '10', '20', '25', '50', '100', '200', '500', '1000', '10000',
    ]);
    const pageNums = new Set(extractNumberTokens(pageText));
    const respUnique = [...new Set(extractNumberTokens(response))]
      .filter((n) => !COMMON_REFERENCE_NUMBERS.has(n));
    const overlap = respUnique.filter((n) => pageNums.has(n));
    if (overlap.length >= 3) {
      return { flagged: true, reason: 'reused_page_numbers', tier: 1, overlap };
    }
  }

  // concept_summary: light constraint — flag only if it looks like it's solving.
  if (requestType === 'concept_summary') {
    if (/\bthe answer is\b/i.test(response) || /\bla respuesta es\b/i.test(response)) {
      return { flagged: true, reason: 'answer_phrase', tier: 1 };
    }
  }

  return { flagged: false };
}

async function tier2Judge({ response, requestType, pageText }) {
  if (!HIGH_RISK_MODES.has(requestType)) {
    return { flagged: false, skipped: true };
  }

  // Only worked_example reaches Tier 2 now (HIGH_RISK_MODES).
  //
  // CRITICAL: this judge has exactly ONE job — detect ANSWER LEAKAGE. It must
  // NOT flag for any of: response is too short, response is too long, response
  // doesn't include numeric work, response is conceptual instead of arithmetic,
  // response is missing a header, response is missing an SVG. Those are
  // quality concerns, not leakage. Quality is enforced by the system prompt;
  // the leak classifier exists only to catch responses that betray the
  // "no answers" guarantee.
  const judgePrompt = `You are checking a tutoring response for ANSWER LEAKAGE only.

Your job is NOT to evaluate quality, format, length, completeness, or whether the response "looks like a worked example." Only flag if the response leaks an answer to the student's actual page problem.

LEAKAGE means ONE of these — and only these:
  (a) The response directly states or computes the final answer to the student's specific page problem.
  (b) The response is a near-duplicate of the page problem (same scenario AND same multi-digit values AND same operation), such that the student can copy the response's answer back to their page without thinking.

DO NOT flag for any of these — these are all FINE:
  - The response is short or terse.
  - The response is conceptual or definitional ("parallel lines never meet, like train tracks") rather than numeric. Many topics don't have a numeric "answer."
  - The response uses a different scenario (train tracks vs. the page's house, baking vs. the page's farmer).
  - The response shares common small numbers (0-9, 10, 100).
  - The response teaches the same skill the page problem requires.
  - The tutor fully solves their OWN example (this is the whole point).
  - The response doesn't include any numeric example.
  - The response doesn't include an SVG.
  - The response doesn't have section headers.

PAGE PROBLEM (student's screen):
${pageText.slice(0, 2000)}

TUTOR RESPONSE:
${response}

Reply ONLY with strict JSON in this exact form: {"leaked": true|false, "reason": "<one short phrase>"}`;

  try {
    const openai = getOpenAI();
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: judgePrompt }],
      temperature: 0,
      max_tokens: 80,
      response_format: { type: 'json_object' },
    });
    const raw = result.choices?.[0]?.message?.content || '{}';
    const parsed = safeParseJson(raw);
    return {
      flagged: parsed.leaked === true,
      reason: parsed.reason || 'judge_flagged',
      tier: 2,
    };
  } catch (err) {
    // Judge failure: fail open — don't block a valid response just because
    // the judge call errored. Log so we can investigate.
    console.warn('[LA] tier2 judge failed:', err && err.message);
    return { flagged: false, error: err && err.message, tier: 2 };
  }
}

function safeParseJson(s) {
  try { return JSON.parse(s); }
  catch { return {}; }
}

async function classifyResponse({ response, requestType, pageText }) {
  const t1 = tier1Sweep({ response, requestType, pageText });
  if (t1.flagged) return t1;

  // Debug switch: set LA_BYPASS_JUDGE=1 in Vercel env vars to skip the LLM
  // judge entirely. Useful for confirming whether Tier 2 is the culprit when
  // tuning prompts. Do NOT leave this on in production.
  if (process.env.LA_BYPASS_JUDGE === '1') {
    return { flagged: false, bypassed: true };
  }

  const t2 = await tier2Judge({ response, requestType, pageText });
  if (t2.flagged) return t2;

  return { flagged: false };
}

module.exports = { classifyResponse, tier1Sweep, tier2Judge };
