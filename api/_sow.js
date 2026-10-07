// v7: POST TO HIS SOCIALS THROUGH OFFICIAL ROUTES ONLY. "post <text>" / "schedule <text> <time>" queue the post in his Sow app
// (sp_posts in the same Supabase project, source 'michael-ai'). Sow's own cron auto-posts to the platforms he has connected there
// (official APIs) and shows the rest as one-tap shares. No robot logins, no browser automation on Facebook/Instagram/TikTok.
import * as V from './_v5.js';

const trim = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export const SOW_URL = () => process.env.SOW_URL || 'https://sow-ng.vercel.app';
export const POST_NOW_RE = /^\s*\/?(?:post|sow|queue)(?:\s+(?:now|this|it\s+now))?\s+(?![:：])([\s\S]{3,})$/i;
export const SCHEDULE_RE = /^\s*\/?(?:schedule|sched)\s+(?:a\s+)?(?:post\s*[:：]?\s+)?([\s\S]{3,})$/i;
export const SOW_LIST_RE = /^\s*\/?(?:queued posts|my posts|scheduled posts|sow|sow queue|post queue)\s*[?.!]*\s*$/i;
export const UNPOST_RE = /^\s*\/?(?:unpost|unschedule|remove post|delete post)\s*#?(\d{1,2})?\s*[.!]*\s*$/i;
// WAT (UTC+1, no DST)
export function watParts(ms) { const d = new Date(ms + 3600e3); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; }
export function parseSchedule(rest, now = Date.now()) {
  rest = String(rest || '').replace(/^\s*((?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i, 'on $1');   // bare "friday 8pm …" means that day
  const r = V.parseReminder('remind me ' + rest, now);
  if (!r || !r.ok || !r.due || r.rep) return { ok: false };
  let text = r.text || '';
  let i = rest.indexOf(text), j0 = i >= 0 ? i + text.length : -1;
  if (i < 0 && text) {                                         // the reminder parser dropped filler words ("please"): keep his exact words
    const w = text.split(/\s+/).filter(Boolean), a = rest.indexOf(w[0]), b = rest.lastIndexOf(w[w.length - 1]);
    if (a >= 0 && b >= a) { i = a; j0 = b + w[w.length - 1].length; text = rest.slice(a, j0); }
  }
  if (i > 0) { const back = rest.slice(0, i).match(/\b(please|pls|kindly)\s+$/i); if (back && /\d|tomorrow|today|tonight|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(rest.slice(0, back.index))) { i = back.index; text = rest.slice(i, j0); } }
  if (i >= 0) { let j = j0; while (j < rest.length && /[!?.…)"'”’\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(rest[j])) j++; text = rest.slice(i, j); }
  if (r.due < now - 60e3) return { ok: false, past: true };
  return { ok: true, due: r.due, text: text.trim() };
}
export function detectPost(text, { pending = false } = {}) {
  const t = String(text || '').trim();
  if (UNPOST_RE.test(t)) { const m = t.match(UNPOST_RE); return { op: 'unpost', n: m[1] ? +m[1] : null }; }
  if (SOW_LIST_RE.test(t)) return { op: 'list' };
  let m = t.match(SCHEDULE_RE);
  if (m && !/^\s*\/?schedule\s*$/i.test(t)) return { op: 'schedule', rest: m[1].trim() };
  if (pending) return null;                                   // a Facebook draft is waiting: "post it" belongs to that flow
  m = t.match(POST_NOW_RE);
  if (m && !/^(it|it now|this|that|now)\s*[.!]*$/i.test(m[1].trim())) return { op: 'now', text: m[1].trim() };
  return null;
}
export const sowOn = () => Boolean(process.env.SCHED_KEY && process.env.SB_URL);
export function queuedText(row, { scheduled = false } = {}) {
  const when = `${row.post_date === watParts(Date.now()).date ? 'today' : row.post_date} at ${String(row.post_time).slice(0, 5)} (Lagos)`;
  return [`🌱 ${scheduled ? 'Scheduled' : 'Queued'} in *Sow* for ${when}:`, `_${trim(row.caption, 300)}_`, '',
    'Sow auto-posts it to the pages you\'ve connected (official APIs) and shows it under *Today* for one-tap sharing everywhere else.',
    `Open: ${SOW_URL()}`, 'Undo: *unpost* · list: *queued posts*'].join('\n');
}
export function listText(rows) {
  if (!rows.length) return `🌱 No posts from me queued in Sow. Try: *post God is faithful 🙏* or *schedule tomorrow 7am New chapter out!*\n${SOW_URL()}`;
  return ['🌱 *Queued in Sow (from WhatsApp)*', ...rows.map((r, i) => `${i + 1}. ${r.post_date} ${String(r.post_time).slice(0, 5)} · _${trim(r.caption, 70)}_`), '', rows.length > 1 ? `Remove one: *unpost ${rows.length}*` : 'Remove it: *unpost*', SOW_URL()].join('\n');
}
