// v9.8.0 (24 Oct 2026): Royal People Care (RPC) daily post drop. Michael on Tab's WhatsApp, 24 Oct 14:47Z: "let my whatsapp bot
// brings it, i am always busy with many msgs here". Posts 019-104 (Sun Oct 25 - Sat Nov 21 2026), 3 a day (9 AM, 1 PM, 6:30 PM CT)
// + a Sunday story on Oct 25 / Nov 1. Media is hosted on the static Vercel project rpc-media (https://rpc-media.vercel.app/p/NNN/...).
// The plan (cleaned captions, slots, media paths) is generated into api/_rpcplan.js by tools/rpc-build.mjs from fixtures/rpc-raw.json.
//  - Trigger: the pg_cron gate row 'live' (/api/cron?task=reminders -> runReminders) wakes at 07:00 UTC = 08:00 Lagos (nextDue is
//    folded into syncSched); the daily Vercel cron "0 7 * * *" (/api/cron?task=rpc, Hobby fires it within that hour) is the backup.
//  - Once a day: michael_ai.daily_push (ns, kind 'rpc', day) claim; the first caller sends, every other run that day does nothing.
//  - Per post: header (post no., slot in CT + Nigeria time), the images / video, then the caption alone (ready to paste); then
//    "That's today's 3 ✅". Media: fetched from rpc-media and uploaded to Meta (sync answer), link send if the upload fails.
//  - WhatsApp 24 h rule: only sent if Michael wrote to the bot in the last 23.5 h. Otherwise the day is HELD (kv) and goes out
//    when he next messages the bot that same Lagos day (the gate is woken at once), plus at most one approved-template nudge
//    for that day (RPC_TEMPLATE=0 turns it off). An older held day is dropped (its slots have passed). Never retried in a loop.
//  - Heads-up: if his window will shut before the next 08:00 drop, ONE line 1 h before it shuts asks him to reply (RPC_KEEPER=0 off),
//    once per message of his, never when the reminder heads-up already went for the same message.
//  - After the plan (Nov 22 onward): one "the plan has ended" note (held like a drop if the window is shut), then nothing.
//  - Commands (owner): "royals" (today's posts again, via the gate), "royals off|on|status".
import * as NL from './_newsletter.js';
import PLAN from './_rpcplan.js';

export const PATCH = 'v9.8.0';
export const KIND = 'rpc';
export const DROP_HOUR_UTC = 7;                                    // 08:00 Lagos (Lagos is UTC+1 all year)
export const WINDOW_MS = 23.5 * 3600e3;                            // same margin as the verse push
export const KEEPER_BEFORE = 3600e3;                               // heads-up 1 h before the 24 h window shuts
export const KEY = ns => `${ns}/rpc/state`;
const log = (...a) => console.log('[rpc]', ...a);
export const rpcOn = () => process.env.RPC_DROP !== '0';
export const plan = () => PLAN;

// ---------- caption cleaning: api/_rpcclean.js ----------
export { cleanCaption, AI_LINE } from './_rpcclean.js';

