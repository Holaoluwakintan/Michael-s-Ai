// v7: the media worker endpoint. Same protocol as /api/jobs, but it only claims "media" jobs and carries ffmpeg (ffmpeg-static).
// POST /api/media[?sandbox=1][&id=N]  (Bearer SCHED_KEY, or x-test-key for the sandbox; &sync=1 runs inline)
import { waitUntil } from '@vercel/functions';
import * as J from './_jobs.js';
import { DEPS, work, auth } from './jobs.js';
import { process1, doneCaption, ffmpegPath } from './_media.js';

export const config = { maxDuration: 300 };
const MDEPS = { ...DEPS, mediaProcess: process1, mediaCaption: doneCaption };

export async function POST(request) {
  const url = new URL(request.url);
  const a = auth(request, url);
  if (!a.ok) return new Response('unauthorized', { status: 401 });
  if (!J.jobsOn()) return Response.json({ ok: false, error: 'jobs store not configured' }, { status: 503 });
  const ns = a.sandbox ? 'wa-test' : 'wa';
  const id = url.searchParams.get('id') ? +url.searchParams.get('id') : null;
  const opts = { deps: MDEPS, kinds: ['media'], notKinds: null, path: '/api/media' };
  if (a.test && url.searchParams.get('sync') === '1') return Response.json({ ok: true, ...(await work(ns, id, { ...opts, chain: false })) });
  waitUntil(work(ns, id, opts));
  return Response.json({ ok: true, accepted: true, ns }, { status: 202 });
}
export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('health') === '1') {
    let ff = null; try { ff = !!(await ffmpegPath()); } catch (e) { ff = 'missing: ' + e.message; }
    return Response.json({ ok: true, media: true, ffmpeg: ff, build: 'v8.0' });
  }
  return new Response('unauthorized', { status: 401 });
}
