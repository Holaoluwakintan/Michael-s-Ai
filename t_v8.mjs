// v8 tests: the "super smart" layer. Routing + strong budget + key rotation, retrieval of his own work, learn,
// auto-memory (extract, dedupe, cap, never secrets), fresh-info search trigger, brain command, health.
// All mocked (in-memory store + brain RPC, fake Gemini generate/embed, fake WhatsApp). LIVE=1 adds a real check against the
// deployed index: the real embedding model + the real michael_ai_brain RPC must return his own book/letter/project content.
import assert from 'node:assert/strict';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092,2348000000001';
const LIVE = process.env.LIVE === '1';
const live = LIVE ? { SB_URL: process.env.SB_URL, SB_ANON_KEY: process.env.SB_ANON_KEY, SCHED_KEY: process.env.SCHED_KEY, GEMINI_API_KEY: process.env.GEMINI_LIVE_KEY } : null;
process.env.SB_URL = 'https://sb.test'; process.env.SB_ANON_KEY = 'anon'; process.env.SCHED_KEY = 'sched-test';
process.env.GEMINI_API_KEY = 'key-one'; delete process.env.GEMINI_API_KEY_2;
process.env.WA_TOKEN = 'wa-test-token'; process.env.WA_PHONE_ID = '123';
process.env.STRONG_PER_KEY = '2'; process.env.SOW_API_KEY = 'sow-test-key';
let n = 0; const ok = (name, cond) => { if (!cond) console.log('LAST:', JSON.stringify(globalThis.__last || null).slice(0, 1800)); assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092', OTHER = '2348000000001';

// ---------- in-memory stores ----------
const usageRows = []; const sowRows = []; const sowCalls = [];
const store = (op, a) => {
  if (op === 'usage_add') { usageRows.push(...a.rows); return true; }
  if (op === 'usage_get') return usageRows.filter(r => r.day === a.day);
  if (op === 'undelivered' || op === 'list' || op === 'site_list') return [];
  if (op === 'open_count' || op === 'count_today') return 0;
  if (op === 'sow_add') { const r = { id: 'sow-' + (sowRows.length + 1), post_date: a.post_date, post_time: a.post_time + ':00', caption: a.caption, title: a.title, status: 'queued', source: 'michael-ai' }; sowRows.push(r); return JSON.parse(JSON.stringify(r)); }
  if (op === 'sow_list') return sowRows.filter(r => r.status === 'queued');
  if (op === 'sow_delete') { const i = sowRows.findIndex(r => r.id === a.id); if (i < 0) return 0; sowRows.splice(i, 1); return 1; }
  return null;
};
const kchunks = []; let kid = 0; const brainCalls = [];
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };
const parseVec = s => JSON.parse(s);
function brainStore(op, a) {
  brainCalls.push(op);
  const ns = a.ns || 'wa';
  if (op === 'add') { let added = 0; for (const r of a.rows) if (!kchunks.some(c => c.ns === ns && c.h === r.h)) { kchunks.push({ id: ++kid, ns, ...r, emb: parseVec(r.emb) }); added++; } return { added }; }
  if (op === 'match') { const q = parseVec(a.emb); return kchunks.filter(c => c.ns === ns || (ns === 'wa-test' && c.ns === 'wa')).map(c => ({ id: c.id, src: c.src, title: c.title, url: c.url, body: c.body.slice(0, a.chars || 1400), score: +cos(q, c.emb).toFixed(4) })).sort((x, y) => y.score - x.score).slice(0, a.k || 5); }
  if (op === 'stats') { const o = {}; for (const c of kchunks.filter(c => c.ns === ns)) { const k = c.src.startsWith('book:') ? 'books' : c.src; o[k] = (o[k] || 0) + 1; } return o; }
  if (op === 'learned') return kchunks.filter(c => c.ns === ns && c.src === 'learn').reverse().map(c => ({ id: c.id, title: c.title, url: c.url }));
  if (op === 'sow_next') return [{ id: 'p1', post_date: '2099-01-01', post_time: '06:00', title: 'This Is The Day', caption: 'Before the noise starts…', platforms: Object.keys(SPm.PLATFORMS), source: 'morning-posts-30' }, { id: 'p2', post_date: '2099-01-02', post_time: '19:00', title: 'He Leads Me', caption: 'You are not wandering alone.', platforms: ['facebook', 'whatsapp'], source: 'michael-ai' }].slice(0, a.n || 3);
  if (op === 'del_id') { const i = kchunks.findIndex(c => c.ns === ns && c.id === +a.id && c.src === 'learn'); if (i < 0) return { deleted: 0 }; kchunks.splice(i, 1); return { deleted: 1 }; }
  return null;
}
// a tiny fake embedding: 768 dims, one bucket per topic word, so related texts are close
const TOPICS = ['golgotha', 'gabriel', 'kojo', 'esther', 'cult', 'twisted', 'letter', 'mercy', 'waiting', 'nysc', 'corps', 'danfo', 'lagos', 'crackit', 'jamb', 'wife', 'python', 'paris', 'devotional', 'god', 'sermon', 'church'];
const fakeEmb = t => { const v = new Array(768).fill(0.001); const s = String(t).toLowerCase(); TOPICS.forEach((w, i) => { const c = s.split(w).length - 1; if (c) v[i * 10] += 1 + Math.min(c, 3) * 0.2; }); v[767] = 0.35; return v; };

