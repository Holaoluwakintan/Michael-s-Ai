// v9.8.0 tests: Royal People Care daily drop (api/_rpc.js, api/_rpcclean.js, api/_rpcplan.js) + wiring (gate, cron task=rpc,
// royals commands, health). All mocked: no network except the fake fetch below.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092';
delete process.env.WA_WABA_ID; delete process.env.RPC_DROP; delete process.env.RPC_KEEPER; delete process.env.RPC_TEMPLATE;
process.env.WA_TOKEN = 'test-token'; process.env.WA_PHONE_ID = 'PHONE';
process.env.SCHED_KEY = 'k'; process.env.SB_URL = 'https://x.supabase.co'; process.env.SB_ANON_KEY = 'a';
let n = 0;
const ok = (name, cond) => { if (!cond) console.log('LAST:', JSON.stringify(globalThis.__last || null).slice(0, 3000)); assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092';
const fetched = [], wakes = [];
globalThis.fetch = async (u, o = {}) => {
  const s = String(u);
  if (s.startsWith('https://rpc-media.vercel.app/')) { fetched.push(s); if (globalThis.__mediaDown) return new Response('no', { status: 503 }); return new Response(Buffer.from('fakebytes'), { status: 200 }); }
  if (s.includes('/rpc/michael_ai_set_next')) { wakes.push(JSON.parse(o.body)); return new Response('null', { status: 200 }); }
  if (s.includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'chat answer' }] }, finishReason: 'STOP' }] }), { status: 200 });
  if (s.includes('/rpc/michael_ai_newsletter')) return new Response('null', { status: 200 });
  throw new Error('unexpected network call in a test: ' + s);
};
const J = await import('./api/_jobs.js'); J.setMock((op) => (op === 'usage_get' || op === 'undelivered' || op === 'list' || op === 'site_list') ? [] : (op === 'open_count' || op === 'count_today') ? 0 : null);
const BR = await import('./api/_brain.js'); BR.setMock((op) => op === 'match' ? [] : null);
const NL = await import('./api/_newsletter.js');
const daily = new Map();
NL.setMock((op, a) => {
  const k = `${a.ns}|${a.kind}|${a.day}`;
  if (op === 'daily_claim') { if (daily.has(k)) return false; daily.set(k, { how: a.how }); return true; }
  if (op === 'daily_mark') { daily.set(k, { how: a.how, detail: a.detail }); return null; }
  if (op === 'daily_get') return daily.get(k) || null;
  return null;
});
const RPC = await import('./api/_rpc.js');
const { cleanCaption, AI_LINE } = await import('./api/_rpcclean.js');
const P = RPC.plan();
const m = await import('./api/whatsapp.js');
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/rpc-raw.json', import.meta.url), 'utf8'));
const Z = iso => Date.parse(iso);

