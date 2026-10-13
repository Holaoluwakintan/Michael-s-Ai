// v4 extras for Michael AI: link reading (read: <url> / bare URL) and free image generation (image: <prompt>).
// No heavy deps: fetch + regex text extraction. Env (all optional): POLLINATIONS_KEY (+ POLLINATIONS_MODEL, default flux),
// CF_ACCOUNT_ID + CF_AI_TOKEN (Cloudflare Workers AI flux-1-schnell), IMG_DAILY_LIMIT (default 20), GEMINI_API_KEY (Gemini image, tried only
// when not parked; Google's free tier gives image models "limit: 0", so a 429 parks it until midnight Pacific).
import { brandStyle95 } from './_v95.js';   // v9.5

export const PAGE_CAP = 30000;            // chars of page text kept for the model
const FETCH_TIMEOUT = 10000;              // ms per page fetch
const MAX_BYTES = 2_000_000;              // bytes read from any page
const UA = 'Mozilla/5.0 (Linux; Android 14; Redmi A5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 MichaelAI/4';

// ---------- link detection ----------
const URL_IN = /(https?:\/\/[^\s<>"'`]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|ai|app|dev|co|ng|me|info|blog|site|xyz|page|link|so|tv|vercel\.app|github\.io)(?:\/[^\s<>"'`]*)?)/i;
export const READ_RE = /^\s*(?:\/read\b\s*[:：]?|read\s*[:：]|summari[sz]e\s*[:：]|open\s*[:：])\s*([\s\S]*)$/i;

function cleanUrl(u) {
  let s = String(u || '').trim().replace(/[)\].,;!?*_]+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const x = new URL(s); if (!/^https?:$/.test(x.protocol)) return null; return x.toString(); } catch { return null; }
}
// -> { url, question } or null. Triggers on "read: <url> [question]" and on a message that is a link plus at most a short line.
export function detectRead(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(READ_RE);
  if (m) {
    const u = m[1].match(URL_IN);
    if (!u) return { url: null, question: '' };
    return { url: cleanUrl(u[1]), question: m[1].replace(u[1], '').trim() };
  }
  const u = t.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!u) return null;
  const rest = t.replace(u[0], '').trim();
  if (rest.length > 160 || /^\s*(teach|remember|post)\b/i.test(t)) return null;   // a long message that merely contains a link is a normal chat
  return { url: cleanUrl(u[0]), question: rest };
}

// ---------- blocked sites ----------
const BLOCKED = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch|messenger\.com)$/i, 'Facebook'],
  [/(^|\.)instagram\.com$/i, 'Instagram'],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/i, 'X (Twitter)'],
  [/(^|\.)threads\.(net|com)$/i, 'Threads'],
  [/(^|\.)linkedin\.com$/i, 'LinkedIn'],
  [/(^|\.)tiktok\.com$/i, 'TikTok'],
  [/(^|\.)whatsapp\.com$/i, 'WhatsApp'],
];
export function blockedSite(url) {
  let h = '';
  try { h = new URL(url).hostname; } catch { return null; }
  for (const [re, name] of BLOCKED) if (re.test(h)) return name;
  return null;
}
export function blockedReply(name) {
  const meta = /Facebook|Instagram|Threads|WhatsApp/.test(name) ? 'Meta blocks' : `${name} blocks`;
  return `🔒 I can't read ${name} links: ${meta} bots from opening posts and profiles (it needs a login).\n\nWorkaround: open it, copy the text, and send it to me as\n*teach:* <the text>\nor just paste it here and ask me about it.`;
}

