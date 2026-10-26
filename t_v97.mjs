// v9.7 tests (v9.6 harness). Original header follows.
// v9.6 tests (built on the v9.5 harness): code model chain (pro first, heavy free models), deeper rules, format notes, public-figure guard, v9.6 banks.
// Original v9.5 header: coding skill (detect, checklist, more room, strong route), image skill (prompt craft, feedback redraw, face rule,
// AI-people note, RETAIN/Nigerian looks), fenced WhatsApp splitting, v9.5 know-how bank + facts files. All mocked: no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092';
delete process.env.WA_WABA_ID; delete process.env.POLLINATIONS_KEY; delete process.env.CF_ACCOUNT_ID;
process.env.IMG_GEMINI = '0';
process.env.WA_TOKEN = 'test-token'; process.env.WA_PHONE_ID = 'PHONE';
process.env.SCHED_KEY = 'k'; process.env.SB_URL = 'https://x.supabase.co'; process.env.SB_ANON_KEY = 'a';
let n = 0;
const ok = (name, cond) => { if (!cond) console.log('LAST:', JSON.stringify(globalThis.__last || null).slice(0, 2500)); assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092';
const calls = []; const imgCalls = [];
const JPEG = Buffer.from('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', 'base64');
const okr = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] }), { status: 200 });
globalThis.fetch = async (u, o = {}) => {
  const s = String(u);
  if (/pollinations\.ai/.test(s)) { (globalThis.__imgUrls = globalThis.__imgUrls || []).push(s); if (globalThis.__zimageDown && /model=zimage/.test(s)) return new Response('busy', { status: 500 }); imgCalls.push(decodeURIComponent(s.split('/prompt/')[1] || s.split('/image/')[1] || '').split('?')[0]); return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }); }
  if (s.includes(':batchEmbedContents')) { const b = JSON.parse(o.body); return Response.json({ embeddings: b.requests.map(() => ({ values: Array(768).fill(0.01) })) }); }
  if (s.includes('generativelanguage')) {
    const body = JSON.parse(o.body); const user = body.contents.at(-1).parts.map(p => p.text || '[media]').join('\n');
    const sys = body.systemInstruction?.parts?.[0]?.text || '';
    if (/gemini-3\.1-pro/.test(s) && globalThis.__pro429) return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }), { status: 429 });
    calls.push({ user, sys, max: body.generationConfig?.maxOutputTokens, temp: body.generationConfig?.temperature, think: body.generationConfig?.thinkingConfig?.thinkingLevel, model: s.match(/models\/([^:]+)/)?.[1] });
    if (/long-term memory of Michael|Output ONLY|JSON array/.test(user)) return okr(globalThis.__memJson || '[]');
    if (globalThis.__hook) { const h = globalThis.__hook({ model: calls.at(-1).model, user, sys }); if (h) return h; }
    if (globalThis.__weak && globalThis.__weak.includes(calls.at(-1).model)) return okr(globalThis.__weakText || "I'm having trouble thinking right now, please try again later.");
    return okr('chat answer');
  }
  if (s.includes('/rpc/michael_ai_set_next') || s.includes('/rpc/michael_ai_newsletter')) return new Response('null', { status: 200 });
  if (s.includes('graph.facebook.com')) return Response.json({ id: 'MEDIA1' });
  throw new Error('unexpected network call in a test: ' + s);
};
const J = await import('./api/_jobs.js'); J.setMock((op) => (op === 'usage_get' || op === 'undelivered' || op === 'list' || op === 'site_list') ? [] : (op === 'open_count' || op === 'count_today') ? 0 : null);
const BR = await import('./api/_brain.js'); const brainCalls = []; BR.setMock((op, a) => { brainCalls.push({ op, a }); return op === 'match' ? [] : null; });
const V95 = await import('./api/_v95.js');
const V96 = await import('./api/_v96.js');
const PV = await import('./api/_providers.js');
const V93 = await import('./api/_v93.js');
const X = await import('./api/_extras.js');
const m = await import('./api/whatsapp.js');
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
let mid = 0;
const say = async (text, c = ctx()) => { calls.length = 0; const r = await m.processMessage({ from: OWNER, id: 'wamid.v97_' + (mid++), type: 'text', text: { body: text } }, 'T', c); globalThis.__last = texts(c); return { r, c, sent: texts(c), last: texts(c).at(-1) || '', chat: calls.find(k => k.sys.includes('# SKILLS')) }; };
await J.rpc('kv_purge_test', {});


const V97 = await import('./api/_v97.js');
const V5 = await import('./api/_v5.js');

// ======================= 1. remind-me questions + pending expiry =======================
for (const q of ['Remind me what my newsletter is called', 'remind me who Daniel is', "Can you remind me my newsletter's name?", 'remind me how to deploy on vercel', 'Remind me the name of my client', 'remind me when is the RETAIN class?', 'Remind me what time the meeting is tomorrow'])
  ok('question, not a reminder: ' + q, V97.remindQuestion(q));
