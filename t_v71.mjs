// v7.1 tests: Monday & Friday Letters newsletter. All mocked: an in-memory copy of public.michael_ai_newsletter,
// fake Brevo/broadcast providers, fake Gemini + WhatsApp. Any unexpected network call (real broadcast, real Brevo) throws.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092,2348000000001';
process.env.SB_URL = 'https://sb.test'; process.env.SB_ANON_KEY = 'anon'; process.env.SCHED_KEY = 'sched-test';
process.env.GEMINI_API_KEY = 'key-one'; delete process.env.GEMINI_API_KEY_2;
process.env.WA_TOKEN = 'wa-test-token'; process.env.WA_PHONE_ID = '123';
delete process.env.BROADCAST_SECRET; delete process.env.BREVO_API_KEY;
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092', OTHER = '2348000000001';

// ---------- in-memory michael_ai_newsletter (mirrors sql/2026-10-07-newsletter.sql) ----------
const db = { letters: [], sends: new Map(), seq: 0, subs: [] };
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const sendsOf = id => [...db.sends.values()].filter(s => s.letter_id === id);
const strip = l => { if (!l) return l; const { fields, ...x } = l; return JSON.parse(JSON.stringify(x)); };
const refresh = id => { const l = db.letters.find(x => x.id === id); const ss = sendsOf(id);
  l.sent = ss.filter(s => s.status === 'sent').length; l.failed = ss.filter(s => s.status === 'failed').length; l.dropped = ss.filter(s => s.status === 'dropped').length;
  if (l.status === 'sending' && !ss.some(s => ['queued', 'inflight'].includes(s.status))) { l.status = 'done'; l.finished_at = new Date().toISOString(); } return l; };
