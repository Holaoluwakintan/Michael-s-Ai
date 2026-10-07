// v5.1 tests: file reading. Real fixtures (text PDF, scanned image-only PDF, DOCX, TXT, XLSX, PPTX, locked PDF, photo),
// sent through processMessage in the test ctx (nothing reaches WhatsApp; state lives under wa-test/ in the real Blob store, cleaned at the end).
// Gemini is mocked for the deterministic checks; LIVE=1 adds real Gemini calls for the text PDF and the scanned PDF (prints the summaries).
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
// v7: keep SB_URL/SCHED_KEY: the bot's store is Supabase kv now (wa-test/ keys, purged at the end)
const realFetch = globalThis.fetch;
let calls = [], live = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('generativelanguage') && !live) {
    const model = u.match(/models\/([^:]+)/)[1];
    const body = JSON.parse(opts.body);
    const parts = body.contents.at(-1).parts;
    const user = parts.map(p => p.text || '').join('\n');
    const inline = parts.filter(p => p.inline_data).map(p => p.inline_data.mime_type);
    calls.push({ model, user, inline, sys: body.systemInstruction.parts[0].text, max: body.generationConfig.maxOutputTokens });
    const okr = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }), { status: 200 });
    if (user.includes('===TEXT===')) return okr('TITLE: Youth Retreat Notice\n*A youth retreat notice* 🏕️\n- Hilltop Camp, Ibadan, 14–16 Nov 2026\n- Fee: 5,000 naira, closes 31 Oct\n===TEXT===\nChurch Youth Retreat 2026 - Notice\nDear brethren,\nOur youth retreat holds on Friday 14 November to Sunday 16 November 2026 at Hilltop Camp, Ibadan.\nRegistration fee is 5,000 naira per person.');
    if (user.includes('write between 1 and 5 short, standalone facts')) return okr('- The Blossom Readers Club meets on Saturdays at 5pm WAT on Google Meet.\n- The Blossom Readers Club goal for October 2026 is 150 members and 40 reviews.');
    if (user.includes('FILE TEXT')) { const t = user.split('"""')[1].trim(); return okr(`*Summary of the file* 📄\n- starts with: ${t.slice(0, 60)}\n- ${user.includes("Michael's question") ? 'ANSWERED-QUESTION' : 'plain summary'}`); }
    return okr(`answer from ${model}`);
  }
  return realFetch(url, opts);
};
const m = await import('./api/whatsapp.js');
const v = await import('./api/_v5.js');
const F = await import('./api/_files.js');
const OWNER = '2348148034092';
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
let n = 0;
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
const fx = f => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url));
const say = async (text, c = ctx()) => { const r = await m.processMessage({ from: OWNER, id: 'wamid.v51t' + Date.now() + (n++), type: 'text', text: { body: text } }, 'T', c); return { r, c, sent: texts(c) }; };
const sendDoc = async (file, { mime, caption, buf, filename } = {}, c = ctx()) => {
  const b = buf || fx(file);
  const msg = { from: OWNER, id: 'wamid.v51d' + Date.now() + (n++), type: 'document', document: { id: 'test-media', filename: filename ?? file, mime_type: mime || 'application/octet-stream', _test_b64: b.toString('base64'), ...(caption ? { caption } : {}) } };
  const r = await m.processMessage(msg, 'T', c); return { r, c, sent: texts(c) };
};
const sendPhoto = async (file, caption, c = ctx()) => {
  const msg = { from: OWNER, id: 'wamid.v51p' + Date.now() + (n++), type: 'image', image: { id: 'test-media', mime_type: 'image/jpeg', _test_b64: fx(file).toString('base64'), ...(caption ? { caption } : {}) } };
  const r = await m.processMessage(msg, 'T', c); return { r, c, sent: texts(c) };
};
let pass = 0; const ok = (name, cond) => { assert.ok(cond, name); pass++; console.log('✔', name); };
const st = () => m.loadState(OWNER, ctx());
{ const { cleanTest } = await import('./t_store.mjs'); await cleanTest(); }   // fresh sandbox
await say('/new');

