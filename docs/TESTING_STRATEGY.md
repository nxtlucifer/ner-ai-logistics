# Testing Strategy

**Status:** the backend test suite and both frontend typecheck/build pipelines are running as of
Mission 1. The layers below describe the target; §11 states exactly what exists today.

---

## 0. Principles

1. **Safety logic gets the highest coverage.** Fleet Sentinel and capacity validation are tested to
   a standard the rest of the codebase is not held to.
2. **Tests run against real PostgreSQL + PostGIS, never SQLite.** Half of what we test is
   spatial and enum-constrained; a substituted database tests a different system.
   **The database is the isolated local cluster at `127.0.0.1:55432/ner_logistics_test`
   and nothing else.** This principle used to read "the real configured database -
   Supabase by default", which is how a suite that deletes rows came to run against a
   shared project. See [the incident record](INCIDENT_2026-09-06_SHARED_DB_WRITE.md).
   The target is now enforced in `tests/db_target.py`, not merely documented.
3. **A test that needs a live third-party API is not a test.** External providers are stubbed at
   the interface boundary.
4. **No test asserts a model's accuracy.** ML tests assert the *pipeline*, the *fallbacks*, and
   *baseline comparison*, never a number.
5. **Deterministic time.** Sentinel timing is tested by injecting a clock, never by sleeping.

---

## 1. Unit Tests (`pytest`)

Pure logic, no I/O, fast enough to run on save.

Priority targets:
- Capacity validation — at, just under, just over, zero, negative, null capacity.
- Trip state machine — every legal transition, and a table of every illegal one.
- Document expiry classification across boundary dates.
- Fuel baseline formula.
- Sentinel threshold arithmetic (distance, elapsed time, deadline).
- Payroll arithmetic — advances, deductions, rounding to paise.
- Serialisation of `Decimal` money and the lat/lon vs GeoJSON `[lon,lat]` boundary.

Target: 90%+ on `app/domain/`. Coverage elsewhere is not a goal in itself.

---

## 2. Integration Tests

Multiple components with a real database, no HTTP.

- Assignment: creating a new active assignment ends the previous one **atomically**, and the
  partial unique index rejects a concurrent second active assignment.
- Reroute: incident created → affected trips identified via `ST_DWithin` → new routes inserted →
  old marked `SUPERSEDED` → alerts raised.
- GPS ingest → Sentinel evaluation → emergency creation, as one flow.
- Audit rows are written for every consequential mutation (asserted generically, so a new mutation
  without an audit entry fails).

---

## 3. API Tests (`pytest` + `httpx.AsyncClient`)

Every endpoint, over real HTTP against a real database.

Per endpoint: happy path; each documented error code; **authorization matrix**; input validation
(out-of-range lat/lon, negative weights, invalid enums, oversized payloads).

The authorization matrix is a parameterised test over *(role × endpoint × own/other resource)* that
must be extended whenever an endpoint is added. Object-level authorization — a driver requesting
another driver's trip — is the specific case most likely to regress, so it is generated rather than
hand-written.

Also asserted: `POST /api/gps/batch` is idempotent (same `device_fix_id` twice → one row,
`duplicates_ignored: 1`), and `/health` returns 200 with the database **stopped**, while `/ready`
returns 503.

---

## 4. Database Tests

Constraints must be proven at the database level, not just in Python:

- `CHECK (current_load_kg <= max_capacity_kg)` rejects a direct SQL overload.
- `uq_active_assignment_driver` / `_truck` reject a second active row.
- **`uq_open_emergency_per_trip` rejects a duplicate open emergency** — the constraint that stops a
  monitor bug from spamming a driver.
- PostGIS behaviour: `ST_DWithin` on `geography` returns metres; a 5 km radius near Guwahati matches
  correctly in both latitude and longitude directions (the specific bug that using `geometry` would
  cause).
- Every migration is tested `upgrade` → `downgrade` → `upgrade`.

