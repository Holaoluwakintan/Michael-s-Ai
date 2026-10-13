// v9.2 (10 Oct 2026): "Sow just posted" pings (Michael, 6:19/6:23 AM PT: "A pin each time sow post").
// Sow's own cron (/api/cron in sow-ng, every :05/:35) POSTs what it just auto-posted to /api/cron?task=sowping
// (header x-sow-key = SOW_API_KEY, the key the bot already holds for Sow). Body: { events: [ {key, platform, ok, remote_id,
// url, title, snippet, error, source} ] }. Sow sends it only when a run actually posted or failed something.
//  - success  -> one WhatsApp message per Sow run: platform, short caption, live link (several in one run = one list message)
//  - failure  -> one short line "X: failed, no credit", at most once a day per platform+reason (Lagos day)
//  - never twice: every event key is remembered for 7 days
//  - his 24h window shut -> held in kv and sent as ONE summary the next time he messages the bot (flushHeld);
//    plus at most one approved-template nudge a day (michael_checkin_v1, only once Meta APPROVES it; SOW_PING_TEMPLATE=0 turns it off)
//  - "sow pings off" / "sow pings on" / "sow pings" (status). Off = events are remembered, nothing sent or held.
import * as J from './_jobs.js';
import * as NL from './_newsletter.js';

