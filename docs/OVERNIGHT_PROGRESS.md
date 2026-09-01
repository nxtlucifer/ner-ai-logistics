# Overnight Engineering Progress

Recovery checkpoint for an autonomous run. Read this first after any restart,
then verify `git status` and `git rev-parse HEAD` before trusting it.

**No credentials, tokens, keys or personal data in this file. Ever.**

---

## Session

| | |
| --- | --- |
| Started | 2026-08-30 23:57 |
| Starting HEAD | `79142518750cf8d4432e0c67d2eb592284722252` |
| Branch | `main` (== origin/main at start) |
| Worktree at start | clean |
| Commit/push authorised | **NO** — leave work in the tree for morning review |
| Target stop | ~06:00 |

## Protected baseline (do not regress)

Backend 415 passed / 5 skipped (420 collected) · Manager 38/38 · Driver 25/25 ·
E2E 44/44 · lock probe 9/9 · migration head `0006_current_assignment_unique`.

---

## Task queue

| # | Task | Status |
| --- | --- | --- |
| 1 | Rate limiting (pre-LAN security gate) | **DONE** — 18 tests (17 overnight + 1 added 2026-08-31 for a per-IP bypass) |
| 2 | P7 routing architecture (provider abstraction) | **DONE** — 31 tests (`tests/test_routing.py`) |
| 3 | Real routing provider integration (OSRM) | **DONE** — contract verified against official docs |
| 4 | Route API | **DONE** — 18 tests (`tests/test_route_api.py`) |
| 5 | Route scoring | **RECONSIDERED** — see iteration 4 |
| 6 | Manager routing UI | **DONE** — 7 new tests, planned vs observed distinct |
| 7 | Routing tests | **DONE** — 31 unit + 18 API + 7 UI (measured 2026-08-31) |
| 8 | P8 weather foundation | **DONE** — 16 tests, live-verified, NOT wired to any endpoint |
| 9 | Battery telemetry foundation | NOT STARTED (only if time) |
| 10 | Code review / debug pass | CONTINUOUS |
| 11 | Demo hardening | NOT STARTED |

---

## Iteration log

### Iteration 0 — 23:57 — baseline

CURRENT_TIME 23:57
CURRENT_HEAD `7914251`
CURRENT_WORKTREE_STATUS clean, 0 entries

COMPLETED_TASK Session start; baseline verified.
FILES_CHANGED none yet
TESTS_RUN none yet (baseline inherited from the committed checkpoint)
BLOCKERS none

CURRENT_TASK Task 1 — rate limiting
NEXT_TASK Task 2 — routing provider abstraction

### Iteration 1 — 00:35 — Task 1 rate limiting

CURRENT_TIME 00:35
CURRENT_HEAD `7914251` (unchanged — nothing committed, as instructed)
CURRENT_WORKTREE_STATUS dirty, rate-limiting work only

COMPLETED_TASK Task 1 — rate limiting on authentication endpoints.

ROOT_CAUSE / DESIGN
  Not a defect — a missing control, and the one that gates LAN exposure. Two
  constraints came from the codebase itself rather than from preference:
  `main.py` forbids app-wide middleware that grants or withholds access, and
  `get_client_ip` documents X-Forwarded-For as client-controlled. So the limiter
  is a per-route dependency keyed on the TCP peer, not middleware keyed on a
  forgeable header. Per-route is also what structurally prevents throttling GPS.

IMPLEMENTATION
  - `app/core/rate_limit.py` — fixed-window limiter, injected clock, pruning
  - `app/core/errors.py` — `RateLimitedError` + `Retry-After` header
  - `app/core/config.py` — 5 knobs, generous defaults
  - `app/api/auth.py` — login (per-IP AND per-identifier), refresh (per-IP)
  - `tests/conftest.py` — reset windows between tests rather than disabling the
    feature, so every login in the suite runs the real gate

FILES_CHANGED
  app/core/rate_limit.py (new), app/core/errors.py, app/core/config.py,
  app/api/auth.py, tests/conftest.py, tests/test_rate_limit.py (new),
  docs/SECURITY.md

TESTS_RUN  tests/test_rate_limit.py → 17 passed (98s)
           auth+authz+audit+concurrency+driver_self+api_fleet+rate_limit
           → 157 passed (540s)
TEST_RESULTS PASS
RUNTIME_RESULT not yet re-verified (deferred to the milestone gate)

