-- Independent per-number pre-agenda validations. No changes to scheduling/source data.
begin;
create table if not exists public.preagenda_validations (
  event_id text not null,
  number text not null,
  kind text not null check (kind in ('fbf','commercial')),
  approved boolean not null,
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  primary key(event_id,number,kind)
);
alter table public.preagenda_validations enable row level security;
revoke all on public.preagenda_validations from public,anon,authenticated;
create table if not exists private.preagenda_validation_history (
  id bigint generated always as identity primary key,
  event_id text not null, number text not null, kind text not null,
  approved boolean not null, changed_at timestamptz not null default now(), changed_by uuid not null
);
alter table private.preagenda_validation_history enable row level security;
revoke all on private.preagenda_validation_history from public,anon,authenticated;

create or replace function public.fbf_validation_snapshot(p_event_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  if p_event_id is distinct from 'cyber-octubre-2026' then raise exception 'Invalid event'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('number',v.number,'kind',v.kind,
    'approved',v.approved,'revision',v.revision,'updated_at',v.updated_at,'updated_by',a.username)),'[]'::jsonb)
    from public.preagenda_validations v left join private.fbf_accounts a on a.user_id=v.updated_by
    where v.event_id=p_event_id and (exists(select 1 from public.source_requests r where r.event_id=v.event_id and r.number=v.number)
    or exists(select 1 from public.provisional_requests p where p.event_id=v.event_id and p.number=v.number and p.deleted_at is null)));
end;
$$;
revoke all on function public.fbf_validation_snapshot(text) from public,anon;
grant execute on function public.fbf_validation_snapshot(text) to authenticated;

create or replace function public.fbf_set_validation(p_event_id text,p_number text,p_kind text,p_approved boolean,p_revision uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.preagenda_validations; saved public.preagenda_validations;
begin
  if not public.is_fbf_team_member() then raise sqlstate '42501' using message='Team access required'; end if;
  if p_event_id is distinct from 'cyber-octubre-2026' or p_kind is null or p_kind not in ('fbf','commercial') or
    p_approved is null or p_number is null or length(btrim(p_number)) not between 1 and 200 then raise exception 'Invalid validation'; end if;
  -- Serialize with source promotion and provisional deletion. Each kind has its own revision.
  perform pg_advisory_xact_lock(hashtextextended('fbf-source:'||p_event_id,0));
  if not exists(select 1 from public.source_requests where event_id=p_event_id and number=p_number)
    and not exists(select 1 from public.provisional_requests where event_id=p_event_id and number=p_number and deleted_at is null)
    then raise sqlstate 'P0001' using message='Request is not shared or was deleted'; end if;
  select * into old from public.preagenda_validations where event_id=p_event_id and number=p_number and kind=p_kind for update;
  if p_revision is distinct from old.revision then raise sqlstate '40001' using message='Validation changed. Refresh before retrying'; end if;
  insert into public.preagenda_validations(event_id,number,kind,approved,updated_by)
    values(p_event_id,p_number,p_kind,p_approved,auth.uid())
    on conflict(event_id,number,kind) do update set approved=excluded.approved,updated_by=auth.uid(),updated_at=now(),revision=gen_random_uuid()
    returning * into saved;
  insert into private.preagenda_validation_history(event_id,number,kind,approved,changed_by)
    values(p_event_id,p_number,p_kind,p_approved,auth.uid());
  return jsonb_build_object('number',saved.number,'kind',saved.kind,'approved',saved.approved,
    'revision',saved.revision,'updated_at',saved.updated_at,'updated_by',(select username from private.fbf_accounts where user_id=auth.uid()));
end;
$$;
revoke all on function public.fbf_set_validation(text,text,text,boolean,uuid) from public,anon;
grant execute on function public.fbf_set_validation(text,text,text,boolean,uuid) to authenticated;
commit;
