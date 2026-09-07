-- Synthetic rows only, transaction rollback. Run after migration 006.
begin;
do $$
declare u uuid; session uuid; n text:='TEST-PLAN-'||gen_random_uuid(); a jsonb; b jsonb; p jsonb; original jsonb;
begin
  select account.user_id,s.id into u,session from private.fbf_accounts account join auth.sessions s on s.user_id=account.user_id
    where account.active and account.activated_at is not null and s.created_at>account.activated_at limit 1;
  if u is null then raise exception 'No active testable session'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',session,'role','authenticated')::text,true);
  p:=public.fbf_save_provisional('cyber-octubre-2026',jsonb_build_object('number',n,'seller','Synthetic','warehouse','7002','units',10,'planned_date','2026-09-15'),null);
  a:=public.fbf_set_plan('cyber-octubre-2026',n,'2026-09-16','Alta',(p->>'revision')::uuid,'provisional');
  if (select planned_date from public.provisional_requests where number=n)<>date '2026-09-16' then raise exception 'Provisional date not saved'; end if;
  begin
    perform public.fbf_set_plan('cyber-octubre-2026',n,'2026-09-17','Alta',(p->>'revision')::uuid,'provisional');
    raise exception 'Stale provisional accepted';
  exception when serialization_failure then null; end;
  original:=jsonb_build_object('number',n,'creado','03/09/2026 12:30:00','seller','Synthetic','seller_id','test','node_id','7002','units','10','estado','Agenda Cyber','fecha_envio','2026-10-15','fecha_ini','2026-09-07','fecha_fin','2026-09-18');
  insert into public.source_requests(event_id,number,source_row) values('cyber-octubre-2026',n,original);
  perform public.fbf_set_validation('cyber-octubre-2026',n,'fbf',true,null);
  perform public.fbf_set_validation('cyber-octubre-2026',n,'commercial',true,null);
  begin
    perform public.fbf_set_plan('cyber-octubre-2026',n,'2026-09-17','Normal',(a->>'revision')::uuid,'provisional');
    raise exception 'Promoted provisional edit accepted';
  exception when serialization_failure then null; end;
  a:=public.fbf_set_plan('cyber-octubre-2026',n,'2026-09-18','Media',null,'sheet');
  if a->>'updated_by' is distinct from (select username from private.fbf_accounts where user_id=u) then raise exception 'Actor mismatch'; end if;
  if not exists(select 1 from jsonb_array_elements(public.fbf_planner_snapshot('cyber-octubre-2026')->'plans') x where x->>'number'=n and x->>'revision'=a->>'revision') then raise exception 'Plan missing from snapshot'; end if;
  begin
    perform public.fbf_set_plan('cyber-octubre-2026',n,'2026-09-19','Alta',null,'sheet');
    raise exception 'Stale official edit accepted';
  exception when serialization_failure then null; end;
  b:=public.fbf_set_plan('cyber-octubre-2026',n,null,'Alta',(a->>'revision')::uuid,'sheet');
  if (select planned_date from public.agenda_plans where number=n) is not null then raise exception 'Unscheduling failed'; end if;
  if (select source_row from public.source_requests where number=n) is distinct from original then raise exception 'Source modified'; end if;
  if (select count(*) from public.preagenda_validations where number=n and approved)<>2 then raise exception 'Approvals modified'; end if;
  if (select count(*) from private.agenda_plan_history where number=n)<>4 then raise exception 'Missing history'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.fbf_set_plan('cyber-octubre-2026',n,null,'Normal',(b->>'revision')::uuid,'sheet');
    raise exception 'Anonymous write accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fbf_planner_snapshot('cyber-octubre-2026');
    raise exception 'Anonymous read accepted';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('authenticated','public.agenda_plans','UPDATE') or has_table_privilege('anon','public.agenda_plans','SELECT') then raise exception 'Direct access granted'; end if;
end;
$$;
rollback;
select 'Shared planning checks passed; synthetic changes rolled back' as result;
