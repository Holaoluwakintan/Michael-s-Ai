// local real-model smoke run of v8 (sandbox ns wa-test; nothing sent). Env: real GEMINI_API_KEY, SCHED_KEY, SB_URL, SB_ANON_KEY.
process.env.WA_TOKEN = process.env.WA_TOKEN || 'x'; process.env.WA_PHONE_ID = process.env.WA_PHONE_ID || '1';
const m = await import('../api/whatsapp.js');
const J = await import('../api/_jobs.js');
const qs = process.argv.slice(2);
let i = 0;
for (const q of qs) {
  const c = { test: true, ns: 'wa-test', outbox: [] }; const t0 = Date.now();
  await m.processMessage({ from: '2348148034092', id: 'wamid.loc' + Date.now() + (i++), type: 'text', text: { body: q } }, 'M', c);
  console.log(JSON.stringify({ q, s: ((Date.now() - t0) / 1000).toFixed(1), route: c.route && { level: c.route.level, chain: c.route.chain, why: c.route.why }, brain: c.brain, memory: c.memory, sent: c.outbox.filter(b => b.type === 'text').map(b => b.text.body), other: c.outbox.filter(b => b.type !== 'text').map(b => ({ type: b.type, caption: b.image && b.image.caption, bytes: b.bytes, mime: b.mime })) }));
}
if (process.env.PURGE === '1') console.log('purged', await J.rpc('kv_purge_test', {}));
