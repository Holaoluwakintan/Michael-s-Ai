// v7: media chat commands (no ffmpeg here, so the webhook stays small)
// ---------- chat commands ----------
const T = String.raw`(\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?`;
export const TRIM_RE = new RegExp(String.raw`^\s*\/?(?:trim|cut|clip)\s+(?:from\s+)?${T}\s*(?:-|–|to|till|until)\s*${T}\s*$`, 'i');
export const FIRST_RE = /^\s*\/?(?:trim|cut|clip|keep)\s+(?:the\s+)?(first|last)\s+(\d{1,3})\s*(?:s|sec|secs|seconds)\s*$/i;
export const COMPRESS_RE = /^\s*\/?(?:compress|shrink|reduce(?:\s+the)?\s+size|make\s+it\s+smaller|smaller)(?:\s+(?:it|this|the\s+video))?\s*[.!]*\s*$/i;
export const CAPTION_RE = /^\s*\/?(?:caption|text|add\s+text|add\s+caption|subtitle|overlay)(?:\s+(top|bottom|center|middle))?\s*[:：\-–]?\s+([\s\S]{1,200})$/i;
export const AUDIO_RE = /^\s*\/?(?:extract\s+(?:the\s+)?audio|get\s+(?:the\s+)?audio|to\s+mp3|mp3|audio\s+only|convert\s+to\s+mp3)\s*[.!]*\s*$/i;
export const IMGAUDIO_RE = /^\s*\/?(?:make\s+(?:a\s+|it\s+a\s+)?video|image\s*\+\s*audio|picture\s+(?:and|\+)\s+(?:audio|song|voice)\s+(?:to\s+)?video|audio\s+video|lyric\s+video|turn\s+(?:it|them|these)\s+into\s+(?:a\s+)?video)\s*[.!]*\s*$/i;
export function toSec(t) { const p = String(t).split(':').map(Number); return p.reduce((n, x) => n * 60 + x, 0); }
export function parseMediaCmd(text) {
  const t = String(text || '').trim();
  let m;
  if ((m = t.match(TRIM_RE))) { const a = toSec(m[1]), b = toSec(m[2]); return b > a ? { op: 'trim', start: a, end: b } : { op: 'bad', why: 'The end time must be after the start time, e.g. *trim 0:05-0:20*' }; }
  if ((m = t.match(FIRST_RE))) return { op: 'trim', [m[1].toLowerCase()]: +m[2], start: m[1].toLowerCase() === 'first' ? 0 : null, end: m[1].toLowerCase() === 'first' ? +m[2] : null };
  if (COMPRESS_RE.test(t)) return { op: 'compress' };
  if ((m = t.match(CAPTION_RE))) return { op: 'caption', pos: (m[1] || 'bottom').toLowerCase().replace('middle', 'center'), text: m[2].trim() };
  if (AUDIO_RE.test(t)) return { op: 'audio' };
  if (IMGAUDIO_RE.test(t)) return { op: 'imgaudio' };
  return null;
}
export function wrapCaption(text, perLine = 26, maxLines = 4) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > perLine && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines).join('\n');
}
