# API Contracts

**Status: part specification, part record of what is running.** That banner used to read "only
`/health` and `/ready` are implemented", which stopped being true several phases ago and made this
document untrustworthy to read.

**Section 15 is the authority on what exists.** It lists the implemented surface in one place and
is checked against the routers mounted in `backend/app/main.py`.

In summary: sections 2-8, 9 (except `/api/routes/preview`), 13a and 15 are **implemented and
covered by the backend test suite**. Sections 10, 11, 12, 13 and 14 - weather, incidents, fuel,
payments, alerts, emergencies and the fleet WebSocket - are **not routed at all**; they are
contracts for a later phase. Tables that mix the two carry an explicit `Status` column. Anything
below without an "implemented" marker is not running code.

---

## 1. Conventions

- Base path `/api`, version pinned via `Accept: application/vnd.ner.v1+json` (header, not URL, so
  the path set stays stable).
- All request and response bodies are JSON. All timestamps are ISO-8601 UTC with `Z`.
- Coordinates are always `{"lat": <float>, "lon": <float>}` in payloads. GeoJSON is used only for
  route geometry, where the `[lon, lat]` ordering is the format standard — this inconsistency is
  deliberate and must be respected, since silently swapping the two is the single most common
  spatial bug.
- Money is a decimal **string** (`"12500.00"`) to avoid float rounding across the wire.
- Pagination: `?limit=&cursor=`, response `{"items": [...], "next_cursor": "..."}`. Cursor-based
  because GPS and audit data are appended constantly and offset pagination would skip rows.

### Error envelope

Every non-2xx response uses one shape:

```json
{
  "error": {
    "code": "CAPACITY_EXCEEDED",
    "message": "Cargo weight 18500.00 kg exceeds truck capacity 16000.00 kg",
    "details": { "cargo_weight_kg": "18500.00", "max_capacity_kg": "16000.00" },
    "request_id": "01J8X9..."
  }
}
```

