// v5.1: file reading. Pure-JS text extraction for PDF (unpdf), DOCX/XLSX/PPTX (own tiny unzip on node:zlib), text files.
// Scans / photos / PDFs with little text go to Gemini inline (the caller does that; this module only decides and prepares).
import zlib from 'node:zlib';

export const FILE_CAP = 30000;                        // chars kept per file (state.lastRead.text)
export const MAX_DOWNLOAD = 25 * 1024 * 1024;         // bytes we will download at all
export const MAX_INLINE = 14 * 1024 * 1024;           // bytes we can send inline to Gemini (base64 ≈ 19 MB, under the 20 MB request cap)
export const CHUNK = 3300, MAX_CHUNKS = 5;            // 3300 text + part label + closing line stays ≤ 3500 (one WhatsApp bubble)

const ext = n => (String(n || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
const MB = b => (b / 1048576).toFixed(b < 10485760 ? 1 : 0);
export { MB };

// Which reader handles this file. mime from WhatsApp is often right, sometimes application/octet-stream: fall back to the name.
export function fileKind(mime, filename) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim(), e = ext(filename);
  if (m === 'application/pdf' || e === 'pdf') return 'pdf';
  if (m.includes('wordprocessingml') || e === 'docx') return 'docx';
  if (m.includes('spreadsheetml') || e === 'xlsx') return 'xlsx';
  if (m.includes('presentationml') || e === 'pptx') return 'pptx';
  if (m === 'application/msword' || e === 'doc') return 'doc-old';
  if (m === 'application/vnd.ms-excel' && e !== 'csv' || e === 'xls') return 'xls-old';
  if (m === 'application/vnd.ms-powerpoint' || e === 'ppt') return 'ppt-old';
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(m) || ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(e)) return 'image';
  if (m.startsWith('text/') || ['application/json', 'application/xml', 'application/rtf', 'text/rtf', 'application/x-subrip'].includes(m) ||
      ['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'srt', 'vtt', 'rtf', 'log', 'yml', 'yaml'].includes(e)) return 'text';
  return 'unsupported';
}

// ---------- tiny unzip (central directory; stored + deflate) ----------
export function unzip(buf, want = () => true) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('not a zip'), { code: 'NOT_ZIP' });
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (!want(name)) continue;
    if (flags & 1) throw Object.assign(new Error('encrypted zip entry'), { code: 'LOCKED' });
    const ln = buf.readUInt16LE(loff + 26), lx = buf.readUInt16LE(loff + 28);
    const data = buf.subarray(loff + 30 + ln + lx, loff + 30 + ln + lx + csize);
    out.set(name, method === 0 ? Buffer.from(data) : method === 8 ? zlib.inflateRawSync(data) : Buffer.alloc(0));
  }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeXml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));
const tidy = s => String(s).replace(/\r/g, '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const isOle = buf => buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0;   // D0 CF 11 E0: old Office file, or an encrypted new one

export function docxText(buf) {
  if (isOle(buf)) throw Object.assign(new Error('ole'), { code: 'LOCKED_OR_OLD' });
  const z = unzip(buf, n => /^word\/(document|footnotes|endnotes)\.xml$/.test(n) || /^word\/(header|footer)\d*\.xml$/.test(n));
  const doc = z.get('word/document.xml');
  if (!doc) throw Object.assign(new Error('no word/document.xml'), { code: 'BAD' });
  const conv = xml => decodeXml(xml.toString('utf8')
    .replace(/<w:tc>[\s\S]*?<\/w:tc>/g, c => c.replace(/<\/w:p>(?![\s\S]*<\/w:p>)/, '').replace(/<\/w:p>/g, ' '))   // a table cell's paragraphs stay on one line
    .replace(/<w:tab\/>/g, '\t').replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n')
    .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<[^>]+>/g, ''));
  let t = conv(doc);
  const notes = ['word/footnotes.xml', 'word/endnotes.xml'].map(k => z.get(k)).filter(Boolean).map(conv).join('\n').trim();
  if (notes.length > 20) t += '\n\nNotes:\n' + notes;
  return tidy(t.replace(/ \| \n/g, '\n'));
}

