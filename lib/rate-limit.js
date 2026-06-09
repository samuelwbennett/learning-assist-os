// /lib/rate-limit.js
// Sliding-window rate limiter with in-memory state.
//
// READ THIS — limitations of in-memory limiting on Vercel serverless:
//
//   1. Vercel keeps a function instance "warm" for a few minutes after each
//      invocation. While warm, in-memory state persists across requests.
//      After cold start, state resets to empty. This is by design.
//
//   2. Vercel may run multiple parallel instances (auto-scaling, multi-region).
//      Each instance has its own Map. A determined attacker who spreads load
//      across regions can exceed the per-instance limit by Nx where N is the
//      number of warm instances.
//
//   3. Different /api/*.js endpoints are bundled as separate functions, so
//      they have separate in-memory stores. An attacker hitting both
//      /api/assist and /api/telemetry sees the limits applied independently.
//
//   4. This is "good enough for V1" — it stops accidental client loops and
//      casual misuse. It is NOT defense against determined adversarial abuse.
//
// MIGRATION PATH:
//   When you provision Vercel KV, Upstash Redis, or Supabase, replace the
//   Map-based store with a network-backed one. Keep the exported API
//   identical: { ok, reason?, retryAfter? }.
//
// Tunable via env:
//   LA_RL_PER_IP_PER_MIN          (default: 12)
//   LA_RL_PER_SESSION_PER_HOUR    (default: 60)

const PER_IP_PER_MIN = clampInt(process.env.LA_RL_PER_IP_PER_MIN, 12, 1, 1000);
const PER_SESSION_PER_HOUR = clampInt(process.env.LA_RL_PER_SESSION_PER_HOUR, 60, 1, 5000);

const ipBucket = new Map();      // ip       -> [timestamps within last 60s]
const sessionBucket = new Map(); // sessionId -> [timestamps within last 60min]

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function purge(arr, cutoff) {
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

function checkAndRecord({ ip, sessionId }) {
  const now = Date.now();

  if (ip) {
    const arr = ipBucket.get(ip) || [];
    purge(arr, now - 60_000);
    if (arr.length >= PER_IP_PER_MIN) {
      const retryAfter = Math.max(1, Math.ceil((arr[0] + 60_000 - now) / 1000));
      return { ok: false, reason: 'ip_limit', retryAfter };
    }
    arr.push(now);
    ipBucket.set(ip, arr);
  }

  if (sessionId) {
    const arr = sessionBucket.get(sessionId) || [];
    purge(arr, now - 3_600_000);
    if (arr.length >= PER_SESSION_PER_HOUR) {
      return { ok: false, reason: 'session_limit', retryAfter: 60 };
    }
    arr.push(now);
    sessionBucket.set(sessionId, arr);
  }

  // Opportunistic cleanup so the Maps don't grow unbounded.
  if (Math.random() < 0.01) {
    for (const [k, v] of ipBucket) if (v.length === 0) ipBucket.delete(k);
    for (const [k, v] of sessionBucket) if (v.length === 0) sessionBucket.delete(k);
  }

  return { ok: true };
}

function getClientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { checkAndRecord, getClientIp };
