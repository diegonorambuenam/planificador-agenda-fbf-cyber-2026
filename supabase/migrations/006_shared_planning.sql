-- Shared operational planning; never changes source fields or pre-agenda approvals.
begin;
create table if not exists public.agenda_plans (
  event_id text not null, number text not null,
  planned_date date check (planned_date between date '2000-01-01' and date '2100-12-31'),
  priority text not null check (priority in ('Normal','Media','Alta')),
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(), updated_by uuid not null,
  primary key(event_id,number)
);
alter table public.agenda_plans enable row level security;
revoke all on public.agenda_plans from public,anon,authenticated;
create table if not exists private.agenda_plan_history (
  id bigint generated always as identity primary key,
  event_id text not null, number text not null, origin text not null,
  previous_date date, planned_date date, previous_priority text, priority text,
  changed_at timestamptz not null default now(), changed_by uuid not null
);
alter table private.agenda_plan_history enable row level security;
revoke all on private.agenda_plan_history from public,anon,authenticated;
create or replace function private.audit_provisional_plan()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' or old.planned_date is distinct from new.planned_date or old.priority is distinct from new.priority then
    insert into private.agenda_plan_history(event_id,number,origin,previous_date,planned_date,previous_priority,priority,changed_by)
    values(new.event_id,new.number,'provisional',old.planned_date,new.planned_date,old.priority,new.priority,new.updated_by);
  end if;
  return new;
end;
$$;
revoke all on function private.audit_provisional_plan() from public,anon,authenticated;
drop trigger if exists audit_provisional_plan on public.provisional_requests;
create trigger audit_provisional_plan after insert or update on public.provisional_requests
for each row execute function private.audit_provisional_plan();

create or replace function public.fbf_set_plan(p_event_id text,p_number text,p_date date,p_priority text,p_revision uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.agenda_plans; saved public.agenda_plans; prov public.provisional_requests; result jsonb;
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  if p_event_id is distinct from 'cyber-octubre-2026' or p_number is null or length(btrim(p_number)) not between 1 and 200
    or p_priority is null or p_priority not in ('Normal','Media','Alta') or p_origin is null or p_origin not in ('sheet','provisional')
    or (p_date is not null and p_date not between date '2000-01-01' and date '2100-12-31') then raise exception 'Invalid planning'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fbf-source:'||p_event_id,0));
  if p_origin='provisional' then
    if exists(select 1 from public.source_requests where event_id=p_event_id and number=p_number) then
      raise sqlstate '40001' using message='Request promoted to official. Refresh before retrying'; end if;
    if p_date is null then raise exception 'A provisional requires a reserved date'; end if;
    update public.provisional_requests set planned_date=p_date,priority=p_priority,updated_at=now(),updated_by=auth.uid(),revision=gen_random_uuid()
      where event_id=p_event_id and number=p_number and deleted_at is null and revision=p_revision returning * into prov;
    if not found then raise sqlstate '40001' using message='Provisional changed or deleted'; end if;
    result:=jsonb_build_object('number',prov.number,'origin','provisional','planned_date',prov.planned_date,'priority',prov.priority,
      'revision',prov.revision,'updated_at',prov.updated_at);
  else
    if not exists(select 1 from public.source_requests where event_id=p_event_id and number=p_number) then
      raise sqlstate 'P0001' using message='Request is not shared'; end if;
    select * into old from public.agenda_plans where event_id=p_event_id and number=p_number for update;
    if p_revision is distinct from old.revision then raise sqlstate '40001' using message='Planning changed. Refresh before retrying'; end if;
    insert into public.agenda_plans(event_id,number,planned_date,priority,updated_by)
      values(p_event_id,p_number,p_date,p_priority,auth.uid())
      on conflict(event_id,number) do update set planned_date=excluded.planned_date,priority=excluded.priority,
        updated_by=auth.uid(),updated_at=now(),revision=gen_random_uuid() returning * into saved;
    insert into private.agenda_plan_history(event_id,number,origin,previous_date,planned_date,previous_priority,priority,changed_by)
      values(p_event_id,p_number,'sheet',old.planned_date,p_date,old.priority,p_priority,auth.uid());
    result:=jsonb_build_object('number',saved.number,'origin','sheet','planned_date',saved.planned_date,'priority',saved.priority,
      'revision',saved.revision,'updated_at',saved.updated_at);
  end if;
  return result||jsonb_build_object('updated_by',(select username from private.fbf_accounts where user_id=auth.uid()));
end;
$$;
revoke all on function public.fbf_set_plan(text,text,date,text,uuid,text) from public,anon;
grant execute on function public.fbf_set_plan(text,text,date,text,uuid,text) to authenticated;

create or replace function public.fbf_planner_snapshot(p_event_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb; provisionals jsonb; plans jsonb;
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  if p_event_id is distinct from 'cyber-octubre-2026' then raise exception 'Invalid event'; end if;
  source:=public.fbf_requests_snapshot(p_event_id);
  select coalesce(jsonb_agg(jsonb_build_object('number',p.number,'seller_id',p.seller_id,'seller',p.seller,
    'warehouse',p.warehouse,'units',p.units,'planned_date',p.planned_date,'priority',p.priority,'comment',p.comment,
    'revision',p.revision,'created_at',p.created_at,'updated_at',p.updated_at,'updated_by',a.username,
    'official',exists(select 1 from public.source_requests r where r.event_id=p.event_id and r.number=p.number)) order by p.number),'[]'::jsonb)
    into provisionals from public.provisional_requests p left join private.fbf_accounts a on a.user_id=p.updated_by
    where p.event_id=p_event_id and p.deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('number',p.number,'origin','sheet','planned_date',p.planned_date,
    'priority',p.priority,'revision',p.revision,'updated_at',p.updated_at,'updated_by',a.username)),'[]'::jsonb)
    into plans from public.agenda_plans p left join private.fbf_accounts a on a.user_id=p.updated_by
    where p.event_id=p_event_id and exists(select 1 from public.source_requests r where r.event_id=p.event_id and r.number=p.number);
  return jsonb_build_object('source',source,'provisionals',provisionals,'plans',plans);
end;
$$;
revoke all on function public.fbf_planner_snapshot(text) from public,anon;
grant execute on function public.fbf_planner_snapshot(text) to authenticated;
commit;
