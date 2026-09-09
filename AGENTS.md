# AGENTS.md

Instructions for any AI coding agent (Claude Code, Codex, Cursor) working in this
repository.

---

## READ /docs BEFORE MODIFYING ARCHITECTURE

The `docs/` directory is the contract. Before changing anything structural, read
the document that governs it:

| Changing | Read first |
| --- | --- |
| Services, boundaries, the AI/deterministic split | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Tables, columns, enums, indexes | [docs/DATA_MODEL.md](docs/DATA_MODEL.md) |
| Endpoints, payloads, error codes | [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) |
| Anything ML | [docs/AI_MODELS.md](docs/AI_MODELS.md) |
| Auth, permissions, uploads, privacy | [docs/SECURITY.md](docs/SECURITY.md) |
| Tests | [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) |
| What to build next | [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) |

If code and docs disagree, that is a defect. Fix both in the same change — never
leave the documentation describing a system that no longer exists.

---

## NEVER

- **Commit secrets.** No credential, token or key in tracked files. `.env` is
  git-ignored; `.env.example` holds placeholders only.
- **Hardcode passwords** anywhere, including tests and fixtures.
- **Invent AI accuracy.** No metric may be stated unless it came from a real
  evaluation run recorded in [docs/AI_MODELS.md](docs/AI_MODELS.md) §7, with its
  date and whether the data was synthetic. "Roughly 90%" is a fabrication.
- **Bypass tests.** Never skip, delete, `xfail` or loosen a failing test to get a
  green build. Fix the cause. If a test is genuinely wrong, say so explicitly and
  explain why before changing it.
- **Silently modify architecture.** Structural changes are stated plainly and
  reflected in `docs/`.
- **Present fake business data as real.** No mock truck, driver, trip or fuel
  figure may render as though it came from the API. Unavailable data renders as
  "unavailable" — never `0`, never a plausible-looking placeholder. A `null` fuel
  estimate is a legitimate value with a defined meaning.
- **Replace deterministic safety logic with an LLM.** Fleet Sentinel, capacity
  validation, document enforcement, payments and emergency escalation are
  deterministic. No model may enter those decision paths.
- **Delete migrations without approval.** Migrations are history. Add a new one.
- **Make a destructive test run by default.** `tests/test_migrations.py` drops
  every table; it is gated behind `RUN_DESTRUCTIVE_MIGRATION_TESTS=1` because an
  ordinary `pytest` once wiped the development database. Any new test that can
  destroy data must be gated the same way.
- **Commit, push or deploy unless explicitly asked.**

---

## Every implementation mission follows this loop

```
PLAN -> IMPLEMENT -> TEST -> FIX -> RETEST -> VERIFY
```

1. Inspect the current state before changing it.
2. State the expected result before implementing.
3. Make the smallest safe change.
4. Run targeted tests.
5. On failure, diagnose the **root cause** — do not paper over the symptom.
6. Fix the root cause.
7. Re-run the targeted test.
8. Run adjacent regression tests.
9. Verify actual runtime behaviour, not just that tests pass.
10. Only then move on.

**Do not hide unresolved failures.** If genuinely blocked after reasonable
attempts, stop and report `BLOCKED` with what was tried.

One phase at a time. Do not begin the next phase automatically.

---

## Verification means running something

A gate is not met because the code looks right. It is met because a command was
run and produced the expected output. "Should work" is not a result.

When reporting status, distinguish:

- **Implemented** — exists, tested, and observed working at runtime.
- **Specified** — designed in `docs/`, no code.
- **Not started.**

Never label planned functionality as implemented.

---

## Project conventions

- **Backend:** start with `python run.py`, not `uvicorn` directly. On Windows the
  selector event-loop policy must be set before uvicorn creates its loop, or every
  async psycopg call fails. See `backend/app/core/event_loop.py`.
- **Database:** **Supabase PostgreSQL 17 + PostGIS 3.3 is the primary database
  for the running application.** `DATABASE_PROVIDER` selects the target and
  there is **no automatic fallback** — never add one. **Tests are the
  exception, and it is not a preference: the suite runs only against the
  isolated cluster at `127.0.0.1:55432/ner_logistics_test`**, armed by
  `.runtime/use-isolated-db.ps1` or `.sh` and enforced by `tests/db_target.py`.
  `DATABASE_PROVIDER=local` alone is not enough — `.env`'s own
  `LOCAL_DATABASE_URL` names a different local database.
- **Authorization lives in FastAPI, never in RLS.** The backend connects as
  `postgres`, which has `rolbypassrls = true` - measured, and pinned by
  `tests/test_rls_boundary.py`. RLS contains the Supabase Data API; it enforces
  nothing on the path clients actually use. Add permissions to
  `app/core/permissions.py` and gate routes with `require_permission(...)`.
  Never write `if user.role == ...` in a route.
- **Never trust client-supplied identity.** Role and actor come from the signed
  token and are re-read from the database on every request, so a demotion or
  deactivation takes effect immediately rather than at token expiry.
