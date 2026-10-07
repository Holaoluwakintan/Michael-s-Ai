// v6 AGENT MODE: the background worker. One tick = claim a job (lease) -> run steps until the time budget is near -> persist -> chain.
// Build/edit jobs follow a fixed pipeline with self-checks; "agent:" jobs run a plan -> act -> check loop with tools.
import * as J from './_jobs.js';
import * as S from './_sites.js';
import * as B from './_backend.js';
import * as R from './_research.js';
import * as GR from './_repo.js';
import * as AP from './_apk.js';
import * as G from './_gem.js';

const log = (...a) => console.log('[agent]', ...a);
export const TICK_BUDGET_MS = () => +(process.env.JOB_TICK_MS || 245000);   // jobs.js maxDuration is 300 s
export const MAX_UPDATES = 2;            // progress pings per job (the "on it" ack is extra)
export const MAX_AGENT_STEPS = 12;
export const MAX_TICKS = 12;
const NEED = { plan: 60e3, research: 45e3, images: 80e3, code: 205e3, fix: 205e3, edit: 205e3, check: 2e3, deploy: 45e3, wait: 30e3, verify: 30e3, save: 10e3, loop: 70e3, load: 10e3, ...R.R_NEED, ...GR.G_NEED, ...AP.A_NEED, m_run: 60e3 };

const trim = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const stamp = () => new Date().toISOString().slice(11, 19);

export function fallbackPlan(brief) {
  const words = String(brief).replace(/^(please\s+)?(build|make|create|design|generate|code)\s+(me\s+)?(a|an|my)?\s*/i, '').split(/\s+/).slice(0, 5).join(' ');
  const app = /\b(app|quiz|game|calculator|tracker|tool|pwa)\b/i.test(brief);
  return { title: words.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 40) || 'New Site', slug: J.slugify(words), type: app ? 'app' : 'site', tagline: '', description: trim(brief, 150),
    palette: { primary: '#1d4ed8', accent: '#f59e0b', bg: '#ffffff', surface: '#f3f4f6', text: '#111827' }, fonts: { heading: 'Poppins', body: 'Inter' }, sections: [], features: [], images: app ? [] : [{ name: 'hero', prompt: words, w: 1200, h: 800 }], research: [] };
}
export function cleanPlan(p, brief) {
  const fb = fallbackPlan(brief);
  if (!p || typeof p !== 'object') return fb;
  const out = { ...fb, ...p };
  out.type = /app/i.test(String(p.type)) ? 'app' : 'site';
  out.slug = J.slugify(p.slug || p.title || fb.slug, 24);
  out.images = (Array.isArray(p.images) ? p.images : []).slice(0, 3).map((im, i) => ({
    name: J.slugify(im.name || `img${i + 1}`, 16), prompt: trim(im.prompt || p.title, 400),
    w: Math.min(1400, Math.max(512, +im.w || 1200)), h: Math.min(1400, Math.max(512, +im.h || 800)) }));
  out.research = (Array.isArray(p.research) ? p.research : []).filter(q => typeof q === 'string' && q.trim()).slice(0, 2);
  out.palette = { ...fb.palette, ...(p.palette || {}) };
  return out;
}
export function doneText(site, { edited = false, warn = '' } = {}) {
  const lines = [edited ? `✅ *${site.title}* updated (v${site.version}) and live!` : `✅ *${site.title}* is live! 🎉`, `🌐 ${site.url}`];
  if (site.kind === 'app') lines.push('', '📱 *Install on Android*: open the link in Chrome → ⋮ → *Add to Home screen*. It works offline like an app.');
  if (site.backend) {
    const cols = site.backend.collections || [];
    const pinged = cols.filter(c => B.NOTIFY_KINDS.includes(c.kind)).map(c => c.label || c.name);
    lines.push('', `🗄️ *Real backend*: ${cols.map(c => c.label || c.name).join(', ')}${site.backend.auth ? ', logins' : ''} save to your database.`);
    if (pinged.length) lines.push(`🔔 I'll ping you here for every new ${pinged.join(' / ').toLowerCase()}.`);
    if (site.backend.payments) lines.push(B.paymentsOn() ? '💳 Paystack payments are ON.' : '💳 Paystack checkout is built in. It shows "Payments coming soon" until you send your Paystack keys.');
    lines.push(`📊 *orders ${site.slug}* · *data ${site.slug}* · *export ${site.slug}* (CSV)`);
  }
  if (warn) lines.push('', `_${warn}_`);
  lines.push('', `✏️ Change it: *edit ${site.slug} <what to change>*`, `📦 Code: *zip ${site.slug}* · all: *my sites*`);
  return lines.join('\n');
}

