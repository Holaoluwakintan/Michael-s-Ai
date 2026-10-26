// v8 (7 Oct 2026): more free AI providers beside Gemini (Michael, m:ac1a75b2). OpenAI-compatible chat calls.
//   GROQ_API_KEY        -> https://api.groq.com/openai/v1         (groq:strong = a 70B/120B-class model, groq:fast = a small instant one)
//   OPENROUTER_API_KEY  -> https://openrouter.ai/api/v1          (only ':free' models; or:strong / or:fast)
// A provider is used only when its key is set: with no keys, the bot behaves exactly as before. Model names can be pinned with
// GROQ_STRONG / GROQ_FAST / OPENROUTER_STRONG / OPENROUTER_FAST; otherwise each provider's live model list is read once (cached 6 h)
// and the best match is picked, so a retired model name never breaks the bot. Text only: photos, PDFs, voice notes and embeddings
// stay on Gemini. The system prompt is trimmed (head + tail, PROVIDER_SYS_MAX chars) to fit small free-tier token limits.
const log = (...a) => console.log('[prov]', ...a);
export const PROVIDERS = {
  groq: {
    name: 'Groq', base: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY', pin: { strong: 'GROQ_STRONG', fast: 'GROQ_FAST' },
    defaults: { strong: 'llama-3.3-70b-versatile', fast: 'llama-3.1-8b-instant' },
    prefer: { strong: [/gpt-oss-120b/i, /llama-3\.3-70b/i, /llama-4-maverick/i, /kimi-k2/i, /qwen3?-.*32b/i, /70b|120b|maverick/i], fast: [/llama-3\.1-8b-instant/i, /instant/i, /gpt-oss-20b/i, /llama-4-scout/i, /8b/i] },
    skip: /whisper|guard|tts|playai|orpheus|prompt-guard|distil|vision|compound/i,
  },
  or: {
    name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY', pin: { strong: 'OPENROUTER_STRONG', fast: 'OPENROUTER_FAST', heavy: 'OPENROUTER_HEAVY' },
    defaults: { strong: 'nvidia/nemotron-3-super-120b-a12b:free', fast: 'google/gemma-4-26b-a4b-it:free', heavy: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
    prefer: { heavy: [/nemotron-3-ultra/i, /nemotron-3-super-120b/i, /inkling:free$/i, /deepseek|qwen.*(235|480)b/i], strong: [/nemotron-3-super-120b/i, /nemotron-3-ultra/i, /inkling:free$/i, /gemma-4-31b/i, /deepseek|llama-3\.3-70b|qwen.*(72|235)b/i], fast: [/gemma-4-26b/i, /lightning/i, /flash/i, /mini|small|nano/i] },
    skip: /safety|guard|code|omni|embed/i, freeOnly: true,
  },
};
export const on = p => Boolean(process.env[PROVIDERS[p]?.env]);
export const ORDER = () => (process.env.PROVIDER_ORDER || 'groq,or').split(',').map(s => s.trim()).filter(p => PROVIDERS[p]);
export const available = () => ORDER().filter(on);
export const strongChain = () => available().map(p => `${p}:strong`);
export const fastChain = () => available().map(p => `${p}:fast`);
export const heavyChain = () => ['or', 'groq'].filter(p => available().includes(p)).map(p => p === 'or' ? 'or:heavy' : `${p}:strong`);   // v9.6: coding asks: the biggest free model on each provider
export const isProvider = m => /^(groq|or):/.test(String(m || ''));
export const providerOf = m => String(m || '').split(':')[0];
export const SYS_MAX = () => +(process.env.PROVIDER_SYS_MAX || 16000);

const listCache = new Map();          // provider -> { at, ids }
export function _resetForTests() { listCache.clear(); }
async function liveModels(p, fetchImpl) {
  const c = listCache.get(p);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.ids;
  const P = PROVIDERS[p];
  try {
    const r = await fetchImpl(`${P.base}/models`, { headers: { authorization: `Bearer ${process.env[P.env]}` }, signal: AbortSignal.timeout(5000) });
    const j = r.ok ? await r.json() : {};
    let ids = (j.data || []).map(m => m.id).filter(id => !P.skip.test(id));
    if (P.freeOnly) ids = ids.filter(id => id.endsWith(':free'));
    listCache.set(p, { at: Date.now(), ids });
    return ids;
  } catch (e) { log('model list failed', p, e.message); listCache.set(p, { at: Date.now() - 5.5 * 3600e3, ids: [] }); return []; }
}
export async function resolve(vid, { fetchImpl = globalThis.fetch, avoid = [] } = {}) {
  const [p, tier] = String(vid).split(':');
  const P = PROVIDERS[p];
  const pinned = process.env[P.pin[tier]];
  if (pinned) return pinned;
  const ids = (await liveModels(p, fetchImpl)).filter(id => !avoid.includes(id));
  for (const re of P.prefer[tier]) { const hit = ids.find(id => re.test(id)); if (hit) return hit; }
  return ids.length ? (avoid.includes(P.defaults[tier]) ? ids[0] : P.defaults[tier]) : P.defaults[tier];
}
// keep the identity/rules head and the facts/retrieval/NOW tail; the long middle (profile, voice pack) is what goes
export function compact(sys, max = SYS_MAX()) {
  const s = String(sys || '');
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.45), tail = max - head - 60;
  return s.slice(0, head) + '\n\n[… some background left out to fit this model …]\n\n' + s.slice(-tail);
}
export function toMessages(sys, contents) {
  const msgs = [{ role: 'system', content: sys }];
  for (const c of contents || []) {
    if ((c.parts || []).some(p => p.inline_data || p.inlineData || p.file_data)) return null;     // media: Gemini only
    const text = (c.parts || []).map(p => p.text || '').join('\n').trim();
    if (!text) continue;
    msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text });
  }
  return msgs;
}
// -> { ok, status, text, model, errText }  (never throws on HTTP errors; throws on network/abort like fetch)
export async function chat(vid, sys, contents, { maxTokens = 2048, temperature = 0.7, signal, fetchImpl = globalThis.fetch, sysMax } = {}) {
  const p = providerOf(vid); const P = PROVIDERS[p];
  if (!P || !on(p)) return { ok: false, status: 0, errText: 'provider off' };
  const messages = toMessages(compact(sys, sysMax || SYS_MAX()), contents);
  if (!messages) return { ok: false, status: 415, errText: 'media is Gemini-only' };
  let model = await resolve(vid, { fetchImpl });
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetchImpl(`${P.base}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env[P.env]}`, ...(p === 'or' ? { 'HTTP-Referer': 'https://michael-ai-mu.vercel.app', 'X-Title': 'Michael AI' } : {}) },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    const txt = await r.text().catch(() => '');
    if (r.ok) {
      let j = {}; try { j = JSON.parse(txt); } catch {}
      const text = String(j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return text ? { ok: true, status: 200, text, model, finish: j.choices?.[0]?.finish_reason === 'length' ? 'MAX_TOKENS' : '' } : { ok: false, status: 'empty', model, errText: txt.slice(0, 200) };
    }
    if ((r.status === 404 || (r.status === 400 && /model|decommission|not found|does not exist/i.test(txt))) && attempt === 0 && !process.env[P.pin[vid.split(':')[1]]]) {
      listCache.delete(p); model = await resolve(vid, { fetchImpl, avoid: [model] }); continue;     // retired model: pick another once
    }
    return { ok: false, status: r.status, model, errText: txt.slice(0, 300) };
  }
  return { ok: false, status: 404, model, errText: 'no working model' };
}
