# NT Travel Bedbank Operations Runbook

## Release contract

The production unit is an immutable container built from a reviewed Git commit. Do not run the Vite development server in production. The initial supported topology is one application replica behind exactly one TLS-terminating reverse proxy; use a shared rate-limit store before scaling to multiple steady-state replicas.

Required runtime:

- Node.js `22.22.2` for non-container operations.
- Container base pinned in `Dockerfile`.
- HTTPS at the edge.
- A Supabase project dedicated to the environment.
- Approved read-only CloudHMS credentials for the same environment.

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

## Initial admin

Run once as an interactive one-off container. Pipe the password over stdin; never place it in shell history:

```bash
docker run --rm -i --env-file /secure/path/nt-travel.env \
  -e BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
  nt-travel-bedbank:<git-sha> \
  npm run bootstrap:admin:production
```

The admin must sign in and replace the temporary password before other operations.

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

Set `SMOKE_DUMP_SHAPE=1` for the first live run. `get-room-availability` is the only endpoint the
approved collection documents without a populated sample, so the mapper for it is derived from the
`get-hotel-availability` rate envelope. The flag prints the top-level key names (never values) of the
real response so `server/cloudhms/fixtures/room-availability.json` can be locked to the true shape.

Check the smoke output before routing traffic:

- `unpricedHotels` must be `0`. Rates priced at zero are excluded as unsellable; a non-zero count
  means that assumption is wrong for this tenant.
- `hasRoomTax` / `hasDetailTax` record whether CloudHMS returned tax at all. The UI shows
  "chưa có dữ liệu" instead of `0 ₫` when it did not — confirm with CloudHMS that this is correct
  before customer sign-off.
- `hotelCount` must match the number of properties the destination really has in the catalog.

## CloudHMS contract questions to confirm before GO

The repository cannot resolve these; they need a written answer from CloudHMS.

1. Does `/connect/token` require `organization_id` in the form body, and which value applies to
   NT Travel? The client now sends `CLOUDHMS_ORGANIZATION_ID` there, matching the approved collection.
2. Are the `x-organization-id`, `x-organization-code`, `x-distribution-channel-id` and
   `x-requestor-id` headers required for read-only endpoints? They appear in no request in the
   collection and are no longer sent.
3. The `organization` body field appears only on `get-room-availability` in the collection (value
   `"alpha"`). We send `CLOUDHMS_ORGANIZATION_CODE` on all three availability calls — is that correct,
   and is the field mandatory on `get-hotel-availability` and `get-room-detail-availability`?
4. Does `get-room-detail-availability` return `totalTaxAmount` or `rates[].taxAmount` in production,
   or is tax only exposed by `get-room-availability`?
5. What does a rate with `totalAmount = 0` and `quantity > 0` mean? We treat it as a rate plan with no
   price loaded for the distribution channel and exclude it.
6. What is the real maximum page size of `/pms-property/hotels/info` and `/pms-property/room-type`?
   The sample caps a requested 50 at 30.
7. Confirm `roomOccupancy` is the occupancy of a single room alongside `numberOfRoom`. Is there any way
   to query rooms with different occupancies in one request?

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
