import crypto from 'node:crypto';
import SYSTEM from './_prompt.js';

export const config = { maxDuration: 60 };

const CHAINS = {
  flash: ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-flash-lite-latest'],
  lite: ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite'],
};
const LABEL = { 'gemini-flash-lite-latest': 'Flash-Lite', 'gemini-3.1-flash-lite': 'Flash-Lite' };
const MEMORY_LIMIT = 4000;
const DEADLINE_MS = 55000;

export function passOk(given) {
  const want = process.env.APP_PASSCODE || '';
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  return want.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function toContents(messages) {
  const out = [];
  for (const m of (messages || []).slice(-30)) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
    const role = m.role === 'user' ? 'user' : 'model';
    const text = m.text.slice(0, 12000);
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += '\n\n' + text;
    else out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export function memoryBlock(memory) {
  let items = Array.isArray(memory) ? memory : (typeof memory === 'string' ? memory.split('\n') : []);
  items = items.map(x => String(typeof x === 'object' && x ? x.text : x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const kept = [];
  let used = 0;
  for (const t of items) {
    const line = '- ' + t.slice(0, 600);
    if (used + line.length + 1 > MEMORY_LIMIT) break;
    kept.push(line); used += line.length + 1;
  }
  if (!kept.length) return '';
  return '\n\n# WHAT MICHAEL HAS TAUGHT YOU (his saved memory: facts are true, instructions are standing orders; "I/my" = Michael)\n' + kept.join('\n') + '\n';
}

function systemText(memory) {
  const now = new Date();
  const day = now.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
  return SYSTEM + `\n# NOW\nToday is ${day}, ${time} in Nigeria (Africa/Lagos).\n` + memoryBlock(memory);
}

async function callGemini(model, contents, sys, { thinking }, started) {
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents,
    generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
  };
  if (thinking) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  // give up on a model that has not started answering in 20 s (or past the overall deadline)
  const ctl = new AbortController();
  const wait = Math.max(1000, Math.min(20000, DEADLINE_MS - 8000 - (Date.now() - started)));
  const timer = setTimeout(() => ctl.abort(), wait);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    return { ok: false, status: 504, text: async () => 'timeout', abort: true };
  } finally { clearTimeout(timer); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!passOk(req.headers['x-passcode'])) {
    await new Promise(r => setTimeout(r, 800));
    res.status(401).json({ error: 'Wrong passcode' }); return;
  }
  let payload = req.body;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  payload = payload || {};
  const contents = toContents(payload.messages);
  if (!contents.length) { res.status(400).json({ error: 'Empty message' }); return; }
  const chain = CHAINS[payload.model] || CHAINS.flash;
  const sys = systemText(payload.memory);

  let upstream = null, used = null, notes = [], lastErr = '';
  const started = Date.now();
  for (const model of chain) {
    if (Date.now() - started > DEADLINE_MS - 12000) break;
    const opts = { thinking: true };
    let r = await callGemini(model, contents, sys, opts, started);
    if (r.status === 400) { opts.thinking = false; r = await callGemini(model, contents, sys, opts, started); }
    if (r.ok) { upstream = r; used = model; break; }
    const t = await r.text().catch(() => '');
    lastErr = `${r.status}`;
    if (r.status === 429) notes.push('quota');
    else if (r.status === 503 || r.status === 500 || r.status === 504) notes.push('busy');
    else { lastErr = `${r.status}: ${t.slice(0, 300)}`; }
  }

  res.writeHead(upstream ? 200 : 502, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  const send = o => res.write(JSON.stringify(o) + '\n');
  if (!upstream) {
    const quota = notes.includes('quota');
    send({ t: 'err', v: quota ? 'Your free daily Gemini quota is used up for now. It resets daily, try again later.' : 'Gemini is busy right now. Please try again in a minute.', detail: lastErr });
    res.end(); return;
  }
  let note = '';
  if (notes.length && LABEL[used] && payload.model !== 'lite') note = notes.includes('quota') ? 'Flash hit its free limit, so Flash-Lite answered this one.' : 'Flash was busy, so Flash-Lite answered this one.';
  send({ t: 'meta', model: used, label: LABEL[used] || 'Flash', note });

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const sources = new Map();
  const handle = line => {
        line = line.trim();
        if (!line.startsWith('data:')) return;
        try {
          const j = JSON.parse(line.slice(5));
          const cand = j.candidates?.[0] || {};
          const parts = cand.content?.parts || [];
          const text = parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
          if (text) send({ t: 'd', v: text });
          for (const c of cand.groundingMetadata?.groundingChunks || []) {
            if (c.web?.uri && sources.size < 4) sources.set(c.web.uri, c.web.title || c.web.uri);
          }
          const fr = cand.finishReason;
          if (fr && fr !== 'STOP') send({ t: 'fin', v: fr });
        } catch {}
  };
  const stop = setTimeout(() => { try { reader.cancel(); } catch {} }, Math.max(3000, DEADLINE_MS - (Date.now() - started)));
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    buf += dec.decode();
    if (buf.trim()) handle(buf);
  } catch (e) { send({ t: 'err', v: 'The connection dropped mid-answer.' }); }
  clearTimeout(stop);
  if (sources.size) send({ t: 'src', v: [...sources].map(([url, title]) => ({ url, title })) });
  send({ t: 'end' });
  res.end();
}
