// v5 helpers for Michael AI: reminders (rule parser in Africa/Lagos time + Gemini fallback), live web search
// (keyless: DuckDuckGo + Google News RSS + Wikipedia, read with the v4 page reader, answered by Gemini with sources),
// model rotation tiers, usage counters, and the scheduler gate (Supabase pg_cron wakes /api/cron?task=reminders when due).
// Env (optional): SCHED_KEY, SB_URL, SB_ANON_KEY (scheduler gate), SEARCH_DAILY_LIMIT (default 30).
import https from 'node:https';
import { fetchPage, blockedSite, decodeEntities } from './_extras.js';

// ---------- models: rotation tiers (observed on Michael's free key, 6 Oct 2026) ----------
// SMART: best answers, small free daily quota each (~20/day on full Flash). LITE: fast, bigger quota. GEMMA: open models
// served by the same API with a large free daily quota; they "think" unless told thinkingLevel minimal.
// v9.7 (19 Oct 2026 probe + Oct 12-19 usage): 3.6-flash and 3.5-flash answer most often; flash-latest / 3.8 were 503 "busy" most of the
// week; Gemma was 429 all week, so it goes last. On top of this order, askGemini ranks by each model's ok/fail count today (_v97 rankChain).
export const SMART = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
export const LITE = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
export const GEMMA = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
export const HARD_CHAIN = [...SMART, ...LITE, ...GEMMA];   // long/hard asks, writing, media
export const EASY_CHAIN = [...LITE, ...SMART, ...GEMMA];   // short everyday questions: Lite first, then Flash before the (429) Gemma
export const isGemma = m => /^gemma/i.test(m);
const HARD_RE = /\b(write|draft|rewrite|compose|script|caption|essay|article|newsletter|devotional|sermon|poem|story|plan|strategy|explain|analy[sz]e|compare|review|summari[sz]e|outline|step[- ]by[- ]step|code|debug|function|translate|proposal|pitch|letter|email|bio|marketing|business plan|ideas?)\b/i;
export function isHard(text, media = false) {
  if (media) return true;
  const t = String(text || '');
  return t.length > 280 || HARD_RE.test(t);
}
// Writing his public content needs the full voice pack in the prompt; everyday chat does not.
const VOICE_RE = /\b(post|caption|reel|script|channel|status|newsletter|devotional|bio|comment|reply to|letter|manga|hook|hashtags?|write (?:a|an|me|my)|draft|in my voice|as me)\b/i;
export const needsVoice = text => VOICE_RE.test(String(text || ''));

// ---------- knowledge retrieval (keep the prompt small) ----------
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those my me i you your we our at by from as what who when where how why which do does did can could should would will just please pls about into than then them they he she his her its not no yes ok okay so if but have has had get got make made tell know want need'.split(' '));
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9₦#@\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
export const KB_SMALL = 6000;   // all taught facts go in while they total under this many chars
// -> facts to send: all of them when small; otherwise the most relevant (keyword overlap) + the newest few, within KB_SMALL chars.
export function relevantFacts(facts, query, budget = KB_SMALL) {
  const list = (facts || []).map((f, i) => ({ i, t: String(f.t ?? f) }));
  const total = list.reduce((n, f) => n + f.t.length + 3, 0);
  if (total <= budget) return { facts: facts || [], omitted: 0 };
  const q = new Set(words(query));
  const scored = list.map(f => { const w = words(f.t); let s = 0; for (const x of new Set(w)) if (q.has(x)) s += 1; return { ...f, s }; });
  const pick = new Set(); let used = 0;
  const add = f => { if (pick.has(f.i) || used + f.t.length + 3 > budget) return; pick.add(f.i); used += f.t.length + 3; };
  list.slice(-5).forEach(add);                                   // newest 5 (standing instructions are usually recent)
  scored.filter(f => f.s > 0).sort((a, b) => b.s - a.s || b.i - a.i).forEach(add);
  const kept = [...pick].sort((a, b) => a - b).map(i => facts[i]);
  return { facts: kept, omitted: list.length - kept.length };
}

