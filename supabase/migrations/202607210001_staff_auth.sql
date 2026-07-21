create type public.staff_role as enum ('admin', 'staff');
create type public.staff_status as enum ('active', 'disabled');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  role public.staff_role not null default 'staff',
  status public.staff_status not null default 'active',
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at desc);
create index audit_events_target_created_idx on public.audit_events (target_user_id, created_at desc);

create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- Database-level protection against racing requests that demote/disable the final active admin.
create function public.protect_last_active_admin() returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active') then
    perform pg_advisory_xact_lock(74689102);
    if (select count(*) from public.profiles where role = 'admin' and status = 'active' and user_id <> old.user_id) = 0 then
      raise exception 'cannot disable or demote the final active admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_admin before update on public.profiles
for each row execute function public.protect_last_active_admin();

alter table public.profiles enable row level security;
alter table public.audit_events enable row level security;

create function public.is_active_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

revoke all on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated;

create policy "staff read own profile" on public.profiles
for select to authenticated using (user_id = auth.uid());

create policy "admins read profiles" on public.profiles
for select to authenticated using (public.is_active_admin());

create policy "admins read audit events" on public.audit_events
for select to authenticated using (public.is_active_admin());

-- There are deliberately no client mutation policies. The BFF uses service_role.
revoke insert, update, delete on public.profiles from authenticated, anon;
revoke insert, update, delete on public.audit_events from authenticated, anon;