// ---------- fetching ----------
async function timedFetch(url, opts = {}, ms = FETCH_TIMEOUT) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { redirect: 'follow', ...opts, signal: ctl.signal }); } finally { clearTimeout(timer); }
}
async function readCapped(r, max = MAX_BYTES) {
  if (!r.body) return Buffer.from(await r.arrayBuffer()).subarray(0, max);
  const reader = r.body.getReader();
  const chunks = []; let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value)); n += value.length;
  }
  try { await reader.cancel(); } catch {}
  return Buffer.concat(chunks).subarray(0, max);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', naira: '₦' };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return ' '; } }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const metaContent = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return '';
  return decodeEntities(tag.match(/content\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/content\s*=\s*'([^']*)'/i)?.[1] ?? '').trim();
};
// HTML -> { title, description, text } (readable text: headings marked, paragraphs and list items on their own lines)
export function htmlToText(html) {
  let h = String(html || '');
  const title = decodeEntities((metaContent(h, 'og:title') || h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const description = metaContent(h, 'description') || metaContent(h, 'og:description');
  h = h.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|select|button|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = h.match(/<main\b[\s\S]*?<\/main>/i)?.[0] || h.match(/<article\b[\s\S]*?<\/article>/i)?.[0];
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 400) h = main;
  else h = h.match(/<body\b[\s\S]*<\/body>/i)?.[0] || h;
  h = h.replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, inner) => `\n\n${'#'.repeat(+n)} ${inner}\n`)
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|tr|ul|ol|blockquote|pre|table|figure|li)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(h).split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((l, i, a) => l && l !== '•' && !/^#+$/.test(l) && !/^[IVX]{1,4}$/.test(l) && !(l === a[i - 1])).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, description, text };
}

function looksLoginWalled(title, text) {
  return text.length < 400 && /\b(log ?in|sign ?in|sign up|create an account|access denied|enable javascript|are you a robot|captcha|just a moment)\b/i.test(title + ' ' + text);
}

