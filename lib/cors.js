// /lib/cors.js
// CORS for a Chrome extension content script. The origin is the *host page*,
// not the extension itself, so origin can be anything (mathacademy.com,
// khanacademy.org, canvas, file://, etc.). For V1 we reflect the request
// origin. When you have a stable extension ID and a public marketing site,
// tighten this to an allow-list.

function applyCors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LA-Session');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { applyCors, handlePreflight };
