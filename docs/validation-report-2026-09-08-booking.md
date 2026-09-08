# Booking validation — 2026-09-08

## Automated checks

`npm run check` on Node 22.22.2: passed with 86 tests in 10 files, no lint warnings,
TypeScript passed, frontend and server builds passed. `git diff --check` passed.

Coverage includes create → guarantee review → commit, request-ID deduplication across competing
requests and service reconstruction, price/guarantee changes, per-staff isolation, forced-password
access, ambiguous write outcomes, partial batch failures, safe read recovery after a lost response,
and clearing old rates when search dates change.

CiHMS adapter tests use trimmed response fixtures from the supplied Postman collection. They
validate actual nested monetary fields, allotments, repeated daily guarantee IDs and per-item
commit results. No live CiHMS write was made.

## Database checks

Applied both migrations to an isolated, network-disabled, temporary PostgreSQL 15.6 container
using the cached Supabase image. All 10 booking pgTAP checks and 20 existing staff checks passed;
the container was automatically removed. Synthetic auth schema/roles were used. Tests cover
direct-access denial, service-role privileges, duplicate IDs, conditional confirmation claims
and consistent stored state. The configured PostgreSQL 17/Supabase CI job has not run in this session.

## Browser checks

Used the production frontend build with an isolated local BFF using mock authentication, mock
inventory and mock bookings. Completed search → room selection → guest form → Prospect →
guarantee acceptance → Reserved, then reloaded and reopened the booking from the list.

Checked 1440×1000 desktop and 390×844 mobile. Navigation is visible on mobile, no horizontal
overflow was observed, the heading remains below the sticky header, and the browser reported
no JavaScript errors. The booking was explicitly labeled as a simulation.

## Deployment state

Changes are in the workspace; no deployment or target Supabase migration was performed.
Apply `202609080001_bookings.sql` before releasing the new backend. Verify tenant source code,
allotment permissions and prices in approved CiHMS UAT before live use. Update/cancel and external
CiHMS reservation search remain outside this release; the list shows NT Travel's saved state.

## Pre-deployment recheck

On the same date, `npm run check` was rerun on Node 22.22.2: all 86 tests, lint, types and
both builds passed. `git diff --check` passed. The Dockerfile also built successfully as
`nt-travel-bedbank:booking-predeploy`, image manifest digest
`sha256:82906a35967a7f29d2b1de2a28dd104c6913a7d8d9767db5e606d3c8c40b9e4e`.

Dependency audit now reports one moderate production issue (`qs`). The production threshold
check `npm audit --omit=dev --audit-level=high` exits 0, but is not a clean audit. The full
audit reports four vulnerable packages: high `nanoid` and `undici`, moderate `postcss` and `qs`.
Dependency remediation and revalidation remain outstanding.

Production readiness is not established: target migration, PostgreSQL 17/Supabase CI,
tenant booking UAT and a committed release artifact remain unverified. This check built a
local image only; it did not deploy or submit a live reservation.