// ---------- fake network ----------
const calls = []; let embedCalls = 0; let mode = 'ok'; let voiceMode = 'ask'; const provCalls = []; const provMode = {}; const pages = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  const s = String(u);
  if (s.includes(':batchEmbedContents')) {
    embedCalls++;
    if (mode === 'embed429') return new Response('{"error":{"code":429}}', { status: 429 });
    const b = JSON.parse(o.body); return new Response(JSON.stringify({ embeddings: b.requests.map(r => ({ values: fakeEmb(r.content.parts[0].text) })) }), { status: 200 });
  }
  if (s.includes('generativelanguage')) {
    const model = s.match(/models\/([^:]+)/)[1]; const key = o.headers['x-goog-api-key'];
    const body = JSON.parse(o.body); const user = body.contents.at(-1).parts.map(p => p.text || '[media]').join('\n');
    const sys = body.systemInstruction?.parts?.[0]?.text || '';
    const call = { model, key, sys, user, thinking: body.generationConfig?.thinkingConfig?.thinkingLevel };
    calls.push(call);
    const okr = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] }), { status: 200 });
    if (user.includes('long-term memory of Michael')) {
      const said = (user.match(/MICHAEL: """([\s\S]*?)"""/) || [, ''])[1];
      if (said.includes('wife') && said.includes('Tolu')) return okr('{"facts":[{"t":"My wife is Tolu; her birthday is 3 March.","replaces":null}]}');
      if (said.includes('jollof')) return okr('{"facts":[{"t":"I prefer jollof rice to fried rice.","replaces":null},{"t":"My PIN is 4455","replaces":null}]}');
      if (said.includes('moved to Ibadan')) { const m = user.match(/(\d+)\. I live in Akure/); return okr(JSON.stringify({ facts: [{ t: 'I live in Ibadan now (moved October 2026).', replaces: m ? +m[1] : null }] })); }
      if (said.includes('Akure')) return okr('{"facts":[{"t":"I live in Akure.","replaces":null}]}');
      return okr('{"facts":[]}');
    }
    if (user.includes('Michael sent this voice note')) {
      if (voiceMode === 'ask') return okr('🎙️ _Remind me by 8pm 9pm 7pm to message Mr John to give me his VPS database_\nSure! Which time should I remind you: 7pm, 8pm or 9pm?');
      if (voiceMode === 'remind') return okr('REMIND: remind me at 7pm, 8pm and 9pm to message Mr John to give me his VPS database');
    }
    if (mode === 'claim') return okr("I've set reminders for 7pm, 8pm, and 9pm to message Mr John. ✅");
    if (mode === 'claimpost') return okr("Done! I've posted it to your Facebook page.");
    if (mode === 'key1-429' && key === 'key-one' && !model.includes('lite')) return new Response('{"error":{"code":429,"message":"GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 });
    return okr(`answer from ${model}`);
  }
  if (/graph\.facebook\.com\/v[\d.]+\/VOICE\d+$/.test(s)) return Response.json({ url: 'https://media.test/' + s.split('/').pop(), mime_type: 'audio/ogg' });
  if (s.startsWith('https://media.test/')) return new Response(new Uint8Array([79, 103, 103, 83, 0, 1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/ogg' } });
  if (s.includes('graph.facebook.com')) return new Response('{"messages":[{"id":"wamid.X"}]}', { status: 200 });
  if (s.includes('/rpc/michael_ai_set_next') || s.includes('/rpc/michael_ai_newsletter')) return new Response('null', { status: 200 });
  if (s.startsWith('https://sow-ng.vercel.app/')) {
    sowCalls.push({ url: s, method: o.method || 'GET', key: o.headers?.['x-sow-key'], body: o.body ? JSON.parse(o.body) : null });
    if (o.headers?.['x-sow-key'] !== 'sow-test-key') return new Response('{"error":"bad key"}', { status: 401 });
    if (s.includes('/api/stats?summary=week')) return Response.json({ from: '2026-10-01', to: '2026-10-07', upcoming_7d: 7, text: '📊 Sow week (2026-10-01 → 2026-10-07)\nPosted 3 times · 🔥 streak 2 days\n7 posts queued for the next 7 days.' });
    if (s.includes('action=mark')) { const b = JSON.parse(o.body); return Response.json({ ok: true, posted: { [b.platform]: '2026-10-07T07:00:00Z' } }); }
    if (s.includes('/api/today?date=')) return Response.json({ today: '2026-10-07', post: null, posts: s.includes('2099') ? [] : [{ id: 'd1', date: s.split('date=')[1], time: '06:00', title: 'This Is The Day', caption: 'Before the noise starts, decide to rejoice.', posted: {} }] });
    if (s.endsWith('/api/today')) return Response.json({ today: '2026-10-07', post: { id: 't1', time: '00:01', title: 'New Mercy Today' }, posts: [{ id: 't1', time: '00:01', title: 'New Mercy Today' }, { id: 't2', time: '23:59', title: 'Evening Word' }] });
  }
  if (s.startsWith('https://api.groq.com/openai/v1/') || s.startsWith('https://openrouter.ai/api/v1/')) {
    const prov = s.includes('groq') ? 'groq' : 'or';
    if (s.endsWith('/models')) return Response.json({ data: prov === 'groq' ? [{ id: 'whisper-large-v3' }, { id: 'llama-3.1-8b-instant' }, { id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }, { id: 'meta-llama/llama-guard-4-12b' }] : [{ id: 'openai/gpt-9' }, { id: 'nvidia/nemotron-3-super-120b-a12b:free' }, { id: 'google/gemma-4-26b-a4b-it:free' }, { id: 'nvidia/nemotron-3.5-content-safety:free' }] });
    const b = JSON.parse(o.body); provCalls.push({ prov, model: b.model, msgs: b.messages, auth: o.headers.authorization });
    if (provMode[prov] === '429') return new Response('{"error":{"message":"Rate limit reached for model on tokens per day (TPD)"}}', { status: 429 });
    if (provMode[prov] === 'retired' && b.model === 'openai/gpt-oss-120b') return new Response('{"error":{"message":"The model openai/gpt-oss-120b has been decommissioned"}}', { status: 400 });
    return Response.json({ choices: [{ message: { content: `answer from ${prov}:${b.model}` } }] });
  }
  if (pages[s]) return new Response(pages[s], { status: 200, headers: { 'content-type': 'text/html' } });
  throw new Error('unexpected network call in a test: ' + s);
};

const J = await import('./api/_jobs.js'); J.setMock(store);
const BR = await import('./api/_brain.js'); BR.setMock(brainStore);
const G = await import('./api/_gem.js');
const SPm = await import('./api/_sowplus.js');
const m = await import('./api/whatsapp.js');
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
let mid = 0;
const say = async (text, from = OWNER, c = ctx()) => { const r = await m.processMessage({ from, id: 'wamid.v8_' + (mid++), type: 'text', text: { body: text } }, 'T', c); globalThis.__last = texts(c); return { r, c, sent: texts(c), all: texts(c).join('\n') }; };

// seed the "his world" index (ns wa, as the real one is) through the same add op the bot uses
const seed = [
  ['book:golgotha', 'Golgotha — book overview', 'Overview of Michael\'s book "Golgotha": Gabriel, an orphan in Kojo Village, hears thoughts; the Squad of teenagers find their callings. Golgotha golgotha gabriel kojo.'],
  ['book:queen-esther-the-cult-leader', 'Queen Esther — book overview', 'Queen Esther: The Cult Leader, a novel about Esther and a cult. esther cult.'],
  ['letters', 'Delayed Is Not Denied', 'Monday Letter: waiting on God. While you are waiting, God is working. mercy waiting letter god devotional.'],
  ['letters', 'Your Prayers Were Working', 'Friday Letter: your prayers were working the whole time. waiting letter god mercy devotional.'],
  ['projects', 'NYSC Companion', "Michael's project — NYSC Companion https://nysc-companion-ng.vercel.app for corps members. nysc corps."],
  ['projects', 'Danfo Rush', "Michael's project — Danfo Rush https://danfo-rush-ng.vercel.app Lagos danfo game. danfo lagos."],
];
const sv = await BR.embed(seed.map(s => s[2]), 'RETRIEVAL_DOCUMENT');
await BR.brainRpc('add', { ns: 'wa', rows: seed.map((s, i) => ({ src: s[0], title: s[1], url: (s[2].match(/https:\S+/) || [null])[0], body: s[2], h: 'seed' + i, emb: BR.vecLit(sv[i]) })) });
embedCalls = 0;

// ======================= 1. routing =======================
for (const t of ['hi', 'Good morning', 'thanks!', 'how far', 'Amen 🙏', 'what time is it in London']) ok(`easy: "${t}"`, BR.classify(t).level === 'easy');
for (const t of ['Write a 300-word devotional on Psalm 23', 'debug this javascript: const x = [1,2', 'what is 15% of 240000?', 'Should I raise my website price to ₦150k?', 'Make a 3-month plan to grow my Facebook page', 'explain how compound interest works', 'compare Paystack and Flutterwave for my app', 'x'.repeat(300)]) ok(`hard: "${t.slice(0, 40)}"`, BR.classify(t).level === 'hard');
ok('media is always hard', BR.classify('', true).level === 'hard');

let x = await say('/new');
calls.length = 0;
x = await say('hello');
ok('easy chat -> Flash-Lite first', calls[0].model === 'gemini-flash-lite-latest' && x.c.route.chain === 'easy');
ok('"hello" does not hit the knowledge index or memory', embedCalls === 0 && !calls.some(c => c.user.includes('long-term memory')));
calls.length = 0;
x = await say('Give me a 3-month plan to grow my Facebook following');
ok('hard question -> gemini-3.6-flash (strong) first', calls[0].model === 'gemini-3.6-flash' && x.c.route.chain === 'hard' && x.sent.at(-1).startsWith('answer from gemini-3.6-flash'));
ok('strong answer keeps the normal (non-deep) prompt', !calls[0].sys.includes('THIS IS A HARD QUESTION') && calls[0].thinking === 'low');
calls.length = 0;
x = await say('explain how compound interest works');
ok('2nd hard question still strong (budget 2/key)', calls[0].model === 'gemini-3.6-flash');
calls.length = 0;
x = await say('compare Paystack and Flutterwave for my app');
const main = calls.find(c => !c.user.includes('long-term memory'));
ok('budget spent -> hard question goes to Lite in deep mode', x.c.route.deep === true && main.model === 'gemini-flash-lite-latest' && x.sent.at(-1).startsWith('answer from gemini-flash-lite-latest'));
ok('deep mode: "think step by step" rules + more thinking on Lite', main.sys.includes('THIS IS A HARD QUESTION') && main.sys.includes('step by step') && main.thinking === 'medium');
x = await say('brain');
ok('brain: per-key strong/lite usage, strong left 0, routing counts', x.all.includes('Brain today') && x.all.includes('*Key 1*: strong 2/2') && x.all.includes('Strong answers left today: *0*') && /2 hard → strong/.test(x.all) && /1 hard → lite \(deep mode\)/.test(x.all));
ok('brain: knowledge index counts + 2nd-key hint', x.all.includes('Knows your world: 2 letters, 2 book passages, 2 projects') && x.all.includes('2nd free Google AI key'));
x = await say('brain', OTHER);
ok('brain is owner-only', x.all.includes('Only Michael'));

// ======================= 2. key rotation =======================
process.env.GEMINI_API_KEY_2 = 'key-two'; G._resetForTests();
x = await say('/new');
mode = 'key1-429'; calls.length = 0;
x = await say('Write a short sermon outline on Ruth');
ok('2 keys: budget is per key -> strong again with key 2', x.c.route.chain === 'hard');
ok('429 on key 1 -> same strong model retried on key 2 (rotation)', calls.filter(c => c.model === 'gemini-3.6-flash').map(c => c.key).join() === 'key-one,key-two' && x.sent.at(-1).startsWith('answer from gemini-3.6-flash'));
calls.length = 0;
x = await say('Write a short poem about Lagos rain');
ok('key 1 parked after a daily 429: next strong call goes straight to key 2', calls.find(c => c.model === 'gemini-3.6-flash').key === 'key-two');
x = await say('brain');
ok('brain shows both keys: key 1 limit hit, key 2 strong count', x.all.includes('*Key 1*:') && x.all.includes('limit hit') && x.all.includes('*Key 2*: strong 2/2') && !x.all.includes('2nd free Google AI key'));
calls.length = 0;
x = await say('Write a devotional on patience');
ok('both keys spent -> graceful fallback to Lite deep mode', x.c.route.deep === true && calls.find(c => !c.user.includes('long-term memory')).model === 'gemini-flash-lite-latest');
mode = 'ok'; delete process.env.GEMINI_API_KEY_2; G._resetForTests(); process.env.STRONG_PER_KEY = '20';

// ======================= 3. retrieval: knows his world =======================
x = await say('/new');
calls.length = 0; embedCalls = 0;
x = await say('What is my book Golgotha about?');
let sys = calls.find(c => !c.user.includes('long-term memory')).sys;
ok('question about his book -> one embedding + one match, overview in the prompt', embedCalls === 1 && sys.includes("# FROM MICHAEL'S OWN WORK") && sys.includes('Golgotha — book overview') && sys.includes('Kojo Village'));
ok('only relevant chunks (score threshold): no Danfo/NYSC chunk for a Golgotha question', !sys.includes('Danfo Rush') && !sys.includes('NYSC Companion') && x.c.brain.n >= 1);
calls.length = 0;
x = await say('what is the link to my nysc app');
sys = calls.find(c => !c.user.includes('long-term memory')).sys;
ok('project question -> the real project link is in the prompt', sys.includes('https://nysc-companion-ng.vercel.app'));
calls.length = 0;
x = await say('Write a short devotional as me about waiting on God');
sys = calls.find(c => !c.user.includes('long-term memory')).sys;
ok('"write as me" -> his letters as voice samples + the voice instruction + full voice pack', sys.includes('Delayed Is Not Denied') && sys.includes('Your Prayers Were Working') && sys.includes('match the voice of his letters') && sys.includes('# VOICE PACK') && !sys.includes('Left out of this chat turn'));
calls.length = 0;
x = await say('How do I reverse a list in Paris style');
sys = calls.find(c => !c.user.includes('long-term memory')).sys;
ok('unrelated question -> nothing from his world added', !sys.includes("# FROM MICHAEL'S OWN WORK"));
mode = 'embed429'; calls.length = 0;
x = await say('Tell me about my book Queen Esther the cult leader');
ok('embedding quota hit -> still answers (retrieval skipped quietly)', x.sent.at(-1).startsWith('answer from') && !calls[0].sys.includes("# FROM MICHAEL'S OWN WORK"));
mode = 'ok';
ok('wantsRetrieval skips small talk and commands', !BR.wantsRetrieval('hi') && !BR.wantsRetrieval('ok thanks') && !BR.wantsRetrieval('/knowledge') && BR.wantsRetrieval('what is my book about') && BR.wantsRetrieval('tell me about Danfo Rush please'));

// learn
x = await say('learn My next book is called Abba, a novel about a church in Ondo. It launches in December 2026.');
ok('learn <text> -> stored in his index', x.all.includes('📚 Learned') && kchunks.some(c => c.src === 'learn' && c.body.includes('Abba') && c.ns === 'wa-test'));
pages['https://example.org/about-sow'] = '<html><head><title>About Sow</title></head><body><main><h1>Sow</h1><p>Sow is Michael\'s cross-posting app. It posts a daily verse to Facebook and YouTube at 6am. It was built in October 2026 and is free to use for his pages and church.</p><p>Sow also keeps a queue of scheduled posts that he can see and cancel from WhatsApp.</p></main></body></html>';
x = await say('learn https://example.org/about-sow');
ok('learn <link> -> page read and stored with its URL', x.all.includes('📚 Learned from *About Sow*') && kchunks.some(c => c.src === 'learn' && c.url === 'https://example.org/about-sow' && c.body.includes('cross-posting')));
x = await say('learn my gmail password is hunter2');
ok('learn refuses secrets', x.all.includes('🔒') && !kchunks.some(c => c.body.includes('hunter2')));
x = await say('learned');
ok('learned lists items with numbers', x.all.includes('Things you taught me with learn') && x.all.includes('About Sow'));
const lid = kchunks.find(c => c.url === 'https://example.org/about-sow').id;
x = await say('unlearn ' + lid);
ok('unlearn removes it', x.all.includes(`Removed #${lid}`) && !kchunks.some(c => c.id === lid));
ok('"learn how to code" is a question, not the learn command', !BR.LEARN_RE.test('learn how to code in python') && !BR.LEARN_RE.test('learn about prayer') && BR.LEARN_RE.test('learn: Ranti has 120 users'));
x = await say('learn My Studio prices changed', OTHER);
ok('learn is owner-only', x.all.includes('Only Michael'));

// ======================= 4. auto-memory =======================
x = await say('/new');
x = await say('My wife is Tolu and her birthday is March 3, I want to plan something special');
let kbNow = await m.loadKB(OWNER, ctx());
ok('auto-memory: durable fact saved without "teach:" and shown in one line', kbNow.facts.some(f => f.auto && f.t.includes('Tolu')) && x.sent.at(-1).includes('📝 Noted: My wife is Tolu'));
const before = kbNow.facts.length;
x = await say('Remind me that my wife Tolu birthday is March 3 is coming, what gift ideas?');
kbNow = await m.loadKB(OWNER, ctx());
ok('auto-memory dedupes (same fact not saved twice)', kbNow.facts.length === before);
x = await say('I like jollof more than fried rice, and I usually eat late');
kbNow = await m.loadKB(OWNER, ctx());
ok('auto-memory drops anything secret-looking (a PIN) but keeps the preference', kbNow.facts.some(f => f.t.includes('jollof')) && !kbNow.facts.some(f => /4455|PIN/.test(f.t)));
calls.length = 0;
x = await say('my bank account number is 0123456789 and my password is abc, keep it safe');
ok('secret message -> no memory call at all, nothing saved', !calls.some(c => c.user.includes('long-term memory')) && !(await m.loadKB(OWNER, ctx())).facts.some(f => /0123456789|abc/.test(f.t)));
x = await say('I live in Akure with my family');
x = await say('We just moved to Ibadan last week, I live there now');
kbNow = await m.loadKB(OWNER, ctx());
ok('auto-memory updates an old auto fact in place (replaces)', kbNow.facts.some(f => f.t.includes('Ibadan')) && !kbNow.facts.some(f => f.t === 'I live in Akure.'));
x = await say('/knowledge');
ok('/knowledge lists auto facts with 📝', x.all.includes('📝 My wife is Tolu') && x.all.includes('picked up from our chats by itself'));
const idx = kbNow.facts.findIndex(f => f.t.includes('jollof')) + 1;
x = await say('/unteach ' + idx);
ok('/unteach removes an auto fact', !(await m.loadKB(OWNER, ctx())).facts.some(f => f.t.includes('jollof')));
const kb2 = { facts: Array.from({ length: 90 }, (_, i) => ({ t: `auto fact number ${i} about topic${i} item${i * 7}`, auto: true })) };
BR.applyMemory(kb2, [{ t: 'a brand new durable fact about rice' }]);
ok('auto facts capped at 80 (oldest auto ones drop)', kb2.facts.length === 80 && kb2.facts.at(-1).t.includes('rice') && !kb2.facts.some(f => f.t.startsWith('auto fact number 0 ')));
ok('wantsMemory: personal yes, small talk/commands no', BR.wantsMemory('My sister Funmi is getting married in December') && !BR.wantsMemory('hi') && !BR.wantsMemory('teach: my price is 2k') && !BR.wantsMemory('what is 2+2'));
ok('looksSecret catches keys, passwords, cards', BR.looksSecret('AIzaSyD' + 'x'.repeat(30)) && BR.looksSecret('my password is x') && BR.looksSecret('card 4111 1111 1111 1111') && !BR.looksSecret('My wife is Tolu'));
ok('parseMemory tolerates junk', BR.parseMemory('nope').length === 0 && BR.parseMemory('```json\n{"facts":[{"t":"I am a pastor\'s son"}]}\n```').length === 1);

// ======================= 5. fresh-info search trigger =======================
for (const t of ["what's the news in Nigeria today?", 'Who won the Arsenal match?', 'how much is petrol in Lagos today?', 'What is the dollar to naira rate right now?', 'any update on the ASUU strike this week?', 'latest iPhone price in Nigeria?']) ok(`search: "${t}"`, !!(m.processMessage && (BR.detectFresh(t) || (await import('./api/_v5.js')).detectSearch(t))));
for (const t of ['what should I post today?', 'what is the link to my nysc app', 'how are you today?', 'Write a devotional for today', 'tell me about my danfo game', 'what is my latest letter?']) ok(`no search: "${t}"`, !BR.detectFresh(t) && !(await import('./api/_v5.js')).detectSearch(t));


// ======================= 6. Sow, first-class =======================
for (const [q, op] of [['sow', 'next'], ['Sow week', 'week'], ['how did my posts do this week?', 'week'], ['posted facebook', 'posted'], ['I posted it on my WhatsApp status', 'posted'], ["what's posting tomorrow on sow?", 'day'], ["what's on sow friday", 'day'], ['sow tomorrow', 'day'], ['add a post for Friday 7pm about faith', 'add'], ['schedule a post for tomorrow 6am about gratitude', 'add']]) ok(`sow intent: "${q}" -> ${op}`, SPm.detect(q)?.op === op);
for (const q of ['queued posts', 'post God is faithful 🙏', 'schedule tomorrow 7am New chapter out!', 'what should I post today?', 'posted my letter', 'unpost']) ok(`not a v8 sow intent (v7 or chat): "${q}"`, SPm.detect(q) === null);
ok('platform aliases', SPm.platformOf('IG') === 'instagram' && SPm.platformOf('my page') === 'fb_page' && SPm.platformOf('twitter') === 'x' && SPm.platformOf('channel') === 'wa_channel' && SPm.platformOf('status') === 'whatsapp' && SPm.platformOf('letter') === null);
x = await say('sow');
ok('sow -> next 3 queued posts with time, title and platforms', x.all.includes('Next in Sow') && x.all.includes('06:00* · This Is The Day') && x.all.includes('all your platforms') && x.all.includes('Facebook, WhatsApp Status'));
x = await say('sow week');
ok('sow week -> Sow\'s weekly summary text (with the key header)', x.all.includes('Posted 3 times') && sowCalls.at(-1).url.endsWith('/api/stats?summary=week') && sowCalls.at(-1).key === 'sow-test-key');
x = await say("what's posting tomorrow on sow?");
const tmr = SPm.dateOf('tomorrow');
ok('natural "what\'s posting tomorrow on sow" -> that day\'s posts', sowCalls.at(-1).url.endsWith('/api/today?date=' + tmr) && x.all.includes('Tomorrow in Sow') && x.all.includes('This Is The Day'));
x = await say('posted ig');
ok('posted <platform> -> marks today\'s latest due post on that platform', sowCalls.at(-1).url.endsWith('/api/today?action=mark') && sowCalls.at(-1).method === 'POST' && sowCalls.at(-1).body.post_id === 't1' && sowCalls.at(-1).body.platform === 'instagram' && x.all.includes('Marked *New Mercy Today* as posted on Instagram'));
calls.length = 0;
x = await say('add a post for Friday 7pm about faith');
const added = sowRows.at(-1);
ok('natural "add a post for Friday 7pm about faith" -> written in his voice by AI and queued for that Friday 19:00', added && added.post_time === '19:00:00' && (added.post_date === SPm.dateOf('friday') || (new Date(Date.now() + 3600e3).getUTCDay() === 5 && added.post_date === SPm.dateOf('today'))) &&   /* on a Friday, 'Friday 7pm' is tonight */ calls.some(c => c.user.includes('about: faith') && c.sys.includes('# VOICE PACK')) && x.all.includes('Scheduled in *Sow*'));
x = await say('unpost');
ok('unpost removes the AI-added post (undo works)', !sowRows.some(r => r.id === added.id) && x.all.includes('Removed'));
x = await say('sow', OTHER);
ok('Sow commands are owner-only', x.all.includes('Only Michael'));
process.env.SOW_API_KEY = 'wrong';
x = await say('sow week');
ok('Sow down / bad key -> a friendly line, no crash', x.all.includes('Sow didn\'t answer'));
process.env.SOW_API_KEY = 'sow-test-key';

// ======================= 6b. reminders: the 07:42Z bug (several times, clarification answer, no fake "I've set") =======================
const R8 = await import('./api/_remind8.js');
const remsOf = async () => (await m.loadKB(OWNER, ctx())).reminders || [];
const remTexts = async () => (await remsOf()).filter(r => !r.done && /Mr John/.test(r.text)).map(r => new Date(r.due).toISOString().slice(11, 16)).sort();
const resetRems = async () => { const kb = await m.loadKB(OWNER, ctx()); kb.reminders = []; await m.saveKB(OWNER, kb, ctx()); };
const pm = R8.parseMulti('Remind me by 8pm 9pm 7pm to message Mr John to give me his VPS database', Date.parse('2026-10-07T07:42:00Z'));
ok('parseMulti: "by 8pm 9pm 7pm" -> 3 reminders 18:00/19:00/20:00 UTC, task text intact', pm && pm.multi.length === 3 && pm.multi.map(x => new Date(x.due).toISOString().slice(11, 16)).join() === '18:00,19:00,20:00' && pm.multi.every(x => x.text === 'message Mr John to give me his VPS database'));
ok('parseMulti: "at 7pm, 8pm and 9pm", "tomorrow at 6am and 9am"', R8.parseMulti('remind me at 7pm, 8pm and 9pm to call mum').multi.length === 3 && R8.parseMulti('remind me tomorrow at 6am and 9am to pray').multi.length === 2 && R8.parseMulti('remind me at 7pm to call mum') === null);
ok('resolveAnswer: "The three time" / "all" / "8pm" against the original request', R8.resolveAnswer(pm ? 'Remind me by 8pm 9pm 7pm to message Mr John' : '', 'The three time').multi.length === 3 && R8.resolveAnswer('Remind me by 8pm 9pm 7pm to message Mr John', 'all').multi.length === 3 && new Date(R8.resolveAnswer('Remind me by 8pm 9pm 7pm to message Mr John', '8pm').due).getUTCHours() === 19 && R8.resolveAnswer('remind me to call mum', 'at 5pm').text === 'call mum');
ok('claimsAction spots fake claims, not normal answers', R8.claimsAction("I've set reminders for 7pm, 8pm, and 9pm").kind === 'reminder' && R8.claimsAction("Done! I've posted it to your page").kind === 'action' && R8.claimsAction('Here is a caption you can post') === null && R8.claimsAction("I've added a call to action at the end") === null);

process.env.WA_MOCK_MEDIA_FILE = ''; await resetRems(); x = await say('/new');
x = await say('Remind me by 8pm 9pm 7pm to message Mr John to give me his VPS database');
const t3 = await remTexts();
ok('typed: the exact 07:42Z request now stores 3 real reminders', t3.length === 3 && x.all.includes('3 reminders set'));
await resetRems(); x = await say('/new');
const voice = async (id) => { const c = ctx(); await m.processMessage({ from: OWNER, id: 'wamid.v8voice' + (mid++), type: 'audio', audio: { id, voice: true } }, 'T', c); globalThis.__last = texts(c); return { c, all: texts(c).join('\n') }; };
voiceMode = 'ask';
let v = await voice('VOICE1');
ok('incident replay, step 1: voice note -> the model asks which time (nothing stored yet)', v.all.includes('Which time') && (await remTexts()).length === 0);
calls.length = 0;
x = await say('The three time');
ok('incident replay, step 2: "The three time" goes back into the reminder flow -> 3 real reminders, honest confirmation', (await remTexts()).join() === (pm ? pm.multi.map(p => new Date(p.due).toISOString().slice(11, 16)).join() : '') && x.all.includes('3 reminders set') && !calls.some(c => !c.user.includes('long-term memory')));
await resetRems(); x = await say('/new');
voiceMode = 'remind';
v = await voice('VOICE2');
ok('voice reminder now comes back as REMIND: and is stored for real (3 times)', (await remTexts()).length === 3 && v.all.includes('3 reminders set'));
await resetRems(); x = await say('/new');
x = await say('Mr John still owes me his VPS database');
mode = 'claim';
x = await say('The three time');
ok('chat model claims "I\'ve set reminders" with nothing parseable -> honest line, nothing stored', x.all.includes("haven't set that reminder yet") && !x.all.includes("I've set reminders") && (await remTexts()).length === 0);
mode = 'ok';
x = await say('/new'); await resetRems();
mode = 'claim';
x = await say('can you sort out reminders for 7pm 8pm and 9pm to message Mr John?');
ok('loose "reminders for 7pm 8pm and 9pm to …" -> set for real (the chat\'s fake claim never reaches him)', (await remTexts()).length === 3 && x.all.includes('3 reminders set') && !x.all.includes('✅\n') );
mode = 'claimpost';
x = await say('my FB page has been quiet, what do you think?');
ok('chat claims "I\'ve posted it" -> correction line appended, nothing pretends to be posted', x.all.includes('Nothing was actually sent or posted'));
mode = 'ok';
calls.length = 0; x = await say('how are you doing today my friend');
ok('every chat prompt carries the honesty-about-actions rule', calls.find(c => !c.user.includes('long-term memory')).sys.includes('HONESTY ABOUT ACTIONS'));
await resetRems();

// ======================= 6c. other free AI providers (Groq, OpenRouter) =======================
const PV = await import('./api/_providers.js');
const V5 = await import('./api/_v5.js');
delete process.env.GROQ_API_KEY; delete process.env.OPENROUTER_API_KEY;
ok('no provider keys -> chains exactly as before (v5 HARD/EASY)', BR.chainFor({ chain: 'hard' }).join() === V5.HARD_CHAIN.join() && BR.chainFor({ chain: 'easy' }).join() === V5.EASY_CHAIN.join() && BR.chainFor({ chain: 'deep' }).join() === V5.EASY_CHAIN.join());
process.env.GROQ_API_KEY = 'gsk-test'; process.env.OPENROUTER_API_KEY = 'or-test'; PV._resetForTests();
ok('with keys: hard = Gemini strong -> Groq/OpenRouter strong -> Lite…; easy = Lite -> fast providers -> Gemma…', BR.chainFor({ chain: 'hard' }).slice(2, 4).join() === 'groq:strong,or:strong' && BR.chainFor({ chain: 'easy' }).slice(4, 6).join() === 'groq:fast,or:fast'   /* v9.7: providers' strong models moved up (after the 2 working Flash / after Lite) */);
ok('model picked from the live list: Groq strong = gpt-oss-120b, fast = 8b-instant; OpenRouter only :free', await PV.resolve('groq:strong') === 'openai/gpt-oss-120b' && await PV.resolve('groq:fast') === 'llama-3.1-8b-instant' && await PV.resolve('or:strong') === 'nvidia/nemotron-3-super-120b-a12b:free' && (await PV.resolve('or:fast')).endsWith(':free'));
ok('media never goes to the other providers', PV.toMessages('s', [{ role: 'user', parts: [{ inline_data: { data: 'x' } }, { text: 'hi' }] }]) === null);
ok('long system prompt trimmed head+tail for small free-tier limits', PV.compact('A'.repeat(10000) + 'B'.repeat(20000) + 'TAIL', 16000).length <= 16000 && PV.compact('A'.repeat(10000) + 'B'.repeat(20000) + 'TAIL', 16000).endsWith('TAIL'));
process.env.STRONG_PER_KEY = '0'; x = await say('/new');
provCalls.length = 0; calls.length = 0;
x = await say('Write a short plan to grow my church choir');
ok('Gemini strong budget spent + Groq key -> hard question goes to Groq\'s 120B (not Lite deep mode)', x.c.route.chain === 'alt' && provCalls[0].prov === 'groq' && provCalls[0].model === 'openai/gpt-oss-120b' && x.sent.at(-1).startsWith('answer from groq:openai/gpt-oss-120b'));
ok('OpenAI-style call: system message + user turn, Bearer key', provCalls[0].msgs[0].role === 'system' && provCalls[0].msgs.at(-1).role === 'user' && provCalls[0].msgs.at(-1).content.includes('church choir') && provCalls[0].auth === 'Bearer gsk-test');
provMode.groq = '429'; provCalls.length = 0;
x = await say('Write a short plan for my Bible study group');
ok('Groq 429 -> rotates to OpenRouter (free model)', provCalls.map(c => c.prov).join() === 'groq,or' && x.sent.at(-1).startsWith('answer from or:nvidia/nemotron-3-super-120b-a12b:free'));
provMode.or = '429'; provCalls.length = 0; calls.length = 0;
x = await say('Write a short plan for my youth fellowship');
ok('Groq parked after its 429 (no wasted call), OpenRouter 429 too -> Lite with step-by-step (deep) as before', !provCalls.some(c => c.prov === 'groq') && calls.find(c => !c.user.includes('long-term memory')).model === 'gemini-flash-lite-latest' && calls.find(c => !c.user.includes('long-term memory')).sys.includes('THIS IS A HARD QUESTION'));
x = await say('brain');
ok('brain shows usage per provider', x.all.includes('*Groq*: strong 1') && x.all.includes('limit/error') && x.all.includes('*OpenRouter*: strong 1') && x.all.includes('hard → other providers'));
provMode.groq = 'retired'; provMode.or = undefined; PV._resetForTests(); x = await say('/new'); { const st = await m.loadState(OWNER, ctx()); st.cool = {}; await m.saveState(OWNER, st, ctx()); } provCalls.length = 0;
x = await say('Write a short plan for my prayer group');
ok('retired Groq model -> picks another from the live list once, still answers', provCalls.length === 2 && provCalls[1].model === 'llama-3.3-70b-versatile' && x.sent.at(-1).startsWith('answer from groq:llama-3.3-70b-versatile'));
const hp = await (await m.GET(new Request('https://x.test/api/whatsapp?health=1'))).json();
ok('health lists providers', hp.v8.providers.join() === 'gemini,groq,or' && hp.v8.provider_env.includes('OPENROUTER_API_KEY'));
delete process.env.GROQ_API_KEY; delete process.env.OPENROUTER_API_KEY; provMode.groq = provMode.or = undefined; process.env.STRONG_PER_KEY = '20';

// ======================= 7. health =======================
const h = await (await m.GET(new Request('https://x.test/api/whatsapp?health=1'))).json();
ok('health: build v8.x with the v8 block (and v7/v7.1 blocks kept)', /^v[89]\.\d/.test(h.build) && h.v8.auto_memory === true && /pgvector/.test(h.v8.retrieval) && h.v8.key_env.includes('GEMINI_API_KEY_2') && h.v7 && h.v71);
ok('help mentions brain + learn + Sow', m.HELP.includes('brain') && m.HELP.includes('learn <text or link>') && m.HELP.includes('sow week') && m.HELP.includes('posted facebook'));
ok('health lists the Sow commands', h.v8.cmds.includes('sow week') && h.v8.cmds.includes('posted <platform>'));

// ======================= 8. LIVE: the real index returns his own content =======================
if (LIVE) {
  BR.setMock(null); J.setMock(null); globalThis.fetch = realFetch;
  Object.assign(process.env, live);
  for (const [q, want] of [['What is my book Golgotha about?', /Golgotha/], ['Write as me a short letter about waiting on God', /letters/], ['What is the link to my NYSC app?', /nysc-companion-ng\.vercel\.app/], ['Who is Esther in my cult leader book?', /Esther/]]) {
    const r = await BR.retrieve(q, { ns: 'wa', voice: /as me/.test(q) });
    const blob = r.hits.map(h => `${h.src} ${h.title} ${h.url || ''} ${h.body}`).join('\n');
    console.log(`   LIVE "${q}" -> ${r.ms} ms, best ${r.best}, ${r.hits.map(h => h.title).join(' | ')}`);
    ok(`LIVE retrieval: "${q}"`, r.hits.length >= 1 && want.test(blob));
  }
  const r = await BR.retrieve('What is the capital of France?', { ns: 'wa' });
  ok('LIVE retrieval: unrelated question brings nothing', r.hits.length === 0);
}
globalThis.fetch = realFetch;
console.log(`\n${n} checks passed`);
