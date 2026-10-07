// Load files/newsletter/letters.csv into michael_ai.nl_letters (ns wa). Safe to re-run: only letters still "scheduled" are updated;
// one already sending, sent or skipped is never touched. Env: SCHED_KEY, SB_URL, SB_ANON_KEY.
//   node tools/nl-import.mjs [/path/to/letters.csv] [--ns wa-test]
import fs from 'node:fs';
import * as NL from '../api/_newsletter.js';
const file = process.argv.find(a => a.endsWith('.csv')) || '/home/user/tab/files/newsletter/letters.csv';
const ns = process.argv.includes('--ns') ? process.argv[process.argv.indexOf('--ns') + 1] : 'wa';
function parseCsv(t) { const rows = []; let row = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; } if (f || row.length) { row.push(f); rows.push(row); } const [h, ...rs] = rows; return rs.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
const rows = parseCsv(fs.readFileSync(file, 'utf8')).map(NL.rowFromCsv);
for (const r of rows) if (!r.slot || !r.fields.title || !r.fields.body || !/^\d{4}-\d{2}-\d{2}$/.test(r.send_on)) throw new Error('bad row ' + JSON.stringify(r).slice(0, 200));
const out = await NL.rpc('import', { ns, rows }, 60000);
console.log(JSON.stringify({ ns, file, ...out, first: rows.slice(0, 3).map(r => r.send_on + ' ' + r.subject) }));