// ======================= 1. caption cleaning =======================
// the Oct 24 reel exactly as it was delivered by hand (Tab, 24 Oct 14:46Z)
const REEL18 = fs.readFileSync(new URL('./fixtures/rpc-018-caption.txt', import.meta.url), 'utf8');
const DELIVERED18 = fs.readFileSync(new URL('./fixtures/rpc-018-delivered.txt', import.meta.url), 'utf8').replace(/\n$/, '');
ok('Oct 24 reel caption cleans to exactly what was delivered by hand', cleanCaption(REEL18, 'reel') === DELIVERED18);
for (const p of raw) {
  const c = cleanCaption(p.raw, p.kind);
  if (/3-A-DAY PLAN|FLAGS|Alt text|ALT TEXT|Audience:|AUDIENCE \/|CAPTION \(ready|^POST \d{3}/m.test(c) || /\n---/.test(c)) ok('clean: no planning text left in post ' + p.n, false);
  // every line kept is a line of the original (nothing reworded), except the added AI line
  const orig = new Set(p.raw.replace(/\r/g, '').split('\n').map(l => l.trimEnd()));
  if (!c.split('\n').every(l => l === '' || l === AI_LINE || orig.has(l))) ok('clean: wording unchanged in post ' + p.n, false);
  if (p.kind === 'reel' && !c.includes(AI_LINE)) ok('reel has the AI line ' + p.n, false);
}
ok('86 posts cleaned: no planning text, every line from the source, reels carry the AI line', raw.length === 86);
{ const c = cleanCaption(raw.find(p => p.n === '022').raw, 'reel'); const ls = c.split('\n'); const h = ls.findIndex(l => l.startsWith('#'));
  ok('AI line added on its own line right before the hashtags', ls[h - 2] === AI_LINE && ls[h - 1] === '' && !c.includes('Alt text') && c.startsWith('Living alone')); }
{ const c = cleanCaption('3-A-DAY PLAN: post 1\n\nHello\n\n#a #b\n\n---\nFLAGS: x', 'feed'); ok('feed: plan line + everything from --- dropped', c === 'Hello\n\n#a #b'); }
{ const c = cleanCaption('POST 057: Friday · NEW\n\nHi\n#x\n---\nAlt text: y', 'feed'); ok('feed: "POST NNN:" header (Nov 6+ files) dropped', c === 'Hi\n#x'); }
{ const c = cleanCaption('3-A-DAY PLAN: x\n\nCAPTION (ready to paste)\nWatch this\n\nVideo created with AI tools.\n\n#r\n\nAlt text: z\nFLAGS', 'reel'); ok('reel already carrying the AI line: not doubled', c === 'Watch this\n\nVideo created with AI tools.\n\n#r'); }
{ const c = cleanCaption(raw.find(p => p.n === '019').raw, 'story'); ok('story: plan line + FLAGS paragraph dropped, frame notes kept', !/FLAGS|3-A-DAY/.test(c) && c.includes('FRAME 3') && c.includes('Text to type')); }
ok('plan module = cleaned fixtures (rebuild with tools/rpc-build.mjs)', P.posts.every(p => p.caption === cleanCaption(raw.find(r => r.n === p.n).raw, p.kind)));
const payBad = P.posts.filter(p => /payment/i.test(p.caption) && !p.caption.includes('Contact us to discuss payment options and verify eligibility.'));
ok('every payment mention carries the exact payment line', payBad.length === 0);

// ======================= 2. the plan =======================
ok('plan: 86 posts, Sun Oct 25 -> Sat Nov 21, 28 days', P.posts.length === 86 && RPC.firstDate() === '2026-10-25' && RPC.lastDate() === '2026-11-21' && new Set(P.posts.map(p => p.date)).size === 28);
ok('every day has 3 timed posts (9 AM, 1 PM, 6:30 PM CT)', [...new Set(P.posts.map(p => p.date))].every(d => RPC.postsFor(d).filter(p => p.kind !== 'story').map(p => p.ct).join() === '9 AM,1 PM,6:30 PM'));
ok('Nigeria time CT+6 until Oct 31', RPC.postsFor('2026-10-31').filter(p => p.kind !== 'story').map(p => p.ng).join() === '3 PM,7 PM,12:30 AM');
ok('Nigeria time CT+7 from Nov 1', RPC.postsFor('2026-11-01').filter(p => p.kind !== 'story').map(p => p.ng).join() === '4 PM,8 PM,1:30 AM' && RPC.postsFor('2026-11-21').map(p => p.ng).join() === '4 PM,8 PM,1:30 AM');
ok('media: https rpc-media paths, jpg/mp4 only', P.base === 'https://rpc-media.vercel.app' && P.posts.every(p => p.media.length && p.media.every(x => /^p\/\d{3}\/(slide-\d\d|frame-\d|post)\.jpg$|^p\/\d{3}\/video\.mp4$/.test(x))));
ok('reels: 022 025 028 040, one video each', P.posts.filter(p => p.kind === 'reel').map(p => p.n).join() === '022,025,028,040' && P.posts.filter(p => p.kind === 'reel').every(p => p.media.length === 1));
{ const msgs = RPC.messagesFor('2026-10-25');
  const t = msgs.map(x => x.t === 'text' ? x.body.split('\n')[0] : `[${x.t}]`);
  ok('Oct 25: opener, story, then 020 / 021 / 022 each header -> media -> caption, then the closing line', /^🌅 \*Royal People Care, Sun Oct 25\*/.test(t[0]) && t[1].startsWith('📌 *Post 019* · Story') && t.indexOf('📌 *Post 020* · 9 AM CT · 3 PM Nigeria') > 0
    && msgs.filter(x => x.t === 'image').length === 3 + 6 + 8 && msgs.filter(x => x.t === 'video').length === 1 && msgs.at(-1).body.startsWith("That's today's 3 + the story ✅"));
  const i = msgs.findIndex(x => x.t === 'text' && x.body.startsWith('📌 *Post 022*'));
  ok('reel: header says 6:30 PM CT · 12:30 AM Nigeria, then the video, then the caption alone', msgs[i].body.includes('6:30 PM CT · 12:30 AM Nigeria') && msgs[i + 1].t === 'video' && msgs[i + 2].body === P.posts.find(p => p.n === '022').caption); }
ok('closing line: plain day = "That\'s today\'s 3 ✅"', RPC.messagesFor('2026-11-10').at(-1).body === "That's today's 3 ✅");

// ======================= 3. run(): once a day, window, hold, end =======================
const kv = new Map();
const kvDeps = { kvGet: async k => kv.has(k) ? JSON.parse(kv.get(k)) : null, kvPut: async (k, v) => { kv.set(k, JSON.stringify(v)); return true; } };
let lastIn = 0; const sends = []; const tpl = [];
const deps = (extra = {}) => ({ ...kvDeps, owner: OWNER, gapMs: 0, loadState: async () => ({ lastIn }),
  sendText: async (to, body) => { sends.push({ t: 'text', body }); return { ok: true, id: 'w' + sends.length }; },
  uploadMedia: async (buf, mime, c, fn) => ({ ok: true, id: 'MID_' + fn }),
  sendMediaRef: async (to, type, ref) => { sends.push({ t: type, ref }); return { ok: true }; },
  sendTemplate: async (to, name, lang, params) => { tpl.push({ name, params }); return { ok: true }; },
  templateStatus: async () => ({ status: 'APPROVED', lang: 'en' }), ...extra });
const C = ctx();
lastIn = Z('2026-10-24T13:51:47Z');
let r = await RPC.run(C, deps({ now: Z('2026-10-25T06:30:00Z') }));
ok('06:30 UTC: too early, nothing sent', r.how === 'too_early' && sends.length === 0);
r = await RPC.run(C, deps({ now: Z('2026-10-25T07:00:05Z') }));
ok('07:00 UTC Oct 25, window open: sent 019-022', r.how === 'sent' && r.posts.join() === '019,020,021,022' && r.sent === r.total && sends.filter(s => s.t === 'text').length === 1 + 4 * 2 + 1);
ok('media uploaded and sent by id (ordered: header, all slides, caption)', sends.filter(s => s.t === 'image').every(s => s.ref.id) && sends[1].body.startsWith('📌 *Post 019*') && sends[2].t === 'image' && sends[2].ref.id === 'MID_frame-1.jpg');
const n1 = sends.length;
r = await RPC.run(C, deps({ now: Z('2026-10-25T07:20:00Z') }));
ok('second run the same day: nothing (done_today)', r.how === 'done_today' && sends.length === n1);
await kv.delete(RPC.KEY('wa-test'));
r = await RPC.run(C, deps({ now: Z('2026-10-25T07:40:00Z') }));
ok('lost local state: the daily_push claim still stops a second drop', r.how === 'already' && sends.length === n1);
ok('daily_push marked sent', daily.get('wa-test|rpc|2026-10-25').how === 'sent');
// media fallback: upload fails -> link
sends.length = 0; lastIn = Z('2026-10-26T06:00:00Z');
r = await RPC.run(C, deps({ now: Z('2026-10-26T07:00:30Z'), uploadMedia: async () => ({ ok: false, detail: 'x' }) }));
ok('upload refused: the image/video goes by public link instead', r.how === 'sent' && sends.filter(s => s.t !== 'text').every(s => s.ref.link && s.ref.link.startsWith('https://rpc-media.vercel.app/p/02')));
// a send fails mid-way: stop, report, no retry loop
sends.length = 0; let k = 0; lastIn = Z('2026-10-27T06:00:00Z');
r = await RPC.run(C, deps({ now: Z('2026-10-27T07:00:30Z'), sendText: async (to, body) => { if (++k === 3) return { ok: false, detail: 'boom' }; sends.push({ t: 'text', body }); return { ok: true }; } }));
ok('a refused send stops the day (partial), reported once', r.how === 'partial' && r.failed && r.failed.detail === 'boom');
r = await RPC.run(C, deps({ now: Z('2026-10-27T08:00:30Z') }));
ok('... and is not retried later that day', r.how === 'done_today');
// window shut
sends.length = 0; lastIn = Z('2026-10-26T06:00:00Z');
r = await RPC.run(C, deps({ now: Z('2026-10-28T07:00:10Z') }));
ok('window shut: nothing free-form sent, day held, ONE template nudge', r.how === 'window_closed' && sends.length === 0 && tpl.length === 1 && tpl[0].name === 'michael_checkin_v1' && /Royal People Care posts for Wed Oct 28/.test(tpl[0].params[1]));
r = await RPC.run(C, deps({ now: Z('2026-10-28T09:00:10Z') }));
ok('later runs that day: no second nudge, nothing sent', r.how === 'done_today' && tpl.length === 1 && sends.length === 0);
let s0 = await RPC.load('wa-test', kvDeps);
ok('nextDue: the held day is not due while his window is still shut', RPC.nextDueOf(s0, lastIn, Z('2026-10-28T10:00:00Z')) === Z('2026-10-29T07:00:00Z'));
lastIn = Z('2026-10-28T15:00:00Z');                                 // he writes to the bot at 4 PM Lagos
ok('he writes: nextDue = now (gate wakes)', RPC.wantsFlush(s0, lastIn, Z('2026-10-28T15:00:01Z')) && RPC.nextDueOf(s0, lastIn, Z('2026-10-28T15:00:01Z')) === Z('2026-10-28T15:00:06Z'));
r = await RPC.run(C, deps({ now: Z('2026-10-28T15:01:00Z') }));
ok('held day goes out after his message (once)', r.held_sent && r.held_sent.date === '2026-10-28' && r.held_sent.sent === r.held_sent.total && sends[0].body.startsWith('🌅 *Royal People Care, Wed Oct 28*'));
ok('daily_push re-marked sent_after_reply', daily.get('wa-test|rpc|2026-10-28').how === 'sent_after_reply');
const n2 = sends.length; r = await RPC.run(C, deps({ now: Z('2026-10-28T15:05:00Z') }));
ok('not sent twice', sends.length === n2 && !r.held_sent);
// a held day that he only answers the next day is dropped (its slots passed)
lastIn = Z('2026-10-27T06:00:00Z'); sends.length = 0;
r = await RPC.run(C, deps({ now: Z('2026-10-29T07:00:10Z') }));
ok('Oct 29 held (window shut), no second template for a new day? one per day', r.how === 'window_closed' && tpl.length === 2);
lastIn = Z('2026-10-30T05:00:00Z');
r = await RPC.run(C, deps({ now: Z('2026-10-30T05:00:30Z') }));
ok('he writes next morning: yesterday\'s held day is dropped, not sent', r.dropped_held === '2026-10-29' && sends.length === 0);
// heads-up before the window shuts
sends.length = 0; lastIn = Z('2026-10-30T05:00:00Z');
r = await RPC.run(C, deps({ now: Z('2026-10-30T07:00:10Z') }));
ok('Oct 30 sent (window open)', r.how === 'sent');
sends.length = 0; s0 = await RPC.load('wa-test', kvDeps);
ok('nextDue: heads-up at lastIn+23h when the window shuts before tomorrow 08:00', RPC.nextDueOf(s0, lastIn, Z('2026-10-30T08:00:00Z')) === Z('2026-10-31T04:00:00Z'));
ok('nextDue: no heads-up if the reminder heads-up went for the same message', RPC.nextDueOf(s0, lastIn, Z('2026-10-30T08:00:00Z'), { reminderKeeperFor: lastIn }) === Z('2026-10-31T07:00:00Z'));
r = await RPC.run(C, deps({ now: Z('2026-10-31T04:00:20Z') }));
ok('heads-up sent once, names today\'s 8 AM posts', r.keeper === 'sent' && sends.length === 1 && /today's Royals posts come at 8 AM \(Sat Oct 31\)/.test(sends[0].body));
r = await RPC.run(C, deps({ now: Z('2026-10-31T04:05:00Z') }));
ok('... not twice for the same message', !r.keeper && sends.length === 1);
process.env.RPC_KEEPER = '0'; s0 = await RPC.load('wa-test', kvDeps); s0.keeperFor = null;
ok('RPC_KEEPER=0: no heads-up wake', RPC.nextDueOf(s0, lastIn, Z('2026-10-30T08:00:00Z')) === Z('2026-10-31T07:00:00Z')); delete process.env.RPC_KEEPER;
process.env.RPC_TEMPLATE = '0'; lastIn = 0; tpl.length = 0;
r = await RPC.run(C, deps({ now: Z('2026-10-31T07:00:10Z') }));
ok('RPC_TEMPLATE=0: held without a template', r.how === 'window_closed' && tpl.length === 0); delete process.env.RPC_TEMPLATE;
// DST: Nov 1 drop headers
lastIn = Z('2026-11-01T06:00:00Z'); sends.length = 0;
r = await RPC.run(C, deps({ now: Z('2026-11-01T07:00:10Z') }));
ok('Nov 1 (US clocks back): 9 AM CT · 4 PM Nigeria, 6:30 PM CT · 1:30 AM Nigeria', r.how === 'sent' && sends.some(s => s.t === 'text' && s.body.startsWith('📌 *Post 042* · 9 AM CT · 4 PM Nigeria')) && sends.some(s => s.t === 'text' && s.body.includes('6:30 PM CT · 1:30 AM Nigeria (after midnight)')));
// end of plan
for (const d of ['2026-11-21']) { lastIn = Z(d + 'T06:00:00Z'); r = await RPC.run(C, deps({ now: Z(d + 'T07:00:10Z') })); ok('Nov 21 (last day) sent 102-104', r.how === 'sent' && r.posts.join() === '102,103,104'); }
s0 = await RPC.load('wa-test', kvDeps);
ok('nextDue after the last day: Nov 22 08:00 (the end note)', RPC.nextDueOf(s0, lastIn, Z('2026-11-21T08:00:00Z')) === Z('2026-11-22T07:00:00Z'));
sends.length = 0; lastIn = Z('2026-11-22T06:00:00Z');
r = await RPC.run(C, deps({ now: Z('2026-11-22T07:00:10Z') }));
ok('Nov 22: plan over -> one end note, then stops', r.how === 'plan_ended' && r.end === 'sent' && sends.length === 1 && /post plan \(Oct 25 – Nov 21\) has ended/.test(sends[0].body));
r = await RPC.run(C, deps({ now: Z('2026-11-23T07:00:10Z') }));
s0 = await RPC.load('wa-test', kvDeps);
ok('after the end: nothing more, nothing scheduled', r.how === 'ended' && sends.length === 1 && RPC.nextDueOf(s0, lastIn, Z('2026-11-23T08:00:00Z')) === null);
// end note while his window is shut: held, sent once on his next message
kv.clear(); sends.length = 0; lastIn = Z('2026-11-20T06:00:00Z');
await RPC.save('wa-test', { lastDate: '2026-11-21' }, kvDeps);
r = await RPC.run(C, deps({ now: Z('2026-11-22T07:00:10Z') }));
ok('end note with the window shut: held', r.how === 'plan_ended' && r.end === 'held' && sends.length === 0);
lastIn = Z('2026-11-25T10:00:00Z');
r = await RPC.run(C, deps({ now: Z('2026-11-25T10:00:30Z') }));
ok('... and sent on his next message, once', r.end === 'sent_after_reply' && sends.length === 1);
r = await RPC.run(C, deps({ now: Z('2026-11-25T11:00:30Z') }));
ok('... not again', sends.length === 1 && r.how === 'ended');
// before the start (today, Oct 24)
kv.clear(); sends.length = 0; lastIn = Z('2026-10-24T13:51:47Z');
r = await RPC.run(C, deps({ now: Z('2026-10-24T15:00:00Z') }));
s0 = await RPC.load('wa-test', kvDeps);
ok('Oct 24 (before the plan): nothing sent, next wake Sun Oct 25 07:00 UTC', r.how === 'not_started' && sends.length === 0 && RPC.nextDueOf(s0, lastIn, Z('2026-10-24T15:00:00Z')) === Z('2026-10-25T07:00:00Z'));
process.env.RPC_DROP = '0'; ok('RPC_DROP=0: off', (await RPC.run(C, deps({ now: Z('2026-10-25T07:00:10Z') }))).how === 'off_env' && RPC.nextDueOf(s0, lastIn) === null); delete process.env.RPC_DROP;

// ======================= 4. commands =======================
ok('detect: royals / royals today / Royals posts? / rpc', ['royals', 'Royals today', "royals today's posts", 'Royals posts?', 'rpc', 'royal people care'].every(t => RPC.detect(t)?.op === 'today'));
ok('detect: royals off|on|status; not normal sentences', RPC.detect('royals off').op === 'off' && RPC.detect('royals on').op === 'on' && RPC.detect('royals status').op === 'status' && !RPC.detect('the royals are coming to town') && !RPC.detect('send me the royals caption for my client'));
{ kv.clear(); const cr = await RPC.command(ctx(), 'today', { ...kvDeps, now: Z('2026-10-26T12:00:00Z') });
  const sx = await RPC.load('wa-test', kvDeps);
  ok('"royals": reply + today held with ask (the gate sends it)', /Sending today's Royals posts \(3\)/.test(cr.text) && sx.held.ask && sx.held.date === '2026-10-26' && RPC.wantsFlush(sx, Z('2026-10-26T12:00:00Z'), Z('2026-10-26T12:00:01Z')));
  sends.length = 0; lastIn = Z('2026-10-26T12:00:00Z');
  r = await RPC.run(C, deps({ now: Z('2026-10-26T12:00:30Z') }));
  ok('... gate run sends today\'s posts again', r.held_sent && r.held_sent.ask && sends[0].body.includes('(again)'));
  const off = await RPC.command(ctx(), 'off', kvDeps); ok('royals off: paused, nothing scheduled', /paused/.test(off.text) && RPC.nextDueOf(await RPC.load('wa-test', kvDeps), lastIn) === null);
  ok('paused run: nothing sent', (await RPC.run(C, deps({ now: Z('2026-10-27T07:00:10Z') }))).how === 'off');
  const on = await RPC.command(ctx(), 'on', kvDeps); ok('royals on', /\*on\*/.test(on.text));
  const stt = await RPC.command(ctx(), 'status', { ...kvDeps, now: Z('2026-10-27T12:00:00Z') }); ok('royals status', /every morning at 8 AM, Oct 25 – Nov 21/.test(stt.text)); }

// ======================= 5. wiring =======================
J.kvMemClear();
{ const c = ctx(); const st = await m.loadState(OWNER, c); st.lastIn = Date.now() - 3600e3; await m.saveState(OWNER, st, c);
  wakes.length = 0; const rr = await m.runReminders(c, { now: Date.now() });
  ok('runReminders runs the RPC drop (gate row live) and re-arms the gate', rr.rpc && typeof rr.rpc.how === 'string' && wakes.length >= 1); }
{ J.kvMemClear(); const c = ctx(); const st = await m.loadState(OWNER, c); st.lastIn = Date.now() - 600e3; await m.saveState(OWNER, st, c);
  wakes.length = 0;
  const res = await m.processMessage({ from: OWNER, id: 'wamid.v98_1', type: 'text', text: { body: 'royals' } }, 'T', c);
  const sx = await RPC.load('wa-test');
  ok('webhook "royals": answered, today held for the gate, gate woken within seconds', c.rpcCmd === 'today' && (texts(c).at(-1) || '').length > 0 && (P.posts.some(p => p.date === NL.lagosDate()) ? sx.held && sx.held.ask && wakes.some(w => w.p_name === 'test' && Date.parse(w.p_due) - Date.now() < 60e3) : /plan/.test(texts(c).at(-1))));
  globalThis.__last = { texts: texts(c), wakes }; }
{ const CR = await import('./api/cron.js');
  J.kvMemClear(); daily.clear();
  const st = await m.loadState(OWNER, ctx()); st.lastIn = Z('2026-10-25T06:00:00Z'); await m.saveState(OWNER, st, ctx());
  const res = await CR.GET(new Request('http://x/api/cron?task=rpc&now=2026-10-25T07:00:30Z', { headers: { 'x-test-key': process.env.WA_TEST_KEY } }));
  const j = await res.json(); globalThis.__last = j;
  ok('cron task=rpc (sandbox): Oct 25 drop in the outbox, nothing real', j.ok && j.sandbox && j.how === 'sent' && j.outbox[0].startsWith('🌅') && j.outbox.filter(x => x.startsWith('[image]')).length === 17 && j.outbox.filter(x => x.startsWith('[video]')).length === 1 && j.uploads.length === 18);
  fs.writeFileSync('/dev/shm/rpc-sample-oct25.json', JSON.stringify(j, null, 1));
  const bad = await CR.GET(new Request('http://x/api/cron?task=rpc')); ok('cron task=rpc needs a key', bad.status === 401); }
{ const vj = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')); ok('vercel.json: daily cron 0 7 * * * -> /api/cron?task=rpc, old 06:00 cron kept', vj.crons.some(c => c.path === '/api/cron?task=rpc' && c.schedule === '0 7 * * *') && vj.crons.some(c => c.path === '/api/cron' && c.schedule === '0 6 * * *')); }
{ const res = await m.GET(new Request('http://x/api/whatsapp?health=1')); const j = await res.json(); ok('health: build v9.8 + v98 block (v9.8.0)', j.build === 'v9.8' && j.v98.patch === 'v9.8.0' && /07:00 UTC/.test(j.v98.rpc) && j.v97 && j.v96); }
J.kvMemClear();
console.log(`\n${n} checks passed`);