async function ghJson(path) {
  const r = await timedFetch(`https://api.github.com${path}`, { headers: { 'user-agent': 'michael-ai-bot', accept: 'application/vnd.github+json' } });
  if (r.status === 404) return { notFound: true };
  if (r.status === 403 || r.status === 429) return { limited: true };
  if (!r.ok) return { error: r.status };
  return r.json();
}
async function rawText(url, max = PAGE_CAP) {
  const r = await timedFetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) return null;
  return (await readCapped(r, max * 3)).toString('utf8').slice(0, max);
}
// GitHub: repo -> API facts + README; blob -> raw file; user/org -> profile + repos.
async function readGitHub(u) {
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && parts.length < 2) {
    const user = await ghJson(`/users/${parts[0]}`);
    if (user.notFound) return { error: 'That GitHub account doesn\'t exist (or is private).' };
    if (user.limited) return null;
    const repos = await ghJson(`/users/${parts[0]}/repos?sort=updated&per_page=30`);
    const list = Array.isArray(repos) ? repos.map(r => `• ${r.name}${r.description ? ': ' + r.description : ''}${r.language ? ` (${r.language})` : ''}${r.homepage ? ` ${r.homepage}` : ''}`).join('\n') : '';
    return { kind: 'github-user', title: `${user.name || user.login} on GitHub`, text: `GitHub profile ${user.login}${user.name ? ` (${user.name})` : ''}. ${user.bio || ''}\nPublic repos: ${user.public_repos}. Followers: ${user.followers}.\n${user.blog ? 'Website: ' + user.blog + '\n' : ''}\nRepositories (most recently updated first):\n${list}` };
  }
  const [owner, repo0, kind, branch, ...rest] = parts;
  const repo = repo0.replace(/\.git$/, '');
  if ((kind === 'blob' || kind === 'raw') && branch && rest.length) {
    const txt = await rawText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join('/')}`);
    if (txt == null) return { error: 'I couldn\'t open that file (it may be private or moved).' };
    return { kind: 'github-file', title: `${rest.at(-1)} in ${owner}/${repo}`, text: txt };
  }
  const info = await ghJson(`/repos/${owner}/${repo}`);
  if (info.notFound) return { error: 'That GitHub repo is private or doesn\'t exist, so I can\'t read it. Make it public, or paste the text here.' };
  if (info.limited || info.error) return null;   // fall back to the HTML page
  let readme = '';
  try {
    const r = await timedFetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers: { 'user-agent': 'michael-ai-bot', accept: 'application/vnd.github.raw' } });
    if (r.ok) readme = (await readCapped(r, PAGE_CAP * 3)).toString('utf8');
  } catch {}
  let tree = '';
  if (kind === 'tree' && branch && rest.length) tree = `\n(He linked the folder ${rest.join('/')} on branch ${branch}.)`;
  const head = [
    `GitHub repository ${info.full_name}${info.private ? ' (private)' : ''}.`,
    info.description ? `Description: ${info.description}` : '',
    info.homepage ? `Website: ${info.homepage}` : '',
    info.topics?.length ? `Topics: ${info.topics.join(', ')}` : '',
    `Main language: ${info.language || 'n/a'}. Stars: ${info.stargazers_count}. Forks: ${info.forks_count}. Open issues: ${info.open_issues_count}.`,
    `Default branch: ${info.default_branch}. Created ${String(info.created_at).slice(0, 10)}, last updated ${String(info.pushed_at).slice(0, 10)}.`,
    info.license?.name ? `License: ${info.license.name}` : '',
  ].filter(Boolean).join('\n');
  return { kind: 'github-repo', title: info.full_name, text: `${head}${tree}\n\nREADME:\n${readme || '(no README)'}` };
}

// -> { ok, url, title, text, kind } | { ok:false, blocked } | { ok:false, error }
export async function fetchPage(url) {
  const blocked = blockedSite(url);
  if (blocked) return { ok: false, blocked };
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: 'That link doesn\'t look right. Send the full link starting with https://' }; }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith('.internal')) return { ok: false, error: 'I can only read public websites.' };
  try {
    if (/^(www\.)?github\.com$/i.test(u.hostname) && u.pathname.split('/').filter(Boolean).length >= 1) {
      const g = await readGitHub(u);
      if (g?.error) return { ok: false, error: g.error };
      if (g) return { ok: true, url, title: g.title, text: g.text.slice(0, PAGE_CAP), kind: g.kind };
    }
    if (/^raw\.githubusercontent\.com$|^gist\.githubusercontent\.com$/i.test(u.hostname)) {
      const t = await rawText(url);
      if (t != null) return { ok: true, url, title: u.pathname.split('/').pop(), text: t, kind: 'raw' };
    }
    const r = await timedFetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5', 'accept-language': 'en' } });
    const finalUrl = r.url || url;
    const blocked2 = blockedSite(finalUrl);
    if (blocked2) return { ok: false, blocked: blocked2 };
    if (!r.ok) return { ok: false, error: r.status === 404 ? 'That page doesn\'t exist (404).' : (r.status === 401 || r.status === 403) ? 'That site blocks bots or needs a login, so I can\'t open it. Copy the text and paste it here (or send it with *teach:*).' : `That site answered with an error (${r.status}). Try again later.` };
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const buf = await readCapped(r);
    if (ct.includes('application/pdf')) return { ok: true, url: finalUrl, title: decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || 'PDF'), kind: 'pdf', pdf: buf.length < 1_900_000 ? buf.toString('base64') : null, text: '' };
    if (/^image\//.test(ct) || /^(video|audio)\//.test(ct)) return { ok: false, error: 'That link is a picture/video file, not a page. Send the picture itself and I\'ll look at it.' };
    const body = buf.toString('utf8');
    if (ct.includes('html') || /^\s*<(!doctype|html)/i.test(body)) {
      const { title, description, text } = htmlToText(body);
      if (looksLoginWalled(title, text)) return { ok: false, error: 'That page needs a login or blocks bots, so I only see a sign-in screen. Copy the text and paste it here (or send it with *teach:*).' };
      const full = [description && !text.startsWith(description) ? `Description: ${description}` : '', text].filter(Boolean).join('\n\n');
      if (full.replace(/\s/g, '').length < 40) return { ok: false, error: 'That page loads its text with JavaScript, so I can\'t see its words from here. Copy the text and paste it here.' };
      return { ok: true, url: finalUrl, title: title || u.hostname, text: full.slice(0, PAGE_CAP), kind: 'web' };
    }
    return { ok: true, url: finalUrl, title: u.pathname.split('/').pop() || u.hostname, text: body.slice(0, PAGE_CAP), kind: 'text' };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'That site took too long to answer (10 s). Try again in a bit.' : 'I couldn\'t reach that site. Check the link and try again.' };
  }
}

export const SAVE_TAIL = '\n\nReply *save* to add this to my knowledge, or ask me anything about it.';
export function summaryPrompt(page, question) {
  return `Michael sent you this link and you just fetched it: ${page.url}\nTitle: ${page.title}\n` +
    (page.kind === 'pdf' ? '(The PDF is attached above.)\n' : `\nPAGE CONTENT (fetched now, may be cut at ${PAGE_CAP} characters):\n"""\n${page.text}\n"""\n`) +
    (question ? `\nMichael's question about it: ${question}\nAnswer his question first using the page, then a short summary.` :
      `\nSummarise it for him in WhatsApp style: one bold line saying what it is, then 3–6 short bullets with the most useful points (for a GitHub repo: what the app does, its tech, status/stars, and anything missing). Keep it under 150 words. If it relates to his own work or goals, add one line on how he can use it.`) +
    `\nDo not invent anything that isn't on the page. Do not add a "reply save" line; I add that.`;
}
export function factsPrompt(page) {
  return `From this page, write between 1 and 5 short, standalone facts worth remembering for Michael (each under 280 characters, each understandable on its own, name the thing it is about in each fact (e.g. "Bible Arena is …"), never start with "According to", no opinions, no secrets). Output ONLY the facts, one per line, each starting with "- ".\n\nSource: ${page.title} (${page.url})\n"""\n${String(page.text || '').slice(0, 20000)}\n"""`;
}
export function parseFacts(t) {
  return String(t || '').split('\n').map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim())
    .filter(l => l.length >= 8 && !/^(here are|facts?:)/i.test(l)).slice(0, 5);
}
export const SAVE_RE = /^\s*(save|save it|save this|save that|save them|yes,? save( it)?|yes|yes please|yeah|yep|ok save|teach it|add it)\s*[.!👍✅🙏]*\s*$/i;
export const SAVE_ONLY_RE = /^\s*(save|save it|save this|save that|save them|yes,? save( it)?|ok save|teach it)\s*[.!👍✅🙏]*\s*$/i;

