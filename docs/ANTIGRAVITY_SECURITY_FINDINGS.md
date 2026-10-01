# RASTA AI — INDEPENDENT APPSEC & PENETRATION AUDIT FINDINGS
**Auditor:** Antigravity AppSec Red Team  
**Target Repository:** `D:\Projects\ner-ai-logistics`  
**Date:** 29 September 2026  
**Standard:** OWASP Top 10 API Security Risks (2023), OWASP ASVS v4.0, CWE Top 25  

---

## 1. VULNERABILITY REGISTER SUMMARY

| Finding ID | Severity | Category | Title | CWE / OWASP |
|---|---|---|---|---|
| **SEC-001** | **CRITICAL** | Resource Management / DoS | Database Pool Starvation during External HTTP Calls | CWE-400 / API4:2023 |
| **SEC-002** | **CRITICAL** | Resource Management / DoS | Unrestricted Resource Consumption on 50+ API Endpoints | CWE-770 / API4:2023 |
| **SEC-003** | **HIGH** | Injection | CSV Formula Injection in Manager Trip Exports | CWE-1236 / API10:2023 |
| **SEC-004** | **HIGH** | Security Misconfiguration | Missing HTTP Security Headers on Live Production Hosted Origin | CWE-16 / API8:2023 |
| **SEC-005** | **HIGH** | Data Storage / DoS | Unmetered In-Database `bytea` Binary Storage | CWE-400 / API4:2023 |
| **SEC-006** | **MEDIUM** | Configuration / Auth | Trusted Proxy Hops Default Causes Global Rate-Limit Lockout | CWE-290 / API8:2023 |
| **SEC-007** | **MEDIUM** | Mobile Security | Cleartext HTTP LAN Endpoint in Android Build Manifest | CWE-319 / M3:2024 |
| **SEC-008** | **MEDIUM** | Information Disclosure | Tracked Mobile Anon Key in Repository Repository History | CWE-200 / API8:2023 |
| **SEC-009** | **MEDIUM** | Performance / DB | Sequential Scans on GPS Telemetry Table in Presence Endpoint | CWE-400 / API4:2023 |
| **SEC-010** | **LOW** | UI / Robustness | Manager Web Test Element Query Mismatch | CWE-398 |

---

## 2. DETAILED TECHNICAL FINDINGS

### SEC-001: Database Connection Pool Starvation during External HTTP Calls
- **Severity:** **CRITICAL** (CVSS 8.5)
- **CWE / OWASP:** CWE-400 (Uncontrolled Resource Consumption) / OWASP API4:2023 (Unrestricted Resource Consumption)
- **Reproduction:**
  1. Inspect `backend/app/api/trips.py` (`POST /api/trips/plan`, `POST /api/trips/{id}/routes/recalculate`), `backend/app/api/ai.py` (`POST /api/ai/ask`), and `backend/app/api/geocoding.py`.
  2. Notice FastAPI injects `db: DbSession` via `get_session()`, which checks out a live connection from SQLAlchemy's `AsyncEngine` pool (`pool_size=5, max_overflow=10`).
  3. The route then calls `await gemini.generate(...)` (1.2–12.0 s) or `await route_service.plan(...)` (700–8,000 ms) while holding the database connection open.
  4. Concurrently fire 15 requests to `/api/ai/ask` or `/api/trips/plan`.
  5. Send a concurrent request to `/health` or `/api/auth/login`.
  6. The login request blocks for `pool_timeout=30s` and fails with HTTP 500 / 503 (`QueuePool limit exceeded`).
- **Evidence:**
  `backend/app/api/ai.py:169-176`:
  ```python
  facts, facts_as_of = await _trip_facts(db, driver)
  ...
  gemini_res = await gemini.generate(...)  # Holds DB connection during external network call!
  ```
- **Impact:** Complete denial of service across all API endpoints, including unaffected operational features.
- **Fix:** Query necessary database facts, release or commit the session back to the pool BEFORE making outbound HTTP calls, and check out a new short-lived session only when persisting final results.
- **Regression Test:** Add a test verifying `get_engine().pool.checkedout()` is 0 while `gemini.generate` is executing.

---

### SEC-002: Unrestricted Resource Consumption on 50+ API Endpoints
- **Severity:** **CRITICAL** (CVSS 8.2)
- **CWE / OWASP:** CWE-770 (Allocation of Resources Without Limits) / OWASP API4:2023
- **Reproduction:**
  1. Audit `backend/app/main.py` router inclusions.
  2. Verify that rate limiting is implemented ONLY on `POST /api/auth/login` and `POST /api/auth/refresh`.
  3. Mutating routes including `/api/trips/plan`, `/api/ai/ask`, `/api/files`, `/api/geocoding/search`, and `/api/driver/me/location` have no rate limiting decorator or dependency.
  4. An authenticated user can flood `/api/trips/plan` or `/api/files` with 10,000 requests without meeting any 429 response.
