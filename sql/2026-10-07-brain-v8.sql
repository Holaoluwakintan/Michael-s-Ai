
create extension if not exists vector with schema extensions;
create table if not exists michael_ai.kchunks (
  id bigserial primary key,
  ns text not null default 'wa',
  src text not null,            -- letters | spare-letters | monday-letters | book:<slug> | projects | learn
  title text,
  url text,
  body text not null,
  h text not null,              -- hash of body (dedupe)
  emb extensions.vector(768) not null,
  created timestamptz not null default now()
);
create unique index if not exists kchunks_h on michael_ai.kchunks(ns, h);
create index if not exists kchunks_src on michael_ai.kchunks(ns, src);
create index if not exists kchunks_emb on michael_ai.kchunks using hnsw (emb extensions.vector_cosine_ops);
alter table michael_ai.kchunks enable row level security;

create or replace function public.michael_ai_brain(p_key text, p_op text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = michael_ai, public, extensions as $f$
declare a jsonb := coalesce(p_args,'{}'::jsonb); v_ns text := coalesce(a->>'ns','wa'); n int := 0; x jsonb; out jsonb;
begin
  if p_key is null or p_key is distinct from (select v from michael_ai.cfg where k = 'key') then raise exception 'denied'; end if;
  if p_op = 'add' then
    for x in select * from jsonb_array_elements(coalesce(a->'rows','[]'::jsonb)) loop
      insert into michael_ai.kchunks(ns, src, title, url, body, h, emb)
      values (v_ns, x->>'src', x->>'title', x->>'url', x->>'body', x->>'h', (x->>'emb')::extensions.vector)
      on conflict (ns, h) do nothing;
      if found then n := n + 1; end if;
    end loop;
    return jsonb_build_object('added', n);
  elsif p_op = 'match' then        -- top k by cosine; the 'wa-test' namespace also sees the real index (read only)
    select coalesce(jsonb_agg(t order by t.score desc), '[]'::jsonb) into out from (
      select id, src, title, url, left(body, coalesce((a->>'chars')::int, 1400)) body,
             round((1 - (emb <=> (a->>'emb')::extensions.vector))::numeric, 4) score
      from michael_ai.kchunks
      where ns = v_ns or (v_ns = 'wa-test' and ns = 'wa')
      order by emb <=> (a->>'emb')::extensions.vector
      limit least(coalesce((a->>'k')::int, 5), 12)) t;
    return out;
  elsif p_op = 'stats' then
    select coalesce(jsonb_object_agg(src, c), '{}'::jsonb) into out from (
      select case when src like 'book:%' then 'books' else src end src, count(*) c from michael_ai.kchunks where ns = v_ns group by 1) s;
    return out;
  elsif p_op = 'learned' then
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'url', url, 'at', created) order by id desc), '[]'::jsonb) into out
    from (select * from michael_ai.kchunks where ns = v_ns and src = 'learn' order by id desc limit coalesce((a->>'n')::int, 10)) t;
    return out;
  elsif p_op = 'del_src' then
    delete from michael_ai.kchunks where ns = v_ns and src = a->>'src'; get diagnostics n = row_count;
    return jsonb_build_object('deleted', n);
  elsif p_op = 'del_id' then
    delete from michael_ai.kchunks where ns = v_ns and id = (a->>'id')::bigint and src = 'learn'; get diagnostics n = row_count;
    return jsonb_build_object('deleted', n);
  elsif p_op = 'purge_test' then
    delete from michael_ai.kchunks where ns = 'wa-test'; get diagnostics n = row_count;
    return jsonb_build_object('deleted', n);
  elsif p_op = 'sow_next' then     -- v8: the next queued Sow posts from every source (read only)
    select coalesce(jsonb_agg(t order by t.post_date, t.post_time), '[]'::jsonb) into out from (
      select id, post_date, to_char(post_time, 'HH24:MI') post_time, title, left(caption, 160) caption, platforms, source
      from public.sp_posts
      where status = 'queued' and post_date is not null
        and (post_date > (now() at time zone 'Africa/Lagos')::date
             or (post_date = (now() at time zone 'Africa/Lagos')::date and post_time > (now() at time zone 'Africa/Lagos')::time))
      order by post_date, post_time, position limit least(coalesce((a->>'n')::int, 3), 10)) t;
    return out;
  end if;
  raise exception 'unknown op %', p_op;
end $f$;
revoke all on function public.michael_ai_brain(text, text, jsonb) from public;
grant execute on function public.michael_ai_brain(text, text, jsonb) to anon, authenticated, service_role;
