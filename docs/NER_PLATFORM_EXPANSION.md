# RASTA AI: from the truck core to a North-East logistics platform

**Owner:** CTO + VP Product (lane `platform-expansion`)
**Written:** 26 September 2026. Revised the same day after review; section 9
lists what changed.
**Scope:** how to grow the verified truck and driver core into a platform for
vans and last-mile delivery, essential and emergency cargo, depots and hubs,
road-rail, road-air and road-inland-waterway transfer points, and more actor
roles, without breaking the truck workflow.

This is a plan. Nothing in it has been built, migrated or deployed. This lane
created one file: this one.

---

## 0. How to read this document

Every claim carries exactly one evidence label.

| Label | Meaning in this document |
|---|---|
| `PROVEN_BY_TEST` | a test run in this lane produced the stated result, pass or fail (command, count and time in section 8) |
| `PROVEN_BY_RUNTIME` | a command run in this lane produced the stated output |
| `PROVEN_BY_DATABASE` | a read-only query in this lane against the isolated cluster (127.0.0.1:55432) returned it |
| `PROVEN_BY_SOURCE` | the cited `file:line` says it (working tree unless marked E4) |
| `PROVEN_BY_WEB` | a page fetched in this lane says it (URL given) |
| `INFERRED` | reasoning from the evidence, or a design decision. Not a fact |
| `NOT_VERIFIED` | not checked in this lane |
| `BLOCKED` | an attempt to check failed |

Line references: **WT** means the working tree (local `main` 5b5e474 plus the
dirty tree). **E4** means `e4043ce`, the commit hosted runs. When a line exists
in both, both numbers are given. "WT only" means it arrives with the 38-commit
integration plan (`docs/POST_DEMO_CHANGE_INVENTORY.md`), mostly with migration
0013.

---

## 1. Starting point

### 1.1 What the problem statement asks

Read from https://sih.gov.in/sih2026PS on 26 September 2026. The fetch tool
returns a summary of the page, so treat the wording below as close, not exact.

- SIH26002 (MDoNER) asks for GPS tracking of vehicles that carry essential
  commodities, medicines, agricultural produce and construction materials.
  `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- It asks that field officials and local authorities can upload geo-tagged
  updates, photographs and incident reports. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- It asks for district-wise connectivity status, alerts for blocked roads and
  delayed deliveries, multilingual notifications, offline sync, and integration
  with weather APIs and transport databases. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- A second read of the same page, asked specifically, found no mention of rail,
  air, inland waterways, warehouses or depots, vehicle types, or the word
  "truck". `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS

What follows for this plan: essential-cargo priority and field-official reports
are named requirements. Vans, hubs and rail, air or water transfers are not
named. They can only be tied to "limited transport connectivity" and "transport
databases", which is an indirect link. `INFERRED`

### 1.2 What the code supports today (section 6 has the full list)

- One road goods vehicle (a row in `trucks`), one driver and one shipment per
  trip, ordered stops, a weight capacity gate, OSRM road routing, phone GPS,
  route-risk review, SOS. `PROVEN_BY_SOURCE` backend/app/models/operations.py:198-206; backend/app/services/trips.py:729-744
- The isolated test database at `0013_state_district_inbox` has 24 domain
  tables plus `alembic_version`. None of them is a hub, organisation, road
  report, transfer or non-road asset table. `PROVEN_BY_DATABASE` ner_logistics_test
- At the time of this lane's first run (before 18:08 on 26 Sep 2026), the truck
  core passed on the working tree: 225 backend tests in 10 files, 53 manager
  tests, 3 driver tests. `PROVEN_BY_TEST` (section 8)
- On a re-run at 18:21 the same day, the driver pair gave 1 failed and 2 passed.
  `driver-app/src/i18n/coverage.test.ts` fails with "untranslated: 10-digit
  mobile number", so that phrase lacks a complete hi/gu/as/bn entry.
  `PROVEN_BY_TEST` (section 8)
- The phrase is the login placeholder. `PROVEN_BY_SOURCE` driver-app/src/screens/LoginScreen.tsx:176
- LoginScreen.tsx was last modified at 18:09:15, after this document was first
  written (18:08:09). This lane did not edit it. `PROVEN_BY_RUNTIME` (file
  modification times)
- So the driver half of the regression gate (4.2) is red on the current tree.
  The fix (add the four translations in phrases.ts, or revert the placeholder)
  belongs to whoever owns that edit. This lane does not touch LoginScreen.tsx or
  phrases.ts. `INFERRED`

### 1.3 Three findings that shape the plan

1. **Priority exists, but nobody can set it.** `shipments.priority`
   (LOW, NORMAL, HIGH, CRITICAL) has existed since migration 0002 and the API
   accepts it. The manager plan form never sends it, and it hardcodes
   `cargo_type: 'GENERAL'`. `PROVEN_BY_SOURCE` backend/app/schemas/domain.py:248 (E4 :239); manager-web/src/pages/TripsPage.tsx:357-376 (E4 :348-367)
   - In the demo database all 73 shipments are `NORMAL`, and every cargo line is
     `GENERAL` or `General`. `PROVEN_BY_DATABASE` ner_logistics_demo (0012), read-only
2. **Shipment status never moves.** No code path writes `shipments.status`
   after creation. A grep for `ShipmentStatus.` and `UPDATE shipments` over
   backend/app, backend/alembic and supabase/migrations finds only the enum, the
   model, the schema and the weight trigger. `PROVEN_BY_SOURCE` backend/alembic/versions/0002_core_domain.py:165-181
   - In the demo database 73 of 73 shipments are `DRAFT`, including the ones
     whose trips are `CLOSED` (39) or `DELIVERED` (10). `PROVEN_BY_DATABASE` ner_logistics_demo, read-only
   - A consignment that passes through a hub or a railhead cannot be followed
     until this is fixed. `INFERRED`
3. **Two planning implementations exist.** The hosted manager uses the REST
   client against FastAPI (`VITE_BACKEND` is `local`). `PROVEN_BY_SOURCE` render.yaml E4 :123-124
   - The `preview` and `production` EAS profiles of the driver app select the
     Supabase-direct backend, and `supabase/migrations/20260907120800_manager_plan_trip.sql`
     plans trips on its own, with its own capacity check. `PROVEN_BY_SOURCE` driver-app/eas.json:13, :25; supabase/migrations/20260907120800_manager_plan_trip.sql:141,160,175
   - Two more EAS profiles, `lan-demo` and `remote-demo`, extend `preview` but set
     `EXPO_PUBLIC_BACKEND` to `local`, the FastAPI path. `PROVEN_BY_SOURCE` driver-app/eas.json:31-38, :43-50
   - A new server rule added only in FastAPI does not exist on that path. `INFERRED`
   - Which build profile produced the APK in use was not checked here. The file
     name `rasta-driver-1.0.22-local.apk` (docs/POST_DEMO_STATE.md:70) fits one
     of the two `local` profiles, but a file name is not proof. `NOT_VERIFIED`

---

## 2. Truck-assumption map

"Generic-able" asks one question: can this serve a van, a hub or a multi-leg
consignment without breaking the truck flow?
- **YES**: usable as it is, or with an additive change.
- **RISKY**: usable, but changing it can break trucks or shipped clients.
- **NO**: cannot serve the new case.

### 2.1 Backend models, enums and schemas

