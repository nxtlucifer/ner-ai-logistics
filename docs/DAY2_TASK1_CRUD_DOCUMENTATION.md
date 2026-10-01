# RASTA AI — CRUD Operations Documentation (Day 2 · Task 1)

Every operation below is **mounted in `backend/app/main.py`, backed by a table in Alembic head `0012`,
and exercised by the backend test suite** (1210 passed on 19 Sep 2026) and/or the end-to-end HTTP run in
[`DAY2_TASK1_API_TEST_RESULTS.md`](DAY2_TASK1_API_TEST_RESULTS.md) (56/56). Nothing here is planned
work. Base URL: `/api`. Auth: `Authorization: Bearer <access JWT>` from `POST /api/auth/login`.
Every non-2xx answer uses one envelope: `{"error": {"code", "message", "details", "request_id"}}`.

**Delete is never a physical `DELETE`.** Master data (drivers, trucks) is *retired/deactivated*
(`deleted_at` set, history kept — trips, GPS and audit rows reference them with `ON DELETE RESTRICT`);
operational records (assignments, trips, routes, emergencies) end through **audited state
transitions**. `audit_logs` itself rejects UPDATE and DELETE by trigger. This is the intended
architecture, not a gap.

## CRUD matrix

| Resource | Create | Read | Update | Delete / state transition | Table(s) |
| --- | :-: | :-: | :-: | :-: | --- |
| Authentication / sessions | ✅ login | ✅ me | ✅ refresh (rotation) | ✅ logout (revoke) | `users`, `refresh_tokens`, `audit_logs` |
| Drivers | ✅ | ✅ list/get (+search, status, cursor) | ✅ PATCH | ✅ deactivate (soft) | `users`, `drivers` |
| Trucks | ✅ | ✅ list/get | ✅ PATCH | ✅ retire (soft) | `trucks` |
| Assignments (driver ↔ truck) | ✅ | ✅ list/get | ✅ verify / verify-manual | ✅ end | `driver_truck_assignments` |
| Shipments + cargo | ✅ (alone or inside `/trips/plan`) | ✅ list | — (immutable once planned) | via trip cancel | `shipments`, `cargo_items` |
| Trips | ✅ create / plan | ✅ list (server filters, total) / get / events | ✅ add stop, dispatch, driver accept/start/stops/complete | ✅ cancel (dispositions), close | `trips`, `trip_stops`, `trip_events` |
| Routes | ✅ recalculate, driver reroute | ✅ list, risk, recommendation, reroute assessment | ✅ select / approve, reroute accept | ✅ supersede (state) | `trip_routes`, `route_review_authorizations` |
| GPS / telemetry | ✅ batch POST (202) | ✅ fleet/active, trip track, driver progress | — (append-only) | — (append-only) | `gps_points` |
| Emergencies (Fleet Sentinel) | ✅ sweep raises | ✅ active | ✅ driver check-in | ✅ resolve / false alarm | `emergencies` |
| Files & documents | ✅ upload (photo), add document | ✅ read (owner/manager), masked lists | — | — | `stored_files`, `driver_documents`, `truck_documents` |

---

## 1. Authentication

| Op | Endpoint | Auth | Request | Response | Table |
| --- | --- | --- | --- | --- | --- |
| CREATE session | `POST /api/auth/login` | none | `{identifier, password, client: "web"\|"mobile"}` — e-mail for managers, phone for drivers | `200 {access_token, token_type, expires_at, refresh_token (mobile only), user{id, role, display_name, email, phone}}`; web gets the refresh token as an `HttpOnly` cookie | R `users`, C `refresh_tokens`, C `audit_logs` (LOGIN / LOGIN_FAILED) |
| READ principal | `GET /api/auth/me` | JWT | — | `200 {user{id, role, display_name, email, phone}, permissions[]}` | R `users` |
| UPDATE (rotate) | `POST /api/auth/refresh` | refresh token (cookie or body) | `{refresh_token?, client}` | `200` new pair; **reusing a rotated token revokes the whole family → 401** | U `refresh_tokens` |
| DELETE session | `POST /api/auth/logout` | JWT | `{refresh_token?}` | `204` | U `refresh_tokens.revoked_at` |

