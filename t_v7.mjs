// v7 tests: HEAVY WORK. Sites with a backend (validation, spam/rate limits, logins, owner ping, orders/data/export),
// GitHub repo jobs (file pick, self-check, push to mai/ only), long research jobs, Sow posts, video/media (real ffmpeg locally),
// Gemini key-2 / retry / quota. All mocked except ffmpeg: in-memory store for the RPC, fake Gemini / GitHub / WhatsApp.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as acorn from 'acorn';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
process.env.WA_ALLOWED = '2348148034092,2348000000001';
process.env.SB_URL = 'https://sb.test'; process.env.SB_ANON_KEY = 'anon'; process.env.SCHED_KEY = 'sched-test';
process.env.GEMINI_API_KEY = 'key-one'; delete process.env.GEMINI_API_KEY_2;
process.env.GITHUB_TOKEN = 'gh-test'; process.env.VERCEL_TOKEN = 'v-test';
delete process.env.PAYSTACK_PUBLIC_KEY; delete process.env.PAYSTACK_SECRET_KEY;
let n = 0; const ok = (name, cond) => { if (!cond) console.log('LAST SENT:', JSON.stringify(globalThis.__last || null).slice(0, 1500)); assert.ok(cond, name); n++; console.log('✔', name); };
const OWNER = '2348148034092', OTHER = '2348000000001';

// ---------- in-memory michael_ai_jobs ----------
const db = { jobs: [], sites: {}, data: [], users: [], hits: [], sow: [], seq: 0, dseq: 0, useq: 0 };
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
function store(op, a) {
  const ns = a.ns || 'wa';
  switch (op) {
    case 'create': { const j = { id: ++db.seq, owner: a.owner, ns, kind: a.kind, input: a.input || {}, status: 'queued', steps: [], state: {}, result: null, ticks: 0, delivered: false, created: new Date().toISOString() }; db.jobs.push(j); return clone(j); }
    case 'claim': { const j = db.jobs.find(x => x.ns === ns && ['queued', 'running'].includes(x.status) && (a.id == null || x.id === +a.id) && (!a.kinds || a.kinds.includes(x.kind)) && (!a.not_kinds || !a.not_kinds.includes(x.kind))); if (!j) return null; j.status = 'running'; j.ticks++; return clone(j); }
    case 'save': { const j = db.jobs.find(x => x.id === +a.id); if (j.status !== 'cancelled' && a.status) j.status = a.status; if (a.steps) j.steps = a.steps; if (a.state) j.state = a.state; if (a.result) j.result = a.result; if (a.delivered != null) j.delivered = a.delivered; return { id: j.id, status: j.status }; }
    case 'get': return clone(db.jobs.find(x => x.id === +a.id));
    case 'list': return db.jobs.filter(x => x.ns === ns && x.owner === a.owner).map(x => ({ id: x.id, kind: x.kind, status: x.status, brief: x.input.brief }));
    case 'count_today': return db.jobs.filter(x => x.ns === ns && x.owner === a.owner && (a.kinds || ['build', 'edit']).includes(x.kind) && x.status !== 'cancelled').length;
    case 'open_count': return db.jobs.filter(x => x.ns === ns && x.owner === a.owner && ['queued', 'running'].includes(x.status)).length;
    case 'undelivered': return [];
    case 'site_get': return clone(db.sites[ns + '/' + a.slug] || null);
    case 'site_put': db.sites[ns + '/' + a.slug] = { ...clone(a), ns }; return { slug: a.slug, version: a.version };
    case 'site_list': return Object.values(db.sites).filter(s => s.ns === ns && s.owner === a.owner).map(s => ({ slug: s.slug, title: s.title, kind: s.kind, url: s.url, version: s.version, project: s.project, has_backend: !!(s.backend && s.backend.collections?.length) }));
    case 'site_meta': { const s = Object.values(db.sites).find(s => a.key ? s.site_key === a.key : (s.ns === ns && s.slug === a.slug)); return s ? { ns: s.ns, slug: s.slug, owner: s.owner, title: s.title, kind: s.kind, url: s.url, project: s.project, site_key: s.site_key, backend: clone(s.backend) } : null; }
    case 'hit': db.hits.push({ k: a.k, at: Date.now() }); return db.hits.filter(h => h.k === a.k && Date.now() - h.at < (a.window_s || 600) * 1000).length;
    case 'data_add': { if (db.data.filter(d => d.ns === ns && d.slug === a.slug).length >= (a.day_max || 500)) return { limited: 'day' }; const r = { id: ++db.dseq, ns, slug: a.slug, coll: a.coll, kind: a.kind, uid: a.uid ?? null, data: clone(a.data), ip: a.ip, status: 'new', notified: !!a.notified, created: new Date().toISOString() }; db.data.push(r); return { id: r.id }; }
    case 'data_list': { let rows = db.data.filter(d => d.ns === ns && d.slug === a.slug && (!a.coll || d.coll === a.coll) && (!a.kinds || a.kinds.includes(d.kind)) && (a.uid == null || d.uid === +a.uid)); rows = rows.sort((x, y) => a.order === 'score' ? (y.data.score || 0) - (x.data.score || 0) : y.id - x.id); return clone(rows.slice(0, a.limit || 50)); }
    case 'data_counts': { const by = {}; for (const d of db.data.filter(d => d.ns === ns && d.slug === a.slug)) { const k = d.coll; by[k] = by[k] || { coll: k, kind: d.kind, total: 0, new_count: 0 }; by[k].total++; if (d.status === 'new') by[k].new_count++; } return Object.values(by); }
    case 'data_update': { const d = db.data.find(d => d.id === +a.id && d.ns === ns && d.slug === a.slug && (a.uid == null || d.uid === +a.uid)); if (!d) return 0; if (a.data) Object.assign(d.data, a.data); if (a.status) d.status = a.status; return 1; }
    case 'data_delete': { const i = db.data.findIndex(d => d.id === +a.id && d.ns === ns && d.slug === a.slug && (a.uid == null || d.uid === +a.uid)); if (i < 0) return 0; db.data.splice(i, 1); return 1; }
    case 'data_seen': { let k = 0; for (const d of db.data) if (d.ns === ns && d.slug === a.slug && d.status === 'new' && a.ids.includes(d.id)) { d.status = 'seen'; k++; } return k; }
    case 'data_unnotified': return clone(db.data.filter(d => d.ns === ns && !d.notified && db.sites[ns + '/' + d.slug]?.owner === a.owner).map(d => ({ ...d, title: db.sites[ns + '/' + d.slug].title })));
    case 'data_notified': { for (const d of db.data) if (a.ids.includes(d.id)) d.notified = true; return a.ids.length; }
    case 'user_add': { if (db.users.some(u => u.ns === ns && u.slug === a.slug && u.username === a.username)) return { exists: true }; const u = { id: ++db.useq, ns, slug: a.slug, username: a.username, pw: a.pw }; db.users.push(u); return { id: u.id }; }
    case 'user_get': { const u = db.users.find(u => u.ns === ns && u.slug === a.slug && (u.username === a.username || u.id === +a.id)); return u ? { id: u.id, username: u.username, pw: u.pw } : null; }
    case 'user_count': return db.users.filter(u => u.ns === ns && u.slug === a.slug).length;
    case 'usage_add': db.usage = (db.usage || []).concat(a.rows); return true;
    case 'usage_get': return clone(db.usage || []);
    case 'gcache_get': return (db.gcache || {})[a.h] ?? null;
    case 'gcache_put': db.gcache = { ...(db.gcache || {}), [a.h]: a.v }; return true;
    case 'sow_add': { const r = { id: 'uuid-' + (db.sow.length + 1), post_date: a.post_date, post_time: a.post_time + ':00', caption: a.caption, status: 'queued', source: 'michael-ai' }; db.sow.push(r); return clone(r); }
    case 'sow_list': return clone(db.sow.filter(r => r.status === 'queued'));
    case 'sow_delete': { const i = db.sow.findIndex(r => r.id === a.id); if (i < 0) return 0; db.sow.splice(i, 1); return 1; }
    case 'purge_test': return 0;
  }
  throw new Error('mock: unknown op ' + op);
}
const J = await import('./api/_jobs.js'); J.setMock(store);
const B = await import('./api/_backend.js');
const S = await import('./api/_sites.js');
const SD = await import('./api/site-data.js');
const R = await import('./api/_research.js');
const GR = await import('./api/_repo.js');
const SOW = await import('./api/_sow.js');
const M = await import('./api/_media.js');
const G = await import('./api/_gem.js');
const A = await import('./api/_agent.js');
const m = await import('./api/whatsapp.js');