| # | Where (WT) | On E4? | Assumption | Generic-able | Why | Label |
|---|---|---|---|---|---|---|
| T1 | backend/app/models/fleet.py:28-35 | yes, :28-35 | Class `Truck`, table `trucks`. The docstring chooses "truck" on purpose and rejects "vehicle". | RISKY | A rename touches every FK, API path and the Supabase SQL. Keep the name and treat `trucks` as the vehicle table. | `PROVEN_BY_SOURCE` |
| T2 | fleet.py:38, :107-112 | yes, :38, :101-106 | `registration_number` String(20), unique among rows that are not deleted | YES road, NO non-road | Every Indian road vehicle has a plate. Rail wagons, aircraft and vessels are not operated through this platform (G10). | `PROVEN_BY_SOURCE` |
| T3 | backend/app/schemas/domain.py:30 | yes, :30 | `REGISTRATION_PATTERN` accepts state-series plates only | YES for state-series goods vehicles | Accepts `AS01AB1234`, `AS-01-AB-1234` and `ML05Z9999`. Rejects `12BH3456AA` and `T1123LA0123A`. | `PROVEN_BY_RUNTIME` |
| T3a | same | same | The two rejected shapes follow the Bharat-series and temporary-registration formats | n/a | This is a secondary source, and it describes BH eligibility as employee vehicles. Whether a goods vehicle may carry either format was not checked. | `PROVEN_BY_WEB` https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_India |
| T4 | fleet.py:46 | yes, :40 | `truck_type` is free text, String(40) | YES | A van can be recorded today as `truck_type = 'LCV'` with no migration. Demo values: Container 4, Open body 1, null 2. | `PROVEN_BY_DATABASE` ner_logistics_demo |
| T5 | fleet.py:51-60, :95-98; schemas/domain.py:110 | yes, :45-54, :89-92; schema :106 | `max_capacity_kg` is NOT NULL, above 0 and at most 100000. A database check enforces `current_load_kg <= max_capacity_kg`. | YES | A van also has a payload in kg. Volume is not modelled, which matters for parcels (`INFERRED`). The constraint exists in the test DB (`PROVEN_BY_DATABASE`). | `PROVEN_BY_SOURCE` |
| T6 | fleet.py:62-67 | yes, :56-61 | `axle_count`, `height_m`, `length_m` and `fuel_tank_capacity_l` are all nullable | YES | Nothing uses height or length for routing. The `truck_restrictions` risk factor is marked unavailable. | `PROVEN_BY_SOURCE` backend/app/domain/route_risk.py:97,103-107 |
| T7 | fleet.py:70; backend/app/domain/fuel_model.py:21-25 | yes, :64; :21-25 | Fuel-model constants are for "a standard multi-axle Indian freight truck (16T-28T GVW)" | RISKY | Dormant: `estimate_fuel` has no production caller, and route rows are written with no fuel figure. If it is ever wired in, it must branch on vehicle class or return unknown for vans. | `PROVEN_BY_SOURCE` backend/app/services/routes.py:404-406; grep finds no caller of `estimate_fuel(` outside fuel_model.py |
| T8 | fleet.py:121-165; backend/app/models/enums.py:92-99 | yes, :115-159; :80-87 | Truck papers: RC, insurance, fitness, PUC, national permit, state permit | YES | Light goods vehicles carry the same kinds of documents (`INFERRED`). Whether permit rules differ for them is `NOT_VERIFIED`. | `PROVEN_BY_SOURCE` |
| T9 | fleet.py:203, :278-293 | yes, :197, :272-287 | At most one current driver per truck, and one current truck per driver (partial unique indexes) | RISKY | This blocks a two-driver long-haul crew and a van with a helper. Keep it for v1, because dispatch and the sentinel depend on it. | `PROVEN_BY_SOURCE` |
| T10 | enums.py:84-89 | yes, :72-77 | `TruckStatus`: AVAILABLE, ON_TRIP, MAINTENANCE, BREAKDOWN, RETIRED | YES | These words fit any vehicle. | `PROVEN_BY_SOURCE` |
| T11 | backend/app/models/operations.py:198-206 | yes, :183-191 | A trip has exactly one shipment, one truck and one driver (NOT NULL FKs) | RISKY | Every trip is a driven road vehicle. So a rail, air or water leg cannot be a `Trip` and needs its own record (step 0018). | `PROVEN_BY_SOURCE` |
| T12 | operations.py:322 | yes, :307 | `ix_trips_shipment` is not unique, so one shipment can have several trips | YES | This is the basis for multi-leg, but there is no leg order. In the demo DB, 72 shipments have 1 trip and 1 shipment has 2. | `PROVEN_BY_DATABASE` ner_logistics_demo |
| T13 | enums.py:126-131 | yes, :114-119 | `ShipmentStatus` exists, but nothing advances it (finding 2) | RISKY | Following a consignment across legs needs a status that moves. | `PROVEN_BY_SOURCE` |
| T14 | enums.py:119-123; operations.py:96-100; schemas/domain.py:248 | yes, :107-111, :96-100, :239 | `CargoPriority` is stored and defaults to NORMAL. Its only reader is the SOS briefing. | YES | Ready for essential cargo, but the console never sets it (T30). | `PROVEN_BY_SOURCE` backend/app/domain/sentinel.py:355 |
| T15 | enums.py:152-165 | yes, :140-153 | `TripStopKind`: PICKUP, DROPOFF, REST, FUEL, CHECKPOINT, OTHER. Docstring: "Why the truck stops here." | YES | A HANDOVER label can be added later (additive). | `PROVEN_BY_SOURCE` |
| T16 | operations.py:566 | yes, :551 | Every GPS fix carries a `truck_id` | YES | Works for vans as long as vans live in `trucks`. | `PROVEN_BY_SOURCE` |
| T17 | operations.py:172-177 | yes, :157-162 | `cargo_items.is_hazardous` and `is_perishable` are accepted and stored. No rule reads them, and the console never sets them. | YES | Useful for medicines and perishables once they are shown. | `PROVEN_BY_SOURCE` (grep over backend/app, manager-web/src, driver-app/src) |

### 2.2 Backend services and API