// ---------- the general agent loop ----------
export const AGENT_SYSTEM = `You are Michael AI in agent mode: a capable assistant that completes a task in steps using tools, for Michael (a Nigerian author, creator and developer). You plan, act, check what came back, and retry with a different approach when something fails.
Reply with ONE JSON object per turn, nothing else:
{"thought": "short reasoning about what to do next and why", "tool": "<tool name>", "args": {...}}
Tools:
- web_search {"q": "query"}: keyless web search, returns titles, links, snippets.
- web_read {"url": "https://..."}: reads a page's text.
- make_image {"prompt": "...", "size": "square|status|landscape"}: makes a picture and sends it to Michael (max 2 per task).
- build_site {"brief": "full description of the site or app to build"}: builds and deploys a website or web app and returns its live link. Use when the task needs a site/app.
- remember {"fact": "..."}: saves a fact to Michael's knowledge (only if he asked you to remember or it's clearly a lasting fact about him).
- send_update {"text": "..."}: a short progress message to Michael on WhatsApp (max 2 per task; only at real milestones).
- finish {"answer": "the final WhatsApp reply"}: ends the task. WhatsApp formatting: *bold*, _italic_, short lines, bullets with •, links in full. Put sources as links at the end when you used the web.
Rules: be efficient (most tasks need 2-6 steps). Never invent facts, links or numbers; if the web didn't give it, say so. If a tool fails, try another query/URL or finish with what you have.`;
export function agentPrompt(st) {
  const obs = (st.obs || []).map((o, i) => `STEP ${i + 1}: ${o.tool} ${trim(JSON.stringify(o.args), 300)}\nRESULT: ${o.result}`).join('\n\n');
  const left = MAX_AGENT_STEPS - (st.obs || []).length;
  return `TASK from Michael: """${st.brief}"""\nToday: ${new Date().toISOString().slice(0, 10)}. Steps left: ${left}${left <= 2 ? ' (finish now with what you have)' : ''}. Updates left: ${MAX_UPDATES - (st.updates || 0)}.\n\n${obs ? 'SO FAR:\n' + obs : 'No steps yet: plan, then take the first action.'}`;
}
export function parseAction(t) {
  const j = S.parseJson(t);
  if (!j || typeof j !== 'object') return null;
  const tool = String(j.tool || j.action || '').trim();
  return tool ? { tool, args: j.args || j.input || {}, thought: j.thought || '' } : null;
}

