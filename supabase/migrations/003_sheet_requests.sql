-- Schema only. Execute as postgres after 002. No keys or seller data here.
begin;
create table if not exists private.fbf_sync_keys (
  event_id text primary key,
  key_hash bytea not null,
  active boolean not null default true
);
revoke all on private.fbf_sync_keys from public, anon, authenticated, service_role;
alter table private.fbf_sync_keys enable row level security;

create table if not exists public.source_requests (
  event_id text not null,
  number text not null,
  source_row jsonb not null,
  source_present boolean not null default true,
  received_at timestamptz not null default now(),
  primary key(event_id, number)
);
create table if not exists public.source_sync_state (
  event_id text primary key,
  source_refreshed_at timestamptz not null,
  received_at timestamptz not null default now(),
  row_count integer not null,
  payload_hash bytea not null
);
alter table public.source_requests enable row level security;
alter table public.source_sync_state enable row level security;
revoke all on public.source_requests, public.source_sync_state from public, anon, authenticated;
-- All reads go through one authorized, transaction-consistent snapshot RPC.

create or replace function private.issue_fbf_sync_key(target_event text)
returns text language plpgsql security definer set search_path = '' as $$
declare new_key text;
begin
  if target_event <> 'cyber-octubre-2026' then raise exception 'Invalid event'; end if;
  new_key := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.fbf_sync_keys(event_id,key_hash)
  values(target_event,extensions.digest(new_key,'sha256'))
  on conflict(event_id) do update set key_hash=excluded.key_hash, active=true;
  return new_key;
end;
$$;
revoke all on function private.issue_fbf_sync_key(text) from public, anon, authenticated, service_role;

create or replace function public.fbf_ingest_requests(
  p_event_id text, p_source_refreshed_at timestamptz, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare supplied_key text; previous public.source_sync_state; checksum bytea; n integer;
begin
  supplied_key := coalesce(nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-fbf-sync-key','');
  if supplied_key !~ '^[a-f0-9]{64}$' or not exists (
    select 1 from private.fbf_sync_keys where event_id=p_event_id and active
      and key_hash=extensions.digest(supplied_key,'sha256')
  ) then raise sqlstate '42501' using message='Sync not authorized'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Expected rows array'; end if;
  n := jsonb_array_length(p_rows);
  if n < 1 or n > 25000 or octet_length(p_rows::text)>5000000 then
    raise exception 'Snapshot empty or too large; previous data retained';
  end if;
  if p_source_refreshed_at is null or not isfinite(p_source_refreshed_at)
    or p_source_refreshed_at > now()+interval '5 minutes' then raise exception 'Invalid source refresh time'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where
    jsonb_typeof(r) <> 'object' or not (r ?& array['creado','seller_id','seller','node_id','fecha_envio','estado','number','units','fecha_ini','fecha_fin'])
    or jsonb_typeof(r->'number') is distinct from 'string'
    or length(btrim(r->>'number')) not between 1 and 200)
    then raise exception 'Invalid columns or number; previous data retained'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r
    group by btrim(r->>'number') having count(*)>1)
    then raise exception 'Duplicate numbers; previous data retained'; end if;
  -- Serialize snapshots. Failed validation never changes source or manual data.
  perform pg_advisory_xact_lock(hashtextextended('fbf-source:'||p_event_id,0));
  select * into previous from public.source_sync_state where event_id=p_event_id;
  checksum := extensions.digest(p_rows::text,'sha256');
  if found and p_source_refreshed_at < previous.source_refreshed_at then
    raise exception 'Outdated snapshot; previous data retained';
  end if;
  if previous.source_refreshed_at = p_source_refreshed_at then
    if previous.payload_hash <> checksum then raise exception 'Snapshot changed without a new source refresh'; end if;
    return jsonb_build_object('ok',true,'unchanged',true,'rows',n);
  end if;
  update public.source_requests set source_present=false where event_id=p_event_id;
  insert into public.source_requests(event_id,number,source_row,source_present,received_at)
    select p_event_id,btrim(r->>'number'),r,true,now() from jsonb_array_elements(p_rows) r
    on conflict(event_id,number) do update set source_row=excluded.source_row,
      source_present=true,received_at=excluded.received_at;
  insert into public.source_sync_state(event_id,source_refreshed_at,received_at,row_count,payload_hash)
    values(p_event_id,p_source_refreshed_at,now(),n,checksum)
    on conflict(event_id) do update set source_refreshed_at=excluded.source_refreshed_at,
      received_at=excluded.received_at,row_count=excluded.row_count,payload_hash=excluded.payload_hash;
  return jsonb_build_object('ok',true,'rows',n);
end;
$$;
revoke all on function public.fbf_ingest_requests(text,timestamptz,jsonb) from public, authenticated;
grant execute on function public.fbf_ingest_requests(text,timestamptz,jsonb) to anon;

create or replace function public.fbf_requests_snapshot(p_event_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  return (select jsonb_build_object('source_refreshed_at',s.source_refreshed_at,
    'received_at',s.received_at,'row_count',s.row_count,
    'rows',coalesce((select jsonb_agg(jsonb_build_object('source',r.source_row,'present',r.source_present) order by r.number)
      from public.source_requests r where r.event_id=s.event_id),'[]'::jsonb))
    from public.source_sync_state s where s.event_id=p_event_id);
end;
$$;
revoke all on function public.fbf_requests_snapshot(text) from public, anon;
grant execute on function public.fbf_requests_snapshot(text) to authenticated;
commit;
