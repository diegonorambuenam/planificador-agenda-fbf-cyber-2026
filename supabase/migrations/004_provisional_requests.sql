-- Shared provisional reservations. Never grants writes/deletes on source_requests.
begin;
create table if not exists public.provisional_requests (
  event_id text not null,
  number text not null,
  seller_id text not null default '',
  seller text not null,
  warehouse text not null check (warehouse in ('7002','9006')),
  units integer not null check (units > 0 and units <= 1000000000),
  planned_date date not null check (planned_date between date '2000-01-01' and date '2100-12-31'),
  priority text not null default 'Normal' check (priority in ('Normal','Media','Alta')),
  comment text not null default '',
  revision uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  deleted_at timestamptz,
  primary key (event_id,number)
);
alter table public.provisional_requests enable row level security;
revoke all on public.provisional_requests from public,anon,authenticated;

create or replace function public.fbf_save_provisional(p_event_id text,p_row jsonb,p_revision uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n text; old public.provisional_requests; saved public.provisional_requests;
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  if p_event_id is distinct from 'cyber-octubre-2026' then raise exception 'Invalid event'; end if;
  if jsonb_typeof(p_row) is distinct from 'object' then raise exception 'Invalid provisional'; end if;
  n := btrim(p_row->>'number');
  if n is null or length(n) not between 1 and 200 or
    length(btrim(coalesce(p_row->>'seller',''))) not between 1 and 300 or
    length(coalesce(p_row->>'seller_id',''))>200 or length(coalesce(p_row->>'comment',''))>2000 or
    coalesce(p_row->>'units','') !~ '^[0-9]{1,10}$' or
    coalesce(p_row->>'planned_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then raise exception 'Invalid provisional fields'; end if;
  -- Same lock as ingestion: promotion, creation and deletion cannot race.
  perform pg_advisory_xact_lock(hashtextextended('fbf-source:'||p_event_id,0));
  if exists(select 1 from public.source_requests where event_id=p_event_id and number=n) then
    raise sqlstate 'P0001' using message='FORMULARIO: esta solicitud ya es oficial y no se puede editar como provisoria';
  end if;
  select * into old from public.provisional_requests where event_id=p_event_id and number=n for update;
  if old.number is not null and old.deleted_at is null then
    if p_revision is distinct from old.revision then raise sqlstate '40001' using message='La provisoria cambio. Actualiza antes de guardar'; end if;
  elsif p_revision is not null then
    raise sqlstate '40001' using message='La provisoria fue eliminada. Actualiza la lista';
  end if;
  insert into public.provisional_requests(event_id,number,seller_id,seller,warehouse,units,planned_date,priority,comment,updated_by)
  values(p_event_id,n,btrim(coalesce(p_row->>'seller_id','')),btrim(p_row->>'seller'),p_row->>'warehouse',
    (p_row->>'units')::integer,(p_row->>'planned_date')::date,coalesce(p_row->>'priority','Normal'),coalesce(p_row->>'comment',''),auth.uid())
  on conflict(event_id,number) do update set seller_id=excluded.seller_id,seller=excluded.seller,
    warehouse=excluded.warehouse,units=excluded.units,planned_date=excluded.planned_date,
    priority=excluded.priority,comment=excluded.comment,revision=gen_random_uuid(),updated_at=now(),updated_by=auth.uid(),deleted_at=null
  returning * into saved;
  return jsonb_build_object('ok',true,'revision',saved.revision);
end;
$$;
revoke all on function public.fbf_save_provisional(text,jsonb,uuid) from public,anon;
grant execute on function public.fbf_save_provisional(text,jsonb,uuid) to authenticated;

create or replace function public.fbf_delete_provisional(p_event_id text,p_number text,p_revision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  if p_event_id is distinct from 'cyber-octubre-2026' then raise exception 'Invalid event'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fbf-source:'||p_event_id,0));
  if exists(select 1 from public.source_requests where event_id=p_event_id and number=btrim(p_number)) then
    raise sqlstate 'P0001' using message='FORMULARIO: no se pueden borrar solicitudes del formulario';
  end if;
  -- Recoverable soft delete; only a live provisional with the expected revision.
  update public.provisional_requests set deleted_at=now(),updated_at=now(),updated_by=auth.uid(),revision=gen_random_uuid()
    where event_id=p_event_id and number=btrim(p_number) and revision=p_revision and deleted_at is null;
  if not found then raise sqlstate '40001' using message='La provisoria cambio o ya fue eliminada. Actualiza la lista'; end if;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.fbf_delete_provisional(text,text,uuid) from public,anon;
grant execute on function public.fbf_delete_provisional(text,text,uuid) to authenticated;

create or replace function public.fbf_planner_snapshot(p_event_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare source jsonb; provisionals jsonb;
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  source := public.fbf_requests_snapshot(p_event_id);
  select coalesce(jsonb_agg(jsonb_build_object('number',p.number,'seller_id',p.seller_id,'seller',p.seller,
    'warehouse',p.warehouse,'units',p.units,'planned_date',p.planned_date,'priority',p.priority,'comment',p.comment,
    'revision',p.revision,'created_at',p.created_at,
    'official',exists(select 1 from public.source_requests r where r.event_id=p.event_id and r.number=p.number)) order by p.number),'[]'::jsonb)
    into provisionals from public.provisional_requests p where p.event_id=p_event_id and p.deleted_at is null;
  -- Official rows take precedence; provisional date stays as the conversion seed.
  return jsonb_build_object('source',source,'provisionals',provisionals);
end;
$$;
revoke all on function public.fbf_planner_snapshot(text) from public,anon;
grant execute on function public.fbf_planner_snapshot(text) to authenticated;
commit;
