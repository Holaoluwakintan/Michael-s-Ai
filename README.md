# Michael AI

Private AI assistant for Olaoluwa Michael. Static PWA in `public/` + `api/chat.js` (Gemini). `api/whatsapp.js` is the WhatsApp Cloud API webhook (v2, 6 Oct 2026; v3 same day: 60k knowledge limit + multi-teach; v4 same day: link reading + image generation, code in `api/_extras.js`): Michael's PERSONAL assistant, owner-only.

Storage (private Vercel Blob store `michael-ai-wa`): `wa/<number>.json` = chat history (last 20 turns), dedupe ids, model cool-downs, pending Facebook draft; `wa/<number>.knowledge.json` = taught facts + settings (nudge on/off). `wa/others/<number>.json` = when the private line was last sent to a stranger. Test runs use `wa-test/`.
Base profile: `api/_profile.js` (always in the system prompt, shown by /profile, cannot be /unteach-ed).

Env (Vercel, never in code): GEMINI_API_KEY, APP_PASSCODE, BLOB_READ_WRITE_TOKEN, WA_VERIFY_TOKEN, WA_ALLOWED (owner allowlist, default 2348148034092), WA_TOKEN, WA_PHONE_ID, WA_WABA_ID, optional WA_APP_SECRET, WA_GRAPH_VERSION (v26.0), WA_TEST_KEY (sandbox test path), CRON_SECRET (morning nudge), FB_PAGE_ID + FB_PAGE_TOKEN (Facebook Page posting).

WhatsApp commands: teach: <fact> (v3: several lines starting with "teach:" in ONE message = one fact each, reply "✅ Saved N facts"; an item runs to the next teach: line or a blank line; other lines are ignored; exact duplicates skipped; 600 chars per fact) (or a voice note starting with "teach"; "remember that…" also works), /knowledge, /unteach N, /profile, /new, /nudge on|off, /help, post: <topic> -> draft -> "yes" posts to the Facebook Page, any other reply edits, "cancel" drops.
Models: gemini-flash-latest -> gemini-3-flash-preview -> gemini-flash-lite-latest -> gemini-3.1-flash-lite -> gemini-2.5-flash-lite. A daily 429 parks a model until midnight Pacific; every path replies.
Morning nudge: Vercel Cron `0 6 * * *` -> /api/cron (07:00-08:00 Lagos). Skips when Michael hasn't messaged in 23.5h (Meta's 24h window), when /nudge off, or when already sent today; Meta refusals are logged only.

Taught facts sent to the model: up to KB_LIMIT = 60,000 chars (v3; was 20,000). On overflow the oldest quarter + the newest facts are kept.
Tests: `node t_v2.mjs` and `node t_v3.mjs` (multi-teach, limit; needs BLOB_READ_WRITE_TOKEN) (mocked Gemini, real Blob under wa-test/). Production sandbox: POST /api/whatsapp with header `x-test-key: $WA_TEST_KEY` (sends nothing, returns the replies; add `x-test-fb-mock: 1` to mock the Page post); GET /api/cron?force=1 with the same header.
Health: GET /api/whatsapp?health=1 (booleans only). Deploy: Vercel REST API (files upload + v13 deployments, framework null).

v4 (6 Oct 2026):
- Link reading: `read: <link>` (also `/read`, `summarise:`) or a message that is just a link (plus at most a short question). GitHub repos read through the public API (description, topics, language, stars, README); GitHub file links read raw; GitHub user pages list repos; other sites: HTML -> readable text (title, meta description, headings, paragraphs), 10 s timeout, 2 MB read cap, 30k chars to the model; PDFs by link go to Gemini inline (<1.9 MB). Facebook / Instagram / X / Threads / LinkedIn / TikTok links get a polite refusal + "copy the text, send it with teach:". Login walls and JS-only pages are detected and explained.
  The summary ends with "Reply *save* to add this to my knowledge, or ask me anything about it." `save` (any time within 24h, until saved) or `yes` (only as the very next message) stores 1-5 facts (Gemini Lite-first; fallback = title + start of page), 600-char cap, duplicates skipped, reply "✅ Saved N facts from <title>". The last page (20k chars) stays in chat state (`lastRead`) and rides along as context for 3 hours so follow-up questions work. /new clears it.
- Image generation: `image: <prompt>`, `draw: …`, `/image …`, `imagine: …`, or "generate/make/create an image/picture/wallpaper/poster of …". Sizes: default 1080x1350; `status`/`story`/`wallpaper`/`portrait` -> 1080x1920; `square`/`dp` -> 1080x1080; `landscape`/`banner` -> 1920x1080. Ack text "🎨 Drawing it…", then the image is uploaded to /PHONE_ID/media and sent as an image message with the prompt as caption. 20 per day (IMG_DAILY_LIMIT), counted per Pacific day, only successful images count. `post: <topic> with this image` (within 6h) drafts a Page post that carries the last generated image.
  Providers, in order (env-gated): POLLINATIONS_KEY (gen.pollinations.ai, model POLLINATIONS_MODEL default flux) -> CF_ACCOUNT_ID + CF_AI_TOKEN (Workers AI flux-1-schnell) -> Gemini image (GEMINI_API_KEY; free tier is "limit: 0" today, a 429 parks it until midnight PT; IMG_GEMINI=0 skips it) -> keyless Pollinations (image.pollinations.ai; best-effort, ~686x858 with a small watermark, often answers 402 "payment required"; IMG_ANON=0 disables).
  Health: image_gen = the keyed provider, or "pending_key"; image_fallback says whether the keyless route is on.
Tests: `node t_v4.mjs` (31 checks; real page fetches, mocked Gemini text, a live image call; if the keyless provider stays busy and no key is set, the live call is reported as SKIP and the send checks run on the last live image).


## v5 (6 Oct 2026): reminders, live web search, model rotation, usage
Code: `api/_v5.js` (helpers) + hooks in `api/whatsapp.js` + `api/cron.js`.

