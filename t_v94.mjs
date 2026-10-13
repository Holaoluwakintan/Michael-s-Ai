// v9.4 tests (plain-words approvals, Meta payment block held + explained, chat prompt rule). Harness copied from t_v9.
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


// ===== v9.4 =====
const P = V9.parseApproval;
ok('parse: "Skip only 5 and send the rest"', JSON.stringify(P('Skip only 5 and send the rest', 5)) === '{"send":[1,2,3,4],"skip":[5]}');
ok('parse: "Send out" = all', P('Send out', 5)?.send.length === 5);
ok('parse: except / range / list', P('send all except 2', 5).send.join() === '1,3,4,5' && P('send 1 to 4', 5).send.join() === '1,2,3,4' && P('Send number 1, 3 and 4', 5).send.join() === '1,3,4');
ok('parse: chat stays chat', P('send me the link', 5) === null && P('ok send', 5) === null && P('send it', 5) === null && P('send 9', 5) === null && P('can you send a caption for this post', 5) === null);

await J.rpc('kv_purge_test', {});
const c1 = ctx();
await say('hi', OWNER, c1);
await say('contacts add\nTolu 0803 123 4567\nAda 0805 000 1111\nBayo 0806 222 3333\nGrace 0807 444 5555\nKemi 0808 666 7777\nSola 0809 888 9999', OWNER, c1);
let cfg = (await kv('cfg')) || {}; cfg.tpl = { status: 'APPROVED', at: Date.now() }; cfg.health = { blocked: V9.PAY_WHY, at: Date.now() }; await kvput('cfg', cfg);
let x = await say('outreach now', OWNER, c1);
ok('blocked by payment: drafts say so, marked blocked', /blocked by Meta/.test(x.last) && /payment method/.test(x.last) && /skip 5 and send the rest/.test(x.last));
const c2 = ctx();
x = await say('Skip only 5 and send the rest', OWNER, c2);
let b = await kv('batch');
ok('plain words: 5 skipped, 1-4 held with the payment reason, nothing sent', b.items[4].status === 'skipped' && b.items.slice(0, 4).every(d => d.status === 'held') && tpls(c2).length === 0 && /Skipped 5/.test(x.last) && /Held 4/.test(x.last) && /payment method/.test(x.last));
ok('plain words never reach the chat AI', !calls.some(k => k.user.includes('Skip only 5')));
cfg = await kv('cfg'); cfg.health = { blocked: null, at: Date.now() }; await kvput('cfg', cfg);
const c3 = ctx();
x = await say('send them out', OWNER, c3);
b = await kv('batch');
ok('after payment fixed: held 1-4 go out by template, 5 stays skipped', tpls(c3).length === 4 && b.items.slice(0, 4).every(d => d.status === 'sent') && b.items[4].status === 'skipped' && b.status === 'done');
ok('whyFailed maps 131042/141006 to payment', /payment method/.test(V9.whyFailed('131042 Business eligibility payment issue')) && /payment method/.test(V9.whyFailed('141006')));
ok('chat prompt: outreach is real, never copy-paste', /NEVER tell him to copy-paste/.test(V9.ethicBlock()));
const c4 = ctx(); const before = calls.length;
x = await say('send me the link to my site', OWNER, c4);
ok('non-approval "send me…" still goes to chat', calls.length > before);
await J.rpc('kv_purge_test', {});
console.log(`${n} checks passed`);
