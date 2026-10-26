// v9.7 (19 Oct 2026, worker c64017e1; Michael m:b7a56707 "Yes please" to the five upgrades from the Oct 19 audit)
// Pure helpers (no I/O), wired in whatsapp.js / _brain.js / _extras.js:
//  1. reminders: "remind me what/who/how …" and "…?" with no clock time are questions for the chat, not reminder requests;
//     a "When should I remind you?" waits only REM_PENDING_MS, and a reply that carries no time cancels it (audit bug: the next
//     unrelated message "Did you send my outreach today?" became a junk reminder because "today" looked like an answer).
//  2. smarter replies: a weak answer (empty, an error/busy line, a cut-off or looping answer) falls through to the next model;
//     each model's ok/fail count today ranks the chain, so models that keep failing today go to the back.
import * as R8 from './_remind8.js';

export const BUILD = 'v9.7';
export const PATCH = 'v9.7.4';   // v9.7.4: images (Z-Image full size, no fake UI / garbled text) · v9.7.3: live-data morning brief + Sunday review · v9.7.2: long-term memory · v9.7.1: upgrades 1+2 (reminder questions, weak-answer retry + model health)
const FEATURES = ['remind-me questions answered in chat; reminder question waits 5 min; a reply without a time cancels it', 'weak/busy/cut-off answers fall through to the next model; models ranked by today\'s ok/fail', 'long-term memory: daily sweep of new chat lines -> learned facts (max 40, deduped, no secrets, quoted) in every prompt', 'morning brief from live data (reminders, open jobs, newsletter numbers, last 48 h), no item from the last 3 briefs, Sunday week review', 'images: Pollinations zimage first (full size), flux fallback; no text/UI unless asked in quotes; negative prompt'];
export const health = () => ({ patch: PATCH, features: FEATURES.slice(), image_models: IMG_MODELS(), reminder_question_minutes: REM_PENDING_MS / 60e3, learned_max: LTM_MAX });

