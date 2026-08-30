# Development Roadmap

Sequential phases. **One phase at a time, one agent at a time, on one laptop.** A phase is not
started until the previous phase's exit gate passes.

Deadline: **19 September**. P0 and P1 are complete as of Mission 1.

---

## How a Phase Works

Every phase follows the same loop, per [AGENTS.md](../AGENTS.md):

```
PLAN -> IMPLEMENT -> TEST -> FIX -> RETEST -> VERIFY
```

The **exit gate** is a set of statements that must be objectively true, verified by running
something — not by inspecting code and forming an opinion. A phase whose gate has not been run has
not passed.

---

## P0 — Specification ✅ COMPLETE

**Objective** Fix the contracts before writing code.
**Inputs** Problem statement SIH26002.
**Implementation** Ten documents in `docs/`.
**Tests** Internal consistency: every enum in [DATA_MODEL.md](DATA_MODEL.md) is referenced by
[API_CONTRACTS.md](API_CONTRACTS.md); every MUST HAVE in [MVP_SCOPE.md](MVP_SCOPE.md) appears in
[DEMO_PLAN.md](DEMO_PLAN.md).
**Exit gate** ✅ All ten documents exist and agree with each other.

---

## P1 — Foundation ✅ COMPLETE

**Objective** Prove all four components start and connect.
**Implementation** FastAPI skeleton with config loading, `/health`, `/ready`; PostgreSQL 18 +
PostGIS 3.6 in WSL2; Alembic bootstrap migration; React/Vite/Tailwind manager shell; Expo driver
shell. Both clients display real backend state.
**Tests** Backend `pytest` suite; `tsc --noEmit` and production build for manager web; `tsc --noEmit`
for driver app.
**Exit gate** ✅ Mission 1 gates 1–13 (see [README.md](../README.md)).

---

## P1.5 — Supabase Migration (COMPLETE)

**Objective** Move the primary database from local WSL2 PostgreSQL to Supabase.
**Implementation** `DATABASE_PROVIDER` selection with no silent fallback;
session-pooler connection with required TLS; Alembic retargeted; `/ready` reports
the provider; PostGIS enabled on Supabase; RLS on every table; credential
redaction throughout.
**Exit gate** Supabase primary, proven by executed query; local WSL2 preserved as
explicit opt-in; normal startup no longer needs `scripts\db-start.ps1`.

---

## P2 — Data Model ✅ COMPLETE

> **Scope changed from the original plan.** This phase originally stopped at identity and fleet,
> deferring trips and GPS to P6. The revised delivery sequence (P3 manager CRUD → P4 driver
> identity → P5 live GPS) contains no later schema phase, so P5 would have had no tables to build
> on. P2 therefore lays down the whole operational spine in one migration. Recorded here rather
> than changed silently, per [AGENTS.md](../AGENTS.md).

**Objective** Implement the canonical domain schema.
**Inputs** [DATA_MODEL.md](DATA_MODEL.md) §2–13.
**Implementation** 17 enum types; 15 tables — `users`, `drivers`, `driver_documents`, `trucks`,
`truck_documents`, `truck_maintenance`, `driver_truck_assignments`, `shipments`, `cargo_items`,
`trips`, `trip_stops`, `trip_routes`, `trip_events`, `gps_points`, `audit_logs`. SQLAlchemy
models, Pydantic contracts, trip state machine, Alembic migration `0002_core_domain`.

Still **not** implemented: payments, payroll, deliveries, alerts, emergencies, road incidents and
weather. Each arrives with the phase that uses it.

**Tests** Migration up/down/up on a scratch database; the `current_load_kg <= max_capacity_kg`
CHECK rejects direct SQL; both partial unique assignment indexes reject a second active row;
`audit_logs` rejects UPDATE and DELETE from the application role; **every new table has
RLS enabled** - on Supabase a table without it is world-readable through the Data API.
**Exit gate** ✅ Migration upgrades, downgrades and re-upgrades cleanly against Supabase; ORM and
database schema proven identical by `compare_metadata`; every constraint proven by a
failing-write test; RLS enabled on all 15 tables with zero policies.

A development seed script is **not** included and moves to P3, where the CRUD endpoints that would
populate it exist.

---

## P3 — Auth, RBAC and Manager API ✅ COMPLETE