Business rules: one identifier field so the 401 never reveals which identifiers exist; password ≥ 8 chars
(422 otherwise); login limited to 10/min per identifier and 20/60 s per IP (429); roles `ADMIN`,
`MANAGER`, `DRIVER`, `AUTHORISED_REVIEWER` map to permission strings in `backend/app/core/permissions.py`;
a deactivated user's access token is refused (401) on the next request.

## 2. Drivers

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/drivers` | `driver:create` (MANAGER, ADMIN) | `{full_name, initial_password, phone, licence_number, licence_expiry, licence_class?, email?, emergency_contact_*?, date_of_joining?, base_salary_monthly?}` | `201 DriverRead {id, user_id, full_name, phone, licence_number, licence_expiry, status, login_is_active, created_at}` |
| READ list | `GET /api/drivers?limit&cursor&driver_status&search` | `driver:read` | — | `200 {items: [DriverRead], next_cursor}` — a DRIVER calling this sees **only their own row** |
| READ one | `GET /api/drivers/{id}` | `driver:read` | — | `200 DriverRead`; `404 NOT_FOUND` for an unknown id or another driver's id (no existence leak) |
| UPDATE | `PATCH /api/drivers/{id}` | `driver:update` | any of `{full_name, phone, licence_number, licence_expiry, licence_class, emergency_contact_name, emergency_contact_phone, photo_url}` | `200 DriverRead` |
| DELETE (soft) | `POST /api/drivers/{id}/deactivate?reason=` | `driver:deactivate` | optional `reason` query (≤ 200 chars) | `200 DriverRead` with `login_is_active: false`; `409 DRIVER_ON_TRIP` if the driver is on the road |
| READ documents | `GET /api/drivers/{id}/documents` | `driver:read` | — | masked document numbers |
| Support view | `POST /api/drivers/{id}/support-session` | `driver:support_view` | — | short-lived read-only driver session (never the password) |

Business rules: the login (`users`) and the profile (`drivers`) are created in **one transaction**; the
driver signs in with the phone number; phone `^\+?[0-9]{10,15}$`; licence normalised to upper-case
and unique (`409 LICENCE_EXISTS`); `status` (`AVAILABLE`/`ON_TRIP`/`OFF_DUTY`/`SUSPENDED`) is owned by
the trip lifecycle and is not editable here; salary is never in `DriverRead` (admin/payroll only);
deactivation keeps every row and sets `deleted_at` + `users.is_active = false`; every write is audited
with before/after JSON and the caller's IP.

## 3. Trucks

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/trucks` | `truck:create` | `{registration_number, max_capacity_kg, truck_type?, make?, model?, manufacture_year?, axle_count?, height_m?, length_m?, fuel_tank_capacity_l?, baseline_mileage_kmpl?}` | `201 TruckRead {id, registration_number, max_capacity_kg, current_load_kg, status, …}` |
| READ list | `GET /api/trucks?limit&cursor&truck_status&search` | `truck:read` | — | `200 {items, next_cursor}` |
| READ one | `GET /api/trucks/{id}` | `truck:read` | — | `200 TruckRead` / `404` |
| UPDATE | `PATCH /api/trucks/{id}` | `truck:update` | `{truck_type, make, model, max_capacity_kg, baseline_mileage_kmpl, odometer_km, status, photo_url}` (all optional; `status` refused while ON_TRIP) | `200 TruckRead` |
| DELETE (soft) | `POST /api/trucks/{id}/retire?reason=` | `truck:retire` | optional `reason` query | `200` with `status: RETIRED`, `deleted_at` set; `409 TRUCK_ON_TRIP` while on a trip |

Business rules: Indian registration format, normalised (`AS 01 AB 1234` → `AS01AB1234`), unique
(`409 REGISTRATION_EXISTS`); capacity `0 < x ≤ 100 000 kg`; `current_load_kg` **cannot be set by a
client** (it is derived from the shipment when a trip is created) and the database refuses
`current_load_kg > max_capacity_kg`; lowering capacity below the current load is refused (422).

