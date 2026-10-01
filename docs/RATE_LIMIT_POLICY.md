# Rate limit policy (P0-B)

Owner: fix round 1, lane backend-2 (30 Sep 2026). Input: `docs/RATE_LIMIT_AUDIT.md`
(the 100-operation inventory, classes A to G, attack cases A to J) and the P0-B row
of `docs/ANTIGRAVITY_FINDINGS_REPRODUCTION.md` section 3.

This document is the contract. The numbers below are the constants in
`backend/app/core/rate_limit.py` (`POLICIES`) and the four auth settings in
`backend/app/core/config.py`; `backend/tests/test_rate_limit_policy.py` fails if
a limited route loses its bucket. Section 8 lists every operation.

## 1. Algorithm: GCRA, not a fixed window

Every limit is a **GCRA** (generic cell rate algorithm, the "virtual scheduling"
form of a token bucket). Per key it stores one timestamp, the theoretical arrival
time (TAT). A policy is `limit` units per `window` (sustained rate) plus `burst`
(how many units may arrive at once).

    interval = window / limit
    tat      = max(stored TAT, now)
    new_tat  = tat + interval * cost
    allowed  = new_tat - now <= interval * burst      -> store new_tat
    refused  : Retry-After = ceil(new_tat - now - interval * burst), at least 1 s

**Why GCRA.**

| Option | Boundary behaviour | State per key | Works on the 0015 table with no migration |
|---|---|---|---|
| Fixed window (before) | **2 x limit inside one instant across an edge** (audit case C) | 1 time + 1 int | yes |
| Sliding log | exact | one row per attempt, attacker-sized | no (needs a table) |
| Sliding-window counter | approximation | 2 counters + 1 time | no (needs a column) |
| Token bucket (tokens, last refill) | none | 1 float + 1 time | only by overloading `hits` |
| **GCRA** | **none: at most `burst + rate x t` in ANY interval t** | **1 time** | **yes: TAT in `window_start`** |

- The bound depends only on the length of an interval, not on where it falls, so
  there is no edge to straddle. Fixed window let 2L through in about a second;
  GCRA lets `burst` through at once and then one unit per `interval`.
- One timestamp fits `rate_limit_windows.window_start` (migration 0015), so the
  shared path needs **no new migration**. `hits` now records whether the last
  attempt passed (1) or was refused (0).
- The shared decision is one `INSERT ... ON CONFLICT DO UPDATE` statement, so two
  instances cannot both read a spare slot and both spend it. The time is the
  database's clock, so clock drift between instances does not matter. It is
  `clock_timestamp()`, not `now()`: `now()` is the transaction's start, and an
  upsert that queued behind another caller's row lock would see less time
  elapsed than there was and refuse the last unit of a burst.
- A refused attempt does not advance the TAT. A caller who keeps retrying gets
  exactly the sustained rate, never more. The old fixed window counted refusals.
  That added nothing a long-run rate does not already bound.

**Accepted cost.** Over a whole window, GCRA admits up to `burst + limit` units
(for example, the full burst at t=0, then the refill). The fixed window had the
same total but allowed it all at once at an edge. Where that matters (login), the
per-identifier limit is the bound that counts, and it is unchanged at 10.

## 2. Keys

| Caller | Primary key | Coarse guard |
|---|---|---|
| Authenticated (classes B to F) | `user.id` (from the verified token and the users row) | `client_address` x `ip_multiple` users' worth, **only on the expensive buckets** |
| Public (A login/refresh/logout, G) | `client_address` | the per-identifier budget on login |

- **NAT and CGNAT.** Indian mobile carriers put many phones behind one address. An
  authenticated user is never limited because of another user's traffic: user
  buckets are per user, and the per-IP guard is 20 users' worth of full-rate
  abuse. A legitimate user runs far below their rate, so hundreds fit under one
  address. The ordinary read/write ceilings, GPS and SOS have **no** per-IP guard.
  A fleet behind one carrier address would otherwise meet one shared ceiling.
- **Order.** User first, then IP. A caller already refused on their own bucket
  does not spend the shared IP guard, so one abuser behind a NAT cannot use up
  the budget of the others.
- `client_address` is unchanged (SEC-006): the TCP peer, or with
  `TRUSTED_PROXY_HOPS = N` the Nth `X-Forwarded-For` entry from the RIGHT. It is
  never the left-most entry, and never `X-Real-IP`.

