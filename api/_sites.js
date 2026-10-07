// v6: build sites & apps from chat. Plan -> (research) -> images -> code -> self-check -> fix -> deploy (Vercel REST, one project per build) -> verify.
// Everything here is pure or takes its I/O through fetch, so tests can mock it.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import * as acorn from 'acorn';
import * as G from './_gem.js';
import * as B from './_backend.js';

const log = (...a) => console.log('[sites]', ...a);
export const CODE_CHAIN = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];   // Gemma's 8k output can't hold a full site
export const PLAN_CHAIN = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemma-4-26b-a4b-it'];
export const FAST_CHAIN = ['gemini-flash-lite-latest', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
const isGemma = m => /^gemma/i.test(m);

// ---------- Gemini (long-output caller; the chat caller in whatsapp.js keeps its short reply budget) ----------
export async function gem(prompt, { system = '', json = false, maxTokens = 8192, chain = CODE_CHAIN, cool = {}, timeoutMs = 120000, deadline = Infinity, temperature = 0.7, src = 'job', cache = null } = {}) {
  const tried = [], retried = new Set();
  // v7: cacheable calls (cache = rpc fn) reuse the same answer for the same prompt for 6 h
  const ch = cache ? G.hashOf(system, prompt, json, maxTokens) : null;
  if (ch) { const hit = await G.cacheGet(ch, cache); if (hit) return { ok: true, text: hit, model: 'cache', finish: 'STOP', tried: ['cache'] }; }
  const chainQueue = chain.filter(m => !(cool[m] > Date.now()));
  while (chainQueue.length) {
    const model = chainQueue.shift();
    const left = deadline - Date.now();
    if (left < 20000) { tried.push('out-of-time'); break; }
    const gemma = isGemma(model);
    const body = {
      contents: [{ role: 'user', parts: [{ text: gemma && system ? `${system}\n\n---\n\n${prompt}` : prompt }] }],
      generationConfig: { temperature, maxOutputTokens: gemma ? Math.min(maxTokens, 8192) : maxTokens },
    };
    if (system && !gemma) body.systemInstruction = { parts: [{ text: system }] };
    if (json && !gemma) body.generationConfig.responseMimeType = 'application/json';
    if (!gemma) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    let r;
    try {
      r = await G.gemFetch(model, body, { signal: AbortSignal.timeout(Math.min(timeoutMs, left - 5000)), src, retry: 1, deadline });   // v7: key 2 on 429, retry on 503
    } catch (e) { tried.push(model + ':timeout'); cool[model] = Date.now() + 3 * 60e3; continue; }
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const cand = j.candidates?.[0] || {};
      const text = (cand.content?.parts || []).filter(p => !p.thought && p.text).map(p => p.text).join('').trim();
      if (text) { if (ch && (cand.finishReason || 'STOP') === 'STOP') await G.cachePut(ch, text, cache); return { ok: true, text, model, finish: cand.finishReason || '', tried }; }
      tried.push(model + ':empty:' + (cand.finishReason || '?'));
      if (cand.finishReason === 'RECITATION' && !retried.has(model) && deadline - Date.now() > 60000) { retried.add(model); temperature = Math.min(1.2, temperature + 0.4); chainQueue.unshift(model); }
      continue;
    }
    const err = await r.text().catch(() => '');
    tried.push(model + ':' + r.status);
    if (r.status === 429) cool[model] = Date.now() + (/PerDay|per day|daily/i.test(err) ? 12 * 3600e3 : 10 * 60e3);
    else if (r.status === 503) cool[model] = Date.now() + 5 * 60e3;
    else if (r.status === 404) cool[model] = Date.now() + 24 * 3600e3;
    else if (r.status >= 500) cool[model] = Date.now() + 2 * 60e3;
  }
  log('gem failed', tried.join(' '));
  return { ok: false, tried, quota: tried.some(t => t.endsWith(':429')) };
}
export function parseJson(t) {
  if (!t) return null;
  const s = String(t).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  // several objects in a row (a model planning ahead): take the first balanced one
  if (a >= 0) {
    let d = 0, str = false, escp = false;
    for (let i = a; i < s.length; i++) {
      const c = s[i];
      if (str) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '{') d++; else if (c === '}' && --d === 0) { try { return JSON.parse(s.slice(a, i + 1)); } catch { break; } }
    }
  }
  return null;
}