// ======================= 1. backend: plan cleaning, validation, auth =======================
const be = B.cleanBackend({ collections: [
  { name: 'Orders', kind: 'order', fields: [{ name: 'name', required: true }, { name: 'phone', type: 'phone', required: true }, { name: 'items', type: 'long', required: true }, { name: 'size', type: 'choice', options: ['Small', 'Large'] }, { name: 'qty', type: 'number', min: 1, max: 50 }, { name: 'id' }] },
  { name: 'guestbook', kind: 'entry', fields: [{ name: 'name', required: true }, { name: 'email', type: 'email' }, { name: 'message', type: 'long', required: true }] },
  { name: 'scores', kind: 'score', fields: [{ name: 'score', type: 'number' }] },
], payments: true });
ok('cleanBackend: slugged names, reserved field dropped, kinds kept', be.collections.map(c => c.name).join() === 'orders,guestbook,scores' && !be.collections[0].fields.some(f => f.name === 'id'));
ok('cleanBackend: public kinds expose only non-contact fields', be.collections[1].public.join() === 'name,message' && be.collections[2].public.includes('score'));
ok('cleanBackend: score gets name + score fields; payments kept only with an order form', be.collections[2].fields.map(f => f.name).join() === 'name,score' && be.payments === true && B.cleanBackend({ collections: [{ name: 'g', kind: 'entry', fields: ['name'] }], payments: true }).payments === false);
ok('cleanBackend: nothing usable -> null; item kind forces logins', B.cleanBackend({ collections: [] }) === null && B.cleanBackend({ collections: [{ name: 'todos', kind: 'item', fields: ['text'] }] }).auth === true);
const ord = be.collections[0];
let v = B.validate(ord, { name: ' Ada  ', phone: '0803 123 4567', items: '2 meat pies', size: 'large', qty: '3', extra: 'dropped', id: 9 });
ok('validate: trims, normalises choice case, parses numbers, drops unknown fields', v.ok && v.data.name === 'Ada' && v.data.size === 'Large' && v.data.qty === 3 && !('extra' in v.data) && !('id' in v.data));
v = B.validate(ord, { name: 'A', phone: 'call me', items: '', qty: 99, size: 'Huge' });
ok('validate: required / phone / range / choice errors', !v.ok && v.errors.some(e => /items is required/.test(e)) && v.errors.some(e => /phone/.test(e)) && v.errors.some(e => /qty is out of range/.test(e)) && v.errors.some(e => /size/.test(e)));
v = B.validate(be.collections[1], { name: 'x'.repeat(500), message: 'm'.repeat(5000), email: 'not-an-email' });
ok('validate: length caps (200 / 2000) and email check', !v.ok && v.errors[0].includes('email') && B.validate(be.collections[1], { name: 'x'.repeat(500), message: 'm'.repeat(5000) }).data.name.length === 200 && B.validate(be.collections[1], { name: 'x', message: 'm'.repeat(5000) }).data.message.length === 2000);
const hp = B.hashPassword('secret12');
ok('passwords: scrypt hash verifies, wrong one fails, salt differs', B.checkPassword('secret12', hp) && !B.checkPassword('secret13', hp) && hp !== B.hashPassword('secret12'));
const tk = B.signToken('sk_abc', 7, 'ada');
ok('tokens: verify for the same site only, reject tampering and expiry', B.verifyToken(tk, 'sk_abc')?.uid === 7 && B.verifyToken(tk, 'sk_other') === null && B.verifyToken(tk.slice(0, -2) + 'xx', 'sk_abc') === null && B.verifyToken(B.signToken('sk_abc', 7, 'ada', 1, Date.now() - 3 * 864e5), 'sk_abc') === null);
const siteRow = { project: 'mai-bakery', url: 'https://mai-bakery.vercel.app' };
ok('origin: only the site\'s own Vercel URLs', B.originOk('https://mai-bakery.vercel.app', siteRow) && B.originOk('https://mai-bakery-git-x-team.vercel.app', siteRow) && !B.originOk('https://evil.com', siteRow) && !B.originOk('https://mai-bakery.vercel.app.evil.com', siteRow) && !B.originOk('', siteRow));
const csv = B.toCsv([{ id: 1, coll: 'orders', status: 'new', created: '2026-10-07T10:00:00Z', data: { name: 'Ada, "Queen"', items: '=HYPERLINK("x")' } }]);
ok('CSV: BOM, header, quoting, formula-injection guard, Lagos time', csv.startsWith('\uFEFFid,date (Lagos),form,status,name,items') && csv.includes('"Ada, ""Queen"""') && csv.includes(`"'=HYPERLINK(""x"")"`) && csv.includes('2026-10-07 11:00'));
const client = B.clientJs({ api: 'https://bot.test/api/site-data', key: 'sk_test1234567', backend: be });
let parsed = true; try { acorn.parse(client, { ecmaVersion: 2020 }); } catch (e) { parsed = e.message; }
ok('mai.js client parses as ES2020, carries key/api, no secrets', parsed === true && client.includes('sk_test1234567') && client.includes('https://bot.test/api/site-data') && !/SCHED_KEY|service_role|sched-test/.test(client));
ok('wantsBackend: order/booking/leaderboard yes, a plain book site no', B.wantsBackend('bakery site with an order form') && B.wantsBackend('barber site where people book an appointment') && B.wantsBackend('quiz with a leaderboard') && !B.wantsBackend('landing page for my new book') && !B.wantsBackend('portfolio site'));
ok('defaultBackend: to-do app gets private items + logins', (() => { const d = B.defaultBackend('make a to-do app with logins'); return d.auth && d.collections[0].kind === 'item'; })());
ok('backendPrompt names the forms/lists/login/payment wiring', (() => { const t = B.backendPrompt({ ...be, auth: true }); return t.includes('data-mai-form') && t.includes('data-mai-list') && t.includes('data-mai-auth') && t.includes('data-mai-pay') && t.includes('Payments coming soon'); })());

