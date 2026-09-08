create table public.bookings (
  id uuid primary key,
  actor_id uuid not null references auth.users(id),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('creating', 'created', 'confirming', 'confirmed', 'attention')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_payload_id check (payload->>'id' = id::text),
  constraint booking_payload_status check (payload->>'status' = status)
);
create index bookings_actor_created_idx on public.bookings (actor_id, created_at desc);
create trigger bookings_set_updated_at before update on public.bookings
for each row execute function public.set_updated_at();
alter table public.bookings enable row level security;
-- Guest details and mutation state are accessible only through the authenticated BFF.
revoke all on public.bookings from anon, authenticated, service_role;
grant select, insert, update on public.bookings to service_role;
