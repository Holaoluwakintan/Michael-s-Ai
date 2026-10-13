
process.env.WA_TOKEN = process.env.WA_TOKEN || 'x'; process.env.WA_PHONE_ID = process.env.WA_PHONE_ID || '1';
const m = await import('../api/whatsapp.js');
const J = await import('../api/_jobs.js');
let i = 0;
const say = async (q, extra = {}) => {
  const c = { test: true, ns: 'wa-test', outbox: [] };
  await m.processMessage({ from: '2348148034092', id: 'wamid.flow' + Date.now() + (i++), type: 'text', text: { body: q }, ...extra }, 'M', c);
  console.log(JSON.stringify({ q, forwarded: !!extra.context, sent: c.outbox.filter(b => b.type === 'text').map(b => b.text.body) }));
};
const steps = JSON.parse(process.argv[2]);
for (const s of steps) await say(s.q, s.fwd ? { context: { forwarded: true } } : {});
const kb = await J.rpc('kv_get', { k: 'wa-test/2348148034092.knowledge.json' });
console.log(JSON.stringify({ reminders: (kb.reminders || []).map(r => ({ text: r.text, due: new Date(r.due).toISOString() })) }));