let realNow = () => Date.now();
function store(op, a) {
  const ns = a.ns || 'wa', now = a.now ? Date.parse(a.now) : realNow();
  const L = db.letters;
  switch (op) {
    case 'import': for (const r of a.rows) { const e = L.find(x => x.ns === ns && x.kind === 'letter' && x.slot === r.slot); if (e) { if (e.status === 'scheduled') Object.assign(e, { send_on: r.send_on, send_at: r.send_at, subject: r.subject, fields: r.fields }); } else L.push({ id: ++db.seq, ns, kind: 'letter', slot: r.slot, send_on: r.send_on, send_at: r.send_at, subject: r.subject, fields: r.fields, status: 'scheduled', total: 0, sent: 0, failed: 0, dropped: 0, preview_at: null }); } return { rows: a.rows.length, scheduled: L.filter(x => x.ns === ns && x.status === 'scheduled').length };
    case 'oneoff': { const r = { id: ++db.seq, ns, kind: 'oneoff', slot: null, send_on: new Date(now + 3600e3).toISOString().slice(0, 10), send_at: new Date(now).toISOString(), subject: a.subject, fields: a.fields, status: 'scheduled', total: 0, sent: 0, failed: 0, dropped: 0, preview_at: null }; L.push(r); return JSON.parse(JSON.stringify(r)); }
    case 'subs_count': return new Set(db.subs.filter(s => s.consent).map(s => s.email.toLowerCase())).size;
    case 'upcoming': return L.filter(x => x.ns === ns && x.status === 'scheduled').sort((x, y) => Date.parse(x.send_at) - Date.parse(y.send_at)).slice(0, a.n || 3).map(x => ({ id: x.id, kind: x.kind, slot: x.slot, send_on: x.send_on, send_at: x.send_at, subject: x.subject, preview_at: x.preview_at }));
    case 'status': { const l = L.filter(x => x.ns === ns && ['sending', 'done'].includes(x.status)).sort((x, y) => (y.status === 'sending') - (x.status === 'sending') || Date.parse(y.started_at) - Date.parse(x.started_at))[0]; if (!l) return null; refresh(l.id); return { ...strip(l), queued: sendsOf(l.id).filter(s => ['queued', 'inflight'].includes(s.status)).length }; }
    case 'spare_count': return L.filter(x => x.ns === ns && x.status === 'skipped').length;
    case 'skip_next': { const l = L.filter(x => x.ns === ns && x.status === 'scheduled' && x.kind === 'letter' && Date.parse(x.send_at) > now).sort((x, y) => Date.parse(x.send_at) - Date.parse(y.send_at))[0]; if (!l) return null; l.status = 'skipped'; l.skipped_at = new Date(realNow()).toISOString(); return strip(l); }
    case 'unskip': { const l = L.filter(x => x.ns === ns && x.status === 'skipped').sort((x, y) => Date.parse(y.skipped_at) - Date.parse(x.skipped_at))[0]; if (!l) return null; if (Date.parse(l.send_at) <= now) return { ...strip(l), past: true }; l.status = 'scheduled'; l.skipped_at = null; return strip(l); }
    case 'due': {
      for (const l of L) if (l.ns === ns && l.status === 'scheduled' && Date.parse(l.send_at) < now - 3 * 864e5) l.status = 'expired';
      for (const l of L.filter(x => x.ns === ns && x.status === 'scheduled' && Date.parse(x.send_at) <= now)) {
        const list = ns === 'wa' ? db.subs.filter(s => s.consent).map(s => s.email) : (a.test_emails || []);
        for (const e of new Set(list.map(x => x.toLowerCase().trim()))) { const k = l.id + '|' + e; if (!db.sends.has(k)) db.sends.set(k, { letter_id: l.id, email: e, status: 'queued', tries: 0, lease_until: 0 }); }
        l.status = 'sending'; l.started_at = new Date(realNow()).toISOString(); l.total = sendsOf(l.id).length;
      }
      return L.filter(x => x.ns === ns && x.status === 'sending').sort((x, y) => Date.parse(x.send_at) - Date.parse(y.send_at)).map(l => { const ss = sendsOf(l.id); return { ...JSON.parse(JSON.stringify(l)), queued: ss.filter(s => s.status === 'queued').length, inflight: ss.filter(s => s.status === 'inflight').length, stale: ss.filter(s => s.status === 'inflight' && s.lease_until < realNow()).length }; });
    }
    case 'claim': {
      if (ns === 'wa') for (const s of sendsOf(+a.id)) if (s.status === 'queued' && !db.subs.some(p => p.email === s.email && p.consent)) { s.status = 'dropped'; s.err = 'unsubscribed'; }
      const q = sendsOf(+a.id).filter(s => s.status === 'queued').sort((x, y) => md5(x.email + ':' + x.letter_id) < md5(y.email + ':' + y.letter_id) ? -1 : 1).slice(0, Math.max(0, a.n));
      for (const s of q) { s.status = 'inflight'; s.tries++; s.lease_until = realNow() + (a.lease_s || 600) * 1000; }
      return q.map(s => s.email);
    }
    case 'stale': return sendsOf(+a.id).filter(s => s.status === 'inflight' && s.lease_until < realNow()).map(s => s.email);
    case 'mark': {
      const ss = sendsOf(+a.id), has = (arr, e) => (arr || []).includes(e);
      for (const s of ss) {
        if (has(a.sent, s.email)) { s.status = 'sent'; s.sent_at = realNow(); s.sentCount = (s.sentCount || 0) + 1; }
        else if (s.status === 'inflight' && has(a.failed, s.email)) { s.status = s.tries >= 3 ? 'failed' : 'queued'; s.err = a.err; }
        else if (s.status === 'inflight' && has(a.requeue, s.email)) { s.status = 'queued'; s.tries = Math.max(0, s.tries - 1); }
        else if (s.status === 'inflight' && has(a.dropped, s.email)) { s.status = 'dropped'; }
      }
      return strip(refresh(+a.id));
    }
    case 'preview_due': { const l = L.filter(x => x.ns === ns && x.status === 'scheduled' && x.send_on === a.date && !x.preview_at)[0]; return l ? strip(l) : null; }
    case 'preview_mark': { const l = L.find(x => x.id === +a.id); l.preview_at = new Date(realNow()).toISOString(); l.preview_how = a.how; return strip(l); }
    case 'get': return JSON.parse(JSON.stringify(L.find(x => x.id === +a.id && x.ns === ns) || null));
    case 'purge_test': { const k = L.length; db.letters = L.filter(x => x.ns !== 'wa-test'); return k - db.letters.length; }
  }
  throw new Error('mock: unknown op ' + op);
}
const J = await import('./api/_jobs.js');
const kvMock = (op) => { throw new Error('jobs op ' + op); }; J.setMock((op, a) => { if (op === 'kv_get' || op === 'kv_put') return null; if (['undelivered', 'data_unnotified', 'usage_add', 'site_list'].includes(op)) return []; return null; });
const NL = await import('./api/_newsletter.js'); NL.setMock(store);
const m = await import('./api/whatsapp.js');

