// Scheduler endpoints.
// - Daily Vercel Cron (GET, "Authorization: Bearer $CRON_SECRET", 06:00 UTC = 7:00 Lagos, Hobby runs it within that hour):
//   morning nudge + a reminders sweep (backup in case the minute scheduler is down).
// - v5 reminders: GET/POST /api/cron?task=reminders with "Authorization: Bearer $SCHED_KEY" (or CRON_SECRET). Called by the
//   Supabase pg_cron gate (job michael-ai-reminders, every minute, but it only calls when the next reminder is due).
//   &sandbox=1 runs it in the wa-test namespace and sends nothing (used to prove the real scheduler end to end).
// - A request with x-test-key runs in the sandbox namespace and sends nothing.
import crypto from 'node:crypto';
import { morningNudge, runReminders, isTest, sendText, sendTemplate, loadState, uploadMedia, sendImage } from './whatsapp.js';
import * as VS from './_verse.js';
import * as NL from './_newsletter.js';
import * as V from './_v5.js';
import * as SPING from './_sowping.js';

export const config = { maxDuration: 300 };
const OWNER = () => (process.env.WA_ALLOWED || '2348148034092').split(',')[0].replace(/\D/g, '');

function sowKeyOk(request) {        // v9.2: Sow's cron calls us with the SOW_API_KEY the bot already shares with Sow
  const want = process.env.SOW_API_KEY, got = request.headers.get('x-sow-key') || '';
  if (!want || want.length < 16) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function bearerOk(request, ...names) {
  const got = request.headers.get('authorization') || '';
  return names.some(n => {
    const want = process.env[n];
    if (!want || want.length < 16) return false;
    const a = Buffer.from(got), b = Buffer.from(`Bearer ${want}`);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function handle(request) {
  const u = new URL(request.url);
  const task = u.searchParams.get('task') || 'nudge';
  const test = isTest(request);
  if (task === 'verse') {          // v7.2: daily verse push at 06:00 Lagos (pg_cron gate row "verse"; &sandbox=1 = row "verse-test", sends nothing)
    if (!test && !bearerOk(request, 'SCHED_KEY', 'CRON_SECRET')) { await new Promise(r => setTimeout(r, 300)); return new Response('Unauthorized', { status: 401 }); }
    const sandbox = test || u.searchParams.get('sandbox') === '1';
    const ctx = sandbox ? { test: true, ns: 'wa-test', outbox: [] } : { test: false, ns: 'wa', outbox: [] };
    let r;
    try {
      const at = sandbox && u.searchParams.get('now') ? Date.parse(u.searchParams.get('now')) : undefined;
      const force = !test && u.searchParams.get('force') === '1' && bearerOk(request, 'SCHED_KEY');   // operator check: ignore the window once
      r = await VS.runVerse(ctx, { sendText, uploadMedia, sendImage, loadState, owner: OWNER(), setNextWake: V.setNextWake, now: at, force });
    } catch (e) { console.log('[cron] verse error', e.message); r = { error: e.message }; }
    return Response.json({ ok: !r.error, task, sandbox, ...r, outbox: sandbox ? ctx.outbox.map(b => b.type === 'text' ? b.text.body : b.type === 'image' ? '[image] ' + (b.image?.caption || '') : '[' + b.type + ']') : undefined });
  }
  if (task === 'sowping') {        // v9.2: Sow just auto-posted (POST from sow-ng /api/cron, x-sow-key); x-test-key = sandbox, sends nothing
    if (!test && !sowKeyOk(request)) { await new Promise(r => setTimeout(r, 300)); return new Response('Unauthorized', { status: 401 }); }
    const sandbox = test || u.searchParams.get('sandbox') === '1';
    const ctx = sandbox ? { test: true, ns: 'wa-test', outbox: [] } : { test: false, ns: 'wa', outbox: [] };
    let r;
    try {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      const at = sandbox && u.searchParams.get('now') ? Date.parse(u.searchParams.get('now')) : undefined;
      r = await SPING.ingest(ctx, body.events || [], { sendText, sendTemplate, loadState, owner: OWNER(), now: at });
    } catch (e) { console.log('[cron] sowping error', e.message); r = { error: e.message }; }
    console.log('[cron] sowping', JSON.stringify({ sandbox, ...r }));
    return Response.json({ ok: !r.error, task, sandbox, ...r, outbox: sandbox ? ctx.outbox.filter(b => b.type === 'text').map(b => b.text.body) : undefined });
  }
  if (task === 'newsletter') {     // v7.1: Monday & Friday Letters (pg_cron gate row "newsletter"; &sandbox=1 = row "newsletter-test", nothing emailed)
    if (!test && !bearerOk(request, 'SCHED_KEY', 'CRON_SECRET')) { await new Promise(r => setTimeout(r, 300)); return new Response('Unauthorized', { status: 401 }); }
    const sandbox = test || u.searchParams.get('sandbox') === '1';
    const ctx = sandbox ? { test: true, ns: 'wa-test', outbox: [] } : { test: false, ns: 'wa', outbox: [] };
    let r;
    try {
      const testEmails = sandbox ? String(u.searchParams.get('emails') || '').split(',').filter(e => /^[^@\s]+@(?:example\.com|x\.test)$/i.test(e)) : undefined;
      const at = sandbox && u.searchParams.get('now') ? Date.parse(u.searchParams.get('now')) : undefined;
      r = await NL.runNewsletter(ctx, { sendText, sendTemplate, loadState, owner: OWNER(), setNextWake: V.setNextWake, testEmails, now: at, deadlineMs: 230e3 });
    } catch (e) { console.log('[cron] newsletter error', e.message); r = { error: e.message }; }
    return Response.json({ ok: !r.error, task, sandbox, ...r, outbox: sandbox ? ctx.outbox.filter(b => b.type === 'text').map(b => b.text.body) : undefined });
  }
  if (task === 'reminders') {
    if (!test && !bearerOk(request, 'SCHED_KEY', 'CRON_SECRET')) { await new Promise(r => setTimeout(r, 300)); return new Response('Unauthorized', { status: 401 }); }
    const sandbox = test || u.searchParams.get('sandbox') === '1';
    const ctx = sandbox ? { test: true, ns: 'wa-test', outbox: [] } : undefined;
    let r;
    try { r = await runReminders(ctx); } catch (e) { console.log('[cron] reminders error', e.message); r = { error: e.message }; }
    console.log('[cron] reminders', JSON.stringify({ sandbox, ...r }));
    return Response.json({ ok: !r.error, task, sandbox, ...r, outbox: ctx ? ctx.outbox.filter(b => b.type === 'text').map(b => b.text.body) : undefined });
  }
  if (!test && !bearerOk(request, 'CRON_SECRET')) return new Response('Unauthorized', { status: 401 });
  const ctx = test ? { test: true, ns: 'wa-test', outbox: [] } : undefined;
  let r, rem;
  try { r = await morningNudge(ctx, { force: test && u.searchParams.get('force') === '1' }); }
  catch (e) { console.log('[cron] nudge error', e.message); r = { error: e.message }; }  // never fail loudly
  try { rem = await runReminders(ctx); } catch (e) { rem = { error: e.message }; }
  console.log('[cron]', JSON.stringify({ ...r, text: undefined, reminders: rem }));
  return Response.json({ ok: true, test, ...r, reminders: rem, outbox: ctx ? ctx.outbox.filter(b => b.type === 'text').map(b => b.text.body) : undefined });
}
export const GET = handle;
export const POST = handle;