for (const q of ['remind me at 5pm to call John', 'remind me to call mum', 'remind me tomorrow to post the verse', 'remind me what to buy at 5pm', 'Can you remind me to call John?', 'remind me in 2 hours what to cook', 'every day at 6am remind me to pray', 'Remind me by 8pm 9pm 7pm to message Mr John'])
  ok('still a reminder request: ' + q, !V97.remindQuestion(q));
for (const a of ['8pm', 'the three time', 'tomorrow 7am', 'what about 8pm?', 'today', '7pm, 8pm and 9pm', 'all of them']) ok('answers the time question: ' + a, V97.pendingAnswer(a));
for (const a of ['Did you send my outreach today?', 'How many subscribers do I have today', 'what is my newsletter called?', 'Tell me the news today', 'ok thanks', 'Write me a caption for tonight’s post about faith and hope and patience in this season']) ok('not an answer: ' + a, !V97.pendingAnswer(a));
{ const t = Date.now(); const p = { text: 'remind me to call mum', at: t - 60e3 };
  ok('pending dropped: expired after 5 min', V97.dropPending({ ...p, at: t - 6 * 60e3 }, '8pm', t) && V97.REM_PENDING_MS === 5 * 60e3);
  ok('pending dropped: a reply with no time', V97.dropPending(p, 'Did you send my outreach today?', t) && V97.dropPending(p, 'ok', t));
  ok('pending kept: a time answer, a voice note (decided later), a fresh reminder request', !V97.dropPending(p, '8pm', t) && !V97.dropPending(p, null, t) && !V97.dropPending(p, 'remind me at 5pm to call Ada', t)); }

const st = async () => m.loadState(OWNER, ctx());
const kbNow = async () => m.loadKB(OWNER, ctx());
let x = await say('/new');
x = await say('Remind me what my newsletter is called');
ok('LIVE BUG 1: "Remind me what my newsletter is called" is answered in chat, not "When should I remind you?"', x.last === 'chat answer' && !/when should i remind/i.test(x.sent.join(' ')));
ok('the chat model is told it is a question about something he forgot', x.chat && x.chat.sys.includes('THIS IS A QUESTION, NOT A REMINDER') && !x.chat.sys.includes('HIS ACTIVE REMINDERS'));
ok('nothing pending after the question', (await st()).remPending === null);
const remsBefore = V5.active(await kbNow()).length;
x = await say('remind me to call mum');
ok('a real reminder with no time is still asked about', /when should i remind/i.test(x.last) && (await st()).remPending);
x = await say('Did you send my outreach today?');
ok('LIVE BUG 2: the next unrelated question is answered, not saved as a reminder', x.last === 'chat answer' && V5.active(await kbNow()).length === remsBefore);
ok('…and it cancelled the pending reminder question', (await st()).remPending === null);
x = await say('8pm');
ok('a later "8pm" does not resurrect the cancelled reminder', V5.active(await kbNow()).length === remsBefore);
x = await say('remind me to call mum');
x = await say('8pm');
ok('control: "8pm" within 5 minutes still sets the reminder', /call mum/i.test(x.last) && V5.active(await kbNow()).length === remsBefore + 1);
x = await say('remind me to water the plants');
{ const s0 = await st(); s0.remPending.at -= 6 * 60e3; await m.saveState(OWNER, s0, ctx()); }
x = await say('9pm');
ok('pending question expires after 5 minutes ("9pm" later sets nothing)', !/water the plants/i.test(x.last) && V5.active(await kbNow()).length === remsBefore + 1 && (await st()).remPending === null);
x = await say('remind me at 6pm to pray');
ok('normal timed reminders unchanged', /pray/i.test(x.last) && V5.active(await kbNow()).length === remsBefore + 2);
{ const k = await kbNow(); k.reminders = []; await m.saveKB(OWNER, k, ctx()); }

// ======================= 2. smarter replies =======================
for (const [t, why] of [['', 'empty'], ['Error: 503 Service Unavailable', 'busy-or-error'], ["I'm having trouble thinking right now 😅", 'busy-or-error'], ['The model is overloaded. Try again later.', 'busy-or-error'], ['<think>let me see</think>', 'thinking-leak'], ["I'm sorry, but I can't help with that.", 'refusal']])
  ok(`weak answer (${why}): ${JSON.stringify(t).slice(0, 40)}`, V97.weakReply(t, { question: 'What should I post on Facebook today for my faith page?' }) === why);
