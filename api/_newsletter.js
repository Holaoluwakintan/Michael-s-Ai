// v7.1 (7 Oct 2026): Monday & Friday Letters newsletter.
// - 75 letters (Oct 12 2026 -> Jun 28 2027) live in Supabase michael_ai.nl_letters (fields only; rendered here, so a template fix
//   reaches every future letter). Per-subscriber state in michael_ai.nl_sends (letter_id + email primary key: nobody gets one twice).
//   All access goes through public.michael_ai_newsletter(p_key, p_op, p_args) (SECURITY DEFINER, checks SCHED_KEY).
// - Trigger: the existing pg_cron gate (michael_ai.tick(), every minute) POSTs /api/cron?task=newsletter when sched row
//   "newsletter" is due. Each run re-arms the row: 08:00 Lagos on send days, 20:00 Lagos the evening before (WhatsApp preview),
//   a minute later while a batch is still going, next 08:00 when today's Brevo budget is used up.
// - Mail goes out through his site's own broadcast endpoint (same sender, same per-recipient %%FIRST_NAME%% and working
//   %%UNSUBSCRIBE_URL%% as the books announcement). Budget = Brevo's live daily credits minus a reserve for welcome emails.
// - Sandbox (ctx.test / ns wa-test): fake recipient list, the broadcast is never called, nothing is emailed.
import * as J from './_jobs.js';

export const RESERVE = () => +(process.env.NL_RESERVE || 10);         // Brevo credits left for transactional mail each day
export const CHUNK = () => +(process.env.NL_CHUNK || 25);             // addresses per broadcast call (endpoint max 100)
export const SEND_HOUR_UTC = 7;                                       // 08:00 Africa/Lagos (UTC+1, no DST)
export const PREVIEW_HOUR_UTC = 19;                                   // 20:00 Lagos, the evening before
export const BROADCAST_URL = () => process.env.BROADCAST_URL || 'https://olaoluwamichael.vercel.app/api/newsletter/broadcast';
export const SITE = 'https://olaoluwamichael.vercel.app';
export const nlOn = () => J.jobsOn();
export const mailOn = () => Boolean(process.env.BROADCAST_SECRET && process.env.BREVO_API_KEY);
const log = (...a) => console.log('[nl]', ...a);

