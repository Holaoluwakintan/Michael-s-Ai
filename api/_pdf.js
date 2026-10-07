// v7: a clean A4 report PDF (title, date, headings, bullets, numbered sources) with DejaVu Sans, so ₦, quotes and accents render.
import fs from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const font = name => fs.readFileSync(new URL(`../assets/${name}`, import.meta.url));
// strip emoji / symbols the font can't draw (keeps letters, digits, punctuation, ₦, €, £, accents)
export function pdfSafe(s) {
  return String(s ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, '').replace(/\t/g, '  ').replace(/[\u0000-\u0008\u000B-\u001F]/g, '');
}
function wrap(text, f, size, width) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/).filter(w => w !== '');
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (f.widthOfTextAtSize(test, size) <= width || !line.trim()) {
        if (f.widthOfTextAtSize(test, size) > width && !line.trim()) {   // one very long word (a URL): hard-break it
          let chunk = '';
          for (const ch of w) { if (f.widthOfTextAtSize(chunk + ch, size) > width) { out.push(chunk); chunk = ''; } chunk += ch; }
          line = chunk;
        } else line = test;
      } else { out.push(line.trimEnd()); line = w.trimStart(); }
    }
    out.push(line.trimEnd());
  }
  return out;
}
// blocks: [{type:'h1'|'h2'|'p'|'li'|'src', text}]
export function parseReport(md) {
  const blocks = [];
  for (let raw of String(md || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const t = l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,;:!?])/g, '$1$2').replace(/__(.+?)__/g, '$1');
    if (/^#\s+/.test(t)) blocks.push({ type: 'h1', text: t.replace(/^#\s+/, '') });
    else if (/^#{2,4}\s+/.test(t)) blocks.push({ type: 'h2', text: t.replace(/^#{2,4}\s+/, '') });
    else if (/^[-•*]\s+/.test(t)) blocks.push({ type: 'li', text: t.replace(/^[-•*]\s+/, '') });
    else if (/^\d+[.)]\s+/.test(t)) blocks.push({ type: 'li', text: t, numbered: true });
    else blocks.push({ type: 'p', text: t });
  }
  return blocks;
}
export async function makePdf({ title, subtitle = '', body = '', sources = [] }) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(font('DejaVuSans.ttf'), { subset: true });
  const bold = await doc.embedFont(font('DejaVuSans-Bold.ttf'), { subset: true });
  doc.setTitle(pdfSafe(title)); doc.setAuthor('Michael AI'); doc.setCreator('Michael AI research');
  const W = 595.28, Hh = 841.89, M = 54, CW = W - 2 * M;
  let page = doc.addPage([W, Hh]), y = Hh - M, pageNo = 1;
  const ink = rgb(0.1, 0.1, 0.13), muted = rgb(0.42, 0.42, 0.48), accent = rgb(0.11, 0.3, 0.85);
  const footer = () => page.drawText(`Michael AI research · page ${pageNo}`, { x: M, y: 28, size: 8, font: reg, color: muted });
  const need = h => { if (y - h < M) { footer(); page = doc.addPage([W, Hh]); pageNo++; y = Hh - M; } };
  const draw = (text, { f = reg, size = 10.5, color = ink, indent = 0, gap = 4, lead = 1.45 } = {}) => {
    const lines = wrap(pdfSafe(text), f, size, CW - indent);
    for (const ln of lines) { need(size * lead); page.drawText(ln, { x: M + indent, y: y - size, size, font: f, color }); y -= size * lead; }
    y -= gap;
  };
  draw(title, { f: bold, size: 20, color: accent, gap: 2, lead: 1.25 });
  if (subtitle) draw(subtitle, { size: 9.5, color: muted, gap: 10 });
  page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.7, color: rgb(0.85, 0.86, 0.9) });
  y -= 10;
  for (const b of parseReport(body)) {
    if (b.type === 'h1') { y -= 6; draw(b.text, { f: bold, size: 15, color: accent, gap: 4, lead: 1.3 }); }
    else if (b.type === 'h2') { y -= 4; draw(b.text, { f: bold, size: 12.5, gap: 3, lead: 1.3 }); }
    else if (b.type === 'li') draw((b.numbered ? '' : '•  ') + b.text, { indent: 12 });
    else draw(b.text, { gap: 6 });
  }
  if (sources.length) {
    y -= 8; draw('Sources', { f: bold, size: 12.5, gap: 3 });
    sources.forEach((s, i) => draw(`[${i + 1}] ${s.title || s.url}\n${s.url}`, { size: 9, color: muted, indent: 0, gap: 3 }));
  }
  footer();
  return Buffer.from(await doc.save());
}