// ---------- 1. plan ----------
export const PLAN_SYSTEM = 'You are a senior product designer and front-end lead. You turn a short WhatsApp request into a tight build plan for a single-page static website or web app. Output only JSON.';
export function planPrompt(brief, { owner = '', today = new Date().toISOString().slice(0, 10) } = {}) {
  return `Request from Michael on WhatsApp: """${brief}"""
Today: ${today}. The audience is mostly Nigerian, on cheap Android phones with slow data, unless the request says otherwise.
${owner ? `About Michael (use ONLY if the site is about Michael himself or his own brand/books/apps):\n${owner}\n` : ''}
Return JSON with exactly these keys:
{
 "title": "short site/app name (2-5 words)",
 "slug": "lowercase-dashed-name, 3-24 chars, no 'site'/'app' suffix unless needed",
 "type": "site" or "app" ("app" = interactive: quiz, game, calculator, tracker, tool; it becomes an installable PWA),
 "tagline": "one line",
 "description": "1-2 sentences for the share preview",
 "audience": "who it's for",
 "style": "visual direction in one sentence (mood, layout idea)",
 "palette": {"primary":"#hex","accent":"#hex","bg":"#hex","surface":"#hex","text":"#hex"},
 "fonts": {"heading":"a Google Font name","body":"a Google Font name"},
 "sections": ["for a site: 5-8 sections in order with one-line content notes; for an app: the screens/states"],
 "features": ["concrete interactive features, 3-8"],
 "images": [{"name":"hero","prompt":"a vivid photo prompt, no text in image","w":1200,"h":800}],
 "research": ["0-2 web search queries ONLY if real-world facts are needed (e.g. quiz facts, a real place); else empty"],
 "facts_given": "contact details, prices, names, numbers the request actually gives (never invent these)",
 "backend": null or {"collections": [{"name": "orders", "kind": "order|booking|contact|signup|entry|score|item", "label": "Order form", "fields": [{"name": "name", "type": "text|long|email|phone|number|date|time|choice|bool|url", "required": true, "options": ["only for choice"]}]}], "auth": false, "payments": false}
}
Rules: images 0-3 (an app usually needs 0-1, a business site 2-3). Keep the slug free of the words 'build', 'make', 'me'. Colours must have strong contrast.
Backend: the site CAN save data for real (orders, bookings, contact messages, sign-ups/RSVPs, guestbook/reviews, quiz leaderboards, private to-do lists with logins). Use "backend" only when the request needs it (an order/booking/contact form that should reach the owner, saved entries, scores, accounts); otherwise null. kind: order (owner pinged), booking (owner pinged), contact (owner pinged), signup (newsletter/RSVP/waitlist), entry (public: guestbook, comments, reviews), score (public leaderboard: name + score), item (private per signed-in user, needs auth). 1-3 collections, 2-8 fields each, short snake_case names. "auth": true only for logins/accounts or private lists. "payments": true only if the request asks to take payment online (Paystack).`;
}