let mock = null;
export function setMock(fn) { mock = fn; }
export async function rpc(op, args = {}, ms = 15000) {
  if (mock) return mock(op, JSON.parse(JSON.stringify(args)));
  if (!J.jobsOn()) throw new Error('newsletter store not configured');
  const r = await fetch(`${process.env.SB_URL}/rest/v1/rpc/michael_ai_newsletter`, {
    method: 'POST',
    headers: { apikey: process.env.SB_ANON_KEY, authorization: `Bearer ${process.env.SB_ANON_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_key: process.env.SCHED_KEY, p_op: op, p_args: args }), signal: AbortSignal.timeout(ms),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`newsletter rpc ${op} ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

// ---------- time (Lagos = UTC+1 all year) ----------
export const lagosDate = (t = Date.now()) => new Date(t + 3600e3).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const sendAtOf = (d) => Date.parse(d + `T0${SEND_HOUR_UTC}:00:00Z`);
export function nextSendSlot(now = Date.now()) {                     // the next 08:00 Lagos strictly after now
  const today = sendAtOf(new Date(now).toISOString().slice(0, 10));
  return today > now ? today : today + 864e5;
}
export const previewAtOf = (sendOn) => Date.parse(addDays(String(sendOn).slice(0, 10), -1) + `T${PREVIEW_HOUR_UTC}:00:00Z`);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function niceDate(d, { day = true, year = false } = {}) {
  const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z');
  return `${day ? DAYS[x.getUTCDay()].slice(0, 3) + ' ' : ''}${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)}${year ? ' ' + x.getUTCFullYear() : ''}`;
}
const longDate = d => { const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z'); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const short = s => String(s || '').replace(/^(Monday|Friday) Letter: /, '');

// ---------- rendering (same look as the books announcement: BLOSSOM header, cream card, Cormorant titles, gold accent) ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "'Cormorant Garamond', Cormorant, Georgia, 'Times New Roman', serif";
const P = `margin:0 0 18px;font-family:${SANS};font-size:16px;line-height:1.7;color:#484139;`;
const paras = t => String(t || '').replace(/\r/g, '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
const inline = s => esc(s).replace(/\*([^*\n]{1,120})\*/g, '<strong style="color:#1C1916;">$1</strong>').replace(/\n/g, '<br>');

export function subjectOf(f) { return f.subject || (f.day ? `${f.day} Letter: ${f.title}` : f.title); }

export function render(f, { kind = 'letter' } = {}) {
  const title = f.title || f.subject || 'A letter from Michael';
  const eyebrow = kind === 'letter' && f.day && f.date ? `${esc(f.day)} Letter &middot; ${esc(longDate(f.date))}` : 'A note from Michael';
  const pre = f.promise || paras(f.body)[0] || title;
  const verse = f.verse_text ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;"><tr>
          <td width="3" style="background:#B8935A;border-radius:2px;"></td>
          <td style="padding:4px 0 4px 18px;">
            <div style="font-family:${SERIF};font-size:20px;line-height:1.45;font-style:italic;color:#1C1916;">&ldquo;${esc(f.verse_text)}&rdquo;</div>
            <div style="margin-top:8px;font-family:${SANS};font-size:13px;letter-spacing:0.06em;color:#8A6832;">${esc(f.verse_ref || '')}${f.translation ? ' (' + esc(f.translation) + ')' : ''}</div>
          </td></tr></table>` : '';
  const body = paras(f.body).map(p => `\n        <p style="${P}">${inline(p)}</p>`).join('');
  const promise = f.promise ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px;"><tr>
          <td style="background:#F3ECDD;border:1px solid #E4D7BF;border-radius:14px;padding:18px 20px;">
            <div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.2em;color:#8A6832;margin:0 0 6px;">TODAY&rsquo;S PROMISE</div>
            <div style="font-family:${SERIF};font-size:19px;line-height:1.45;color:#1C1916;">${esc(f.promise)}</div>
          </td></tr></table>` : '';
  const book = f.book && f.book_link ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 26px;">
          <tr><td align="center" bgcolor="#1C1916" style="border-radius:999px;">
            <a href="${esc(f.book_link)}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:0.04em;color:#F7F3EB;text-decoration:none;border-radius:999px;">Read ${esc(f.book)} &rarr;</a>
          </td></tr>
        </table>` : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:#F7F3EB; }
  a { color:#8A6832; }
  @media (max-width:480px) { .card { padding:28px 20px !important; } .outer { padding:20px 10px !important; } .ttl { font-size:28px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#F7F3EB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F7F3EB;">${esc(String(pre).slice(0, 140))}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F3EB;">
  <tr><td align="center" class="outer" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td align="center" style="padding:0 0 20px;font-family:${SERIF};font-size:22px;letter-spacing:0.32em;color:#1C1916;font-weight:600;">BLOSSOM</td></tr>
      <tr><td class="card" style="background:#FCFAF5;border:1px solid #DBD1C0;border-radius:18px;padding:36px 32px;">
        <div style="font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8A6832;margin:0 0 10px;">${eyebrow}</div>
        <h1 class="ttl" style="margin:0 0 22px;font-family:${SERIF};font-size:32px;line-height:1.15;font-weight:600;color:#1C1916;">${esc(title)}</h1>
        <p style="${P}">Hi %%FIRST_NAME%%,</p>${verse}${body}${promise}${f.signoff ? `\n        <p style="${P}">${inline(f.signoff)}</p>` : ''}${book}
        <p style="margin:0;font-family:${SANS};font-size:16px;line-height:1.7;color:#484139;">With love,</p>
        <p style="margin:2px 0 0;font-family:${SERIF};font-size:24px;line-height:1.3;font-style:italic;font-weight:500;color:#8A6832;">Olaoluwa Michael</p>
      </td></tr>
      <tr><td align="center" style="padding:22px 12px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:#70675C;">
        You're receiving this because you subscribed to BLOSSOM.${kind === 'letter' ? '<br>A short letter every Monday and Friday.' : ''}<br>
        <a href="%%UNSUBSCRIBE_URL%%" style="color:#70675C;text-decoration:underline;">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="${SITE}" style="color:#70675C;text-decoration:underline;">olaoluwamichael.vercel.app</a><br>
        &copy; ${new Date().getUTCFullYear()} Olaoluwa Michael &middot; BLOSSOM
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = [
    kind === 'letter' && f.day ? `${String(f.day).toUpperCase()} LETTER` : null,
    String(title).toUpperCase(), '',
    'Hi %%FIRST_NAME%%,', '',
    f.verse_text ? `"${f.verse_text}"\n${f.verse_ref || ''}${f.translation ? ' (' + f.translation + ')' : ''}\n` : null,
    ...paras(f.body).flatMap(p => [p.replace(/\*([^*\n]+)\*/g, '$1'), '']),
    f.promise ? `Today's promise: ${f.promise}\n` : null,
    f.signoff ? f.signoff + '\n' : null,
    f.book && f.book_link ? `Read ${f.book}: ${f.book_link}\n` : null,
    'With love,', 'Olaoluwa Michael', '', '—',
    "You're receiving this because you subscribed to BLOSSOM.",
    'Unsubscribe: %%UNSUBSCRIBE_URL%%',
  ].filter(x => x !== null).join('\n');
  return { subject: subjectOf(f), html, text };
}

// letters.csv row -> DB row
export function rowFromCsv(r) {
  const fields = { day: r.day, date: r.date, title: r.title, book: r.book, verse_ref: r.verse_ref, translation: r.translation, verse_text: r.verse_text,
    body: r.body, promise: r.promise, signoff: r.signoff, season: r.season, book_link: r.book_link };
  return { slot: +r.slot, send_on: r.date, send_at: new Date(sendAtOf(r.date)).toISOString(), subject: subjectOf(fields), fields };
}

// ---------- providers (real) ----------
export async function brevoCredits() {
  const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('brevo account ' + r.status);
  const plan = (await r.json()).plan || [];
  const p = plan.find(x => x.creditsType === 'sendLimit');
  return p ? +p.credits : Infinity;                                   // a paid plan has no daily send limit
}
export async function brevoGot(email, subject) {                      // did Brevo log a request for this address + subject (2 days)?
  const u = new URL('https://api.brevo.com/v3/smtp/statistics/events');
  u.search = new URLSearchParams({ email, event: 'requests', days: '2', limit: '50' });
  const r = await fetch(u, { headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('brevo events ' + r.status);
  return ((await r.json()).events || []).some(e => e.subject === subject);
}
export async function broadcast(payload) {
  const r = await fetch(BROADCAST_URL(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-broadcast-secret': process.env.BROADCAST_SECRET },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) });
  let b; try { b = await r.json(); } catch { b = { error: `HTTP ${r.status}` }; }
  if (r.status >= 400 && !b.sentTo) throw new Error(`broadcast ${r.status}: ${String(b.error || '').slice(0, 200)}`);
  return b;
}
export const REAL = { credits: brevoCredits, got: brevoGot, broadcast };
// sandbox: the same flow with nothing leaving the box
export function sandboxProviders(credits = 300) {
  let left = credits;
  return {
    credits: async () => left,
    got: async () => false,
    broadcast: async ({ emails = [] }) => { left -= emails.length; return { sentTo: emails, failedTo: [], skipped: [] }; },
  };
}

// ---------- the scheduler run ----------
// deps: { sendText, loadState, owner, setNextWake, providers, now, deadlineMs, testEmails }
export async function runNewsletter(ctx, deps) {
  const ns = ctx && ctx.test ? 'wa-test' : 'wa';
  const fixed = deps.now != null;
  const clock = () => (fixed ? deps.now : Date.now());
  const deadline = Date.now() + (deps.deadlineMs ?? 200e3);
  const prov = deps.providers || (ctx && ctx.test ? sandboxProviders() : REAL);
  const out = { ns, started: [], sent: 0, failed: 0, stop: null, preview: null };
  if (!(ctx && ctx.test) && !deps.providers && !mailOn()) out.stop = 'mail_not_configured';
  const iso = t => new Date(t).toISOString();

  // 1. evening preview (from 20:00 Lagos, for tomorrow's letter), only inside WhatsApp's 24h window
  const nowL = clock(), h = new Date(nowL).getUTCHours();
  if (h >= PREVIEW_HOUR_UTC) {                                        // 20:00-00:59 Lagos only: never a preview in the small hours
    const tomorrow = addDays(lagosDate(nowL), 1);
    const pv = await rpc('preview_due', { ns, date: tomorrow });
    if (pv && nowL >= previewAtOf(pv.send_on)) {
      let how = 'window_closed';
      try {
        const st = await deps.loadState(deps.owner, ctx);
        if (st.lastIn && nowL - st.lastIn < 23.5 * 3600e3) {
          const r = await deps.sendText(deps.owner, previewText(pv), ctx);
          how = r && r.ok !== false ? 'sent' : 'send_failed';
        }
      } catch (e) { how = 'send_failed'; log('preview failed', e.message); }
      await rpc('preview_mark', { ns, id: pv.id, how });
      out.preview = { id: pv.id, how };
    }
  }

  // 2. start what's due, then send within today's budget
  const dueArgs = () => ({ ns, now: iso(clock()), ...(ns === 'wa-test' ? { test_emails: deps.testEmails || [] } : {}) });
  let letters = await rpc('due', dueArgs());
  out.started = letters.filter(l => l.sent === 0 && l.queued === l.total).map(l => l.id);
  let budget = null;
  if (!out.stop && letters.length) {
    try { const c = await prov.credits(); budget = c === Infinity ? Infinity : Math.max(0, c - RESERVE()); out.budget = budget; }
    catch (e) { out.stop = 'credits_unknown'; log('credits read failed', e.message); }
  }
  for (const L of letters) {
    if (out.stop) break;
    const full = await rpc('get', { ns, id: L.id });
    const mail = render(full.fields || {}, { kind: full.kind });
    mail.subject = full.subject || mail.subject;
    if (L.stale) {                    // addresses left in flight by a run that died: ask Brevo before sending anything again
      const stale = await rpc('stale', { ns, id: L.id });
      const sent = [], requeue = [];
      for (const e of stale) { try { (await prov.got(e, mail.subject)) ? sent.push(e) : requeue.push(e); } catch { /* stays in flight; asked again next run */ } }
      if (sent.length || requeue.length) await rpc('mark', { ns, id: L.id, sent, requeue });
    }
    while (!out.stop) {
      if (Date.now() > deadline) { out.stop = 'time'; break; }
      if (budget !== Infinity && budget <= 0) { out.stop = 'budget'; break; }
      const emails = await rpc('claim', { ns, id: L.id, n: Math.min(CHUNK(), budget), lease_s: 600 });
      if (!emails.length) break;
      let b;
      try { b = await prov.broadcast({ subject: mail.subject, html: mail.html, text: mail.text, emails }); }
      catch (e) { out.stop = 'broadcast_error'; out.error = String(e.message).slice(0, 200); log('broadcast failed, left in flight for reconcile', e.message); break; }
      const low = x => String(typeof x === 'string' ? x : (x && x.email) || '').toLowerCase();
      const sentTo = (b.sentTo || []).map(low).filter(Boolean);
      const failedTo = (b.failedTo || []).map(low).filter(Boolean);
      const skipped = (b.skipped || []).map(low).filter(Boolean);
      const unknown = emails.filter(e => !sentTo.includes(e) && !failedTo.includes(e) && !skipped.includes(e));
      await rpc('mark', { ns, id: L.id, sent: sentTo, failed: failedTo, dropped: skipped, requeue: unknown, err: (b.errors || [])[0] || null });
      out.sent += sentTo.length; out.failed += failedTo.length;
      if (budget !== Infinity) budget -= sentTo.length + failedTo.length;
      if (failedTo.length && !sentTo.length) { out.stop = 'provider_refused'; out.error = String((b.errors || [])[0] || '').slice(0, 200); break; }
      if (!sentTo.length && !failedTo.length && unknown.length === emails.length) { out.stop = 'no_result'; break; }
    }
  }

  // 3. re-arm the gate
  letters = await rpc('due', { ...dueArgs(), test_emails: [] });
  const left = letters.reduce((s, l) => s + l.queued + l.inflight, 0);
  const t = clock();
  let next = null;
  if (left) {
    const queued = letters.some(l => l.queued > 0);
    if (out.stop === 'time') next = t + 60e3;
    else if (['credits_unknown', 'broadcast_error', 'no_result'].includes(out.stop)) next = t + 15 * 60e3;
    else if (out.stop === 'mail_not_configured') next = t + 60 * 60e3;
    else if (out.stop === 'budget' || out.stop === 'provider_refused') next = queued ? nextSendSlot(t) : t + 11 * 60e3;  // the rest at 08:00 tomorrow
    else next = queued ? t + 60e3 : t + 11 * 60e3;                         // only leases outstanding: reconcile after they expire
  }
  const up = await rpc('upcoming', { ns, n: 1 });
  if (up && up[0]) {
    const at = Date.parse(up[0].send_at), pv = previewAtOf(up[0].send_on);
    const cand = [at, ...(up[0].preview_at || pv <= t ? [] : [pv])];
    next = Math.min(next ?? Infinity, ...cand);
  }
  out.left = left; out.next = next ? iso(next) : null;
  if (deps.setNextWake) { const r = await deps.setNextWake(ns === 'wa-test' ? 'newsletter-test' : 'newsletter', next); out.armed = !!(r && r.ok); }
  log(JSON.stringify(out));
  return out;
}

export function previewText(l) {
  return `📬 Tomorrow's letter (8am): *${short(l.subject)}*\nReply *skip* to hold it.`;
}

// ---------- WhatsApp commands (owner only) ----------
export const LETTERS_RE = /^\s*\/?(?:letters|newsletters?\s+status|next\s+letters?|letter\s+status)\s*[?.!]*\s*$/i;
export const SKIP_RE = /^\s*\/?skip(?:\s+(?:it|the\s+next(?:\s+letter)?|next(?:\s+letter)?|(?:tomorrow'?s?|monday'?s?|friday'?s?)\s+letter|letter))?\s*[.!]*\s*$/i;
export const UNSKIP_RE = /^\s*\/?(?:unskip|un-skip|undo\s+skip)(?:\s+(?:it|letter))?\s*[.!]*\s*$/i;
export const SUBS_RE = /^\s*\/?(?:subs|subscribers|subscriber\s+count|how\s+many\s+subscribers)\s*[?.!]*\s*$/i;
export const NEWSLETTER_RE = /^\s*\/?newsletter\b\s*[:：\-–]?\s*([\s\S]*)$/i;
export const YES_RE = /^\s*(yes|yes+|yes,? send( it)?|send( it)?( now)?|go ahead|yep|yeah|ok,? send( it)?|okay,? send( it)?)\s*[.!👍✅🙏]*\s*$/iu;
export const NO_RE = /^\s*(no|nope|cancel|don'?t send( it)?|drop it|stop|discard)\s*[.!]*\s*$/i;
export const PENDING_MS = 30 * 60e3;

export function budgetLine(count, usable) {
  if (usable === Infinity || usable >= count) return `All ${count} go out right away.`;
  const day = 300 - RESERVE();
  if (usable <= 0) return `Today's free email budget is used up, so it starts tomorrow at 8am (${Math.min(count, day)} then${count > day ? ', the rest the morning after' : ''}).`;
  return `${usable} go out right away (today's free budget), the other ${count - usable} tomorrow at 8am.`;
}

export function lettersText(up, st, spare, subs) {
  const lines = ['📬 *Monday & Friday Letters*'];
  if (up.length) { lines.push('', '*Next up:*'); for (const l of up) lines.push(`• ${niceDate(l.send_on)}: ${short(l.subject)}${l.kind === 'oneoff' ? ' (one-off)' : ''}`); }
  else lines.push('', 'Nothing scheduled.');
  if (st) {
    if (st.status === 'sending') lines.push('', `*Sending now:* ${short(st.subject)}: ${st.sent}/${st.total} sent${st.queued ? `, ${st.queued} to go (8am)` : ''}${st.failed ? `, ${st.failed} failed` : ''}`);
    else lines.push('', `*Last send:* ${short(st.subject)}: sent ${st.sent}/${st.total}${st.failed ? ` (${st.failed} failed)` : ''}${st.dropped ? ` (${st.dropped} unsubscribed meanwhile)` : ''}`);
  } else lines.push('', `_No letter has gone out yet.${up[0] ? ` The first one is ${niceDate(up[0].send_on)} at 8am.` : ''}_`);
  lines.push('', `👥 ${subs} subscribers · 300 free emails a day, so each letter lands over ${subs > 300 - RESERVE() ? '2 mornings' : '1 morning'}.`);
  if (spare) lines.push(`🗂️ Skipped (spare pile): ${spare}`);
  lines.push('', '_skip · unskip · subs · newsletter <text>_');
  return lines.join('\n');
}

// Handles the newsletter commands. Returns null when the text isn't one of them, else { reply, kick? }.
// deps: { ns, isOwner, state (chat state; nlPending lives on it), draft(text) -> {subject,title,body,signoff}|null, credits(), now }
export async function command(text, deps) {
  const t = String(text || '').trim();
  const { ns, state } = deps;
  const now = deps.now ?? Date.now();
  const pend = state.nlPending && now - state.nlPending.at < PENDING_MS ? state.nlPending : null;
  if (state.nlPending && !pend) state.nlPending = null;              // expired after 30 min
  const fbNewer = state.pending && Date.parse(state.pending.at) > (pend ? pend.at : 0);
  if (pend && !fbNewer && (YES_RE.test(t) || NO_RE.test(t))) {
    if (!deps.isOwner) return null;
    state.nlPending = null;
    if (NO_RE.test(t)) return { reply: '🗑️ Newsletter cancelled. Nothing was sent.' };
    const row = await rpc('oneoff', { ns, subject: pend.subject, fields: pend.fields, now: new Date(now).toISOString() });
    return { reply: `✅ Sending *${pend.subject}* now. ${pend.timing}\nSend *letters* any time to see how far it's got.`, kick: row && row.id };
  }
  const isCmd = LETTERS_RE.test(t) || SKIP_RE.test(t) || UNSKIP_RE.test(t) || SUBS_RE.test(t) || NEWSLETTER_RE.test(t);
  if (!isCmd) return null;
  if (!deps.isOwner) return { reply: 'Only Michael can manage the newsletter on this line.' };
  if (!nlOn()) return { reply: '📬 The newsletter store isn\'t switched on yet. Tab will fix it.' };
  if (SUBS_RE.test(t)) {
    const n = await rpc('subs_count', {});
    const day = 300 - RESERVE();
    return { reply: `👥 *${n}* newsletter subscribers right now.\nThe free email plan sends about ${day} a day, so a letter reaches everyone over ${Math.max(1, Math.ceil(n / day))} morning${n > day ? 's' : ''}.` };
  }
  if (LETTERS_RE.test(t)) {
    const [up, st, spare, subs] = await Promise.all([rpc('upcoming', { ns, n: 3 }), rpc('status', { ns }), rpc('spare_count', { ns }), rpc('subs_count', {})]);
    return { reply: lettersText(up || [], st, spare, subs) };
  }
  if (SKIP_RE.test(t)) {
    const r = await rpc('skip_next', { ns, now: new Date(now).toISOString() });
    if (!r) return { reply: 'There\'s no upcoming letter to skip.' };
    const up = await rpc('upcoming', { ns, n: 1 });
    return { reply: `⏸️ Skipped *${short(r.subject)}* (${niceDate(r.send_on)}). It's in the spare pile now, so nothing goes out that day.${up && up[0] ? `\nNext letter: ${niceDate(up[0].send_on)}, ${short(up[0].subject)}.` : ''}\nChanged your mind? Send *unskip*.` };
  }
  if (UNSKIP_RE.test(t)) {
    const r = await rpc('unskip', { ns, now: new Date(now).toISOString() });
    if (!r) return { reply: 'Nothing is skipped right now.' };
    if (r.past) return { reply: `*${short(r.subject)}* was due ${niceDate(r.send_on)}, which has passed, so it stays in the spare pile.` };
    return { reply: `▶️ Back on: *${short(r.subject)}* goes out ${niceDate(r.send_on)} at 8am.` };
  }
  // newsletter <text>
  const body = (t.match(NEWSLETTER_RE)[1] || '').trim();
  if (body.length < 12) return { reply: '✉️ To email all your subscribers, send:\n_newsletter <your message>_\ne.g. _newsletter The new book is out this Saturday, here\'s why I wrote it…_\nI\'ll show you a preview first; nothing goes until you reply *yes*.\n\nFor the Monday & Friday letters, send *letters*.' };
  let d = null;
  try { d = deps.draft ? await deps.draft(body) : null; } catch (e) { log('draft failed', e.message); }
  if (!d || !d.body) { const first = body.split(/\n|(?<=[.!?])\s/)[0].slice(0, 70).replace(/[.!?]+$/, ''); d = { subject: first, title: first, body, signoff: null }; }
  const fields = { title: d.title || d.subject, subject: d.subject, body: d.body, signoff: d.signoff || null };
  const subs = await rpc('subs_count', {});
  let usable = null;
  try { const c = await (deps.credits || brevoCredits)(); usable = c === Infinity ? Infinity : Math.max(0, c - RESERVE()); } catch { usable = null; }
  const timing = usable == null ? 'It goes out within today\'s free budget and the rest tomorrow at 8am.' : budgetLine(subs, usable);
  state.nlPending = { at: now, subject: d.subject, fields, timing };
  const preview = String(d.body).length > 1500 ? String(d.body).slice(0, 1500) + '…' : d.body;
  return { reply: `✉️ *Newsletter preview*\n\n*Subject:* ${d.subject}\n\nHi <first name>,\n\n${preview}${d.signoff ? '\n\n' + d.signoff : ''}\n\nWith love,\nOlaoluwa Michael\n\n———\n👥 To *${subs}* subscribers. ${timing}\nReply *yes* within 30 min to send, or *no* to cancel. To change it, send *newsletter* again with new text.` };
}

// Gemini prompt for a one-off: his words, tidied into the newsletter's voice (never invents facts)
export function draftPrompt(text) {
  return `Michael (Olaoluwa Michael, Christian author, BLOSSOM newsletter) wants to email his subscribers. His note:\n<<<${text}>>>\n\n` +
    'Write the email as him, warm and personal, in his newsletter voice: short paragraphs, plain words, no hype. Keep every fact he gave and add none (no dates, links, prices or claims he did not write). ' +
    'If his note is already a full message, keep his wording and only tidy it. 60-220 words. Do not include a greeting line or "With love" (the template adds them).\n' +
    'Reply with ONLY JSON: {"subject":"max 60 chars","title":"short headline","body":"paragraphs separated by blank lines, no farewell line","signoff":"one short closing sentence that is not a farewell (no Grace and peace, Blessings, Love), or empty"}';
}
export function parseDraft(txt) {
  const m = String(txt || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (!j.body || !j.subject) return null;
    let so = j.signoff ? String(j.signoff).trim() : null;
    // the template already closes with "With love, Olaoluwa Michael": drop a farewell line so it doesn't sign off twice
    if (so && (/,\s*$/.test(so) || /^(grace|peace|blessings?|love|with love|yours|regards|warmly|cheers|sincerely|god bless|shalom|stay blessed)\b/i.test(so))) so = null;
    let body = String(j.body).trim().replace(/\n+\s*(grace and peace|blessings|with love|love|yours|stay blessed|god bless you)[^\n]{0,40},?\s*$/i, '');
    return { subject: String(j.subject).slice(0, 90), title: String(j.title || j.subject).slice(0, 90), body, signoff: so };
  } catch { return null; }
}