- **Evidence:**
  Grep across `backend/app/api`: only `auth.py` imports and calls `_enforce()`.
- **Impact:** System exhaustion, massive third-party API bills (Google Places API, Gemini AI), disk fill, and degraded responsiveness.
- **Fix:** Apply `require_rate_limit(limit=N, window=60)` across all state-mutating and expensive routes.
- **Regression Test:** Add pytest tests verifying 429 response codes after exceeding configured limits on `/api/trips/plan` and `/api/files`.

---

### SEC-003: CSV Formula Injection in Manager Trip Exports
- **Severity:** **HIGH** (CVSS 7.4)
- **CWE / OWASP:** CWE-1236 (Improper Neutralization of Formula Elements in CSV File) / OWASP API10:2023 (Unsafe Consumption of APIs)
- **Reproduction:**
  1. Inspect `manager-web/src/pages/tripExport.ts:142-144`:
     ```typescript
     export function csvCell(value: string): string {
       return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
     }
     ```
  2. Create a shipment with `client_name = "=cmd|' /C calc'!A0"` or `"=SUM(A1:A10)"`.
  3. In Manager Web, navigate to Trips, click "Export CSV".
  4. The downloaded CSV contains the raw unescaped formula `=cmd|' /C calc'!A0`.
  5. Open the CSV in Microsoft Excel. Excel alerts or executes the formula.
- **Evidence:**
  `manager-web/src/pages/tripExport.ts:142`: Does not test for leading `=`, `+`, `-`, `@`, `\t`, or `\r`.
- **Impact:** Remote command execution or data exfiltration on manager workstations opening exported operational reports in spreadsheet software.
- **Fix:** Sanitize formula characters by prefixing any string starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote (`'`):
  ```typescript
  export function csvCell(value: string): string {
    const sanitized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return /[",\n\r]/.test(sanitized) ? `"${sanitized.replaceAll('"', '""')}"` : sanitized
  }
  ```
- **Regression Test:** Add a test in `manager-web/src/pages/tripExport.test.ts` asserting that `=cmd` becomes `'=cmd` in exported cells.

---

### SEC-004: Missing HTTP Security Headers on Live Production Hosted Origin
- **Severity:** **HIGH** (CVSS 7.1)
- **CWE / OWASP:** CWE-16 (Configuration) / OWASP API8:2023 (Security Misconfiguration)
- **Reproduction:**
  1. Execute `git diff backend/app/main.py`.
  2. Observe that `security_headers` middleware (which adds `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security`) is **uncommitted** in the working tree.
  3. Query live hosted Render backend `https://ner-intelligence.onrender.com/ready`.
  4. Response headers lack HSTS, CSP, nosniff, and X-Frame-Options.
- **Evidence:**
  `backend/app/main.py:230-242` is present in dirty worktree, but absent in commit `HEAD` (`5b5e474`) and absent in remote `origin/main` (`e4043ce`).
- **Impact:** Vulnerability to clickjacking, MIME-type sniffing of stored user files, and protocol downgrade attacks on the public internet.
- **Fix:** Commit and deploy the `security_headers` middleware to `main`.
- **Regression Test:** Add an HTTP test asserting headers are present on all `/ready`, `/health`, and `/api/*` responses.

---

### SEC-005: Unmetered In-Database `bytea` Binary Storage
- **Severity:** **HIGH** (CVSS 7.0)
- **CWE / OWASP:** CWE-400 (Uncontrolled Resource Consumption) / OWASP API4:2023
- **Reproduction:**
  1. Inspect `backend/app/api/files.py:80-100` and `backend/app/models/files.py`.
  2. Upload endpoint accepts files up to 5 MB per request.
  3. Files are stored directly in PostgreSQL column `stored_files.contents` as binary `bytea`.
  4. There is no rate limit on uploads and no malware scanning.
  5. Streaming multiple 5 MB files rapidly balloons PostgreSQL TOAST storage and monopolizes DB write I/O.
- **Evidence:**
  `backend/app/models/files.py:31`: `contents: Mapped[bytes] = mapped_column(sa.LargeBinary)`.
- **Impact:** Database storage exhaustion, backup bloat, and memory pressure during serialization.
- **Fix:** Store uploaded files in an S3-compatible object store (e.g. Supabase Storage / AWS S3) with presigned upload URLs; store only object keys and metadata in PostgreSQL.
- **Regression Test:** Add file upload quota and size validation tests.

