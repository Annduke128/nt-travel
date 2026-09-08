# NT Travel Bedbank Operations Runbook

## Release contract

The production unit is an immutable container built from a reviewed Git commit. Do not run the Vite development server in production. The initial supported topology is one application replica behind exactly one TLS-terminating reverse proxy; use a shared rate-limit store before scaling to multiple steady-state replicas.

Required runtime:

- Node.js `22.22.2` for non-container operations.
- Container base pinned in `Dockerfile`.
- HTTPS at the edge.
- A Supabase project dedicated to the environment.
- Approved CloudHMS credentials for the same environment, with booking create/commit access for this release.

## Required secrets and configuration

Store secrets in the deployment platform secret store, never in an image or Git:

| Variable | Required | Notes |
|---|---:|---|
| `NODE_ENV=production` | yes | Enables secure cookies, HSTS and production config validation |
| `HOST=0.0.0.0` | yes in container | Listener address |
| `PORT=3001` | yes | Container port |
| `TRUST_PROXY_HOPS=1` | behind one proxy | Must equal the exact path length; use `0` for direct access |
| `SUPABASE_URL` | yes | Environment project URL |
| `SUPABASE_ANON_KEY` | yes | Server-side public Auth client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only; rotate after suspected disclosure |
| `CLOUDHMS_MODE=live` | yes | Never release customer production in mock mode |
| `CLOUDHMS_API_URL` | yes | Approved HTTPS API origin |
| `CLOUDHMS_IDENTITY_URL` | yes | Approved HTTPS identity origin |
| `CLOUDHMS_CLIENT_ID` | yes | Secret-store value |
| `CLOUDHMS_CLIENT_SECRET` | yes | Secret-store value |
| `CLOUDHMS_ORGANIZATION_ID` | yes | ID, not organization code |
| `CLOUDHMS_ORGANIZATION_CODE` | yes | Business code such as `Vingroup` |
| `CLOUDHMS_DISTRIBUTION_CHANNEL_ID` | yes | Approved channel |
| `CLOUDHMS_REQUESTOR_ID` | yes | Approved requestor |
| `CLOUDHMS_BOOKING_SOURCE_CODE` | tenant-dependent | Defaults to `CRO` from the collection description; verify with CiHMS (`WBS` appears in the sample body) |

The reverse proxy must overwrite, not append untrusted, `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto`.

## Pre-deployment gate

From a clean checkout:

```bash
nvm use
npm ci
npm audit --omit=dev --audit-level=high
npm run check
docker build --tag nt-travel-bedbank:<git-sha> .
```

The release is blocked if any command fails.

For the target Supabase project:

```bash
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
```

Only apply reviewed migrations. The current migration is additive; future migrations must remain backward-compatible for at least one application release so image rollback remains safe.

The booking release requires `202609080001_bookings.sql` before the new image starts. Readiness now
checks access to this table. It holds guest details and a durable request ID; only the BFF service role
can read/write it. UI/API access is restricted to the staff member who created the request.

## Booking operations

Create produces `Prospect`; staff must review the guarantee conditions and explicitly confirm to
obtain `Reserved`. Confirm sends `isSendMail=false`. No payment is collected by this application.
See [integration flow](cihms-integration.md) and [booking UAT](customer-uat.md).

Before using live writes, reconcile tenant source code, per-room prices, allotment eligibility,
guarantee amounts and statuses with CiHMS in approved UAT. Local automated checks exercise mock
and collection fixtures, and do not prove the tenant accepts live writes.

Never replay create/commit after a timeout. The unique request row and atomic state transition
prevent repeated writes for the same request ID across retries, workers and restarts. They do not
deduplicate two intentionally different request IDs.

For `attention` or a lingering `creating`/`confirming` row, use the displayed `NT-{requestId}`
reference and reservation IDs to reconcile with CiHMS. The app's refresh action reads its stored
state; it does not query CiHMS or resolve an ambiguous write automatically. Do not delete the row
or reset its state to retry. Escalate to operations for a reviewed reconciliation. Partially
confirmed batches retain known per-room outcomes and never show whole-booking success.

Mock requests are memory-only, are visibly labeled in booking details/history, and disappear when
the BFF restarts. Production must use live mode with the durable Supabase store.

## Initial admin

Run once as an interactive one-off container. Pipe the password over stdin; never place it in shell history:

```bash
docker run --rm -i --env-file /secure/path/nt-travel.env \
  -e BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
  nt-travel-bedbank:<git-sha> \
  npm run bootstrap:admin:production
```

