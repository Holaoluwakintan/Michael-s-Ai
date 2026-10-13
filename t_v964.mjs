
import assert from 'node:assert';
const V9 = await import('./api/_v9.js');
const q=[{text:'A',at:1},{text:'B',at:2},{text:'A',at:3},{text:'',at:4},{text:'C',at:5},{text:'B',at:6}];
const d=V9.dedupeQueue(q);
assert.deepStrictEqual(d.map(x=>x.text+x.at),['A3','C5','B6']);
assert.deepStrictEqual(V9.dedupeQueue(null),[]);
console.log('t_v964 3 checks passed');
