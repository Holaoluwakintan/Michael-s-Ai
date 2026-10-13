
const J = await import('../api/_jobs.js');
const k = process.argv[2] || 'wa/2348148034092.knowledge.json';
const v = await J.rpc('kv_get', { k });
if (!v) { console.log('NULL'); process.exit(); }
console.log(JSON.stringify({keys:Object.keys(v), facts:(v.facts||[]).length, reminders:(v.reminders||[]).length}));
for (const [i,f] of (v.facts||[]).entries()) console.log(i+1, JSON.stringify(f).slice(0,400));
