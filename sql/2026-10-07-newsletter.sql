
-- Michael AI v7.1: Monday & Friday Letters newsletter (Oct 7 2026)
create table if not exists michael_ai.nl_letters (
  id bigserial primary key,
  ns text not null default 'wa',
  kind text not null default 'letter' check (kind in ('letter','oneoff')),
  slot int,
  send_on date not null,                 -- Lagos calendar date
  send_at timestamptz not null,          -- 08:00 Lagos (07:00 UTC) for letters; the confirm time for one-offs
  subject text not null,
  fields jsonb not null default '{}'::jsonb,   -- title, day, verse..., body, promise, signoff, book, book_link (rendered by the bot)
  status text not null default 'scheduled' check (status in ('scheduled','skipped','sending','done','expired','cancelled')),
  total int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  dropped int not null default 0,
  preview_at timestamptz,
  preview_how text,
  skipped_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created timestamptz not null default now(),
  updated timestamptz not null default now()
);
create unique index if not exists nl_letters_slot on michael_ai.nl_letters(ns, slot) where kind = 'letter';
create index if not exists nl_letters_due on michael_ai.nl_letters(ns, status, send_at);

create table if not exists michael_ai.nl_sends (
  letter_id bigint not null references michael_ai.nl_letters(id) on delete cascade,
  email text not null,
  status text not null default 'queued' check (status in ('queued','inflight','sent','failed','dropped')),
  tries int not null default 0,
  lease_until timestamptz,
  sent_at timestamptz,
  err text,
  primary key (letter_id, email)
);
create index if not exists nl_sends_status on michael_ai.nl_sends(letter_id, status);
create index if not exists nl_sends_sent_at on michael_ai.nl_sends(sent_at) where status = 'sent';
alter table michael_ai.nl_letters enable row level security;
alter table michael_ai.nl_sends enable row level security;
revoke all on michael_ai.nl_letters, michael_ai.nl_sends from anon, authenticated;


create table if not exists michael_ai.daily_push (
  ns text not null, kind text not null, day date not null,
  how text not null, detail text, at timestamptz not null default now(),
  primary key (ns, kind, day)
);
alter table michael_ai.daily_push enable row level security;
revoke all on michael_ai.daily_push from anon, authenticated;

create or replace function michael_ai.nl_refresh(p_id bigint) returns michael_ai.nl_letters
language plpgsql security definer set search_path to 'michael_ai','public' as $$
declare r michael_ai.nl_letters; q int;
begin
  update michael_ai.nl_letters l set
    sent = (select count(*) from michael_ai.nl_sends s where s.letter_id = l.id and s.status = 'sent'),
    failed = (select count(*) from michael_ai.nl_sends s where s.letter_id = l.id and s.status = 'failed'),
    dropped = (select count(*) from michael_ai.nl_sends s where s.letter_id = l.id and s.status = 'dropped'),
    updated = now()
  where l.id = p_id returning * into r;
  select count(*) into q from michael_ai.nl_sends s where s.letter_id = p_id and s.status in ('queued','inflight');
  if r.status = 'sending' and q = 0 then
    update michael_ai.nl_letters set status = 'done', finished_at = now() where id = p_id returning * into r;
  end if;
  return r;
end $$;