// ---------- tick ----------
export async function runTick({ ns = 'wa', id = null, deps, budgetMs = TICK_BUDGET_MS(), now = Date.now, kinds = null, notKinds = null } = {}) {
  const started = now();
  const deadline = started + budgetMs;
  const job = await J.rpc('claim', { ns, id, lease_s: Math.ceil(budgetMs / 1000) + 75, ...(kinds ? { kinds } : {}), ...(notKinds ? { not_kinds: notKinds } : {}) });
  if (!job) return { idle: true };
  const ctx = ns === 'wa-test' ? { test: true, ns, outbox: [] } : { test: false, ns: 'wa', outbox: [] };
  const st = job.state || {};
  const steps = Array.isArray(job.steps) ? job.steps : [];
  st.cool = Object.fromEntries(Object.entries(st.cool || {}).filter(([, v]) => v > Date.now()));
  const owner = job.owner;
  const step = (msg) => { steps.push(`${stamp()} ${msg}`); log(`#${job.id}`, msg); };
  let status = 'running', result = null, cancelled = false, finalSent = null;

  if (!st.phase) {
    st.brief = job.input?.brief || '';
    st.phase = job.kind === 'agent' ? 'loop' : job.kind === 'edit' ? 'load' : job.kind === 'research' ? 'r_plan' : job.kind === 'repo' ? 'g_load' : job.kind === 'media' ? 'm_run' : job.kind === 'apk' ? 'a_load' : 'plan';
    if (job.kind === 'research') { st.topic = job.input?.topic || st.brief; st.pdf = job.input?.pdf !== false; }
    if (job.kind === 'repo') { st.repoName = job.input?.repo; st.change = job.input?.change || st.brief; }
    if (job.kind === 'media') { st.cmd = job.input?.cmd; st.media = job.input?.media || {}; }
    if (job.kind === 'apk') st.slug = job.input?.slug;
    st.mode = job.kind;
    st.updates = 0;
  }
  if (job.ticks > MAX_TICKS) { st.phase = 'fail'; st.error = 'it kept running out of time'; }

  const save = async (extra = {}) => {
    if (ctx.test && ctx.outbox.length) { st.outbox = [...(st.outbox || []), ...ctx.outbox.map(b => b.text?.body || b.image?.caption || b.document?.filename || b.filename || b.name || b.type)].slice(-30); ctx.outbox.length = 0; }
    const r = await J.rpc('save', { id: job.id, state: st, steps: steps.slice(-80), ...extra });
    if (r?.status === 'cancelled') cancelled = true;
    return r;
  };
  const send = async (text) => deps.sendText(owner, text, ctx);
  const update = async (text) => { if ((st.updates || 0) >= MAX_UPDATES) return false; st.updates = (st.updates || 0) + 1; const r = await send(text); step(`update sent (${r.ok ? 'ok' : 'failed'})`); return r.ok; };
  const finish = async (text, res, ok = true) => {
    const r = await send(text);
    finalSent = r.ok;
    status = ok ? 'done' : 'failed';
    result = { ...res, message: trim(text, 1500), sent: r.ok, send_error: r.ok ? null : trim(r.detail || r.status, 200) };
    step(`${status}; result ${r.ok ? 'sent' : 'NOT sent (' + trim(r.detail || r.status, 80) + ')'}`);
  };

  try {
    while (status === 'running' && !cancelled) {
      const need = NEED[st.phase] || 30e3;
      if (deadline - now() < need) { step(`pausing before ${st.phase} (time budget); next tick continues`); break; }
      const ph = st.phase;

      if (ph === 'fail') { await finish(`⚠️ Sorry, job #${job.id} didn't finish: ${st.error || 'something broke'}.\nSend it again, or try a simpler version.`, { error: st.error }, false); break; }

      // ===== build pipeline =====
      if (ph === 'plan') {
        const r = await S.gem(S.planPrompt(st.brief, { owner: deps.profile ? trim(deps.profile, 2500) : '' }), { system: S.PLAN_SYSTEM, json: true, maxTokens: 4096, chain: S.PLAN_CHAIN, cool: st.cool, timeoutMs: 45000, deadline });
        st.plan = cleanPlan(r.ok ? S.parseJson(r.text) : null, st.brief);
        // v7: a real backend (orders, bookings, guestbook, leaderboard, logins) when the request needs one
        st.plan.backend = B.cleanBackend(st.plan.backend) || (B.wantsBackend(st.brief) ? B.defaultBackend(st.brief) : null);
        if (st.plan.backend) st.siteKey = st.siteKey || B.newSiteKey();
        st.slug = await uniqueSlug(st.plan.slug, ns, deps);
        step(`plan: ${st.plan.type} "${st.plan.title}" slug ${st.slug} (${r.ok ? r.model : 'fallback plan'}), ${st.plan.images.length} images, ${st.plan.research.length} searches${st.plan.backend ? `, backend: ${st.plan.backend.collections.map(c => c.name + '/' + c.kind).join(' ')}${st.plan.backend.auth ? ' +logins' : ''}${st.plan.backend.payments ? ' +payments(off)' : ''}` : ''}`);
        st.phase = st.plan.research.length ? 'research' : st.plan.images.length ? 'images' : 'code';
        await update(`📐 Plan ready: *${st.plan.title}*, a mobile-first ${st.plan.type === 'app' ? 'app (installable on Android)' : 'website'}${st.plan.sections?.length ? ` with ${Math.min(st.plan.sections.length, 8)} ${st.plan.type === 'app' ? 'screens' : 'sections'}` : ''}. Writing the code now, about 3–5 min ⏳`);
      } else if (ph === 'research') {
        const notes = [];
        for (const q of st.plan.research) {
          try {
            const res = await deps.webResults(q);
            const top = (res.results || res || []).slice(0, 4);
            notes.push(`Search "${q}":\n` + top.map(x => `- ${x.title}: ${trim(x.snippet, 220)} (${x.url})`).join('\n'));
            const pages = await deps.readTop(top, 1, 7000).catch(() => []);
            for (const pg of pages || []) if (pg?.text) notes.push(`From ${pg.url}:\n${trim(pg.text, 2500)}`);
          } catch (e) { notes.push(`Search "${q}" failed: ${e.message}`); }
        }
        st.research = trim(notes.join('\n\n'), 7000);
        step(`research: ${st.plan.research.length} searches, ${st.research.length} chars of notes`);
        st.phase = st.plan.images.length ? 'images' : 'code';
      } else if (ph === 'images') {
        st.images = st.images || [];
        const todo = st.plan.images.filter(im => !st.images.some(x => x.name === im.name));
        const got = await Promise.all(todo.map(async im => {
          try {
            const r = await deps.generateImage(im.prompt, { width: im.w, height: im.h, budgetMs: 70000 });
            if (!r.ok) return { ...im, failed: true };
            const ext = /png/.test(r.mime) ? 'png' : /webp/.test(r.mime) ? 'webp' : 'jpg';
            return { ...im, path: `img/${im.name}.${ext}`, b64: Buffer.from(r.bytes).toString('base64') };
          } catch (e) { return { ...im, failed: true }; }
        }));
        st.images.push(...got);
        const ok = st.images.filter(x => x.b64);
        step(`images: ${ok.length}/${st.plan.images.length} made (${Math.round(ok.reduce((n, x) => n + x.b64.length * 0.75, 0) / 1024)} KB)`);
        st.phase = 'code';
      } else if (ph === 'code' || ph === 'edit') {
        const imgs = (st.images || []).filter(x => x.b64).map(x => ({ path: x.path, w: x.w, h: x.h, prompt: x.prompt }));
        const prompt = ph === 'edit' ? S.editPrompt(st.files, st.change, st.plan) : S.codePrompt(st.plan, { images: imgs, research: st.research || '' });
        const r = await S.gem(prompt, { system: S.CODE_SYSTEM, maxTokens: 32000, chain: S.CODE_CHAIN, cool: st.cool, timeoutMs: 170000, deadline, temperature: 0.6 });
        st.codeTries = (st.codeTries || 0) + 1;
        const files = r.ok ? S.parseFiles(r.text) : {};
        if (!files['index.html']) {
          step(`${ph}: no usable files (${r.ok ? 'bad format, finish ' + r.finish : r.tried?.join(' ')}) try ${st.codeTries}`);
          if (st.codeTries >= 3) { st.phase = 'fail'; st.error = r.quota ? 'today\'s free AI quota is used up (it resets 8–9am Nigeria time)' : 'the AI didn\'t return a usable site after 3 tries'; }
          continue;
        }
        st.files = { ...(ph === 'edit' ? st.files : {}), ...pick(files, ['index.html', 'style.css', 'app.js']) };
        if (!st.files['style.css']) st.files['style.css'] = '';
        if (!st.files['app.js']) st.files['app.js'] = '';
        step(`${ph}: ${r.model} wrote ${Object.keys(files).join(', ')} (${Math.round(Object.values(files).join('').length / 1024)} KB)${r.finish && r.finish !== 'STOP' ? ' finish ' + r.finish : ''}`);
        st.phase = 'check';
      } else if (ph === 'check') {
        const all = withImages(st.files, st.images);
        const issues = S.checkSite(all, { facts: [st.siteBrief || st.brief, st.plan?.facts_given, st.mode === 'edit' ? (st.change || '') + ' ' + JSON.stringify(st.knownFacts || '') : ''].join(' '), backend: st.plan?.backend || null });
        st.issues = issues;
        step(`check: ${issues.length ? issues.length + ' issue(s): ' + trim(issues.join(' | '), 400) : 'clean'}`);
        if (issues.length && (st.fixes || 0) < 2) st.phase = 'fix';
        else if (issues.some(S.isHard) && (st.codeTries || 0) < 2 && st.mode !== 'edit') { st.phase = 'code'; st.fixes = 0; }
        else st.phase = 'deploy';
      } else if (ph === 'fix') {
        const r = await S.gem(S.fixPrompt(st.files, st.issues, st.plan), { system: S.CODE_SYSTEM, maxTokens: 32000, chain: S.CODE_CHAIN, cool: st.cool, timeoutMs: 170000, deadline, temperature: 0.3 });
        st.fixes = (st.fixes || 0) + 1;
        const files = r.ok ? S.parseFiles(r.text) : {};
        if (files['index.html']) { st.files = { ...st.files, ...pick(files, ['index.html', 'style.css', 'app.js']) }; step(`fix ${st.fixes}: ${r.model} returned ${Object.keys(files).join(', ')}`); }
        else step(`fix ${st.fixes}: no usable output (${r.ok ? 'format' : r.tried?.join(' ')})`);
        st.phase = 'check';
      } else if (ph === 'deploy') {
        if (!S.deployOn()) { st.phase = 'fail'; st.error = 'deploying isn\'t set up yet (no Vercel token)'; continue; }
        if (!st.version) st.version = 1;
        const extraDeploy = Object.fromEntries(Object.entries(st.extra || {}).filter(([k]) => !k.startsWith('_')));
        const out = { ...S.decorate(withImages(st.files, st.images), st.plan, { version: st.version, siteKey: st.siteKey || null, api: J.BASE_URL() + '/api/site-data' }), ...extraDeploy };
        st.project = st.project || `mai-${st.slug}`;
        try {
          const d = await S.deployFiles(st.project, out);
          st.deploy = d; st.deployTries = (st.deployTries || 0) + 1;
          if (!st.opened) { await S.openProject(d.projectId); st.opened = true; }
          step(`deploy: ${d.id} to project ${st.project}`);
          st.phase = 'wait';
        } catch (e) {
          st.deployTries = (st.deployTries || 0) + 1;
          step(`deploy failed: ${trim(e.message, 200)}`);
          if (st.deployTries >= 3) { st.phase = 'fail'; st.error = 'Vercel refused the deploy: ' + trim(e.message, 120); }
        }
      } else if (ph === 'wait') {
        let s = null;
        for (let i = 0; i < 10 && deadline - now() > 15e3; i++) {
          s = await S.deploymentStatus(st.deploy.id);
          if (['READY', 'ERROR', 'CANCELED'].includes(s.state)) break;
          await new Promise(r => setTimeout(r, 3000));
        }
        if (s?.state === 'READY') {
          const host = S.bestAlias(s.alias, st.project) || s.url;
          st.url = 'https://' + host;
          step(`ready: ${st.url}`);
          st.phase = 'verify';
        } else if (s?.state === 'ERROR' || s?.state === 'CANCELED') {
          step(`deployment ${s.state}: ${trim(s.error, 150)}`);
          st.phase = st.deployTries >= 2 ? 'fail' : 'deploy';
          if (st.phase === 'fail') st.error = 'the deploy failed on Vercel';
        } else step(`deployment still ${s?.state || 'unknown'}; checking again next round`);
      } else if (ph === 'verify') {
        const v = await S.verifyLive(st.url, st.plan.title);
        step(`verify: HTTP ${v?.status} ${v?.ok ? 'OK' : 'NOT OK'} (${v?.bytes || 0} bytes)`);
        st.verified = !!v?.ok;
        if (!v?.ok && (st.verifyTries = (st.verifyTries || 0) + 1) < 2) continue;
        st.phase = 'save';
      } else if (ph === 'save') {
        const site = { ns, slug: st.slug, owner, title: st.plan.title, kind: st.plan.type, project: st.project, project_id: st.deploy?.projectId, url: st.url,
          files: { ...withImages(st.files, st.images), ...(st.extra || {}), '_plan.json': JSON.stringify(st.plan) }, version: st.version, last_deploy: st.deploy?.id, site_key: st.siteKey || null, backend: st.plan.backend || null, brief: trim(st.mode === 'edit' ? `${st.siteBrief0 || ''} | edit: ${st.change}` : (st.siteBrief || st.brief), 2000) };
        try { await J.rpc('site_put', site, 15000); step('site saved'); } catch (e) { step(`site save failed: ${trim(e.message, 120)}`); }
        if (st.mode === 'agent') { st.brief = st.agentBrief || st.brief; delete st.images; delete st.files; st.obs.push({ tool: 'build_site', args: { brief: trim(st.siteBrief, 200) }, result: `Built and live at ${st.url} (${st.plan.type}, title "${st.plan.title}")` }); st.phase = 'loop'; st.builtUrl = st.url; continue; }
        const warn = !st.verified ? 'The link may take a minute to open the first time.' : (st.issues?.length && st.issues.some(S.isHard)) ? 'Heads-up: my checker still saw a small issue; send *edit ' + st.slug + ' fix any bugs* if something looks off.' : '';
        await finish(doneText({ title: st.plan.title, url: st.url, kind: st.plan.type, slug: st.slug, version: st.version, backend: st.plan.backend || null }, { edited: st.mode === 'edit', warn }), { url: st.url, slug: st.slug, deploy: st.deploy?.id, version: st.version, backend: !!st.plan.backend });
        // keep job rows light: the site's source lives in the sites table
        delete st.images; delete st.files; delete st.research; delete st.extra;
      } else if (ph === 'load') {
        const site = await J.rpc('site_get', { ns, slug: job.input.slug });
        if (!site) { st.phase = 'fail'; st.error = `I couldn't find the site "${job.input.slug}"`; continue; }
        const files = { ...site.files };
        st.plan = (() => { try { return JSON.parse(files['_plan.json']); } catch { return fallbackPlan(site.title || site.slug); } })();
        delete files['_plan.json'];
        st.images = Object.entries(files).filter(([k, v]) => k.startsWith('img/') && v && v.b64).map(([k, v]) => ({ name: k.replace(/^img\/|\.\w+$/g, ''), path: k, b64: v.b64 }));
        st.extra = Object.fromEntries(Object.entries(files).filter(([k]) => k === 'app.apk' || k.startsWith('.well-known/') || k === '_apk_version'));   // v7: keep the hosted APK + assetlinks across edits
        st.files = Object.fromEntries(Object.entries(files).filter(([k, v]) => typeof v === 'string' && !k.startsWith('.well-known/') && k !== '_apk_version'));
        st.knownFacts = [site.brief || '', ...(['index.html', 'app.js'].flatMap(k => String(files[k] || '').match(new RegExp(S.PRICE_RE.source + '|' + S.PHONE_RE.source, 'g')) || []))].join(' ');
        st.siteBrief0 = site.brief || '';
        st.slug = site.slug; st.project = site.project; st.version = (site.version || 1) + 1; st.opened = true; st.change = job.input.change;
        // v7: keep the site's backend and key; an edit like "add an order form" gives an old site a backend
        st.plan.backend = site.backend || B.cleanBackend(st.plan.backend) || (B.wantsBackend(st.change) ? B.defaultBackend(st.change) : null);
        st.siteKey = site.site_key || (st.plan.backend ? B.newSiteKey() : null);
        step(`loaded ${site.slug} v${site.version} (${Object.keys(files).length} files)`);
        st.phase = 'edit';
      }

      // ===== general agent loop =====
      else if (ph === 'loop') {
        st.obs = st.obs || [];
        if (st.obs.length >= MAX_AGENT_STEPS) { st.forceFinish = true; }
        const r = await S.gem(agentPrompt(st) + (st.forceFinish ? '\n\nYou are out of steps: use the finish tool now.' : ''), { system: AGENT_SYSTEM, json: true, maxTokens: 3000, chain: S.FAST_CHAIN, cool: st.cool, timeoutMs: 60000, deadline });
        const a = r.ok ? parseAction(r.text) : null;
        if (!a) {
          st.badTurns = (st.badTurns || 0) + 1; step(`agent: no valid action (${r.ok ? trim(r.text, 80) : r.tried?.join(' ')})`);
          if (st.badTurns >= 3) { st.phase = 'fail'; st.error = r.quota ? 'today\'s free AI quota is used up' : 'the AI got confused'; }
          continue;
        }
        step(`agent → ${a.tool} ${trim(JSON.stringify(a.args), 140)}`);
        const res = await runTool(a, st, { ns, owner, ctx, deps, update, job });
        if (res?.finish) { await finish(res.finish, { url: st.builtUrl || null, steps: st.obs.length }); break; }
        if (res?.build) continue;            // switched into the build pipeline
        st.obs.push({ tool: a.tool, args: a.args, result: trim(res?.result ?? '(no result)', 3500) });
      }
      // ===== v7: research / repo / media jobs =====
      else if (ph.startsWith('r_') || ph.startsWith('g_') || ph.startsWith('a_')) {
        const h = { step, update, deadline, now, deps, rpc: J.rpc, ns, api: J.BASE_URL() + '/api/site-data', finish: async (text, res) => finish(text, res, true),
          sendDoc: async (buf, mime, name, caption) => { const up = await deps.uploadMedia(buf, mime, ctx, name); if (!up.ok) return up; return deps.sendDocument(owner, up.id, name, caption, ctx); } };
        if (ph.startsWith('r_')) await R.phase(st, h); else if (ph.startsWith('a_')) { if (!S.deployOn()) { st.phase = 'fail'; st.error = 'deploying isn\'t set up'; continue; } await AP.phase(st, h); } else await GR.phase(st, h);
      } else if (ph === 'm_run') {
        if (!deps.mediaProcess) { st.phase = 'fail'; st.error = 'video tools are not available here'; continue; }
        const inputs = {};
        for (const k of ['video', 'image', 'audio']) {
          if (!st.media?.[k]) continue;
          const d = await deps.downloadFile(st.media[k], ctx);
          if (!d.ok) { st.phase = 'fail'; st.error = d.tooBig ? 'that file is too big (max 16 MB)' : `I couldn't download the ${k} from WhatsApp (${trim(d.error, 60)})`; break; }
          inputs[k] = { buf: d.buf, mime: d.mime || st.media[k].mime_type };
        }
        if (st.phase === 'fail') continue;
        const res = await deps.mediaProcess(st.cmd, inputs);
        step(`media ${st.cmd?.op}: ${res.ok ? `${Math.round(res.buf.length / 1024)} KB ${res.mime}${res.duration ? ' ' + Math.round(res.duration) + 's' : ''}` : 'failed: ' + res.error}`);
        if (!res.ok) { st.phase = 'fail'; st.error = res.error; st.mediaFail = true; continue; }
        const up = await deps.uploadMedia(res.buf, res.mime, ctx, res.name);
        if (!up.ok) { st.phase = 'fail'; st.error = 'WhatsApp didn\'t accept the file (' + trim(up.detail, 80) + ')'; continue; }
        const caption = deps.mediaCaption ? deps.mediaCaption(st.cmd, res) : '✅ Done';
        const type = res.mime.startsWith('audio') ? 'audio' : 'video';
        const sm = await deps.sendMedia(owner, up.id, type, caption, ctx);
        step(`sent ${type} (${sm.ok ? 'ok' : 'failed ' + trim(sm.detail, 60)})`);
        await finish(type === 'audio' ? caption + '\n\nMore: *trim*, *compress*, *caption <text>* on any video.' : 'More edits on this video: *trim 0:05-0:20* · *compress* · *caption <text>* · *extract audio*', { op: st.cmd?.op, bytes: res.buf.length, sent: sm.ok, out_bytes: res.buf.length, duration: res.duration || null });
      } else { st.phase = 'fail'; st.error = 'unknown step ' + ph; }

      const sv = await save();
      if (sv?.status === 'cancelled') break;
    }
  } catch (e) {
    step(`error in ${st.phase}: ${trim(e.stack || e.message, 300)}`);
    st.errors = (st.errors || 0) + 1;
    if (st.errors >= 3) { st.phase = 'fail'; st.error = trim(e.message, 120); }
  }
  if (cancelled) { step('cancelled by Michael'); await J.rpc('save', { id: job.id, steps: steps.slice(-80), release: true }); return { id: job.id, status: 'cancelled' }; }
  await save({ status, result, release: true, delivered: status === 'running' ? undefined : finalSent === true });
  if (ns === 'wa') await G.flushUsage(J.rpc).catch(() => {}); else G.usage.clear();
  return { id: job.id, status, phase: st.phase, url: st.url || null, more: status === 'running', outbox: ctx.test ? st.outbox : undefined, ms: now() - started };
}

