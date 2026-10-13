// v6 tests: AGENT MODE (job queue, agent loop, build sites & apps). All mocked: an in-memory job store stands in for Supabase,
// Gemini / Vercel / images / web are faked; chat goes through processMessage in the test ctx (state under wa-test/ in the real Blob store, cleaned at the end).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
process.env.WA_TEST_KEY = process.env.WA_TEST_KEY || 'local-test-key-0123456789abcdef';
delete process.env.SB_URL; delete process.env.SCHED_KEY;
process.env.WA_ALLOWED = '2348148034092,2348000000001';
process.env.APK_OFF = '1';   // v7: "apk" now packages a real APK (tested in t_v7); this suite keeps the v6 honest answer
process.env.VERCEL_TOKEN = 'test-vercel-token'; process.env.VERCEL_TEAM_ID = 'team_test';
process.env.SB_URL = 'https://sb.test'; process.env.SB_ANON_KEY = 'anon'; process.env.SCHED_KEY = 'sched-test';   // jobsOn() true; rpc is mocked
const realFetch = globalThis.fetch;
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; console.log('✔', name); };

// ---------- in-memory michael_ai_jobs ----------
const db = { jobs: [], sites: {}, seq: 0 };
const today = () => new Date().toISOString().slice(0, 10);
function store(op, a) {
  const ns = a.ns || 'wa';
  const J = db.jobs;
  switch (op) {
    case 'create': { const j = { id: ++db.seq, owner: a.owner, ns, kind: a.kind, input: a.input || {}, status: 'queued', steps: [], state: {}, result: null, ticks: 0, lease_until: null, delivered: false, created: new Date().toISOString(), updated: new Date().toISOString() }; J.push(j); return structuredClone(j); }
    case 'claim': { const j = J.find(x => x.ns === ns && ['queued', 'running'].includes(x.status) && (!x.lease_until || x.lease_until < Date.now()) && (a.id == null || x.id === +a.id)); if (!j) return null; j.status = 'running'; j.ticks++; j.lease_until = Date.now() + a.lease_s * 1000; return structuredClone(j); }
    case 'save': { const j = J.find(x => x.id === +a.id); if (j.status !== 'cancelled' && a.status) j.status = a.status; if (a.steps) j.steps = a.steps; if (a.state) j.state = a.state; if (a.result) j.result = a.result; if (a.delivered != null) j.delivered = a.delivered; if (a.release) j.lease_until = null; return { id: j.id, status: j.status }; }
    case 'get': { const j = J.find(x => x.id === +a.id && x.ns === ns); return j ? structuredClone(j) : null; }
    case 'list': return J.filter(x => x.ns === ns && x.owner === a.owner).sort((x, y) => y.id - x.id).slice(0, a.limit || 8).map(x => ({ id: x.id, kind: x.kind, status: x.status, brief: x.input.brief, url: x.result?.url || null, error: x.result?.error || null }));
    case 'cancel': { const j = J.find(x => x.ns === ns && x.owner === a.owner && x.id === +a.id && ['queued', 'running'].includes(x.status)); if (j) { j.status = 'cancelled'; j.delivered = true; } return { cancelled: j ? 1 : 0 }; }
    case 'count_today': return J.filter(x => x.ns === ns && x.owner === a.owner && (a.kinds || ['build', 'edit']).includes(x.kind) && x.status !== 'cancelled' && x.created.slice(0, 10) === today()).length;
    case 'open_count': return J.filter(x => x.ns === ns && x.owner === a.owner && ['queued', 'running'].includes(x.status)).length;
    case 'undelivered': return J.filter(x => x.ns === ns && x.owner === a.owner && ['done', 'failed'].includes(x.status) && !x.delivered).map(x => structuredClone(x));
    case 'site_get': return db.sites[ns + '/' + a.slug] ? structuredClone(db.sites[ns + '/' + a.slug]) : null;
    case 'site_put': { db.sites[ns + '/' + a.slug] = { ...a, updated: new Date().toISOString() }; return { slug: a.slug, version: a.version }; }
    case 'site_list': return Object.values(db.sites).filter(s => s.ns === ns && s.owner === a.owner).map(s => ({ slug: s.slug, title: s.title, kind: s.kind, url: s.url, version: s.version, project: s.project }));
  }
  throw new Error('op ' + op);
}