ok('cut off by the token limit (short) is weak', V97.weakReply('Here are three ideas: 1.', { finish: 'MAX_TOKENS' }) === 'cut-off');
ok('a looping answer is weak', V97.weakReply(Array(7).fill('Post a verse every morning at 6am.').join('\n')) === 'looping');
ok('good answers pass (short ones too)', V97.weakReply('Yes ✅ It is called Monday & Friday Letters.', { question: 'what is my newsletter called' }) === null && V97.weakReply('OK', { question: 'hi' }) === null && V97.weakReply('Morning! Here is the plan…\n' + 'x'.repeat(500), { finish: 'MAX_TOKENS' }) === null);
ok('declining to repeat a PIN is not "weak"', V97.weakReply("I can't share your PIN here.", { question: 'what is my bank pin' }) === null);
{ const s = {}; const T = Date.parse('2026-10-19T10:00:00Z');
  V97.noteHealth(s, 'gemini-flash-latest', false, T); V97.noteHealth(s, 'gemini-flash-latest', false, T); V97.noteHealth(s, 'gemini-3.6-flash', true, T);
  ok('model failing today goes to the back, others keep their order', V97.rankChain(['gemini-flash-latest', 'gemini-3.6-flash', 'groq:strong'], s.mh).join() === 'gemini-3.6-flash,groq:strong,gemini-flash-latest');
  V97.noteHealth(s, 'gemini-flash-latest', true, T); V97.noteHealth(s, 'gemini-flash-latest', true, T);
  ok('…and comes back once it answers again', V97.rankChain(['gemini-flash-latest', 'gemini-3.6-flash'], s.mh)[0] === 'gemini-flash-latest');
  for (let i = 0; i < 6; i++) V97.noteHealth(s, 'gemma-4-31b-it', false, T);
  V97.noteHealth(s, 'x', true, T + 864e5);
  ok('next Lagos day: counts halved, not wiped (a model that failed all evening starts behind)', s.mh.day === '2026-10-20' && s.mh.m['gemma-4-31b-it'][1] === 3 && V97.failing(s.mh, 'gemma-4-31b-it')); }
delete process.env.GROQ_API_KEY; delete process.env.OPENROUTER_API_KEY;
ok('chains (no provider keys): hard = 3.6 > 3.5 > busy Flash > Lite > Gemma; easy = Lite > Flash > Gemma', V5.HARD_CHAIN.slice(0, 2).join() === 'gemini-3.6-flash,gemini-3.5-flash' && V5.EASY_CHAIN.at(-1).startsWith('gemma') && V5.EASY_CHAIN[0] === 'gemini-flash-lite-latest' && BR.chainFor({ chain: 'hard' }).join() === V5.HARD_CHAIN.join());
process.env.GROQ_API_KEY = 'gq-test'; process.env.OPENROUTER_API_KEY = 'or-test';
ok('chains (with keys): Groq strong right after the two working Flash models; easy = Lite then Groq strong', BR.chainFor({ chain: 'hard' }).slice(0, 4).join() === 'gemini-3.6-flash,gemini-3.5-flash,groq:strong,or:strong' && BR.chainFor({ chain: 'easy' }).slice(0, 3).join() === 'gemini-flash-lite-latest,gemini-3.1-flash-lite,groq:strong');
delete process.env.GROQ_API_KEY; delete process.env.OPENROUTER_API_KEY;
{ const s = { cool: {} }; globalThis.__weak = ['gemini-flash-lite-latest'];
  const a = await m.askGemini([], [], [{ text: 'what should I post today on my page?' }], Date.now(), { cool: {}, track: s, chain: V5.EASY_CHAIN, quality: 'what should I post today on my page?' });
  ok('a busy/error answer falls through to the next model', a.ok && a.text === 'chat answer' && a.model === 'gemini-3.1-flash-lite' && a.tried[0] === 'gemini-flash-lite-latest:weak-busy-or-error');
  ok('…and counts as a failure for that model today', s.mh.m['gemini-flash-lite-latest'][1] === 1 && s.mh.m['gemini-3.1-flash-lite'][0] === 1);
  globalThis.__weak = [...V5.EASY_CHAIN]; globalThis.__weakText = 'Sorry, something went wrong.';
  const b = await m.askGemini([], [], [{ text: 'hello there my friend how far' }], Date.now(), { cool: {}, chain: V5.EASY_CHAIN.slice(0, 3), quality: 'hello there my friend how far' });
  ok('when every model is weak, the first weak answer is used (never the error line)', b.ok && b.weak && b.tried.length === 3);
  const c = await m.askGemini([], [], [{ text: '{"x":1}' }], Date.now(), { cool: {}, chain: V5.EASY_CHAIN.slice(0, 2) });
  ok('JSON / background calls are not quality-checked', c.ok && c.tried.length === 1);
  globalThis.__weak = null; globalThis.__weakText = null;
  const s2 = { mh: { day: V97.lagosDay(), m: { 'gemini-flash-lite-latest': [0, 4] } } };
  const d = await m.askGemini([], [], [{ text: 'hi' }], Date.now(), { cool: {}, track: s2, chain: V5.EASY_CHAIN, quality: 'hi' });
  ok('a model failing all day is skipped to the back (first call goes to the next)', d.model === 'gemini-3.1-flash-lite'); }