create or replace function public.michael_ai_newsletter(p_key text, p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'michael_ai','public' as $$
declare a jsonb := coalesce(p_args,'{}'::jsonb); v_ns text := coalesce(a->>'ns','wa'); r michael_ai.nl_letters; out jsonb; n int; x jsonb;
  v_now timestamptz := coalesce((a->>'now')::timestamptz, now());
begin
  if p_key is null or p_key is distinct from (select v from michael_ai.cfg where k = 'key') then raise exception 'denied'; end if;

  if p_op = 'import' then          -- upsert scheduled letters; never touches a letter that already started or was skipped
    n := 0;
    for x in select * from jsonb_array_elements(coalesce(a->'rows','[]'::jsonb)) loop
      insert into michael_ai.nl_letters(ns, kind, slot, send_on, send_at, subject, fields)
      values (v_ns, 'letter', (x->>'slot')::int, (x->>'send_on')::date, (x->>'send_at')::timestamptz, x->>'subject', x->'fields')
      on conflict (ns, slot) where kind = 'letter' do update set
        send_on = excluded.send_on, send_at = excluded.send_at, subject = excluded.subject, fields = excluded.fields, updated = now()
        where michael_ai.nl_letters.status = 'scheduled';
      n := n + 1;
    end loop;
    return jsonb_build_object('rows', n, 'scheduled', (select count(*) from michael_ai.nl_letters where ns = v_ns and status = 'scheduled'));

  elsif p_op = 'oneoff' then
    insert into michael_ai.nl_letters(ns, kind, send_on, send_at, subject, fields)
    values (v_ns, 'oneoff', (v_now at time zone 'Africa/Lagos')::date, v_now, a->>'subject', coalesce(a->'fields','{}'::jsonb)) returning * into r;
    return to_jsonb(r);

  elsif p_op = 'subs_count' then
    return to_jsonb((select count(distinct lower(trim(email))) from public.newsletter_subscribers where marketing_consent and email like '%@%'));

  elsif p_op = 'upcoming' then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'slot', slot, 'send_on', send_on, 'send_at', send_at, 'subject', subject, 'preview_at', preview_at) order by send_at), '[]'::jsonb) into out
      from (select * from michael_ai.nl_letters where ns = v_ns and status = 'scheduled' order by send_at limit coalesce((a->>'n')::int, 3)) t;
    return out;

  elsif p_op = 'status' then       -- the letter being sent now, else the last one finished
    select * into r from michael_ai.nl_letters where ns = v_ns and status in ('sending','done') order by (status = 'sending') desc, started_at desc nulls last limit 1;
    if not found then return null; end if;
    r := michael_ai.nl_refresh(r.id);
    return to_jsonb(r) - 'fields' || jsonb_build_object('queued', (select count(*) from michael_ai.nl_sends where letter_id = r.id and status in ('queued','inflight')));

  elsif p_op = 'spare_count' then
    return to_jsonb((select count(*) from michael_ai.nl_letters where ns = v_ns and status = 'skipped'));

  elsif p_op = 'skip_next' then
    select * into r from michael_ai.nl_letters where ns = v_ns and status = 'scheduled' and kind = 'letter' and send_at > v_now order by send_at limit 1 for update;
    if not found then return null; end if;
    update michael_ai.nl_letters set status = 'skipped', skipped_at = now(), updated = now() where id = r.id returning * into r;
    return to_jsonb(r) - 'fields';

  elsif p_op = 'unskip' then
    select * into r from michael_ai.nl_letters where ns = v_ns and status = 'skipped' order by skipped_at desc limit 1 for update;
    if not found then return null; end if;
    if r.send_at <= v_now then return to_jsonb(r) - 'fields' || '{"past":true}'::jsonb; end if;
    update michael_ai.nl_letters set status = 'scheduled', skipped_at = null, updated = now() where id = r.id returning * into r;
    return to_jsonb(r) - 'fields';

  elsif p_op = 'due' then          -- start every scheduled letter whose time has come: snapshot its recipients once
    update michael_ai.nl_letters set status = 'expired', updated = now()
      where ns = v_ns and status = 'scheduled' and send_at < v_now - interval '3 days';
    for r in select * from michael_ai.nl_letters where ns = v_ns and status = 'scheduled' and send_at <= v_now order by send_at for update skip locked loop
      if v_ns = 'wa' then
        insert into michael_ai.nl_sends(letter_id, email)
          select distinct r.id, lower(trim(email)) from public.newsletter_subscribers where marketing_consent and email like '%@%'
          on conflict do nothing;
      else                          -- sandbox: the test passes its own fake list, never real people
        insert into michael_ai.nl_sends(letter_id, email)
          select distinct r.id, lower(trim(e)) from jsonb_array_elements_text(coalesce(a->'test_emails','[]'::jsonb)) e
          on conflict do nothing;
      end if;
      update michael_ai.nl_letters set status = 'sending', started_at = now(), updated = now(),
        total = (select count(*) from michael_ai.nl_sends where letter_id = r.id) where id = r.id;
    end loop;
    select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('queued', (select count(*) from michael_ai.nl_sends s where s.letter_id = l.id and s.status = 'queued'),
        'stale', (select count(*) from michael_ai.nl_sends s where s.letter_id = l.id and s.status = 'inflight' and s.lease_until < now()),
        'inflight', (select count(*) from michael_ai.nl_sends s where s.letter_id = l.id and s.status = 'inflight')) order by l.send_at), '[]'::jsonb)
      into out from michael_ai.nl_letters l where l.ns = v_ns and l.status = 'sending';
    return out;

  elsif p_op = 'claim' then        -- lease up to n queued addresses of one letter (rotating order so day 2 isn't always the same people)
    if v_ns = 'wa' then
      update michael_ai.nl_sends s set status = 'dropped', err = 'unsubscribed'
        where s.letter_id = (a->>'id')::bigint and s.status = 'queued'
          and not exists (select 1 from public.newsletter_subscribers p where lower(trim(p.email)) = s.email and p.marketing_consent);
    end if;
    with c as (
      select email from michael_ai.nl_sends where letter_id = (a->>'id')::bigint and status = 'queued'
      order by md5(email || ':' || letter_id::text) limit greatest(0, coalesce((a->>'n')::int, 25)) for update skip locked),
    u as (
      update michael_ai.nl_sends s set status = 'inflight', tries = tries + 1, lease_until = now() + make_interval(secs => coalesce((a->>'lease_s')::int, 600))
      from c where s.letter_id = (a->>'id')::bigint and s.email = c.email returning s.email)
    select coalesce(jsonb_agg(email), '[]'::jsonb) into out from u;
    return out;

  elsif p_op = 'stale' then
    select coalesce(jsonb_agg(email), '[]'::jsonb) into out from michael_ai.nl_sends
      where letter_id = (a->>'id')::bigint and status = 'inflight' and lease_until < now();
    return out;

  elsif p_op = 'mark' then          -- sent: [emails]; failed: [emails] (+err); requeue: [emails]
    update michael_ai.nl_sends set status = 'sent', sent_at = now(), lease_until = null, err = null
      where letter_id = (a->>'id')::bigint and email in (select jsonb_array_elements_text(coalesce(a->'sent','[]'::jsonb)));
    update michael_ai.nl_sends set status = case when tries >= 3 then 'failed' else 'queued' end, lease_until = null, err = left(a->>'err', 300)
      where letter_id = (a->>'id')::bigint and status = 'inflight' and email in (select jsonb_array_elements_text(coalesce(a->'failed','[]'::jsonb)));
    update michael_ai.nl_sends set status = 'queued', lease_until = null, tries = greatest(tries - 1, 0)
      where letter_id = (a->>'id')::bigint and status = 'inflight' and email in (select jsonb_array_elements_text(coalesce(a->'requeue','[]'::jsonb)));
    update michael_ai.nl_sends set status = 'dropped', lease_until = null, err = 'skipped by the site'
      where letter_id = (a->>'id')::bigint and status = 'inflight' and email in (select jsonb_array_elements_text(coalesce(a->'dropped','[]'::jsonb)));
    r := michael_ai.nl_refresh((a->>'id')::bigint);
    return to_jsonb(r) - 'fields';

  elsif p_op = 'sent_today' then   -- our own sends since 00:00 UTC (Brevo's day), all namespaces that really send
    return to_jsonb((select count(*) from michael_ai.nl_sends s join michael_ai.nl_letters l on l.id = s.letter_id
      where l.ns = 'wa' and s.status = 'sent' and s.sent_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'));

  elsif p_op = 'preview_due' then  -- the next scheduled letter for a given Lagos date that has not had its evening preview
    select * into r from michael_ai.nl_letters where ns = v_ns and status = 'scheduled' and send_on = (a->>'date')::date and preview_at is null order by send_at limit 1;
    if not found then return null; end if;
    return to_jsonb(r) - 'fields';

  elsif p_op = 'preview_mark' then
    update michael_ai.nl_letters set preview_at = now(), preview_how = a->>'how', updated = now() where id = (a->>'id')::bigint and ns = v_ns returning * into r;
    return to_jsonb(r) - 'fields';

  elsif p_op = 'get' then
    select * into r from michael_ai.nl_letters where id = (a->>'id')::bigint and ns = v_ns;
    if not found then return null; end if;
    return to_jsonb(r);

  elsif p_op = 'by_slot' then
    select * into r from michael_ai.nl_letters where slot = (a->>'slot')::int and ns = v_ns and kind = 'letter';
    if not found then return null; end if;
    return to_jsonb(r);

  elsif p_op = 'daily_claim' then  -- once-a-day pushes (daily verse): true only for the first caller of (ns, kind, day)
    insert into michael_ai.daily_push(ns, kind, day, how) values (v_ns, a->>'kind', (a->>'day')::date, coalesce(a->>'how', 'claimed'))
      on conflict do nothing;
    get diagnostics n = row_count;
    return to_jsonb(n = 1);

  elsif p_op = 'daily_mark' then
    update michael_ai.daily_push set how = a->>'how', detail = left(a->>'detail', 300), at = now()
      where ns = v_ns and kind = a->>'kind' and day = (a->>'day')::date;
    return to_jsonb(true);

  elsif p_op = 'daily_get' then
    select to_jsonb(d) into out from michael_ai.daily_push d where ns = v_ns and kind = a->>'kind' and day = (a->>'day')::date;
    return out;

  elsif p_op = 'purge_test' then
    delete from michael_ai.daily_push where ns = 'wa-test';
    delete from michael_ai.nl_letters where ns = 'wa-test';
    get diagnostics n = row_count;
    return to_jsonb(n);
  end if;
  raise exception 'unknown op %', p_op;
end $$;
revoke all on function public.michael_ai_newsletter(text, text, jsonb) from public;
grant execute on function public.michael_ai_newsletter(text, text, jsonb) to anon, authenticated;
revoke all on function michael_ai.nl_refresh(bigint) from public, anon, authenticated;

insert into michael_ai.sched(name, url, next_due) values
  ('newsletter', coalesce((select v from michael_ai.cfg where k='base_url'),'https://michael-ai-mu.vercel.app') || '/api/cron?task=newsletter', null),
  ('newsletter-test', coalesce((select v from michael_ai.cfg where k='base_url'),'https://michael-ai-mu.vercel.app') || '/api/cron?task=newsletter&sandbox=1', null)
on conflict (name) do nothing;
insert into michael_ai.sched(name, url, next_due) values
  ('verse', coalesce((select v from michael_ai.cfg where k='base_url'),'https://michael-ai-mu.vercel.app') || '/api/cron?task=verse', null),
  ('verse-test', coalesce((select v from michael_ai.cfg where k='base_url'),'https://michael-ai-mu.vercel.app') || '/api/cron?task=verse&sandbox=1', null)
on conflict (name) do nothing;
