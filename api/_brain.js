// v8 (7 Oct 2026): the "super smart" layer of Michael AI.
// 1. Smart routing: classify each message (cheap rules, no extra AI call) -> strong model (gemini-3.6-flash family) for hard
//    questions, Flash-Lite for easy chat. A per-key daily budget for the strong model (STRONG_PER_KEY, default 20 per key;
//    Google's free quota resets at midnight Pacific). When the budget or every key is spent, hard questions go to Lite with a
//    "think step by step" prompt and more thinking. Keys: GEMINI_API_KEY, GEMINI_API_KEY_2 (gemFetch rotates on 429).
// 2. Knows his world: his letters, books and project list are embedded (gemini-embedding-001, 768 dims, free) and stored in
//    Supabase pgvector (michael_ai.kchunks, RPC public.michael_ai_brain). Each real question pulls the closest chunks into the
//    prompt. Owner command "learn <text or link>" adds to it.
// 3. Auto-memory: after a chat turn that sounds personal, Flash-Lite pulls out durable facts about Michael (preferences,
//    people, plans, dates) into the same knowledge list /knowledge shows, deduped, capped, never secrets.
// 4. Fresh questions (news, prices, scores, "today") go to the live web search from normal chat (see detectFresh).
import * as G from './_gem.js';
import * as J from './_jobs.js';
import * as P from './_providers.js';
import * as V from './_v5.js';

const log = (...a) => console.log('[brain]', ...a);
export const STRONG = /^(gemini-3\.6-flash|gemini-flash-latest|gemini-3\.8-flash|gemini-3\.5-flash)$/;
export const isStrong = m => STRONG.test(String(m || '')) || /^(groq|or):strong$/.test(String(m || ''));
export const STRONG_PER_KEY = () => Math.max(0, +(process.env.STRONG_PER_KEY || 20));
export const EMBED_MODEL = 'gemini-embedding-001';
export const DIMS = 768;
export const MIN_SCORE = () => +(process.env.BRAIN_MIN_SCORE || 0.62);
export const AUTO_MAX = 80;                       // auto-learned facts kept (oldest auto ones drop first)

// ---------- 1. routing ----------
const HARD_WORDS = /\b(write|draft|rewrite|compose|script|essay|article|newsletter|devotional|sermon|poem|story|plan|planning|strategy|strategi[sz]e|roadmap|explain|analy[sz]e|analysis|compare|comparison|review|critique|summari[sz]e|outline|step[- ]by[- ]step|code|coding|debug|bug|error|function|algorithm|regex|sql|javascript|typescript|python|react|node|api|database|deploy|translate|proposal|pitch|letter|email|business plan|budget|forecast|pricing|price my|calculate|calculation|solve|equation|prove|proof|maths?|percent(age)?|interest rate|profit|loss|logic|riddle|puzzle|advice|advise|should i|what should|how (?:do|can|should) i|how to|pros and cons|difference between|which is better|best way|decide|decision|recommend|evaluate|improve|optimi[sz]e|marketing|monetis|monetiz|grow my|scale|research)\b/i;
const MATH_RE = /\d\s*[-+*/x×÷^%]\s*\d|\b\d+(\.\d+)?\s*(%|percent\b)|\bsqrt\b|\bderivative|\bintegral/i;
const EASY_RE = /^\s*(hi+|hey+|hello+|good (morning|afternoon|evening|night)|gm|gn|thanks?|thank you|thx|ok(ay)?|cool|nice|wow|lol|haha+|amen|alright|great|sure|yes|no|yep|nope|how are you|how far|wetin dey|sup|bless(ed)?|🙏|👍|❤️|😂)[\s!.?,😂🙏👍❤️]*$/i;
export function classify(text, media = false) {
  const t = String(text || '').trim();
  if (media) return { level: 'hard', why: 'media' };
  if (!t || EASY_RE.test(t)) return { level: 'easy', why: 'small talk' };
  if (t.length > 280) return { level: 'hard', why: 'long' };
  if (MATH_RE.test(t)) return { level: 'hard', why: 'maths' };
  const m = t.match(HARD_WORDS);
  if (m) return { level: 'hard', why: m[0].toLowerCase() };
  if (/\bwhy\b/i.test(t) && t.split(/\s+/).length >= 6) return { level: 'hard', why: 'why' };
  if ((t.match(/\?/g) || []).length >= 3) return { level: 'hard', why: 'several questions' };
  return { level: 'easy', why: 'short question' };
}

