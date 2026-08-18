# NT Travel Bedbank — Local Production Readiness Report

> **Superseded on 2026-08-16.** A field-by-field review against the approved CloudHMS Postman
> collection found five Critical and five Major integration defects that this report's automated
> gates could not see: the mapper fixtures had been hand-written rather than derived from real
> responses. The "release candidate" verdict below therefore did not hold. See the CloudHMS
> contract questions in `operations-runbook.md` and `server/cloudhms/fixtures/README.md`.

**Validated:** 2026-07-25 (Asia/Bangkok)  
**Baseline:** `f50d2e25b39c4cabe044e6eb7d21807282518d16`  
**Scope:** local source, local Supabase, mock read-only CloudHMS, production container

## Decision

The repository is locally buildable and the repository-controlled production
gaps in the implementation plan are complete. It is a **release candidate**, not
yet a production GO: live CloudHMS/Supabase proof, staging deployment, customer
data reconciliation/UAT, backup ownership and GitHub protection remain external
gates.

## Current Feature Inventory

| Area | Available behavior |
|---|---|
| Authentication | Supabase email/password login, HttpOnly strict cookies, refresh, logout, mandatory temporary-password change |
| Staff administration | Admin-only list/create, role change, lock/unlock and password reset |
| Admin safety | Application and database protection against disabling/demoting the final active Admin |
| Audit | Append-only events for user creation/update and password change/reset |
| Search | Debounced property suggestions; city/property search; dates; 1–8 rooms; adult/child/infant occupancy |
| Availability | Hotel availability, room/rate plans, remaining quantity, occupancy, total/average/net tax and currency |
| Rate detail | Daily price/tax breakdown and cancellation/payment policies |
| CloudHMS | Mock and live adapters; paginated active-property catalog; bounded concurrency/timeouts; sanitized read-only DTOs |
| Operations | Liveness/readiness, request IDs, safe errors, proxy-aware bounded rate limiting, security/cache headers and graceful shutdown |
| Delivery | Exact Node/npm/dependencies, GitHub Actions gates, non-root multi-stage Docker image, runbook and customer UAT checklist |

V1 intentionally has no booking create, update, commit, cancel or payment
capability. The UI and BFF expose lookup-only CloudHMS operations.

## Validation Results

| Gate | Result |
|---|---|
| Node/npm | Node `22.22.2`; npm `11.17.0` |
| Static/application gate | lint pass; typecheck pass; 7 test files and 37/37 tests pass |
| Production build | Vite client and TypeScript server build pass |
| Dependency audit | `npm audit --audit-level=high`: 0 vulnerabilities |
| Database rebuild | Migration applies from a clean local database |
| Database lint | 0 schema errors |
| Database tests | 20/20 pgTAP assertions pass |
| Container build | `nt-travel-bedbank:production-audit` built successfully; local manifest list `sha256:38133ccb2f6e47a7920e41f88b50231639739517b6ab5789f9c8b47ec1b4a684` |
| Container runtime | non-root `uid=1000(node)`; Node `22.22.2`; npm `11.17.0` |
| HTTP smoke | liveness 200; root 200; fingerprinted asset 200; invalid upstream readiness 503 without detail leakage |
| Headers/cache | HSTS and CSP present; health no-store; SPA no-cache; fingerprinted assets immutable for one year |
| Config rejection | Production image exits non-zero when required Supabase configuration is absent |
| Lifecycle | SIGINT/SIGTERM path emits shutdown-started/completed and exits within the deadline |
| Local readiness | BFF with real local Supabase and mock CloudHMS returns readiness 200 |
| Local HTTP flow | Admin bootstrap/login/change-password, property/hotel/room/detail lookup, user list/create/lock/reset all pass |
| Audit flow | `password.changed`, `password.reset`, `user.created` and `user.updated` rows verified |
| Cleanup | Test users removed by clean DB reset; application and Supabase test processes stopped |

## Defects Found and Closed During Validation

1. Docker was replacing the npm installation while npm itself was executing,
   leaving Arborist without `promise-retry`. npm is now installed in an isolated
   `/opt/npm` prefix in build/runtime stages and CI uses the same safe pattern.
2. RLS policies existed but table privileges were absent, so both authenticated
   reads and BFF `service_role` operations were denied by PostgREST. The migration
   now starts from no privileges and grants only authenticated reads plus the
   exact BFF profile/audit operations. The regression moved from 5 failed
   assertions to 20/20 passing.
3. Default Supabase local ports collided with another local stack. This project
   now uses the isolated `56320–56329` range.

## External GO Gates

1. Provide production secret-store values and verify the remote Supabase
   PostgreSQL major version matches the migration configuration.
2. Apply/review the migration on staging and run readiness/auth/RLS checks there.
3. Run the approved read-only CloudHMS live smoke with real credentials and
   reconcile quantity, price, tax, currency, daily rates and policies.
4. Deploy the immutable image behind the final TLS proxy, set the exact
   `TRUST_PROXY_HOPS`, and confirm both health endpoints.
5. Complete the customer UAT checklist and record product, operations and
   technical sign-off.
6. Push the workflow, require `quality`, `database` and `container` checks on
   protected `main`, publish the image digest and record the previous rollback
   digest.
7. Confirm Supabase backup/PITR ownership and complete a restore drill.
