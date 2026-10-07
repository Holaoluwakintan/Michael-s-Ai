// v8 (7 Oct 2026): Sow as a first-class part of the bot (Michael, m:9ef1a142 "Can my bot have access to sow??").
//   sow                      -> the next 3 queued posts in Sow, from every source (date, time, title, platforms)
//   sow week                 -> Sow's weekly summary (GET /api/stats?summary=week, x-sow-key)
//   posted <platform>        -> marks today's post as posted there (POST /api/today?action=mark {post_id, platform})
//   sow tomorrow / "what's posting tomorrow on sow" / "what's on sow friday" -> that day's posts (GET /api/today?date=)
//   "add a post for Friday 7pm about faith" -> writes the post in his voice (Lite) and queues it in Sow (same sp_posts path as
//   "schedule"; undo with *unpost*).
// Reads SOW_API_KEY (already in the env from v7.2). The next-3 list comes from Supabase through michael_ai_brain op sow_next.
import * as SOW from './_sow.js';

export const sowApiOn = () => Boolean(process.env.SOW_API_KEY);
const KEYH = () => ({ 'x-sow-key': process.env.SOW_API_KEY || '' });
export const PLATFORMS = { facebook: 'Facebook', fb_page: 'FB Page', fb_groups: 'FB groups', whatsapp: 'WhatsApp Status', wa_channel: 'WA Channel', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', threads: 'Threads', youtube: 'YouTube', linkedin: 'LinkedIn', pinterest: 'Pinterest' };
const ALIAS = [
  [/^(fb|facebook|my facebook|facebook profile|profile)$/, 'facebook'], [/^(fb page|facebook page|page|my page)$/, 'fb_page'],
  [/^(fb groups?|facebook groups?|groups?)$/, 'fb_groups'], [/^(whatsapp|wa|status|whatsapp status|wa status|my status)$/, 'whatsapp'],
  [/^(wa channel|whatsapp channel|channel|my channel)$/, 'wa_channel'], [/^(ig|insta|instagram)$/, 'instagram'], [/^(tiktok|tik tok|tt)$/, 'tiktok'],
  [/^(x|twitter)$/, 'x'], [/^threads$/, 'threads'], [/^(yt|youtube|youtube shorts|shorts)$/, 'youtube'], [/^(linkedin|linked in)$/, 'linkedin'], [/^pinterest$/, 'pinterest'],
];
export function platformOf(s) { const t = String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); for (const [re, k] of ALIAS) if (re.test(t)) return k; return null; }
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_WORD = '(today|tonight|tomorrow|tmrw|tmr|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)';
export function dateOf(word, now = Date.now()) {
  const w = String(word || '').toLowerCase();
  const today = SOW.watParts(now).date;
  const add = d => new Date(Date.parse(today + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);
  if (/^(today|tonight)$/.test(w)) return today;
  if (/^(tomorrow|tmrw|tmr)$/.test(w)) return add(1);
  const i = DAYS.findIndex(d => d.startsWith(w.slice(0, 3)));
  if (i < 0) return null;
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  return add(((i - dow + 7) % 7) || 7);
}
export const SOW_NEXT_RE = /^\s*\/?(?:sow|sow (?:queue|next|upcoming|posts)|next posts?(?: (?:on|in) sow)?|upcoming posts?(?: (?:on|in) sow)?|what'?s (?:queued|next|coming(?: up)?|up next) (?:on|in) sow|what'?s on sow)\s*[?.!]*\s*$/i;
export const SOW_WEEK_RE = /^\s*\/?(?:sow (?:week|weekly|stats|summary|report)|sow weekly (?:summary|report|stats)|my (?:sow )?week (?:on|in) sow|how (?:did|are) my (?:sow )?posts (?:do|doing)(?: this week)?|how did sow do(?: this week)?)\s*[?.!]*\s*$/i;
export const POSTED_RE = /^\s*(?:i\s+(?:have\s+|just\s+|already\s+)?)?(?:posted|shared|mark(?:ed)?(?: (?:today'?s|the) post)?(?: as)? posted)\s+(?:it\s+|today'?s post\s+|the post\s+)?(?:on|to|in)?\s*(?:my\s+)?([a-z][a-z ]{0,24}?)\s*[.!✅👍]*\s*$/i;
const DAY_RE1 = new RegExp(String.raw`^\s*\/?sow\s+${DAY_WORD}\s*[?.!]*\s*$`, 'i');
const DAY_RE2 = new RegExp(String.raw`\b(?:what'?s|what is|what are|anything|which posts?|any posts?)\b[^?]{0,40}?\b(?:posting|post(?:s|ed)?|going out|scheduled|queued|on sow|in sow)\b[^?]{0,30}?\b${DAY_WORD}\b`, 'i');
const DAY_RE3 = new RegExp(String.raw`\b(?:what'?s|what is|anything)\b[^?]{0,20}?\b(?:on|in)\s+sow\s+(?:for\s+|on\s+)?${DAY_WORD}\b`, 'i');
export const ADD_RE = /^\s*(?:please\s+|pls\s+|can you\s+|could you\s+)?(?:add|create|make|queue|put|schedule|plan)\s+(?:me\s+)?(?:a\s+|one\s+)?(?:new\s+)?(?:sow\s+)?post\s+(?:(?:on|in|to)\s+sow\s+)?(?:for|on|at)\s+(.{2,40}?)\s+(?:about|on the topic of|on|around)\s+([\s\S]{2,300}?)(?:\s+(?:on|in|to)\s+sow)?\s*[.!?]*\s*$/i;
export function detect(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 400) return null;
  if (SOW_WEEK_RE.test(t)) return { op: 'week' };
  if (SOW_NEXT_RE.test(t)) return { op: 'next' };
  let m = t.match(POSTED_RE);
  if (m) { const p = platformOf(m[1]); if (p) return { op: 'posted', platform: p }; }
  m = t.match(DAY_RE1) || (/\bsow\b|\bpost/i.test(t) ? (t.match(DAY_RE3) || t.match(DAY_RE2)) : null);
  if (m) { const date = dateOf(m[1]); if (date) return { op: 'day', date, word: m[1].toLowerCase() }; }
  m = t.match(ADD_RE);
  if (m) return { op: 'add', when: m[1].trim(), topic: m[2].trim() };
  return null;
}
export function platformsText(list) {
  const ps = (list || []).filter(p => PLATFORMS[p]);
  if (!ps.length) return '';
  if (ps.length >= 10) return 'all your platforms';
  return ps.map(p => PLATFORMS[p]).join(', ');
}
const trim = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const dayLabel = (date, now = Date.now()) => { const today = SOW.watParts(now).date; if (date === today) return 'Today'; if (date === dateOf('tomorrow', now)) return 'Tomorrow'; return new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
export function nextText(rows, now = Date.now()) {
  if (!rows || !rows.length) return `🌱 Nothing queued in Sow right now.\nAdd one: _add a post for Friday 7pm about faith_\n${SOW.SOW_URL()}`;
  return ['🌱 *Next in Sow*', ...rows.map((r, i) => `${i + 1}. *${dayLabel(r.post_date, now)} ${r.post_time}* · ${trim(r.title || r.caption, 60)}${platformsText(r.platforms) ? `\n   _${platformsText(r.platforms)}_` : ''}`), '', '_sow week · sow tomorrow · posted facebook · add a post for Friday 7pm about faith_'].join('\n');
}
export function dayText(posts, date, now = Date.now()) {
  const label = dayLabel(date, now);
  if (!posts || !posts.length) return `🌱 Nothing in Sow for ${label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : label}.\nAdd one: _add a post for ${label === 'Today' ? 'today 7pm' : label === 'Tomorrow' ? 'tomorrow 7pm' : label.split(' ')[0] + ' 7pm'} about …_`;
  return [`🌱 *${label} in Sow* (${date})`, ...posts.map(p => `• *${p.time}* · ${trim(p.title || p.caption, 60)}${p.status === 'posted' || Object.keys(p.posted || {}).length ? ` ✅ posted on ${Object.keys(p.posted || {}).map(k => PLATFORMS[k] || k).join(', ')}` : ''}${p.caption && p.title ? `\n   _${trim(p.caption, 110)}_` : ''}`)].join('\n');
}
export async function getJson(path, { method = 'GET', body = null, ms = 12000, fetchImpl = globalThis.fetch } = {}) {
  const r = await fetchImpl(`${SOW.SOW_URL()}${path}`, { method, headers: { ...KEYH(), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok) { const e = new Error(`sow ${path.split('?')[0]} ${r.status}`); e.status = r.status; e.body = j; throw e; }
  return j;
}
export const week = async () => { const j = await getJson('/api/stats?summary=week'); return (j && j.text) ? `${j.text}${j.upcoming_7d != null && !/queued/.test(j.text) ? `\n${j.upcoming_7d} posts queued for the next 7 days.` : ''}` : '🌱 Sow sent an empty summary.'; };
export const day = async date => { const j = await getJson(`/api/today?date=${encodeURIComponent(date)}`); return (j && j.posts) || (j && j.post ? [j.post] : []); };
// today's post to mark: the latest one whose time has come (else the first of the day)
export async function markPosted(platform, now = Date.now()) {
  const j = await getJson('/api/today');
  const posts = (j && j.posts) || (j && j.post ? [j.post] : []);
  if (!posts.length) return { none: true };
  const nowT = SOW.watParts(now).time;
  const post = [...posts].reverse().find(p => String(p.time) <= nowT) || posts[0];
  const r = await getJson('/api/today?action=mark', { method: 'POST', body: { post_id: post.id, platform } });
  return { ok: !!(r && r.ok), post, posted: r && r.posted };
}
export function addPrompt(topic, when) {
  return `Write ONE short social media post for Michael (Olaoluwa Michael, Nigerian Christian author) to post on ${when}, about: ${topic}.
Write as him, first person. 2–4 short lines, warm and faith-first, everyday Nigerian picture if it fits, one KJV verse quoted exactly with its reference, then 2–3 hashtags on the last line. No emojis overload (max 2). Output only the post text.`;
}