## 3. Proxy trust (FC-02 / AG-16)

`TRUSTED_PROXY_HOPS` defaults to 0, which is correct with no proxy. Behind a proxy
with 0, every public caller shares the proxy's address. The login per-IP budget
(20/min) then becomes a global budget, and so does the public bucket.

What the code does about it:

1. **Startup warning.** With `APP_ENV` staging or production and hops = 0, the
   lifespan logs a WARNING naming the setting and the Render value.
2. **Runtime detection.** The first `X-Forwarded-For` that arrives while hops = 0
   sets a flag, in every environment, and logs one WARNING outside development
   (a local dev proxy may add the header there).
3. **`/ready` detail.** `checks.proxy` is `{"ok": true, "detail": "direct"}`,
   `{"ok": true, "detail": "trusted_hops_set"}` or
   `{"ok": false, "detail": "forwarded_header_ignored"}`. It is **advisory**: it
   does not turn `/ready` 503. Taking an instance out of rotation over a proxy
   setting would be an outage of its own. `/api/system/readiness` (managers) adds
   the configured hop count.
4. **Blast radius.** Authenticated classes key on the user, so a wrong hop count
   degrades only the public per-IP buckets (login, refresh, logout, `/ready`,
   `/api/org/regions`). The per-identifier login limit still binds per account.

Deployment value: **Render `TRUSTED_PROXY_HOPS=1`** (one TLS-terminating hop;
`render.yaml` in the working tree already says so). Cloud Run: NOT_VERIFIED. Its
front end appends its own entry. Measure the chain with a header echo before
setting a value. Never raise the value "to be safe": each extra hop is one more
header position the client controls.

## 4. More than one instance

| Bucket kind | MULTI_INSTANCE=false | MULTI_INSTANCE=true |
|---|---|---|
| `shared` (A login/refresh/password; all of B except places; upload; sweep) | in-process GCRA | GCRA in Postgres `rate_limit_windows` (one upsert on the request pool). The request's own transaction is committed first, so the check never holds two connections |
| local (read/write ceilings, places, GPS, SOS, public) | in-process GCRA | in-process GCRA, so N instances allow N x the budget |

Why some buckets stay local:
- The read/write ceilings, GPS and public buckets are cheap. A database statement
  per request would cost more than the thing it protects.
- **SOS is local so that a database hiccup can never be the reason an SOS fails.**

For a shared bucket, the local limiter is checked first, as login did before this
change. What this instance alone refuses is refused without a query (audit F1).
Otherwise the shared count decides. The login identifier budget is reset on
success, so it is counted in Postgres only.

**No Redis.** The 0015 table carries a GCRA as one upsert per decision, and two
real API processes on one scratch database share one budget (section 9,
`MULTI_*` cases). Nothing here needs a second datastore.

**Restart.** Single instance: in-memory state is lost on restart (audit case I;
accepted, it can only loosen for one window). MULTI_INSTANCE: the shared
buckets survive a restart, and the local ones start empty.

**Rolling deploy.** Rows written by the old fixed-window code hold a window
start, not a TAT. With MULTI_INSTANCE on, move every instance to the new code at
once, or accept one window of mixed accounting. Production runs
MULTI_INSTANCE=false today.

## 5. Policy by class

Rates are `limit per window`. `Burst` is the most units at once. `IP_LIMIT` is the
coarse guard: `ip_multiple` (20) x the user rate, with 20 x the user burst.
"Shared" is section 4. Cost is units per request.
`backend/tests/test_rate_limit_policy.py::test_the_policy_table_is_what_the_document_says`
parses this table and fails if a number here differs from the code.

