# RASTA AI — API Test Results (Day 2 · Task 1)

**Run:** 2026-09-19T09:53:29 IST · **Target:** local FastAPI `http://127.0.0.1:8010` (started with `.runtime/start-demo-backend.sh`, `DATABASE_PROVIDER=local`, PostgreSQL 18.2 + PostGIS 3.6 on the isolated cluster, database `ner_logistics_demo` — a local clone; **Supabase was not written to**) · **Backend commit:** `7c176f3` (main) · **Runner:** `docs/submission/day2/task1/api_evidence.py` (stdlib `urllib`, one process, no mocks; raw results in `api-results.json` beside it). Tokens and passwords are redacted from this page; every row below is the real HTTP status the server returned.

**Result: 56/56 PASS.** Rows created by the run were retired/deactivated by the same run (soft delete), so the demo database carries no live test fixtures.

Hosted backend (read-only probe, same morning): `GET https://ner-intelligence.onrender.com/health` → `200 {"status":"ok"}`; `GET /ready` → `200 {"status":"ready","provider":"supabase","checks":{"database":{"ok":true,"detail":"PostgreSQL 17.6"},"postgis":{"ok":true,"detail":"3.3 …"}}}`.

## 1. Automated suites (same session, same commit)

| Suite | Command | Result |
| --- | --- | --- |
| Backend (pytest, isolated PostgreSQL `ner_logistics_test`) | `source .runtime/use-isolated-db.sh && pytest` | **1210 passed, 5 skipped** in 223 s (skips: 4 destructive migration downgrades behind `RUN_DESTRUCTIVE_MIGRATION_TESTS=1`, 1 non-Windows event-loop case) |
| Manager Web (vitest) | `npm test` in `manager-web` | **259 passed** (24 files) |
| Manager Web typecheck | `npm run typecheck` | **0 errors** after the 3 fixes listed in the final report (5 errors at HEAD before them) |
| Driver App (vitest) | `npm test` in `driver-app` | **624 passed** (54 files) |
| Driver App typecheck | `npm run typecheck` | **0 errors** |
| Schema drift | `tests/test_schema_drift.py::test_no_drift_between_models_and_database` (in the backend run) | PASS — models == Alembic head `0012` |

## 2. End-to-end HTTP run — summary table