- **Driver-scoped routes take no id.** `require_current_driver()` resolves the
  driver from the token (`users.id -> drivers.user_id`). Never add a `driver_id`
  path or body parameter that selects whose data is returned - that is the shape
  of every IDOR.
- **Row Level Security on every table, always.** Supabase publishes `public`
  through its Data API, so a table created without
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is readable by anyone holding the
  anon key — bypassing FastAPI entirely. Every migration that creates a table
  must enable it.
- **Clients never hold a Supabase credential.** Manager web and driver app talk
  only to FastAPI. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS completely and belongs
  in `backend/.env` alone, if ever.
- **Geography, not geometry.** Spatial columns use `geography(...,4326)` so
  distances are metres. See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) §1.
- **Money** is `NUMERIC`/`Decimal`, never float. Serialised as a string.
- **Timestamps** are `TIMESTAMPTZ` in UTC. Safety timers use server time
  (`received_at`), never device time.
- **Client env vars:** `VITE_*` and `EXPO_PUBLIC_*` are inlined into client
  bundles and are therefore public. Never put a secret behind those prefixes.
- **SQL** is always parameterised. No f-string SQL, especially in PostGIS
  expressions taking client coordinates.

## Current state

P0–P6 complete. The full operational loop is closed and certified end to end: a
manager creates a driver, truck and assignment; the driver signs in and verifies
the physical truck; the manager plans a shipment and its trip **atomically** and
dispatches it; the driver starts it and the phone streams GPS; the manager sees
the truck LIVE on the fleet map with its observed track; the driver works the
stops in order and completes; the manager closes.

Measured 2026-08-30, not estimated:

| Suite | Result |
| --- | --- |
| Backend (`pytest`) | 415 passed, 5 skipped, 0 failed — 420 collected, 20m57s |
| Manager web (Vitest) | 38 passed |
| Driver app (Vitest) | 25 passed |
| End-to-end fleet certification | 44 checks passed, 0 failed |

**GPS exists.** Ingestion, idempotency, freshness, the driver tracking engine and
the manager fleet map are implemented.

**Routing partly exists — uncommitted, P7 exit gate NOT met.** A provider
abstraction with a primary→fallback chain, an OSRM provider verified against the
live service (305.39 km Guwahati→Jorhat), persistence into `trip_routes` with
supersession, and a manager UI drawing the planned route distinctly from the
observed track. It is **not** three routes: PRIMARY always, EMERGENCY_BACKUP only
for a genuinely different corridor, **FUEL_EFFICIENT never** — that needs a fuel
model. No ETA, no elevation, no driver-app rendering, no scoring.

**Rate limiting partly exists — uncommitted.** Authentication endpoints only.

**Route risk V1 exists — uncommitted.** Weather is sampled at five points along a
planned route and scored by a deterministic weighted rule with published constants
(`app/domain/route_risk.py`). It is **not** a model: no confidence, no version, no
prediction, and a test keeps those fields absent. It reports the datasets it lacks
(landslide, road quality, truck restrictions, fuel) rather than hiding them.

**Route eligibility and audited review exist — uncommitted (LS-4..LS-11).**
Eligibility is a REFUSAL decided separately from the score
(`app/domain/route_eligibility.py`): a closed road is REJECTED no matter how it
ranks. With no landslide source connected every route is UNKNOWN and therefore
REQUIRES_REVIEW, so an **AUTHORISED_REVIEWER** (a distinct role holding
`route:review_authorize` and deliberately NOT `route:select`) may authorise ONE
selection, bound to the route and an evidence digest, single-use, 30 minutes,
consumed atomically inside the selection's transaction — migration 0007,
applied to the isolated test cluster ONLY.

It can never reach REJECTED or NOT_ASSESSED, and it does not change what the
evidence says: after consumption the route still reports
`landslide: NOT_AVAILABLE`. Never describe it as marking a route safe or
verified.

What does **not** exist at all: ETA, fuel AI, road incidents, automatic
rerouting, Fleet Sentinel, SOS, payments, payroll, OCR, and rate limiting outside
auth. Physical Android GPS capture is **NOT CERTIFIED** — it has never been run
on a real handset.

See [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md).

**Arm the isolated database before running the backend suite.**

```
PowerShell:  . .\.runtime\use-isolated-db.ps1
Bash:        source .runtime/use-isolated-db.sh
```

A plain `pytest` resolves `backend/.env`, which is `DATABASE_PROVIDER=supabase`
— the shared project. That is not theoretical: three unarmed runs executed
105 tests against it, and the autouse teardown deleted by global prefix on every
one of them. See
[docs/INCIDENT_2026-09-06_SHARED_DB_WRITE.md](docs/INCIDENT_2026-09-06_SHARED_DB_WRITE.md).

`tests/db_target.py` now refuses any target but
`127.0.0.1:55432/ner_logistics_test`, before a socket is opened, with no
environment-variable override. Forgetting to arm is a clear exit-3 refusal
rather than a silent write somewhere else.

**One backend pytest run at a time.** Enforced by a session advisory lock.
Cleanup is now id-scoped so concurrent runs no longer delete each other's rows,
but several tests still assume they are the only writer — see
[docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md).
