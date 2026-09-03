-- Run as postgres in Supabase SQL Editor, after migration 001.
-- Generic schema only: NEVER add real accounts or activation codes here.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table if not exists private.fbf_accounts (
  user_id uuid primary key references auth.users(id),
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,31}$'),
  active boolean not null default true,
  activated_at timestamptz,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '7 days'
);
alter table private.fbf_accounts enable row level security;
revoke all on private.fbf_accounts from public, anon, authenticated;

create or replace function public.is_fbf_team_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.fbf_accounts a
    join auth.sessions s on s.user_id = a.user_id
    where a.user_id = auth.uid() and a.active and a.activated_at is not null
      and s.id::text = auth.jwt()->>'session_id'
      and s.created_at > a.activated_at
  );
$$;
revoke all on function public.is_fbf_team_member() from public, anon;
grant execute on function public.is_fbf_team_member() to authenticated;

create or replace function public.fbf_access_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
    'username', a.username,
    'pending', a.activated_at is null and a.expires_at > now() and s.created_at >= a.issued_at,
    'authorized', public.is_fbf_team_member()
  ) from private.fbf_accounts a join auth.sessions s on s.user_id = a.user_id
    where a.user_id = auth.uid() and a.active and s.id::text = auth.jwt()->>'session_id'),
    '{"pending":false,"authorized":false}'::jsonb);
$$;
revoke all on function public.fbf_access_status() from public, anon;
grant execute on function public.fbf_access_status() to authenticated;

-- Invoker is intentional: normal Auth API writes run as supabase_auth_admin,
-- whereas the two tightly scoped administrator-owned functions run as postgres.
grant usage on schema private to supabase_auth_admin;
grant select (user_id) on private.fbf_accounts to supabase_auth_admin;
drop policy if exists auth_managed_account_lookup on private.fbf_accounts;
create policy auth_managed_account_lookup on private.fbf_accounts for select
  to supabase_auth_admin using (true);
create or replace function private.guard_fbf_credentials()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('postgres', 'supabase_admin')
    and exists (select 1 from private.fbf_accounts where user_id = old.id)
    and (new.encrypted_password is distinct from old.encrypted_password
      or new.email is distinct from old.email or new.phone is distinct from old.phone)
  then raise exception 'Managed credentials: administrator operation required'; end if;
  return new;
end;
$$;
drop trigger if exists guard_fbf_credentials on auth.users;
create trigger guard_fbf_credentials before update on auth.users
  for each row execute function private.guard_fbf_credentials();

create or replace function public.fbf_activate_account(new_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare a private.fbf_accounts; old_hash text;
begin
  select * into a from private.fbf_accounts where user_id = auth.uid() for update;
  if not found or not a.active or a.activated_at is not null or a.expires_at <= clock_timestamp()
    or not exists (select 1 from auth.sessions s where s.user_id = a.user_id
      and s.id::text = auth.jwt()->>'session_id' and s.created_at >= a.issued_at)
  then raise exception 'Activation unavailable'; end if;
  if new_password is null or length(new_password) < 12 or octet_length(new_password) > 72
  then raise exception 'Password must contain at least 12 characters and at most 72 UTF-8 bytes'; end if;
  select encrypted_password into old_hash from auth.users where id = a.user_id;
  if extensions.crypt(new_password, old_hash) = old_hash
  then raise exception 'Choose a password different from the activation code'; end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
    updated_at = clock_timestamp() where id = a.user_id;
  update private.fbf_accounts set activated_at = clock_timestamp() where user_id = a.user_id;
end;
$$;
revoke all on function public.fbf_activate_account(text) from public, anon;
grant execute on function public.fbf_activate_account(text) to authenticated;

-- SQL Editor only. Code generated in the database, returned once, never stored
-- in plaintext. The query itself contains no credential. Treat results as secret.
create or replace function private.issue_fbf_activation(account_id uuid, account_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare activation_code text;
begin
  if not exists (select 1 from auth.users where id = account_id
    and email = account_username || '@fbf.invalid') then
    raise exception 'Create the confirmed Auth account with its internal alias first';
  end if;
  -- Serialize provisioning and cap membership at three accounts.
  lock table private.fbf_accounts in exclusive mode;
  if not exists (select 1 from private.fbf_accounts where user_id = account_id)
    and (select count(*) from private.fbf_accounts) >= 3 then
    raise exception 'The team already has three accounts';
  end if;
  activation_code := encode(extensions.gen_random_bytes(24), 'hex');
  insert into private.fbf_accounts(user_id, username) values(account_id, account_username)
    on conflict(user_id) do update set username = excluded.username,
      activated_at = null, active = true, issued_at = clock_timestamp(),
      expires_at = clock_timestamp() + interval '7 days';
  update auth.users set encrypted_password = extensions.crypt(activation_code, extensions.gen_salt('bf', 10)),
    updated_at = clock_timestamp() where id = account_id;
  return activation_code;
end;
$$;
revoke all on function private.issue_fbf_activation(uuid,text) from public, anon, authenticated, service_role;
-- Old email membership is retained for rollback but no longer grants data access.
revoke all on public.team_members from anon, authenticated;
commit;