**Reminders** (Africa/Lagos time, UTC+1): "remind me at 5pm to …", "remind me tomorrow 7am …", "remind me in 2 hours …", "remind me on friday at 3pm …", "every day at 6am remind me …", "every weekday/monday …"; `reminders` lists, `cancel reminder 2`, `cancel all reminders`. Rules parse first; Gemini (Lite first) only when the rules can't find a time. Stored inside the knowledge blob (`kb.reminders`, `kb.missed`), so no extra Blob reads (Hobby Blob: 10k reads + 2k writes a month).
Scheduler: Supabase project rlbrhpjljjgpqpqjrpkc (Blossom), schema `michael_ai` (private, not exposed): pg_cron job `michael-ai-reminders` runs `michael_ai.tick()` every minute; it calls `POST /api/cron?task=reminders` (Authorization: Bearer SCHED_KEY, via pg_net) ONLY when `michael_ai.sched.next_due` has passed (retry backoff 2,4,8…60 min if the call doesn't re-arm). The bot re-arms it through `public.michael_ai_set_next(p_key, p_name, p_due)` (SECURITY DEFINER, anon-callable, checks SCHED_KEY). Rows: `live`, `test` (= `&sandbox=1`, wa-test namespace, sends nothing). Backups: the daily Vercel cron also sweeps reminders, and every incoming message delivers anything due. Job `michael-ai-cleanup` trims cron.job_run_details daily.
24h rule: a reminder due when Michael hasn't written in 24h is not sent; it goes to `kb.missed` and he gets "⏰ Missed while the chat was asleep: …" with his next message (also shown in `reminders`). Meta's later failed status (131047) for a sent reminder is caught from the webhook `statuses`. If a reminder falls in the day after the window closes, he gets a heads-up 23h after his last message ("reply anything"). No approved template on the test WABA fits reminders (only hello_world + Jasper's Market samples).

**Search**: "search: …" (also google:/look up:) or a fresh-info question (news, exchange/dollar rate, weather, who won, latest …?). Keyless: DuckDuckGo HTML → Bing → DuckDuckGo lite (via node:https; Node's fetch gets bot pages) + Google News RSS for newsy asks + Wikipedia last; top 2 pages read with the v4 reader; Gemini (Lite first, short system prompt) answers with [n] citations; reply ends with 1–3 source links. 30/day cap (SEARCH_DAILY_LIMIT), 30-min cache per query. Gemini google_search grounding is 429 on the free key (no free quota).

**Models**: SMART gemini-3.6-flash, flash-latest, 3.8-flash, 3.5-flash → LITE flash-lite-latest (3.5-flash-lite), 3.1-flash-lite → GEMMA gemma-4-26b-a4b-it, gemma-4-31b-it. Hard/long/writing/media asks start SMART; short asks start LITE (saves Flash). 429 parks a model (till midnight PT if Google says per-day, else 10 min), 503 parks 5 min, timeout 3 min; per-model timeouts 25 s then 15 s. Gemma gets thinkingLevel "minimal". Everyday chat uses a lean prompt (no voice-pack examples; only relevant taught facts once they pass 6k chars). Same question re-sent within 3 min = cached answer. `usage` shows today's counts per model and feature.

Env added: SCHED_KEY, SB_URL, SB_ANON_KEY (optional SEARCH_DAILY_LIMIT). Tests: t_v2, t_v3, t_v4, t_v5 (`BLOB_READ_WRITE_TOKEN=… node t_v5.mjs`).


## v5.1 (6 Oct 2026): file reading

Send the bot a document and it pulls the text out, summarises it, answers questions on it, *save* keeps 1–5 facts and *full text* sends the text back.

- Code: `api/_files.js` (extractors, prompts, chunking) + `fileFlow` / `fullTextFlow` / `downloadFile` in `api/whatsapp.js`.
- Download: Graph `GET /{media-id}` (url + file_size) then the url with the bearer token. Max 25 MB.
- PDF: `unpdf` (pdf.js serverless build, pure JS). If the text layer has under ~60 letters a page (a scan), the PDF goes inline to Gemini (`application/pdf`, up to 14 MB) with one call that returns TITLE + summary + `===TEXT===` + the transcription. OCR chain = the Lite models first, then the Smart ones (no Gemma: it can't take PDFs).
- DOCX / XLSX / PPTX: a tiny unzip on node:zlib (word/document.xml incl. tables and footnotes; sharedStrings + sheets; slides). Old .doc/.xls/.ppt get a "Save As .docx/PDF" message. Encrypted Office files (OLE header) and password PDFs get a 🔒 message.
- Text: txt, md, csv, tsv, json, xml, html, srt/vtt, rtf (UTF-8 / UTF-16 BOM).
- Pictures: a photo with a caption like "read this" / "scan" / "extract text" (or a picture sent as a document) goes through the same OCR path. Other photos keep the old chat path.
- Text kept: 30,000 characters in `state.lastRead` (kind `file-<type>`). It rides the existing per-message state save, so files add NO Blob writes.
- Caption on a document = a question about it (answer first, then a short summary). Caption "full text" sends the text instead of a summary.
- `full text` / `text` (bare word only when a file/page was read in the last 24 h): parts of ≤3,500 chars (3,300 text + label + closing line), max 5 messages; then "Reply *more*" continues (only right after), and the last part says when the 30k cap cut the file.
- Follow-up questions get the file text (up to 30k) as context for 12 h. A new file or link clears the 3-minute reply cache.
- `usage` shows "📄 Files read: N (full text sent M×)". Health: build "v5.1", file_read true, file_types, file_ocr, file_max_mb, file_text_cap.
- Tests: `t_v51.mjs` (46 checks with LIVE=1; fixtures in `fixtures/`: text PDF, scanned image-only PDF, locked PDF, DOCX, TXT, long TXT, XLSX, PPTX, photo). Test ctx: `document._test_b64` / `image._test_b64` carries the bytes (only honoured with the test key).


## v6.0 AGENT MODE (7 Oct 2026)
Build sites & apps from chat, background jobs, an agent loop with tools.

**Chat commands** (Michael's own number only for builds/jobs; WA_ALLOWED still gates the line):
- `build me a landing page for my bakery`, `make a quiz app about …`, `create a portfolio website …`, `build: …` -> job (kind build). Questions ("how do I build a website?") stay in chat.
- `agent: <task>` (also task:/research:/job:) -> job (kind agent): plan -> act -> check loop with tools.
- `jobs` (last 8, with status), `cancel 12` (job 12; `/cancel 2` is still a reminder), `my sites`, `edit <site> <change>`, `zip <site>` (source as a .zip document), `apk` (honest: PWA install steps + pwabuilder.com route).
- Guards: 10 builds+edits per Lagos day (BUILD_DAILY_LIMIT), 3 open jobs at once, builds only from BUILD_NUMBERS (default first WA_ALLOWED number = 2348148034092).

**Queue** (Supabase Blossom rlbrhpjljjgpqpqjrpkc, schema `michael_ai`, no Blob writes): tables `jobs` (id, owner, ns wa|wa-test, kind build|edit|agent, input, status queued|running|done|failed|cancelled, steps log, state, result, ticks, lease_until, delivered) and `sites` (ns+slug, files jsonb incl. images as base64 and `_plan.json`, project, url, version). All access through `public.michael_ai_jobs(p_key, p_op, p_args)` (SECURITY DEFINER, checks SCHED_KEY): create/claim/save/get/list/cancel/count_today/open_count/undelivered/site_get/site_put/site_list/site_delete/purge_test.
pg_cron `michael-ai-jobs` (every minute) runs `michael_ai.jobs_tick()`: fails jobs older than 6 h, and POSTs /api/jobs (Bearer SCHED_KEY; `?sandbox=1` for wa-test) only while a job is queued/running with an expired lease. The webhook also kicks /api/jobs right after enqueuing; each tick self-chains.

**Worker** `api/jobs.js` (maxDuration 300): answers 202, runs one tick in waitUntil (`api/_agent.js` runTick, ~245 s budget, lease = budget + 75 s, max 12 ticks/job). Build pipeline: plan (Gemini JSON) -> research (0-2 keyless searches) -> images (Pollinations, 0-3, base64) -> code (Gemini, 32k tokens, index.html + style.css + app.js) -> check (`api/_sites.js` checkSite: doctype/viewport/title, cut-off page, tag balance, acorn parse of every script, missing local files, JS ids missing from HTML, placeholder text, CSS braces) -> fix pass (max 2, re-code once if hard errors remain) -> decorate (monogram PNG icons, OG/theme tags; apps get manifest + service worker = installable PWA) -> deploy (Vercel REST: /v2/files by sha1 + /v13/deployments, project `mai-<slug>` in the team, ssoProtection off) -> wait READY -> verify 200 -> save site -> WhatsApp message with the link. Edit jobs load the site from `sites`, apply the change, check, redeploy the same project, version+1.
Agent loop tools: web_search (v5 keyless DDG/Bing/News/Wikipedia), web_read (v4 reader, r.jina.ai fallback), make_image (Pollinations, max 2), build_site (runs the build pipeline then returns to the loop), remember (adds a fact to the KB blob), send_update (max 2 progress pings), finish. Max 12 steps.
**24h window**: free-form sends only work within 24 h of his last message. A result that fails to send stays `delivered=false` and is sent with his next message ("Finished while the chat was asleep"). Proactive delivery outside 24 h would need an approved template (none on the test WABA).
**Env added**: VERCEL_TOKEN, VERCEL_TEAM_ID (optional BUILD_DAILY_LIMIT, BUILD_NUMBERS, JOB_TICK_MS, PUBLIC_URL).
**Tests**: `t_v6.mjs` (64 checks, all mocked: in-memory job store, fake Gemini/Vercel). Live: POST /api/whatsapp with x-test-key + a build message (sandbox ns wa-test), then GET /api/jobs?sandbox=1&id=N with the same header; `GET /api/jobs?purge=1` deletes wa-test jobs+sites rows. `t_drive.mjs` runs a real local build (needs all env).


## v7.0 HEAVY WORK (7 Oct 2026)
Prod: dpl_B8H196LjJREY4BMTMoJTyDZpFpt7 (first v7 deploy dpl_CYPD8KpxEJCXZQjeB53hRUbt6F2N; before: v6.1 kv-store dpl_ALH7b1cj1xVczBTWgfitRUStHxMH). Health: build v7.0 + a `v7` block.
- STORE: per-message state moved from Vercel Blob to Supabase `michael_ai.kv` (Blob was suspended at Vercel 100% usage; Blob is read-only fallback).
- SITES WITH A BACKEND (`api/_backend.js`, `api/site-data.js`): the planner adds forms/lists/logins when the brief needs them (orders, bookings, guestbook, to-do, leaderboard). The built site gets `/mai.js` (per-site key, no secrets) wired with `data-mai-form`, `data-mai-list`, `data-mai-auth`. Server: field validation from the plan's schema, honeypot + bot-speed check, per-IP rate limit (8 writes / 10 min), origin lock to the site's own Vercel URLs, private kinds (orders/bookings) never listed publicly, scrypt passwords + signed tokens, per-user private items. Owner WhatsApp ping on each order/booking (missed pings go out with his next message). Commands: `orders <site>`, `data <site>`, `export <site>` (CSV with BOM, formula-injection guard, Lagos time). Paystack inline built but OFF until PAYSTACK_PUBLIC_KEY/PAYSTACK_SECRET_KEY are set; until then "Payments coming soon".
- REPOS (`api/_repo.js`): `repos`, `repo <name> <change>` -> job reads the tree, picks files under a budget, Gemini edits, self-check (acorn parse, JSON, truncation/elision, CI files refused), pushes to a NEW `mai/<slug>` branch (never main/master, never force, existing names get a suffix), sends diff summary + compare link. REPO_PROTECTED (default Blossom-website, Blossom-website.) is refused outright. Needs GITHUB_TOKEN env.
- RESEARCH (`api/_research.js`, `api/_pdf.js`): `research <topic>` (add "no pdf" for text only) -> multi-tick job: plan 8-10 searches, read up to 14 pages (max 2 per domain), write a cited summary + PDF report.
- MEDIA (`api/_media.js`, `api/_mediacmd.js`, `api/media.js`): ffmpeg-static (bundled via includeFiles) on a separate 300 s function; jobs_tick routes kind=media to /api/media. Video + caption: trim 0:05-0:20, compress, caption <text>, extract audio; picture + voice note -> make video.
- SOW (`api/_sow.js`): `post <text>` (now), `schedule <when> <text>`, `queued posts`, `unpost [n]` -> rows in public.sp_posts (source michael-ai). Sow posts through official APIs / one-tap share. `post: <topic>` is still the FB-draft flow.
- APK (`api/_apk.js`): `apk <site>` -> PWABuilder cloud packager (no account) builds a signed TWA APK + AAB; APK hosted at https://<site>/app.apk, /.well-known/assetlinks.json added, zip (APK, AAB, signing key) sent privately. Keystore never deployed.
- GEMINI (`api/_gem.js`): optional GEMINI_API_KEY_2 (429 on key 1 -> same model on key 2), 503 retry with backoff, prompt cache (gcache), usage counters; `quota` command.
- Limits: 10 builds+edits/day, only WA_ALLOWED[0] builds/pushes/posts/exports.
- Tests: t_v2 36, t_v3 19, t_v4 31, t_v5 65, t_v51 43, t_v6 66 (GEMINI_API_KEY=test-key), t_v7 109. Env for tests: SCHED_KEY, SB_URL, SB_ANON_KEY.
- Deploy: files/michael-ai/deploy-v7.py (MAI_VERCEL_TOKEN / MAI_TEAM_ID / MAI_PROJECT to repoint; --env writes env vars on a new project).


## v7.1 (7 Oct 2026): Monday & Friday Letters newsletter (worker 6a930451)
**What it does**: the 75 letters in files/newsletter/letters.csv (Mondays + Fridays, 12 Oct 2026 -> 28 Jun 2027) email out automatically at 08:00 Lagos to every subscriber of his site (public.newsletter_subscribers, marketing_consent = true; 457 on 7 Oct). Brevo's free plan allows 300/day, so each run sends up to Brevo's live remaining credits minus a reserve of 10 (NL_RESERVE) and the rest goes the next morning at 08:00.
**Data** (Supabase Blossom, schema michael_ai, RLS on, no anon grants): `nl_letters` (ns wa|wa-test, kind letter|oneoff, slot, send_on (Lagos date), send_at (07:00 UTC), subject, fields jsonb (title/verse/body/promise/signoff/book/book_link), status scheduled|skipped|sending|done|expired|cancelled, total/sent/failed/dropped, preview_at/preview_how) and `nl_sends` (letter_id + email PRIMARY KEY, status queued|inflight|sent|failed|dropped, tries, lease_until, sent_at, err). Access only through `public.michael_ai_newsletter(p_key, p_op, p_args)` (SECURITY DEFINER, checks SCHED_KEY): import, oneoff, subs_count, upcoming, status, spare_count, skip_next, unskip, due, claim, stale, mark, sent_today, preview_due, preview_mark, get, by_slot, purge_test. Migration: sql/2026-10-07-newsletter.sql.
**Trigger**: the existing pg_cron gate. `michael_ai.tick()` (every minute) POSTs `/api/cron?task=newsletter` (Bearer SCHED_KEY) when sched row `newsletter` is due (backoff 2,4,8..60 min if a run fails to re-arm). Each run re-arms the row itself: 20:00 Lagos the evening before a letter (WhatsApp preview), 08:00 Lagos on the send day, +1 min while a batch is still running, the next 08:00 once today's budget is spent, +15 min if Brevo or the broadcast didn't answer. Row `newsletter-test` (= &sandbox=1) is the sandbox twin.
**Run** (api/_newsletter.js runNewsletter): (1) from 20:00 Lagos, if tomorrow has a letter and it hasn't had its preview: WhatsApp "📬 Tomorrow's letter (8am): <title> / Reply *skip* to hold it" ONLY if Michael wrote to the bot within 23.5 h (Meta's 24h rule; the test number has no template), else preview_how = window_closed. (2) `due` snapshots the recipients of every letter whose time has come (once; on conflict do nothing). (3) Reads Brevo credits (GET /v3/account); none readable = sends nothing. (4) Claims chunks of 25 (rotating md5 order, so day 2 isn't always the same people; a subscriber who unsubscribed since the snapshot is dropped), leases them 10 min, POSTs his site's own `/api/newsletter/broadcast` (x-broadcast-secret; it fills %%FIRST_NAME%% and a working %%UNSUBSCRIBE_URL%% per person, same sender as the books email), marks sentTo/failedTo/skipped. A chunk whose call dies stays in flight; after the lease the next run asks Brevo's events (address + subject, 2 days) and marks it sent or re-queues it, so nobody gets a letter twice. Letters more than 3 days late are expired, not sent.
**Rendering** (render()): same look as the books email (BLOSSOM header, cream card, Cormorant titles, gold #8A6832): eyebrow "Monday Letter · 12 October 2026", title, "Hi %%FIRST_NAME%%,", verse box, body, TODAY'S PROMISE box, sign-off, "Read <book> →" button, "With love, Olaoluwa Michael", footer with Unsubscribe. Subject "<Day> Letter: <title>". Rendered at send time from fields, so a template fix reaches every future letter.
**WhatsApp commands (owner only, BUILD_NUMBERS / first WA_ALLOWED)**: `letters` (next 3 + last/current send X/Y + spare pile), `skip` (next letter -> spare pile, nothing sent that day), `unskip` (puts the last skipped one back if its date hasn't passed), `subs` (subscriber count), `newsletter <text>` (Gemini tidies his note into the newsletter voice without adding facts, falls back to his words verbatim; preview with subscriber count and timing from live credits; `yes` within 30 min queues a one-off and kicks the gate, `no` cancels; it never sends without yes). Checked before the FB-draft yes/no; if both are pending the newer one wins.
**Env added**: BREVO_API_KEY, BROADCAST_SECRET, BROADCAST_URL (optional NL_RESERVE, NL_CHUNK). Health `?health=1` shows build v7.1 and `v71.newsletter*`. vercel.json: api/cron.js maxDuration 300.
**Load / reload letters**: `node tools/nl-import.mjs [csv] [--ns wa-test]` (needs SCHED_KEY, SB_URL, SB_ANON_KEY). Only rows still `scheduled` are updated.
**Tests**: `node t_v71.mjs` (52 checks, all mocked; any real broadcast/Brevo call throws). Live sandbox: POST /api/whatsapp with x-test-key ("letters", "skip", "newsletter …" → wa-test rows, nothing emailed) and `GET /api/cron?task=newsletter&sandbox=1&now=<iso>&emails=a@x.test,b@x.test` (x-test-key; fake addresses only, sandbox provider, never the broadcast). Clean up: RPC purge_test + `update michael_ai.sched set next_due=null where name='newsletter-test'`.
**Shared Brevo pool**: the books announcement (send.py), his site's welcome emails and its new-post cron all draw from the same 300/day; this sender always reads the live balance first and keeps 10 back.
**Deploy**: files/michael-ai/deploy-v71.py (skips tools/ and sql/). Live: dpl_FMja5s8GdjVXGPkudxZUKGKiMcD1 (7 Oct 06:47Z). v7.0 rollback: dpl_B8H196LjJREY4BMTMoJTyDZpFpt7.


## v7.2 (7 Oct 2026): daily verse from Sow (worker 6a930451, Michael m:aebe4447 "My daily bible verse is not here")
- 06:00 Lagos every day the bot sends Michael today's Sow post: GET https://sow-ng.vercel.app/api/today (x-sow-key: SOW_API_KEY, env added) -> the post image (uploaded to WhatsApp) with caption = Sow's WhatsApp text (title, message, KJV verse - reference (KJV)); over 1000 chars the full text follows as a message. Image fetch fails -> text only.
- Trigger: pg_cron gate row `verse` -> POST /api/cron?task=verse (Bearer SCHED_KEY), re-armed each run to the next 05:00 UTC. Sandbox row `verse-test` (&sandbox=1, &now=<iso> for tests).
- Once a day: table michael_ai.daily_push (ns, kind, day) PRIMARY KEY, ops daily_claim / daily_mark / daily_get on public.michael_ai_newsletter. First run that claims the day decides; every other run that day answers already:<how>.
- 24h rule: sent only if Michael wrote to the bot within 23.5 h; else the day is recorded `window_closed` (no late send). Not before 06:00 or after 12:00 Lagos. Sow down -> `error`; Sow serving another day -> `sow_day_mismatch`.
- `&force=1` (Bearer SCHED_KEY only, never the test key): operator check that ignores the window once (used 7 Oct 07:16Z for the first live send).
- Command (owner only): `verse` / `today` / `daily verse` / `today's verse` -> today's picture + caption on demand. Help line added.
- Failed WhatsApp statuses (e.g. 131047 outside the window) are now kept in kv `wa/failed-status.json` (last 20) for diagnosis.
- Tests: `node t_v72.mjs` (18 checks). Deploy dpl_8Y2eUSwEY29KyQVnDcR1AohrAJvX (build v7.2).


## v8.0 SUPER SMART (Oct 7, 2026, worker a538ac9d)
Four upgrades, all free tier. Code: `api/_brain.js` (new) plus small hooks in `api/whatsapp.js`, `api/_gem.js`, `api/_v5.js`.

**1. Smart routing.** `BR.classify()` is a cheap rule set (no extra AI call): small talk and short questions go to Flash-Lite;
writing, planning, coding/debugging, maths, advice ("should I…", "how do I…"), comparisons, long messages and media go to the strong
model (`gemini-3.6-flash`, then the other Flash models). Each key gets `STRONG_PER_KEY` strong answers a day (default 20, Google's free
limit; counted per Pacific day in the chat state, plus background jobs from `michael_ai.usage`). When the budget is spent, or every key
hit its daily 429, hard questions go to Lite with a "think step by step" block and `thinkingLevel: medium` ("deep mode").
Keys: `GEMINI_API_KEY` and `GEMINI_API_KEY_2`. `gemFetch` rotates to key 2 on a 429 and now reports which keys hit a limit
(`x-gem-429` header), so the budget and the `brain` command know per key. Owner command **brain**: strong/lite per key today,
strong answers left, how messages were routed, the knowledge-index size and the auto-memory count.
*Adding keys:* put `GEMINI_API_KEY_2=…` in `/home/user/tab/files/.michael-gemini.env` and/or `GROQ_API_KEY=…` / `OPENROUTER_API_KEY=…` in
`/home/user/tab/files/.michael-ai-providers.env`, then `python3 files/michael-ai/add-ai-keys.py` (checks each key with its provider, writes
only those env vars, redeploys once with deploy-v8.py).

**2. Knows his world (retrieval).** 588 chunks in Supabase pgvector (`extensions.vector`, table `michael_ai.kchunks`, HNSW cosine index,
RLS on, access only through `public.michael_ai_brain(p_key, p_op, p_args)`, SECURITY DEFINER, same key as the jobs RPC; ops add, match,
stats, learned, del_src, del_id, purge_test). Sources: 75 Monday & Friday letters, 25 spare letters (the old 100 Mondays are the same
titles, deduped), all 6 book manuscripts in ~2,200-char passages, a whole-book overview of each of the 5 books (made with Flash-Lite,
`tools/book-overviews.json`), and the public project list with links (`tools/projects.md`, no secrets). The collected-works PDF is the
same 5 books, so it is not indexed twice. Embeddings: `gemini-embedding-001`, 768 dims, RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY (free, its
own quota). Each real question (not "hi", not commands) is embedded once (~0.4–0.7 s) and the closest chunks with cosine ≥ 0.62
(`BRAIN_MIN_SCORE`) go into the prompt under "FROM MICHAEL'S OWN WORK". When he asks it to write as him, two of his letters always go in
as voice samples beside the full voice pack. The sandbox namespace `wa-test` reads the real index. Rebuild/extend: `python3 tools/kb-index.py`
(idempotent, cached embeddings, backs off on the ~100/min embedding limit). Owner commands: **learn <text or link>** (reads the page,
chunks, embeds, stores as src learn; refuses anything that looks like a password/key/account number), **learned**, **unlearn <n>**.

**3. Auto-memory.** When his message states something personal (people, dates, plans, preferences; not questions, requests or commands),
Flash-Lite runs beside the answer (no added wait) and returns up to 3 durable first-person facts as JSON. They go into the same knowledge
list as teach: (marked `auto`), deduped by word overlap, updated in place when a new fact replaces an old auto fact, capped at 80 auto
facts, and never anything that looks like a password, PIN, key, card or account number (checked on his message and on each fact).
The reply ends with one small line: "_📝 Noted: …_". `/knowledge` shows auto facts with 📝; `/unteach N` removes them.

**4. Live web search in normal chat.** Besides v5's rules, `BR.detectFresh()` sends questions that need fresh info (time words like
today/now/latest/this week + a topic like news, price, rate, fuel, match, election, president…, or a team/league name) to the existing
keyless search (DuckDuckGo → Bing → DDG-lite + Google News RSS + Wikipedia, 2 pages read, Lite answer with 1–3 sources). Questions about
his own things ("my app", "my letter") never go to the web. "Today/latest" questions now ask Google News for the last 2 days (7 for "this
week"/"last match") with filler words removed, and put dated news first. If a search runs past 7 s the bot first sends
"🔎 Checking the web for you…".

**5. Photos and PDFs** were already understood (v4 photos via Gemini vision; v5.1 PDF/Word/Excel/PowerPoint/text + OCR of scans). Nothing new needed.

**6. Sow, first-class** (`api/_sowplus.js`, Michael asked "Can my bot have access to sow??"). **sow**: the next 3 queued posts from every
source (date, time, title, platforms; Supabase via `michael_ai_brain` op `sow_next`). **sow week**: Sow's `/api/stats?summary=week` text.
**sow tomorrow** / "what's posting tomorrow on sow" / "what's on sow friday": that day's posts (`/api/today?date=`). **posted <platform>**
(fb, page, groups, status, channel, ig, tiktok, x, threads, yt, linkedin, pinterest): marks today's latest due post via
`POST /api/today?action=mark`. "add a post for Friday 7pm about faith": Lite writes it in his voice and queues it in sp_posts (same path as
*schedule*, undo with *unpost*). All use the existing `SOW_API_KEY`. Owner only.

**7. Reminder fix (live bug 7 Oct 07:42Z)** (`api/_remind8.js`). He voice-noted "Remind me by 8pm 9pm 7pm to message Mr John…", the chat
model asked which time, he said "The three time", and the chat model claimed "I've set reminders" with nothing stored. Now: several times
in one request make one reminder each ("by 8pm 9pm 7pm", "at 7pm, 8pm and 9pm", "reminders for 7pm 8pm and 9pm to …"); a short answer
("the three time", "all", "8pm") to a reminder question goes back into the reminder flow with the original request (`state.remPending`,
20 min); a voice note asking for a reminder comes back from the model as one `REMIND:` line and runs the real flow; every chat prompt
carries an "honesty about actions" rule; and a chat reply that still claims a reminder was set is turned into the real reminder (from this
message or the last 20 min) or replaced by an honest line; a claim of something sent/posted gets a correction line. No duplicate reminders.

**8. Other free AI providers** (`api/_providers.js`, Michael m:ac1a75b2). OpenAI-compatible chat calls to Groq (`GROQ_API_KEY`) and
OpenRouter (`OPENROUTER_API_KEY`, only `:free` models). Each is used only when its key is set; with no keys every chain is exactly the v5
one (tested). Virtual models `groq:strong|fast`, `or:strong|fast` resolve to a pinned name (`GROQ_STRONG`, `GROQ_FAST`, `OPENROUTER_STRONG`,
`OPENROUTER_FAST`) or to the best match in the provider's live model list (cached 6 h; a retired model is swapped once automatically).
Chains: hard = Gemini strong → Groq/OpenRouter strong → Lite → fast providers → Gemma; when the Gemini strong budget is spent, hard
questions go to Groq/OpenRouter strong first (route "alt") and only then to Lite deep mode; easy = Lite → fast providers → Gemma. A 429
parks that provider like a Gemini model. Photos, PDFs, voice notes and embeddings stay on Gemini. The system prompt is trimmed (head +
tail, `PROVIDER_SYS_MAX` 16,000 chars) for small free-tier token limits. `brain` shows strong/fast/limit counts per provider.

**Health:** build `v8.0` with a `v8` block. **Tests:** `t_v8.mjs` (119 checks mocked; `LIVE=1 GEMINI_LIVE_KEY=… SB_URL/SB_ANON_KEY/SCHED_KEY` adds 5 live
retrieval checks against the real index). Real-model smoke: `node tools/local-live.mjs '<q1>' '<q2>'` (sandbox ns, nothing sent; PURGE=1 cleans). All older suites unchanged except the build-regex in t_v6/t_v7 (accepts v8).
**Deploy:** `python3 files/michael-ai/deploy-v8.py` (MAI_SRC defaults to /home/user/work/michael-ai-v8).


## v9.0 "replica of Tab" (9 Oct 2026; Michael's voice note 06:03Z)
Module `api/_v9.js` (store: michael_ai.kv keys `<ns>/v9/cfg|contacts|batch|log|chat-<num>`).
- **Daily outreach, owner-approved**: at `outreach time` (default 09:00 Lagos) the bot picks 5 random people from the list (people who messaged the bot number + owner-added via `contacts add` / a .vcf or .csv document), skipping anyone messaged in the last 14 days or opted out, drafts a short personal message for each (Gemini, goal-aware; fallback text if AI is down) and sends the 5 drafts to the OWNER only. Approvals: `send all`, `send 1 3`, `edit 2: <text>`, `skip 4`, `redo 5`, `drafts`. Contacts inside the 24h window get free-form text; others get template `michael_checkin_v1` (lang `en`, MARKETING, body "Hi {{1}}, it's Michael 👋 {{2}} …", footer "Reply STOP…"; submitted Oct 9 06:06Z, id 1632050801887578). If the template isn't APPROVED, those drafts are held (never sent) and the owner is told. Failures are explained in plain words (131030 test number, 131047 window, 132001 template, 131026 not on WhatsApp); late failures from the status webhook are reported too. Contacts saying STOP are opted out for good (START re-opts).
- **Selective auto-reply** for anyone not on WA_ALLOWED (replaces the old "This is a private assistant." line when the kv store is on): `autoreply only <numbers|label>` -> AI answers as "Michael's assistant" (Lite chain, own short history per contact, public business info only, never personal facts, never invents prices/promises); `autoreply except <numbers>` -> never answered; everyone else -> `autoreply unknown hold|silent|answer` (default hold: one polite "Michael will get back to you" per 24h + owner notice, max 1 notice / contact / 30 min). `autoreply all|none|on|off|remove <x>`. Owner answers through the bot: `reply <number>: <text>` (24h window only). Evening digest 20:00 Lagos, or `digest`.
- **Goals + growth**: `goals` (add/remove/set), injected into every owner prompt; Monday 08:00 Lagos "3 moves" business-coach nudge, or `growth`.
- **Work ethic**: `V9.ethicBlock()` appended to every owner chat system prompt (act don't ask, never claim done, plain failures, short, point of view, one next step, reminders for anything timed, business-guru stance, goals).
- **Voice note -> send-ready text** (owner): one Gemini call returns TRANSCRIPT / KIND / INSTRUCTION / POLISHED / UNCLEAR / ANSWER. Dictation: message 1 = transcript + what was done + flagged unclear words; message 2 = the clean text alone (forwardable; an instruction like "write this into an article titled X" is followed, title first, signed _Olaoluwa Michael_). Question: transcript + answer. Follow-ups within 30 min: `shorter`, `more formal`, `as a status`, `for <name>`, `polish`. Old one-line format still handled.
- **Trigger**: no new pg_cron row needed. The existing gate row `live` (-> /api/cron?task=reminders) now wakes at min(next reminder, next v9 moment) and `runReminders` runs `V9.tick` (claims the day before sending, so one batch a day). Owner window shut -> drafts/digests are queued in cfg.queue and delivered when he next writes. Sandbox: `POST /api/jobs?sandbox=1&v9=1&force=outreach|growth|digest` with x-test-key.
- Tests: `t_v9.mjs` (100 checks); t_v2/t_v5/t_v6/t_v7/t_v8 assertions loosened for v9 (stranger holding reply, shared gate, build v9, Friday date edge in t_v8).


## v9.3 TRAINED (10 Oct 2026, worker 99fe398e; Michael m:f765b47e "Then please train my Ai", m:7f3f7cf2 "Image coding video replying to texts. Banks of thing to know")
Module `api/_v93.js` (pure helpers). Changes:
- **His knowledge loaded**: `tools/kb-import-v93.mjs <ns> facts|knowhow|both` imports `files/michael-ai/train-v93/facts-import.json` (95 facts: all 84
  teach-pack items P1 12 / P2 10 / P3A 15 / P3B 15 / P4 11 / P5 10 / P6 11, with P1.04 merged with the 10 Oct Facebook update, plus 11 dated facts from
  Tab's notes: short replies, Akure/WAT, December goals, the Facebook million goal, clip bank, Telegram storage, Bible Arena + beta 11 Oct, Sow,
  Blossom, Monday & Friday Letters, Royal People Care) into `<ns>/2348148034092.knowledge.json` as normal taught facts with `tag`, `src` and `pin`
  (4 pinned standing facts). Dedupe: exact or token-Jaccard > 0.6 against what's there (his own wins). `/knowledge`, `/unteach N`, `teach:` work as before.
- **Retrieval**: `V93.pickFacts` chooses the taught facts per message (topic tags matched from the question + keyword overlap with light stemming +
  two-word names + pinned + newest 5), oldest-first order kept. Budgets: lean chat 9,000 chars, hard/voice 16,000; no query (nudges/jobs) = all.
  The base profile is still always in. `/knowledge` shows a topic summary once there are >25 facts; `knowledge all`, `knowledge <topic>`.
- **Know-how bank**: 33 dated reference entries (faith basics, BVN/NIN/transfers/Paystack, reels/YouTube/Facebook reuse rules, freelance pricing,
  Vercel/Render/Supabase/APK/PWA/WhatsApp API, CapCut/Premiere, image prompts, reply drafting) in `michael_ai.kchunks` src `knowhow:*`, pulled by the
  same embedding lookup as letters/books; `wantsRetrieval` also fires on know-how words; labelled "reference bank (dated)" in the prompt.
- **Skills**: `SKILLS_RULES` in every owner prompt (image command lines, code formatting, honest video limits, 3-tone reply drafts, freshest fact first).
  Reply drafts: "reply to this…" or a FORWARDED message -> exactly 3 replies (*Warm*, *Short*, *Professional*), [blank] placeholders, no invented dates.
  Images: "make/design a poster|flyer|thumbnail|banner|verse graphic|card … of/for …" now route to the image maker, with Blossom / faith / thumbnail /
  poster looks added to the prompt and a "add your words in Canva" tip.
- **Reminders**: a reminder request with no time at all is asked about ("When should I remind you?") instead of the AI guessing 9am; an answer that
  can't be turned into a time is asked once more; the chat model now sees his real active reminders when reminders are discussed, so "did you set
  it?" is answered truthfully (v8 already routed "the three time" back to the reminder flow and blocked false claims).
- Goals: DEFAULT_GOALS += Facebook million goal. Health: build `v9.3`, `v93` block. Tests: `t_v93.mjs` (36 checks); t_v5 clock-edge fix ("in 2 hours"
  after 22:00 Lagos is tomorrow); t_v92 build regex. NOTE: the mocked suites write and wipe the real `wa-test` kv namespace: re-import before sandbox runs.


## v9.5 CODING + IMAGES (12 Oct 2026, worker c503eadc; Michael m:7b382ab1 "just train… especially for coding and image generation")
- api/_v95.js (pure): SKILLS_V95 (HOW TO THINK + CODING + IMAGES blocks, added after the v9.3 skills in every owner prompt);
  codeAsk/CODE_EXTRA (error / code / task; vague bug -> ask for the exact error; otherwise one-line cause, complete files, steps, self-check);
  promptAsk/PROMPT_EXTRA (2-3 ready `image:` lines + Canva words; [blank] for unknown details; made-up lines marked (suggested));
  imageFeedback ("again", "brighter", "make it more Nigerian", "use RETAIN colours", "in status size" within 30 min of a picture -> redraw);
  selfFace/SELF_FACE_REPLY (never draws Michael: his photos come from his Telegram picture bank); peopleNote (AI-made people in captions);
  brandStyle95 (RETAIN palette, Nigerian look; wired into _extras.brandStyle); splitFenced (WhatsApp splitting never cuts a ``` block).
- whatsapp.js: code asks -> 8K output, temperature 0.3, thinking medium, first model budget 32 s, full fact budget, wide retrieval, no auto-memory;
  prompt asks -> wide retrieval, no auto-memory. askGemini takes opts.temperature / opts.thinking / opts.firstMs.
- _brain.js: classify -> hard for code/prompt asks; KNOW_RE + coding/image words; retrieve({ wide }) 6 hits from 14; voice:* chunks lead when writing as him.
- _v93.js: BUILD v9.5; topic `images` (Images & design) for facts.
- Knowledge (files/michael-ai/train-v95/): knowhow.json 99 chunks (knowhow:code 33, code-examples 12, debug 12, imagecraft 16, image-examples 10,
  voice:guide 12, voice:thoughts 4 incl. his NIMC essay verbatim); facts-import.json 7 facts (RETAIN /hrp + /tst, 0703 then 0903, RETAIN colours,
  face rule (pinned), coding prefs, image sizes, Just Me and My Thoughts pattern). Import: node tools/kb-import-v93.mjs <ns> both --dir=/home/user/tab/files/michael-ai/train-v95
- Tests: t_v95.mjs (mocked). tools/run_all.sh runs t_v71 on a fixed clock (tools/fake-clock.mjs, FAKE_NOW=2026-10-11T12:00Z): it checks
  "skip the next letter" and letter 1 went out 12 Oct 07:00Z. tools/wa-test-reset.mjs wipes wa-test (kv + brain) before re-importing for sandbox runs.
  tools/sandbox-v95.mjs <questions.json> <out.json> runs real-model sandbox Q&As locally in wa-test.

## v9.6 (12 Oct 2026) — coding + images, round 2 (Michael: "dont rush it, make it super super smart like you")
- Code asks: model chain `gemini-3.1-pro-preview` (free keys answer 429 "limit: 0" -> parked until Google's daily reset; it answers the day billing is on) > `gemini-3.6-flash` > `or:heavy` (OpenRouter's biggest free model, nemotron-3-ultra) > `groq:strong` (gpt-oss-120b) > rest of the Flash family > Lite > fast providers > Gemma. Not limited by the daily strong budget. A fast refusal (<2.5 s) keeps the long first-model budget. `CODE_PRO_MODELS` env overrides/turns off pro ("" = off). Heavy provider calls keep up to 40K chars of system prompt.
- Image-prompt asks: OpenRouter strong before Groq strong; brand notes (RETAIN/Blossom) are dropped from retrieval unless the ask names that brand.
- api/_v96.js: SKILLS_V96 (wrong assumptions, never invent, diagnose/rank causes, long pasted code, his projects' gotchas, add-only edits to existing files, Hobby 12 functions / daily crons, formats, vague briefs, drawing Michael), CODE_EXTRA96 + CODE_TAIL and PROMPT_EXTRA96 + IMAGE_TAIL (short rules in the per-message tail, because providers get a trimmed prompt), codeAsk96/promptAsk96 (wider detection), realPerson guard (no AI pictures of named public figures), selfFace96, tablesToLists (Markdown tables -> WhatsApp lists), filterBrandHits.
- Retrieval: wide asks (code / image prompt) get 3000 chars per note (complete templates).
- Knowledge (kchunks src): knowhow:debug-cases 42, knowhow:templates 18, knowhow:code96 4, knowhow:image-formats 6, knowhow:image-examples96 24, knowhow:image-playbook 12 (files: /home/user/tab/files/michael-ai/train-v96/knowhow.json). Rollback of data: brain op del_src per src (none shared with v9.5).
- tools/kb-import-v93.mjs now paces embedding batches (12 s) and retries per-minute 429s. tools/sandbox-v96.mjs: /new before each case, logs provider models too.
- Tests: t_v96.mjs; t_v95 accepts build v9.5+.


## v9.7 (19 Oct 2026, worker c64017e1) — the five upgrades from the Oct 19 audit (Michael m:b7a56707 "Yes please")
Module `api/_v97.js` (pure helpers) + wiring in whatsapp.js / _brain.js / _v5.js / _extras.js / _providers.js / cron.js. Health: build `v9.7`, block `v97` (patch, features, image_models).
1. **Remind-me questions** (v9.7.1): "remind me what/who/how/which/the name…" and "…?" with no clock time are answered in chat (prompt gets REMIND_Q_EXTRA), never the reminder flow. A "When should I remind you?" waits 5 min (was 20); any reply that isn't a time (incl. "Did you send my outreach today?") cancels it. Checked on every text before routing (`V97.dropPending`).
2. **Smarter replies** (v9.7.1): chains reordered from the Oct 12-19 usage + Oct 19 probes: SMART = 3.6-flash > 3.5-flash > flash-latest > 3.8; hard = 3.6, 3.5, groq:strong, or:strong, busy Flash, Lite, fast, Gemma; easy = Lite, groq/or strong, fast, Flash, Gemma (Gemma was 429 all week). askGemini ranks every chain by each model's ok/fail today (`state.mh`, Lagos day, yesterday halved; ≥2 fails and fails > 2×ok -> back of the line). The main chat passes `quality`: an empty / busy-or-error / refusal / thinking-leak / cut-off / looping answer falls through to the next model; if all are weak the first weak answer is used (never the error line). JSON/background calls are not quality-checked. Free tiers only (no billing).
3. **Long-term memory** (v9.7.2): `longTermMemory()` runs in the daily 06:00 UTC cron before the brief (and alone: `/api/cron?task=memory`, SCHED_KEY/CRON_SECRET or x-test-key [&force=1]). Reads chat lines since `kb.settings.ltmAt`, asks the hard chain for ≤6 durable facts, each with an exact quote of Michael's words (no quote in his lines = dropped), no secrets / long digit runs, deduped (BR.similar ≥ 0.7) against all facts, "replaces L3" updates in place. Saved as kb facts `{ ltm: true, tag: 'learned' }`, max 40 (oldest learned drop first). Every prompt: own block "WHAT YOU LEARNED ABOUT MICHAEL FROM YOUR CHATS" (newest first, 2600 chars); not mixed into pickFacts. /knowledge and /unteach N see them like any fact. Rollback of data: delete facts with ltm:true.
4. **Morning brief** (v9.7.3): `briefData()` = today's reminders, open jobs, newsletter status/next/subs (read-only RPCs), his last 48 h of messages; Sunday adds week numbers (messages, reminders sent, things learned, letter emails, jobs done). Prompt bans every item of the last 3 briefs; `staleFilter` (V97.similarItem ≥ 0.55, stemmed overlap) drops repeats anyway; if nothing is left, `briefFallback` builds it from the data. Sandbox: `/api/cron?force=1[&sunday=1]` with x-test-key.
5. **Images** (v9.7.4): Pollinations models `POLLINATIONS_MODELS` (default `zimage,flux`; Z-Image Turbo returns the full size: 1088x1344 / 1088x1920 / 1920x1088 checked 19 Oct; flux gave 1024x1088 + garbled signs). Every ask first becomes a concrete scene (one Lite call, 8 s max, `IMG_SCENE=0` turns it off; brand names/titles never in it, quoted words kept exact). Prompt rules learned from live probes 19 Oct: a long "no text, no letters…" list made Z-Image draw empty gradients or write "{ADDRESS}"; "space for a title / text" became flat colour bands; brand names (Blossom, RETAIN…) got written as text. So: platform words reworded ("YouTube thumbnail" -> "cinematic wide photo", "WhatsApp status" -> "tall picture"), "for my video about X" -> "showing the idea of X", flyer/poster -> "vivid illustration", brand names stripped (colours kept), ONE "without any text, lettering or logos" line (or "the only words are exactly …" when he quoted words), `negative_prompt` sent too. Sample: files/michael-ai/v97-images-sample.jpg.
- Tests: `t_v97.mjs` (mocked; 100+ checks); t_v8 provider-chain slice and t_v96 health build regex loosened for v9.7. `tools/run_all.sh` now also runs t_v964 + t_v97. Live sandbox: `tools/sandbox-v97.mjs seed|run|peek|purge`.
- Deploys (rollback = promote the previous one): v9.7.1 dpl_DiAZbfnxRki8GX2vf8uvoRLpdTNP (prev dpl_4izFqfLb4vXaa8eWs5NQoueS8Gzh = v9.6.4), v9.7.2 dpl_98S3bmcsXzprdgfzNSrYrgPVAwh7, v9.7.3 dpl_9Bfuqvi27cpFwtd9atYzXVQjEA7x, v9.7.4 see .last-deploy.


## v9.8.0 (24 Oct 2026, worker 98904084) — Royal People Care daily post drop (Michael on Tab's WhatsApp 14:47Z: "let my whatsapp bot brings it, i am always busy with many msgs here")
Modules: `api/_rpc.js` (run / nextDue / held day / heads-up / end note / royals cmds), `api/_rpcclean.js` (caption cleaning), `api/_rpcplan.js` (GENERATED by `node tools/rpc-build.mjs` from `fixtures/rpc-raw.json`, which holds slot, CT/Nigeria times, media paths and raw caption.txt of posts 019-104 from RPC_3perDay_Oct19-Nov21_FULL.zip). Health: build `v9.8`, block `v98`.
- **Media**: static Vercel project `rpc-media` (team michael-380d, prj created 24 Oct, deployment dpl_HRv62ZSSC9TJeQ7Zf7HkBXzUvP1M): `https://rpc-media.vercel.app/p/<NNN>/<slide-0X.jpg|post.jpg|frame-N.jpg|video.mp4>`, 176 files, 28.9 MB, all byte-checked (sha1) after deploy. Biggest image 0.31 MB, reels 022/025/028/040 1.7-2.0 MB (H.264 High + AAC, 720x1280, 39-47 s). ALT videos/captions and the `alt` folder were not uploaded.
- **Trigger**: gate row `live` (runReminders -> `RPC.run`), `syncSched` folds in `RPC.nextDue` (07:00 UTC = 08:00 Lagos; a held day = now; heads-up = lastIn+23h). Backup: Vercel cron `0 7 * * *` -> `/api/cron?task=rpc` (Hobby fires within the hour; it runs the whole runReminders sweep). Once a day by `michael_ai.daily_push (ns,'rpc',day)` + kv `wa/rpc/state.lastDate`.
- **Messages**: opener "🌅 Royal People Care, Sun Oct 25 👇"; per post header `📌 Post 020 · 9 AM CT · 3 PM Nigeria` + "Carousel, 6 slides" (6:30 PM -> "12:30 AM Nigeria (after midnight)"; CT+6 until Oct 31, CT+7 from Nov 1, computed with real time zones), the images/video (fetched from rpc-media, uploaded to Meta, sent by id; by link if the upload fails), the caption alone; closing "That's today's 3 ✅" (+ "+ the story" on Oct 25/Nov 1; reel days add the AI-label tip). Gap 1.2 s after media / 0.6 s after text (order). A refused send stops that day (partial), no retry.
- **Captions** (`cleanCaption`): drop the first "3-A-DAY PLAN" line and the "POST NNN: …" header (files 057+); cut at a line exactly `---`; reels: only between "CAPTION (ready to paste)" and "Alt text:", "Video created with AI tools." added on its own line before the hashtags when missing (022/025/028/040 all lacked it); stories: FLAGS paragraph dropped, frame notes kept. Test: every kept line is a line of the source; the Oct 24 reel cleans to exactly what Tab delivered by hand.
- **Window shut** (no message to the bot in 23.5 h): the day is held (kv), one template nudge for that day (`michael_checkin_v1`, only if APPROVED; today it fails at Meta with 131042 payment, WABA payment block; `RPC_TEMPLATE=0` off), sent when he next writes to the bot that same Lagos day (the webhook wakes the gate; the drop runs in /api/cron, 300 s). A held day from an earlier day is dropped. Heads-up 1 h before his window shuts if the next drop would fall outside it (once per message of his; skipped if the reminder heads-up went; `RPC_KEEPER=0` off).
- **End**: Nov 22 08:00 one "the post plan (Oct 25 – Nov 21) has ended … Ask Tab for the next batch" (held if the window is shut), then nothing is scheduled. `RPC_DROP=0` turns everything off (env needs a redeploy).
- **Commands** (owner): `royals` / `royals today` (today's posts again, via the gate within ~1 min), `royals off|on|status`.
- Tests: `t_v98.mjs` (67 checks, mocked); t_v97 build check loosened to v9.7+; run_all.sh runs t_v98. Live sandbox: `GET /api/cron?task=rpc&now=<iso>` with x-test-key (wa-test, outbox only; real media fetch from rpc-media; template status faked APPROVED). Clean: sandbox-v97 purge + `NL.rpc('purge_test')` + `V.setNextWake('test', null)`.
- Deploy v9.8.0 dpl_CopGnYysmPBPcLMFGkiGMRsVCaqD (prev v9.7.4 dpl_5kwNw7kHidUdgiENafpZiiyJ6m4y). Rollback: `python3 files/michael-ai/rollback-v98-to-v974.py` (promotes the previous deployment).