> **⚠ The suite may only ever reach the isolated cluster, and it deletes only
> what it created.**
>
> Both of those were once true by convention and are now checked.
>
> **Target.** `tests/db_target.py` registers one permitted database —
> `postgresql+psycopg://127.0.0.1:55432/ner_logistics_test` — and vetoes every
> connection that is not it, on SQLAlchemy's `do_connect` event. That is the
> point where the dialect would otherwise call the driver, so a refused target
> opens no socket, and it covers every engine in the process: the async
> application engine, the synchronous one holding the advisory lock, the `db`
> fixture's, and the one `test_migrations.py` builds from a *different* URL.
> `DATABASE_PROVIDER=local` is not consulted and is not sufficient —
> `backend/.env` sets `LOCAL_DATABASE_URL` to `localhost:5432/ner_logistics`,
> which is local, is a different database, and would be written to just as
> readily. There is no environment-variable override; a future authorised remote
> target would be added to `ALLOWED_TARGETS` by a human editing that file.
> Arm a shell with `.runtime/use-isolated-db.ps1` (dot-sourced) or
> `source .runtime/use-isolated-db.sh`; an unarmed run exits 3 before any test
> executes.
>
> **Ownership.** `factories.OWNED` records the id of every row the run creates,
> and `factories.cleanup` deletes exactly those. It no longer deletes by prefix,
> so a concurrent run's fixtures, rows that predate this run, and real records
> that happen to match a pattern are all unreachable from it. Ids are recorded by
> an `after_flush` listener rather than by each factory, because several tests
> create their trips by POSTing to `/api/trips` — those rows are made by the
> application's own session and no factory ever sees them.
>
> Both properties are tested, and tested as behaviour rather than as helper
> return values: `tests/test_db_target_guard.py` builds real engines with
> `psycopg.connect` replaced by a tripwire, so a refusal that reached the driver
> fails; `tests/test_cleanup_ownership.py` writes another run's whole graph with
> raw SQL and asserts it survives.
>
> **Still run one backend suite at a time.** `exclusive_suite_lock` takes a
> PostgreSQL session advisory lock on a dedicated `NullPool` connection and
> refuses a second process at startup. The reason has changed: it used to be the
> only thing standing between two runs and mutual deletion, and now that cleanup
> is id-scoped it is about the *results* — several tests assert on counts and
> locks while assuming they are the only writer. Losing the lock mid-run aborts
> rather than continuing, because a run that stopped being alone is no longer
> reporting an isolated result.
>
> `scripts/certify_fleet.py` remains safe to run alongside; its namespaces are
> disjoint from the factories'.
>
> This replaces an earlier note that described the prefix-wide deletes as
> acceptable within one serial run and deferred per-run namespacing because truck
> registrations had no room to encode a run id. Recording ids sidesteps the
> format question entirely. What the deferral actually cost is in
> [the incident record](INCIDENT_2026-09-06_SHARED_DB_WRITE.md).

