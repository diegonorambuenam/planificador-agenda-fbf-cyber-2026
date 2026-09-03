-- Capacidades compartidas del Planificador FBF.
-- Ejecutar una vez en Supabase > SQL Editor.

create table if not exists public.team_members (
  email text primary key check (email = lower(email)),
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.capacities (
  event_id text not null,
  warehouse text not null check (warehouse in ('9006', '7002')),
  date date not null,
  capacity numeric not null check (capacity >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (event_id, warehouse, date)
);

alter table public.team_members enable row level security;
alter table public.capacities enable row level security;

create or replace function public.is_fbf_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and active = true
  );
$$;

revoke all on function public.is_fbf_team_member() from public, anon;
grant execute on function public.is_fbf_team_member() to authenticated;

drop policy if exists "El miembro puede verse" on public.team_members;
create policy "El miembro puede verse"
on public.team_members for select
to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')) and active = true);

drop policy if exists "Equipo lee capacidades" on public.capacities;
create policy "Equipo lee capacidades"
on public.capacities for select
to authenticated
using (public.is_fbf_team_member());

drop policy if exists "Equipo crea capacidades" on public.capacities;
create policy "Equipo crea capacidades"
on public.capacities for insert
to authenticated
with check (public.is_fbf_team_member());

drop policy if exists "Equipo actualiza capacidades" on public.capacities;
create policy "Equipo actualiza capacidades"
on public.capacities for update
to authenticated
using (public.is_fbf_team_member())
with check (public.is_fbf_team_member());

create or replace function public.stamp_capacity_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists stamp_capacity_change on public.capacities;
create trigger stamp_capacity_change
before insert or update on public.capacities
for each row execute function public.stamp_capacity_change();

grant select on public.team_members to authenticated;
grant select, insert, update on public.capacities to authenticated;

-- Permite recibir cambios sin recargar y también puede ejecutarse más de una vez.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'capacities'
  ) then
    execute 'alter publication supabase_realtime add table public.capacities';
  end if;
end;
$$;

-- Después de ejecutar la migración, reemplaza los correos y ejecuta:
-- insert into public.team_members (email, display_name) values
--   ('persona1@empresa.com', 'Persona 1'),
--   ('persona2@empresa.com', 'Persona 2'),
--   ('persona3@empresa.com', 'Persona 3')
-- on conflict (email) do update set display_name = excluded.display_name, active = true;
