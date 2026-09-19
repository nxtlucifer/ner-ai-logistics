# RASTA AI — Frontend ↔ Backend ↔ Database Integration Evidence (Day 2 · Task 1)

```text
Manager Web (React + TypeScript + Vite)          Driver App (React Native + Expo; APK + web)
   manager-web/src/api/client.ts                     driver-app/src/api/client.ts
              │  fetch(`${API_BASE_URL}/api/…`, Bearer JWT)          │
              ▼                                                       ▼
        FastAPI backend  backend/app/main.py  →  routers  →  services  →  SQLAlchemy async (psycopg)
              │
              ▼
        PostgreSQL + PostGIS   (Supabase PG 17.6 / PostGIS 3.3 hosted · isolated PG 18.2 / PostGIS 3.6 local)
```

**One transport.** Both clients use the same REST client shape against the same FastAPI service
(`VITE_API_BASE_URL` / `EXPO_PUBLIC_API_BASE_URL`); the hosted manager and the APK talk to
`https://ner-intelligence.onrender.com`, the local stack to `http://127.0.0.1:8010`. The Supabase
client transport still exists in both code bases but is not the demo path (`docs/ARCHITECTURE.md`,
`render.yaml`).

**How this evidence was produced (19 Sep 2026, local stack).** Backend `.runtime/start-demo-backend.sh`
(port 8010, `DATABASE_PROVIDER=local`, demo clone DB), manager `npm run dev` (5173), driver
`npx expo start --web` (8123). A headless Chromium (`.runtime/day2/evidence.mjs`, `evidence2.mjs`,
`evidence3.mjs`) signed in as the demo manager and the demo driver, walked the screens, and **recorded
every `/api` response the pages received** (method, path, status). The trip used in pass 2/3
(`HILL-F5BF1C`) was created through the real APIs by `.runtime/demo.py reset → dispatch → start`
(plan → route → manager approval → dispatch → driver accept → truck verification photo → start).
Result files: `docs/submission/day2/task1/evidence-results*.json`; screenshots in
`docs/submission/day2/task1/screenshots/`. 24/24 checks passed across the three passes; zero 5xx.

---

## A. Manager Web → FastAPI → PostgreSQL

| # | Screen / action | Endpoint called (observed) | Backend handler | Table(s) read / written | Visible result | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | **Sign in** (`LoginPage`) with the manager e-mail | `POST /api/auth/login` → 200; then `GET /api/auth/me` → 200 (a fresh browser first tries `POST /api/auth/refresh` → 401, the silent-restore path, by design) | `api/auth.py: login`, `me` | R `users`, C `refresh_tokens`, C `audit_logs (LOGIN)` | Console opens on **Fleet command**, sidebar shows "Demo Manager · MANAGER" | `07_manager_backend_integration_fleet.png` |
| A2 | **Fleet command** page | `GET /api/fleet/active` → 200, `GET /api/trips` → 200, `GET /api/emergencies/active` → 200, `GET /api/drivers`, `GET /api/trucks`, `GET /api/assignments` → 200; `GET /ready` → 200 (connectivity badge) | `api/trips.py: active_fleet`, `list_trips`; `api/emergencies.py: list_active_emergencies` | R `trips ⨝ gps_points` (last fix per truck, PostGIS), `emergencies`, `drivers`, `trucks`, `driver_truck_assignments` | "ACTIVE TRIPS 1 · ACTIVE DRIVERS 1 transmitting GPS · LIVE 1"; marker **AS86QQ7606** on the map — the position the driver app posted seconds earlier | `07_manager_backend_integration_fleet.png` |
| A3 | **Drivers** page | `GET /api/drivers` → 200, `GET /api/assignments` → 200, `GET /api/files/{id}` → 200 (profile photos) | `api/fleet.py: list_drivers`; `api/files.py: read` | R `drivers`, `driver_truck_assignments`, `stored_files` | Driver table with status, licence, pairing; Add driver form (server 422s are mapped onto fields — Day 1 evidence `10-drivers-validation-422.png`) | `07b_manager_drivers_list.png` |
| A4 | **Trucks** page | `GET /api/trucks` → 200, `GET /api/assignments` → 200 | `api/fleet.py: list_trucks` | R `trucks` | Truck table (registration, capacity, status, current driver) | `07c_manager_trucks_list.png` |
| A5 | **Trips → Open trips** (server-side list) | `GET /api/trips?open_only=true&limit=20…` → 200 (repeated per filter change) | `api/trips.py: list_trips` | R `trips ⨝ shipments` with `total` | "5 shown of 5 matching · page 1 of 1"; **HILL-F5BF1C · RASTA Demo Driver · AS86QQ7606 · Selected · ACTIVE · On the road · Open / Change journey** | `09_trip_workflow_trips_list.png` |
| A6 | **Trips → Open** the ACTIVE trip (route review panel) | `GET /api/trips/{id}` → 200, `GET /api/trips/{id}/routes` → 200 | `api/trips.py: get_trip`, `list_routes` | R `trips`, `trip_stops`, `trip_routes`, `route_review_authorizations` | "PRIMARY · 9:58:08 AM · Assigned", "Approved by **Demo Manager** (manager) · 9/19/2026, 9:58:14 AM · rationale" — the `route_review_authorizations` row written by `/approve` | `09c_trip_review_panel.png`, `09d_trip_journey_history.png` |
| A7 | **Trips → History** tab | `GET /api/trips?open_only=false&limit=20` → 200 | `api/trips.py: list_trips` | R `trips` (terminal states only) | "20 shown of 69 matching · page 1 of 4", every row CLOSED with only **View** — the server, not the browser, decides what history is | `09d_trip_journey_history.png` |
| A8 | **Diagnostics** page | `GET /api/system/providers` → 200, `GET /ready` → 200 | `api/health.py: providers`, `ready` | provider health cache; `SELECT version(), postgis_version()` | Database and PostGIS shown reachable; each external provider with status and freshness | `07d_manager_diagnostics_providers.png` |
| A9 | Session keep-alive while browsing | `POST /api/auth/refresh` → 200 (rotation) | `api/auth.py: refresh` | U `refresh_tokens` (rotate within the family) | No re-login during the session | (network log) |