> **⚠ Test accounts are retained but deactivated, and the suite password is
> generated per run.**
>
> Cleanup cannot delete users: `audit_logs.actor_user_id` is RESTRICT (0004), so
> anyone who has done anything auditable — including one failed login — is pinned
> by their own trail. That is the intended production behaviour and the suite
> does not weaken it.
>
> It previously left those accounts **active**, with a password that was a
> literal committed to this repository. Retention and usability had been
> conflated. An audit of the shared development project found **3,670 live
> accounts, 13 of them ADMIN**, that still authenticated with it and received a
> full permission set — while the code comment beside them read "they are inert".
> Harmless against a localhost bind; not harmless the moment the backend is
> exposed on a LAN so a physical handset can reach it, which P7 requires.
>
> Two changes, both proven by `tests/test_test_account_hygiene.py`:
>
> - `TEST_PASSWORD = secrets.token_urlsafe(32)`, generated once per process,
>   never committed, never logged. `scripts/certify_fleet.py` already worked this
>   way; the suite now matches it.
> - `factories.cleanup()` deletes refresh tokens and then sets `is_active = false`
>   on the accounts it cannot delete. The audit trail keeps its actor; the actor
>   keeps no way in.
>
> **Ownership is proven, never guessed.** The predicate is exactly the two
> domains this repository generates — `@p3test.invalid` and `@p5cert.invalid`,
> both RFC 6761 `.invalid`. Never a heuristic about names, roles or dates. Four
> cases pin the boundary: `@ner.local` development accounts, unrelated `.invalid`
> domains, unowned addresses, and **NULL-email** rows — drivers authenticate by
> phone, and `email LIKE '…'` evaluates to NULL rather than false for them, so
> they fall outside the `WHERE` by three-valued logic rather than by explicit
> exclusion. A future rewrite using `NOT IN` or a negation would behave
> differently and silently, which is why that case is tested rather than assumed.

> **⚠ These migration tests are destructive and opt-in.** `alembic downgrade base`
> issues `DROP TABLE ... CASCADE` on every domain table, so against the shared
> Supabase development project it destroys all data — manager accounts, drivers,
> trucks and any demo seed. That happened once during P3: an ordinary `pytest`
> run silently emptied the development database.
>
> **Two interlocks guard them, not one.** The opt-in flag alone is not enough:
> setting it while `.env` still points at Supabase — the obvious way to try
> running them locally — would destroy the shared project, and the flag would
> have *felt* like the safety check. So the migration target must **also** be a
> local host. Both must hold; either one missing skips, and the skip reason says
> which:
>
> ```bash
> # Skipped: not opted in.
> pytest tests/test_migrations.py
>
> # REFUSED: opted in, but the target is Supabase.
> RUN_DESTRUCTIVE_MIGRATION_TESTS=1 pytest tests/test_migrations.py
>
> # Runs: opted in, against a database you are willing to empty.
> docker compose up -d db
> DATABASE_PROVIDER=local RUN_DESTRUCTIVE_MIGRATION_TESTS=1 >   pytest tests/test_migrations.py
> ```
>
> **Skipped-by-default is the right local behaviour and the wrong permanent
> one.** A migration that cannot be rolled back cannot be safely deployed, and
> that property has to be checked *somewhere*. Since P5 it is checked in CI:
> `.github/workflows/migrations.yml` stands up a disposable PostGIS container,
> points `DATABASE_PROVIDER=local` at it, and runs exactly the tests that are
> skipped everywhere else — on any change under `backend/alembic/` or
> `backend/app/models/`, and weekly regardless. It then re-runs the drift check,
> because a downgrade that "works" but rebuilds a *different* schema is not a
> working downgrade.
>
> Nothing in that job can reach Supabase: in `local` mode the config validator
> rejects a non-local host outright, so even a leaked production URL in the
> environment could not be migrated by it.
>
> A non-destructive `test_database_is_at_head` runs on every ordinary invocation
> and catches the common case those tests would otherwise be relied on for — a
> migration written but never applied.

---

## 5. Frontend Tests (Vitest + Testing Library)

- `tsc --noEmit` and a production build gate every change.

### What the frontend suites actually cover (P6)

**Manager** (`manager-web`, 38 tests): refresh-token coordination across tabs;
the fleet polling loop's discipline — one request in flight, backoff on failure,
abort on unmount, last-good data retained through a blip; and the fleet screen's
states, filters, search, selection and detail panel. MapLibre needs WebGL, which
jsdom does not have, so the map component is substituted with a stand-in that
**records what it was asked to plot** — which is the thing under test.

The load-bearing assertion there is a negative one: a truck that has never
reported a position is listed and counted but **never plotted**. Inventing a
coordinate for it would put a truck on a dispatcher's screen somewhere nobody
observed it.