// site check + decorate
const goodHtml = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><title>Bakery</title><link rel="stylesheet" href="style.css"></head><body><main>
<form data-mai-form="orders"><input name="name" required><input name="phone" type="tel" required><textarea name="items" required></textarea><select name="size"><option>Small</option></select><input name="qty" type="number"><button>Order</button><p data-mai-status></p></form>
<form data-mai-form="guestbook"><input name="name" required><textarea name="message" required></textarea><button>Sign</button></form><div data-mai-list="guestbook"></div><div data-mai-list="scores"></div><p data-mai-pay-note></p></main><script src="app.js"></script></body></html>`;
ok('backendIssues: a correctly wired page is clean', S.backendIssues(goodHtml, '', be).length === 0);
const bad = goodHtml.replace('name="phone"', 'name="tel"').replace('data-mai-form="guestbook"', 'data-mai-form="gb"');
const bi = S.backendIssues(bad, '', be);
ok('backendIssues: missing required input, unknown field, unknown collection, unused collection', bi.some(x => /missing inputs for required fields: phone/.test(x)) && bi.some(x => /won't store: tel/.test(x)) && bi.some(x => /data-mai-form="gb"/.test(x)));
ok('checkSite: mai.js reference allowed only for backend sites', !S.checkSite({ 'index.html': goodHtml.replace('</head>', '<script src="mai.js"></script></head>'), 'style.css': '', 'app.js': '' }, { backend: be }).some(x => /doesn't exist/.test(x)) && S.checkSite({ 'index.html': goodHtml.replace('</head>', '<script src="mai.js"></script></head>'), 'style.css': '', 'app.js': '' }).some(x => /mai\.js/.test(x)));
const dec = S.decorate({ 'index.html': goodHtml, 'style.css': '', 'app.js': '' }, { title: 'Bakery', type: 'site', palette: {}, backend: be }, { siteKey: 'sk_test1234567', api: 'https://bot.test/api/site-data' });
ok('decorate: injects mai.js file + one script tag in head (before app.js)', !!dec['mai.js'] && (dec['index.html'].match(/src="mai\.js"/g) || []).length === 1 && dec['index.html'].indexOf('mai.js') < dec['index.html'].indexOf('app.js'));
ok('decorate: no backend -> no mai.js', !S.decorate({ 'index.html': goodHtml, 'style.css': '', 'app.js': '' }, { title: 'X', type: 'site', palette: {} })['mai.js']);

// ======================= 2. /api/site-data (handler, mocked store + WhatsApp) =======================
db.sites['wa/bakery'] = { ns: 'wa', slug: 'bakery', owner: OWNER, title: 'Mama Bakery', kind: 'site', url: 'https://mai-bakery.vercel.app', project: 'mai-bakery', site_key: 'sk_bakery123456', backend: be, version: 1, files: {} };
db.sites['wa-test/todo'] = { ns: 'wa-test', slug: 'todo', owner: OWNER, title: 'Todo', kind: 'app', url: 'https://mai-todo.vercel.app', project: 'mai-todo', site_key: 'sk_todo1234567', backend: B.defaultBackend('to-do app with logins'), version: 1, files: {} };
const waSent = [];
const fakeFetch = async (u, o = {}) => { if (String(u).includes('graph.facebook.com')) { waSent.push(JSON.parse(o.body)); return new Response('{"messages":[{"id":"wamid.X"}]}', { status: 200 }); } throw new Error('unexpected fetch ' + u); };
process.env.WA_TOKEN = 'wa-test-token'; process.env.WA_PHONE_ID = '123';
const deferred = [];
const call = async (body, { origin = 'https://mai-bakery.vercel.app', ip = '1.2.3.4', method = 'POST', qs = '' } = {}) => {
  const req = new Request('https://bot.test/api/site-data' + qs, { method, headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': ip }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  const r = await SD.handle(req, { fetchImpl: fakeFetch, defer: p => deferred.push(p) });
  return { status: r.status, j: await r.json().catch(() => null), h: r.headers };
};
SD._clearCache();
let r = await call({ key: 'sk_bakery123456', op: 'add', coll: 'orders', data: { name: 'Ada', phone: '08031234567', items: '2 meat pies', size: 'Small' }, t: 5000 });
await Promise.all(deferred.splice(0));
ok('order stored with a CORS header for the site', r.status === 200 && r.j.ok && r.j.id > 0 && r.h.get('access-control-allow-origin') === 'https://mai-bakery.vercel.app' && db.data.at(-1).data.items === '2 meat pies');
ok('owner pinged on WhatsApp with the order details (and marked notified)', waSent.length === 1 && waSent[0].to === OWNER && waSent[0].text.body.includes('New order') && waSent[0].text.body.includes('2 meat pies') && db.data.at(-1).notified === true);
r = await call({ key: 'sk_bakery123456', op: 'add', coll: 'orders', data: { name: 'Bot' }, t: 5000 });
ok('invalid order -> 400 with a clear message, nothing stored', r.status === 400 && /items is required/.test(r.j.error) && db.data.length === 1);
r = await call({ key: 'sk_bakery123456', op: 'add', coll: 'orders', data: { name: 'Spam', phone: '08031234567', items: 'x' }, hp: 'http://spam', t: 5000 });
ok('honeypot filled -> fake success, nothing stored, no ping', r.j.ok && r.j.id === 0 && db.data.length === 1 && waSent.length === 1);
r = await call({ key: 'sk_bakery123456', op: 'add', coll: 'orders', data: { name: 'Fast', phone: '08031234567', items: 'x' }, t: 200 });
ok('instant submit (bot speed) -> fake success, nothing stored', r.j.ok && r.j.id === 0 && db.data.length === 1);
r = await call({ key: 'sk_bakery123456', op: 'add', coll: 'orders', data: { name: 'Ada', phone: '08031234567', items: 'x' }, t: 5000 }, { origin: 'https://evil.example' });
ok('other origins refused (403, no CORS header)', r.status === 403 && !r.h.get('access-control-allow-origin'));
r = await call({ key: 'sk_nope12345678', op: 'add', coll: 'orders', data: {} });
ok('unknown site key -> 404', r.status === 404);
for (let i = 0; i < 9; i++) r = await call({ key: 'sk_bakery123456', op: 'add', coll: 'guestbook', data: { name: 'G' + i, message: 'hello ' + i }, t: 5000 }, { ip: '9.9.9.9' });
ok('per-IP rate limit: the 9th write in 10 min is refused (429)', r.status === 429 && db.data.filter(d => d.coll === 'guestbook').length === 8);
r = await call({ key: 'sk_bakery123456', op: 'list', coll: 'guestbook' });
ok('public list: newest first, public fields only, short CDN cache', r.j.ok && r.j.rows.length === 8 && r.j.rows[0].data.name === 'G7' && !('email' in r.j.rows[0].data) && /s-maxage=10/.test(r.h.get('cache-control')));
r = await call({ key: 'sk_bakery123456', op: 'list', coll: 'orders' });
ok('orders are private: list refused', r.status === 403);
for (const [nm, sc] of [['Ada', 7], ['Bola', 12], ['Chi', 9]]) await call({ key: 'sk_bakery123456', op: 'add', coll: 'scores', data: { name: nm, score: sc } }, { ip: '5.5.5.' + sc });
r = await call({ key: 'sk_bakery123456', op: 'list', coll: 'scores' });
ok('leaderboard sorted by score', r.j.rows.map(x => x.data.name).join() === 'Bola,Chi,Ada');
r = await call({ key: 'sk_bakery123456', op: 'config' }, { method: 'GET', qs: '?op=config&key=sk_bakery123456' });
ok('config: payments OFF without Paystack keys (no key leaked)', r.j.ok && r.j.payments === false && r.j.public_key === null);
r = await call({ key: 'sk_bakery123456', op: 'verify', reference: 'x' });
ok('verify while payments are off -> "Payments coming soon"', r.j.soon === true && /coming soon/i.test(r.j.error));
// logins + private to-dos (sandbox site: no WhatsApp send at all)
const T0 = { origin: 'https://mai-todo.vercel.app', ip: '7.7.7.7' };
r = await call({ key: 'sk_todo1234567', op: 'signup', username: 'Ada', password: '123' }, T0);
ok('signup: short password refused', r.status === 400 && /6 characters/.test(r.j.error));
r = await call({ key: 'sk_todo1234567', op: 'signup', username: 'ada', password: 'secret12' }, T0);
const tokA = r.j.token;
ok('signup returns a token; duplicate username refused', r.j.ok && tokA && (await call({ key: 'sk_todo1234567', op: 'signup', username: 'ADA', password: 'other123' }, T0)).status === 409);
ok('login: wrong password 401, right one ok', (await call({ key: 'sk_todo1234567', op: 'login', username: 'ada', password: 'nope1234' }, T0)).status === 401 && (await call({ key: 'sk_todo1234567', op: 'login', username: 'ada', password: 'secret12' }, T0)).j.ok);
const tokB = (await call({ key: 'sk_todo1234567', op: 'signup', username: 'bola', password: 'secret34' }, T0)).j.token;
r = await call({ key: 'sk_todo1234567', op: 'add', coll: 'todos', data: { text: 'buy flour' } }, T0);
ok('private item needs a login', r.status === 401);
r = await call({ key: 'sk_todo1234567', op: 'add', coll: 'todos', data: { text: 'buy flour' }, token: tokA }, T0);
const todoId = r.j.id;
ok('logged-in add works', r.j.ok && todoId > 0);
ok('each user sees only their own items', (await call({ key: 'sk_todo1234567', op: 'list', coll: 'todos', token: tokA }, T0)).j.rows.length === 1 && (await call({ key: 'sk_todo1234567', op: 'list', coll: 'todos', token: tokB }, T0)).j.rows.length === 0);
ok('another user can\'t update or delete my item', (await call({ key: 'sk_todo1234567', op: 'remove', id: todoId, coll: 'todos', token: tokB }, T0)).status === 404);
ok('owner of the item can update + delete it', (await call({ key: 'sk_todo1234567', op: 'update', id: todoId, coll: 'todos', data: { done: true }, token: tokA }, T0)).j.ok && db.data.find(d => d.id === todoId).data.done === true && (await call({ key: 'sk_todo1234567', op: 'remove', id: todoId, coll: 'todos', token: tokA }, T0)).j.ok);
db.sites['wa-test/shop'] = { ns: 'wa-test', slug: 'shop', owner: OWNER, title: 'Test Shop', url: 'https://mai-shop.vercel.app', project: 'mai-shop', site_key: 'sk_shop12345678', backend: be, version: 1, files: {} };
waSent.length = 0;
r = await call({ key: 'sk_shop12345678', op: 'add', coll: 'orders', data: { name: 'Sandbox', phone: '08031234567', items: 'cake' }, t: 4000 }, { origin: 'https://mai-shop.vercel.app', ip: '8.8.8.8' });
await Promise.all(deferred.splice(0));
ok('sandbox site: owner-ping path returns the ping text, nothing sent', r.j.ok && r.j.ping.includes('New order') && r.j.ping.includes('cake') && waSent.length === 0);

// ======================= 3. chat: orders / data / export =======================
const ctx = (extra = {}) => ({ test: true, ns: 'wa-test', outbox: [], ...extra });
let mid = 0;
const texts = c => c.outbox.filter(b => b.type === 'text').map(b => b.text.body);
const say = async (text, from = OWNER, c = ctx()) => { const r = await m.processMessage({ from, id: 'wamid.v7_' + (mid++), type: 'text', text: { body: text } }, 'T', c); globalThis.__last = texts(c); return { r, c, sent: texts(c) }; };
// fake Gemini for chat fallbacks
const realFetch = globalThis.fetch;
let gemCalls = [], ghLog = [], gemMode = 'ok';
globalThis.fetch = async (u, o = {}) => {
  const s = String(u);
  if (s.includes('generativelanguage')) {
    const model = s.match(/models\/([^:]+)/)[1]; const key = o.headers?.['x-goog-api-key']; const body = JSON.parse(o.body); const user = body.contents.at(-1).parts.map(p => p.text || '').join('\n');
    gemCalls.push({ model, key, user });
    if (gemMode === 'k1-429' && key === 'key-one') return new Response('{"error":{"code":429,"message":"GenerateRequestsPerDayPerProjectPerModel"}}', { status: 429 });
    if (gemMode === '503-once' && gemCalls.filter(c => c.model === model).length === 1) return new Response('{"error":{"code":503}}', { status: 503 });
    const okr = t => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] }), { status: 200 });
    if (user.includes('Research topic from Michael')) return okr('{"title":"Free hosting for Nigerian devs","questions":["Which hosts are free?","Limits?"],"queries":["free hosting nigeria","vercel free tier limits 2026","netlify free tier","render free tier","cloudflare pages free"]}');
    if (user.includes('SOURCES (numbered')) return okr('===WHATSAPP===\n*Short answer:* Vercel and Cloudflare Pages are the best free hosts [1][2].\n• Vercel Hobby: free, 100 GB transfer [1]\n• Cloudflare Pages: unlimited bandwidth [2]\n• Netlify: 100 GB [3]\n• Render: free web services sleep [4]\n• Paystack works with all of them [1]\n*My take:* start on Cloudflare Pages for static sites. '.padEnd(400, ' ') + '\n===REPORT===\n# Free hosting\n## Summary\nVercel [1] and Cloudflare [2] lead.\n## Options\n- Vercel [1]\n- Cloudflare [2]\n- Netlify [3]\n## Gaps & caveats\nLimits change often [4].' + ' More detail.'.repeat(60));
    if (user.includes('Change request from the owner')) return okr('{"read":["index.html","app.js"],"create":[],"plan":"Add a dark mode toggle button to the header and CSS variables."}');
    if (user.includes('CURRENT FILES:')) return okr('=== FILE: app.js ===\nconst btn = document.getElementById("dark");\nif (btn) btn.addEventListener("click", () => document.body.classList.toggle("dark"));\nconsole.log("ready");\n=== FILE: index.html ===\n<!DOCTYPE html><html><head><title>T</title></head><body><button id="dark">Dark</button><main>Hello</main><script src="app.js"></script></body></html>\n=== SUMMARY ===\n- Added a Dark button in the header\n- Toggles a .dark class on the page');
    return okr('chat answer');
  }
  if (s.startsWith('https://api.github.com')) {
    const method = o.method || 'GET'; ghLog.push(method + ' ' + s.replace('https://api.github.com', '')); const p = s.replace('https://api.github.com', '');
    const js = (x, st = 200) => new Response(JSON.stringify(x), { status: st });
    if (p.startsWith('/user/repos')) return js([{ name: 'test-repo', full_name: 'Holaoluwakintan/test-repo', private: false, description: 'A test', language: 'JavaScript', pushed_at: new Date().toISOString(), default_branch: 'main', size: 3, html_url: 'https://github.com/Holaoluwakintan/test-repo' }, { name: 'Blossom-website', full_name: 'Holaoluwakintan/Blossom-website', private: false, description: 'live site', language: 'Astro', pushed_at: new Date().toISOString(), default_branch: 'main', size: 9, html_url: 'x' }]);
    if (p.includes('/git/ref/heads/main')) return js({ object: { sha: 'base000' } });
    if (p.includes('/git/trees/base000')) return js({ tree: [{ path: 'index.html', type: 'blob', size: 120 }, { path: 'app.js', type: 'blob', size: 40 }, { path: 'README.md', type: 'blob', size: 30 }, { path: 'node_modules/x/index.js', type: 'blob', size: 10 }, { path: 'logo.png', type: 'blob', size: 5000 }], truncated: false });
    if (p.includes('/contents/')) { const f = decodeURIComponent(p.split('/contents/')[1].split('?')[0]); const c = { 'index.html': '<!DOCTYPE html><html><head><title>T</title></head><body><main>Hello</main><script src="app.js"></script></body></html>', 'app.js': 'console.log("ready");\n', 'README.md': '# test repo' }[f]; return js({ encoding: 'base64', content: Buffer.from(c || '').toString('base64') }); }
    if (p.includes('/git/commits/base000')) return js({ tree: { sha: 'tree000' } });
    if (p.endsWith('/git/blobs') && method === 'POST') return js({ sha: 'blob' + ghLog.length }, 201);
    if (p.endsWith('/git/trees') && method === 'POST') return js({ sha: 'tree111' }, 201);
    if (p.endsWith('/git/commits') && method === 'POST') return js({ sha: 'commit111' }, 201);
    if (p.endsWith('/git/refs') && method === 'POST') { const b = JSON.parse(o.body); if (b.ref === 'refs/heads/mai/add-dark-mode-toggle') return js({ message: 'Reference already exists' }, 422); return js({ ref: b.ref }, 201); }
    return js({ message: 'not mocked ' + p }, 404);
  }
  if (s.includes('graph.facebook.com')) return new Response('{"messages":[{"id":"wamid.Y"}]}', { status: 200 });
  return realFetch(u, o);
};

// chat runs in the sandbox namespace (wa-test): move the bakery there, drop the other sandbox sites
delete db.sites['wa-test/todo']; delete db.sites['wa-test/shop'];
db.sites['wa-test/bakery'] = { ...db.sites['wa/bakery'], ns: 'wa-test' }; delete db.sites['wa/bakery'];
for (const d of db.data) if (d.slug === 'bakery') d.ns = 'wa-test';
let x = await say('orders');
ok('"orders" with one backend site picks it and lists the latest entries', x.sent.at(-1).includes('Mama Bakery') && x.sent.at(-1).includes('2 meat pies') && x.sent.at(-1).includes('export bakery'));
ok('...and marks the new ones seen', db.data.filter(d => d.slug === 'bakery' && d.kind === 'order').every(d => d.status === 'seen'));
x = await say('data bakery');
ok('"data <site>" shows counts per form', /guestbook\*: 8/.test(x.sent.at(-1)) && /scores\*: 3/.test(x.sent.at(-1)));
x = await say('export bakery');
const docMsg = x.c.outbox.find(b => b.type === 'document'), upMsg = x.c.outbox.find(b => b.type === 'media_upload');
ok('"export <site>" uploads a CSV and sends it as a document', upMsg && upMsg.mime === 'text/csv' && /^bakery-\d{4}-\d{2}-\d{2}\.csv$/.test(upMsg.filename) && docMsg && x.sent.at(-1).includes('rows'));
x = await say('orders bakery', OTHER);
ok('other allowed numbers can\'t see site data', x.sent.at(-1).includes('Only Michael'));
x = await say('orders nosuchsite');
ok('unknown site name -> lists sites with a backend', /No site called "nosuchsite"/.test(x.sent.at(-1)) && x.sent.at(-1).includes('bakery'));
db.data.push({ id: ++db.dseq, ns: 'wa-test', slug: 'bakery', coll: 'orders', kind: 'order', data: { name: 'Late' }, status: 'new', notified: false, created: new Date().toISOString() });
x = await say('hello there');
ok('orders that arrived while the chat was asleep are announced with his next message', x.sent[0].includes('While the chat was asleep') && x.sent[0].includes('orders bakery') && db.data.at(-1).notified === true);

// ======================= 4. GitHub repos =======================
ok('repo regexes', GR.REPO_RE.test('repo voicepad add a dark mode toggle') && GR.REPOS_RE.test('repos') && GR.REPO_INFO_RE.test('repo voicepad') && !GR.REPO_RE.test('repo'));
ok('branchSlug + safeBranch: only mai/ names, no ..', GR.branchSlug('Please add a dark mode toggle to the header!') === 'add-dark-mode-toggle-header' && GR.safeBranch('mai/add-x') && !GR.safeBranch('main') && !GR.safeBranch('mai/../main') && !GR.safeBranch('feature/x'));
ok('treeList skips node_modules, lock files and binaries', GR.treeList([{ path: 'a.js', type: 'blob', size: 1 }, { path: 'node_modules/b.js', type: 'blob', size: 1 }, { path: 'package-lock.json', type: 'blob', size: 1 }, { path: 'x.png', type: 'blob', size: 1 }, { path: 'src/App.tsx', type: 'blob', size: 1 }]).map(f => f.path).join() === 'a.js,src/App.tsx');
ok('chooseFiles respects the read budget and file cap', GR.chooseFiles([{ path: 'a', size: 50000 }, { path: 'b', size: 50000 }, { path: 'c', size: 10 }, { path: 'big', size: 90000 }], ['big', 'a', 'b', 'c'], 60000).join() === 'a,c');
const cc = GR.checkChange({ 'a.js': 'const x = ;', 'b.json': '{bad', 'c.js': 'ok()\n', '.github/workflows/x.yml': 'on: push', 'd.js': '// ... rest of the code' }, { 'c.js': 'x'.repeat(5000) });
ok('checkChange: syntax, JSON, truncation, CI files, elisions', cc.some(x => /a\.js: JavaScript syntax error/.test(x)) && cc.some(x => /b\.json: invalid JSON/.test(x)) && cc.some(x => /c\.js: the new version is much shorter/.test(x)) && cc.some(x => /workflows.*not allowed/.test(x)) && cc.some(x => /d\.js: contains an elision/.test(x)));
ok('checkChange: TS/JSX skipped by the JS parser, clean code passes', GR.checkChange({ 'a.tsx': 'const x: number = <div/>;', 'b.js': 'export const y = 1;' }, {}).length === 0);
ok('lineDiff counts added/removed lines', JSON.stringify(GR.lineDiff('a\nb\nc', 'a\nc\nd\ne')) === '{"added":2,"removed":1}' && GR.lineDiff(null, 'x\ny').removed === 0);
ok('parseChange splits files and summary', (() => { const p = GR.parseChange('=== FILE: a.js ===\nx\n=== SUMMARY ===\n- did a\nnoise'); return p.files['a.js'] === 'x\n' && p.summary === '- did a'; })());
x = await say('repos');
ok('"repos" lists his repos and marks the live-site repo hands-off', x.sent.at(-1).includes('test-repo') && x.sent.at(-1).includes('hands off'));
x = await say('repo Blossom-website change the hero text');
ok('the live-site repo is refused before any job', x.sent.at(-1).includes('keep my hands off') && !db.jobs.some(j => j.kind === 'repo'));
x = await say('repo test-repo add a dark mode toggle', OTHER);
ok('only Michael can start repo jobs', x.sent.at(-1).includes('Only Michael'));
x = await say('repo test-repo add a dark mode toggle');
const rj = db.jobs.find(j => j.kind === 'repo');
ok('"repo <name> <change>" starts a repo job', rj && rj.input.repo === 'test-repo' && x.sent.at(-1).includes('never main'));
const deps = { sendText: async (to, t, c) => { c.outbox.push({ type: 'text', text: { body: t } }); return { ok: true }; }, uploadMedia: async (b, mime, c, name) => { c.outbox.push({ type: 'media_upload', bytes: b.length, mime, filename: name }); return { ok: true, id: 'MID' }; }, sendDocument: async (to, id, name, cap, c) => { c.outbox.push({ type: 'document', name }); return { ok: true }; }, sendMedia: async (to, id, type, cap, c) => { c.outbox.push({ type, caption: cap }); return { ok: true }; }, webResults: async q => ({ results: [1, 2, 3, 4].map(i => ({ title: `${q} result ${i}`, url: `https://site${i}-${q.length}.example.org/${encodeURIComponent(q)}`, snippet: `About ${q} number ${i}` })), news: [] }), fetchPage: async url => ({ ok: true, title: 'Page ' + url.slice(8, 30), text: ('Facts about free hosting from ' + url + '. ').repeat(40) }), jinaRead: async () => null, downloadFile: async (media) => media._buf ? { ok: true, buf: media._buf, mime: media.mime_type } : { ok: false, error: 'no media' } };
let tick = 0, res;
do { res = await A.runTick({ ns: 'wa-test', id: rj.id, deps, budgetMs: 600000 }); tick++; } while (res.more && tick < 5);
const rjob = db.jobs.find(j => j.id === rj.id);
ok('repo job: picked files, made the change, passed checks, pushed', rjob.status === 'done' && rjob.result.branch === 'mai/add-dark-mode-toggle-2' && rjob.result.compare.includes('compare/main...mai/add-dark-mode-toggle-2'));
ok('repo job: an existing branch name is never overwritten (new suffix), main never written', ghLog.filter(l => l.startsWith('POST') && l.includes('/git/refs')).length === 2 && !ghLog.some(l => /PATCH|PUT|DELETE/.test(l)) && !ghLog.some(l => /refs\/heads\/main/.test(l) && l.startsWith('POST')));
ok('repo job: message has the diff summary and the compare link', rjob.result.message.includes('+') && rjob.result.message.includes('Create pull request') && rjob.result.message.includes('Added a Dark button'));