| HTTP | Meaning in this API |
| --- | --- |
| 400 | Malformed request |
| 401 | Missing/invalid token |
| 403 | Authenticated but role or ownership forbids it |
| 404 | Not found, **or** found but not visible to this actor (drivers get 404 not 403 for other drivers' trips, so the API does not leak existence) |
| 409 | State conflict (e.g. dispatching an already-active trip) |
| 422 | Business rule violation (capacity, expired document, invalid transition) |
| 429 | Rate limited |
| 503 | A dependency is down and the operation genuinely requires it |

**422 vs 403 matters:** 403 means "you may not"; 422 means "nobody may, this violates a rule".
Capacity and document violations are always 422 — no role can override them.

### Permission legend

`M` = MANAGER · `A` = ADMIN · `D` = DRIVER (own records only) · `S` = system/scheduler

---

## 2. `/api/auth`

| Method | Path | Perms | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | public | Email+password (manager) or phone+password (driver) |
| POST | `/api/auth/refresh` | any | Exchange refresh token |
| POST | `/api/auth/logout` | any | Revoke refresh token |
| GET | `/api/auth/me` | any | Current principal |

**POST `/api/auth/login`**
```json
// request
{ "identifier": "manager@fleet.example", "password": "..." }
// 200
{ "access_token": "eyJ...", "refresh_token": "...", "token_type": "bearer",
  "expires_in": 900,
  "user": { "id": "uuid", "role": "MANAGER", "display_name": "R. Baruah" } }
```
Errors: `401 INVALID_CREDENTIALS` (identical response and timing for unknown user and wrong
password), `403 ACCOUNT_DISABLED`, `429 TOO_MANY_ATTEMPTS`.

---


### `client`: how the refresh token is delivered

`POST /api/auth/login` and `POST /api/auth/refresh` accept a `client` field:

```json
{ "identifier": "…", "password": "…", "client": "web" }
```

| `client` | `refresh_token` in the response body | `Set-Cookie` |
| --- | --- | --- |
| `"web"` *(default)* | **absent — always `null`** | `ner_refresh`, `HttpOnly` |
| `"mobile"` | present, for `expo-secure-store` | none |

Defaults to `web`, which is the fail-safe direction: a caller that does not
declare itself cannot read the token. An unrecognised value is a `422`.

Nothing infers this from the `User-Agent`. Sniffing would let any caller request
the token in the body by claiming to be a phone, and would make the
confidentiality of a 30-day credential depend on a header anyone can set. See
[SECURITY.md](SECURITY.md) §1.

## 3. `/api/drivers`

| Method | Path | Perms | Notes |
| --- | --- | --- | --- |
| GET | `/api/drivers` | M A | Filter `?status=&document_status=` |
| POST | `/api/drivers` | M A | Creates linked `users` row |
| GET | `/api/drivers/{id}` | M A, D(self) | |
| PATCH | `/api/drivers/{id}` | M A | Salary fields admin-only |
| DELETE | `/api/drivers/{id}` | A | Soft delete; 409 if on an active trip |
| GET | `/api/drivers/{id}/documents` | M A, D(self) | |
| POST | `/api/drivers/{id}/documents` | M A, D(self) | Multipart upload |
| GET | `/api/drivers/{id}/trips` | M A, D(self) | History |

Errors: `422 LICENCE_EXPIRED` when assigning a driver whose licence has lapsed;
`409 DRIVER_ON_ACTIVE_TRIP` on delete.

---

## 4. `/api/trucks`

| Method | Path | Perms |
| --- | --- | --- |
| GET / POST | `/api/trucks` | M A |
| GET / PATCH | `/api/trucks/{id}` | M A |
| GET / POST | `/api/trucks/{id}/documents` | M A |
| GET / POST | `/api/trucks/{id}/maintenance` | M A |

`GET /api/trucks/{id}` returns `max_capacity_kg`, `current_load_kg`,
`available_capacity_kg` (derived), `document_summary`, and `current_trip` (nullable).
Errors: `409 REGISTRATION_EXISTS`, `422 CAPACITY_BELOW_CURRENT_LOAD` when lowering capacity below
what the truck is already carrying.

---

## 5. `/api/assignments`

| Method | Path | Perms | Notes |
| --- | --- | --- | --- |
| GET | `/api/assignments` | M A | Filter by driver/truck/status |
| POST | `/api/assignments` | M A | Ends any current assignment atomically — unless a trip is underway |
| GET | `/api/assignments/{id}` | M A, D(self) | |
| POST | `/api/assignments/{id}/verify` | D(self) | Driver submits photo + readings |
| POST | `/api/assignments/{id}/review` | M A | Resolve a flagged mismatch |
| POST | `/api/assignments/{id}/end` | M A | `409 ALREADY_ENDED`, `409 ASSIGNMENT_HAS_LIVE_TRIP` |

**An assignment cannot be ended while its trip is underway.** Ending frees the driver's slot in
the partial unique indexes, so if it were allowed mid-trip the one-current-assignment invariant
would stop meaning anything: the driver would be paired to a second truck while the fleet map
still showed them executing a trip on the first, and both would be true at once.

"Underway" is `app/domain/trip_state.py::COMMITS_DRIVER_TO_TRUCK` — `ACTIVE`, `DELAYED`,
`INCIDENT`, `DELIVERED`. The line sits at `ACTIVE` on purpose: before it the pairing is a plan and
moving a driver is ordinary dispatch work, from it onward the pairing is a fact about where a
person physically is. `DELIVERED` is included because the trip is not closed yet.

Both routes that end an assignment enforce it — `/end`, and `POST /api/assignments`, which ends
the driver's current pairing inline. Guarding only the first would leave a one-call bypass.
Refusal is `409 ASSIGNMENT_HAS_LIVE_TRIP` with the blocking `trip_id`, `trip_code` and
`trip_status` in `details`. The escape hatch is the ordinary one: close or cancel the trip.

**POST `/api/assignments/{id}/verify`** (multipart)
```
photo: <file>            reported_registration: "AS01AB1234"
reported_odometer_km: 184203    reported_fuel_level_pct: 65
damage_notes: "Minor dent, left rear panel"
```
```json
// 200
{ "id": "uuid", "status": "ACTIVE", "mismatch_flagged": false, "verified_at": "..." }
```
If `reported_registration` differs from the truck record, the response is still 200 but with
`"status": "PENDING_VERIFICATION"`, `"mismatch_flagged": true` — **the driver is not blocked, and
the manager is alerted.** A driver stuck at a depot at 04:00 because of a typo is a worse outcome
than a manager reviewing a flag. OCR, when added, only sets this flag; it never decides.

Errors: `422 DOCUMENTS_INVALID` (truck documents expired), `409 ALREADY_VERIFIED`.

---

### Current assignment invariant

A driver holds **at most one current assignment**, and a truck has **at most one
current driver**. "Current" is `ACTIVE` **or** `PENDING_VERIFICATION` — a
reported registration mismatch moves an assignment to `PENDING_VERIFICATION` and
the driver keeps the truck, so it is still current.

Enforced by two partial unique indexes (`uq_current_assignment_driver`,
`uq_current_assignment_truck`), widened in migration 0006 from an `ACTIVE`-only
predicate that let a reassignment slip past an assignment awaiting review. The
service-layer check produces a readable message; the **indexes** are the
authority, because a SELECT-then-INSERT pre-check cannot survive two concurrent
requests.

---

## 6. `/api/shipments`

| Method | Path | Perms | Status |
| --- | --- | --- | --- |
| GET | `/api/shipments` | M A | **implemented** (P5) |
| POST | `/api/shipments` | M A | **implemented** (P5) — creates the shipment and its cargo in one transaction |
| GET / PATCH | `/api/shipments/{id}` | M A | planned |
| POST | `/api/shipments/{id}/cargo` | M A | planned |
| DELETE | `/api/shipments/{id}/cargo/{item_id}` | M A | planned |

Coordinates cross the wire as a nested `{"lat": …, "lon": …}` object, not as
sibling fields on the address. The `Coordinate` schema that shape binds to is the
**only** defence against latitude/longitude inversion: PostGIS silently wraps an
out-of-range latitude over the pole into a plausible-looking point rather than
rejecting it (see `test_geospatial.py`).

```json
// POST /api/shipments
{ "client_name": "Assam Tea Co-op", "priority": "HIGH",
  "pickup": { "address": "Jorhat Warehouse", "lat": 26.7509, "lon": 94.2037 },
  "destination": { "address": "Guwahati Hub", "lat": 26.1445, "lon": 91.7362 },
  "scheduled_pickup_at": "2026-09-10T04:30:00Z",
  "cargo_items": [ { "cargo_type": "TEA", "cargo_name": "CTC chests",
                     "weight_kg": "450.00", "quantity": 30, "is_perishable": true } ] }
```
`total_weight_kg` is **server-computed** from the items and any client-supplied value is ignored.

---

## 7. `/api/trips`

| Method | Path | Perms | Status |
| --- | --- | --- | --- |
| GET | `/api/trips` | `trip:read` | **implemented** (P5) — `?trip_status=` |
| POST | `/api/trips` | `trip:create` | **implemented** (P5) — creates DRAFT, capacity gate |
| POST | `/api/trips/plan` | `trip:create` **and** `shipment:create` | **implemented** (P6) — shipment + trip in ONE transaction |
| GET | `/api/trips/{id}` | `trip:read` | **implemented** (P5) — with stops |
| POST | `/api/trips/{id}/dispatch` | `trip:dispatch` | **implemented** (P5) — DRAFT → ASSIGNED |
| POST | `/api/trips/{id}/cancel` | `trip:cancel` | **implemented** (P5) |
| POST | `/api/trips/{id}/close` | `trip:close` | **implemented** (P5) — DELIVERED → CLOSED |
| GET | `/api/trips/{id}/track` | `fleet:location_read` | **implemented** (P5) — bounded history |
| GET | `/api/trips/{id}/timeline` | `trip:read` | planned — reads `trip_events` |

**Starting a trip is not here.** It is `POST /api/driver/me/trip/start`, in
section 13a. A driver-scoped operation takes its subject from the token; putting
a trip id in the path would create exactly the parameter an IDOR needs.

### Trip state machine

Legal transitions live in `app/domain/trip_state.py` and every status write goes
through `trips.transition()`, which asserts against them before writing. An
illegal move is `409 ILLEGAL_TRIP_TRANSITION`, never a silent write.

| From | To | Actor | Preconditions | Side effects | Event |
| --- | --- | --- | --- | --- | --- |
| — | `DRAFT` | manager | shipment, driver, truck exist; capacity fits | stops created | `CREATED` |
| `DRAFT` | `ASSIGNED` | manager | licence valid, truck operational, capacity fits, open driver↔truck assignment | `dispatched_at`, `assignment_id` | `ASSIGNED` |
| `ASSIGNED` | `ACTIVE` | **driver (own)** | assignment open **and verified**, truck operational | `started_at`; driver and truck → `ON_TRIP` | `STARTED` |
| `ACTIVE`/`DELAYED` | `DELIVERED` | **driver (own)** | every stop `COMPLETED` or `SKIPPED` | `delivered_at` (server clock); driver and truck released | `DELIVERED` |
| `DELIVERED` | `CLOSED` | manager | — | `closed_at` | `CLOSED` |
| `DRAFT`/`ASSIGNED`/`ACTIVE`/`DELAYED` | `CANCELLED` | manager | — | driver and truck released | `CANCELLED` |

`COMPLETED → IN_PROGRESS` and every other resurrection is absent from the table
and therefore prohibited. `DELAYED`, `INCIDENT`, `VERIFICATION_PENDING` and
`MANAGER_REVIEW` exist in the enum and the transition map but have no endpoint
yet — they arrive with the phases that raise them.

Trip stops move `PENDING → ARRIVED → COMPLETED`, strictly in `sequence` order.
The API exposes exactly one actionable stop at a time (`next_stop_id`), because a
driver presented with several buttons will eventually press the wrong one.

**POST `/api/trips`** — creates a DRAFT:
```json
{ "trip_code": "TRP-2026-0042", "shipment_id": "uuid",
  "truck_id": "uuid", "driver_id": "uuid", "stops": [] }
```
`status` is absent by design: a client that could choose the initial status could
skip the gates guarding the path into ACTIVE. When `stops` is empty the
shipment's own pickup and destination become stops 0 and 1.

**POST `/api/trips/plan`** — creates a shipment and its trip **atomically**:
```json
{ "shipment": { "reference_code": "SHP-2026-0042", "client_name": "...",
                "pickup_address": "...", "pickup": {"lat": 26.1445, "lon": 91.7362},
                "destination_address": "...", "destination": {"lat": 26.7509, "lon": 94.2037},
                "cargo_items": [ { "cargo_type": "GENERAL", "cargo_name": "Consignment",
                                   "weight_kg": "9000", "quantity": 1 } ] },
  "trip":     { "trip_code": "TRP-2026-0042", "truck_id": "uuid", "driver_id": "uuid" } }
```
Returns the same `TripRead` as `POST /api/trips`, `201`.

`trip.shipment_id` is **absent, and that absence is the contract**: the shipment
is created in the same transaction, so its id does not exist when the request is
written. Requires **both** `shipment:create` and `trip:create`; a caller holding
only one gets `403` and nothing is written.

Why this endpoint exists: planning is one decision that touches two tables, and
as two committed calls it is not atomic. The shipment committed, the capacity
gate then refused the trip, and a cargo record nothing referenced was stranded —
one more on every retry, since each attempt mints a fresh reference code. And
`422 CAPACITY_EXCEEDED` is the refusal the planning form advertises, so managers
meet it routinely. Every gate below applies unchanged; any failure rolls the
shipment back with the trip. Pinned by `tests/test_shipment_trip_atomicity.py`.

`POST /api/shipments` and `POST /api/trips` remain: creating a shipment with no
trip is a legitimate deliberate act. What `plan` removes is doing it by accident.

Gates, checked at **creation**:
1. Shipment, driver and truck exist → else `404`
2. Driver not suspended, licence valid → else `422 DRIVER_SUSPENDED` / `422 LICENCE_EXPIRED`
3. Truck not retired, broken down or in maintenance → else `422 TRUCK_NOT_OPERATIONAL`
4. **`shipment.total_weight_kg <= truck.max_capacity_kg`** → else `422 CAPACITY_EXCEEDED`

Re-checked at **dispatch**, plus:

5. An open driver↔truck assignment exists → else `409 NO_ACTIVE_ASSIGNMENT`

Re-checking is not redundancy: a licence lapses, a truck breaks down and an
assignment ends between planning a trip and dispatching it. Dispatch **never**
creates a missing assignment to make itself succeed — a trip whose driver is not
actually responsible for the truck is a paperwork fiction, and manufacturing the
assignment would destroy the only record of who was.

422 rather than 403 for the capacity and licence gates is deliberate: 403 means
"you may not", 422 means "nobody may". No role can authorise an overloaded truck.

Truck-document validation (`422 DOCUMENTS_INVALID`) and route/fuel estimation are
still planned; neither is implemented, and the 201 response carries no `routes`
array yet.

```json
// 201
{ "id": "uuid", "trip_code": "TRP-2026-0042", "status": "DRAFT",
  "shipment_id": "uuid", "truck_id": "uuid", "driver_id": "uuid",
  "dispatched_at": null, "started_at": null, "delivered_at": null,
  "planned_eta": null, "current_eta": null, "delay_minutes": null }
```

When routing arrives it will add a `routes` array. `estimated_fuel_*` being
`null` will be a legitimate response meaning the model was unavailable: clients
must render "unavailable", never `0` and never a guess, and
`fuel_estimate_source` says whether a number came from the model or the km/l
baseline.

---

## 8. Location telemetry

The paths planned here in P1 were `/api/gps/batch`, `/api/gps/live` and
`/api/gps/trips/{id}/track`. P5 implements the same three operations at
**driver-scoped and resource-scoped paths instead**, because the planned shape
required the client to name its own trip:

| Planned | Implemented (P5) | Perms |
| --- | --- | --- |
| `POST /api/gps/batch` | `POST /api/driver/me/location` | `location:submit_own` (DRIVER) |
| `GET /api/gps/live` | `GET /api/fleet/active` | `fleet:location_read` |
| `GET /api/gps/trips/{id}/track` | `GET /api/trips/{id}/track` | `fleet:location_read` |

**POST `/api/driver/me/location`**
```json
{ "trip_id": "uuid",
  "fixes": [ { "device_fix_id": "uuid",
               "location": { "lat": 26.1445, "lon": 91.7362 },
               "altitude_m": "55.20", "speed_kmph": "42.50", "heading_deg": "118.00",
               "accuracy_m": "8.40", "recorded_at": "2026-09-10T05:12:33Z",
               "is_mock_location": false } ] }
```
```json
// 202
{ "trip_id": "uuid", "accepted": 12, "duplicates_ignored": 3, "rejected": 1,
  "rejected_reasons": { "STALE": 1 }, "anomalies": ["POOR_ACCURACY"],
  "server_time": "..." }
```

`trip_id` is **optional and narrowing-only** — the trip is resolved from the
authenticated driver regardless, and a mismatch is `409 TRIP_SUPERSEDED`. There
is no `driver_id`, `truck_id` or `user_id` in the contract at all: those are
server-decided, and `extra="forbid"` turns an attempt to send one into a 422.

Coordinates are the nested `{"lat", "lon"}` object, not sibling fields. That is
the shape `Coordinate` validates, and its bounds are the only thing standing
between an inverted pair and a plausible-looking point in the Arctic.

Contract rules that make offline operation safe:
- **Idempotent on `(trip_id, device_fix_id)`,** enforced by a unique index plus
  `INSERT … ON CONFLICT DO NOTHING` — never a SELECT-then-INSERT, which two
  concurrent uploads both pass. Duplicates are counted, not errored.
- Batches of 1–500 fixes; backdated fixes accepted up to 24h; timestamps more
  than 2 minutes in the future are rejected.
- **Per-fix dispositions, not a per-batch verdict.** A reconnecting truck flushes
  hundreds of fixes and one bad timestamp must not discard the rest. Malformed
  input is still a 422 for the whole request — that is a broken client.
- `202` not `201` — accepted for processing.
- Collection is bound to an **in-progress trip**, enforced server-side. No trip,
  or a trip not yet started, and the request is refused ([SECURITY.md](SECURITY.md) §3).
- **No audit row per fix.** One `audit_logs` entry per GPS point would bury the
  compliance trail under telemetry. GPS goes to `gps_points` and nowhere else.
- `is_mock_location` and the computed anomaly flags are stored and surfaced. They
  are **never** used to auto-reject a fix ([SECURITY.md](SECURITY.md) §8).

**GET `/api/fleet/active`**
```json
{ "trips": [ { "trip_id": "uuid", "trip_code": "TRP-…", "trip_status": "ACTIVE",
               "driver_name": "…", "registration_number": "AS01AB1234",
               "position": { "location": { "lat": 26.1445, "lon": 91.7362 },
                             "recorded_at": "…", "received_at": "…",
                             "age_seconds": 12.4, "freshness": "LIVE",
                             "speed_kmph": 42.5, "is_mock_location": false },
               "freshness": "LIVE",
               "next_stop_sequence": 1, "stops_done": 1, "stops_total": 2 } ],
  "fresh_seconds": 90, "stale_seconds": 600, "server_time": "…" }
```

Freshness is `LIVE` | `STALE` | `NO_CONTACT` | `NO_LOCATION`, decided by the
server and returned with the threshold behind it. `NO_LOCATION` means no fix has
**ever** arrived, which is a different fact from a stale one and is rendered
differently.

`age_seconds` is measured from `received_at`, the **server** clock — a phone with
a wrong or manipulated clock cannot make an old position look current. And
"current location" is the newest observation by `recorded_at`, not the last row
inserted: a reconnecting truck's backlog arrives newest-last.

**GET `/api/trips/{id}/track`** returns a bounded window, newest first, capped at
1000 points and defaulting to 500, with `truncated` set when the cap was hit.
There is deliberately **no all-history mode**: an unrestricted GPS dump turns an
authorised "where is this truck" read into a complete movement profile of a
person.

---

## 9. `/api/routes`

| Method | Path | Perms | Status |
| --- | --- | --- | --- |
| GET | `/api/trips/{id}/routes` | `route:read` | **implemented** (P7) — includes SUPERSEDED |
| POST | `/api/trips/{id}/routes/recalculate` | `route:plan` | **implemented** (P7) |
| POST | `/api/trips/{id}/routes/{route_id}/select` | `route:select` | **implemented** (P7) |
| POST | `/api/routes/preview` | M A | planned — candidates without a trip |
| GET | `/api/trips/{id}/routes/{route_id}/review-authorization` | `route:read` | **implemented** (LS-11) — the live authorisation, or null |
| POST | `/api/trips/{id}/routes/{route_id}/review-authorization` | `route:review_authorize` | **implemented** (LS-11) — authorise ONE selection |
| DELETE | `/api/trips/{id}/routes/{route_id}/review-authorization/{auth_id}` | `route:review_authorize` | **implemented** (LS-11) — revoke an unspent one |
| GET | `/api/trips/{id}/routes/{route_id}/risk` | `route:read` | **implemented** (P8) — deterministic route risk V1 |
| GET | `/api/trips/{id}/routes/recommendation` | `route:read` | **implemented** — Explainable Route Recommendation V1 |
| GET | `/api/trips/{id}/reroute` | `route:read` | **implemented** — reroute assessment V1 |
| POST | `/api/trips/{id}/reroute/accept` | `route:select` | **implemented** — the ONLY way a moving trip's route changes |
| GET | `/api/driver/me/trip/offline-package` | driver (own trip) | **implemented** — offline corridor package V1 |
| GET | `/api/driver/me/trip/navigation` | driver (own trip) | **implemented** (LS-12 G2.1) — turn instructions for the current route |

### Route risk (`GET /api/trips/{id}/routes/{route_id}/risk`)

Weather sampled at five points along the route geometry, scored by a **deterministic weighted
rule with published constants** (`app/domain/route_risk.py`). It is **not** a model. There is no
`confidence`, no `model_version` and no `predicted_delay` field, because there is no training
data, no validation split and no metrics — and a test asserts those fields stay absent.

The response carries its own gaps. `inputs` maps every factor a complete assessment would want
to `AVAILABLE` or `NOT_AVAILABLE`, and `unavailable` lists the absent ones, so
`landslide: NOT_AVAILABLE` is visible beside the score. A bare number would be read as complete.

```json
// 200
{ "score": 37, "band": "MODERATE",
  "components": [
    { "code": "RAIN_EXPOSURE", "label": "Rain exposure", "points": 18,
      "detail": "peak 9.0 mm/h across 3 of 5 sampled points" },
    { "code": "DURATION_EXPOSURE", "label": "Travel duration", "points": 15,
      "detail": "360 min on the road" },
    { "code": "DISTANCE_EXPOSURE", "label": "Distance", "points": 4,
      "detail": "305 km" } ],
  "inputs": { "distance": "AVAILABLE", "duration": "AVAILABLE", "weather": "AVAILABLE",
               "landslide": "NOT_AVAILABLE", "road_quality": "NOT_AVAILABLE" },
  "unavailable": ["landslide", "road_quality", "truck_restrictions", "fuel_model"],
  "reason_codes": ["HEAVY_RAIN_ON_ROUTE"],
  "observations_used": 5, "observations_stale": 0,
  "assessed_at": "2026-08-31T09:00:00Z" }
```

The components sum to the score — asserted by test, so the breakdown is an explanation rather
than decoration.

`reason_codes` are **codes, not sentences**, so the driver app can render Hindi or Assamese from
local translation files with no LLM in the loop. A sentence composed here would arrive on the
phone untranslatable.

**Stale observations are never scored.** A reading past the freshness window is counted in
`observations_stale` and excluded from the score — a stale calm reading must not dilute live
heavy rain.

**A weather outage is not a request failure.** The endpoint answers 200 with
`weather: NOT_AVAILABLE` and `WEATHER_UNAVAILABLE`; distance and duration are still evidence.

Nothing is persisted. A risk score describes *now*, and a stored one would look current long
after it stopped being true. `route_id` is scoped by `trip_id`, so another trip's route is 404.

`recalculate` inserts new `trip_routes` rows and marks obsolete **unselected** ones
SUPERSEDED — it never mutates history. Route history is evidence in an incident review.

**Planning does not change the route a trip is following (LS-10).** The row
`trips.selected_route_id` points at is left alone, because `SUPERSEDED` is terminal here —
`select` refuses it and the recommendation drops it from candidates — and asking a provider
what else exists is not consent to take a moving truck off its road. Only `select` (before
departure) or `reroute/accept` (in transit) changes the assignment.

Every route in `GET /api/trips/{id}/routes` therefore carries **`is_current`**: true for the
row `trips.selected_route_id` names, and it is the field a client must use. It is NOT the same
as `state == "SELECTED"` — trips written before this fix still point at a row reading
`SUPERSEDED`, and the driver is following it. Those rows report `is_current: true` with their
real `state`; they are shown honestly and are still refused for re-selection
(`422 ROUTE_SUPERSEDED`). No read endpoint rewrites them.

Errors: `503 ROUTING_UNAVAILABLE` (every provider unreachable; a retry may succeed) and
`422 NO_VIABLE_ROUTE` (a provider answered and no route exists). Those are deliberately
different: collapsing them would tell a manager a trip is unroutable when the provider is
merely having a bad minute.

**`PRIMARY` always; `EMERGENCY_BACKUP` conditionally; `FUEL_EFFICIENT` never.**

`PRIMARY` is written whenever a provider answers. `EMERGENCY_BACKUP` is written only when the
provider returns an alternative that is a **genuinely different corridor** — judged by sampled
point-to-point separation (2 km), not by comparing total distances, because two routes can
share a length and go different ways. Providers routinely offer an "alternative" that leaves
the highway for a few hundred metres and rejoins it; storing that would put a choice in front
of a dispatcher that is not a choice. On most NER corridors there is one sensible road and no
alternative comes back at all — `backup_planned: false` is the ordinary answer, not a failure.

`FUEL_EFFICIENT` is **never** produced. Ranking by consumption needs a fuel model, and none
exists (`ml/` is a README). Relabelling the primary route would be a fabricated feature
indistinguishable from a working one — `docs/AI_MODELS.md` §0.

`estimated_fuel_litres` is **absent from the response contract**, not returned as null — a
permanently-null field invites a client to render `0`, and `docs/AI_MODELS.md` §0 forbids
stating a number that came from no evaluation.

`estimated_duration_min` is the provider's **free-flow travel time, not an ETA.** No departure
time, traffic or stop dwell is accounted for. The UI must not present it as an arrival time.

**Provider chain.** `primary → fallback`, normalised to one internal shape so no business logic
depends on a provider's response format. A provider *outage* falls through to the next; a
provider *refusal* is terminal, because a second provider will also fail to route from an
unroutable point and trying it spends another timeout to reach the same answer. The keyless
fallback is the public OSRM demo server, whose own policy states it gives no quality guarantee
and that access "shall be withdrawn at any time" — so it is a fallback, not something to demo on
alone.

`ROUTING_PRIMARY_URL` accepts any OSRM-compatible endpoint that needs no credential — a
self-hosted instance, for example. **There is deliberately no key setting.** A provider that
requires one needs its own class against `RoutingProvider`, because where a credential goes
differs per vendor; a setting that accepted a key and sent it nowhere would let someone configure
it, watch routing work through the fallback, and believe the key was in use. When such a provider
is added its credential is a **backend** secret and must never take a `VITE_` or `EXPO_PUBLIC_`
prefix, since those are inlined into client bundles.

Geometry is requested at OSRM's `overview=simplified`. Measured against the live service on the
Guwahati–Jorhat corridor, `full` returns 5,213 points (~121 KB of JSON per route, fetched on every
trip selection) where `simplified` returns 52 (~1.2 KB) with **identical** distance and duration.

---

Each candidate in the recommendation carries **`eligibility`** — `ELIGIBLE`,
`REQUIRES_REVIEW`, `REJECTED` or `NOT_ASSESSED` — decided by the server from that route's own
hazard evidence. `risk.reason_codes` says *why*; this says *what*. A client must never
re-derive it: a client holding a copy of the eligibility rule is a client asserting its own
eligibility.

### Review authorisation (LS-11)

With no landslide source connected every route assesses UNKNOWN, so
`select` and `reroute/accept` refuse with `ROUTE_SELECTION_REQUIRES_REVIEW`.
An **authorised reviewer** may accept that specific, incomplete evidence so that
**one** selection may proceed.

    POST .../review-authorization      body: { "rationale": "..." }   -> 201

`rationale` is the ONLY field a client sends. The trip, route, evidence digest
and snapshot, policy and evidence versions, basis, and the issue/expiry times
are all computed server-side from the route's own assessment — there is no field
by which a caller can assert what it is authorising.

`select` and `reroute/accept` then take an optional `authorization_id`
(query parameter and body field respectively). It **only ever relaxes
REQUIRES_REVIEW**. It cannot reach:

| State | Why not |
| --- | --- |
| `REJECTED` | a verified closure. No role, rationale or policy overrides a road an authority has shut |
| `NOT_ASSESSED` | an integration failure in this application, not uncertainty about a road. It must be fixed, not approved |
| HIGH evidence | out of the approved scope — only assessed `HAZARD_DATA_UNKNOWN` is authorisable today |

Spending it is a single conditional UPDATE inside the selection's own
transaction, under the trip row lock, after the route has been re-read. It is
refused (`ROUTE_REVIEW_AUTHORIZATION_INVALID`) if expired, already used,
revoked, issued by the person now selecting, or if the route's lifecycle state
or its evidence digest changed since issue. A failed selection rolls the
consumption back with it, so an authorisation is never spent on a mutation that
did not happen.

**It does not change what the evidence says.** After a consumed authorisation
the route still reports `landslide: NOT_AVAILABLE` and
`LANDSLIDE_DATA_NOT_CONFIGURED`. What is recorded is that a named person
accepted incomplete evidence at a particular time — never that the road was
checked. UI wording must reflect that: "Hazard data incomplete — authorized for
this selection", never "safe" or "verified".

Two-person control: `AUTHORISED_REVIEWER` holds `route:review_authorize` and
deliberately NOT `route:select`. ADMIN holds both through `ALL_PERMISSIONS`, so
`reviewer_user_id != consumer` is ALSO enforced explicitly at consumption.

### Route recommendation (`GET /api/trips/{id}/routes/recommendation`)

Every live route on the trip scored against current conditions, then compared. Superseded and
blocked routes are excluded: history is evidence, but advice is about what to do next.

**Explainable Route Recommendation V1** (`app/domain/route_recommendation.py`) — a published
comparison rule over deterministic inputs. Not a model, and `version` says so; a test pins the
string.

The rule: the baseline is `PRIMARY`, and a switch is advised only when a comparable alternative
is lower by `MIN_RISK_MARGIN_POINTS` (10). Below that the gap is noise on inputs this coarse and
a detour is not free — but the figures are still returned, because a manager overruling the rule
deserves the numbers the rule used.

```json
// 200
{ "recommended_route_id": "…b2", "baseline_route_id": "…p1", "comparable": true,
  "reason_codes": ["LOWER_RISK_ALTERNATIVE", "ALTERNATIVE_IS_SLOWER", "ALTERNATIVE_IS_LONGER"],
  "tradeoff": { "duration_delta_min": 23.0, "distance_delta_km": 21.0, "risk_delta_points": -33 },
  "candidates": [ { "route_id": "…p1", "kind": "PRIMARY", "distance_km": 305.0,
                    "estimated_duration_min": 221, "risk": { "…": "as above" } } ],
  "unavailable_inputs": ["flood", "landslide", "road_quality", "truck_restrictions"],
  "margin_points": 10, "version": "explainable-route-recommendation-v1" }
```

Read **`comparable` first.** False means the answer does not rest on a like-for-like comparison.

**No percentages, anywhere.** Deltas are in points, minutes and kilometres — the units the
inputs arrived in. "33 points lower" is checkable against the components that produced it;
"54% safer" is a claim about probability of harm and nothing here measures that. A test asserts
`%`, `confidence`, `probability`, `predicted` and `model_version` never reach the wire.

**A single corridor is a truthful answer, not a degraded one.** One route yields
`ONLY_ONE_ROUTE_AVAILABLE`, `comparable: false`, `tradeoff: null`. No backup is invented.

**Asymmetric evidence refuses to recommend.** The failure a naive comparison walks into: weather
only ever ADDS points, so a route the provider failed on scores lower purely from the missing
factor — and it fails most readily in a storm, which is exactly when it matters. When the
available-input sets differ the comparison is declined with `RISK_INPUTS_NOT_COMPARABLE` and the
baseline is kept.

**NULL stays NULL.** A route with no duration estimate reports a `null` delta, never 0, and
sorts last among equals rather than first.

Cost: `MAX_CANDIDATE_ROUTES` (2) × `ROUTE_SAMPLES` (5) = at most ten weather requests per call.
A considered read, not a feed. **A client must not poll it.** The database connection is released
before any provider call — asserted from inside the stub.

### Reroute (`GET /api/trips/{id}/reroute`, `POST /api/trips/{id}/reroute/accept`)

Three outcomes, and the third is the one that matters:

| outcome | meaning |
| --- | --- |
| `NO_ACTION` | the road is not bad enough to reconsider |
| `ALERT_ONLY` | it IS bad, and there is **nothing better to offer** |
| `PROPOSE` | it is bad, and a genuinely better road exists |

`ALERT_ONLY` exists because much of the North East is a single corridor. A system that only
knows how to propose alternatives falls silent in exactly the situation that matters most;
"this road has deteriorated and there is no better option" is what makes a dispatcher phone the
driver. `proposed_route_id` is `null` there **on purpose** — returning the least-bad alternative
would read as advice to take it.

`DETERIORATION_FLOOR` is imported from `route_risk.BAND_HIGH_AT` rather than repeated, so "we
reconsider once it reads HIGH" stays one number. The floor is necessary, not tidy: without it
every marginally-better parallel road becomes an interruption, and proposals that arrive when
nothing is wrong are the ones that get dismissed unread.

The comparison is **not re-invented** — it is `route_recommendation.recommend` with an explicit
baseline of the route the truck is ON, not the `PRIMARY`. A trip already rerouted once must not
be compared against the road it left.

```json
// GET 200
{ "outcome": "PROPOSE", "selected_route_id": "…p1", "selected_risk_score": 85,
  "selected_risk_band": "HIGH", "proposed_route_id": "…b2",
  "reason_codes": ["SELECTED_ROUTE_DETERIORATED", "BETTER_ROUTE_AVAILABLE"],
  "comparison": { "…": "a RouteRecommendation" },
  "unavailable_inputs": ["landslide"], "floor_points": 60, "margin_points": 10,
  "version": "reroute-assessment-v1" }
```

**Nothing reroutes itself.** There is no scheduler, no background task that applies a proposal,
and no code path from the assessment to a write. A test issues three consecutive assessments and
asserts `selected_route_id` and the trip's event count are unchanged. A driver on a hill road at
night whose map silently changes has been given an instruction nobody issued.

**No model writes trip state.** `POST .../reroute/accept` accepts exactly
`{from_route_id, to_route_id}` — asserted by test on `model_fields`. There is no free text and
nothing derived from a language model on the write path.

`from_route_id` must match what the trip currently has selected. A manager acting on a page
rendered before someone else rerouted the same trip would otherwise move it off a road they
never saw; that is `409 ROUTE_SUPERSEDED` telling them to reload, not a silent overwrite. Two
managers accepting simultaneously get exactly one 200 and one 409, and exactly one
`ROUTE_CHANGED` event — measured with two independent app instances, not argued.

**One transaction.** `routes.apply_selection` deliberately does not commit, so the route change,
the demotion of the route being left, `trips.selected_route_id`, the timeline event and the
audit row all land together. A test monkeypatches the event write to fail and asserts the trip
stays on its original route.

The route left behind is demoted to `PROPOSED`, **not** `SUPERSEDED`. Weather is not permanent:
a corridor abandoned this afternoon may be right this evening, and marking it dead would make a
reroute a one-way door.

A trip that is not in transit is refused with `409 TRIP_NOT_IN_TRANSIT` — changing a route
before departure is ordinary planning and belongs on the select endpoint, where nobody has to be
told a journey changed mid-way.

**A declined proposal is not recorded.** No `trip_event_kind` value honestly means "a manager
was offered a safer road and stayed", and misusing one would be a lie in the audit trail. The
migration is prepared and deliberately **not applied** —
`docs/migrations/PENDING_reroute_decision_events.sql`.

### Navigation package (`GET /api/driver/me/trip/navigation`)

Turn instructions for the corridor this driver's trip currently follows. Subject taken from the
token; no trip id in the path, so there is no parameter in which to ask for another driver's
guidance.

404 only when there is no current trip, matching the offline package. Having a trip whose route
cannot drive guidance is a **200 with `available: false`** and a reason code — that is a state the
map renders, not an error it should retry.

**`geometry` is returned even when `available` is false.** Losing directions is not losing the
road, and a map that blanks because maneuvers are missing has turned a degraded feature into a
broken screen.

| field | meaning |
| --- | --- |
| `route_id`, `route_revision` | which corridor these instructions describe. A client compares both before drawing a cached package |
| `available`, `reason_codes` | whether guidance can be driven, and why not |
| `geometry` | `[[lat, lon], ...]` in travel order |
| `maneuvers` | ordered provider instructions — see below |
| `distance_m`, `duration_s` | provider totals. `duration_s` is **free-flow**, never an arrival time |
| `provider`, `provider_route_id` | traces a displayed instruction back to what produced it |
| `captured_at` | when the package was assembled. Separate from route approval and from GPS freshness |
| `coordinate_format`, `distance_unit`, `duration_unit` | declared, not inferred from field names |

#### `distance_from_start_m` is the field a next-turn panel needs

The one contract detail worth reading twice.

OSRM's `step.distance` is *"the distance of travel from the maneuver to the subsequent step's
maneuver"* — it measures **forward**. It is therefore **not** the answer to "how far until I
turn", and a panel that renders it as one is wrong by exactly one step.

Verified against the provider rather than argued from documentation: a 5,942 m Guwahati route
returns 17 steps whose distances sum to 5,942.5 m with a final `arrive` step of **0.0 m**. A
backward-measured step could be neither. The demo corridor agrees — 19 maneuvers whose
`step_distance_m` sum to 305,393 m against a route distance of 305,393 m.

So each maneuver carries both:

| field | measures |
| --- | --- |
| `distance_from_start_m` | along the route, from its start to this maneuver |
| `step_distance_m` | from this maneuver to the **next** one; `0.0` at arrival |

Distance to the next turn is `distance_from_start_m - distance_already_travelled`, using the
`progress.travelled_distance_km` the trip poll already carries. That is remaining path length,
needs no step arithmetic on the client, and has no off-by-one available to get wrong.

Measured on the demo corridor at 79.2 km travelled: the correct distance to the next maneuver is
**42,867 m**; that maneuver's own `step_distance_m` is **4,918 m**.

#### Availability reasons

| code | meaning |
| --- | --- |
| `NO_SELECTED_ROUTE` | no corridor is assigned, or the selection is SUPERSEDED. Not dispatched — a different state from cannot guide |
| `GUIDANCE_NOT_AVAILABLE` | the route carries no stored maneuvers. **Never** "this road has no turns" |
| `GUIDANCE_INCONSISTENT_WITH_ROUTE` | stored maneuvers do not address this geometry, or run backwards. Refused rather than drawn — directions for another road render perfectly and are wrong |
| `DURATION_IS_FREE_FLOW_NOT_AN_ETA` | travels beside every `duration_s` |

Parsing is all-or-nothing. Half a set of directions runs out mid-journey and reads as an
arrival, which is worse than none. Rows written before `step_distance_m` was renamed from
`distance_m` still parse: the name was wrong, the number never was.

#### Planning a route that can be navigated

`POST /api/trips/{id}/routes/recalculate?detailed=true` asks the provider for full geometry and
turn-by-turn steps **in one response**, and stores the maneuvers alongside the geometry they
describe. That single-response property is what makes it impossible for a route to carry
directions for a different road.

`detailed` is **off by default**, and that is a cost decision: full geometry plus steps is 5,213
points against 52 for the simplified overview, and most plans are comparisons that are never
driven.

Planning does not select. A detailed candidate goes through the same assessment and acceptance
as any other route — on the demo corridor that meant a `422 ROUTE_SELECTION_REQUIRES_REVIEW`,
a reviewer authorisation under `HAZARD_DATA_UNKNOWN`, and a different account spending it.

### Offline corridor package (`GET /api/driver/me/trip/offline-package`)

The driver's own current trip, packaged to survive losing the network. Subject taken from the
token; no trip id in the path.

404 when there is no current trip — unlike `GET /api/driver/me/trip`, which answers `null`
because between-trips is a normal screen. Asking to *download* a journey that does not exist is
a request that cannot be satisfied, and `null` would leave the app guessing whether to retry.

Three things are kept apart, because conflating them is how this feature gets overclaimed:

| | status |
| --- | --- |
| offline **route** | **built** — the corridor already chosen, its geometry, stops and estimates |
| offline **routing** | **not built, not claimed** — computing a NEW route needs a road graph on the device |
| offline **basemap** | **blocked on licence** — see below |

`basemap` is `BUNDLED_NONE` with reason `BASEMAP_NOT_BUNDLED_LICENCE`. The OSM Foundation tile
usage policy prohibits prefetch and "download area for offline use" against
`tile.openstreetmap.org`, which is the tile source this project uses. Bulk-caching it would be a
policy violation dressed up as a feature. The gap is **declared**, so a driver is told at the
depot rather than discovering it in a valley.

`risk` is a **snapshot** stamped with `risk_captured_at`, never presented as live. The app must
render it against that timestamp and let it age on screen using the device clock alone. A
weather panel still reading LIGHT RAIN ten hours into a signal blackout is the failure the field
exists to prevent.

A weather outage does **not** block the download: the route is the part that cannot be
recomputed on the roadside.

`backup_route` is `null` with `NO_DISTINCT_BACKUP_CORRIDOR` on a single-road corridor. Handing a
driver an escape road that does not exist, at the moment they most need one, is the worst thing
this endpoint could do.

`package_hash` covers only the durable parts — identity, stops, route geometry — so a device can
ask "has the corridor changed" without the answer flipping every time the weather does. A test
asserts a changed risk score leaves the hash alone.

### Route progress (on `GET /api/driver/me/trip`)

`progress` is `null` only when the trip has no selected route — progress along a corridor nobody
chose is not a degraded answer, there is no corridor. Every other gap, including having no
position at all, is expressed inside the object through its reason codes, so the app has one
shape to render rather than two.

Measured by **projecting the last observed fix onto the planned line**. The planned route and
the observed track are different objects; `off_route_m` is the distance between them and is the
number that says whether the rest mean anything. When off-route the figures still return, WITH
`VEHICLE_OFF_PLANNED_ROUTE` — withholding them would leave a dispatcher with less than they had.

**There is no ETA, and the naming is part of the guarantee.** A provider's `duration` is a
free-flow estimate over a road graph; it knows nothing about this load, the driver's break or a
checkpoint queue. What ships is `remaining_at_planned_pace_min` beside
`planned_average_speed_kmph` and `REMAINING_TIME_ASSUMES_PLANNED_PACE`. A test walks the object's
field names and rejects any containing `eta`, `arrival`, `arrives`, `due_at` or `arrive`.

No provider duration means `null`, never a guess from a default speed — an invented speed
produces a figure indistinguishable on screen from a measured one. No position means `null`, not
zero: a truck with no fix has not arrived.


## 10. `/api/weather` and `/api/incidents`

| Method | Path | Perms | Notes |
| --- | --- | --- | --- |
| GET | `/api/weather/along-route/{route_id}` | M A | |
| GET | `/api/weather/area` | M A | `?lat=&lon=&radius_km=` |
| GET | `/api/incidents` | M A, D | `?state=&severity=&bbox=` |
| POST | `/api/incidents` | M A, D | Drivers may report; `source=DRIVER_REPORT` |
| PATCH | `/api/incidents/{id}` | M A | Confirm / clear |
| GET | `/api/incidents/{id}/affected-trips` | M A | The reroute trigger |

Driver-reported incidents enter as `state=REPORTED` and do **not** apply the hard route filter
until a manager confirms them. Otherwise one driver could reroute an entire fleet.

---

## 11. `/api/fuel`

| Method | Path | Perms |
| --- | --- | --- |
| POST | `/api/fuel/estimate` | M A |
| GET | `/api/fuel/model-info` | M A |

```json
// POST /api/fuel/estimate  -> 200
{ "estimated_litres": "78.20", "estimated_cost": "7429.00",
  "safety_reserve_litres": "11.70", "refuelling_required": false,
  "source": "MODEL_V1", "model_version": "fuel-lgbm-v1",
  "confidence_interval": { "low": "71.00", "high": "86.10" },
  "baseline_litres": "82.10", "baseline_source": "truck_baseline_kmpl" }
```
The baseline is returned **alongside** every model estimate, deliberately. It keeps the model
honest in the UI and makes the "does the model beat the baseline" question inspectable at runtime
rather than only at training time. `GET /model-info` returns training date, feature list, and
measured baseline comparison — never a bare accuracy number.

---

## 12. `/api/payments`, `/api/expenses`, `/api/deliveries`

| Method | Path | Perms | Notes |
| --- | --- | --- | --- |
| GET/POST | `/api/payments` | M A | |
| PATCH | `/api/payments/{id}` | M A | Status transitions only |
| GET/POST | `/api/expenses` | M A, D(own submit) | Multipart receipt |
| POST | `/api/expenses/{id}/approve` \| `/reject` | M A | |
| GET | `/api/payroll/{driver_id}` | A, D(self) | |
| POST | `/api/deliveries` | D(own) | PoD: signature + photos |
| GET | `/api/deliveries/{trip_id}` | M A, D(own) | |

No endpoint in this group initiates a transfer, and none accepts card, UPI or bank credentials.
These record asserted state only.

PoD capture returns `geofence_ok: false` when the capture point is beyond the configured radius
from the destination. The delivery is still recorded — GPS drift in hill terrain is common — but
the flag is surfaced to the manager.

---

## 13. `/api/alerts` and `/api/emergencies`

| Method | Path | Perms | Notes |
| --- | --- | --- | --- |
| GET | `/api/alerts` | M A, D(own) | `?unacknowledged=true` |
| POST | `/api/alerts/{id}/ack` | M A, D(own) | |
| GET | `/api/emergencies` | M A | |
| GET | `/api/emergencies/{id}` | M A | Full briefing |
| POST | `/api/emergencies/{id}/respond` | **D(own only)** | Driver check-in |
| POST | `/api/emergencies/{id}/resolve` | M A | Requires `resolution_note` |

**POST `/api/emergencies/{id}/respond`** — the driver safety endpoint:
```json
{ "response": "BREAKDOWN", "note": "Clutch failure, waiting for mechanic" }
```
```json
// 200
{ "id": "uuid", "state": "DRIVER_RESPONDED", "responded_at": "...",
  "escalation_cancelled": true }
```
- `response: "NEED_HELP"` escalates **immediately**, returning `"state": "SOS_ESCALATED"`.
- Accepted even after `response_deadline_at` has passed and the state is already `SOS_ESCALATED` —
  a late "I am safe" must always be recordable. It sets `driver_response` and alerts the manager,
  but does **not** silently close the emergency; only a manager resolves it.
- This is the one endpoint that must never be rate-limited into failure.

`GET /api/emergencies/{id}` returns the full briefing from
[ARCHITECTURE.md](ARCHITECTURE.md) Diagram F, served from `briefing_snapshot` so it reflects
conditions at escalation, with a separate `current` block for live values.

---

## 13a. `/api/driver` — driver self-service *(implemented)*

Every route is scoped to the authenticated driver by `require_current_driver`.
**None accepts a driver id**, so there is nothing to enumerate: the subject comes
from the token, not the URL.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/driver/me` | The signed-in driver's own profile |
| GET | `/api/driver/me/assignment` | Current assignment, or `null` |
| POST | `/api/driver/me/assignment/verify` | Confirm the physical truck |
| GET | `/api/driver/me/trip` | Current trip with stops, or `null` |
| GET | `/api/driver/me/trip/places` | Roadside services from a local OSM corridor snapshot |
| POST | `/api/driver/me/trip/accept` | Records the driver's acknowledgment. **No status change** |
| POST | `/api/driver/me/trip/start` | ASSIGNED → ACTIVE |
| POST | `/api/driver/me/trip/stops/{stop_id}/arrive` | PENDING → ARRIVED |
| POST | `/api/driver/me/trip/stops/{stop_id}/complete` | ARRIVED → COMPLETED |
| POST | `/api/driver/me/trip/complete` | ACTIVE/DELAYED → DELIVERED |
| POST | `/api/driver/me/location` | Position fixes for the current trip |

`stop_id` is the one id that appears in a driver path, and it is checked for
membership of the driver's **own** trip. A stop belonging to another trip is a
**404, not a 403** — confirming that the id exists would itself disclose
something about a trip that is not theirs.

`GET /api/driver/me/assignment` returns **200 with a null body** when the driver
has no assignment. Unassigned is a normal state, not an error, so the app renders
an empty screen rather than special-casing a 404. `GET /api/driver/me/trip`
behaves the same way: a driver between trips is a normal state.

**`GET /api/driver/me/trip`** carries everything the trip screen needs, all
server-decided:

| Field | Why the server decides it |
| --- | --- |
| `stops`, `next_stop_id` | Exactly one stop is actionable at a time, in `sequence` order |
| `can_start`, `start_blocked_code`, `start_blocked_reason` | Computed by the **same function** `POST .../start` uses, so a control the app enables is one the server will honour |
| `tracking_expected` | Whether the server will accept location for this trip at all |
| `tracking` | Upload cadence and the freshness threshold — the app holds no copies, so what a phone uploads and what a manager calls "live" cannot drift apart |
| `last_fix` | When a fix last **landed**, by the server clock, so the app reports what was delivered rather than what it queued |
| `selected_route_id` | **Which** route the driver is on, or `null` when none is selected. Added LS-12 for the driver map |
| `driver_accepted_at` | When **this** driver acknowledged the job, or `null`. Added LS-12 G1A. Not a start gate |

Responses carry only what the app needs — no manager metadata, no salary, no
other drivers, no document contents.

**`selected_route_id` carries the route IDENTITY, never the geometry** (LS-12).
This payload is re-read every ten seconds by the driver's poll, and a route
polyline is tens of kilobytes that changes only when a manager selects or
reroutes — sending it on every poll to detect a rare change is the wrong trade.
So the id travels here and the geometry is fetched from
`GET /api/driver/me/trip/offline-package`, exactly when the id moves.

It is also what lets a client PROVE that the map, the stops and the progress
figures it is showing all describe the same approved route, rather than three
reads that happened to interleave with a reroute. The driver map refuses to
draw a cached corridor whose `selected_route.route_id` does not equal this
value: a package from before a reroute is not a stale version of the current
route, it is a different road.

### Trip acceptance (`POST /api/driver/me/trip/accept`) — LS-12 G1A

The driver acknowledges a dispatched job. **This is not a lifecycle
transition**: the trip stays `ASSIGNED`, `started_at` stays null, and driver
and truck stay available to the planner. Starting travel remains
`POST /api/driver/me/trip/start`, unchanged, under the same `can_start` gate.

Relabelling `start` as "Accept" was rejected deliberately. A driver who has
accepted a job at the depot has not begun travelling, and a dispatcher reading
`ACTIVE` would believe a truck was moving that is still parked.

| Property | Behaviour |
| --- | --- |
| Subject | From the token. `trip_id` in the body can only NARROW; a mismatch is `409 TRIP_SUPERSEDED` |
| Idempotency | Accepting twice returns the first acceptance unchanged and writes **one** `ACCEPTED` timeline event. Concurrent taps serialise on the trip row lock |
| Terminal trips | `409 TRIP_NOT_ACCEPTABLE` for DELIVERED / CLOSED / CANCELLED — a stale screen, not a retry |
| Not a gate | `can_start`, route eligibility, the hazard refusal and the review authorisation do not read it. Accepting a blocked trip leaves it blocked |
| Atomicity | The stamp, the timeline event and the audit row commit together or not at all |

**Acceptance cannot be inherited.** `trips.driver_accepted_by` records which
driver gave it, and `driver_accepted_at` is reported only when that matches the
driver asking. A trip handed to a different driver therefore reads as
unaccepted for them, with no reassignment path needing to remember to clear
anything.

### Roadside services (`GET /api/driver/me/trip/places`) — LS-12 G1B

Mapped roadside services for the authenticated driver's own trip. Categories:
`EMERGENCY`, `TYRES`, `HOTEL`, `REST`.

**Served from a local snapshot; the app never calls Overpass.** The Overpass
commons guidance asks that public instances not back a general application, and
a driver app querying on every map pan is exactly that. A one-off bounded
developer query built `app/services/places/data/corridor_snapshot.json`, and
the request path reads that file — `app/services/places/` contains no network
call at all, so "changing category issues no external request" is true by
construction rather than by discipline.

**`LIVE SOURCE NOT CONFIGURED.`** `source.is_live` is `false` and the app must
not describe the result as a live availability feed.

| Guarantee | How |
| --- | --- |
| Bounded | Box validated on construction: max 5° per side, no inversion. A 22° box is `422 BUSINESS_RULE_VIOLATION`. Results capped at 60 |
| Driver-scoped | Subject from the token. `anchor=ROUTE_CORRIDOR` reads the driver's OWN route server-side — a caller cannot supply geometry |
| Honest counts | `raw_records` 720, `unique_places` 702, `merged_duplicates` 18 all travel with the response |

**Four distinct states.** Collapsing them into "no results" is the defect
`state` exists to prevent:

| `state` | Meaning |
| --- | --- |
| `AVAILABLE`, non-empty | Results |
| `AVAILABLE`, empty | Searched; nothing of that kind is **mapped** here. Not "no help exists" |
| `OUTSIDE_COVERAGE` | The area is outside the snapshot. **Nothing was searched** |
| `UNAVAILABLE` | The snapshot could not be read. Says nothing about the road |

**Deduplication.** OSM often maps one place twice — a node for the point and a
way for the building. Records are merged only on *same category + same name +
within 150 m*: name alone would merge four Maruti Suzuki dealers up to 48 km
apart, and distance alone would merge a hospital with the police station across
the road. Unnamed records are never merged (two unnamed lay-bys are two places
to stop). The survivor keeps the most tags, so a merge never loses a phone
number only one of the pair had.

**Along-route is not the bounding box.** `anchor=ROUTE_CORRIDOR` filters by
distance to the route **polyline**, per segment. The corridor has 52 vertices
over 305 km, so a vertex-radius test would reject a tyre shop sitting on the
highway between two recorded points — the midpoint of the demo route is under
1 m from the line and over 100 km from the nearest vertex.

**Distances are straight-line only.** `straight_line_m` is great-circle from
the search anchor, or `null`. No road distance and no travel time is computed
anywhere in this feature — a business across a river is 200 m away and 20 km to
reach. Absent facts (`phone`, `opening_hours`, `hgv`, `max_height`, …) are
`null` and must render as "not provided": 677 of 720 records have no phone and
701 have no opening hours. Missing hours must never become "open now", and a
lay-by with no `hgv` tag is unknown, not permitted.

**Verification semantics** (`POST .../verify`):

| Situation | Result |
| --- | --- |
| First verification, registration matches | 200, `ACTIVE`, `verified_at` set |
| First verification, registration differs | 200, `PENDING_VERIFICATION`, `mismatch_flagged` — the driver is never blocked |
| Repeat with the **same** readings | 200, idempotent, `already_verified: true` |
| Repeat with **different** readings | 409 `ALREADY_VERIFIED` — a correction is a manager review, not a silent overwrite |
| No truck photo on **this** assignment (`POST /api/files?kind=TRUCK_VERIFICATION`) | 422 `VERIFICATION_PHOTO_REQUIRED` — the app hides the button; the server refuses the same way. Drivers without a smartphone: manager `verify-manual` (plate, no photo) |
| No `reported_registration` | 422 `REGISTRATION_REQUIRED` |
| Assignment ended | 404 — an ended assignment is not *current*, so there is nothing to verify |
| Assignment superseded (stale screen) | 409 `ASSIGNMENT_SUPERSEDED` |
| Truck retired or broken down | 409 `TRUCK_NOT_OPERATIONAL` |
| Driver suspended, or no profile | 403 |

The idempotent branch matters because the driver app runs on an unreliable
network: a retry after a lost response must not become a conflict the driver
cannot clear.

`assignment_id` is optional in the body and can only ever **narrow** the request.
The assignment is resolved from the authenticated driver regardless, and the id
is compared against it to reject a stale screen — sending another driver's id
cannot widen access, it simply fails.

`POST /api/assignments/{id}/verify` is an **id-addressed alias** of this
operation and delegates to the same service function. It is not a second
implementation: there briefly were two, and they had already drifted — the alias
answered a repeat with a flat 409 and never checked that the truck was still
operational. The path id behaves exactly like the body's `assignment_id`: it can
only narrow the request.

---

## 13b. `/api/geocoding` — address search *(implemented, never executed)*

Behind the server so the browser never holds a Google credential. Gated on
`trip:create`: address search is a billed external call, and an endpoint any
signed-in account could drive is a way to spend the owner's quota from a
driver's phone. A DRIVER receives 403 — verified against the running server.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/geocoding/suggest` | `trip:create` | `q` (min 3 chars), `session_token` |
| GET | `/api/geocoding/details` | `trip:create` | `place_id`, `session_token` |

`suggest` always answers 200. `available: false` means NO PROVIDER IS
CONFIGURED and the list is empty because nobody looked — deliberately distinct
from an empty list after a real search, because the client shows different words
for each. `error` non-null means a configured provider refused (quota, disabled
API, rejected key), which is retryable.

`details` answers 503 `GEOCODING_UNAVAILABLE` when no provider is configured.
It returned 500 `INTERNAL_ERROR` in the first version; that was a defect, found
against the running server and fixed.

Only `id,displayName,formattedAddress,location` are ever requested from Google.
That field mask is the retention boundary and a test pins it: fields never
fetched cannot be stored by accident.

**Status: no `GOOGLE_PLACES_API_KEY` is configured on the demo machine, so this
has never made a real call to Google.**

## 13c. `/api/ai` — online model router (Gemini → OpenRouter → offline library)

Three surfaces, one proxy. Driver-scoped and takes NO id: the trip whose facts
reach the model comes from the signed-in driver's token, so there is no
parameter that could select whose trip is described. The model WORDS an answer
from facts the deterministic engine supplies; it decides nothing.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/ai/status` | current driver | Checked live, never cached. `providers` = per-provider health (`NOT_CONFIGURED` \| `CONFIGURED` \| `HEALTHY` \| `FAILED` \| `RATE_LIMITED`, error category only) |
| POST | `/api/ai/ask` | current driver | `mode`: `assistant` \| `safety` \| `translate`; `language` (app language, the answer comes back in it, script pinned); `context` (≤2000 chars of facts the phone already holds, no identity/document numbers). Response `provider`: `GOOGLE_GEMINI` \| `OPENROUTER` \| `OFFLINE_ASSISTANT`; Gemini 429/5xx/timeout → one retry → OpenRouter (configured models in order, reasoning off) → offline library |
| GET | `/api/system/providers` | any signed-in user | Data-source health (state, freshness `FRESH` \| `AGING` \| `STALE` \| `EXPIRED` \| `UNKNOWN` \| `STATIC`, last success/error category, never a key) + the code-audited intelligence inventory |

Refusals, each a different action for the driver:

| Status | Code | Meaning |
| --- | --- | --- |
| 429 | `AI_BUSY` | Something else is generating. One at a time, deliberately not a queue. |
| 503 | `AI_UNAVAILABLE` | No model server, no model, or it refused. |
| 422 | `TRANSLATION_UNAVAILABLE` | The installed model cannot do that language pair. |

No conversation is stored and no answer is persisted. Nothing this endpoint
returns can change a route, a trip or a hazard decision — see
[docs/AI_MODELS.md](AI_MODELS.md) section 8.

**Status: no model runtime is installed on the demo machine.** `/status` returns
`available: false` and `/ask` returns 503 — both verified against the running
server. No token has ever been generated.

## 14. WebSocket `/ws/fleet`

Authenticated by access token in the connect query. Server → client events:

| Event | Audience | Payload |
| --- | --- | --- |
| `fleet.position_update` | M A | trip_id, lat, lon, speed, recorded_at |
| `trip.status_changed` | M A, D(own) | trip_id, from, to |
| `route.changed` | M A, D(own) | trip_id, new_route_id, reason |
| `incident.created` | M A | incident summary |
| `alert.created` | targeted | alert body |
| `emergency.check_required` | D(own) | emergency_id, deadline |
| `emergency.escalated` | M A | briefing summary |

The socket is a **delivery optimisation, not a source of truth.** Every event has a REST equivalent
a client can poll, and clients must reconcile on reconnect. If the socket dies during the demo,
polling gives the same state.

---

## 15. Implemented Today

As of the route-intelligence work (P7-P11), the implemented surface is:

| Area | Paths |
| --- | --- |
| System | `/health`, `/ready` |
| Auth | `/api/auth/login`, `/refresh`, `/logout`, `/me` |
| Manager CRUD | `/api/drivers*`, `/api/trucks*`, `/api/assignments*` |
| Planning | `/api/shipments`, `/api/trips*` (create, dispatch, cancel, close) |
| Driver self-service | `/api/driver/me*` — profile, assignment, trip, location |
| Fleet location | `/api/fleet/active`, `/api/trips/{id}/track` |
| Detail reads (P6) | `GET /api/drivers/{id}`, `GET /api/trucks/{id}`, `GET /api/trips/{id}` — the last now carries a `shipment` summary (client, reference, load, priority) so an operations screen does not need a second lookup for what a truck is carrying |
| Route planning (P7) | `GET /api/trips/{id}/routes`, `POST /api/trips/{id}/routes/recalculate`, `POST /api/trips/{id}/routes/{route_id}/select` — see §9. `POST /api/routes/preview` is **not** implemented |
| Route risk (P8) | `GET /api/trips/{id}/routes/{route_id}/risk` — deterministic weighted rule over weather sampled along the route. Reports which datasets it did **not** have. Not a model |
| Route recommendation | `GET /api/trips/{id}/routes/recommendation` — compares this trip's live routes and advises one, in points/minutes/km. Refuses to recommend when the candidates were scored on different evidence. No percentages. Not a model |
| Reroute | `GET /api/trips/{id}/reroute`, `POST /api/trips/{id}/reroute/accept` — three outcomes including `ALERT_ONLY`. The POST is the **only** way a moving trip's route changes, and nothing applies a proposal on its own |
| Offline corridor | `GET /api/driver/me/trip/offline-package` — the journey packaged to survive losing the network. Declares `basemap: BUNDLED_NONE`; the OSM tile policy prohibits prefetching tiles for offline use |
| Route progress | `progress` on `GET /api/driver/me/trip` — the observed fix projected onto the planned line, with `off_route_m`. Deliberately carries **no ETA** |
| Rate limiting (P7) | `/api/auth/login` and `/api/auth/refresh` only, per route, in-process — see `backend/app/core/rate_limit.py` |

Everything else in this document is a specification for a later phase and is not
routed. The system endpoints:

| Method | Path | Response |
| --- | --- | --- |
| GET | `/health` | `200 {"status":"ok"}` — liveness, no dependency check |
| GET | `/ready` | `200` when DB reachable and PostGIS present, else `503` |

```json
// GET /ready  -> 200
{ "status": "ready",
  "provider": "supabase",
  "checks": { "database": { "ok": true, "detail": "PostgreSQL 17.6" },
              "postgis":  { "ok": true, "detail": "3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1" } } }
// GET /ready  -> 503
{ "status": "not_ready",
  "provider": "supabase",
  "checks": { "database": { "ok": false, "detail": "unreachable (OperationalError)" },
              "postgis":  { "ok": false, "detail": "not checked" } } }
```

`provider` is `"supabase"` or `"local"`. It is the **only** connection information
this endpoint exposes: no host, user, database name or URL, and the failure detail
carries the exception *class* rather than its message, because psycopg embeds the
full connection string - password included - in connection errors. `/ready` is
unauthenticated, so this matters.

When the configured primary database is unreachable, `/ready` returns 503. It does
**not** fall back to another database, even when one is running locally.
`/health` deliberately does **not** touch the database: a liveness probe that fails when a
dependency is down causes the process to be restarted for someone else's outage.