export function xlsxText(buf) {
  if (isOle(buf)) throw Object.assign(new Error('ole'), { code: 'LOCKED_OR_OLD' });
  const z = unzip(buf, n => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const ss = [];
  const sx = z.get('xl/sharedStrings.xml');
  if (sx) for (const si of sx.toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || []) ss.push(decodeXml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join('')));
  const names = ((z.get('xl/workbook.xml') || '').toString('utf8').match(/<sheet [^>]*name="[^"]*"/g) || []).map(s => decodeXml(s.match(/name="([^"]*)"/)[1]));
  const sheets = [...z.keys()].filter(k => k.startsWith('xl/worksheets/')).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const out = [];
  sheets.forEach((k, i) => {
    const rows = [];
    for (const row of z.get(k).toString('utf8').match(/<row[\s\S]*?<\/row>/g) || []) {
      const cells = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const type = (c.match(/\bt="([^"]+)"/) || [])[1];
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const is = (c.match(/<is>([\s\S]*?)<\/is>/) || [])[1];
        let val = type === 's' && v != null ? ss[+v] : is != null ? is.replace(/<[^>]+>/g, '') : v != null ? v : '';
        cells.push(decodeXml(String(val ?? '')).replace(/\s+/g, ' ').trim());
      }
      while (cells.length && !cells.at(-1)) cells.pop();
      if (cells.length) rows.push(cells.join(' | '));
    }
    if (rows.length) out.push(`Sheet: ${names[i] || 'Sheet' + (i + 1)}\n` + rows.join('\n'));
  });
  return tidy(out.join('\n\n'));
}

export function pptxText(buf) {
  if (isOle(buf)) throw Object.assign(new Error('ole'), { code: 'LOCKED_OR_OLD' });
  const z = unzip(buf, n => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const slides = [...z.keys()].filter(k => k.includes('/slides/')).sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  return tidy(slides.map((k, i) => {
    const t = decodeXml(z.get(k).toString('utf8').replace(/<\/a:p>/g, '\n').replace(/<a:br\/>/g, '\n').replace(/<(?!\/?a:t\b)[^>]+>/g, '').replace(/<\/?a:t[^>]*>/g, ''));
    return `Slide ${i + 1}:\n${tidy(t)}`;
  }).join('\n\n'));
}

export function plainText(buf, filename = '', mime = '') {
  let s;
  if (buf[0] === 0xff && buf[1] === 0xfe) s = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); s = b.toString('utf16le'); }
  else s = buf.toString('utf8').replace(/^\uFEFF/, '');
  const e = ext(filename);
  if (e === 'html' || e === 'htm' || /html/.test(mime)) s = decodeXml(s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li|tr|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
  if (e === 'rtf' || /rtf/.test(mime)) s = s.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  if (e === 'srt' || e === 'vtt') s = s.replace(/^\d+\s*$/gm, '').replace(/^[\d:.,]+ --> [\d:.,]+.*$/gm, '').replace(/^WEBVTT.*$/m, '');
  return tidy(s.replace(/\u0000/g, ''));
}

// ---------- PDF ----------
export async function pdfText(buf) {
  const { getDocumentProxy } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf), { isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  } catch (e) {
    if (e && (e.name === 'PasswordException' || /password/i.test(e.message || ''))) throw Object.assign(new Error('password'), { code: 'LOCKED' });
    throw Object.assign(new Error('pdf: ' + (e?.message || e)), { code: 'BAD' });
  }
  const pages = pdf.numPages, texts = [];
  let total = 0;
  for (let i = 1; i <= pages && total < FILE_CAP * 1.5; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let line = '', out = '';
    for (const it of tc.items) { if (!('str' in it)) continue; line += it.str; if (it.hasEOL) { out += line + '\n'; line = ''; } }
    out += line;
    texts.push(tidy(out)); total += out.length;
    page.cleanup?.();
  }
  try { await pdf.destroy(); } catch {}
  const text = tidy(texts.filter(Boolean).map((t, i) => pages > 1 ? `[Page ${i + 1}]\n${t}` : t).join('\n\n'));
  return { text, pages, readPages: texts.length };
}
// A scan has (almost) no text layer: fewer than ~60 real letters per page, or under 120 in total.
export function looksScanned(text, pages = 1) {
  const letters = (String(text).replace(/\[Page \d+\]/g, '').match(/\p{L}/gu) || []).length;
  return letters < 120 || letters < 60 * Math.max(1, pages);
}

// Extract text locally. Returns { ok, text, pages, needsOcr, error, code }.
export async function extractText(buf, kind, { filename = '', mime = '' } = {}) {
  try {
    if (kind === 'pdf') {
      if (buf.subarray(0, 1024).toString('latin1').indexOf('%PDF') < 0) return { ok: false, code: 'BAD', error: 'not a pdf' };
      const r = await pdfText(buf);
      return { ok: true, text: r.text, pages: r.pages, needsOcr: looksScanned(r.text, r.pages) };
    }
    if (kind === 'docx') return { ok: true, text: docxText(buf) };
    if (kind === 'xlsx') return { ok: true, text: xlsxText(buf) };
    if (kind === 'pptx') return { ok: true, text: pptxText(buf) };
    if (kind === 'text') return { ok: true, text: plainText(buf, filename, mime) };
    if (kind === 'image') return { ok: true, text: '', needsOcr: true };
    return { ok: false, code: 'UNSUPPORTED' };
  } catch (e) {
    return { ok: false, code: e.code || 'BAD', error: String(e.message || e).slice(0, 200) };
  }
}

