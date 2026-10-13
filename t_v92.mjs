// v9.2: "Sow just posted" pings. Module + webhook routing + /api/cron?task=sowping auth. All mocked (no network).
import assert from 'node:assert/strict';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092';
delete process.env.WA_WABA_ID;
process.env.WA_TOKEN = 'test-token'; process.env.WA_PHONE_ID = 'PHONE';
process.env.SCHED_KEY = 'k'; process.env.SB_URL = 'https://x.supabase.co'; process.env.SB_ANON_KEY = 'a';
process.env.SOW_API_KEY = 'sow-key-0123456789abcdef-test';
let n = 0;
const ok = (name, cond) => { if (!cond) console.log('LAST:', JSON.stringify(globalThis.__last || null).slice(0, 2500)); assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092';
globalThis.fetch = async (u, o = {}) => {
  const s = String(u);
  if (s.includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'chat answer' }] }, finishReason: 'STOP' }] }), { status: 200 });
  if (s.includes('/rpc/michael_ai_set_next') || s.includes('/rpc/michael_ai_newsletter')) return new Response('null', { status: 200 });
  throw new Error('unexpected network call in a test: ' + s);
};
const J = await import('./api/_jobs.js'); J.setMock((op) => (op === 'usage_get' || op === 'undelivered' || op === 'list' || op === 'site_list' || op === 'sow_list') ? [] : (op === 'open_count' || op === 'count_today') ? 0 : null);
const BR = await import('./api/_brain.js'); BR.setMock(() => null);
const S = await import('./api/_sowping.js');
const m = await import('./api/whatsapp.js');
const cron = await import('./api/cron.js');

// ---------- pure helpers ----------
ok('fb link from page_post id', S.linkOf({ platform: 'fb_page', remote_id: '1174320202433527_122129246871393254' }) === 'https://www.facebook.com/1174320202433527/posts/122129246871393254');
ok('x / youtube links; url wins; IG has none', S.linkOf({ platform: 'x', remote_id: '1845' }) === 'https://x.com/i/status/1845' && S.linkOf({ platform: 'youtube', remote_id: 'abcDEF_123' }) === 'https://youtube.com/shorts/abcDEF_123' && S.linkOf({ platform: 'youtube', url: 'https://youtube.com/shorts/zz' }) === 'https://youtube.com/shorts/zz' && S.linkOf({ platform: 'instagram', remote_id: '1789' }) === null);
ok('reasons in plain words', S.reasonOf({ error: 'X: CreditsDepleted' }) === 'no credit' && S.reasonOf({ error: 'X: Your enrolled account [1170581832947159040] does not have any credits to fulfill this request.' }) === 'no credit' && S.reasonOf({ error: 'YouTube upload: {"error":{"code":403,"message":"quotaExceeded"}}' }) === 'daily limit reached' && S.reasonOf({ error: 'Facebook Page not connected' }) === 'reconnect needed');
const ytRaw = 'YouTube init: {\n  "error": {\n    "code": 403,\n    "message": "YouTube Data API v3 has not been used in project 511211 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=5112';
ok('steer: YouTube 403 API off -> "API not enabled" (no JSON)', S.reasonOf({ error: ytRaw }) === 'API not enabled' && S.failText({ platform: 'youtube', reason: S.reasonOf({ error: ytRaw }) }) === '⚠️ YouTube: failed, API not enabled');
ok('steer: unverified test user / expired token', S.reasonOf({ error: 'YouTube: {"error":"access_denied","error_description":"The app is not verified"}' }) === 'not a test user' && S.reasonOf({ error: 'YouTube token: {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}' }) === 'reconnect needed');
const other = S.reasonOf({ error: 'YouTube upload: {"error":{"code":400,"message":"The request metadata specifies an invalid video title that is far too long for the API"}}' });
ok('steer: anything else = first 60 chars of the message, no JSON', other.length <= 61 && !/[{}"]/.test(other) && other.startsWith('The request metadata specifies'));
ok('snippet: one line, hashtags dropped (mood tag, #movie:/#seq: too), capped', S.snip('#prayer\nLord, mend me.\nGod is good #faith #love\n#movie:wap #seq:08', 90) === 'Lord, mend me. God is good' && S.snip('a'.repeat(200), 90).length === 90);
const one = S.successText([{ platform: 'fb_page', remote_id: '1174320202433527_122129246871393254', snippet: 'Built to crack it: lesson 2' }]);
ok('single ping: platform, caption, link', one.includes('Sow just posted on Facebook') && one.includes('_Built to crack it: lesson 2_') && one.includes('https://www.facebook.com/1174320202433527/posts/122129246871393254'));
ok('failure line', S.failText({ platform: 'x', reason: 'no credit' }) === '⚠️ X: failed, no credit');

// ---------- detection ----------
ok('commands detected', S.detect('sow pings off').op === 'off' && S.detect('Sow pings on').op === 'on' && S.detect('sow pings').op === 'status' && S.detect('stop sow pings').op === 'off' && S.detect('turn on sow pings').op === 'on');
ok('not commands', S.detect('pings off') === null && S.detect('sow week') === null && S.detect('sow') === null && S.detect('post God is good') === null);

// ---------- ingest (window open / shut, dedupe, failures) ----------
const kv = new Map(), sent = [], tpls = [];
let lastIn = 0, sendOk = true, tplStatus = 'PENDING';
const deps = (now, x = {}) => ({ now, owner: OWNER, loadState: async () => ({ lastIn }), sendText: async (to, t) => { if (!sendOk) return { ok: false, detail: '131047' }; sent.push({ to, t }); return { ok: true }; },
  sendTemplate: async (to, name, lang, params) => { tpls.push({ name, params }); return { ok: true }; }, templateStatus: async () => ({ status: tplStatus, lang: 'en' }),
  kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); return true; }, ...x });
