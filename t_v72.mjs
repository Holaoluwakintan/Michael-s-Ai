// v7.2 tests: daily verse from Sow (06:00 Lagos push + "verse" command). All mocked: in-memory daily_push, fake Sow/image/WhatsApp.
import assert from 'node:assert/strict';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092,2348000000001';
process.env.SB_URL = 'https://sb.test'; process.env.SB_ANON_KEY = 'anon'; process.env.SCHED_KEY = 'sched-test';
process.env.GEMINI_API_KEY = 'key-one'; process.env.SOW_API_KEY = 'sow-test-key';
process.env.WA_TOKEN = 'wa-test-token'; process.env.WA_PHONE_ID = '123';
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092', OTHER = '2348000000001';
const pushes = new Map();
const J = await import('./api/_jobs.js'); J.setMock((op) => (['undelivered', 'data_unnotified', 'site_list'].includes(op) ? [] : null));
const NL = await import('./api/_newsletter.js');
NL.setMock((op, a) => {
  const k = `${a.ns}|${a.kind}|${a.day}`;
  if (op === 'daily_get') return pushes.get(k) || null;
  if (op === 'daily_claim') { if (pushes.has(k)) return false; pushes.set(k, { how: a.how }); return true; }
  if (op === 'daily_mark') { pushes.set(k, { how: a.how, detail: a.detail }); return true; }
  throw new Error('op ' + op);
});
const VS = await import('./api/_verse.js');
const m = await import('./api/whatsapp.js');
const POST = { title: 'New Mercy Today', verse: 'It is of the LORD’S mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.', reference: 'Lamentations 3:22-23', caption: 'Yesterday\'s mistakes didn\'t use up today\'s mercy.', image_url: 'https://img.test/01.jpg', text: { whatsapp: '*New Mercy Today*\n\nYesterday\'s mistakes didn\'t use up today\'s mercy. It\'s brand new and waiting for you.\n\n"It is of the LORD’S mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness." - Lamentations 3:22-23' } };
let sowDay = '2026-10-07', sowCalls = 0, sowDown = false;
const net = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  const s = String(u); net.push(s);
  if (s === 'https://sow-ng.vercel.app/api/today') { sowCalls++; if (sowDown) return new Response('{}', { status: 503 }); assert.equal(o.headers['x-sow-key'], 'sow-test-key'); return new Response(JSON.stringify({ today: sowDay, post: { ...POST, date: sowDay } }), { status: 200 }); }
  if (s === 'https://img.test/01.jpg') return new Response(Buffer.from('fakejpeg'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (s.includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'chat answer' }] }, finishReason: 'STOP' }] }), { status: 200 });
  if (s.includes('graph.facebook.com')) return new Response('{"messages":[{"id":"wamid.X"}]}', { status: 200 });
  if (s.includes('/rpc/michael_ai_set_next')) return new Response('"ok"', { status: 200 });
  throw new Error('unexpected network call ' + s);
};

// caption + timing
const cap = VS.captionOf(POST);
ok('caption: title, message, KJV verse and reference, once each', cap.startsWith('*New Mercy Today*') && cap.includes('great is thy faithfulness') && cap.includes('Lamentations 3:22-23 (KJV)') && cap.split('New Mercy Today').length === 2 && cap.length < 1024);
ok('caption without a WhatsApp text is built from title + caption + verse', (() => { const c = VS.captionOf({ ...POST, text: {} }); return c.startsWith('*New Mercy Today*') && c.includes('Yesterday') && c.includes('(KJV)'); })());
ok('next push slot = 06:00 Lagos (05:00 UTC)', VS.nextPushSlot(Date.parse('2026-10-07T04:00:00Z')) === Date.parse('2026-10-07T05:00:00Z') && VS.nextPushSlot(Date.parse('2026-10-07T05:00:00Z')) === Date.parse('2026-10-08T05:00:00Z'));
ok('verse command words', VS.VERSE_RE.test('verse') && VS.VERSE_RE.test('Today') && VS.VERSE_RE.test('daily verse') && VS.VERSE_RE.test("today's verse") && !VS.VERSE_RE.test('what is today') && !VS.VERSE_RE.test('verse about love'));