| # | Where (WT) | On E4? | Assumption | Generic-able | Why | Label |
|---|---|---|---|---|---|---|
| T18 | backend/app/services/trips.py:103-108, :729-744 | yes, :98-103, :687-702 | `UNUSABLE_TRUCK_STATUSES`. The capacity gate checks weight only and returns `CAPACITY_EXCEEDED`. | YES | Applies unchanged to vans. | `PROVEN_BY_SOURCE` |
| T19 | trips.py:338-344 | yes, :299-305 | Error code `TRUCK_RESERVED_BY_TRIP` | YES | Keep the code string, because clients may match on it. | `PROVEN_BY_SOURCE` |
| T20 | backend/app/services/driver_trips.py:261-262; backend/app/services/assignments.py:233 | yes, :261-262; :233 | A truck goes ON_TRIP at start. Retired or broken-down trucks are refused for assignment. | YES | Nothing here is specific to trucks. | `PROVEN_BY_SOURCE` |
| T21 | trips.py:1085-1090, :1155-1170 | yes, :883-888, :953-968 | "Return to depot" sends the vehicle back to the trip's pickup stop | RISKY | This assumes the depot is the pickup. Once hubs exist, a depot is a different place. | `PROVEN_BY_SOURCE` |
| T22 | backend/app/services/routing/osrm.py:104; backend/app/services/routes.py:117-131 | yes | Routing uses the OSRM `driving` profile of the configured server, and nothing overrides the profile | YES for vans | For trucks this gap already exists and is disclosed: there are no heavy-vehicle restrictions. | `PROVEN_BY_SOURCE` |
| T23 | osrm.py (never reads `RouteStep.mode`) | yes | Ferry segments inside a road route are not flagged, even though `RouteCandidate.warnings` has a slot for "ferry" | RISKY for river crossings | OSRM documents a per-step `mode` field (`PROVEN_BY_WEB` https://project-osrm.org/docs/v5.24.0/api/). Whether it returns ferry steps on NER routes is `NOT_VERIFIED`. | `PROVEN_BY_SOURCE` backend/app/domain/routing.py:392-394; grep of osrm.py for `mode`, `ferry` and `warnings` is empty |
| T24 | backend/app/domain/route_risk.py:144-147 | yes, :144-147 | Wind-gust thresholds are set for a loaded high-sided truck | YES | For a van they err on the cautious side. | `PROVEN_BY_SOURCE` |
| T25 | backend/app/domain/sentinel.py:309-356 | yes, :309-356 | The SOS briefing snapshot uses keys `truck.registration`, `truck.model` and `cargo.priority`, and is frozen into `emergencies.briefing_snapshot` | YES | Keep the key names, because old snapshots are evidence and must stay readable. | `PROVEN_BY_SOURCE` backend/app/models/emergency.py:86 |
| T26 | trips.py:1003, :1073 | WT only | Notification payloads carry a `truck` key holding the registration | YES | Keep the key. | `PROVEN_BY_SOURCE` |
| T27 | backend/app/api/fleet.py:183; backend/app/core/permissions.py:33-36 | yes, :183; :33-36 | `/api/trucks` and the permissions `truck:read`, `truck:create`, `truck:update`, `truck:retire` | YES | A van is another row of the same resource, so no new permission is needed. | `PROVEN_BY_SOURCE` |
| T28 | backend/app/api/driver.py:94-114; backend/app/api/documents.py:129-131, :236-242; backend/app/api/files.py:54 | yes, :90-110; :113-115, :201-207; :54 | Driver API names: `TruckSummary`, `truck`, `truck_registration`, `truck_verified`, `/api/driver/me/truck-documents`, and file kinds `TRUCK_VERIFICATION`, `TRUCK_PHOTO`, `TRUCK_DOCUMENT` | YES | Keep every name, because the shipped driver app reads them (T34). | `PROVEN_BY_SOURCE` |
| T29 | schemas/domain.py:275-290 | yes, :266-281 | The service region is a single bounding box around the eight states | YES | A hub outside the box, such as a Kolkata railhead, would be refused. That is correct for this product. | `PROVEN_BY_SOURCE` |

### 2.3 Manager console

| # | Where (WT) | On E4? | Assumption | Generic-able | Why | Label |
|---|---|---|---|---|---|---|
| T30 | manager-web/src/pages/TripsPage.tsx:357-376 | yes, :348-367 | The plan form sends `cargo_type: 'GENERAL'` and `cargo_name: 'Consignment'`, and sends no `priority` | YES | This alone stops managers from marking essential cargo (fixed by step A0). | `PROVEN_BY_SOURCE` |
| T31 | manager-web/src/api/client.ts:399-404, :471-482 | yes, :368-373, :437-448 | `Truck` interface and `TruckStatus` union | YES | Add `vehicle_class?` as an optional field later. | `PROVEN_BY_SOURCE` |
| T32 | manager-web/src/App.tsx:87; manager-web/src/pages/planValidation.ts:219-220; manager-web/src/components/AssignTruckDialog.tsx:175 | yes, :39; :219-220; :175 | Nav label "Trucks"; a client-side copy of the weight check; capacity in kg in the pickers | YES | These are copy and a mirror of the server check. | `PROVEN_BY_SOURCE` |
| T33 | manager-web/src/pages/FleetPage.tsx:1657; manager-web/src/api/supabaseManagerApi.ts:472 | yes, :1603; :472 | The fallback priority is `'STANDARD'`, which is not a `CargoPriority` value | YES | A display defect. Fix it in step A0. | `PROVEN_BY_SOURCE` |

### 2.4 Driver app

| # | Where (WT) | On E4? | Assumption | Generic-able | Why | Label |
|---|---|---|---|---|---|---|
| T34 | driver-app/src/api/client.ts:372-391, :432-434 | yes, :343-362, :403-405 | `TruckSummary`, `truck_registration`, `truck_photo_url`, `truck_verified` | YES | Keep the names. | `PROVEN_BY_SOURCE` |
| T35 | driver-app/src/screens/AssignmentScreen.tsx:265, :281, :317 | yes, :271, :287, :323 | Copy: "Your truck", capacity in kg, "Registration on the truck" | RISKY | Every new or changed phrase needs all four translations in phrases.ts, or `coverage.test.ts` fails. | `PROVEN_BY_SOURCE` driver-app/src/i18n/coverage.test.ts:1-7 |
| T36 | driver-app/src/i18n/phrases.ts:290, :432, :619 | yes, :105, :247, :434 | Translated phrases "Truck", "Truck access (HGV)" and "Truck problem" | RISKY | Same translation gate. Reviewing translations is work for a person, not code. | `PROVEN_BY_SOURCE` |

### 2.5 Supabase-direct path

| # | Where | On E4? | Assumption | Generic-able | Why | Label |
|---|---|---|---|---|---|---|
| T37 | supabase/migrations/*.sql (7 of 11 files reference `trucks` or `truck_id`); `20260907120800_manager_plan_trip.sql:141,160,175` | yes (11 files on E4) | A second planning implementation. It writes priority (default NORMAL) and cargo_type (default GENERAL), and runs its own capacity check. | RISKY | New columns with server defaults will not break it (`INFERRED`). New rules added only in FastAPI will be missing from it (`INFERRED`). The owner has to decide whether to retire this path or keep it updated. | `PROVEN_BY_SOURCE` |

**Cost of a rename.** `grep -rci truck --include=*.py --include=*.ts --include=*.tsx`
over backend/app, manager-web/src and driver-app/src, with test files removed
(paths containing `.test.`, `/tests/` or `test_`), gives 760 hits in 58 backend
files, 466 in 29 manager files and 239 in 40 driver-app files. JSON and CSS
files are not counted, so these numbers are a floor. `PROVEN_BY_RUNTIME`

---

## 3. Target model: which current table plays each role

| Concept | Current table(s) | Plays the role today? | Gap | Label |
|---|---|---|---|---|
| Vehicle / Asset | `trucks`, `truck_documents`, `truck_maintenance` | Yes, for Indian road goods vehicles | No class column (van or truck). Non-road assets are out of scope. | `PROVEN_BY_SOURCE` backend/app/models/fleet.py:28-200 |
| Shipment / Consignment | `shipments`, `cargo_items` | Partly | Status never advances (finding 2). Priority and category are never set from the console (finding 1). | `PROVEN_BY_DATABASE` ner_logistics_demo |
| Trip / Journey | `trips` | Yes, for one road leg | The trips of one shipment have no leg order. A non-road leg cannot be a trip (T11). | `PROVEN_BY_SOURCE` operations.py:191-323 |
| Stop | `trip_stops` | Yes | A stop cannot point to a named, reusable place. The default geofence is 200 m. | `PROVEN_BY_SOURCE` operations.py:326-380 |
| Hub (depot, warehouse, transfer point) | none | No | The "depot" is the pickup stop (T21). The `places` layer is an OpenStreetMap snapshot file (ODbL 1.0, retrieved 20 Sep 2026) of fuel, emergency, tyre, hotel and rest points. It does not hold operator hubs. | `PROVEN_BY_SOURCE` backend/app/services/places/data/corridor_snapshot.json (source block) |
| Carrier / Organization | none | No | There is one operator. `states` and `districts` (0013) are administrative geography, not organisations. | `PROVEN_BY_DATABASE` ner_logistics_test table list |
| Operator (people) | `users` (role, state and district scope), `drivers` (1:1 profile) | Yes | There is no field-official role. | `PROVEN_BY_SOURCE` backend/app/models/identity.py:26-210; enums.py:29-49 |
| Route | `trip_routes`, with `route_review_authorizations` as the approval record | Yes, road only | Road geometry comes from OSRM only. | `PROVEN_BY_SOURCE` operations.py:383-475 |
| Evidence | `trip_events` (append-only), `audit_logs`, `stored_files` (BYTEA, 5 MB cap), `gps_points`, `route_review_authorizations`, `emergencies.briefing_snapshot`, `trip_routes.risk_factors` | Yes | No proof-of-delivery record and no road-report record. | `PROVEN_BY_SOURCE` backend/app/models/files.py:36; backend/app/api/files.py:47 |
| Alert | `notifications` (inbox, 0013, WT only), `driver_notifications` (push log, 0012), `emergencies` | Yes | Priority does not reach any alert. | `PROVEN_BY_SOURCE` backend/app/models/notifications.py:39-72 |
| Assignment | `driver_truck_assignments` | Yes | One-to-one only (T9). | `PROVEN_BY_SOURCE` fleet.py:203-296 |

Decision: keep every existing table under its current name. Add at most four
things: a class column on `trucks`, a road-report table, a hub table and a
handover table. `INFERRED`

---

## 4. Migration path

### 4.1 Rules for every step

- **No rename.** Table, column, API path, JSON key, permission string and error
  code names stay the same: `trucks`, `truck_id`, `/api/trucks`, `TruckSummary`,
  `truck:*`, `TRUCK_RESERVED_BY_TRIP`, and the snapshot key `truck`.
  `INFERRED` (policy, based on T25-T28 and T34)
- **Additive only.** New columns are nullable or have a server default. New API
  fields are optional on input and added on output. `INFERRED` (policy, same approach as backend/alembic/versions/0013_state_district_inbox.py:1-5)
- **Enum labels cannot be removed.** PostgreSQL cannot drop an enum label, so a
  rollback leaves the label in place, unused. `PROVEN_BY_SOURCE` backend/app/models/enums.py:240-243
- **New enum labels are committed before they are used**, with
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS` inside `autocommit_block`, as 0013
  does. `PROVEN_BY_SOURCE` 0013_state_district_inbox.py:75-84
- **Why IF NOT EXISTS matters here.** A single-step downgrade leaves the label
  in place, so a plain `ADD VALUE` fails on the next upgrade. The CI migration
  test downgrades all the way to base. `PROVEN_BY_SOURCE`
  backend/tests/test_migrations.py:109-119
- So that test would not catch a missing IF NOT EXISTS. `INFERRED`
- **New tables turn on row-level security**, as 0013 does for its own tables.
  `PROVEN_BY_SOURCE` 0013_state_district_inbox.py:129, :221
- **Every step updates the drift ledger** (`ENUM_LABELS_ADDED_AFTER_0002` and
  `ENUM_TYPES_ADDED_AFTER_0002`). `PROVEN_BY_SOURCE` backend/tests/test_schema_drift.py:78, :90
- **Every migration must survive upgrade, downgrade, upgrade** in the
  destructive migration test, which CI runs against a throwaway container.
  `PROVEN_BY_SOURCE` backend/tests/test_migrations.py:1-25 (the workflow file .github/workflows/migrations.yml exists)
- **Hosted gate.** No numbered step below may run on hosted until migration
  0013 is approved and applied under docs/MIGRATION_0013_DEPLOYMENT_PACKET.md
  and the 0014 renumbering is settled. The code-only steps (A0, R0, R1) need no
  migration and can run against a 0012 database. `INFERRED` (policy)
- **Local proof first.** Each migration is proven on a database the implementer
  creates on the isolated cluster. Never on `ner_logistics_cert`, never on
  hosted. `INFERRED` (policy)

### 4.2 The truck regression gate: green before and after every step

| Suite | Files | Status in this lane |
|---|---|---|
| Backend truck core | test_trip_state, test_fuel_model, test_schemas, test_api_fleet, test_assignment_invariant, test_resource_reservation, test_trip_execution, test_domain_integrity, test_schema_drift, test_trip_multiplicity_invariant | 225 passed `PROVEN_BY_TEST` |
| Backend, also required | test_golden_path_e2e, test_route_api, test_dispatch_route_gate, test_shipment_trip_atomicity, test_trip_release_after_delivery, test_sentinel, test_scope_http_idor, test_state_district_scope, test_input_limits, test_rls_boundary, test_migrations (CI) | not run here `NOT_VERIFIED` |
| Manager | src/pages/planValidation.test.ts, src/pages/TripsPage.test.tsx | 53 passed `PROVEN_BY_TEST` |
| Driver | src/i18n/coverage.test.ts, src/screens/AssignmentScreen.test.tsx | First run (before 18:08): 3 passed. Re-run at 18:21: 1 failed, 2 passed; coverage.test.ts reports "untranslated: 10-digit mobile number" (see 1.2). **Red on the current tree.** `PROVEN_BY_TEST` |
| Full suites | backend, manager and driver, all files | not run here `NOT_VERIFIED` |

The gate has to be green before step A0 starts. As of 18:21 on 26 Sep 2026 the
driver row is not, for a reason outside this plan (1.2). `INFERRED` (policy)

### 4.3 Steps

Migration numbers start after 0013. Number 0014 belongs to the pdf branch
migration.

#### Step A0: essential-cargo priority and category in the plan form

No migration. Recommended: **ADOPT_NOW**.

- **Change.** The manager plan form offers:
  - `priority` (LOW, NORMAL, HIGH, CRITICAL);
  - a fixed `cargo_type` list (MEDICINE, FOOD, AGRICULTURAL_PRODUCE,
    CONSTRUCTION_MATERIAL, GENERAL), written to the existing free-text column.

  The trip list shows a priority badge, and "not recorded" replaces the
  `'STANDARD'` fallback (T33). The list follows the four commodity groups the
  problem statement names. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- **Server.** No change: both planning paths already accept `priority`.
  `PROVEN_BY_SOURCE` schemas/domain.py:248; supabase/migrations/20260907120800_manager_plan_trip.sql:141
- **Rules to keep.**
  - Priority must not relax the route safety gate. `PROVEN_BY_SOURCE` backend/app/domain/route_eligibility.py:21
  - Priority must not raise a notification to URGENT, which is reserved for a
    person asking for help. `PROVEN_BY_SOURCE` enums.py:326-332 (WT only)
- **Placement.** Right after integration-plan commit 10. That is the only plan
  commit that touches TripsPage.tsx, so A0 stays in the prefix that can deploy
  on 0012. `PROVEN_BY_SOURCE` docs/POST_DEMO_CHANGE_INVENTORY.md:340
- **Tests.**
  - A new TripsPage test that the plan payload carries the chosen priority and
    category.
  - A new backend API test that a plan sent with `priority: CRITICAL` reads back
    as CRITICAL. No such test exists today; only test_sentinel covers the
    snapshot. `PROVEN_BY_SOURCE` grep of backend/tests for `priority`
- **Rollback.** Revert the commit. Rows already written hold valid enum values.

#### Step R0: flag ferry segments in road routes

No migration. **ROADMAP.**

- **Change.** Read the OSRM step `mode`. When it is `ferry`, add a warning to
  the candidate and show it on the route card.
- **Tests.** An OSRM response fixture with a ferry step produces a warning. The
  existing routing tests stay unchanged.
- **Rollback.** Revert. Nothing stored changes shape.
- **Why not ADOPT_NOW.** It is not verified that OSRM returns ferry steps on NER
  corridors. `NOT_VERIFIED`

#### Step R1: shipment status follows its trips

No migration. **ROADMAP.** Required before 0017 and 0018.

- **Change.** PLANNED at dispatch, IN_TRANSIT at start, DELIVERED when the last
  leg delivers, CANCELLED only by a manager. The enum already has every value.
  `PROVEN_BY_SOURCE` enums.py:126-131
- **Open decision.** What a cancelled and re-planned trip does to its shipment.
  One demo shipment has 2 trips; the other 72 have 1. `PROVEN_BY_DATABASE` ner_logistics_demo
- **Old rows.** No backfill. They stay DRAFT and read as "not tracked".
- **Gap.** The Supabase-direct path would not update the status (T37). `INFERRED`
- **Tests.** A new test_shipment_status_follows_trips. test_trip_execution,
  test_shipment_trip_atomicity and test_golden_path_e2e stay green.
- **Rollback.** Revert the code. Rows keep whatever status they reached, and all
  of those are valid enum labels.

#### Step 0014_device_events: a renumber, not new work

- **Problem.** The pdf branch file `0013_device_events.py` declares
  `revision = "0013_device_events"` and `down_revision = "0012_push_notifications"`,
  so it forks the chain. `PROVEN_BY_SOURCE` origin/claude/pdf-master-mission-gohuj5:backend/alembic/versions/0013_device_events.py:55-56
- **Fix.** It becomes `0014_device_events` with
  `down_revision = "0013_state_district_inbox"`. Its three `trip_event_kind`
  labels go into the drift ledger against 0014. `INFERRED`
- **Known issues.** The cycle-1 findings on that branch's event queue were
  handed to this lane and not re-checked here: it is not trip-scoped, it strands
  events at INCIDENT, and it retries permanent 4xx errors. `NOT_VERIFIED`

#### Step: vehicle_class (next free revision; 0015 and 0016 are taken as of 27 Sep)

**ROADMAP.**

- **Upgrade.**
  - `CREATE TYPE vehicle_class AS ENUM ('TRUCK', 'LIGHT_GOODS_VEHICLE')`.
  - `ALTER TABLE trucks ADD COLUMN vehicle_class vehicle_class NOT NULL DEFAULT 'TRUCK'`.

  Every existing row becomes TRUCK. No further label is added until a user
  needs one.
- **API.** `TruckCreate.vehicle_class` is optional and defaults to TRUCK.
  `TruckRead` and the driver `TruckSummary` gain the field. Nothing is renamed.
- **Unknown.** How much adding this default costs on the hosted PostgreSQL
  version was not checked (`NOT_VERIFIED`). The demo table has 7 rows, 4 of
  them soft-deleted. `PROVEN_BY_DATABASE` ner_logistics_demo
- **Tests.**
  - The regression gate (4.2).
  - test_schema_drift records `vehicle_class: <its revision>`.
  - A new test that a LIGHT_GOODS_VEHICLE runs the full plan, dispatch, start,
    deliver and close flow under the same capacity gate.
  - test_input_limits covers the new field.
- **Rollback.** Downgrade drops the column and the type. The type is new, so it
  can be dropped. Clients ignore an optional field that is missing. `INFERRED`

#### Step 0016_field_reports

**ROADMAP.** This is the first numbered step, because the problem statement
names field officials.

- **Upgrade.**
  - Inside `autocommit_block`, before any other statement:
    `ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'FIELD_OFFICIAL'`. The label
    cannot be undone.
  - `CREATE TABLE road_reports`: reporter, location, optional district, server
    `received_at` and device `reported_at` kept apart, kind, optional photo
    file id, review state, reviewer, `reviewed_at`.
  - Row-level security on.
- **Behaviour.**
  - What today's road-memory rules allow. `CAN_OPEN` is `OFFICIAL_AGENCY` and
    `FLEET_TRAVERSAL`, so evidence from an official agency can open a road.
    The source check runs only for evidence that opens a road, so a report from
    any source can also establish `CLOSED` or `REPAIR_REPORTED`, not only
    `REPORTED_INCIDENT`. The newest piece of evidence sets the status.
    `PROVEN_BY_SOURCE` backend/app/domain/road_memory.py:118-127, :199-209, :240-249
  - The plan's choice. A field report enters the evidence log as
    `OPERATOR_REPORT`, or as a new source that is not in `CAN_OPEN`, and never
    as `OFFICIAL_AGENCY`. It may carry `INCIDENT_REPORTED`, `CLOSURE_DECLARED`
    or `REPAIR_CLAIMED`, never `PASSAGE_OBSERVED` or `REOPENING_DECLARED`. A
    field report therefore can never open a road, and a test pins this.
    `INFERRED` (design decision)
  - Because the newest evidence wins, an unreviewed field report could replace
    an official `CLOSED` with `REPORTED_INCIDENT` or `REPAIR_REPORTED`. That is
    why a report counts only after review. `INFERRED`
  - No table stores road-memory evidence today; the 0013 test database has none
    (1.2). `PROVEN_BY_DATABASE` ner_logistics_test
  - A manager in scope reviews each report before it enters the evidence log.
  - Accounts are created the way State Managers create District Managers, with
    the forced password reset.
- **Tests.**
  - The new role cannot read trips, fleet locations or drivers.
  - Report ingest is idempotent and rate-limited.
  - A field report maps to a source outside `CAN_OPEN`. `PASSAGE_OBSERVED` or
    `REOPENING_DECLARED` from it is refused, so it never produces VERIFIED_OPEN.
  - A report that has not been reviewed does not enter the evidence log.
  - The photo size cap holds.
  - District-manager scope tests.
  - The drift ledger.
- **Rollback.** Downgrade drops the table, but the `FIELD_OFFICIAL` label stays.
  Deactivate any such accounts first; 0013 states the same rule for scoped
  users. `PROVEN_BY_SOURCE` 0013_state_district_inbox.py:21-29

#### Step 0017_hubs

**ROADMAP.**

- **Upgrade.**
  - `CREATE TYPE hub_kind AS ENUM ('DEPOT', 'WAREHOUSE')`.
  - `CREATE TABLE hubs`: name, kind, location, optional district,
    `source_status` (reusing `district_source`), notes, soft delete.
  - `ALTER TABLE trip_stops ADD COLUMN hub_id`, a nullable FK.
  - Row-level security on.
- **Behaviour.** A manager picks a hub instead of retyping coordinates, and
  RETURN_TO_DEPOT can target a named depot. Trips without hubs behave exactly as
  they do today.
- **Data.** Hubs are the operator's own premises, entered by the operator. No
  public warehouse dataset is imported. The district link is optional because
  district data is only a candidate so far (handed to this lane, not checked
  here). `NOT_VERIFIED`
- **Tests.**
  - A stop with a hub and a stop without one.
  - RETURN_TO_DEPOT still goes to the pickup when no hub is set.
  - A district manager sees only hubs in scope.
  - The drift ledger and test_rls_boundary.
- **Rollback.** Downgrade drops `trip_stops.hub_id`, the table and the type.

#### Step 0018_handovers

**ROADMAP.** Depends on R1 and 0017.

- **Upgrade.**
  - Inside `autocommit_block`, before any other statement (these labels cannot
    be undone):
    `ALTER TYPE hub_kind ADD VALUE IF NOT EXISTS 'RAILHEAD'`,
    `ALTER TYPE hub_kind ADD VALUE IF NOT EXISTS 'RIVER_TERMINAL'`,
    `ALTER TYPE trip_stop_kind ADD VALUE IF NOT EXISTS 'HANDOVER'`.
  - `CREATE TYPE transfer_mode AS ENUM ('RAIL', 'INLAND_WATERWAY')`.
  - `CREATE TABLE consignment_handovers`: shipment, from hub, to hub, mode,
    `handed_over_at`, `handed_over_by`, `received_at`, `received_by`, carrier
    reference as free text, optional evidence file.
  - Row-level security on.
- **Behaviour.**
  - A road trip ends at a HANDOVER stop at a railhead or river terminal.
  - The non-road leg is a record with two human confirmations. It is not a
    tracked trip.
  - A second road trip picks the consignment up at the far hub.
  - Between the two, the shipment shows "with rail/water carrier since ...".
- **Tests.**
  - The shipment status sequence across two legs.
  - A handover cannot be received before it is handed over.
  - The first road trip closes and releases its truck exactly as today
    (test_trip_release_after_delivery stays green).
  - The drift ledger.
- **Rollback.** Downgrade drops the table and `transfer_mode`. The added labels
  stay, unused.

#### Not numbered

REJECT for this phase: organisations and tenancy, a rename to `vehicles`, air
transfers, and live tracking of trains, aircraft or vessels. See G9 to G12.

---

## 5. Expansion gate

### 5.1 Summary

| ID | Mode or actor | Recommendation | One-line reason |
|---|---|---|---|
| G1 | Truck + driver road freight (baseline) | ADOPT_NOW | Already live and tested. Every other row must leave it intact. |
| G2 | Essential and emergency cargo (priority + category) | ADOPT_NOW | Named in the problem statement. The column and API have existed since 0002, so this is a UI-only change. |
| G3 | Light goods vehicle / van, last mile | ROADMAP | Works today as a `trucks` row with `truck_type`. A class column needs hosted 0013 first. |
| G4 | Field official / local authority reporter | ROADMAP | Named in the problem statement, but a new role that feeds safety data needs its own security review. |
| G5 | Depot / warehouse / hub | ROADMAP | Not named in the problem statement. A convenience for operators that needs a new table. |
| G6 | Consignee / receiving district | ROADMAP | Destination district managers are already told a trip is coming. Delivery confirmation needs R1 first. |
| G7 | Road-rail transfer point | ROADMAP | Only an untracked handover is feasible. Needs R1 and 0017. No lawful live rail data is known. |
| G8 | Road-inland waterway transfer point (and ferry legs in road routes) | ROADMAP | Same handover mechanism. The ferry warning (R0) is small, but its value is unverified. |
| G9 | Road-air transfer point | REJECT | No link to the problem statement, no data source, and no user asking. Two enum labels add it later if needed. |
| G10 | Live tracking of trains, aircraft, vessels | REJECT | No lawful feed identified. The platform does not operate these, and the driver app is built for a road cab. |
| G11 | Multiple carriers / organisations (tenancy) | REJECT | Not in the problem statement. Tenant isolation is the highest-risk change, and nothing waits on it. |
| G12 | Rename trucks to vehicles in schema and API | REJECT | About 1,465 source references, the field names the shipped APK reads, and 7 SQL files would change, with nothing new for users. |

All twelve recommendations are decisions, so they are `INFERRED`. The facts
under them carry their own labels below.

### 5.2 Detail per row

**G1. Truck + driver road freight (baseline)**
- USER_PERSONA: fleet manager at a desk; driver in the cab with one phone. `PROVEN_BY_SOURCE` docs/PRODUCT_VISION.md:40-45
- USE_CASE: plan, dispatch, track, review route risk, respond to SOS.
- PROBLEM_STATEMENT_LINK: tracking vehicles that carry essential goods; blocked-road alerts. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: this is the verified core. In this lane 225 backend and 53 manager regression tests passed. The 3 driver tests passed at the first run; at the 18:21 re-run one fails, for a reason outside this plan (1.2). `PROVEN_BY_TEST`
- REQUIRED_DATA: OSRM routing, weather, terrain, official warnings. The project keeps a source admission ledger (docs/FINAL_SOURCE_ADMISSION_LEDGER.md), which was not reviewed in this lane. `NOT_VERIFIED`
- REQUIRED_BACKEND_CHANGE: none.
- SECURITY_IMPACT: none new.
- SCALABILITY_IMPACT: hosted runs one uvicorn worker on the Render free plan. `PROVEN_BY_SOURCE` backend/Dockerfile:53; render.yaml:35 (E4 :35). How many vehicles that serves is unknown: this lane ran no load test, and none is allowed against hosted. `NOT_VERIFIED`
- UI_IMPACT: none.
- TEST_PLAN: the regression gate in 4.2.
- Recommendation: **ADOPT_NOW** (keep as it is).

**G2. Essential and emergency cargo (priority + category)**
- USER_PERSONA: a manager dispatching medicines, food or relief material to a remote district.
- USE_CASE: mark a consignment CRITICAL and MEDICINE so that it stands out in the trip list and in the SOS briefing.
- PROBLEM_STATEMENT_LINK: essential commodities, medicines, agricultural produce, construction materials. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: the data is already stored and shown in the SOS briefing, but today it is always NORMAL and GENERAL. `PROVEN_BY_DATABASE` ner_logistics_demo
- REQUIRED_DATA: entered by the manager. No external source is needed.
- REQUIRED_BACKEND_CHANGE: none, plus one new API test. `PROVEN_BY_SOURCE` schemas/domain.py:248
- SECURITY_IMPACT: priority must not bypass the route safety gate or become URGENT (A0 rules). If everything is marked CRITICAL, the flag stops meaning anything; that is a risk in how people use it, not in the code. `INFERRED`
- SCALABILITY_IMPACT: none. `INFERRED`
- UI_IMPACT: two selects in the plan form, a badge in the trip list, and the 'STANDARD' fallback fixed. The driver app does not change, so no translation work.
- TEST_PLAN: the A0 tests plus the regression gate.
- Recommendation: **ADOPT_NOW**. Small, additive, no migration, and it unblocks a named requirement.

**G3. Light goods vehicle / van, last mile**
- USER_PERSONA: a manager running a smaller vehicle from a district town to villages, and its driver.
- USE_CASE: the same flow as a truck, with a smaller payload.
- PROBLEM_STATEMENT_LINK: the problem statement says "vehicles" carrying essential goods and does not name vehicle types. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: correct labels and filters now, and a correct fuel model for small vehicles later.
- REQUIRED_DATA: vehicle papers entered by the operator. Routing uses the same OSRM `driving` profile (T22).
- REQUIRED_BACKEND_CHANGE: the vehicle_class migration. Until then, without a migration, a van can be registered as a `trucks` row with `truck_type = 'LCV'`, and the UI will still call it a truck. `PROVEN_BY_SOURCE` fleet.py:46
- SECURITY_IMPACT: none new. Drivers keep `truck:read` only. `PROVEN_BY_SOURCE` permissions.py:139
- SCALABILITY_IMPACT: more vehicles means more GPS rows. At the 10-second moving interval, a 10-hour shift writes 3,600 rows per vehicle into an unpartitioned table. `PROVEN_BY_SOURCE` backend/app/domain/telemetry_policy.py:55-62. The point at which that becomes a problem is unknown. `NOT_VERIFIED`
- UI_IMPACT: a class select and a class filter in the manager console. Driver-app copy can keep saying "truck" in v1. Any class-specific copy needs four reviewed translations per phrase (T35).
- TEST_PLAN: the vehicle_class migration tests plus the regression gate.
- Recommendation: **ROADMAP**. The need is real but does not block anything, the interim workaround works, and the migration waits for hosted 0013.

**G4. Field official / local authority reporter**
- USER_PERSONA: a district official or a local authority staff member with a phone. Not a driver.
- USE_CASE: report a landslide, washout or closure with a photo and a location.
- PROBLEM_STATEMENT_LINK: field officials and local authorities uploading geo-tagged updates, photographs and incident reports. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: ground observations for road status. The road-memory module already types observations by kind and by source; `OPERATOR_REPORT` is described as a driver or manager typing what they saw. `PROVEN_BY_SOURCE` road_memory.py:75-99. Nothing stores them yet (0016).
- REQUIRED_DATA: the reports themselves, from people the operator or the state creates accounts for. No external dataset.
- REQUIRED_BACKEND_CHANGE: 0016 (role label, table, endpoints, review flow).
- SECURITY_IMPACT: high.
  - Untrusted input feeds a safety decision. Under today's road-memory rules an `OFFICIAL_AGENCY` source can open a road, and a report from any source can establish `CLOSED` or `REPAIR_REPORTED`. `PROVEN_BY_SOURCE` road_memory.py:118-127, :199-209
  - The plan's choice: field reports map to `OPERATOR_REPORT` (or a new source outside `CAN_OPEN`), never `OFFICIAL_AGENCY`, and count only after a manager reviews them. Tests pin both. `INFERRED` (design decision, see 0016)
  - Photo EXIF data may reveal the reporter's movements. `INFERRED`
  - Rate limits and a forced password reset on created accounts.
  - The role must not read fleet locations, which the code calls the most sensitive data it holds. `PROVEN_BY_SOURCE` permissions.py:150-153
- SCALABILITY_IMPACT: photos are stored in PostgreSQL as BYTEA, with a 5 MB cap per file. `PROVEN_BY_SOURCE` backend/app/models/files.py:36; backend/app/api/files.py:47. How that growth fits the hosted database quota is unknown. `NOT_VERIFIED`
- UI_IMPACT: a way to file reports (a role in the driver app or a small web form) and a review queue for managers. Either one needs translated copy.
- TEST_PLAN: the 0016 tests plus the regression gate and test_scope_http_idor.
- Recommendation: **ROADMAP**, as the first numbered step. It is a named requirement, but a new role and a new trust boundary are not a small change.

**G5. Depot / warehouse / hub**
- USER_PERSONA: a manager who dispatches from the same few yards every day.
- USE_CASE: pick "Guwahati depot" instead of retyping coordinates; send a vehicle back to its depot.
- PROBLEM_STATEMENT_LINK: none direct. The closest is logistics bottlenecks and planning. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS (no warehouse or depot term found)
- VALUE: fewer planning errors, and a place to anchor transfers (G7, G8). `INFERRED`
- REQUIRED_DATA: the operator's own sites, entered by the operator, which makes them lawful by construction. No public warehouse registry was identified in this lane. `NOT_VERIFIED`
- REQUIRED_BACKEND_CHANGE: 0017.
- SECURITY_IMPACT: the locations of stores holding essential stock are sensitive (`INFERRED`), so no public endpoint, and hubs are scoped by district.
- SCALABILITY_IMPACT: a small table. `INFERRED`
- UI_IMPACT: a hub picker in the plan form and in the mid-trip "return to depot" action, and a hubs page.
- TEST_PLAN: the 0017 tests plus the regression gate.
- Recommendation: **ROADMAP**.

**G6. Consignee / receiving district**
- USER_PERSONA: the destination district manager, or the store that receives medicines.
- USE_CASE: know what is coming; confirm what arrived.
- PROBLEM_STATEMENT_LINK: alerts for delayed deliveries. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: the destination district already gets an "incoming trip" notice. `PROVEN_BY_SOURCE` enums.py:310-311; trips.py:1017 (WT only)
- REQUIRED_DATA: none external.
- REQUIRED_BACKEND_CHANGE: after R1, a delivery confirmation by the destination district manager, with no new role. There is no proof-of-delivery record today. `PROVEN_BY_SOURCE` grep of backend/app for proof-of-delivery terms
- SECURITY_IMPACT: the receiver may sit outside the operator. With no organisation model they cannot be given access, so confirmation stays with the district manager. `INFERRED`
- SCALABILITY_IMPACT: negligible. `INFERRED`
- UI_IMPACT: a confirm action on the incoming-trip notification.
- TEST_PLAN: the R1 tests, plus a test that only a manager in the destination scope can confirm.
- Recommendation: **ROADMAP**.

**G7. Road-rail transfer point**
- USER_PERSONA: a manager whose consignment covers part of the distance by rail.
- USE_CASE: truck to a railhead, a rail leg, then a truck from the far railhead.
- PROBLEM_STATEMENT_LINK: indirect only ("limited transport connectivity", "transport databases"). The text has no rail term. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: the consignment stays visible across the handover, and the road legs keep every existing safety feature. `INFERRED`
- REQUIRED_DATA:
  - Railhead locations could come from OpenStreetMap (ODbL), which the project already uses under that licence for places. `PROVEN_BY_SOURCE` corridor_snapshot.json source block
  - For train schedules or freight status, no lawful machine-readable source was identified. `NOT_VERIFIED`
- REQUIRED_BACKEND_CHANGE: R1, 0017 and 0018.
- SECURITY_IMPACT: carrier reference numbers and receipts become stored evidence, with the same access rules as other private files. `INFERRED`
- SCALABILITY_IMPACT: small. `INFERRED`
- UI_IMPACT: a HANDOVER stop, a "with rail carrier since" state, and two confirm actions.
- TEST_PLAN: the 0018 tests plus the regression gate.
- Recommendation: **ROADMAP**, once a real user names a railhead they use.

**G8. Road-inland waterway transfer point, and ferry legs inside road routes**
- USER_PERSONA: a manager moving goods across or along a river.
- USE_CASE: (a) a road route that crosses a river by ferry should say so; (b) a consignment handed over at a river terminal.
- PROBLEM_STATEMENT_LINK: indirect only, as for G7. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: (a) discloses a safety fact on the existing road flow; (b) is the same as G7. `INFERRED`
- REQUIRED_DATA:
  - Terminal locations from OpenStreetMap, as for G7.
  - A web search pointed to IWAI pages for National Waterway 2, but both fetches failed (connection refused, then HTTP 403). Terminal names, status and data terms therefore could not be checked in this lane. `BLOCKED`
- REQUIRED_BACKEND_CHANGE: R0 (no migration) and 0018.
- SECURITY_IMPACT: as for G7.
- SCALABILITY_IMPACT: small. `INFERRED`
- UI_IMPACT: a ferry warning on the route card, plus the G7 handover UI.
- TEST_PLAN: the R0 fixture test and the 0018 tests.
- Recommendation: **ROADMAP**.

**G9. Road-air transfer point**
- USER_PERSONA: an emergency supply officer using a flight or helicopter leg.
- USE_CASE: as G7, with an airport.
- PROBLEM_STATEMENT_LINK: none found. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: not established in this lane. `NOT_VERIFIED`
- REQUIRED_DATA: airport locations from OpenStreetMap, as for G7. For flight or cargo status, no lawful source was identified. `NOT_VERIFIED`
- REQUIRED_BACKEND_CHANGE: one `transfer_mode` label and one `hub_kind` label on top of 0018.
- SECURITY_IMPACT: as for G7.
- SCALABILITY_IMPACT: none. `INFERRED`
- UI_IMPACT: as for G7.
- TEST_PLAN: as for 0018.
- Recommendation: **REJECT** for this roadmap. Reconsider only when a user brings an air leg; at that point it costs two enum labels.

**G10. Live tracking of trains, aircraft, vessels**
- USER_PERSONA: none in this project.
- USE_CASE: show a non-road carrier on the map.
- PROBLEM_STATEMENT_LINK: "transport databases" at most. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: low without a lawful feed. `INFERRED`
- REQUIRED_DATA: no lawful live feed was identified. `NOT_VERIFIED`
- REQUIRED_BACKEND_CHANGE: a new asset model, because `Trip` requires a truck and a driver (T11).
- SECURITY_IMPACT: third-party data terms apply, and scraping is not acceptable. `INFERRED`
- SCALABILITY_IMPACT: unknown. `NOT_VERIFIED`
- UI_IMPACT: large.
- TEST_PLAN: not planned.
- Recommendation: **REJECT**.

**G11. Multiple carriers / organisations (tenancy)**
- USER_PERSONA: a second transport company on the same platform.
- USE_CASE: each company sees only its own fleet.
- PROBLEM_STATEMENT_LINK: none. The users the problem statement names are officials and local authorities. `PROVEN_BY_WEB` https://sih.gov.in/sih2026PS
- VALUE: only once a second operator exists. `INFERRED`
- REQUIRED_DATA: none external.
- REQUIRED_BACKEND_CHANGE: `organization_id` on users, drivers, trucks and shipments, and in every query path. Scoping today is by geography only. `PROVEN_BY_SOURCE` permissions.py:162-165 (WT only)
- SECURITY_IMPACT: the highest of any row. One missed filter shows one company's fleet locations to another. `INFERRED`
- SCALABILITY_IMPACT: an index for every scoped query. `INFERRED`
- UI_IMPACT: screens to administer organisations.
- TEST_PLAN: a cross-tenant IDOR suite modelled on test_scope_http_idor.
- Recommendation: **REJECT** for this phase.

**G12. Rename trucks to vehicles in schema and API**
- USER_PERSONA: developers only.
- USE_CASE: none for users.
- PROBLEM_STATEMENT_LINK: none.
- VALUE: naming only.
- REQUIRED_DATA: none.
- REQUIRED_BACKEND_CHANGE: every FK, index, constraint, API path, JSON key, permission, error code, and 7 Supabase SQL files. `PROVEN_BY_RUNTIME` (grep counts in section 2.5)
- SECURITY_IMPACT: permission strings and RLS policies would all change at once, which is easy to get wrong. `INFERRED`
- SCALABILITY_IMPACT: none.
- UI_IMPACT: the shipped driver app reads the `truck`, `truck_registration` and `TruckSummary` fields (T34), so it would break. `INFERRED`
- TEST_PLAN: not planned.
- Recommendation: **REJECT**. Use "vehicle" in new user-facing copy where it helps, and keep the code names.

---

## 6. Logistics modes

### CURRENT_SUPPORTED_LOGISTICS_MODES

Only what the code does today.

| Mode | What works | Limits | Label |
|---|---|---|---|
| Road, one goods vehicle, point to point | Plan (shipment and trip in one transaction), dispatch, driver accept and start, stops, deliver, close. Capacity gate by weight. | One vehicle, one driver, one shipment per trip. Inside the NER bounding box only. | `PROVEN_BY_SOURCE` trips.py:486-744; schemas/domain.py:275-290 |
| Road, several stops on one trip | Ordered stops: PICKUP, DROPOFF, REST, FUEL, CHECKPOINT, OTHER. Stops can be added mid-trip. | Stops cannot point to named places (hubs). | `PROVEN_BY_SOURCE` enums.py:152-165 |
| Road routing with risk review | OSRM `driving` profile, route risk with human review, reroute | No heavy-vehicle restrictions. Ferry legs are not flagged. | `PROVEN_BY_SOURCE` osrm.py:104; route_risk.py:103-107 |
| Live tracking of the road vehicle | Phone GPS, an offline queue, 10 s / 60 s cadence | The phone is the only tracker. | `PROVEN_BY_SOURCE` telemetry_policy.py:55-66 |
| Safety | Stationary check, SOS escalation, manager dispositions including return to the pickup ("depot"). Driver stop requests exist in the working tree only (WT only; absent on E4). | The depot is always the pickup stop. | `PROVEN_BY_SOURCE` sentinel.py:150, :272 (E4 same); trips.py:1085-1170 (dispositions); backend/app/api/driver.py:1517 and backend/app/services/driver_trips.py:747 (stop request, WT only) |
| Cargo attributes | priority, cargo_type, hazardous and perishable are stored | They cannot be set from the console. No rule reads them except the SOS snapshot. | `PROVEN_BY_SOURCE` TripsPage.tsx:357-376; sentinel.py:355 |
| Several trips for one shipment | The schema allows it (`POST /api/trips` with an existing shipment) | No leg order, and the shipment status never advances. | `PROVEN_BY_SOURCE` schemas/domain.py:332-341 |

Today a van works only as a `trucks` row (T4). That is a workaround, not a
supported mode. `INFERRED`

### ROADMAP_LOGISTICS_MODES

| Order | Mode | Step | Recommendation |
|---|---|---|---|
| 1 | Essential and emergency cargo priority and category | A0 | ADOPT_NOW |
| 2 | Ferry legs flagged inside road routes | R0 | ROADMAP |
| 3 | Consignment status across trips | R1 | ROADMAP |
| 4 | Light goods vehicle / van as a class | next free revision | ROADMAP |
| 5 | Field-official road reports | 0016 | ROADMAP |
| 6 | Depots, warehouses, hubs | 0017 | ROADMAP |
| 7 | Road-rail and road-inland-waterway handovers | 0018 | ROADMAP |
| - | Road-air handover, live non-road tracking, multiple carriers, rename | none | REJECT |

Rows 4 to 7 wait for hosted 0013 and the 0014 renumbering; rows 1 to 3 do not.
Rows 4 and 5 are independent of each other. Row 7 needs rows 3 and 6.
`INFERRED`

---

## 7. What must not change for trucks

1. `trucks` stays the vehicle table, and every existing column keeps its name
   and meaning. `INFERRED` (policy)
2. `ck_trucks_load_within_capacity` and the weight gate apply to every vehicle
   class. `PROVEN_BY_SOURCE` fleet.py:95-98; trips.py:729-744
3. One current driver per vehicle and one vehicle per driver stay in place until
   a crew model is designed and tested. `PROVEN_BY_SOURCE` fleet.py:278-293
4. No priority, class or hub value may relax a route safety decision.
   `PROVEN_BY_SOURCE` route_eligibility.py:21
5. The API field names that shipped clients read stay (T28, T34). `INFERRED` (policy)
6. The regression gate in 4.2 passes before and after every step. `INFERRED` (policy)

---

## 8. What was run in this lane

| Check | Command (secrets left out) | Result | Label |
|---|---|---|---|
| Backend truck core | `source .runtime/use-isolated-db.sh && cd backend && .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider tests/test_trip_state.py tests/test_fuel_model.py tests/test_schemas.py tests/test_api_fleet.py tests/test_assignment_invariant.py tests/test_resource_reservation.py tests/test_trip_execution.py tests/test_domain_integrity.py tests/test_schema_drift.py tests/test_trip_multiplicity_invariant.py` | 225 passed in 60.29 s | `PROVEN_BY_TEST` |
| Manager | `cd manager-web && node_modules/.bin/vitest run src/pages/planValidation.test.ts src/pages/TripsPage.test.tsx` | 2 files, 53 passed | `PROVEN_BY_TEST` |
| Manager, re-run (18:26, 26 Sep 2026) | same command | 2 files, 53 passed | `PROVEN_BY_TEST` |
| Driver, first run (before 18:08) | `cd driver-app && node_modules/.bin/vitest run src/i18n/coverage.test.ts src/screens/AssignmentScreen.test.tsx` | 2 files, 3 passed | `PROVEN_BY_TEST` |
| Driver, re-run (18:21, 26 Sep 2026) | same command | 1 file failed, 1 passed; 1 test failed, 2 passed. coverage.test.ts: "untranslated: 10-digit mobile number" | `PROVEN_BY_TEST` |
| LoginScreen.tsx change time | `ls -la --time-style=full-iso driver-app/src/screens/LoginScreen.tsx` | modified 2026-09-26 18:09:15 | `PROVEN_BY_RUNTIME` |
| Registration regex | Python `re.match(REGISTRATION_PATTERN, ...)` on six strings: `AS01AB1234`, `AS-01-AB-1234`, `ML05Z9999`, `12BH3456AA`, `T1123LA0123A`, `AS01AB12345` | The first three accepted, the last three rejected (`AS01AB12345` has five final digits) | `PROVEN_BY_RUNTIME` |
| Test DB | read-only queries on `ner_logistics_test` | Revision `0013_state_district_inbox`; 25 base tables including `alembic_version`; the truck capacity constraints and the assignment and registration indexes are present | `PROVEN_BY_DATABASE` |
| Demo DB | read-only session on `ner_logistics_demo` | Revision `0012_push_notifications`; 73 shipments, all DRAFT and NORMAL; trips: 1 ACTIVE, 1 ASSIGNED, 20 CANCELLED, 39 CLOSED, 10 DELIVERED, 3 DRAFT; 72 shipments with 1 trip and 1 with 2; 7 truck rows, 4 of them soft-deleted (the last two re-queried at revision, session `default_transaction_read_only=on`) | `PROVEN_BY_DATABASE` |
| Not touched | `ner_logistics_cert`, hosted Render and Supabase, any migration | Not accessed | n/a |
| Not run | Full backend, manager and driver suites; the destructive migration tests | n/a | `NOT_VERIFIED` |

---

## 9. Revision after review (26 September 2026)

- Step 0016 and G4: the old text said a report "can never mark a road open" and
  cited road_memory.py:11-18 as proof. The source does not say that, and for
  official sources it says the opposite. The text is now split into what the
  code allows (`PROVEN_BY_SOURCE` :118-127, :199-209, :240-249) and the plan's
  choice (`INFERRED`).
- Driver tests: results are now time-stamped. The re-run at 18:21 fails on a
  later LoginScreen.tsx edit this lane did not make (1.2, 4.2, 8).
- Modes table: driver stop requests are marked WT only, with the correct
  citation.
- Registration regex: all six strings are named.
- Rename cost: the grep command and filter are stated.
- Step R1 and T12: one demo shipment has 2 trips.
- Steps 0016 and 0018: `ADD VALUE IF NOT EXISTS` inside `autocommit_block`,
  plus a rule in 4.1 explaining why.
- Finding 3: the `lan-demo` and `remote-demo` EAS profiles are listed.
