// /lib/storage.js
// Pluggable storage adapter for telemetry + assist events.
//
// V1: write to console (Vercel logs catch these for free).
// Tomorrow: swap the body of write() for one of:
//   - Vercel KV:     await kv.lpush('la:events', JSON.stringify(safe))
//   - Supabase:      await supabase.from('la_events').insert(safe)
//   - Postgres:      await sql`INSERT INTO la_events (...) VALUES (...)`
//   - BigQuery, S3, ClickHouse, etc.
//
// Keep the exported API stable so callers don't have to change.

async function write(event) {
  const safe = sanitize(event);
  // Single line of JSON makes it easy to grep / pipe to a log shipper later.
  console.log('[LA-event]', JSON.stringify(safe));
}

// Best-effort PII redaction. This is defense-in-depth, NOT primary control —
// the right answer is to never collect PII in the first place. We strip the
// most obvious patterns so a copy/paste accident doesn't end up in logs.
const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,                     // US SSN
  /\b\d{13,19}\b/g,                              // long digit runs (cards)
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,               // email
  /\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // phone
];

function sanitize(event) {
  const cloned = safeClone(event || {});
  walk(cloned);
  return cloned;
}

function walk(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string') {
      let s = v;
      for (const re of PII_PATTERNS) s = s.replace(re, '[redacted]');
      // Also cap any individual string at 4 KB.
      if (s.length > 4096) s = s.slice(0, 4096) + '…[truncated]';
      obj[k] = s;
    } else if (v && typeof v === 'object') {
      walk(v);
    }
  }
}

function safeClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch { return {}; }
}

module.exports = { write };