## 4. Assignments (driver ↔ truck pairing)

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/assignments` | `assignment:create` | `{driver_id, truck_id}` | `201 AssignmentRead {id, driver_id, truck_id, status: PENDING_VERIFICATION\|ACTIVE, assigned_at, verified_at, mismatch_flagged, verification_source, verification_photo_url, ended_at}`; `409 ASSIGNMENT_UNCHANGED` if the same pairing is already open |
| READ | `GET /api/assignments?driver_id&truck_id&active_only&limit`, `GET /api/assignments/{id}` | `assignment:read` | — | `200` |
| UPDATE (driver verifies) | `POST /api/driver/me/assignment/verify` or `POST /api/assignments/{id}/verify` | DRIVER (own) | `{reported_registration?, reported_odometer_km?, reported_fuel_level_pct?, reported_damage_notes?}` (photo uploaded first via `POST /api/files?kind=TRUCK_VERIFICATION`) | `200`; a plate mismatch **flags** for review, never blocks |
| UPDATE (manager verifies by hand) | `POST /api/assignments/{id}/verify-manual` | `assignment:review` | `{reported_registration, note}` | `200` with `verification_source: MANAGER_MANUAL` (driver without a smartphone) |
| DELETE (end) | `POST /api/assignments/{id}/end?reason=` | `assignment:end` | optional `reason` query | `200` with `status: ENDED`, `ended_at` |

Business rules: **one open pairing per driver and per truck**, enforced by partial unique indexes
(`uq_current_assignment_driver/truck`, migration 0006), so two managers racing cannot both succeed;
re-pairing a driver ends the previous pairing and creates a fresh `PENDING_VERIFICATION` one in the same
transaction; a trip cannot be accepted by the driver until the assignment is verified
(`ASSIGNMENT_NOT_VERIFIED`); verification photos go through `POST /api/files` and are served back only to
the owner or a manager.

## 5. Shipments and cargo

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/shipments` (or as `shipment` inside `POST /api/trips/plan`) | `shipment:create` | `{reference_code, client_name, client_contact?, pickup_address, pickup{lat,lon}, destination_address, destination{lat,lon}, priority, scheduled_pickup_at?, expected_delivery_at?, cargo_items: [{cargo_type, cargo_name, weight_kg, quantity, is_hazardous, is_perishable, handling_notes?}]}` | `201 ShipmentRead {…, total_weight_kg, status}` |
| READ | `GET /api/shipments?limit&cursor` | `shipment:read` | — | `200 {items, next_cursor}` |
| UPDATE / DELETE | — | | A shipment is the commercial record of a trip; it changes through the trip (cancel dispositions), not directly. | |

Business rules: `total_weight_kg` is **computed by a database trigger from `cargo_items`** — a client
cannot declare the weight the capacity check uses; at least one cargo item; pickup ≠ destination; both
points must be inside the North-East service region (`in_service_region`, 422 otherwise); delivery
not before pickup; reference code unique.