// per-key strong/lite counts, kept in the chat state per Pacific day: state.brain = { day, k: { "1": { s, l, e } } }
export function brainOf(state, now = Date.now()) {
  const day = G.ptDay(now);
  if (!state.brain || state.brain.day !== day) state.brain = { day, k: {}, route: { hard: 0, easy: 0, fallback: 0 } };
  state.brain.route = state.brain.route || { hard: 0, easy: 0, fallback: 0 };
  return state.brain;
}
export function noteCall(state, model, key, ok = true) {
  const b = brainOf(state);
  if (P.isProvider(model)) { const pv = (b.p = b.p || {}); const r = pv[P.providerOf(model)] || (pv[P.providerOf(model)] = { s: 0, f: 0, e: 0 }); if (!ok) r.e++; else if (isStrong(model)) r.s++; else r.f++; return; }
  const k = String(key || 1);
  const r = b.k[k] || (b.k[k] = { s: 0, l: 0, e: 0 });
  if (!ok) r.e++; else if (isStrong(model)) r.s++; else r.l++;
}
export function strongLeft(state, { keyCount = G.keys().filter(k => k.v).length || 1, cool = {}, now = Date.now(), jobsStrong = {} } = {}) {
  const b = brainOf(state, now); let left = 0;
  for (let k = 1; k <= keyCount; k++) {
    const used = (b.k[String(k)]?.s || 0) + (jobsStrong[k] || 0);
    if ((b.k[String(k)]?.blocked || 0) > now) continue;
    left += Math.max(0, STRONG_PER_KEY() - used);
  }
  const smartParked = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash'].every(m => cool[m] > now);
  return smartParked ? 0 : left;
}
export function note429s(state, model, header, nextReset = null) {
  for (const x of String(header || '').split(',').filter(Boolean)) {
    const [k, kind] = x.split(':');
    noteCall(state, model, k, false);
    if (kind === 'day' && isStrong(model) && model === 'gemini-3.6-flash') blockKey(state, k, nextReset || nextPacificMidnight());
  }
}
export function nextPacificMidnight(now = Date.now()) {
  const d = new Date(now); const pt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const mid = new Date(pt); mid.setHours(24, 0, 0, 0); return mid.getTime() + (d.getTime() - pt.getTime());
}
export function blockKey(state, key, until) { const b = brainOf(state); const r = b.k[String(key)] || (b.k[String(key)] = { s: 0, l: 0, e: 0 }); r.blocked = until; }
// -> { level, why, chain: 'hard'|'easy'|'deep', deep } ; deep = hard question answered by Lite with step-by-step thinking
export function route(text, media, state, opts = {}) {
  const c = classify(text, media);
  const b = brainOf(state);
  if (c.level === 'easy') { b.route.easy++; return { ...c, chain: 'easy', deep: false }; }
  const left = strongLeft(state, opts);
  if (left > 0) { b.route.hard++; return { ...c, chain: 'hard', deep: false, left }; }
  if (P.strongChain().length) { b.route.alt = (b.route.alt || 0) + 1; return { ...c, chain: 'alt', deep: true, left: 0 }; }   // other providers' strong models first
  b.route.fallback++;
  return { ...c, chain: 'deep', deep: true, left: 0 };
}
// model order per route; with no other provider keys these equal the v5 chains exactly
export function chainFor(rt) {
  const ps = P.strongChain(), pf = P.fastChain();
  if (rt.chain === 'hard') return [...V.SMART, ...ps, ...V.LITE, ...pf, ...V.GEMMA];
  if (rt.chain === 'alt') return [...ps, ...V.LITE, ...pf, ...V.GEMMA];
  if (rt.chain === 'deep') return [...V.LITE, ...pf, ...V.GEMMA, ...V.SMART];
  return [...V.LITE, ...pf, ...V.GEMMA, ...V.SMART, ...ps];
}
export const DEEP_RULES = '\n\n# THIS IS A HARD QUESTION\nThink it through step by step privately before you answer: work out what he really needs, check each step (and any numbers twice), consider the trade-offs, then give him only the clear final answer with the key reasoning in a few lines. Do not show scratch work unless he asked for it.\n';

