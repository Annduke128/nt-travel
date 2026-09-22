# NT Travel deployment

This directory contains the production Compose wrapper for the repository's root `Dockerfile`.

## Prepare

From the repository root:

```bash
cp deploy/env.production.example deploy/env.production
# edit deploy/env.production with the production secret-store values
docker compose -f deploy/docker-compose.yml config
```

The service binds only to `127.0.0.1:3101` on the host and listens on port `3001` inside the container. This avoids the shared server ports already used by other applications.

## Deploy

```bash
docker compose -f deploy/docker-compose.yml build --pull
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml ps
curl --fail http://127.0.0.1:3101/health/live
curl --fail http://127.0.0.1:3101/health/ready
```

The reverse proxy on this host is nginx-proxy-manager (container `gastrack-npm`), and it routes
by container name over the shared `npm_network`: `set $server "nt-travel"; set $port 3001`. The
service therefore joins `npm_network` as an external network, and `127.0.0.1:3101` stays published
only for host-side health checks. Do not proxy to `127.0.0.1:3101` from a container — the port is
bound to loopback and is unreachable from one.

Apply the required Supabase migration before switching the service to live traffic. Keep
`CLOUDHMS_MODE=mock` until all live CloudHMS identifiers and credentials have been verified;
switching to `live` also requires `CLOUDHMS_CLIENT_ID`, `CLOUDHMS_CLIENT_SECRET`,
`CLOUDHMS_ORGANIZATION_ID`, `CLOUDHMS_DISTRIBUTION_CHANNEL_ID` and `CLOUDHMS_REQUESTOR_ID`, which
`server/config.ts` rejects the startup without.

### One-time migration from the unnamed project

Deployments made before the project name was pinned ran as project `deploy` on a Compose-created
`deploy_default` network. Build first, then swap, so the outage is only the container restart:

```bash
docker compose -f deploy/docker-compose.yml build --pull
docker compose -p deploy -f deploy/docker-compose.yml down
docker compose -f deploy/docker-compose.yml up -d
curl --fail https://nt-travel.hasutech.com.vn/health/ready
```

## Stop or update

```bash
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs --tail=100 -f nt-travel
```