## 6. Trips

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/trips` | `trip:create` | `{trip_code, shipment_id, truck_id, driver_id, stops: [{sequence, kind, location{lat,lon}, name?, address?, geofence_radius_m?}]}` | `201 TripRead` (always `DRAFT`) |
| CREATE (atomic plan) | `POST /api/trips/plan` | `trip:create` | `{shipment: ShipmentCreate, trip: {trip_code, truck_id, driver_id, stops}}` | `201 TripRead` — shipment, cargo, trip and stops in **one transaction**; a capacity refusal leaves **no** orphan shipment |
| READ list | `GET /api/trips?limit&cursor&status&driver_id&truck_id&search&open_only` | `trip:read` | — | `200 {items: [TripRead + client_name, origin, destination], next_cursor, total}` |
| READ one | `GET /api/trips/{id}` | `trip:read` | — | `200 TripRead` with stops and a shipment summary |
| READ history | `GET /api/trips/{id}/events?limit` | `trip:read` | — | `200` journey timeline (actor display name, reason, acknowledged flag; no coordinates) |
| UPDATE add stop | `POST /api/trips/{id}/stops` | `trip:create` | `{location{lat,lon}, address (≥ 3 chars), name?, kind (default CHECKPOINT), placement: NEXT\|BEFORE_FINAL, reason (≥ 10 chars)}` | `201`; refused for a trip not in transit, an out-of-region or too-close point (< 200 m), or no pending stops |
| UPDATE dispatch | `POST /api/trips/{id}/dispatch` | `trip:dispatch` | — | `200` `DRAFT → ASSIGNED`; `422 ROUTE_SELECTION_REQUIRED / ROUTE_REVIEW_REQUIRED / ROUTE_INVALID` without an approved route |
| UPDATE (driver) | `POST /api/driver/me/trip/accept`, `/start`, `/stops/{stop_id}/arrive`, `/stops/{stop_id}/complete`, `/complete`, `/instruction/ack` | DRIVER (own) | — / `{reason?}` | `200` `ASSIGNED → ACTIVE → DELIVERED` with stop-level progress |
| DELETE (cancel) | `POST /api/trips/{id}/cancel` | `trip:cancel` | `{reason?, disposition?, destination?, destination_address?}` — before pickup all optional; after pickup `reason` ≥ 10 chars and a `disposition` (`RETURN_TO_DEPOT\|NEW_DESTINATION\|HOLD_FOR_INSTRUCTION\|COMPLETE_CURRENT_LEG\|CARGO_UNLOADED`) are required | `200` `→ CANCELLED` (or an instruction the driver must acknowledge); `409 ILLEGAL_TRIP_TRANSITION` if already terminal |
| DELETE (close) | `POST /api/trips/{id}/close` | `trip:close` | — | `200` `DELIVERED → CLOSED`, driver and truck released |

Business rules: transitions come from the state machine in `backend/app/domain/trip_state.py`
(`DRAFT, ASSIGNED, VERIFICATION_PENDING, MANAGER_REVIEW, ACTIVE, DELAYED, INCIDENT, DELIVERED, CLOSED,
CANCELLED`); creation checks capacity against the derived shipment weight and **reserves** the driver
and truck (`DRIVER_RESERVED_BY_TRIP` / `TRUCK_RESERVED_BY_TRIP`, decided under `SELECT … FOR UPDATE` so
two planners cannot double-book); dispatch requires a selected route whose hazard evidence was
accepted (§7); the driver must accept, and can only start after the assignment is verified; every
transition writes a `trip_events` row and an `audit_logs` row; stop sequence is unique per trip;
a mid-trip stop never changes the road — the route stays until a manager plans and approves one.

## 7. Routes

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/trips/{id}/routes/recalculate?detailed=true` | `route:plan` | — | `201 [RouteRead]` — one `PRIMARY` plus up to two distinct provider alternatives stored as `EMERGENCY_BACKUP`; provider answers whose ends do not match the stops are refused (`ROUTE_VALIDATION_FAILED`) |
| READ | `GET /api/trips/{id}/routes` | `route:read` | — | `200 [RouteRead {id, kind, state, distance_km, estimated_duration_min, geometry, risk_score, risk_factors, maneuvers, routing_provider}]` |
| READ risk | `GET /api/trips/{id}/routes/{route_id}/risk` | `route:read` | — | deterministic assessment: level, factors present/absent, `UNKNOWN ≠ SAFE` |
| READ recommendation | `GET /api/trips/{id}/routes/recommendation` | `route:read` | — | compares live candidates; refuses to advise on unequal evidence |
| UPDATE select | `POST /api/trips/{id}/routes/{route_id}/select` | `route:select` | — | `200`; `422 ROUTE_REVIEW_REQUIRED` when hazard evidence is incomplete |
| UPDATE approve + select | `POST /api/trips/{id}/routes/{route_id}/approve` | `route:select` | `{rationale (≥ 20 chars), acknowledged_incomplete_evidence: true}` | `200` — issues **and** spends a `route_review_authorizations` row and selects the route in one transaction; hard blocks (closure, HIGH hazard, superseded) stay non-overridable |
| Reviewer path (optional) | `GET/POST …/review-authorization`, `DELETE …/review-authorization/{authorization_id}` | `route:review_authorize` | `{rationale}` | single-use, expiring authorisation a separate reviewer can issue or revoke |
| Live reroute | `GET /api/trips/{id}/reroute`, `POST /api/trips/{id}/reroute/accept`; driver `POST /api/driver/me/trip/reroute` | `route:read` / `route:select` / DRIVER | — / `{route_id}` | the **only** way a moving trip's road changes; the old route is `SUPERSEDED`, a `ROUTE_CHANGED` event is written |