| # | Method | Endpoint | Purpose | Auth | Expected | Actual | Error code | ms | Result |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `GET` | `/health` | Liveness | none | 200 | **200** |  | 19 | PASS |
| 2 | `GET` | `/ready` | Readiness: DB + PostGIS reachable | none | 200 | **200** |  | 17 | PASS |
| 3 | `POST` | `/api/auth/login` | Bad credential rejected | none | 401 | **401** | UNAUTHENTICATED | 76 | PASS |
| 4 | `POST` | `/api/auth/login` | Schema validation | none | 422 | **422** | VALIDATION_ERROR | 13 | PASS |
| 5 | `POST` | `/api/auth/login` | Manager sign-in (JWT + refresh) | none | 200 | **200** |  | 74 | PASS |
| 6 | `GET` | `/api/auth/me` | Current principal + role | JWT | 200 | **200** |  | 16 | PASS |
| 7 | `GET` | `/api/drivers` | Unauthenticated -> 401 | none | 401 | **401** | UNAUTHENTICATED | 13 | PASS |
| 8 | `GET` | `/api/drivers` | Invalid token -> 401 | bad JWT | 401 | **401** | UNAUTHENTICATED | 1 | PASS |
| 9 | `POST` | `/api/drivers` | Validation error shape | manager driver:create | 422 | **422** | VALIDATION_ERROR | 15 | PASS |
| 10 | `POST` | `/api/drivers` | CREATE users + drivers (one transaction) | manager driver:create | 201 | **201** |  | 67 | PASS |
| 11 | `POST` | `/api/drivers` | Unique constraint surfaces as 409 | manager | 409 | **409** | LICENCE_EXISTS | 5 | PASS |
| 12 | `GET` | `/api/drivers/3004e822-8b52-4f91-bc4f-88326c477ff7` | READ one | manager driver:read | 200 | **200** |  | 20 | PASS |
| 13 | `GET` | `/api/drivers` | READ list, filtered | manager driver:read | 200 | **200** |  | 16 | PASS |
| 14 | `PATCH` | `/api/drivers/3004e822-8b52-4f91-bc4f-88326c477ff7` | UPDATE (partial) | manager driver:update | 200 | **200** |  | 18 | PASS |
| 15 | `GET` | `/api/drivers/0c7b513c-0cdc-4ff5-a069-11123ccd9604` | Unknown id -> 404 | manager | 404 | **404** | NOT_FOUND | 27 | PASS |
| 16 | `POST` | `/api/trucks` | Validation | manager truck:create | 422 | **422** | VALIDATION_ERROR | 14 | PASS |
| 17 | `POST` | `/api/trucks` | CREATE trucks | manager truck:create | 201 | **201** |  | 21 | PASS |
| 18 | `POST` | `/api/trucks` | Unique registration -> 409 | manager | 409 | **409** | REGISTRATION_EXISTS | 2 | PASS |
| 19 | `GET` | `/api/trucks/64e2b4be-61af-4882-b8be-c5eaa787471b` | READ one | manager truck:read | 200 | **200** |  | 23 | PASS |
| 20 | `PATCH` | `/api/trucks/64e2b4be-61af-4882-b8be-c5eaa787471b` | UPDATE | manager truck:update | 200 | **200** |  | 20 | PASS |
| 21 | `GET` | `/api/trucks` | READ list (cursor paging) | manager truck:read | 200 | **200** |  | 27 | PASS |
| 22 | `POST` | `/api/assignments` | CREATE driver<->truck pairing | manager assignment:create | 201 | **201** |  | 21 | PASS |
| 23 | `POST` | `/api/assignments` | One open pairing per driver/truck | manager | 409 | **409** | ASSIGNMENT_UNCHANGED | 26 | PASS |
| 24 | `GET` | `/api/assignments/70d1abe4-65bc-4e08-b34e-c0608f557ba2` | READ one | manager assignment:read | 200 | **200** |  | 3 | PASS |
| 25 | `POST` | `/api/assignments/70d1abe4-65bc-4e08-b34e-c0608f557ba2/verify-manual` | UPDATE: manager verifies truck by hand | manager assignment:review | 200 | **200** |  | 7 | PASS |
| 26 | `POST` | `/api/trips/plan` | Service-region gate | manager trip:create | 422 | **422** | VALIDATION_ERROR | 17 | PASS |
| 27 | `POST` | `/api/trips/plan` | Capacity gate; shipment NOT left behind (atomic) | manager trip:create | 422 | **422** | CAPACITY_EXCEEDED | 8 | PASS |
| 28 | `POST` | `/api/trips/plan` | CREATE shipments+cargo_items+trips+trip_stops in one transaction | manager trip:create | 201 | **201** |  | 13 | PASS |
| 29 | `GET` | `/api/shipments` | READ shipments | manager shipment:read | 200 | **200** |  | 4 | PASS |
| 30 | `GET` | `/api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10` | READ one (with shipment summary + stops) | manager trip:read | 200 | **200** |  | 4 | PASS |
| 31 | `GET` | `/api/trips` | READ list with search + total | manager trip:read | 200 | **200** |  | 3 | PASS |
| 32 | `POST` | `/api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/dispatch` | Route-selection gate: no dispatch without a selected route | manager trip:dispatch | 422 | **422** | ROUTE_SELECTION_REQUIRED | 5 | PASS |
| 33 | `GET` | `/api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/routes` | READ trip_routes | manager route:read | 200 | **200** |  | 3 | PASS |
| 34 | `POST` | `/api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/cancel` | DRAFT -> CANCELLED, audited | manager trip:cancel | 200 | **200** |  | 24 | PASS |
| 35 | `POST` | `/api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/cancel` | Invalid transition -> 409 | manager | 409 | **409** | ILLEGAL_TRIP_TRANSITION | 26 | PASS |
| 36 | `GET` | `/api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/events` | READ trip_events | manager trip:read | 200 | **200** |  | 15 | PASS |
| 37 | `POST` | `/api/auth/login` | Driver sign-in | none | 200 | **200** |  | 72 | PASS |
| 38 | `GET` | `/api/driver/me` | READ own profile | driver | 200 | **200** |  | 20 | PASS |
| 39 | `GET` | `/api/driver/me/assignment` | READ own assignment | driver | 200 | **200** |  | 15 | PASS |
| 40 | `GET` | `/api/driver/me/trip` | READ own trip | driver | 200 or 404 | **200** |  | 14 | PASS |
| 41 | `GET` | `/api/drivers` | driver:read is object-scoped: a driver sees one row (own) | driver driver:read | 200 | **200** |  | 15 | PASS |
| 42 | `POST` | `/api/drivers` | Wrong role -> 403 | driver | 403 | **403** | FORBIDDEN | 13 | PASS |
| 43 | `GET` | `/api/drivers/a6f6861f-4f0a-471f-aa9d-6836209ae04e` | Other driver hidden | driver | 403 or 404 | **404** | NOT_FOUND | 16 | PASS |
| 44 | `GET` | `/api/fleet/active` | Location read needs fleet:location_read | driver | 403 | **403** | FORBIDDEN | 14 | PASS |
| 45 | `POST` | `/api/driver/me/location` | Server decides trip/driver/truck; fix must carry location{lat,lon}+recorded_at | driver location:submit_own | 422 | **422** | VALIDATION_ERROR | 16 | PASS |
| 46 | `POST` | `/api/driver/me/location` | Telemetry refused when the driver has no trip to report for | driver location:submit_own | 404 or 409 | **404** | NOT_FOUND | 16 | PASS |
| 47 | `POST` | `/api/auth/refresh` | Rotate tokens | refresh token | 200 | **200** |  | 18 | PASS |
| 48 | `POST` | `/api/auth/refresh` | Reused refresh token revoked (family) | stale refresh | 401 | **401** | UNAUTHENTICATED | 30 | PASS |
| 49 | `GET` | `/api/fleet/active` | Trips on the road (PostGIS last fix) | manager fleet:location_read | 200 | **200** |  | 28 | PASS |
| 50 | `GET` | `/api/emergencies/active` | Open emergencies | manager emergency:read | 200 | **200** |  | 14 | PASS |
| 51 | `GET` | `/api/system/providers` | Provider health + intelligence inventory | JWT | 200 | **200** |  | 13 | PASS |
| 52 | `POST` | `/api/assignments/70d1abe4-65bc-4e08-b34e-c0608f557ba2/end` | State transition: ACTIVE -> ENDED | manager assignment:end | 200 | **200** |  | 18 | PASS |
| 53 | `POST` | `/api/trucks/64e2b4be-61af-4882-b8be-c5eaa787471b/retire` | DELETE = retire (deleted_at set, history kept) | manager truck:retire | 200 | **200** |  | 29 | PASS |
| 54 | `POST` | `/api/drivers/3004e822-8b52-4f91-bc4f-88326c477ff7/deactivate` | DELETE = deactivate (login disabled, rows kept) | manager driver:deactivate | 200 | **200** |  | 34 | PASS |
| 55 | `GET` | `/api/driver/me` | Deactivated login refused | driver | 401 or 403 | **401** | UNAUTHENTICATED | 1 | PASS |
| 56 | `POST` | `/api/auth/logout` | Revoke session | JWT | 204 | **204** |  | 22 | PASS |

