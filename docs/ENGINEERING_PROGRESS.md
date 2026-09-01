# Engineering Progress

Rolling record of the core-intelligence build. Newest entry first.
No secrets, no connection strings, no keys.

---

## 2026-09-01 — Infrastructure defect: the suite lock leaks behind the pooler

**HEAD** `7914251` (unchanged) · **committed** NO · **pushed** NO

### What happened

The full backend regression launched after the risk engine returned
**74 failed, 436 passed, 242 errors in 2h14m** — against ~510 passed in ~10
minutes earlier the same day.

That result is **INVALID, not a regression.** Two distinct causes, both
environmental:

**1. The network dropped mid-run.** The dominant error was
`[Errno 11001] getaddrinfo failed` (DNS resolution failure) alongside
`server closed the connection unexpectedly`. Every database-dependent test then
failed or errored, and the 13x duration is retries against an unreachable host.
DNS and TCP to the database were re-verified healthy afterwards.

**2. A stale advisory lock then blocked every retry.** This is the real find,
and it is a genuine defect in the test infrastructure.

    pytest run dies without teardown
      -> client process gone
      -> Supabase's pooler (Supavisor) keeps the SERVER session alive and idle
      -> the session-level advisory lock survives on that session
      -> every future run is refused, indefinitely

Confirmed by inspection: holder backend `state='idle'`,
`application_name='Supavisor'`, idle for over four minutes and not recycling,
while **zero** pytest processes existed on the machine.

`pg_advisory_unlock_all()` only affects the calling session, so there is no way
to release another session's lock except to end that session. Recovery was a
guarded `pg_terminate_backend` that fired only for a pid still holding this
exact 64-bit lock identity. No rows were read, written or deleted.

Afterwards `tests/test_rate_limit.py` returned **18 passed** — so the 7 failures
seen mid-incident were contamination, not a rate-limiter regression.

### Why this matters beyond today

The suite lock exists to stop two runs destroying each other's fixtures, and it
does that well. But its failure mode is silent and total: a crashed run leaves
the project untestable with an error message that tells the operator to "wait
for the other run to finish" when there is no other run. Anyone hitting this
without the `pg_locks` query would conclude the database was broken.

### Fixed

`tests/conftest.py` now names the holder when it refuses. Verified by holding
the lock from a second session and observing the real output:

    Held by backend pid=284211, state='idle', idle for 0:00:12, session age 0:00:13.

    If NO pytest process is running on this machine, that session is orphaned:
    its client died and the pooler kept the server session alive, so the lock
    leaked. Confirm there is no live run, then release it with
        SELECT pg_terminate_backend(284211);
    which ends only that connection and changes no data.

Deliberately **not** auto-terminating. A legitimately running suite also sits
`idle` between statements, so any heuristic here would eventually kill
somebody's real run. The diagnostic informs a human and lets them decide.

The change is confined to the `if not acquired:` branch plus a module-level
newline constant; the acquire path is untouched. Re-verified that a normal run
still takes the lock (`tests/test_health.py` — 9 passed) and re-ran the full
suite afterwards, because conftest is foundational.

### Lesson recorded
A long run that gets dramatically slower is an infrastructure signal, not a
code signal. Reading the error signatures first (`getaddrinfo failed`) cost two
minutes and prevented chasing 74 imaginary regressions.

---

## 2026-08-31 — Route Risk Engine V1 (Phases 4 + 5)

**HEAD** `7914251` (unchanged) · **worktree** dirty, uncommitted · **committed** NO · **pushed** NO

### Current phase
Phase 4 (weather becomes useful) and Phase 5 (deterministic route risk V1) — delivered.
Phases 6–15 not started.

### Completed this loop

Weather stopped being an orphan library and became an application feature.

Before this loop `app/domain/weather.py` and `app/services/weather/` were
imported by nothing outside their own tests — a provider with no consumer.
There is now a path from a persisted route to an explained risk score:

    trip route geometry (PostGIS)
      -> parse_wkt_linestring
      -> sample_positions (5 points along the corridor)
      -> release the DB connection
      -> Open-Meteo, 5 requests concurrently
      -> WeatherObservation, freshness-checked
      -> route_risk.assess  (deterministic, published constants)
      -> GET /api/trips/{trip_id}/routes/{route_id}/risk

### Files changed

New
- `backend/app/domain/route_risk.py` — scoring rule, no I/O
- `backend/app/services/route_risk.py` — sampling, provider fan-out, DB lifetime
- `backend/tests/test_route_risk.py` — 19 tests, injected clock
- `backend/tests/test_route_risk_api.py` — 9 tests over real HTTP