**Objective** The first production service layer over the P2 schema.
**Implementation** Local JWT auth behind a swappable `TokenVerifier`; Argon2id;
opaque rotating refresh tokens with reuse detection (migration 0003);
centralised permission-based RBAC; service layer for drivers, trucks and
assignments; audit logging on every mutation; uniform error envelope; manager UI
for login, drivers, trucks and assignments.
**Tests** 268 backend tests, including the authorization matrix, privilege
escalation attempts, object-level scoping, token forgery, assignment
concurrency, and audit scrubbing.
**Exit gate** ✅ P3 gates 1–26.

Migration 0004 changed `audit_logs.actor_user_id` to RESTRICT — see
[DATA_MODEL.md](DATA_MODEL.md) and [SECURITY.md](SECURITY.md) §10.

---

## P4 — Driver Identity + Assignment Verification ✅ COMPLETE

**Objective** Close the manager-to-driver loop: a driver signs in, sees their own
assignment, and confirms the physical truck.

**Implementation** `require_current_driver()` resolves identity server-side from
the token (`users.id -> drivers.user_id`); `/api/driver/me`,
`/api/driver/me/assignment` and `/api/driver/me/assignment/verify`; driver login
in the Expo app with `expo-secure-store` token storage; verification screen with
every async state; manager sees VERIFIED / NEEDS REVIEW / AWAITING DRIVER.
Cross-tab refresh coordination via the Web Locks API.

**Tests** 35 driver-identity, IDOR and alias-parity tests, plus 12 Vitest tests
covering refresh coordination. Certified end to end against Supabase.

**Exit gate** ✅ P4 gates 1–30.

**Deferred from the old P4 (manager dashboard):** driver and truck *detail*
pages, edit forms, document upload with expiry status, and a manager review
queue for flagged verifications. None blocks the demo chain; they arrive
alongside the phases that need them.

---

## P5 — Live GPS + Trip Execution ✅ COMPLETE

**Objective** Turn the authenticated driver app into a real trip-execution client:
manager dispatches → driver starts → position flows → stops progress → manager
sees it → driver completes.

**Implementation** Manager planning (`/api/shipments`, `/api/trips` with create,
dispatch, cancel, close) and driver execution (`/api/driver/me/trip` with start,
stop arrive/complete, complete) over the **existing** P2 schema — no new tables.
Position ingestion at `POST /api/driver/me/location`, idempotent on
`(trip_id, device_fix_id)` via the unique index and `ON CONFLICT DO NOTHING`.
Manager visibility at `/api/fleet/active` and `/api/trips/{id}/track`, with
server-decided freshness labels. Foreground `expo-location` tracking with a
server-supplied cadence, a bounded queue and exponential backoff.

**Deliberately not built.** No WebSocket broadcast: correct bounded polling is
indistinguishable to a dispatcher, and a realtime subsystem would carry its own
auth, reconnection and backpressure problems for no visible gain. No MapLibre map
— that is P6, and a coordinate table that is honest beats a map that is
decorative. No background location task and no SQLite buffer: foreground tracking
with an in-memory bounded queue is the smallest thing that honours
[SECURITY.md](SECURITY.md) §3, and a background permission we have no use for is
a worse consent conversation and a larger thing to get wrong.

**Defects found and fixed in this phase**
- `trip_events.location` was NOT NULL in the database although migration 0002 and
  the model both declared it nullable, so **no trip event could be recorded at
  all**. Cause: one shared GeoAlchemy2 `Geography` instance across six columns,
  which its column listener mutates — the first `nullable=False` column poisoned
  the shared type for every later one. Invisible to the drift check because the
  models were wrong identically. Fixed by migration 0005 and by making the type a
  per-column factory.
- The manager fleet query used `DISTINCT ON`, which read **every point of every
  active trip** on each poll — 30,000 rows and 60–400 ms at 25 trips, degrading
  with track length. Replaced with a LATERAL per-trip index lookup: 25 rows,
  0.8 ms, and O(active trips) rather than O(total points).

**Tests** 78 new backend tests across trip execution and telemetry, plus a 37-check
end-to-end certification script (`scripts/certify_p5.py`) that drives the whole
loop over real HTTP against Supabase and cleans up after itself.

**Exit gate** ✅ Manager → driver → trip → position → stops → completion, proven
end to end. Physical-device GPS is **NOT CERTIFIED** — see the native device
status in the P5 report; Expo web is certified, native is not.

---

## P6 — Map + Fleet Operations Dashboard ✅ COMPLETE

**Objective** Make the fleet visible. P5 got position flowing from a phone into
PostGIS and out through an API; P6 is the screen a dispatcher actually works
from.

