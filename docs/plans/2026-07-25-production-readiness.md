# NT Travel Bedbank Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use skill({ name: "executing-plans" }) to implement this plan task-by-task.

**Goal:** Make the NT Travel Bedbank v1 repository reproducible, observable, secure behind a reverse proxy, deployable as an immutable container, and guarded by automated release checks.

**Architecture:** Keep the existing same-origin React + Express BFF design. Add runtime contracts around it: a pinned Node toolchain, dependency-safe CI, public liveness/readiness probes, bounded proxy-aware rate limiting, security headers, graceful shutdown, dependency health probes, and a multi-stage production container. CloudHMS remains read-only and Supabase remains the identity/profile store.

**Tech Stack:** Node.js 22, npm, TypeScript, React, Vite, Express 5, Helmet, Vitest/Supertest, Supabase, CloudHMS, Docker, GitHub Actions.

---

## Execution Status — 2026-07-25

| Wave | Status | Evidence |
|---|---|---|
| Runtime and CI foundation | Complete locally | Exact Node/npm/dependency contract, clean build gate, audit and CI workflow |
| HTTP/runtime/database hardening | Complete locally | 37 application tests, 20 pgTAP assertions, local readiness and HTTP end-to-end smoke |
| Container and operational proof | Complete locally | Non-root image, health/cache/security smoke, missing-secret rejection, runbook and UAT pack |
| External release gates | Pending | Live CloudHMS/Supabase credentials, staging/TLS, customer reconciliation/UAT, registry and branch protection |

Detailed evidence and the current feature inventory are recorded in
`docs/validation-report-2026-07-25.md`.

---

## Must-Haves

**Goal:** A release candidate can be built once, validated automatically, deployed behind one documented proxy, observed, rolled back, and accepted by the customer without exposing credentials or enabling booking mutations.

### Observable Truths

1. A clean checkout uses the declared Node/npm versions and `npm ci` produces a buildable dependency graph.
2. `npm run check` proves lint, typecheck, 19+ automated tests, client build, and server build.
3. `/health/live` reports process health without dependencies; `/health/ready` reports whether Supabase and CloudHMS can serve traffic.
4. Production responses carry hardened headers and sensitive API responses are non-cacheable.
5. Login rate limiting resolves the intended client IP only when the configured proxy hop count is correct and cannot grow memory without bound.
6. SIGTERM stops new traffic, drains the HTTP server, and exits within a configured deadline.
7. A non-root immutable container starts on `0.0.0.0`, exposes a health check, and fails fast when production secrets are missing.
8. Operators have exact deploy, migration, smoke, monitoring, rollback, and customer UAT procedures.

### Required Artifacts

| Artifact | Provides | Path |
|---|---|---|
| Runtime contract | Node/npm versions, pinned dependencies, unified gate | `.nvmrc`, `.npmrc`, `package.json`, `package-lock.json` |
| CI gate | Clean install, audit, checks, container build | `.github/workflows/ci.yml` |
| HTTP hardening | Health, security, cache, proxy/rate-limit behavior | `server/app.ts`, `server/app.test.ts` |
| Dependency readiness | Supabase/CloudHMS probes | `server/services.ts`, `server/auth/*.ts`, `server/cloudhms/*.ts` |
| Runtime lifecycle | Host binding and graceful shutdown | `server/config.ts`, `server/index.ts`, `server/runtime.ts` |
| Immutable deployment | Multi-stage non-root image | `Dockerfile`, `.dockerignore` |
| Operations contract | Deploy, monitoring, rollback, UAT | `docs/operations-runbook.md`, `docs/customer-uat.md` |

### Key Links

| From | To | Via | Risk |
|---|---|---|---|
| Reverse proxy | Express | `X-Forwarded-For`, `TRUST_PROXY_HOPS` | Wrong hop count lets clients spoof IPs or makes all users share one limiter key |
| Readiness probe | Supabase/CloudHMS | service `health()` methods | Aggressive probes can overload upstreams; results must be briefly cached |
| Browser | BFF | same-origin HttpOnly cookies | Cached authenticated API responses could expose staff data |
| Container orchestrator | Node HTTP server | SIGTERM and health endpoints | Hard termination can drop in-flight requests |
| CloudHMS mapper | approved live API | sanitized DTO mapping | Unit fixtures may drift from live response shapes |