// ---------- the plan ----------
export const postsFor = (date, P = PLAN) => P.posts.filter(p => p.date === date);
export const lastDate = (P = PLAN) => P.posts[P.posts.length - 1].date;
export const firstDate = (P = PLAN) => P.posts[0].date;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(date) { const d = new Date(date + 'T12:00:00Z'); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; }
export function what(p) {
  const n = p.media.length;
  if (p.kind === 'reel') return 'Reel (video)';
  if (p.kind === 'story') return `Story, ${n} frames (FB + IG Stories)`;
  return n > 1 ? `Carousel, ${n} slides` : 'Single image';
}
export function header(p) {
  if (p.kind === 'story') return `📌 *Post ${p.n}* · Story · any time today\n${what(p)}`;
  return `📌 *Post ${p.n}* · ${p.ct} CT · ${p.ng} Nigeria${p.ngNextDay ? ' (after midnight)' : ''}\n${what(p)}`;
}
export function closing(posts) {
  const feed = posts.filter(p => p.kind !== 'story').length, story = posts.some(p => p.kind === 'story'), reel = posts.some(p => p.kind === 'reel');
  return `That's today's ${feed}${story ? ' + the story' : ''} ✅${reel ? '\nReel: turn on the AI label when you post it.' : ''}`;
}
// the ordered messages for one day: [{ t:'text', body } | { t:'image'|'video', url, path }]
export function messagesFor(date, { P = PLAN, again = false } = {}) {
  const posts = postsFor(date, P);
  if (!posts.length) return [];
  const out = [{ t: 'text', body: `🌅 *Royal People Care, ${dayLabel(date)}*${again ? ' (again)' : ''} 👇` }];
  for (const p of posts) {
    out.push({ t: 'text', body: header(p) });
    for (const m of p.media) out.push({ t: /\.mp4$/i.test(m) ? 'video' : 'image', url: `${P.base}/${m}`, path: m });
    out.push({ t: 'text', body: p.caption });
  }
  out.push({ t: 'text', body: closing(posts) });
  return out;
}
export const END_TEXT = () => `🏁 *Royal People Care:* the post plan (${dayLabel(firstDate()).replace(/^\w+ /, '')} – ${dayLabel(lastDate()).replace(/^\w+ /, '')}) has ended, so there are no more daily posts from me. Ask Tab when you want the next batch.`;
export const KEEPER_TEXT = (date, today) => `⏰ Heads-up: ${date === today ? 'today' : 'tomorrow'}'s Royals posts come at 8 AM (${dayLabel(date)}). WhatsApp only lets me message you within 24 hours of your last message, so reply anything (even 👍) and they'll reach you.`;

// ---------- state ----------
const store = deps => NL.kvOf(deps);
export async function load(ns, deps = {}) { return Object.assign({ on: true, held: null, ended: false, endSent: false, keeperFor: null, tplDay: null, lastDate: null, last: null }, (await store(deps).get(KEY(ns))) || {}); }
export async function save(ns, s, deps = {}) { return store(deps).put(KEY(ns), s); }
export const dropAt = date => Date.parse(`${date}T0${DROP_HOUR_UTC}:00:00Z`);
const lagosHour = now => new Date(now + 3600e3).getUTCHours();
const isOpen = (lastIn, now) => Boolean(lastIn && now - lastIn < WINDOW_MS);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// the next date whose drop has not run yet (afterNow: today's 08:00 has passed, so this run is today's drop)
export function nextDropDate(s, today, now = Date.now(), { afterNow = false } = {}) {
  let d = s.lastDate === today || (afterNow && now >= dropAt(today)) ? NL.addDays(today, 1) : today;
  if (d < firstDate()) d = firstDate();
  return d;
}
// a held day (or end note) that can go now: he has written since it was held, and it is still that Lagos day
export function wantsFlush(s, lastIn, now = Date.now()) {
  return Boolean(s && s.on && s.held && isOpen(lastIn, now) && (s.held.end || s.held.date === NL.lagosDate(now)) && (!s.held.at || lastIn > s.held.at));
}
// next moment run() has work (folded into the 'live' gate row); null = nothing more, ever
export function nextDueOf(s, lastIn, now = Date.now(), { reminderKeeperFor = null } = {}) {
  if (!rpcOn() || !s.on) return null;
  const today = NL.lagosDate(now), c = [];
  const pastEnd = today > lastDate();
  if (wantsFlush(s, lastIn, now)) c.push(now + 5e3);
  if (!s.ended) {
    let d;
    if (pastEnd) d = today;                                         // the end note
    else if (today < firstDate()) d = firstDate();
    else d = s.lastDate === today ? NL.addDays(today, 1) : today;
    const at = d === today ? Math.max(dropAt(d), now + 30e3) : dropAt(d);
    c.push(at);
    // heads-up before his window shuts, if the next drop falls after it
    const kd = nextDropDate(s, today, now);
    if (process.env.RPC_KEEPER !== '0' && lastIn && s.keeperFor !== lastIn && reminderKeeperFor !== lastIn && kd <= lastDate()) {
      const k = lastIn + 24 * 3600e3 - KEEPER_BEFORE;
      if (lastIn + WINDOW_MS <= dropAt(kd) && k > now - 30 * 60e3) c.push(Math.max(k, now + 30e3));
    }
  }
  return c.length ? Math.min(...c) : null;
}
export async function nextDue(ns, lastIn, now = Date.now(), opt = {}, deps = {}) { return nextDueOf(await load(ns, deps), lastIn, now, opt); }