const live = { test: false, ns: 'wa', outbox: [] };
const T0 = Date.parse('2026-10-10T15:05:30Z');
const fb1 = { key: 'bl:2026-10-10_1600_aiclass-02-cv:fb', platform: 'fb', ok: true, remote_id: '1174320202433527_1', title: 'AI class 02', snippet: 'Your CV is your first sermon #ai', source: 'blossom' };
const xf = { key: 'sp:42:x', platform: 'x', ok: false, error: 'X: CreditsDepleted' };
lastIn = T0 - 3600e3;
let r = await S.ingest(live, [fb1, xf, { ...xf, key: 'sp:43:x' }], deps(T0));
ok('window open: one message with the post + one failure line', r.sent === 2 && sent.length === 1 && sent[0].to === OWNER && sent[0].t.includes('Sow just posted on Facebook') && sent[0].t.includes('https://www.facebook.com/1174320202433527/posts/1') && sent[0].t.includes('⚠️ X: failed, no credit') && sent[0].t.split('X: failed').length === 2);
r = await S.ingest(live, [fb1, xf], deps(T0 + 1800e3));
ok('same post again: no duplicate; same failure same day: silent', r.dup === 1 && r.fail_deduped === 1 && sent.length === 1);
r = await S.ingest(live, [{ ...xf, error: 'X: CreditsDepleted' }], deps(Date.parse('2026-10-10T23:30:00Z')));
ok('23:30Z = 00:30 Lagos = a new Lagos day: the same failure pings once more', r.sent === 1 && sent.length === 2);
r = await S.ingest(live, [{ ...xf }], deps(Date.parse('2026-10-11T10:00:00Z')));
ok('same reason later that Lagos day: silent', r.fail_deduped === 1 && sent.length === 2);
r = await S.ingest(live, [{ ...xf, error: 'X: Unauthorized' }], deps(Date.parse('2026-10-11T10:00:00Z')));
ok('a NEW reason on the same platform still pings', r.sent === 1 && sent.at(-1).t.includes('X: failed, Unauthorized'));

// stored keys from the first live run (raw JSON reason) are migrated: no repeat ping today
kv.set('wa/sow/pings', { on: true, seen: {}, held: [], fails: { 'youtube|{ "error": { "code": 403, "message": "YouTube Data API v3 has not been': '2026-10-11' } });
r = await S.ingest(live, [{ key: 'sp:9:youtube', platform: 'youtube', ok: false, error: ytRaw }], deps(Date.parse('2026-10-11T10:02:00Z')));
ok('old raw-JSON dedupe key migrated -> same failure stays silent today', r.fail_deduped === 1 && kv.get('wa/sow/pings').fails['youtube|API not enabled'] === '2026-10-11');
// several posts in one run -> one list message
const many = Array.from({ length: 10 }, (_, i) => ({ key: 'sp:clip' + i + ':youtube', platform: 'youtube', ok: true, url: 'https://youtube.com/shorts/v' + i, snippet: 'Clip ' + i }));
r = await S.ingest(live, many, deps(Date.parse('2026-10-11T10:05:00Z')));
ok('10 posts in one run: ONE message, 8 listed + "and 2 more"', r.sent === 10 && sent.at(-1).t.includes('Sow just posted 10') && sent.at(-1).t.includes('https://youtube.com/shorts/v7') && !sent.at(-1).t.includes('v8\n') && sent.at(-1).t.includes('and 2 more'));