// ---------- fake Gemini / Vercel / web ----------
const GOOD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bible Books Quiz</title><link rel="stylesheet" href="style.css"></head>
<body><header><h1>Bible Books Quiz</h1></header><main id="app"><p id="q">Which book comes after Genesis?</p><div id="opts"></div><button id="next" type="button">Next</button><p id="score">Score: 0</p></main>
<footer><p>Made for Bible lovers</p></footer><script src="app.js"></script></body></html>`;
const GOOD_CSS = ':root{--p:#1d4ed8}body{margin:0;font-family:sans-serif}header{background:var(--p);color:#fff;padding:1rem}';
const GOOD_JS = "const q=document.getElementById('q');const o=document.getElementById('opts');const nx=document.getElementById('next');let s=0;\nif(nx){nx.addEventListener('click',()=>{s++;document.getElementById('score').textContent='Score: '+s;});}";
const BAD_JS = "const q=document.getElementById('q');\nfunction broken( {\n  return 1;\n}";
const filesText = (html, css, js) => `=== FILE: index.html ===\n${html}\n=== FILE: style.css ===\n${css}\n=== FILE: app.js ===\n${js}`;
let gem = [], codeMode = 'buggy-then-good', agentScript = [], vercel = [], imgCalls = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const okJson = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('generativelanguage')) {
    const model = u.match(/models\/([^:]+)/)[1];
    const body = JSON.parse(opts.body);
    const user = body.contents.at(-1).parts.map(p => p.text || '').join('\n');
    const sys = body.systemInstruction?.parts?.[0]?.text || '';
    gem.push({ model, user: user.slice(0, 300), sys: sys.slice(0, 80), max: body.generationConfig.maxOutputTokens, json: body.generationConfig.responseMimeType });
    const okr = t => okJson({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] });
    if (sys.startsWith('You are a senior product designer')) return okr(JSON.stringify({ title: 'Bible Books Quiz', slug: 'bible-books-quiz', type: 'app', tagline: 'Know your Bible', description: 'A quiz on the order of the books of the Bible.', palette: { primary: '#1d4ed8', accent: '#f59e0b', bg: '#ffffff', surface: '#f3f4f6', text: '#111827' }, sections: ['start', 'question', 'result'], features: ['score'], images: [{ name: 'hero', prompt: 'open bible on a table', w: 1200, h: 800 }], research: [] }));
    if (sys.startsWith('You are an elite front-end')) {
      if (user.startsWith('An automated check found')) return okr(filesText(GOOD_HTML, GOOD_CSS, GOOD_JS));
      if (user.includes('Apply this change from the owner')) return okr(filesText(GOOD_HTML.replace('Next', 'Next question'), GOOD_CSS.replace('#1d4ed8', '#15803d'), GOOD_JS));
      return okr(filesText(GOOD_HTML, GOOD_CSS, codeMode === 'buggy-then-good' ? BAD_JS : GOOD_JS));
    }
    if (sys.startsWith('You are Michael AI in agent mode')) return okr(JSON.stringify(agentScript.shift() || { tool: 'finish', args: { answer: 'done' } }));
    return okr(`answer from ${model}`);
  }
  if (u.startsWith('https://api.vercel.com')) {
    vercel.push((opts.method || 'GET') + ' ' + u.replace(/\?.*$/, ''));
    if (u.includes('/v9/projects/') && (!opts.method || opts.method === 'GET')) return new Response('{}', { status: 404 });
    if (u.includes('/v2/files')) return okJson({});
    if (u.includes('/v13/deployments') && opts.method === 'POST') { const b = JSON.parse(opts.body); return okJson({ id: 'dpl_test' + vercel.length, projectId: 'prj_' + b.name, url: b.name + '-abc123.vercel.app' }); }
    if (u.includes('/v13/deployments/')) return okJson({ readyState: 'READY', alias: ['mai-x-abc.vercel.app', u.includes('dpl_') ? 'mai-bible-books-quiz.vercel.app' : ''], url: 'x-abc123.vercel.app' });
    if (opts.method === 'PATCH') return okJson({});
    return okJson({});
  }
  if (/mai-[\w-]+\.vercel\.app/.test(u)) return new Response('<!DOCTYPE html><html><head><title>Bible Books Quiz</title></head><body>ok</body></html>', { status: 200 });
  return realFetch(url, opts);
};

const J = await import('./api/_jobs.js');
J.setMock(store);
const S = await import('./api/_sites.js');
const A = await import('./api/_agent.js');
const m = await import('./api/whatsapp.js');
const v = await import('./api/_v5.js');
const OWNER = '2348148034092', OTHER = '2348000000001';
const fakeImage = async () => { imgCalls++; return { ok: true, bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), mime: 'image/jpeg' }; };
let sendFail = false;
const deps = {
  sendText: async (to, text, ctx) => { if (sendFail) return { ok: false, status: 400, detail: '(#131047) Re-engagement message' }; return m.sendText(to, text, ctx); },
  uploadMedia: m.uploadMedia, sendImage: m.sendImage, loadKB: m.loadKB, saveKB: m.saveKB, addFact: m.addFact,
  generateImage: fakeImage, fetchPage: async url => ({ ok: true, title: 'Page', text: 'JAMB 2026 registration opens in January. Source text.' }),
  webResults: async q => ({ results: [{ title: 'JAMB news', url: 'https://example.org/jamb', snippet: 'JAMB registration dates' }] }), readTop: async () => [], jinaRead: async () => null, profile: 'Michael is a Nigerian author.',
};
let mid = 0;
async function say(text, from = OWNER) {
  const ctx = { test: true, ns: 'wa-test', outbox: [] };
  const r = await m.processMessage({ id: 'wamid.v6test' + Date.now() + (++mid), from, type: 'text', text: { body: text } }, 'Michael', ctx);
  return { ...r, sent: ctx.outbox.filter(b => b.type === 'text').map(b => b.text.body), docs: ctx.outbox.filter(b => b.type === 'document'), uploads: ctx.outbox.filter(b => b.type === 'media_upload') };
}

// ---------- 1. intents ----------
for (const t of ['build me a landing page for my bakery', 'make a quiz app about the books of the Bible', 'Please create a portfolio website for me', 'build: a todo app with dark mode', 'design a website for my church youth group', 'Can you build me a calculator app for JAMB aggregate']) ok(`detectBuild yes: ${t}`, !!J.detectBuild(t));
for (const t of ['how do I build a website?', 'what app should I make?', 'can you build apps?', 'make me a flyer for my event', 'is it going to site or app?', 'remind me to build the site at 5pm']) ok(`detectBuild no: ${t}`, !J.detectBuild(t));
ok('agent: prefix', J.detectAgent('agent: find 5 JAMB sites')?.brief === 'find 5 JAMB sites' && J.detectAgent('research: compare free hosts')?.brief === 'compare free hosts' && !J.detectAgent('tell me about agents'));
ok('jobs / cancel / my sites / edit / zip / apk regexes', J.JOBS_RE.test('jobs') && J.CANCEL_JOB_RE.exec('cancel 12')[1] === '12' && J.CANCEL_JOB_RE.exec('cancel job #7')[1] === '7' && !J.CANCEL_JOB_RE.test('cancel') && J.SITES_RE.test('my sites') && J.EDIT_RE.exec('edit bakery make the header green')[1] === 'bakery' && J.ZIP_RE.exec('zip bakery')[1] === 'bakery' && J.APK_RE.test('make apk') && J.APK_RE.exec('apk bible-quiz')[1] === 'bible-quiz');
ok('"/cancel 2" still cancels a reminder (v5), not a job', v.CANCEL_REM_RE.test('/cancel 2'));
ok('slugify', J.slugify("Mama Tolu's Bakery & Cakes!") === 'mama-tolus-bakery-cakes' && J.slugify('') === 'site');

// ---------- 2. self-check ----------
const good = { 'index.html': GOOD_HTML, 'style.css': GOOD_CSS, 'app.js': GOOD_JS };
ok('checkSite: clean site passes', S.checkSite(good).length === 0);
ok('checkSite: JS syntax error found (acorn)', S.checkSite({ ...good, 'app.js': BAD_JS }).some(x => /syntax error/.test(x)));
ok('checkSite: missing local file found', S.checkSite({ ...good, 'index.html': GOOD_HTML.replace('style.css', 'css/main.css') }).some(x => /doesn't exist/.test(x)));
ok('checkSite: placeholder text found', S.checkSite({ ...good, 'index.html': GOOD_HTML.replace('Made for Bible lovers', 'Lorem ipsum dolor') }).some(x => /placeholder/.test(x)) && S.checkSite({ ...good, 'index.html': GOOD_HTML.replace('Made for Bible lovers', 'Call 123-456-7890') }).some(x => /placeholder/.test(x)));
ok('checkSite: unbalanced tags + cut-off page found', S.checkSite({ ...good, 'index.html': GOOD_HTML.replace('</main>', '') }).some(x => /unbalanced <main>/.test(x)) && S.checkSite({ ...good, 'index.html': GOOD_HTML.slice(0, -20) }).some(x => /cut off/.test(x)));
ok('checkSite: JS looks up an id the HTML lacks', S.checkSite({ ...good, 'app.js': GOOD_JS + "\ndocument.getElementById('ghost');" }).some(x => /ghost/.test(x)));
ok('checkSite: broken inline script found', S.checkSite({ ...good, 'index.html': GOOD_HTML.replace('</body>', '<script>let x = ;</script></body>') }).some(x => /inline script 1/.test(x)));
ok('invented prices / phone numbers flagged unless the request gave them', S.checkSite({ ...good, 'index.html': GOOD_HTML.replace('Made for Bible lovers', 'Agege bread ₦1,200 · call 0803 123 4567') }, { facts: 'a bakery landing page' }).filter(x => /invented/.test(x)).length === 2 && S.checkSite({ ...good, 'index.html': GOOD_HTML.replace('Made for Bible lovers', 'Agege bread ₦1,200 · call 0803 123 4567') }, { facts: 'bread is 1200 naira, call 08031234567' }).length === 0);
ok('parseJson takes the first of several JSON objects', S.parseJson('{"tool":"web_search","args":{"q":"a}b"}}\n{"tool":"finish"}')?.args?.q === 'a}b');
ok('parseFiles reads the three files (and strips code fences)', (() => { const f = S.parseFiles('=== FILE: index.html ===\n```html\n<p>hi</p>\n```\n=== FILE: app.js ===\nlet a=1;'); return f['index.html'] === '<p>hi</p>\n' && f['app.js'] === 'let a=1;\n'; })());

// ---------- 3. decorate, icons, zip ----------
const dec = S.decorate({ ...good, 'img/hero.jpg': { b64: 'AAAA' } }, { title: 'Bible Books Quiz', slug: 'bible-books-quiz', type: 'app', palette: { primary: '#1d4ed8', accent: '#f59e0b', bg: '#fff' }, description: 'quiz' });
ok('decorate (app): manifest, service worker, icons, OG + theme tags', dec['manifest.webmanifest'] && JSON.parse(dec['manifest.webmanifest']).icons.length === 2 && dec['sw.js'].includes("caches.open") && dec['index.html'].includes('rel="manifest"') && dec['index.html'].includes("register('sw.js')") && dec['index.html'].includes('og:image') && dec['icon-512.png'].b64);
ok('decorated app still passes the self-check (sw.js parses)', S.checkSite(dec).length === 0);
ok('stripInjected removes what decorate added', !S.stripInjected(dec['index.html']).includes('mai:head') && !S.stripInjected(dec['index.html']).includes('serviceWorker'));
ok('decorate (site): no manifest / sw', (() => { const d = S.decorate(good, { title: 'Bakery', type: 'site' }); return !d['sw.js'] && !d['manifest.webmanifest'] && d['icon-192.png']; })());
const png = Buffer.from(dec['icon-512.png'].b64, 'base64');
ok('icon PNG: signature, 512x512 IHDR', png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === 512 && png.readUInt32BE(20) === 512);
fs.writeFileSync('/tmp/mai-test.zip', S.zipFiles({ 'index.html': GOOD_HTML, 'img/a.png': { b64: png.toString('base64') } }, 'quiz'));
ok('zip: valid archive (unzip -t)', /No errors detected/.test(execSync('unzip -t /tmp/mai-test.zip').toString()));
ok('bestAlias prefers mai-<slug>.vercel.app', S.bestAlias(['mai-x-abc123-team.vercel.app', 'mai-x.vercel.app'], 'mai-x') === 'mai-x.vercel.app');

// ---------- 4. chat: start jobs, guards, lists ----------
let x = await say('build me a quiz app about the books of the Bible');
ok('build request: instant "On it" reply with the job number', x.sent.at(-1).startsWith('On it 🛠️ Building your app') && /Job #1/.test(x.sent.at(-1)) && x.job?.kind === 'build');
ok('job queued in the store with the brief', db.jobs[0].kind === 'build' && db.jobs[0].status === 'queued' && db.jobs[0].ns === 'wa-test' && db.jobs[0].input.brief.includes('books of the Bible'));
x = await say('make a portfolio website for me', OTHER);
ok('only Michael\'s own number can build', x.sent.at(-1).includes('Only Michael') && db.jobs.length === 1);
x = await say('how do I build a website?');
ok('a question about building goes to normal chat, not a job', db.jobs.length === 1 && !x.sent.at(-1).startsWith('On it'));
x = await say('jobs');
ok('"jobs" lists the job with its status', x.sent.at(-1).includes('#1 Build') && x.sent.at(-1).includes('queued'));

// ---------- 5. worker: run the build ----------
gem = []; vercel = [];
let t = await A.runTick({ ns: 'wa-test', deps, budgetMs: 290000 });
let job = db.jobs[0];
ok('tick: build finished in one tick', t.status === 'done' && job.status === 'done' && job.result.url === 'https://mai-bible-books-quiz.vercel.app', JSON.stringify(t));
ok('pipeline steps logged: plan → images → code → check (bug) → fix → check clean → deploy → ready → verify → saved', ['plan:', 'images: 1/1', 'code:', 'check: 1 issue', 'fix 1', 'check: clean', 'deploy: dpl_', 'ready:', 'verify: HTTP 200', 'site saved'].every(k => job.steps.some(s => s.includes(k))));
ok('self-check caught the JS syntax error and the fix pass repaired it', job.steps.some(s => /check: 1 issue.*syntax error/.test(s)));
ok('deployed to a NEW project named mai-<slug> under the team (files uploaded by sha, v13)', vercel.some(s => s.startsWith('POST https://api.vercel.com/v2/files')) && vercel.some(s => s === 'POST https://api.vercel.com/v13/deployments') && vercel.some(s => s.startsWith('PATCH https://api.vercel.com/v9/projects/prj_mai-bible-books-quiz')));
ok('progress ping + final message with the live link and install steps (2 sends)', job.state.outbox.length === 2 && job.state.outbox[0].startsWith('📐 Plan ready') && job.state.outbox[1].includes('https://mai-bible-books-quiz.vercel.app') && job.state.outbox[1].includes('Add to Home screen'));
ok('job row kept light after the build (no files/images in state)', !job.state.files && !job.state.images && job.delivered === true && job.lease_until === null);
const site = db.sites['wa-test/bible-books-quiz'];
ok('site source stored (html/css/js, image, plan) for edits', site && site.files['index.html'] && site.files['app.js'].trim() === GOOD_JS && site.files['img/hero.jpg']?.b64 && JSON.parse(site.files['_plan.json']).type === 'app' && site.version === 1);
ok('code model asked for a long output, plan asked for JSON', gem.some(g => g.max === 32000) && gem.some(g => g.json === 'application/json'));
x = await say('my sites');
ok('"my sites" lists it with the URL', x.sent.at(-1).includes('Bible Books Quiz') && x.sent.at(-1).includes('https://mai-bible-books-quiz.vercel.app'));
x = await say('zip bible-books-quiz');
ok('"zip <site>" sends the source as a zip document', x.uploads.at(-1)?.mime === 'application/zip' && x.docs.at(-1)?.document.filename === 'bible-books-quiz-v1.zip' && x.sent.at(-1).includes('full code'));
x = await say('make apk');
ok('"make apk": honest answer + PWA install steps with the app link', x.sent.at(-1).includes('real APK') && x.sent.at(-1).includes('Add to Home screen') && x.sent.at(-1).includes('mai-bible-books-quiz.vercel.app'));

// ---------- 6. edit ----------
x = await say('edit bible-books-quiz make the colours green');
ok('"edit <site> <change>" queues an edit job', x.sent.at(-1).startsWith('On it ✏️ Updating *Bible Books Quiz*') && db.jobs.at(-1).kind === 'edit' && db.jobs.at(-1).input.slug === 'bible-books-quiz');
vercel = [];
t = await A.runTick({ ns: 'wa-test', deps, budgetMs: 290000 });
job = db.jobs.at(-1);
ok('edit redeployed to the SAME project, v2, link sent', t.status === 'done' && vercel.filter(s => s === 'POST https://api.vercel.com/v13/deployments').length === 1 && !vercel.some(s => s.startsWith('PATCH')) && db.sites['wa-test/bible-books-quiz'].version === 2 && db.sites['wa-test/bible-books-quiz'].files['style.css'].includes('#15803d') && job.state.outbox.at(-1).includes('updated (v2)'));
x = await say('edit the second line of my draft');
ok('"edit <word>" that is not a site falls through to normal chat', db.jobs.at(-1).kind === 'edit' && db.jobs.length === 2);

// ---------- 7. agent loop ----------
agentScript = [
  { thought: 'search first', tool: 'web_search', args: { q: 'JAMB 2026 registration date' } },
  { thought: 'read the source', tool: 'web_read', args: { url: 'https://example.org/jamb' } },
  { thought: 'tell him', tool: 'send_update', args: { text: 'Found the date, writing it up' } },
  { thought: 'done', tool: 'finish', args: { answer: '*JAMB 2026*: registration opens in January.\nSource: https://example.org/jamb' } },
];
x = await say('agent: find when JAMB 2026 registration opens');
ok('"agent:" queues a background task', x.sent.at(-1).startsWith('On it 🧠') && db.jobs.at(-1).kind === 'agent');
t = await A.runTick({ ns: 'wa-test', deps, budgetMs: 290000 });
job = db.jobs.at(-1);
ok('agent loop: search → read → update → finish, answer sent', t.status === 'done' && job.state.obs.length === 3 && job.state.obs[0].result.includes('JAMB news') && job.state.obs[1].result.includes('January') && job.state.outbox.length === 2 && job.state.outbox.at(-1).includes('registration opens in January'));
agentScript = [{ tool: 'remember', args: { fact: 'My bakery client is Mama Tolu.' } }, { tool: 'build_site', args: { brief: 'a quiz app about Bible books' } }, { tool: 'finish', args: { answer: 'Built it: https://mai-bible-books-quiz-2.vercel.app' } }];
codeMode = 'good';
x = await say('agent: remember my client Mama Tolu and build a quiz app');
t = await A.runTick({ ns: 'wa-test', deps, budgetMs: 290000 });
job = db.jobs.at(-1);
const kb = await m.loadKB(OWNER, { test: true, ns: 'wa-test', outbox: [] });
if (process.env.DEBUG) console.log(JSON.stringify({ t, steps: job.steps, obs: job.state.obs, facts: kb.facts.slice(-2), sites: Object.keys(db.sites) }, null, 1));
ok('agent tools remember + build_site (reuses the build pipeline, then finishes)', t.status === 'done' && kb.facts.some(f => String(f.t || f).includes('Mama Tolu')) && job.state.obs.some(o => o.tool === 'build_site' && o.result.includes('Built and live at https://mai-')) && db.sites['wa-test/bible-books-quiz-2']);

// ---------- 8. cancel, limits, 24h window ----------
x = await say('build me a landing page for my bakery');
const bid = db.jobs.at(-1).id;
x = await say(`cancel ${bid}`);
ok('"cancel <n>" stops a queued job, and the worker skips it', x.sent.at(-1).includes(`Job #${bid} cancelled`) && db.jobs.at(-1).status === 'cancelled' && (await A.runTick({ ns: 'wa-test', deps })).idle === true);
x = await say('cancel 999');
ok('"cancel <n>" for a job that isn\'t running', x.sent.at(-1).includes("isn't running"));
// cancelled mid-run: the save after the plan step sees "cancelled"
x = await say('build me a landing page for my church');
const cjob = db.jobs.at(-1);
const realSave = store;
J.setMock((op, a) => { const r = realSave(op, a); if (op === 'save' && a.id === cjob.id && !a.release) { cjob.status = 'cancelled'; } return r; });
t = await A.runTick({ ns: 'wa-test', deps, budgetMs: 290000 });
J.setMock(store);
ok('a job cancelled mid-run stops at the next step', t.status === 'cancelled' && cjob.status === 'cancelled' && !cjob.steps.some(s => s.includes('deploy:')));
// daily limit
process.env.BUILD_DAILY_LIMIT = String(store('count_today', { ns: 'wa-test', owner: OWNER, kinds: ['build', 'edit'] }));
x = await say('build me a website for my photography');
ok('daily build limit enforced', x.sent.at(-1).includes("today's") && x.sent.at(-1).includes('builds'));
delete process.env.BUILD_DAILY_LIMIT;
// open jobs cap
const before = db.jobs.length;
for (let i = 0; i < 3; i++) store('create', { ns: 'wa-test', owner: OWNER, kind: 'agent', input: { brief: 'x' + i } });
x = await say('agent: one more thing');
ok('max 3 open jobs at once', x.sent.at(-1).includes('already have 3 jobs') && db.jobs.length === before + 3);
db.jobs.filter(j => j.status === 'queued').forEach(j => { j.status = 'cancelled'; });
// result that couldn't be sent (24h window closed) arrives with his next message
agentScript = [{ tool: 'finish', args: { answer: 'Here is the late answer.' } }];
x = await say('agent: a slow task');
sendFail = true; t = await A.runTick({ ns: 'wa-test', deps, budgetMs: 290000 }); sendFail = false;
const late = db.jobs.at(-1);
ok('final send refused (window closed) → job done but not delivered', late.status === 'done' && late.delivered === false && late.result.sent === false);
x = await say('hello');
ok('...delivered with his next message', x.sent.some(s => s.includes('Finished while the chat was asleep') && s.includes('late answer')) && db.jobs.find(j => j.id === late.id).delivered === true);

