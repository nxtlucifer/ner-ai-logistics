# RASTA AI — PRIORITIZED REMAINING WORK REGISTER (P0 THROUGH P4)
**Auditor:** Antigravity Principal Architecture & Engineering Lead  
**Target Repository:** `D:\Projects\ner-ai-logistics`  
**Date:** 29 September 2026  
**Standard:** Root-cause defect remediation, prioritized by security, integrity, reliability, and scale.  

---

## 1. P0 (CRITICAL — SECURITY, SYSTEM CRASH, DATA LOSS)

### P0-01: Decouple External HTTP I/O from Database Connection Lifecycles
- **Issue:** `trips.py` (`recalculate`, `plan`), `ai.py` (`ask`), and `geocoding.py` check out a database connection from the SQLAlchemy connection pool and hold it open during external HTTP calls (0.7s to 12.0s).
- **Why:** 15 concurrent calls completely exhaust the application database connection pool (`pool_size=5, max_overflow=10`), causing immediate HTTP 500/503 denial of service across all unrelated API traffic.
- **Files:** `backend/app/api/trips.py`, `backend/app/api/ai.py`, `backend/app/api/geocoding.py`.
- **Fix:** Fetch necessary database facts, close/commit the DB session before making external HTTP requests (`gemini.generate`, `route_service.plan`, `nominatim`), and open a short-lived session only when writing the final results.
- **Test:** Concurrent load test verifying that 20 simultaneous AI requests do not block `/health` or `/api/auth/login`.
- **Risk:** Session state lifecycle changes in FastAPI dependencies.
- **Dependency:** None.
- **Complexity:** **M**
- **Blocked By:** None.

### P0-02: Implement Route-Level Rate Limiting on All Mutating & Expensive Endpoints
- **Issue:** 54 of 56 API endpoints have zero rate limiting. Authenticated users can flood `/api/trips/plan`, `/api/ai/ask`, `/api/files`, and `/api/driver/me/location`.
- **Why:** Leaves the application vulnerable to volumetric DoS, high third-party API bills (Gemini, Google Places), and database storage exhaustion.
- **Files:** `backend/app/api/trips.py`, `backend/app/api/ai.py`, `backend/app/api/files.py`, `backend/app/api/geocoding.py`, `backend/app/core/rate_limit.py`.
- **Fix:** Add `require_rate_limit(limit=N, window=60)` decorators/dependencies to all state-mutating endpoints.
- **Test:** Pytest tests verifying that requests exceeding configured limits receive HTTP 429 with valid `Retry-After` headers.
- **Risk:** Low.
- **Dependency:** None.
- **Complexity:** **M**
- **Blocked By:** None.

### P0-03: Commit and Deploy Missing Security Headers Middleware to Production
- **Issue:** Live hosted Render deployment serves no HSTS, CSP, nosniff, or X-Frame-Options headers because `security_headers` middleware exists only in uncommitted local working copy.
- **Why:** Leaves hosted web origins vulnerable to clickjacking, MIME-sniffing, and protocol downgrades.
- **Files:** `backend/app/main.py`.
- **Fix:** Commit dirty `main.py` changes and push to `main` branch for automatic Render deployment.
- **Test:** HTTP request to hosted `/ready` asserting presence of `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and HSTS.
- **Risk:** Low.
- **Dependency:** None.
- **Complexity:** **S**
- **Blocked By:** None.

---

## 2. P1 (HIGH — MAJOR ARCHITECTURAL DRIFT & RELIABILITY)

### P1-01: Apply Database Migrations 0013–0016 to Hosted Supabase
- **Issue:** Hosted Supabase database is stuck at migration `0012_push_notifications`, whereas local application code expects `0016_geography_boundaries`.
- **Why:** Schema drift prevents deploying latest manager console and driver app features (State/District RBAC, multi-instance leases, notifications inbox).
- **Files:** `backend/alembic/versions/0013_state_district_inbox.py` through `0016_geography_boundaries.py`.
- **Fix:** Authorize and execute migration rehearsal 0013–0016 against hosted Supabase instance.
- **Test:** `alembic current` on hosted database reports `0016_geography_boundaries`.
- **Risk:** Schema migration on production database.
- **Dependency:** Database backup must be taken prior to migration.
- **Complexity:** **M**
- **Blocked By:** Operator authorization for hosted database mutation.

### P1-02: Fix CSV Formula Injection in Manager Trip Exports
- **Issue:** `csvCell()` in `manager-web/src/pages/tripExport.ts` fails to sanitize formula characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
- **Why:** Allows malicious client or shipment names to execute formulas or commands when managers open CSV files in Microsoft Excel (CWE-1236).
- **Files:** `manager-web/src/pages/tripExport.ts`.
- **Fix:** Prefix any cell beginning with `=+\-@\t\r` with a single quote (`'`).
- **Test:** Vitest test asserting `=cmd` is exported as `'=cmd`.
- **Risk:** Negligible.
- **Dependency:** None.
- **Complexity:** **S**
- **Blocked By:** None.

### P1-03: Eliminate Whole-Table Sequential Scans on GPS Telemetry
- **Issue:** `/api/presence` and `/api/dashboard` run `SELECT max(received_at) FROM gps_points GROUP BY driver_id`, scanning all 593,000+ rows (193 ms per call).
- **Why:** Overview page polls this query every 15 seconds; saturates PostgreSQL CPU and disk I/O under scale.
- **Files:** `backend/app/api/presence.py`, `backend/app/api/dashboard.py`.
- **Fix:** Add a composite index on `(driver_id, received_at DESC)` or create a dedicated `latest_driver_telemetry` table updated on each GPS ingestion.
- **Test:** `EXPLAIN ANALYZE` confirms Index Only Scan with execution time < 5 ms.
- **Risk:** Low.
- **Dependency:** None.
- **Complexity:** **M**
- **Blocked By:** None.

