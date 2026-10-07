// v5 tests: reminders (parse in Africa/Lagos, store/list/cancel, scheduler endpoint fires a due reminder in the sandbox,
// endpoint auth, 24h-window miss + "missed while asleep" notice, failed-status webhook), web search with sources (REAL keyless
// search, mocked Gemini), model rotation on simulated 429/503, prompt trimming, usage. Nothing is sent to WhatsApp (test ctx);
// state lives under wa-test/ in the real Blob store and is cleaned at the end.
import assert from 'node:assert/strict';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.SCHED_KEY = 'sched-test-key-0123456789abcdef';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'cron-test-secret-0123456789abcdef';
process.env.SB_URL = 'https://sb.example.test'; process.env.SB_ANON_KEY = 'anon';
const realFetch = globalThis.fetch;
const calls = [], rpc = [], kvMem = new Map();
let mode = 'ok';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://sb.example.test/rest/v1/rpc/michael_ai_jobs')) {   // v7: the bot's kv store (Supabase) in memory
    const b = JSON.parse(opts.body);
    if (b.p_op === 'kv_get') return new Response(kvMem.has(b.p_args.k) ? kvMem.get(b.p_args.k) : 'null', { status: 200 });
    if (b.p_op === 'kv_put') { kvMem.set(b.p_args.k, JSON.stringify(b.p_args.v)); return new Response('true', { status: 200 }); }
    if (b.p_op === 'kv_purge_test') { const n = kvMem.size; kvMem.clear(); return new Response(String(n), { status: 200 }); }
    if (b.p_op === 'usage_add') return new Response('true', { status: 200 });
    if (b.p_op === 'usage_get') return new Response('[]', { status: 200 });
  }
  if (u.startsWith('https://sb.example.test')) { rpc.push(JSON.parse(opts.body)); return new Response('"ok"', { status: 200 }); }
  if (u.includes('generativelanguage')) {
    const model = u.match(/models\/([^:]+)/)[1];
    const body = JSON.parse(opts.body);
    const user = body.contents.at(-1).parts.map(p => p.text || '[media]').join('\n');
    calls.push({ model, sys: body.systemInstruction.parts[0].text, user, thinking: body.generationConfig.thinkingConfig });
    const okr = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: t }] } }] }), { status: 200 });
    if (mode === 'smart429' && /^gemini-(3\.6|flash-latest|3\.8|3\.5)-?f?/.test(model) && !model.includes('lite')) return new Response('{"error":{"code":429,"message":"You exceeded your current quota"}}', { status: 429 });
    if (mode === 'lite503' && model.includes('lite')) return new Response('{"error":{"code":503,"message":"high demand"}}', { status: 503 });
    if (mode === 'allbutgemma' && !model.startsWith('gemma')) return new Response('{"error":{"code":429,"message":"GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 });
    if (user.includes('Turn it into ONE reminder')) return okr('{"when":"' + aiWhen + '","repeat":null,"task":"call pastor"}');
    if (user.includes('fresh web results')) return okr('*Latest:* the answer is in the first source [1], with more detail in [3].');
    return okr(`answer from ${model}`);
  }
  return realFetch(url, opts);
};
const m = await import('./api/whatsapp.js');
await (await import('./t_store.mjs')).cleanTest(); // v7 fresh sandbox (the store keeps wa-test records between runs)
const v = await import('./api/_v5.js');
const cron = await import('./api/cron.js');
const OWNER = '2348148034092';
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
let n = 0;
const say = async (text, c = ctx()) => { const r = await m.processMessage({ from: OWNER, id: 'wamid.v5' + Date.now() + (n++), type: 'text', text: { body: text } }, 'T', c); return { r, c, sent: c.outbox.filter(b => b.type === 'text').map(b => b.text.body) }; };
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('✔', name); };
const L = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 1, mi);        // Lagos wall clock -> ms (UTC+1)
let aiWhen = '';

