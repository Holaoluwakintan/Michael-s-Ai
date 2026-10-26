// v9.7 live sandbox: posts webhook-shaped messages to production with x-test-key (namespace wa-test: nothing is sent to WhatsApp,
// the replies come back in the response). Usage: node tools/sandbox-v97.mjs seed|purge|run '<json steps>'
//   seed  = copy the live knowledge (facts only, no reminders) into wa-test/<owner>.knowledge.json and clear wa-test chat state
//   purge = kv_purge_test (all wa-test kv rows)  ·  run = [{"q":"..."} | {"wait":ms} | {"age":"remPending","ms":360000}]
// Env: WA_TEST_KEY (+ SCHED_KEY/SB_URL/SB_ANON_KEY for seed/purge/age). BASE (default https://michael-ai-mu.vercel.app).
const J = await import('../api/_jobs.js');
const OWNER = '2348148034092', BASE = process.env.BASE || 'https://michael-ai-mu.vercel.app';
const [, , cmd, arg] = process.argv;
if (cmd === 'seed') {
  const live = await J.rpc('kv_get', { k: `wa/${OWNER}.knowledge.json` });
  await J.rpc('kv_put', { k: `wa-test/${OWNER}.knowledge.json`, v: { facts: live.facts || [], settings: {}, reminders: [], missed: [], remSeq: 0 } });
  await J.rpc('kv_put', { k: `wa-test/${OWNER}.json`, v: {} });
  console.log(JSON.stringify({ seeded_facts: (live.facts || []).length }));
} else if (cmd === 'purge') {
  console.log(JSON.stringify({ purged: await J.rpc('kv_purge_test', {}) }));
} else if (cmd === 'peek') {
  const s = await J.rpc('kv_get', { k: `wa-test/${OWNER}.json` }); const k = await J.rpc('kv_get', { k: `wa-test/${OWNER}.knowledge.json` });
  console.log(JSON.stringify({ remPending: s?.remPending || null, mh: s?.mh || null, reminders: (k?.reminders || []).filter(r => r.status === 'active').map(r => r.text), facts: (k?.facts || []).length, ltm: (k?.facts || []).filter(f => f.ltm).map(f => f.t), settings: k?.settings }));
} else {
  let i = 0;
  for (const s of JSON.parse(arg)) {
    if (s.wait) { await new Promise(r => setTimeout(r, s.wait)); continue; }
    if (s.age) { const st = await J.rpc('kv_get', { k: `wa-test/${OWNER}.json` }); if (st && st[s.age]) { st[s.age].at -= s.ms; await J.rpc('kv_put', { k: `wa-test/${OWNER}.json`, v: st }); } console.log(JSON.stringify({ aged: s.age, ms: s.ms })); continue; }
    const msg = { from: OWNER, id: 'wamid.sbx97_' + Date.now() + '_' + (i++), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: s.q } };
    const body = { object: 'whatsapp_business_account', entry: [{ id: 'x', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Michael' }, wa_id: OWNER }], messages: [msg] } }] }] };
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-key': process.env.WA_TEST_KEY }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    console.log(JSON.stringify({ q: s.q, status: r.status, ms: Date.now() - t0, sent: j.sent, result: JSON.stringify(j.results || '').slice(0, +(process.env.SBX_MAX || 300)) }));
  }
}