## 8. GPS / telemetry

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/driver/me/location` | DRIVER (own), `location:submit_own` | `{fixes: [{device_fix_id (uuid), location{lat,lon}, recorded_at, speed_kmph?, heading_deg?, accuracy_m?, altitude_m?, is_mock_location?}]}` | `202 {trip_id, accepted, duplicates_ignored, rejected}`; `404` when the driver has no trip; `422` on a malformed fix |
| READ fleet | `GET /api/fleet/active` | `fleet:location_read` | — | trips on the road with each truck's last position and freshness (LIVE / STALE / NO CONTACT) |
| READ track | `GET /api/trips/{id}/track?limit` | `fleet:location_read` | — | recent points for one trip |
| READ own progress | `GET /api/driver/me/trip` (`progress`) | DRIVER | — | observed fix projected onto the planned line, `off_route_m` |

Business rules: the server decides `trip_id`, `driver_id`, `truck_id`, `received_at` from the
authenticated caller — a client cannot write another driver's track; `(trip_id, device_fix_id)` is
unique so an offline queue can replay safely; speed ≥ 0, heading in [0, 360), accuracy ≥ 0; location
is the most sensitive data the system holds, so `fleet:location_read` is a separate permission a
driver never has; Fleet Sentinel and the route-ahead watcher read these rows on a schedule.

## 9. Emergencies (Fleet Sentinel)

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/emergencies/sweep` (also a background loop) | `emergency:resolve` | — | raises `DRIVER_CHECK_REQUIRED` for a truck stationary off an approved stop; one open emergency per trip (partial unique index) |
| READ | `GET /api/emergencies/active` | `emergency:read` | — | `200` open incidents with briefing snapshot |
| UPDATE (driver) | `POST /api/driver/me/trip/check-in` | DRIVER (own) | `{response: I_AM_SAFE\|TRAFFIC\|ROAD_BLOCKED\|BREAKDOWN\|…\|NEED_HELP, note?}` | `200`; `NEED_HELP` escalates immediately (`SOS_ESCALATED`) |
| DELETE (resolve) | `POST /api/emergencies/{id}/resolve` | `emergency:resolve` | `{note?, is_false_alarm}` | `200` `→ RESOLVED` or `FALSE_ALARM`, `INCIDENT_RESOLVED` event |

## 10. Files and documents

| Op | Endpoint | Permission | Request | Response |
| --- | --- | --- | --- | --- |
| CREATE | `POST /api/files?kind=PROFILE_PHOTO\|TRUCK_VERIFICATION\|TRUCK_PHOTO&truck_id=` | JWT | raw image body (≤ 5 MiB, content-type checked) | `201 {id, url: /api/files/{id}}` — stored in `stored_files.data` (BYTEA), never on disk; the URL is written onto the driver, assignment or truck |
| READ | `GET /api/files/{id}` | owner driver or manager | — | the bytes; anyone else `404` |
| CREATE / READ documents | `POST/GET /api/driver/me/documents`, `/truck-documents`; `GET /api/drivers/{id}/documents` | DRIVER (own) / `driver:read` | `{doc_type, doc_number?, issued_on?, expires_on?, file_id?}` | numbers are **masked** in every list |

---

### Where the rules live

| Layer | Path |
| --- | --- |
| Routers (HTTP contract, permission per route) | `backend/app/api/*.py` |
| Request/response schemas (validation, normalisation) | `backend/app/schemas/*.py` |
| Business logic, transactions, audit | `backend/app/services/*.py`, `backend/app/domain/*.py` |
| Models and constraints | `backend/app/models/*.py` → `backend/alembic/versions/0001…0012` |
| Tests | `backend/tests/` (87 files, 1151 test functions; e.g. `test_api_fleet.py`, `test_trip_execution.py`, `test_dispatch_route_gate.py`, `test_route_review_authorization.py`, `test_telemetry.py`, `test_emergency_api.py`, `test_authorization.py`, `test_migrations.py`) |
