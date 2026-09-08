begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
select ok(to_regclass('public.bookings') is not null, 'bookings table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.bookings'::regclass), 'booking RLS is enabled');
select ok(not has_table_privilege('anon', 'public.bookings', 'SELECT,INSERT,UPDATE,DELETE'), 'anonymous callers have no direct access');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'SELECT,INSERT,UPDATE,DELETE'), 'staff must use the BFF for bookings');
select ok(has_table_privilege('service_role', 'public.bookings', 'SELECT,INSERT,UPDATE'), 'BFF can persist and claim bookings');
select ok(not has_table_privilege('service_role', 'public.bookings', 'DELETE'), 'BFF cannot remove reconciliation records');
insert into auth.users (id, email) values ('99999999-9999-4999-8999-999999999999', 'booking-test@example.test');
insert into public.bookings (id, actor_id, fingerprint, status, payload) values (
  '22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999999', repeat('a', 64), 'created',
  '{"id":"22222222-2222-4222-8222-222222222222","status":"created"}'
);
select throws_ok($$insert into public.bookings select * from public.bookings$$, '23505', null, 'duplicate request IDs cannot claim another create');
with claimed as (
  update public.bookings set status = 'confirming', payload = jsonb_set(payload, '{status}', '"confirming"')
  where id = '22222222-2222-4222-8222-222222222222' and status = 'created' returning id
) select is((select count(*) from claimed), 1::bigint, 'first confirmation claims the booking');
with claimed as (
  update public.bookings set status = 'confirming', payload = jsonb_set(payload, '{status}', '"confirming"')
  where id = '22222222-2222-4222-8222-222222222222' and status = 'created' returning id
) select is((select count(*) from claimed), 0::bigint, 'second confirmation cannot claim the same booking');
select throws_ok($$update public.bookings set status = 'confirmed'$$, '23514', null, 'stored payload and state must agree');
select * from finish();
rollback;
