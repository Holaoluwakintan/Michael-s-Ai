// Michael AI on WhatsApp: Meta WhatsApp Cloud API webhook.
// GET  = Meta verification handshake (hub.verify_token vs WA_VERIFY_TOKEN), plus ?health=1 (booleans only).
// POST = incoming messages. Answers 200 at once; the work runs in waitUntil.
// Env: GEMINI_API_KEY, WA_VERIFY_TOKEN, WA_TOKEN, WA_PHONE_ID, WA_APP_SECRET (optional), WA_ALLOWED (optional),
//      WA_GRAPH_VERSION (optional, default v26.0), WA_DRY_RUN=1 (log instead of sending), BLOB_READ_WRITE_TOKEN,
//      WA_TEST_KEY (optional: a POST with header x-test-key equal to it runs synchronously in a sandbox namespace,
//      sends nothing to WhatsApp and returns the replies it would have sent), CRON_SECRET (morning nudge auth).
// v5 (6 Oct 2026): reminders ("remind me at 5pm to …", daily/weekly, list/cancel; woken by a Supabase pg_cron gate, see api/_v5.js),
//      live web search (search: … / fresh-news questions; keyless DuckDuckGo + Google News + Wikipedia, answered with sources),
//      model rotation (smart Flash for hard asks, Lite then Gemma so it never goes silent), lean prompts, reply cache, /usage.
// v4 (6 Oct 2026): read: <link> / bare link -> fetch + summary + "save" to knowledge (api/_extras.js); image: <prompt> -> free image
//      provider (Pollinations key / Cloudflare / Gemini image / keyless Pollinations), sent back as a WhatsApp image; 20 images/day.
// v3 (6 Oct 2026): KB_LIMIT 20k -> 60k chars (oldest + newest on overflow); multi-teach (several "teach:" lines in one message = several facts).
// v2 (6 Oct 2026): owner-only allowlist, teach:/knowledge/unteach knowledge base (kept apart from chat history),
//      seeded base profile (/profile), personal-assistant prompt, /help, quota-aware model fallback, morning nudge.
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { get as blobGet, put as blobPut } from '@vercel/blob';
import SYSTEM from './_prompt.js';
import PROFILE from './_profile.js';
import * as V93 from './_v93.js';
import * as V95 from './_v95.js';
import * as V96 from './_v96.js';   // v9.6: deeper coding + image rules, code model chain (pro first), format notes   // v9.5: coding + image-prompt skills, picture feedback loop, face rule, fenced splitting
import * as F from './_files.js';
import { detectRead, fetchPage, blockedReply, summaryPrompt, factsPrompt, parseFacts, SAVE_RE, SAVE_ONLY_RE, SAVE_TAIL, detectImage, generateImage, imageQuota, countImage, primaryProvider, providerList } from './_extras.js';
import * as V from './_v5.js';
import * as V9 from './_v9.js';
import * as J from './_jobs.js';
import * as G from './_gem.js';
import * as B from './_backend.js';
import * as R from './_research.js';
import * as GR from './_repo.js';
import * as SOW from './_sow.js';
import { parseMediaCmd } from './_mediacmd.js';
import * as SPING from './_sowping.js';             // v9.2: "Sow just posted" pings (sow pings on/off)
import * as RPC from './_rpc.js';                  // v9.8.0: Royal People Care daily post drop (08:00 Lagos) + royals cmds
import * as SP from './_sowplus.js';               // v8: sow · sow week · posted <platform> · sow <day> · add a post for <when> about <topic>
import * as V97 from './_v97.js';               // v9.7: reminder questions + pending expiry, weak-answer retry + model health ranking, long-term memory, live morning brief
import * as R8 from './_remind8.js';                // v8: several times in one reminder, clarification answers, no fake "I've set it"
import * as PV from './_providers.js';             // v8: Groq / OpenRouter free models beside Gemini (only when their keys are set)
import * as BR from './_brain.js';                // v8: routing, his-world retrieval, auto-memory, fresh-info search
import { zipFiles } from './_sites.js';
import * as NL from './_newsletter.js';
import * as VS from './_verse.js';

export const config = { maxDuration: 60 };

const GRAPH = () => `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || 'v26.0'}`;
const DRY = () => process.env.WA_DRY_RUN === '1';
const ALLOWED = () => (process.env.WA_ALLOWED || '2348148034092').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
// Full Flash first; on a 429 fall through to the Lite models (each has its own free daily quota).
// v5: the 2.5/2.0 models are gone for new keys (404). Rotation tiers live in _v5.js: SMART (Flash) -> LITE -> GEMMA.
export const CHAIN = V.HARD_CHAIN;
export const LITE_FIRST = V.EASY_CHAIN;
const MAX_TURNS = 20;            // user+model pairs kept per number
const KB_LIMIT = 60000;          // v3: chars of taught facts sent to the model (~15k tokens; all of it, in practice)
const KB_OLD_SHARE = 0.25;       // on overflow: oldest facts get this share of KB_LIMIT, newest get the rest
const MAX_MULTI = 150;           // most teach: items saved from one message
const MAX_FACT = 600;
const PRIVATE_LINE = 'This is a private assistant.';
const SPLIT_AT = 3500;           // WhatsApp text limit is 4096
const seenHere = new Set();      // per warm instance, catches fast duplicate deliveries

const WA_RULES = `

# YOU ARE ON WHATSAPP NOW
Michael is chatting with you inside WhatsApp (not the app). Write like a friend texting:
- Short questions get short answers. No long preambles.
- WhatsApp formatting only: *bold* with single asterisks, _italic_ with underscores, simple "• " bullets or "1." lists. Never use **double asterisks**, # headings, tables or [links](url); paste bare URLs.
- Keep most replies under ~150 words unless he asks for something long (a post, a letter, a script, code).
- If he sends a VOICE NOTE: start your reply with one line 🎙️ _"…what he said…"_ (shorten if long), then answer him.
- If he sends a PICTURE: look at it carefully and do what the caption asks (or describe/help if there is no caption).`;

const PA_RULES = `

# PERSONAL ASSISTANT MODE (this overrides anything above about who you talk to)
- Michael is the ONLY person who talks to you here. You are his personal assistant: talk TO him ("you", "your"), like a sharp, warm, loyal PA who knows his life and work. Never talk as if you are him in normal chat, and don't sign off as him.
- Write AS him (first person, his public voice from the voice pack) only when he asks for content he will publish: Facebook posts, captions, Reel scripts, WhatsApp Channel posts, Status, newsletters/letters, Bible manga scripts, bios, replies to readers or comments.
- The BASE PROFILE and WHAT MICHAEL HAS TAUGHT YOU sections below are true facts about his life and work. Taught facts are newer: if one conflicts with the profile, the taught fact wins. Use them naturally when relevant; don't recite them unless he asks.
- Be useful and forward-moving: when it fits, connect answers to his current priority (making money, landing clients) and his open to-dos. Prefer a concrete next step, a draft or a short checklist over theory.
- Keep it short for WhatsApp: most replies are 1–6 lines.
- He trains you with "teach: <fact>" (text, or a voice note starting with "teach"). Commands: /help, /knowledge, /unteach N, /profile, /new, /nudge on|off, reminders, usage. Reminders: "remind me at 5pm to …" (the bot sets them; you never promise a reminder yourself). Fresh facts from the web: "search: <question>". Files: he can send a PDF, Word, Excel, PowerPoint or text file, or a photo of a page with "read"; the bot pulls the text, summarises it, answers questions on it, "save" keeps facts from it and "full text" sends the text back. Never say you can't read his files. For his Facebook Page he sends "post: <topic>": you draft it, and only his explicit "yes" publishes it. If he asks how to teach you or what you know, point him to these.
- AGENT MODE (v6): you CAN build websites and apps. When he wants a site or app, tell him to send it as an order, e.g. "build me a landing page for my bakery" or "make a quiz app about Bible books": the bot builds it in the background, deploys it live and messages him the link (apps install on Android via "Add to Home screen"). "edit <site> <change>" updates one, "my sites" lists them, "zip <site>" sends the code. Long research/multi-step jobs: "agent: <task>" runs in the background and reports back. "jobs" lists jobs, "cancel 12" stops one. Never claim you already built something unless the bot sent the link. A true Android APK file can't be built here (offer the installable web app).
- NEWSLETTER (v7.1): his Monday & Friday Letters email out automatically at 8am Lagos (75 letters, Oct 12 2026 to Jun 2027; 300 free emails a day, so each letter lands over 2 mornings). Commands: "letters" (next 3 + last send), "skip" / "unskip" the next letter, "subs" (subscriber count), "newsletter <text>" (one-off email: preview first, sends only after his "yes"). Never say an email went out unless the bot confirmed it.
- DAILY VERSE (v7.2): at 6am Lagos the bot sends him today's verse post from Sow (picture + caption, ready to forward or post to Status), only while the WhatsApp 24h window is open. "verse" (or "today", "daily verse") sends it on demand.
- v8 BRAIN: hard questions get the strongest model; he can see usage with "brain". You also get passages from his own letters, books and project list when they fit ("FROM MICHAEL'S OWN WORK"): use them, quote them accurately, give his real links. "learn <text or link>" adds to that library ("learned", "unlearn N"). The bot also notes durable facts about him from chat by itself (shown as "📝 Noted"), so he doesn't have to type teach: for everything.
- SOW (v8): "sow" shows the next 3 queued posts, "sow week" the weekly summary, "sow tomorrow" (or any day) that day's posts, "posted facebook" marks today's post as posted, "add a post for Friday 7pm about faith" writes and queues one. "post <text>" / "schedule <when> <text>" queue his exact words.
- Apart from these, the newsletter commands and the "post:" flow for his Facebook Page, you can't post or send emails from here. Questions that need fresh facts (news, prices, scores, "today") are searched on the web automatically before they reach you; if you still lack fresh data, say so and suggest "search: <question>". If he asks for something you can't do, say so in one line and give what you can (a draft or steps), or suggest sending the job to Tab.`;

const log = (...a) => console.log('[wa]', ...a);

// ctx: { test: bool, ns: 'wa' | 'wa-test', outbox: [] }. Test runs send nothing and keep their own blobs.
const liveCtx = () => ({ test: false, ns: 'wa', outbox: [] });

