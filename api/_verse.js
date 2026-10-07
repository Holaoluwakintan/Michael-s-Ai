// v7.2 (7 Oct 2026): daily Bible verse from Sow, pushed to Michael at 06:00 Africa/Lagos, plus the "verse" command.
// - Source: GET https://sow-ng.vercel.app/api/today (x-sow-key: SOW_API_KEY) -> post { title, verse, reference, caption, image_url, text.whatsapp }.
// - Trigger: the pg_cron gate (michael_ai.tick(), every minute) POSTs /api/cron?task=verse when sched row "verse" is due; each run
//   re-arms the row to the next 06:00 Lagos (05:00 UTC). Row "verse-test" (&sandbox=1) is the sandbox twin.
// - Once a day, guaranteed by michael_ai.daily_push (ns, kind, day) primary key: the first run that claims the day sends; any other
//   run that day (retry, double fire, the daily Vercel cron) sees the claim and does nothing.
// - WhatsApp 24h rule (test number, no template): only sent if Michael wrote to the bot in the last 23.5 h; otherwise the day is
//   recorded as window_closed and nothing is sent. A run after 12:00 Lagos doesn't send that day's verse (too late to be useful).
import * as NL from './_newsletter.js';

export const SOW_URL = () => process.env.SOW_URL || 'https://sow-ng.vercel.app';
export const verseOn = () => Boolean(process.env.SOW_API_KEY);
export const PUSH_HOUR_UTC = 5;                                   // 06:00 Lagos
export const LATEST_HOUR_UTC = 11;                                // after 12:00 Lagos the morning push is skipped
export const VERSE_RE = /^\s*\/?(?:verse|today|today'?s\s+verse|daily\s+verse|my\s+daily\s+(?:bible\s+)?verse|bible\s+verse(?:\s+today)?|verse\s+of\s+the\s+day)\s*[?.!🙏]*\s*$/iu;
const log = (...a) => console.log('[verse]', ...a);

export function nextPushSlot(now = Date.now()) {
  const d = new Date(now).toISOString().slice(0, 10);
  const t = Date.parse(`${d}T0${PUSH_HOUR_UTC}:00:00Z`);
  return t > now ? t : t + 864e5;
}

export async function fetchToday({ fetchImpl = globalThis.fetch } = {}) {
  const r = await fetchImpl(`${SOW_URL()}/api/today`, { headers: { 'x-sow-key': process.env.SOW_API_KEY || '' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`sow today ${r.status}`);
  const j = await r.json();
  return { today: j.today, post: j.post || null };
}

export function captionOf(p) {
  const ref = p.reference ? `${p.reference}${/KJV/i.test(p.reference) ? '' : ' (KJV)'}` : '';
  let cap = p.text && p.text.whatsapp ? String(p.text.whatsapp).trim() : '';
  if (cap) {
    if (p.title && !cap.includes(p.title)) cap = `*${p.title}*\n\n${cap}`;
    if (p.verse && !cap.includes(String(p.verse).slice(0, 30))) cap += `\n\n"${p.verse}" - ${ref}`;
    else if (p.reference && !/KJV/i.test(cap)) cap = cap.replace(p.reference, ref);
  } else {
    cap = [p.title ? `*${p.title}*` : null, p.caption || null, p.verse ? `"${p.verse}" - ${ref}` : null].filter(Boolean).join('\n\n');
  }
  return cap;
}

// deps: { sendText, uploadMedia, sendImage, owner, fetchImpl }
export async function sendVerse(post, ctx, deps) {
  const cap = captionOf(post);
  const short = cap.length > 1000;                                // WhatsApp image captions stop at 1024 chars
  if (post.image_url) {
    try {
      const r = await (deps.fetchImpl || globalThis.fetch)(post.image_url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('image ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const up = await deps.uploadMedia(buf, /png/.test(mime) ? 'image/png' : 'image/jpeg', ctx, 'verse.jpg');
      if (!up.ok) throw new Error('upload ' + String(up.detail || '').slice(0, 80));
      const s = await deps.sendImage(deps.owner, up.id, short ? `*${post.title || 'Today\'s verse'}*${post.reference ? ' · ' + post.reference : ''}` : cap, ctx);
      if (s && s.ok === false) throw new Error('send ' + String(s.detail || '').slice(0, 80));
      if (short) await deps.sendText(deps.owner, cap, ctx);
      return { ok: true, image: true, waId: s && s.id };
    } catch (e) { log('image path failed, sending text', e.message); }
  }
  const s = await deps.sendText(deps.owner, cap, ctx);
  return { ok: !(s && s.ok === false), image: false, detail: s && s.detail, waId: s && s.id };
}

// the scheduled push. deps: { loadState, sendText, uploadMedia, sendImage, owner, setNextWake, now, fetchImpl }
export async function runVerse(ctx, deps) {
  const ns = ctx && ctx.test ? 'wa-test' : 'wa';
  const now = deps.now ?? Date.now();
  const day = NL.lagosDate(now);
  const out = { ns, day, how: null };
  const prior = await NL.rpc('daily_get', { ns, kind: 'verse', day });
  const lh = new Date(now + 3600e3).getUTCHours();                  // Lagos hour
  if (prior) out.how = 'already:' + prior.how;
  else if (lh < PUSH_HOUR_UTC + 1 && !deps.force) out.how = 'too_early';
  else if (lh >= LATEST_HOUR_UTC + 1) out.how = 'too_late';
  else if (!verseOn()) out.how = 'sow_key_missing';
  else {
    const st = await deps.loadState(deps.owner, ctx);
    const open = deps.force || (st.lastIn && now - st.lastIn < 23.5 * 3600e3);   // force: an operator check with SCHED_KEY only
    if (!(await NL.rpc('daily_claim', { ns, kind: 'verse', day, how: open ? 'sending' : 'window_closed' }))) out.how = 'already';
    else if (!open) { out.how = 'window_closed'; out.last_message_hours_ago = st.lastIn ? Math.round((now - st.lastIn) / 36e5) : null; }
    else {
      let detail = null;
      try {
        const { today, post } = await fetchToday({ fetchImpl: deps.fetchImpl });
        if (!post) out.how = 'no_post';
        else if (today && today !== day) { out.how = 'sow_day_mismatch'; detail = today; }
        else { const r = await sendVerse(post, ctx, deps); out.how = (r.ok ? (r.image ? 'sent' : 'sent_text') : 'send_failed') + (deps.force && !(st.lastIn && now - st.lastIn < 23.5 * 3600e3) ? '_forced' : ''); out.title = post.title; out.waId = r.waId || null; detail = [post.title, r.waId, r.detail].filter(Boolean).join(' | '); }
      } catch (e) { out.how = 'error'; detail = e.message; }
      await NL.rpc('daily_mark', { ns, kind: 'verse', day, how: out.how, detail });
    }
  }
  const next = nextPushSlot(now);
  out.next = new Date(next).toISOString();
  if (deps.setNextWake) { const r = await deps.setNextWake(ns === 'wa-test' ? 'verse-test' : 'verse', next); out.armed = !!(r && r.ok); }
  log(JSON.stringify(out));
  return out;
}
