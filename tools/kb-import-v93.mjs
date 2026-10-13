// v9.3 import: Michael's teach packs + facts from Tab's notes -> his knowledge store; know-how bank -> kchunks (src knowhow:*).
// Usage: node tools/kb-import-v93.mjs <ns: wa-test|wa> [facts|knowhow|both] [--dry] [--dir=/home/user/tab/files/michael-ai/train-v95]
// Env: SCHED_KEY/SB_URL/SB_ANON_KEY (store), GEMINI_API_KEY (embeddings). Idempotent: facts dedupe by text (exact or near), chunks by hash.
import fs from 'node:fs';
const J = await import('../api/_jobs.js');
const BR = await import('../api/_brain.js');
const G = await import('../api/_gem.js').catch(() => null);
const [ns = 'wa-test', what = 'both'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dry = process.argv.includes('--dry');
const OWNER = '2348148034092';
const D = (process.argv.find(a => a.startsWith('--dir=')) || '--dir=/home/user/tab/files/michael-ai/train-v93/').slice(6).replace(/\/?$/, '/');   // v9.5: --dir=<train folder> (default v9.3)
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const toks = s => new Set(norm(s).match(/[a-z0-9]{4,}/g) || []);
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / Math.max(1, a.size + b.size - i); };
const out = { ns };
if (what === 'facts' || what === 'both') {
  const key = `${ns}/${OWNER}.knowledge.json`;
  const kb = (await J.rpc('kv_get', { k: key })) || {};
  kb.facts = kb.facts || [];
  const before = kb.facts.length;
  const items = JSON.parse(fs.readFileSync(D + 'facts-import.json', 'utf8'));
  const per = {}; let skipped = 0, merged = 0; const skips = [];
  for (const it of items) {
    const t = it.t.replace(/\s+/g, ' ').trim().slice(0, 600);
    const tt = toks(t);
    const hit = kb.facts.findIndex(f => norm(f.t) === norm(t) || jac(toks(f.t), tt) > 0.6);
    const pack = it.src.startsWith('pack:') ? it.src.slice(5).split('.')[0] : 'Tab notes';
    if (hit >= 0) {
      const f = kb.facts[hit];
      if (!f.tag && it.tag) { f.tag = it.tag; merged++; }        // same fact already taught: keep his, add the topic tag
      skipped++; skips.push(`${it.src} ~ #${hit + 1}`); continue;
    }
    const f = { t, at: new Date().toISOString(), tag: it.tag, src: it.src };
    if (it.pin) f.pin = true;
    kb.facts.push(f); per[pack] = (per[pack] || 0) + 1;
  }
  if (!dry) await J.rpc('kv_put', { k: key, v: kb }, 15000);
  Object.assign(out, { facts_before: before, facts_after: kb.facts.length, imported: per, skipped_as_duplicate: skipped, tags_added_to_existing: merged, skips, chars: kb.facts.reduce((n, f) => n + f.t.length, 0) });
}
if (what === 'knowhow' || what === 'both') {
  const items = JSON.parse(fs.readFileSync(D + 'knowhow.json', 'utf8'));
  const vecs = [];
  for (let i = 0; i < items.length; i += 20) {
    const part = items.slice(i, i + 20);
    for (let attempt = 0; ; attempt++) {                         // v9.6: per-minute embedding quota -> wait and retry (bigger chunks)
      try { vecs.push(...await BR.embed(part.map(x => x.body), 'RETRIEVAL_DOCUMENT', { ms: 30000, titles: part.map(x => x.title) })); break; }
      catch (e) { if (attempt >= 4 || !/429/.test(e.message)) throw e; console.error('embed 429, waiting 40 s'); await new Promise(r => setTimeout(r, 40000)); }
    }
    if (i + 20 < items.length) await new Promise(r => setTimeout(r, 12000));
  }
  const crypto = await import('node:crypto');
  const rows = items.map((x, i) => ({ src: x.src, title: x.title, url: null, body: x.body, h: crypto.createHash('sha256').update(x.src + '|' + x.body).digest('hex').slice(0, 40), emb: BR.vecLit(vecs[i]) }));
  const r = dry ? { dry: true } : await BR.brainRpc('add', { ns, rows }, 30000);
  out.knowhow = { rows: rows.length, result: r };
}
console.log(JSON.stringify(out, null, 1));
