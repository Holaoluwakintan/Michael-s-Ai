// v9.1: newsletter preview reaches Michael (full letter; template nudge when his window is shut; held until his next message)
import * as NL from './api/_newsletter.js';
let n = 0; const ok = (name, c) => { if (!c) { console.log('✘ ' + name); process.exit(1); } n++; console.log('✔ ' + name); };
const fields = { day: 'Monday', date: '2026-10-12', title: 'Gold in the Cracks', body: 'Para one about Kintsugi.\n\nPara two.', promise: 'He restores.', signoff: 'See you on Friday.', book: 'Balm of Gilead', book_link: 'https://x/b', verse_ref: 'Jeremiah 30:17', verse_text: 'For I will restore health unto thee', translation: 'KJV' };
const L = [{ id: 3, ns: 'wa', kind: 'letter', slot: 1, send_on: '2026-10-12', send_at: '2026-10-12T07:00:00Z', subject: 'Monday Letter: Gold in the Cracks', fields, status: 'scheduled', preview_at: null, preview_how: null, total: 0, sent: 0, queued: 0, inflight: 0 }];
const strip = l => { const { fields, ...x } = l; return JSON.parse(JSON.stringify(x)); };
NL.setMock((op, a) => {
  switch (op) {
    case 'preview_due': { const l = L.find(x => x.status === 'scheduled' && x.send_on === a.date && !x.preview_at); return l ? strip(l) : null; }
    case 'preview_mark': { const l = L.find(x => x.id === +a.id); l.preview_at = 'now'; l.preview_how = a.how; return strip(l); }
    case 'get': { const l = L.find(x => x.id === +a.id); return l ? JSON.parse(JSON.stringify(l)) : null; }
    case 'subs_count': return 457;
    case 'due': return [];
    case 'upcoming': return L.filter(x => x.status === 'scheduled').map(x => ({ id: x.id, send_on: x.send_on, send_at: x.send_at, subject: x.subject, preview_at: x.preview_at }));
    default: throw new Error('op ' + op);
  }
});
const kv = new Map(), texts = [], tpls = [];
let tplStatus = { 'michael_letter_ready_v1': 'NOT_FOUND', 'michael_checkin_v1': 'PENDING' }, lastIn = 0;
const deps = (now, x = {}) => ({ now, owner: '2348148034092', providers: { credits: async () => 300 }, loadState: async () => ({ lastIn }),
  sendText: async (to, t) => { texts.push(t); return { ok: true }; },
  sendTemplate: async (to, name, lang, params) => { tpls.push({ to, name, lang, params }); return { ok: true, id: 'wamid.X' }; },
  templateStatus: async name => (tplStatus[name] === 'NOT_FOUND' ? 'NOT_FOUND' : { status: tplStatus[name], lang: 'en' }),
  kvGet: async k => kv.get(k) ?? null, kvPut: async (k, v) => { kv.set(k, v); return true; }, setNextWake: async () => ({ ok: true }), ...x });
const live = { test: false, ns: 'wa', outbox: [] };

// review text
const rt = NL.reviewText(L[0], 457);
ok('review text: whole letter (verse, body, promise, sign-off, book), subject, count, skip; no mail placeholders', rt.includes('*Subject:* Monday Letter: Gold in the Cracks') && rt.includes('Kintsugi') && rt.includes('Para two.') && rt.includes('Jeremiah 30:17') && rt.includes('He restores.') && rt.includes('See you on Friday.') && rt.includes('Balm of Gilead') && rt.includes('*457* subscribers') && rt.includes('Mon 12 Oct at 8am') && rt.includes('*skip*') && !rt.includes('%%') && !rt.includes('Unsubscribe'));
ok('review text fits WhatsApp (under 4096 for the real 75? checked on this one)', rt.length < 4096);