// ---- 1. reminder parsing (Africa/Lagos) ----
const NOW = L(2026, 10, 6, 18, 50);                                             // Tue 6 Oct 2026, 6:50pm Lagos
const P = t => v.parseReminder(t, NOW);
ok('at 5pm (already past) -> tomorrow 17:00 WAT', P('remind me at 5pm to post the verse').due === L(2026, 10, 7, 17) && P('remind me at 5pm to post the verse').text === 'post the verse');
ok('at 9pm -> today 21:00 WAT = 20:00 UTC', P('remind me at 9pm to post the verse').due === Date.UTC(2026, 9, 6, 20));
ok('tomorrow 7am', P('remind me tomorrow 7am to call the printer').due === L(2026, 10, 7, 7) && P('remind me tomorrow 7am to call the printer').text === 'call the printer');
ok('in 2 hours', P('remind me in 2 hours to check the oven').due === NOW + 2 * 3600e3);
ok('in 30 mins / half an hour', P('remind me in 30 mins to drink water').due === NOW + 30 * 60e3 && P('remind me in half an hour to stretch').due === NOW + 30 * 60e3);
{ const r = P("every day at 6am remind me to post today's verse"); ok('every day at 6am -> daily, next 6:00 WAT tomorrow, text keeps "today\'s"', r.rep.type === 'daily' && r.rep.h === 6 && r.due === L(2026, 10, 7, 6) && r.text === "post today's verse"); }
{ const r = P('every weekday at 7am remind me to pitch 3 businesses'); ok('every weekday', r.rep.type === 'weekdays' && r.due === L(2026, 10, 7, 7)); }
{ const r = P('every monday at 9am remind me to plan the week'); ok('every monday -> Mon 12 Oct 9:00', r.rep.type === 'weekly' && r.due === L(2026, 10, 12, 9)); }
ok('on friday at 3pm', P('remind me on friday at 3pm to send the invoice').due === L(2026, 10, 9, 15));
ok('on 12 oct at 9am', P('remind me on 12 oct at 9am to renew domain').due === L(2026, 10, 12, 9));
ok('15/10 is DD/MM (Nigeria), 9am default', P('remind me to submit form on 15/10').due === L(2026, 10, 15, 9));
ok('"at 9" with no am/pm at 6:50pm -> 9pm', P('remind me at 9 to read').due === L(2026, 10, 6, 21));
ok('tomorrow at 3 -> 3pm', P('remind me tomorrow at 3 to buy data').due === L(2026, 10, 7, 15));
ok('tonight -> 9pm', P('remind me tonight to charge my phone').due === L(2026, 10, 6, 21));
ok('24h clock 17:30 (past) -> tomorrow', P('remind me 17:30 to leave').due === L(2026, 10, 7, 17, 30));
ok('no time -> Gemini fallback flagged', P('remind me after church to call pastor').ai === true);
ok('no task -> asks what', P('remind me in an hour').ask?.includes('What should I remind you about'));
ok('not a reminder -> null', P('what is the capital of Ghana?') === null && P('teach: remind me is my catchphrase') === null);
ok('fmtWhen in Lagos time', v.fmtWhen(L(2026, 10, 7, 17), NOW) === 'tomorrow at 5:00pm' && v.fmtWhen(L(2026, 10, 9, 15), NOW) === 'Fri 9 Oct at 3:00pm');
ok('nextOccurrence daily rolls over midnight Lagos', v.nextOccurrence({ type: 'daily', h: 6, mi: 0 }, L(2026, 10, 7, 6)) === L(2026, 10, 8, 6));
{ const a = v.parseAIReminder('{"when":"2026-10-11T13:00","repeat":null,"task":"call pastor"}', NOW); ok('AI JSON parsed as Lagos time', a.due === L(2026, 10, 11, 13) && a.text === 'call pastor'); }