// ---------- 2. code ----------
export const CODE_SYSTEM = `You are an elite front-end engineer and designer. You ship complete, polished, production-quality static websites and web apps in plain HTML, CSS and vanilla JavaScript (no frameworks, no build step, no npm).
Quality bar: looks like a premium template, mobile-first (360px phones first, then tablet/desktop), fast on slow 3G, accessible (semantic tags, alt text, labels, focus styles, 4.5:1 contrast), smooth subtle animations, sticky header with a working mobile menu where a site has navigation, real, specific copy written for the audience (never lorem ipsum, never "Your text here", never [brackets] or TODOs).
Hard rules:
- NEVER invent phone numbers, emails, street addresses, social handles, prices or testimonials attributed to real people. Use only facts given. If there is no contact number, the contact button opens https://wa.me/ with a prefilled message (no number), or a simple contact form that opens the visitor's email/WhatsApp. Without given prices, show items without prices or "Ask for price".
- Only these files may be referenced: index.html, style.css, app.js and the image files listed. No other local files. External: Google Fonts only. No external JS libraries.
- All JavaScript in app.js (no inline script tags, no inline on* handlers). It must run without errors, guard against missing elements, and use localStorage where saving progress/scores helps.
- Every element your JS looks up by id/selector must exist in index.html.
- Use each provided image file at most twice on the page; elsewhere use CSS gradients, shapes, emoji or inline SVG icons.
- Use CSS custom properties for the palette. Images: width/height attributes, loading="lazy" except the hero, object-fit: cover.
Output format, exactly, nothing before or after:
=== FILE: index.html ===
...
=== FILE: style.css ===
...
=== FILE: app.js ===
...`;
export function codePrompt(plan, { images = [], research = '' } = {}) {
  const imgs = images.length ? images.map(i => `- ${i.path} (${i.w}x${i.h}): ${i.prompt}`).join('\n') : '(none: use CSS gradients, shapes and emoji/SVG icons instead)';
  return `Build this ${plan.type === 'app' ? 'web app (it will be installed as a PWA; make it feel like a native app: full-height layout, bottom or top bar, big tap targets)' : 'website'} from the plan.

PLAN:
${JSON.stringify(plan, null, 1)}

IMAGE FILES AVAILABLE (reference them by these exact relative paths):
${imgs}
${research ? `\nRESEARCH NOTES (facts from the web; use them accurately, don't invent beyond them):\n${research.slice(0, 6000)}\n` : ''}
${plan.backend ? B.backendPrompt(plan.backend) + '\n' : ''}
Write the three files now. Make it genuinely impressive and complete: every section filled with real content, every button working.`;
}
export function editPrompt(files, change, plan = null) {
  return `Here is a live static ${plan?.type === 'app' ? 'web app' : 'website'}. Apply this change from the owner: """${change}"""

Keep everything else working and the same style unless the change says otherwise. Return ALL THREE files in full (index.html, style.css, app.js) in the required format, even ones you didn't change.
${plan?.backend ? B.backendPrompt(plan.backend) + '\n' : ''}
${textFilesBlock(files)}`;
}
export function fixPrompt(files, issues, plan = null) {
  return `An automated check found these problems in the site below. Fix every one, keep the design and content, and return ALL THREE files in full in the required format.${plan?.backend ? '\nKeep the data-mai-* backend wiring (forms, lists, logins); mai.js is added automatically, never write it or link it yourself.' : ''}

PROBLEMS:
${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}

${textFilesBlock(files)}`;
}
function textFilesBlock(files) {
  return ['index.html', 'style.css', 'app.js'].map(p => `=== FILE: ${p} ===\n${stripInjected(files[p] || '')}`).join('\n');
}
export function parseFiles(text) {
  const out = {};
  const re = /^\s*={3,}\s*FILE:\s*([\w.\-/]+)\s*={3,}\s*$/gm;
  const marks = [...String(text || '').matchAll(re)];
  marks.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    let body = text.slice(start, end).replace(/^\s*\n/, '');
    body = body.replace(/^```[a-z]*\s*\n/i, '').replace(/\n```\s*$/i, '').trimEnd() + '\n';
    out[m[1].replace(/^\.?\//, '')] = body;
  });
  return out;
}

// ---------- 3. self-check ----------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const CHECK_TAGS = ['html', 'head', 'body', 'main', 'header', 'footer', 'nav', 'section', 'article', 'aside', 'div', 'ul', 'ol', 'form', 'button', 'a', 'table', 'select', 'textarea', 'script', 'style', 'label', 'dialog'];
export const PLACEHOLDER_RE = /lorem ipsum|dolor sit amet|\bTODO\b|\bFIXME\b|your (?:business|company|brand) name|your text here|\[(?:insert|your|add|placeholder)[^\]]{0,40}\]|via\.placeholder|placehold\.(?:it|co)|placeholder\.com|example\.com|123[-. ]456[-. ]7890|\b0{3}[-. ]?0{3}[-. ]?0{4}\b|\+234\s?0{3}|XXX-XXX/i;
function stripComments(html) { return html.replace(/<!--[\s\S]*?-->/g, ''); }
export function tagBalance(html) {
  const clean = stripComments(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
  const counts = {};
  for (const m of clean.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const tag = m[2].toLowerCase();
    if (VOID.has(tag) || !CHECK_TAGS.includes(tag)) continue;
    counts[tag] = (counts[tag] || 0) + (m[1] ? -1 : 1);
  }
  return Object.entries(counts).filter(([, n]) => n !== 0);
}
export function jsErrors(code, label = 'app.js') {
  if (!code || !code.trim()) return [];
  for (const sourceType of ['script', 'module']) {
    try { acorn.parse(code, { ecmaVersion: 'latest', sourceType, allowHashBang: true }); return []; }
    catch (e) { if (sourceType === 'module') return [`${label}: JavaScript syntax error: ${e.message}`]; }
  }
  return [];
}
function cssBalance(css) {
  const s = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '');
  let d = 0; for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d--; if (d < 0) return false; }
  return d === 0;
}
export function idsUsedByJs(js) {
  const ids = new Set();
  for (const m of String(js || '').matchAll(/getElementById\(\s*['"`]([\w-]+)['"`]\s*\)/g)) ids.add(m[1]);
  for (const m of String(js || '').matchAll(/querySelector(?:All)?\(\s*['"`]#([\w-]+)['"`]\s*\)/g)) ids.add(m[1]);
  return [...ids];
}
export const PRICE_RE = /(?:₦|NGN\s?|N(?=\d{1,3}(?:,\d{3})+\b))\s?\d[\d,.]*/;
export const PHONE_RE = /(?:\+?234[\s-]?|\b0)[789][01]\d[\s-]?\d{3}[\s-]?\d{4}\b/;
// facts = the request + facts the plan says were given; prices/phone numbers not in them were invented
export function inventedFacts(files, facts = '') {
  const f = String(facts || '');
  const out = [];
  const text = ['index.html', 'app.js'].map(p => stripInjected(files[p] || '')).join('\n');
  const givenPrice = /₦|naira|ngn|\bprice|\d+\s?k\b|\d{3,}/i.test(f);
  const givenPhone = /\d{7,}|\+\d{3}/.test(f.replace(/\s/g, ''));
  const p = !givenPrice && text.match(PRICE_RE);
  if (p) out.push(`invented price "${p[0]}": no prices were given, so remove every price (show items without prices or "Ask for price")`);
  const ph = !givenPhone && text.match(PHONE_RE);
  if (ph) out.push(`invented phone number "${ph[0]}": none was given, so use a WhatsApp link without a number (https://wa.me/?text=...) instead`);
  return out;
}
export function checkSite(files, { facts = null, backend = null } = {}) {
  const issues = [];
  const html = files['index.html'];
  if (!html || html.length < 200) return ['index.html is missing or empty'];
  if (!/^\s*<!doctype html>/i.test(html)) issues.push('index.html must start with <!DOCTYPE html>');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) issues.push('add <meta name="viewport" content="width=device-width, initial-scale=1">');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  if (!title || !title.trim()) issues.push('add a real <title>');
  if (!/<\/html>\s*$/i.test(html.trim())) issues.push('index.html is cut off: it must end with </html>');
  for (const [tag, n] of tagBalance(html)) issues.push(`unbalanced <${tag}> tags in index.html (${n > 0 ? n + ' not closed' : -n + ' extra closing'})`);
  const inline = [...stripComments(html).matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim() && !/application\/ld\+json/i.test(s));
  inline.forEach((code, i) => issues.push(...jsErrors(code, `inline script ${i + 1}`)));
  for (const [p, body] of Object.entries(files)) if (p.endsWith('.js') && typeof body === 'string') issues.push(...jsErrors(body, p));
  if (files['style.css'] != null && !cssBalance(files['style.css'])) issues.push('style.css has unbalanced { } braces (cut off or broken)');
  // local references must exist
  const known = new Set(Object.keys(files));
  if (backend) known.add('mai.js');
  for (const m of stripComments(html).matchAll(/\b(?:src|href)=["']([^"'#]+?)["']/gi)) {
    const ref = m[1].trim();
    if (/^(?:https?:|\/\/|data:|mailto:|tel:|sms:|javascript:|whatsapp:|#)/i.test(ref)) continue;
    const p = ref.replace(/^\.?\//, '').split(/[?#]/)[0];
    if (p && !known.has(p) && !known.has(p.replace(/\/$/, '') + '/index.html')) issues.push(`index.html references "${ref}", which doesn't exist (only ${[...known].filter(k => !k.startsWith('.')).join(', ')} exist)`);
  }
  // JS lookups by id must exist in the HTML (or be created by the JS itself)
  const js = Object.entries(files).filter(([p]) => p.endsWith('.js') && p !== 'sw.js').map(([, b]) => b).join('\n');
  const allIds = new Set([...html.matchAll(/\bid=["']([\w-]+)["']/g)].map(m => m[1]));
  const missing = idsUsedByJs(js).filter(id => !allIds.has(id) && !new RegExp(`\\.id\\s*=\\s*['"\`]${id}['"\`]|id=\\\\?["']${id}`).test(js));
  if (missing.length) issues.push(`app.js looks up element ids that are not in index.html: ${missing.slice(0, 8).join(', ')}`);
  const ph = [...Object.entries(files)].filter(([p, b]) => typeof b === 'string' && /\.(html|js|css)$/.test(p)).map(([p, b]) => [p, (stripInjected(b).match(PLACEHOLDER_RE) || [])[0]]).filter(([, m]) => m);
  for (const [p, m] of ph) issues.push(`placeholder text in ${p}: "${m}" (write real content, or remove it)`);
  if (html.length > 400000) issues.push('index.html is too large; keep it lean');
  if (facts != null) issues.push(...inventedFacts(files, facts));
  if (backend) issues.push(...backendIssues(html, files['app.js'] || '', backend));
  return [...new Set(issues)];
}
// v7: the page must actually use the backend it was planned with
export function backendIssues(html, js, backend) {
  const out = [];
  const h = stripComments(html);
  const forms = [...h.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const used = new Set();
  for (const [, attrs, inner] of forms) {
    const m = attrs.match(/data-mai-form=["']([\w-]+)["']/);
    if (!m) continue;
    const col = backend.collections.find(c => c.name === m[1]);
    if (!col) { out.push(`a form uses data-mai-form="${m[1]}" but the backend collections are: ${backend.collections.map(c => c.name).join(', ')}`); continue; }
    used.add(col.name);
    const names = new Set([...inner.matchAll(/\bname=["']([\w-]+)["']/g)].map(x => x[1]));
    const missing = col.fields.filter(f => f.required && !names.has(f.name)).map(f => f.name);
    if (missing.length) out.push(`the "${col.name}" form is missing inputs for required fields: ${missing.join(', ')} (use name="${missing[0]}")`);
    const extra = [...names].filter(n => n !== '_hp' && !col.fields.some(f => f.name === n));
    if (extra.length) out.push(`the "${col.name}" form has inputs the backend won't store: ${extra.slice(0, 5).join(', ')} (rename them to the field names: ${col.fields.map(f => f.name).join(', ')})`);
  }
  for (const m of h.matchAll(/data-mai-list=["']([\w-]+)["']/g)) { used.add(m[1]); if (!backend.collections.some(c => c.name === m[1])) out.push(`data-mai-list="${m[1]}" is not a backend collection`); }
  for (const m of String(js).matchAll(/MAI\.(?:add|list)\(\s*['"`]([\w-]+)['"`]/g)) used.add(m[1]);
  for (const c of backend.collections) if (!used.has(c.name)) out.push(`the backend collection "${c.name}" (${c.kind}) isn't used: add a <form data-mai-form="${c.name}"> or MAI.add('${c.name}', …)${B.PUBLIC_KINDS.includes(c.kind) ? ` and a <div data-mai-list="${c.name}">` : ''}`);
  if (backend.auth && !/data-mai-auth=["'](?:login|signup)["']/.test(h)) out.push('logins are on but there is no <form data-mai-auth="login"> / <form data-mai-auth="signup">');
  if (/<script[^>]+src=["']\.?\/?mai\.js["']/i.test(h)) out.push('remove the <script src="mai.js"> tag: it is added automatically');
  if (/js\.paystack\.co|PaystackPop/i.test(h + js)) out.push('do not load Paystack yourself; use data-mai-pay on the form (MAI handles payment)');
  return out;
}
// issues worth a model fix pass even after the second try = would visibly break the page
export const isHard = s => /syntax error|cut off|missing or empty|doesn't exist|unbalanced <(?:html|body|head|script|style|main)>/.test(s);

// ---------- 4. decorate: icons, share preview, PWA ----------
const FONT5x7 = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110', D: '11100100101000110001100011001011100',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111', 0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110', 4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
};
const hexRgb = h => { const m = String(h || '').replace('#', '').match(/^([0-9a-f]{6})$/i); const v = m ? parseInt(m[1], 16) : 0x2b59c3; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
// a monogram app icon (letter on a diagonal gradient), maskable-safe (the letter sits in the middle 50%)
export function iconPng(size, letter, c1, c2) {
  const [r1, g1, b1] = hexRgb(c1), [r2, g2, b2] = hexRgb(c2 || c1);
  const glyph = FONT5x7[String(letter || 'A').toUpperCase()] || FONT5x7.A;
  const cell = Math.floor(size * 0.46 / 7), gw = cell * 5, gh = cell * 7, gx = Math.floor((size - gw) / 2), gy = Math.floor((size - gh) / 2);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1); raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      let r = r1 + (r2 - r1) * t, g = g1 + (g2 - g1) * t, b = b1 + (b2 - b1) * t;
      const gxp = x - gx, gyp = y - gy;
      if (gxp >= 0 && gyp >= 0 && gxp < gw && gyp < gh && glyph[Math.floor(gyp / cell) * 5 + Math.floor(gxp / cell)] === '1') { r = 255; g = 255; b = 255; }
      const o = row + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}
const INJ_START = '<!-- mai:head -->', INJ_END = '<!-- /mai:head -->';
export function stripInjected(s) { return String(s || '').replace(/\s*<!-- mai:head -->[\s\S]*?<!-- \/mai:head -->\s*/g, '\n').replace(/\s*<!-- mai:sw -->[\s\S]*?<!-- \/mai:sw -->\s*/g, '\n'); }
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export function decorate(files, plan, { version = 1, siteKey = null, api = null } = {}) {
  const out = { ...files };
  const p = plan || {};
  const withBackend = !!(p.backend && siteKey);
  const color = p.palette?.primary || '#2b59c3';
  const letter = (String(p.title || p.slug || 'A').match(/[A-Za-z0-9]/) || ['A'])[0];
  out['icon-192.png'] = { b64: iconPng(192, letter, color, p.palette?.accent).toString('base64') };
  out['icon-512.png'] = { b64: iconPng(512, letter, color, p.palette?.accent).toString('base64') };
  const hero = Object.keys(files).find(k => /^img\/hero\./.test(k)) || Object.keys(files).find(k => /^img\//.test(k));
  const head = [INJ_START,
    `<meta name="theme-color" content="${esc(color)}">`,
    `<meta name="description" content="${esc(p.description || p.tagline || '')}">`,
    `<meta property="og:title" content="${esc(p.title || '')}">`,
    `<meta property="og:description" content="${esc(p.description || p.tagline || '')}">`,
    `<meta property="og:type" content="website">`,
    hero ? `<meta property="og:image" content="${hero}">` : '',
    `<link rel="icon" href="icon-192.png" type="image/png">`,
    `<link rel="apple-touch-icon" href="icon-192.png">`,
    p.type === 'app' ? `<link rel="manifest" href="manifest.webmanifest">` : '',
    p.type === 'app' ? `<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes">` : '',
    withBackend ? `<script src="mai.js"></script>` : '',
    INJ_END].filter(Boolean).join('\n');
  let html = stripInjected(out['index.html'] || '');
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, head + '\n</head>') : head + html;
  if (p.type === 'app') {
    const reg = `<!-- mai:sw --><script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}</script><!-- /mai:sw -->`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, reg + '\n</body>') : html + reg;
    out['manifest.webmanifest'] = JSON.stringify({
      name: p.title || 'App', short_name: String(p.title || 'App').slice(0, 12), description: p.description || '', start_url: './', scope: './', display: 'standalone',
      background_color: p.palette?.bg || '#ffffff', theme_color: color,
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    }, null, 1);
    const assets = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...Object.keys(files).filter(k => k.startsWith('img/'))];
    out['sw.js'] = `const C='mai-${esc(p.slug || 'app')}-v${version}';const A=${JSON.stringify(assets)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(res=>{const cl=res.clone();caches.open(C).then(c=>c.put('index.html',cl));return res}).catch(()=>caches.match('index.html')));return}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok&&new URL(e.request.url).origin===location.origin){const cl=res.clone();caches.open(C).then(c=>c.put(e.request,cl))}return res}).catch(()=>caches.match('index.html'))))});
`;
  }
  if (withBackend) {
    out['mai.js'] = B.clientJs({ api: api || `${process.env.PUBLIC_URL || 'https://michael-ai-mu.vercel.app'}/api/site-data`, key: siteKey, backend: p.backend });
    html = html.replace(/<script[^>]+src=["']\.?\/?mai\.js["'][^>]*>\s*<\/script>\s*/gi, (m0, off) => off < html.indexOf(INJ_START) || off > html.indexOf(INJ_END) ? '' : m0);
  }
  out['index.html'] = html;
  out['vercel.json'] = JSON.stringify({ headers: [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] });
  return out;
}

// ---------- 5. deploy (Vercel REST: upload files by sha1, then v13 deployment in a project named mai-<slug>) ----------
const VAPI = 'https://api.vercel.com';
const vq = () => process.env.VERCEL_TEAM_ID ? `teamId=${process.env.VERCEL_TEAM_ID}` : '';
const vh = (extra = {}) => ({ authorization: `Bearer ${process.env.VERCEL_TOKEN}`, ...extra });
export const deployOn = () => Boolean(process.env.VERCEL_TOKEN);
export function fileBytes(v) { return typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.b64, 'base64'); }
export async function projectExists(name) {
  const r = await fetch(`${VAPI}/v9/projects/${encodeURIComponent(name)}?${vq()}`, { headers: vh(), signal: AbortSignal.timeout(10000) });
  return r.status === 200 ? await r.json() : null;
}
export async function deployFiles(name, files) {
  const list = [];
  for (const [path, v] of Object.entries(files)) {
    const b = fileBytes(v);
    const sha = crypto.createHash('sha1').update(b).digest('hex');
    const r = await fetch(`${VAPI}/v2/files?${vq()}`, { method: 'POST', headers: vh({ 'x-vercel-digest': sha, 'content-type': 'application/octet-stream' }), body: b, signal: AbortSignal.timeout(30000) });
    if (!r.ok && r.status !== 409) throw new Error(`upload ${path}: ${r.status} ${(await r.text()).slice(0, 150)}`);
    list.push({ file: path, sha, size: b.length });
  }
  const r = await fetch(`${VAPI}/v13/deployments?${vq()}&skipAutoDetectionConfirmation=1`, {
    method: 'POST', headers: vh({ 'content-type': 'application/json' }), signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ name, target: 'production', files: list, projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`deploy: ${r.status} ${JSON.stringify(j.error || j).slice(0, 200)}`);
  return { id: j.id, projectId: j.projectId, url: j.url };
}
export async function openProject(projectId) {   // new projects come with Vercel Authentication on previews; make every URL public
  try {
    await fetch(`${VAPI}/v9/projects/${projectId}?${vq()}`, { method: 'PATCH', headers: vh({ 'content-type': 'application/json' }), body: JSON.stringify({ ssoProtection: null }), signal: AbortSignal.timeout(10000) });
  } catch (e) { log('openProject', e.message); }
}
export async function deploymentStatus(id) {
  const r = await fetch(`${VAPI}/v13/deployments/${id}?${vq()}`, { headers: vh(), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  return { state: j.readyState, alias: j.alias || [], url: j.url, error: j.errorMessage || null, projectId: j.projectId };
}
export function bestAlias(aliases, name) {
  const a = (aliases || []).filter(x => x.endsWith('.vercel.app'));
  return a.find(x => x === `${name}.vercel.app`) || a.sort((x, y) => x.length - y.length)[0] || null;
}
export async function deleteProject(idOrName) {
  const r = await fetch(`${VAPI}/v9/projects/${encodeURIComponent(idOrName)}?${vq()}`, { method: 'DELETE', headers: vh(), signal: AbortSignal.timeout(15000) });
  return r.status;
}
export async function verifyLive(url, title, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 12) MichaelAI-check' } });
      const body = await r.text();
      last = { status: r.status, ok: r.status === 200 && /<html/i.test(body) && (!title || body.includes(String(title).slice(0, 20)) || /<title>/i.test(body)), bytes: body.length };
      if (last.ok) return last;
    } catch (e) { last = { status: 0, ok: false, detail: e.message }; }
    await new Promise(r => setTimeout(r, 2500));
  }
  return last;
}

// ---------- zip (stored, no compression; enough for a few small files) ----------
export function zipFiles(files, folder = 'site') {
  const locals = [], centrals = []; let offset = 0;
  for (const [path, v] of Object.entries(files)) {
    const data = fileBytes(v); const name = Buffer.from(`${folder}/${path}`); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
