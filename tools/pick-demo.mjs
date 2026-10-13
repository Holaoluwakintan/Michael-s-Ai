
import fs from 'node:fs';
const V93 = await import('../api/_v93.js');
const facts = JSON.parse(fs.readFileSync('/home/user/tab/files/michael-ai/train-v93/facts-import.json','utf8'));
for (const q of process.argv.slice(2)) {
  for (const [nm,b] of [['lean',V93.LEAN_BUDGET],['full',V93.FULL_BUDGET]]) {
    const r = V93.pickFacts(facts, q, b, { voice: /voice|post/.test(q) });
    console.log(nm, JSON.stringify(q), 'kept', r.facts.length, 'omitted', r.omitted, '::', r.facts.map(f=>f.src.replace('pack:','').slice(0,8)).join(' '));
  }
}