// window shut, nothing approved: no WhatsApp at all, held
lastIn = Date.parse('2026-10-10T10:22:27Z');
let r = await NL.runNewsletter(live, deps(Date.parse('2026-10-11T19:00:00Z')));
ok('Sun 20:00, window shut, no approved template: nothing sent, held for his next message', r.preview.how === 'window_closed_waiting' && texts.length === 0 && tpls.length === 0 && kv.get('wa/nl/preview-pending').id === 3);
ok('the gate still wakes for the Monday 08:00 send', r.next === '2026-10-12T07:00:00.000Z');
// he messages at 21:30 Lagos
let fp = await NL.flushPreview(live, deps(Date.parse('2026-10-11T20:30:00Z')));
ok('his next message: full preview goes, once', fp.sent && texts.length === 1 && texts[0].includes('Kintsugi') && L[0].preview_how === 'sent_on_reply');
fp = await NL.flushPreview(live, deps(Date.parse('2026-10-11T20:31:00Z')));
ok('not twice', fp === null && texts.length === 1);

// approved dedicated template
L[0].preview_at = null; L[0].preview_how = null; kv.clear(); texts.length = 0;
tplStatus = { 'michael_letter_ready_v1': 'APPROVED', 'michael_checkin_v1': 'PENDING' };
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-11T19:00:00Z')));
ok('window shut + letter-ready template approved: template nudge to Michael, preview held', r.preview.how === 'window_closed_template' && tpls.length === 1 && tpls[0].name === 'michael_letter_ready_v1' && tpls[0].to === '2348148034092' && tpls[0].params[0] === 'Monday Letter' && tpls[0].params[1] === 'Gold in the Cracks' && kv.get('wa/nl/preview-pending').id === 3);
fp = await NL.flushPreview(live, deps(Date.parse('2026-10-11T19:10:00Z')));
ok('his reply to the nudge releases the full letter', fp.sent && texts.at(-1).includes('Kintsugi'));

// only the check-in template approved: uses it with a one-line nudge
L[0].preview_at = null; kv.clear(); tpls.length = 0;
tplStatus = { 'michael_letter_ready_v1': 'PENDING', 'michael_checkin_v1': 'APPROVED' };
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-11T19:00:00Z')));
ok('fallback: michael_checkin_v1 nudge with a one-line param (no newlines)', r.preview.how === 'window_closed_template' && tpls.length === 1 && tpls[0].name === 'michael_checkin_v1' && tpls[0].params[0] === 'Michael' && tpls[0].params[1].includes('Gold in the Cracks') && !/\n/.test(tpls[0].params[1]));

// window open: full letter straight away, no template, nothing held
L[0].preview_at = null; kv.clear(); tpls.length = 0; texts.length = 0; lastIn = Date.parse('2026-10-11T12:00:00Z');
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-11T19:00:00Z')));
ok('window open: full letter sent at 20:00, no template, nothing held', r.preview.how === 'sent' && texts.length === 1 && texts[0].includes('Para two.') && tpls.length === 0 && !kv.get('wa/nl/preview-pending'));

// held preview after the send time / after skip: dropped, not sent
kv.set('wa/nl/preview-pending', { id: 3 }); texts.length = 0;
fp = await NL.flushPreview(live, deps(Date.parse('2026-10-12T07:30:00Z')));
ok('after 08:00 the held preview is dropped (letter already going)', fp.dropped && texts.length === 0);
kv.set('wa/nl/preview-pending', { id: 3 }); L[0].status = 'skipped';
fp = await NL.flushPreview(live, deps(Date.parse('2026-10-11T21:00:00Z')));
ok('a skipped letter is not previewed', fp.dropped && texts.length === 0);
L[0].status = 'scheduled';

// send fails: kept for the next message
kv.set('wa/nl/preview-pending', { id: 3 });
fp = await NL.flushPreview(live, deps(Date.parse('2026-10-11T21:00:00Z'), { sendText: async () => ({ ok: false, detail: '131047' }) }));
ok('a failed send keeps it held for the next message', fp.sent === false && kv.get('wa/nl/preview-pending').id === 3);

// real 75 letters fit one WhatsApp message? (splitText handles longer anyway)
import fs from 'node:fs';
const csvPath = new URL('./fixtures/letters.csv', import.meta.url);
if (fs.existsSync(csvPath)) console.log('(fixtures/letters.csv present)');
console.log(`\n${n} checks passed`);