**Driver** (`driver-app`, 25 tests): the location tracking engine. Its logic was
extracted out of the React hook into `src/tracking/tracker.ts` — framework-free,
with the Expo sensor reached only through a three-call adapter — precisely so it
could be tested. A hook that owns its own timers, subscriptions and network
calls can only be exercised with a simulator attached, which in practice means
the bounded queue and the backoff are never exercised at all, and those are the
parts that must not be wrong on a truck that has lost signal.

Time is injected rather than slept through, so the backoff sequence is checked
deterministically. Only the sensor is stood in for; the cadence rule, queue
bounds and retry behaviour under test are the real ones.
- Component tests for state rendering — especially that a `null` fuel estimate renders
  "unavailable" and **never** `0`, `—`, or a fabricated value. This is a correctness test, not a
  cosmetic one: it enforces the honesty rule from [AI_MODELS.md](AI_MODELS.md).
- Backend-offline states render as offline, not as empty success.
- MSW stubs the API; no test hits a live backend.

---

## 6. Mobile Tests (Jest + React Native Testing Library)

- `tsc --noEmit` gates every change.
- **Offline queue** is the priority: fixes buffer when offline, flush in order on reconnect, survive
  app restart, and never duplicate after an ack timeout.
- The Sentinel check-in screen renders all ten response options and posts the correct enum.
- Token storage uses `expo-secure-store` — asserted, since a regression to `AsyncStorage` is silent.
- Detox E2E only if time permits; not a MUST.

---

## 7. End-to-End (Playwright)

One scenario matters most: **the demo chain in [DEMO_PLAN.md](DEMO_PLAN.md), automated end to end.**
Manager creates shipment → assigns → dispatches → simulated GPS → incident → reroute → alerts →
stationary → check → no response → SOS briefing.

If that test passes, the demo works. It runs against a real backend and real database with the GPS
replay harness driving the ingestion API — the backend cannot distinguish it from a real phone.

Also: capacity rejection surfaces a clear message in the UI; login/logout/refresh for both roles.

---

## 8. ML Tests

What is asserted:
- Feature engineering is deterministic and handles nulls without silent imputation.
- The trained model **beats its stated baseline** on the held-out set — the assertion is
  `model_mae < baseline_mae`, not an absolute threshold.
- Serving contract: output shape, `source` and `model_version` populated, latency budget.
- **Fallbacks, exhaustively** — missing model file, inference exception, timeout, out-of-range
  prediction, missing feature. Each must return the baseline or `null`, never a fabricated number.
- Training is reproducible from a fixed seed.

What is never asserted: an absolute accuracy figure. See [AI_MODELS.md](AI_MODELS.md) §0.

---

## 9. Failure Injection

The property from [ARCHITECTURE.md](ARCHITECTURE.md) §8 — *the platform works without ML* — is only
real if tested:

| Injected failure | Required behaviour |
| --- | --- |
| ML service entirely down | Trips dispatch, GPS ingests, reroute works, **SOS escalates**. Only estimates show as unavailable. |
| Routing provider 503 | Existing trips continue; new route requests return `503 ROUTING_UNAVAILABLE`; no crash |
| Weather API timeout | Last-known-good served with staleness marked |
| Database connection lost | `/health` 200, `/ready` 503, requests fail cleanly with no partial writes |
| WebSocket disconnected | Clients fall back to polling and reconcile on reconnect |
| Driver offline 2 hours | Fixes buffer, flush in order, deduplicate; `COMMS_LOST` raised, **not** SOS |
| Scheduler stops | Health check detects it and alarms |
| Clock skew on device (±6 h) | Safety timers unaffected — they use `received_at` |

The clock-skew and offline-flush cases are the ones most likely to break silently in the field.

---

## 10. Security Tests

- Authorization matrix (§3) is the primary control.
- Token tampering: `alg: none`, wrong signature, expired, another user's token.
- Upload validation: oversized, wrong magic bytes, `.jpg` containing a script, path traversal in
  filename, EXIF GPS stripped after re-encode.