KNOWN_RISKS
  - In-process state: resets on restart, per-worker not global. Documented.
  - Behind a reverse proxy the per-IP limit collapses to one bucket; only the
    per-identifier limit still bites. Documented, not silently accepted.
  - GPS ingestion deliberately unbounded — a compromised driver token can still
    write telemetry. Bounding it needs a per-trip quota, not a per-IP limit.

CURRENT_TASK Task 2 — routing provider abstraction
NEXT_TASK Task 3 — real provider integration
BLOCKERS none

### Iteration 2 — 00:55 — Tasks 2/3/4 routing

CURRENT_TIME 00:55
CURRENT_HEAD `7914251` (nothing committed)
CURRENT_WORKTREE_STATUS dirty — rate limiting + routing

COMPLETED_TASK P7 routing: provider abstraction, OSRM provider, route API.

DESIGN
  The `trip_routes` schema already anticipated this — kind, state,
  routing_provider, provider_route_id, superseded_by, and a nullable
  estimated_fuel_litres whose column comment already says "NULL means no
  estimate available. Never default to zero." Built onto it rather than
  inventing a parallel model.

  Provider contract verified against the official OSRM v5.24 API docs, not
  recalled: lon,lat ordering; distance metres; duration seconds; code values
  Ok / NoRoute / NoSegment / TooBig / Invalid*.

  Outage vs refusal are separate exception types, and the chain treats them
  differently: an outage falls through to the fallback, a refusal is terminal.
  A second provider will also fail to route from a point in the sea, and trying
  it spends another timeout to reach the same answer.

IMPLEMENTATION
  - `app/domain/routing.py` — RouteCandidate, validation, WKT, error types
  - `app/services/routing/{base,osrm,__init__}.py` — protocol, chain, provider
  - `app/services/routes.py` — plan / list / select, supersession, audit
  - `app/api/trips.py` — GET routes, POST recalculate, POST select
  - `app/core/permissions.py` — route:read / route:plan / route:select
  - `app/core/errors.py` — ServiceUnavailableError (503, distinct from 422)
  - `app/core/config.py` — provider URLs, timeout, enable flag

DELIBERATE REFUSALS
  - Only PRIMARY is written. FUEL_EFFICIENT needs a fuel model that does not
    exist; relabelling the primary would be a fabricated feature.
  - No ETA. `estimated_duration_min` is free-flow travel time and is documented
    as not an arrival time.
  - `estimated_fuel_litres` absent from the response contract rather than null.

TESTS_RUN  tests/test_routing.py → 24 passed (25s)
           tests/test_route_api.py → 12 passed (66s)
TEST_RESULTS PASS
RUNTIME_RESULT not yet re-verified

KNOWN_RISKS
  - Fallback is the public OSRM demo server: no quality guarantee, access can be
    withdrawn without notice. Fine as a fallback, NOT something to demo on alone.
    A keyed primary is configurable but no credential is available in this run.
  - Route planning is not yet wired into the Manager UI (Task 6).
  - `/api/routes/preview` still planned, not built.

CURRENT_TASK Task 6 — Manager routing UI
NEXT_TASK milestone regression, then Task 10 review
BLOCKERS
  Task 3 keyed primary provider: needs an API key, which is a user-only
  credential decision. Keyless fallback works, so this is not blocking.

### Iteration 3 — 00:28 — Task 6/7 routing UI + self-review

CURRENT_TIME 00:28
CURRENT_HEAD `7914251` (nothing committed)
CURRENT_WORKTREE_STATUS dirty — rate limiting + routing + routing UI

COMPLETED_TASK Manager routing UI, routing tests, hostile review of new code.

IMPLEMENTATION
  - `FleetMap.tsx` — `planned-route` source/layer, dashed violet, drawn BENEATH
    the solid sky-blue observed track so where they diverge the observation
    stays on top. Distinguishable by dash as well as colour, which matters for
    a colour-blind dispatcher.
  - `FleetPage.tsx` — routes fetched with the selection; planning is a separate
    explicit action, because it calls a third party and writes a row.
  - `client.ts` — TripRoute / RoutePlanResult types, three endpoints.

