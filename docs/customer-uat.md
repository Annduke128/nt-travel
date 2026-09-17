# NT Travel Bedbank Customer UAT

## Scope

The internal tool authenticates staff, displays availability and rates, creates Prospect bookings and explicitly confirms them as Reserved after guarantee review. Staff can reopen their own requests. Updating/cancelling bookings and searching reservations created outside this app are outside this release.

## Preconditions

- Staging uses the intended Supabase and approved CloudHMS environment.
- The release image passed `quality`, `database`, and `container` gates.
- `/health/live` and `/health/ready` return 200.
- One Admin and one Staff account are available.
- CloudHMS source data is available for comparison.

## Acceptance scenarios

| ID | Scenario | Expected evidence |
|---|---|---|
| AUTH-01 | Sign in with valid Admin and Staff accounts | Correct name/role; no token visible in response body or browser storage |
| AUTH-02 | Sign in with an invalid password repeatedly | Generic error; limiter activates after the documented threshold |
| AUTH-03 | Sign in with a temporary password | Only the mandatory password-change screen is available |
| AUTH-04 | Lock a Staff account | Existing/new session cannot access search after re-authentication |
| ADMIN-01 | Create Staff, change role/status, reset password | UI reflects each change; audit rows are present |
| ADMIN-02 | Attempt to demote/disable the final active Admin | Operation is rejected |
| SEARCH-01 | Search by city and exact property name | Active matching properties only |
| SEARCH-02 | Search one, two and multiple rooms with adult/child/infant occupancy | Request and returned availability match approved CloudHMS behavior |
| RATE-01 | Open hotel, room/rate and detail for at least three properties | Room/rate identifiers and remaining quantity match CloudHMS |
| RATE-02 | Compare at least three stays/currencies | Total, average, tax and daily breakdown reconcile exactly |
| POLICY-01 | Compare flexible and non-refundable plans | Cancellation/guarantee descriptions match CloudHMS |
| EMPTY-01 | Search a known sold-out stay | Clear no-availability state; no stale rate detail |
| ERROR-01 | Simulate CloudHMS timeout/rate limit | Safe retryable error; no secret or raw upstream body shown |
| SECURITY-01 | Inspect authenticated API responses | `Cache-Control: private, no-store`; secure HttpOnly cookies; hardened headers |
| BOOK-01 | Select a rate and complete guest details for each room | Exact dates/rate/room count; policies visible before creation |
| BOOK-02 | Create booking, then inspect before confirming | Prospect displayed as pending; no automatic commit or email |
| BOOK-03 | Review guarantees and explicitly confirm | Every reservation becomes Reserved; confirmation numbers retained; CiHMS shows payment `No`, settled 0 and a TravelAgent NT_Travel profile |
| BOOK-04 | Change price, inventory, or guarantee between steps | Mutation is blocked until current conditions are reviewed |
| BOOK-05 | Double submit, lose response, restart BFF, reopen own requests | One upstream create/commit per request; uncertain states require reconciliation |
| BOOK-06 | Fail only one reservation in batch commit | No whole-booking success; individual outcomes retained |
| BOOK-07 | Access another staff member's booking ID | 404; guest data is not disclosed |
| BOOK-08 | Change dates after loading room results | Old room/detail selection is cleared |
| SCOPE-01 | Inspect booking network activity | Only explicit create/confirm writes; mock clearly identified; no update/cancel requests |
| UX-01 | Test supported desktop/mobile widths and keyboard flow | No blocking overflow; labels, focus and errors remain usable |

## Data reconciliation record

For every RATE scenario record:

- Timestamp and timezone.
- User role.
- Search destination, dates and per-room occupancy.
- Property, room type and rate plan IDs.
- Currency, quantity, total, average, tax and daily prices from both systems.
- Cancellation and guarantee text from both systems.
- Request/correlation ID.
- Pass/fail and discrepancy owner.

Do not paste access tokens, client secrets, guest personal data or unrestricted raw upstream responses into UAT evidence.

## Go/no-go

Production GO requires:

1. All acceptance scenarios pass or have an approved written exception.
2. No price, tax, currency, availability or policy discrepancy remains open.
3. Customer product owner and NT Travel operations owner sign off.
4. Backup/restore ownership, monitoring contacts and rollback image are recorded.

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Customer product owner |  |  |  |  |
| NT Travel operations owner |  |  |  |  |
| Technical owner |  |  |  |  |
