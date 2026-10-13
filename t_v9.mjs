// v9 tests: contacts (paste/vcf/csv), daily outreach drafts + owner approval (send all / send 1 3 / edit / skip / redo),
// 24h window vs template, template not approved -> held, failures explained, STOP opt-out, 14-day cooldown, selective auto-reply
// (only / except / unknown hold|silent|answer), owner notices + queue when his window is shut, evening digest, goals, growth nudge,
// minute tick (claims the day once), voice note -> transcript + send-ready text + follow-ups, work-ethic prompt. All mocked.
import assert from 'node:assert/strict';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092';
delete process.env.WA_WABA_ID;
process.env.WA_TOKEN = 'test-token'; process.env.WA_PHONE_ID = 'PHONE';
process.env.SCHED_KEY = 'k'; process.env.SB_URL = 'https://x.supabase.co'; process.env.SB_ANON_KEY = 'a';   // store on: J.setMock keeps it in memory
let n = 0;
const ok = (name, cond) => { if (!cond) console.log('LAST:', JSON.stringify(globalThis.__last || null).slice(0, 2500)); assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092';
const calls = []; let voiceText = ''; let draftFail = false; let contactFail = false;
const realFetch = globalThis.fetch;
const okr = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] }), { status: 200 });
globalThis.fetch = async (u, o = {}) => {
  const s = String(u);
  if (s.includes('generativelanguage')) {
    const body = JSON.parse(o.body); const user = body.contents.at(-1).parts.map(p => p.text || '[media]').join('\n');
    const sys = body.systemInstruction?.parts?.[0]?.text || '';
    calls.push({ user, sys });
    if (user.includes('Michael sent this voice note')) return okr(voiceText);
    const m = user.match(/Output ONLY a JSON array of (\d+) strings/);
    if (m) { if (draftFail) return new Response('{"error":{"code":503}}', { status: 503 }); return okr(JSON.stringify(Array.from({ length: +m[1] }, (_, i) => `Draft body ${i + 1} about ${user.includes('web design') ? 'web design' : 'checking in'}\nline two`))); }
    if (sys.startsWith("You are Michael's assistant")) { if (contactFail) return new Response('{"error":{"code":503}}', { status: 503 }); return okr('Hi! I\'m Michael\'s AI assistant. His websites start at ₦60k.'); }
    if (user.includes("Michael's business coach")) return okr('1. Message 10 shops\n2. Post 3 times\n3. Follow up leads\nMy pick: 3');
    if (user.includes('WhatsApp Status')) return okr('Short status line ✨');
    if (user.includes('noticeably shorter')) return okr('Shorter version.');
    if (user.includes('addressed to')) return okr('Hi Tolu, polished for Tolu.');
    if (user.includes('send-ready')) return okr('Polished again.');
    return okr('chat answer');
  }
  if (/graph\.facebook\.com\/v[\d.]+\/VOICE\d+$/.test(s)) return Response.json({ url: 'https://media.test/x', mime_type: 'audio/ogg' });
  if (s.startsWith('https://media.test/')) return new Response(new Uint8Array([79, 103, 103, 83]), { status: 200 });
  if (s.includes('/rpc/michael_ai_set_next') || s.includes('/rpc/michael_ai_newsletter')) return new Response('null', { status: 200 });
  throw new Error('unexpected network call in a test: ' + s);
};
const J = await import('./api/_jobs.js'); J.setMock((op) => (op === 'usage_get' || op === 'undelivered' || op === 'list' || op === 'site_list') ? [] : (op === 'open_count' || op === 'count_today') ? 0 : null);
const BR = await import('./api/_brain.js'); BR.setMock(() => null);
const V9 = await import('./api/_v9.js');
const m = await import('./api/whatsapp.js');
const jobs = await import('./api/jobs.js');
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
const tpls = c => c.outbox.filter(b => b.type === 'template');
let mid = 0;
const say = async (text, from = OWNER, c = ctx(), name = 'T') => { const r = await m.processMessage({ from, id: 'wamid.v9_' + (mid++), type: 'text', text: { body: text } }, name, c); globalThis.__last = texts(c); return { r, c, sent: texts(c), last: texts(c).at(-1) || '' }; };
const kv = async k => J.rpc('kv_get', { k: `wa-test/v9/${k}.json` });
const kvput = async (k, v) => J.rpc('kv_put', { k: `wa-test/v9/${k}.json`, v });

