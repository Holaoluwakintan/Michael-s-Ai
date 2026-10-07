// v7: LIGHT VIDEO / MEDIA WORK with ffmpeg (ffmpeg-static, run inside the /api/media function: 300 s, 2 GB).
// trim a clip, compress it, add a caption/text overlay, turn an image + audio into a video, extract the audio as MP3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const trim = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
export const LIMITS = { inMB: 16, outMB: 15.5, maxSec: 180, imgAudioSec: 300, ffmpegMs: 230000 };
export const M_NEED = { m_run: 60e3 };
let FF = null;
export async function ffmpegPath() {
  if (FF) return FF;
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return (FF = process.env.FFMPEG_PATH);
  const mod = await import('ffmpeg-static');
  const p = mod.default || mod;
  if (!p || !fs.existsSync(p)) throw new Error('ffmpeg binary missing');
  try { fs.chmodSync(p, 0o755); } catch {}
  return (FF = p);
}
export const fontFile = () => fileURLToPathSafe(new URL('../assets/DejaVuSans-Bold.ttf', import.meta.url));
function fileURLToPathSafe(u) { return decodeURIComponent(u.pathname); }
export function run(args, { ms = LIMITS.ffmpegMs } = {}) {
  return new Promise(async (resolve) => {
    let bin; try { bin = await ffmpegPath(); } catch (e) { return resolve({ ok: false, err: e.message }); }
    execFile(bin, ['-hide_banner', '-nostdin', '-y', ...args], { timeout: ms, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, killed: !!err?.killed, err: err ? trim(String(stderr || err.message).split('\n').filter(Boolean).slice(-4).join(' | '), 400) : '', stderr: String(stderr || '') });
    });
  });
}
export async function probe(file) {
  const r = await run(['-i', file], { ms: 20000 });     // exits non-zero (no output file) but prints the stream info
  const s = r.stderr || '';
  const d = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = s.match(/Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  return { duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : null, video: !!v, audio: /Stream #[^\n]*Audio:/.test(s), w: v ? +v[1] : null, h: v ? +v[2] : null };
}

export * from './_mediacmd.js';
import { wrapCaption } from './_mediacmd.js';
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const SCALE = (max) => `scale='if(gt(iw,ih),min(${max * 16 / 9 | 0},iw),-2)':'if(gt(iw,ih),-2,min(${max * 16 / 9 | 0},ih))'`;
export function buildArgs(op, inp, out, o = {}) {
  switch (op) {
    case 'trim': return ['-ss', String(o.start), '-to', String(o.end), '-i', inp, ...ENC, '-crf', '24', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-b:a', '128k', out];
    case 'compress': return ['-i', inp, ...ENC, '-crf', String(o.crf || 30), '-vf', `scale='min(${o.max || 720},iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2`, '-r', '30', '-c:a', 'aac', '-b:a', '80k', '-ac', '2', out];
    case 'caption': {
      const y = o.pos === 'top' ? 'h*0.07' : o.pos === 'center' ? '(h-text_h)/2' : 'h-text_h-h*0.09';
      const vf = `scale=trunc(iw/2)*2:trunc(ih/2)*2,drawtext=fontfile='${o.font}':textfile='${o.textFile}':fontsize=h/16:fontcolor=white:line_spacing=8:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=${y}`;
      return ['-i', inp, ...ENC, '-crf', '24', '-vf', vf, '-c:a', 'copy', out];
    }
    case 'audio': return ['-i', inp, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', out];
    case 'imgaudio': return ['-loop', '1', '-framerate', '2', '-i', inp, '-i', o.audio, '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1080,iw)':-2,scale=trunc(iw/2)*2:trunc(ih/2)*2", '-r', '2', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', '-t', String(o.secs || LIMITS.imgAudioSec), out];
  }
  throw new Error('unknown op ' + op);
}
const extOf = mime => /png/.test(mime) ? 'png' : /jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : /ogg|opus/.test(mime) ? 'ogg' : /mpeg|mp3/.test(mime) ? 'mp3' : /aac|m4a|mp4a/.test(mime) ? 'm4a' : /amr/.test(mime) ? 'amr' : /3gpp/.test(mime) ? '3gp' : /quicktime/.test(mime) ? 'mov' : /webm/.test(mime) ? 'webm' : 'mp4';

// Process one media job end to end. inputs: {video|image|audio: {buf, mime}} ; returns {ok, buf, mime, name, note} or {ok:false, error}
export async function process1(cmd, inputs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mai-'));
  try {
    const main = cmd.op === 'imgaudio' ? inputs.image : inputs.video;
    if (!main?.buf) return { ok: false, error: cmd.op === 'imgaudio' ? 'I need a picture first: send the picture, then the audio/voice note, then *make video*' : 'send the video first' };
    if (main.buf.length > LIMITS.inMB * 1048576) return { ok: false, error: `that file is over ${LIMITS.inMB} MB` };
    const inp = path.join(dir, 'in.' + extOf(main.mime));
    fs.writeFileSync(inp, main.buf);
    const info = cmd.op === 'imgaudio' ? { duration: null, video: true } : await probe(inp);
    if (cmd.op !== 'imgaudio' && !info.video && cmd.op !== 'audio') return { ok: false, error: 'I couldn\'t read that as a video' };
    if (cmd.op !== 'imgaudio' && cmd.op !== 'audio' && info.duration && info.duration > LIMITS.maxSec && cmd.op !== 'trim') return { ok: false, error: `that video is ${Math.round(info.duration)} s; I can handle up to ${LIMITS.maxSec / 60} minutes (trim it first, e.g. *trim 0:00-2:30*)` };
    const o = { ...cmd };
    if (cmd.op === 'trim') {
      if (cmd.last != null && info.duration) { o.start = Math.max(0, info.duration - cmd.last); o.end = info.duration; }
      if (info.duration && o.start >= info.duration) return { ok: false, error: `the video is only ${Math.round(info.duration)} s long` };
      if (info.duration) o.end = Math.min(o.end, info.duration);
      if (o.end - o.start > LIMITS.maxSec) return { ok: false, error: `keep the clip under ${LIMITS.maxSec / 60} minutes` };
    }
    if (cmd.op === 'caption') { o.textFile = path.join(dir, 'cap.txt'); fs.writeFileSync(o.textFile, wrapCaption(cmd.text)); o.font = fontFile(); }
    if (cmd.op === 'imgaudio') {
      if (!inputs.audio?.buf) return { ok: false, error: 'I need the audio too: send a voice note or audio file, then *make video*' };
      o.audio = path.join(dir, 'a.' + extOf(inputs.audio.mime)); fs.writeFileSync(o.audio, inputs.audio.buf);
      const ai = await probe(o.audio);
      if (!ai.audio) return { ok: false, error: 'I couldn\'t read that audio' };
      o.secs = Math.min(LIMITS.imgAudioSec, Math.ceil(ai.duration || LIMITS.imgAudioSec));
    }
    const out = path.join(dir, cmd.op === 'audio' ? 'out.mp3' : 'out.mp4');
    let r = await run(buildArgs(cmd.op, inp, out, o));
    if (!r.ok && cmd.op === 'caption' && /Stream specifier|copy|codec/i.test(r.err)) {   // audio stream that can't be copied: re-encode it
      const a = buildArgs(cmd.op, inp, out, o); a.splice(a.indexOf('copy'), 1, 'aac'); r = await run(a);
    }
    if (!r.ok) return { ok: false, error: r.killed ? 'it took too long (try a shorter clip)' : 'ffmpeg failed: ' + trim(r.err, 160) };
    let buf = fs.readFileSync(out), note = '';
    if (cmd.op !== 'audio' && buf.length > LIMITS.outMB * 1048576) {          // too big for WhatsApp: squeeze once more
      const out2 = path.join(dir, 'out2.mp4');
      const r2 = await run(buildArgs('compress', out, out2, { crf: 32, max: 480 }));
      if (r2.ok) { buf = fs.readFileSync(out2); note = 'I shrank it to 480p so WhatsApp takes it.'; }
      if (buf.length > LIMITS.outMB * 1048576) return { ok: false, error: 'the result is still over 16 MB (WhatsApp\'s limit); trim it shorter first' };
    }
    const outInfo = cmd.op === 'audio' ? await probe(out) : await probe(fs.existsSync(path.join(dir, 'out2.mp4')) && note ? path.join(dir, 'out2.mp4') : out);
    return { ok: true, buf, mime: cmd.op === 'audio' ? 'audio/mpeg' : 'video/mp4', name: cmd.op === 'audio' ? 'audio.mp3' : 'video.mp4', inBytes: main.buf.length, duration: outInfo.duration, w: outInfo.w, h: outInfo.h, note };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}
export function doneCaption(cmd, res) {
  const mb = b => (b / 1048576).toFixed(1) + ' MB';
  const dur = res.duration ? ` · ${Math.round(res.duration)} s` : '';
  const base = { trim: `✂️ Trimmed${cmd.start != null && cmd.end != null ? ` (${cmd.start}s–${Math.round(cmd.end)}s)` : ''}`, compress: `🗜️ Compressed: ${mb(res.inBytes)} → ${mb(res.buf.length)}`, caption: '🔤 Caption added', audio: '🎵 Audio extracted (MP3)', imgaudio: '🎬 Your video is ready' }[cmd.op] || '✅ Done';
  return `${base}${dur}${res.w ? ` · ${res.w}x${res.h}` : ''}${res.note ? `\n_${res.note}_` : ''}`;
}
