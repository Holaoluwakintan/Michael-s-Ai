// v6 (6 Oct 2026): background job queue for AGENT MODE, kept in Supabase (schema michael_ai, tables jobs + sites), never in Blob.
// The bot talks to it only through public.michael_ai_jobs(p_key, p_op, p_args): SECURITY DEFINER, checks SCHED_KEY (same key as the reminder gate).
// pg_cron job "michael-ai-jobs" runs michael_ai.jobs_tick() every minute: it POSTs /api/jobs (Bearer SCHED_KEY) only while a job is queued
// or running with an expired lease. The webhook also kicks /api/jobs right after it enqueues, and each tick self-chains while work remains.
export const jobsOn = () => Boolean(process.env.SCHED_KEY && process.env.SB_URL && process.env.SB_ANON_KEY);
export const BASE_URL = () => process.env.PUBLIC_URL || 'https://michael-ai-mu.vercel.app';
export const BUILD_DAILY_LIMIT = () => +(process.env.BUILD_DAILY_LIMIT || 10);
export const MAX_OPEN = 3;                         // queued/running jobs per owner at once

let mock = null;                                   // tests: an in-memory stand-in for the RPC
export function setMock(fn) { mock = fn; }

const kvMem = new Map();                           // tests with a mocked store: kv lives in memory
export function kvMemClear() { const n = kvMem.size; kvMem.clear(); return n; }
export async function rpc(op, args = {}, ms = 8000) {
  if (mock && op === 'kv_get') return kvMem.has(args.k) ? JSON.parse(kvMem.get(args.k)) : null;
  if (mock && op === 'kv_put') { kvMem.set(args.k, JSON.stringify(args.v)); return true; }
  if (mock && op === 'kv_purge_test') return kvMemClear();
  if (mock) return mock(op, JSON.parse(JSON.stringify(args)));
  if (!jobsOn()) throw new Error('jobs store not configured');
  const r = await fetch(`${process.env.SB_URL}/rest/v1/rpc/michael_ai_jobs`, {
    method: 'POST',
    headers: { apikey: process.env.SB_ANON_KEY, authorization: `Bearer ${process.env.SB_ANON_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_key: process.env.SCHED_KEY, p_op: op, p_args: args }), signal: AbortSignal.timeout(ms),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`jobs rpc ${op} ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

export const nsOf = ctx => (ctx && ctx.test ? 'wa-test' : 'wa');

// Kick the worker endpoint now (fire-and-forget: it answers 202 at once and works inside waitUntil).
export async function kick(ns = 'wa', { id = null, ms = 4000, path = '/api/jobs' } = {}) {
  if (mock || !process.env.SCHED_KEY) return { skipped: true };
  const u = new URL(path, BASE_URL());
  if (ns === 'wa-test') u.searchParams.set('sandbox', '1');
  if (id) u.searchParams.set('id', String(id));
  try {
    const r = await fetch(u, { method: 'POST', headers: { authorization: `Bearer ${process.env.SCHED_KEY}`, 'content-type': 'application/json' }, body: '{"from":"kick"}', signal: AbortSignal.timeout(ms) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, detail: e.message }; }
}

// ---------- chat-side intents ----------
const BUILD_VERB = String.raw`(?:please\s+|pls\s+|kindly\s+|can\s+you\s+|could\s+you\s+|help\s+me\s+)?(?:build|make|create|design|generate|code|develop|set\s*up)`;
const BUILD_NOUN = String.raw`(?:web\s*site|site|landing\s*page|web\s*page|home\s*page|page|portfolio|blog|web\s*app|app|pwa|game|quiz|calculator|tracker|dashboard|store|shop|catalog(?:ue)?|menu|invitation|resume|cv\s+site|link[\s-]?in[\s-]?bio)`;
export const BUILD_RE = new RegExp(String.raw`^\s*${BUILD_VERB}\s+(?:me\s+|us\s+|him\s+|her\s+)?(?:a|an|my|the|one|simple|quick|small|new|nice|beautiful|modern)?\s*[\s\S]{0,80}?\b${BUILD_NOUN}\b`, 'i');
export const BUILD_PREFIX_RE = /^\s*\/?(?:build|site|website|app|make\s+site|make\s+app)\s*[:：]\s*([\s\S]{3,})$/i;
export const AGENT_RE = /^\s*\/?(?:agent|task|research|job|work\s+on\s+this|do\s+this)\s*[:：]\s*([\s\S]{3,})$/i;
export const JOBS_RE = /^\s*\/?(?:jobs|my\s+jobs|job\s+list|list\s+jobs|tasks|my\s+tasks)\s*[?.!]*\s*$/i;
export const CANCEL_JOB_RE = /^\s*\/?(?:cancel|stop|kill)\s+(?:job\s*|task\s*)?#?(\d{1,7})\s*[.!]*\s*$/i;
export const SITES_RE = /^\s*\/?(?:my\s+sites|sites|my\s+apps|apps|my\s+websites|websites|list\s+sites)\s*[?.!]*\s*$/i;
export const EDIT_RE = /^\s*\/?(?:edit|change|update|fix)\s+(?:site\s+|app\s+|my\s+)?([a-z0-9][a-z0-9-]{1,40})\s*[:：,\-–]?\s+([\s\S]{3,})$/i;
export const ZIP_RE = /^\s*\/?(?:zip|source|download|code)\s+(?:of\s+|for\s+)?(?:site\s+|app\s+|my\s+)?([a-z0-9][a-z0-9-]{1,40})\s*$/i;
export const ZIP_ALONE_RE = /^\s*\/?(?:zip|source code|send (?:me )?the (?:source|code|zip))\s*[.!]*\s*$/i;
export const APK_RE = /^\s*\/?(?:make|build|create|get|generate)?\s*(?:an?\s+)?(?:android\s+)?apk\b\s*(?:for\s+|of\s+)?([a-z0-9][a-z0-9-]{1,40})?\s*[?.!]*\s*$/i;

export function detectBuild(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 3000) return null;
  const p = t.match(BUILD_PREFIX_RE);
  if (p) return { brief: p[1].trim() };
  if (/^\s*(?:how|what|why|when|where|which|who|is|are|should|do|does|did)\b/i.test(t)) return null;   // questions about building, not orders
  if (/^\s*(?:can|could)\s+you\b/i.test(t) && /\?\s*$/.test(t) && t.length < 40) return null;        // "can you build apps?"
  if (BUILD_RE.test(t)) {
    if (/\b(post|caption|flyer|poster|image|picture|photo|logo|video|song|poem|email|letter|essay|story|reminder)\b/i.test(t.split(/\b(?:site|website|page|app)\b/i)[0]) && !/\b(site|website|web app|landing page|app)\b/i.test(t)) return null;
    return { brief: t };
  }
  return null;
}
export function detectAgent(text) {
  const m = String(text || '').match(AGENT_RE);
  return m ? { brief: m[1].trim() } : null;
}

export function slugify(s, max = 28) {
  const base = String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
  return base || 'site';
}

const ICON = { queued: '⏳', running: '🛠️', done: '✅', failed: '⚠️', cancelled: '🚫' };
const KIND = { build: 'Build', edit: 'Edit', agent: 'Task', research: 'Research', repo: 'Repo', media: 'Video', apk: 'APK' };
export function jobsText(list) {
  if (!list || !list.length) return 'No jobs yet. Try: _build me a landing page for my bakery_ or _agent: find 5 free JAMB past-question sites and compare them_';
  const lines = ['🗂️ *Your jobs*'];
  for (const j of list) {
    const brief = String(j.brief || '').replace(/\s+/g, ' ').slice(0, 60);
    let line = `${ICON[j.status] || '•'} #${j.id} ${KIND[j.kind] || j.kind}: ${brief}${String(j.brief || '').length > 60 ? '…' : ''} · _${j.status}_`;
    if (j.url) line += `\n   ${j.url}`;
    else if (j.status === 'failed' && j.error) line += `\n   _${String(j.error).slice(0, 80)}_`;
    lines.push(line);
  }
  if (list.some(j => j.status === 'queued' || j.status === 'running')) lines.push('', 'Stop one with *cancel 12* (the job number).');
  return lines.join('\n');
}
export function sitesText(list) {
  if (!list || !list.length) return 'No sites yet. Try: _build me a landing page for my bakery_ 🛠️';
  const lines = ['🌐 *Your sites & apps*'];
  list.slice(0, 15).forEach((s, i) => lines.push(`${i + 1}. *${s.title || s.slug}* (${s.slug}, v${s.version})\n   ${s.url}`));
  lines.push('', 'Change one: *edit ' + list[0].slug + ' make the buttons green*', 'Get the code: *zip ' + list[0].slug + '*');
  return lines.join('\n');
}
// pick a site by slug, a slug fragment or a word of its title
export function findSite(list, q) {
  const k = String(q || '').toLowerCase().trim();
  if (!k || !list?.length) return null;
  return list.find(s => s.slug === k) || list.find(s => s.slug === 'mai-' + k) || list.find(s => s.slug.includes(k))
    || list.find(s => String(s.title || '').toLowerCase().includes(k.replace(/-/g, ' '))) || null;
}

export const APK_TEXT = (url) => [
  '📱 *About an Android APK*, honestly:',
  'What I build is a *PWA*: it installs like an app straight from Chrome, no Play Store needed.',
  '',
  '*Install it now* (Android, Chrome):',
  `1. Open ${url || 'your app link'}`,
  '2. Tap ⋮ (top right) → *Add to Home screen* / *Install app*',
  '3. It gets its own icon, opens full-screen and works offline.',
  '',
  '*Want a real APK file?* Build an app first (e.g. _make a quiz app about …_), then send *apk <app name>*: I package it as a signed Android APK and send the download link. Or by hand: pwabuilder.com → paste the link → Package for stores → Android.',
].join('\n');