x = await say('/new');
globalThis.__weak = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
x = await say('thanks, how are you doing');
ok('end to end: Michael gets the good answer after two weak ones', x.last === 'chat answer' && calls.length >= 3);
ok('model health is saved with his chat state', (await st()).mh && (await st()).mh.m['gemini-flash-lite-latest'][1] >= 1);
globalThis.__weak = null;

{ const res = await m.GET(new Request('http://x/api/whatsapp?health=1')); const j = await res.json();
  ok('health: build v9.7+ + v97 block (older blocks kept)', /^v9\.([7-9]|\d\d)/.test(j.build) && /^v9\.7\.\d/.test(j.v97.patch) && j.v96 && j.v95 && j.v93); }

// ======================= 3. long-term memory =======================
{ const H = [{ role: 'user', text: 'old', at: 100 }, { role: 'user', text: 'My sister Ada is getting married on 12 December', at: 300 }, { role: 'model', text: 'Congrats!', at: 301 }, { role: 'model', text: 'Good morning', at: 302, nudge: true }, { role: 'user', text: 'I now charge ₦150k for a business site', at: 400 }];
  const tr = V97.ltmTranscript(H, 200);
  ok('memory transcript: only new lines since the last run, no morning briefs', tr.users === 2 && tr.last === 400 && !tr.text.includes('old') && !tr.text.includes('Good morning') && tr.text.includes('MICHAEL: My sister Ada'));
  const pr = V97.ltmPrompt(tr.text, [{ t: 'My newsletter is Monday & Friday Letters' }, { t: 'My barber is Tunde', ltm: true }]);
  ok('memory prompt lists taught facts as "do not repeat", learned ones as L1…, asks for JSON + no secrets', pr.includes('- My newsletter is Monday & Friday Letters') && pr.includes('L1. My barber is Tunde') && /NEVER passwords/.test(pr) && /Output only JSON/.test(pr)); }
{ const kb = { facts: [{ t: 'My newsletter is called Monday & Friday Letters, sent every Monday and Friday' }, { t: 'My barber is Tunde in Oja Oba', ltm: true, at: 'x' }] };
  const res = V97.applyLtm(kb, [
    { t: 'My sister Ada is getting married on 12 December 2026' },
    { t: 'My newsletter is called Monday and Friday Letters, sent each Monday and Friday' },
    { t: 'My bank PIN is 4455' }, { t: 'My account number is 0123456789 at GTB' },
    { t: 'My barber is now Kunle at Alagbaka', replaces: 'L1' },
    { t: 'ok' }], { similar: BR.similar, looksSecret: BR.looksSecret });
  ok('learned facts: new fact added, marked ltm', res.added.length === 1 && kb.facts.some(f => f.ltm && /Ada/.test(f.t)));
  ok('learned facts: duplicate of a taught fact dropped, secrets/account numbers dropped, too-short dropped', res.dropped === 4);
  ok('learned facts: "replaces L1" updates the old learned fact in place (no duplicate)', res.replaced.length === 1 && kb.facts.filter(f => /barber/.test(f.t)).length === 1 && /Kunle/.test(kb.facts.find(f => /barber/.test(f.t)).t));
  for (let i = 0; i < 45; i++) V97.applyLtm(kb, [{ t: `Unique durable fact number ${i} about project ${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${i} zone${i * 7}` }], { similar: () => 0, looksSecret: BR.looksSecret });
  const L = kb.facts.filter(f => f.ltm);
  ok('learned facts capped at 40 (oldest learned drop first; taught facts never touched)', L.length === V97.LTM_MAX && !L.some(f => /Ada/.test(f.t)) && kb.facts.some(f => /Monday & Friday/.test(f.t)) && /number 44/.test(L.at(-1).t));
  ok('quote check: only facts backed by his exact words pass', V97.quoted({ quote: 'I am moving to Ibadan' }, 'Guess what, I am moving to Ibadan next year!') && !V97.quoted({ quote: 'my favourite movie is' }, 'what is a CIA lawyer movie') && !V97.quoted({ quote: 'Ibadan' }, 'Ibadan'));
  const blk = V97.ltmBlock(kb.facts);
  ok('prompt block: newest first and within the size cap', blk.indexOf('number 44') < blk.indexOf('number 43') && blk.length < V97.LTM_CHARS + 200); }
{ const sys = m.systemText([{ t: 'My newsletter is Monday & Friday Letters' }, { t: 'My sister Ada is getting married on 12 December 2026', ltm: true }], { lean: true, query: 'who is getting married?' });
  ok('every prompt carries the learned block; learned facts are not mixed into the taught list', /# WHAT YOU LEARNED ABOUT MICHAEL FROM YOUR CHATS[\s\S]*Ada is getting married/.test(sys) && !/# WHAT MICHAEL HAS TAUGHT YOU[^#]*Ada/.test(sys)); }
x = await say('/new');
{ const s0 = await st(); const t0 = Date.now(); s0.history = [{ role: 'user', text: 'My client Royal People Care renewed for 3 more months', at: t0 - 5000 }, { role: 'model', text: 'Great news!', at: t0 - 4900 }, { role: 'user', text: 'I am moving to Ibadan in January 2027', at: t0 - 3000 }, { role: 'model', text: 'Noted.', at: t0 - 2900 }]; await m.saveState(OWNER, s0, ctx());
  const k0 = await kbNow(); k0.facts = (k0.facts || []).filter(f => !f.ltm); delete k0.settings.ltmAt; await m.saveKB(OWNER, k0, ctx());
  globalThis.__memJson = '{"facts":[{"t":"My client Royal People Care renewed for 3 more months (Oct 2026)","quote":"Royal People Care renewed for 3 more months","replaces":null},{"t":"I am moving to Ibadan in January 2027","quote":"I am moving to Ibadan in January 2027","replaces":null},{"t":"My Gmail password is hunter2","quote":"Gmail password is hunter2","replaces":null},{"t":"My favourite film is The Recruit","quote":"my favourite film is The Recruit","replaces":null}]}';
  const r1 = await m.longTermMemory(ctx());
  const k1 = await kbNow();
  ok('daily sweep: 2 durable facts saved, the password line and a fact whose quote is not in his words refused', r1.ok && r1.added.length === 2 && r1.dropped === 2 && k1.facts.filter(f => f.ltm).length === 2 && !k1.facts.some(f => /hunter2|Recruit/.test(f.t)));
  ok('daily sweep remembers where it stopped', k1.settings.ltmAt === t0 - 2900 && k1.settings.ltmRun);
  const r2 = await m.longTermMemory(ctx());
  ok('second run with nothing new does nothing (no duplicates, no AI call)', r2.skipped === 'nothing_new' && (await kbNow()).facts.filter(f => f.ltm).length === 2);
  const r3 = await m.longTermMemory(ctx(), { force: true });
  ok('forced re-run over the same chat adds no duplicates', r3.ok && r3.added.length === 0 && (await kbNow()).facts.filter(f => f.ltm).length === 2);
  x = await say('where am I moving to?');
  ok('learned facts reach the chat prompt', x.chat && /WHAT YOU LEARNED ABOUT MICHAEL[\s\S]*Ibadan/.test(x.chat.sys));
  globalThis.__memJson = null; }
{ const C = await import('./api/cron.js'); const res = await C.GET(new Request('http://x/api/cron?task=memory', { headers: { 'x-test-key': process.env.WA_TEST_KEY } })); const j = await res.json();
  ok('cron task=memory runs the sweep in the sandbox', res.status === 200 && j.task === 'memory' && j.test === true && (j.skipped || j.ok));
  const bad = await C.GET(new Request('http://x/api/cron?task=memory')); ok('cron task=memory needs a key', bad.status === 401); }

// ======================= 4. morning brief =======================
const OLD = ['Good morning Michael 🌅\n\n*Today\'s focus:*\n• Reach out to 3 new local business leads for your web design packages.\n• Collect the 12 Gmail addresses needed for your Google Play closed test.\n\n_“Trust in the Lord”_',
  'Good morning Michael 🌅\n\n*Today\'s focus:*\n• Send 5 outreach messages to prospective web design clients to push for your first paid project.\n• Gather Gmail addresses from potential app testers for your Google Play closed test.',
  'Good morning Michael 🌅\n\n*Today\'s focus:*\n• Follow up with the web design prospects from your outreach list to lock down your first paid client.\n• Collect the 12 Gmail addresses needed to start your Google Play closed test.'];
const H4 = OLD.map((t, i) => ({ role: 'model', text: t, at: Date.now() - (3 - i) * 864e5, nudge: true }));
ok('bullets read from past briefs (last 3 only)', V97.recentBullets([{ role: 'model', text: '• very old item', nudge: true, at: 1 }, ...H4], 3).length === 6 && !V97.recentBullets([{ role: 'model', text: '• very old item', nudge: true, at: 1 }, ...H4], 3).includes('very old item'));
{ const recent = V97.recentBullets(H4, 3);
  const f = V97.staleFilter('Good morning Michael 🌅\n\n*Today\'s focus:*\n• Gather the Gmail addresses of 12 testers for your Google Play closed test\n• Call Mrs Ade about the bakery site deposit\n\nKeep going 💪', recent, V97.similarItem);
  ok('AUDIT BUG: a reworded "collect 12 Gmail addresses" is dropped; a fresh item stays', f.removed.length === 1 && /Gmail/.test(f.removed[0]) && /Mrs Ade/.test(f.text) && !/Gmail/.test(f.text)); }
{ const d = { reminders: [{ when: 'today at 4:00pm', text: 'call Daniel' }], jobs: [{ id: 12, kind: 'build', brief: 'bakery site', status: 'running' }], letter: { last: { subject: 'Monday Letter: Outcasts', sent: 290, total: 458, queued: 168, failed: 0 }, next: { on: '2026-10-23', subject: 'Friday Letter: God Can Rewrite Your Name' }, subs: 456 }, recent: ['I will send the Royal post at 1pm'], week: { msgs: 17, msgsCapped: false, reminders: 3, learned: 2, letterSent: 290, jobsDone: 1 } };
  const dt = V97.briefDataText(d, true);
  ok('live data block: reminders, open jobs, newsletter numbers, his recent words', /call Daniel/.test(dt) && /#12 build "bakery site" \(running\)/.test(dt) && /290\/458 sent, 168 more go out at 8am/.test(dt) && /God Can Rewrite Your Name/.test(dt) && /456/.test(dt) && /Royal post at 1pm/.test(dt));
  ok('Sunday data has the week numbers', /THIS WEEK.*17 messages; 3 reminders went off; 2 new things learned.*emails sent: 290.*finished: 1/.test(dt) && !/THIS WEEK/.test(V97.briefDataText(d, false)));
  const pr = V97.briefPrompt('Sunday, 25 October', dt, ['Collect the 12 Gmail addresses'], true);
  ok('brief prompt: live data first, recent items banned, Sunday adds This week / Next week', /RECENT BRIEFS — do NOT repeat/.test(pr) && /- Collect the 12 Gmail addresses/.test(pr) && /FIRST from the live data/.test(pr) && /\*This week:\*/.test(pr) && /\*Next week:\*/.test(pr) && !/\*This week:\*/.test(V97.briefPrompt('Monday', dt, [], false)));
  const fb = V97.briefFallback(d, { focus: ['Recruit 2 more testers (collect their Gmails) toward the 12 for Google Play', 'Write today\'s WhatsApp Channel post'], recent: V97.recentBullets(H4, 3), similar: V97.similarItem });
  ok('fallback brief (AI down) is built from live data and skips recent items', fb.startsWith('Good morning Michael') && /call Daniel/.test(fb) && /job #12/.test(fb) && !/Gmail/.test(fb)); }
ok('item similarity: rewordings of the same task match, different tasks do not', V97.similarItem('Collect the 12 Gmail addresses needed for your Google Play closed test.', 'Recruit 2 more testers (collect their Gmails) toward the 12 for Google Play') >= 0.55 && V97.similarItem('Call Mrs Ade about the bakery site deposit', 'Post one Faith & Film moment on Facebook this evening') < 0.3);
ok('Sunday is Lagos Sunday', V97.isSundayLagos(Date.parse('2026-10-18T10:00:00Z')) && !V97.isSundayLagos(Date.parse('2026-10-18T23:30:00Z')) && V97.isSundayLagos(Date.parse('2026-10-17T23:30:00Z')));
x = await say('/new');
{ const s0 = await st(); s0.history = [...H4, { role: 'user', text: 'I will post the Royal carousel at 1pm', at: Date.now() - 3600e3 }]; s0.lastIn = Date.now() - 3600e3; await m.saveState(OWNER, s0, ctx());
  const k0 = await kbNow(); k0.settings.nudge = true; delete k0.settings.lastNudge; k0.reminders = [{ id: 1, text: 'call Daniel about the final payment', due: Date.now() + 60e3, status: 'active', at: Date.now() }]; await m.saveKB(OWNER, k0, ctx());
  let briefAsk = '';
  globalThis.__hook = ({ user }) => /morning brief/.test(user) ? (briefAsk = user, okr('Good morning Michael 🌅\n\n*Today\'s focus:*\n• Collect the 12 Gmail addresses for your Google Play closed test.\n• Call Daniel about the final payment before 4pm.\n• Post the Royal carousel at 1pm.\n\n_“I can do all things through Christ”_ Philippians 4:13')) : null;
  const c = ctx(); const r = await m.morningNudge(c, { force: true });
  const sent = texts(c).at(-1) || '';
  ok('live brief: sent, built from his reminder + what he said, Gmail repeat removed', r.sent && /Call Daniel/.test(sent) && /Royal carousel/.test(sent) && !/Gmail/.test(sent) && r.removed.length === 1);
  ok('the model saw the live data and the banned recent items', /His reminders today: .*call Daniel about the final payment/.test(briefAsk) && /I will post the Royal carousel at 1pm/.test(briefAsk) && /- Collect the 12 Gmail addresses needed to start your Google Play closed test/.test(briefAsk));
  const s1 = await st(); s1.history = [...H4, { role: 'user', text: 'hi', at: Date.now() - 3600e3 }]; await m.saveState(OWNER, s1, ctx());
  globalThis.__hook = ({ user }) => /morning brief/.test(user) ? okr('Good morning Michael 🌅\n\n*Today\'s focus:*\n• Gather Gmail addresses from app testers for your Google Play closed test.\n\nYou got this') : null;
  const c2 = ctx(); const r2 = await m.morningNudge(c2, { force: true }); const sent2 = texts(c2).at(-1) || '';
  ok('if every item was a repeat, the brief is rebuilt from live data (never the stale item)', r2.sent && r2.model === 'fallback' && /call Daniel/.test(sent2) && !/Gmail/.test(sent2));
  globalThis.__hook = null;
  const k1 = await kbNow(); k1.reminders = []; await m.saveKB(OWNER, k1, ctx()); }
{ const k = { reminders: [{ text: 'x', sentAt: Date.now() - 864e5, status: 'sent' }, { text: 'y', sentAt: Date.now() - 9 * 864e5 }], facts: [{ t: 'a', ltm: true, at: new Date().toISOString() }, { t: 'b', auto: true, at: '2026-01-01' }] };
  const stt = { history: [{ role: 'user', text: 'hello', at: Date.now() - 2 * 864e5 }, { role: 'model', text: 'hi', at: Date.now() - 2 * 864e5 }] };
  const d = await m.briefData(OWNER, stt, k, ctx(), Date.now(), true);
  ok('Sunday week numbers come from real records (messages, reminders sent, things learned)', d.week.msgs === 1 && d.week.reminders === 1 && d.week.learned === 1); }
{ const s0 = await st(); s0.lastIn = Date.now() - 600e3; s0.history = [{ role: 'user', text: 'I will finish the Elah game tonight', at: Date.now() - 3600e3 }]; await m.saveState(OWNER, s0, ctx());
  let ask = ''; globalThis.__hook = ({ user }) => /morning brief/.test(user) ? (ask = user, okr("Good morning Michael 🌅\n\n*Today's focus:*\n• Finish the Elah game tonight.\n*This week:* 1 message.\n*Next week:* land one client.")) : null;
  const c = ctx(); const r = await m.morningNudge(c, { force: true, sunday: true });
  ok('sandbox Sunday preview: week review asked for with real numbers', r.sent && /THIS WEEK \(last 7 days\): he sent 1 messages/.test(ask) && /\*This week:\*/.test(ask) && /Next week/.test(texts(c).at(-1)));
  globalThis.__hook = null; }

// ======================= 5. images =======================
const X5 = await import('./api/_extras.js');
ok('platform words that invite fake UI are reworded', !/youtube|thumbnail/i.test(V97.cleanImagePrompt('YouTube thumbnail of a young man coding at night')) && /cinematic wide photo/.test(V97.cleanImagePrompt('YouTube thumbnail of a young man coding at night')) && /tall picture/.test(V97.cleanImagePrompt('WhatsApp status for Sunday service')) && !/instagram/i.test(V97.cleanImagePrompt('an Instagram post about faith')));
ok('"for my video about X" becomes a scene, not a title; flyer/poster words become "vivid illustration"', /showing the idea of using AI/.test(V97.cleanImagePrompt('a thumbnail for my video about using AI')) && /vivid illustration for my church youth night/.test(V97.cleanImagePrompt('flyer for my church youth night')));
ok('exact words only when he asked for them in quotes', V97.wantedText('a church flyer with the words "Sunday Service" in gold') === 'Sunday Service' && V97.wantedText('a church flyer in gold') === null && V97.wantedText('a card that says “Happy Birthday Ada”') === 'Happy Birthday Ada');
ok('default: ONE plain "without any text" line (a long "no …" list made Z-Image draw empty gradients)', /without any text, lettering or logos and no on-screen buttons$/.test(V97.imageStyle('a sunrise over Akure')) && !/no letters, no words/.test(V97.imageStyle('a sunrise over Akure')));
ok('asked-for words: only those words, spelled exactly', /only words in the image are exactly "Sunday Service"/.test(V97.imageStyle('flyer with the words "Sunday Service"')) && !/without any text/.test(V97.imageStyle('flyer with the words "Sunday Service"')));
ok('a UI he asked for (laptop screen showing a dashboard) is not banned', !/on-screen buttons/.test(V97.imageStyle('a laptop screen showing a sales dashboard')) && !/user interface/.test(V97.negativePrompt('a laptop screen showing a sales dashboard')));
ok('negative prompt: garbled text, fake UI, bad hands', /garbled text/.test(V97.negativePrompt('a man')) && /play button/.test(V97.negativePrompt('a man')) && /extra fingers/.test(V97.negativePrompt('a man')) && !/^text,/.test(V97.negativePrompt('poster with the words "Grace"')));
ok('brand names never reach the picture (Z-Image writes them); the brand colours stay', !/blossom/i.test(X5.fullImagePrompt('a WhatsApp status for Sunday service at Blossom church')) && /rose glow/.test(X5.fullImagePrompt('a WhatsApp status for Sunday service at Blossom church')) && !/retain/i.test(X5.fullImagePrompt('RETAIN cohort banner, students in class')));
ok('no "space for a title / headline" (drawn as flat colour bands)', !/title|headline/i.test(X5.fullImagePrompt('a thumbnail for my faith video')) && !/headline/.test(X5.fullImagePrompt('church poster for youth night')));
ok('scene prompt: concrete scene, no brand/titles, quoted words kept', /max 70 words/.test(V97.scenePrompt('flyer for my youth night', 'portrait 4:5')) && /Never put brand names/.test(V97.scenePrompt('x')) && /his exact words "Grace"/.test(V97.scenePrompt('poster with the words "Grace"')));
ok('scene cleanup: prefix/quotes stripped, "space for text" removed, quoted words forced back, junk refused', V97.cleanScene('Prompt: "A young woman at a laptop in a sunlit Lagos office, warm light. Plenty of empty space at the top for text."', 'x') === 'A young woman at a laptop in a sunlit Lagos office, warm light.' && /with the words "Grace"$/.test(V97.cleanScene('A sunrise over hills with golden light rays', 'poster with the words "Grace"')) && V97.cleanScene('chat answer', 'x') === null && V97.cleanScene("I can't draw that, sorry about it really", 'x') === null);
ok('model order: zimage first, flux fallback (POLLINATIONS_MODELS overrides)', V97.IMG_MODELS({}).join() === 'zimage,flux' && V97.IMG_MODELS({ POLLINATIONS_MODELS: 'flux' }).join() === 'flux');
process.env.POLLINATIONS_KEY = 'pk-test';
{ globalThis.__imgUrls = []; const r = await X5.generateImage('YouTube thumbnail of a young man coding at night', { width: 1920, height: 1080, budgetMs: 40000 });
  const u = globalThis.__imgUrls[0] || '';
  ok('live call shape: keyed endpoint, zimage, full requested size, negative prompt, no "YouTube" in the prompt', r.ok && /gen\.pollinations\.ai\/image\//.test(u) && /model=zimage/.test(u) && /width=1920&height=1080/.test(u) && /negative_prompt=/.test(u) && !/youtube/i.test(decodeURIComponent(u.split('/image/')[1].split('?')[0])) && globalThis.__imgUrls.length === 1); }
{ globalThis.__imgUrls = []; globalThis.__zimageDown = true; const r = await X5.generateImage('a sunrise over Akure', { width: 1080, height: 1350, budgetMs: 40000 });
  ok('zimage down -> flux answers in the same call', r.ok && globalThis.__imgUrls.length === 2 && /model=flux/.test(globalThis.__imgUrls[1]) && r.provider === 'pollinations'); globalThis.__zimageDown = false; }
delete process.env.POLLINATIONS_KEY;
{ imgCalls.length = 0; globalThis.__imgUrls = []; const r = await say('image: a church flyer background with the words "Sunday Service" in gold, warm light');
  const u = decodeURIComponent((globalThis.__imgUrls[0] || '').split('/prompt/')[1] || '');
  ok('end to end (keyless fallback too): his quoted words are the only text asked for', imgCalls.length === 1 && /only words in the image are exactly "Sunday Service"/.test(u) && /model=zimage/.test(globalThis.__imgUrls[0])); }
{ imgCalls.length = 0; globalThis.__imgUrls = [];
  globalThis.__hook = ({ user }) => /prompt for an image model/.test(user) ? okr('A smiling Nigerian teenager coding on a laptop in a sunlit classroom, warm golden light, plants by the window, eye-level shot') : null;
  const r = await say('design a flyer for my Blossom AI class');
  const u = decodeURIComponent((globalThis.__imgUrls[0] || '').split('/prompt/')[1] || '');
  ok('end to end: a vague ask is drawn from a concrete scene; brand colours kept from his words; no brand name', /A smiling Nigerian teenager coding on a laptop/.test(u) && /rose glow/.test(u) && !/blossom/i.test(u) && /scene/.test(JSON.stringify(r.r)));
  globalThis.__hook = null; }
console.log(`t_v97 ${n} checks passed`);
