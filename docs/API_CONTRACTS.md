# API Contracts

**Status: design specification.** Only `/health` and `/ready` are implemented. Everything under
`/api/*` below is a contract to build against, not running code.

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
| POST | `/api/assignments` | M A | Ends any current active assignment atomically |
| GET | `/api/assignments/{id}` | M A, D(self) | |
| POST | `/api/assignments/{id}/verify` | D(self) | Driver submits photo + readings |
| POST | `/api/assignments/{id}/review` | M A | Resolve a flagged mismatch |
| POST | `/api/assignments/{id}/end` | M A | |

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

| Method | Path | Perms |
| --- | --- | --- |
| POST | `/api/routes/preview` | M A |
| POST | `/api/trips/{id}/routes/recalculate` | M A, S |
| POST | `/api/trips/{id}/routes/{route_id}/select` | M A |

`preview` computes candidates without persisting a trip. `recalculate` inserts new `trip_routes`
rows and marks superseded ones — it never mutates history.
Errors: `503 ROUTING_UNAVAILABLE`, `422 NO_VIABLE_ROUTE` (every candidate crossed an `IMPASSABLE`
incident — a real and important answer in NER, not a failure).

---

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

Responses carry only what the app needs — no manager metadata, no salary, no
other drivers, no document contents.

**Verification semantics** (`POST .../verify`):

| Situation | Result |
| --- | --- |
| First verification, registration matches | 200, `ACTIVE`, `verified_at` set |
| First verification, registration differs | 200, `PENDING_VERIFICATION`, `mismatch_flagged` — the driver is never blocked |
| Repeat with the **same** readings | 200, idempotent, `already_verified: true` |
| Repeat with **different** readings | 409 `ALREADY_VERIFIED` — a correction is a manager review, not a silent overwrite |
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

As of P5, the implemented surface is:

| Area | Paths |
| --- | --- |
| System | `/health`, `/ready` |
| Auth | `/api/auth/login`, `/refresh`, `/logout`, `/me` |
| Manager CRUD | `/api/drivers*`, `/api/trucks*`, `/api/assignments*` |
| Planning | `/api/shipments`, `/api/trips*` (create, dispatch, cancel, close) |
| Driver self-service | `/api/driver/me*` — profile, assignment, trip, location |
| Fleet location | `/api/fleet/active`, `/api/trips/{id}/track` |
| Detail reads (P6) | `GET /api/drivers/{id}`, `GET /api/trucks/{id}`, `GET /api/trips/{id}` — the last now carries a `shipment` summary (client, reference, load, priority) so an operations screen does not need a second lookup for what a truck is carrying |

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
