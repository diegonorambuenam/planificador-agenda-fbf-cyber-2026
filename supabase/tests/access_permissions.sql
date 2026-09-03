-- Read-only assertions; run as postgres after 002, without request JWT claims.
-- Does not provision accounts or exercise password activation.
do $$
begin
  if public.is_fbf_team_member() then raise exception 'Sessionless access granted'; end if;
  if has_function_privilege('anon','public.fbf_activate_account(text)','execute')
    then raise exception 'Anonymous activation exposed'; end if;
  if has_function_privilege('authenticated','private.issue_fbf_activation(uuid,text)','execute')
    then raise exception 'Administrative reset exposed'; end if;
  if has_table_privilege('authenticated','private.fbf_accounts','select')
    then raise exception 'Account list exposed'; end if;
  if not exists(select 1 from pg_trigger where tgname='guard_fbf_credentials' and tgenabled='O')
    then raise exception 'Credential guard missing'; end if;
end;
$$;