**Implementation** MapLibre GL JS over OpenStreetMap raster tiles - no API key,
no billing account, no vendor lock. One marker per active trip, coloured by the
**server's** freshness label. A selection panel carrying only real API values:
driver, truck, cargo, load, origin, destination, last contact, speed, GPS
accuracy. Summary counts, freshness filters and search over registration, driver
and trip code. The observed GPS breadcrumb rendered as a polyline. One polling
loop (`useFleetPoll`) feeds map, list, counts and filters, so they cannot
disagree with each other.

**Two rules the screen keeps.** A truck that has never reported is listed and
counted but **never plotted** - there is no coordinate for it, and putting one
anywhere would show a dispatcher a truck in a place nobody observed it. And the
camera moves only when the operator asks; a map that re-centres every ten
seconds cannot be worked with.

**Deliberately not built.** No ETA - routing does not exist until P7, and a
number with nothing behind it is worse than a blank. No decorative "Reroute",
"Weather" or "SOS" controls. The breadcrumb is labelled *Observed trip track*,
never *route*.

**Defects found and fixed in this phase** (see the P6 report for the full list):
two lost-idempotency bugs in P5 trip execution, both on a driver's LAST action at
a stop and at a trip; and the two findings the older P3 audit raised - the web
refresh token was still being handed to page JavaScript, and the
"one current assignment" invariant still excluded `PENDING_VERIFICATION`, which
P5 had turned from untidy into unsafe.

**Tests** 33 manager Vitest tests (fleet states, the never-plotted rule,
filters, search, selection, polling discipline), 25 driver tracker tests, and
the fleet certification extended to 43 checks.

**Exit gate** ✅ A manager sees real trucks at real coordinates, with honest
freshness. Physical-device GPS remains **NOT CERTIFIED** - no Android SDK,
emulator or handset is available on this machine.

---

## P7 — Routing

**Objective** Three route options per trip.
**Implementation** `RoutingProvider` interface first, then a concrete provider; `trip_routes`;
elevation enrichment for gradient; route selection and persistence; route rendering on both clients.

**This phase carries the largest schedule risk** ([MVP_SCOPE.md](MVP_SCOPE.md)). Timebox the
provider decision: if self-hosted Valhalla is not working within the allotted time, fall back to a
hosted provider or pre-computed corridor routes and move on. The interface makes this reversible.

**Tests** Provider stubbed at the interface for all route tests; geometry persists and round-trips
through PostGIS; provider 503 returns `503 ROUTING_UNAVAILABLE` without crashing.
**Exit gate** Three routes returned with distance, duration and geometry, rendered on both clients.
Provider is swappable by configuration — proven by running the suite against the stub.

---

## P8 — Weather and Incidents

**Objective** Environmental awareness.
**Implementation** `road_incidents`, `weather_events`; weather provider behind an interface with
last-known-good caching; manager incident reporting; driver incident reporting entering as
`REPORTED` and requiring manager confirmation; `ST_DWithin` affected-trip query.
**Tests** Affected-trip query correctness including the longitude-vs-latitude case at 26°N;
driver-reported incidents do not apply the hard filter until confirmed; weather timeout serves
stale-marked cache.
**Exit gate** Creating an `IMPASSABLE` incident on a route correctly identifies exactly the trips
whose selected route passes within its radius — verified against hand-computed cases.

---

## P9 — Rerouting

**Objective** Close the loop from incident to new route.
**Implementation** Incident confirmed → affected trips → hard filter rejects blocked candidates →
new `trip_routes` inserted, old marked `SUPERSEDED` → ETA and fuel recomputed → alerts to manager
and driver → driver acknowledgement.
**Tests** Route history preserved (nothing overwritten); a blocked candidate is **rejected, never
merely down-ranked**; alerts reach both parties; `422 NO_VIABLE_ROUTE` when all candidates are
blocked.
**Exit gate** The full chain runs end to end from a manager-created incident, and a closed road
cannot be selected by any code path.

---

## P10 — Fuel AI