// ---------------- 1. reminders ----------------
export const REM_PENDING_MS = 5 * 60e3;
const clean = t => String(t || '').replace(/^\[voice note\]\s*/i, '').trim();
// an explicit clock time / relative time ("8pm", "at 7", "19:30", "in 2 hours", "noon")
export function hasClock(t) {
  const s = clean(t);
  return R8.timesIn(s).length > 0 || /\b\d{1,2}[:.]\d{2}\b/.test(s) || /\b(?:at|by|@)\s*\d{1,2}\b(?!\s*(?:%|min|hour|hr|day|week|people|times))/i.test(s)
    || /\b(?:in|after)\s+(?:\d+(?:\.\d+)?|an?|one|two|three|four|five|ten|fifteen|twenty|thirty|half\s+an?)\s*(?:minutes?|mins?|hours?|hrs?|h|days?|weeks?)\b/i.test(s)
    || /\b(?:noon|midday|midnight)\b/i.test(s);
}
const Q_AFTER = /\bremind\s+me\s+(?:again\s+)?(?:of\s+)?(?:what|what's|whats|who|who's|whom|whose|how|why|where|which|whether|if)\b/i;
const Q_WHEN = /\bremind\s+me\s+when\s+(?:is|was|are|were|did|does|do|will|has|have)\b/i;
const Q_NAME = /\bremind\s+me\s+(?:of\s+)?(?:the\s+|my\s+|our\s+|his\s+|her\s+)?(?:name|title|number|address|password|link|price)\b/i;
const TASKY = /\bremind\s+me\s+(?:again\s+)?(?:to|at|by|in|on|tomorrow|tonight|today|every|daily|next|this|later|about\s+(?:the\s+|my\s+)?(?:meeting|call|appointment|service|class|deadline))\b/i;
// true -> answer in chat, never the reminder flow
export function remindQuestion(text) {
  const t = clean(text);
  if (!/\bremind\s+me\b/i.test(t)) return false;
  if (hasClock(t)) return false;                                    // "remind me what to buy at 5pm" is a real reminder
  if (Q_AFTER.test(t) || Q_WHEN.test(t) || Q_NAME.test(t)) return true;
  if (/\?\s*$/.test(t) && !TASKY.test(t)) return true;              // "can you remind me my newsletter's name?"
  return false;
}
export const REMIND_Q_EXTRA = '\n\n# THIS IS A QUESTION, NOT A REMINDER\nHe wrote "remind me …" but he is asking you to TELL him something he forgot. Answer it directly from what you know about him (taught facts, notes, this chat). Do not talk about setting reminders. If you truly don\'t know, say so in one line and ask him to teach you.\n';
const QSTART = /^\s*(?:did|do|does|have|has|had|what|what's|whats|who|whom|whose|how|why|where|which|can|could|would|is|are|was|were|will|should|shall|tell|show|send|make|write|draft|build|post|give|check|read|search|find|explain|help|please\s+(?:tell|send|check|make|write))\b/i;
// a short reply to "When should I remind you?" that carries a time (or "all three")
export function pendingAnswer(text) {
  const t = clean(text);
  if (!R8.looksLikeAnswer(t)) return false;
  if (t.split(/\s+/).length > 12) return false;
  const timed = hasClock(t) || R8.ALL_RE.test(t);
  if (QSTART.test(t) && !(timed && /^\s*(?:what about|how about|can you do|make it)\b/i.test(t))) return false;   // "did you send … today?" is a new question
  if (/\?/.test(t) && !timed) return false;
  return true;
}
// called on every message before routing: true -> forget the pending reminder question
export function dropPending(pending, text, now = Date.now()) {
  if (!pending) return false;
  if (!pending.at || now - pending.at > REM_PENDING_MS) return true;   // expired
  if (text == null) return false;                                    // voice note / media: decided after transcription
  const t = clean(text);
  if (pendingAnswer(t)) return false;
  if (/\bremind\s+me\b|^\s*\/?remind|^\s*set\s+(?:a\s+)?reminder/i.test(t) && !remindQuestion(t)) return false;   // a fresh reminder request: its own flow
  return true;                                                       // anything else cancels it
}

// ---------------- 2. smarter replies ----------------
const BUSY_RE = /^(?:\W{0,3})(?:error\b|sorry,?\s+(?:i|something)\s+(?:can'?t|couldn'?t|went wrong|am unable)|i'?m\s+(?:currently\s+)?(?:unable to (?:respond|answer|process)|having (?:trouble|issues|difficulty))|(?:the\s+)?(?:model|service|server|system)\s+is\s+(?:currently\s+)?(?:busy|overloaded|unavailable|down)|(?:rate|usage)\s+limit|quota\b|internal (?:server )?error|service unavailable|an error occurred|request failed|as an ai(?: language model)?,? i (?:can'?t|cannot|don'?t|am not able))/i;
const REFUSE_RE = /^(?:\W{0,3})(?:i'?m sorry,?\s+(?:but\s+)?)?i (?:can'?t|cannot|am unable to|won'?t be able to) (?:help with|assist with|do that|provide|answer|fulfil+|comply)/i;
// -> null (fine) | reason string (weak: try the next model)
export function weakReply(text, { question = '', finish = '' } = {}) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  if (/^\s*<\/?think>|^\s*(?:analysis|thinking)\s*:/i.test(t)) return 'thinking-leak';
  if (t.includes('[… some background left out to fit this model …]')) return 'prompt-echo';
  const head = t.slice(0, 200);
  if (BUSY_RE.test(head)) return 'busy-or-error';
  if (REFUSE_RE.test(head) && t.length < 260 && !/\b(password|pin|bvn|otp|card)\b/i.test(String(question))) return 'refusal';
  if (/^max_tokens$/i.test(finish) && t.length < 240) return 'cut-off';
  const q = String(question || '').trim();
  if (q.length > 40 && t.length < 4) return 'too-short';
  const lines = t.split('\n').map(l => l.trim()).filter(l => l.length > 8);
  if (lines.length >= 6) { const c = new Map(); for (const l of lines) c.set(l, (c.get(l) || 0) + 1); if (Math.max(...c.values()) >= 4) return 'looping'; }
  if (t.length > 400) { const w = t.split(/\s+/); const tail = w.slice(-60).join(' '); const seg = w.slice(-12).join(' '); if (seg.length > 30 && tail.split(seg).length - 1 >= 3) return 'looping'; }
  return null;
}
// per-model health today (Lagos day). Yesterday's counts are halved, not dropped, so a model that failed all evening starts the morning behind.
export const lagosDay = (now = Date.now()) => new Date(now + 3600e3).toISOString().slice(0, 10);
export function noteHealth(state, model, ok, now = Date.now()) {
  if (!state || !model) return;
  const day = lagosDay(now);
  let mh = state.mh && typeof state.mh === 'object' ? state.mh : { day, m: {} };
  if (mh.day !== day) { const m = {}; for (const [k, v] of Object.entries(mh.m || {})) { const a = [Math.floor((v[0] || 0) / 2), Math.floor((v[1] || 0) / 2)]; if (a[0] || a[1]) m[k] = a; } mh = { day, m }; }
  const r = mh.m[model] || (mh.m[model] = [0, 0]);
  if (ok) r[0]++; else r[1]++;
  if (r[0] + r[1] > 200) { r[0] = Math.round(r[0] / 2); r[1] = Math.round(r[1] / 2); }
  state.mh = mh;
}
export const failing = (mh, model) => { const r = mh && mh.m && mh.m[model]; return Boolean(r && r[1] >= 2 && r[1] > 2 * r[0]); };
// stable: models failing today go behind the rest, everything else keeps its order
export function rankChain(order, mh) {
  if (!mh || !mh.m) return order.slice();
  const good = [], bad = [];
  for (const m of order) (failing(mh, m) ? bad : good).push(m);
  return [...good, ...bad];
}
export function healthText(mh) {
  if (!mh || !mh.m) return 'no calls yet today';
  return Object.entries(mh.m).map(([k, v]) => `${k} ${v[0]}✓/${v[1]}✗${failing(mh, k) ? ' (back of the line)' : ''}`).join(', ');
}

// ---------------- 3. long-term memory ----------------
// Once a day (the 06:00 UTC cron, before the morning brief) the day's new chat lines are read and durable facts about Michael
// are saved as kb facts marked { ltm: true }: deduped against everything he taught, capped at LTM_MAX (oldest learned drop first),
// never secrets. They reach every prompt in their own block (newest first, LTM_CHARS), so they don't compete with his taught facts.
export const LTM_MAX = 40, LTM_CHARS = 2600, LTM_FACT = 220, LTM_PER_RUN = 6;
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
export function ltmTranscript(history, since = 0) {
  const msgs = (history || []).filter(h => h && h.text && (h.at || 0) > since && !h.nudge);
  const lines = msgs.map(h => `${h.role === 'user' ? 'MICHAEL' : 'ASSISTANT'}: ${clip(h.text, h.role === 'user' ? 700 : 280)}`);
  let text = lines.join('\n'); if (text.length > 14000) text = text.slice(-14000);
  return { text, mine: msgs.filter(h => h.role === 'user').map(h => h.text).join('\n'), users: msgs.filter(h => h.role === 'user').length, last: msgs.length ? Math.max(...msgs.map(h => h.at || 0)) : since };
}
export function ltmPrompt(transcript, facts, today = new Date()) {
  const all = facts || [];
  const learned = all.filter(f => f && f.ltm);
  const taught = all.filter(f => f && !f.ltm).slice(-70);
  const day = today.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' });
  return `You keep the long-term memory of Michael's personal WhatsApp assistant. Michael is Olaoluwa Michael, a Nigerian Christian author and app/web developer in Akure.

What the assistant already knows from him (do NOT repeat these, even reworded):
${taught.map(f => '- ' + clip(f.t ?? f, 160)).join('\n') || '(none)'}

What it learned from earlier chats (numbered; you may update one):
${learned.map((f, i) => `L${i + 1}. ${clip(f.t, 200)}`).join('\n') || '(none yet)'}

Today's chat (oldest first):
"""
${transcript}
"""

Pull out only NEW, DURABLE facts that MICHAEL himself stated or clearly confirmed, worth remembering for weeks: people in his life (name + who they are), clients and projects and their decisions, plans with dates, preferences, routines, how he wants the assistant to work. One short line each, first person ("My …", "I …"), absolute dates (today is ${day}).
Skip: small talk, his questions, tasks he asked the assistant to do, anything only true today, anything the ASSISTANT said that he didn't confirm, guesses, anything already listed, and NEVER passwords, keys, tokens, PINs, OTPs, card or bank numbers.
Do NOT save: what he wants done once ("I want to make a freeze-frame in CapCut" is a task, not a fact), what he only asked about ("a movie about a CIA lawyer" does not make it his favourite), or anything you have to guess.
For each fact give "quote": his exact words from the chat that prove it (copied, at least 4 words). No quote, no fact.
If a new fact updates an "L" fact, set "replaces" to that label (e.g. "L3").
Output only JSON: {"facts":[{"t":"...","quote":"...","replaces":null}]} with at most ${LTM_PER_RUN} facts, or {"facts":[]}. Most days there is nothing new: then {"facts":[]}.`;
}
export function parseLtm(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { const j = JSON.parse(m[0]); return (Array.isArray(j.facts) ? j.facts : []).filter(f => f && typeof f.t === 'string').slice(0, LTM_PER_RUN); } catch { return []; }
}
// mutates kb.facts -> { added: [t], replaced: [t], dropped, capped }
const normQ = s => String(s || '').toLowerCase().replace(/[^a-z0-9₦]+/g, ' ').trim();
// the fact's quote must really be in Michael's own lines (anti-guess check)
export function quoted(item, michaelText) {
  const q = normQ(item && item.quote);
  return q.split(' ').length >= 4 && normQ(michaelText).includes(q);
}
export function applyLtm(kb, items, { now = new Date().toISOString(), similar, looksSecret, michaelText = null } = {}) {
  kb.facts = kb.facts || [];
  const added = [], replaced = []; let dropped = 0, capped = 0;
  const learned = () => kb.facts.filter(f => f && f.ltm);
  for (const it of items || []) {
    const t = clip(it.t, LTM_FACT).replace(/^[-•*\s]+/, '');
    if (t.length < 10 || (looksSecret && looksSecret(t)) || /\b(\d[ -]?){10,}\b/.test(t)) { dropped++; continue; }
    if (michaelText != null && !quoted(it, michaelText)) { dropped++; continue; }   // not backed by his own words
    const rl = String(it.replaces || '').match(/^L?(\d{1,3})$/i);
    const target = rl ? learned()[+rl[1] - 1] : null;
    const dupOf = kb.facts.find(f => f !== target && similar && similar(f.t ?? f, t) >= 0.7);
    if (dupOf) { dropped++; continue; }
    if (target) { target.t = t; target.at = now; replaced.push(t); continue; }
    kb.facts.push({ t, at: now, ltm: true, tag: 'learned' }); added.push(t);
  }
  const L = learned();
  if (L.length > LTM_MAX) { const drop = new Set(L.slice(0, L.length - LTM_MAX)); capped = drop.size; kb.facts = kb.facts.filter(f => !drop.has(f)); }
  return { added, replaced, dropped, capped };
}
export function ltmBlock(facts) {
  const L = (facts || []).filter(f => f && f.ltm);
  if (!L.length) return '';
  const out = []; let used = 0;
  for (const f of L.slice().reverse()) { const line = '- ' + clip(f.t, LTM_FACT); if (used + line.length + 1 > LTM_CHARS) break; out.push(line); used += line.length + 1; }
  return '\n\n# WHAT YOU LEARNED ABOUT MICHAEL FROM YOUR CHATS (saved automatically, newest first; his taught facts win if they conflict)\n' + out.join('\n') + '\n';
}

// ---------------- 4. morning brief ----------------
// Built from live data (today's reminders, open jobs, the newsletter's real numbers, what he said in the last 48 h), never repeating
// an item from the last 3 briefs (audit: "collect 12 Gmail addresses" came back 4 times in 5 days). Sunday adds a short week review.
const STOP = new Set('the a an and or for to of in on at by with your you my me i it its this that these those from into about up out be is are was were will can just more some any all each now today day needed need start get make do new one two three'.split(' '));
const stem = w => w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w.replace(/s$/, '');
const itemToks = s => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9₦]+/g, ' ').split(' ').filter(w => w && (w.length > 2 || /^\d{2,}$/.test(w)) && !STOP.has(w)).map(stem));
// how much two brief items are the same task (stemmed word overlap / smaller set)
export function similarItem(a, b) {
  const A = itemToks(a), B = itemToks(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}
export const isSundayLagos = (now = Date.now()) => new Date(now + 3600e3).getUTCDay() === 0;
export const bulletsOf = text => String(text || '').split('\n').map(l => l.trim()).filter(l => /^(?:[•*-]|\d+[.)])\s+/.test(l)).map(l => l.replace(/^(?:[•*-]|\d+[.)])\s+/, '').replace(/[*_]/g, '').trim()).filter(Boolean);
export function recentBullets(history, n = 3) {
  return (history || []).filter(h => h && h.role === 'model' && h.nudge).slice(-n).flatMap(h => bulletsOf(h.text));
}
// drops bullets that repeat (or reword) one from a recent brief -> { text, removed }
export function staleFilter(text, recent, similar, th = 0.55) {
  const removed = [];
  const out = String(text || '').split('\n').filter(line => {
    const b = bulletsOf(line)[0];
    if (!b) return true;
    if ((recent || []).some(r => similar(r, b) >= th)) { removed.push(b); return false; }
    return true;
  });
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}
export function briefDataText(d = {}, sunday = false) {
  const L = ['# LIVE DATA (real, checked just now; use only these numbers)'];
  L.push(d.reminders && d.reminders.length ? `- His reminders today: ${d.reminders.map(r => `${r.when}: ${r.text}`).join('; ')}` : '- His reminders today: none');
  if (d.jobs) L.push(d.jobs.length ? `- Work still open in the bot: ${d.jobs.map(j => `#${j.id} ${j.kind} "${j.brief}" (${j.status})`).join('; ')}` : '- Work still open in the bot: none');
  if (d.letter) {
    const l = d.letter;
    if (l.last) L.push(`- Newsletter, latest letter "${l.last.subject}": ${l.last.sent}/${l.last.total} sent${l.last.queued ? `, ${l.last.queued} more go out at 8am` : ''}${l.last.failed ? `, ${l.last.failed} failed` : ''}`);
    if (l.next) L.push(`- Next letter: ${l.next.on}, "${l.next.subject}" (goes out by itself at 8am)`);
    if (l.subs != null) L.push(`- Newsletter subscribers: ${l.subs}`);
  }
  if (d.recent && d.recent.length) L.push('- What he talked about in the last 2 days (his words):\n' + d.recent.map(t => `  • "${t}"`).join('\n'));
  else L.push('- He has not written in the last 2 days.');
  if (sunday && d.week) {
    const w = d.week;
    L.push(`- THIS WEEK (last 7 days): he sent ${w.msgs}${w.msgsCapped ? '+' : ''} messages; ${w.reminders} reminders went off; ${w.learned} new things learned about him${w.letterSent != null ? `; newsletter emails sent: ${w.letterSent}` : ''}${w.jobsDone != null ? `; builds/jobs finished: ${w.jobsDone}` : ''}`);
  }
  return L.join('\n');
}
export function briefPrompt(dayLabel, dataText, recent, sunday = false) {
  return `It's ${dayLabel}, early morning in Nigeria. Write Michael's ${sunday ? 'Sunday' : 'daily'} morning brief on WhatsApp, as his assistant.

${dataText}

# RECENT BRIEFS — do NOT repeat or reword any of these items:
${(recent || []).map(b => '- ' + b).join('\n') || '(none)'}

Exactly this shape:
Good morning Michael 🌅
*Today's focus:*
• (2 or 3 short, concrete actions. FIRST from the live data: today's reminders, open work, and things he said he WOULD do in his recent messages (his plans and promises — not questions he asked, not things already answered). Then at most ONE growth move from his goals or taught facts that is NOT in the recent briefs. Money/clients first. Never invent numbers, names or events not in the data.)
${sunday ? `*This week:* (one line with the real numbers from THIS WEEK, nothing made up)
*Next week:* (one bold move for the week)
` : ''}Then one short line of encouragement or one short Bible verse quoted exactly (KJV) with its reference.
Max ${sunday ? 110 : 70} words. No headings other than these.`;
}
export function briefFallback(d = {}, { sunday = false, focus = [], recent = [], similar = () => 0, seed = 0 } = {}) {
  const items = [];
  for (const r of (d.reminders || []).slice(0, 2)) items.push(`${r.when}: ${r.text}`);
  for (const j of (d.jobs || []).slice(0, 1)) items.push(`Check job #${j.id} (${j.brief}): it's ${j.status}`);
  if (items.length < 2 && d.letter && d.letter.last && d.letter.last.queued) items.push(`The newsletter finishes sending at 8am (${d.letter.last.queued} left of ${d.letter.last.total})`);
  const fresh = (focus || []).filter(f => !(recent || []).some(r => similar(r, f) >= 0.55));
  for (let k = 0; items.length < 3 && k < fresh.length; k++) items.push(fresh[(seed + k) % fresh.length]);
  let t = `Good morning Michael 🌅\n\n*Today's focus:*\n${items.slice(0, 3).map(i => '• ' + i).join('\n')}`;
  if (sunday && d.week) t += `\n\n*This week:* ${d.week.msgs}${d.week.msgsCapped ? '+' : ''} messages, ${d.week.reminders} reminders, ${d.week.learned} new things learned about you.`;
  return t + '\n\nYou\'ve got this. One step at a time 💪';
}

// ---------------- 5. images ----------------
// Pollinations Z-Image Turbo (free tier, flat rate, returns the full requested size: 1088x1344 / 1088x1920 / 1920x1088 checked
// 19 Oct) is tried before flux (flux.1-schnell came back 1024x1088 for a 4:5 ask and wrote a garbled sign). Prompts never
// invite fake UI or text: platform words ("YouTube thumbnail", "Instagram post") become plain composition words, and every
// prompt says no text / no UI unless he asked for exact words in quotes; a negative prompt rides along for models that read it.
export const IMG_MODELS = (env = process.env) => String(env.POLLINATIONS_MODELS || env.POLLINATIONS_MODEL || 'zimage,flux').split(',').map(s => s.trim()).filter(Boolean);
const PLATFORM = '(?:youtube|yt|instagram|ig|facebook|fb|whatsapp|tiktok|twitter|x|linkedin)';
// the exact words he asked to appear, if any: "with the words 'Happy Sunday'", "that says “Grace”", text: "…"
export function wantedText(prompt) {
  const p = String(prompt || '');
  const m = p.match(/\b(?:with|saying|says|that says|reads?|reading|text|words?|caption|title|headline|quote|written)\b[^"“”'‘’]{0,24}["“‘']([^"”’']{1,60})["”’']/i);
  return m ? m[1].trim() : null;
}
const BRAND_NAMES = /\b(?:(?:at|for|of|from|by)\s+)?(?:the\s+)?(?:blossom(?:\s+church)?|retain(?:\s+cohort)?|salesplat|royal people care|olaoluwa michael|michael ai)(?:'s)?\b/gi;
export function cleanImagePrompt(prompt) {
  let p = String(prompt || '');
  // "a thumbnail for my video about using AI to grow…" -> the model writes the topic as a title; describe the scene instead
  p = p.replace(/\b(?:for|of)\s+(?:my|a|the|our|his)\s+(?:new\s+)?(?:youtube\s+|yt\s+)?(?:video|post|reel|episode|channel|talk|class|sermon|podcast|course|blog|article|book|ebook)\s+(?:about|on|titled|called|named)\s+/gi, 'showing the idea of ')
    .replace(/\b(?:titled|called|named)\s+["“'‘][^"”'’]{1,60}["”'’]/gi, m => wantedText(p) ? m : '');
  p = p.replace(new RegExp(String.raw`\b${PLATFORM}\s+(?:video\s+)?thumbnails?\b`, 'gi'), 'cinematic wide photo')
    .replace(/\bthumbnails?\b/gi, 'key art image')
    .replace(new RegExp(String.raw`\b(?:for\s+(?:my\s+|the\s+|a\s+)?)?${PLATFORM}\s+(?:post|status|story|stories|reel|reels|page|feed|banner|cover|ad)\b`, 'gi'), m => /status|story|stories|reel/i.test(m) ? 'tall picture' : /banner|cover/i.test(m) ? 'wide picture' : 'picture')
    .replace(/\s{2,}/g, ' ').trim();
  if (!wantedText(prompt)) p = p.replace(/\b(?:flyers?|posters?|banners?|invitation(?: card)?s?|invite cards?|graphics?)\b(?:\s+background)?/gi, 'vivid illustration');   // design words invite headlines
  return p;
}
// brand / person names get written onto the picture as text by Z-Image: keep the look (colours come from brandStyle), drop the name
export function stripNames(full, prompt) {
  const words = wantedText(prompt);
  return String(full || '').replace(BRAND_NAMES, m => (words && words.toLowerCase().includes(m.trim().toLowerCase()) ? m : '')).replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,]+/, '');
}
const NO_UI_ASKED = /\b(screenshot|mockup|mock-up|app screen|website on a|laptop screen showing|phone screen showing|user interface|\bui\b|dashboard)\b/i;
export function imageStyle(prompt) {
  const words = wantedText(prompt);
  const ui = NO_UI_ASKED.test(String(prompt || ''));
  // 19 Oct probe: a long "no text, no letters, no …" list makes Z-Image draw empty gradients or write placeholder words;
  // a positive scene + ONE plain "without any text" line gave clean, full pictures. Flux writes text either way.
  if (words) return `, the only words in the image are exactly "${words}", spelled correctly in large clean letters, nothing else written`;
  return `, without any text, lettering or logos${ui ? '' : ' and no on-screen buttons'}`;
}
export function negativePrompt(prompt) {
  const words = wantedText(prompt);
  const ui = NO_UI_ASKED.test(String(prompt || ''));
  return [words ? 'misspelled words, extra text, gibberish letters' : 'text, letters, words, typography, captions, signs, garbled text, gibberish, watermark, logo, signature',
    ui ? '' : 'user interface, UI, buttons, play button, progress bar, subscribe button, app screen, browser window, frame',
    'blurry, low quality, jpeg artifacts, deformed hands, extra fingers, distorted face'].filter(Boolean).join(', ');
}

// a vague ask ("flyer for my church youth night") gives Z-Image nothing to draw (19 Oct: empty gradients, a "{ADDRESS}" placeholder);
// one quick text-model call turns it into a concrete scene first. Brand names / titles never go in; quoted words stay exact.
export function scenePrompt(prompt, shape = '') {
  return `Michael asked his assistant for this picture${shape ? ` (${shape})` : ''}: """${String(prompt || '').slice(0, 600)}"""

Write ONE prompt for an image model, max 70 words: the concrete subject, what they are doing, the setting, the light and colours, the camera angle or composition, and the style (photo or illustration, whichever fits). If it is a flyer, poster, thumbnail, banner or status, describe only the full-bleed picture behind the words, filled edge to edge with the scene (he adds his words later in Canva); never blank areas, bands, borders or boxes. People are Black Nigerians unless he said otherwise. Never draw Michael himself. Never put brand names, titles, slogans, dates or any words to be written into the prompt${wantedText(prompt) ? `, except his exact words "${wantedText(prompt)}" which must appear in quotes` : ''}. Output only the prompt.`;
}
export function cleanScene(text, prompt) {
  let t = String(text || '').trim().replace(/^```[a-z]*\s*|\s*```$/g, '').replace(/^(?:image\s+)?prompt\s*[:：]\s*/i, '').replace(/^["“]+|["”]+$/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 25 || t.length > 900 || /^(?:i\s|sorry|as an ai)/i.test(t)) return null;
  t = t.replace(/(?:with\s+)?(?:ample|plenty of|lots of|generous|serene|calm|clean|some)?[\s,]*(?:empty|negative|blank)\s+space\b[^.;]*?(?=[.;]|$)/gi, '').replace(/[^.;]*\bfor (?:text|copy|his words|a headline|a title)(?: placement| overlay)?\b[^.;]*[.;]?/gi, '').replace(/\s+([.,;])/g, '$1').replace(/([.;,])[.;,]+/g, '$1').replace(/\s{2,}/g, ' ').trim();   // Z-Image draws "space for text" as flat colour bands (19 Oct)
  const w = wantedText(prompt);
  if (w && !t.includes(w)) t += ` with the words "${w}"`;
  return t.slice(0, 700);
}