Observed manager call log (pass 1, 102 responses; pass 2, 46): only 2xx, plus the single expected 401 on
the pre-login refresh probe. No 5xx, no uncaught exceptions, no console errors.

## B. Driver App → FastAPI → PostgreSQL

| # | Screen / action | Endpoint called (observed) | Backend handler | Table(s) read / written | Visible result | Screenshot |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | **Sign in** with the driver phone number | `POST /api/auth/login` → 200 (`client: mobile`), `GET /api/auth/me` → 200, `GET /api/driver/me` → 200 | `api/auth.py: login`; `api/driver.py: me` | R `users`, `drivers`; C `refresh_tokens`, `audit_logs` | Header "Good morning, RASTA Demo Driver · GPS live · AS65DC89C22121" | `08_driver_backend_integration_trip.png` |
| B2 | **Trip** tab (current trip) | `GET /api/driver/me/trip` → 200 (polled), `GET /api/driver/me/profile` → 200, `GET /api/driver/me/assignment` → 200, `GET /api/driver/me/notices` → 200, `GET /api/files/{id}` → 200 | `api/driver.py: my_trip`; `api/documents.py: my_profile` | R `trips`, `trip_stops`, `trip_routes`, latest `gps_points` (progress), `driver_truck_assignments`, `driver_notifications` | "CURRENT TRIP · ACTIVE · HILL-F5BF1C · PICKUP Guwahati Depot · DESTINATION Shillong Depot", truck **AS86QQ7606 · verified**, "Connection Connected · Last sync 5s ago" | `08_driver_backend_integration_trip.png` |
| B3 | **Navigate** tab | `GET /api/driver/me/trip/navigation` → 200, `GET /api/driver/me/trip/offline-package` → 200, `GET /api/driver/me/trip/route-risk` → 200 | `api/driver.py: my_navigation_package`, `my_offline_package`, `my_route_risk` | R `trip_routes.maneuvers`, `trip_routes.geometry` (4,341 points, 98.82 km), risk evidence | Turn-by-turn ("1.4 km · Turn straight onto…, then Turn left"), route line, "LANDSLIDE EXPOSURE AHEAD · CAUTION" advisory with its evidence count, ETA bar (1 h 15 min · 95.8 km remaining) | `08b_driver_navigate_guidance.png` |
| B4 | **GPS upload** (simulated fix 3 km along the route) | `POST /api/driver/me/location` → **202** | `api/driver.py: submit_location` | **C `gps_points`** (server sets trip/driver/truck, unique `device_fix_id`) | Header switches to "GPS live"; seconds later the manager's Fleet page shows the truck **LIVE** at that position (A2) — the same row read back through `GET /api/fleet/active` | `08b_…` + `07_…fleet.png` |
| B5 | **More** tab (profile, documents, language, sign-out) | `GET /api/driver/me/profile` → 200, `GET /api/driver/me/documents` (when opened) | `api/documents.py` | R `drivers`, `driver_documents` (masked) | Profile card, document status | `08c_driver_more.png` |
| B6 | With **no** active trip (pass 1, before the seed) | `GET /api/driver/me/trip` → 200 (`null` trip), `GET /api/driver/me/trip/route-risk` → 404 (expected — nothing to assess) | `api/driver.py` | R `trips` | "No active trip — you are available for assignment" | (pass-1 shot of `08_…`, overwritten by pass 2) |

Observed driver call log (pass 2, 25 responses): all 2xx, GPS accepted with 202. The three console warnings
were blocked map-tile images in the headless profile (`ERR_BLOCKED_BY_ORB`), not application errors.

## C. Full trip workflow through the API (`.runtime/demo.py`, real endpoints, 19 Sep 09:58–09:59 IST)

