// One test email of a letter to ONE address through the same path the scheduler uses (his site's broadcast endpoint, testEmail mode).
// Env: BROADCAST_SECRET (+ optional BROADCAST_URL). Usage: node tools/nl-test-send.mjs <slot> <email> [--go]
import fs from 'node:fs';
import * as NL from '../api/_newsletter.js';
const [slot, email] = process.argv.slice(2);
function parseCsv(t) { const rows = []; let row = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; } if (f || row.length) { row.push(f); rows.push(row); } const [h, ...rs] = rows; return rs.filter(r => r.length > 1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
const row = parseCsv(fs.readFileSync('/home/user/tab/files/newsletter/letters.csv', 'utf8')).map(NL.rowFromCsv).find(r => r.slot === +slot);
const mail = NL.render(row.fields);
const subject = '[Test] ' + row.subject;
if (!process.argv.includes('--go')) { console.log('would send', subject, 'to', email); process.exit(0); }
const t0 = Date.now();
const b = await NL.broadcast({ subject, html: mail.html, text: mail.text, testEmail: email });
console.log(JSON.stringify({ subject, ms: Date.now() - t0, status: b.status, sent: b.sent, sentTo: b.sentTo, failed: b.failed, errors: b.errors }));