REVIEW FINDINGS FIXED IN THIS ITERATION
  1. `recalculate` took no row lock. Two concurrent re-plans would both read the
     same open routes and both insert, leaving two PROPOSED routes. Now locks
     the trip — but AFTER the provider call, so a slow provider does not hold a
     row lock for the routing timeout.
  2. `select_route` had the same gap: concurrent selections would each demote
     the other and leave trips.selected_route_id disagreeing with the SELECTED
     row. Now locks first; no external call happens there so the lock is cheap.
  3. A `trips.get()` after the lock was a redundant second read; replaced.
  4. My reset-on-selection effect drew a lint warning. Replaced with routes and
     errors tagged by trip id, so a stale result stops matching instead of
     being cleared by an extra render pass. Lint back to the 2 pre-existing.
  5. FleetPage docstring still said "routing does not exist yet". Corrected.
  6. FleetPage tests broke when `listRoutes` joined the selection read — an
     incomplete fixture, not a product defect. Fixture fixed, no assertion
     weakened.

TESTS_RUN  manager vitest → 45 passed (was 38)
           typecheck 0, build 0, lint 2 pre-existing warnings
TEST_RESULTS PASS
RUNTIME_RESULT pending

KNOWN_RISKS
  - `plan()` holds a DB session open across the provider HTTP call (up to the
    8s timeout). At demo scale fine; against the 15-client pooler it is worth
    watching if planning ever becomes concurrent.
  - Route API tests predate the locking change and need re-running.
  - The in-flight milestone regression started before the route API existed, so
    it is NOT authoritative for routing. A final full run is required.

CURRENT_TASK re-run route tests after locking change
NEXT_TASK Task 5 route scoring, then final regression
BLOCKERS none

### Iteration 4 — 01:10 — real alternatives, and why scoring was deferred

CURRENT_TIME 01:10
CURRENT_HEAD `7914251` (nothing committed)

DECISION: Task 5 (route scoring) deferred, and a substitute done instead.

  Scoring as specified would combine travel time, distance, a fuel proxy, road
  penalties and risk. Four of those five do not exist. Worse, with a single
  PRIMARY candidate there was nothing to rank - a "score" over one item is a
  number with no decision attached to it, which is the kind of thing that looks
  like AI and is not.

  The blocking problem was not the scoring formula; it was having only one
  candidate. So the work went there instead: OSRM's `alternatives` parameter,
  and an honest rule for when a second route deserves to be called one.

COMPLETED_TASK Real provider alternatives + corridor distinctness.

IMPLEMENTATION
  - `route_options(..., limit)` on the provider and the chain; `route()` now
    delegates to it, so the single-route path is the same code.
  - `is_distinct_corridor()` in the domain: sample 12 points along each route,
    take the maximum separation, require 2 km. Positional rather than by total
    distance, because two routes can share a length and go different ways - and
    going a different way is a backup route's entire value.
  - `plan()` requests two options and stores the second as EMERGENCY_BACKUP
    only when it clears that bar. `backup_planned` is reported to the client.
  - Moved `haversine_m` from `services/telemetry.py` down into
    `domain/routing.py`. Two subsystems needed it and the domain must not
    import a service. One copy, so a fix reaches both.

TESTS_RUN  tests/test_routing.py → 31 passed
           tests/test_route_api.py → 16 passed
TEST_RESULTS PASS

REVIEW FINDINGS FIXED
  - The chain's stub provider in tests implemented only `route()`, so it would
    have passed while the chain called something no real provider offers. Stub
    now implements the full protocol.

KNOWN_RISKS
  - FUEL_EFFICIENT remains unproduced and will stay so until a fuel model
    exists. Documented in API_CONTRACTS §9 and in the service docstring.
  - The 2 km distinctness threshold is a judgement, not a measurement. It is
    named, tested at both ends (a 300 m detour is rejected, a 0.5° corridor is
    accepted) and adjustable in one place.
  - Backup routes are stored but the Manager UI still draws only the active
    route; surfacing the choice is outstanding.

CURRENT_TASK milestone regression 2
NEXT_TASK E2E certification, then final gates
BLOCKERS none

### Iteration 5 — 01:45 — live verification, payload fix, honesty fixes

CURRENT_TIME 01:45
CURRENT_HEAD `7914251` (nothing committed)

COMPLETED_TASK Live provider verification, geometry payload fix, doc
reconciliation, self-review of the overnight diff.