export function brainText(state, { rows = [], stats = null, keyCount = G.keys().filter(k => k.v).length || 1, autoCount = 0, now = Date.now() } = {}) {
  const b = brainOf(state, now);
  const lines = ['🧠 *Brain today* (Google\'s free limits reset 8–9am Nigeria time)', ''];
  const jobs = {};
  for (const r of rows || []) { if (r.src === 'chat') continue; const j = jobs[r.k] || (jobs[r.k] = { s: 0, l: 0 }); if (isStrong(r.model)) j.s += r.ok || 0; else j.l += r.ok || 0; }
  for (let k = 1; k <= keyCount; k++) {
    const r = b.k[String(k)] || { s: 0, l: 0, e: 0 }; const j = jobs[k] || { s: 0, l: 0 };
    const s = r.s + j.s;
    const blocked = (r.blocked || 0) > now;
    lines.push(`🔑 *Key ${k}*: strong ${s}/${STRONG_PER_KEY()}${blocked ? ' (used up, resting)' : ''} · lite ${r.l + j.l}${r.e ? ` · ${r.e}× limit hit` : ''}${j.s || j.l ? `\n   _(incl. background work: strong ${j.s}, lite ${j.l})_` : ''}`);
  }
  const left = strongLeft(state, { keyCount, now });
  lines.push('', `💪 Strong answers left today: *${left}*${left ? '' : ' (hard questions now use Lite + step-by-step thinking)'}`);
  lines.push(`🧭 Routed today: ${b.route.hard} hard → strong, ${b.route.easy} easy → lite${b.route.alt ? `, ${b.route.alt} hard → other providers` : ''}${b.route.fallback ? `, ${b.route.fallback} hard → lite (deep mode)` : ''}`);
  const pon = P.available();
  for (const p of pon) { const r = (b.p || {})[p] || { s: 0, f: 0, e: 0 }; lines.push(`🤖 *${P.PROVIDERS[p].name}*: strong ${r.s} · fast ${r.f}${r.e ? ` · ${r.e}× limit/error` : ''}`); }
  if (!pon.length) lines.push('🤖 Other AI providers: none yet (Groq / OpenRouter keys turn them on)');
  if (stats) {
    const books = stats.books || 0, letters = (stats.letters || 0) + (stats['spare-letters'] || 0) + (stats['monday-letters'] || 0);
    lines.push(`📚 Knows your world: ${letters} letters, ${books} book passages, ${stats.projects || 0} projects${stats.learn ? `, ${stats.learn} things you taught with *learn*` : ''}`);
  }
  lines.push(`📝 Auto-memory: ${autoCount} facts picked up from our chats (see /knowledge)`);
  if (keyCount < 2) lines.push('', '➕ A 2nd free Google AI key doubles the strong answers. Send it to Tab.');
  return lines.join('\n');
}

// ---------- 2. retrieval ----------
let mock = null;
export function setMock(fn) { mock = fn; }
export async function brainRpc(op, args = {}, ms = 6000) {
  if (mock) return mock(op, JSON.parse(JSON.stringify(args)));
  if (!J.jobsOn()) throw new Error('brain store not configured');
  const r = await fetch(`${process.env.SB_URL}/rest/v1/rpc/michael_ai_brain`, {
    method: 'POST', signal: AbortSignal.timeout(ms),
    headers: { apikey: process.env.SB_ANON_KEY, authorization: `Bearer ${process.env.SB_ANON_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_key: process.env.SCHED_KEY, p_op: op, p_args: args }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`brain rpc ${op} ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}
export const brainOn = () => Boolean(mock || J.jobsOn());

// embeddings: free gemini-embedding-001 (its own quota, separate from chat). Tries each key on 429.
export async function embed(texts, task = 'RETRIEVAL_QUERY', { ms = 6000, titles = null } = {}) {
  const ks = G.keys().filter(k => k.v);
  const body = JSON.stringify({ requests: texts.map((t, i) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: String(t).slice(0, 8000) }] }, taskType: task, outputDimensionality: DIMS, ...(titles && titles[i] ? { title: titles[i] } : {}) })) });
  let last = '';
  for (const k of ks) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': k.v }, body, signal: AbortSignal.timeout(ms) });
      if (r.status === 429) { last = '429'; continue; }
      if (!r.ok) { last = String(r.status); break; }
      const j = await r.json();
      const out = (j.embeddings || []).map(e => e.values);
      if (out.length === texts.length && out.every(v => Array.isArray(v) && v.length === DIMS)) return out;
      last = 'bad shape'; break;
    } catch (e) { last = e.message; break; }
  }
  throw new Error('embed failed: ' + last);
}
export const vecLit = v => '[' + v.map(x => (+x).toFixed(6)).join(',') + ']';

