// Local unit tests for v2. Gemini is mocked (no quota used); WhatsApp sends are captured (test ctx);
// state lives in the real Blob store under wa-test/ (cleaned up at the end).
import assert from 'node:assert/strict';
const realFetch = globalThis.fetch;
const calls = [];
let geminiMode = 'ok';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('generativelanguage')) {
    const model = u.match(/models\/([^:]+)/)[1];
    const body = JSON.parse(opts.body);
    calls.push({ model, sys: body.systemInstruction.parts[0].text, user: JSON.stringify(body.contents.at(-1)) });
    const ok = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200 });
    if (geminiMode === 'all429') return new Response('{"error":{"message":"Quota exceeded for metric generate_content_free_tier_requests, limit: 20 GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 });
    if (geminiMode === 'flash429' && !model.includes('lite')) return new Response('{"error":{"message":"GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 });
    if (geminiMode === 'voiceteach') return ok('TEACH: my ebook price is ₦2,000');
    const last = calls.at(-1).user;
    if (last.includes('Write a Facebook post')) return ok('**Ruth stayed.**\n\nWhen everyone left, she stayed.\n\nOlaoluwa Michael');
    if (last.includes('NOT_ABOUT_DRAFT') && last.includes('capital')) return ok('NOT_ABOUT_DRAFT');
    if (last.includes('NOT_ABOUT_DRAFT')) return ok('Ruth stayed. Shorter now.');
    if (last.includes('morning nudge')) return ok("Good morning Michael 🌅\n*Today's focus:*\n• Pitch 3 businesses");
    return ok(`answer from ${model}`);
  }
  return realFetch(url, opts);
};
const m = await import('./api/whatsapp.js');
await (await import('./t_store.mjs')).cleanTest(); // v7 fresh sandbox (the store keeps wa-test records between runs)
const OWNER = '2348148034092';
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
let n = 0;
const say = async (text, from = OWNER, c = ctx()) => { const r = await m.processMessage({ from, id: 'wamid.t' + Date.now() + (n++), type: 'text', text: { body: text } }, 'T', c); return { r, sent: c.outbox.filter(b => b.type === 'text').map(b => b.text.body) }; };
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('✔', name); };

// pure helpers
ok('teach regex', m.command('teach: x y', { history: [] }, { facts: [], settings: {} }).saveKB);
ok('teach me is not a command', m.command('teach me how to pray', { history: [] }, { facts: [], settings: {} }) === null);
ok('voiceTeach parse', m.voiceTeach('*TEACH:* my price is 5k') === 'my price is 5k' && m.voiceTeach('🎙️ hello') === null);
ok('yes regex', m.YES_RE.test('Yes') && m.YES_RE.test('post it') && !m.YES_RE.test('yes but shorter'));
ok('pacific midnight in future', m.nextPacificMidnight() > Date.now() && m.nextPacificMidnight() - Date.now() <= 25 * 3600e3);
ok('cleanPost strips **', m.cleanPost('**Hi**') === 'Hi');
ok('help lists commands', ['teach:', '/knowledge', '/unteach', '/profile', '/new', 'post:'].every(k => m.HELP.includes(k)));

// flow
let x = await say('/new');
x = await say('teach: my ebook price is ₦2,000');
ok('teach confirms', x.sent[0].startsWith("Got it ✅ I'll remember: _my ebook price is ₦2,000_"));
x = await say('teach: I prefer short replies');
x = await say('/knowledge');
ok('/knowledge lists base + facts', x.sent[0].includes('Base profile') && x.sent[0].includes('1. my ebook price is ₦2,000') && x.sent[0].includes('2. I prefer short replies'));
x = await say('/unteach 0'); ok('/unteach 0 protects base', x.sent[0].includes("can't be removed"));
x = await say('/unteach 9'); ok('/unteach out of range', x.sent[0].includes('no fact number 9'));
x = await say('/unteach 2'); ok('/unteach removes', x.sent[0].includes('Removed: _I prefer short replies_'));
x = await say('/profile'); ok('/profile shows base', x.sent.join('\n').includes('VoicePad') && x.sent.length >= 1);
geminiMode = 'ok'; calls.length = 0;
x = await say('How much is my ebook?');
ok('question answered by first model in rotation (v5: short asks go Lite-first)', x.sent[0] === 'answer from ' + m.LITE_FIRST[0]);
ok('system prompt carries profile + taught fact + PA rules', calls[0].sys.includes('BASE PROFILE') && calls[0].sys.includes('my ebook price is ₦2,000') && calls[0].sys.includes('PERSONAL ASSISTANT MODE'));
ok('no secrets in profile', !/passcode|token=|EAA|AQ\./i.test(calls[0].sys.split('# BASE PROFILE')[1]));
ok('no private manuscripts in profile', !/15 Days Break|Pictures in My Heart/i.test(calls[0].sys.split('# BASE PROFILE')[1]));
geminiMode = 'flash429'; calls.length = 0;
x = await say('another question');
ok('flash 429 falls back to lite', x.sent[0] === 'answer from gemini-flash-lite-latest');
calls.length = 0;
x = await say('third question');
ok('parked flash models skipped next time', calls[0].model === 'gemini-flash-lite-latest');
geminiMode = 'all429';
x = await say('fourth question');
ok('all quota gone still replies', x.sent[0].includes('free AI quota'));
geminiMode = 'ok';
x = await say('/new'); // clears history, keeps cooldowns
// stranger
x = await say('hello', '2349999999999');
ok('stranger gets private line', x.sent[0] === 'This is a private assistant.');
x = await say('hello again', '2349999999999');
ok('stranger second message quiet', x.sent.length === 0);
// voice teach
process.env.WA_MOCK_MEDIA_FILE = '/etc/hostname'; process.env.WA_MOCK_MEDIA_MIME = 'audio/ogg';
geminiMode = 'voiceteach';
{ const c = ctx(); await m.processMessage({ from: OWNER, id: 'wamid.v' + Date.now(), type: 'audio', audio: { id: 'M', voice: true } }, 'T', c);
  ok('voice teach saves', c.outbox.filter(b => b.type === 'text')[0].text.body.includes("I'll remember: _my ebook price is ₦2,000_")); }