// ===== 1. parsing =====
ok('normNum: 0803… -> 234803…', V9.normNum('0803 123 4567') === '2348031234567');
ok('normNum: +234 (0) … and 10-digit', V9.normNum('+234 0805 000 1111') === '2348050001111' && V9.normNum('8031234567') === '2348031234567');
ok('normNum: foreign + kept, junk null', V9.normNum('+44 7700 900123') === '447700900123' && V9.normNum('12345') === null);
let pl = V9.parseList('Tolu 0803 123 4567\nAda - +234 805 000 1111\n0806 222 3333, 0807 444 5555');
ok('parseList: names + numbers, several per line', pl.length === 4 && pl[0].name === 'Tolu' && pl[1].name === 'Ada' && pl[1].n === '2348050001111');
const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bayo Ade\r\nTEL;TYPE=HOME:01 234 5678\r\nTEL;TYPE=CELL:0809 111 2222\r\nEND:VCARD\r\nBEGIN:VCARD\r\nN:Okon;Grace;;;\r\nitem1.TEL:+2348093334444\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:No Phone\r\nEND:VCARD';
let pv = V9.parseVcf(vcf);
ok('parseVcf: FN, N fallback, mobile preferred, no-phone skipped', pv.length === 2 && pv[0].name === 'Bayo Ade' && pv[0].n === '2348091112222' && pv[1].name === 'Grace Okon');
let pc = V9.parseCsv('Name,Phone\nChidi,08031110000\n"Ngozi",+2348032220000\n');
ok('parseCsv: header columns', pc.length === 2 && pc[0].name === 'Chidi' && pc[1].n === '2348032220000');
ok('parseTime: 9am / 6:30pm / 18:30 / bad', V9.parseTime('9am') === '09:00' && V9.parseTime('6:30pm') === '18:30' && V9.parseTime('18:30') === '18:30' && V9.parseTime('25') === null);