**Objective** A fuel estimate that beats its baseline.
**Inputs** [AI_MODELS.md](AI_MODELS.md) §1.
**Implementation** Baseline formula **first**, wired into the API and returned as
`source: "BASELINE_KMPL"`. Then the synthetic generator, feature pipeline, LightGBM training in
`ml/`, artefact loading, and `POST /api/fuel/estimate` returning model output **alongside** the
baseline. `GET /api/fuel/model-info` exposes provenance and the synthetic-data disclosure.
**Tests** `model_mae < baseline_mae` on held-out data (relative assertion only); every fallback
path returns baseline or `null`, never a fabricated number; reproducible from a fixed seed.
**Exit gate** The model beats the baseline on synthetic held-out data, the improvement is recorded
in [AI_MODELS.md](AI_MODELS.md) §7 **with the date and marked synthetic**, and deleting the model
file degrades cleanly to the baseline with no error.

---

## P11 — Fleet Sentinel

**Objective** The safety differentiator. **The most important phase in the project.**
**Inputs** [ARCHITECTURE.md](ARCHITECTURE.md) Diagram F, [DATA_MODEL.md](DATA_MODEL.md) §11.
**Implementation** `emergencies` table with `uq_open_emergency_per_trip`; scheduled monitor every
5 minutes over active trips; stationary detection using `received_at` and `ST_DWithin`; geofence
exclusion; `COMMS_LOST` distinguished from SOS; driver check push with all ten response options;
stored 30-minute deadline; escalation with frozen `briefing_snapshot`; manager briefing view.
Thresholds configurable.

**No LLM in any part of this phase. No exceptions.**

**Tests** Injected clock, never `sleep`. Stationary just under and just over 60 minutes; inside and
outside a geofence; `NEED_HELP` escalates immediately; no response escalates at exactly 30 minutes;
**a late response after escalation is still recorded**; the monitor running 12 times over the same
stationary truck creates exactly **one** emergency; GPS gap raises `COMMS_LOST` not SOS; device
clock skewed ±6 hours does not shift the deadline; briefing contains every field required by
Diagram F.
**Exit gate** Every test above passes, and the whole chain is demonstrated end to end with a real
driver app. Scheduler health is itself monitored.

---

## P12 — Payments and Proof of Delivery

**Objective** Close the trip lifecycle.
**Implementation** `payments`, `expenses`, `payroll`, `deliveries`; status transitions; expense
submission and approval; PoD capture with signature, photos and `geofence_ok`.
**Tests** `paid_amount <= amount`; payroll arithmetic including rounding; no endpoint accepts
payment credentials; PoD outside the geofence records with the flag set rather than failing.
**Exit gate** Trip reaches `CLOSED` through the UI. **Asserted: no code path initiates a transfer
and no endpoint accepts card, UPI or bank details.**

---

## P13 — Integration

**Objective** Prove the whole chain holds together.
**Implementation** The Playwright E2E of the full demo narrative; failure-injection suite from
[TESTING_STRATEGY.md](TESTING_STRATEGY.md) §9; `scripts/demo_reset`; seed data for the demo cast.
**Tests** All of the above, plus the ML-unavailable property: with the ML service down, trips
dispatch, GPS ingests, reroute works and **SOS escalates**.
**Exit gate** The full demo chain passes as one automated test, three consecutive runs, from a
clean reset each time.

---

## P14 — Demo Hardening

**Objective** Make it survive the room.
**Implementation** Pre-cache map tiles for the Jorhat–Guwahati corridor; decide WebSocket vs
polling and pin it; timing config profile for the demo; emulator fallback prepared; full rehearsal;
**record the fallback video after the first clean rehearsal**; prepare the question bank.
**Tests** Rehearse on hotspot and on venue-like conditions; rehearse the reset repeatedly.
**Exit gate** Three consecutive clean manual runs, at least one on a hotspot. Reset takes under 30
seconds. Fallback recording exists.

---

## Sequencing Notes

- **P2 → P3 → P4 → P5 is the critical path.** Nothing live works until GPS ingestion does.
- **P6 (routing) is the schedule risk.** Timebox it; the provider interface makes retreat cheap.
- **P10 (Fleet Sentinel) is the highest-value phase.** If time runs short, cut scope from P9 or P11 — never P10.
- **P9 (Fuel AI) is the phase most likely to tempt dishonesty.** Ship the baseline rather than a fabricated
  metric. A baseline that is labelled a baseline is a better result than an invented accuracy
  figure, both ethically and in judging.
- Frontend work may be interleaved with backend work only if the API contract for that endpoint
  group is already fixed and tested.

## Contingency

If the schedule slips, cut in this order: P11 payments → P9 model (keep baseline) → P6 route B/C
(keep primary + backup) → P7 weather (keep manual incidents).

**Never cut:** the capacity gate (P5), rerouting (P8), or Fleet Sentinel (P10). Those three are the
project.