// ======================= 5. research =======================
ok('detectResearch: topic + pdf flag', R.detectResearch('research best free hosting for Nigerian devs')?.topic === 'best free hosting for Nigerian devs' && R.detectResearch('research about cassava no pdf').pdf === false && R.detectResearch('researching') === null);
ok('cleanResearchPlan tops up to 8-10 queries without duplicates', (() => { const p = R.cleanResearchPlan({ queries: ['a', 'a', 'b'] }, 'cassava farming'); return p.queries.length >= 8 && new Set(p.queries).size === p.queries.length; })());
ok('pickPages: max 2 per domain, social/PDF skipped', (() => { const c = [1, 2, 3].map(i => ({ title: 'cassava ' + i, url: 'https://same.com/' + i, snippet: 'cassava', rank: 0 })).concat([{ title: 'cassava fb', url: 'https://facebook.com/x', snippet: 'cassava' }, { title: 'cassava pdf', url: 'https://x.org/a.pdf', snippet: 'cassava' }, { title: 'other', url: 'https://other.org', snippet: 'cassava farming' }]); const p = R.pickPages(c, 'cassava farming'); return p.filter(x => x.host === 'same.com').length === 2 && !p.some(x => /facebook|\.pdf/.test(x.url)) && p.some(x => x.host === 'other.org'); })());
ok('citedSources renumbers only real citations', JSON.stringify(R.citedSources(['a [3] b [1] c [3] [99]'], [1, 2, 3])) === '[3,1]');
x = await say('research best free hosting for Nigerian devs');
const resj = db.jobs.find(j => j.kind === 'research');
ok('"research <topic>" starts a research job', resj && resj.input.topic === 'best free hosting for Nigerian devs' && x.sent.at(-1).includes('PDF'));
tick = 0; do { res = await A.runTick({ ns: 'wa-test', id: resj.id, deps, budgetMs: 600000 }); tick++; } while (res.more && tick < 6);
const rsj = db.jobs.find(j => j.id === resj.id);
ok('research job: many searches, pages read, report written', rsj.status === 'done' && rsj.steps.some(s => /searched 5\/\d+|searched \d+\/\d+: \d+ unique/.test(s)) && rsj.result.pages >= 8 && rsj.result.sources >= 3);
ok('research job: WhatsApp summary with numbered sources + a PDF document', rsj.result.message.includes('Sources') && /\[1\] /.test(rsj.result.message) && rsj.result.pdf === true && rsj.steps.some(s => /pdf: \d+ KB sent/.test(s)));
ok('research: more searches/reads than the 12-step agent loop', rsj.steps.some(s => /searched (\d+)/.test(s) && +s.match(/searched (\d+)/)[1] >= 8) || rsj.state.qDone >= 8);

