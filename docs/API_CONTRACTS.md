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

## 6. `/api/shipments`

| Method | Path | Perms |
| --- | --- | --- |
| GET / POST | `/api/shipments` | M A |
| GET / PATCH | `/api/shipments/{id}` | M A |
| POST | `/api/shipments/{id}/cargo` | M A |
| DELETE | `/api/shipments/{id}/cargo/{item_id}` | M A |

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

| Method | Path | Perms | Notes |
| --- | --- | --- | --- |
| GET | `/api/trips` | M A, D(own) | `?status=ACTIVE,DELAYED` |
| POST | `/api/trips` | M A | **Capacity gate** |
| GET | `/api/trips/{id}` | M A, D(own) | Full detail |
| POST | `/api/trips/{id}/dispatch` | M A | ASSIGNED → dispatched |
| POST | `/api/trips/{id}/start` | D(own) | → ACTIVE |
| POST | `/api/trips/{id}/cancel` | M A | Requires `reason` |
| GET | `/api/trips/{id}/timeline` | M A, D(own) | Audit-derived event list |

**POST `/api/trips`** — the deterministic gate:
```json
{ "shipment_id": "uuid", "truck_id": "uuid", "driver_id": "uuid",
  "scheduled_start_at": "2026-09-10T04:30:00Z" }
```
Validation order, all before routing or ML is touched:
1. Shipment exists and is `DRAFT`/`PLANNED` → else `409`
2. Truck `AVAILABLE` → else `409 TRUCK_UNAVAILABLE`
3. Driver `AVAILABLE`, licence valid → else `422 LICENCE_EXPIRED`
4. Active assignment links this driver to this truck → else `422 NO_ACTIVE_ASSIGNMENT`
5. Truck documents valid → else `422 DOCUMENTS_INVALID`
6. **`shipment.total_weight_kg <= truck.max_capacity_kg`** → else `422 CAPACITY_EXCEEDED`

Only after all six does the server request routes and fuel estimates.

```json
// 201
{ "id": "uuid", "trip_code": "TRP-2026-0042", "status": "ASSIGNED",
  "routes": [
    { "id": "uuid", "kind": "PRIMARY", "distance_km": "308.40",
      "estimated_duration_min": 442,
      "estimated_fuel_litres": "78.20", "estimated_fuel_cost": "7429.00",
      "fuel_estimate_source": "MODEL_V1",
      "risk_score": 0.21, "risk_factors": ["monsoon_active"],
      "geometry": { "type": "LineString", "coordinates": [[91.7362,26.1445], "..."] } },
    { "id": "uuid", "kind": "FUEL_EFFICIENT", "estimated_fuel_litres": null,
      "estimated_fuel_cost": null, "fuel_estimate_source": null, "...": "..." }
  ] }
```
`estimated_fuel_*` being `null` is a legitimate response meaning the model was unavailable. Clients
must render "unavailable", never `0` and never a guess. `fuel_estimate_source` tells the UI whether
it is showing a model output or the km/l baseline.

---

## 8. `/api/gps`

| Method | Path | Perms | Notes |
| --- | --- | --- | --- |
| POST | `/api/gps/batch` | D(own) | Primary ingestion |
| GET | `/api/gps/trips/{id}/track` | M A | History, `?from=&to=&simplify_m=` |
| GET | `/api/gps/live` | M A | Latest fix per active trip |

**POST `/api/gps/batch`**
```json
{ "trip_id": "uuid",
  "fixes": [ { "device_fix_id": "uuid", "lat": 26.1445, "lon": 91.7362,
               "altitude_m": 55.2, "speed_kmph": 42.5, "heading_deg": 118.0,
               "accuracy_m": 8.4, "recorded_at": "2026-09-10T05:12:33Z",
               "is_mock_location": false } ] }
```
```json
// 202
{ "accepted": 12, "duplicates_ignored": 3, "rejected": 0, "server_time": "..." }
```
Contract rules that make offline operation safe:
- **Idempotent on `device_fix_id`.** Re-posting an unacknowledged batch is always safe; duplicates
  are counted, not errored. Without this, a dropped ack on a hill road produces duplicate track
  points and corrupts the Sentinel distance calculation.
- Batches up to 500 fixes; backdated fixes accepted up to 24h.
- `202` not `201` — accepted for processing; the WebSocket broadcast is asynchronous.
- Rate limited per driver (see [SECURITY.md](SECURITY.md)).
- `is_mock_location` is stored and surfaced to the manager. It is **not** used to auto-reject.

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

`GET /api/driver/me/assignment` returns **200 with a null body** when the driver
has no assignment. Unassigned is a normal state, not an error, so the app renders
an empty screen rather than special-casing a 404.

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
