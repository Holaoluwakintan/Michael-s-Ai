// v6 AGENT MODE worker endpoint (v7: every job kind except media; media jobs run in /api/media, which carries ffmpeg).
// POST /api/jobs            (Authorization: Bearer SCHED_KEY)  -> 202 at once, runs one tick in waitUntil, self-chains while work remains.
// POST /api/jobs?sandbox=1  same for the wa-test namespace (sends nothing to WhatsApp; outgoing texts land in job.state.outbox).
// x-test-key: WA_TEST_KEY may stand in for the bearer (sandbox only); add &sync=1 to run the tick inline and get its result.
// GET  /api/jobs?sandbox=1&id=N (test key) -> the sandbox job row (status, steps, result, outbox), for end-to-end tests.
import { waitUntil } from '@vercel/functions';
import * as J from './_jobs.js';
import { runTick } from './_agent.js';
import { sendText, uploadMedia, sendImage, sendDocument, sendMedia, downloadFile, loadKB, saveKB, addFact } from './whatsapp.js';
import { generateImage, fetchPage } from './_extras.js';
import { webResults, readTop } from './_v5.js';
import PROFILE from './_profile.js';

export const config = { maxDuration: 300 };
const log = (...a) => console.log('[jobs]', ...a);

async function jinaRead(url) {
  const r = await fetch('https://r.jina.ai/' + url, { headers: { accept: 'text/plain', 'x-return-format': 'text' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return null;
  const t = await r.text();
  return t && t.length > 80 ? t : null;
}
export const DEPS = { sendText, uploadMedia, sendImage, sendDocument, sendMedia, downloadFile, loadKB, saveKB, addFact, generateImage, fetchPage, webResults, readTop, jinaRead, profile: PROFILE };

export function auth(request, url) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const key = process.env.SCHED_KEY || '';
  const test = process.env.WA_TEST_KEY && request.headers.get('x-test-key') === process.env.WA_TEST_KEY;
  const sandbox = url.searchParams.get('sandbox') === '1';
  if (key && bearer === key) return { ok: true, sandbox };
  if (test) return { ok: true, sandbox: true, test: true };      // the test key only ever reaches the sandbox namespace
  return { ok: false };
}

export async function work(ns, id = null, { chain = true, deps = DEPS, kinds = null, notKinds = ['media'], path = '/api/jobs' } = {}) {
  let r;
  try { r = await runTick({ ns, id, deps, kinds, notKinds }); }
  catch (e) { log('tick failed', e.message); return { error: e.message }; }
  log(JSON.stringify({ ns, id: r.id, status: r.status, phase: r.phase, ms: r.ms, idle: r.idle || false }));
  if (chain && (r.more || (!r.idle && r.status !== 'running'))) {
    // more work (this job, or another one queued behind it): hand over to a fresh invocation
    const k = await J.kick(ns, { ms: 4000, path });
    log('chained', JSON.stringify(k));
  }
  return r;
}

export async function POST(request) {
  const url = new URL(request.url);
  const a = auth(request, url);
  if (!a.ok) return new Response('unauthorized', { status: 401 });
  if (!J.jobsOn()) return Response.json({ ok: false, error: 'jobs store not configured' }, { status: 503 });
  const ns = a.sandbox ? 'wa-test' : 'wa';
  const id = url.searchParams.get('id') ? +url.searchParams.get('id') : null;
  if (a.test && url.searchParams.get('sync') === '1') return Response.json({ ok: true, ...(await work(ns, id, { chain: false })) });
  waitUntil(work(ns, id));
  return Response.json({ ok: true, accepted: true, ns }, { status: 202 });
}

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('health') === '1') return Response.json({ ok: true, jobs: J.jobsOn(), build: 'v8.0' });
  const a = auth(request, url);
  if (!a.ok || !a.test) return new Response('unauthorized', { status: 401 });
  const id = +url.searchParams.get('id');
  if (url.searchParams.get('purge') === '1') return Response.json({ ok: true, purged: await J.rpc('purge_test', {}) });
  if (url.searchParams.get('sites') === '1') return Response.json({ ok: true, sites: await J.rpc('site_list', { ns: 'wa-test', owner: url.searchParams.get('owner') || '2348148034092' }) });
  const job = id ? await J.rpc('get', { ns: 'wa-test', id }) : null;
  if (job?.state) { delete job.state.files; delete job.state.images; delete job.state.cool; }
  return Response.json({ ok: true, job });
}