Modified
- `backend/app/domain/routing.py` — `sample_positions`, `parse_wkt_linestring`
- `backend/app/api/trips.py` — `RouteRiskRead`, risk endpoint, WKT parser deduplicated
- `backend/app/services/routes.py` — `ensure_belongs_to_trip`
- `backend/app/core/config.py` — `WEATHER_PROVIDER_URL`, `WEATHER_TIMEOUT_SECONDS`, `WEATHER_ENABLED`

### Design decisions worth defending

**It is not AI, and it does not pretend to be.** A weighted rule with constants
in one file. There is no `confidence`, no `model_version`, no
`predicted_delay`. A test asserts those fields are absent, because the moment
one appears the system is claiming training and validation that never happened.

**Absent datasets are named, not omitted.** The response carries
`inputs` and `unavailable`, so `landslide: NOT_AVAILABLE` is visible next to
the score. A dispatcher shown a bare "37/100" assumes it is complete, and that
assumption is the dangerous one.

**Stale observations are never scored.** A reading older than the freshness
window is counted and reported but excluded. A test pins the specific failure:
a stale *calm* reading must not dilute live heavy rain, which is exactly when a
naive average would understate risk.

**A weather outage is not a request failure.** The endpoint returns 200 with
`weather: NOT_AVAILABLE` and a `WEATHER_UNAVAILABLE` reason code. Distance and
duration remain real evidence, and a 503 would show a dispatcher nothing at all
because a free API had a bad minute.

**Reason codes, not sentences.** `HEAVY_RAIN_ON_ROUTE`, not "Heavy rain is
affecting your route." Phase 11 needs the driver app to render Hindi and
Assamese from local files with no LLM in the loop; a sentence built on the
server arrives untranslatable.

**Nothing is persisted.** A risk score is a statement about *now*. Storing one
would leave a number that looks current long after it stopped being true — the
same failure as a stale GPS fix rendered LIVE. No migration was needed.

**Thresholds are project-defined and labelled as such.** The rain and gust
cut-offs are this project's operational constants, not an official
meteorological standard, and the module says so.

### Root causes fixed earlier in the same session
- `routes.plan()` held a pooled connection across the provider call
  (measured `pool.checkedout() == 1`, `idle in transaction`) → released with
  `commit`, not `rollback`, because rollback expires the `actor` and raises
  MissingGreenlet.
- A successful login cleared the **per-IP** rate-limit budget, so one valid
  credential bought unlimited credential spraying → per-IP reset removed.
- `POST /api/assignments/{id}/end` had no guard against a live trip, and
  `create()` reached the same state inline in one call → `COMMITS_DRIVER_TO_TRUCK`
  guard on both paths, with `FOR UPDATE` on non-terminal trips to close the race.

### Test results
- `tests/test_route_risk.py` — 19 passed
- `tests/test_route_risk_api.py` — 9 passed
- routing + weather + risk + config + schemas subsystem — 155 passed
- full backend regression — running at time of writing

### Runtime results
Not runtime-verified against a live server this loop. The weather provider was
verified against the real Open-Meteo service in an earlier loop (Guwahati,
units asserted). The risk endpoint has been exercised over real HTTP through
ASGI, not through a bound port.

### IMPLEMENTED
- Deterministic route risk V1 with explainable components
- Weather sampled along a real route corridor
- Explicit input-availability reporting
- Freshness handling that refuses to score stale data
- Route-scoped authorization on the risk endpoint (IDOR closed)
- DB connection released before provider I/O

### PARTIALLY_IMPLEMENTED
- P7 routing — PRIMARY always, EMERGENCY_BACKUP only for a genuinely distinct
  corridor, FUEL_EFFICIENT never; no driver-app rendering; no scoring of routes
  against each other yet
- Weather — one provider, no fallback chain, no caching

### NOT_IMPLEMENTED
- Phase 6 weather-aware route comparison and recommendation
- Phase 7 dynamic rerouting
- Phase 8 offline corridor mode
- Phase 10 physical Android certification
- Phase 11 multilingual, Phase 12 voice
- Phases 13–15 POIs, battery/network risk, SOS

### Known risks
- The keyless fallback is the public OSRM demo server. Its policy grants no
  quality guarantee and allows withdrawal without notice. Acceptable for
  development; a live demo depending solely on it is a real risk.
- Open-Meteo is free for non-commercial use and has no contractual uptime.
- Five weather requests per assessment. Bounded, but a UI that polls this
  endpoint would multiply it — the client must not poll it like telemetry.

### Blockers
None.

### Next task
Phase 6 — weather-aware comparison of PRIMARY against a real EMERGENCY_BACKUP,
with a recommendation that states its reason in the same units it compares
(minutes and risk points), and no invented percentage claims.
