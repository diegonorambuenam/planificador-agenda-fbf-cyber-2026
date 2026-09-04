-- Run as postgres after 004. All synthetic records are rolled back.
-- Requires one existing active team session; never outputs credentials or claims.
begin;
do $$
declare
  event text := 'cyber-octubre-2026';
  fixture text := 'TEST-PROVISIONAL-'||gen_random_uuid()::text;
  claims jsonb;
  payload jsonb;
  result jsonb;
  snap jsonb;
  revision1 uuid;
  revision2 uuid;
begin
  if has_table_privilege('anon','public.provisional_requests','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.provisional_requests','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.source_requests','DELETE')
    or has_function_privilege('anon','public.fbf_save_provisional(text,jsonb,uuid)','EXECUTE')
    or has_function_privilege('anon','public.fbf_delete_provisional(text,text,uuid)','EXECUTE')
    or has_function_privilege('anon','public.fbf_planner_snapshot(text)','EXECUTE')
    then raise exception 'Unexpected public access'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.fbf_save_provisional(event,'{}'::jsonb,null);
    raise exception 'Missing session accepted for save';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fbf_delete_provisional(event,fixture,gen_random_uuid());
    raise exception 'Missing session accepted for delete';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fbf_planner_snapshot(event);
    raise exception 'Missing session accepted for read';
  exception when insufficient_privilege then null; end;

  -- Simulated request context, not a login: reuse an existing authorized session
  -- only inside this rollback transaction. Do not alter users or credentials.
  select jsonb_build_object('sub',a.user_id,'session_id',s.id,'role','authenticated') into claims
    from private.fbf_accounts a join auth.sessions s on s.user_id=a.user_id
    where a.active and a.activated_at is not null and s.created_at>a.activated_at
    order by s.created_at desc limit 1;
  if claims is null then raise exception 'Sign into the app before running integration tests'; end if;
  perform set_config('request.jwt.claims',claims::text,true);
  if not public.is_fbf_team_member() then raise exception 'Test context is not authorized'; end if;
  payload := jsonb_build_object('number',fixture,'seller','Synthetic test only','seller_id','',
    'warehouse','7002','units',80,'planned_date','2026-09-14','priority','Alta','comment','Synthetic reservation');
  result := public.fbf_save_provisional(event,payload,null);
  revision1 := (result->>'revision')::uuid;
  if revision1 is null then raise exception 'Create failed'; end if;
  begin
    perform public.fbf_save_provisional(event,payload,null);
    raise exception 'Duplicate create accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.fbf_save_provisional(event,payload||'{"units":-1}'::jsonb,revision1);
    raise sqlstate 'XX000' using message='Invalid units accepted';
  exception when raise_exception or check_violation then null; end;
  result := public.fbf_save_provisional(event,payload||'{"units":120}'::jsonb,revision1);
  revision2 := (result->>'revision')::uuid;
  if revision2=revision1 then raise exception 'Revision did not change'; end if;
  begin
    perform public.fbf_delete_provisional(event,fixture,revision1);
    raise exception 'Stale delete accepted';
  exception when serialization_failure then null; end;
  perform public.fbf_delete_provisional(event,fixture,revision2);
  if not exists(select 1 from public.provisional_requests where event_id=event and number=fixture and deleted_at is not null)
    then raise exception 'Delete is not recoverable'; end if;
  snap := public.fbf_planner_snapshot(event);
  if exists(select 1 from jsonb_array_elements(snap->'provisionals') p where p->>'number'=fixture)
    then raise exception 'Deleted reservation still visible'; end if;
  result := public.fbf_save_provisional(event,payload,null);
  revision2 := (result->>'revision')::uuid;
  begin
    perform public.fbf_save_provisional(event,payload,revision1);
    raise exception 'Recreated row accepted old revision';
  exception when serialization_failure then null; end;

  -- Simulate arrival in the existing source table; never refresh BigQuery.
  insert into public.source_requests(event_id,number,source_row,source_present)
    values(event,fixture,jsonb_build_object('number',fixture),true);
  begin
    perform public.fbf_delete_provisional(event,fixture,revision2);
    raise sqlstate 'XX000' using message='Official row was deletable';
  exception when raise_exception then
    if sqlerrm not like 'FORMULARIO:%' then raise; end if;
  end;
  begin
    perform public.fbf_save_provisional(event,payload,revision2);
    raise sqlstate 'XX000' using message='Official row was editable';
  exception when raise_exception then
    if sqlerrm not like 'FORMULARIO:%' then raise; end if;
  end;
  snap := public.fbf_planner_snapshot(event);
  if not exists(select 1 from jsonb_array_elements(snap->'provisionals') p
    where p->>'number'=fixture and (p->>'official')::boolean and p->>'planned_date'='2026-09-14')
    then raise exception 'Promotion lost date'; end if;
  update public.source_requests set source_present=false where event_id=event and number=fixture;
  begin
    perform public.fbf_delete_provisional(event,fixture,revision2);
    raise sqlstate 'XX000' using message='Absent official row was deletable';
  exception when raise_exception then
    if sqlerrm not like 'FORMULARIO:%' then raise; end if;
  end;
  raise notice 'Provisional integration tests passed; rolling back all fixtures';
end;
$$;
rollback;