export const KEY = ns => `${ns}/sow/pings`;
export const WINDOW_MS = 23.5 * 3600e3;
const KEEP_MS = 7 * 86400e3, MAX_HELD = 40, MAX_LIST = 8;
const NAMES = { fb_page: 'Facebook', facebook: 'Facebook', fb: 'Facebook', instagram: 'Instagram', ig: 'Instagram', youtube: 'YouTube', x: 'X', threads: 'Threads', linkedin: 'LinkedIn' };
export const nameOf = p => NAMES[String(p || '').toLowerCase()] || String(p || 'Sow');
const lagosDay = ms => new Date(ms + 3600e3).toISOString().slice(0, 10);
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
export const snip = (s, n = 90) => { s = oneLine(String(s || '').replace(/(^|\s)#[\p{L}\p{N}_:-]+/gu, '$1')).replace(/\s+([.,!?])/g, '$1'); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export const PINGS_RE = /^\s*\/?(?:sow\s+)?(?:pings?|notifications?|alerts?|notify)(?:\s+(?:from\s+)?sow)?\s+(on|off|status)\s*[.!?]*\s*$|^\s*\/?sow\s+(?:pings?|notifications?|alerts?)\s*[?.!]*\s*$|^\s*\/?(?:turn|switch)\s+(on|off)\s+(?:the\s+)?sow\s+(?:pings?|notifications?|alerts?)\s*[.!]*\s*$|^\s*\/?(?:stop|mute)\s+(?:the\s+)?sow\s+(?:pings?|notifications?|alerts?)\s*[.!]*\s*$/i;
export function detect(text) {
  const t = String(text || '').trim();
  const m = t.match(PINGS_RE);
  if (!m) return null;
  if (/^\s*\/?(?:stop|mute)\b/i.test(t)) return { op: 'off' };
  const w = (m[1] || m[2] || 'status').toLowerCase();
  if (!/\bsow\b/i.test(t)) return null;                     // "notifications off" alone is not about Sow
  return { op: w };
}

// live link for a post
export function linkOf(ev) {
  if (ev.url && /^https:\/\//.test(ev.url)) return ev.url;
  const id = String(ev.remote_id || '').trim(), p = String(ev.platform || '').toLowerCase();
  if (!id) return null;
  if (p === 'fb_page' || p === 'facebook' || p === 'fb') {
    const m = id.match(/^(\d+)_(\d+)$/);
    return m ? `https://www.facebook.com/${m[1]}/posts/${m[2]}` : `https://www.facebook.com/${id}`;
  }
  if (p === 'x') return /^\d+$/.test(id) ? `https://x.com/i/status/${id}` : null;
  if (p === 'youtube') return /^[\w-]{6,20}$/.test(id) ? `https://youtube.com/shorts/${id}` : null;
  return null;                                                 // Instagram/Threads/LinkedIn ids are not links
}
// a failure reason in plain words (also the dedupe key). Never raw JSON: a Google/Meta error body becomes its message, then a known phrase.
export function msgOf(raw) {
  let e = oneLine(raw || '');
  const m = e.match(/"(?:message|error_description|detail|title|error_user_msg)"\s*:\s*"((?:[^"\\]|\\.)*)/i);   // also a body cut mid-string
  if (m && m[1].trim()) e = m[1];
  return e.replace(/^(?:Facebook|Instagram|YouTube|X|Threads|LinkedIn)(?:\s+(?:init|upload|stats))?\s*:\s*/i, '').replace(/[{}\[\]"\\]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function reasonOf(ev) {
  const raw = oneLine(ev.error || ''), e = msgOf(raw);
  if (/credit|CreditsDepleted|payment required|\b402\b/i.test(raw)) return 'no credit';
  if (/has not been used|API v\d+ has not been|accessNotConfigured|SERVICE_DISABLED|API (?:has been|is) disabled|it is disabled/i.test(raw)) return 'API not enabled';
  if (/test user|access_denied|has not completed the Google verification|app is not verified|developer.{0,20}approved/i.test(raw)) return 'not a test user';
  if (/not connected|reconnect|invalid_grant|expired|revoked|invalid.{0,10}token|token.{0,20}invalid|session has been invalidated|\b190\b|unauthorized_client/i.test(raw)) return 'reconnect needed';
  if (/quota|rate.?limit|too many|\b429\b/i.test(raw)) return 'daily limit reached';
  if (/duplicate/i.test(raw)) return 'duplicate post refused';
  if (/no video/i.test(raw)) return 'no video on the post';
  const s = e.replace(/\b[0-9a-f]{12,}\b|\b\d{6,}\b/gi, '#').trim();
  return (s.length > 60 ? s.slice(0, 60).replace(/\s+\S*$/, '') + '…' : s) || 'unknown error';
}
export function successText(evs, { held = false } = {}) {
  const line = ev => { const l = linkOf(ev); const s = snip(ev.snippet || ev.title || ''); return { s, l }; };
  if (evs.length === 1 && !held) {
    const ev = evs[0], { s, l } = line(ev);
    return [`🌱 *Sow just posted on ${nameOf(ev.platform)}*`, s ? `_${s}_` : null, l || '(open Sow to see it)'].filter(Boolean).join('\n');
  }
  const head = held ? `🌱 *While you were away, Sow posted ${evs.length}:*` : `🌱 *Sow just posted ${evs.length}:*`;
  const rows = evs.slice(0, MAX_LIST).map((ev, i) => { const { s, l } = line(ev); return `${i + 1}. *${nameOf(ev.platform)}*${s ? ` · _${snip(s, 60)}_` : ''}${l ? `\n${l}` : ''}`; });
  if (evs.length > MAX_LIST) rows.push(`…and ${evs.length - MAX_LIST} more. *sow week* lists them all.`);
  return [head, ...rows].join('\n');
}
export const failText = f => `⚠️ ${nameOf(f.platform)}: failed, ${f.reason}`;

const store = deps => NL.kvOf(deps);
async function load(ns, deps) {
  const s = Object.assign({ on: true, seen: {}, fails: {}, held: [], tpl_day: null }, (await store(deps).get(KEY(ns))) || {});
  for (const [k, d] of Object.entries(s.fails)) {                  // v9.2.1: keys stored with a raw error body get today's plain reason (no repeat ping)
    const i = k.indexOf('|'); if (i < 0 || !/[{}"]/.test(k)) continue;
    const nk = k.slice(0, i) + '|' + reasonOf({ error: k.slice(i + 1) }); delete s.fails[k]; if (!s.fails[nk] || s.fails[nk] < d) s.fails[nk] = d;
  }
  for (const h of s.held || []) if (h.t === 'fail' && /[{}"]/.test(h.reason || '')) h.reason = reasonOf({ error: h.reason });
  return s;
}
async function save(ns, s, deps) { return store(deps).put(KEY(ns), s); }
function prune(s, now) {
  for (const [k, t] of Object.entries(s.seen)) if (now - t > KEEP_MS) delete s.seen[k];
  const today = lagosDay(now);
  for (const [k, d] of Object.entries(s.fails)) if (d !== today) delete s.fails[k];
}

// Sow told us what it posted. deps: { sendText, sendTemplate?, loadState, owner, now?, kvGet?, kvPut?, templateStatus? }
export async function ingest(ctx, events, deps) {
  const ns = ctx && ctx.test ? 'wa-test' : 'wa', now = deps.now ?? Date.now();
  const s = await load(ns, deps); prune(s, now);
  const today = lagosDay(now), wins = [], fails = [], out = { ns, got: 0, dup: 0, off: false, sent: 0, held: 0, fail_deduped: 0 };
  for (const ev of Array.isArray(events) ? events.slice(0, 60) : []) {
    if (!ev || !ev.platform) continue;
    out.got++;
    if (ev.ok) {
      const k = String(ev.key || `${ev.platform}:${ev.remote_id || ev.url || ''}`).slice(0, 160);
      if (s.seen[k]) { out.dup++; continue; }
      s.seen[k] = now; wins.push({ platform: ev.platform, remote_id: ev.remote_id || null, url: ev.url || null, title: snip(ev.title, 120), snippet: snip(ev.snippet, 200), at: now });
    } else {
      const reason = reasonOf(ev), fk = `${String(ev.platform).toLowerCase()}|${reason}`;
      if (s.fails[fk] === today || fails.some(f => f.fk === fk)) { out.fail_deduped++; continue; }
      s.fails[fk] = today; fails.push({ fk, platform: ev.platform, reason, at: now });
    }
  }
  if (!s.on) { out.off = true; await save(ns, s, deps); return out; }
  if (!wins.length && !fails.length) { await save(ns, s, deps); return out; }
  let open = false;
  try { const st = await deps.loadState(deps.owner, ctx); open = Boolean(st.lastIn && now - st.lastIn < WINDOW_MS); } catch { open = false; }
  const text = [wins.length ? successText(wins) : null, ...fails.map(failText)].filter(Boolean).join('\n\n');
  let sent = false;
  if (open) {
    try { const r = await deps.sendText(deps.owner, text, ctx); sent = Boolean(r && r.ok !== false); if (!sent) out.detail = String(r && r.detail || '').slice(0, 120); }
    catch (e) { out.detail = e.message; }
  }
  if (sent) out.sent = wins.length + fails.length;
  else {
    s.held = [...(s.held || []), ...wins.map(w => ({ t: 'ok', ...w })), ...fails.map(f => ({ t: 'fail', platform: f.platform, reason: f.reason, at: f.at }))].slice(-MAX_HELD);
    out.held = wins.length + fails.length; out.window = open ? 'open_send_failed' : 'closed';
    if (process.env.SOW_PING_TEMPLATE !== '0' && s.tpl_day !== today && deps.sendTemplate) {
      try { const t = await nudge(s.held, ctx, deps); out.template = t; if (t.ok) s.tpl_day = today; } catch (e) { out.template = { ok: false, detail: e.message }; }
    }
  }
  await save(ns, s, deps);
  return out;
}
// window shut: one approved-template nudge a day (reuses the newsletter's template check; nothing is sent until Meta approves one)
export const PING_TEMPLATES = () => [process.env.OUTREACH_TEMPLATE || 'michael_checkin_v1'];
async function nudge(held, ctx, deps) {
  const tried = [], n = held.filter(h => h.t === 'ok').length, f = held.length - n;
  for (const name of PING_TEMPLATES()) {
    let st; try { st = await (deps.templateStatus || NL.templateStatusOf)(name); } catch { st = 'UNKNOWN'; }
    const status = typeof st === 'string' ? st : st.status; tried.push(`${name}:${status}`);
    if (status !== 'APPROVED') continue;
    const what = [n ? `${n} new post${n > 1 ? 's' : ''}` : null, f ? `${f} failed post${f > 1 ? 's' : ''}` : null].filter(Boolean).join(' and ');
    const r = await deps.sendTemplate(deps.owner, name, (st && st.lang) || 'en', ['Michael', `Sow has ${what} for you. Reply here to see the links.`], ctx);
    if (r && r.ok !== false) return { ok: true, name };
    tried.push(`${name}:send_failed`);
  }
  return { ok: false, tried };
}
// Michael just messaged the bot: anything held goes out as ONE summary (once)
export async function flushHeld(ctx, deps) {
  const ns = ctx && ctx.test ? 'wa-test' : 'wa';
  const s = await load(ns, deps);
  const held = s.held || [];
  if (!held.length) return null;
  s.held = []; await save(ns, s, deps);                        // clear first: two quick messages never send it twice
  if (!s.on) return { dropped: held.length };
  const wins = held.filter(h => h.t === 'ok'), fails = held.filter(h => h.t === 'fail');
  const text = [wins.length ? successText(wins, { held: true }) : null, ...fails.map(failText)].filter(Boolean).join('\n\n');
  const r = await deps.sendText(deps.owner, text, ctx);
  if (r && r.ok !== false) return { sent: held.length };
  const cur = await load(ns, deps); cur.held = [...held, ...(cur.held || [])].slice(-MAX_HELD); await save(ns, cur, deps);   // try again next message
  return { sent: 0, kept: held.length, detail: r && r.detail };
}
// "sow pings on|off|status"
export async function command(ctx, op, deps) {
  const ns = ctx && ctx.test ? 'wa-test' : 'wa';
  const s = await load(ns, deps);
  if (op === 'on' || op === 'off') { s.on = op === 'on'; if (!s.on) s.held = []; await save(ns, s, deps); }
  return s.on
    ? (op === 'on' ? '🔔 Sow pings are *on*. Each time Sow auto-posts I\'ll send you the link here. Failures come once a day per reason.\nTurn off: *sow pings off*'
                   : '🔔 Sow pings are *on*: a message with the link each time Sow auto-posts.\nTurn off: *sow pings off*')
    : (op === 'off' ? '🔕 Sow pings are *off*. Sow keeps posting as normal, I just won\'t message you about it.\nTurn back on: *sow pings on*'
                    : '🔕 Sow pings are *off*.\nTurn on: *sow pings on*');
}
