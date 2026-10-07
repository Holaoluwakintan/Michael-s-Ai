# v7 progress (worker fb4c817f)
- DONE: DB migration (site_data, site_users, hits, usage, gcache, kv; RPC ops; claim kinds filter; jobs_tick base_url + /api/media)
- DONE + DEPLOYED (dpl_ALH7b1cj1xVczBTWgfitRUStHxMH, build v6.1): store moved Blob -> Supabase kv (Blob suspended at Vercel 100%); _gem.js key2/retry/usage/cache
- WRITTEN: _backend.js, site-data.js, _sites/_agent backend integration, _pdf.js, _research.js
- TODO: _repo.js, _media.js + api/media.js, _sow, whatsapp hooks (orders/data/export, repos, research, post/schedule, media, quota), runTick dispatch, help, health v7.0, t_v7.mjs, deploy, e2e, apk, zip, memory

## worker fef5da8e (continuation, Oct 7 02:0xZ)
- Found far more done than the list above: _repo, _media+api/media, _sow, _apk (PWABuilder real APK), whatsapp hooks, runTick dispatch, help, health v7.0, t_v7 all written.
- Fixed 2 last t_v7 failures (assetlinks key with leading slash in _apk.pack; outbox mapping keeps doc filenames). ALL suites pass: v2 36, v3 19, v4 31, v5 65, v51 43, v6 66, v7 104.
- DB: michael_ai_jobs supports every op the code uses; jobs_tick routes media -> /api/media.
- NEXT: add GITHUB_TOKEN env, deploy-v7.py, one prod deploy, live e2e, screenshots, zip, memory.

# v7.1 newsletter (worker 6a930451, 7 Oct 2026)
- DONE: sql/2026-10-07-newsletter.sql applied (nl_letters, nl_sends, public.michael_ai_newsletter, sched rows newsletter + newsletter-test)
- DONE: api/_newsletter.js (render, scheduler run, commands), cron.js task=newsletter (maxDuration 300), whatsapp.js hooks + help + health v7.1, jobs/media health v7.1
- DONE: 75 letters imported (ns wa), gate armed (next 2026-10-11T19:00Z preview, then 2026-10-12T07:00Z send)
- DONE: t_v71.mjs 52/52; t_v5 65, t_v6 66 (GEMINI_API_KEY=test-key), t_v7 103 still pass
- DONE v7.2: daily verse (api/_verse.js, cron task=verse, daily_push table, sched rows verse + verse-test), verse command, t_v72.mjs 18/18. Deploy dpl_8Y2eUSwEY29KyQVnDcR1AohrAJvX. First live send forced 07:16Z (wamid accepted by Meta).

# v8.0 (worker a538ac9d, 7 Oct 2026)
- DONE: routing + per-key strong budget + deep mode, brain cmd; pgvector index (588 chunks) + learn/learned/unlearn; auto-memory; fresh-info search + fresher Google News; Sow first-class; reminder bug fix (multi-time, clarification, voice REMIND:, no fake claims). Merged v7.2 final (verse). All suites green: v2 36, v3 19, v4 31, v5 65, v51 43, v6 66, v7 103, v71 52, v72 18, v8 119.
- Deploys: dpl_E7bo3NxcoBqsYVjqJiL7vQKxKjM3, dpl_BvHyyTS6S5UNHMLrdcRTWZasRueN, final dpl_9AoJ3ybCzwQtwfpBSA1JcALp5H9T. Rollback v7.2 dpl_8Y2eUSwEY29KyQVnDcR1AohrAJvX.