// ---------- sending ----------
// deps: { sendText, sendMediaRef(to, type, {id}|{link}, ctx), uploadMedia, fetchImpl, owner, gapMs }
export async function sendMessages(msgs, ctx, deps) {
  const gap = deps.gapMs ?? (ctx && ctx.test ? 0 : 1200);
  let sent = 0, failed = null;
  for (const m of msgs) {
    let r;
    try {
      if (m.t === 'text') r = await deps.sendText(deps.owner, m.body, ctx);
      else r = await sendOneMedia(m, ctx, deps);
    } catch (e) { r = { ok: false, detail: e.message }; }
    if (!r || r.ok === false) { failed = { at: sent, what: m.t === 'text' ? 'text' : m.path, detail: String((r && r.detail) || '').slice(0, 160) }; break; }
    sent++;
    if (gap) await sleep(m.t === 'text' ? Math.round(gap / 2) : gap);   // keeps the order on his phone (media lands slower than text)
  }
  return { sent, total: msgs.length, failed };
}
async function sendOneMedia(m, ctx, deps) {
  const mime = m.t === 'video' ? 'video/mp4' : 'image/jpeg';
  try {
    const r = await (deps.fetchImpl || globalThis.fetch)(m.url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('fetch ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const up = await deps.uploadMedia(buf, mime, ctx, m.path.split('/').pop());
    if (!up || !up.ok) throw new Error('upload ' + String(up && up.detail || '').slice(0, 80));
    const s = await deps.sendMediaRef(deps.owner, m.t, { id: up.id }, ctx);
    if (s && s.ok !== false) return s;
    throw new Error('send ' + String(s && s.detail || '').slice(0, 80));
  } catch (e) {
    log('media by id failed, sending by link', m.path, e.message);
    return deps.sendMediaRef(deps.owner, m.t, { link: m.url }, ctx);
  }
}

// one approved-template nudge for a held day (same template + check as the Sow pings; nothing until Meta approves one)
async function nudge(date, ctx, deps) {
  const name = process.env.RPC_TEMPLATE_NAME || process.env.OUTREACH_TEMPLATE || 'michael_checkin_v1';
  let st; try { st = await (deps.templateStatus || NL.templateStatusOf)(name); } catch { st = 'UNKNOWN'; }
  const status = typeof st === 'string' ? st : st.status;
  if (status !== 'APPROVED') return { ok: false, tried: `${name}:${status}` };
  const r = await deps.sendTemplate(deps.owner, name, (st && st.lang) || 'en', ['Michael', `your Royal People Care posts for ${dayLabel(date)} are ready. Reply here and I'll send them.`], ctx);
  return r && r.ok !== false ? { ok: true, name } : { ok: false, tried: `${name}:send_failed`, detail: String(r && r.detail || '').slice(0, 120) };
}

// the scheduled run (gate row 'live' via runReminders, the 07:00 Vercel cron, or a held day after his message).
// deps: { loadState, sendText, sendTemplate, uploadMedia, sendMediaRef, owner, now, fetchImpl, gapMs, reminderKeeperFor, force }
export async function run(ctx, deps) {
  const ns = ctx && ctx.test ? 'wa-test' : 'wa';
  const now = deps.now ?? Date.now();
  const today = NL.lagosDate(now);
  const out = { ns, day: today };
  if (!rpcOn()) return { ...out, how: 'off_env' };
  const s = await load(ns, deps);
  if (!s.on) return { ...out, how: 'off' };
  const st = await deps.loadState(deps.owner, ctx);
  const lastIn = st && st.lastIn || 0, open = isOpen(lastIn, now);
  let dirty = false;
  // 1. a held day / end note: goes out once he has written (window open again)
  if (s.held) {
    if (!s.held.end && s.held.date !== today) { out.dropped_held = s.held.date; s.held = null; dirty = true; }
    else if (wantsFlush(s, lastIn, now)) {
      const h = s.held; s.held = null; await save(ns, s, deps); dirty = false;   // clear first: two runs never send it twice
      if (h.end) { const r = await deps.sendText(deps.owner, END_TEXT(), ctx); out.end = r && r.ok !== false ? 'sent_after_reply' : 'send_failed'; if (out.end === 'sent_after_reply') { const c = await load(ns, deps); c.endSent = true; await save(ns, c, deps); } }
      else {
        const r = await sendMessages(messagesFor(h.date, { again: !!h.ask }), ctx, deps);
        out.held_sent = { date: h.date, ...r, ask: !!h.ask };
        if (!h.ask) try { await NL.rpc('daily_mark', { ns, kind: KIND, day: h.date, how: r.failed ? 'partial_after_reply' : 'sent_after_reply', detail: JSON.stringify(r).slice(0, 280) }); } catch {}
      }
      return out;
    }
  }
  // 2. heads-up before his window shuts
  if (process.env.RPC_KEEPER !== '0' && lastIn && s.keeperFor !== lastIn && !s.ended) {
    const k = lastIn + 24 * 3600e3 - KEEPER_BEFORE, d = nextDropDate(s, today, now, { afterNow: true });
    if (now >= k && d <= lastDate() && lastIn + WINDOW_MS <= dropAt(d)) {
      s.keeperFor = lastIn; dirty = true;
      if (deps.reminderKeeperFor === lastIn) out.keeper = 'reminder_heads_up_went';
      else if (now < lastIn + 24 * 3600e3 - 60e3) { const r = await deps.sendText(deps.owner, KEEPER_TEXT(d, today), ctx); out.keeper = r && r.ok !== false ? 'sent' : 'send_failed'; }
      else out.keeper = 'too_late';
    }
  }
  // 3. today's drop
  if (s.ended || s.lastDate === today) { if (dirty) await save(ns, s, deps); return { ...out, how: s.ended ? 'ended' : 'done_today' }; }
  if (lagosHour(now) < DROP_HOUR_UTC + 1 && !deps.force) { if (dirty) await save(ns, s, deps); return { ...out, how: 'too_early' }; }
  if (today > lastDate()) {                                          // the plan ran out: tell him once, then stop
    s.ended = true; s.lastDate = today; out.how = 'plan_ended';
    if (open) { const r = await deps.sendText(deps.owner, END_TEXT(), ctx); s.endSent = r && r.ok !== false; out.end = s.endSent ? 'sent' : 'send_failed'; }
    else { s.held = { end: true, at: now }; out.end = 'held'; }
    await save(ns, s, deps); return out;
  }
  const posts = postsFor(today);
  if (!posts.length) { s.lastDate = today; await save(ns, s, deps); return { ...out, how: today < firstDate() ? 'not_started' : 'no_posts' }; }
  if (!(await NL.rpc('daily_claim', { ns, kind: KIND, day: today, how: open ? 'sending' : 'window_closed' }))) { s.lastDate = today; await save(ns, s, deps); return { ...out, how: 'already' }; }
  s.lastDate = today;
  if (!open) {
    s.held = { date: today, at: now }; out.how = 'window_closed'; out.last_message_hours_ago = lastIn ? Math.round((now - lastIn) / 36e5) : null;
    if (process.env.RPC_TEMPLATE !== '0' && deps.sendTemplate && s.tplDay !== today) { s.tplDay = today; try { out.template = await nudge(today, ctx, deps); } catch (e) { out.template = { ok: false, detail: e.message }; } }
    await save(ns, s, deps);
    try { await NL.rpc('daily_mark', { ns, kind: KIND, day: today, how: 'window_closed', detail: JSON.stringify(out.template || {}).slice(0, 280) }); } catch {}
    return out;
  }
  await save(ns, s, deps);
  const r = await sendMessages(messagesFor(today), ctx, deps);
  out.how = r.failed ? 'partial' : 'sent'; out.posts = posts.map(p => p.n); out.sent = r.sent; out.total = r.total; if (r.failed) out.failed = r.failed;
  const c = await load(ns, deps); c.last = { date: today, how: out.how, sent: r.sent, total: r.total, at: now }; await save(ns, c, deps);
  try { await NL.rpc('daily_mark', { ns, kind: KIND, day: today, how: out.how, detail: JSON.stringify({ posts: out.posts, ...r }).slice(0, 280) }); } catch {}
  log(JSON.stringify(out));
  return out;
}

// ---------- commands: "royals" (today's posts again) · "royals off|on|status" ----------
export const CMD_RE = /^\s*\/?(?:royals?|rpc|royal\s+people\s+care)(?:\s+(posts?|today|today'?s(?:\s+posts?)?|now|again|on|off|status|stop|pause|resume))?\s*[?.!🙏]*\s*$/i;
export function detect(text) {
  const m = String(text || '').match(CMD_RE);
  if (!m) return null;
  const w = (m[1] || '').toLowerCase();
  if (w === 'on' || w === 'resume') return { op: 'on' };
  if (w === 'off' || w === 'stop' || w === 'pause') return { op: 'off' };
  if (w === 'status') return { op: 'status' };
  return { op: 'today' };
}
export async function command(ctx, op, deps = {}) {
  const ns = ctx && ctx.test ? 'wa-test' : 'wa', now = deps.now ?? Date.now(), today = NL.lagosDate(now);
  const s = await load(ns, deps);
  if (op === 'on' || op === 'off') { s.on = op === 'on'; if (!s.on) s.held = null; await save(ns, s, deps); return { text: s.on ? '🔔 Royals posts are *on*: every morning at 8 AM I send that day\'s posts here.\nPause: *royals off*' : '🔕 Royals posts are *paused*. Nothing more from me until you say *royals on*.' }; }
  if (op === 'status') {
    if (!s.on) return { text: '🔕 Royals posts are *paused*. Turn on: *royals on*' };
    if (s.ended || today > lastDate()) return { text: `🏁 The Royals plan ended on ${dayLabel(lastDate())}. Ask Tab for the next batch.` };
    return { text: `🔔 Royals posts are *on*: every morning at 8 AM, ${dayLabel(firstDate()).replace(/^\w+ /, '')} – ${dayLabel(lastDate()).replace(/^\w+ /, '')}.${s.last ? `\nLast: ${dayLabel(s.last.date)}, ${s.last.sent}/${s.last.total} messages.` : ''}\nToday's again: *royals*` };
  }
  if (!postsFor(today).length) return { text: today > lastDate() ? `🏁 The Royals plan ended on ${dayLabel(lastDate())}, so there's nothing for today. Ask Tab for the next batch.` : `No Royals posts for today in the plan (it runs ${dayLabel(firstDate())} – ${dayLabel(lastDate())}).` };
  s.held = { date: today, at: 0, ask: true }; await save(ns, s, deps);
  return { text: `Sending today's Royals posts (${postsFor(today).length}) now 👇`, wake: true };
}
export function health() { return { patch: PATCH, rpc: rpcOn() ? `daily drop 07:00 UTC (08:00 Lagos) via gate row live + vercel cron 0 7 * * *; ${PLAN.posts.length} posts ${firstDate()}..${lastDate()}; media ${PLAN.base}` : 'off (RPC_DROP=0)', keeper: process.env.RPC_KEEPER !== '0', template_nudge: process.env.RPC_TEMPLATE !== '0', cmds: ['royals', 'royals on|off|status'] }; }