// ---------- usage counters (per Pacific day, the day Google's free quotas reset on) ----------
export const ptDay = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function usageOf(state, now = Date.now()) {
  const day = ptDay(now);
  if (!state.usage || state.usage.day !== day) state.usage = { day, m: {}, f: {}, lim: {} };
  return state.usage;
}
export function bump(state, key, n = 1) { const u = usageOf(state); u.f[key] = (u.f[key] || 0) + n; return u.f[key]; }
export function bumpModel(state, model) { const u = usageOf(state); u.m[model] = (u.m[model] || 0) + 1; }
export function noteLimit(state, model) { const u = usageOf(state); if (u.lim[model] == null) u.lim[model] = u.m[model] || 0; }
export const SEARCH_LIMIT = () => +(process.env.SEARCH_DAILY_LIMIT || 30);
const short = m => m.replace(/^gemini-/, '').replace(/-it$/, '');
export function usageText(state, { imgUsed = 0, imgLimit = 20, active = 0, now = Date.now() } = {}) {
  const u = usageOf(state, now);
  const cool = state.cool || {};
  const models = Object.entries({ ...Object.fromEntries(Object.keys(u.lim).map(k => [k, 0])), ...u.m }).sort((a, b) => b[1] - a[1]);
  const total = models.reduce((n, [, c]) => n + c, 0);
  const lines = ['📊 *Today\'s usage* (free quotas reset 8–9am Nigeria time)', '', `🧠 AI answers: ${total}`];
  for (const [m, c] of models) lines.push(`• ${short(m)}: ${c}${u.lim[m] != null ? ` (quota hit after ${u.lim[m]})` : ''}`);
  const parked = Object.keys(cool).filter(m => cool[m] > now && u.lim[m] != null);
  if (!models.length) lines.push('• none yet');
  lines.push('', `🌍 Web searches: ${u.f.search || 0}/${SEARCH_LIMIT()}`, `🎨 Pictures: ${imgUsed}/${imgLimit}`, `🔗 Links read: ${u.f.read || 0}`, `📄 Files read: ${u.f.file || 0}${u.f.fulltext ? ` (full text sent ${u.f.fulltext}×)` : ''}`,
    `⏰ Reminders sent: ${u.f.remind || 0} (active: ${active})`, `🛠️ Agent jobs started: ${u.f.agent || 0}`);
  if (u.f.cache) lines.push(`♻️ Answered from memory (no quota used): ${u.f.cache}`);
  if (parked.length) lines.push('', `_Resting till the reset: ${parked.map(short).join(', ')}. I switch to the next model automatically._`);
  return lines.join('\n');
}

