// v7: Gemini load helper shared by chat and background jobs.
// - Two free keys: GEMINI_API_KEY and optional GEMINI_API_KEY_2. A 429 on key 1 tries key 2 before the caller moves to the next model.
// - Retry with backoff on 500/503 (busy) when the caller has time.
// - Usage counters per Pacific day (Google's free quotas reset at midnight PT), flushed to Supabase michael_ai.usage.
// - A small prompt cache (memory + Supabase gcache) for job calls whose answer can be reused (same prompt, same day).
import crypto from 'node:crypto';

const log = (...a) => console.log('[gem]', ...a);
export const ptDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function keys() {
  const out = [];
  if (process.env.GEMINI_API_KEY) out.push({ k: 1, v: process.env.GEMINI_API_KEY });
  if (process.env.GEMINI_API_KEY_2 && process.env.GEMINI_API_KEY_2 !== process.env.GEMINI_API_KEY) out.push({ k: 2, v: process.env.GEMINI_API_KEY_2 });
  if (!out.length) out.push({ k: 1, v: '' });
  return out;
}
const keyCool = new Map();            // `${k}|${model}` -> until (this instance only; the callers keep their own model cool maps)
export function _resetForTests() { keyCool.clear(); usage.clear(); mem.clear(); }
export const usage = new Map();       // `${day}|${model}|${k}|${src}` -> {calls, ok, e429, e5xx}
function count(model, k, src, field) {
  const key = `${ptDay()}|${model}|${k}|${src}`;
  const u = usage.get(key) || { calls: 0, ok: 0, e429: 0, e5xx: 0 };
  u[field] = (u[field] || 0) + 1;
  usage.set(key, u);
}
export function usageRows() {
  return [...usage.entries()].map(([key, u]) => { const [day, model, k, src] = key.split('|'); return { day, model, k: +k, src, ...u }; });
}
export async function flushUsage(rpc) {
  const rows = usageRows().filter(r => r.calls || r.ok || r.e429 || r.e5xx);
  if (!rows.length || !rpc) return 0;
  usage.clear();
  try { await rpc('usage_add', { rows }, 5000); return rows.length; } catch (e) { log('usage flush failed', e.message); return 0; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const URL_OF = model => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Returns a Response (body already read and re-wrapped) like fetch would; throws like fetch on a network error / abort.
export async function gemFetch(model, body, { signal = undefined, src = 'chat', retry = 0, retryWaitMs = 1500, deadline = Infinity, fetchImpl = null } = {}) {
  const f = fetchImpl || globalThis.fetch;
  const ks = keys();
  const now = Date.now();
  let usable = ks.filter(x => !(keyCool.get(`${x.k}|${model}`) > now));
  if (!usable.length) usable = ks.slice(0, 1);
  let last = null;
  const hit429 = [];                                             // v8: keys that hit a limit during this call ("k:day" / "k:min")
  for (let i = 0; i < usable.length; i++) {
    const key = usable[i];
    let attempt = 0;
    while (true) {
      count(model, key.k, src, 'calls');
      const r = await f(URL_OF(model), { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key.v }, body: typeof body === 'string' ? body : JSON.stringify(body), signal });
      const txt = await r.text().catch(() => '');
      last = new Response(txt, { status: r.status, headers: { 'x-gem-key': String(key.k), 'x-gem-429': hit429.join(',') } });
      if (r.ok) { count(model, key.k, src, 'ok'); return last; }
      if (r.status === 429) {
        count(model, key.k, src, 'e429');
        keyCool.set(`${key.k}|${model}`, Date.now() + (/PerDay|per day|daily/i.test(txt) ? 6 * 3600e3 : 60e3));
        hit429.push(`${key.k}:${/PerDay|per day|daily/i.test(txt) ? 'day' : 'min'}`);
        last = new Response(txt, { status: r.status, headers: { 'x-gem-key': String(key.k), 'x-gem-429': hit429.join(',') } });
        break;                                                   // next key, if any
      }
      if ((r.status === 503 || r.status === 500) && attempt < retry && deadline - Date.now() > retryWaitMs * (attempt + 1) + 15000) {
        count(model, key.k, src, 'e5xx');
        attempt++; await sleep(retryWaitMs * attempt + Math.floor(Math.random() * 400)); continue;
      }
      if (r.status >= 500) count(model, key.k, src, 'e5xx');
      return last;                                               // other errors: the key doesn't matter
    }
  }
  return last;
}

// ---------- prompt cache (only for calls marked cacheable) ----------
const mem = new Map();
export const hashOf = (...parts) => crypto.createHash('sha256').update(parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join('\u0000')).digest('hex').slice(0, 40);
export async function cacheGet(h, rpc, ttlS = 6 * 3600) {
  const m = mem.get(h);
  if (m && Date.now() - m.at < ttlS * 1000) return m.v;
  if (!rpc) return null;
  try { const v = await rpc('gcache_get', { h, ttl_s: ttlS }, 4000); if (typeof v === 'string') { mem.set(h, { v, at: Date.now() }); return v; } } catch {}
  return null;
}
export async function cachePut(h, v, rpc) {
  mem.set(h, { v, at: Date.now() });
  if (mem.size > 200) mem.delete(mem.keys().next().value);
  if (!rpc) return;
  try { await rpc('gcache_put', { h, v: String(v).slice(0, 200000) }, 4000); } catch {}
}

// ---------- the "quota" block for jobs/site work (chat counts live in the chat state) ----------
const short = m => String(m).replace(/^gemini-/, '').replace(/-it$/, '').replace(/-a4b$/, '');
export function quotaText(rows, { key2 = keys().length > 1 } = {}) {
  const lines = ['', '🧮 *All AI calls today* (chat + jobs + sites)'];
  const by = {};
  for (const r of rows || []) {
    const b = by[r.model] || (by[r.model] = { calls: 0, ok: 0, e429: 0, e5xx: 0, k2: 0, src: {} });
    b.calls += r.calls; b.ok += r.ok; b.e429 += r.e429; b.e5xx += r.e5xx; if (+r.k === 2) b.k2 += r.ok;
    b.src[r.src] = (b.src[r.src] || 0) + r.ok;
  }
  const list = Object.entries(by).sort((a, b) => b[1].ok - a[1].ok);
  if (!list.length) lines.push('• none yet');
  for (const [m, b] of list) {
    const parts = Object.entries(b.src).filter(([, n]) => n).map(([s, n]) => `${s} ${n}`).join(', ');
    lines.push(`• ${short(m)}: ${b.ok} ok${parts ? ` (${parts})` : ''}${b.e429 ? ` · ${b.e429}× quota-limited` : ''}${b.e5xx ? ` · ${b.e5xx}× busy` : ''}`);
  }
  lines.push(key2 ? '🔑 2 Gemini keys: when key 1 hits a limit I switch to key 2.' : '🔑 1 Gemini key. A second free key (another Google account) doubles the daily limit: send it to Tab.');
  return lines.join('\n');
}