// ---- 2. store / list / cancel through the bot (sandbox) ----
await m.saveKB(OWNER, { facts: [], settings: {} }, ctx()); await m.saveState(OWNER, { history: [] }, ctx());
let x = await say('/new');
rpc.length = 0;
x = await say('remind me in 2 hours to check the oven');
ok('reminder confirmed', x.sent.at(-1).startsWith("⏰ Done! I'll remind you *today at") && x.sent.at(-1).includes('_check the oven_'));
ok('scheduler gate armed (test row) with the due time', rpc.length >= 1 && rpc.at(-1).p_name === 'test' && rpc.at(-1).p_key === process.env.SCHED_KEY && Math.abs(Date.parse(rpc.at(-1).p_due) - (Date.now() + 2 * 3600e3)) < 120e3);
x = await say("every day at 6am remind me to post today's verse");
ok('daily reminder confirmed with 24h-window note', x.sent.at(-1).includes('every day at 6:00am') && x.sent.at(-1).includes('24h'));
aiWhen = new Date(Date.now() + 3 * 864e5 + 3600e3).toISOString().slice(0, 16);   // (UTC iso read as Lagos: fine, it's in the future)
calls.length = 0;
x = await say('remind me after church to call pastor');
ok('Gemini fallback used only when rules fail (Lite first)', calls.length === 1 && calls[0].model === m.LITE_FIRST[0] && x.sent.at(-1).includes('call pastor'));
x = await say('reminders');
ok('list shows 3 in time order', /1\. (?:today|tomorrow) at .*check the oven/.test(x.sent.at(-1)) && /2\. every day at 6:00am \(next: (?:today|tomorrow) at 6:00am\): post today's verse/.test(x.sent.at(-1)) && x.sent.at(-1).includes('3. ') && x.sent.at(-1).includes('call pastor'));
x = await say('cancel reminder 3');
ok('cancel reminder 3', x.sent.at(-1).includes('Cancelled: _call pastor_'));
x = await say('cancel reminder 9');
ok('cancel out of range', x.sent.at(-1).includes("no reminder number 9"));
x = await say('reminders');
ok('list now has 2', x.sent.at(-1).includes('2. every day') && !x.sent.at(-1).includes('call pastor'));

// ---- 3. scheduler endpoint fires a due reminder (sandbox, nothing sent) ----
{ const kb = await m.loadKB(OWNER, ctx()); const r = kb.reminders.find(r => r.text === 'check the oven'); r.due = Date.now() - 90e3; await m.saveKB(OWNER, kb, ctx()); }
rpc.length = 0;
let res = await cron.GET(new Request('http://x/api/cron?task=reminders', { headers: { 'x-test-key': process.env.WA_TEST_KEY } }));
let j = await res.json();
ok('cron task=reminders (test key) fires the due one', res.status === 200 && j.sandbox === true && j.sent.length === 1 && j.outbox[0].startsWith('⏰ *Reminder:* check the oven'));
ok('gate re-armed for the next one (daily 6am)', rpc.length === 1 && rpc[0].p_name === 'test' && new Date(rpc[0].p_due).getUTCHours() === 5);
{ const kb = await m.loadKB(OWNER, ctx()); const r = kb.reminders.find(r => r.text === 'check the oven'); ok('one-off marked done with its WhatsApp id', r.status === 'done' && /^wamid\.TEST/.test(r.waId)); }
res = await cron.GET(new Request('http://x/api/cron?task=reminders', { headers: { 'x-test-key': process.env.WA_TEST_KEY } })); j = await res.json();
ok('second run sends nothing (no double send)', j.sent.length === 0);

// ---- 4. auth on the scheduler endpoint ----
res = await cron.POST(new Request('http://x/api/cron?task=reminders&sandbox=1', { method: 'POST' }));
ok('no auth -> 401', res.status === 401);
res = await cron.POST(new Request('http://x/api/cron?task=reminders&sandbox=1', { method: 'POST', headers: { authorization: 'Bearer wrong-wrong-wrong-wrong' } }));
ok('wrong key -> 401', res.status === 401);
res = await cron.POST(new Request('http://x/api/cron?task=reminders&sandbox=1', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.SCHED_KEY } }));
ok('SCHED_KEY (what pg_cron sends) -> 200 in sandbox', res.status === 200 && (await res.json()).sandbox === true);
res = await cron.GET(new Request('http://x/api/cron', { headers: { authorization: 'Bearer ' + process.env.SCHED_KEY } }));
ok('SCHED_KEY cannot run the morning nudge (CRON_SECRET only)', res.status === 401);

// ---- 5. 24h window: closed -> missed, told next time he writes; failed-status webhook ----
{ const st = await m.loadState(OWNER, ctx()); st.lastIn = Date.now() - 30 * 3600e3; st.history = st.history.map(h => ({ ...h, at: Date.now() - 30 * 3600e3 })); await m.saveState(OWNER, st, ctx());
  const kb = await m.loadKB(OWNER, ctx()); const r = kb.reminders.find(r => r.rep); r.due = Date.now() - 60e3; await m.saveKB(OWNER, kb, ctx()); }
