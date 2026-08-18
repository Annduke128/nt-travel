begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select ok(to_regclass('public.profiles') is not null, 'profiles table exists');
select ok(to_regclass('public.audit_events') is not null, 'audit_events table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass),
  'audit_events has RLS enabled'
);
select ok(
  (select count(*) = 2 from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  'profiles exposes only the own-profile and admin read policies'
);
select ok(
  (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'audit_events'),
  'audit_events exposes only the admin read policy'
);
select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated users may select profiles through RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.audit_events', 'SELECT'),
  'authenticated users may select audit events through RLS'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous users cannot read profiles'
);
select ok(
  has_table_privilege('service_role', 'public.profiles', 'SELECT,INSERT,UPDATE'),
  'the BFF service role can read and maintain profiles'
);
select ok(
  not has_table_privilege('service_role', 'public.profiles', 'DELETE'),
  'the BFF service role cannot delete profiles directly'
);
select ok(
  has_table_privilege('service_role', 'public.audit_events', 'INSERT'),
  'the BFF service role can append audit events'
);
select ok(
  has_sequence_privilege('service_role', pg_get_serial_sequence('public.audit_events', 'id'), 'USAGE'),
  'the BFF service role can allocate audit event identities'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT,UPDATE,DELETE'),
  'authenticated cannot mutate profiles directly'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'INSERT,UPDATE,DELETE'),
  'anonymous users cannot mutate profiles directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'INSERT,UPDATE,DELETE'),
  'authenticated cannot mutate audit events directly'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_protect_last_admin'
      and not tgisinternal
  ),
  'last-active-admin trigger exists'
);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'admin-one@nttravel.test');

insert into public.profiles (user_id, display_name, role, status, must_change_password)
values ('00000000-0000-0000-0000-000000000001', 'Admin One', 'admin', 'active', false);

select throws_ok(
  $$update public.profiles set role = 'staff' where user_id = '00000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'cannot disable or demote the final active admin',
  'the final active admin cannot be demoted'
);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000002', 'admin-two@nttravel.test');

insert into public.profiles (user_id, display_name, role, status, must_change_password)
values ('00000000-0000-0000-0000-000000000002', 'Admin Two', 'admin', 'active', false);

select lives_ok(
  $$update public.profiles set role = 'staff' where user_id = '00000000-0000-0000-0000-000000000001'$$,
  'an admin can be demoted when another active admin remains'
);
select ok(
  (select role = 'staff' from public.profiles where user_id = '00000000-0000-0000-0000-000000000001'),
  'the allowed demotion is persisted'
);

select * from finish();
rollback;
