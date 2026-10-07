// v4 tests: link reading (real page fetches, mocked Gemini text), save flow, Facebook refusal, image generation (REAL provider call),
// WhatsApp image send payload (sandbox ctx: nothing is sent). State in the real Blob store under wa-test/ (cleaned at the end).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const realFetch = globalThis.fetch;
const calls = [];
let stubImage = null;   // set when the keyless provider stays busy: serve a previously generated live image so the send checks still run
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (stubImage && /pollinations\.ai/.test(u)) return new Response(stubImage, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  if (u.includes('generativelanguage') && !/image/.test(u)) {
    const model = u.match(/models\/([^:]+)/)[1];
    const body = JSON.parse(opts.body);
    const user = body.contents.at(-1).parts.map(p => p.text || '[media]').join('\n');
    calls.push({ model, sys: body.systemInstruction.parts[0].text, user });
    const ok = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200 });
    if (user.includes('write between 1 and 5 short, standalone facts')) {
      if (user.includes('Bible-Arena')) return ok('- Bible Arena (github.com/Holaoluwakintan/Bible-Arena) is a real-time Bible trivia game.\n- Bible Arena is built with React Native / Expo and an Express + tRPC backend.\n- Bible Arena runs a backend on port 3000 and Expo on 8081 in local preview.');
      return ok('- BLOSSOM (olaoluwamichael.vercel.app) is the creative home of Olaoluwa Michael.\n- The featured BLOSSOM book is Balm of Gilead.');
    }
    if (user.includes('Michael sent you this link')) {
      const title = user.match(/Title: (.*)/)[1];
      return ok(`*${title}* summary from ${model}\n• point one\n• point two`);
    }
    return ok(`answer from ${model}`);
  }
  return realFetch(url, opts);
};
const m = await import('./api/whatsapp.js');
await (await import('./t_store.mjs')).cleanTest(); // v7 fresh sandbox (the store keeps wa-test records between runs)
const x = await import('./api/_extras.js');
const OWNER = '2348148034092';
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
let n = 0;
const say = async (text, c = ctx()) => { const r = await m.processMessage({ from: OWNER, id: 'wamid.v4' + Date.now() + (n++), type: 'text', text: { body: text } }, 'T', c); return { r, c, sent: c.outbox.filter(b => b.type === 'text').map(b => b.text.body) }; };
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('✔', name); };

// pure helpers
ok('detectRead bare URL', x.detectRead('https://github.com/a/b')?.url === 'https://github.com/a/b');
ok('detectRead read: + question', x.detectRead('read: olaoluwamichael.vercel.app what is this?').question === 'what is this?');
ok('long chat containing a link is not a read', x.detectRead('so yesterday ' + 'z'.repeat(200) + ' https://a.com') === null);
ok('teach with a link stays a teach', x.detectRead('teach: my site is https://olaoluwamichael.vercel.app') === null);
ok('blocked: facebook, fb.watch, instagram, x', ['https://www.facebook.com/x', 'https://fb.watch/abc', 'https://instagram.com/p/1', 'https://x.com/a/status/1'].every(u => x.blockedSite(u)));
ok('htmlToText strips scripts and keeps headings', (() => { const r = x.htmlToText('<html><head><title>T &amp; Co</title><meta name="description" content="Desc"></head><body><script>bad()</script><h1>Hello</h1><p>World &#8212; ok</p></body></html>'); return r.title === 'T & Co' && r.description === 'Desc' && r.text.includes('# Hello') && r.text.includes('World — ok') && !r.text.includes('bad()'); })());
ok('detectImage forms', x.detectImage('image: a lamb').prompt === 'a lamb' && x.detectImage('/image a lamb').prompt === 'a lamb' && x.detectImage('draw: a lamb').prompt === 'a lamb' && x.detectImage('Can you generate an image of a lamb in rain').prompt === 'a lamb in rain');
ok('detectImage sizes', x.detectImage('image: status a lamb').height === 1920 && x.detectImage('image: square a lamb').height === 1080 && x.detectImage('image: a lamb').height === 1350 && x.detectImage('image: landscape a lamb').width === 1920);
ok('normal chat is not an image request', !x.detectImage('what image should I use for my post?') && !x.detectImage('I made an image yesterday'));
{ const st = {}; for (let i = 0; i < 20; i++) x.countImage(st); ok('daily image quota 20', x.imageQuota(st).left === 0 && x.imageQuota({}).left === 20); }

// e2e: GitHub repo read -> summary -> save
await say('/new');
calls.length = 0;
let r = await say('read: https://github.com/Holaoluwakintan/Bible-Arena');
ok('repo read: summary + save prompt', r.sent.at(-1).includes('Holaoluwakintan/Bible-Arena') && r.sent.at(-1).endsWith('Reply *save* to add this to my knowledge, or ask me anything about it.'));
ok('repo read: README + API facts reached the model', calls[0].user.includes('React Native / Expo') && calls[0].user.includes('Main language: TypeScript'));
r = await say('save');
ok('save -> "✅ Saved 3 facts from Holaoluwakintan/Bible-Arena"', r.sent.at(-1).startsWith('✅ Saved 3 facts from Holaoluwakintan/Bible-Arena'));
r = await say('/knowledge'); ok('facts are in /knowledge', r.sent.join('\n').includes('real-time Bible trivia game'));
r = await say('save'); ok('second save does nothing new', !r.sent.at(-1).startsWith('✅ Saved'));
calls.length = 0; r = await say('which backend does it use?');
ok('follow-up question carries the page', calls[0].user.includes('Context from Tab\'s link reader') && calls[0].user.includes('Express + tRPC'));