// ---------- network guard ----------
const realFetch = globalThis.fetch;
const netLog = [], wakes = [];
globalThis.fetch = async (u, o = {}) => {
  const s = String(u); netLog.push(s);
  if (s.includes('generativelanguage')) {
    const body = JSON.parse(o.body); const user = body.contents.at(-1).parts.map(p => p.text || '').join('\n');
    const okr = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] }), { status: 200 });
    if (user.includes('wants to email his subscribers')) return okr('{"subject":"Golgotha is free this week","title":"A gift for you","body":"I have something for you.\\n\\nGolgotha is free to download this week.","signoff":"Tell a friend."}');
    return okr('chat answer');
  }
  if (s.includes('graph.facebook.com')) return new Response('{"messages":[{"id":"wamid.X"}]}', { status: 200 });
  if (s.includes('/rpc/michael_ai_set_next')) { wakes.push(JSON.parse(o.body)); return new Response('"ok"', { status: 200 }); }
  throw new Error('unexpected network call in a test: ' + s);
};

// ======================= 1. content: 75 letters -> rows, render =======================
const csvText = fs.readFileSync('/home/user/tab/files/newsletter/letters.csv', 'utf8');
function parseCsv(t) { const rows = []; let row = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; } if (f || row.length) { row.push(f); rows.push(row); } const [h, ...rs] = rows; return rs.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
const csv = parseCsv(csvText);
const rows = csv.map(NL.rowFromCsv);
ok('75 letters, slots 1..75 unique', rows.length === 75 && new Set(rows.map(r => r.slot)).size === 75);
ok('every letter is a Monday or Friday at 07:00 UTC (08:00 Lagos)', rows.every(r => [1, 5].includes(new Date(r.send_on + 'T12:00:00Z').getUTCDay()) && r.send_at.endsWith('T07:00:00.000Z') && r.send_at.startsWith(r.send_on)));
ok('first three: Mon 12 Oct, Fri 16 Oct, Mon 19 Oct 2026', rows.slice(0, 3).map(r => r.send_on).join() === '2026-10-12,2026-10-16,2026-10-19');
ok('subject = "<Day> Letter: <title>"', rows[0].subject === 'Monday Letter: Gold in the Cracks' && rows[1].subject.startsWith('Friday Letter: '));
const mail = NL.render(rows[0].fields);
ok('render: unsubscribe + first-name placeholders in html and text', mail.html.includes('href="%%UNSUBSCRIBE_URL%%"') && mail.html.includes('Hi %%FIRST_NAME%%,') && mail.text.includes('Unsubscribe: %%UNSUBSCRIBE_URL%%') && mail.text.includes('Hi %%FIRST_NAME%%,'));
ok('render: BLOSSOM look (header, cream card, Cormorant, gold) + verse, promise, book button', mail.html.includes('>BLOSSOM</td>') && mail.html.includes('#FCFAF5') && mail.html.includes('Cormorant Garamond') && mail.html.includes('Jeremiah 30:17') && mail.html.includes('TODAY&rsquo;S PROMISE') && mail.html.includes('https://olaoluwamichael.vercel.app/books/balm-of-gilead') && mail.html.includes('Monday Letter &middot; 12 October 2026'));
ok('render: every paragraph of the body is in the email, HTML-escaped', csv[0].body.split(/\n\s*\n/).every(p => mail.html.includes(p.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').slice(0, 40))) && !NL.render({ title: '<b>x</b>', body: '<script>' }).html.includes('<script>'));
ok('render: all 75 render with a title, body and unsubscribe link', rows.every(r => { const x = NL.render(r.fields); return x.html.length > 3000 && x.html.includes('%%UNSUBSCRIBE_URL%%') && x.text.length > 300; }));
ok('render: one-off uses the same template, "A note from Michael", no verse box', (() => { const x = NL.render({ title: 'Hi', subject: 'Hi', body: 'Para one.\n\nPara two.' }, { kind: 'oneoff' }); return x.html.includes('A note from Michael') && !x.html.includes('TODAY&rsquo;S PROMISE') && x.html.includes('Para two.') && x.subject === 'Hi'; })());

// ======================= 2. time helpers =======================
ok('nextSendSlot: before 07:00Z = today, after = tomorrow', NL.nextSendSlot(Date.parse('2026-10-12T06:59:00Z')) === Date.parse('2026-10-12T07:00:00Z') && NL.nextSendSlot(Date.parse('2026-10-12T07:00:00Z')) === Date.parse('2026-10-13T07:00:00Z'));
ok('previewAtOf: 20:00 Lagos the evening before', NL.previewAtOf('2026-10-12') === Date.parse('2026-10-11T19:00:00Z'));
ok('lagosDate: 23:30Z is already tomorrow in Lagos', NL.lagosDate(Date.parse('2026-10-11T23:30:00Z')) === '2026-10-12');

// ======================= 3. the scheduler =======================
store('import', { ns: 'wa', rows });
db.subs = Array.from({ length: 457 }, (_, i) => ({ email: `reader${i}@example.com`, consent: true }));
db.subs.push({ email: 'READER1@example.com', consent: true });       // a duplicate in another case: counted once
let credits = 300; const bcast = []; let breakNext = false, refuseNext = false;
const prov = {
  credits: async () => credits,
  got: async (e, subj) => bcast.some(b => b.subject === subj && b.emails.includes(e) && b.reallySent),
  broadcast: async (p) => { if (breakNext) { breakNext = false; bcast.push({ ...p, reallySent: true }); throw new Error('socket hang up'); } if (refuseNext) { return { sentTo: [], failedTo: p.emails, errors: ['daily limit'] }; } bcast.push({ ...p, reallySent: true }); credits -= p.emails.length; return { sentTo: p.emails, failedTo: [], skipped: [] }; },
};
const sentTexts = [];
let lastIn = 0;
const kvStore = new Map(); const tplSent = []; let tplStatus = 'PENDING';
const deps = (now, extra = {}) => ({ now, providers: prov, kvGet: async k => kvStore.get(k) ?? null, kvPut: async (k, v) => { kvStore.set(k, v); return true; }, templateStatus: async () => ({ status: tplStatus, lang: 'en' }), sendTemplate: async (to, name, lang, params) => { tplSent.push({ to, name, lang, params }); return { ok: true, id: 'wamid.T' }; }, owner: OWNER, loadState: async () => ({ lastIn }), sendText: async (to, t) => { sentTexts.push(t); return { ok: true }; }, setNextWake: async (name, t) => { wakes.push({ p_name: name, p_due: t ? new Date(t).toISOString() : null }); return { ok: true }; }, ...extra });
const live = { test: false, ns: 'wa', outbox: [] };
let r = await NL.runNewsletter(live, deps(Date.parse('2026-10-08T10:00:00Z')));
ok('before the first letter: nothing sent, gate armed for the Sunday 20:00 preview', r.sent === 0 && r.next === '2026-10-11T19:00:00.000Z' && bcast.length === 0);
lastIn = Date.parse('2026-10-11T09:00:00Z');
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-11T19:00:00Z')));
ok('Sunday 20:00 Lagos: preview sent inside the 24h window, gate re-armed for Monday 08:00', r.preview?.how === 'sent' && sentTexts.at(-1).includes("Your next letter, for review") && sentTexts.at(-1).includes('Gold in the Cracks') && sentTexts.at(-1).includes('Kintsugi') && sentTexts.at(-1).includes('Jeremiah 30:17') && sentTexts.at(-1).includes('*457* subscribers') && !sentTexts.at(-1).includes('%%') && sentTexts.at(-1).includes('*skip*') && r.next === '2026-10-12T07:00:00.000Z');
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-11T19:01:00Z')));
ok('preview goes once', r.preview === null && sentTexts.length === 1);
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-12T07:00:00Z')));
ok('Monday 08:00: 290 sent (300 credits - 10 reserve), stops on budget', r.sent === 290 && r.stop === 'budget' && credits === 10);
ok('chunks of 25 at most, all through the broadcast with the letter subject + unsubscribe html', bcast.every(b => b.emails.length <= 25 && b.subject === 'Monday Letter: Gold in the Cracks' && b.html.includes('%%UNSUBSCRIBE_URL%%')));
ok('the rest (167) waits for Tuesday 08:00', r.left === 167 && r.next === '2026-10-13T07:00:00.000Z');
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-12T09:00:00Z')));
ok('a stray run the same day sends nothing (budget spent) and keeps tomorrow 08:00', r.sent === 0 && r.next === '2026-10-13T07:00:00.000Z');
credits = 300;
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-13T07:00:00Z')));
ok('Tuesday 08:00: the other 167 go, letter done', r.sent === 167 && r.left === 0 && db.letters.find(x => x.slot === 1).status === 'done');
const all = bcast.flatMap(b => b.emails);
ok('nobody twice, nobody missed: 457 unique addresses for letter 1', all.length === 457 && new Set(all).size === 457);
ok('then the gate waits for Thursday 20:00 (Friday letter preview)', r.next === '2026-10-15T19:00:00.000Z');
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-15T19:00:00Z')));
ok('window shut, no approved template: nothing sent at 20:00, preview held for his next message', r.preview?.how === 'window_closed_waiting' && sentTexts.length === 1 && kvStore.get('wa/nl/preview-pending')?.id === db.letters.find(x => x.slot === 2).id && r.template && !r.template.ok);
{ // v9.1: he messages the bot at 23:00 Lagos -> the held preview goes now, once
  const fp = await NL.flushPreview(live, { ...deps(Date.parse('2026-10-15T22:00:00Z')) });
  ok('his next message releases the held preview (full letter), marked sent_on_reply', fp?.sent === true && sentTexts.length === 2 && sentTexts.at(-1).includes('When Life Tears Up Your Script') && sentTexts.at(-1).includes('*skip*') && db.letters.find(x => x.slot === 2).preview_how === 'sent_on_reply');
  const fp2 = await NL.flushPreview(live, { ...deps(Date.parse('2026-10-15T22:05:00Z')) });
  ok('a second message does not send it again', fp2 === null && sentTexts.length === 2);
}

// rotation: day-2 people differ between letters
credits = 300;
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-16T07:00:00Z')));
const l2 = db.letters.find(x => x.slot === 2);
const day1a = new Set(bcast.filter(b => b.subject.startsWith('Monday')).slice(0, 12).flatMap(b => b.emails));
const day1b = new Set(bcast.filter(b => b.subject === l2.subject).flatMap(b => b.emails));
ok('Friday: 290 sent; the order rotates so the same people are not always on day 2', r.sent === 290 && [...day1b].filter(e => !day1a.has(e)).length > 30);

// unsubscribe between day 1 and day 2
db.subs.find(s => s.email === sendsOf(l2.id).find(s => s.status === 'queued').email).consent = false;
credits = 300;
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-17T07:00:00Z')));
const st2 = store('status', { ns: 'wa' });
ok('someone who unsubscribed after day 1 is dropped, not emailed', r.sent === 166 && st2.dropped === 1 && st2.sent === 456 && st2.status === 'done');

// crash mid-chunk: in flight -> reconciled against Brevo, never re-sent
db.subs.forEach(s => s.consent = true);
credits = 300; breakNext = true;
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-19T07:00:00Z')));
ok('a broadcast that dies leaves its chunk in flight and retries in 15 min', r.stop === 'broadcast_error' && r.next === '2026-10-19T07:15:00.000Z');
const l3 = db.letters.find(x => x.slot === 3);
const lost = sendsOf(l3.id).filter(s => s.status === 'inflight').map(s => s.email);
for (const s of sendsOf(l3.id)) if (s.status === 'inflight') s.lease_until = 0;   // lease expired
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-19T07:20:00Z')));
ok('next run asks Brevo: the 25 that really went are marked sent, not re-sent', lost.length === 25 && lost.every(e => sendsOf(l3.id).find(s => s.email === e).status === 'sent' && sendsOf(l3.id).find(s => s.email === e).sentCount === 1) && bcast.filter(b => b.subject === l3.subject).flatMap(b => b.emails).filter(e => lost.includes(e)).length === 25);

// provider refusal
credits = 300; refuseNext = true;
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-20T07:00:00Z')));
ok('a chunk refused outright (limit) stops the run until the next 08:00; addresses go back to the queue', r.stop === 'provider_refused' && r.next === '2026-10-21T07:00:00.000Z' && sendsOf(l3.id).filter(s => s.status === 'queued').length > 0);
refuseNext = false; credits = 300;
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-21T07:00:00Z')));
ok('next morning it finishes', store('status', { ns: 'wa' }).status === 'done' && new Set(bcast.filter(b => b.subject === l3.subject).flatMap(b => b.emails)).size === 457);

// credits unreadable -> no sends
const provNo = { ...prov, credits: async () => { throw new Error('brevo 503'); } };
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-23T07:00:00Z'), { providers: provNo }));
ok('Brevo balance unreadable: sends nothing, tries again in 15 min', r.stop === 'credits_unknown' && r.sent === 0 && r.next === '2026-10-23T07:15:00.000Z');
credits = 300;
r = await NL.runNewsletter(live, deps(Date.parse('2026-10-23T07:15:00Z')));
ok('...and goes when it can read it', r.sent === 290);
ok('a letter more than 3 days late is expired, not sent', (() => { const x = store('due', { ns: 'wa', now: '2027-08-01T07:00:00Z' }); return db.letters.filter(l => l.status === 'expired').length > 0; })());
db.letters.filter(l => l.status === 'expired').forEach(l => l.status = 'scheduled');
ok('real mail is never attempted without BROADCAST_SECRET/BREVO_API_KEY', (await NL.runNewsletter(live, { now: Date.parse('2026-10-26T07:00:00Z'), owner: OWNER, loadState: async () => ({}), sendText: async () => ({}) })).stop === 'mail_not_configured' && !netLog.some(u => /brevo|olaoluwamichael/.test(u)));

// sandbox namespace: fake list, sandbox providers, nothing leaves
store('import', { ns: 'wa-test', rows: rows.slice(0, 2).map(x => ({ ...x, send_at: '2026-10-07T07:00:00.000Z', send_on: '2026-10-07' })) });
r = await NL.runNewsletter({ test: true, ns: 'wa-test', outbox: [] }, { now: Date.parse('2026-10-07T08:00:00Z'), owner: OWNER, testEmails: ['a@x.test', 'b@x.test'], loadState: async () => ({}), sendText: async () => ({ ok: true }), setNextWake: async () => ({ ok: true }) });
ok('sandbox run: sends to the fake list only (2 letters x 2 fake addresses), through the sandbox provider, no network', r.ns === 'wa-test' && r.sent === 4 && !netLog.some(u => /brevo|olaoluwamichael/.test(u)));
store('purge_test', {});

// ======================= 4. WhatsApp commands =======================
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
let mid = 1;
const say = async (text, from = OWNER, c = ctx()) => { const r = await m.processMessage({ from, id: 'wamid.v71_' + (mid++), type: 'text', text: { body: text } }, 'T', c); return { r, c, sent: texts(c), all: texts(c).join('\n') }; };
store('import', { ns: 'wa-test', rows });
let x = await say('help');
ok('help lists the newsletter commands', x.all.includes('letters · skip · unskip · subs · newsletter <text>'));
x = await say('letters');
ok('letters: next 3 with dates and titles + subscriber count', x.all.includes('Mon 12 Oct: Gold in the Cracks') && x.all.includes('Fri 16 Oct') && x.all.includes('Mon 19 Oct') && x.all.includes('457 subscribers') && x.all.includes('No letter has gone out yet'));
x = await say('subs');
ok('subs: subscriber count and the 2-mornings note', x.all.includes('*457* newsletter subscribers') && x.all.includes('2 mornings'));
x = await say('skip');
ok('skip: the next letter goes to the spare pile, next one named', x.all.includes('Skipped *Gold in the Cracks*') && x.all.includes('spare pile') && x.all.includes('Fri 16 Oct'));
x = await say('letters');
ok('letters after skip: starts at Fri 16 Oct, spare pile 1', !x.all.includes('Gold in the Cracks') && x.all.includes('Fri 16 Oct') && x.all.includes('spare pile): 1'));
x = await say('unskip');
ok('unskip: back on for Mon 12 Oct', x.all.includes('Back on: *Gold in the Cracks*') && x.all.includes('Mon 12 Oct'));
x = await say('letters', OTHER);
ok('owner only: another allowed number is refused', x.all.includes('Only Michael can manage the newsletter'));
x = await say('skip', OTHER);
ok('owner only: skip refused for others; letter untouched', x.all.includes('Only Michael') && store('upcoming', { ns: 'wa-test', n: 1 })[0].slot === 1);
x = await say('newsletter');
ok('bare "newsletter" explains the command', x.all.includes('newsletter <your message>') && x.all.includes('*yes*'));
const before = db.letters.length;
x = await say('newsletter Golgotha is free to download this week, tell your friends');
ok('newsletter <text>: preview with subject, body, count and timing; nothing created yet', x.all.includes('Newsletter preview') && x.all.includes('Golgotha is free this week') && x.all.includes('To *457* subscribers') && x.all.includes('290 go out right away') && x.all.includes('167 tomorrow at 8am') && x.all.includes('Reply *yes* within 30 min') && db.letters.length === before);
wakes.length = 0;
x = await say('yes');
const one = db.letters.find(l => l.kind === 'oneoff');
ok('"yes" queues the one-off now and kicks the gate', x.all.includes('Sending *Golgotha is free this week* now') && one && one.ns === 'wa-test' && one.fields.body.includes('Golgotha is free') && wakes.some(w => w.p_name === 'newsletter-test'));
x = await say('yes');
ok('a second "yes" does not send it twice', db.letters.filter(l => l.kind === 'oneoff').length === 1);
x = await say('newsletter Another note for everyone about the retreat on Saturday');
x = await say('no');
ok('"no" cancels: nothing queued', x.all.includes('Newsletter cancelled') && db.letters.filter(l => l.kind === 'oneoff').length === 1);
// 30-minute expiry
x = await say('newsletter A third note that I will not confirm in time');
{ const st = await m.loadState(OWNER, ctx()); }
const RealNow = Date.now; Date.now = () => RealNow() + 31 * 60e3;
x = await say('yes');
Date.now = RealNow;
ok('"yes" after 30 minutes does not send', db.letters.filter(l => l.kind === 'oneoff').length === 1 && !x.all.includes('Sending *'));
// Gemini down -> his own words
const gf = globalThis.fetch; globalThis.fetch = async (u, o) => String(u).includes('generativelanguage') ? new Response('{"error":{"code":503}}', { status: 503 }) : gf(u, o);
x = await say('newsletter: The book launch is on Saturday. Come celebrate with us!');
globalThis.fetch = gf;
ok('AI busy: the preview uses his own words verbatim', x.all.includes('*Subject:* The book launch is on Saturday') && x.all.includes('Come celebrate with us!'));
await say('no');
ok('no real broadcast or Brevo call anywhere in the WhatsApp tests', !netLog.some(u => /brevo|olaoluwamichael/.test(u)));
ok('commands do not swallow normal chat ("skipping lunch today")', NL.SKIP_RE.test('skipping lunch today') === false && NL.SKIP_RE.test('skip') && NL.SKIP_RE.test('skip the next letter') && NL.LETTERS_RE.test('Letters') && !NL.LETTERS_RE.test('write letters to my mum'));

ok('one-off draft never signs off twice (the template adds "With love")', NL.parseDraft('{"subject":"S","title":"T","body":"Hello.\\n\\nGrace and peace to you,","signoff":"Grace and peace to you,"}').signoff === null && !NL.parseDraft('{"subject":"S","title":"T","body":"Hello.\\n\\nGrace and peace to you,","signoff":"x"}').body.includes('Grace') && NL.parseDraft('{"subject":"S","title":"T","body":"Hi","signoff":"Tell one friend about it."}').signoff === 'Tell one friend about it.');
globalThis.fetch = realFetch;
console.log(`\n${n} checks passed`);
