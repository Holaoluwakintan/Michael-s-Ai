
process.env.WA_TOKEN = process.env.WA_TOKEN || 'x'; process.env.WA_PHONE_ID = process.env.WA_PHONE_ID || '1';
process.env.WA_ALLOWED = '2348148034092';
const realFetch = globalThis.fetch; let netlog = [];
globalThis.fetch = async (u, o) => { const s = String(u); const r = await realFetch(u, o); if (s.includes('generativelanguage') && s.includes(':generateContent')) netlog.push((s.match(/models\/([^:]+)/) || [])[1] + ':' + r.status); return r; };
const m = await import('../api/whatsapp.js');
const fs = await import('node:fs');
const steps = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = [];
let i = 0;
for (const s of steps) {
  const c = { test: true, ns: 'wa-test', outbox: [] };
  const t0 = Date.now(); netlog = [];
  await m.processMessage({ from: '2348148034092', id: 'wamid.sb95' + Date.now() + (i++), type: 'text', text: { body: s.q } }, 'M', c);
  const rec = { kind: s.kind, q: s.q, secs: +((Date.now() - t0) / 1000).toFixed(1), skill: c.skill || null, route: c.route ? c.route.level + ':' + c.route.why : null, retrieved: c.brain ? c.brain.titles : [], replies: c.outbox.filter(b => b.type === 'text').map(b => b.text.body), models: netlog.slice(), images: c.outbox.filter(b => b.type === 'image').map(b => b.image.caption) };
  out.push(rec); console.error('done', s.q.slice(0, 50), rec.secs);
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