---

## 3. P2 (MEDIUM — INFRASTRUCTURE, MOBILE & MAPS)

### P2-01: Import Survey of India Shapefiles into PostGIS
- **Issue:** `country_boundaries` is empty (0 rows); `states.geometry` and `districts.geometry` are 100% NULL.
- **Why:** 27 real-city boundary tests are skipped; PostGIS spatial boundary classification relies on synthetic test boxes.
- **Files:** `backend/scripts/import_soi_boundaries.py`.
- **Fix:** Obtain official Survey of India administrative boundary shapefiles (OVSF/1M/7) and execute `import_soi_boundaries.py`.
- **Test:** `TestRealCities` in `backend/tests/test_geo_classify.py` passes 27 collected tests without skipping.
- **Risk:** Low.
- **Dependency:** Official shapefiles download with CAPTCHA verification.
- **Complexity:** **L**
- **Blocked By:** Shapefile download requirement.

### P2-02: Migrate File Storage from PostgreSQL `bytea` to S3 / Object Store
- **Issue:** Binary files up to 5 MB are stored directly in PostgreSQL column `stored_files.contents`.
- **Why:** Causes database bloat, large backup sizes, and high memory usage when serving avatars and documents.
- **Files:** `backend/app/api/files.py`, `backend/app/models/files.py`.
- **Fix:** Integrate Supabase Storage or S3 with presigned URLs; store only URLs and metadata in PostgreSQL.
- **Test:** File upload and download tests using presigned URLs.
- **Risk:** Medium.
- **Dependency:** S3 bucket / Supabase storage bucket provisioning.
- **Complexity:** **M**
- **Blocked By:** None.

### P2-03: Fix Manager Web Vitest Label Mismatch
- **Issue:** 3 tests fail looking for button label "Image credits" instead of "Photo credits".
- **Why:** Prevents manager web CI build from reporting 100% green.
- **Files:** `manager-web/src/components/ScenicImage.test.tsx`, `manager-web/src/pages/OverviewPage.test.tsx`, `manager-web/src/pages/scopeSelector.test.tsx`.
- **Fix:** Update test selectors to query for `/photo credits/i`.
- **Test:** `npm test` in `manager-web` passes 539 of 539 tests.
- **Risk:** None.
- **Dependency:** None.
- **Complexity:** **S**
- **Blocked By:** None.

### P2-04: Upgrade Render Hosted Backend to Always-On Instance
- **Issue:** Free Render instance (0.1 CPU) spins down after 15 minutes of inactivity, causing 32.8s cold starts.
- **Why:** Severe user latency on mobile app cold start; limited to ~10 req/s.
- **Files:** `render.yaml`.
- **Fix:** Upgrade instance type to `plan: standard` located in AWS Mumbai (`ap-south-1`).
- **Test:** Continuous uptime probe confirming zero spin-down.
- **Risk:** Incurs monthly hosting cost.
- **Dependency:** Billing account.
- **Complexity:** **S**
- **Blocked By:** Operator billing authorization.

---

## 4. P3 (POLISH & HARDENING)

### P3-01: Remove Committed Anon Key from `driver-app/eas.json`
- **Issue:** Supabase publishable key is committed in tracked git file.
- **Why:** Violates secret hygiene best practices and impedes key rotation.
- **Files:** `driver-app/eas.json`.
- **Fix:** Move keys to EAS Build Secrets.
- **Test:** Build passes without keys in `eas.json`.
- **Risk:** Low.
- **Complexity:** **S**
- **Blocked By:** None.

### P3-02: Implement Offline Map Tile Caching for Driver App
- **Issue:** Driver app renders blank grey tiles when disconnected in unfamiliar corridors.
- **Why:** Leaflet webview does not cache map tiles locally for offline viewing.
- **Files:** `driver-app/src/map/DriverRouteMap.web.tsx`, `driver-app/src/map/DriverRouteMap.native.tsx`.
- **Fix:** Bundle offline raster tiles or integrate offline vector tile caching.
- **Test:** Driver map navigation verified in Airplane mode.
- **Risk:** Medium.
- **Complexity:** **L**
- **Blocked By:** None.

---

## 5. P4 (FUTURE SCALE & ENHANCEMENTS)

### P4-01: Physical Android 4G Field Certification
- **Issue:** Android GPS capture has never been executed on a physical Android handset.
- **Why:** Real-world background battery optimizations (Doze mode) can kill background tracking.
- **Files:** `driver-app`.
- **Fix:** Conduct road trials across Assam and Meghalaya highway corridors using physical Android handsets.
- **Test:** 4-hour continuous GPS track recorded with screen off.
- **Risk:** High (hardware variability).
- **Complexity:** **L**
- **Blocked By:** Physical test hardware.

### P4-02: Transition to Redis Distributed Rate Limiting & Telemetry Queue
- **Issue:** Scaling past 250 trucks requires multi-worker and multi-replica clusters.
- **Why:** In-memory rate limiting and polling degrade at high concurrency.
- **Files:** `backend/app/core/rate_limit.py`, `backend/app/services/telemetry.py`.
- **Fix:** Implement Redis-backed sliding window limiter and telemetry pub/sub.
- **Test:** 1,000 concurrent virtual drivers load test with Redis.
- **Risk:** Architectural dependency addition.
- **Complexity:** **XL**
- **Blocked By:** None.