// ---- 1. pure extraction units ----
{ const r = await F.extractText(fx('club-plan.pdf'), 'pdf');
  ok('unpdf pulls the text layer from a real 2-page PDF', r.ok && r.pages === 2 && !r.needsOcr && r.text.includes('Blossom Readers Club') && r.text.includes('Notes for hosts'));
  const s = await F.extractText(fx('retreat-scan.pdf'), 'pdf');
  ok('image-only (scanned) PDF -> no text, flagged for OCR', s.ok && s.needsOcr && s.text.length < 40);
  const l = await F.extractText(fx('locked.pdf'), 'pdf');
  ok('password-protected PDF -> LOCKED', !l.ok && l.code === 'LOCKED');
  ok('DOCX: paragraphs + table rows from word/document.xml', F.docxText(fx('launch-checklist.docx')).includes('Launch date: Saturday 21 November 2026') && F.docxText(fx('launch-checklist.docx')).includes('WhatsApp channel | Michael'));
  ok('XLSX: sheet name, shared + inline strings', /Sheet: October[\s\S]*New mercy today \| Facebook[\s\S]*WhatsApp & X/.test(F.xlsxText(fx('content-bank.xlsx'))));
  ok('PPTX: slide text in order', /Slide 1:\nFaith that finishes\nHebrews 12:2\n\nSlide 2:\nRun with patience/.test(F.pptxText(fx('talk.pptx'))));
  ok('fileKind by mime and by name', F.fileKind('application/pdf', 'x') === 'pdf' && F.fileKind('application/octet-stream', 'Plan.DOCX') === 'docx' && F.fileKind('text/csv', 'a.csv') === 'text' && F.fileKind('application/msword', 'a.doc') === 'doc-old' && F.fileKind('application/zip', 'a.zip') === 'unsupported' && F.fileKind('image/png', '') === 'image');
  const ch = F.chunkText(fs.readFileSync(new URL('./fixtures/long.txt', import.meta.url), 'utf8'));
  ok(`chunkText: ${ch.length} chunks, all ≤ ${F.CHUNK}, split on line ends, nothing lost`, ch.every(c => c.length <= F.CHUNK) && ch.every(c => /\.$/.test(c.trim())) && ch.join('').replace(/\s/g, '').length === fs.readFileSync(new URL('./fixtures/long.txt', import.meta.url), 'utf8').replace(/\s/g, '').length); }

// ---- 2. text PDF through the bot ----
calls = [];
let x = await sendDoc('club-plan.pdf', { mime: 'application/pdf' });
let s = await st();
console.log('   text-PDF reply (mock model):\n' + x.sent.at(-1).split('\n').map(l => '     ' + l).join('\n'));
ok('text PDF: one Gemini call, text only (no inline PDF), extracted text in the prompt', calls.length === 1 && calls[0].inline.length === 0 && calls[0].user.includes('Blossom Readers Club') && calls[0].user.includes('club-plan.pdf (PDF, 2 pages)'));
ok('text PDF: summary + save line + full text line + page count', x.sent.length === 1 && x.sent[0].includes('Reply *save* to add this to my knowledge, or ask me anything about it.') && x.sent[0].includes('*full text*') && x.sent[0].includes('2 pages'));
ok('text PDF: kept as the last-read doc', s.lastRead.kind === 'file-pdf' && s.lastRead.title === 'club-plan.pdf' && s.lastRead.text.includes('Week 2') && s.lastRead.method === 'text' && s.lastRead.awaiting === true);
ok('history records the file and the summary', s.history.at(-2).text.startsWith('[file club-plan.pdf]') && s.history.at(-1).text.startsWith('Summary of the file "club-plan.pdf"'));

// follow-up question uses the file as context
calls = [];
x = await say('when do they meet?');
ok('follow-up question gets the file text as context', calls.length === 1 && calls[0].user.includes("Tab's file reader") && calls[0].user.includes('5pm WAT') && calls[0].user.includes('when do they meet?'));

// save -> facts
calls = [];
x = await say('save');
const kb1 = await m.loadKB(OWNER, ctx());
ok('save stores 1–5 facts from the file', /^✅ Saved 2 facts from club-plan.pdf/.test(x.sent[0]) && kb1.facts.some(f => f.t.includes('150 members')));

// ---- 3. scanned PDF -> Gemini inline ----
calls = [];
x = await sendDoc('retreat-scan.pdf', { mime: 'application/pdf' });
s = await st();
ok('scanned PDF: sent inline to Gemini as application/pdf, lite model first, big output budget', calls.length === 1 && calls[0].inline[0] === 'application/pdf' && calls[0].model === v.LITE[0] && calls[0].max === 8192);
ok('scanned PDF: summary from the OCR call (no second call), says it was read from the scan', x.sent[0].includes('Hilltop Camp') && x.sent[0].includes('read from the scan') && x.sent[0].includes('Reply *save*') && !x.sent[0].includes('===TEXT==='));
ok('scanned PDF: transcribed text stored for follow-ups / full text', s.lastRead.method === 'ocr' && s.lastRead.text.includes('Registration fee is 5,000 naira') && !s.lastRead.text.includes('TITLE:'));