// scheduled push
const out = []; let lastIn = Date.parse('2026-10-07T04:00:00Z'); const wakes = [];
const deps = (now) => ({ now, owner: OWNER, loadState: async () => ({ lastIn }), sendText: async (to, t) => { out.push({ t: 'text', to, body: t }); return { ok: true }; }, uploadMedia: async (b, mime) => { out.push({ t: 'upload', mime, bytes: b.length }); return { ok: true, id: 'MID' }; }, sendImage: async (to, id, c) => { out.push({ t: 'image', to, id, caption: c }); return { ok: true }; }, setNextWake: async (name, t) => { wakes.push([name, new Date(t).toISOString()]); return { ok: true }; } });
const live = { test: false, ns: 'wa', outbox: [] };
let r = await VS.runVerse(live, deps(Date.parse('2026-10-07T04:30:00Z')));
ok('before 06:00 Lagos: too early, nothing sent, armed for 05:00 UTC', r.how === 'too_early' && out.length === 0 && r.next === '2026-10-07T05:00:00.000Z' && wakes.at(-1)[0] === 'verse');
r = await VS.runVerse(live, deps(Date.parse('2026-10-07T05:00:00Z')));
ok('06:00 Lagos inside the 24h window: the picture with the full caption goes to Michael', r.how === 'sent' && out.some(o => o.t === 'upload' && o.mime === 'image/jpeg') && out.some(o => o.t === 'image' && o.to === OWNER && o.caption === cap) && r.next === '2026-10-08T05:00:00.000Z');
const sentBefore = out.length;
r = await VS.runVerse(live, deps(Date.parse('2026-10-07T05:01:00Z')));
ok('never twice in one day (a second run sees the day claimed)', r.how === 'already:sent' && out.length === sentBefore);
r = await VS.runVerse(live, deps(Date.parse('2026-10-07T09:00:00Z')));
ok('...also later that day', r.how.startsWith('already') && out.length === sentBefore);
lastIn = Date.parse('2026-10-07T04:00:00Z'); sowDay = '2026-10-08';
r = await VS.runVerse(live, deps(Date.parse('2026-10-08T05:00:00Z')));
ok('24h window shut (he last wrote 25 h ago): skipped and recorded, nothing sent', r.how === 'window_closed' && out.length === sentBefore && pushes.get('wa|verse|2026-10-08').how === 'window_closed');
r = await VS.runVerse(live, deps(Date.parse('2026-10-08T06:00:00Z')));
ok('a skipped day stays skipped (no late send after he writes)', r.how === 'already:window_closed');
lastIn = Date.parse('2026-10-08T20:00:00Z'); sowDay = '2026-10-09';
r = await VS.runVerse(live, deps(Date.parse('2026-10-09T12:00:00Z')));
ok('after 12:00 Lagos the morning push is skipped (too late)', r.how === 'too_late' && out.length === sentBefore);
sowDay = '2026-10-10'; lastIn = Date.parse('2026-10-09T20:00:00Z'); sowDown = true;
r = await VS.runVerse(live, deps(Date.parse('2026-10-10T05:00:00Z')));
ok('Sow down: recorded as error, nothing sent, re-armed for tomorrow', r.how === 'error' && out.length === sentBefore && r.next === '2026-10-11T05:00:00.000Z');
sowDown = false; sowDay = '2026-10-10'; lastIn = Date.parse('2026-10-10T20:00:00Z');
r = await VS.runVerse(live, deps(Date.parse('2026-10-11T05:00:00Z')));
ok('Sow serving a different day than Lagos today: not sent', r.how === 'sow_day_mismatch');

// command
sowDay = '2026-10-07';
const ctx = () => ({ test: true, ns: 'wa-test', outbox: [] });
const say = async (text, from = OWNER) => { const c = ctx(); const res = await m.processMessage({ from, id: 'wamid.v72_' + Math.random(), type: 'text', text: { body: text } }, 'T', c); return { res, c }; };
let x = await say('verse');
const img = x.c.outbox.find(b => b.type === 'image');
ok('"verse": today\'s picture + caption ("New Mercy Today", Lamentations 3:22-23)', img && img.image.caption.includes('New Mercy Today') && img.image.caption.includes('Lamentations 3:22-23') && x.c.outbox.some(b => b.type === 'media_upload'));
x = await say('today');
ok('"today" works the same', x.c.outbox.some(b => b.type === 'image'));
x = await say('verse', OTHER);
ok('owner only', x.c.outbox.some(b => b.type === 'text' && /Only Michael/.test(b.text.body)) && !x.c.outbox.some(b => b.type === 'image'));
sowDown = true; x = await say('daily verse'); sowDown = false;
ok('Sow down: a friendly retry line, no crash', x.c.outbox.some(b => b.type === 'text' && /Sow didn't answer/.test(b.text.body)));
x = await say('help');
ok('help lists verse', x.c.outbox.some(b => b.type === 'text' && b.text.body.includes('📖 *verse*')));
globalThis.fetch = realFetch;
console.log(`\n${n} checks passed`);