The admin must sign in and replace the temporary password before other operations.

## Layered connectivity check

Run this **before** the smoke test whenever credentials, hosts or the tenant change:

```bash
SMOKE_PROPERTY_ID=<property-uuid> npm run check:cloudhms
```

It walks the six layers in order — identity token, `/pms-property/hotels/info`, `/pms-property/room-type`,
`get-hotel-availability`, `get-room-availability`, `get-room-detail-availability` — and prints one
JSON line per layer with the real HTTP status. Unlike the smoke test it never fails fast, and an
empty availability array is reported as `emptyAvailability: true` on a passing layer rather than as
an error, so "wrong credential", "token rejected by CRS", "wrong distribution channel" and "no rooms
on those dates" stay distinguishable.

`SMOKE_ARRIVAL_DATE` / `SMOKE_DEPARTURE_DATE` (default today +30 / +32) and `SMOKE_ADULTS` (default 2)
are optional. The script never prints the client secret or the access token — only whitelisted JWT
claims, which is how a token minted by one environment's identity host is caught being sent to
another environment's CRS host.

## Read-only integration smoke

Run before routing customer traffic:

```bash
docker run --rm --env-file /secure/path/nt-travel.env \
  -e SMOKE_DESTINATION='Nha Trang' \
  -e SMOKE_ARRIVAL_DATE=2026-08-10 \
  -e SMOKE_DEPARTURE_DATE=2026-08-12 \
  nt-travel-bedbank:<git-sha> \
  npm run smoke:cloudhms:production
```

The smoke test reads property, hotel availability, room/rate availability and rate detail. It does not create or mutate a booking.

`SMOKE_DUMP_SHAPE=1` prints the top-level key names (never values) of the raw
`get-room-availability` response. It is no longer needed for the initial rollout —
`server/cloudhms/fixtures/room-availability.json` was locked to a live capture on 2026-08-29 — but
keep using it whenever the tenant or the CloudHMS contract changes.

Check the smoke output before routing traffic:

- `unpricedHotels` must be `0`. Rates priced at zero are excluded as unsellable; a non-zero count
  means that assumption is wrong for this tenant.
- `hasRoomTax` / `hasDetailTax` record whether CloudHMS returned tax at all. The UI shows
  "chưa có dữ liệu" instead of `0 ₫` when it did not — confirm with CloudHMS that this is correct
  before customer sign-off.
- `hotelCount` must match the number of properties the destination really has in the catalog.

## CloudHMS contract questions

Answers marked **[verified 2026-08-29]** were established by running `npm run check:cloudhms` against
identity `identity.stg.hulk.cloudhms.io` + CRS `api.beta.cloudhms.io`, org `vingroup`, property
`5751` / `5d60c1ad-3ee7-7388-6907-0a3f5fcc093b`, channel `7e504b27-9a93-49af-8ccf-d73da1f778a8`.
They hold for that tenant on staging; re-confirm against the production tenant before GO.

1. **[verified 2026-08-29]** `/connect/token` accepts `organization_id` in the form body and returns
   an 8-hour `Bearer` token (`iss: https://identity.stg.hulk.cloudhms.io`, `aud: resource-api-ams`,
   `scope: hms-scope`). The token carries `organization`, `organization_code` and `organization_id`
   claims, so the tenant is bound at token issue time. Still to confirm: whether the field is
   *mandatory* and which value applies to the production tenant.
2. Are the `x-organization-id`, `x-organization-code`, `x-distribution-channel-id` and
   `x-requestor-id` headers required for read-only endpoints? They appear in no request in the
   collection and are no longer sent. **[verified 2026-08-29]** all five read-only endpoints answer
   200 without them, so they are not required for reads. Booking flows are untested.
3. **[verified 2026-08-29]** All three availability calls accept `organization` with the lowercase
   tenant code (`vingroup`). Whether the field is mandatory on `get-hotel-availability` and
   `get-room-detail-availability` is still unconfirmed — it was sent on every call.
4. **[verified 2026-08-29]** Tax is exposed **only** by `get-room-availability`, as
   `totalTaxAmount: { amount, currencyCode }` (value `0` for this tenant).
   `get-room-detail-availability` returns neither `totalTaxAmount` nor `rates[].taxAmount`, so
   `RateDetailDto.tax` is always absent and the UI shows "chưa có dữ liệu" on the detail panel while
   the room list shows `0 ₫`. Confirm with CloudHMS that a zero tax is genuinely correct here.