// ---------- image generation ----------
export const IMAGE_RE = /^\s*(?:\/(?:image|img|draw|imagine)\b\s*[:：]?|(?:image|img|draw|picture|imagine)\s*[:：])\s*([\s\S]*)$/i;
const NATURAL_IMG_RE = /^\s*(?:hey\s+)?(?:please\s+)?(?:can you\s+|could you\s+|pls\s+|abeg\s+)?(?:please\s+)?(?:generate|make|create|draw|design|paint)\s+(?:me\s+|for me\s+)?(?:an?\s+|one\s+|the\s+)?(?:(?:portrait|square|status|landscape)\s+)?(?:ai\s+)?(?:image|picture|pic|photo|illustration|drawing|wallpaper|poster|artwork|flyer background)\s+(?:of|showing|with|for|where|that shows|about)\s+([\s\S]{3,})$/i;
// v9.3: posters, flyers, thumbnails, verse graphics… ("make a bible verse graphic for Psalm 23", "design my church flyer with …")
const DESIGN_NOUN = '(?:image|picture|pic|photo|illustration|drawing|wallpaper|poster|artwork|flyer|thumbnail|banner|graphic|cover|cover photo|invitation|invite card|card|background|post image|status image)';
const NATURAL2_RE = new RegExp(String.raw`^\s*(?:hey\s+)?(?:please\s+)?(?:can you\s+|could you\s+|pls\s+|abeg\s+)?(?:please\s+)?(?:generate|make|create|draw|design|paint)\s+(?:me\s+|for me\s+)?(?:an?\s+|one\s+|the\s+|my\s+)?((?:[\w'’-]+\s+){0,3}?${DESIGN_NOUN})\s+(of|showing|with|for|where|that shows|about|on)\s+([\s\S]{3,})$`, 'i');
const PLAIN_NOUN = /^(?:(?:portrait|square|status|landscape|ai)\s+)*(?:image|picture|pic|photo|illustration|drawing|artwork)$/i;
export const DESIGN_KIND_RE = /\b(poster|flyer|thumbnail|banner|graphic|cover|invitation|invite|card)\b/i;
export function brandStyle(prompt) {
  const p = String(prompt || ''); let s = brandStyle95(p);   // v9.5: RETAIN palette, Nigerian look
  if (/\bblossom\b/i.test(p)) s += ', Blossom brand look: near-black and graphite with a dusty-rose accent, elegant and modern';
  if (/\b(bible|verse|psalm|faith|church|jesus|christ|god|prayer|pray|worship|gospel|sermon|cross)\b/i.test(p)) s += ', reverent and hopeful, warm golden light, dignified';
  if (/\bthumbnail\b/i.test(p)) s += ', bold high-contrast subject, expressive face, uncluttered background, clear empty area for a title';
  else if (DESIGN_KIND_RE.test(p)) s += ', clean layout with generous empty space at the top for a headline';
  return s;
}
export function detectImage(text) {
  const t = String(text || '').trim();
  let m = t.match(IMAGE_RE);
  if (!m) { const n2 = t.match(NATURAL2_RE); if (n2) m = [n2[0], PLAIN_NOUN.test(n2[1].trim()) ? n2[3] : `${n2[1].trim()} ${n2[2]} ${n2[3]}`]; }   // v9.3
  if (!m) m = t.match(NATURAL_IMG_RE);
  if (!m) return null;
  let prompt = m[1].trim();
  let w = 1080, h = 1350, shape = 'portrait 4:5';
  const all = t.toLowerCase();
  if (/\b(status|story|stories|9:16|9x16|wallpaper|reel)\b/.test(all) || /^\s*portrait\b/i.test(prompt) || /\bportrait (size|format|image)\b/i.test(all)) { w = 1080; h = 1920; shape = 'status 9:16'; }
  else if (/\b(square|1:1|profile pic(ture)?|dp)\b/.test(all)) { w = 1080; h = 1080; shape = 'square'; }
  else if (/\b(landscape|wide|16:9|banner|cover photo|youtube thumbnail)\b/.test(all)) { w = 1920; h = 1080; shape = 'landscape 16:9'; }
  prompt = prompt.replace(/^\s*(portrait|square|status|landscape)\b[\s,:-]*/i, '').trim();
  return { prompt, width: w, height: h, shape };
}
const pacificDay = (now = Date.now()) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function imageQuota(state, limit = +(process.env.IMG_DAILY_LIMIT || 20), now = Date.now()) {
  const day = pacificDay(now);
  const q = state.img && state.img.day === day ? state.img : { day, n: 0 };
  return { day, used: q.n, left: Math.max(0, limit - q.n), limit };
}
export function countImage(state, now = Date.now()) {
  const day = pacificDay(now);
  state.img = state.img && state.img.day === day ? { day, n: state.img.n + 1 } : { day, n: 1 };
}
const STYLE = ', high quality, sharp focus, clean composition, vivid natural colors, no text, no letters, no watermark';
function nextMidnightPT(now = Date.now()) {
  const d = new Date(now);
  const pt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const diff = d.getTime() - pt.getTime();
  pt.setHours(24, 0, 5, 0);
  return pt.getTime() + diff;
}
export function providerList(env = process.env) {
  const out = [];
  if (env.POLLINATIONS_KEY) out.push('pollinations');
  if (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN) out.push('cloudflare');
  if (env.GEMINI_API_KEY && env.IMG_GEMINI !== '0') out.push('gemini');
  if (env.IMG_ANON !== '0') out.push('pollinations-free');
  return out;
}
// health: the keyed provider in use, else "pending_key" (the keyless Pollinations fallback is best-effort and reported apart)
export function primaryProvider(env = process.env) { return providerList(env).find(p => p === 'pollinations' || p === 'cloudflare') || 'pending_key'; }