// e2e: website (bare URL), "yes" saves, dedupe on repeat
calls.length = 0;
r = await say('https://olaoluwamichael.vercel.app');
ok('bare website URL is read + summarised', r.sent.at(-1).includes('BLOSSOM') && r.sent.at(-1).includes('Reply *save*') && calls[0].user.includes('Stories that stay with you'));
r = await say('yes'); ok('"yes" right after a summary saves (2 facts)', r.sent.at(-1).startsWith('✅ Saved 2 facts from BLOSSOM'));
r = await say('https://olaoluwamichael.vercel.app'); r = await say('save');
ok('re-reading + save skips duplicates', r.sent.at(-1).includes('Nothing new'));
r = await say('https://olaoluwamichael.vercel.app'); r = await say('tell me a joke'); r = await say('yes');
ok('"yes" later (not right after) is not a save', !r.sent.at(-1).startsWith('✅ Saved') && !r.sent.at(-1).includes('Nothing new'));

// Facebook refusal (no fetch, no model call)
calls.length = 0;
r = await say('read: https://www.facebook.com/olaoluwa.michael/posts/123');
ok('Facebook link -> polite refusal, no model call', r.sent.at(-1).includes("can't read Facebook links") && r.sent.at(-1).includes('teach:') && calls.length === 0);
r = await say('https://www.instagram.com/p/abc/'); ok('Instagram refused too', r.sent.at(-1).includes("can't read Instagram"));

// image: REAL provider call, sandbox send
let img = null, live = true;
for (let attempt = 0; attempt < 4 && !img; attempt++) {
  const c = ctx({ keepImage: true });
  r = await say('image: a cute felt lamb resting in a green yarn meadow at sunrise, soft pastel colors', c);
  if (r.r.image) img = { r, c };
  else { console.log('  (provider busy, attempt', attempt + 1, r.sent.at(-1).slice(0, 60), ') waiting 25s'); await new Promise(z => setTimeout(z, 25000)); }
}
if (!img && !process.env.POLLINATIONS_KEY && !process.env.CF_AI_TOKEN && fs.existsSync('/home/user/tab/files/michael-ai/v4-test-image.jpg')) {
  console.log('  ⚠ SKIP live image: keyless Pollinations stayed busy (402) for 4 tries and no key is set; send checks run on the last live image');
  live = false; stubImage = fs.readFileSync('/home/user/tab/files/michael-ai/v4-test-image.jpg');
  const c = ctx({ keepImage: true }); r = await say('image: a cute felt lamb resting in a green yarn meadow at sunrise, soft pastel colors', c); if (r.r.image) img = { r, c };
}
ok(live ? 'image: produced by a live provider' : 'image: produced (stubbed provider bytes)', img && img.r.r.image.bytes > 10000);
const up = img.c.outbox.find(b => b.type === 'media_upload');
const send = img.c.outbox.find(b => b.type === 'image');
ok('media upload carries the image bytes (jpeg/png)', up && /^image\/(jpeg|png)$/.test(up.mime) && up.bytes === img.r.r.image.bytes);
ok('image message payload is correct', send && send.messaging_product === 'whatsapp' && send.to === OWNER && send.type === 'image' && send.image.id === 'TEST_MEDIA_ID' && send.image.caption.startsWith('🎨 a cute felt lamb') && send.image.caption.includes('left today'));
{ const a = img.c.outbox.findIndex(b => b.type === 'text' && b.text.body.startsWith('🎨 Drawing')); ok('ack text sent before the image', a >= 0 && a < img.c.outbox.findIndex(b => b.type === 'image')); }
const out = '/home/user/tab/files/michael-ai/v4-test-image.' + (up.mime === 'image/png' ? 'png' : 'jpg');
if (live) fs.writeFileSync(out, Buffer.from(up.b64, 'base64'));
console.log('  provider:', img.r.r.image.provider, img.r.r.image.model, img.r.r.image.bytes, 'bytes', img.r.r.image.ms + 'ms', JSON.stringify(img.r.r.image.tried), '->', out);
r = await say('image:'); ok('empty image: explains usage', r.sent.at(-1).includes('Tell me what to draw'));
// post: ... with this image -> draft carries the image
r = await say('post: Psalm 23 morning word with this image');
const st = await m.loadState(OWNER, ctx());
ok('post with this image -> draft keeps the generated image', st.pending && st.pending.imageId === 'TEST_MEDIA_ID' && r.sent.at(-1).includes('(with your picture)'));
r = await say('cancel');
// quota hit
{ const st2 = await m.loadState(OWNER, ctx()); st2.img = { day: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), n: 20 }; await m.saveState(OWNER, st2, ctx());
  r = await say('image: another lamb'); ok('limit reached -> told, nothing generated', r.sent.at(-1).includes("today's 20 free pictures") && !r.c.outbox.some(b => b.type === 'image')); }
r = await say('/help'); ok('/help lists read + image', r.sent.join('\n').includes('read: <link>') && r.sent.join('\n').includes('image: <your idea>'));
{ const res = await m.GET(new Request('http://x/api/whatsapp?health=1')); const j = await res.json(); ok('health build v4 + read_links + image_gen', /^v[4-9](\.\d+)?$/.test(j.build) && j.read_links === true && (j.image_gen === 'pending_key' || j.image_gen === 'pollinations' || j.image_gen === 'cloudflare')); }

// cleanup
const { cleanTest } = await import('./t_store.mjs');
console.log(`\n${pass} checks passed`); console.log('cleaned', await cleanTest(), 'test records');
