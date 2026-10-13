
const BR = await import('../api/_brain.js');
console.log(JSON.stringify(await BR.brainRpc('stats', { ns: process.argv[2] || 'wa' })));
const l = await BR.brainRpc('learned', { ns: process.argv[2] || 'wa', n: 20 });
console.log(JSON.stringify((l || []).map(x => (x.title || '') + ' :: ' + String(x.body || '').slice(0, 120))));
