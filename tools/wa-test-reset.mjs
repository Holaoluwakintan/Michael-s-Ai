// v9.5: wipe the wa-test sandbox (kv + brain) and re-import the trained knowledge (v9.3 + v9.5), so sandbox runs see what prod sees.
// The mocked suites write/wipe the REAL wa-test namespace, so run this after the suites and before any sandbox run.
const J = await import('../api/_jobs.js');
const BR = await import('../api/_brain.js');
console.log(JSON.stringify({ kv_purge: await J.rpc('kv_purge_test', {}), brain_purge: await BR.brainRpc('purge_test', {}) }));