// window shut -> held, template only when APPROVED, one summary on his next message
kv.clear(); sent.length = 0; lastIn = Date.parse('2026-10-10T10:22:00Z');
const N1 = Date.parse('2026-10-11T15:05:00Z');
r = await S.ingest(live, [{ ...fb1, key: 'bl:a:fb' }], deps(N1));
ok('window shut: nothing sent, held; template PENDING -> no template', r.held === 1 && r.window === 'closed' && sent.length === 0 && tpls.length === 0 && kv.get('wa/sow/pings').held.length === 1);
tplStatus = 'APPROVED';
r = await S.ingest(live, [{ ...fb1, key: 'bl:b:fb' }, xf], deps(N1 + 1800e3));
ok('template APPROVED: one nudge (michael_checkin_v1, one-line param)', tpls.length === 1 && tpls[0].name === 'michael_checkin_v1' && tpls[0].params[0] === 'Michael' && /2 new posts and 1 failed post/.test(tpls[0].params[1]) && !/\n/.test(tpls[0].params[1]));
r = await S.ingest(live, [{ ...fb1, key: 'bl:c:fb' }], deps(N1 + 3600e3));
ok('…at most one template a day', tpls.length === 1 && kv.get('wa/sow/pings').held.length === 4);
let f = await S.flushHeld(live, deps(N1 + 4000e3));
ok('his next message: ONE summary of everything held', f.sent === 4 && sent.length === 1 && sent[0].t.includes('While you were away, Sow posted 3') && sent[0].t.includes('X: failed, no credit'));
f = await S.flushHeld(live, deps(N1 + 4100e3));
ok('not twice', f === null && sent.length === 1);
// failed flush keeps them
await S.ingest(live, [{ ...fb1, key: 'bl:d:fb' }], deps(N1 + 5000e3));
sendOk = false; f = await S.flushHeld(live, deps(N1 + 5100e3)); sendOk = true;
ok('a failed flush keeps them for next time', f.sent === 0 && kv.get('wa/sow/pings').held.length >= 1);
tplStatus = 'PENDING';

// off / on
let msg = await S.command(live, 'off', deps(N1));
ok('off: confirms, clears held', /off/.test(msg) && kv.get('wa/sow/pings').on === false && kv.get('wa/sow/pings').held.length === 0);
lastIn = N1;
r = await S.ingest(live, [{ ...fb1, key: 'bl:e:fb' }], deps(N1 + 6000e3));
ok('off: nothing sent or held, but remembered (no burst when turned back on)', r.off && sent.length === 1 && kv.get('wa/sow/pings').seen['bl:e:fb']);
msg = await S.command(live, 'on', deps(N1)); r = await S.ingest(live, [{ ...fb1, key: 'bl:e:fb' }], deps(N1 + 6100e3));
ok('on again: old event not replayed', /on/.test(msg) && r.dup === 1 && sent.length === 1);
ok('status', /on/.test(await S.command(live, 'status', deps(N1))));

// ---------- through the real webhook handler (sandbox ns, in-memory store) ----------
const ctx = () => ({ test: true, ns: 'wa-test', outbox: [] });
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
let mid = 0;
const say = async (text, from = OWNER) => { const c = ctx(); await m.processMessage({ from, id: 'wamid.v92_' + (mid++), type: 'text', text: { body: text } }, 'T', c); globalThis.__last = texts(c); return { c, sent: texts(c), last: texts(c).at(-1) || '' }; };
let x = await say('sow pings off');
ok('"sow pings off" is the command, never a Sow post', /Sow pings are \*off\*/.test(x.last) && !/Queued in \*Sow\*/.test(x.sent.join('\n')));
x = await say('sow pings on');
ok('"sow pings on"', /Sow pings are \*on\*/.test(x.last));
x = await say('sow pings', '2348000000000');
ok('a stranger cannot change them', !/Sow pings are/.test(x.sent.join('\n')));
// held ping flushes on his next message (through processMessage)
await J.rpc('kv_put', { k: 'wa-test/sow/pings', v: { on: true, seen: {}, fails: {}, held: [{ t: 'ok', platform: 'fb', remote_id: '1174320202433527_9', snippet: 'Held post' }] } });
x = await say('hello');
ok('his next message releases the held summary first', x.sent.some(t => t.includes('While you were away, Sow posted 1') && t.includes('/posts/9')));
x = await say('hello again');
ok('…once', !x.sent.some(t => t.includes('While you were away')));

// ---------- /api/cron?task=sowping auth ----------
const req = (h, body) => new Request('https://michael-ai-mu.vercel.app/api/cron?task=sowping', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body || { events: [] }) });
let res = await cron.POST(req({}));
ok('no key: 401', res.status === 401);
res = await cron.POST(req({ 'x-sow-key': 'wrong-key-0123456789abcdef-tes' }));
ok('wrong key: 401', res.status === 401);
res = await cron.POST(req({ 'x-test-key': process.env.WA_TEST_KEY }, { events: [{ key: 'sp:t1:youtube', platform: 'youtube', ok: true, url: 'https://youtube.com/shorts/T1', snippet: 'Test clip' }] }));
let j = await res.json();
ok('sandbox call: 200, wa-test ns, nothing really sent', res.status === 200 && j.ns === 'wa-test' && j.got === 1);
const hr = await m.GET(new Request('https://x/api/whatsapp?health=1')); const h = await hr.json();
ok('health build v9.2', /^v9\.[2-9]/.test(h.build) && h.v92 && /sowping/.test(h.v92.sow_pings));
console.log(`\n${n} checks passed`);
