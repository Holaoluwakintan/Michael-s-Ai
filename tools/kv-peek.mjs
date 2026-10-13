
const J = await import('../api/_jobs.js');
const v = await J.rpc('kv_get', { k: process.argv[2] });
const s = JSON.stringify(v, null, 1); console.log(s ? s.slice(0, +(process.argv[3]||3000)) : 'NULL');