// ---------- Lagos time (WAT = UTC+1 all year, no daylight saving) ----------
export const TZ_OFFSET = 3600e3;
const L = ms => { const d = new Date(ms + TZ_OFFSET); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() }; };
const fromL = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo, d, h, mi) - TZ_OFFSET;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?';
const dayIdx = s => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(String(s).toLowerCase().slice(0, 3));
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const monIdx = s => MONTHS.indexOf(String(s).toLowerCase().slice(0, 3));
export function fmtTime(ms) { const { h, mi } = L(ms); const hh = h % 12 || 12; return `${hh}:${String(mi).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; }
export function fmtWhen(ms, now = Date.now()) {
  const a = L(ms), b = L(now);
  const dayDiff = Math.round((Date.UTC(a.y, a.mo, a.d) - Date.UTC(b.y, b.mo, b.d)) / 864e5);
  const day = dayDiff === 0 ? 'today' : dayDiff === 1 ? 'tomorrow' : dayDiff === -1 ? 'yesterday'
    : `${DAYS[a.dow].slice(0, 3).replace(/^./, c => c.toUpperCase())} ${a.d} ${MONTHS[a.mo].replace(/^./, c => c.toUpperCase())}`;
  return `${day} at ${fmtTime(ms)}`;
}
export function fmtRepeat(rep) {
  if (!rep) return '';
  const t = fmtTime(fromL(2026, 0, 1, rep.h, rep.mi));
  if (rep.type === 'daily') return `every day at ${t}`;
  if (rep.type === 'weekdays') return `every weekday at ${t}`;
  if (rep.type === 'weekly') return `every ${DAYS[rep.dow].replace(/^./, c => c.toUpperCase())} at ${t}`;
  return '';
}
// next time a repeating reminder fires strictly after `after`
export function nextOccurrence(rep, after) {
  const a = L(after);
  for (let k = 0; k < 9; k++) {
    const t = fromL(a.y, a.mo, a.d + k, rep.h, rep.mi);
    if (t <= after) continue;
    const dow = L(t).dow;
    if (rep.type === 'weekdays' && (dow === 0 || dow === 6)) continue;
    if (rep.type === 'weekly' && dow !== rep.dow) continue;
    return t;
  }
  return null;
}

// ---------- reminder parsing (rules first; Gemini only when the rules can't tell when) ----------
export const REMIND_INTENT = /(^\s*\/?remind(?:er)?\b|\bremind\s+me\b|^\s*set\s+(?:a\s+)?reminder\b|^\s*reminder\s*[:：])/i;
export const LIST_RE = /^\s*\/?(?:reminders|my reminders|list reminders|show (?:my )?reminders|reminder list)\s*[?.!]*\s*$/i;
export const CANCEL_REM_RE = /^\s*\/?(?:cancel|delete|remove|stop|clear)\s+(?:reminder|rem)\s*#?\s*(\d+)\s*[.!]*\s*$|^\s*\/cancel\s+#?(\d+)\s*$/i;
export const CANCEL_ALL_RE = /^\s*\/?(?:cancel|delete|remove|stop|clear)\s+all\s+(?:my\s+)?reminders\s*[.!]*\s*$/i;
const PART = { morning: [8, 'am'], afternoon: [14, 'pm'], evening: [18, 'pm'], night: [21, 'pm'], tonight: [21, 'pm'] };

// -> null (not a reminder) | { ok:true, due, rep, text } | { ok:false, ask } | { ok:false, ai:true }
export function parseReminder(input, now = Date.now()) {
  const orig = String(input || '').trim();
  if (/^\s*\/?(?:teach|remember|post|search|read|image|draw)\b/i.test(orig)) return null;
  if (!REMIND_INTENT.test(orig) && !/^\s*(?:every\s*day|everyday|daily|every\s+(?:morning|evening|night|weekday)|every\s+\w+day)\b.*\bremind\b/i.test(orig)) return null;
  let s = ' ' + orig.replace(/\s+/g, ' ') + ' ';
  const cut = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  // recurrence
  let rep = null;
  const r1 = cut(/\b(?:every\s*day|everyday|daily|each\s+day|every\s+single\s+day)\b/i);
  if (r1) rep = { type: 'daily' };
  if (!rep) { const r2 = cut(/\bevery\s+(morning|evening|night|afternoon)\b/i); if (r2) rep = { type: 'daily', part: r2[1].toLowerCase() }; }
  if (!rep) { const r3 = cut(/\b(?:every\s+weekday|weekdays|every\s+working\s+day|monday\s+to\s+friday)\b/i); if (r3) rep = { type: 'weekdays' }; }
  if (!rep) { const r4 = cut(new RegExp(`\\b(?:every|each)\\s+${DAY_RE}\\b`, 'i')); if (r4) rep = { type: 'weekly', dow: dayIdx(r4[1]) }; }
  // relative: in 2 hours / in 30 mins / in an hour / in half an hour / in 1h30m / in 3 days
  let rel = null;
  const half = cut(/\bin\s+(?:half\s+an?\s+hour|30\s*min(?:ute)?s?\s*time)\b/i);
  if (half) rel = 30 * 60e3;
  if (!rel) {
    const m = cut(/\b(?:in|after)\s+(an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty[- ]five|\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|hr|h|days?|d|weeks?|wks?)\b(?:\s*(?:and\s*)?(\d+)\s*(minutes?|mins?|m)\b)?(?:\s+time)?/i);
    if (m) {
      const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45, 'forty five': 45 };
      const n = NUM[m[1].toLowerCase()] ?? parseFloat(m[1]);
      const u = m[2].toLowerCase()[0] === 'm' ? 60e3 : m[2].toLowerCase()[0] === 'h' ? 3600e3 : m[2].toLowerCase()[0] === 'd' ? 864e5 : 7 * 864e5;
      rel = n * u + (m[3] ? +m[3] * 60e3 : 0);
    }
  }
  // explicit time
  let hh = null, mm = 0, mer = null;
  let t = cut(/\b(?:at|by|@|for)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=[\s,.!?]|$)/i);
  if (t) { hh = +t[1]; mm = +(t[2] || 0); mer = t[3].toLowerCase()[0] === 'a' ? 'am' : 'pm'; }
  if (hh == null) { t = cut(/\b(noon|midday|midnight)\b/i); if (t) { hh = t[1].toLowerCase() === 'midnight' ? 0 : 12; mer = 'x'; } }
  if (hh == null) { t = cut(/\b(?:at|by|@)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i) || cut(/\b([01]?\d|2[0-3]):([0-5]\d)\b/); if (t) { hh = +t[1]; mm = +t[2]; mer = hh > 12 || /^0/.test(t[1]) ? 'x' : null; } }
  if (hh == null) { t = cut(/\b(?:at|by|@)\s*(\d{1,2})\b(?!\s*(?:%|min|hour|hr|day|week))/i); if (t && +t[1] <= 23) { hh = +t[1]; mer = hh > 12 ? 'x' : null; } }
  if (hh != null && mer === 'pm' && hh < 12) hh += 12;
  if (hh != null && mer === 'am' && hh === 12) hh = 0;
  if (hh != null && (hh > 23 || mm > 59)) return { ok: false, ask: 'That time doesn\'t look right. Try e.g. _remind me at 5pm to post the verse_' };
  // day
  let dayOff = null, dateYMD = null, part = rep?.part || null, wd = null;
  const da = cut(/\b(?:the\s+)?day\s+after\s+tomorrow\b/i); if (da) dayOff = 2;
  const tm = !da && cut(/\b(?:tomorrow|tmrw|tmr|tomorow|2moro|2morrow)(?:\s+(morning|afternoon|evening|night))?\b/i);
  if (tm) { dayOff = 1; if (tm[1]) part = tm[1].toLowerCase(); }
  const tn = cut(/\btonight\b(?!['’]s)/i); if (tn) { dayOff = dayOff ?? 0; part = 'tonight'; }
  const td = cut(/\b(?:today|this)\s+(morning|afternoon|evening)\b/i) || cut(/\btoday\b(?!['’]s)/i); if (td) { dayOff = dayOff ?? 0; if (td[1]) part = td[1].toLowerCase(); }
  const pd = !part && (cut(/\bin\s+the\s+(morning|afternoon|evening)\b/i) || cut(/\bat\s+(night)\b/i)); if (pd) part = pd[1].toLowerCase();
  const w = !rep && (cut(new RegExp(`\\b(?:on|this|next|by|coming)\\s+${DAY_RE}\\b`, 'i')) || cut(new RegExp(`\\b${DAY_RE}(?=\\s+(?:at\\s|morning|afternoon|evening|night|\\d))`, 'i')));
  if (w) { wd = { dow: dayIdx(w[1]), next: /^\s*next/i.test(w[0]) }; }
  let dm = cut(new RegExp(`\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}`, 'i'));
  if (dm) dateYMD = { d: +dm[1], mo: monIdx(dm[2]) };
  if (!dateYMD) { dm = cut(new RegExp(`\\b(?:on\\s+)?${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')); if (dm) dateYMD = { d: +dm[2], mo: monIdx(dm[1]) }; }
  if (!dateYMD) { dm = cut(/\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/); if (dm) dateYMD = { y: +dm[1], mo: +dm[2] - 1, d: +dm[3] }; }
  if (!dateYMD) { dm = cut(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); if (dm) dateYMD = { d: +dm[1], mo: +dm[2] - 1, y: dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : undefined }; }   // Nigeria: DD/MM
  // task text
  let text = s.replace(/\b(?:please|pls|plz|kindly|abeg)\b/gi, ' ')
    .replace(/\bremind\s+me\b/i, ' ').replace(/\bset\s+(?:a\s+)?reminder\b/i, ' ').replace(/^\s*\/?remind(?:er)?\s*[:：]?/i, ' ')
    .replace(/\s+/g, ' ').trim();
  for (let k = 0; k < 3; k++) {
    text = text.replace(/^(?:[,:;.\-–]\s*)+/, '').replace(/^(?:me|to|that|about|of|for|so\s+i\s+can|so\s+that\s+i)\b\s*/i, '')
      .replace(/^i\s+(?:should|need\s+to|have\s+to|must)\s+/i, '').replace(/^(?:at|on|in|me)\s*$/i, '')
      .replace(/\s*\b(?:to|at|on|in|and|by|for)\s*$/i, '').replace(/[\s,.;:!-]+$/, '').trim();
  }
  if (text.length > 300) text = text.slice(0, 300);
  if (!text || text.length < 2) return { ok: false, ask: 'What should I remind you about? e.g. _remind me at 5pm to post the verse_' };
  if (/\b(remind|every|tomorrow|today|tonight|next|on|at)\b\s*$/i.test(text)) return { ok: false, ai: true };

  if (rel != null) {
    if (rep) return { ok: false, ai: true };
    if (rel < 60e3 || rel > 366 * 864e5) return { ok: false, ask: 'I can set reminders from 1 minute up to a year ahead.' };
    return { ok: true, due: now + rel, rep: null, text };
  }
  const p = part ? PART[part] : null;
  if (hh == null && p) { hh = rep && part === 'morning' ? 7 : p[0]; mm = 0; mer = 'x'; }
  if (hh != null && mer == null && hh <= 12) {                        // "at 7" with no am/pm
    if (p) { if (p[1] === 'pm' && hh < 12) hh += 12; mer = 'x'; }
  }
  if (rep) {
    if (hh == null) return { ok: false, ask: `What time should I remind you ${rep.type === 'weekly' ? 'every ' + DAYS[rep.dow] : rep.type === 'weekdays' ? 'on weekdays' : 'every day'}? e.g. _every day at 6am remind me to post today's verse_` };
    if (mer == null && hh >= 1 && hh <= 6) hh += 12;                    // "every day at 5" -> 5pm
    const r = { type: rep.type, h: hh, mi: mm, ...(rep.type === 'weekly' ? { dow: rep.dow } : {}) };
    return { ok: true, due: nextOccurrence(r, now), rep: r, text };
  }
  if (hh == null && dayOff == null && !wd && !dateYMD) return { ok: false, ai: true };   // no "when" the rules can read
  const n = L(now);
  let base;                                                             // [y, mo, d] in Lagos
  if (dateYMD) {
    let y = dateYMD.y ?? n.y;
    if (dateYMD.mo < 0 || dateYMD.mo > 11 || dateYMD.d < 1 || dateYMD.d > 31) return { ok: false, ai: true };
    if (dateYMD.y == null && fromL(y, dateYMD.mo, dateYMD.d, 23, 59) < now) y += 1;
    base = [y, dateYMD.mo, dateYMD.d];
  } else if (wd) {
    let k = (wd.dow - n.dow + 7) % 7;
    if (wd.next && k === 0) k = 7;
    base = [n.y, n.mo, n.d + k];
  } else base = [n.y, n.mo, n.d + (dayOff || 0)];
  const explicitDay = !!(dateYMD || wd || dayOff != null);
  if (hh == null) { hh = 9; mm = 0; mer = 'x'; }                         // a day with no time: 9am
  const cands = (mer == null && hh >= 1 && hh <= 12)
    ? (explicitDay && !(dayOff === 0) ? [hh >= 7 && hh < 12 ? hh : (hh === 12 ? 12 : hh + 12)] : [hh % 12, hh % 12 + 12].map(x => x === 0 && hh === 12 ? 12 : x))
    : [hh];
  let due = null;
  for (const h of cands.sort((a, b) => a - b)) { const t2 = fromL(base[0], base[1], base[2], h, mm); if (t2 > now + 30e3) { due = t2; break; } }
  if (due == null) {
    if (explicitDay && dayOff !== 0 && !wd) return { ok: false, ask: 'That time has already passed. Send a time in the future, e.g. _remind me tomorrow 7am to …_' };
    let t3 = fromL(base[0], base[1], base[2] + (wd ? 7 : 1), cands[0], mm);
    due = t3;
  }
  if (due - now > 366 * 864e5) return { ok: false, ask: 'I can set reminders up to a year ahead.' };
  return { ok: true, due, rep: null, text };
}
export function reminderAIPrompt(text, now = Date.now()) {
  const n = L(now);
  const iso = `${n.y}-${String(n.mo + 1).padStart(2, '0')}-${String(n.d).padStart(2, '0')}T${String(n.h).padStart(2, '0')}:${String(n.mi).padStart(2, '0')}`;
  return `Now it is ${DAYS[n.dow]} ${iso} in Nigeria (Africa/Lagos, UTC+1). Michael wrote: """${String(text).slice(0, 500)}"""
Turn it into ONE reminder. Reply with ONLY a JSON object, no code fence:
{"when":"YYYY-MM-DDTHH:MM" (Lagos local time, in the future), "repeat":null or "daily" or "weekdays" or "weekly", "task":"what to remind him, short, in his words"}
If he gave no usable time, reply {"error":"no time"}.`;
}
export function parseAIReminder(modelText, now = Date.now()) {
  const m = String(modelText || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch { return null; }
  if (j.error || !j.when || !j.task) return null;
  const x = String(j.when).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!x) return null;
  const due = fromL(+x[1], +x[2] - 1, +x[3], +x[4], +x[5]);
  const task = String(j.task).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!task) return null;
  if (j.repeat === 'daily' || j.repeat === 'weekdays' || j.repeat === 'weekly') {
    const lt = L(due);
    const rep = { type: j.repeat, h: lt.h, mi: lt.mi, ...(j.repeat === 'weekly' ? { dow: lt.dow } : {}) };
    return { ok: true, due: nextOccurrence(rep, now), rep, text: task };
  }
  if (due <= now + 30e3 || due - now > 366 * 864e5) return null;
  return { ok: true, due, rep: null, text: task };
}

