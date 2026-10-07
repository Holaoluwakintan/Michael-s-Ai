
import * as J from './api/_jobs.js';
import { runTick } from './api/_agent.js';
import { DEPS } from './api/jobs.js';
const brief = process.argv[2] || 'build me a landing page for Mama Tolu\'s Bakery in Ibadan: fresh bread, cakes for birthdays and weddings, small chops';
const kind = process.argv[3] || 'build';
const input = kind === 'edit' ? { brief: 'edit ' + process.argv[4], slug: process.argv[4], change: brief } : { brief };
const job = await J.rpc('create', { ns: 'wa-test', owner: '2348148034092', kind, input });
console.log('job', job.id);
for (let i = 0; i < 8; i++) {
  const r = await runTick({ ns: 'wa-test', id: job.id, deps: DEPS });
  console.log('tick', i, JSON.stringify({ status: r.status, phase: r.phase, url: r.url, ms: r.ms }));
  if (r.idle || r.status !== 'running') break;
}
const j = await J.rpc('get', { ns: 'wa-test', id: job.id });
console.log(j.steps.join('\n'));
console.log('OUTBOX', JSON.stringify(j.state.outbox, null, 1));
console.log('RESULT', JSON.stringify(j.result));