// ---------- Gemini prompts for files ----------
export const OCR_SPLIT = '===TEXT===';
export function ocrPrompt(name, question, isImage) {
  return `Michael sent you ${isImage ? 'a photo/picture' : 'a scanned document'} on WhatsApp${name ? ` ("${name}")` : ''}. It is attached above. Read ALL the text in it, every page, carefully.\n` +
    `Reply in exactly this shape:\n` +
    `TITLE: <a short title for it, max 8 words>\n` +
    (question ? `<answer his question first, using only the document, then a 2–4 bullet summary>\n` :
      `<a WhatsApp-style summary: one bold line saying what it is, then 3–6 short bullets with the key points (dates, names, amounts). Under 150 words.>\n`) +
    `${OCR_SPLIT}\n<the full text exactly as written, in reading order, plain text, keep line breaks; write [unclear] for words you cannot read; mark pages as [Page N] if there are several>\n` +
    (question ? `\nHis question: ${question}\n` : '') +
    `Never invent text that isn't there. If there is no readable text at all, write NO_TEXT after ${OCR_SPLIT}. Do not add a "reply save" line.`;
}
export function parseOcr(out) {
  const s = String(out || '');
  const i = s.indexOf(OCR_SPLIT);
  let head = i >= 0 ? s.slice(0, i) : s, text = i >= 0 ? s.slice(i + OCR_SPLIT.length) : '';
  let title = '';
  head = head.replace(/^\s*TITLE:\s*(.+)\n?/i, (m, t) => { title = t.replace(/[*_]/g, '').trim(); return ''; }).trim();
  text = tidy(text);
  if (/^NO_TEXT\b/.test(text)) text = '';
  return { title: title.slice(0, 120), summary: head, text };
}
export function fileSummaryPrompt(doc, question) {
  return `Michael sent you a file on WhatsApp and I pulled its text out for you.\nFile: ${doc.name} (${doc.kindLabel}${doc.pages ? `, ${doc.pages} page${doc.pages > 1 ? 's' : ''}` : ''})\n` +
    `\nFILE TEXT${doc.cut ? ` (first ${FILE_CAP} characters of ${doc.fullLen})` : ''}:\n"""\n${doc.text}\n"""\n` +
    (question ? `\nMichael's question about it: ${question}\nAnswer his question first using only the file, then a 2–4 bullet summary.` :
      `\nSummarise it for him in WhatsApp style: one bold line saying what it is, then 3–6 short bullets with the most useful points (dates, names, amounts, actions). Keep it under 150 words. If it relates to his own work or goals, add one line on how he can use it.`) +
    `\nDo not invent anything that isn't in the file. Do not add a "reply save" line; I add that.`;
}
export const KIND_LABEL = { pdf: 'PDF', docx: 'Word document', xlsx: 'Excel sheet', pptx: 'PowerPoint', text: 'text file', image: 'picture' };

// "full text" / "text" (bare word only counts right after a file/page was read; the caller checks that)
export const FULL_TEXT_RE = /^\s*\/?(?:full[ -]?text|the full text|whole text|all (?:the )?text|text|the text|send (?:me )?(?:the )?(?:full |whole )?text|pull (?:the )?text|extract (?:the )?text|copy (?:the )?text)\s*(?:please|pls|plz)?\s*[.!?🙏]*\s*$/i;
export const MORE_RE = /^\s*(?:more|next|continue|send more|the rest|rest)\s*(?:please|pls|plz)?\s*[.!?🙏]*\s*$/i;
// caption on a picture that asks to read it (otherwise a picture is "look at this")
export const READ_CAPTION_RE = /^\s*(?:read|scan|ocr|extract|transcribe|type out|pull|copy|full[ -]?text|text|summari[sz]e|what does (?:it|this) say)\b/i;

// Split into ≤size pieces on paragraph / line / sentence / word boundaries.
export function chunkText(text, size = CHUNK) {
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > size) {
    const win = rest.slice(0, size + 1);
    let cut = Math.max(win.lastIndexOf('\n\n'), -1);
    if (cut < size * 0.5) cut = win.lastIndexOf('\n');
    if (cut < size * 0.5) cut = Math.max(win.lastIndexOf('. '), win.lastIndexOf('? '), win.lastIndexOf('! ')) + 1;
    if (cut < size * 0.5) cut = win.lastIndexOf(' ');
    if (cut < size * 0.3) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