LIVE VERIFICATION (the first time any of this touched the real provider)
  Guwahati -> Jorhat against router.project-osrm.org:
    305.39 km / 221 min / first point (26.144276, 91.736153)
  The repo's own DEMO_PLAN independently states "~308 km", so the integration
  corroborates against a figure written before it existed. Coordinates came back
  in the right order - an inversion here is the most common spatial bug and
  would have been invisible in stubbed tests.

  Only ONE option returned. That empirically confirms the assumption behind the
  backup logic rather than leaving it as an assertion: NER corridors usually
  have one sensible road, so `backup_planned: false` is ordinary.

DEFECT FOUND BY THAT CHECK
  `overview=full` returned 5,213 geometry points - ~121 KB of JSON per route,
  fetched on every trip selection and shipped to the browser, to draw a line at
  a zoom where the extra vertices are invisible. Switched to `simplified`
  (OSRM's own default): 52 points, 1.2 KB, a 100x reduction with IDENTICAL
  distance, duration and endpoints. Pinned by a test carrying the measurement.

HONESTY FIX
  `ROUTING_PRIMARY_KEY` was declared in config and read by nothing - a knob
  advertising a capability that did not exist. Someone could have set it,
  watched routing work through the keyless fallback, and believed the key was
  in use. Removed entirely, with the reasoning recorded where the setting was:
  a keyed provider needs its own class, because where a credential goes differs
  per vendor.

  Also documented, not defended against: the rate limiter prunes only EXPIRED
  windows, so a map of all-fresh entries is bounded by the per-IP limit rather
  than by an eviction policy. The eviction policy would be the harder thing to
  get right and the limit it protects is the cheaper bound.

DOCS RECONCILED
  ROADMAP P7 marked PARTIALLY COMPLETE with the exit gate explicitly NOT met
  and each missing piece named. README and AGENTS.md now separate "partly
  implemented (uncommitted)" from "not implemented". API_CONTRACTS §9 carries
  the backup rule, the no-key decision and the geometry measurement.

TESTS_RUN  routing + route API + telemetry -> 87 passed
           E2E fleet certification -> 44 passed
           runtime /health 200, /ready 200 (ownership proven, PID 31728, port
           8011 verified free first - port 8000 belongs to the other account)
TEST_RESULTS PASS

CURRENT_TASK final authoritative regression
NEXT_TASK frontend gates, final audit, morning report
BLOCKERS none

### Iteration 6 — 02:10 — P8 weather foundation

CURRENT_TIME 02:10
CURRENT_HEAD `7914251` (nothing committed)

COMPLETED_TASK Weather provider foundation, backend only.

DESIGN
  Same shape as routing, deliberately: normalised `WeatherObservation` in the
  domain, provider in services, application depends on neither Open-Meteo's
  field names nor its envelope. Contract taken from the official docs.

  No chain. One provider is configured, and a fallback would be scaffolding for
  a resilience story that does not exist; `RoutingChain` shows the shape to copy
  when a second provider earns its place.

THREE REFUSALS WORTH RECORDING
  1. No risk score, no "conditions are dangerous", no reroute suggestion.
     Turning a temperature into a safety judgement needs agreed, tested
     thresholds. None exist. A test asserts the model has no `risk`,
     `severity` or `is_dangerous` attribute, so adding one is a deliberate act.
  2. No `visibility` field. Open-Meteo exposes visibility HOURLY, not as a
     current variable. A field that is always None invites a UI to render
     "0 m" - the same failure as a permanently-null fuel estimate.
  3. Condition codes are kept as codes. Translating 61 into "rain" is a
     judgement with operational consequences and does not belong at this layer.

UNITS ARE READ, NOT ASSUMED
  The provider checks `current_units` and REFUSES on a mismatch rather than
  converting. m/s read as km/h is a 3.6x error in a number a dispatcher might
  hold a truck over, and nothing in the response would look wrong - the number
  is simply smaller. Pinned by a test.

LIVE VERIFICATION
  One request to Open-Meteo for Guwahati: 25.5 C, 0.3 mm, 6.0 km/h (gust 12.6),
  code 55, observed 2026-08-30T20:30Z - which is 02:00 IST on the 31st, matching
  the local clock. The unit assertion held against the real service, so the
  contract is confirmed rather than assumed.

TESTS_RUN  tests/test_weather.py -> 16 passed
TEST_RESULTS PASS

KNOWN_RISKS / HONEST STATUS
  - The weather subsystem is a FOUNDATION and is wired to NOTHING. No endpoint,
    no UI, no consumer. That is what Task 8 asked for, but it means the code is
    currently unreferenced by the application, and a reviewer may reasonably
    prefer to hold it back from the checkpoint. Flagged rather than buried.
  - Open-Meteo needs no key for non-commercial use; commercial use would.

CURRENT_TASK final regression with weather included
NEXT_TASK morning report
BLOCKERS none


---

# 2026-08-31 MORNING REVIEW + RESUMED FORENSIC AUDIT

Appended after the overnight run. Counts above were the numbers measured at the
time each iteration finished; the authoritative figures are below.

## TEST EVIDENCE STATUS

    192 passed          STALE / INVALIDATED
                        That process had already imported the pre-fix
                        `app/api/auth.py`. Python caches modules in
                        `sys.modules`, so an edit made on disk after collection
                        cannot reach a running interpreter. No fixture can
                        repair this - only a fresh process can.

    498 passed,         CURRENT / AUTHORITATIVE
    5 skipped           Fresh process, 2026-08-31 13:18:25 -> 13:28:05 (9m 38s).
                        Verified that no backend source file changed after the
                        run began. Subtotal for the same nine files that
                        produced 192 is now 193 - the +1 is the added
                        credential-spraying test.

    Skips (all expected, none silenced): 1 non-Windows event-loop test,
    4 destructive migration tests still gated behind
    RUN_DESTRUCTIVE_MIGRATION_TESTS, which was left disarmed.

## TWO FUNCTIONAL FIXES

  FIX 1  app/services/routes.py :: plan()
         The connection-release added earlier used `await db.rollback()`, which
         expires every object in the session - including the `actor` User the
         permission dependency loaded through it. The next `actor.id` raised
         MissingGreenlet. Changed to `await db.commit()`: both release the
         connection, but the sessionmaker sets `expire_on_commit=False`.

  FIX 2  app/api/auth.py :: login()
         A successful login cleared the per-IP rate-limit budget as well as the
         per-identifier one. One valid credential therefore bought unlimited
         credential spraying: N-1 guesses at N-1 accounts, one login of your
         own to zero the counter, repeat. The per-identifier limit cannot see
         that attack because no single account is guessed twice. The per-IP
         reset was removed; the identifier reset stays.
         Reproduced red before the fix under a reversible, hash-verified edit.

## FURTHER FALSE CLAIMS FOUND AND CORRECTED

  - `docs/API_CONTRACTS.md` banner still said only /health and /ready existed.
  - The FastAPI app's own OpenAPI `description` said the same thing, and it is
    what an API consumer actually reads.
  - `/openapi.json` was served in production while `/docs` was gated - the
    schema is the more useful half of that pair to an attacker. Both are now
    development-only (verified across development/production/staging).
  - `manager-web/src/pages/SystemPage.tsx` told users routing was "not built
    yet" inside an app that already draws planned routes.
  - `docs/DEVELOPMENT_ROADMAP.md` still referenced a `ROUTING_PRIMARY_KEY`
    setting that had been deleted.
  - `README.md` said "routing does not exist" two lines after describing it.

## DEFECT FOUND AND FIXED

  P2  `POST /api/assignments/{id}/end` has no guard against an in-flight trip.
      Demonstrated: end returns 200 while the trip is ACTIVE, the trip stays
      ACTIVE pointing at an ENDED assignment, and the driver can then be
      assigned to a SECOND truck (201 ACTIVE) while still executing the first
      trip. That bypasses the P5 one-current-assignment invariant in two
      ordinary manager calls.

      A second, worse path was then found: `create()` ends the driver's open
      assignments INLINE rather than calling `end()`, so a single
      `POST /api/assignments` reached the same invalid state without the word
      "end" appearing anywhere. A guard on the explicit endpoint alone would
      have made the bypass shorter, not closed it.

      FIXED. `app/domain/trip_state.py` gained `COMMITS_DRIVER_TO_TRUCK`
      (ACTIVE, DELAYED, INCIDENT, DELIVERED) and
      `app/services/assignments.py::_refuse_if_a_trip_is_underway` is called
      from BOTH paths, answering `409 ASSIGNMENT_HAS_LIVE_TRIP`. Blocking the
      transition rather than cascading: silently ending a live trip because
      someone edited an assignment would be a far larger semantic change.
      7 regression tests, red before the fix (4 failed) and green after.
      No UI change needed - the manager already renders a 409 as "Conflict"
      with the server's message and no Retry button.
