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

## P2 — Data Model

**Objective** Implement the core domain schema.
**Inputs** [DATA_MODEL.md](DATA_MODEL.md) §2–6.
**Implementation** Enums; `users`, `drivers`, `driver_documents`, `trucks`, `truck_documents`,
`truck_maintenance`, `driver_truck_assignments`, `audit_logs`. SQLAlchemy models, Alembic
migration, seed script for development data.

Do **not** implement trips, GPS, payments or emergencies in this phase.

**Tests** Migration up/down/up on a scratch database; the `current_load_kg <= max_capacity_kg`
CHECK rejects direct SQL; both partial unique assignment indexes reject a second active row;
`audit_logs` rejects UPDATE and DELETE from the application role; **every new table has
RLS enabled** - on Supabase a table without it is world-readable through the Data API.
**Exit gate** Migration is reversible; every constraint above is proven by a failing-write test;
seed script produces a usable development dataset.

---

## P3 — Core Backend

**Objective** Authentication, RBAC, and CRUD for drivers, trucks and assignments.
**Inputs** [API_CONTRACTS.md](API_CONTRACTS.md) §2–5, [SECURITY.md](SECURITY.md) §1–2.
**Implementation** Argon2id hashing; JWT access + rotating refresh with reuse detection; RBAC
dependency; the endpoint groups above; assignment transition that atomically ends the previous
active assignment; file upload with magic-byte validation and EXIF stripping.
**Tests** The full authorization matrix, including **object-level** access (a driver requesting
another driver's record gets 404); token tampering rejected; upload validation; assignment
atomicity under concurrency.
**Exit gate** Authorization matrix passes for every implemented endpoint; no endpoint returns data
outside the principal's scope; upload of a `.jpg` with executable magic bytes is rejected.

---

## P4 — Manager Dashboard

**Objective** Real UI over the P3 API.
**Implementation** Login; driver and truck list/detail/create/edit; document upload with expiry
status; assignment screen with verification review; app shell, routing, error and loading states.
**Tests** Vitest component tests; MSW-stubbed API; Playwright login and CRUD; typecheck and build.
**Exit gate** A manager can complete driver and truck lifecycle entirely through the UI. **No
hardcoded or placeholder data anywhere in the rendered output.**

---

## P5 — Driver App

**Objective** Driver authentication and assignment acceptance.
**Implementation** Phone login with `expo-secure-store` token storage; assigned truck view; truck
verification (camera, odometer, fuel, damage notes); profile and documents. Location permission is
requested **in this phase**, with the rationale screen from [SECURITY.md](SECURITY.md) §3.
**Tests** RNTL component tests; secure-store usage asserted; typecheck.
**Exit gate** A driver logs in on a real device, sees their assignment, and completes verification.
Tokens are confirmed absent from `AsyncStorage`.

---

## P6 — Live GPS

**Objective** Phone GPS to manager map.
**Inputs** [API_CONTRACTS.md](API_CONTRACTS.md) §8, [DATA_MODEL.md](DATA_MODEL.md) §8.
**Implementation** `shipments`, `cargo_items`, `trips`, `gps_points` tables; trip creation with the
**capacity gate**; background location task with local SQLite buffering; `POST /api/gps/batch`
idempotent on `device_fix_id`; WebSocket broadcast; MapLibre live map. **GPS replay harness** built
here — it is a test client posting to the real API.
**Tests** Idempotency (same fix twice → one row); offline buffering, ordered flush, restart
survival; capacity gate rejects over-capacity with 422; map renders live position.
**Exit gate** A phone moving produces a moving marker on the manager map. Airplane mode for 10
minutes then reconnect flushes every fix exactly once. Over-capacity assignment is refused.

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

- **P2 → P3 → P6 is the critical path.** Nothing live works until GPS ingestion does.
- **P7 is the schedule risk.** Timebox it; the provider interface makes retreat cheap.
- **P11 is the highest-value phase.** If time runs short, cut scope from P10 or P12 — never P11.
- **P10 is the phase most likely to tempt dishonesty.** Ship the baseline rather than a fabricated
  metric. A baseline that is labelled a baseline is a better result than an invented accuracy
  figure, both ethically and in judging.
- P4 and P5 can be interleaved with backend work only if the API contract for that endpoint group
  is already fixed and tested.

## Contingency

If the schedule slips, cut in this order: P12 payments → P10 model (keep baseline) → P7 route B/C
(keep primary + backup) → P8 weather (keep manual incidents).

**Never cut:** the capacity gate (P6), rerouting (P9), or Fleet Sentinel (P11). Those three are the
project.