## 3. Selected cases in detail (request → actual response)

### `GET /health` — health

- **Purpose:** Liveness
- **Auth:** none
- **Expected:** 200 · **Actual:** 200 · **PASS**

Response (redacted):
```json
{
  "status": "ok"
}
```

### `GET /ready` — ready

- **Purpose:** Readiness: DB + PostGIS reachable
- **Auth:** none
- **Expected:** 200 · **Actual:** 200 · **PASS**

Response (redacted):
```json
{
  "status": "ready",
  "provider": "local",
  "checks": {
    "database": {
      "ok": true,
      "detail": "PostgreSQL 18.2"
    },
    "postgis": {
      "ok": true,
      "detail": "3.6 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"
    }
  }
}
```

### `POST /api/auth/login` — login wrong password

- **Purpose:** Bad credential rejected
- **Auth:** none
- **Expected:** 401 · **Actual:** 401 · `UNAUTHENTICATED` · **PASS**

Request body:
```json
{
  "identifier": "demo.manager@fleet.example",
  "password": "<redacted>"
}
```

Response (redacted):
```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Invalid credentials.",
    "details": {},
    "request_id": "215abb95-3316-4eaa-ac8a-bb3260d3f12c"
  }
}
```

### `POST /api/auth/login` — manager login

- **Purpose:** Manager sign-in (JWT + refresh)
- **Auth:** none
- **Expected:** 200 · **Actual:** 200 · **PASS**

Request body:
```json
{
  "identifier": "demo.manager@fleet.example",
  "password": "<redacted>",
  "client": "mobile"
}
```

Response (redacted):
```json
{
  "access_token": "<redacted>",
  "refresh_token": "<redacted>",
  "token_type": "bearer",
  "expires_at": "2026-09-19T04:38:28.182347Z",
  "user": {
    "id": "a6f6861f-4f0a-471f-aa9d-6836209ae04e",
    "role": "MANAGER",
    "display_name": "Demo Manager",
    "email": "demo.manager@fleet.example",
    "phone": null
  }
}
```

### `GET /api/auth/me` — auth/me

- **Purpose:** Current principal + role
- **Auth:** JWT
- **Expected:** 200 · **Actual:** 200 · **PASS**

Response (redacted):
```json
{
  "user": {
    "id": "a6f6861f-4f0a-471f-aa9d-6836209ae04e",
    "role": "MANAGER",
    "display_name": "Demo Manager",
    "email": "demo.manager@fleet.example",
    "phone": null
  },
  "permissions": [
    "assignment:create",
    "assignment:end",
    "assignment:read",
    "..."
  ]
}
```

### `GET /api/drivers` — drivers without token

- **Purpose:** Unauthenticated -> 401
- **Auth:** none
- **Expected:** 401 · **Actual:** 401 · `UNAUTHENTICATED` · **PASS**