---

### SEC-006: Trusted Proxy Hops Default Causes Global Rate-Limit Lockout
- **Severity:** **MEDIUM** (CVSS 6.5)
- **CWE / OWASP:** CWE-290 (Authentication Bypass by Spoofing) / OWASP API8:2023
- **Reproduction:**
  1. Inspect `backend/app/core/config.py:135`: `TRUSTED_PROXY_HOPS: int = 0`.
  2. Inspect `backend/app/core/rate_limit.py:186-194`: When `trusted_hops == 0`, `X-Forwarded-For` is ignored and `peer` is returned.
  3. On Render, `peer` is the reverse proxy's internal IP (`10.x.x.x`).
  4. All incoming requests share one IP address.
- **Evidence:**
  `backend/app/core/config.py:135` sets default `TRUSTED_PROXY_HOPS: int = 0`.
- **Impact:** Denial of service locking out all users globally when 20 login attempts occur anywhere within 60 seconds.
- **Fix:** Set `TRUSTED_PROXY_HOPS: int = 1` in `render.yaml` and default to `1` in production container images.
- **Regression Test:** Verified in `test_trusted_proxy.py`.

---

### SEC-007: Cleartext HTTP LAN Endpoint in Android Build Manifest
- **Severity:** **MEDIUM** (CVSS 5.3)
- **CWE / OWASP:** CWE-319 (Cleartext Transmission of Sensitive Information) / OWASP Mobile M3:2024
- **Reproduction:**
  1. Inspect `driver-app/eas.json:39`:
     ```json
     "EXPO_PUBLIC_API_BASE_URL": "http://192.168.1.6:8010"
     ```
  2. The `lan-demo` profile configures cleartext HTTP over local Wi-Fi.
  3. Modern Android (API 28+) blocks cleartext traffic by default unless explicitly permitted in network security config.
- **Evidence:**
  `driver-app/eas.json:39`.
- **Impact:** Credentials, GPS locations, and session tokens transmitted in plaintext on shared local Wi-Fi networks during demos.
- **Fix:** Enforce HTTPS even in local development (using self-signed certificates or mkcert/tailscale TLS).

---

### SEC-008: Tracked Mobile Anon Key in Repository
- **Severity:** **MEDIUM** (CVSS 4.3)
- **CWE / OWASP:** CWE-200 (Exposure of Sensitive Information) / OWASP API8:2023
- **Reproduction:**
  1. View `driver-app/eas.json:16,28`.
  2. The Supabase Publishable Anon JWT (`eyJhbGciOiJIUzI1Ni...`) is committed in git.
- **Evidence:**
  `driver-app/eas.json:16`.
- **Impact:** While public by design in Supabase architecture, storing API keys in tracked git files risks credential leakage and prevents key rotation.
- **Fix:** Move keys to EAS Build Secrets (`eas secret:create`).

---

### SEC-009: Sequential Scans on GPS Telemetry Table in Presence Endpoint
- **Severity:** **MEDIUM** (CVSS 5.3)
- **CWE / OWASP:** CWE-400 (Uncontrolled Resource Consumption) / OWASP API4:2023
- **Reproduction:**
  1. Execute `EXPLAIN ANALYZE` on the presence latest fix query:
     `SELECT trips.driver_id, max(gps_points.received_at) FROM gps_points JOIN trips ON trips.id = gps_points.trip_id GROUP BY trips.driver_id;`
  2. Observe query execution plan: `Parallel Seq Scan on gps_points` over all 593,214 rows (193 ms execution time).
  3. The Overview page polls `/api/presence` every 15 seconds.
- **Evidence:**
  PostgreSQL query plan on `ner_logistics_perf` confirmed sequential scan.
- **Impact:** CPU saturation on database server; degrades under large GPS telemetry volume.
- **Fix:** Add a composite index on `(driver_id, received_at DESC)` or maintain a materialized `driver_latest_position` table.

---

### SEC-010: Manager Web Test Element Query Mismatch
- **Severity:** **LOW** (CVSS 2.0)
- **CWE / OWASP:** CWE-398 (Code Quality)
- **Reproduction:**
  1. Run `npm.cmd test` in `manager-web`.
  2. 3 tests fail looking for button name `Image credits` instead of `Photo credits`.
- **Evidence:**
  Vitest output in `ScenicImage.test.tsx`, `OverviewPage.test.tsx`, `scopeSelector.test.tsx`.
- **Impact:** CI/CD build break; test flakiness.
- **Fix:** Align test assertions with component text.