res = await cron.GET(new Request('http://x/api/cron?task=reminders', { headers: { 'x-test-key': process.env.WA_TEST_KEY } })); j = await res.json();
ok('window closed -> not sent, recorded as missed', j.sent.length === 0 && j.missed.length === 1 && j.outbox.length === 0);
{ const kb = await m.loadKB(OWNER, ctx()); const r = kb.reminders.find(r => r.rep); ok('daily one moved to the next 6am', r.status === 'active' && r.due > Date.now() && new Date(r.due).getUTCHours() === 5); }
x = await say('good morning');
ok('next message starts with "⏰ missed while the chat was asleep"', x.sent[0].startsWith('⏰ *Missed while the chat was asleep:*') && x.sent[0].includes("post today's verse") && x.sent.length === 2);
x = await say('reminders');
ok('list notes the missed one', x.sent.at(-1).includes('Missed while the chat was asleep') && x.sent.at(-1).includes("post today's verse"));
x = await say('hello again');
ok('missed notice only once', !x.sent.some(s => s.includes('Missed while')));
// Meta's later "failed" status (131047) for a reminder that had been sent
{ const kb = await m.loadKB(OWNER, ctx()); kb.reminders.push({ id: 99, text: 'pay the hosting bill', due: Date.now() - 60e3, lastDue: Date.now() - 60e3, status: 'done', waId: 'wamid.FAIL1' }); await m.saveKB(OWNER, kb, ctx()); }
res = await m.POST(new Request('http://x/api/whatsapp', { method: 'POST', headers: { 'x-test-key': process.env.WA_TEST_KEY }, body: JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.FAIL1', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] }, { id: 'wamid.X', status: 'read' }] } }] }] }) }));
j = await res.json();
ok('failed status 131047 -> reminder noted as missed (read receipts ignored)', j.results.length === 1 && j.results[0].missed === 99 && j.results[0].code === 131047);
x = await say('hi');
ok('…and he hears about it next time', x.sent[0].includes('pay the hosting bill'));
// keeper heads-up an hour before the window closes, when a reminder falls in the next day
{ const kb = { reminders: [{ id: 1, text: 'x', due: Date.now() + 10 * 3600e3, status: 'active' }] }; const lastIn = Date.now() - 23 * 3600e3;
  ok('keeper time = last message + 23h when a reminder falls after the window', v.keeperTime(kb, lastIn, null) === lastIn + 23 * 3600e3 && v.keeperTime(kb, lastIn, lastIn) === null && v.nextWake(kb, lastIn, null) === lastIn + 23 * 3600e3); }

// ---- 6. web search with sources (REAL keyless search; Gemini mocked) ----
ok('detectSearch explicit', v.detectSearch('search: naira to dollar rate today')?.explicit === true);
ok('detectSearch natural fresh questions', ['what is the dollar rate today?', "what's the latest news in Nigeria?", 'who won the match yesterday?', 'weather in Akure tomorrow?'].every(t => v.detectSearch(t)));
ok('detectSearch leaves normal chat alone', ['what price should I sell my ebook?', 'write a post for today', 'how do I grow my channel?', 'what is grace?', 'post: latest news about my book'].every(t => !v.detectSearch(t)));
calls.length = 0;
x = await say('search: Nigeria naira exchange rate news');
const out = x.sent.at(-1);
console.log('   search reply:\n' + out.split('\n').map(l => '     ' + l).join('\n'));
ok('search answer + Sources with real links', out.startsWith('🌍 ') && out.includes('*Sources:*') && /\n1\. .+\nhttps?:\/\//.test(out) && /\n2\. .+\nhttps?:\/\//.test(out));
ok('citations renumbered to the Sources list', out.includes('[1]') && out.includes('[2]') && !out.includes('[3]'));
ok('search used Lite first with a short system prompt (no full profile)', calls.at(-1).model === m.LITE_FIRST[0] && !calls.at(-1).sys.includes('BASE PROFILE'));
calls.length = 0;
x = await say('search: Nigeria naira exchange rate news');
ok('same search within 30 min -> cached, no quota', calls.length === 0 && x.sent.at(-1) === out);

// ---- 7. model rotation ----
mode = 'smart429'; calls.length = 0;
x = await say('Write a short plan to grow my WhatsApp channel this week');
ok('hard ask starts on Flash; on 429 rotates to the next model', calls[0].model === m.CHAIN[0] && x.sent.at(-1).startsWith('answer from ') && !x.sent.at(-1).includes('gemini-3.6-flash'));
const firstOk = x.sent.at(-1).replace('answer from ', '');
ok('…skipping every 429 smart model to Lite', firstOk === 'gemini-flash-lite-latest');
calls.length = 0;
x = await say('Write another plan, for Facebook');
ok('parked Flash models are skipped next time (no wasted call)', calls[0].model === 'gemini-flash-lite-latest');
mode = 'lite503'; calls.length = 0;
x = await say('what is the capital of Ghana');
ok('easy ask: Lite busy (503) -> Gemma answers', x.sent.at(-1) === 'answer from gemma-4-26b-a4b-it' && calls.some(c => c.model.includes('lite')));
ok('Gemma asked with thinkingLevel minimal; thought parts dropped', calls.find(c => c.model.startsWith('gemma')).thinking?.thinkingLevel === 'minimal');
mode = 'allbutgemma'; calls.length = 0;
x = await say('one more quick one');
ok('everything Gemini parked -> still answers (Gemma)', x.sent.at(-1).startsWith('answer from gemma'));
mode = 'ok';
calls.length = 0;
x = await say('one more quick one');
ok('identical question within 3 min -> cached reply, no model call', calls.length === 0 && x.sent.at(-1).startsWith('answer from gemma'));

// ---- 8. lean prompt + relevant facts ----
{ const many = Array.from({ length: 84 }, (_, i) => ({ t: `fact ${i} about ${i === 40 ? 'selar pricing in naira for ebooks' : 'something else entirely number ' + i} ` + 'x'.repeat(200) }));
  const r = v.relevantFacts(many, 'how should I price my ebook on Selar?');
  ok('relevantFacts keeps the matching fact + newest, drops the rest', r.facts.some(f => f.t.includes('selar pricing')) && r.facts.includes(many[83]) && r.omitted > 50);
  const lean = m.systemText(many, { lean: true, query: 'how should I price my ebook on Selar?' });
  const full = m.systemText(many);
  ok(`lean prompt much smaller (${lean.length} vs ${full.length} chars)`, lean.length < full.length * 0.6 && lean.includes('BASE PROFILE') && !lean.includes('Examples of his voice'));
  ok('writing asks keep the full voice pack', m.systemText(many, { lean: true, query: 'write a caption for my post' }).includes('Examples of his voice')); }

// ---- 9. usage ----
x = await say('usage');
const us = x.sent.at(-1);
console.log('   usage reply:\n' + us.split('\n').map(l => '     ' + l).join('\n'));
ok('usage shows per-model counts, limits hit and features', us.includes("Today's usage") && /gemma-4-26b-a4b: \d/.test(us) && us.includes('quota hit after') && /Web searches: 1\/30/.test(us) && us.includes('Reminders sent: 1') && /Answered from memory.*: 2/.test(us));
x = await say('/help');
ok('/help short and lists reminders + search + usage', x.sent.length === 1 && x.sent[0].length < 1100 && x.sent[0].includes('remind me at 5pm') && x.sent[0].includes('search:') && x.sent[0].includes('usage'));
{ const res2 = await m.GET(new Request('http://x/api/whatsapp?health=1')); const h = await res2.json();
  ok('health: build v5, reminders + scheduler named, search method, model rotation', /^v5(\.\d+)?$|^v[6-9]/.test(h.build) && h.reminders === true && /pg_cron/.test(h.scheduler) && /duckduckgo/.test(h.search) && h.models.hard[0] === m.CHAIN[0] && h.models.easy.includes('gemma-4-26b-a4b-it')); }

console.log(`\n${pass} checks passed`);
const { cleanTest } = await import('./t_store.mjs');
console.log(`cleaned ${await cleanTest()} test records`);