- SQL injection attempts through string parameters, including PostGIS query paths.
- Rate limits return 429 — and `POST /api/emergencies/{id}/respond` is confirmed **not** limited
  into failure.
- Secret scanning in CI; `pip-audit` and `npm audit`.
- Grep assertion that no `VITE_*`/`EXPO_PUBLIC_*` variable name matches a secret-like pattern.

---

## 11. What Exists Today

| Layer | State |
| --- | --- |
| Backend unit + API tests for `/health`, `/ready` (DB up and DB down) | **Running** |
| Config loading and `SECRET_KEY` enforcement tests | **Running** |
| **Provider selection: Supabase default, no silent local fallback** | **Running** |
| **Credential redaction in logs and in `/ready` output** | **Running** |
| **Row Level Security enabled on every table** | **Running** |
| **Schema drift: ORM vs database via `compare_metadata`** | **Running** |
| **FK, CHECK and partial-unique constraints (raw SQL)** | **Running** |
| **Append-only `audit_logs` trigger** | **Running** |
| **Derived `shipments.total_weight_kg` trigger** | **Running** |
| **Geospatial: SRID, metre distance, isotropic `ST_DWithin`, GIST indexes** | **Running** |
| **Trip state machine, including prohibited transitions** | **Running** |
| **Pydantic contracts reject server-managed fields** | **Running** |
| **Authorization matrix: role x endpoint x own/other** | **Running** |
| **Privilege escalation: body role, header role, actor id, demotion mid-token** | **Running** |
| **Token hardening: alg:none, wrong key, expired, refresh-as-access** | **Running** |
| **Refresh rotation and reuse detection, cookie and body paths** | **Running** |
| **Assignment concurrency under simultaneous requests** | **Running** |
| **Audit coverage, scrubbing and immutability** | **Running** |
| **RLS boundary: backend role bypasses RLS (pinned)** | **Running** |
| **Driver identity binding and fail-closed cases** | **Running** |
| **IDOR: a driver cannot read or verify another driver's assignment** | **Running** |
| **Verification semantics: idempotent retry, stale screen, ended, superseded** | **Running** |
| **Concurrent verification from multiple devices** | **Running** |
| **Manager frontend: refresh single-flight and cross-tab lock (Vitest)** | **Running** |
| **Trip execution: start gates, ordered stops, idempotent retries, concurrency** | **Running** |
| **GPS telemetry: idempotency, ordering, freshness, anomaly flags** | **Running** |
| **Atomic shipment+trip planning: no orphan on refusal, no duplicate on retry** | **Running** |
| **Suite isolation: advisory lock refuses a second concurrent pytest run** | **Running** |
| **Manager frontend component tests (FleetPage, TripsPage)** | **Running** — 18 of the 38 |
| **Driver tracking engine (bounded queue, backoff, cadence)** | **Running** — 25 tests |
| Driver app *screen* component tests | **Not implemented** — screens certified end to end against the live API |
| PostGIS availability test against the real database | **Running** |
| Migration upgrade/downgrade test | **Running** |
| Manager web `tsc --noEmit` + production build | **Running** |
| Driver app `tsc --noEmit` | **Running** |
| Everything else above | **Not implemented** |

## 12. Commands

```bash
# Arm the isolated target FIRST. An unarmed run is refused (exit 3); it does not
# fall back to backend/.env, which points at shared Supabase.
source .runtime/use-isolated-db.sh       # Bash
# PowerShell: dot-source .runtime\use-isolated-db.ps1

cd backend && pytest -v                 # backend suite
cd backend && pytest --cov=app          # with coverage
cd manager-web && npm run typecheck     # tsc --noEmit
cd manager-web && npm run test          # Vitest
cd manager-web && npm run build         # production build
cd driver-app && npm run typecheck      # tsc --noEmit
cd driver-app && npm run test           # Vitest
```

