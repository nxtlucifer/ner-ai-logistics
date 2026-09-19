# RASTA AI — DAY 2 TASK 1 FINAL REPORT

**Backend Finalization, API & Database Integration** · Team NER-AI LOGISTICS (SIH26002) · 19 September 2026
Repository `nxtlucifer/ner-ai-logistics`, branch `main`, HEAD `7c176f3` at the start of the session (uncommitted
working-tree changes listed in §13 and §16). Companion documents produced today:

| Document | Purpose |
| --- | --- |
| [`DAY2_TASK1_CRUD_DOCUMENTATION.md`](DAY2_TASK1_CRUD_DOCUMENTATION.md) | CRUD operations per resource: endpoint, request, response, authorisation, table, business rules |
| [`DAY2_TASK1_ER_DIAGRAM.md`](DAY2_TASK1_ER_DIAGRAM.md) + [`submission/day2/task1/er-diagram.png`](submission/day2/task1/er-diagram.png) | Database schema, ER diagram (Mermaid + PNG/SVG), 20-table inventory, constraints |
| [`DAY2_TASK1_API_TEST_RESULTS.md`](DAY2_TASK1_API_TEST_RESULTS.md) | 56-step HTTP run (expected vs actual, request/response), automated suite results, screenshot checklist |
| [`DAY2_TASK1_INTEGRATION_EVIDENCE.md`](DAY2_TASK1_INTEGRATION_EVIDENCE.md) | Manager Web → API → DB and Driver App → API → DB, with the observed request log and screenshots |
| [`submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.pdf`](submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.pdf) (+ `.docx`, `.md`, `build_report.py`) | The 12-page judge-facing report built from this evidence (A4, page-1 task requirements only) |
| `submission/day2/task1/screenshots/*.png`, `evidence-results*.json`, `api_evidence.py` + `api-results.json` | 15 automatically captured screenshots, the three browser evidence runs' results, and the re-runnable API test script with its raw output |

---

## 1. Executive Summary

The backend was already substantially complete; today's work **verified** it end to end and fixed what was
actually broken, rather than rebuilding anything.

- **Backend runs and is wired to PostgreSQL/PostGIS:** `/health` 200, `/ready` 200 with `database` and
  `postgis` checks `ok` on both the local isolated cluster (PostgreSQL 18.2, PostGIS 3.6) and the hosted
  Render service on Supabase (PostgreSQL 17.6, PostGIS 3.3).
- **86 HTTP routes** are mounted (enumerated from the running app, not from documentation); 83 have HTTP-level
  tests; the remaining 3 are thin wrappers around external providers.
- **CRUD is complete for every operational resource** (drivers, trucks, assignments, shipments, trips, routes,
  telemetry, emergencies, files); "delete" is soft-delete / audited state transition by design.
- **Database:** Alembic chain `0001 → 0012` linear and at head; 20 domain tables, 41 FKs, 36 CHECKs, 75 indexes,
  20 enums, RLS everywhere, PostGIS geography on 5 tables; `test_schema_drift.py::test_no_drift_between_models_and_database` passes.
- **Tests this session:** backend **1210 passed / 5 skipped**; manager **259 passed**; driver **624 passed**;
  a 56-step HTTP run against the local backend **56/56 PASS**; three browser evidence passes **24/24**.
- **Defects found and fixed today:** the manager web production build (`npm run build`) failed at HEAD with
  5 TypeScript errors (introduced 18–19 Sep); fixed with a 3-file, 4-line change. Four stale documentation
  statements (OpenAPI description, `API_CONTRACTS.md`, `DATA_MODEL.md`, `SUBMISSION_README.md`) were
  corrected from code evidence.
- **Nothing was committed or pushed**, no shared/Supabase data was modified, no secrets were printed.

## 2. Backend Status