// ---------- reminders store (inside the knowledge blob: kb.reminders, kb.missed; no extra blob reads) ----------
export const MAX_ACTIVE = 40;
export const active = kb => (kb.reminders || []).filter(r => r.status === 'active').sort((a, b) => a.due - b.due);
export function addReminder(kb, p, now = Date.now()) {
  kb.reminders = (kb.reminders || []).filter(r => r.status === 'active' || now - (r.sentAt || r.at || 0) < 7 * 864e5).slice(-80);
  if (active(kb).length >= MAX_ACTIVE) return null;
  kb.remSeq = (kb.remSeq || 0) + 1;
  const r = { id: kb.remSeq, text: p.text, due: p.due, rep: p.rep || null, at: now, status: 'active' };
  kb.reminders.push(r);
  return r;
}
export function listText(kb, now = Date.now()) {
  const a = active(kb);
  const lines = [];
  if (!a.length) lines.push('⏰ No reminders set.', 'Try: _remind me at 5pm to post the verse_ or _every day at 6am remind me to post today\'s verse_');
  else {
    lines.push('⏰ *Your reminders*');
    a.forEach((r, i) => lines.push(`${i + 1}. ${r.rep ? fmtRepeat(r.rep) + ` (next: ${fmtWhen(r.due, now)})` : fmtWhen(r.due, now)}: ${r.text}`));
    lines.push('', 'Cancel one with *cancel reminder 2*.');
  }
  const missed = (kb.missed || []).filter(x => now - x.due < 7 * 864e5);
  if (missed.length) {
    lines.push('', '_Missed while the chat was asleep (last 7 days):_');
    for (const x of missed.slice(-5)) lines.push(`• ${fmtWhen(x.due, now)}: ${x.text}`);
  }
  return lines.join('\n');
}
export function cancelReminder(kb, n) {
  const a = active(kb);
  if (n < 1 || n > a.length) return null;
  a[n - 1].status = 'cancelled';
  return a[n - 1];
}
export function missedNotice(kb, now = Date.now()) {
  const fresh = (kb.missed || []).filter(x => !x.told);
  if (!fresh.length) return null;
  fresh.forEach(x => { x.told = now; });
  return '⏰ *Missed while the chat was asleep:*\n' + fresh.slice(-6).map(x => `• ${fmtWhen(x.due, now)}: ${x.text}`).join('\n')
    + '\n_WhatsApp only lets me message you within 24 hours of your last message to me._';
}
export function recordMissed(kb, r, why, now = Date.now()) {
  kb.missed = [...(kb.missed || []), { id: r.id, text: r.text, due: r.due, why, at: now }].slice(-20);
}
export const WINDOW_MS = 24 * 3600e3;
export const KEEPER_AT = 23 * 3600e3;          // a heads-up 1h before WhatsApp's 24h window closes, if a reminder falls in the next day
// When should the scheduler next wake us? Earliest active reminder, or the keeper heads-up.
export function nextWake(kb, lastIn, keeperFor, now = Date.now()) {
  const a = active(kb);
  let t = a.length ? a[0].due : null;
  const k = keeperTime(kb, lastIn, keeperFor);
  if (k && (t == null || k < t)) t = k;
  return t;
}
export function keeperTime(kb, lastIn, keeperFor) {
  if (!lastIn || keeperFor === lastIn) return null;
  const close = lastIn + WINDOW_MS;
  const need = active(kb).some(r => r.due > close - 60e3 && r.due <= close + WINDOW_MS);
  return need ? lastIn + KEEPER_AT : null;
}
export function keeperText(kb, lastIn, now = Date.now()) {
  const close = lastIn + WINDOW_MS;
  const r = active(kb).find(x => x.due > close - 60e3 && x.due <= close + WINDOW_MS);
  return `⏰ Heads-up: you have a reminder ${fmtWhen(r.due, now)} (_${r.text}_).\nWhatsApp only lets me message you within 24 hours of your last message, so reply anything (even 👍) and it will reach you on time.`;
}