function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] != null) r[k] = o[k]; return r; }
function withImages(files, images) {
  const out = { ...(files || {}) };
  for (const im of images || []) if (im.b64 && im.path) out[im.path] = { b64: im.b64 };
  return out;
}
async function uniqueSlug(slug, ns, deps) {
  let s = slug;
  for (let i = 2; i < 30; i++) {
    const taken = await J.rpc('site_get', { ns, slug: s }).catch(() => null);
    const vercel = S.deployOn() ? await S.projectExists(`mai-${s}`).catch(() => null) : null;
    if (!taken && !vercel) return s;
    s = `${slug}-${i}`;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

async function runTool(a, st, { ns, owner, ctx, deps, update, job }) {
  const args = a.args || {};
  try {
    switch (a.tool) {
      case 'web_search': {
        const res = await deps.webResults(String(args.q || args.query || st.brief));
        const list = (res.results || res || []).slice(0, 6);
        return { result: list.length ? list.map((x, i) => `${i + 1}. ${x.title} | ${x.url} | ${trim(x.snippet, 200)}`).join('\n') : 'No results. Try different words.' };
      }
      case 'web_read': {
        const url = String(args.url || '');
        if (!/^https?:\/\//i.test(url)) return { result: 'Bad URL; give a full https:// link.' };
        const pg = await deps.fetchPage(url).catch(e => ({ ok: false, error: e.message }));
        if (pg?.ok && pg.text) return { result: `${pg.title || ''}\n${trim(pg.text, 3500)}` };
        const jr = await deps.jinaRead(url).catch(() => null);
        return { result: jr ? trim(jr, 3500) : `Couldn't read it (${pg?.error || pg?.status || 'blocked'}). Try another source.` };
      }
      case 'make_image': {
        st.imagesSent = st.imagesSent || 0;
        if (st.imagesSent >= 2) return { result: 'Image limit for this task reached (2).' };
        const dims = { square: [1080, 1080], status: [1080, 1920], landscape: [1600, 900] }[args.size] || [1080, 1350];
        const r = await deps.generateImage(String(args.prompt || st.brief), { width: dims[0], height: dims[1], budgetMs: 60000 });
        if (!r.ok) return { result: 'The image service was busy; skip images or try once more later.' };
        const up = await deps.uploadMedia(r.bytes, r.mime, ctx);
        if (!up.ok) return { result: 'Image made but WhatsApp upload failed.' };
        const s = await deps.sendImage(owner, up.id, trim(args.caption || '', 900), ctx);
        st.imagesSent++;
        return { result: s.ok ? 'Image sent to Michael.' : 'Image made but sending failed.' };
      }
      case 'build_site': {
        const used = await J.rpc('count_today', { owner, ns, kinds: ['build', 'edit', 'agent-build'] }).catch(() => 0);
        if ((st.builds || 0) >= 1) return { result: 'Only one build per task. Finish with the link you have.' };
        if (used >= J.BUILD_DAILY_LIMIT()) return { result: `Daily build limit (${J.BUILD_DAILY_LIMIT()}) reached; tell Michael it can build again tomorrow.` };
        st.builds = (st.builds || 0) + 1;
        st.siteBrief = String(args.brief || st.brief);
        st.brief0 = st.brief0 || st.brief;
        // reuse the build pipeline; it returns to the loop at "save"
        const keep = st.brief; st.brief = st.siteBrief; st.phase = 'plan'; st.agentBrief = keep;
        return { build: true };
      }
      case 'remember': {
        const fact = trim(String(args.fact || '').trim(), 600);
        if (!fact) return { result: 'Nothing to remember.' };
        const kb = await deps.loadKB(owner, ctx);
        deps.addFact(kb, fact);
        await deps.saveKB(owner, kb, ctx);
        return { result: 'Saved to knowledge.' };
      }
      case 'send_update': {
        const ok = await update('🛠️ ' + trim(String(args.text || ''), 600));
        return { result: ok ? 'Update sent.' : 'No updates left; continue silently.' };
      }
      case 'finish': {
        const ans = String(args.answer || args.text || '').trim() || 'Done.';
        return { finish: (st.agentBrief ? '' : '') + ans };
      }
      default: return { result: `Unknown tool "${a.tool}". Use one of: web_search, web_read, make_image, build_site, remember, send_update, finish.` };
    }
  } catch (e) { return { result: `Tool error: ${trim(e.message, 200)}` }; }
}