| Step | Actor | Endpoint | Status | Database effect |
| --- | --- | --- | --- | --- |
| 1 | manager | `POST /api/assignments` | 201 | previous pairing ENDED, new row ACTIVE |
| 2 | manager | `POST /api/trips/plan` | 201 `HILL-F5BF1C` | `shipments` + `cargo_items` + `trips` + 2 `trip_stops` + `trip_events(CREATED)` + `audit_logs` in one transaction |
| 3 | manager | `POST /api/trips/{id}/routes/recalculate?detailed=true` | 201 | `trip_routes` PRIMARY 98.82 km (+ backup options) |
| 4 | manager | `POST /api/trips/{id}/routes/{rid}/select` | **422** `ROUTE_REVIEW_REQUIRED` | refused: hazard evidence incomplete (no landslide dataset configured locally) |
| 5 | manager | `POST /api/trips/{id}/routes/{rid}/approve` | 200 | `route_review_authorizations` issued + consumed, `trips.selected_route_id` set, event + audit |
| 6 | manager | `GET /api/trips/{id}/routes/{rid}/risk` | 200 | evidence warmed (7/11 factors, terrain) |
| 7 | manager | `POST /api/trips/{id}/dispatch` | 200 → ASSIGNED | `trip_events(DISPATCHED)`, `driver_notifications` |
| 8 | driver | `POST /api/driver/me/trip/accept` | 200 (`ASSIGNMENT_NOT_VERIFIED` hint) | acceptance recorded; start still gated on truck verification |
| 9 | driver | `POST /api/files?kind=TRUCK_VERIFICATION` → `POST /api/driver/me/assignment/verify` | 201 / 200 | `stored_files` (photo), `driver_truck_assignments.verified_at` |
| 10 | driver | `POST /api/driver/me/trip/start` | 200 → **ACTIVE** | `trips.started_at`, `trip_events(STARTED)`, driver/truck `ON_TRIP` |
| 11 | driver app | `POST /api/driver/me/location` | 202 | `gps_points` rows (seen on the manager's Fleet page) |

Database check after step 10 (`ner_logistics_demo`): `trips.status = ACTIVE`, `trip_events` =
CREATED → ASSIGNED → ACCEPTED → STARTED, `audit_logs` for the trip = CREATE + 3 × STATUS_CHANGE.

## D. Hosted stack (read-only checks this morning)

| Check | Result |
| --- | --- |
| `GET https://ner-intelligence.onrender.com/health` | `200 {"status":"ok"}` |
| `GET https://ner-intelligence.onrender.com/ready` | `200 provider=supabase, PostgreSQL 17.6, PostGIS 3.3` |
| Manager `https://ner-manager.onrender.com`, driver web `https://ner-driver-web.onrender.com`, APK `release/RASTA-AI-1.0.18.apk` | built from the same clients against the same API (`render.yaml`, `driver-app/eas.json`); the last full hosted manager+driver run is recorded in `docs/terrain/HANDOFF.md` §20 (18 Sep, 32/33) |

## E. Screenshot index for the submission

| Required name | Use this file | Status |
| --- | --- | --- |
| `01_backend_health.png` | `docs/submission/day2/task1/screenshots/01_backend_health.png` | captured |
| `02_backend_ready_database.png` | `…/02_backend_ready_database.png` | captured |
| `03_fastapi_swagger.png` | `…/03_fastapi_swagger.png`, `…/03b_fastapi_swagger_trips.png` | captured |
| `04_api_login_success.png` | NEEDS MANUAL SCREENSHOT — Swagger *Try it out* on `POST /api/auth/login`, or the terminal output of `python docs/submission/day2/task1/api_evidence.py` (`[PASS] POST /api/auth/login -> 200`) | manual |
| `05_api_crud_example.png` | NEEDS MANUAL SCREENSHOT — terminal lines `POST /api/drivers -> 201`, `GET`, `PATCH -> 200`, `deactivate -> 200` from the same run | manual |
| `06_database_tables.png` | NEEDS MANUAL SCREENSHOT — Supabase Table Editor or pgAdmin listing the 20 tables (the local cluster: `127.0.0.1:55432/ner_logistics_demo`) | manual |
| `07_manager_backend_integration.png` | `…/07_manager_backend_integration_fleet.png` (+ `07b`, `07c`, `07d`) | captured |
| `08_driver_backend_integration.png` | `…/08_driver_backend_integration_trip.png` (+ `08b`, `08c`) | captured |
| `09_trip_workflow.png` | `…/09_trip_workflow_trips_list.png` (+ `09c`, `09d`) | captured |
| `10_test_results.png` | NEEDS MANUAL SCREENSHOT — terminal after `pytest` (`1210 passed, 5 skipped`), `npm test` (259 / 624) | manual |
| `11_er_diagram.png` | `docs/submission/day2/task1/er-diagram.png` (also `.svg`) | captured |

The trip `HILL-F5BF1C` was left **ACTIVE on the local demo database** so the same screens can be
re-shot by hand (`bash .runtime/start-demo-backend.sh`, manager on 5173, driver web on 8123 with
simulated GPS). `python .runtime/demo.py finish` completes it; `python .runtime/demo.py cancel` clears it.