// ======================= 6. Sow posts =======================
x = await say('post God is faithful 🙏');
ok('"post <text>" queues it in Sow for now (Lagos time)', db.sow.length === 1 && db.sow[0].caption === 'God is faithful 🙏' && x.sent.at(-1).includes('Queued in *Sow*') && db.sow[0].post_date === SOW.watParts(Date.now()).date);
x = await say('schedule tomorrow 7am New chapter out!');
ok('"schedule <time> <text>" queues at that time, punctuation kept', db.sow.length === 2 && db.sow[1].caption === 'New chapter out!' && db.sow[1].post_time === '07:00:00' && x.sent.at(-1).includes('Scheduled'));
x = await say('schedule sometime');
ok('schedule without a time asks how', x.sent.at(-1).includes('When should it go out'));
x = await say('queued posts');
ok('"queued posts" lists them', x.sent.at(-1).includes('New chapter out!'));
x = await say('unpost');
ok('"unpost" removes my most recent one', db.sow.length === 1 && x.sent.at(-1).includes('Removed'));
x = await say('post something', OTHER);
ok('only Michael can post', x.sent.at(-1).includes('Only Michael') && db.sow.length === 1);
ok('"post: topic" still goes to the Facebook draft flow, "post it" untouched', SOW.detectPost('post: a verse') === null && SOW.detectPost('post it') === null && SOW.detectPost('post God is good', { pending: true }) === null);

