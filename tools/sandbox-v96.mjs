
process.env.WA_TOKEN = process.env.WA_TOKEN || 'x'; process.env.WA_PHONE_ID = process.env.WA_PHONE_ID || '1';
process.env.WA_ALLOWED = '2348148034092';
const realFetch = globalThis.fetch; let netlog = [];
globalThis.fetch = async (u, o) => { const s = String(u); const r = await realFetch(u, o); if (s.includes('generativelanguage') && s.includes(':generateContent')) netlog.push((s.match(/models\/([^:]+)/) || [])[1] + ':' + r.status); else if (/openrouter\.ai|api\.groq\.com/.test(s) && /chat\/completions/.test(s)) { let mdl = '?'; try { mdl = JSON.parse(o.body).model; } catch {} netlog.push(mdl + ':' + r.status); } return r; };
const m = await import('../api/whatsapp.js');
const fs = await import('node:fs');
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
let i = 0;
for (const s of steps) {
  if (!s.keep) await m.processMessage({ from: '2348148034092', id: 'wamid.sbnew' + Date.now() + (i++), type: 'text', text: { body: '/new' } }, 'M', { test: true, ns: 'wa-test', outbox: [] });   // v9.6: fresh history per case
  const c = { test: true, ns: 'wa-test', outbox: [] };
  const t0 = Date.now(); netlog = [];
  await m.processMessage({ from: '2348148034092', id: 'wamid.sb95' + Date.now() + (i++), type: 'text', text: { body: s.q } }, 'M', c);
  const rec = { id: s.id, kind: s.kind, q: s.q, secs: +((Date.now() - t0) / 1000).toFixed(1), skill: c.skill || null, route: c.route ? c.route.level + ':' + c.route.why : null, retrieved: c.brain ? c.brain.titles : [], replies: c.outbox.filter(b => b.type === 'text').map(b => b.text.body), models: netlog.slice(), images: c.outbox.filter(b => b.type === 'image').map(b => b.image.caption) };
  out.push(rec); console.error('done', s.q.slice(0, 50), rec.secs);
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