### Standing the isolated cluster up on Linux

`.runtime/` is git-ignored, so a fresh checkout has no armed shell and no
cluster. On Windows that is `scripts\db-start.ps1` plus the PowerShell arming
script. The Linux equivalent, which is what CI and a cloud session use:

```bash
# PostgreSQL 16 + PostGIS, one disposable cluster, loopback only.
apt-get install -y postgresql-16 postgresql-16-postgis-3
mkdir -p .runtime && chown -R postgres:postgres .runtime
runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D .runtime/pgdata -U ner --auth=trust
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_ctl -D .runtime/pgdata -l .runtime/pg.log \
  -o "-p 55432 -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off" start
psql -h 127.0.0.1 -p 55432 -U ner -d postgres -c "CREATE DATABASE ner_logistics_test"
psql -h 127.0.0.1 -p 55432 -U ner -d ner_logistics_test -c "CREATE EXTENSION postgis"
cd backend && python -m alembic upgrade head
```

`.runtime/use-isolated-db.sh` must export `DATABASE_PROVIDER=local`,
`LOCAL_DATABASE_URL` and `MIGRATION_DATABASE_URL` pointing at
`postgresql+psycopg://ner@127.0.0.1:55432/ner_logistics_test` (the one target
`tests/db_target.py` permits), `DB_REQUIRE_SSL=false`, a non-placeholder
`SECRET_KEY`, and the provider switches off so no test reaches the network:
`WEATHER_ENABLED`, `TERRAIN_ENABLED`, `FLOOD_ENABLED`, `WARNINGS_ENABLED`,
`ROUTE_WATCH_ENABLED`, `SENTINEL_SCHEDULER_ENABLED` all `false`.

**Leave `APP_ENV` at `development`.** Setting it to `test` makes the refresh
cookie `secure`, which an httpx test client over plain HTTP will not send back,
and three refresh-rotation tests fail for a reason that has nothing to do with
what they are testing.

`tests/test_select_route_rpc.py` additionally needs a superuser role and
`.runtime/pgpass.txt` holding its password; without them its 18 cases skip with
a stated reason rather than passing silently.

### Resilience suites *(added by the connectivity/offline mission)*

| Suite | Covers |
| --- | --- |
| `backend/tests/test_connectivity.py` | The evidence floor, every segment state, clock clamping, journey counting, gap measurement, windowing, and the labelled simulation |
| `backend/tests/test_device_events.py` | Offline replay: ordering, the two clocks, triple replay of an SOS, a poison event in front of an SOS, the acceptance window at both ends, every bound |
| `backend/tests/test_offline_package.py` | The v2 trip kit and its per-dataset freshness manifest |
| `backend/tests/test_route_risk.py` | The connectivity factor: a measured good corridor beats an unmeasured one; a dead zone costs more than a weak zone of the same length; not knowing stays cheaper than knowing it is bad |
| `backend/tests/test_telemetry.py` | An incident does not stop tracking; delivery does |
| `driver-app/src/events/eventQueue.test.ts` | Priority, overflow, settlement, backoff, process death, a disk that will not write, a truncated file |
| `driver-app/src/offline/prefetch.test.ts` | Lead distance from speed/size/connection/outage, idempotent triggering, per-dataset ageing on the device clock |
| `driver-app/src/offline/useTripKit.test.ts` | Reading connectivity segments; which refresh reasons this hook owns |
| `manager-web/src/components/TripRouteReview.test.tsx` | Unknown signal is reported as unknown, never as coverage |

## 13. CI Gate (when a repository is initialised)

Backend tests, both typechecks, both builds, `pip-audit`, `npm audit`, and secret scanning must
pass. `pytest` runs against a PostGIS service container so the spatial and constraint tests are
real. No merge on red — and per [AGENTS.md](../AGENTS.md), tests are never skipped to make a
build green.