// ===== 2. contacts commands =====
let x = await say('contacts');
ok('contacts: empty list explains how to add', /empty/i.test(x.last) && /\.vcf/.test(x.last));
x = await say('contacts add');
ok('contacts add alone: instructions', /one per line/.test(x.last));
x = await say('contacts add clients: Tolu 0803 123 4567\nAda +234 805 000 1111\nMe 08148034092');
ok('contacts add with label: 2 added, owner skipped', /Added 2/.test(x.last) && /clients/.test(x.last));
let cs = await kv('contacts');
ok('stored in kv with label + src owner', cs.length === 2 && cs.every(c => c.label === 'clients' && c.src === 'owner'));
x = await say('contacts add Tolu 08031234567, 0806 222 3333');
ok('duplicate counted, new one added', /Added 1 \(1 already there\)/.test(x.last));
// a .vcf document
let c1 = ctx();
await m.processMessage({ from: OWNER, id: 'wamid.v9_doc1', type: 'document', document: { id: 'D1', filename: 'contacts.vcf', mime_type: 'text/vcard', _test_b64: Buffer.from(vcf).toString('base64') } }, 'T', c1);
ok('.vcf document -> 2 contacts added', /Read 2 contacts/.test(texts(c1).at(-1)) && /added 2/.test(texts(c1).at(-1)));
c1 = ctx();
await m.processMessage({ from: OWNER, id: 'wamid.v9_doc2', type: 'document', document: { id: 'D2', filename: 'list.csv', mime_type: 'text/csv', caption: 'friends', _test_b64: Buffer.from('Name,Phone\nChidi,08031110000\n').toString('base64') } }, 'T', c1);
ok('.csv document with caption label', /added 1/.test(texts(c1).at(-1)) && /friends/.test(texts(c1).at(-1)));
x = await say('contacts');
ok('contacts list shows 6 numbered', /Contacts\* \(6/.test(x.last) && /1\. Tolu/.test(x.last));
x = await say('contacts remove 6');
ok('contacts remove by index', /Removed Chidi/.test(x.last) && (await kv('contacts')).length === 5);
x = await say('contact my pastor tomorrow about the site');
ok('normal chat starting with "contact" is not hijacked', x.last === 'chat answer');

// ===== 3. outreach settings =====
x = await say('outreach time 7:30pm');
ok('outreach time saved', /19:30/.test(x.last) && (await kv('cfg')).outreach.time === '19:30');
x = await say('outreach goal promote my web design: ₦60k/₦120k/₦200k+ olaoluwa-studio.vercel.app');
ok('outreach goal saved', /web design/.test((await kv('cfg')).outreach.goal));
x = await say('outreach');
ok('outreach status: on, time, goal, list size, template', /ON/.test(x.last) && /19:30/.test(x.last) && /5 people, 5 ready/.test(x.last) && /Template/.test(x.last));

// ===== 4. a batch: drafts to owner only =====
// make one contact "in window" (wrote recently)
cs = await kv('contacts'); cs.find(c => c.name === 'Ada').lastIn = Date.now() - 3600e3; await kvput('contacts', cs);
x = await say('outreach now');
const b1 = await kv('batch');
{ const a = b1.items.find(d => d.name === 'Ada'), f = b1.items[0]; if (a && a !== f) { for (const k of ['n', 'name', 'first']) [a[k], f[k]] = [f[k], a[k]]; } await kvput('batch', b1); }   // make draft 1 the in-window one
ok('outreach now: 5 drafts, sent only to owner', b1.items.length === 5 && x.c.outbox.filter(o => o.to).every(o => o.to === OWNER) && /Today's outreach/.test(x.last));
ok('drafts use the goal and are single-line bodies', b1.items.every(d => /web design/.test(d.body) && !/\n/.test(d.body)));
ok('draft shows the greeting, numbering and approval help', /\*1\. /.test(x.last) && /it's Michael 👋/.test(x.last) && /send all/.test(x.last) && /Nothing goes out until you say so/.test(x.last));
ok('in-window contact marked 💬, others template', /Ada.*💬/.test(x.last) && /📨 template/.test(x.last));
x = await say('edit 2: Quick one: are you still selling shoes?');
ok('edit 2 replaces the body', /Draft 2 now reads/.test(x.last) && (await kv('batch')).items[1].body.startsWith('Quick one'));
const bodyBefore = (await kv('batch')).items[2].body;
x = await say('redo 3');
ok('redo 3 rewrites via AI', /Draft 3 now reads/.test(x.last) && calls.at(-1).user.includes('clearly different'));
x = await say('skip 4');
ok('skip 4', /Skipped 4/.test(x.last) && (await kv('batch')).items[3].status === 'skipped');
let c2 = ctx();
x = await say('send 1 2', OWNER, c2);
let bb = await kv('batch');
ok('send 1 2: only those two went out', bb.items[0].status === 'sent' && bb.items[1].status === 'sent' && bb.items[2].status === 'draft');
const sentTo = c2.outbox.filter(o => o.to && o.to !== OWNER);
ok('free-form for the in-window contact, template for the other', sentTo.length === 2 && sentTo.some(o => o.type === 'text') && sentTo.some(o => o.type === 'template'));
const tp = tpls(c2)[0];
ok('template call: name, lang, 2 params, no newlines', tp.template.name === 'michael_checkin_v1' && tp.template.language.code === 'en' && tp.template.components[0].parameters.length === 2 && !/\n/.test(tp.template.components[0].parameters[1].text));
ok('owner told what went', /Sent 2/.test(x.last));
cs = await kv('contacts');
ok('lastOut stamped on the two', cs.filter(c => c.lastOut).length === 2);
x = await say('send 1');
ok('sending again: already sent, no duplicate', /already sent/.test(x.last));
// template not approved -> held
const cfg = await kv('cfg'); cfg.tpl = { status: 'PENDING', at: Date.now() }; await kvput('cfg', cfg);
c2 = ctx();
x = await say('send all', OWNER, c2);
ok('template pending: out-of-window drafts held, nothing sent to them', /Held/.test(x.last) && /pending/.test(x.last) && c2.outbox.filter(o => o.to && o.to !== OWNER).length === 0);
ok('batch keeps held items open', (await kv('batch')).status === 'open');
// approve the template and fail one send
cfg.tpl = { status: 'APPROVED', at: Date.now() }; await kvput('cfg', cfg);
c2 = ctx({ failNext: null });
const origSend = c2.outbox.push.bind(c2.outbox);
let k = 0; c2.outbox.push = (b) => { origSend(b); if (b.type === 'template' && ++k === 1) throw Object.assign(new Error('x'), {}); return c2.outbox.length; };
// simpler: use a real failure via sendOne directly
const fail = await V9.sendOne({ n: '2348000009999', first: 'X', body: 'b' }, { n: '2348000009999', lastIn: 0 }, cfg, { test: true, sendTemplate: async () => ({ ok: false, detail: '{"error":{"code":131030,"message":"Recipient phone number not in allowed list"}}' }) }, ctx());
ok('send failure carries detail', fail.ok === false && /131030/.test(fail.detail));
ok('whyFailed explains the test number in plain words', /test number/.test(V9.whyFailed(fail.detail)) && /24-hour/.test(V9.whyFailed('131047')));
c2 = ctx();
x = await say('send all', OWNER, c2);
ok('send all after approval: remaining two sent by template', /Sent 2/.test(x.last) && tpls(c2).length === 2 && (await kv('batch')).status === 'done');
x = await say('send all');
ok('no batch open -> honest line', /No drafts waiting/.test(x.last));

// ===== 5. status webhook failure for an outreach message =====
const lg = await kv('log'); const s0 = lg.sends.find(s => s.ok && s.id);
let c3 = ctx();
// owner window open (he messaged) so notice goes straight to him
const fr = await m.onFailedStatus({ id: s0.id, status: 'failed', errors: [{ code: 131030, title: 'Recipient not in allowed list' }] }, c3);
ok('late failure: marked, owner told in plain words', fr.outreach_failed === s0.n && /didn't arrive/.test(texts(c3).at(-1)) && /test number/.test(texts(c3).at(-1)));
ok('late failure: contact back in the pool (lastOut cleared)', (await kv('contacts')).find(c => c.n === s0.n).lastOut === 0);

// ===== 6. cooldown + pick =====
const now = Date.now();
const pool = [{ n: '1', lastOut: now - 3 * 864e5 }, { n: '2', lastOut: now - 20 * 864e5 }, { n: '3', optOut: true }, { n: OWNER }, { n: '4' }];
ok('eligible: skips 14-day cooldown, opted out, owner', JSON.stringify(V9.eligible(pool, OWNER, now).map(c => c.n)) === '["2","4"]');
ok('pick: at most 5, no repeats', (() => { const a = V9.pick(Array.from({ length: 30 }, (_, i) => ({ n: String(i) }))); return a.length === 5 && new Set(a.map(c => c.n)).size === 5; })());
draftFail = true;
const fb = await V9.makeDrafts([{ n: '9', name: 'Kemi Ola' }], { outreach: { goal: 'promote my web design olaoluwa-studio.vercel.app' }, goals: [] }, { ask: async () => ({ ok: false }) });
ok('AI down: fallback draft still uses the goal + first name', fb[0].first === 'Kemi' && /olaoluwa-studio\.vercel\.app/.test(fb[0].body));
draftFail = false;

// ===== 7. other people: auto-reply =====
const TOLU = '2348031234567', STR = '2348099990000';
x = await say('autoreply');
ok('autoreply status: nobody yet, hold for others', /nobody yet/.test(x.last) && /polite/.test(x.last));
let c4 = ctx();
x = await say('Good evening, how much is a website?', STR, c4, 'Stranger Dan');
ok('unknown sender: polite holding reply', x.r.reply === V9.HOLD_TEXT && x.r.mode === 'hold');
ok('owner notified with reply / autoreply commands', c4.outbox.some(o => o.to === OWNER && /Stranger Dan/.test(o.text.body) && /reply 2348099990000:/.test(o.text.body)));
ok('unknown sender saved to contacts as dm', (await kv('contacts')).some(c => c.n === STR && c.src === 'dm' && c.name === 'Stranger Dan' && c.lastIn));
c4 = ctx();
x = await say('Hello??', STR, c4);
ok('second message within 24h: no second holding reply, no second notice (30 min)', !x.r.reply && c4.outbox.length === 0);
x = await say('autoreply only clients');
ok('autoreply only <label>', /clients/.test(x.last) && (await kv('cfg')).auto.only.includes('clients'));
c4 = ctx();
x = await say('Hi Michael, do you still build sites?', TOLU, c4);
ok('label match: AI answers as Michael\'s assistant', x.r.mode === 'ai' && /assistant/.test(x.r.reply) && c4.outbox[0].to === TOLU);
const csys = calls.at(-1).sys;
ok('contact prompt: assistant not Michael, privacy, no invented prices', /not Michael/.test(csys) && /PRIVACY/.test(csys) && /Never invent prices/.test(csys));
ok('contact prompt: no phone/email/money situation/to-dos from his profile', !/814 803|michaelolaoluwagab@|Zero budget|Open to-dos|Testers/i.test(csys) && /60k/.test(csys));
ok('businessFacts keeps prices/links, drops personal + secrets', JSON.stringify(V9.businessFacts(['my ebook costs ₦2,000', 'my wife is Ada', 'bank pin 1234', { t: 'logo ₦15k' }])) === '["my ebook costs ₦2,000","logo ₦15k"]');
x = await say('and the price for e-commerce?', TOLU, ctx());
ok('contact chat keeps its own history', calls.at(-1).user.includes('e-commerce') && (await kv('chat-' + TOLU)).h.length === 4);
contactFail = true;
c4 = ctx();
x = await say('hello again', TOLU, c4);
ok('AI down for a contact: holding reply, owner told', x.r.action === 'held (AI busy)');
contactFail = false;
x = await say('autoreply except 0803 123 4567');
c4 = ctx();
x = await say('another one', TOLU, c4);
ok('except beats only: silent, nothing sent to them', x.r.mode === 'silent' && !c4.outbox.some(o => o.to === TOLU));
x = await say('autoreply remove 2348031234567');
x = await say('autoreply unknown silent');
c4 = ctx();
x = await say('who is this', '2348077770000', c4);
ok('unknown silent: no reply to them', x.r.mode === 'silent' && !c4.outbox.some(o => o.to === '2348077770000'));
x = await say('autoreply all');
ok('autoreply all', (await kv('cfg')).auto.only.includes('*'));
c4 = ctx();
x = await say('price?', '2348066660000', c4);
ok('all: anyone gets the AI answer', x.r.mode === 'ai');
x = await say('autoreply off');
c4 = ctx();
x = await say('hey', '2348055550000', c4);
ok('off: falls back to the unknown mode (silent here)', x.r.mode === 'silent');
await say('autoreply on'); await say('autoreply none'); await say('autoreply unknown hold');
// STOP
c4 = ctx();
x = await say('STOP', '2348050001111', c4);
ok('STOP: opted out + confirmation', x.r.reply === V9.STOP_TEXT && (await kv('contacts')).find(c => c.n === '2348050001111').optOut === true);
ok('opted-out contact is never eligible', !V9.eligible(await kv('contacts'), OWNER).some(c => c.n === '2348050001111'));
// owner replies through the bot
c4 = ctx();
x = await say('reply 0809 999 0000: Thanks Dan, I\'ll call you by 5pm', OWNER, c4);
ok('reply <number>: <text> sends to them (window open)', /Sent to Stranger Dan/.test(x.last) && c4.outbox.some(o => o.to === STR && /call you by 5pm/.test(o.text.body)));
x = await say('reply 0803 000 0001: hello');
ok('reply outside 24h: refused with the reason', /24h/.test(x.last));
// digest
x = await say('digest');
ok('digest: replied + waiting + opted out', /Today's messages/.test(x.last) && /I replied to/.test(x.last) && /Waiting for you/.test(x.last) && /Opted out/.test(x.last));

// ===== 8. owner window shut -> queue -> flushed on his next message =====
const st = await m.loadState(OWNER, ctx()); st.lastIn = Date.now() - 30 * 3600e3; await m.saveState(OWNER, st, ctx());
c4 = ctx();
x = await say('Hello, I need a logo', '2348011112222', c4, 'Logo Lady');
ok('owner window shut: notice queued, not sent', !c4.outbox.some(o => o.to === OWNER) && (await kv('cfg')).queue.length >= 1);
c4 = ctx();
x = await say('hi', OWNER, c4);
ok('his next message: queued notice delivered first', /Logo Lady/.test(texts(c4)[0]) && (await kv('cfg')).queue.length === 0);

// ===== 9. minute tick =====
const D = m.v9Deps(ctx());
let cf = await kv('cfg'); cf.outreach.time = '00:00'; cf.outreach.lastRun = null; cf.lastDigest = V9.lagos().date; cf.lastNudge = V9.lagos().date; await kvput('cfg', cf);
let t1 = await V9.tick('wa-test', OWNER, D);
ok('tick: makes today\'s batch once and sends it to the owner', t1.outreach === 'sent' && t1.batch && D.ctx.outbox.some(o => o.to === OWNER && /Today's outreach/.test(o.text.body)));
let t2 = await V9.tick('wa-test', OWNER, D);
ok('tick again same day: idle (no second batch)', t2.idle === true);
cf = await kv('cfg'); cf.outreach.on = false; cf.outreach.lastRun = null; await kvput('cfg', cf);
ok('outreach off: tick idle', (await V9.tick('wa-test', OWNER, D)).idle === true);
const mon = Date.parse('2026-10-12T08:30:00Z');   // Monday 09:30 Lagos
cf = await kv('cfg'); cf.lastNudge = null; cf.lastDigest = '2026-10-12'; await kvput('cfg', cf);
let t3 = await V9.tick('wa-test', OWNER, D, { now: mon });
ok('Monday 08:00+: growth nudge with 3 moves', t3.growth && D.ctx.outbox.some(o => /This week's 3 moves/.test(o.text?.body || '')));
const gp = calls.find(c => c.user.includes("business coach"));
ok('growth prompt carries his goals', /new phone, new laptop/.test(gp.user));
const ev = Date.parse('2026-10-12T19:30:00Z');  // 20:30 Lagos
cf = await kv('cfg'); cf.lastDigest = null; await kvput('cfg', cf);
const lgx = await kv('log'); lgx.inbound.push({ n: STR, name: 'Stranger Dan', text: 'evening msg', action: 'holding reply', at: ev, day: '2026-10-12' }); await kvput('log', lgx);
let t4 = await V9.tick('wa-test', OWNER, D, { now: ev });
ok('20:00+: evening digest', t4.digest && D.ctx.outbox.some(o => /Today's messages/.test(o.text?.body || '')));
// sandbox endpoint
process.env.SCHED_KEY = process.env.SCHED_KEY || 'k'; process.env.SB_URL = process.env.SB_URL || 'https://x.supabase.co'; process.env.SB_ANON_KEY = process.env.SB_ANON_KEY || 'a';
const res = await jobs.POST(new Request('https://h/api/jobs?sandbox=1&v9=1&force=growth', { method: 'POST', headers: { 'x-test-key': process.env.WA_TEST_KEY } }));
const rj = await res.json();
ok('/api/jobs?v9=1 (test key): runs the tick in the sandbox', rj.ok && rj.growth && rj.outbox.some(t => /3 moves/.test(String(t))));

// ===== 10. goals =====
x = await say('goals');
ok('goals: shows defaults', /Your goals/.test(x.last) && /new house/.test(x.last));
x = await say('goals add 50 paying site clients by December');
ok('goals add', /50 paying site clients/.test(x.last));
x = await say('goals remove 1');
ok('goals remove', !/₦60k \/ ₦120k/.test(x.last.split('\n').slice(1, 6).join(' ')) || (await kv('cfg')).goals.length === 3);
x = await say('my goal is to sell more books');
ok('"my goal is…" chat not hijacked', x.last !== '' && !/Your goals/.test(x.last));

// ===== 11. work ethic prompt =====
await say('hello there');
const sys = calls.at(-1).sys;
ok('ethic block in every owner chat prompt', /HOW YOU WORK \(v9: work like Tab\)/.test(sys) && /Never claim something is done/.test(sys) && /BUSINESS GURU/.test(sys) && /my pick/.test(sys));
ok('ethic block carries his current goals', /50 paying site clients/.test(sys));
ok('HELP lists v9 commands', /outreach/.test(m.HELP) && /autoreply/.test(m.HELP) && /goals/.test(m.HELP));

// ===== 12. voice note -> transcript + send-ready =====
const voice = async (c = ctx()) => { await m.processMessage({ from: OWNER, id: 'wamid.v9_v' + (mid++), type: 'voice', voice: { id: 'VOICE1', mime_type: 'audio/ogg' } }, 'T', c); globalThis.__last = texts(c); return texts(c); };
voiceText = 'TRANSCRIPT: em so I want to to tell everyone that uh the site is ready\nKIND: DICTATION\nPOLISHED: I want to tell everyone that the site is ready.\nANSWER: NONE';
let vt = await voice();
ok('dictation: transcript message first', /^🎙️ _em so I want/.test(vt.at(-2)) && /Send-ready version below/.test(vt.at(-2)));
ok('dictation: polished text alone in its own (last) message', vt.at(-1) === 'I want to tell everyone that the site is ready.');
ok('voice prompt asks to keep his words', calls.findLast(c => c.user.includes('voice note')).user.includes('KEEP HIS OWN WORDS'));
x = await say('shorter');
ok('follow-up "shorter": new version alone', x.last === 'Shorter version.' && x.sent.at(-2) === '✍️ Here it is 👇');
x = await say('as a WhatsApp status');
ok('follow-up "as a status"', x.last === 'Short status line ✨');
x = await say('for Tolu');
ok('follow-up "for <name>"', x.last === 'Hi Tolu, polished for Tolu.');
// Michael's 06:18Z case: a rambling note that ends with an instruction -> follow it, his title, signed; unclear words flagged
voiceText = "TRANSCRIPT: em so you know, I was just thinking, the God that owns the cattle on a thousand hills, em, big man, she knew [unclear] ... write this into a detailed article and title it Just Me and My Thoughts\nKIND: DICTATION\nINSTRUCTION: article titled Just Me and My Thoughts\nPOLISHED: *Just Me and My Thoughts*\n\nI was just thinking: the God who owns the cattle on a thousand hills (Psalm 50:10). Big man, she knew.\n\n" + 'Paragraph. '.repeat(400) + "\n\n_Olaoluwa Michael_\nUNCLEAR: one word after \"she knew\"\nANSWER: NONE";
vt = await voice();
const hdr = vt.find(t => t.startsWith('🎙️'));
ok('instruction note: header says it followed the instruction', /Done as you asked \(article titled Just Me and My Thoughts\)/.test(hdr));
ok('instruction note: unclear words flagged, not guessed', /couldn't make out: _one word after "she knew"_/.test(hdr));
const art = vt.slice(vt.indexOf(hdr) + 1);
ok('article: title first, signed, split under 4096 per message', art[0].startsWith('*Just Me and My Thoughts*') && art.at(-1).includes('_Olaoluwa Michael_') && art.length >= 2 && art.every(t => t.length < 4096));
ok('voice note uses the strong tier with room for a long article', calls.findLast(c => c.user.includes('voice note')) && /INSTRUCTION/.test(calls.findLast(c => c.user.includes('voice note')).user));
voiceText = 'TRANSCRIPT: what time is it in London\nKIND: ASK\nPOLISHED: NONE\nANSWER: It\'s 7pm in London.';
vt = await voice();
ok('ask: one message with transcript + answer', vt.length >= 1 && /^🎙️ _what time/.test(vt.at(-1)) && /7pm in London/.test(vt.at(-1)));
x = await say('polish');
ok('"polish" after an ask voice note polishes the transcript', x.last === 'Polished again.');
voiceText = 'TEACH: my ebook costs ₦2,000';
vt = await voice();
ok('voice teach still works', /I'll remember/.test(vt.at(-1)));
voiceText = '🎙️ _old style line_\nold style answer';
vt = await voice();
ok('old-format answer still passes through', /old style answer/.test(vt.at(-1)));

// ===== 13. scheduling on the existing gate =====
const base = { ...V9.defaultCfg() };
const t0 = Date.parse('2026-10-09T06:00:00Z');   // Fri 07:00 Lagos
ok('nextDue: today 09:00 outreach first', V9.nextDueOf(base, t0) === Date.parse('2026-10-09T08:00:00Z'));
ok('nextDue: after outreach ran -> 20:00 digest', V9.nextDueOf({ ...base, outreach: { ...base.outreach, lastRun: '2026-10-09' } }, t0) === Date.parse('2026-10-09T19:00:00Z'));
ok('nextDue: Monday 08:00 nudge before 09:00 outreach', V9.nextDueOf(base, Date.parse('2026-10-12T05:00:00Z')) === Date.parse('2026-10-12T07:00:00Z'));
ok('nextDue: missed time -> soon, not tomorrow', V9.nextDueOf(base, Date.parse('2026-10-09T10:00:00Z')) - Date.parse('2026-10-09T10:00:00Z') <= 60e3);
cf = await kv('cfg'); cf.outreach.on = true; cf.outreach.time = '00:00'; cf.outreach.lastRun = null; await kvput('cfg', cf);
const rr = await m.runReminders(ctx());
ok('the reminders gate run also runs the v9 tick', rr.v9 && rr.v9.batch);

// ===== 14. health =====
const h = await (await m.GET(new Request('https://h/api/whatsapp?health=1'))).json();
ok('health: build v9.x with v9 block', /^v9\.\d+$/.test(h.build) && h.v9.outreach && h.v9.template === 'michael_checkin_v1');

globalThis.fetch = realFetch;
console.log(`\n${n} checks passed`);
