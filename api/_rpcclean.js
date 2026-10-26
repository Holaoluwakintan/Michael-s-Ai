// v9.8.0: RPC caption cleaning (pure; used by tools/rpc-build.mjs to make api/_rpcplan.js and by the tests)
// ---------- caption cleaning (the rules used for the hand deliveries since Oct 19) ----------
// 1. drop the first line that starts with "3-A-DAY PLAN" (and the "POST NNN: <day> · <time> · …" header the Nov 6+ files use)
// 2. drop everything from a line that is exactly "---" (alt text, audience, FLAGS); a story has no "---", its FLAGS paragraph goes
// 3. reels: only the text between "CAPTION (ready to paste)" and "Alt text:"
// 4. reels: "Video created with AI tools." must be in it (added on its own line before the hashtags when missing)
// Nothing else is changed.
export const AI_LINE = 'Video created with AI tools.';
export function cleanCaption(raw, kind = 'feed') {
  let lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const i = lines.findIndex(l => /^\s*3-A-DAY PLAN/.test(l));
  if (i >= 0) lines.splice(i, 1);
  const f = lines.findIndex(l => l.trim() !== '');
  if (f >= 0 && /^\s*POST\s+\d{3}\s*:/.test(lines[f])) lines.splice(f, 1);
  const j = lines.findIndex(l => l.trim() === '---');
  if (j >= 0) lines = lines.slice(0, j);
  if (kind === 'story') { const k = lines.findIndex(l => /^\s*FLAGS\b/.test(l)); if (k >= 0) lines = lines.slice(0, k); }
  let t = lines.join('\n');
  if (kind === 'reel') {
    const A = 'CAPTION (ready to paste)', a = t.indexOf(A);
    if (a >= 0) { const rest = t.slice(a + A.length); const b = rest.indexOf('Alt text:'); t = b >= 0 ? rest.slice(0, b) : rest; }
  }
  t = t.replace(/^\s*\n/, '').replace(/\s+$/, '');
  t = t.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/^\n+/, '');
  if (kind === 'reel' && !t.includes(AI_LINE)) {
    const ls = t.split('\n');
    let h = -1; for (let x = ls.length - 1; x >= 0; x--) if (/^\s*#[\p{L}\p{N}_]/u.test(ls[x])) { h = x; break; }
    if (h >= 0) { while (h > 0 && /^\s*#[\p{L}\p{N}_]/u.test(ls[h - 1])) h--; ls.splice(h, 0, AI_LINE, ''); t = ls.join('\n'); }
    else t = t + '\n\n' + AI_LINE;
  }
  return t;
}