geminiMode = 'ok';
x = await say('/knowledge'); ok('voice fact listed', x.sent[0].includes('2. my ebook price is ₦2,000'));
x = await say('/unteach 2'); x = await say('/unteach 1');
// facebook flow
x = await say('post: Ruth\'s loyalty');
ok('post: drafts without markdown', x.sent[0].includes('Draft for your Facebook Page') && x.sent[0].includes('Ruth stayed.') && !x.sent[0].includes('**') && x.sent[0].includes('Reply *yes*'));
x = await say('make it shorter'); ok('edit updates draft', x.sent[0].includes('Updated draft') && x.sent[0].includes('Shorter now'));
x = await say("what's the capital of Ghana?"); ok('unrelated msg answered normally while draft pending', x.sent[0].startsWith('answer from'));
const savedTok = process.env.FB_PAGE_TOKEN; delete process.env.FB_PAGE_TOKEN;
x = await say('yes'); ok('yes without page token -> not connected', x.sent[0].startsWith('Page not connected yet'));
{ const c = ctx({ fbMock: true }); x = await say('yes', OWNER, c);
  ok('yes with mock posts once', c.outbox.filter(b => b.type === 'fb_feed').length === 1 && x.sent[0].includes('Posted to your Facebook Page') && x.sent[1].includes('WhatsApp Channel') && x.sent[1].includes('Shorter now')); }
{ const c = ctx({ fbMock: true }); x = await say('yes', OWNER, c); ok('second yes does not repost', c.outbox.filter(b => b.type === 'fb_feed').length === 0); }
x = await say('post: test'); x = await say('cancel'); ok('cancel drops draft', x.sent[0].includes('Nothing was posted'));
// nudge
{ const c = ctx(); const r = await m.morningNudge(c, { force: true }); ok('nudge sends within window', r.sent && c.outbox.some(b => b.type === 'text' && b.text.body.startsWith('Good morning Michael'))); }
{ const c = ctx(); const r = await m.morningNudge(c); ok('nudge once a day', r.skipped === 'already_sent_today'); }
x = await say('/nudge off'); { const r = await m.morningNudge(ctx(), { force: true }); ok('nudge off respected', r.skipped === 'nudge_off'); }
x = await say('/nudge on');
// HTTP test path
process.env.WA_TEST_KEY = 'k'.repeat(32);
{ const body = { entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: OWNER, id: 'wamid.h' + Date.now(), type: 'text', text: { body: '/help' } }] } }] }] };
  const r = await m.POST(new Request('http://x/api/whatsapp', { method: 'POST', headers: { 'x-test-key': 'k'.repeat(32) }, body: JSON.stringify(body) }));
  const j = await r.json(); ok('POST test path returns replies', j.test && j.sent[0].text.includes('Michael AI')); }
{ process.env.WA_APP_SECRET = 'sekret'; const r = await m.POST(new Request('http://x/api/whatsapp', { method: 'POST', headers: { 'x-test-key': 'wrong'.repeat(7) }, body: '{}' })); ok('wrong test key + secret => 401', r.status === 401); delete process.env.WA_APP_SECRET; }
console.log(`\n${pass} checks passed`);
// cleanup sandbox blobs
const { cleanTest } = await import('./t_store.mjs');
console.log('cleaned', await cleanTest(), 'test records');