async function tryProvider(p, prompt, w, h, seed, ms) {
  const full = prompt + brandStyle(prompt) + STYLE;   // v9.3: brand/faith/thumbnail/poster looks
  if (p === 'pollinations' || p === 'pollinations-free') {
    const base = p === 'pollinations' ? 'https://gen.pollinations.ai/image/' : 'https://image.pollinations.ai/prompt/';
    const model = p === 'pollinations' ? (process.env.POLLINATIONS_MODEL || 'flux') : 'flux';
    const url = `${base}${encodeURIComponent(full.slice(0, 1500))}?width=${w}&height=${h}&seed=${seed}&nologo=true&safe=true&model=${encodeURIComponent(model)}`;
    const headers = p === 'pollinations' ? { authorization: `Bearer ${process.env.POLLINATIONS_KEY}` } : {};
    const r = await timedFetch(url, { headers }, ms);
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !ct.startsWith('image/')) return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 200) };
    return { ok: true, bytes: Buffer.from(await r.arrayBuffer()), mime: ct, model: r.headers.get('x-model-used') || model };
  }
  if (p === 'cloudflare') {
    const r = await timedFetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.CF_AI_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: full, steps: 6, seed }),
    }, ms);
    if (!r.ok) return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 200) };
    const j = await r.json();
    if (!j.result?.image) return { ok: false, status: 'empty' };
    return { ok: true, bytes: Buffer.from(j.result.image, 'base64'), mime: 'image/jpeg', model: 'flux-1-schnell' };
  }
  if (p === 'gemini') {
    const aspect = w === h ? '1:1' : h / w > 1.6 ? '9:16' : h > w ? '4:5' : '16:9';
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
    const r = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: full }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }),
    }, ms);
    if (!r.ok) return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 200) };
    const j = await r.json();
    const part = (j.candidates?.[0]?.content?.parts || []).find(x => x.inlineData || x.inline_data);
    const d = part && (part.inlineData || part.inline_data);
    if (!d) return { ok: false, status: 'empty' };
    return { ok: true, bytes: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png', model };
  }
  return { ok: false, status: 'unknown provider' };
}
// -> { ok, bytes, mime, provider, model, tried } | { ok:false, tried, busy }
export async function generateImage(prompt, { width = 1080, height = 1350, cool = {}, budgetMs = 42000, seed } = {}) {
  const started = Date.now();
  const tried = [];
  seed = seed ?? Math.floor(Math.random() * 1e9);
  const order = providerList().filter(p => !(cool['img:' + p] > Date.now()));
  for (const p of order) {
    const left = budgetMs - (Date.now() - started);
    if (left < 5000) break;
    const attempts = p === 'pollinations-free' ? 2 : 1;
    for (let a = 0; a < attempts; a++) {
      let res;
      try { res = await tryProvider(p, prompt, width, height, seed + a, Math.min(p === 'gemini' ? 25000 : 35000, budgetMs - (Date.now() - started))); }
      catch (e) { res = { ok: false, status: e.name === 'AbortError' ? 'timeout' : 'error', detail: e.message }; }
      tried.push({ p, status: res.ok ? 200 : res.status });
      if (res.ok && res.bytes.length > 2000) return { ...res, provider: p, tried, ms: Date.now() - started };
      if (p === 'gemini' && res.status === 429) { cool['img:gemini'] = nextMidnightPT(); break; }
      if (res.status === 401 || res.status === 403) { cool['img:' + p] = Date.now() + 3600e3; break; }
      if (a + 1 < attempts && budgetMs - (Date.now() - started) > 12000) await new Promise(r => setTimeout(r, 4000));
    }
  }
  return { ok: false, tried, ms: Date.now() - started, busy: tried.some(t => t.status === 402 || t.status === 429 || t.status === 500 || t.status === 'timeout') };
}