5. **[verified 2026-08-29 — the premise was wrong]** No rate on this tenant has
   `totalAmount = 0`. `totalAmount` is nested **twice**
   (`{ amount: { amount: 5400000, currencyCode: "VND" } }`) while `averageAmount` and
   `totalTaxAmount` are nested once. Any reader that unwraps a single level reads every amount as
   `0`; `nestedAmount` in `bedbank.ts` handles this, shallower readers must not be added.
   The meaning of a genuine zero-priced rate is still an open question.
6. **[verified 2026-08-29]** `/pms-property/hotels/info` caps the page size at **100**, not 30:
   requesting `limit=200` returns `limit: 100` with all 58 properties on page 0. `bedbank.ts`
   compares against the response's own `limit`, which is correct.
7. Confirm `roomOccupancy` is the occupancy of a single room alongside `numberOfRoom`. Is there any way
   to query rooms with different occupancies in one request?
8. **[verified 2026-08-29 — new]** In `get-room-availability` the top-level `roomTypeId` and
   `ratePlanId` are the all-zero GUID `00000000-0000-0000-0000-000000000000` on every rate; the
   usable identifiers live in `roomType.roomTypeID` and `ratePlan.id` / `ratePlan.ratePlanId`.
   Passing the zero GUIDs to `get-room-detail-availability` returns HTTP 400
   `RATE_PLAN_NOT_FOUND`; passing the nested ones returns 200. `bedbank.ts` now skips the zero GUID
   and falls back to the nested id, and the response schemas reject it at the BFF boundary. Still ask
   CloudHMS whether the zero GUID is intended — if they fix it upstream the fallback becomes dead code.
9. **[verified 2026-08-29 — new]** `get-room-availability` nests room-type metadata under keys
   `roomTypeID` / `roomTypeCode` / `roomTypeName`, whereas `/pms-property/room-type` uses
   `id` / `code` / `name`. The two shapes are not interchangeable.
10. **[observed 2026-08-29]** `/pms-property/hotels/info` is usually fast (~750 ms, 5/5 successful
    in a row) but was seen once exceeding the 12 s `CLOUDHMS_TIMEOUT_MS` and once returning HTTP 504
    after 29 s. Confirm the upstream SLA before settling on a production timeout.

## Health and rollout

- `GET /health/live`: process liveness only. Restart the container after three consecutive failures.
- `GET /health/ready`: cached Supabase + CloudHMS readiness. Route traffic only after HTTP 200.
- During rollout, send `SIGTERM` and allow at least `SHUTDOWN_TIMEOUT_MS + 5s` before forced termination.
- Verify the deployed image digest matches the approved release artifact.

Post-deployment checks:

1. `/health/live` and `/health/ready` return 200.
2. Admin and staff login work.
3. Temporary password enforcement works.
4. One known CloudHMS search reconciles with the approved source.
5. Logs contain request/correlation IDs and do not contain credentials or raw CloudHMS bodies.

## Monitoring and alerting

Collect JSON stdout/stderr with image digest and environment labels.

Alert on:

- Liveness failure: immediate page after three failed probes.
- Readiness failure: warning after 2 minutes, page after 5 minutes.
- HTTP 5xx: more than 2% for 5 minutes.
- CloudHMS 429/5xx or timeout: more than 5 events in 5 minutes.
- Login 429 spike: investigate proxy hop configuration and credential attacks.
- Container restart or graceful-shutdown timeout: immediate warning.

Keep application logs for at least 30 days or the customer's agreed retention. Access is restricted to operators.

## Backup and recovery

- Enable and verify Supabase backups/PITR according to the customer plan.
- Record the last successful restore drill and owner before production GO.
- Application containers are stateless; rebuild from Git and the pinned image definition.
- CloudHMS is an upstream system of record and is never written by V1.

## Rollback

1. Stop routing new traffic to the failed image.
2. Redeploy the previous known-good image digest.
3. Wait for `/health/ready` to return 200.
4. Run the read-only integration smoke.
5. Record the incident, failed image digest, request IDs and rollback time.

Do not reverse a database migration during an application rollback. If a future migration is not backward-compatible, it requires its own approved restore plan before deployment.

## Security operations

- Rotate Supabase service-role and CloudHMS client secrets on staff departure or suspected exposure.
- Keep `main` protected: pull request required, `quality`, `database`, and `container` checks required, force pushes and deletion disabled.
- Review `npm audit` and Supabase security advisors for every release.
- Confirm production is not running with `CLOUDHMS_MODE=mock`.