Starting seeds (FIX LIST P0-B, from the Antigravity audit): plan and recalculate
5/min per manager, geocoding 20/min, upload 5/min, AI 10/min per driver. Kept:
geocoding, and AI as the soft gate. Changed, with the reason in the row:
`route_plan` (one bucket now serves three operations) and `upload` (one burst
must hold a driver's document set).

| Class | Bucket | LIMIT_DIMENSION | USER_LIMIT | IP_LIMIT | GLOBAL_LIMIT | BURST | ALGORITHM | COST_WEIGHT | RETRY_AFTER | MULTI_WORKER_COORDINATION | EMERGENCY_EXCEPTION | RATIONALE |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | `login` (settings) | client address, and casefolded identifier | 10 / 60 s per identifier (`LOGIN_RATE_LIMIT_PER_IDENTIFIER`), reset on success | 20 / 60 s (`LOGIN_RATE_LIMIT_PER_IP`) | none | = limit | GCRA | 1 | exact, >= 1 s | shared (identifier: DB only; IP: local first) | none | Argon2 guessing; checked before the password, so a limited caller gets no Argon2 and no answer. Behind CGNAT, 20 distinct logins/min per address remains the accepted trade-off (audit case D) |
| A | `refresh` (settings) | client address | none | 60 / 60 s (`REFRESH_RATE_LIMIT_PER_IP`) | none | = limit | GCRA | 1 | exact | shared, local first | none | token-guessing flood; refresh is legitimately bursty |
| A | `password` | user | 5 / 900 s | 100 / 900 s | none | 5 | GCRA | 1 | exact | shared | none | Argon2id verify + hash (CPU, 128 MiB); a stolen access token must not become an online oracle for the current password |
| A | `public` (logout) | client address | none | 60 / 60 s | none | 30 | GCRA | 1 | exact | local | none | unauthenticated, one DB lookup |
| A | `read` (`/api/auth/me`) | user | as F | none | none | as F | GCRA | 1 | exact | local | none | ordinary read |
| B | `route_plan` | user | 10 / 60 s | 200 / 60 s | none | 5 | GCRA | 1 | exact | shared | none | trip plan, route recalculate and shipment create reach OSRM, Nominatim reverse and the risk evidence fan-out. The seed was 5/min each for plan and recalculate; one shared bucket for all three gets 10/min, and burst 5 lets a manager plan a small batch at once, then one every 6 s |
| B | `route_assess` | user | 20 / 60 s | 400 / 60 s | none | 10 | GCRA | 1 | exact | shared | none | risk, recommendation and manager reroute assessment each fan out up to ten weather requests; the clients never poll them (manager-web `routeRecommendation` contract) |
| B | `geocoding` | user | 20 / 60 s | 400 / 60 s | none | 10 | GCRA | 1 | exact | shared | none | Nominatim is paced at 1 req/s for the whole service, so one user must not use it all; the address picker debounces 700 ms. Audit seed 20/min |
| B | `driver_route` | user | 30 / 60 s | 600 / 60 s | none | 15 | GCRA | 1 | exact | shared | none | driver route-risk, navigation and offline package. The app polls risk every 5 min and fetches packages when the route changes |
| B | `driver_reroute` | user | 6 / 600 s | 120 / 600 s | none | 3 | GCRA | 1 | exact | shared | none | OSRM from the reported fix; the app asks at most once per 120 s and 500 m (`REROUTE_MIN_INTERVAL_MS`) |
| B | `ai_ask` | user | 30 / 60 s | 600 / 60 s | none | 10 | GCRA | 1 | exact | shared | none | **decision below** |
| B | `places` | user | 120 / 60 s | none | none | 60 | GCRA | 1 | exact | local | none | local snapshot, no provider call; the manager map re-queries on `moveend` (400 ms debounce) |
| C | `write` (ceiling) | user | 120 / 60 s | none | none | 60 | GCRA | 1 | exact | local | SOS, GPS and emergency resolve are exempt | every authenticated non-GET, counted in `get_current_user`, so a new route cannot be missed |
| C | `upload` | user | 10 / 60 s | 200 / 60 s | none | 10 | GCRA | 1 | exact | shared | none | `POST /api/files`: up to 5 MB into Postgres `bytea` per call, charged before the body is read. The seed was 5/min; one burst of 10 holds a driver's document set (the 7 `DriverDocumentType` values plus a profile photo), then one every 6 s |
| D | `gps` | user (driver) | 60 fixes / 60 s | none | none | 1000 fixes | GCRA | **number of fixes** | exact | local | exempt from the write ceiling | 10x the moving cadence (1 fix / 10 s); the burst is two full offline queues (500 each) |
| D | `read` / `write` (ceiling) | user | as F / as C | none | none | as F / as C | GCRA | 1 | exact | local | none | polls: fleet 10 s, SOS 10 s, trips 5 s, overview 15 s, driver trip 10 s |
| E | `sos` | user (driver) | 5 / 600 s, **counted only after the trip's first SOS** | none | none | 5 | GCRA | 1 | exact | **local** | **the first SOS of a trip, and the answer to an open check, are never counted**; exempt from the write ceiling | resists spam without ever blocking a real SOS; see section 6 |
| E | `emergency_sweep` | user | 6 / 60 s | none | none | 3 | GCRA | 1 | exact | shared | none | a manager-triggered whole-fleet Sentinel pass |
| E | resolve | none | none | none | none | none | none | none | none | none | **never limited**, exempt from the write ceiling | a manager closing an emergency must never meet a 429 |
| F | `read` (ceiling) | user | 600 / 60 s | none | none | 300 | GCRA | 1 | exact | local | none | every authenticated GET; 3 manager tabs at the measured polls use about 180/min; a trip page opens with about 15 reads at once |
| G | `/health` | none | none | none | none | none | none | none | none | none | **never limited** | liveness probe (Render `healthCheckPath`); a 429 there gets a healthy process restarted |
| G | `public` | client address | none | 60 / 60 s | none | 30 | GCRA | 1 | exact | local | none | `/ready` (four DB statements, unauthenticated) and `/api/org/regions` (300 s cache); page loads only |

**GLOBAL_LIMIT is "none" everywhere, on purpose.** A global cap lets one abuser
use up every other caller's budget, which is the denial of service the limiter
exists to prevent. The global bounds that do exist protect a resource, not a
caller, and are unchanged: Nominatim pacing at 1 req/s (`coordination.pace`), the
Argon2 semaphore (2), the local-inference semaphore (1), the DB pool (3+2, 10 s
timeout), the upload cap (5 MB), the GPS batch cap (500) and the track read cap
(1000).

### AI ask: both

`POST /api/ai/ask` keeps the free-tier **soft gate** (10/min per driver in
`gemini.RateLimiter`, the audit's seed). Past it, the driver gets the
deterministic offline answer with HTTP 200. A driver asking a safety question
should get guidance, not an error.

A 429 does not strand the driver either: the driver app's assistant treats any
failed `/api/ai/ask` as "the server could not answer" and shows its own local
answer (`driver-app/src/screens/AssistantScreen.tsx`, the `.catch` on
`api.aiAsk`). Known intents never reach the server at all.

On top of that, the route now has a **hard `ai_ask` limit** (30/min, burst 10,
per user). It runs as a route dependency, so it comes before `_trip_facts` and
before the soft gate. Between 10 and 30 a minute the answer is offline (200); past
30 it is 429 with Retry-After. No person types 30 questions a minute. A script
does, and it no longer costs a database read and a fact assembly per call. The
soft gate stays process-local (it protects a quota, not the server).

## 6. SOS: abuse-resistant, never blocking the real one

- **Check-in** (`POST /api/driver/me/trip/check-in`): the answer to an open
  `DRIVER_CHECK_REQUIRED` check is **never counted**, whatever the answer
  (I_AM_SAFE matters as much as NEED_HELP). Later check-ins on the same emergency
  (already answered or escalated) spend the `sos` bucket.
- **Stop request** (`POST /api/driver/me/trip/stop-request`, the driver SOS): when
  the trip has **no open SOS_ESCALATED emergency**, the request is **never
  counted**. That is the first SOS of a trip, or the first after a manager
  resolved the last one. Further requests while an SOS is already open spend
  the bucket. The service stays idempotent on `request_id`, so a retried request
  never raises a second emergency.
- **Past the bucket** (5 at once, then one per 2 min): 429 with Retry-After and the
  message "An SOS is already open on this trip. Call your manager, or 112 if you
  are in danger." A check-in past it reads "Too many attempts. Call your
  manager, or 112 if you are in danger.": a check-in is also charged when no
  check is open at all, so its text claims nothing about one. The refusal is
  logged at WARNING with driver and trip ids. It
  is **not** written to the audit log: one audit row per refused spam request
  would turn the limit into a write amplifier. Accepted SOS requests keep their
  audit row (`driver requested an emergency stop`) and trip event.
- Local only, no per-IP guard, and exempt from the write ceiling. Nothing about
  another user, another instance or the database can refuse the first SOS.
- Managers: `resolve` is never limited; `sweep` has its own small bucket.

## 7. GPS: a budget, never data loss

- **Cost is the number of fixes**, so the budget measures what is written. The
  tracker sends 1 fix per 10 s while moving and 1 per 60 s when parked (server
  cadence, `telemetry_policy.py`), in batches of up to 100 from a backlog. The
  offline queue holds at most 500.
- The budget is 1 fix/s sustained and 1000 at once. Normal tracking uses 10% of
  the rate. Flushing a full queue after a dead zone uses half the burst. The
  existing guard `TestTelemetryIsNotThrottled` (70 batches) and the new cadence
  test stay green.
- **Excess is delayed, not dropped.** Past the budget the answer is 429 with
  Retry-After. The driver app treats 429 as retryable
  (`classifyUploadError`): the batch goes back on its queue and is re-sent with
  backoff. A re-send that the server had in fact stored is merged by the unique
  `(trip_id, device_fix_id)` index (`duplicates_ignored`), so nothing is stored
  twice and nothing the phone still holds is lost on the server side. The
  phone's own 500-fix queue bound (oldest first) is unchanged.
- No per-IP guard: a fleet behind one carrier address is 500 trucks x 6 fixes/min.

## 8. Every operation

Generated from the running app's routes by
`.runtime/production/fix1/backend-2/policy_table.py` (it reads the dependencies
actually attached, not this document). `read` and `write` are the ceilings in
`get_current_user`. `-` means not counted.

101 operations: the audit's 100, plus `GET /api/system/readiness` (added by fix
lane backend-1). Only `/health` and emergency resolve spend no budget, both on
purpose. Class counts: A 5, B 15, C 38, D 14, E 4, F 22, G 3.

| Class | Method | Path | Auth | Budgets spent |
|---|---|---|---|---|
| A | POST | `/api/auth/login` | public | login: per IP + per identifier (settings) |
| A | POST | `/api/auth/logout` | public | public (60/60 s, burst 30, address, local) |
| A | GET | `/api/auth/me` | yes | read (600/60 s, burst 300, user, local) |
| A | POST | `/api/auth/password` | yes | password (5/900 s, burst 5, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| A | POST | `/api/auth/refresh` | public | refresh: per IP (settings) |
| B | POST | `/api/ai/ask` | yes | ai_ask (30/60 s, burst 10, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| B | GET | `/api/driver/me/trip/navigation` | yes | driver_route (30/60 s, burst 15, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| B | GET | `/api/driver/me/trip/offline-package` | yes | driver_route (30/60 s, burst 15, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| B | GET | `/api/driver/me/trip/places` | yes | places (120/60 s, burst 60, user, local); read (600/60 s, burst 300, user, local) |
| B | POST | `/api/driver/me/trip/reroute` | yes | driver_reroute (6/600 s, burst 3, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| B | GET | `/api/driver/me/trip/route-risk` | yes | driver_route (30/60 s, burst 15, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| B | GET | `/api/geocoding/details` | yes | geocoding (20/60 s, burst 10, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| B | POST | `/api/geocoding/resolve-link` | yes | geocoding (20/60 s, burst 10, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| B | GET | `/api/geocoding/suggest` | yes | geocoding (20/60 s, burst 10, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| B | GET | `/api/places` | yes | places (120/60 s, burst 60, user, local); read (600/60 s, burst 300, user, local) |
| B | POST | `/api/trips/plan` | yes | route_plan (10/60 s, burst 5, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| B | GET | `/api/trips/{trip_id}/reroute` | yes | route_assess (20/60 s, burst 10, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| B | POST | `/api/trips/{trip_id}/routes/recalculate` | yes | route_plan (10/60 s, burst 5, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| B | GET | `/api/trips/{trip_id}/routes/recommendation` | yes | route_assess (20/60 s, burst 10, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| B | GET | `/api/trips/{trip_id}/routes/{route_id}/risk` | yes | route_assess (20/60 s, burst 10, user, IP x20, shared); read (600/60 s, burst 300, user, local) |
| C | POST | `/api/assignments` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/assignments/{assignment_id}/end` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/assignments/{assignment_id}/verify` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/assignments/{assignment_id}/verify-manual` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/assignment/verify` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/documents` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/push-token` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/trip/accept` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/trip/complete` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/trip/instruction/ack` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/trip/start` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/trip/stops/{stop_id}/arrive` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/trip/stops/{stop_id}/complete` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/driver/me/truck-documents` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/drivers` | yes | write (120/60 s, burst 60, user, local) |
| C | PATCH | `/api/drivers/{driver_id}` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/drivers/{driver_id}/deactivate` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/drivers/{driver_id}/support-session` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/files` | yes | upload (10/60 s, burst 10, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| C | POST | `/api/notifications/read` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/org/managers` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/org/managers/{manager_id}/deactivate` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/shipments` | yes | route_plan (10/60 s, burst 5, user, IP x20, shared); write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/cancel` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/close` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/dispatch` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/reroute/accept` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/routes/{route_id}/approve` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/routes/{route_id}/review-authorization` | yes | write (120/60 s, burst 60, user, local) |
| C | DELETE | `/api/trips/{trip_id}/routes/{route_id}/review-authorization/{authorization_id}` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/routes/{route_id}/select` | yes | write (120/60 s, burst 60, user, local) |
| C | DELETE | `/api/trips/{trip_id}/simulation` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/simulation` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trips/{trip_id}/stops` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trucks` | yes | write (120/60 s, burst 60, user, local) |
| C | PATCH | `/api/trucks/{truck_id}` | yes | write (120/60 s, burst 60, user, local) |
| C | POST | `/api/trucks/{truck_id}/retire` | yes | write (120/60 s, burst 60, user, local) |
| D | GET | `/api/ai/status` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/dashboard` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/driver/me` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/driver/me/assignment` | yes | read (600/60 s, burst 300, user, local) |
| D | POST | `/api/driver/me/location` | yes | gps (cost = fixes) |
| D | GET | `/api/driver/me/notices` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/driver/me/trip` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/emergencies/active` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/fleet/active` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/presence` | yes | read (600/60 s, burst 300, user, local) |
| D | POST | `/api/presence/heartbeat` | yes | write (120/60 s, burst 60, user, local) |
| D | GET | `/api/system/providers` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/system/simulation` | yes | read (600/60 s, burst 300, user, local) |
| D | GET | `/api/trips/{trip_id}/track` | yes | read (600/60 s, burst 300, user, local) |
| E | POST | `/api/driver/me/trip/check-in` | yes | sos, only after the open check is answered |
| E | POST | `/api/driver/me/trip/stop-request` | yes | sos, only while an SOS is already open |
| E | POST | `/api/emergencies/sweep` | yes | emergency_sweep (6/60 s, burst 3, user, shared); write (120/60 s, burst 60, user, local) |
| E | POST | `/api/emergencies/{emergency_id}/resolve` | yes | - |
| F | GET | `/api/assignments` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/assignments/{assignment_id}` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/driver/me/documents` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/driver/me/profile` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/driver/me/truck-documents` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/drivers` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/drivers/{driver_id}` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/drivers/{driver_id}/documents` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/files/{file_id}` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/notifications` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/org/districts` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/org/managers` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/org/states` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/shipments` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/system/readiness` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/trips` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/trips/{trip_id}` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/trips/{trip_id}/events` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/trips/{trip_id}/routes` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/trips/{trip_id}/routes/{route_id}/review-authorization` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/trucks` | yes | read (600/60 s, burst 300, user, local) |
| F | GET | `/api/trucks/{truck_id}` | yes | read (600/60 s, burst 300, user, local) |
| G | GET | `/api/org/regions` | public | public (60/60 s, burst 30, address, local) |
| G | GET | `/health` | public | - |
| G | GET | `/ready` | public | public (60/60 s, burst 30, address, local) |

## 9. Proof (30 Sep 2026)

Evidence: `.runtime/production/fix1/backend-2/`.

- **Tests.** `backend/tests/test_rate_limit_policy.py` (37 tests: the GCRA
  bounds, route wiring, the class B and C budgets over HTTP, NAT, one user from
  many addresses, forged `X-Forwarded-For`/`X-Real-IP` at hops 0 and 1, a
  malformed chain, IPv6, restart, two instances, first SOS, check-in, GPS
  cadence, `/health`, and this document's table). The login, proxy and
  coordination suites were renamed to `GcraLimiter`. Targeted run 104 passed;
  every test file on a changed route 493 passed; full backend suite
  **1704 passed, 27 skipped** (`full_pytest_final.log`).
- **Mutations.** 25 guards removed one at a time (`mutate.py`): all 25 fail their
  pinning test with an assertion (exit 1), and every file is restored byte for
  byte (`mutation_results.json`).
- **Red, unit.** `red_unit.py`, limit 20 per 4 s, 20 ms around a window edge:
  the old fixed window admits 19 + 20 = **39**; GCRA admits **20**.
- **Red and green, runtime.** The same harness (`attack_fix.py`, `run_proof.py`)
  ran the pre-change code (`before_src/`) and this code, each through
  `run.py`, on the scratch database `repro_backend2_1` (migrated to head, then
  dropped), with every provider on a local fake. `before_after.md` has every
  case next to the rate-limit lane's own numbers:

| Case | Before | After |
|---|---|---|
| Login cases A to J (lane's shapes) | same counts as the lane | same counts; Retry-After is the time to the next attempt (e.g. 6 s, was 59 s) |
| Window edge, 19 at 3.6 s + 20 at 4.4 s, per-IP 20 / 4 s | **39** pass | **24** pass (GCRA bound 20 + 0.8 / 0.2) |
| Trip plan x12 | 12 x 422, never 429 | 5 x 422, then 7 x 429 (Retry-After 6) |
| Geocoding x15 at once | 15 x 200 | 10 x 200, 5 x 429 |
| Route risk x12 | 12 x 404 | 10 x 404, 2 x 429 |
| AI ask x15 | 15 x 200 (soft gate only) | 10 x 200, 5 x 429 |
| Wrong current password x8 | 8 x 401 (8 Argon2 runs) | 5 x 401, 3 x 429 (Retry-After 180) |
| Upload x12 | 12 x 415 | 10 x 415, 2 x 429 |
| Driver reroute x6 | 6 x 422 | 3 x 422, 3 x 429 (Retry-After 100) |
| Driver route risk x20 | 20 x 409 | 15 x 409, 5 x 429 |
| 15 users x 8 on one address | 120 answered | 120 answered, no 429 |
| One user from 15 addresses (hops 1) | 15 answered | 10 answered, 5 x 429 |
| 70 writes, then the first SOS, then 6 more | all 200 | 61 + 9 x 429; **first SOS 200**; 5 x 200 + 1 x 429 "An SOS is already open..." |
| GPS at tracker cadence (45 batches, 540 fixes) | 45 x 202 | 45 x 202 |
| GPS 3 x 500 fixes at once | 3 x 202 | 2 x 202, 1 x 429 (Retry-After 500) |
| `/api/auth/me` x400 | 400 x 200 | 318 x 200, 82 x 429 |
| `/ready` x40 | 40 x 200 | 30 x 200, 10 x 429 |
| `/health` x500 | 500 x 200 | 500 x 200 |
| Hops 0 behind a proxy | no signal | startup and runtime WARNING; `/ready` 200 with `proxy: forwarded_header_ignored` |
| Driver reroute across a restart, MULTI_INSTANCE off / on | 422 / 422 | 422 (memory is gone) / **429** (Postgres TAT survives, Retry-After 95) |
| 20 suggestions at once over 2 instances, one user | 20 x 200 | **exactly 10 x 200**, 10 x 429 |
| 12 plans alternating 2 instances, one user | 12 x 422 | 5 x 422, 7 x 429 |

  Without MULTI_INSTANCE, budgets stay per process (J: 2 processes, 20 passes
  for one identifier; 4, 40), as section 4 says; production runs one process.
  The first harness run (`run1_*`) is kept. Its geocoding cases ran through the
  Nominatim pace (1 req/s), so the budget refilled while requests waited, and
  its edge case sent the second batch late. Run 2 fixed both, and C2 was rerun
  once with wider margins (`run_proof_c2_console.log`).

## 10. Not done here

- Identifier Unicode normalisation (NFKC) for the login key: NOT_REPRODUCED by the
  audit and not changed. The key is `strip().casefold()`, as before.
- The `rate_limit_windows` table is not renamed. The `window_start` column holds
  the TAT (see the model docstring).
- `render.yaml` is not edited in this lane. See section 3 for the value. The
  working tree already sets `TRUSTED_PROXY_HOPS: "1"`, but only uncommitted:
  it has to ship with this code. Hops = 0 behind a proxy is detected and
  warned about, not made safe. Code cannot tell a real proxy from a forged
  header. Never pair hops = 0 with uvicorn `--forwarded-allow-ips "*"`: uvicorn
  would then take the LEFT-most entry as the peer.
- Clients: nothing is required. The tracker already retries a 429, the
  assistant falls back locally, and the trip screen shows the server's message.
  Showing a countdown from `Retry-After` on the plan, geocoding and assessment
  buttons would be kinder; that is the web and driver lanes' call.
- Hosted: NOT_VERIFIED. No deploy and no hosted request were made.