### Task Dependencies

- Wave 1: Task 1 (runtime and CI foundation)
- Wave 2: Task 2 (production HTTP/runtime behavior; depends on Task 1)
- Wave 3: Task 3 (deployment, operations, and full proof; depends on Tasks 1–2)

## Task 1: Reproducible Runtime and Release Gate

**Files:**

- Create: `.nvmrc`, `.npmrc`, `.github/workflows/ci.yml`
- Modify: `package.json`, `package-lock.json`, `README.md`

**Steps:**

1. Pin Node 22 and npm, replace `latest` dependency ranges with installed exact versions, and add `engines`.
2. Add `check`, `check:static`, and `check:build` scripts.
3. Add Helmet as a pinned runtime dependency.
4. Add CI for clean install, production dependency audit, full checks, and Docker build.
5. Verify with Node 22: clean dependency graph, audit, static checks.

**Acceptance:** CI-equivalent commands do not depend on the host Node 18 installation and no dependency is declared as `latest`.

## Task 2: Production HTTP, Dependency, and Runtime Hardening

**Files:**

- Modify: `server/app.ts`, `server/app.test.ts`, `server/config.ts`, `server/services.ts`
- Modify: `server/auth/supabase.ts`, `server/auth/unconfigured.ts`
- Modify: `server/cloudhms/client.ts`, `server/cloudhms/mock.ts`, `server/cloudhms/bedbank.ts`
- Create: `server/runtime.ts`, `server/runtime.test.ts`
- Modify: `server/index.ts`, `.env.example`

**Steps:**

1. RED: add tests for live/readiness semantics, non-cacheable API data, Helmet headers, trusted proxy behavior, bounded rate limiting, and graceful shutdown.
2. GREEN: implement the minimum behavior to pass each test.
3. Add cached dependency readiness probes so infrastructure checks do not hammer upstream APIs.
4. Bind through configurable `HOST`, configure exact proxy hops, and install SIGTERM/SIGINT graceful shutdown with a deadline.
5. Add sanitized CloudHMS room/detail contract fixtures derived from the approved collection.

**Acceptance:** All tests pass outside the network sandbox; failed dependency probes return 503 without disclosing secrets; liveness remains independent.

## Task 3: Immutable Deployment, Operations, and Release Proof

**Files:**

- Create: `Dockerfile`, `.dockerignore`
- Create: `docs/operations-runbook.md`, `docs/customer-uat.md`
- Modify: `README.md`

**Steps:**

1. Build a multi-stage Node 22 image; run production as the non-root `node` user.
2. Document required secrets, Supabase migration/bootstrap, CloudHMS read-only smoke, health monitoring, log fields, backup ownership, and incident response.
3. Document rollback to the previous immutable image and database compatibility rule: expand-only migrations until the release is accepted.
4. Run the full Node 22 gate, dependency audits, container build/start/health smoke, and production missing-secret negative test.
5. If live credentials are present, run CloudHMS read-only smoke and Supabase readiness; otherwise record them as explicit external release gates.

**Acceptance:** The repository produces an immutable container and complete local proof. Production GO additionally requires live integration evidence, staging deployment, customer UAT sign-off, and protected-branch enforcement.

## Rollback and Compatibility

- Baseline commit: `f50d2e25b39c4cabe044e6eb7d21807282518d16`.
- Source rollback: revert the production-hardening commit; never reset user work.
- Runtime rollback: redeploy the previous immutable image digest.
- Database rollback: this plan does not introduce destructive schema changes. Future migrations must remain backward-compatible across one release window.
- Proxy compatibility: default to zero trusted proxies; production must explicitly set the exact hop count.
- API compatibility: no existing `/api/*` response contract or CloudHMS write capability is added.

## External Release Gates

The repository cannot manufacture external credentials or a hosting target. Production GO still requires:

1. Secret-store values for Supabase and CloudHMS.
2. A staging/production deployment target and TLS domain.
3. Successful read-only CloudHMS live smoke.
4. Successful Supabase migration, bootstrap, auth, RLS, and last-admin checks.
5. Customer UAT sign-off on price, tax, currency, availability, and policy data.
6. GitHub branch protection requiring the new CI check after the workflow is pushed.