// ---- 4. DOCX + TXT + XLSX ----
calls = [];
x = await sendDoc('launch-checklist.docx', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
ok('DOCX: text pulled (incl. table) and summarised', calls.length === 1 && calls[0].user.includes('Price: 3,000 naira on Selar') && calls[0].user.includes('WhatsApp channel | Michael') && x.sent[0].includes('Reply *save*'));
calls = [];
x = await sendDoc('notes.txt', { mime: 'text/plain' });
ok('TXT: read directly and summarised', calls.length === 1 && calls[0].user.includes('Walking by faith') && x.sent[0].includes('starts with: Sermon notes'));
calls = [];
x = await sendDoc('content-bank.xlsx', { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
ok('XLSX: rows read and summarised', calls.length === 1 && calls[0].user.includes('He leads me | WhatsApp & X'));

// ---- 5. caption = question ----
calls = [];
x = await sendDoc('club-plan.pdf', { mime: 'application/pdf', caption: 'How many members do they want?' });
ok('caption on a document is a question about it', calls.length === 1 && calls[0].user.includes("Michael's question about it: How many members do they want?") && x.sent[0].includes('ANSWERED-QUESTION'));
calls = [];
x = await sendDoc('retreat-scan.pdf', { mime: 'application/pdf', caption: 'how much is the fee?' });
ok('caption question on a scan goes into the OCR prompt', calls.length === 1 && calls[0].user.includes('His question: how much is the fee?') && calls[0].inline[0] === 'application/pdf');
calls = [];
x = await sendDoc('notes.txt', { mime: 'text/plain', caption: 'read this' });
ok('"read this" caption is not treated as a question', calls.length === 1 && !calls[0].user.includes("Michael's question"));

// ---- 6. full text ----
calls = [];
x = await say('full text');                                    // last doc = notes.txt (short)
ok('"full text" on a short file: one message, the whole text, no Gemini call', calls.length === 0 && x.sent.length === 1 && x.sent[0].includes('Point 3: Faith finishes.') && x.sent[0].includes("That's the whole text"));
calls = [];
x = await sendDoc('long.txt', { mime: 'text/plain', caption: 'full text' });
s = await st();
const N = F.chunkText(s.lastRead.text).length;
ok(`caption "full text" on a 55k file: no summary call, 5 messages, each ≤ 3500 chars (of ${N} parts)`, calls.length === 0 && x.sent.length === 5 && x.sent.every(t => t.length <= 3500) && x.sent[0].includes('part 1/' + N));
ok('…then tells him to reply more / ask questions', x.sent[4].includes('Reply *more*') && x.sent[4].includes('ask me anything'));
ok('text is capped at 30k characters', s.lastRead.text.length === 30000 && s.lastRead.cut === true && s.lastRead.len > 55000);
x = await say('more');
ok('"more" sends the next parts and says what was kept', x.sent.length === N - 5 && x.sent.every(t => t.length <= 3500) && x.sent.at(-1).includes(`first 30,000 of ${s.lastRead.len.toLocaleString('en-US')} characters`));
calls = [];
x = await say('more');
ok('"more" only works right after a full-text send', calls.length === 1);
x = await say('text');
ok('bare "text" after a recent file = full text', x.sent.length === 5 && x.sent[0].includes('part 1/'));

// ---- 7. pictures ----
calls = [];
x = await sendPhoto('retreat-photo.jpg', 'read this');
s = await st();
ok('photo + "read this" -> OCR inline as image/jpeg, kept as last-read', calls.length === 1 && calls[0].inline[0] === 'image/jpeg' && calls[0].user.includes('===TEXT===') && s.lastRead.kind === 'file-image' && s.lastRead.title === 'Youth Retreat Notice');
calls = [];
x = await sendPhoto('retreat-photo.jpg', 'what a nice day');
ok('photo with an ordinary caption keeps the old picture chat path', calls.length === 1 && calls[0].user.includes('(Michael sent this picture with the caption:) what a nice day') && !calls[0].user.includes('===TEXT==='));
calls = [];
x = await sendDoc('retreat-photo.jpg', { mime: 'image/jpeg' });
ok('a picture sent as a document goes to OCR', calls.length === 1 && calls[0].inline[0] === 'image/jpeg' && calls[0].user.includes('===TEXT==='));

// ---- 8. friendly errors ----
calls = [];
x = await sendDoc('locked.pdf', { mime: 'application/pdf' });
ok('password-protected PDF: clear message, no AI call', calls.length === 0 && x.sent[0].startsWith('🔒') && x.sent[0].includes('Save as PDF'));
x = await sendDoc('old.doc', { mime: 'application/msword', buf: Buffer.from('xx') });
ok('old .doc: asks for .docx/PDF', x.sent[0].includes('old-format Word') && x.sent[0].includes('.docx'));
x = await sendDoc('app.zip', { mime: 'application/zip', buf: Buffer.from('PK') });
ok('unsupported type: lists what works', x.sent[0].includes("can't read") && x.sent[0].includes('PDF') && x.sent[0].includes('Word'));
x = await sendDoc('big.pdf', { mime: 'application/pdf', buf: Buffer.alloc(F.MAX_DOWNLOAD + 1024) });
ok('too-big file: says the size and the limit', x.sent[0].includes('25 MB') && x.sent[0].includes('That file is'));
x = await sendDoc('broken.pdf', { mime: 'application/pdf', buf: Buffer.from('%PDF-1.4 garbage garbage') });
ok('damaged PDF: friendly message', /couldn't open "broken.pdf"/.test(x.sent[0]));
calls = [];
x = await sendDoc('blank.txt', { mime: 'text/plain', buf: Buffer.from('   \n  ') });
ok('empty file: says there is no text', calls.length === 0 && x.sent[0].includes('no readable text'));

// ---- 9. storage writes: a file costs the same writes as a normal message ----
{ const { kvWrites } = await import('./t_store.mjs');   // v7: the store is Supabase kv now; count its writes
  const textW = [...new Set(await kvWrites(() => say('hello there friend')))];
  const fileW = [...new Set(await kvWrites(() => sendDoc('notes.txt', { mime: 'text/plain' })))];
  ok(`a file message writes the same blobs as a text message (text: ${textW.join(',')} | file: ${fileW.join(',')})`, fileW.length === textW.length && fileW.length === 1 && fileW[0].endsWith(OWNER + '.json')); }

// ---- 10. usage, help, health ----
x = await say('usage');
console.log('   usage:\n' + x.sent.at(-1).split('\n').map(l => '     ' + l).join('\n'));
ok('usage counts files read + full-text sends', /Files read: \d+ \(full text sent \d+×\)/.test(x.sent.at(-1)));
x = await say('/help');
ok('/help mentions files and full text, still short', x.sent[0].includes('*Files*') && x.sent[0].includes('*full text*') && x.sent[0].length < 1400);
{ const h = await (await m.GET(new Request('http://x/api/whatsapp?health=1'))).json();
  ok('health: build v5.1, file_read true', /^v5\.1$|^v[6-9]/.test(h.build) && h.file_read === true && h.read_links === true && h.reminders === true); }

// ---- 11. LIVE Gemini (LIVE=1): real summaries of the text PDF and the scanned PDF ----
if (process.env.LIVE === '1') {
  live = true;
  for (const [f, cap] of [['club-plan.pdf'], ['retreat-scan.pdf'], ['retreat-scan.pdf', 'How much is registration and when does it close?']]) {
    const t0 = Date.now();
    x = await sendDoc(f, { mime: 'application/pdf', caption: cap });
    s = await st();
    console.log(`\n   LIVE ${f}${cap ? ' + caption "' + cap + '"' : ''} (${Date.now() - t0} ms, method ${s.lastRead.method}):\n` + x.sent.at(-1).split('\n').map(l => '     ' + l).join('\n'));
    fs.writeFileSync(`/home/user/tab/files/michael-ai/v51-live-${f.replace('.pdf', '')}${cap ? '-question' : ''}.txt`, x.sent.at(-1) + '\n\n--- stored text ---\n' + s.lastRead.text);
    if (f === 'club-plan.pdf') ok('LIVE text PDF summary mentions the club', /Readers Club|reading/i.test(x.sent.at(-1)) && x.sent.at(-1).includes('Reply *save*'));
    else if (!cap) ok('LIVE scanned PDF: real OCR text has the details', s.lastRead.method === 'ocr' && /5,?000/.test(s.lastRead.text) && /Hilltop/i.test(s.lastRead.text) && /retreat/i.test(x.sent.at(-1)));
    else ok('LIVE caption question on the scan answered (5,000 / 31 October)', /5,?000/.test(x.sent.at(-1)) && /31/.test(x.sent.at(-1)));
  }
  x = await say('full text'); console.log('   LIVE full text of the scan:\n' + x.sent.join('\n---\n').split('\n').map(l => '     ' + l).join('\n'));
  live = false;
}

console.log(`\n${pass} checks passed`);
const { cleanTest } = await import('./t_store.mjs');
console.log(`cleaned ${await cleanTest()} test records`);
