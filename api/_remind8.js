// v8 (7 Oct 2026): reminders that can't be lost in chat. Live bug 07:42Z: Michael voice-noted "Remind me by 8pm 9pm 7pm to message
// Mr John to give me his VPS database"; the chat model asked which time, he said "The three time", and the chat model replied
// "I've set reminders for 7pm, 8pm, and 9pm" — nothing was stored. Fixes:
//  - parseMulti: several clock times in one request -> one reminder per time ("by 8pm 9pm 7pm", "at 7pm, 8pm and 9pm").
//  - a clarification answer ("the three time", "all", "8pm") goes back into the reminder flow with the original request.
//  - voice notes asking for a reminder come back from the model as one "REMIND: …" line and go through the real reminder flow.
//  - claimsAction: a chat reply that claims a reminder/post/message was set or sent, when no tool ran, is never passed on as is.
import * as V from './_v5.js';

const T = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)`;
const CLUSTER = new RegExp(String.raw`(?:\b(?:at|by|for|around)\s+|@\s*)?((?:${T})(?:\s*(?:,|and|&|or|then|plus|also)?\s*(?:(?:at|by)\s+)?(?:${T}))+)`, 'i');
const normT = s => s.replace(/\s+/g, '').replace(/\./g, '').toLowerCase();
export function timesIn(text) { return [...String(text || '').matchAll(new RegExp(T, 'gi'))].map(x => normT(x[0])); }
// -> null | { ok: true, multi: [parsed…], text }   (each parsed = V.parseReminder result for one time)
export function parseMulti(text, now = Date.now()) {
  const t = String(text || '');
  const m = t.match(CLUSTER);
  if (!m) return null;
  const uniq = [...new Set(timesIn(m[1]))];
  if (uniq.length < 2 || uniq.length > 6) return null;
  const items = [];
  for (const tm of uniq) {
    const p = V.parseReminder(t.replace(m[0], ` at ${tm} `).replace(/\s+/g, ' '), now);
    if (!p || !p.ok) return null;
    items.push(p);
  }
  items.sort((a, b) => a.due - b.due);
  return { ok: true, multi: items, text: items[0].text };
}
// "set reminders for 7pm 8pm and 9pm to message Mr John" -> "remind me today at 7pm, 8pm, 9pm to message Mr John"
export function coerce(text) {
  const t = String(text || '').replace(/^\[voice note\]\s*/i, '');
  if (!/\bremind(?:er)?s?\b/i.test(t)) return null;
  const times = timesIn(t); const task = t.match(/\bto\s+([\s\S]{2,200}?)\s*[?.!]*\s*$/i);
  if (!times.length || !task) return null;
  const day = (t.match(/\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i) || [])[1];
  return `remind me ${day ? (/day$/i.test(day) && !/^(today)$/i.test(day) ? 'on ' + day : day) + ' ' : ''}at ${times.join(', ')} to ${task[1].replace(new RegExp(String.raw`\b(?:at|by)?\s*${T}`, 'gi'), ' ').replace(/\s+/g, ' ').trim()}`;
}
// the full reminder parse: several times first, then the v5 single-time parser, then the loose "reminders for 7pm to …" form
export function parseAny(text, now = Date.now()) {
  const p = parseMulti(text, now) || V.parseReminder(text, now);
  if (p && p.ok) return p;
  const c = coerce(text);
  const q = c ? (parseMulti(c, now) || V.parseReminder(c, now)) : null;
  return (q && q.ok) ? q : p;
}

export const ALL_RE = /\b(all|both|each|every one|all of them|all (?:the )?(?:three|two|four|3|2|4)|the (?:three|two|four|3|2|4)(?: (?:times?|of them))?|(?:three|two|four|3|2|4) times?)\b/i;
export const looksLikeAnswer = t => { const s = String(t || '').trim(); return s.length > 0 && s.length <= 80 && (ALL_RE.test(s) || timesIn(s).length > 0 || /\b(tomorrow|tonight|today|morning|evening|noon|midnight|in \d+ ?(?:min|hour|hr))/i.test(s)); };
// original request (needs a time, or had several) + his short answer -> a parse, or null
export function resolveAnswer(request, answer, now = Date.now()) {
  const req = String(request || ''), ans = String(answer || '').trim();
  if (!req || !looksLikeAnswer(ans)) return null;
  const reqTimes = timesIn(req), ansTimes = timesIn(ans);
  if (ALL_RE.test(ans) && !ansTimes.length) return reqTimes.length >= 2 ? parseMulti(req, now) : null;   // "all of them" only means something if he gave several times
  const base = req.replace(CLUSTER, ' ').replace(new RegExp(String.raw`\b(?:at|by|for|around)?\s*${T}`, 'gi'), ' ').replace(/\s+/g, ' ').trim();
  const withAns = /\bremind/i.test(base) ? `${base} ${ansTimes.length ? 'at ' + ansTimes.join(', ') : ans}` : `remind me ${ans} to ${base}`;
  return parseAny(withAns, now);
}
// a reminder-ish request in the recent history (text or "[voice note] transcript"), newest first
export function recentRequest(history, now = Date.now(), maxAgeMs = 20 * 60e3) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== 'user' || (h.at && now - h.at > maxAgeMs)) continue;
    const t = String(h.text || '').replace(/^\[voice note\]\s*/i, '');
    if (/\bremind(?:er)?s?\b/i.test(t)) return t;
  }
  return null;
}
// chat replies that claim a completed action. kind: 'reminder' | 'action'
const CLAIM_RE = /\b(?:i'?ve|i have|i just|i'?ll|i will|i'?ve now|i've gone ahead and|all set|done)\b[^.!?\n]{0,40}?\b(set|scheduled|created|added|saved|sent|posted|booked|emailed|messaged|texted|queued|ordered|paid|deleted|cancell?ed|remind(?:ed)?)\b/i;
const CLAIM2_RE = /\b(reminders? (?:is|are|has been|have been) (?:set|scheduled|created|saved)|(?:message|email|post) (?:has been|was) (?:sent|posted))\b/i;
export function claimsAction(reply) {
  const t = String(reply || '');
  const m = t.match(CLAIM_RE) || t.match(CLAIM2_RE);
  if (!m) return null;
  if (/remind|reminder|alarm|alert/i.test(t)) return { kind: 'reminder', match: m[0] };
  if (/\b(sent|posted|emailed|messaged|texted|booked|ordered|paid|scheduled|queued)\b/i.test(m[0])) return { kind: 'action', match: m[0] };
  return null;
}
export const HONEST_REMINDER = '⚠️ I haven\'t set that reminder yet. Send it like this and I\'ll save it for real:\n_remind me at 7pm to …_\nSeveral times work too: _remind me at 7pm, 8pm and 9pm to …_';
export const ACTION_RULES = `

# HONESTY ABOUT ACTIONS (v8)
In this chat you only talk. Reminders, posts, emails, messages, schedules and builds happen only when the bot's own commands run, and the bot confirms those itself. NEVER say you have set, scheduled, saved, sent, posted, booked or reminded anything, and never say "I'll remind you". If he asks for one of these, give him the exact command in one line (for reminders: "remind me at 7pm, 8pm and 9pm to …").`;
