// v7: the backend for sites the bot builds. Called by each site's mai.js (CORS, site key, server-side schema).
// POST {key, op: add|list|update|remove|signup|login|verify, ...}   GET ?op=config|list&key=...&coll=...
// The owner gets a WhatsApp ping for each new order / booking / message (sandbox sites, ns wa-test, never send: the ping comes back in the reply).
import { waitUntil } from '@vercel/functions';
import * as J from './_jobs.js';
import * as B from './_backend.js';

export const config = { maxDuration: 30 };
const log = (...a) => console.log('[site-data]', ...a);
const GRAPH = () => `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || 'v26.0'}`;

const siteCache = new Map();          // key -> {site, at}; 60 s per warm instance (saves a DB read per request)
async function siteOf(key) {
  if (!/^sk_[\w-]{8,40}$/.test(String(key || ''))) return null;
  const c = siteCache.get(key);
  if (c && Date.now() - c.at < 60e3) return c.site;
  const site = await J.rpc('site_meta', { key }, 6000);
  if (site) siteCache.set(key, { site, at: Date.now() });
  return site;
}
export function _clearCache() { siteCache.clear(); }
function cors(origin, ok) {
  const h = { 'vary': 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
  if (ok && origin) h['access-control-allow-origin'] = origin;
  return h;
}
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
function clientIp(req) { return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || '0.0.0.0'; }

export async function sendOwner(to, text, fetchImpl = fetch) {
  if (!process.env.WA_TOKEN || !process.env.WA_PHONE_ID) return { ok: false, detail: 'no WhatsApp token' };
  if (process.env.WA_DRY_RUN === '1') { log('DRY send', to, text.slice(0, 80)); return { ok: true, dry: true }; }
  try {
    const r = await fetchImpl(`${GRAPH()}/${process.env.WA_PHONE_ID}/messages`, { method: 'POST', headers: { authorization: `Bearer ${process.env.WA_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000), preview_url: false } }), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: j.messages?.[0]?.id } : { ok: false, detail: j.error?.message || String(r.status) };
  } catch (e) { return { ok: false, detail: e.message }; }
}

export async function handle(req, { fetchImpl = fetch, defer = (p) => waitUntil(p) } = {}) {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin, true) });
  if (!J.jobsOn()) return json({ ok: false, error: 'Backend not configured' }, 503);
  const url = new URL(req.url);
  let body = {};
  if (req.method === 'POST') {
    const raw = await req.text();
    if (raw.length > B.LIMITS.maxBody) return json({ ok: false, error: 'Too much data' }, 413, cors(origin, true));
    try { body = JSON.parse(raw || '{}'); } catch { return json({ ok: false, error: 'Bad request' }, 400, cors(origin, true)); }
  } else {
    body = Object.fromEntries(url.searchParams);
  }
  const op = String(body.op || (req.method === 'GET' ? 'config' : 'add'));
  let site;
  try { site = await siteOf(body.key); } catch (e) { log('site lookup failed', e.message); return json({ ok: false, error: 'Server busy, try again' }, 503, cors(origin, true)); }
  if (!site) return json({ ok: false, error: 'Unknown site' }, 404, cors(origin, true));
  const allowed = B.originOk(origin, site);
  const H = cors(origin, allowed);
  if (op === 'config') return json({ ok: true, payments: B.paymentsOn(), public_key: B.paymentsOn() ? process.env.PAYSTACK_PUBLIC_KEY : null, currency: 'NGN' }, 200, { ...H, 'cache-control': 'public, s-maxage=300, max-age=60' });
  if (!allowed) return json({ ok: false, error: 'Not allowed from this page' }, 403, H);
  const backend = site.backend || { collections: [] };
  const col = backend.collections.find(c => c.name === String(body.coll || ''));
  const ns = site.ns, slug = site.slug;
  const ipk = `${ns}:${slug}:${B.ipHash(clientIp(req))}`;
  const user = body.token ? B.verifyToken(body.token, site.site_key) : null;

  if (op === 'list') {
    if (!col) return json({ ok: false, error: 'Unknown list' }, 404, H);
    const limit = Math.min(100, Math.max(1, +body.limit || 30));
    if (col.kind === 'item') {
      if (!user) return json({ ok: false, error: 'Please sign in', auth: true }, 401, H);
      const rows = await J.rpc('data_list', { ns, slug, coll: col.name, uid: user.uid, limit });
      return json({ ok: true, rows: rows.map(r => ({ id: r.id, data: r.data, created: r.created, status: r.status })) }, 200, H);
    }
    if (!B.PUBLIC_KINDS.includes(col.kind)) return json({ ok: false, error: 'This list is private' }, 403, H);
    const rows = await J.rpc('data_list', { ns, slug, coll: col.name, limit, order: col.kind === 'score' ? 'score' : 'new' });
    return json({ ok: true, rows: rows.map(r => B.publicRow(col, r)) }, 200, { ...H, 'cache-control': 'public, s-maxage=10, max-age=5' });
  }

  if (op === 'signup' || op === 'login') {
    if (!backend.auth) return json({ ok: false, error: 'Accounts are off on this site' }, 400, H);
    const n = await J.rpc('hit', { k: ipk + ':auth', window_s: 600 });
    if (n > B.LIMITS.ipAuth10m) return json({ ok: false, error: 'Too many tries. Wait 10 minutes.' }, 429, H);
    const username = String(body.username || '').trim().toLowerCase(), pw = String(body.password || '');
    if (!B.USER_RE.test(username)) return json({ ok: false, error: 'Username: 3–40 letters, numbers, _ . @ -' }, 400, H);
    if (pw.length < 6 || pw.length > 200) return json({ ok: false, error: 'Password must be at least 6 characters' }, 400, H);
    if (op === 'signup') {
      const r = await J.rpc('user_add', { ns, slug, username, pw: B.hashPassword(pw) });
      if (r?.exists) return json({ ok: false, error: 'That username is taken' }, 409, H);
      return json({ ok: true, token: B.signToken(site.site_key, r.id, username), username }, 200, H);
    }
    const u = await J.rpc('user_get', { ns, slug, username });
    if (!u || !B.checkPassword(pw, u.pw)) return json({ ok: false, error: 'Wrong username or password' }, 401, H);
    return json({ ok: true, token: B.signToken(site.site_key, u.id, u.username), username: u.username }, 200, H);
  }

  if (op === 'update' || op === 'remove') {
    if (!user) return json({ ok: false, error: 'Please sign in', auth: true }, 401, H);
    const id = +body.id;
    if (!id) return json({ ok: false, error: 'Missing id' }, 400, H);
    if (op === 'remove') { const n = await J.rpc('data_delete', { ns, slug, id, uid: user.uid }); return json({ ok: n > 0 }, n > 0 ? 200 : 404, H); }
    const c2 = col || backend.collections.find(c => c.kind === 'item');
    const v = B.validate({ ...c2, fields: c2.fields.map(f => ({ ...f, required: false })) }, body.data);
    if (!v.ok) return json({ ok: false, error: v.errors[0] }, 400, H);
    const n = await J.rpc('data_update', { ns, slug, id, uid: user.uid, data: v.data });
    return json({ ok: n > 0 }, n > 0 ? 200 : 404, H);
  }

  if (op === 'verify') {
    if (!B.paymentsOn()) return json({ ok: false, soon: true, error: 'Payments coming soon' }, 200, H);
    const v = await B.paystackVerify(String(body.reference || ''), fetchImpl);
    if (!v.ok) return json({ ok: false, error: 'Payment not confirmed' }, 402, H);
    const id = +body.id || +v.metadata?.order_id;
    if (id) await J.rpc('data_update', { ns, slug, id, data: { _paid: v.amount, _ref: v.reference }, status: 'paid' });
    const text = `💰 *Payment received* on *${site.title || slug}*: ₦${v.amount}${id ? ` for #${id}` : ''} (${v.email || 'customer'}). Ref ${v.reference}`;
    if (ns !== 'wa-test') defer(sendOwner(site.owner, text, fetchImpl));
    return json({ ok: true, paid: v.amount, ...(ns === 'wa-test' ? { ping: text } : {}) }, 200, H);
  }

  if (op !== 'add') return json({ ok: false, error: 'Unknown action' }, 400, H);
  if (!col) return json({ ok: false, error: 'Unknown form' }, 404, H);
  // bots: a filled honeypot or an instant submit gets a fake success and nothing is stored
  if (body.hp || (Number.isFinite(+body.t) && +body.t < B.LIMITS.minFillMs && col.kind !== 'score' && col.kind !== 'item')) return json({ ok: true, id: 0 }, 200, H);
  if (col.kind === 'item' && !user) return json({ ok: false, error: 'Please sign in', auth: true }, 401, H);
  const hits = await J.rpc('hit', { k: ipk + ':w', window_s: 600 });
  if (hits > (col.kind === 'score' || col.kind === 'item' ? B.LIMITS.ipScores10m : B.LIMITS.ipWrites10m)) return json({ ok: false, error: 'Too many submissions. Please wait a few minutes.' }, 429, H);
  const v = B.validate(col, body.data);
  if (!v.ok) return json({ ok: false, error: 'Please check: ' + v.errors.slice(0, 3).join(', ') }, 400, H);
  const notify = B.NOTIFY_KINDS.includes(col.kind);
  const r = await J.rpc('data_add', { ns, slug, coll: col.name, kind: col.kind, uid: user?.uid ?? null, data: v.data, ip: B.ipHash(clientIp(req)), day_max: B.LIMITS.siteDay, notified: !notify || ns === 'wa-test' });
  if (r?.limited) return json({ ok: false, error: 'This site is busy today. Please try again tomorrow.' }, 429, H);
  const row = { id: r.id, data: v.data };
  const out = { ok: true, id: r.id };
  if (notify) {
    const text = B.notifyText(site, col, row);
    if (ns === 'wa-test') out.ping = text;                 // sandbox: the owner ping path runs, nothing is sent
    else defer((async () => { const s = await sendOwner(site.owner, text, fetchImpl); if (s.ok) await J.rpc('data_notified', { ns, ids: [r.id] }).catch(() => {}); else log('ping not sent (will come with his next message):', s.detail); })());
  }
  return json(out, 200, H);
}

export async function GET(request) { return handle(request); }
export async function POST(request) { return handle(request); }
export async function OPTIONS(request) { return handle(request); }