// Is this message worth a lookup in his own material? (not for "hi", commands, or one-word replies)
const SELF_RE = /\b(my|mine|me|i|i'm|i've|our|olaoluwa|michael|blossom|letters?|books?|novel|chapter|twisted|balm|gilead|golgotha|esther|crack(it)?|algorithm|nysc|bible arena|danfo|ranti|sow|voicepad|accountability|naija vote|studio|newsletter|subscribers?|project|app|site|devotional|write as me|in my voice|like me)\b/i;
export function wantsRetrieval(text) {
  const t = String(text || '').trim();
  if (t.length < 12 || EASY_RE.test(t) || /^\s*\//.test(t)) return false;
  if (t.split(/\s+/).length < 3) return false;
  return SELF_RE.test(t) || t.length > 40;
}
export async function retrieve(text, { ns = 'wa', k = 8, voice = false, ms = 6500 } = {}) {
  const t0 = Date.now();
  if (!brainOn()) return { hits: [], skipped: 'off' };
  const [v] = await embed([text], 'RETRIEVAL_QUERY', { ms: Math.min(4500, ms) });
  const rows = await brainRpc('match', { ns, emb: vecLit(v), k, chars: 1500 }, Math.max(1500, ms - (Date.now() - t0)));
  const min = MIN_SCORE();
  let hits = (rows || []).filter(r => r.score >= min);
  // writing as him: keep at least two of his letters as voice samples, even when a book passage scored higher
  const top = hits.slice(0, 4);
  if (voice) for (const r of (rows || []).filter(r => /letters/.test(r.src) && r.score >= min - 0.06)) { if (top.filter(x => /letters/.test(x.src)).length >= 2) break; if (!top.includes(r)) top.push(r); }
  hits = top.slice(0, 5);
  return { hits, ms: Date.now() - t0, best: rows?.[0]?.score ?? null };
}
const SRC_NAME = s => /^book:/.test(s) ? 'his book' : s === 'projects' ? 'his project list' : s === 'learn' ? 'something he taught you (learn)' : 'his Monday & Friday letters';
export function brainBlock(hits, { voice = false } = {}) {
  if (!hits || !hits.length) return '';
  const body = hits.map((h, i) => `[${i + 1}] ${h.title || ''} — from ${SRC_NAME(h.src)}${h.url ? ` (${h.url})` : ''}\n${String(h.body || '').replace(/\n{3,}/g, '\n\n').trim()}`).join('\n\n---\n\n');
  return '\n\n# FROM MICHAEL\'S OWN WORK (retrieved for this message from his letters, books, projects and things he taught you)\n'
    + 'Use these when they help: quote his books and letters accurately, give his real project links, and never invent titles, plots, numbers or links that are not here or in the profile. If none of it is relevant, ignore it.'
    + (voice ? ' He wants this written as him: match the voice of his letters below (warm, short lines, a Nigerian everyday picture, a KJV verse, faith-first, a gentle close).' : '')
    + '\n\n' + body + '\n';
}

// "learn <text or link>"
export const LEARN_RE = /^\s*\/?learn(?!\s+(?:how|to|about|more|from|the\s+basics)\b)\s*[:：\-–]?\s+([\s\S]{3,})$/i;
export const LEARNED_RE = /^\s*\/?(?:learned|what (?:have )?you learned|my learned)\s*[?.!]*\s*$/i;
export const UNLEARN_RE = /^\s*\/?unlearn\s+#?(\d{1,9})\s*$/i;
export const BRAIN_RE = /^\s*\/?(?:brain|brain status|my brain)\s*[?.!]*\s*$/i;
export function chunkText(text, size = 1800, overlap = 150) {
  const t = String(text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= size) return t ? [t] : [];
  const paras = t.split(/\n\s*\n/); const out = []; let cur = '';
  for (const p of paras) {
    if (p.length > size) { if (cur) { out.push(cur); cur = ''; } for (let i = 0; i < p.length; i += size - overlap) out.push(p.slice(i, i + size)); continue; }
    if (cur && cur.length + p.length + 2 > size) { out.push(cur); cur = cur.slice(-overlap) + '\n\n' + p; } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) out.push(cur);
  return out.slice(0, 40);
}
export async function learn({ text, title, url = null, ns = 'wa' }) {
  if (looksSecret(text)) return { ok: false, secret: true };
  const parts = chunkText(text);
  if (!parts.length) return { ok: false, empty: true };
  const vecs = [];
  for (let i = 0; i < parts.length; i += 20) vecs.push(...await embed(parts.slice(i, i + 20), 'RETRIEVAL_DOCUMENT', { ms: 15000, titles: parts.slice(i, i + 20).map(() => title) }));
  const rows = parts.map((b, i) => ({ src: 'learn', title: (title + (parts.length > 1 ? ` (part ${i + 1})` : '')).slice(0, 200), url, body: b, h: G.hashOf('learn', b), emb: vecLit(vecs[i]) }));
  const r = await brainRpc('add', { ns, rows }, 15000);
  return { ok: true, chunks: parts.length, added: r?.added ?? parts.length };
}

// ---------- 3. auto-memory ----------
const SECRET_RE = /(AIza[0-9A-Za-z_\-]{20,}|\bsk-[A-Za-z0-9_\-]{16,}|eyJ[A-Za-z0-9_\-]{20,}\.|gh[pousr]_[A-Za-z0-9]{20,}|xkeysib-|\bpk_(live|test)_|\bsk_(live|test)_|\b(password|passcode|passwd|pin|otp|cvv|secret|token|api[\s_-]?key|private key|seed phrase|recovery phrase)\b|\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\b\d{10}\b.*\b(account|acct|bank)\b|\b(account|acct)\s*(number|no)\b)/i;
export const looksSecret = t => SECRET_RE.test(String(t || ''));
const PERSONAL_RE = /\b(i|i'm|im|i am|i've|i was|i will|i'll|my|mine|me|we|our|wife|husband|son|daughter|mum|mom|dad|father|mother|brother|sister|friend|pastor|church|birthday|anniversary|wedding|born|live in|moving|travel(l?ing)?|trip|exam|deadline|launch|tomorrow|next week|next month|on (mon|tue|wed|thu|fri|sat|sun)|january|february|march|april|may|june|july|august|september|october|november|december|prefer|favou?rite|love|hate|like|don't like|allergic|always|never|plan|planning|goal|want to|going to|started|stopped|quit|new job|business|customer|client|price|charge)\b/i;
export function wantsMemory(text) {
  const t = String(text || '').trim();
  if (t.length < 15 || t.length > 2500 || EASY_RE.test(t) || /^\s*\//.test(t)) return false;
  // questions and requests rarely carry new facts about him ("what is my book about?", "write my bio")
  if (/\?\s*$/.test(t) && !/\b(i|i'm|i am|my|we)\b[^?]{12,}[.!,;]/i.test(t)) return false;
  if (/^\s*(what|who|when|where|which|how|why|is|are|can|could|would|should|do|does|did|tell me|give me|show me|write|draft|explain|help|please|pls|abeg)\b/i.test(t) && !/[.!]\s+\S/.test(t)) return false;
  if (/^\s*(teach|remember|remind|search|google|post|schedule|learn|read|image|draw|build|make|create|research|edit|repo|zip|apk)\b/i.test(t)) return false;
  return PERSONAL_RE.test(t);
}
export function memoryPrompt(userText, botText, facts) {
  const list = (facts || []).slice(-60).map((f, i, a) => `${(facts.length - a.length) + i + 1}. ${String(f.t ?? f).slice(0, 220)}`).join('\n') || '(none)';
  return `You keep the long-term memory of Michael's personal assistant (Michael is a Nigerian Christian author and app developer).

What the assistant already knows (numbered):
${list}

The latest exchange:
MICHAEL: """${String(userText).slice(0, 2000)}"""
ASSISTANT: """${String(botText || '').slice(0, 800)}"""

Already known (do NOT repeat): he is Olaoluwa Michael, a Nigerian Christian author (Twisted, Balm of Gilead, Golgotha, Queen Esther, Crack the Algorithm) and app developer (CrackIt, NYSC Companion, Bible Arena, Danfo Rush, Ranti, Sow, VoicePad, Michael AI).

Pull out only NEW, DURABLE facts that Michael himself STATED in his message, worth remembering for weeks: his preferences, the people in his life (names + who they are), his plans and dates, his projects' decisions, his routines. Write each as one short line in first person ("My …" / "I …"), with absolute dates (today is ${new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' })}).
Skip: small talk, anything he only asked about or asked you to do, guesses from his question, things only true today, anything already in the list, opinions about the assistant, and NEVER passwords, keys, tokens, PINs, card or bank numbers.
If a new fact updates an old one in the list, give that old number in "replaces".
Output only JSON: {"facts":[{"t":"...","replaces":null}]} with at most 3 facts, or {"facts":[]} if nothing is worth keeping.`;
}
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9₦ ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(the|and|for|with|that|this|have|has|was|are|his|her|michael|my|mine)$/.test(w));
export function similar(a, b) {
  const A = new Set(norm(a)), B = new Set(norm(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}
export function parseMemory(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { const j = JSON.parse(m[0]); return (Array.isArray(j.facts) ? j.facts : []).filter(f => f && typeof f.t === 'string').slice(0, 3); } catch { return []; }
}
// -> { added: [t], replaced: [{ n, t }], dropped } ; mutates kb.facts
export function applyMemory(kb, facts, now = new Date().toISOString()) {
  const added = [], replaced = []; let dropped = 0;
  kb.facts = kb.facts || [];
  for (const f of facts) {
    const t = String(f.t).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (t.length < 8 || looksSecret(t)) { dropped++; continue; }
    const rn = Number.isInteger(+f.replaces) && +f.replaces >= 1 && +f.replaces <= kb.facts.length ? +f.replaces : null;
    if (rn && kb.facts[rn - 1]?.auto) { kb.facts[rn - 1] = { t, at: now, auto: true }; replaced.push({ n: rn, t }); continue; }
    if (kb.facts.some(x => similar(x.t ?? x, t) >= 0.75)) { dropped++; continue; }
    kb.facts.push({ t, at: now, auto: true }); added.push(t);
  }
  const autos = kb.facts.filter(x => x.auto);
  if (autos.length > AUTO_MAX) { const drop = new Set(autos.slice(0, autos.length - AUTO_MAX)); kb.facts = kb.facts.filter(x => !drop.has(x)); }
  return { added, replaced, dropped };
}

// ---------- 4. fresh info: which normal-chat questions need the live web ----------
const TIME_RE = /\b(today|tonight|this (morning|afternoon|evening|week|weekend|month|year)|yesterday|right now|now|currently|at the moment|so far|latest|recent(ly)?|new(est)?|upcoming|20(2[5-9]))\b/i;
const TOPIC_RE = /\b(news|headlines?|happen(ed|ing)?|price|prices|cost|rate|rates|naira|dollar|usd|pounds?|euro|fuel|petrol|diesel|gas|bitcoin|crypto|stock|shares?|market|weather|rain|match|game|games|score|scores|result|results|fixture|fixtures|table|standings|league|cup|transfer|won|win|lose|lost|beat|election|vote|president|governor|senate|minister|government|tinubu|inec|cbn|asuu|jamb|waec|neco|nysc|strike|protest|flood|attack|launch(ed)?|release(d)?|update|iphone|samsung|android|chatgpt|gemini|openai|google|apple|meta|whatsapp|tiktok|holiday|public holiday)\b/i;
const SPORT_RE = /\b(arsenal|chelsea|man(chester)? (united|city|utd)|liverpool|tottenham|barcelona|real madrid|psg|bayern|super eagles|super falcons|afcon|world cup|premier league|epl|champions league|ucl|la liga|serie a|nba|f1|formula 1|wimbledon|olympics|boxing|ufc|osimhen|lookman|messi|ronaldo)\b/i;
const PERSONAL_ONLY_RE = /\b(my|me|i)\b.*\b(today|tonight|tomorrow)\b.*\b(plan|do|wear|eat|cook|pray|post|write|schedule|reminder|letter)\b|\b(what should i|remind me|my (day|plan|schedule|letter|verse))\b|\bmy (own )?(app|apps|site|sites|website|book|books|letters?|project|projects|bot|game|newsletter|subscribers|channel|page)\b/i;
export function detectFresh(text) {
  const t = String(text || '').trim();
  if (t.length < 8 || t.length > 260 || /https?:\/\//i.test(t) || /^\s*\//.test(t)) return null;
  if (/^\s*(teach|remember|post|read|image|draw|imagine|remind|write|draft|create|make|generate|build|learn|research|schedule|newsletter)\b/i.test(t)) return null;
  if (PERSONAL_ONLY_RE.test(t)) return null;
  const q = /\?\s*$|^\s*(what|what's|whats|who|who's|when|where|which|how|is|are|did|does|do|has|have|any|tell me|give me|check|find|show me|latest|wetin|abeg)\b/i.test(t);
  if (!q) return null;
  if (SPORT_RE.test(t) || (TIME_RE.test(t) && TOPIC_RE.test(t))) return { q: t.replace(/^(?:hey|hi|please|pls|abeg)[,\s]+/i, '').slice(0, 300), explicit: false, why: 'fresh' };
  return null;
}
