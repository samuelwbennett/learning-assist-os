// /lib/svg-sanitizer.js
// Whitelist-based SVG sanitizer for the LLM-generated diagrams we render in
// the popup. Defense against accidental script injection in model output.
//
// Threat model:
//   - The LLM is not adversarial but may produce malformed SVG, stray
//     <script> tags, event handlers, or <foreignObject> blocks containing HTML.
//   - We trust the LLM enough that we don't need a full DOM parser; regex
//     stripping plus a tag/attribute whitelist is sufficient.
//
// What gets dropped:
//   - <script>, <style>, <foreignObject>, <use>, <image> tags entirely
//   - Any tag not in ALLOWED_TAGS
//   - Any attribute not in ALLOWED_ATTRS
//   - Event handlers (onload, onclick, onmouseover, ...)
//   - href, xlink:href, src (no external references)
//   - javascript:, data:, vbscript: URL schemes in any attribute value
//   - XML processing instructions, DOCTYPE, comments

const ALLOWED_TAGS = new Set([
  'svg', 'g',
  'line', 'rect', 'circle', 'ellipse',
  'polygon', 'polyline', 'path',
  'text', 'tspan',
  'defs', 'linearGradient', 'radialGradient', 'stop',
  'title', 'desc',
  'marker',
]);

const ALLOWED_ATTRS = new Set([
  // geometry / layout
  'viewbox', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'transform', 'points', 'd', 'dx', 'dy',
  'refx', 'refy', 'orient', 'markerwidth', 'markerheight', 'markerunits',
  // style
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity',
  'stop-color', 'stop-opacity', 'offset', 'gradientunits', 'spreadmethod',
  // text
  'font-size', 'font-family', 'font-weight', 'text-anchor',
  'dominant-baseline', 'alignment-baseline',
  // accessibility / namespace
  'id', 'class', 'role', 'aria-label', 'aria-labelledby', 'aria-hidden',
  'xmlns',
]);

function sanitizeSvg(input) {
  if (typeof input !== 'string' || !input.trim()) return '';

  let s = input;

  // 1. Drop unsafe container tags entirely (with everything inside).
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  s = s.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '');
  // <use> and <image> can pull in external content — drop both forms
  s = s.replace(/<use\b[^>]*\/?>/gi, '');
  s = s.replace(/<\/use\s*>/gi, '');
  s = s.replace(/<image\b[^>]*\/?>/gi, '');
  s = s.replace(/<\/image\s*>/gi, '');

  // 2. Strip XML processing instructions, doctypes, comments
  s = s.replace(/<\?[\s\S]*?\?>/g, '');
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // 3. Process every remaining tag: keep allowlisted ones, strip the rest.
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (match, slash, tagName, attrs) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return '';
    if (slash) return `</${lower}>`;
    const cleanAttrs = sanitizeAttributes(attrs || '');
    const selfClosing = /\/\s*$/.test(attrs);
    return `<${lower}${cleanAttrs}${selfClosing ? ' /' : ''}>`;
  });

  return s.trim();
}

function sanitizeAttributes(attrString) {
  if (!attrString.trim()) return '';

  const out = [];
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(attrString)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] || ''));

    // Block event handlers (onload, onclick, onmouseover, etc.)
    if (name.startsWith('on')) continue;
    // Block external references
    if (name === 'href' || name === 'xlink:href' || name === 'src') continue;
    // Block anything not on the allow list
    if (!ALLOWED_ATTRS.has(name)) continue;
    // Block dangerous URL schemes anywhere in the value
    if (/(?:^|[^a-z])(javascript|data|vbscript)\s*:/i.test(value)) continue;

    const escaped = String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    out.push(`${name}="${escaped}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

// Find every <svg>...</svg> in a text response and replace each with its
// sanitized form. Surrounding prose is left alone.
function sanitizeSvgsInText(text) {
  return String(text || '').replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, (match) => {
    const cleaned = sanitizeSvg(match);
    return cleaned || ''; // if sanitization stripped everything, drop it
  });
}

module.exports = { sanitizeSvg, sanitizeSvgsInText };