Response (redacted):
```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Authentication required.",
    "details": {},
    "request_id": "a2acf7fd-6161-44be-a0a3-00b6ce229d5e"
  }
}
```

### `POST /api/drivers` — driver create - invalid phone (422)

- **Purpose:** Validation error shape
- **Auth:** manager driver:create
- **Expected:** 422 · **Actual:** 422 · `VALIDATION_ERROR` · **PASS**

Request body:
```json
{
  "full_name": "Day2 Test Driver 136C48",
  "initial_password": "<redacted>",
  "phone": "12",
  "licence_number": "AS01D2136C48",
  "licence_expiry": "2028-08-19",
  "licence_class": "HMV"
}
```

Response (redacted):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request failed validation.",
    "details": {
      "errors": [
        {
          "loc": [
            "body",
            "phone"
          ],
          "msg": "String should match pattern '^\\+?[0-9]{10,15}$'",
          "type": "string_pattern_mismatch"
        }
      ]
    },
    "request_id": "8b6b6e06-7351-481c-b020-774e5b69f85c"
  }
}
```

### `POST /api/drivers` — driver create

- **Purpose:** CREATE users + drivers (one transaction)
- **Auth:** manager driver:create
- **Expected:** 201 · **Actual:** 201 · **PASS**

Request body:
```json
{
  "full_name": "Day2 Test Driver 136C48",
  "initial_password": "<redacted>",
  "phone": "9789791808",
  "licence_number": "AS01D2136C48",
  "licence_expiry": "2028-08-19",
  "licence_class": "HMV"
}
```

Response (redacted):
```json
{
  "id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "user_id": "8728ab47-50ab-4f86-8e32-84bdc4367cd6",
  "full_name": "Day2 Test Driver 136C48",
  "phone": "9789791808",
  "photo_url": null,
  "licence_number": "AS01D2136C48",
  "licence_expiry": "2028-08-19",
  "status": "AVAILABLE",
  "login_is_active": true,
  "created_at": "2026-09-19T09:53:28.250423+05:30"
}
```

### `POST /api/drivers` — driver create - duplicate licence (409)

- **Purpose:** Unique constraint surfaces as 409
- **Auth:** manager
- **Expected:** 409 · **Actual:** 409 · `LICENCE_EXISTS` · **PASS**

Request body:
```json
{
  "full_name": "Day2 Test Driver 136C48",
  "initial_password": "<redacted>",
  "phone": "9789791815",
  "licence_number": "AS01D2136C48",
  "licence_expiry": "2028-08-19",
  "licence_class": "HMV"
}
```

Response (redacted):
```json
{
  "error": {
    "code": "LICENCE_EXISTS",
    "message": "A driver with that licence number already exists.",
    "details": {},
    "request_id": "6060eebc-f5b4-48f3-8832-6b5f7b66d704"
  }
}
```

### `PATCH /api/drivers/3004e822-8b52-4f91-bc4f-88326c477ff7` — driver update

- **Purpose:** UPDATE (partial)
- **Auth:** manager driver:update
- **Expected:** 200 · **Actual:** 200 · **PASS**

Request body:
```json
{
  "licence_class": "HGMV",
  "emergency_contact_name": "Day2 Contact"
}
```

Response (redacted):
```json
{
  "id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "user_id": "8728ab47-50ab-4f86-8e32-84bdc4367cd6",
  "full_name": "Day2 Test Driver 136C48",
  "phone": "9789791808",
  "photo_url": null,
  "licence_number": "AS01D2136C48",
  "licence_expiry": "2028-08-19",
  "status": "AVAILABLE",
  "login_is_active": true,
  "created_at": "2026-09-19T09:53:28.250423+05:30"
}
```

### `POST /api/trucks` — truck create

- **Purpose:** CREATE trucks
- **Auth:** manager truck:create
- **Expected:** 201 · **Actual:** 201 · **PASS**

Request body:
```json
{
  "registration_number": "AS01D7808",
  "max_capacity_kg": "9000",
  "truck_type": "Container",
  "make": "Tata",
  "model": "LPT 1109",
  "manufacture_year": 2021
}
```

Response (redacted):
```json
{
  "id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
  "registration_number": "AS01D7808",
  "photo_url": null,
  "truck_type": "Container",
  "make": "Tata",
  "model": "LPT 1109",
  "max_capacity_kg": "9000.00",
  "current_load_kg": "0.00",
  "status": "AVAILABLE",
  "baseline_mileage_kmpl": null,
  "created_at": "2026-09-19T09:53:28.420721+05:30"
}
```

### `PATCH /api/trucks/64e2b4be-61af-4882-b8be-c5eaa787471b` — truck update

- **Purpose:** UPDATE
- **Auth:** manager truck:update
- **Expected:** 200 · **Actual:** 200 · **PASS**

Request body:
```json
{
  "model": "LPT 1109 EX",
  "odometer_km": "12000.5"
}
```

Response (redacted):
```json
{
  "id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
  "registration_number": "AS01D7808",
  "photo_url": null,
  "truck_type": "Container",
  "make": "Tata",
  "model": "LPT 1109 EX",
  "max_capacity_kg": "9000.00",
  "current_load_kg": "0.00",
  "status": "AVAILABLE",
  "baseline_mileage_kmpl": null,
  "created_at": "2026-09-19T09:53:28.420721+05:30"
}
```

### `POST /api/assignments` — assignment create

- **Purpose:** CREATE driver<->truck pairing
- **Auth:** manager assignment:create
- **Expected:** 201 · **Actual:** 201 · **PASS**

Request body:
```json
{
  "driver_id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "truck_id": "64e2b4be-61af-4882-b8be-c5eaa787471b"
}
```

Response (redacted):
```json
{
  "id": "70d1abe4-65bc-4e08-b34e-c0608f557ba2",
  "driver_id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "truck_id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
  "status": "ACTIVE",
  "assigned_at": "2026-09-19T09:53:28.516707+05:30",
  "verified_at": null,
  "mismatch_flagged": false,
  "ended_at": null,
  "verification_source": null,
  "verification_photo_url": null,
  "reported_registration": null
}
```

### `POST /api/assignments` — assignment create - driver already paired (409)

- **Purpose:** One open pairing per driver/truck
- **Auth:** manager
- **Expected:** 409 · **Actual:** 409 · `ASSIGNMENT_UNCHANGED` · **PASS**

Request body:
```json
{
  "driver_id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "truck_id": "64e2b4be-61af-4882-b8be-c5eaa787471b"
}
```

Response (redacted):
```json
{
  "error": {
    "code": "ASSIGNMENT_UNCHANGED",
    "message": "Driver is already assigned to this truck.",
    "details": {
      "assignment_id": "70d1abe4-65bc-4e08-b34e-c0608f557ba2"
    },
    "request_id": "a4b57d5a-89f6-4e03-90c6-baeec6ad9aad"
  }
}
```

### `POST /api/trips/plan` — trip plan - cargo over truck capacity (422)

- **Purpose:** Capacity gate; shipment NOT left behind (atomic)
- **Auth:** manager trip:create
- **Expected:** 422 · **Actual:** 422 · `CAPACITY_EXCEEDED` · **PASS**

Request body:
```json
{
  "shipment": {
    "reference_code": "DAY2-136C48-H",
    "client_name": "Day 2 Evidence Client",
    "pickup_address": "Guwahati Depot, Assam",
    "pickup": {
      "lat": 26.1445,
      "lon": 91.7362
    },
    "destination_address": "Shillong Depot, Meghalaya",
    "destination": {
      "lat": 25.5788,
      "lon": 91.8933
    },
    "priority": "NORMAL",
    "cargo_items": [
      {
        "cargo_type": "General",
        "cargo_name": "Rice bags",
        "weight_kg": "20000",
        "quantity": 1
      }
    ]
  },
  "trip": {
    "trip_code": "D2T-136C48-H",
    "truck_id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
    "driver_id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
    "stops": [
      {
        "sequence": 0,
        "kind": "PICKUP",
        "location": {
          "lat": 26.1445,
          "lon": 91.7362
        },
        "name": "Guwahati Depot"
      },
      {
        "sequence": 1,
        "kind": "DROPOFF",
        "location": {
          "lat": 25.5788,
          "lon": 91.8933
        },
        "name": "Shillong Depot"
      }
    ]
  }
}
```

Response (redacted):
```json
{
  "error": {
    "code": "CAPACITY_EXCEEDED",
    "message": "Shipment weight exceeds the truck's capacity.",
    "details": {
      "shipment_weight_kg": "20000.00",
      "truck_capacity_kg": "9000.00"
    },
    "request_id": "766e8481-16dd-4226-a6e7-798157a3acee"
  }
}
```

### `POST /api/trips/plan` — trip plan (shipment+trip atomic)

- **Purpose:** CREATE shipments+cargo_items+trips+trip_stops in one transaction
- **Auth:** manager trip:create
- **Expected:** 201 · **Actual:** 201 · **PASS**

Request body:
```json
{
  "shipment": {
    "reference_code": "DAY2-136C48",
    "client_name": "Day 2 Evidence Client",
    "pickup_address": "Guwahati Depot, Assam",
    "pickup": {
      "lat": 26.1445,
      "lon": 91.7362
    },
    "destination_address": "Shillong Depot, Meghalaya",
    "destination": {
      "lat": 25.5788,
      "lon": 91.8933
    },
    "priority": "NORMAL",
    "cargo_items": [
      {
        "cargo_type": "General",
        "cargo_name": "Rice bags",
        "weight_kg": "1200",
        "quantity": 1
      }
    ]
  },
  "trip": {
    "trip_code": "D2T-136C48",
    "truck_id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
    "driver_id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
    "stops": [
      {
        "sequence": 0,
        "kind": "PICKUP",
        "location": {
          "lat": 26.1445,
          "lon": 91.7362
        },
        "name": "Guwahati Depot"
      },
      {
        "sequence": 1,
        "kind": "DROPOFF",
        "location": {
          "lat": 25.5788,
          "lon": 91.8933
        },
        "name": "Shillong Depot"
      }
    ]
  }
}
```

Response (redacted):
```json
{
  "id": "f01df784-92b3-4aa9-b39e-9babc06cac10",
  "trip_code": "D2T-136C48",
  "shipment_id": "3263e5ce-56e9-46ab-a233-94f6a4c74fdb",
  "client_name": null,
  "origin": null,
  "destination": null,
  "truck_id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
  "driver_id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "status": "DRAFT",
  "selected_route_id": null,
  "dispatched_at": null,
  "started_at": null,
  "delivered_at": null,
  "planned_eta": null,
  "current_eta": null,
  "delay_minutes": null,
  "created_at": "2026-09-19T09:53:28.587600+05:30"
}
```

### `GET /api/trips` — trip list (server filters)

- **Purpose:** READ list with search + total
- **Auth:** manager trip:read
- **Expected:** 200 · **Actual:** 200 · **PASS**

Response (redacted):
```json
{
  "items": 1,
  "total": 1,
  "keys": [
    "items",
    "next_cursor",
    "total"
  ]
}
```

### `POST /api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/dispatch` — trip dispatch without route (422)

- **Purpose:** Route-selection gate: no dispatch without a selected route
- **Auth:** manager trip:dispatch
- **Expected:** 422 · **Actual:** 422 · `ROUTE_SELECTION_REQUIRED` · **PASS**

Response (redacted):
```json
{
  "error": {
    "code": "ROUTE_SELECTION_REQUIRED",
    "message": "Select a route in the trip review before dispatching. A draft is not dispatchable without one.",
    "details": {},
    "request_id": "6cc323ca-1462-4ec2-ab91-1e33f6a92564"
  }
}
```

### `POST /api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/cancel` — trip cancel (state transition)

- **Purpose:** DRAFT -> CANCELLED, audited
- **Auth:** manager trip:cancel
- **Expected:** 200 · **Actual:** 200 · **PASS**

Request body:
```json
{
  "reason": "Day 2 API evidence run - cancelling test trip"
}
```

Response (redacted):
```json
{
  "id": "f01df784-92b3-4aa9-b39e-9babc06cac10",
  "trip_code": "D2T-136C48",
  "shipment_id": "3263e5ce-56e9-46ab-a233-94f6a4c74fdb",
  "client_name": null,
  "origin": null,
  "destination": null,
  "truck_id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
  "driver_id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "status": "CANCELLED",
  "selected_route_id": null,
  "dispatched_at": null,
  "started_at": null,
  "delivered_at": null,
  "planned_eta": null,
  "current_eta": null,
  "delay_minutes": null,
  "created_at": "2026-09-19T09:53:28.587600+05:30"
}
```

### `POST /api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/cancel` — trip cancel again (409)

- **Purpose:** Invalid transition -> 409
- **Auth:** manager
- **Expected:** 409 · **Actual:** 409 · `ILLEGAL_TRIP_TRANSITION` · **PASS**

Request body:
```json
{
  "reason": "Day 2 API evidence run - second cancel"
}
```

Response (redacted):
```json
{
  "error": {
    "code": "ILLEGAL_TRIP_TRANSITION",
    "message": "Illegal trip transition CANCELLED -> CANCELLED. Allowed from CANCELLED: none (terminal state)",
    "details": {
      "current": "CANCELLED",
      "requested": "CANCELLED"
    },
    "request_id": "b65b791b-c66b-4da2-bb6e-67397c86102f"
  }
}
```

### `GET /api/trips/f01df784-92b3-4aa9-b39e-9babc06cac10/events` — trip events (journey history)

- **Purpose:** READ trip_events
- **Auth:** manager trip:read
- **Expected:** 200 · **Actual:** 200 · **PASS**

Response (redacted):
```json
{
  "items": 2,
  "sample": [
    {
      "id": 6127,
      "kind": "CREATED",
      "description": "trip D2T-136C48 created for shipment DAY2-136C48",
      "occurred_at": "2026-09-19T09:53:28.595936+05:30",
      "actor_name": "Demo Manager",
      "instruction": null,
      "reason": null,
      "acknowledged": false
    },
    {
      "id": 6128,
      "kind": "CANCELLED",
      "description": "Day 2 API evidence run - cancelling test trip",
      "occurred_at": "2026-09-19T09:53:28.641600+05:30",
      "actor_name": "Demo Manager",
      "instruction": null,
      "reason": "Day 2 API evidence run - cancelling test trip",
      "acknowledged": false
    }
  ]
}
```

### `POST /api/auth/login` — driver login (phone)

- **Purpose:** Driver sign-in
- **Auth:** none
- **Expected:** 200 · **Actual:** 200 · **PASS**

Request body:
```json
{
  "identifier": "9789791808",
  "password": "<redacted>",
  "client": "mobile"
}
```

Response (redacted):
```json
{
  "access_token": "<redacted>",
  "refresh_token": "<redacted>",
  "token_type": "bearer",
  "expires_at": "2026-09-19T04:38:28.754355Z",
  "user": {
    "id": "8728ab47-50ab-4f86-8e32-84bdc4367cd6",
    "role": "DRIVER",
    "display_name": "Day2 Test Driver 136C48",
    "email": null,
    "phone": "9789791808"
  }
}
```

### `GET /api/drivers` — driver lists drivers -> scoped to self only

- **Purpose:** driver:read is object-scoped: a driver sees one row (own)
- **Auth:** driver driver:read
- **Expected:** 200 · **Actual:** 200 · **PASS**

Response (redacted):
```json
{
  "items": 1,
  "only_self": true
}
```

### `POST /api/drivers` — driver forbidden: create driver (403)

- **Purpose:** Wrong role -> 403
- **Auth:** driver
- **Expected:** 403 · **Actual:** 403 · `FORBIDDEN` · **PASS**

Request body:
```json
{
  "full_name": "Day2 Test Driver 136C48",
  "initial_password": "<redacted>",
  "phone": "9789791808",
  "licence_number": "AS01D2136C48",
  "licence_expiry": "2028-08-19",
  "licence_class": "HMV"
}
```

Response (redacted):
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action.",
    "details": {
      "required_permission": "driver:create"
    },
    "request_id": "ac6dd1e8-d179-4496-8711-36330189b221"
  }
}
```