// ======================= 7. media =======================
ok('media commands parse', M.parseMediaCmd('trim 0:05-0:20').start === 5 && M.parseMediaCmd('trim 1:00 to 1:30').end === 90 && M.parseMediaCmd('compress').op === 'compress' && M.parseMediaCmd('caption top: Hello').pos === 'top' && M.parseMediaCmd('extract audio').op === 'audio' && M.parseMediaCmd('make video').op === 'imgaudio' && M.parseMediaCmd('trim 9-3').op === 'bad' && M.parseMediaCmd('what is a video') === null);
ok('wrapCaption: short lines, max 4', M.wrapCaption('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty', 20).split('\n').length === 4);
const clip = fs.existsSync('/tmp/mt/clip.mp4') ? fs.readFileSync('/tmp/mt/clip.mp4') : null;
if (clip) {
  const vid = { type: 'video', video: { id: 'VID1', mime_type: 'video/mp4', caption: 'trim 0:01-0:04', _test_b64: clip.toString('base64') } };
  const c = ctx(); await m.processMessage({ from: OWNER, id: 'wamid.v7v', ...vid }, 'T', c);
  const mj = db.jobs.find(j => j.kind === 'media');
  ok('a video with a command caption starts a media job (test bytes ride along)', mj && mj.input.cmd.op === 'trim' && mj.input.media.video._test_b64);
  const ffDeps = { ...deps, mediaProcess: M.process1, mediaCaption: M.doneCaption, downloadFile: async (media) => ({ ok: true, buf: Buffer.from(media._test_b64, 'base64'), mime: media.mime_type }) };
  ok('the chat worker never claims media jobs', (await A.runTick({ ns: 'wa-test', deps, notKinds: ['media'], budgetMs: 600000 })).idle === true);
  res = await A.runTick({ ns: 'wa-test', id: mj.id, deps: ffDeps, kinds: ['media'], budgetMs: 600000 });
  const mjd = db.jobs.find(j => j.id === mj.id);
  ok('media job: real ffmpeg trims, uploads and sends the video', mjd.status === 'done' && mjd.result.op === 'trim' && mjd.result.sent && mjd.steps.some(s => /media trim: \d+ KB video\/mp4 3s/.test(s)));
  x = await say('extract audio');
  const aj = db.jobs.filter(j => j.kind === 'media').at(-1);
  ok('a text command after a video uses that video', aj.input.cmd.op === 'audio' && aj.input.media.video.id === 'VID1');
  res = await A.runTick({ ns: 'wa-test', id: aj.id, deps: ffDeps, kinds: ['media'], budgetMs: 600000 });
  ok('extract audio -> MP3 sent as audio', db.jobs.find(j => j.id === aj.id).status === 'done' && db.jobs.find(j => j.id === aj.id).steps.some(s => /audio\/mpeg/.test(s)));
  const c2 = ctx(); await m.processMessage({ from: OWNER, id: 'wamid.v7v2', type: 'video', video: { id: 'VID2', mime_type: 'video/mp4' } }, 'T', c2);
  ok('a video without a caption gets the menu', texts(c2).at(-1).includes('What should I do with it'));
} else console.log('(skip ffmpeg flow: /tmp/mt/clip.mp4 missing)');
x = await say('make video');
ok('"make video" without a recent picture + audio explains what to send', x.sent.at(-1).includes('Send me a picture and a voice note'));