// ---------- scheduler gate (Supabase pg_cron calls /api/cron?task=reminders when next_due has passed) ----------
export const schedOn = () => Boolean(process.env.SCHED_KEY && process.env.SB_URL && process.env.SB_ANON_KEY);
export async function setNextWake(name, due) {
  if (!schedOn()) return { ok: false, off: true };
  try {
    const r = await fetch(`${process.env.SB_URL}/rest/v1/rpc/michael_ai_set_next`, {
      method: 'POST', headers: { apikey: process.env.SB_ANON_KEY, authorization: `Bearer ${process.env.SB_ANON_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_key: process.env.SCHED_KEY, p_name: name, p_due: due ? new Date(due).toISOString() : null }), signal: AbortSignal.timeout(6000),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, detail: e.message }; }
}

// ---------- live web search (keyless) ----------
export const SEARCH_RE = /^\s*(?:\/search\b\s*[:：]?|search\s*[:：]|google\s*[:：]|look\s*up\s*[:：]|web\s*[:：]|\/google\b\s*[:：]?)\s*([\s\S]+)$/i;
const FRESH_RE = /\b(news|headlines?|breaking|exchange\s+rate|dollar\s+(?:rate|to\s+naira)|naira\s+(?:rate|to)|black\s+market\s+rate|bitcoin|btc|crypto\s+price|stock\s+price|share\s+price|weather|forecast|temperature\s+in|who\s+won|live\s+score|scores?\s+(?:of|for|today)|fixtures?|match\s+result|election\s+results?|trending|happening\s+(?:now|today|in)|latest\s+(?:news|update|version|price|on|about|iphone|samsung|model)|current\s+(?:price|rate|president|governor|minister|ceo|champion)|price\s+of\s+\S+.*\b(?:today|now|in\s+nigeria|naira)|fuel\s+price|petrol\s+price|release\s+date|just\s+(?:released|announced))\b/i;
const QUESTION_RE = /\?\s*$|^\s*(what|what's|whats|who|who's|when|where|which|how\s+much|how\s+many|is|are|did|does|has|have|any|tell\s+me|give\s+me|check|find|show\s+me|latest)\b/i;
const NOT_SEARCH_RE = /^\s*(teach|remember|post|read|image|draw|imagine|remind|write|draft|create|make|generate|help\s+me\s+write|\/)/i;
export function detectSearch(text) {
  const t = String(text || '').trim();
  const m = t.match(SEARCH_RE);
  if (m) return { q: m[1].trim().slice(0, 300), explicit: true };
  if (t.length > 220 || NOT_SEARCH_RE.test(t) || /https?:\/\//i.test(t)) return null;
  if (FRESH_RE.test(t) && QUESTION_RE.test(t)) return { q: t.replace(/^(?:hey|hi|please|pls|abeg)[,\s]+/i, '').slice(0, 300), explicit: false };
  return null;
}
const NEWSY = /\b(news|headlines?|breaking|today|yesterday|this\s+week|latest|election|won|score|result|trending|happening|announced|released)\b/i;
const strip = h => decodeEntities(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const SUA = 'Mozilla/5.0 (Linux; Android 14; Redmi A5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
async function tfetch(url, opts = {}, ms = 7000) { return fetch(url, { ...opts, signal: AbortSignal.timeout(ms), headers: { 'user-agent': SUA, 'accept-language': 'en-NG,en;q=0.9', ...(opts.headers || {}) } }); }
// Search engines answer Node's built-in fetch with a bot page (DuckDuckGo 202, Bing without results: it sends browser-only
// "sec-fetch-*" headers); a plain node:https request with ordinary headers gets the normal results page.
export function httpsText(url, { method = 'GET', body = null, ms = 7000, hops = 3 } = {}) {
  return new Promise(resolve => {
    let u; try { u = new URL(url); } catch { return resolve({ status: 0, text: '' }); }
    const headers = { 'User-Agent': SUA, Accept: 'text/html,*/*', 'Accept-Language': 'en' };
    if (body) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers, timeout: ms }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) { res.resume(); return resolve(httpsText(new URL(res.headers.location, u).toString(), { ms, hops: hops - 1 })); }
      let d = '', n = 0; res.setEncoding('utf8');
      res.on('data', c => { n += c.length; if (n < 1_500_000) d += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: d }));
      res.on('error', () => resolve({ status: res.statusCode || 0, text: d }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, text: '' }); });
    req.on('error', () => resolve({ status: 0, text: '' }));
    if (body) req.write(body);
    req.end();
  });
}
function bingUrl(href) {
  const u = decodeEntities(href || '');
  try { const x = new URL(u); if (/bing\.com$/.test(x.hostname) && x.searchParams.get('u')) { const b = x.searchParams.get('u').replace(/^a1/, ''); return Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } return /^https?:/.test(u) && !/bing\.com|microsoft\.com\/en-us\/bing/.test(x.hostname) ? u : null; } catch { return null; }
}
export function parseBing(html) {
  const out = [];
  for (const blk of String(html).split(/<li class="b_algo"/).slice(1)) {
    const a = blk.match(/<div class="b_algoheader">\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) || blk.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = bingUrl(a[1]);
    const p = blk.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (url) out.push({ title: strip(a[2]), url, snippet: strip(p ? p[1] : '').replace(/^\d+ \w+ ago\s*·\s*/, '') });
    if (out.length >= 8) break;
  }
  return out;
}
function ddgUrl(href) {
  let u = decodeEntities(href || '');
  if (u.startsWith('//')) u = 'https:' + u;
  try { const x = new URL(u, 'https://duckduckgo.com'); const real = x.searchParams.get('uddg'); if (real) return real; if (/duckduckgo\.com$/.test(x.hostname) && /\/y\.js/.test(x.pathname)) return null; return x.toString(); } catch { return null; }
}
export function parseDDGHtml(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/g;
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    const url = ddgUrl(m[1]);
    if (!url || /duckduckgo\.com\/y\.js|ad_provider|ad_domain/.test(m[0])) continue;
    out.push({ title: strip(m[2]), url, snippet: strip(m[3] || m[4] || '') });
  }
  return out;
}
export function parseDDGLite(html) {
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 8) { const url = ddgUrl(m[1]); if (url) out.push({ title: strip(m[2]), url, snippet: strip(m[3]) }); }
  return out;
}
export function parseNewsRss(xml) {
  const out = [];
  for (const it of String(xml).split('<item>').slice(1, 7)) {
    const g = tag => (it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
    const title = strip(g('title').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const link = strip(g('link'));
    const src = strip(g('source'));
    const site = (it.match(/<source[^>]+url="([^"]+)"/) || [])[1] || '';
    const date = g('pubDate');
    if (title && link) out.push({ title, url: site || link, gnews: link, snippet: `${src ? src + ', ' : ''}${date ? new Date(date).toUTCString().slice(0, 16) : ''}`.trim(), news: true, date: date ? Date.parse(date) : 0 });
  }
  return out;
}
// v8: "what's the latest news in Nigeria today?" -> "Nigeria news" (Google News matches words literally)
export function newsQuery(q) {
  return String(q || '').replace(/[?!.,]/g, ' ')
    .replace(/\b(what'?s|whats|what|is|are|the|any|tell me|give me|show me|please|pls|abeg|hey|hi|latest|breaking|today|todays|today's|tonight|now|right now|currently|this (morning|week)|yesterday|recent(ly)?|happening|going on|on|in|about|for|of|me|update|updates|headlines?|top)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').concat(/\bnews|headlines?\b/i.test(q) ? ['news'] : []).filter((w, i, a) => w && a.indexOf(w) === i).join(' ');
}
export async function webResults(q) {
  const tried = [];
  let results = [];
  const r1 = await httpsText('https://html.duckduckgo.com/html/', { method: 'POST', body: new URLSearchParams({ q }).toString() });
  results = parseDDGHtml(r1.text); tried.push(`ddg:${r1.status}:${results.length}`);
  if (!results.length) {
    const r2 = await httpsText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en&cc=NG`);
    results = parseBing(r2.text); tried.push(`bing:${r2.status}:${results.length}`);
  }
  if (!results.length) {
    const r3 = await httpsText('https://lite.duckduckgo.com/lite/', { method: 'POST', body: new URLSearchParams({ q }).toString() });
    results = parseDDGLite(r3.text); tried.push(`ddg-lite:${r3.status}:${results.length}`);
  }
  let news = [];
  if (NEWSY.test(q) || !results.length) {
    try {
      // v8: "today / latest / this week" questions ask Google News for the last 2 (or 7) days only, with the filler words removed
      const when = /\b(today|tonight|now|right now|latest|breaking|yesterday|this morning)\b/i.test(q) ? '2d' : /\bthis week|recent(ly)?\b|\blast (match|game|night|weekend|fight|race)\b/i.test(q) ? '7d' : '';
      const nq = when ? (newsQuery(q) || q) + ` when:${when}` : q;
      let r = await tfetch(`https://news.google.com/rss/search?q=${encodeURIComponent(nq)}&hl=en-NG&gl=NG&ceid=NG:en`);
      news = parseNewsRss(r.ok ? await r.text() : '').sort((a, b) => b.date - a.date).slice(0, 4); tried.push(`gnews${when ? '-' + when : ''}:${r.status}:${news.length}`);
      if (when && !news.length) {
        r = await tfetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-NG&gl=NG&ceid=NG:en`);
        news = parseNewsRss(r.ok ? await r.text() : '').sort((a, b) => b.date - a.date).slice(0, 4); tried.push(`gnews:${r.status}:${news.length}`);
      }
    } catch { tried.push('gnews:err'); }
  }
  if (!results.length && !news.length) {
    try {
      const r = await tfetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3&origin=*`);
      const j = r.ok ? await r.json() : {};
      results = (j.query?.search || []).map(x => ({ title: x.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`, snippet: strip(x.snippet) }));
      tried.push(`wiki:${r.status}:${results.length}`);
    } catch { tried.push('wiki:err'); }
  }
  results = results.filter(x => !blockedSite(x.url));
  return { results, news, tried };
}
// read the top pages (in parallel, short timeout) so the answer has substance, not just snippets
export async function readTop(results, n = 2, ms = 7000) {
  const picks = results.filter(r => !/youtube\.com|youtu\.be|tiktok|\.pdf($|\?)/i.test(r.url)).slice(0, n);
  const pages = await Promise.all(picks.map(r => Promise.race([fetchPage(r.url).catch(() => null), new Promise(res => setTimeout(() => res(null), ms))])));
  return picks.map((r, i) => ({ ...r, text: pages[i]?.ok ? String(pages[i].text || '').slice(0, 3500) : '' }));
}
export function searchPrompt(q, sources, now = Date.now()) {
  const day = new Date(now).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `Today is ${day} (Nigeria). Michael asked: """${q}"""
Here are fresh web results (numbered). Answer him using ONLY these sources; if they don't answer it, say so in one line and give the best lead. Be short (2–6 lines, WhatsApp style, *bold* with single asterisks, no markdown links). Mention dates when they matter ("as of …"). Put the source numbers you used in square brackets, e.g. [1] or [2][3].

` + sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet ? 'Snippet: ' + s.snippet + '\n' : ''}${s.text ? 'Page text: ' + s.text.replace(/\s+/g, ' ').slice(0, 3500) + '\n' : ''}`).join('\n');
}
export const SEARCH_SYSTEM = 'You are Michael\'s personal assistant on WhatsApp (he is a Nigerian Christian author and creator). You answer questions from fresh web results, accurately and briefly. Never invent facts that are not in the sources.';
export function sourcesBlock(sources, answer) {
  const cited = [...new Set([...String(answer || '').matchAll(/\[(\d)\]/g)].map(m => +m[1] - 1))].filter(i => sources[i]);
  const use = (cited.length ? cited : [0, 1]).filter(i => sources[i]).slice(0, 3);
  return '*Sources:*\n' + use.map((i, k) => `${k + 1}. ${sources[i].title.slice(0, 90)}${sources[i].news && sources[i].snippet ? ` (${sources[i].snippet})` : ''}\n${sources[i].url}`).join('\n');
}
export function renumber(answer, sources) {
  // the answer cites [n] by source index; renumber to match the Sources list order
  const cited = [...new Set([...String(answer || '').matchAll(/\[(\d)\]/g)].map(m => +m[1] - 1))].filter(i => sources[i]).slice(0, 3);
  if (!cited.length) return answer;
  return String(answer).replace(/\[(\d)\]/g, (all, d) => { const k = cited.indexOf(+d - 1); return k >= 0 ? `[${k + 1}]` : ''; });
}