### `POST /api/driver/me/location` — driver GPS without active trip (404)

- **Purpose:** Telemetry refused when the driver has no trip to report for
- **Auth:** driver location:submit_own
- **Expected:** 404 or 409 · **Actual:** 404 · `NOT_FOUND` · **PASS**

Request body:
```json
{
  "fixes": [
    {
      "device_fix_id": "6264b4b1-d5d7-4b63-b640-b7167e083fcb",
      "location": {
        "lat": 26.14,
        "lon": 91.73
      },
      "recorded_at": "2026-09-19T06:00:00Z",
      "speed_kmph": 0
    }
  ]
}
```

Response (redacted):
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "You have no trip to send location for.",
    "details": {},
    "request_id": "6234b123-f38c-4f71-83d2-97fb05231304"
  }
}
```

### `POST /api/auth/refresh` — driver refresh reuse (401)

- **Purpose:** Reused refresh token revoked (family)
- **Auth:** stale refresh
- **Expected:** 401 · **Actual:** 401 · `UNAUTHENTICATED` · **PASS**

Request body:
```json
{
  "refresh_token": "<redacted>",
  "client": "mobile"
}
```

Response (redacted):
```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Invalid refresh token.",
    "details": {},
    "request_id": "7fa60411-fde3-4098-88fb-3c8d194099fd"
  }
}
```

### `GET /api/fleet/active` — fleet/active

- **Purpose:** Trips on the road (PostGIS last fix)
- **Auth:** manager fleet:location_read
- **Expected:** 200 · **Actual:** 200 · **PASS**

Response (redacted):
```json
{
  "items": 4
}
```

### `POST /api/trucks/64e2b4be-61af-4882-b8be-c5eaa787471b/retire` — truck retire (soft delete)

- **Purpose:** DELETE = retire (deleted_at set, history kept)
- **Auth:** manager truck:retire
- **Expected:** 200 · **Actual:** 200 · **PASS**

Request body:
```json
{
  "reason": "Day 2 evidence teardown"
}
```

Response (redacted):
```json
{
  "id": "64e2b4be-61af-4882-b8be-c5eaa787471b",
  "registration_number": "AS01D7808",
  "photo_url": null,
  "truck_type": "Container",
  "make": "Tata",
  "model": "LPT 1109 EX",
  "max_capacity_kg": "9000.00",
  "current_load_kg": "0.00",
  "status": "RETIRED",
  "baseline_mileage_kmpl": null,
  "created_at": "2026-09-19T09:53:28.420721+05:30"
}
```

### `POST /api/drivers/3004e822-8b52-4f91-bc4f-88326c477ff7/deactivate` — driver deactivate (soft delete)

- **Purpose:** DELETE = deactivate (login disabled, rows kept)
- **Auth:** manager driver:deactivate
- **Expected:** 200 · **Actual:** 200 · **PASS**

Request body:
```json
{
  "reason": "Day 2 evidence teardown"
}
```

Response (redacted):
```json
{
  "id": "3004e822-8b52-4f91-bc4f-88326c477ff7",
  "user_id": "8728ab47-50ab-4f86-8e32-84bdc4367cd6",
  "full_name": "Day2 Test Driver 136C48",
  "phone": "9789791808",
  "photo_url": null,
  "licence_number": "AS01D2136C48",
  "licence_expiry": "2028-08-19",
  "status": "SUSPENDED",
  "login_is_active": false,
  "created_at": "2026-09-19T09:53:28.250423+05:30"
}
```

### `GET /api/driver/me` — driver token after deactivation (401)

- **Purpose:** Deactivated login refused
- **Auth:** driver
- **Expected:** 401 or 403 · **Actual:** 401 · `UNAUTHENTICATED` · **PASS**

Response (redacted):
```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Account is disabled.",
    "details": {},
    "request_id": "7c6e8df2-b7e6-4e32-8248-fa9a75bb8d0d"
  }
}
```

## 4. Negative and contract cases covered above

| Case | Endpoint | Result |
| --- | --- | --- |
| Unauthenticated request | `GET /api/drivers` (no token, garbage token) | 401 `UNAUTHENTICATED` |
| Wrong credentials | `POST /api/auth/login` | 401 `UNAUTHENTICATED` (same message whether identifier exists or not) |
| Wrong role | `POST /api/drivers` as DRIVER; `GET /api/fleet/active` as DRIVER | 403 `FORBIDDEN` with `required_permission` |
| Object scoping | `GET /api/drivers` as DRIVER → only own row; `GET /api/drivers/{other}` as DRIVER → 404 (no existence leak) | PASS |
| Schema validation | login password < 8 chars; phone `12`; capacity `-5`; GPS fix without `location`/`recorded_at` | 422 `VALIDATION_ERROR` |
| Business rules (422) | destination outside the North-East service region; cargo over truck capacity (shipment **not** left behind — atomic plan); dispatch without a selected route (`ROUTE_SELECTION_REQUIRED`) | PASS |
| Conflicts (409) | duplicate licence (`LICENCE_EXISTS`); duplicate registration (`REGISTRATION_EXISTS`); second identical pairing (`ASSIGNMENT_UNCHANGED`); cancel a cancelled trip (`ILLEGAL_TRIP_TRANSITION`) | PASS |
| Token lifecycle | refresh rotates (200); reusing the rotated token → 401 (family revoked); deactivated driver's token → 401; logout → 204 | PASS |
| Rate limiting | `/api/auth/login` 10/min per identifier and 20/60 s per IP (`backend/app/core/rate_limit.py`, `tests/test_rate_limit.py`) — **not** triggered in this run on purpose (the demo accounts share the limiter) | covered by unit tests |

## 5. Screenshot checklist for the submission

Automatically captured this session (headless Chrome, `.runtime/day2/evidence*.mjs`) into `docs/submission/day2/task1/screenshots/`:

| File | What it shows |
| --- | --- |
| `01_backend_health.png` | `GET /health` → `{"status":"ok"}` |
| `02_backend_ready_database.png` | `GET /ready` → database + PostGIS checks `ok: true` |
| `03_fastapi_swagger.png`, `03b_fastapi_swagger_trips.png` | Swagger UI at `/docs` listing the mounted routers |
| `07_manager_backend_integration_fleet.png`, `07b_…drivers_list.png`, `07c_…trucks_list.png`, `07d_…diagnostics_providers.png` | Manager console pages fed by the API (Fleet with the live truck, Drivers, Trucks, Diagnostics) |
| `08_driver_backend_integration_trip.png`, `08b_driver_navigate_guidance.png`, `08c_driver_more.png` | Driver app signed in, ACTIVE trip, turn-by-turn from `/api/driver/me/trip/navigation`, GPS posted to `/api/driver/me/location` (202) |
| `09_trip_workflow_trips_list.png`, `09c_trip_review_panel.png`, `09d_trip_journey_history.png` | Trip list with the ACTIVE row (Open / Change journey), the route review panel ("Approved by Demo Manager"), server-side History tab |

Still to capture by hand (a terminal or DB client is needed):

| File | How |
| --- | --- |
| `04_api_login_success.png` | Swagger `/docs` → `POST /api/auth/login` → *Try it out* with the demo manager e-mail → 200 body (mask the token) — or a terminal showing `python api_evidence.py` output |
| `05_api_crud_example.png` | Terminal: the `[PASS]` lines of the run above (drivers create/read/update/deactivate) |
| `06_database_tables.png` | pgAdmin / DBeaver / Supabase Table Editor showing the 20 tables (or `\dt` in psql against the isolated cluster) |
| `10_test_results.png` | Terminal: `1210 passed, 5 skipped` (backend), `259 passed` (manager), `624 passed` (driver) |
| `11_er_diagram.png` | Use `docs/submission/day2/task1/er-diagram.png` as is |