// ======================= 8b. real APK (packager + Vercel mocked) =======================
{
  const AP = await import('./api/_apk.js');
  ok('packageId is a valid Android id', AP.packageId('bible-books-quiz-2') === 'ng.michaelai.biblebooksquiz2' && AP.packageId('2048-game') === 'ng.michaelai.a2048game');
  const opt = AP.packOptions({ slug: 'quiz', title: 'Bible Quiz', url: 'https://mai-quiz.vercel.app' }, { palette: { primary: '#123456' } });
  ok('packOptions: host, manifest, icon, colours, new signing key', opt.host === 'mai-quiz.vercel.app' && opt.webManifestUrl === 'https://mai-quiz.vercel.app/manifest.webmanifest' && opt.themeColor === '#123456' && opt.signingMode === 'new');
  db.sites['wa-test/quiz'] = { ns: 'wa-test', slug: 'quiz', owner: OWNER, title: 'Bible Quiz', kind: 'app', url: 'https://mai-quiz.vercel.app', project: 'mai-quiz', version: 1, files: { 'index.html': '<!DOCTYPE html><html><head><title>Q</title></head><body>Q</body></html>', 'style.css': '', 'app.js': '', '_plan.json': JSON.stringify({ title: 'Bible Quiz', type: 'app', palette: {} }) } };
  const fakeZip = S.zipFiles({ 'Bible Quiz.apk': { b64: Buffer.from('PK-fake-apk-bytes').toString('base64') }, 'assetlinks.json': '[{"target":{"package_name":"ng.michaelai.quiz"}}]', 'signing.keystore': { b64: 'AAAA' } }, '').subarray(0);
  const prevFetch = globalThis.fetch; const vlog = [];
  globalThis.fetch = async (u, o = {}) => {
    const s = String(u);
    if (s.includes('pwabuilder-cloudapk')) { vlog.push('pack ' + JSON.parse(o.body).packageId); return new Response(fakeZip, { status: 200, headers: { 'content-type': 'application/zip' } }); }
    if (s.startsWith('https://api.vercel.com/v2/files')) { vlog.push('upload'); return new Response('{}', { status: 200 }); }
    if (s.startsWith('https://api.vercel.com/v13/deployments?')) { const b = JSON.parse(o.body); vlog.push('deploy ' + b.files.map(f => f.file).sort().join(',')); return new Response('{"id":"dpl_apk1","projectId":"prj_q"}', { status: 200 }); }
    if (s.startsWith('https://api.vercel.com/v13/deployments/')) return new Response('{"readyState":"READY","alias":["mai-quiz.vercel.app"]}', { status: 200 });
    if (s.startsWith('https://mai-quiz.vercel.app/app.apk')) return new Response('', { status: 200 });
    return prevFetch(u, o);
  };
  x = await say('apk quiz');
  const apj = db.jobs.find(j => j.kind === 'apk');
  ok('"apk <app>" starts a real-APK job (and still gives the Chrome install tip)', apj && apj.input.slug === 'quiz' && x.sent.at(-1).includes('real APK') && x.sent.at(-1).includes('Add to Home screen'));
  tick = 0; do { res = await A.runTick({ ns: 'wa-test', id: apj.id, deps, budgetMs: 600000 }); tick++; } while (res.more && tick < 4);
  const apd = db.jobs.find(j => j.id === apj.id);
  ok('APK job: packaged, then redeployed the site with app.apk + .well-known/assetlinks.json', apd.status === 'done' && vlog.some(l => l.startsWith('pack ng.michaelai.quiz')) && vlog.some(l => /deploy .*\.well-known\/assetlinks\.json.*app\.apk/.test(l)));
  ok('APK job: sends the zip privately and the download link', apd.result.url === 'https://mai-quiz.vercel.app/app.apk' && apd.result.zip_sent && apd.result.message.includes('signing key') && apd.state.outbox.some(o => /android-v1\.zip/.test(o)));
  ok('APK job: the site keeps app.apk + assetlinks for later edits; keystore never deployed', db.sites['wa-test/quiz'].files['app.apk']?.b64 && db.sites['wa-test/quiz'].files['.well-known/assetlinks.json'] && !vlog.some(l => /keystore/.test(l)));
  globalThis.fetch = prevFetch;
}