| Component | Location | Status | Evidence |
| --- | --- | --- | --- |
| FastAPI application, 14 routers registered in one place | `backend/app/main.py` | IMPLEMENTED | route dump: 86 routes |
| Config, event-loop policy (Windows psycopg fix), structured error envelope | `backend/app/core/`, `backend/run.py` | IMPLEMENTED | `/ready` on Windows; `test_event_loop.py`, `test_config.py` |
| Authentication: JWT access + rotating refresh tokens (cookie for web, body for mobile), family revocation, rate limiting | `backend/app/services/auth.py`, `core/security.py`, `core/rate_limit.py` | IMPLEMENTED | HTTP run rows 3–8, 44–47; `test_auth.py`, `test_rate_limit.py`, `test_test_account_hygiene.py` |
| RBAC: 4 roles → permission strings, object scoping in services | `backend/app/core/permissions.py`, `api/deps.py` | IMPLEMENTED | rows 41–43 (driver sees only self, 403 on create, 404 on other's row); `test_authorization.py` |
| Drivers / trucks / assignments (fleet master data) | `services/drivers.py`, `trucks.py`, `assignments.py` | IMPLEMENTED | rows 9–29; `test_api_fleet.py`, `test_assignment_invariant.py`, `test_concurrency.py` |
| Shipments + atomic trip planning, capacity and reservation gates | `services/shipments.py`, `trips.py` (`plan`, `_assert_resources_free`) | IMPLEMENTED | rows 30–34; `test_shipment_trip_atomicity.py`, `test_resource_reservation.py`, `test_trip_multiplicity_invariant.py` |
| Trip state machine, dispatch gates, cancel dispositions, mid-trip stops, journey history | `domain/trip_state.py`, `services/trips.py` | IMPLEMENTED | rows 35–39; `test_trip_execution.py`, `test_dispatch_route_gate.py`, `test_midtrip_stops_and_history.py`, `test_post_pickup_resolution.py` |
| Driver self-service: accept/start/stops/complete, GPS batches, offline package, navigation, notices, push token | `services/driver_trips.py`, `telemetry.py`, `offline_package.py`, `notify.py` | IMPLEMENTED | rows 40–48; live GPS 202 in evidence pass 2; `test_driver_self.py`, `test_telemetry.py`, `test_offline_package.py` |
| Route planning (up to 3 validated options), deterministic risk, recommendation, review/approval governance, live reroute | `services/routes.py`, `route_risk.py`, `route_review.py`, `reroute.py`, `domain/routing.py` | IMPLEMENTED | demo.py workflow (§9 of integration evidence: `select` → 422 `ROUTE_REVIEW_REQUIRED`, `approve` → 200); `test_route_api.py`, `test_route_eligibility.py`, `test_route_review_authorization.py`, `test_route_selection_hazard_api.py`, `test_reroute_api.py`, `test_driver_reroute_api.py` |
| Fleet Sentinel emergencies (stationary detection → driver check → escalation → resolve) + background loops (sentinel, warnings feed, route watch) | `services/sentinel.py`, `warnings.py`, `route_watch.py`, lifespan in `main.py` | IMPLEMENTED | `GET /api/emergencies/active` 200; `test_sentinel.py`, `test_sentinel_concurrency.py`, `test_emergency_api.py` |
| Private files (BYTEA) and document records | `api/files.py`, `api/documents.py` | IMPLEMENTED | verification photo upload 201 in the demo workflow; `test_files_documents.py` |
| Geocoding (Nominatim; Google Places only with a key), AI assistant router (advisory) | `services/geocoding.py`, `api/ai.py` | IMPLEMENTED (external) | `test_geocoding.py`, `test_maplink.py`; `/api/ai/*` has no HTTP test → NEEDS TESTING |
| Audit logging on every consequential mutation | `services/audit.py`, trigger `trg_audit_logs_append_only` | IMPLEMENTED | 32,651 audit rows in the demo DB; `test_audit.py` |
| Fuel estimation, payments, expenses, payroll, deliveries, `/api/alerts`, WebSocket | — | NOT IMPLEMENTED (design only, `API_CONTRACTS.md` §10–14) | — |

## 3. API Status

86 routes mounted; every one is listed with its permission, database operation, frontend consumer and test
coverage in §17 (Route Inventory). Summary by area:

| Area | Routes | Consumers | Coverage |
| --- | :-: | --- | --- |
| System (`/health`, `/ready`, `/api/system/*`) | 4 | both clients | tested (simulation route is demo tooling) |
| Auth | 4 | both clients | tested |
| Drivers / Trucks / Assignments | 7 / 5 / 6 | Manager Web (+ manager shell in the driver app) | tested |
| Shipments / Trips / Routes / Fleet | 2 / 12 / 13 / 1 | Manager Web; driver app for reroute/routes | tested |
| Driver self-service `/api/driver/me*` | 24 | Driver App | tested (`/trip/places` has no HTTP test) |
| Emergencies | 3 | Manager Web | tested (sweep via service tests) |
| Files / Documents | 2 (+ 6 document routes counted above) | both clients | tested |
| Geocoding / AI | 3 / 2 | Manager Web / Driver App | geocoding tested; AI untested (external) |

Contract properties verified in the HTTP run: one error envelope; 401 vs 403 vs 404 semantics (no existence leak
to drivers); 422 for schema and business-rule violations; 409 for uniqueness and illegal transitions; cursor
paging with `next_cursor`; server-side filters + `total` on `/api/trips`; idempotent GPS batches.

## 4. CRUD Matrix

| Resource | Create | Read | Update | Delete / state transition | Verified by |
| --- | :-: | :-: | :-: | :-: | --- |
| Auth / sessions | ✅ login | ✅ me | ✅ refresh rotation | ✅ logout, family revoke | HTTP rows 3–8, 44–47, 56 |
| Drivers | ✅ | ✅ list / get / search | ✅ PATCH | ✅ deactivate (soft) | HTTP rows 9–15, 54–55 |
| Trucks | ✅ | ✅ | ✅ PATCH | ✅ retire (soft) | HTTP rows 16–21, 53 |
| Assignments | ✅ | ✅ | ✅ verify / verify-manual | ✅ end | HTTP rows 22–25, 52 |
| Shipments + cargo | ✅ | ✅ | — (immutable) | via trip | HTTP rows 30–33 |
| Trips | ✅ create / plan | ✅ list / get / events | ✅ dispatch, add stop, driver progress | ✅ cancel / close | HTTP rows 32–39; demo workflow |
| Routes | ✅ recalculate / reroute | ✅ list / risk / recommendation | ✅ select / approve | ✅ supersede | demo workflow; backend tests |
| GPS telemetry | ✅ 202 batch | ✅ fleet / track / progress | append-only | append-only | evidence pass 2 (202), HTTP rows 44–45 |
| Emergencies | ✅ sweep | ✅ active | ✅ check-in | ✅ resolve | HTTP row 49; backend tests |
| Files / documents | ✅ | ✅ | — | — | demo workflow (photo 201); backend tests |

Full detail: `DAY2_TASK1_CRUD_DOCUMENTATION.md`.

## 5. Database Integration

| Check | Local (this session) | Hosted (read-only probe) |
| --- | --- | --- |
| Provider | `local` — isolated cluster `127.0.0.1:55432`, DB `ner_logistics_demo` (demo clone) and `ner_logistics_test` (pytest) | `supabase` |
| `GET /ready` | `200 {"status":"ready","provider":"local","checks":{"database":{"ok":true,"detail":"PostgreSQL 18.2"},"postgis":{"ok":true,"detail":"3.6 …"}}}` | `200 … "provider":"supabase" … "PostgreSQL 17.6" … "3.3 …"` |
| Migration state | `alembic current` = `0012_push_notifications (head)`; `alembic heads` = same | migrations are applied to Supabase by hand (`alembic upgrade head` with `MIGRATION_DATABASE_URL`, README "Apply migrations to Supabase"); the Render container only serves (`backend/Dockerfile`) |
| Tables | 22 (20 domain + `alembic_version` + `system_info`) | — |
| Constraints | 41 FKs, 36 named CHECKs, 75 indexes, 20 enums, RLS enabled on 22 tables | — |
| Driver: SQLAlchemy 2 async + psycopg 3; `WindowsSelectorEventLoopPolicy` via `run.py` | verified (`/ready` and 1210 tests) | — |
| Safety guard | `tests/db_target.py` refuses any target that is not the isolated cluster; `.runtime/use-isolated-db.sh` arms it | Supabase never touched by tests |

Row counts in the demo clone after the session (no fixtures left live): users 19,871 · drivers 5 · trucks 3 ·
shipments 69 · trips 70 · trip_routes 86 · trip_stops 140 · trip_events 551 · gps_points 2,521 ·
route_review_authorizations 75 · audit_logs 32,651 · stored_files 11 · driver_notifications 24 · emergencies 0.

## 6. Database Schema

20 domain tables (`docs/DAY2_TASK1_ER_DIAGRAM.md` §3 has the full inventory with PKs, FKs and migrations):

`users`, `refresh_tokens`, `drivers`, `driver_documents`, `trucks`, `truck_documents`, `truck_maintenance`,
`driver_truck_assignments`, `shipments`, `cargo_items`, `trips`, `trip_stops`, `trip_routes`, `trip_events`,
`gps_points`, `route_review_authorizations`, `emergencies`, `stored_files`, `driver_notifications`, `audit_logs`.

Conventions verified in the models: UUID PKs, `TIMESTAMPTZ`, native enums, `NUMERIC` money/weight, PostGIS
`geography(Point|LineString,4326)` with GIST indexes, soft delete on master data, append-only audit (trigger),
derived shipment weight (trigger), `updated_at` triggers.

## 7. ER Diagram

Mermaid source and explanation: `docs/DAY2_TASK1_ER_DIAGRAM.md`. Rendered:
`docs/submission/day2/task1/er-diagram.png` (5018 × 5568 px) and `er-diagram.svg`
(`docs/submission/day2/task1/render_er.mjs`, headless Chrome + Mermaid 11). Core relationships:
`users 1—0..1 drivers`; `drivers/trucks 1—n driver_truck_assignments` (one open per side);
`shipments 1—1..n cargo_items`, `1—n trips`; `trips 1—1..n trip_stops`, `1—n trip_routes` (+ `selected_route_id`),
`1—n trip_events`, `1—n gps_points`, `1—0..1 open emergency`; `trip_routes 1—0..1 live route_review_authorization`.

## 8. Manager ↔ Backend Integration

Verified in a real Chromium against the local stack (`DAY2_TASK1_INTEGRATION_EVIDENCE.md` §A): sign-in →
`POST /api/auth/login` → Fleet command reading `/api/fleet/active`, `/api/trips`, `/api/emergencies/active` and
showing the truck the driver app had just positioned; Drivers, Trucks (list reads); Trips → Open trips
(server filters, `total`, ACTIVE row with **Open / Change journey**); trip review panel showing the
manager's approval stored in `route_review_authorizations`; History tab (`open_only=false`, 69 rows, read-only);
Diagnostics (`/api/system/providers`, `/ready`). 148 API responses observed across two passes, zero 5xx.
Screenshots `07_*`, `09_*`.

## 9. Driver ↔ Backend Integration

Verified on the Expo web build at phone width with simulated GPS (§B): sign-in with phone →
`/api/driver/me`, `/api/driver/me/trip` (ACTIVE `HILL-F5BF1C`, truck verified), Navigate →
`/api/driver/me/trip/navigation` + `/offline-package` (4,341-point route) + `/route-risk` (CAUTION advisory),
**`POST /api/driver/me/location` → 202** written to `gps_points` and read back on the manager's Fleet page as
LIVE. The full trip lifecycle (plan → route → approve → dispatch → accept → verify photo → start) was driven
through the real endpoints by `.runtime/demo.py` and is recorded in `trip_events` and `audit_logs`.
Screenshots `08_*`. The physical Android APK (1.0.18) was certified against the hosted API on 14–18 Sep
(`docs/terrain/HANDOFF.md` §7, §17, §20) and was not re-run today.

## 10. API Test Results

56/56 PASS (`DAY2_TASK1_API_TEST_RESULTS.md`): liveness/readiness; login success, wrong password 401,
short password 422; unauthenticated/garbage token 401; driver CRUD (422 → 201 → 409 → 200 → 200 → 404);
truck CRUD (422 → 201 → 409 → 200 → 200); assignment create/409/read/verify-manual; trip plan refused out of
region (422) and over capacity (422, atomic), plan 201, list with `search` + `total`, dispatch without route
422 `ROUTE_SELECTION_REQUIRED`, cancel 200, cancel again 409, journey history 200; driver login, self-reads,
scoped list, 403 on create, 404 on another driver, GPS 422/404, refresh rotation 200 then reuse 401;
fleet/emergencies/providers reads; end / retire / deactivate 200 and the deactivated token 401; logout 204.

## 11. Automated Test Results

| Suite | Result | Notes |
| --- | --- | --- |
| Backend `pytest` (isolated PostgreSQL) | **1210 passed, 5 skipped**, 223 s | skips are the destructive downgrade tests (opt-in) and one non-Windows case |
| Backend targeted re-run after edits (`test_health`, `test_migrations`, `test_api_fleet`) | 55 passed, 4 skipped | main.py description change is text-only |
| Manager Web `vitest` | **259 passed** (24 files) | |
| Manager Web `tsc -b --noEmit` / `npm run build` | **0 errors / build OK** | was 5 errors / build failing at HEAD `7c176f3` |
| Driver App `vitest` | **624 passed** (54 files) | |
| Driver App `tsc --noEmit` | **0 errors** | |
| Browser evidence passes (`.runtime/day2/evidence*.mjs`) | 9/9, 11/11, 4/4 | real sign-ins, request log recorded |

## 12. Screenshots Required

Captured automatically → `docs/submission/day2/task1/screenshots/`:
`01_backend_health.png`, `02_backend_ready_database.png`, `03_fastapi_swagger.png`, `03b_fastapi_swagger_trips.png`,
`07_manager_backend_integration_fleet.png`, `07b_manager_drivers_list.png`, `07c_manager_trucks_list.png`,
`07d_manager_diagnostics_providers.png`, `08_driver_backend_integration_trip.png`, `08b_driver_navigate_guidance.png`,
`08c_driver_more.png`, `09_trip_workflow_trips_list.png`, `09c_trip_review_panel.png`, `09d_trip_journey_history.png`,
plus `docs/submission/day2/task1/er-diagram.png` (= `11_er_diagram.png`).

NEEDS MANUAL SCREENSHOT (a terminal / DB client is required):

| File | Open | Do | Must be visible |
| --- | --- | --- | --- |
| `04_api_login_success.png` | `http://127.0.0.1:8010/docs` (backend up via `bash .runtime/start-demo-backend.sh`) | `POST /api/auth/login` → *Try it out* → demo manager e-mail + password → Execute | `200` response with `user.role: "MANAGER"` (blur the tokens) |
| `05_api_crud_example.png` | Terminal in the repo root | `python docs/submission/day2/task1/api_evidence.py` (or re-run the drivers steps in Swagger: POST 201 → GET 200 → PATCH 200 → deactivate 200) | the `[PASS]` lines for `/api/drivers` |
| `06_database_tables.png` | pgAdmin/DBeaver on `127.0.0.1:55432/ner_logistics_demo` (or Supabase Table Editor) | expand *Tables* | the 20 tables listed in §6 |
| `10_test_results.png` | Terminal | `source .runtime/use-isolated-db.sh && cd backend && .venv/Scripts/python.exe -m pytest -q`; `npm test` in `manager-web` and `driver-app` | `1210 passed, 5 skipped` · `259 passed` · `624 passed` |

## 13. Issues Found and Fixed

| # | Priority | Issue | Root cause | Fix | Verification |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | `manager-web` production build (`npm run build` = `tsc -b && vite build`) failed at HEAD with 5 TypeScript errors; `npm run typecheck` red | `TripsPage.tsx` kept an unused `JourneyHistory` import after the panel moved into `TripRouteReview` (985db6d); `client.test.ts` typed a zero-arg `vi.fn` so `mock.calls[0][0]` was `never` (5dcc608); `planValidation.test.ts` passed plain strings where `Trip['status']` is required (7c176f3) | remove the import; type the fetch mock `(..._args: Parameters<typeof fetch>)`; type `holding(status: Trip['status'])` and the two `it.each<[Trip['status']]>` tables | `tsc -b --noEmit` 0 errors; `npm run build` ✓; 68 targeted tests pass; full 259 pass. Render's static build (`vite build --mode remote-demo`) does not run `tsc`, so the hosted site was never affected |
| 2 | P3 | OpenAPI/Swagger description said "Not implemented: … alerts and emergencies" while the emergencies router, table and tests exist | text not updated since P11 | new description in `backend/app/main.py` | `/docs` shows it; `test_health.py` passes |
| 3 | P3 | `docs/API_CONTRACTS.md` header said sections 13 (emergencies) "not routed at all"; §15 "Implemented Today" listed a fraction of the surface; §13b geocoding "never executed" | drift since 13–18 Sep | header rewritten; §13 status note; §15 regenerated from the live route table (86 rows); §13b corrected | matches `app.routes` |
| 4 | P3 | `docs/DATA_MODEL.md` status said "partially implemented, migrations 0001 and 0002, 15 tables" | drift | status paragraph rewritten; §13 gained the 0003–0012 table; bootstrap footnote corrected | matches Alembic + live DB |
| 5 | P3 | `SUBMISSION_README.md` quoted old test counts (1138 / 621 / 170) and `uvicorn app.main:app` (breaks on Windows) | drift | counts updated to today's, `python run.py` | — |

Left as found, on purpose: the HILL trip `HILL-F5BF1C` remains ACTIVE in the **local** demo clone so the
screens can be re-shot; `python .runtime/demo.py finish|cancel` clears it. Test rows created by the HTTP run
were retired/deactivated by the run itself.

## 14. Remaining Limitations

| Item | Classification | Note |
| --- | --- | --- |
| `POST /api/ai/ask`, `GET /api/ai/status`, `GET /api/driver/me/trip/places` | IMPLEMENTED · NEEDS TESTING | thin wrappers over external providers; no HTTP-level test |
| Fuel estimation, payments/expenses/payroll, deliveries, `/api/alerts`, WebSocket fleet feed | NOT IMPLEMENTED | design-only sections of `API_CONTRACTS.md`; the app works without them |
| `estimated_fuel_*` columns on `trip_routes` | IMPLEMENTED (schema) / NOT IMPLEMENTED (value) | deliberately NULL — no fuel model exists (`services/routes.py`) |
| ETA fields `planned_eta`, `current_eta`, `delay_minutes` on `trips` | IMPLEMENTED (schema) / PARTIAL (value) | not populated by the backend; the driver app computes its ETA bar client-side from the route |
| Hazard evidence on the hosted stack | PARTIAL | `LANDSLIDE_DATA_NOT_CONFIGURED` makes every corridor REQUIRES_REVIEW; the manager's audited approval is the designed path |
| Physical phone run | NOT RE-RUN TODAY | last certified 18 Sep (HANDOFF §20); the web build of the same app was verified today |
| Manual screenshots 04, 05, 06, 10 | NEEDS MANUAL SCREENSHOT | see §12 |

## 15. Final Day-2 Compliance Matrix

| Requirement | Status | Evidence |
| --- | --- | --- |
| Finalized backend | PASS | §2; 86 routes; 1210 backend tests; `/health`, `/ready` |
| APIs | PASS | §3, §17; 56/56 HTTP run; Swagger screenshot |
| CRUD | PASS | §4; `DAY2_TASK1_CRUD_DOCUMENTATION.md` |
| Database | PASS | §5–6; Alembic head 0012 on the live DB; PostGIS checks |
| ER Diagram | PASS | `DAY2_TASK1_ER_DIAGRAM.md`, `er-diagram.png/svg` |
| Frontend-backend integration | PASS (screenshots captured) | §8–9; `DAY2_TASK1_INTEGRATION_EVIDENCE.md`; 15 screenshots; request logs |
| API testing | PASS + NEEDS MANUAL SCREENSHOT (04, 05, 10 are terminal shots) | `DAY2_TASK1_API_TEST_RESULTS.md` |
| Documentation | PASS | four new documents; four stale documents corrected |

## 16. Files changed this session (uncommitted)

New: `docs/DAY2_TASK1_FINAL_REPORT.md`, `docs/DAY2_TASK1_CRUD_DOCUMENTATION.md`, `docs/DAY2_TASK1_ER_DIAGRAM.md`,
`docs/DAY2_TASK1_API_TEST_RESULTS.md`, `docs/DAY2_TASK1_INTEGRATION_EVIDENCE.md`,
`docs/submission/day2/task1/` (screenshots, `er-diagram.png/svg`, `render_er.mjs`, `api_evidence.py` + `api-results.json`, `evidence-results*.json`).
Modified: `manager-web/src/pages/TripsPage.tsx`, `manager-web/src/api/client.test.ts`,
`manager-web/src/pages/planValidation.test.ts`, `backend/app/main.py`, `docs/API_CONTRACTS.md`,
`docs/DATA_MODEL.md`, `SUBMISSION_README.md`. Runtime-only (git-ignored): `.runtime/day2/evidence*.mjs`.
Pre-existing, not touched: `docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pptx`, `docs/submission/day1/build_docs.py`,
`docs/submission/day1/task3/`, `docs/prompts/`, `docs/submission/final-render/` (Day 1 work from earlier sessions).

## 17. Route Inventory (generated from the running application)

Legend: R = SELECT, C = INSERT, U = UPDATE. "Tests" lists backend test files that call the path (up to three).

| # | Method | Endpoint | Auth | Permission / role | Database operation | Frontend consumer | Tests | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | `GET` | `/health` | none | public | none (liveness) | Manager Web | test_authorization.py, test_health.py | IMPLEMENTED |
| 2 | `GET` | `/ready` | none | public | SELECT version(), postgis_version() | Manager Web, Driver App | test_health.py | IMPLEMENTED |
| 3 | `POST` | `/api/ai/ask` | JWT | DRIVER (own) | external model router (no table) | Driver App | none (HTTP) | IMPLEMENTED · NEEDS TESTING |
| 4 | `GET` | `/api/ai/status` | JWT | DRIVER (own) | provider health (no table) | Driver App | none (HTTP) | IMPLEMENTED · NEEDS TESTING |
| 5 | `GET` | `/api/assignments` | JWT | assignment:read | R driver_truck_assignments | Manager Web | test_api_fleet.py, test_assignment_invariant.py, test_audit.py +3 | IMPLEMENTED |
| 6 | `POST` | `/api/assignments` | JWT | assignment:create | U previous assignment (ENDED) + C driver_truck_assignments; C audit_logs | Manager Web | test_api_fleet.py, test_assignment_invariant.py, test_audit.py +3 | IMPLEMENTED |
| 7 | `GET` | `/api/assignments/{assignment_id}` | JWT | assignment:read | R driver_truck_assignments | Manager Web | test_api_fleet.py, test_authorization.py, test_concurrency.py +2 | IMPLEMENTED |
| 8 | `POST` | `/api/assignments/{assignment_id}/end` | JWT | assignment:end | U driver_truck_assignments.ended_at/status; C audit_logs | Manager Web | test_api_fleet.py, test_authorization.py, test_concurrency.py | IMPLEMENTED |
| 9 | `POST` | `/api/assignments/{assignment_id}/verify` | JWT | DRIVER (own), assignment:verify_own | U driver_truck_assignments (verified_at, reported_*, mismatch_flagged); C audit_logs | Manager Web | test_driver_self.py | IMPLEMENTED |
| 10 | `POST` | `/api/assignments/{assignment_id}/verify-manual` | JWT | assignment:review | U driver_truck_assignments (MANAGER_MANUAL); C audit_logs | Manager Web | test_files_documents.py | IMPLEMENTED |
| 11 | `POST` | `/api/auth/login` | none | public | R users; C refresh_tokens; U users.last_login_at; C audit_logs (LOGIN/LOGIN_FAILED) | Manager Web, Driver App | conftest.py, test_api_fleet.py, test_audit.py +4 | IMPLEMENTED |
| 12 | `POST` | `/api/auth/logout` | none | public | U refresh_tokens.revoked_at | Manager Web, Driver App | test_auth.py | IMPLEMENTED |
| 13 | `GET` | `/api/auth/me` | JWT | any signed-in user | R users (+drivers) | Manager Web, Driver App | test_auth.py, test_authorization.py | IMPLEMENTED |
| 14 | `POST` | `/api/auth/refresh` | none | public | R/U refresh_tokens (rotate, family revoke on reuse) | Manager Web, Driver App | test_auth.py, test_test_account_hygiene.py | IMPLEMENTED |
| 15 | `GET` | `/api/driver/me` | JWT | DRIVER (own) | R drivers | Driver App | test_driver_self.py, test_support_session.py | IMPLEMENTED |
| 16 | `GET` | `/api/driver/me/assignment` | JWT | DRIVER (own) | R driver_truck_assignments | Driver App | test_driver_self.py, test_support_session.py | IMPLEMENTED |
| 17 | `POST` | `/api/driver/me/assignment/verify` | JWT | DRIVER (own) | U driver_truck_assignments; C audit_logs | Driver App | test_assignment_invariant.py, test_driver_self.py, test_files_documents.py | IMPLEMENTED |
| 18 | `GET` | `/api/driver/me/documents` | JWT | DRIVER (own) | R driver_documents | Driver App | test_files_documents.py | IMPLEMENTED |
| 19 | `POST` | `/api/driver/me/documents` | JWT | DRIVER (own) | C driver_documents | Driver App | test_files_documents.py | IMPLEMENTED |
| 20 | `POST` | `/api/driver/me/location` | JWT | DRIVER (own) | C gps_points (batch, idempotent on device_fix_id); Sentinel/route-watch read them | Driver App | test_golden_path_e2e.py, test_offline_package.py, test_rate_limit.py +2 | IMPLEMENTED |
| 21 | `GET` | `/api/driver/me/notices` | JWT | DRIVER (own) | R driver_notifications | Driver App | test_post_pickup_resolution.py | IMPLEMENTED |
| 22 | `GET` | `/api/driver/me/profile` | JWT | DRIVER (own) | R drivers | Driver App | test_files_documents.py | IMPLEMENTED |
| 23 | `POST` | `/api/driver/me/push-token` | JWT | DRIVER (own) | U drivers.push_token | Driver App | test_notify.py, test_support_session.py | IMPLEMENTED |
| 24 | `GET` | `/api/driver/me/trip` | JWT | DRIVER (own) | R trips + trip_stops + trip_routes + latest gps_points (progress) | Driver App | test_emergency_api.py, test_golden_path_e2e.py, test_midtrip_stops_and_history.py +6 | IMPLEMENTED |
| 25 | `POST` | `/api/driver/me/trip/accept` | JWT | DRIVER (own) | U trips.driver_accepted_*; C trip_events(ACCEPTED); C audit_logs | Driver App | test_trip_acceptance.py | IMPLEMENTED |
| 26 | `POST` | `/api/driver/me/trip/check-in` | JWT | DRIVER (own) | U emergencies (driver_response); C trip_events | Driver App | test_emergency_api.py | IMPLEMENTED |
| 27 | `POST` | `/api/driver/me/trip/complete` | JWT | DRIVER (own) | U trips (DELIVERED); C trip_events(DELIVERED); C audit_logs | Driver App | test_telemetry.py, test_trip_execution.py | IMPLEMENTED |
| 28 | `POST` | `/api/driver/me/trip/instruction/ack` | JWT | DRIVER (own) | C trip_events(ACCEPTED, acknowledges) | Driver App | test_midtrip_stops_and_history.py, test_post_pickup_resolution.py | IMPLEMENTED |
| 29 | `GET` | `/api/driver/me/trip/navigation` | JWT | DRIVER (own) | R trip_routes.maneuvers | Driver App | test_navigation_package.py | IMPLEMENTED |
| 30 | `GET` | `/api/driver/me/trip/offline-package` | JWT | DRIVER (own) | R trips, trip_stops, trip_routes | Driver App | test_driver_reroute_api.py, test_golden_path_e2e.py, test_offline_package.py | IMPLEMENTED |
| 31 | `GET` | `/api/driver/me/trip/places` | JWT | DRIVER (own) | R trip_routes + external POI provider | Driver App | none (HTTP) | IMPLEMENTED · NEEDS TESTING |
| 32 | `POST` | `/api/driver/me/trip/reroute` | JWT | DRIVER (own) | C trip_routes (EMERGENCY_BACKUP from live position); C trip_events | Driver App | test_driver_reroute_api.py | IMPLEMENTED |
| 33 | `GET` | `/api/driver/me/trip/route-risk` | JWT | DRIVER (own) | R trip_routes (+evidence) | Driver App | test_corridor_too_wide.py | IMPLEMENTED |
| 34 | `POST` | `/api/driver/me/trip/start` | JWT | DRIVER (own) | U trips (ACTIVE, started_at); C trip_events(STARTED); C audit_logs | Driver App | test_assignment_invariant.py, test_driver_reroute_api.py, test_golden_path_e2e.py +11 | IMPLEMENTED |
| 35 | `POST` | `/api/driver/me/trip/stops/{stop_id}/arrive` | JWT | DRIVER (own) | U trip_stops (ARRIVED); C trip_events(STOP_ARRIVED) | Driver App | test_post_pickup_resolution.py, test_telemetry.py, test_trip_execution.py | IMPLEMENTED |
| 36 | `POST` | `/api/driver/me/trip/stops/{stop_id}/complete` | JWT | DRIVER (own) | U trip_stops (COMPLETED); C trip_events(STOP_COMPLETED) | Driver App | test_post_pickup_resolution.py, test_telemetry.py, test_trip_execution.py | IMPLEMENTED |
| 37 | `GET` | `/api/driver/me/truck-documents` | JWT | DRIVER (own) | R truck_documents | Driver App | test_files_documents.py | IMPLEMENTED |
| 38 | `POST` | `/api/driver/me/truck-documents` | JWT | DRIVER (own) | C truck_documents | Driver App | test_files_documents.py | IMPLEMENTED |
| 39 | `GET` | `/api/drivers` | JWT | driver:read | R drivers (scoped to self for DRIVER) | Manager Web, Driver App | test_api_fleet.py, test_audit.py, test_authorization.py +1 | IMPLEMENTED |
| 40 | `POST` | `/api/drivers` | JWT | driver:create | C users + drivers (one tx); C audit_logs | Manager Web, Driver App | test_api_fleet.py, test_audit.py, test_authorization.py +1 | IMPLEMENTED |
| 41 | `GET` | `/api/drivers/{driver_id}` | JWT | driver:read | R drivers | Manager Web | test_api_fleet.py, test_authorization.py, test_concurrency.py +2 | IMPLEMENTED |
| 42 | `PATCH` | `/api/drivers/{driver_id}` | JWT | driver:update | U drivers; C audit_logs | Manager Web | test_api_fleet.py, test_authorization.py, test_concurrency.py +2 | IMPLEMENTED |
| 43 | `POST` | `/api/drivers/{driver_id}/deactivate` | JWT | driver:deactivate | U drivers.deleted_at/status, U users.is_active=false (token refused from now on); C audit_logs | Manager Web | test_api_fleet.py, test_concurrency.py | IMPLEMENTED |
| 44 | `GET` | `/api/drivers/{driver_id}/documents` | JWT | driver:read | R driver_documents (masked) | Manager Web | test_files_documents.py | IMPLEMENTED |
| 45 | `POST` | `/api/drivers/{driver_id}/support-session` | JWT | driver:support_view | C refresh_tokens (short-lived, read-only view); C audit_logs | Manager Web | test_support_session.py | IMPLEMENTED |
| 46 | `GET` | `/api/emergencies/active` | JWT | emergency:read | R emergencies ⨝ trips | Manager Web | test_emergency_api.py | IMPLEMENTED |
| 47 | `POST` | `/api/emergencies/sweep` | JWT | emergency:resolve | R gps_points; C/U emergencies; C trip_events | Manager Web | test_sentinel*.py (run_sentinel_sweep) | IMPLEMENTED |
| 48 | `POST` | `/api/emergencies/{emergency_id}/resolve` | JWT | emergency:resolve | U emergencies (RESOLVED/FALSE_ALARM); C trip_events; C audit_logs | Manager Web | test_emergency_api.py | IMPLEMENTED |
| 49 | `POST` | `/api/files` | JWT | any signed-in user | C stored_files (BYTEA, ≤5 MiB) | Manager Web, Driver App | factories.py, test_api_fleet.py, test_assignment_invariant.py +2 | IMPLEMENTED |
| 50 | `GET` | `/api/files/{file_id}` | JWT | any signed-in user | R stored_files (owner/manager only) | Manager Web + Driver App (photo URLs returned by the API) | factories.py, test_files_documents.py | IMPLEMENTED |
| 51 | `GET` | `/api/fleet/active` | JWT | fleet:location_read | R trips ⨝ latest gps_points (PostGIS) | Manager Web, Driver App | test_telemetry.py | IMPLEMENTED |
| 52 | `GET` | `/api/geocoding/details` | JWT | trip:create | external Nominatim (no table) | Manager Web | test_geocoding.py | IMPLEMENTED |
| 53 | `POST` | `/api/geocoding/resolve-link` | JWT | trip:create | external (no table) | Manager Web | test_maplink.py | IMPLEMENTED |
| 54 | `GET` | `/api/geocoding/suggest` | JWT | trip:create | external Nominatim (no table) | Manager Web | test_geocoding.py | IMPLEMENTED |
| 55 | `GET` | `/api/shipments` | JWT | shipment:read | R shipments | Manager Web | test_shipment_trip_atomicity.py | IMPLEMENTED |
| 56 | `POST` | `/api/shipments` | JWT | shipment:create | C shipments + cargo_items (trigger derives total_weight_kg); C audit_logs | Manager Web | test_shipment_trip_atomicity.py | IMPLEMENTED |
| 57 | `GET` | `/api/system/providers` | JWT | any signed-in user | provider health cache (no table) | Manager Web, Driver App | test_provider_health.py | IMPLEMENTED |
| 58 | `GET` | `/api/system/simulation` | JWT | any signed-in user | in-memory (DEMO only) | ops tooling only | test_simulation.py | IMPLEMENTED (demo tooling) |
| 59 | `GET` | `/api/trips` | JWT | trip:read | R trips ⨝ shipments (filters, cursor, total) | Manager Web, Driver App | factories.py, test_concurrency.py, test_midtrip_stops_and_history.py +3 | IMPLEMENTED |
| 60 | `POST` | `/api/trips` | JWT | trip:create | C trips + trip_stops (capacity + reservation gates, SELECT … FOR UPDATE); C trip_events(CREATED); C audit_logs | Manager Web, Driver App | factories.py, test_concurrency.py, test_midtrip_stops_and_history.py +3 | IMPLEMENTED |
| 61 | `POST` | `/api/trips/plan` | JWT | trip:create | C shipments + cargo_items + trips + trip_stops in ONE transaction; C trip_events; C audit_logs | Manager Web | test_resource_reservation.py, test_shipment_trip_atomicity.py | IMPLEMENTED |
| 62 | `GET` | `/api/trips/{trip_id}` | JWT | trip:read | R trips + trip_stops + shipments | Manager Web, Driver App | test_api_fleet.py, test_concurrency.py, test_dispatch_route_gate.py +20 | IMPLEMENTED |
| 63 | `POST` | `/api/trips/{trip_id}/cancel` | JWT | trip:cancel | U trips (CANCELLED), release driver/truck; C trip_events(CANCELLED); C audit_logs | Manager Web | test_post_pickup_resolution.py, test_start_race_epq.py, test_trip_execution.py | IMPLEMENTED |
| 64 | `POST` | `/api/trips/{trip_id}/close` | JWT | trip:close | U trips (CLOSED), release resources; C trip_events(CLOSED); C audit_logs | Manager Web | test_trip_execution.py | IMPLEMENTED |
| 65 | `POST` | `/api/trips/{trip_id}/dispatch` | JWT | trip:dispatch | U trips (ASSIGNED), U drivers/trucks status; C trip_events(DISPATCHED); C driver_notifications; C audit_logs | Manager Web, Driver App | test_concurrency.py, test_dispatch_route_gate.py, test_golden_path_e2e.py | IMPLEMENTED |
| 66 | `GET` | `/api/trips/{trip_id}/events` | JWT | trip:read | R trip_events ⨝ users (display name) | Manager Web | test_midtrip_stops_and_history.py | IMPLEMENTED |
| 67 | `GET` | `/api/trips/{trip_id}/reroute` | JWT | route:read | R trip_routes, gps_points (assessment) | Manager Web, Driver App | test_golden_path_e2e.py, test_reroute_api.py | IMPLEMENTED |
| 68 | `POST` | `/api/trips/{trip_id}/reroute/accept` | JWT | route:select | U trip_routes (supersede), U trips.selected_route_id; C trip_events(ROUTE_CHANGED); C audit_logs | Manager Web, Driver App | test_golden_path_e2e.py, test_reroute_api.py | IMPLEMENTED |
| 69 | `GET` | `/api/trips/{trip_id}/routes` | JWT | route:read | R trip_routes | Manager Web, Driver App | test_route_api.py, test_route_current_assignment.py | IMPLEMENTED |
| 70 | `POST` | `/api/trips/{trip_id}/routes/recalculate` | JWT | route:plan | C trip_routes (PRIMARY + EMERGENCY_BACKUP options, provider validated) | Manager Web | test_driver_reroute_api.py, test_golden_path_e2e.py, test_navigation_package.py +9 | IMPLEMENTED |
| 71 | `GET` | `/api/trips/{trip_id}/routes/recommendation` | JWT | route:read | R trip_routes (+risk evidence) | Manager Web | test_golden_path_e2e.py, test_route_current_assignment.py, test_route_recommendation_api.py | IMPLEMENTED |
| 72 | `POST` | `/api/trips/{trip_id}/routes/{route_id}/approve` | JWT | route:select | C route_review_authorizations + selection in one tx; C trip_events; C audit_logs | Manager Web | test_route_review_authorization.py | IMPLEMENTED |
| 73 | `GET` | `/api/trips/{trip_id}/routes/{route_id}/review-authorization` | JWT | route:read | R route_review_authorizations | Manager Web | test_route_review_authorization.py | IMPLEMENTED |
| 74 | `POST` | `/api/trips/{trip_id}/routes/{route_id}/review-authorization` | JWT | route:review_authorize | C route_review_authorizations; C audit_logs | Manager Web | test_route_review_authorization.py | IMPLEMENTED |
| 75 | `DELETE` | `/api/trips/{trip_id}/routes/{route_id}/review-authorization/{authorization_id}` | JWT | route:review_authorize | U route_review_authorizations.revoked_*; C audit_logs | reviewer path (optional) | test_route_review_authorization.py | IMPLEMENTED |
| 76 | `GET` | `/api/trips/{trip_id}/routes/{route_id}/risk` | JWT | route:read | R trip_routes; U trip_routes.risk_score/risk_factors | Driver App | test_route_review_authorization.py, test_route_risk_api.py | IMPLEMENTED |
| 77 | `POST` | `/api/trips/{trip_id}/routes/{route_id}/select` | JWT | route:select | U trips.selected_route_id, U trip_routes.state; U route_review_authorizations.consumed_*; C trip_events; C audit_logs | Manager Web | test_driver_reroute_api.py, test_golden_path_e2e.py, test_navigation_package.py +6 | IMPLEMENTED |
| 78 | `DELETE` | `/api/trips/{trip_id}/simulation` | JWT | trip:dispatch | in-memory scenario (DEMO only) | ops tooling only | test_simulation.py | IMPLEMENTED (demo tooling) |
| 79 | `POST` | `/api/trips/{trip_id}/simulation` | JWT | trip:dispatch | in-memory scenario (DEMO only) | ops tooling only | test_simulation.py | IMPLEMENTED (demo tooling) |
| 80 | `POST` | `/api/trips/{trip_id}/stops` | JWT | trip:create | C trip_stops (gap opened in two UPDATEs); C trip_events (instruction, requires_ack) | Manager Web | test_midtrip_stops_and_history.py | IMPLEMENTED |
| 81 | `GET` | `/api/trips/{trip_id}/track` | JWT | fleet:location_read | R gps_points (recent) | Manager Web | test_telemetry.py | IMPLEMENTED |
| 82 | `GET` | `/api/trucks` | JWT | truck:read | R trucks | Manager Web, Driver App | test_api_fleet.py, test_audit.py, test_authorization.py +1 | IMPLEMENTED |
| 83 | `POST` | `/api/trucks` | JWT | truck:create | C trucks; C audit_logs | Manager Web, Driver App | test_api_fleet.py, test_audit.py, test_authorization.py +1 | IMPLEMENTED |
| 84 | `GET` | `/api/trucks/{truck_id}` | JWT | truck:read | R trucks | Manager Web | test_api_fleet.py, test_audit.py | IMPLEMENTED |
| 85 | `PATCH` | `/api/trucks/{truck_id}` | JWT | truck:update | U trucks; C audit_logs | Manager Web | test_api_fleet.py, test_audit.py | IMPLEMENTED |
| 86 | `POST` | `/api/trucks/{truck_id}/retire` | JWT | truck:retire | U trucks.status=RETIRED, deleted_at; C audit_logs | Manager Web | test_api_fleet.py | IMPLEMENTED |