// ---------- storage ----------
// v7: Supabase (michael_ai.kv through the michael_ai_jobs RPC) is the main store; Vercel Blob is only read as a fallback
// (Oct 7 2026: the Blob store was suspended when his Vercel Hobby usage hit 100%, so the bot lost its memory there).
const kvOn = () => J.jobsOn();
async function blobRead(path) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const r = await blobGet(path, { access: 'private', useCache: false });
    if (!r) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) { log('blob read failed', path, e.message); return null; }
}
async function readJson(path) {
  if (kvOn()) {
    try {
      const v = await J.rpc('kv_get', { k: path }, 6000);
      if (v != null) return v;
    } catch (e) { log('kv read failed', path, e.message); }
    const old = await blobRead(path);                        // first read after the move: bring the old Blob copy over
    if (old != null) { try { await J.rpc('kv_put', { k: path, v: old }, 8000); } catch {} }
    return old;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) { log('no store configured: storage disabled'); return null; }
  return blobRead(path);
}
async function writeJson(path, obj) {
  if (kvOn()) {
    try { await J.rpc('kv_put', { k: path, v: obj }, 8000); return; } catch (e) { log('kv write failed', path, e.message); }
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await blobPut(path, JSON.stringify(obj), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
  } catch (e) { log('write failed', path, e.message); }
}
// chat history (+ dedupe ids, model cool-downs): <ns>/<number>.json
export async function loadState(num, ctx = liveCtx()) {
  const s = (await readJson(`${ctx.ns}/${num}.json`)) || {};
  return { history: s.history || [], memory: s.memory || [], seen: s.seen || [], cool: s.cool || {}, migrated: !!s.migrated, pending: s.pending || null, lastIn: s.lastIn || 0, lastRead: s.lastRead || null, img: s.img || null, lastImage: s.lastImage || null,
    usage: s.usage || null, jobsUntil: s.jobsUntil || 0, sc: s.sc || [], lastQA: s.lastQA || null, keeperFor: s.keeperFor || null, schedNext: s.schedNext ?? null,
    lastMedia: s.lastMedia || null, sowLast: s.sowLast || [], nlPending: s.nlPending || null,
    brain: s.brain || null, lastBrain: s.lastBrain || null, remPending: s.remPending || null, remPendingReasked: s.remPendingReasked || false, lastPolish: s.lastPolish || null, mh: s.mh || null };   // v8: per-key strong/lite counts for routing + last retrieval
}
export async function saveState(num, s, ctx = liveCtx()) {
  s.history = (s.history || []).slice(-MAX_TURNS * 2);
  s.seen = (s.seen || []).slice(-60);
  s.updated = new Date().toISOString();
  await writeJson(`${ctx.ns}/${num}.json`, s);
}
// knowledge base, kept apart from chat history: <ns>/<number>.knowledge.json
export async function loadKB(num, ctx = liveCtx()) {
  const k = (await readJson(`${ctx.ns}/${num}.knowledge.json`)) || {};
  return { facts: Array.isArray(k.facts) ? k.facts : [], settings: k.settings || {}, reminders: Array.isArray(k.reminders) ? k.reminders : [], missed: Array.isArray(k.missed) ? k.missed : [], remSeq: k.remSeq || 0 };
}
export async function saveKB(num, kb, ctx = liveCtx()) {
  kb.updated = new Date().toISOString();
  await writeJson(`${ctx.ns}/${num}.knowledge.json`, kb);
}

// ---------- formatting ----------
export function toWhatsApp(md) {
  let t = V96.tablesToLists(String(md || '').replace(/\r\n/g, '\n'));   // v9.6: no tables on WhatsApp
  const blocks = [];
  t = t.replace(/```[\s\S]*?```/g, m => { blocks.push(m.replace(/```[a-zA-Z0-9_+-]*\n/, '```\n')); return `\u0000B${blocks.length - 1}\u0000`; });
  const inl = [];
  t = t.replace(/`[^`\n]+`/g, m => { inl.push(m); return `\u0000I${inl.length - 1}\u0000`; });
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_, h) => `\u0001${h.replace(/\*\*|__/g, '')}\u0001`); // headings -> bold
  t = t.replace(/^([ \t]*)[*-][ \t]+/gm, '$1• ');                                                  // bullets
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '\u0001\u0002$1\u0002\u0001');                       // bold+italic
  t = t.replace(/\*\*(.+?)\*\*/g, '\u0001$1\u0001').replace(/__(.+?)__/g, '\u0001$1\u0001');  // bold
  // single *x* is left alone: on WhatsApp it is bold, which is what the prompt asks for
  t = t.replace(/~~(.+?)~~/g, '~$1~');
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, a, u) => a === u ? u : `${a} (${u})`);
  t = t.replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '');                                                  // horizontal rules
  t = t.replace(/\u0001\u0001/g, '').replace(/\u0001/g, '*').replace(/\u0002/g, '_');   // v8: only EMPTY bold goes (it used to glue a bold line to the next bold heading)
  t = t.replace(/\*{2,}/g, '*');                                                                    // v8: no stray ** ever reaches WhatsApp (code kept)
  t = t.replace(/\u0000I(\d+)\u0000/g, (_, i) => inl[i]).replace(/\u0000B(\d+)\u0000/g, (_, i) => blocks[i]);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
export function splitText(t, max = SPLIT_AT) {
  if (String(t || '').includes('```')) return V95.splitFenced(t, max);   // v9.5: never cut a code block in half
  const out = [];
  let rest = t;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// ---------- Graph API ----------
async function graph(path, body, ctx = liveCtx()) {
  if (ctx.test) {
    ctx.outbox.push(body);
    if (ctx.failNext && body.type === 'text') { const f = ctx.failNext; ctx.failNext = null; return { ok: false, status: 400, detail: f }; }
    return { ok: true, dry: true, id: 'wamid.TEST' + ctx.outbox.length };
  }
  if (DRY()) { log('DRY_RUN would POST', path, JSON.stringify(body).slice(0, 4000)); return { ok: true, dry: true }; }
  if (!process.env.WA_TOKEN || !process.env.WA_PHONE_ID) { log('cannot send: WA_TOKEN or WA_PHONE_ID is not set yet'); return { ok: false, missing: true }; }
  try {
    const r = await fetch(`${GRAPH()}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${process.env.WA_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let detail = '', id = null;
    if (!r.ok) { detail = (await r.text()).slice(0, 500); log('graph error', r.status, detail); }
    else { const j = await r.json().catch(() => ({})); id = j.messages?.[0]?.id || null; }
    return { ok: r.ok, status: r.status, detail, id };
  } catch (e) { log('graph fetch failed', e.message); return { ok: false, detail: e.message }; }
}
const phonePath = () => `${process.env.WA_PHONE_ID || 'PHONE_ID'}/messages`;
export async function sendText(to, text, ctx = liveCtx()) {
  let last = { ok: true };
  for (const part of splitText(text)) {
    last = await graph(phonePath(), { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: part, preview_url: false } }, ctx);
    if (!last.ok) break;
  }
  return last;
}
// v9: an approved template (people outside WhatsApp's 24h window); params fill {{1}}, {{2}}… in the body
export async function sendTemplate(to, name, lang, params, ctx = liveCtx()) {
  return graph(phonePath(), { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: { name, language: { code: lang }, components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) }] } }, ctx);
}
// v4: upload bytes to /PHONE_ID/media, then send an image message (caption up to 1024 chars)
export async function uploadMedia(bytes, mime, ctx = liveCtx(), filename = null) {
  if (ctx.test) { ctx.outbox.push({ type: 'media_upload', bytes: bytes.length, mime, filename, ...(ctx.keepImage ? { b64: bytes.toString('base64') } : {}) }); return { ok: true, id: 'TEST_MEDIA_ID' }; }
  if (DRY()) { log('DRY_RUN would upload media', mime, bytes.length); return { ok: true, id: 'DRY_MEDIA_ID' }; }
  try {
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', mime);
    fd.append('file', new Blob([bytes], { type: mime }), filename || (mime === 'image/png' ? 'image.png' : 'image.jpg'));
    const r = await fetch(`${GRAPH()}/${process.env.WA_PHONE_ID}/media`, { method: 'POST', headers: { authorization: `Bearer ${process.env.WA_TOKEN}` }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) { log('media upload failed', r.status, JSON.stringify(j).slice(0, 300)); return { ok: false, detail: j.error?.message || String(r.status) }; }
    return { ok: true, id: j.id };
  } catch (e) { log('media upload error', e.message); return { ok: false, detail: e.message }; }
}
export async function sendImage(to, mediaId, caption, ctx = liveCtx()) {
  return graph(phonePath(), { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'image', image: { id: mediaId, caption: String(caption || '').slice(0, 1024) } }, ctx);
}
// v7: a video or audio file (media jobs)
export async function sendMedia(to, mediaId, type, caption, ctx = liveCtx()) {
  const obj = type === 'audio' ? { id: mediaId } : { id: mediaId, caption: String(caption || '').slice(0, 1024) };
  return graph(phonePath(), { messaging_product: 'whatsapp', recipient_type: 'individual', to, type, [type]: obj }, ctx);
}
// v9.8: an image / video by Meta media id ({ id }) or public URL ({ link }), no caption (RPC drop: the caption follows as its own text)
export async function sendMediaRef(to, type, ref, ctx = liveCtx()) {
  return graph(phonePath(), { messaging_product: 'whatsapp', recipient_type: 'individual', to, type, [type]: ref.id ? { id: ref.id } : { link: ref.link } }, ctx);
}
export function rpcDeps(ctx, extra = {}) {
  return { loadState, sendText, sendTemplate, uploadMedia, sendMediaRef, owner: ALLOWED()[0], ...extra };
}
// v6: a file as a WhatsApp document (the zip of a site's source)
export async function sendDocument(to, mediaId, filename, caption, ctx = liveCtx()) {
  return graph(phonePath(), { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document', document: { id: mediaId, filename, caption: String(caption || '').slice(0, 1024) } }, ctx);
}
async function markReadTyping(messageId, ctx) {
  // read receipt + typing indicator (Cloud API; typing shows up to 25 s or until we reply)
  const r = await graph(phonePath(), { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }, ctx);
  if (!r.ok && !r.missing && !r.dry) await graph(phonePath(), { messaging_product: 'whatsapp', status: 'read', message_id: messageId }, ctx);
}
async function downloadMedia(id) {
  if ((DRY() || process.env.WA_MOCK_MEDIA_FILE) && process.env.WA_MOCK_MEDIA_FILE) {
    const fs = await import('node:fs');
    return { data: fs.readFileSync(process.env.WA_MOCK_MEDIA_FILE).toString('base64'), mime: process.env.WA_MOCK_MEDIA_MIME || 'application/octet-stream' };
  }
  if (!process.env.WA_TOKEN) throw new Error('WA_TOKEN missing');
  const h = { authorization: `Bearer ${process.env.WA_TOKEN}` };
  const meta = await fetch(`${GRAPH()}/${id}`, { headers: h }).then(r => r.json());
  if (!meta.url) throw new Error('no media url: ' + JSON.stringify(meta).slice(0, 200));
  if (meta.file_size && meta.file_size > 15 * 1024 * 1024) throw new Error('too big');
  const r = await fetch(meta.url, { headers: h });
  if (!r.ok) throw new Error('media download ' + r.status);
  return { data: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: (meta.mime_type || r.headers.get('content-type') || '').split(';')[0] };
}

// v5.1: download a document as raw bytes (GET /{media-id} for the url + size, then fetch it with the bearer token).
// Test ctx: msg.document._test_b64 / msg.image._test_b64 carries the bytes (only honoured with the test key), so no real media id is needed.
export async function downloadFile(media, ctx = liveCtx()) {
  if (ctx.test && media && media._test_b64) {
    const buf = Buffer.from(media._test_b64, 'base64');
    if (buf.length > F.MAX_DOWNLOAD) return { ok: false, tooBig: buf.length };
    return { ok: true, buf, mime: media.mime_type || 'application/octet-stream', size: buf.length };
  }
  if (process.env.WA_MOCK_MEDIA_FILE && (DRY() || ctx.test)) {
    const fs = await import('node:fs');
    const buf = fs.readFileSync(process.env.WA_MOCK_MEDIA_FILE);
    return { ok: true, buf, mime: process.env.WA_MOCK_MEDIA_MIME || media?.mime_type || 'application/octet-stream', size: buf.length };
  }
  if (!process.env.WA_TOKEN) return { ok: false, error: 'WA_TOKEN missing' };
  const h = { authorization: `Bearer ${process.env.WA_TOKEN}` };
  try {
    const meta = await fetch(`${GRAPH()}/${media.id}`, { headers: h, signal: AbortSignal.timeout(10000) }).then(r => r.json());
    if (!meta.url) return { ok: false, error: 'no media url: ' + JSON.stringify(meta).slice(0, 200) };
    const size = +meta.file_size || +media.file_size || 0;
    if (size > F.MAX_DOWNLOAD) return { ok: false, tooBig: size };
    const r = await fetch(meta.url, { headers: h, signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { ok: false, error: 'media download ' + r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > F.MAX_DOWNLOAD) return { ok: false, tooBig: buf.length };
    return { ok: true, buf, mime: (meta.mime_type || media.mime_type || r.headers.get('content-type') || '').split(';')[0], size: buf.length };
  } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? 'download timed out' : String(e.message || e) }; }
}

// ---------- prompt ----------
export function knowledgeBlock(facts) {
  // v3: up to KB_LIMIT chars (~60k chars ≈ 15k tokens; Gemini Flash/Flash-Lite take 1M). If it ever overflows,
  // keep the oldest facts (first quarter of the budget: who he is, standing rules) plus as many of the newest as fit.
  const lines = (facts || []).map(f => '- ' + String(f.t ?? f).replace(/\s+/g, ' ').trim().slice(0, MAX_FACT));
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  let kept = lines, omitted = 0;
  if (total > KB_LIMIT) {
    const head = []; let used = 0, i = 0;
    for (; i < lines.length && used + lines[i].length + 1 <= KB_LIMIT * KB_OLD_SHARE; i++) { head.push(lines[i]); used += lines[i].length + 1; }
    const tail = [];
    for (let j = lines.length - 1; j >= i && used + lines[j].length + 1 <= KB_LIMIT; j--) { tail.unshift(lines[j]); used += lines[j].length + 1; }
    omitted = lines.length - head.length - tail.length;
    kept = [...head, ...(omitted ? [`- (${omitted} older taught facts left out here to save space; newer facts win)`] : []), ...tail];
  }
  return '\n\n# WHAT MICHAEL HAS TAUGHT YOU (saved with "teach:"; true facts and standing instructions; newer than the base profile; later facts override earlier ones; "I/my" = Michael)\n'
    + (kept.length ? kept.join('\n') : '(nothing taught yet)') + '\n';
}
// v5: lean prompt for everyday chat: drops the long voice-pack examples (kept for writing his posts) and sends only the
// relevant taught facts once there are many. Full prompt (no opts) is used for drafts, the nudge and media.
const VOICE_START = SYSTEM.indexOf('# VOICE PACK');
const ABIL_START = SYSTEM.indexOf('# ABILITIES');
const LEAN_SYSTEM = VOICE_START > 0 && ABIL_START > VOICE_START
  ? SYSTEM.slice(0, VOICE_START) + '# VOICE PACK\n(Left out of this chat turn to save space. If he asks you to write public content as him, write warmly in first person, faith-first, short lines, and suggest "post: <topic>" for a full draft in his voice.)\n\n' + SYSTEM.slice(ABIL_START)
  : SYSTEM;
export function systemText(facts, opts = {}) {
  const voice = V.needsVoice(opts.query);
  const lean = opts.lean && !voice;
  let kbFacts = facts, omitted = 0;
  // v9.3: with a question, send the most relevant taught facts (topic + keywords + pinned + newest), not all/oldest-first
  const learned = (facts || []).filter(f => f && f.ltm);       // v9.7: learned-from-chat facts get their own block (not competing with taught ones)
  if (learned.length) kbFacts = (facts || []).filter(f => !(f && f.ltm));
  if (opts.query) ({ facts: kbFacts, omitted } = V93.pickFacts(kbFacts, opts.query, lean ? V93.LEAN_BUDGET : V93.FULL_BUDGET, { voice }));
  const now = new Date();
  const day = now.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
  return (lean ? LEAN_SYSTEM : SYSTEM) + WA_RULES + PA_RULES + V9.ethicBlock() + V93.SKILLS_RULES + V95.SKILLS_V95 + V96.SKILLS_V96 + `\n\n# NOW\nToday is ${day}, ${time} in Nigeria (Africa/Lagos).\n`
    + '\n\n# BASE PROFILE (seeded facts about Michael; a taught fact wins if they conflict)\n' + PROFILE + knowledgeBlock(kbFacts)
    + (omitted ? `- (${omitted} other taught facts not shown here because they don't look related to this message)\n` : '') + V97.ltmBlock(learned);
}
function historyContents(history) {
  const out = [];
  for (const m of history || []) {
    const role = m.role === 'user' ? 'user' : 'model';
    if (!m.text) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += '\n\n' + m.text;
    else out.push({ role, parts: [{ text: m.text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.length && out[out.length - 1].role === 'user') out.pop(); // the new turn is appended separately
  return out;
}

// ---------- Gemini (quota-aware fallback) ----------
// Free keys get ~20 requests/day on full Flash. A daily 429 parks that model until Google's reset
// (midnight Pacific); a per-minute 429 parks it for a minute. Parked models are skipped, so a used-up
// Flash costs no time, and the Lite models answer instead. Every path ends in a reply to Michael.
export function nextPacificMidnight(now = Date.now()) {
  const d = new Date(now);
  const pt = new Date(d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const offset = d.getTime() - pt.getTime();            // UTC - PT wall clock
  const mid = new Date(pt); mid.setHours(24, 0, 0, 0);
  return mid.getTime() + offset;
}
export function coolUntil(errText, now = Date.now()) {
  if (/PerDay|per day|daily/i.test(errText || '')) return nextPacificMidnight(now);
  if (/PerMinute|per minute/i.test(errText || '')) return now + 65000;
  return now + 10 * 60e3;                                    // v5: 429 with no detail (free tier often says nothing): rest 10 min
}
export async function askGemini(history, facts, userParts, started, opts = {}) {
  const cool = opts.cool || {};
  const chain = opts.chain || CHAIN;
  const track = opts.track || null;                            // v5: the chat state, for per-model usage counts
  const contents = [...historyContents(history), { role: 'user', parts: userParts }];
  const sys0 = (opts.system || systemText(facts, { lean: !!opts.lean, query: opts.query }) + R8.ACTION_RULES) + (opts.extra || '');
  const sysFor = model => sys0 + (opts.deep && !BR.isStrong(model) ? BR.DEEP_RULES : '');   // v8: Lite answering a hard question thinks step by step
  let lastStatus = 0, quota = false;
  const tried = [];
  const now = Date.now();
  let order = chain.filter(m => !(cool[m] > now));
  if (!order.length) order = [...V.GEMMA, ...chain.slice(-2)];  // everything parked: still try the big-quota models
  if (track && !opts.media) order = V97.rankChain(order, track.mh);   // v9.7: models that keep failing today go to the back
  let weak = null;                                             // v9.7: a weak answer is kept only as a last resort
  const weakOf = (text, finish) => opts.quality == null ? null : V97.weakReply(text, { question: opts.quality, finish });
  let first = true, fastFail = false;
  for (const model of order) {
    const spent = Date.now() - started;
    if (spent > 44000) break;
    const t0m = Date.now();                                    // v9.6: a fast refusal (pro 429 'limit: 0', a 404) keeps the long first-model budget
    if (!first && fastFail) first = true;
    fastFail = false;
    if (PV.isProvider(model)) {                              // v8: OpenAI-compatible providers (text only)
      if (opts.media || userParts.some(p => p.inline_data)) continue;
      const budget = Math.max(3000, Math.min(first ? (opts.firstMs || 25000) : 15000, 52000 - (Date.now() - started)));
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), budget);
      let pr;
      try { pr = await PV.chat(model, sysFor(model), contents, { maxTokens: opts.maxTokens || 2048, temperature: opts.temperature ?? 0.7, signal: ctl.signal, ...(/:heavy$/.test(model) ? { sysMax: 40000 } : {}) }); }
      catch (e) { clearTimeout(timer); cool[model] = Date.now() + 3 * 60e3; tried.push(model + ':timeout'); if (track) V97.noteHealth(track, model, false); first = false; continue; }
      clearTimeout(timer);
      if (pr.ok) {
        const why = weakOf(pr.text, pr.finish || '');
        if (why && Date.now() - started < 40000) { if (track) V97.noteHealth(track, model, false); tried.push(model + ':weak-' + why); if (!weak) weak = { ok: true, text: pr.text, model, provider_model: pr.model, weak: why }; first = false; continue; }
        if (track) { V.bumpModel(track, model); BR.noteCall(track, model, null); V97.noteHealth(track, model, true); } tried.push(model + ':ok'); return { ok: true, text: pr.text, model, provider_model: pr.model, cool, tried };
      }
      if (track) { BR.noteCall(track, model, null, false); if (pr.status === 429 || pr.status === 'empty' || pr.status >= 500) V97.noteHealth(track, model, false); }
      if (pr.status === 429) { quota = true; cool[model] = coolUntil(pr.errText); }
      else if (pr.status !== 415) cool[model] = Date.now() + (pr.status === 401 || pr.status === 403 ? 6 * 3600e3 : 5 * 60e3);
      lastStatus = pr.status; tried.push(model + ':' + pr.status); fastFail = Date.now() - t0m < 2500; first = false; continue;
    }
    const gemma = V.isGemma(model);
    for (const thinking of [true, false]) {
      const body = { systemInstruction: { parts: [{ text: sysFor(model) }] }, contents, generationConfig: { temperature: opts.temperature ?? 0.8, maxOutputTokens: opts.maxTokens || 4096 } };   // v9.5: code asks run cooler
      if (thinking) body.generationConfig.thinkingConfig = { thinkingLevel: gemma ? 'minimal' : (opts.thinking || (opts.deep && !BR.isStrong(model) ? 'medium' : 'low')) };   // v9.5: code asks think harder
      // v5: short per-model timeouts so a busy (503) or slow model can't eat the whole reply budget
      const budget = Math.max(3000, Math.min(first ? (opts.firstMs || 25000) : 15000, 52000 - (Date.now() - started)));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), budget);
      let r;
      try {
        r = await G.gemFetch(model, body, { signal: ctl.signal, src: opts.src || 'chat', retry: first ? 1 : 0, retryWaitMs: 900, deadline: started + 44000 });   // v7: key 2 on 429, one retry on 503
      } catch (e) { lastStatus = 504; clearTimeout(timer); cool[model] = Date.now() + 3 * 60e3; tried.push(model + ':timeout'); if (track) V97.noteHealth(track, model, false); break; }
      clearTimeout(timer);
      if (track) BR.note429s(track, model, r.headers.get('x-gem-429'));   // v8: per-key limit hits (brain + strong budget)
      if (r.ok) {
        const j = await r.json();
        const cand = j.candidates?.[0] || {};
        const text = (cand.content?.parts || []).filter(p => !p.thought && p.text).map(p => p.text).join('').trim();
        const why = text ? weakOf(text, cand.finishReason || '') : null;
        if (text && why && Date.now() - started < 40000) {         // v9.7: weak / busy / cut-off answer -> next model (kept as a last resort)
          if (track) V97.noteHealth(track, model, false);
          tried.push(model + ':weak-' + why); if (!weak) weak = { ok: true, text, model, key: +(r.headers.get('x-gem-key') || 1), weak: why }; break;
        }
        if (text) { if (track) { V.bumpModel(track, model); BR.noteCall(track, model, r.headers.get('x-gem-key')); V97.noteHealth(track, model, true); } tried.push(model + ':ok'); return { ok: true, text, model, key: +(r.headers.get('x-gem-key') || 1), cool, tried }; }
        if (track) V97.noteHealth(track, model, false);
        lastStatus = 'empty:' + (cand.finishReason || j.promptFeedback?.blockReason || '?');
        tried.push(model + ':' + lastStatus);
        break;
      }
      lastStatus = r.status;
      const errText = await r.text().catch(() => '');
      if (track && (r.status === 429 || r.status >= 500)) V97.noteHealth(track, model, false);
      if (r.status === 429) {
        quota = true; cool[model] = coolUntil(errText); if (track) V.noteLimit(track, model);
        log('429 on', model, 'parked until', new Date(cool[model]).toISOString()); tried.push(model + ':429'); break;
      }
      if (r.status === 400 && thinking) continue;          // retry this model without the thinking option
      if (r.status === 400 && opts.media && !gemma) return { ok: false, status: 400, detail: errText.slice(0, 300), cool, tried };
      if (r.status === 503) cool[model] = Date.now() + 5 * 60e3;          // "high demand": rest it 5 minutes
      else if (r.status >= 500) cool[model] = Date.now() + 2 * 60e3;
      else if (r.status === 404) cool[model] = nextPacificMidnight();      // model gone for this key
      tried.push(model + ':' + r.status);
      break;                                                 // 400 / 404 / 5xx -> next model
    }
    fastFail = Date.now() - t0m < 2500;
    first = false;
  }
  if (weak) { if (track) V.bumpModel(track, weak.model); return { ...weak, cool, tried }; }   // v9.7: every other model failed: the weak answer beats an error line
  return { ok: false, status: lastStatus, quota, cool, tried };
}

// ---------- commands ----------
export const HELP = [
  '*Michael AI* 🤖 text, voice, picture, video or file',
  '🧠 teach: <fact> · /knowledge · /unteach 3 · /profile · /new',
  '🧠 brain · learn <text or link> · learned · unlearn <n>',
  '⏰ remind me at 5pm to … · reminders',
  '📣 outreach · contacts · autoreply · goals',
  '🌍 search: <q> · read: <link> · research <topic> (report + PDF)',
  '📄 *Files*: send PDF/Word/Excel · *full text*',
  '🎨 image: <your idea>',
  '🎬 *Video*: send it + trim 0:05-0:20 · compress · caption <text> · extract audio · picture + voice note → make video',
  '',
  '🛠️ *Build & Agent mode*',
  '• build me a bakery site with an order form',
  '• my sites · edit <site> <change> · zip <site> · apk',
  '• orders <site> · data <site> · export <site>',
  '• agent: <task> · jobs · cancel 12',
  '🐙 repos · repo <name> <change>',
  '🌱 post <text> · schedule tomorrow 7am <text> · unpost',
  '🌱 sow · sow week · sow tomorrow · posted facebook · add a post for Fri 7pm about …',
  '📘 FB Page draft: post: <topic>',
  '📬 *Newsletter*: letters · skip · unskip · subs · newsletter <text>',
  '📖 *verse* (today\'s verse from Sow, ready to forward) · sent daily at 6am',
  '',
  'usage · quota · /nudge on|off · /help',
].join('\n');

export function addFact(kb, text) {
  const fact = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["“']|["”']$/g, '').slice(0, MAX_FACT);
  if (fact.length < 2) return null;
  kb.facts.push({ t: fact, at: new Date().toISOString() });
  return fact;
}
const TEACH_RE = /^\s*(?:\/teach\b\s*[:：\-–]?|teach\s*[:：\-–]|teach\s+that\b|(?:please\s+)?remember\s+that\b|remember\s*[:：])\s*([\s\S]*)$/i;
// v3 multi-teach: a message with 2+ lines starting with "teach:" saves each item as its own fact.
// An item runs from its "teach:" line to the next "teach:" line or a blank line; other lines
// (pack headers, labels like [1.01], separators) are ignored.
const MULTI_LINE_RE = /^\s*(?:[-•*_]\s*)?[*_]?\/?teach[*_]?\s*[:：][*_]?\s?(.*)$/i;
export function splitTeach(text) {
  const items = []; let cur = null, skipped = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(MULTI_LINE_RE);
    if (m) { cur = [m[1]]; items.push(cur); continue; }
    if (!raw.trim()) { cur = null; continue; }
    if (cur) cur.push(raw); else if (items.length) skipped++;
  }
  return { items: items.map(a => a.join(' ').trim()), skipped };
}
export function multiTeach(text, kb) {
  const { items, skipped } = splitTeach(text);
  if (items.length < 2) return null;
  const known = new Set(kb.facts.map(f => String(f.t ?? f).toLowerCase()));
  let saved = 0, dup = 0, empty = 0, cut = 0;
  for (const it of items.slice(0, MAX_MULTI)) {
    const clean = it.replace(/\s+/g, ' ').trim().replace(/^["“']|["”']$/g, '');
    if (clean.length < 2) { empty++; continue; }
    if (known.has(clean.slice(0, MAX_FACT).toLowerCase())) { dup++; continue; }
    const fact = addFact(kb, clean);
    if (!fact) { empty++; continue; }
    if (clean.length > MAX_FACT) cut++;
    known.add(fact.toLowerCase()); saved++;
  }
  const notes = [];
  if (dup) notes.push(`${dup} already known, skipped`);
  if (cut) notes.push(`${cut} cut to ${MAX_FACT} characters`);
  if (empty) notes.push(`${empty} empty, skipped`);
  if (items.length > MAX_MULTI) notes.push(`only the first ${MAX_MULTI} read; send the rest in another message`);
  if (skipped) notes.push(`${skipped} line${skipped === 1 ? '' : 's'} not starting with teach: ignored`);
  const head = saved ? `✅ Saved ${saved} fact${saved === 1 ? '' : 's'}` : 'Nothing new to save';
  return { reply: head + (notes.length ? ` (${notes.join('; ')})` : '') + '\nSend /knowledge to see everything I know.', saveKB: saved > 0 };
}
export function command(text, state, kb) {
  const t = String(text || '').trim();
  const low = t.toLowerCase().replace(/\s+/g, ' ');
  const multi = multiTeach(t, kb);
  if (multi) return multi;
  const tm = t.match(TEACH_RE);
  if (tm) {
    const fact = addFact(kb, tm[1]);
    if (!fact) return { reply: 'Tell me what to remember after the colon, e.g.\n_teach: my ebook price is ₦2,000_' };
    return { reply: `Got it ✅ I'll remember: _${fact}_`, saveKB: true };
  }
  if (low === 'teach' || low === '/teach') return { reply: 'Send *teach:* and the fact, e.g.\n_teach: my ebook price is ₦2,000_' };
  const kv93 = low.match(/^\/?(?:knowledge|facts)\s+(all|about|prefs|goals|voice|growth|copy|author|faith|tech|projects|other)$/);   // v9.3
  if (kv93 && kb.facts.length) return { reply: V93.knowledgeView(kb.facts, kv93[1], { max: 60000 }) };
  if (['/knowledge', 'knowledge', '/memory', 'memory', '/facts'].includes(low)) {
    const head = `📌 *Base profile* (built in, can't be deleted): who you are, your apps, channels, priorities and to-dos. Send /profile to read it.`;
    if (!kb.facts.length) return { reply: `${head}\n\n🧠 *Taught facts*: none yet. Try:\n_teach: my ebook price is ₦2,000_` };
    const autoN = kb.facts.filter(f => f.auto).length;      // v8: 📝 = picked up automatically from our chats
    if (kb.facts.length > 25) return { reply: `${head}\n\n` + V93.knowledgeView(kb.facts) + '\n\nSend *knowledge all* for the full list, or *knowledge <topic>* (e.g. knowledge faith). Remove one with /unteach and its number.' };   // v9.3
    return { reply: `${head}\n\n🧠 *What you've taught me*\n` + kb.facts.map((f, i) => `${i + 1}. ${f.auto ? '📝 ' : ''}${f.t}`).join('\n') + '\n\nRemove one with /unteach and its number.' + (autoN ? `\n_📝 = picked up from our chats by itself (${autoN})._` : '') };
  }
  const un = low.match(/^\/(?:unteach|forget)\s*#?(\d+)$/);
  if (un) {
    const n = Number(un[1]);
    if (n === 0) return { reply: "The base profile can't be removed. To change something in it, just teach me the update and I'll go with the newer fact." };
    if (n < 1 || n > kb.facts.length) return { reply: kb.facts.length ? `There's no fact number ${n}. Send /knowledge to see the list (1 to ${kb.facts.length}).` : 'You haven\'t taught me any facts yet, so there\'s nothing to remove.' };
    const [gone] = kb.facts.splice(n - 1, 1);
    return { reply: `🗑️ Removed: _${gone.t}_`, saveKB: true };
  }
  if (/^\/(unteach|forget)\b/.test(low)) {
    if (/profile|base/.test(low)) return { reply: "The base profile can't be removed. Teach me the update instead and the newer fact wins." };
    return { reply: 'Send /unteach with a number, e.g. /unteach 2. Send /knowledge to see the numbers.' };
  }
  if (low === '/profile' || low === 'profile') return { reply: PROFILE.trim() + '\n\n_This base profile is built in. To update anything, just teach me: teach: <new fact>_' };
  if (low === '/new' || low === '/reset' || low === '/clear') {
    state.history = []; state.lastRead = null;
    return { reply: '🆕 Fresh chat started. (Everything you taught me is still here.)', saveState: true };
  }
  const nd = low.match(/^\/nudge\s*(on|off)?$/);
  if (nd) {
    if (nd[1]) { kb.settings.nudge = nd[1] === 'on'; return { reply: nd[1] === 'on' ? '🌅 Morning nudge is *on* (about 7am Lagos time).' : '🔕 Morning nudge is *off*. Send /nudge on to bring it back.', saveKB: true }; }
    return { reply: `Morning nudge is *${kb.settings.nudge === false ? 'off' : 'on'}*. Send /nudge on or /nudge off.` };
  }
  if (['/help', '/start', 'help', '/commands'].includes(low)) return { reply: HELP };
  // v5: reminders list / cancel, usage
  if (V.LIST_RE.test(t)) return { reply: V.listText(kb) };
  const cr = t.match(V.CANCEL_REM_RE);
  if (cr) {
    const n = +(cr[1] || cr[2]);
    const gone = V.cancelReminder(kb, n);
    if (!gone) return { reply: V.active(kb).length ? `There's no reminder number ${n}. Send *reminders* to see the list.` : 'You have no reminders set.' };
    return { reply: `🗑️ Cancelled: _${gone.text}_ (${gone.rep ? V.fmtRepeat(gone.rep) : V.fmtWhen(gone.due)})`, saveKB: true };
  }
  if (V.CANCEL_ALL_RE.test(t)) {
    const a = V.active(kb);
    a.forEach(r => { r.status = 'cancelled'; });
    return { reply: a.length ? `🗑️ Cancelled all ${a.length} reminder${a.length === 1 ? '' : 's'}.` : 'You have no reminders set.', saveKB: a.length > 0 };
  }
  if (/^\s*\/?(?:usage|quota|limits?|my usage|today'?s usage)\s*[?.!]*\s*$/i.test(t)) {
    const q = imageQuota(state);
    return { reply: V.usageText(state, { imgUsed: q.used, imgLimit: q.limit, active: V.active(kb).length }) };
  }
  return null;
}

// ---------- v5: reminders delivery (shared by the webhook and the scheduler endpoint) ----------
const remText = (r, now) => `⏰ *Reminder:* ${r.text}` + (now - r.due > 15 * 60e3 ? `\n_(was due ${V.fmtWhen(r.due, now)})_` : '')
  + (r.rep ? `\n_${V.fmtRepeat(r.rep)} · send *reminders* to manage_` : '');
export async function deliverDue(owner, state, kb, ctx, now = Date.now(), { windowOpen = null, keeper = true } = {}) {
  let changed = false, keeperSent = false;
  const sent = [], missed = [];
  const open = windowOpen ?? Boolean(state.lastIn && now - state.lastIn < V.WINDOW_MS - 60e3);
  for (const r of V.active(kb)) {
    if (r.due > now + 30e3) break;                          // sorted by due; 30 s early is fine
    changed = true;
    const due = r.origDue || r.due;
    let ok = false, why = null;
    if (!open) why = 'window';
    else {
      const res = await sendText(owner, remText({ ...r, due }, now), ctx);
      if (res.ok) { ok = true; r.waId = res.id || null; r.sentAt = now; V.bump(state, 'remind'); sent.push(r.id); }
      else why = /131047|re-?engagement|24 hours|outside.*window/i.test(String(res.detail || '')) ? 'window' : 'error';
    }
    if (!ok && why === 'error' && (r.tries = (r.tries || 0) + 1) < 3) { r.origDue = due; r.due = now + 5 * 60e3; continue; }  // retry in 5 min
    if (!ok) { V.recordMissed(kb, { ...r, due }, why, now); missed.push(r.id); }
    r.lastDue = due; r.firedAt = now; delete r.tries; delete r.origDue;
    if (r.rep) r.due = V.nextOccurrence(r.rep, Math.max(now, due));
    else r.status = ok ? 'done' : 'missed';
  }
  if (keeper && state.lastIn) {
    const kt = V.keeperTime(kb, state.lastIn, state.keeperFor);
    if (kt && now >= kt - 30e3) {
      if (now < state.lastIn + V.WINDOW_MS - 60e3) { const res = await sendText(owner, V.keeperText(kb, state.lastIn, now), ctx); keeperSent = res.ok; }
      state.keeperFor = state.lastIn; changed = true;
    }
  }
  return { changed, sent, missed, keeper: keeperSent, window_open: open };
}
async function syncSched(state, kb, ctx, { force = false } = {}) {
  let t = V.nextWake(kb, state.lastIn, state.keeperFor) || null;
  if (kvOn() && process.env.V9_GATE !== '0') { try { const t9 = await V9.nextDue(ctx.ns); if (t9 && (!t || t9 < t)) t = t9; } catch (e) { log('v9 next due failed', e.message); } }   // v9: outreach / digest / Monday nudge share the gate
  if ((kvOn() || ctx.test) && RPC.rpcOn()) { try { const tr = await RPC.nextDue(ctx.ns, state.lastIn, Date.now(), { reminderKeeperFor: state.keeperFor }); if (tr && (!t || tr < t)) t = tr; } catch (e) { log('rpc next due failed', e.message); } }   // v9.8: RPC drop 07:00 UTC + held day + heads-up share the gate
  if (!force && t === (state.schedNext ?? null)) return;
  const r = await V.setNextWake(ctx.test ? 'test' : 'live', t);
  if (r.ok) state.schedNext = t; else if (!r.off) log('scheduler sync failed', r.status || r.detail);
  if (ctx.test) ctx.sched = { name: 'test', next: t, ok: r.ok, off: !!r.off };
}
// the scheduler endpoint: deliver what's due, send the 24h-window heads-up if needed, re-arm the gate
export async function runReminders(ctx = liveCtx(), { now = Date.now() } = {}) {
  const owner = ALLOWED()[0];
  if (!owner) return { skipped: 'no_owner' };
  const [state, kb] = await Promise.all([loadState(owner, ctx), loadKB(owner, ctx)]);
  const r = await deliverDue(owner, state, kb, ctx, now);
  if (kvOn() || ctx.test) { try { r.v9 = await V9.tick(ctx.ns, owner, v9Deps(ctx, kb.facts || []), { now }); } catch (e) { log('v9 tick failed', e.message); r.v9 = { error: e.message }; } }   // v9: daily outreach drafts, Monday growth, 8pm digest
  if ((kvOn() || ctx.test) && RPC.rpcOn()) { try { r.rpc = await RPC.run(ctx, rpcDeps(ctx, { now, reminderKeeperFor: state.keeperFor })); } catch (e) { log('rpc run failed', e.message); r.rpc = { error: e.message }; } }   // v9.8: Royal People Care daily drop (08:00 Lagos)
  const before = state.schedNext ?? null;
  await syncSched(state, kb, ctx, { force: true });
  if (r.changed || (state.schedNext ?? null) !== before) await Promise.all([saveState(owner, state, ctx), r.changed ? saveKB(owner, kb, ctx) : null]);
  return { ...r, next: state.schedNext ? new Date(state.schedNext).toISOString() : null };
}
// Meta reports a failed send later (status webhook), e.g. 131047 when the 24h window had closed
export async function onFailedStatus(st, ctx = liveCtx()) {
  const owner = ALLOWED()[0];
  try {                                                      // v7.2: keep the last 20 failed statuses (verse pushes, previews…) for diagnosis
    const f = (await readJson(`${ctx.ns}/failed-status.json`)) || [];
    await writeJson(`${ctx.ns}/failed-status.json`, [...f, { id: st.id, code: st.errors?.[0]?.code || null, title: String(st.errors?.[0]?.title || '').slice(0, 120), at: new Date().toISOString() }].slice(-20));
  } catch {}
  try { const o = await V9.onStatusFail(st, ctx, v9Deps(ctx)); if (o) return o; } catch (e) { log('v9 status check failed', e.message); }   // v9: an outreach message that failed later
  const kb = await loadKB(owner, ctx);
  const r = (kb.reminders || []).find(x => x.waId && x.waId === st.id);
  if (!r) return { ignored: 'not_a_reminder' };
  const code = st.errors?.[0]?.code;
  if ((kb.missed || []).some(x => x.waId === st.id)) return { ignored: 'already_noted' };
  kb.missed = [...(kb.missed || []), { id: r.id, text: r.text, due: r.lastDue || r.due, why: code === 131047 ? 'window' : `error ${code || ''}`.trim(), at: Date.now(), waId: st.id }].slice(-20);
  if (!r.rep) r.status = 'missed';
  await saveKB(owner, kb, ctx);
  return { missed: r.id, code };
}


// ---------- Facebook Page posting (draft -> explicit "yes" -> publish) ----------
// Env: FB_PAGE_ID, FB_PAGE_TOKEN (a Page access token). Never posts without an explicit yes.
export const POST_RE = /^\s*\/?post\s*[:：\-–]\s*([\s\S]*)$/i;
export const YES_RE = /^\s*(yes|yes+|yes,? post( it)?|yes please|post it|post it now|go ahead|yep|yeah|ok,? post( it)?|okay,? post( it)?|publish( it)?|send it)\s*[.!👍✅🙏]*\s*$/i;
export const CANCEL_RE = /^\s*(cancel|no|nope|discard|drop it|don'?t post( it)?|stop|delete (the )?draft)\s*[.!]*\s*$/i;
const NOT_CONNECTED = 'Page not connected yet; Tab will set it up. Your draft is saved, so reply *yes* once it\'s connected.';
const fbConfigured = () => Boolean(process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN);
const DRAFT_TAIL = '\n\nReply *yes* to post, or tell me what to change (or *cancel*).';
export function cleanPost(t) {
  return String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*["“]|["”]\s*$/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
function draftPrompt(brief) {
  return `Write a Facebook post for Michael's Facebook page, AS Michael (first person, his public voice from the VOICE PACK: his rhythm, faith framing, sign-offs; pick the fitting content pillar).
Brief from Michael: """${brief || '(no text: use the picture)'}"""
If the brief is already a finished post, polish it lightly and keep his words. Reply with ONLY the post text, ready to publish: no title, no quote marks, no notes, no options, no markdown (Facebook shows asterisks literally). At most 2 hashtags.`;
}
async function fbPublish(p, ctx) {
  if (ctx.test) {
    if (!fbConfigured() && !ctx.fbMock) return { ok: false, notConnected: true };
    ctx.outbox.push({ type: 'fb_' + (p.imageId ? 'photo' : 'feed'), message: p.text });
    return { ok: true, id: 'TESTPAGE_TESTPOST', link: 'https://www.facebook.com/TESTPAGE_TESTPOST', mock: true };
  }
  if (!fbConfigured()) return { ok: false, notConnected: true };
  const page = process.env.FB_PAGE_ID, tok = process.env.FB_PAGE_TOKEN;
  try {
    let r;
    if (p.imageId) {
      const m = await downloadMedia(p.imageId);
      const fd = new FormData();
      fd.append('source', new Blob([Buffer.from(m.data, 'base64')], { type: m.mime || 'image/jpeg' }), 'photo.jpg');
      fd.append('caption', p.text);
      fd.append('access_token', tok);
      r = await fetch(`${GRAPH()}/${page}/photos`, { method: 'POST', body: fd });
    } else {
      r = await fetch(`${GRAPH()}/${page}/feed`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ message: p.text, access_token: tok }) });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { log('fb post error', r.status, JSON.stringify(j).slice(0, 400)); return { ok: false, detail: j.error?.message || `HTTP ${r.status}` }; }
    const id = j.post_id || j.id;
    return { ok: true, id, link: `https://www.facebook.com/${id}` };
  } catch (e) { log('fb post failed', e.message); return { ok: false, detail: e.message }; }
}

// ---------- one incoming message ----------
const VOICE_NOTE = '(Michael sent this voice note. RULE: if he starts by saying the word "teach" (he is teaching you a fact to save), reply with ONLY one line, exactly: TEACH: <the fact in clean written words, keeping "I/my" for Michael>. RULE 2: if he is asking for a reminder, reply with ONLY one line, exactly: REMIND: <his request in clean written words, starting "remind me", keeping every time and day he said, e.g. REMIND: remind me at 7pm, 8pm and 9pm to message Mr John>. Never say you set a reminder yourself. Otherwise start with the 🎙️ transcript line, then answer him.)';
export function voiceTeach(modelText) {
  for (const line of String(modelText || '').split('\n')) {
    const m = line.match(/^\s*[*_]*\s*TEACH\s*[*_]*\s*:\s*[*_]*\s*(.+?)\s*[*_]*\s*$/i);
    if (m) return m[1];
  }
  return null;
}
async function strangerNotice(from, msgId, ctx) {
  const key = `${ctx.ns}/others/${from}.json`;
  const rec = (await readJson(key)) || {};
  if (rec.at && Date.now() - Date.parse(rec.at) < 24 * 3600e3) { log('private line already sent to this number in the last 24h'); return { ignored: 'not_allowed_quiet' }; }
  const r = await sendText(from, PRIVATE_LINE, ctx);            // Meta may refuse (test number); that's fine
  await writeJson(key, { at: new Date().toISOString(), lastMsg: msgId });
  return { reply: PRIVATE_LINE, ignored: 'not_allowed', sent: r.ok };
}

// v9: what the outreach / auto-reply / growth module needs from here
export function v9Deps(ctx, kbFacts = null) {
  const owner = ALLOWED()[0];
  const ownerOpen = async () => { const st = await loadState(owner, ctx); return Boolean(st.lastIn && Date.now() - st.lastIn < V.WINDOW_MS - 60e3); };
  const factsP = kbFacts ? Promise.resolve(kbFacts) : loadKB(owner, ctx).then(k => k.facts || []).catch(() => []);
  return {
    test: !!ctx.test, ctx, owner, sendTemplate, _facts: kbFacts || [], fmt: toWhatsApp, profile: PROFILE,
    sendText: (to, text, c = ctx) => sendText(to, text, c),
    ask: async (prompt, system, maxTokens = 1000) => askGemini([], await factsP, [{ text: prompt }], Date.now(), { cool: {}, chain: CHAIN, maxTokens, ...(system ? { system } : {}), src: 'v9' }),
    askContact: async (hist, text, system) => askGemini(hist, [], [{ text }], Date.now(), { cool: {}, chain: LITE_FIRST, maxTokens: 2048, system, src: 'v9-contact' }),
    ownerOpen,
    toOwner: async (text) => { if (await ownerOpen()) { const r = await sendText(owner, text, ctx); if (r.ok) return 'sent'; } await V9.queueOwner(ctx.ns, text); return 'queued'; },
    get facts() { return this._facts || []; },
  };
}

export async function processMessage(msg, contactName, ctx = liveCtx()) {
  const started = Date.now();
  const from = String(msg.from || '').replace(/\D/g, '');
  if (seenHere.has(ctx.ns + msg.id)) { log('duplicate (memory)', msg.id); return { ignored: 'duplicate' }; }
  seenHere.add(ctx.ns + msg.id);
  if (!ALLOWED().includes(from)) {                         // v9: other people -> contact list + selective auto-reply (+ owner notice)
    if (!kvOn() && !ctx.test) { log('message from a number not on WA_ALLOWED'); return strangerNotice(from, msg.id, ctx); }
    const D = v9Deps(ctx);
    D._facts = await loadKB(ALLOWED()[0], ctx).then(k => k.facts || []).catch(() => []);
    return V9.onContactMessage(msg, contactName, ctx, D);
  }
  if (!ctx.test && !DRY() && (!process.env.WA_TOKEN || !process.env.WA_PHONE_ID)) {
    log('WA_TOKEN / WA_PHONE_ID not set yet: message received but no reply can be sent'); return { ignored: 'no_token' };
  }
  const [state, kb] = await Promise.all([loadState(from, ctx), loadKB(from, ctx)]);
  if (state.seen.includes(msg.id)) { log('duplicate (store)', msg.id); return { ignored: 'duplicate' }; }
  state.seen.push(msg.id);
  let kbDirty = false;
  if (!state.migrated) {                                     // v1 "remember that" memories move into the knowledge base once
    for (const m of state.memory || []) { addFact(kb, m); kbDirty = true; }
    state.memory = []; state.migrated = true;
  }
  await markReadTyping(msg.id, ctx);
  const now = () => Date.now();
  if (state.remPending && V97.dropPending(state.remPending, msg.type === 'text' ? String(msg.text?.body || '') : null)) {   // v9.7: 5 min, and a reply with no time cancels it
    log('reminder question dropped (expired or answered with something else)'); state.remPending = null; state.remPendingReasked = false;
  }
  // v5: tell him what he missed while WhatsApp's 24h window was shut, then deliver anything due (he just wrote, so it's open)
  const notice = V.missedNotice(kb);
  if (notice) { kbDirty = true; await sendText(from, notice, ctx); }
  const dd = await deliverDue(from, state, kb, ctx, Date.now(), { windowOpen: true, keeper: false });
  const D9 = v9Deps(ctx, kb.facts || []);
  if (from === ALLOWED()[0]) { try { await V9.flushQueue(ctx.ns, D9); } catch (e) { log('v9 queue flush failed', e.message); } }   // v9: drafts/digests that waited for his window
  // v9.1: a newsletter preview that waited for his window (shut at 20:00 Lagos) goes out now; not when he's answering it with skip/unskip
  if (from === ALLOWED()[0] && J.jobsOn()) {
    const tb = msg.type === 'text' ? String(msg.text?.body || '') : '';
    if (!(NL.SKIP_RE.test(tb) || NL.UNSKIP_RE.test(tb))) { try { const fp = await NL.flushPreview(ctx, { sendText, owner: from }); if (fp) { log('nl preview flush', JSON.stringify(fp)); if (ctx.test) ctx.nlFlush = fp; } } catch (e) { log('nl preview flush failed', e.message); } }
  }
  // v9.2: Sow pings that waited for his window go out now as one summary (not when he's switching pings off)
  if (from === ALLOWED()[0] && J.jobsOn()) {
    const tb = msg.type === 'text' ? String(msg.text?.body || '') : '';
    const pc = SPING.detect(tb);
    if (!(pc && pc.op === 'off')) { try { const fh = await SPING.flushHeld(ctx, { sendText, owner: from }); if (fh) { log('sow ping flush', JSON.stringify(fh)); if (ctx.test) ctx.spFlush = fh; } } catch (e) { log('sow ping flush failed', e.message); } }
  }
  // v9.8: a Royals day that waited for his window: wake the gate now (it sends from /api/cron, 300 s, not this 60 s webhook)
  if (from === ALLOWED()[0] && (J.jobsOn() || ctx.test) && RPC.rpcOn()) {
    try { const rs = await RPC.load(ctx.ns); if (RPC.wantsFlush(rs, Date.now(), Date.now())) { const w = await V.setNextWake(ctx.test ? 'test' : 'live', Date.now() + 5e3); if (w.ok) state.schedNext = null; if (ctx.test) ctx.rpcWake = { held: rs.held, ok: !!w.ok }; } } catch (e) { log('rpc flush wake failed', e.message); }
  }
  if (dd.changed) kbDirty = true;

  const finish = async (reply, userText, modelText) => {
    await sendText(from, reply, ctx);
    state.lastIn = now();                                    // his last message time (Meta's 24h window for the nudge)
    if (userText) state.history.push({ role: 'user', text: userText, at: now() });
    if (modelText) state.history.push({ role: 'model', text: modelText, at: now() });
    await syncSched(state, kb, ctx);                         // v5: re-arm the reminder scheduler if the next wake moved
    await Promise.all([saveState(from, state, ctx), kbDirty ? saveKB(from, kb, ctx) : null, ctx.test ? G.usage.clear() : G.flushUsage(J.jobsOn() ? J.rpc : null)]);
    return { reply };
  };

  // ---------- v8: auto-memory (runs beside the answer; Lite; never secrets; deduped; capped) ----------
  const autoMemory = async (ut, kbRef, t0) => {
    if (BR.looksSecret(ut)) return { added: [], replaced: [], dropped: 0, secret: true };
    const job = (async () => {
      const ans = await askGemini([], [], [{ text: BR.memoryPrompt(ut, '', kbRef.facts) }], t0, { cool: { ...(state.cool || {}) }, track: state, chain: LITE_FIRST, maxTokens: 400, system: 'You extract durable personal facts as JSON. Output only JSON.', src: 'memory' });
      if (!ans.ok) return null;
      return BR.applyMemory(kbRef, BR.parseMemory(ans.text));
    })().catch(e => { log('auto-memory failed', e.message); return null; });
    return Promise.race([job, new Promise(res => setTimeout(() => res(null), 15000))]);
  };

  // ---------- v5: reminders ----------
  const reminderFlow = async (pr, ut) => {
    let p = pr;
    if (!p.ok && p.ai && !V93.hasWhen(ut)) p = { ok: false, ask: '⏰ When should I remind you? e.g. _8pm_, _tomorrow 7am_, _in 2 hours_, or several: _7pm, 8pm and 9pm_' };   // v9.3: no time said -> ask, never guess one
    if (!p.ok && p.ai) {                                     // rules couldn't read the time: ask Gemini (Lite first) once
      const ans = await askGemini([], [], [{ text: V.reminderAIPrompt(ut) }], started, { cool: state.cool, track: state, chain: LITE_FIRST, maxTokens: 300, system: 'You turn reminder requests into JSON. Output only JSON.' });
      state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
      p = (ans.ok && V.parseAIReminder(ans.text)) || { ok: false, ask: 'I couldn\'t tell when 🤔 Try one of these:\n_remind me at 5pm to …_\n_remind me tomorrow 7am to …_\n_remind me in 2 hours to …_\n_every day at 6am remind me to …_' };
    }
    if (!p.ok) { state.remPending = { text: ut, at: now() }; return finish(p.ask, null, null); }   // v8: his answer comes back here
    state.remPending = null;
    if (!p.multi && V.active(kb).some(r => r.due === p.due && r.text === p.text && !p.rep)) return finish(`⏰ That one's already set: *${V.fmtWhen(p.due)}*\n_${p.text}_\n\nSend *reminders* to see them all.`, ut, null);   // v8: never a duplicate
    if (p.multi) {                                           // v8: several times in one request -> one reminder each
      const made = [];
      for (const one of p.multi) { const dup = V.active(kb).find(r => r.due === one.due && r.text === one.text); const r = dup || V.addReminder(kb, one); if (r) made.push(r); }
      if (!made.length) return finish(`You already have ${V.MAX_ACTIVE} reminders. Send *reminders* and cancel a few first.`, null, null);
      kbDirty = true;
      let reply = `⏰ Done! ${made.length} reminders set:\n` + made.map(r => `• *${V.fmtWhen(r.due)}*`).join('\n') + `\n_${made[0].text}_`;
      if (made.length < p.multi.length) reply += `\n_(Only ${made.length} fit: you're at the ${V.MAX_ACTIVE}-reminder limit.)_`;
      if (made.some(r => r.due > now() + V.WINDOW_MS - 60e3)) reply += '\n\n_WhatsApp only lets me message you within 24h of your last message. If the chat is about to go quiet before a reminder, I\'ll warn you so you can reply; anything missed, I\'ll show you when you\'re back._';
      reply += '\n\nSend *reminders* to see them all.';
      if (ctx.test) ctx.reminders = made;
      return finish(reply, ut, reply);
    }
    const r = V.addReminder(kb, p);
    if (!r) return finish(`You already have ${V.MAX_ACTIVE} reminders. Send *reminders* and cancel a few first.`, null, null);
    kbDirty = true;
    const when = r.rep ? `${V.fmtRepeat(r.rep)}` : V.fmtWhen(r.due);
    let reply = `⏰ Done! I'll remind you *${when}*:\n_${r.text}_`;
    if (r.rep) reply += `\nFirst one: ${V.fmtWhen(r.due)}.`;
    if (r.rep || r.due > now() + V.WINDOW_MS - 60e3) reply += '\n\n_WhatsApp only lets me message you within 24h of your last message. If the chat is about to go quiet before a reminder, I\'ll warn you so you can reply; anything missed, I\'ll show you when you\'re back._';
    reply += '\n\nSend *reminders* to see them all.';
    return finish(reply, ut, reply);
  };

  // ---------- v5: live web search ----------
  const searchFlow = async (sq, ut) => {
    const key = sq.q.toLowerCase().replace(/\s+/g, ' ').trim();
    const hit = (state.sc || []).find(x => x.k === key && Date.now() - x.at < 30 * 60e3);
    if (hit) { V.bump(state, 'cache'); return finish(hit.reply, ut, hit.reply); }
    const u = V.usageOf(state);
    if ((u.f.search || 0) >= V.SEARCH_LIMIT()) {
      if (!sq.explicit) return null;                         // natural question: just answer from what I know
      return finish(`🌍 That's today's ${V.SEARCH_LIMIT()} web searches used (to save your free AI quota). It resets around 8–9am Nigeria time.`, null, null);
    }
    let slowNote = setTimeout(() => { slowNote = null; sendText(from, '🔎 Checking the web for you…', ctx).catch(() => {}); }, +(process.env.SEARCH_NOTE_MS || 7000));   // v8: a quick note if it runs long
    const clearNote = () => { if (slowNote) clearTimeout(slowNote); slowNote = null; };
    const { results, news, tried } = await V.webResults(sq.q).catch(e => { clearNote(); throw e; });
    log('search', JSON.stringify(tried));
    if (!results.length && !news.length) { clearNote(); return finish('🌍 I couldn\'t reach the search engines just now 😕 Try again in a minute.', ut, null); }
    V.bump(state, 'search');
    const top = await V.readTop(results, 2);
    const sources = [], seenUrl = new Set();
    const freshFirst = news.length && /\b(news|today|latest|breaking|now|this week|yesterday|tonight|score|won|result)\b/i.test(sq.q);   // v8: dated news first for fresh questions
    for (const s of (freshFirst ? [...news.slice(0, 3), ...top, ...results] : [...top, ...news.slice(0, 3), ...results])) { if (sources.length < 6 && !seenUrl.has(s.url)) { seenUrl.add(s.url); sources.push(s); } }
    const ans = await askGemini([], [], [{ text: V.searchPrompt(sq.q, sources) }], started, { cool: state.cool, track: state, chain: LITE_FIRST, maxTokens: 1024, system: V.SEARCH_SYSTEM });
    state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
    let reply;
    if (ans.ok) reply = `🌍 ${V.renumber(toWhatsApp(ans.text), sources)}\n\n${V.sourcesBlock(sources, ans.text)}`;
    else reply = '🌍 Here\'s what the web says right now (I couldn\'t summarise it):\n\n' + sources.slice(0, 3).map((s, i) => `${i + 1}. *${s.title}*${s.snippet ? '\n' + s.snippet.slice(0, 160) : ''}\n${s.url}`).join('\n\n');
    state.sc = [...(state.sc || []).filter(x => Date.now() - x.at < 30 * 60e3).slice(-4), { k: key, at: Date.now(), reply }];
    clearNote();
    return finish(reply, `[search] ${sq.q}`, reply);
  };

  const draftFlow = async ({ brief, parts, userText: ut, imageId = null, media: isMedia = false }) => {
    const ans = await askGemini(state.history, kb.facts, parts, started, { cool: state.cool, track: state, media: isMedia });
    state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
    if (!ans.ok) return finish(ans.quota ? 'I\'ve used up today\'s free AI quota ⏳ so I can\'t write the post right now. It resets around 8–9am Nigeria time.' : 'I couldn\'t write that post just now 😅 Please try again.', null, null);
    const text = cleanPost(ans.text);
    state.pending = { text, imageId, brief: brief.slice(0, 300), at: new Date().toISOString() };
    return finish('📝 *Draft for your Facebook Page' + (imageId ? ' (with your picture)' : '') + ':*\n\n' + text + DRAFT_TAIL, ut, 'Facebook draft:\n' + text);
  };
  const publishFlow = async (ut) => {
    const p = state.pending;
    const r = await fbPublish(p, ctx);
    if (r.notConnected) return finish(NOT_CONNECTED, ut, null);
    if (!r.ok) return finish(`Facebook didn't accept the post 😕 (${String(r.detail || 'unknown error').slice(0, 160)}). Your draft is still saved: reply *yes* to try again.`, ut, null);
    state.pending = null;
    await sendText(from, `✅ Posted to your Facebook Page:\n${r.link}`, ctx);
    return finish(`📋 For your WhatsApp Channel (copy and paste):\n\n${p.text}`, ut, `Posted to Facebook: ${r.link}`);
  };


  // ---------- v4: read a link ----------
  const READ_FRESH_MS = 3 * 3600e3;
  const readFlow = async ({ url, question }, ut) => {
    if (!url) return finish('Send *read:* and the link, e.g.\n_read: https://github.com/Holaoluwakintan/Bible-Arena_', null, null);
    const page = await fetchPage(url);
    if (!page.ok) {
      const reply = page.blocked ? blockedReply(page.blocked) : `🔗 ${page.error}`;
      return finish(reply, ut, reply);
    }
    const parts = page.kind === 'pdf'
      ? (page.pdf ? [{ inline_data: { mime_type: 'application/pdf', data: page.pdf } }, { text: summaryPrompt(page, question) }] : null)
      : [{ text: summaryPrompt(page, question) }];
    if (!parts) return finish('That PDF is too big for me to read from a link 🙏 Send it to me here as a file instead.', ut, null);
    V.bump(state, 'read');
    const ans = await askGemini(state.history, kb.facts, parts, started, { cool: state.cool, track: state, media: page.kind === 'pdf', maxTokens: 2048, chain: page.kind === 'pdf' ? CHAIN : LITE_FIRST, lean: true, query: page.title });
    state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
    let summary;
    if (ans.ok) summary = toWhatsApp(ans.text).replace(/\n*_?Reply \*?save\*?[\s\S]*$/i, '').trim();
    else {
      log('read: gemini failed', ans.status);
      const desc = (page.text || '').split('\n').filter(l => l.length > 30).slice(0, 3).join('\n').slice(0, 500);
      summary = `*${page.title}*\n${desc}\n\n_(${ans.quota ? 'My free AI quota for today is used up, so this is the raw start of the page instead of a summary.' : 'I couldn\'t summarise it just now, so here is the start of the page.'})_`;
    }
    state.lastQA = null;
    state.lastRead = { url: page.url, title: String(page.title || page.url).slice(0, 200), kind: page.kind, text: String(page.text || (ans.ok ? ans.text : '')).slice(0, 20000), summary: ans.ok ? ans.text.slice(0, 3000) : '', at: Date.now(), awaiting: true, saved: false };
    return finish(summary + SAVE_TAIL, `[link] ${page.url}${question ? ' ' + question : ''}`, `Summary of ${page.title} (${page.url}):\n${ans.ok ? ans.text : summary}`);
  };
  const saveFlow = async (ut) => {
    const p = state.lastRead;
    const src = p.text || p.summary || '';
    let facts = [];
    const ans = await askGemini([], [], [{ text: factsPrompt({ ...p, text: src }) }], started, { cool: state.cool, track: state, chain: LITE_FIRST, maxTokens: 1024, system: 'You turn web pages into short, accurate facts for a personal assistant\'s memory. Output only the facts.' });
    state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
    if (ans.ok) facts = parseFacts(ans.text);
    if (!facts.length) facts = [`${p.title} (${p.url}): ${src.replace(/\s+/g, ' ').slice(0, 400)}`];
    const have = new Set(kb.facts.map(f => String(f.t).toLowerCase()));
    const saved = [];
    for (const f of facts) {
      const clean = String(f).replace(/\s+/g, ' ').trim().slice(0, MAX_FACT);
      if (clean.length < 8 || have.has(clean.toLowerCase())) continue;
      if (addFact(kb, clean)) { saved.push(clean); have.add(clean.toLowerCase()); }
    }
    if (saved.length) kbDirty = true;
    p.saved = true; p.awaiting = false;
    const reply = saved.length
      ? `✅ Saved ${saved.length} fact${saved.length > 1 ? 's' : ''} from ${p.title}\n` + saved.map(f => `• ${f}`).join('\n') + '\n\nSend /knowledge to see everything I know.'
      : `I already know everything from ${p.title} ✅ Nothing new to save.`;
    return finish(reply, ut, reply);
  };

  // ---------- v5.1: read a file (PDF, Word, Excel, PowerPoint, text, photo of a page) ----------
  const FILE_FRESH_MS = 12 * 3600e3;
  const OCR_CHAIN = LITE_FIRST.filter(m => !m.startsWith('gemma'));   // Gemma can't take PDFs inline
  const fileErr = {
    old: k => `That's an old-format ${k === 'doc-old' ? 'Word (.doc)' : k === 'xls-old' ? 'Excel (.xls)' : 'PowerPoint (.ppt)'} file 🙏 I can't open that type. Open it and *Save As* ${k === 'doc-old' ? '.docx' : k === 'xls-old' ? '.xlsx' : '.pptx'} or PDF, then send it again.`,
    unsupported: name => `I can't read ${name ? `"${name}"` : 'that kind of file'} yet 🙏 I can read *PDF*, *Word (.docx)*, *Excel (.xlsx)*, *PowerPoint (.pptx)*, *text/CSV* files and *photos of pages*.`,
    big: sz => `📄 That file is ${F.MB(sz)} MB. I can read files up to ${F.MB(F.MAX_DOWNLOAD)} MB (scanned ones up to ${F.MB(F.MAX_INLINE)} MB). Send a smaller copy, or just the pages you need.`,
    bigScan: sz => `📄 That PDF looks scanned (pictures of pages, no text inside), and at ${F.MB(sz)} MB it's too big for me to read from the pictures (max ${F.MB(F.MAX_INLINE)} MB). Send fewer pages, or a smaller/compressed copy.`,
    locked: k => k === 'pdf'
      ? '🔒 That PDF is password-protected, so I can\'t open it. Open it on your phone, use *Print → Save as PDF* (that makes a copy without the password), and send me the copy.'
      : '🔒 That file is password-protected (or an old format), so I can\'t open it. Remove the password, *Save As* .docx/.xlsx/PDF, and send it again.',
    bad: name => `I couldn't open ${name ? `"${name}"` : 'that file'} 😕 It may be damaged or not what its name says. Try exporting it again as PDF.`,
    empty: name => `I opened ${name ? `"${name}"` : 'that file'} but there's no readable text in it 🤔 If it's a photo or scan, send it as a clear picture and I'll read it.`,
  };
  const wordsOnly = c => /^\s*(?:pls |please )?(?:read|scan|ocr|summari[sz]e|open|check)(?: (?:it|this|that|the (?:file|doc|document|pdf|text|picture|page)))?(?: (?:for me|pls|please))?\s*[.!?🙏]*\s*$/i.test(c);
  const fullTextFlow = async (ut, start = 0) => {
    const lr = state.lastRead;
    const text = String(lr.text || '');
    if (!text.trim()) return finish(`I only kept a summary of ${lr.title}, not its full text 🙏 Send it again and I'll pull the text.`, ut, null);
    const chunks = F.chunkText(text, F.CHUNK);
    const N = chunks.length;
    if (start >= N) start = 0;
    const end = Math.min(N, start + F.MAX_CHUNKS);
    const label = i => N > 1 ? `📄 *${String(lr.title).slice(0, 60)}* · part ${i + 1}/${N}\n\n` : `📄 *${String(lr.title).slice(0, 60)}*\n\n`;
    for (let i = start; i < end - 1; i++) await sendText(from, label(i) + chunks[i], ctx);
    let tail;
    if (end < N) { tail = `\n\n_That's part ${start + 1}–${end} of ${N}. Reply *more* for the next part, or just ask me anything about the rest._`; lr.part = end; lr.more = true; }
    else if (lr.cut) tail = `\n\n_That's all I kept: the first ${F.FILE_CAP.toLocaleString('en-US')} of ${Number(lr.len || 0).toLocaleString('en-US')} characters. Ask me anything about it._`;
    else tail = `\n\n✅ _That's the whole text. Ask me anything about it${lr.saved ? '' : ', or reply *save* to keep it'}._`;
    if (end >= N) { lr.part = 0; lr.more = false; }
    V.bump(state, 'fulltext');
    return finish(label(end - 1) + chunks[end - 1] + tail, ut, `[I sent Michael the text of "${lr.title}" (part ${start + 1}–${end} of ${N}).]`);
  };
  const fileFlow = async ({ media, name = '', mime = '', caption = '', viaImage = false }) => {
    const kind = viaImage ? 'image' : F.fileKind(mime, name);
    const cap = String(caption || '').trim();
    const wantFull = !!cap && (F.FULL_TEXT_RE.test(cap) || /^\s*(?:transcribe|type (?:it )?out|extract|copy)\b/i.test(cap));
    const question = cap && !wantFull && !wordsOnly(cap) ? cap : '';
    const ut = `[${viaImage || kind === 'image' ? 'picture' : 'file'}${name ? ' ' + name : ''}]${cap ? ' ' + cap : ''}`;
    if (/-old$/.test(kind)) return finish(fileErr.old(kind), ut, null);
    if (kind === 'unsupported') return finish(fileErr.unsupported(name), ut, null);
    const d = await downloadFile(media, ctx);
    if (!d.ok) { log('file download failed', d.error || d.tooBig); return finish(d.tooBig ? fileErr.big(d.tooBig) : 'I couldn\'t download that file from WhatsApp 🙏 Please send it again.', ut, null); }
    const ex = await F.extractText(d.buf, kind, { filename: name, mime: d.mime || mime });
    log('file', kind, d.size + 'B', ex.ok ? `text ${String(ex.text || '').length} ocr ${!!ex.needsOcr}` : ex.code + ' ' + (ex.error || ''));
    if (!ex.ok) return finish(ex.code === 'LOCKED' || ex.code === 'LOCKED_OR_OLD' ? fileErr.locked(kind) : ex.code === 'UNSUPPORTED' ? fileErr.unsupported(name) : fileErr.bad(name), ut, null);
    V.bump(state, 'file');
    let text = String(ex.text || ''), summary = '', title = name || F.KIND_LABEL[kind] || 'file', method = 'text', modelUsed = '';
    if (ex.needsOcr) {
      if (d.buf.length > F.MAX_INLINE) { if (text.length < 40) return finish(fileErr.bigScan(d.buf.length), ut, null); }
      else {
        const omime = kind === 'pdf' ? 'application/pdf' : (/^image\//.test(d.mime) ? d.mime : 'image/jpeg');
        const ans = await askGemini([], [], [{ inline_data: { mime_type: omime, data: d.buf.toString('base64') } }, { text: F.ocrPrompt(name, question, kind === 'image') }], started,
          { cool: state.cool, track: state, media: true, maxTokens: 8192, chain: OCR_CHAIN, system: 'You read scanned documents and photos of text for a personal assistant. Transcribe faithfully and follow the requested output shape exactly.' });
        state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
        if (ans.ok) {
          const o = F.parseOcr(ans.text);
          if (o.text.length >= text.length) { text = o.text; method = 'ocr'; }
          summary = toWhatsApp(o.summary).replace(/\n*_?Reply \*?save\*?[\s\S]*$/i, '').trim();
          if (!name && o.title) title = o.title;
          modelUsed = ans.model;
        } else {
          log('ocr failed', ans.status, ans.detail || '');
          if (text.length < 40) return finish(ans.quota ? 'That file looks scanned, and I\'ve used up today\'s free AI quota for reading pictures ⏳ Send it again after 8–9am Nigeria time.' : 'That file looks scanned (pictures of pages) and I couldn\'t read it just now 😕 Please send it again in a minute.', ut, null);
        }
      }
    }
    if (!text.trim() && !summary) return finish(fileErr.empty(name), ut, null);
    const fullLen = text.length, cut = fullLen > F.FILE_CAP;
    text = text.slice(0, F.FILE_CAP);
    state.lastQA = null;                                     // a new file changes what the same question means
    state.lastRead = { url: 'file sent on WhatsApp', title: String(title).slice(0, 200), kind: 'file-' + kind, text, summary: summary.slice(0, 3000), at: Date.now(), awaiting: true, saved: false, len: fullLen, cut, pages: ex.pages || 0, method, part: 0, more: false };
    if (wantFull) return fullTextFlow(ut, 0);
    if (!summary) {
      const doc = { name: title, kindLabel: F.KIND_LABEL[kind] || 'file', pages: ex.pages, text, cut, fullLen };
      const ans = await askGemini(state.history, kb.facts, [{ text: F.fileSummaryPrompt(doc, question) }], started,
        { cool: state.cool, track: state, maxTokens: 2048, chain: question && V.isHard(question, false) ? CHAIN : LITE_FIRST, lean: true, query: question || title });
      state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
      if (ans.ok) { summary = toWhatsApp(ans.text).replace(/\n*_?Reply \*?save\*?[\s\S]*$/i, '').trim(); modelUsed = ans.model; }
      else {
        log('file: gemini failed', ans.status);
        const desc = text.split('\n').filter(l => l.trim().length > 20).slice(0, 4).join('\n').slice(0, 600);
        summary = `*${title}*\n${desc}\n\n_(${ans.quota ? 'My free AI quota for today is used up, so this is the start of the file instead of a summary.' : 'I couldn\'t summarise it just now, so here is the start of the file.'})_`;
      }
      state.lastRead.summary = summary.slice(0, 3000);
    }
    const facts = [ex.pages ? `${ex.pages} page${ex.pages > 1 ? 's' : ''}` : '', `${fullLen.toLocaleString('en-US')} characters`, method === 'ocr' ? 'read from the scan' : ''].filter(Boolean).join(' · ');
    const reply = `${summary}\n\n_📄 ${facts}${cut ? ` (I kept the first ${F.FILE_CAP.toLocaleString('en-US')})` : ''}_` + SAVE_TAIL + '\nReply *full text* to get the text back.';
    log('file summarised with', modelUsed || 'fallback', method);
    return finish(reply, ut, `Summary of the file "${title}":\n${summary}`);
  };

  // ---------- v4: make a picture ----------
  const imageFlow = async (req, ut) => {
    if (req.prompt && V96.realPerson(req.prompt)) return finish(V96.REAL_PERSON_REPLY, ut, 'I explained I never make AI pictures of real public figures and offered a scene without them.');   // v9.6
    if (req.prompt && (V95.selfFace(req.prompt) || V96.selfFace96(req.prompt))) return finish(V95.SELF_FACE_REPLY, ut, 'I explained I never draw his face with AI (his photos come from his picture bank) and offered a background without him.');   // v9.5
    if (!req.prompt || req.prompt.length < 3) return finish('Tell me what to draw after *image:*, e.g.\n_image: a felt lamb resting in a yarn meadow at sunrise_\nAdd *status*, *square* or *landscape* for other sizes.', null, null);
    const q = imageQuota(state);
    if (!q.left) return finish(`🎨 That's today's ${q.limit} free pictures used up. The count resets at midnight US Pacific time (8–9am Nigeria time). I can still chat, read links and help you write.`, ut, null);
    await sendText(from, `🎨 Drawing it (${req.shape})… give me 10–30 seconds.`, ctx);
    let drawPrompt = req.prompt;                              // v9.7: a vague ask becomes a concrete scene first (8 s max; else his words as they are)
    if (process.env.IMG_SCENE !== '0') {
      const sc = await Promise.race([askGemini([], [], [{ text: V97.scenePrompt(req.prompt, req.shape) }], Date.now(), { cool: { ...(state.cool || {}) }, chain: LITE_FIRST, maxTokens: 400, temperature: 0.7, system: 'You write prompts for an image model. Output only the prompt.', src: 'img-scene' }).catch(() => null), new Promise(r => setTimeout(() => r(null), 8000))]);
      const t = sc && sc.ok ? V97.cleanScene(sc.text, req.prompt) : null;
      if (t) { drawPrompt = t; log('image scene', t.slice(0, 200)); }
    }
    const img = await generateImage(drawPrompt, { width: req.width, height: req.height, cool: state.cool, budgetMs: Math.max(15000, 50000 - (Date.now() - started)), styleFrom: req.prompt });
    state.cool = Object.fromEntries(Object.entries(state.cool || {}).filter(([, v]) => v > Date.now()));
    log('image', img.ok ? 'ok' : 'failed', JSON.stringify(img.tried), img.ms + 'ms');
    if (!img.ok) {
      const reply = img.busy
        ? '😕 The free picture service is busy right now and didn\'t give me an image. Try again in a minute or two (it didn\'t count against your 20).'
        : '😕 I couldn\'t make that picture just now. Try again in a bit, or describe it a little differently (it didn\'t count against your 20).';
      return finish(reply, ut, null);
    }
    const up = await uploadMedia(img.bytes, img.mime, ctx);
    if (!up.ok) return finish(`I made the picture but WhatsApp didn't accept the upload 😕 (${String(up.detail).slice(0, 120)}). Try again.`, ut, null);
    countImage(state);
    const left = imageQuota(state).left;
    const textTip = /\b(poster|flyer|thumbnail|banner|graphic|cover|invitation|invite|card|verse)\b/i.test(req.prompt) ? '\n_It comes without words so spelling stays perfect: add your headline or verse on top in Canva._' : '';   // v9.3
    const caption = `🎨 ${(req.change ? `Redrawn: ${req.change}` : req.prompt).slice(0, 300)}${textTip}${V95.peopleNote(req.prompt)}\n\n_${left} free picture${left === 1 ? '' : 's'} left today. To post it: post: <topic> with this image_`;
    const sent = await sendImage(from, up.id, caption, ctx);
    if (!sent.ok && !sent.dry) return finish('I made the picture but couldn\'t send it 😕 Please try again.', ut, null);
    state.lastImage = { mediaId: up.id, prompt: req.prompt.slice(0, 500), base: req.prompt.slice(0, 900), width: req.width, height: req.height, shape: req.shape, provider: img.provider, at: Date.now() };   // v9.5: size + base kept for "again / brighter"
    state.lastIn = now();
    state.history.push({ role: 'user', text: ut, at: now() });
    state.history.push({ role: 'model', text: `[I made and sent Michael a picture: ${req.prompt.slice(0, 300)}]`, at: now() });
    await syncSched(state, kb, ctx);
    await Promise.all([saveState(from, state, ctx), kbDirty ? saveKB(from, kb, ctx) : null]);
    return { reply: caption, image: { provider: img.provider, model: img.model, bytes: img.bytes.length, mime: img.mime, ms: img.ms, tried: img.tried, scene: drawPrompt !== req.prompt ? drawPrompt.slice(0, 400) : null } };
  };

  // ---------- v6: AGENT MODE (background jobs, build sites & apps) ----------
  const BUILDERS = (process.env.BUILD_NUMBERS || ALLOWED()[0] || '2348148034092').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
  const agentIntent = async (ut) => {
    const t = String(ut || '').trim();
    if (!t) return null;
    const ns = J.nsOf(ctx);
    const wantsJobs = J.JOBS_RE.test(t), cj = t.match(J.CANCEL_JOB_RE), wantsSites = J.SITES_RE.test(t);
    const ed = t.match(J.EDIT_RE), zp = t.match(J.ZIP_RE), zipAlone = J.ZIP_ALONE_RE.test(t), apk = t.match(J.APK_RE);
    const bd = J.detectBuild(t), ag = J.detectAgent(t);
    if (!(wantsJobs || cj || wantsSites || ed || zp || zipAlone || apk || bd || ag)) return null;
    if (!J.jobsOn()) return (bd || ag) ? finish('🛠️ Agent mode isn\'t switched on yet (its job store is missing). Tab will fix it.', null, null) : null;
    try {
      if (wantsJobs) return finish(J.jobsText(await J.rpc('list', { ns, owner: from, limit: 8 })), null, null);
      if (cj) {
        const r = await J.rpc('cancel', { ns, owner: from, id: +cj[1] });
        return finish(r?.cancelled ? `🚫 Job #${cj[1]} cancelled.` : `Job #${cj[1]} isn't running (send *jobs* to see them).`, null, null);
      }
      const sites = (wantsSites || ed || zp || zipAlone || apk) ? await J.rpc('site_list', { ns, owner: from }) : [];
      if (wantsSites) return finish(J.sitesText(sites), null, null);
      if (apk) {
        const s = apk[1] ? J.findSite(sites, apk[1]) : (sites.find(x => x.kind === 'app') || sites[0]);
        return finish(J.APK_TEXT(s?.url), null, null);
      }
      if (zp || zipAlone) {
        const s = zp ? J.findSite(sites, zp[1]) : sites[0];
        if (!s) { if (zp && !/^\s*\/?zip\b/i.test(t)) return null; return finish(sites.length ? `No site called "${zp ? zp[1] : ''}". Send *my sites* to see the names.` : 'No sites yet. Try: _build me a landing page for my bakery_', null, null); }
        const full = await J.rpc('site_get', { ns, slug: s.slug });
        const files = Object.fromEntries(Object.entries(full.files || {}).filter(([k]) => !k.startsWith('_')));
        const zip = zipFiles(files, s.slug);
        const up = await uploadMedia(zip, 'application/zip', ctx, `${s.slug}-v${s.version}.zip`);
        if (!up.ok) return finish(`I couldn't upload the zip to WhatsApp 😕 (${String(up.detail || '').slice(0, 100)}).`, null, null);
        await sendDocument(from, up.id, `${s.slug}-v${s.version}.zip`, `📦 ${s.title}: source code (v${s.version})`, ctx);
        return finish(`That's the full code for *${s.title}* (${Object.keys(files).length} files). Open index.html in a browser, or upload the folder to any free host.`, null, null);
      }
      if (ed) {
        const s = J.findSite(sites, ed[1]);
        if (!s) {
          if (!/^\s*\/?edit\s+(?:site|app)\b/i.test(t) || state.pending) return null;     // "edit the draft …", "change my mind …": not a site edit
          return finish(sites.length ? `No site called "${ed[1]}". Your sites: ${sites.slice(0, 6).map(x => x.slug).join(', ')}` : 'No sites yet. Try: _build me a landing page for my bakery_', null, null);
        }
      }
      if (ed || bd || ag) {
        if (!BUILDERS.includes(from)) return finish('Only Michael can start builds and agent jobs on this line.', null, null);
        const open = await J.rpc('open_count', { ns, owner: from });
        if (open >= J.MAX_OPEN) return finish(`You already have ${open} jobs running. Send *jobs* to see them, or wait for one to finish.`, null, null);
        const kind = ed ? 'edit' : bd ? 'build' : 'agent';
        if (kind !== 'agent') {
          const used = await J.rpc('count_today', { ns, owner: from, kinds: ['build', 'edit'] });
          if (used >= J.BUILD_DAILY_LIMIT()) return finish(`🛑 That's today's ${J.BUILD_DAILY_LIMIT()} builds (it protects your free quotas). Send it again tomorrow.`, null, null);
        }
        const s = ed ? J.findSite(sites, ed[1]) : null;
        const input = ed ? { brief: `edit ${s.slug}: ${ed[2].trim()}`, slug: s.slug, change: ed[2].trim() } : { brief: (bd || ag).brief };
        const job = await J.rpc('create', { ns, owner: from, kind, input });
        V.bump(state, 'agent');
        state.jobsUntil = now() + 7 * 864e5;
        const app = bd && /\b(app|quiz|game|calculator|tracker|tool|pwa)\b/i.test(bd.brief);
        const reply = kind === 'build' ? `On it 🛠️ Building your ${app ? 'app' : 'site'} now. I'll message you here when it's live (usually 3–6 min).\n_Job #${job.id} · *jobs* to check · *cancel ${job.id}* to stop_`
          : kind === 'edit' ? `On it ✏️ Updating *${s.title}*: _${ed[2].trim().slice(0, 120)}_\nI'll send the link when the new version is live (2–4 min). _Job #${job.id}_`
          : `On it 🧠 Working on that in the background. I'll message you with the result.\n_Job #${job.id} · *jobs* to check · *cancel ${job.id}* to stop_`;
        const out = await finish(reply, ut, reply);
        out.job = { id: job.id, kind, kick: await J.kick(ns, { id: job.id }) };
        return out;
      }
    } catch (e) {
      log('agent intent failed', e.message);
      if (bd || ag || ed) return finish('😕 I couldn\'t start that job (my job store didn\'t answer). Try again in a minute.', null, null);
      return null;
    }
    return null;
  };

  // ---------- v7: HEAVY WORK (site data, GitHub repos, long research, Sow posts, video/media) ----------
  const isOwner = BUILDERS.includes(from);
  const ORDERS_RE = /^\s*\/?(?:orders|bookings|enquiries|inbox|submissions|form\s+entries)(?:\s+(?:for|on|from|of)?\s*([a-z0-9][a-z0-9-]{1,40}))?\s*[?.!]*\s*$/i;
  const DATA_RE = /^\s*\/?(?:data|database|db|site\s+data)\s+(?:for\s+|of\s+|on\s+)?([a-z0-9][a-z0-9-]{1,40})\s*[?.!]*\s*$/i;
  const EXPORT_RE = /^\s*\/?(?:export|csv|download\s+data|export\s+data)\s+(?:for\s+|of\s+|from\s+)?([a-z0-9][a-z0-9-]{1,40})(?:\s+([a-z0-9_]{1,24}))?\s*[.!]*\s*$/i;
  const startJob = async (kind, input, limit, kindsCounted, reply) => {
    if (!isOwner) return finish('Only Michael can start that on this line.', null, null);
    if (!J.jobsOn()) return finish('🛠️ Background jobs aren\'t switched on yet. Tab will fix it.', null, null);
    const ns = J.nsOf(ctx);
    const open = await J.rpc('open_count', { ns, owner: from });
    if (open >= J.MAX_OPEN) return finish(`You already have ${open} jobs running. Send *jobs* to see them, or wait for one to finish.`, null, null);
    const used = await J.rpc('count_today', { ns, owner: from, kinds: kindsCounted });
    if (used >= limit) return finish(`🛑 That's today's ${limit} (it protects your free quotas). Try again tomorrow.`, null, null);
    const job = await J.rpc('create', { ns, owner: from, kind, input });
    V.bump(state, kind === 'media' ? 'media' : kind === 'research' ? 'research' : kind === 'repo' ? 'repo' : 'agent');
    state.jobsUntil = now() + 7 * 864e5;
    const text = reply(job.id);
    const out = await finish(text, input.brief ? `${kind}: ${input.brief}` : null, text);
    out.job = { id: job.id, kind, kick: await J.kick(ns, { id: job.id, path: kind === 'media' ? '/api/media' : '/api/jobs' }) };
    return out;
  };
  const siteFor = async (name) => {
    const ns = J.nsOf(ctx);
    const sites = await J.rpc('site_list', { ns, owner: from });
    const withData = sites.filter(x => x.has_backend);
    const s = name ? J.findSite(sites, name) : (withData.length === 1 ? withData[0] : null);
    if (!s) return { err: name ? `No site called "${name}". ${withData.length ? 'Sites with a backend: ' + withData.map(x => x.slug).join(', ') : 'None of your sites has a backend yet. Try: _build me a bakery site with an order form_'}` : (withData.length ? `Which site? ${withData.map(x => '*orders ' + x.slug + '*').join(' · ')}` : 'None of your sites has a backend yet. Try: _build me a bakery site with an order form_') };
    const meta = await J.rpc('site_meta', { ns, slug: s.slug });
    return { site: { ...s, ...(meta || {}) }, ns };
  };
  const mediaJob = async (cmd, media) => startJob('media', { brief: `${cmd.op}${cmd.text ? ': ' + cmd.text.slice(0, 60) : ''}`, cmd, media }, +(process.env.MEDIA_DAILY_LIMIT || 15), ['media'],
    id => `On it 🎬 ${{ trim: 'Trimming', compress: 'Compressing', caption: 'Adding your caption to', audio: 'Pulling the audio from', imgaudio: 'Making a video from your picture + audio:' }[cmd.op] || 'Working on'} ${cmd.op === 'imgaudio' ? '' : 'the video'}. Usually under a minute.\n_Job #${id}_`);
  const mediaRef = (m) => m ? { id: m.id, mime_type: m.mime_type, ...(ctx.test && m._test_b64 ? { _test_b64: m._test_b64 } : {}) } : null;
  const recent = (x, ms = 3 * 3600e3) => x && Date.now() - x.at < ms;
  const v7Intent = async (ut) => {
    const t = String(ut || '').trim();
    if (!t) return null;
    let m;
    try {
      // --- site data: orders / data / export ---
      if ((m = t.match(ORDERS_RE)) || (m = t.match(DATA_RE)) || (m = t.match(EXPORT_RE))) {
        if (!J.jobsOn()) return null;
        if (!isOwner) return finish('Only Michael can see site data on this line.', null, null);
        const which = ORDERS_RE.test(t) ? 'orders' : DATA_RE.test(t) ? 'data' : 'export';
        const { site, ns, err } = await siteFor(m[1]);
        if (err) return finish(err, null, null);
        if (which === 'orders') {
          const rows = await J.rpc('data_list', { ns, slug: site.slug, kinds: ['order', 'booking', 'contact', 'signup'], limit: 10 });
          const fresh = rows.filter(r => r.status === 'new').map(r => r.id);
          if (fresh.length) await J.rpc('data_seen', { ns, slug: site.slug, ids: fresh }).catch(() => {});
          return finish(B.ordersText(site, rows), null, null);
        }
        if (which === 'data') {
          const counts = await J.rpc('data_counts', { ns, slug: site.slug });
          const samples = {};
          for (const c of counts.slice(0, 4)) samples[c.coll] = await J.rpc('data_list', { ns, slug: site.slug, coll: c.coll, limit: 3 });
          const users = site.backend?.auth ? await J.rpc('user_count', { ns, slug: site.slug }) : 0;
          return finish(B.dataText(site, counts, samples, users), null, null);
        }
        const rows = await J.rpc('data_list', { ns, slug: site.slug, coll: m[2] || null, limit: 5000 });
        if (!rows.length) return finish(`📭 Nothing to export from *${site.title || site.slug}* yet.`, null, null);
        const csv = Buffer.from(B.toCsv(rows.reverse()), 'utf8');
        const name = `${site.slug}${m[2] ? '-' + m[2] : ''}-${new Date(Date.now() + 3600e3).toISOString().slice(0, 10)}.csv`;
        let up = await uploadMedia(csv, 'text/csv', ctx, name);
        if (!up.ok) up = await uploadMedia(csv, 'text/plain', ctx, name);
        if (!up.ok) return finish(`I couldn't upload the CSV to WhatsApp 😕 (${String(up.detail || '').slice(0, 100)}).`, null, null);
        await sendDocument(from, up.id, name, `📊 ${site.title || site.slug}: ${rows.length} rows`, ctx);
        return finish(`That's every entry from *${site.title || site.slug}* (${rows.length} ${rows.length === 1 ? 'row' : 'rows'}). Opens in Excel, Google Sheets or WPS.`, null, null);
      }
      // --- GitHub repos ---
      if (GR.REPOS_RE.test(t) || (m = t.match(GR.REPO_INFO_RE)) || (m = t.match(GR.REPO_RE))) {
        if (!isOwner) return finish('Only Michael can use GitHub on this line.', null, null);
        if (!GR.repoOn()) return finish('🐙 GitHub isn\'t connected to the bot yet. Tab will set it up.', null, null);
        if (GR.REPOS_RE.test(t)) return finish(GR.reposText(await GR.listRepos()), null, null);
        const repos = await GR.listRepos();
        const repo = GR.findRepo(repos, m[1]);
        if (!repo) { if (!/^\s*\/?(?:repo|github)\b/i.test(t)) return null; return finish(`No repo called "${m[1]}". Send *repos* to see them.`, null, null); }
        if (!m[2]) return finish(`🐙 *${repo.name}*${repo.private ? ' 🔒' : ''}\n${repo.desc ? '_' + repo.desc + '_\n' : ''}${repo.lang || 'mixed'} · default branch *${repo.branch}* · ${repo.url}\n\nChange it: *repo ${repo.name} <what to change>*\nI push to a new branch *mai/…* and send the pull-request link. I never touch ${repo.branch}.`, null, null);
        if (GR.isProtected(repo.name)) return finish(`🛑 *${repo.name}* runs your live site, so I keep my hands off it. Ask Tab for changes there.`, null, null);
        return startJob('repo', { brief: `${repo.name}: ${m[2].trim().slice(0, 200)}`, repo: repo.name, change: m[2].trim() }, J.BUILD_DAILY_LIMIT(), ['build', 'edit', 'repo'],
          id => `On it 🐙 Working on *${repo.name}*: _${m[2].trim().slice(0, 120)}_\nI'll read the code, make the change, check it and push a new branch (never ${repo.branch}). 2–5 min.\n_Job #${id}_`);
      }
      // --- real APK (PWABuilder's free packager) ---
      if ((m = t.match(J.APK_RE)) && isOwner && J.jobsOn() && process.env.APK_OFF !== '1') {
        const sites = await J.rpc('site_list', { ns: J.nsOf(ctx), owner: from });
        const s = m[1] ? J.findSite(sites, m[1]) : (sites.find(x => x.kind === 'app') || sites[0]);
        if (s) return startJob('apk', { brief: `apk ${s.slug}`, slug: s.slug }, +(process.env.APK_DAILY_LIMIT || 3), ['apk'],
          id => `On it 📱 Making a real APK of *${s.title || s.slug}* (signed Android app). About 2–3 min.\nYou can already install it from Chrome meanwhile: open ${s.url} → ⋮ → *Add to Home screen*.\n_Job #${id}_`);
      }
      // --- long research ---
      const rq = R.detectResearch(t);
      if (rq) return startJob('research', { brief: rq.topic.slice(0, 300), topic: rq.topic, pdf: rq.pdf }, +(process.env.RESEARCH_DAILY_LIMIT || 6), ['research'],
        id => `On it 🔎 Deep research: _${rq.topic.slice(0, 140)}_\nI'll run ~10 searches, read the best pages and send a summary with sources${rq.pdf ? ' + a PDF report' : ''}. 3–6 min.\n_Job #${id}_`);
      // --- v9.8: royals (today's RPC posts again via the gate) · royals on | off | status ---
      const rpp = RPC.detect(t);
      if (rpp && isOwner) {
        try { const rr = await RPC.command(ctx, rpp.op, {}); if (ctx.test) ctx.rpcCmd = rpp.op; return finish(rr.text, null, null); }
        catch (e) { log('royals cmd failed', e.message); return finish('Couldn\'t reach the Royals posts just now. Try again in a minute.', null, null); }
      }
      // --- v9.2: sow pings on | off | status (before Sow posts: "sow pings off" must never become a post) ---
      const spp = SPING.detect(t);
      if (spp) {
        if (!isOwner) return finish('Only Michael can change Sow pings on this line.', null, null);
        try { return finish(await SPING.command(ctx, spp.op, {}), null, null); }
        catch (e) { log('sow pings cmd failed', e.message); return finish('Couldn\'t change Sow pings just now. Try again in a minute.', null, null); }
      }
      // --- Sow posts ---
      const pq = SOW.detectPost(t, { pending: !!state.pending });
      if (pq) {
        if (!isOwner) return finish('Only Michael can post on this line.', null, null);
        if (!SOW.sowOn()) return finish('🌱 Sow isn\'t connected yet. Tab will set it up.', null, null);
        if (pq.op === 'list') return finish(SOW.listText(await J.rpc('sow_list', {})), null, null);
        if (pq.op === 'unpost') {
          const list = await J.rpc('sow_list', {});
          const target = pq.n ? list[pq.n - 1] : list.find(x => (state.sowLast || []).includes(x.id)) || null;
          if (!target) return finish(pq.n ? `There's no post #${pq.n}. Send *queued posts* to see them.` : 'Nothing of mine to remove. Send *queued posts* to see them.', null, null);
          const n = await J.rpc('sow_delete', { id: target.id });
          state.sowLast = (state.sowLast || []).filter(x => x !== target.id);
          return finish(n ? `🗑️ Removed from Sow: _${String(target.caption).slice(0, 80)}_` : 'It already went out or was removed.', null, null);
        }
        let due = Date.now(), text = pq.text;
        if (pq.op === 'schedule') {
          const ps = SOW.parseSchedule(pq.rest);
          if (!ps.ok) return finish(ps.past ? 'That time has already passed 🙂 Pick a later time.' : 'When should it go out? Try:\n_schedule tomorrow 7am God is faithful 🙏_\n_schedule friday 6pm New chapter out!_', null, null);
          due = ps.due; text = ps.text;
        }
        if (!text || text.length < 2) return finish('What should the post say? e.g. *post God is faithful 🙏*', null, null);
        const w = SOW.watParts(due);
        const row = await J.rpc('sow_add', { post_date: w.date, post_time: w.time, caption: text.slice(0, 2200), title: text.slice(0, 60) });
        state.sowLast = [...(state.sowLast || []), row.id].slice(-10);
        return finish(SOW.queuedText(row, { scheduled: pq.op === 'schedule' }), null, null);
      }
      // --- media commands on the last video / picture + audio ---
      const mc = parseMediaCmd(t);
      if (mc) {
        const lm = state.lastMedia || {};
        if (mc.op === 'bad') return finish(mc.why, null, null);
        if (mc.op === 'imgaudio') {
          if (!recent(lm.image) || !recent(lm.audio)) return finish('🎬 Send me a picture and a voice note / audio file (any order), then *make video*.', null, null);
          return mediaJob(mc, { image: mediaRef(lm.image), audio: mediaRef(lm.audio) });
        }
        if (!recent(lm.video)) { if (mc.op === 'caption' || mc.op === 'compress') return null; return finish('🎬 Send the video first (or put the command in the video\'s caption), e.g. caption: *trim 0:05-0:20*', null, null); }
        return mediaJob(mc, { video: mediaRef(lm.video) });
      }
    } catch (e) {
      log('v7 intent failed', e.message);
      return finish('😕 That didn\'t work just now (' + String(e.message).slice(0, 120) + '). Try again in a minute.', null, null);
    }
    return null;
  };
  // v7: orders/bookings that came in while the 24h window was shut come with his next message
  if (isOwner && J.jobsOn()) {
    try {
      const und = await J.rpc('data_unnotified', { ns: J.nsOf(ctx), owner: from });
      if (Array.isArray(und) && und.length) {
        const by = {}; for (const r of und) (by[r.slug] = by[r.slug] || []).push(r);
        const lines = ['📬 _While the chat was asleep:_'];
        for (const [slug, rows] of Object.entries(by)) lines.push(`• *${rows[0].title || slug}*: ${rows.length} new (${[...new Set(rows.map(r => r.kind))].join(', ')}) → *orders ${slug}*`);
        const r = await sendText(from, lines.join('\n'), ctx);
        if (r.ok) await J.rpc('data_notified', { ns: J.nsOf(ctx), ids: und.map(x => x.id) });
      }
    } catch (e) { log('unnotified check failed', e.message); }
  }
  // results that finished while WhatsApp's 24h window was shut come with his next message
  if (state.jobsUntil > now() && J.jobsOn()) {
    try {
      const und = await J.rpc('undelivered', { ns: J.nsOf(ctx), owner: from });
      for (const j of und || []) {
        const msgText = j.result?.message || (j.status === 'failed' ? `⚠️ Job #${j.id} didn't finish.` : `✅ Job #${j.id} finished.`);
        const r = await sendText(from, `📬 _Finished while the chat was asleep (job #${j.id}):_\n\n${msgText}`, ctx);
        if (r.ok) await J.rpc('save', { id: j.id, delivered: true });
      }
    } catch (e) { log('undelivered check failed', e.message); }
  }

  let userParts, userText, media = false;
  if (msg.type === 'text') {
    userText = msg.text?.body || '';
    if (from === ALLOWED()[0]) {                             // v9: outreach / contacts / auto-reply / goals commands, voice polish follow-ups
      const v9 = await V9.ownerCommand(userText, ctx, D9, from).catch(e => { log('v9 command failed', e.message); return null; });
      if (v9) return finish(v9, null, null);
      if (state.lastPolish && Date.now() - state.lastPolish.at < 30 * 60e3 && V9.POLISH_FOLLOW_RE.test(userText)) {
        const ask = /^\s*(polish( it)?|clean (it|this) up|send-?ready)\s*[.!?]*\s*$/i.test(userText) ? 'polish' : userText;
        const base = ask === 'polish' ? (state.lastPolish.transcript || state.lastPolish.text) : state.lastPolish.text;
        const ans = await askGemini([], [], [{ text: V9.polishPrompt(base, ask) }], started, { cool: state.cool, track: state, chain: CHAIN, maxTokens: 4096, system: 'You edit Michael\'s own words into clean, send-ready text without changing his voice or meaning. Output only the text.', src: 'polish' });
        if (!ans.ok) return finish('I couldn\'t redo it just now 😕 Try again in a minute.', null, null);
        const done = toWhatsApp(ans.text.trim());
        state.lastPolish = { ...state.lastPolish, text: done, at: Date.now() };
        await sendText(from, '✍️ Here it is 👇', ctx);
        return finish(done, userText, done);
      }
    }
    if (/^\s*\/?(?:usage|quota|limits?|my usage|today'?s usage)\s*[?.!]*\s*$/i.test(userText)) {   // v7: chat counts + every AI call today (jobs, sites) from Supabase
      const q = imageQuota(state);
      let extra = '';
      if (J.jobsOn()) { try { if (ctx.test) G.usage.clear(); else await G.flushUsage(J.rpc); extra = G.quotaText(await J.rpc('usage_get', { day: G.ptDay() }, 5000)); } catch (e) { log('quota read failed', e.message); } }
      return finish(V.usageText(state, { imgUsed: q.used, imgLimit: q.limit, active: V.active(kb).length }) + extra, null, null);
    }
    // v7.1: Monday & Friday Letters + one-off newsletter (owner only): letters · skip · unskip · subs · newsletter <text> (yes/no within 30 min)
    const nlDraft = async (text) => {
      const ans = await askGemini([], [], [{ text: NL.draftPrompt(text) }], started, { cool: state.cool, track: state, maxTokens: 1500, system: 'You write warm, plain newsletter emails for a Christian author, as him. Output only JSON.' });
      state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
      return ans.ok ? NL.parseDraft(ans.text) : null;
    };
    let nlr = null;
    try { nlr = await NL.command(userText, { ns: J.nsOf(ctx), isOwner, state, draft: nlDraft, credits: ctx.test ? async () => +(ctx.nlCredits ?? 300) : undefined }); }
    catch (e) { log('newsletter command failed', e.message); if (NL.NEWSLETTER_RE.test(userText) || NL.LETTERS_RE.test(userText) || NL.SKIP_RE.test(userText) || NL.UNSKIP_RE.test(userText) || NL.SUBS_RE.test(userText)) nlr = { reply: '📬 The newsletter store didn\'t answer just now 😕 Try again in a minute.' }; }
    if (nlr) {
      if (nlr.kick) { const k = await V.setNextWake(ctx.test ? 'newsletter-test' : 'newsletter', Date.now()); if (ctx.test) ctx.nlKick = { id: nlr.kick, ok: !!k.ok }; }
      return finish(nlr.reply, null, null);
    }
    // v7.2: today's verse from Sow (the same post the 6am push sends)
    if (VS.VERSE_RE.test(userText)) {
      if (!isOwner) return finish('Only Michael can use that on this line.', null, null);
      if (!VS.verseOn()) return finish('📖 The daily verse isn\'t connected yet (Sow key missing). Tab will fix it.', null, null);
      let res = null, post = null;
      try { ({ post } = await VS.fetchToday()); if (post) res = await VS.sendVerse(post, ctx, { sendText, uploadMedia, sendImage, owner: from }); }
      catch (e) { log('verse failed', e.message); }
      if (!post) return finish(res === null ? '📖 Sow didn\'t answer just now 😕 Try *verse* again in a minute.' : '📖 There\'s no verse post in Sow for today yet.', null, null);
      if (!res || !res.ok) return finish('📖 I couldn\'t send today\'s verse just now 😕 Try *verse* again in a minute.', null, null);
      state.lastIn = now();
      state.history.push({ role: 'user', text: userText, at: now() });
      state.history.push({ role: 'model', text: `[I sent Michael today's verse post from Sow: ${post.title} (${post.reference})]`, at: now() });
      await syncSched(state, kb, ctx);
      await Promise.all([saveState(from, state, ctx), kbDirty ? saveKB(from, kb, ctx) : null]);
      return { reply: VS.captionOf(post), verse: { title: post.title, reference: post.reference, image: res.image } };
    }
    // v8: brain · learn <text or link> · learned · unlearn N (owner only)
    if (BR.BRAIN_RE.test(userText)) {
      if (!isOwner) return finish('Only Michael can see that on this line.', null, null);
      let rows = [], stats = null;
      if (J.jobsOn()) { try { if (ctx.test) G.usage.clear(); else await G.flushUsage(J.rpc); rows = await J.rpc('usage_get', { day: G.ptDay() }, 5000); } catch (e) { log('usage read failed', e.message); } }
      try { stats = await BR.brainRpc('stats', { ns: 'wa' }, 4000); } catch (e) { log('brain stats failed', e.message); }
      return finish(BR.brainText(state, { rows, stats, autoCount: kb.facts.filter(f => f.auto).length }), null, null);
    }
    const lm8 = userText.match(BR.LEARN_RE);
    if (lm8) {
      if (!isOwner) return finish('Only Michael can teach me on this line.', null, null);
      let body = lm8[1].trim(), title = body.slice(0, 60).replace(/\s+/g, ' '), url = null;
      const link = body.match(/^https?:\/\/\S+/i);
      if (link) {
        url = link[0];
        try { const p = await fetchPage(url); if (!p || !p.ok || !String(p.text || '').trim()) return finish('🔗 I couldn\'t read that page 😕 Paste the text instead: *learn <text>*', null, null); body = `${p.title ? p.title + '\n' : ''}${String(p.text).slice(0, 60000)}`; title = (p.title || url).slice(0, 120); }
        catch (e) { return finish('🔗 I couldn\'t open that link 😕 Paste the text instead: *learn <text>*', null, null); }
      }
      if (BR.looksSecret(body)) return finish('🔒 That looks like it has a password, key or account number in it, so I won\'t store it. Leave those out and send it again.', null, null);
      try {
        const r = await BR.learn({ text: body, title, url, ns: J.nsOf(ctx) });
        if (!r.ok) return finish('Send some text after *learn*, e.g. _learn My next book is called "Abba"_', null, null);
        return finish(`📚 Learned${url ? ` from *${title}*` : ''}: ${r.chunks} part${r.chunks > 1 ? 's' : ''} added to what I know about your world. Ask me about it anytime.\n_learned · unlearn <n>_`, null, null);
      } catch (e) { log('learn failed', e.message); return finish('📚 My memory store is busy 😅 Try *learn* again in a minute.', null, null); }
    }
    if (BR.LEARNED_RE.test(userText)) {
      if (!isOwner) return finish('Only Michael can see that on this line.', null, null);
      try {
        const list = await BR.brainRpc('learned', { ns: J.nsOf(ctx), n: 15 }, 5000);
        if (!list || !list.length) return finish('Nothing added with *learn* yet. Try: _learn <text or link>_', null, null);
        return finish('📚 *Things you taught me with learn* (newest first)\n' + list.map(x => `${x.id}. ${x.title}${x.url ? ` (${x.url})` : ''}`).join('\n') + '\n\nRemove one: *unlearn <number>*', null, null);
      } catch (e) { return finish('📚 My memory store is busy 😅 Try again in a minute.', null, null); }
    }
    const ul8 = userText.match(BR.UNLEARN_RE);
    if (ul8) {
      if (!isOwner) return finish('Only Michael can do that on this line.', null, null);
      try { const r = await BR.brainRpc('del_id', { ns: J.nsOf(ctx), id: +ul8[1] }, 5000); return finish(r?.deleted ? `🗑️ Removed #${ul8[1]}.` : `There's no learned item #${ul8[1]}. Send *learned* to see the numbers.`, null, null); }
      catch (e) { return finish('📚 My memory store is busy 😅 Try again in a minute.', null, null); }
    }
    const cmd = command(userText, state, kb);
    const lr = state.lastRead;
    const wasAwaiting = !!(lr && lr.awaiting);
    if (lr) lr.awaiting = false;                             // "yes" only counts as save right after a summary
    const wasMore = !!(lr && lr.more);
    if (lr) lr.more = false;                                 // v5.1: "more" only continues right after a full-text send
    if (cmd) {
      if (cmd.saveKB) kbDirty = true;
      return finish(cmd.reply, null, null);
    }
    if (lr && !lr.saved && Date.now() - lr.at < 24 * 3600e3) {
      const draftNewer = state.pending && Date.parse(state.pending.at) > lr.at;
      if (SAVE_ONLY_RE.test(userText) || (wasAwaiting && !draftNewer && SAVE_RE.test(userText))) return saveFlow(userText);
    }
    if (lr && lr.text && Date.now() - lr.at < 24 * 3600e3) {   // v5.1: send the text of the last file/page back
      if (wasMore && F.MORE_RE.test(userText)) return fullTextFlow(userText, lr.part || 0);
      if (F.FULL_TEXT_RE.test(userText)) return fullTextFlow(userText, 0);
    }
    const spq = SP.detect(userText);                          // v8: Sow first-class (next 3, week, posted, a day's posts, add a post)
    if (spq) {
      if (!isOwner) return finish('Only Michael can use Sow on this line.', null, null);
      try {
        if (spq.op === 'next') { if (!SOW.sowOn()) throw new Error('store off'); return finish(SP.nextText(await BR.brainRpc('sow_next', { n: 3 }, 6000)), null, null); }
        if (spq.op === 'add') {
          if (!SOW.sowOn()) return finish('🌱 Sow isn\'t connected yet. Tab will set it up.', null, null);
          const ps = SOW.parseSchedule(`${spq.when} Sow post`);
          if (!ps.ok) return finish(ps.past ? 'That time has already passed 🙂 Pick a later time.' : `When should it go out? Try: _add a post for Friday 7pm about ${spq.topic.slice(0, 40)}_`, null, null);
          const ans = await askGemini([], kb.facts, [{ text: SP.addPrompt(spq.topic, spq.when) }], started, { cool: state.cool, track: state, chain: LITE_FIRST, maxTokens: 600, lean: true, query: 'write a post as me: ' + spq.topic });
          state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
          const caption = ans.ok ? cleanPost(ans.text) : spq.topic;
          const w8 = SOW.watParts(ps.due);
          const row = await J.rpc('sow_add', { post_date: w8.date, post_time: w8.time, caption: caption.slice(0, 2200), title: (caption.split('\n').find(l => l.trim()) || spq.topic).replace(/[*_]/g, '').slice(0, 60) });
          state.sowLast = [...(state.sowLast || []), row.id].slice(-10);
          return finish(SOW.queuedText(row, { scheduled: true }) + (ans.ok ? '' : '\n_(AI was busy, so I queued your topic as the text. Edit it in Sow.)_'), userText, `[queued a Sow post for ${w8.date} ${w8.time}: ${caption.slice(0, 200)}]`);
        }
        if (!SP.sowApiOn()) return finish('🌱 Sow isn\'t connected yet (key missing). Tab will fix it.', null, null);
        if (spq.op === 'week') return finish(await SP.week(), null, null);
        if (spq.op === 'day') return finish(SP.dayText(await SP.day(spq.date), spq.date), null, null);
        if (spq.op === 'posted') {
          const r = await SP.markPosted(spq.platform);
          if (r.none) return finish('🌱 There\'s no Sow post for today to mark.', null, null);
          return finish(r.ok ? `✅ Marked *${r.post.title || 'today\'s post'}* as posted on ${SP.PLATFORMS[spq.platform]}.${r.posted ? `\nPosted so far: ${Object.keys(r.posted).map(k => SP.PLATFORMS[k] || k).join(', ')}` : ''}` : '🌱 Sow didn\'t accept that just now 😕 Try again in a minute.', null, null);
        }
      } catch (e) { log('sow failed', e.message); return finish('🌱 Sow didn\'t answer just now 😕 Try again in a minute.', null, null); }
    }
    const v7 = await v7Intent(userText);                      // v7: orders/data/export, repos, research, post/schedule, media
    if (v7) return v7;
    const ai = await agentIntent(userText);                   // v6: build / edit / agent jobs, jobs, my sites, zip, apk
    if (ai) return ai;
    if (state.remPending && Date.now() - state.remPending.at < V97.REM_PENDING_MS && V97.pendingAnswer(userText) && !V.parseReminder(userText)) {   // v9.7: was 20 min + any 'today'
      const req = state.remPending.text; state.remPending = null;           // v8: "the three time" / "8pm" answers the reminder question
      const res = R8.resolveAnswer(req, userText);
      if (res) return reminderFlow(res, `${req} → ${userText}`);
      if (!state.remPendingReasked) {                          // v9.3: an answer we can't turn into a time -> ask once more, never guess or chat
        state.remPending = { text: req, at: Date.now() }; state.remPendingReasked = true;
        return finish(`⏰ I need the exact time${/\b(three|all|both|each)\b/i.test(userText) ? 's' : ''} for: _${req.replace(/^\s*(?:please\s+)?(?:set (?:a )?reminders? (?:for|to)|remind me (?:to )?)\s*/i, '').slice(0, 120)}_\nSend them like: _7pm, 8pm and 9pm_ or _tomorrow 7am_.`, null, null);
      }
    }
    state.remPendingReasked = false;
    const remQ = V97.remindQuestion(userText);               // v9.7: "remind me what my newsletter is called" is a question
    const pr = remQ ? null : R8.parseAny(userText);          // v8: several times in one request first, then the v5 parser
    if (pr) return reminderFlow(pr, userText);
    const im = detectImage(userText);
    if (im) return imageFlow(im, userText);
    const fb = V95.imageFeedback(userText, state.lastImage, { pending: !!state.pending });   // v9.5: "again" / "brighter" / "make it more Nigerian" right after a picture
    if (fb) return imageFlow(fb, userText);
    const pm = userText.match(POST_RE);
    if (pm) {
      if (!pm[1].trim()) return finish('Tell me the topic or paste the text after *post:*, e.g.\n_post: Ruth\'s loyalty_', null, null);
      const li = state.lastImage;
      if (li && Date.now() - li.at < 6 * 3600e3 && /\b(this|the|that|last|same|my|your)\s+(image|picture|pic|photo|drawing)\b/i.test(pm[1])) {
        const brief = pm[1].replace(/\s*\b(with|using|and|plus|on)?\s*(this|the|that|last|same|my|your)\s+(image|picture|pic|photo|drawing)\b/i, ' ').trim() || li.prompt;
        return draftFlow({ brief, parts: [{ text: draftPrompt(brief) + `\n(The post will carry a picture you made for him: ${li.prompt}. Write the caption to fit it.)` }], userText, imageId: li.mediaId });
      }
      return draftFlow({ brief: pm[1].trim(), parts: [{ text: draftPrompt(pm[1].trim()) }], userText });
    }
    const rd = detectRead(userText);
    if (rd && !(state.pending && !rd.url)) return readFlow(rd, userText);
    const sq = V.detectSearch(userText) || BR.detectFresh(userText);   // v8: more "fresh info" questions go to the live web
    if (sq) { const done = await searchFlow(sq, userText); if (done) return done; }
    if (state.pending) {
      if (YES_RE.test(userText)) return publishFlow(userText);
      if (CANCEL_RE.test(userText)) { state.pending = null; return finish('🗑️ Draft dropped. Nothing was posted.', userText, 'Draft dropped.'); }
      const ed = await askGemini(state.history, kb.facts, [{ text: `Current draft of Michael's Facebook post (written as him):\n"""${state.pending.text}"""\n\nMichael just replied: """${userText}"""\n\nIf his reply is feedback or an instruction about this draft, rewrite it and reply with ONLY the full new post text (no notes, no markdown). If his reply is clearly about something else (a new question or topic), reply with exactly: NOT_ABOUT_DRAFT` }], started, { cool: state.cool, track: state });
      state.cool = Object.fromEntries(Object.entries(ed.cool || {}).filter(([, v]) => v > Date.now()));
      if (ed.ok && !/NOT_ABOUT_DRAFT/.test(ed.text)) {
        state.pending.text = cleanPost(ed.text); state.pending.at = new Date().toISOString();
        return finish('✏️ *Updated draft:*\n\n' + state.pending.text + DRAFT_TAIL, userText, 'Updated draft:\n' + state.pending.text);
      }
      if (!ed.ok) return finish(ed.quota ? 'I\'ve used up today\'s free AI quota ⏳ so I can\'t edit the draft right now. Reply *yes* to post it as it is, or try later.' : 'I couldn\'t edit the draft just now 😅 Try again, or reply *yes* to post it as it is.', null, null);
      // unrelated message: answer normally, the draft stays pending
    }
    const qa = state.lastQA;                                 // v5: same question re-sent within 3 min -> same answer, no quota
    if (qa && qa.q === userText.trim() && Date.now() - qa.at < 3 * 60e3 && !state.pending) { V.bump(state, 'cache'); return finish(qa.reply, null, null); }
    userParts = [{ text: userText }];
    const isFile = !!(lr && String(lr.kind || '').startsWith('file-'));
    if (lr && Date.now() - lr.at < (isFile ? FILE_FRESH_MS : READ_FRESH_MS) && (lr.text || lr.summary)) {
      userParts = isFile
        ? [{ text: `(Context from Tab's file reader, not typed by Michael: the last file he sent you was "${lr.title}"${lr.cut ? ` (first ${F.FILE_CAP} of ${lr.len} characters)` : ''}. Use it only if his message is about it; answer from the file and say so if the answer isn't in it.)\n"""\n${String(lr.text || lr.summary).slice(0, 30000)}\n"""` }, { text: userText }]
        : [{ text: `(Context from Tab's link reader, not typed by Michael: the last page he asked you to read was "${lr.title}" ${lr.url}. Use it only if his message is about it.)\n"""\n${String(lr.text || lr.summary).slice(0, 15000)}\n"""` }, { text: userText }];
    }
  } else if (msg.type === 'video') {                        // v7: light video work (trim / compress / caption / extract audio)
    const v = msg.video || {};
    state.lastMedia = { ...(state.lastMedia || {}), video: { id: v.id, mime_type: v.mime_type || 'video/mp4', at: Date.now(), ...(ctx.test && v._test_b64 ? { _test_b64: v._test_b64 } : {}) } };
    const mc = parseMediaCmd(v.caption || '');
    if (mc && mc.op === 'bad') return finish(mc.why, null, null);
    if (mc && mc.op !== 'imgaudio') return mediaJob(mc, { video: mediaRef(state.lastMedia.video) });
    return finish('🎬 Got your video. What should I do with it?\n• *trim 0:05-0:20* (or *trim first 30 sec*)\n• *compress*\n• *caption Your text here*\n• *extract audio* (MP3)\n_Tip: put the command in the video\'s caption next time._', null, null);
  } else if (msg.type === 'audio' || msg.type === 'voice') {
    { const a = msg.audio || msg.voice || {}; state.lastMedia = { ...(state.lastMedia || {}), audio: { id: a.id, mime_type: a.mime_type || 'audio/ogg', at: Date.now(), ...(ctx.test && a._test_b64 ? { _test_b64: a._test_b64 } : {}) } }; }
    if (ctx.test && (msg.audio || msg.voice)?._test_b64 && state.lastMedia.image && Date.now() - state.lastMedia.image.at < 3 * 3600e3) return finish('🎵 Got the audio. Send *make video* to put it on your picture.', null, null);
    try {
      const m = await downloadMedia(msg.audio?.id || msg.voice?.id);
      userParts = [{ inline_data: { mime_type: m.mime || 'audio/ogg', data: m.data } }, { text: from === ALLOWED()[0] ? V9.VOICE_V9 : VOICE_NOTE }];   // v9: transcript + send-ready version
      userText = '[voice note]'; media = true;
    } catch (e) { log('voice download failed', e.message); return finish('I couldn\'t open that voice note 🙏 Please try again, or type it.', null, null); }
  } else if (msg.type === 'image' && F.READ_CAPTION_RE.test(msg.image?.caption || '')) {   // v5.1: "read this" on a photo of a page
    return fileFlow({ media: msg.image, name: '', mime: msg.image?.mime_type || 'image/jpeg', caption: msg.image?.caption || '', viaImage: true });
  } else if (msg.type === 'image') {
    { const im = msg.image || {}; state.lastMedia = { ...(state.lastMedia || {}), image: { id: im.id, mime_type: im.mime_type || 'image/jpeg', at: Date.now(), ...(ctx.test && im._test_b64 ? { _test_b64: im._test_b64 } : {}) } }; }
    const icmd = parseMediaCmd(msg.image?.caption || '');
    if (icmd && icmd.op === 'imgaudio') {
      const lm = state.lastMedia;
      if (lm.audio && Date.now() - lm.audio.at < 3 * 3600e3) return mediaJob(icmd, { image: mediaRef(lm.image), audio: mediaRef(lm.audio) });
      return finish('🎬 Nice picture. Now send the voice note or audio file, then *make video*.', null, null);
    }
    try {
      const m = ctx.test && msg.image._test_b64 ? { data: msg.image._test_b64, mime: msg.image.mime_type } : await downloadMedia(msg.image.id);
      const cap = msg.image.caption || '';
      const pcap = cap.match(POST_RE);
      if (pcap) return draftFlow({ brief: pcap[1].trim(), parts: [{ inline_data: { mime_type: m.mime || 'image/jpeg', data: m.data } }, { text: draftPrompt(pcap[1].trim()) + '\n(The picture above will be posted with this text as its caption.)' }], userText: `[picture] ${cap}`, imageId: msg.image.id, media: true });
      const tm = cap.match(TEACH_RE);
      if (tm && addFact(kb, tm[1])) { kbDirty = true; }
      userParts = [{ inline_data: { mime_type: m.mime || 'image/jpeg', data: m.data } }, { text: cap ? `(Michael sent this picture with the caption:) ${cap}` : '(Michael sent this picture with no caption. Say what you see and how you can help.)' }];
      userText = `[picture]${cap ? ' ' + cap : ''}`; media = true;
    } catch (e) { log('image download failed', e.message); return finish('I couldn\'t open that picture 🙏 Please send it again.', null, null); }
  } else if (msg.type === 'document') {                     // v5.1: any document goes through the file reader
    if (from === ALLOWED()[0] && V9.isContactFile(msg.document?.filename, msg.document?.mime_type)) {   // v9: a contacts file -> outreach list
      try {
        const m = ctx.test && msg.document?._test_b64 ? { data: msg.document._test_b64 } : await downloadMedia(msg.document?.id);
        return finish(await V9.importFile(ctx.ns, from, msg.document?.filename || '', msg.document?.mime_type || '', Buffer.from(m.data, 'base64').toString('utf8'), msg.document?.caption || ''), null, null);
      } catch (e) { log('contacts file failed', e.message); return finish('I couldn\'t open that contacts file 🙏 Please send it again.', null, null); }
    }
    return fileFlow({ media: msg.document, name: msg.document?.filename || '', mime: msg.document?.mime_type || '', caption: msg.document?.caption || '' });
  } else {
    return finish('I can read text, voice notes, pictures, videos and files (PDF, Word, Excel, PowerPoint, text) for now 🙂', null, null);
  }

  // v8: route (easy -> Lite, hard -> strong while today's per-key budget lasts, else Lite + step-by-step), pull his own
  // material for this message (letters, books, projects, learn), and pick up durable facts about him in parallel.
  const rt = BR.route(userText, media, state, { cool: state.cool });
  const rAsk = msg.type === 'text' ? V93.replyAsk(msg, userText) : null;   // v9.3: "reply to this" / a forwarded message -> 3 replies
  const voice = V.needsVoice(userText) || Boolean(rAsk);
  const remQ97 = msg.type === 'text' && V97.remindQuestion(userText);   // v9.7: "remind me what …" -> answer it, no reminder talk
  let extra = (rAsk ? V93.REPLY_EXTRA(rAsk) : '') + (remQ97 ? V97.REMIND_Q_EXTRA : '') + (!remQ97 && /\b(remind|reminder|reminders|alarm|alert|set (?:it|them))\b/i.test(userText) || (state.history || []).slice(-4).some(h => /remind/i.test(h.text || '')) ? V93.remindersBlock(V.active(kb), d => V.fmtWhen(d)) : '');   // v9.3
  const cAsk = msg.type === 'text' && !rAsk ? V96.codeAsk96(userText) : null;   // v9.5: coding asks get a focused checklist + more room
  const pAsk = msg.type === 'text' && !rAsk && !cAsk && V96.promptAsk96(userText);   // v9.5: image prompt / design-idea asks
  if (ctx.test) ctx.skill = cAsk ? 'code:' + cAsk : pAsk ? 'image-prompt' : null;
  if (msg.type === 'text' && BR.wantsRetrieval(userText)) {
    try {
      const rr = await BR.retrieve(userText, { ns: J.nsOf(ctx), voice, wide: Boolean(cAsk || pAsk) });   // v9.5: coding / image-prompt asks pull more know-how
      if (pAsk) rr.hits = V96.filterBrandHits(rr.hits, userText);   // v9.6: brand notes only when that brand is asked for
      extra += BR.brainBlock(rr.hits, { voice });
      state.lastBrain = { at: Date.now(), n: rr.hits.length, best: rr.best, ms: rr.ms, src: rr.hits.map(h => h.src) };
      if (ctx.test) ctx.brain = { ...state.lastBrain, titles: rr.hits.map(h => h.title) };
    } catch (e) { log('retrieval skipped', e.message); }
  }
  if (cAsk) extra += V95.CODE_EXTRA(cAsk, userText) + V96.CODE_EXTRA96(cAsk, userText);   // v9.6: the task instructions come last (after the notes)
  if (pAsk) extra += V95.PROMPT_EXTRA + V96.PROMPT_EXTRA96(userText);
  if (ctx.test) ctx.route = rt;
  const ansP = askGemini(state.history, kb.facts, userParts, started, { cool: state.cool, track: state, media, chain: cAsk ? BR.codeChain() : pAsk ? BR.promptChain(rt) : BR.chainFor(rt), deep: rt.level === 'hard', extra, lean: !media && !rAsk && !cAsk, query: userText, quality: userText === '[voice note]' ? '' : String(userText || ''), ...(userText === '[voice note]' || cAsk ? { maxTokens: 8192 } : {}), ...(cAsk ? { temperature: 0.3, thinking: 'medium', firstMs: 32000 } : {}) });   // v9.7: quality -> weak answers fall through   // v9: room for transcript + a full article
  const memoP = msg.type === 'text' && !cAsk && !pAsk && BR.wantsMemory(userText) ? autoMemory(userText, kb, started) : null;   // v9.5: bug reports and design briefs are not facts about him   // beside the answer, not before it
  const ans = await ansP;
  state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
  if (!ans.ok) {
    log('gemini failed', ans.status, ans.detail || '');
    if (media && ans.status === 400) return finish('I couldn\'t read that one 🙏 Please type it, or try again.', null, null);
    const m = ans.quota
      ? 'I\'ve used up today\'s free AI quota ⏳ It resets around 8–9am Nigeria time. Teach commands (/knowledge, teach: …) still work.'
      : 'I\'m having trouble thinking right now 😅 Please try again in a minute.';
    return finish(m, null, null);
  }
  log('answered with', ans.model);
  let modelText = pAsk ? V96.fixImageLines(V96.scrubInternal(ans.text), V96.selfAskChat(userText)) : cAsk ? V96.scrubInternal(ans.text) : ans.text;   // v9.6
  if (userText === '[voice note]') {
    const taught = voiceTeach(modelText);
    if (taught) {
      const fact = addFact(kb, taught);
      if (fact) { kbDirty = true; const reply = `Got it ✅ I'll remember: _${fact}_`; return finish(reply, '[voice note] teach: ' + fact, reply); }
    }
    const rem = modelText.match(/^\s*REMIND:\s*(.+)$/im);    // v8: a spoken reminder goes through the real reminder flow
    if (rem) {
      const said = /^\s*remind/i.test(rem[1]) ? rem[1].trim() : 'remind me ' + rem[1].trim();
      const pr = R8.parseAny(said) || { ok: false, ask: 'When should I remind you? e.g. _7pm_, _tomorrow 8am_, or _7pm, 8pm and 9pm_' };
      return reminderFlow(pr, '[voice note] ' + said);
    }
    const vp = V9.parseVoice(modelText);                    // v9: transcript + send-ready version (dictation) or transcript + answer (a question)
    if (vp) {
      state.lastPolish = { text: vp.polished || vp.transcript, transcript: vp.transcript, at: Date.now() };
      const tr = `🎙️ _${vp.transcript.replace(/_/g, ' ')}_`;
      if (vp.polished && !vp.answer) {
        await sendText(from, V9.voiceHeader(vp), ctx);   // transcript + what was done + unclear words; the clean text follows alone
        const done = toWhatsApp(vp.polished);
        return finish(done, '[voice note] ' + vp.transcript, done);
      }
      modelText = `${tr}\n\n${vp.answer || ''}`.trim();
      userText = '[voice note] ' + vp.transcript;
    }
    const first = modelText.split('\n')[0];
    if (first.startsWith('🎙')) userText = '[voice note] ' + first.replace(/^🎙️?\s*/, '').replace(/^_|_$/g, '');
  }
  // v8: the chat model can't set reminders or send things. A reply that claims it did is turned into the real action
  // (reminder found in this message or the last 20 min) or into an honest line. Never passed on as is.
  const claim = R8.claimsAction(modelText);
  if (claim && !rAsk && !remQ97 && (!V.needsVoice(userText) || (claim.kind === 'reminder' && /\bremind/i.test(userText)))) {   // v9.3: "remind me … post …" is still checked
    if (claim.kind === 'reminder') {
      const req = R8.recentRequest([...state.history, { role: 'user', text: userText, at: Date.now() }]);
      let res = R8.parseAny(String(userText).replace(/^\[voice note\]\s*/i, ''));
      if ((!res || !res.ok) && req && req !== userText) res = R8.resolveAnswer(req, userText) || R8.parseAny(req);
      if (res && res.ok) { log('chat claimed a reminder: doing it for real'); return reminderFlow(res, userText); }
      log('chat claimed a reminder it could not set: replaced'); modelText = R8.HONEST_REMINDER;
      if (req) state.remPending = { text: req, at: Date.now() };
    } else {
      log('chat claimed an action:', claim.match);
      modelText += '\n\n_⚠️ Nothing was actually sent or posted from this chat. To post: *post <text>* or *schedule <when> <text>*; email: *newsletter <text>*._';
    }
    if (ctx.test) ctx.claim = claim;
  } else if (!remQ97 && /\?/.test(modelText) && /\bremind/i.test(userText) && /\b(time|when|which)\b/i.test(modelText)) {
    state.remPending = { text: String(userText).replace(/^\[voice note\]\s*/i, ''), at: Date.now() };   // the model asked a reminder question: his answer goes to the reminder flow
  }
  let out = toWhatsApp(modelText);
  if (msg.type === 'text') state.lastQA = { q: String(userText).trim(), reply: out, at: Date.now() };
  if (memoP) {                                               // v8 auto-memory: show what was picked up, in one small line
    const mem = await memoP;
    if (mem && (mem.added.length || mem.replaced.length)) {
      kbDirty = true;
      const got = [...mem.added, ...mem.replaced.map(r => r.t)];
      out += `\n\n_📝 Noted: ${got.join(' · ')}_`;
      if (ctx.test) ctx.memory = mem;
    }
  }
  return finish(out, userText, modelText);
}

// ---------- v9.7: long-term memory (daily, from the 06:00 UTC cron before the brief; task=memory runs it alone) ----------
export async function longTermMemory(ctx = liveCtx(), { force = false } = {}) {
  const owner = ALLOWED()[0];
  if (!owner) return { skipped: 'no_owner' };
  const [state, kb0] = await Promise.all([loadState(owner, ctx), loadKB(owner, ctx)]);
  const since = force ? 0 : (kb0.settings.ltmAt || 0);
  const tr = V97.ltmTranscript(state.history, since);
  if (tr.users < (force ? 1 : 2)) return { skipped: 'nothing_new', new_messages: tr.users };
  const ans = await askGemini([], [], [{ text: V97.ltmPrompt(tr.text, kb0.facts) }], Date.now(), { cool: { ...(state.cool || {}) }, chain: BR.chainFor({ chain: 'hard' }), maxTokens: 1500, temperature: 0.2, system: 'You keep a personal assistant\'s long-term memory. Output only JSON.', src: 'ltm' });
  if (!ans.ok) return { skipped: 'ai_busy', tried: ans.tried };
  const kb = await loadKB(owner, ctx);                         // fresh copy: he may have taught something meanwhile
  const res = V97.applyLtm(kb, V97.parseLtm(ans.text), { similar: BR.similar, looksSecret: BR.looksSecret, michaelText: tr.mine });
  kb.settings.ltmAt = tr.last; kb.settings.ltmRun = new Date().toISOString();
  await saveKB(owner, kb, ctx);
  log('long-term memory', JSON.stringify({ ...res, model: ans.model }));
  return { ok: true, ...res, model: ans.model, new_messages: tr.users, learned_total: kb.facts.filter(f => f.ltm).length };
}

// ---------- morning nudge (Vercel Cron, once a day) ----------
const lagosDate = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
// v9.7: the morning brief's live data (each source optional; a slow or failed source is left out, never blocks the brief)
const within = (p, ms = 6000) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
export async function briefData(owner, state, kb, ctx, now = Date.now(), sunday = false) {
  const ns = J.nsOf(ctx), day = lagosDate(now), wk = 7 * 864e5;
  const d = { reminders: V.active(kb).filter(r => lagosDate(r.due) === day).slice(0, 6).map(r => ({ when: V.fmtWhen(r.due), text: String(r.text).slice(0, 80) })) };
  let jl = null, st = null;
  if (J.jobsOn()) {
    const [a, b, up, subs] = await Promise.all([within(J.rpc('list', { ns, owner, limit: 12 })), within(NL.rpc('status', { ns })), within(NL.rpc('upcoming', { ns, n: 1 })), within(NL.rpc('subs_count', {}))]);
    jl = Array.isArray(a) ? a : null; st = b && typeof b === 'object' ? b : null;
    if (jl) d.jobs = jl.filter(j => j.status === 'queued' || j.status === 'running').slice(0, 3).map(j => ({ id: j.id, kind: j.kind, brief: String(j.brief || '').replace(/\s+/g, ' ').slice(0, 60), status: j.status }));
    if (st || (Array.isArray(up) && up.length) || typeof subs === 'number') d.letter = { last: st ? { subject: st.subject, status: st.status, sent: st.sent || 0, total: st.total || 0, queued: st.queued || 0, failed: st.failed || 0 } : null, next: Array.isArray(up) && up[0] ? { on: up[0].send_on, subject: up[0].subject } : null, subs: typeof subs === 'number' ? subs : null };
  }
  d.recent = (state.history || []).filter(h => h.role === 'user' && now - (h.at || 0) < 48 * 3600e3).slice(-8).map(h => String(h.text || '').replace(/\s+/g, ' ').slice(0, 160));
  if (sunday) {
    const mine = (state.history || []).filter(h => h.role === 'user' && now - (h.at || 0) < wk);
    const oldest = (state.history || [])[0];
    const ts = j => Date.parse(j.updated || j.finished_at || j.created || '') || 0;
    d.week = { msgs: mine.length, msgsCapped: Boolean(oldest && now - (oldest.at || now) < wk && (state.history || []).length >= MAX_TURNS * 2),
      reminders: (kb.reminders || []).filter(r => r.sentAt && now - r.sentAt < wk).length,
      learned: (kb.facts || []).filter(f => (f.ltm || f.auto) && now - (Date.parse(f.at) || 0) < wk).length,
      letterSent: st && now - (Date.parse(st.started_at || '') || 0) < wk ? st.sent || 0 : null,
      jobsDone: jl ? jl.filter(j => j.status === 'done' && now - ts(j) < wk).length : null };
  }
  return d;
}

const FALLBACK_FOCUS = [
  'Message 3 small businesses with your portfolio (olaoluwa-studio.vercel.app) and price list',
  'Post one Faith & Film moment on Facebook this evening',
  'Recruit 2 more testers (collect their Gmails) toward the 12 for Google Play',
  'Write today\'s WhatsApp Channel post',
  'Follow up with anyone who asked about a website or video',
  'Draft the next Bible manga episode',
  'One Holy humour Reel idea: film it in 10 minutes',
];
export async function morningNudge(ctx = liveCtx(), { force = false, sunday: sundayTest = null } = {}) {
  const owner = ALLOWED()[0];
  if (!owner) return { skipped: 'no_owner' };
  const [state, kb] = await Promise.all([loadState(owner, ctx), loadKB(owner, ctx)]);
  if (kb.settings.nudge === false) return { skipped: 'nudge_off' };
  const today = lagosDate();
  if (!force && kb.settings.lastNudge === today) return { skipped: 'already_sent_today' };
  const lastIn = Math.max(state.lastIn || 0, ...state.history.filter(h => h.role === 'user').map(h => h.at || 0));
  // Meta only delivers free-form messages within 24h of his last message; don't even try outside it.
  if (!lastIn || Date.now() - lastIn > 23.5 * 3600e3) return { skipped: 'outside_24h_window', last_message_hours_ago: lastIn ? Math.round((Date.now() - lastIn) / 36e5) : null };
  const day = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' });
  // v9.7: live data first, never an item from the last 3 briefs, Sunday week review
  const sunday = ctx.test && sundayTest != null ? sundayTest : V97.isSundayLagos();   // sandbox can preview the Sunday review
  const data = await briefData(owner, state, kb, ctx, Date.now(), sunday);
  const recent = V97.recentBullets(state.history, 3);
  const ask = V97.briefPrompt(day, V97.briefDataText(data, sunday), recent, sunday);
  const ans = await askGemini([], kb.facts, [{ text: ask }], Date.now(), { cool: state.cool, track: state, chain: BR.chainFor({ chain: 'hard' }), maxTokens: 2048, quality: ask.slice(0, 80) });
  state.cool = Object.fromEntries(Object.entries(ans.cool || {}).filter(([, v]) => v > Date.now()));
  let text, removed = [];
  const n = Number(today.slice(-2));
  if (ans.ok) {
    const f = V97.staleFilter(toWhatsApp(ans.text), recent, V97.similarItem);
    removed = f.removed; text = f.text;
    if (!V97.bulletsOf(text).length) text = null;               // everything it wrote was a repeat: build it from the data instead
  }
  const fromData = !text;
  if (!text) text = V97.briefFallback(data, { sunday, focus: FALLBACK_FOCUS, recent, similar: V97.similarItem, seed: n });
  if (removed.length) log('brief: dropped repeated items', JSON.stringify(removed));
  const r = await sendText(owner, text, ctx);
  if (!r.ok) { log('nudge not delivered (handled quietly)', r.status || '', (r.detail || '').slice(0, 200)); return { skipped: 'meta_refused', status: r.status }; }
  state.history.push({ role: 'model', text, at: Date.now(), nudge: true });
  kb.settings.lastNudge = today;
  await Promise.all([saveState(owner, state, ctx), saveKB(owner, kb, ctx)]);
  return { sent: true, text, model: fromData ? 'fallback' : ans.model, removed, data_used: Object.keys(data).filter(k => data[k] && (!Array.isArray(data[k]) || data[k].length)) };
}

// ---------- HTTP ----------
function sigOk(raw, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) { log('WA_APP_SECRET not set: skipping signature check'); return true; }
  if (!header || !header.startsWith('sha256=')) return false;
  const want = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
export function isTest(request) {
  const want = process.env.WA_TEST_KEY || '';
  const got = request.headers.get('x-test-key') || '';
  if (!want || want.length < 16 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
}
const testCtx = request => ({ test: true, ns: 'wa-test', outbox: [], fbMock: request.headers.get('x-test-fb-mock') === '1', keepImage: request.headers.get('x-test-keep-image') === '1' });
const sentTexts = ctx => ctx.outbox.filter(b => b.type === 'text' || b.type === 'image' || b.type === 'media_upload').map(b => b.type === 'text' ? { to: b.to, text: b.text.body } : b.type === 'image' ? { to: b.to, image: b.image } : { upload: { bytes: b.bytes, mime: b.mime, b64: b.b64 } });

export async function GET(request) {
  const u = new URL(request.url);
  const p = u.searchParams;
  if (p.get('health') === '1') {
    const has = k => Boolean(process.env[k]);
    return Response.json({ ok: true, version: 2, build: 'v9.8', v98: RPC.health(), v97: V97.health(), v96: { patch: V96.PATCH, coding: 'code asks -> ' + BR.codeChain().slice(0, 6).join(' > ') + ' …; temp 0.3, medium thinking, first model 32 s even after a fast pro refusal; complete templates retrieved (3000 chars each)', images: 'format notes (flyer/status/thumbnail/square/book cover/banner), vague-brief default, draw-Michael route', knowhow: ['knowhow:debug-cases', 'knowhow:templates', 'knowhow:code96', 'knowhow:image-formats', 'knowhow:image-examples96', 'knowhow:image-playbook'] }, v95: { coding: 'coding asks -> strong model, checklist (ask for the error, one-line cause, complete files, numbered steps), 8K output, fenced splitting', image_prompts: 'prompt-craft rules + "write me a prompt" -> ready image: lines', image_feedback: 'again / brighter / make it … within 30 min redraws the last picture', face_rule: 'never draws Michael (picture bank)', brand_looks: ['retain', 'nigerian', 'blossom', 'faith', 'thumbnail'], knowhow: ['knowhow:code', 'knowhow:imagecraft', 'voice:*'] }, v93: { retrieval: 'taught facts picked per message (topics + keywords + pinned + newest), lean ' + V93.LEAN_BUDGET + ' / full ' + V93.FULL_BUDGET + ' chars', skills: ['images', 'coding', 'video (honest)', 'reply drafts x3', 'know-how bank (knowhow:* in kchunks)'], knowledge_view: true }, v9: { outreach: true, template: V9.TPL_NAME(), autoreply: true, voice_polish: true, growth_nudge: 'monday 08:00 lagos', digest: '20:00 lagos' }, v8: { routing: 'rules: easy -> lite, hard -> strong (gemini-3.6-flash family) while ' + BR.STRONG_PER_KEY() + '/key/day lasts, then lite + step-by-step', strong_per_key: BR.STRONG_PER_KEY(), providers: ['gemini', ...PV.available()], provider_env: ['GROQ_API_KEY', 'OPENROUTER_API_KEY'], keys: G.keys().filter(k => k.v).length, key_env: ['GEMINI_API_KEY', 'GEMINI_API_KEY_2'], retrieval: BR.brainOn() ? 'gemini-embedding-001 768d in supabase pgvector michael_ai.kchunks' : 'off', auto_memory: true, fresh_search: true, vision: 'photos + PDFs/Office via gemini (since v4/v5.1)', cmds: ['brain', 'learn <text|link>', 'learned', 'unlearn <n>', 'sow', 'sow week', 'sow <day>', 'posted <platform>', 'add a post for <when> about <topic>'], sow: SP.sowApiOn() ? 'sow api + sp_posts' : 'sp_posts only (SOW_API_KEY missing)' }, v72: { daily_verse: VS.verseOn() ? 'sow /api/today -> 06:00 Lagos via pg_cron gate row verse (24h window only, once a day)' : 'off (SOW_API_KEY missing)', verse_cmd: ['verse', 'today', 'daily verse'] }, v92: { sow_pings: 'sow-ng cron -> /api/cron?task=sowping (x-sow-key); window shut -> held, one summary on his next message; fails once/day per platform+reason; cmds sow pings on|off' }, v91: { nl_preview: 'full letter at 20:00 Lagos; window shut -> approved template nudge (' + NL.PREVIEW_TEMPLATES().join(' | ') + ') + held until his next message' }, v71: { newsletter: NL.nlOn() ? 'monday & friday letters, 08:00 Lagos via pg_cron gate row newsletter' : 'off (store env missing)', newsletter_mail: NL.mailOn(), newsletter_cmds: ['letters', 'skip', 'unskip', 'subs', 'newsletter <text>'], newsletter_reserve: NL.RESERVE() }, v7: { site_backend: J.jobsOn(), site_data_api: '/api/site-data', payments: B.paymentsOn() ? 'paystack on' : 'built, off (no Paystack keys yet)', repos: GR.repoOn(), repo_branch_prefix: 'mai/', repo_protected: GR.PROTECTED(), research: J.jobsOn(), research_pdf: true, media: 'ffmpeg via /api/media', sow_posts: SOW.sowOn(), gemini_key2: G.keys().filter(k => k.v).length > 1, quota_cmd: true, apk: 'real signed APK via PWABuilder cloud packager (no account), hosted at <site>/app.apk' }, storage: J.jobsOn() ? 'supabase kv (blob read-fallback)' : (has('BLOB_READ_WRITE_TOKEN') ? 'vercel blob' : 'none'), gemini_keys: G.keys().filter(k => k.v).length, agent: J.jobsOn() && has('VERCEL_TOKEN') && has('GEMINI_API_KEY'), jobs: J.jobsOn(), deploy: has('VERCEL_TOKEN'), builds_daily_limit: J.BUILD_DAILY_LIMIT(), agent_tools: ['web_search', 'web_read', 'make_image', 'build_site', 'remember', 'send_update'], job_runner: 'supabase michael_ai.jobs + pg_cron michael-ai-jobs (every minute) + self-chain, 300 s per tick', file_read: true, file_types: ['pdf', 'docx', 'xlsx', 'pptx', 'txt/csv/md/json/html', 'image (photo of a page)'], file_ocr: 'gemini inline (lite-first rotation) for scans/photos, max ' + Math.round(F.MAX_INLINE / 1048576) + ' MB', file_max_mb: Math.round(F.MAX_DOWNLOAD / 1048576), file_text_cap: F.FILE_CAP, reminders: true, scheduler: V.schedOn() ? 'supabase pg_cron (every minute, wakes only when due) + daily vercel cron + on each message' : 'daily vercel cron + on each message (gate env missing)', reminder_tz: 'Africa/Lagos', search: 'keyless: duckduckgo -> bing -> ddg-lite (+ google-news-rss, wikipedia) -> gemini summary with 1-3 sources', search_daily_limit: V.SEARCH_LIMIT(), models: { hard: V.HARD_CHAIN, easy: V.EASY_CHAIN }, usage_cmd: true, kb_limit: KB_LIMIT, multi_teach: true, read_links: true, image_gen: primaryProvider(), image_fallback: providerList().includes('pollinations-free') ? 'pollinations-free (keyless, best-effort)' : 'off', image_providers: providerList(), img_daily_limit: +(process.env.IMG_DAILY_LIMIT || 20), verify_token: has('WA_VERIFY_TOKEN'), wa_token: has('WA_TOKEN'), phone_id: has('WA_PHONE_ID'), app_secret: has('WA_APP_SECRET'), store: has('BLOB_READ_WRITE_TOKEN'), gemini: has('GEMINI_API_KEY'), owner_only: ALLOWED().length > 0, test_key: has('WA_TEST_KEY'), cron_secret: has('CRON_SECRET'), fb_page: fbConfigured(), profile_words: PROFILE.split(/\s+/).length, dry_run: DRY(), graph: process.env.WA_GRAPH_VERSION || 'v26.0' });
  }
  const want = process.env.WA_VERIFY_TOKEN || '';
  if (p.get('hub.mode') === 'subscribe' && want && p.get('hub.verify_token') === want) {
    return new Response(p.get('hub.challenge') || '', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request) {
  const raw = await request.text();
  const test = isTest(request);
  if (!test && !sigOk(raw, request.headers.get('x-hub-signature-256'))) { log('bad signature'); return new Response('bad signature', { status: 401 }); }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }
  const ctx = test ? testCtx(request) : liveCtx();
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field && change.field !== 'messages') continue;
      const name = v.contacts?.[0]?.profile?.name;
      for (const msg of v.messages || []) jobs.push(processMessage(msg, name, ctx).catch(e => { log('process error', e.stack || e.message); return { error: e.message }; }));
      // v5: only FAILED statuses matter (e.g. 131047: a reminder sent after the 24h window closed); sent/delivered/read are ignored
      for (const st of v.statuses || []) if (st.status === 'failed') jobs.push(onFailedStatus(st, ctx).catch(e => ({ error: e.message })));
    }
  }
  const all = Promise.all(jobs);
  if (test || process.env.WA_SYNC === '1') return Response.json({ ok: true, test, results: await all, sent: sentTexts(ctx) });
  if (jobs.length) waitUntil(all);
  return new Response('EVENT_RECEIVED', { status: 200 });
}