// ======================= 8. Gemini load: key 2, retry, cache, quota =======================
G._resetForTests(); gemCalls = []; gemMode = 'k1-429'; process.env.GEMINI_API_KEY_2 = 'key-two';
let g = await S.gem('hello', { chain: ['gemini-x'], maxTokens: 100 });
ok('429 on key 1 -> same model on key 2, answer comes back', g.ok && gemCalls.map(c => c.key).join() === 'key-one,key-two');
gemCalls = []; g = await S.gem('hello again', { chain: ['gemini-x'], maxTokens: 100 });
ok('key 1 stays parked for that model (goes straight to key 2)', g.ok && gemCalls.map(c => c.key).join() === 'key-two');
G._resetForTests(); delete process.env.GEMINI_API_KEY_2; gemCalls = []; gemMode = '503-once';
g = await S.gem('busy test', { chain: ['gemini-y', 'gemini-z'], maxTokens: 100 });
ok('503 -> one retry with backoff on the same model before falling back', g.ok && g.model === 'gemini-y' && gemCalls.length === 2);
gemMode = 'ok'; gemCalls = [];
const c1 = await S.gem('cache me', { chain: ['gemini-y'], cache: J.rpc }); const c2r = await S.gem('cache me', { chain: ['gemini-y'], cache: J.rpc });
ok('cacheable calls: the second identical prompt costs no AI call', c1.ok && c2r.model === 'cache' && gemCalls.length === 1);
const rows = G.usageRows();
ok('usage counters per model / key / source', rows.some(r => r.model === 'gemini-y' && r.e5xx >= 1 && r.ok >= 1));
await G.flushUsage(J.rpc);
x = await say('quota');
ok('"quota" shows chat counts plus all AI calls today and the key status', x.sent.at(-1).includes('Today\'s usage') && x.sent.at(-1).includes('All AI calls today') && x.sent.at(-1).includes('1 Gemini key'));

// ======================= 9. help + health =======================
x = await say('help');
ok('help: short, grouped, lists the new commands', x.sent.at(-1).length < 1100 && ['orders <site>', 'export <site>', 'repo <name> <change>', 'research <topic>', 'post <text>', 'schedule', 'trim', 'make video'].every(k => x.sent.at(-1).includes(k)));
{ const r = await m.GET(new Request('http://x/api/whatsapp?health=1')); const h = await r.json();
  ok('health: build v7.x with the new flags', /^v[78]\.[0-9]/.test(h.build) && h.v7.site_backend === true && h.v7.repos === true && h.v7.research === true && /off/.test(h.v7.payments) && h.v7.repo_branch_prefix === 'mai/' && h.v7.sow_posts === true); }
// the agent's backend build path: plan -> backend -> key -> decorate (mocked Gemini returns a plan without backend; the brief needs one)
ok('agent build: a brief that needs a backend gets one even if the plan forgot it', (() => { const p = A.cleanPlan({ title: 'Bakery', type: 'site' }, 'bakery site with an order form'); const bk = B.cleanBackend(p.backend) || (B.wantsBackend('bakery site with an order form') ? B.defaultBackend('bakery site with an order form') : null); return bk && bk.collections[0].kind === 'order'; })());
ok('doneText: backend sites say where orders go and how to see them', (() => { const t = A.doneText({ title: 'Bakery', url: 'https://x', kind: 'site', slug: 'bakery', version: 1, backend: be }); return t.includes('Real backend') && t.includes('ping you') && t.includes('Payments coming soon') && t.includes('orders bakery'); })());

// v7.0 post-deploy fixes (worker fef5da8e)
{ const now = Date.UTC(2026, 9, 7, 2, 0); const p1 = SOW.parseSchedule('tomorrow 7am E2E test, please ignore', now), p2 = SOW.parseSchedule('tomorrow 9am Please share this', now), p3 = SOW.parseSchedule('friday 8pm New chapter out now', now);
  ok('schedule keeps his exact words ("please" inside and at the start)', p1.text === 'E2E test, please ignore' && p2.text === 'Please share this');
  ok('schedule: a bare weekday means that day, not today', p3.ok && p3.text === 'New chapter out now' && new Date(p3.due + 3600e3).toISOString().startsWith('2026-10-09T20:00')); }
ok('research: a trailing "pdf" is a flag, not part of the topic', R.detectResearch('research best hosting in 2026 pdf').topic === 'best hosting in 2026' && R.detectResearch('research pdf readers for android').topic === 'pdf readers for android');
ok('repo protection matches "Blossom-website." too', GR.isProtected('Blossom-website.') && GR.isProtected('blossom-website') && !GR.isProtected('voicepad'));
ok('mai.js renders a numeric rating as stars', B.CLIENT_JS ? /u2b50|⭐/.test(B.CLIENT_JS) : /u2b50/.test(fs.readFileSync('./api/_backend.js', 'utf8')));
globalThis.fetch = realFetch;
console.log(`\n${n} checks passed`);