// ---------- 9. help, usage, health ----------
x = await say('help');
ok('help shows Agent mode with the commands', x.sent.at(-1).includes('Agent mode') && x.sent.at(-1).includes('my sites') && x.sent.at(-1).includes('cancel 12'));
x = await say('usage');
ok('usage counts agent jobs', /Agent jobs started: [1-9]/.test(x.sent.at(-1)));
{ const r = await m.GET(new Request('http://x/api/whatsapp?health=1')); const h = await r.json();
  ok('health: build v6.0, agent true, jobs true', /^v(6|7|8|9)\.\d/.test(h.build) && h.agent === true && h.jobs === true && h.builds_daily_limit === 10); }
// jobs endpoint auth
{ const jobs = await import('./api/jobs.js');
  const r1 = await jobs.POST(new Request('http://x/api/jobs', { method: 'POST' }));
  const r2 = await jobs.GET(new Request('http://x/api/jobs?sandbox=1&id=1', { headers: { 'x-test-key': 'wrong' } }));
  const r3 = await jobs.GET(new Request('http://x/api/jobs?sandbox=1&id=1', { headers: { 'x-test-key': process.env.WA_TEST_KEY } }));
  ok('/api/jobs: no key → 401, wrong test key → 401, test key reads the sandbox job', r1.status === 401 && r2.status === 401 && (await r3.json()).job?.id === 1); }

// ---------- cleanup (wa-test blobs) ----------
console.log(`\n${n} checks passed\ncleaned ${J.kvMemClear()} in-memory test records`);
