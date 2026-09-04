-- Transactional fixtures only: all data created here is rolled back.
begin;
do $$
declare u uuid; s uuid; n text:='TEST-VALIDATION-'||gen_random_uuid(); a jsonb; b jsonb; p jsonb; denied boolean:=false;
begin
  select a.user_id,ses.id into u,s from private.fbf_accounts a join auth.sessions ses on ses.user_id=a.user_id
    where a.active and a.activated_at is not null and ses.created_at>a.activated_at limit 1;
  if u is null then raise exception 'No active testable session'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',s,'role','authenticated')::text,true);
  p:=public.fbf_save_provisional('cyber-octubre-2026',jsonb_build_object('number',n,'seller','Synthetic test','warehouse','9006','units',12,'planned_date','2026-09-15'),null);
  a:=public.fbf_set_validation('cyber-octubre-2026',n,'fbf',true,null);
  b:=public.fbf_set_validation('cyber-octubre-2026',n,'commercial',true,null);
  if (select count(*) from jsonb_array_elements(public.fbf_validation_snapshot('cyber-octubre-2026')) x where x->>'number'=n and (x->>'approved')::boolean)<>2 then raise exception 'Snapshot did not expose both approvals'; end if;
  perform public.fbf_save_provisional('cyber-octubre-2026',jsonb_build_object('number',n,'seller','Synthetic test','warehouse','7002','units',18,'planned_date','2026-09-18'),(p->>'revision')::uuid);
  if (select count(*) from public.preagenda_validations where number=n and approved)<>2 then raise exception 'Rescheduling cleared validations'; end if;
  begin
    perform public.fbf_set_validation('cyber-octubre-2026',n,'fbf',false,null);
    raise exception 'Stale update accepted';
  exception when serialization_failure then null;
  end;
  perform public.fbf_set_validation('cyber-octubre-2026',n,'fbf',false,(a->>'revision')::uuid);
  if not exists(select 1 from public.preagenda_validations where number=n and kind='commercial' and approved) then raise exception 'Independent approval lost'; end if;
  if (select count(*) from private.preagenda_validation_history where number=n)<>3 then raise exception 'Missing audit'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.fbf_validation_snapshot('cyber-octubre-2026');
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Anonymous access accepted'; end if;
  if has_table_privilege('authenticated','public.preagenda_validations','UPDATE') or has_table_privilege('anon','public.preagenda_validations','SELECT') then raise exception 'Direct table access granted'; end if;
end;
$$;
rollback;
select 'Checks passed; synthetic changes rolled back' as result;
