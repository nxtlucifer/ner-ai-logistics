# RASTA AI — Security Assurance Plan

**Owner** CISO (lane `security-assurance`)
**Written** 26 September 2026
**Baselines** hosted = `e4043ce` (`origin/main`, database revision `0012`); local = `5b5e474`
plus the uncommitted dirty tree (migration `0013`), preserved in tag
`snapshot/post-demo-2026-09-26`.
**Frameworks** OWASP ASVS 4.0.3, OWASP API Security Top 10 (2023), OWASP MASVS, NIST
SP 800-218 (SSDF) version 1.1.
**Revised** 26 September 2026, about 18:40 IST, after a failed review gate. Changed: NEW-16
and the MASVS-PRIVACY row (permissions re-read from the parsed manifest; `DUMP` removed),
NEW-04 (fixed in the working tree by another session at 18:13), section 3 (all three runs
repeated, logs kept), the SSDF titles, a new MASVS-CRYPTO row, a new NEW-19, and several
citations.
**Line numbers** point into a tree that other sessions are editing. References into
`backend/app/services/auth.py` and `backend/tests/test_auth.py`, which another session
changed at 18:13 and 18:12, were re-read at 18:25–18:30 IST. Modification-time checks
(`find -newer`) at 18:23 and 18:33 IST found no other file this plan cites changed after
the first draft (18:06). Fingerprint of `backend/app` and `backend/tests` at 18:28 IST:
`23ad9807f7e62c22`, the first 16 hex digits of the SHA-256 of a `sha256sum` listing of
their 229 tracked and untracked files (`PROVEN_BY_RUNTIME`; the listing is
`backend-fingerprint.txt` in the lane scratch directory). Recheck a line before citing it.

This is a plan and a findings register, not a certificate. It does not say the system is
secure. It lists what was checked, how, and what is still open. Nothing in it was tested
against the hosted service: every runtime result below comes from the local test client
against the isolated database `ner_logistics_test`. Hosted state is read from the
deployed commit's source, never from requests to Render or Supabase.

### Evidence labels

Every claim carries exactly one label.

| Label | Meaning |
|---|---|
| `PROVEN_BY_TEST` | A pytest test ran in this lane and its result is quoted |
| `PROVEN_BY_RUNTIME` | A command or script ran in this lane and its output is quoted |
| `PROVEN_BY_DATABASE` | A read-only query against the isolated cluster |
| `PROVEN_BY_SOURCE` | Read in the file at the line given (`git show origin/main:` for hosted) |
| `PROVEN_BY_WEB` | Read from the URL given, fetched in this lane |
| `INFERRED` | Reasoned from evidence, not observed. Never a fact |
| `NOT_VERIFIED` | Not checked. Unknown is not safe |
| `BLOCKED` | Could not be checked without breaking a lane rule |

### Severity scale

| Level | Rule | Release effect |
|---|---|---|
| P0 | Exploitable now without an account, or a live credential exposed publicly | Stop. Hotfix and rotate |
| P1 | Crosses a trust boundary for a signed-in user, puts a secret where people without a need can read it, or publishes personal data | Blocks release |
| P2 | A required control (ASVS L1) is missing, or an existing control has a realistic bypass | Fix before release, or a written acceptance naming an owner and a date |
| P3 | Hardening, hygiene, defence in depth | Scheduled |

---

## 0. Where the target stands today

**Target:** zero known P0 or P1 findings on the surface being released. A release is
any deploy of the integration branch to hosted, and any APK handed to a driver.

**The target is not met.** Three P1 findings are open. One of them, C1-01, is carried
from cycle 1 and was not re-verified in this lane.

| ID | P1 finding | Surface | Evidence |
|---|---|---|---|
| C1-01 | Cycle 1 reported that public evidence images on `origin/main` show the demo driver's full phone number | hosted repository | Image content: `NOT_VERIFIED` in this lane (the images were not opened). Count of matching files (18): `PROVEN_BY_SOURCE` |
| NEW-01 | The Gemini API key is written to the application log on every Gemini call | hosted **and** local | `PROVEN_BY_TEST` (scratch test, red) |
| NEW-02 | State and district managers can read, deactivate and "view as" any driver in the fleet | local only (0013 roles) | `PROVEN_BY_TEST` (scratch test, red) |

No P0 was found. That is a statement about what was examined, not a guarantee —
`NOT_VERIFIED` for everything outside sections 1–8.

---

## 1. Security backlog

Status values: `OPEN`, `FIXED_LOCAL_UNCOMMITTED` (fixed in the dirty tree, not deployed),
`FIXED_HOSTED`. **Nothing in this register is `FIXED_HOSTED`.** Every fix made since the
demo is in the uncommitted tree. `PROVEN_BY_SOURCE` for each "hosted" cell, from
`git show origin/main:<path>`.

### 1a. Cycle-1 findings

| ID | Finding | Sev | Hosted `e4043ce` | Local dirty tree | Status | Owner | Regression test | Evidence |
|---|---|---|---|---|---|---|---|---|
| C1-01 | Cycle 1 reported that evidence PNGs show the demo driver's full phone number (user decision pending) | P1 | present. `git ls-tree origin/main` finds 18 files matching `docs/terrain-command/evidence/{after,before,iteration1}-driver-*.png`. Cycle-1 reported 12 of them show the number | same files | OPEN | Product owner decides; Release manager executes | needed: a tracked-asset allowlist check for `docs/**/*.png` in CI | `PROVEN_BY_SOURCE` (file count). Image content: cycle-1 finding, `NOT_VERIFIED` in this lane |
| C1-02 | DEP-6: a forged `Host` header bypassed the must-reset gate | P1 | not affected. The gate does not exist in `e4043ce` | fixed at `backend/app/api/deps.py:81`, which uses `request.scope["path"]` | FIXED_LOCAL_UNCOMMITTED | Backend lead | `tests/test_org_api.py::TestTemporaryPasswordGate::test_a_new_manager_may_do_nothing_but_change_their_password` (forged Host at lines 269–273). **Passed** | `PROVEN_BY_TEST` |
| C1-03 | Blocked AI prompts logged their text at WARNING | P3 | live: `backend/app/services/gemini.py:268,278` log `user[:50]` | logs length and driver id only | FIXED_LOCAL_UNCOMMITTED | Backend lead | `tests/test_gemini_ai.py::test_prompt_injection_defense`, `::test_credential_theft_defense`. **Passed** | `PROVEN_BY_TEST` |
| C1-04 | Leaflet loaded into the driver WebView with no Subresource Integrity (SEC-008) | P3 | 0 `integrity=` attributes in `driver-app/src/map/DriverRouteMap.native.tsx` | pinned at `DriverRouteMap.native.tsx:48-55` (plan commit 16) | FIXED_LOCAL_UNCOMMITTED | Mobile lead | `driver-app/src/map/subresourceIntegrity.test.ts` (not run in this lane) | `PROVEN_BY_SOURCE` |
| C1-04a | Are the two pinned digests correct? | — | — | Both equal `sha384` of `driver-app/node_modules/leaflet/dist/leaflet.{css,js}`, version 1.9.4, computed with `openssl dgst -sha384` | — | Mobile lead | — | `PROVEN_BY_RUNTIME` |
| C1-04b | Does unpkg serve those same bytes? | — | — | unpkg serves npm package contents, so it should, but no request to unpkg was made | — | Mobile lead | — | `INFERRED` |
| C1-05 | SEC-006: login limiter keys on the TCP peer, which on Render is the proxy | P3 | open: `backend/app/api/auth.py:67-74` uses `request.client.host` | `auth.py:71-89` calls `client_address`; lands in plan commit 31. `render.yaml`'s `TRUSTED_PROXY_HOPS=1` has no effect before then | FIXED_LOCAL_UNCOMMITTED | Backend lead | `tests/test_trusted_proxy.py`, 12 tests. **Passed**. `tests/test_security_assessment.py:258-297` still asserts the open state and needs rework | `PROVEN_BY_TEST` |
| C1-06 | `ShipmentRead` has `min_length=3` while `ShipmentCreate` has `min_length=1`. A 1–2 character address can be written but not read back, and one such row breaks every list that returns it (500) | P2 | not present | `backend/app/schemas/domain.py:244,246` (create) vs `:298-299` (read) | OPEN (rework in plan commit 25) | Backend lead | needed: `test_short_address_shipment_is_readable` — create with `"A"`, then `GET /api/shipments` → 200 | `PROVEN_BY_SOURCE` |
| C1-07 | Supabase RPC `public.plan_trip` is a SECURITY INVOKER wrapper (`:249-253`) with `grant execute ... to authenticated` (`:260`). It calls `app.plan_trip`, which is SECURITY DEFINER (`:41-45`) and writes `pickup_address` / `destination_address` with no length or emptiness check | P3 (P2 together with C1-06) | `supabase/migrations/20260907120800_manager_plan_trip.sql:136,138,215,220` | same file | OPEN | Backend lead | needed: SQL test that calls `plan_trip` with `''`, `'A'` and a 10,000-character address and expects `22023` | `PROVEN_BY_SOURCE`. Whether the migration is applied on hosted Supabase: `NOT_VERIFIED` |
| C1-08 | Branch `origin/claude/pdf-master-mission-gohuj5`: durable event queue is not trip-scoped, strands events at INCIDENT, retries permanent 4xx forever | P2 | not merged | not merged | OPEN | Mobile lead | needed, on that branch: `eventQueue.test.ts` cases for a 4xx drop and a trip change | Queue files exist on the branch (`driver-app/src/events/eventQueue.ts`, `backend/app/services/device_events.py`) — `PROVEN_BY_SOURCE`. The behaviour is a cycle-1 finding, `NOT_VERIFIED` in this lane |
| C1-09 | `docs/submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.docx` on `origin/main` is corrupt | P3 | 7,500 bytes, Python `zipfile` → `BadZipFile` | — | OPEN | Release manager | needed: a docs check that opens every tracked `.docx`/`.pptx` with `zipfile` | `PROVEN_BY_RUNTIME` |
| C1-10 | District data is a CANDIDATE only. No verified official district seed exists, so district managers match no trips and `recipients_for_trip` returns `[]` | P3 (fails closed) | no districts table | 8 states seeded, 0 districts | OPEN (needs an official source) | Product owner | `tests/test_state_district_scope.py::TestSeed::test_districts_are_not_seeded_and_that_is_deliberate`. **Passed** | `PROVEN_BY_TEST` |

### 1b. Day 2 fixes that are not deployed

The Day 2 report lists SEC-002 as "FIXED". That is true of the working tree only.
**Hosted still serves the vulnerable code.**

| ID | Finding | Sev | Hosted `e4043ce` | Local | Status | Owner | Regression test (result in this lane) | Evidence |
|---|---|---|---|---|---|---|---|---|
| SEC-001 | API responses carry no hardening headers | P3 | `backend/app/main.py` has no `security_headers` middleware | `main.py:199-211` | FIXED_LOCAL_UNCOMMITTED | Backend lead | `test_security_assessment.py::TestSecurityHeaders` (2). Passed | `PROVEN_BY_TEST` |
| SEC-002 | Any driver can read another driver's document metadata (BOLA) | P2 | `backend/app/api/documents.py:226-233` queries by path `driver_id` with no ownership check | `documents.py:273` resolves the driver through `drivers.get(actor=)` | FIXED_LOCAL_UNCOMMITTED | Backend lead | `TestDriverDocumentsAreScoped` (2). Passed | `PROVEN_BY_TEST` |
| SEC-003 | A driver can list the whole truck register | P3 | `backend/app/services/trucks.py:41-53` has no actor filter | `trucks.py:30-47` | FIXED_LOCAL_UNCOMMITTED | Backend lead | `TestTruckRegisterIsScopedForDrivers` (2). Passed | `PROVEN_BY_TEST` |
| SEC-004 | Upload buffers the whole body before the 5 MB check | P3 | `backend/app/api/files.py:89` `await request.body()` | `files.py:93-100` streams and stops at the cap | FIXED_LOCAL_UNCOMMITTED | Backend lead | `TestUploadIsBoundedBeforeItIsBuffered` (2). Passed | `PROVEN_BY_TEST` |
| SEC-005 | Render static sites send no clickjacking or referrer headers | P3 | `render.yaml` has no `headers:` block | `render.yaml` adds `X-Frame-Options`, `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy` | FIXED_LOCAL_UNCOMMITTED | Release manager | needed: post-deploy `curl -sI` check. No automated test exists | `PROVEN_BY_SOURCE` |

### 1c. New findings from this lane

Details and reproduction tests are in section 7.

| ID | Finding | Sev | Hosted | Local | Status | Owner | Regression test | Evidence |
|---|---|---|---|---|---|---|---|---|
| NEW-01 | Gemini API key logged in plain text | P1 | yes | yes | FIXED on `post-demo-integration` (1c14764: key sent as `x-goog-api-key`, httpx request log at WARNING); hosted still exposed until deploy, then rotate the key | Backend lead | `test_gemini_api_key_never_reaches_the_log` (green) | `PROVEN_BY_TEST` |
| NEW-02 | Scoped managers have fleet-wide power over drivers, trucks, assignments, emergencies and files | P1 | n/a (roles absent) | yes | FIXED in the working tree (scoped roles lose driver/truck/assignment/emergency writes); lands with the gated 0013 commits | Backend lead + CISO | `tests/test_scoped_role_writes.py` (green) | `PROVEN_BY_TEST` |
| NEW-03 | `POST /api/auth/password` has no attempt limit | P2 | n/a (route absent) | yes | OPEN | Backend lead | `test_password_change_guessing_is_rate_limited` (red) | `PROVEN_BY_TEST` |
| NEW-04 | Login identifier is matched with `ILIKE`, so `%` and `_` are wildcards | P2 | yes: `services/auth.py:95` (`PROVEN_BY_SOURCE`) | fixed by another session at 18:13, uncommitted: `func.lower(User.email) == normalised.lower()` at `services/auth.py:166` | FIXED_LOCAL_UNCOMMITTED | Backend lead | `tests/test_auth.py::TestLogin::test_email_wildcards_are_literal` (in the tree) and the two scratch tests `test_login_identifier_is_matched_literally`, `test_a_wildcard_matching_many_accounts_is_an_ordinary_401`. All **passed** at 18:25–18:28 | `PROVEN_BY_TEST` (local tree) |
| NEW-04b | The manager-creation email check still uses `ILIKE` (`api/org.py:355`) | P3 | n/a (file absent on `e4043ce`) | yes | OPEN | Backend lead | needed: create a manager whose email differs from an existing one only where the new one has `_`; expect no `EMAIL_TAKEN` | `PROVEN_BY_SOURCE` |
| NEW-05 | Uploads have no per-principal count or byte quota | P2 | yes | yes | OPEN | Backend lead | needed | `PROVEN_BY_SOURCE` |
| NEW-06 | Driver passwords: manager-chosen, never forced to change; 8-character minimum; no breached-password check | P2 | yes | yes | OPEN | Backend lead | needed | `PROVEN_BY_SOURCE` |
| NEW-07 | No MFA on the manager / admin console | P2 | yes | yes | OPEN | CISO | needed | `PROVEN_BY_SOURCE` |
| NEW-08 | Manager web caches API lists (driver phones included) in `localStorage`, cleared only on explicit logout | P3 | yes | yes | OPEN | Web lead | needed | `PROVEN_BY_SOURCE` |
| NEW-09 | Driver app keeps the GPS queue and offline trip package in unencrypted AsyncStorage | P3 | yes | yes | OPEN | Mobile lead | needed | `PROVEN_BY_SOURCE` |
| NEW-10 | Map WebView: `originWhitelist={['*']}`, no navigation guard, `onMessage` does not check the origin | P3 | yes | yes | OPEN | Mobile lead | needed | `PROVEN_BY_SOURCE` |
| NEW-11 | Audit IP is the left-most `X-Forwarded-For`, which the client controls | P3 | yes | yes | OPEN | Backend lead | needed | `PROVEN_BY_SOURCE` |
| NEW-12 | `GET /api/presence` returns every active user, unpaginated, for unscoped roles | P3 | n/a | yes | OPEN | Backend lead | needed | `PROVEN_BY_SOURCE` |
| NEW-13 | Refresh expiry slides 30 days on every rotation; no absolute session lifetime | P3 | yes | yes | OPEN | Backend lead | needed | `PROVEN_BY_SOURCE` |
| NEW-14 | `docs/SECURITY.md` §10 says retention "is enforced by a scheduled job". No such job exists | P2 | yes | yes | OPEN | Data protection owner | needed | `PROVEN_BY_SOURCE` |
| NEW-15 | CI has no security gates. The only workflow is `.github/workflows/migrations.yml` | P2 | yes | yes | OPEN | CISO | — | `PROVEN_BY_SOURCE` |
| NEW-16 | The 1.0.22 APK requests `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `CAMERA`, `USE_BIOMETRIC`, `USE_FINGERPRINT` and legacy external storage (`maxSdkVersion` 32). Whether a feature uses each one was not checked | P3 | unknown | yes | OPEN | Mobile lead | needed: a build check that compares the parsed `uses-permission` list with an allowlist | `PROVEN_BY_RUNTIME` (`uses-permission` elements of the parsed binary manifest) |
| NEW-17 | No screenshot policy: no `FLAG_SECURE` in the app, no rule for evidence images (the root cause of C1-01) | P3 | yes | yes | OPEN | Product owner | — | `PROVEN_BY_SOURCE` |
| NEW-18 | 13 mounted `/api` paths are missing from `docs/API_CONTRACTS.md` | P3 | n/a | yes | OPEN | Backend lead | the check in plan commit 32 | `PROVEN_BY_RUNTIME` |
| NEW-19 | The driver app's stop-request id fell back to a non-UUID string when `crypto.randomUUID` is missing, and the API accepts only a UUID. Hermes and Expo's native runtime install no `crypto` global, so on the APK the emergency stop request was **probably always rejected (422)** | **P1** (raised 27 Sep) | yes (APK 1.0.22) | yes | FIXED in the working tree (RFC 4122 v4 fallback); on-device check pending | Mobile lead | driver-app `makeRequestId` tests | `PROVEN_BY_SOURCE` (Hermes has no crypto global per Expo runtime source); on device `NOT_VERIFIED` |
| NEW-20 | `GET /api/emergencies/active` was not scoped: STATE_MANAGER and DISTRICT_MANAGER (both hold EMERGENCY_READ) saw every open emergency in the fleet, including other areas' drivers | P2 | n/a (scoped roles need 0013) | yes | FIXED in the working tree (joins Trip, applies `scope.trip_scope_clause`) | Backend lead | `test_a_scoped_manager_sees_it_only_where_they_see_the_trip` | `PROVEN_BY_TEST` |
| NEW-21 | `EmergencyRead.last_gps_point_id` was typed UUID for a BIGINT column: every emergency with a GPS fix made `/api/emergencies/active`, the driver's `/me/trip` and the check-in response return 500, so the SOS path failed exactly when a position was known | **P1** (safety-path availability) | **yes** (e4043ce `schemas/domain.py:489`) | yes | FIXED in the working tree (`int \| None`) | Backend lead | `test_without_a_phone_position_the_last_gps_fix_is_used` | `PROVEN_BY_TEST` |
| NEW-22 | A driver's 'Emergency: request trip stop' created no Emergency row, so the manager's SOS badge and Fleet incident view never showed it (only an inbox notification) | **P1** (product safety) | yes | yes | FIXED in the working tree (opens/escalates an SOS_ESCALATED emergency; lock order emergency then trip; idempotent) | Backend + web leads | `tests/test_driver_sos_emergency.py` (16 tests); browser re-proof | `PROVEN_BY_TEST` + `PROVEN_BY_RUNTIME` (see the final browser proof) |
| NEW-23 | Audit rows recorded the left-most `X-Forwarded-For` entry, which the client controls | P2 | yes | yes | FIXED in the working tree (hop-aware `client_address`) | Backend lead | `tests/test_ops_hardening.py` | `PROVEN_BY_TEST` |
| NEW-24 | Argon2 password checks ran on the event loop: every login stalled all requests on the worker (~45 ms locally, far more on 0.1 CPU); a login burst amplified that | P2 | yes | yes | FIXED in the working tree (bounded `to_thread`, no pool slot held while waiting) | Backend lead | `TestArgon2OffTheLoop` | `PROVEN_BY_TEST` |
| NEW-25 | Trip cancel sent Expo pushes before its commit while holding the trip row lock: a rolled-back cancel could still tell the driver 'Trip cancelled' | P2 | yes | yes | FIXED in the working tree (push after commit) | Backend lead | `tests/test_ops_hardening.py` | `PROVEN_BY_TEST` |
| NEW-26 | Sentinel sweep escalated on an unlocked, possibly stale trip/emergency read (lost update over DELIVERED/CANCELLED; dangling emergencies) | P2 | yes | yes | FIXED in the working tree (row locks, one lock order, status re-check) | Backend lead | `tests/test_ops_hardening.py`, sentinel tests | `PROVEN_BY_TEST` |
| NEW-27 | Login/refresh rate limits were per process, so N instances gave N× the budget | P2 once >1 instance | n/a (1 instance) | yes | FIXED behind `MULTI_INSTANCE` (shared Postgres windows, sha256 keys, local flood shedding) | Backend lead | `tests/test_coordination.py` | `PROVEN_BY_TEST` + two-process proof |
| NEW-28 | Official-warning matching read the issuing office ('IMD Guwahati has issued…') as the warned area, putting a false HIGH alert on Guwahati corridors for manager and driver | P2 (evidence integrity) | yes | yes | FIXED in the working tree (strip only a known NE office followed by an issuing verb on the same line; true matches kept) | Backend lead | `tests/test_official_warnings.py` | `PROVEN_BY_TEST` |
| NEW-29 | The driver app deleted its refresh token on ANY non-2xx refresh (a 5xx during a backend wake, a 429 behind carrier NAT), forcing a password sign-in in the field | P2 | yes | yes | FIXED in the working tree (clear only on 401/403) | Mobile lead | `src/api/refreshSession.test.ts` | `PROVEN_BY_TEST` |

---

## 2. Control map

Status values: `COVERED` means a control exists and a test that ran here proves it.
`PARTIAL` means a control exists with a known gap. `GAP` means no control. `NOT_VERIFIED`
means not checked. "Passed" means passed in the section-3 run on the local tree. None
of these statuses describes hosted, which lacks the section-1b fixes.

### 2a. OWASP API Security Top 10 (2023)

Item titles are `PROVEN_BY_WEB`: https://api-security.owasp.org/editions/2023/en/0x11-t10

| Item | Control in RASTA | Proving test | Status |
|---|---|---|---|
| API1 Broken Object Level Authorization | The driver's subject always comes from the token: `deps.py:141-180`. Drivers see only their own row: `services/drivers.py:34-74`. Trucks: `services/trucks.py:30-47`. Documents: `documents.py:273`. Files: `files.py:160-173`. Trips and shipments are row-scoped through `core/scope.py:99-165`, used at `services/trips.py:164-171,347-348` and `services/shipments.py:71-72` | `test_authorization.py` (27), `test_scope_http_idor.py` (7), `test_security_assessment.py::TestScopedManagerIdor`, `TestDriverDocumentsAreScoped`. Passed | **PARTIAL** — NEW-02 (scoped managers unscoped outside trips and shipments); SEC-002 and SEC-003 live on hosted. `PROVEN_BY_TEST` |
| API2 Broken Authentication | Argon2id: `core/security.py:27-29`. HS256 pinned with `exp/iat/sub` required: `auth/verifier.py:70-86`. Role and `is_active` re-read from the database on each request: `deps.py:62-71`. Login limits per IP and per identifier: `api/auth.py:192-194`, `config.py:146-156`. Refresh rotation with family revocation: `services/auth.py:241-321` | `test_auth.py` (32), `test_rate_limit.py` (18), `test_trusted_proxy.py` (12), `test_login_workspace.py` (10). Passed | **PARTIAL** — NEW-03, NEW-04b, NEW-06, NEW-07; NEW-04 and SEC-006 live on hosted. `PROVEN_BY_TEST` |
| API3 Broken Object Property Level Authorization | Request models reject unknown fields (`extra="forbid"`): `schemas/common.py:26-29`. Document numbers are masked: `documents.py:71,136-138`. Salary needs `driver:read_sensitive`, which only ADMIN holds: `permissions.py:31,114-126` | `test_input_limits.py` (4), `test_auth.py::test_never_returns_password_hash`, `test_files_documents.py::TestDocuments::test_numbers_are_masked_dates_validated_and_status_derived`. Passed | **PARTIAL** — `DriverRead` returns phone numbers to every `driver:read` holder, including scoped managers (NEW-02). `PROVEN_BY_TEST` |
| API4 Unrestricted Resource Consumption | Page size capped at 100: `api/trips.py:64`, `api/fleet.py:48`. Upload caps: `files.py:47,53,94-101`. AI limit of 10 per minute per driver, held in process: `services/gemini.py:136-157`. Auth limits as API2 | `TestUploadIsBoundedBeforeItIsBuffered`, `test_rate_limit.py::test_gps_ingestion_is_never_rate_limited`, `test_gemini_ai.py::test_free_tier_rate_limiter`. Passed | **PARTIAL** — NEW-05, NEW-12; GPS ingestion is unbounded by design (`docs/SECURITY.md` §12); limiter state resets on restart. `PROVEN_BY_TEST` |
| API5 Broken Function Level Authorization | Every protected route goes through `require_permission`: `deps.py:101-121`. Unknown roles get nothing: `permissions.py:200-207`. Support-view tokens are GET-only: `deps.py:88-93`. Only 6 routes have no auth dependency: `/health`, `/ready`, `POST /api/auth/{login,refresh,logout}`, `GET /api/org/regions` | `test_authorization.py`, `test_route_review_authorization.py` (29), `test_support_session.py` (1), `test_org_api.py` (11). Passed | **PARTIAL** — the check is enforced; the permission set granted to scoped roles is the NEW-02 problem. Route list: `PROVEN_BY_RUNTIME` (dependency walk of `create_app()`) |
| API6 Unrestricted Access to Sensitive Business Flows | Route approval gate: `services/route_review.py`, `test_route_review_authorization.py`. AI cost bounded per driver. Dispatch compliance gate lands in plan commit 28 | `test_route_review_authorization.py` (29). Passed | **PARTIAL** — no abuse-case review of SOS or emergency spam, or of AI cost across many drivers. `NOT_VERIFIED` |
| API7 Server Side Request Forgery | Maps-link host allowlist plus private-address refusal: `services/maplink.py:36,62,65-79`. Redirects not followed automatically; each hop is re-checked: `:116,119` | `test_maplink.py` (13). Passed | **COVERED**. `PROVEN_BY_TEST` |
| API8 Security Misconfiguration | Headers: `main.py:199-211`. Docs and OpenAPI served in development only: `main.py:179-181`. Explicit CORS origins: `main.py:184-190`, `config.py:384-395`. Placeholder `SECRET_KEY` refused outside development: `config.py:408-416`. Non-root container: `backend/Dockerfile:39`. Uniform error envelopes: `core/errors.py:200-219` | `TestSecurityHeaders`, `test_config.py` (30), `test_health.py` (9). Passed | **PARTIAL** — NEW-01 (log level exposes a key); SEC-001 and SEC-005 live on hosted; no `script-src` CSP on the static sites. `PROVEN_BY_TEST` |
| API9 Improper Inventory Management | OpenAPI off in production. `docs/API_CONTRACTS.md` is the inventory | the plan-commit-32 route/doc check (not a pytest) | **GAP** — 13 undocumented paths (NEW-18). Three `claude/*` branches are not merged into `origin/main` (`git branch -r --no-merged origin/main`). One of them carries a forked `0013` migration: `git ls-tree origin/claude/pdf-master-mission-gohuj5 backend/alembic/versions` lists `0013_device_events.py`, while the local tree has `0013_state_district_inbox.py`. `PROVEN_BY_RUNTIME` |
| API10 Unsafe Consumption of APIs | Outbound timeouts (`GEMINI_TIMEOUT_SECONDS`, `GEOCODING_TIMEOUT_SECONDS`, weather). AI answers are advisory. The Places key travels in a header (`services/geocoding.py:299-302`) | `test_gemini_ai.py` (11), `test_maplink.py`. Passed | **PARTIAL** — Gemini key sent in the URL query (`gemini.py:323`, NEW-01); 100 characters of a Gemini error body are logged (`gemini.py:358`). `PROVEN_BY_TEST` |

### 2b. OWASP ASVS 4.0.3 chapters

Requirement texts quoted here are `PROVEN_BY_WEB` from
`https://raw.githubusercontent.com/OWASP/ASVS/v4.0.3/4.0/en/` files
`0x11-V2-Authentication.md`, `0x12-V4-Access-Control.md`, `0x15-V7-Error-Logging.md`
and `0x16-V8-Data-Protection.md`.

| Chapter | Control in RASTA | Proving test | Status |
|---|---|---|---|
| V2 Authentication | Argon2id `t=3, m=64 MiB, p=4` (`security.py:27-29`). Timing equalised with a dummy hash (`services/auth.py:34,178-179`). Managers get a random temporary password and a forced change (`org.py:384-392`, `deps.py:81`) | `test_auth.py`, `test_rate_limit.py`, `test_org_api.py::TestTemporaryPasswordGate`. Passed | **PARTIAL.** 2.1.1 asks for at least 12 characters; RASTA allows 8 (`schemas/auth.py:12`, `schemas/domain.py:47`). No breached-password check (2.1.7). 2.2.1 anti-automation is weakened by NEW-03, and on hosted by NEW-04. 2.3.1 (initial passwords) is not met for drivers (NEW-06). `PROVEN_BY_SOURCE` |
| V3 Session management | Refresh cookie: HttpOnly, Secure outside development, `path=/api/auth` (`api/auth.py:103-126`). Web body never carries the refresh token (`:141-171`). 15-minute access token. Reuse revokes the whole family. A password change revokes every refresh token (`api/auth.py:326`) | `test_auth.py::test_reuse_of_a_rotated_token_revokes_the_whole_family`, `::test_refresh_token_cookie_is_http_only`, `::test_web_response_body_never_carries_the_refresh_token`, `::test_logout_revokes_the_session`. Passed | **PARTIAL** — NEW-13 (no absolute lifetime). An access token outlives a password change by up to 15 minutes (`INFERRED` from stateless JWT design, `security.py:63-92`) |
| V4 Access control | As API1 and API5 | as above | **PARTIAL.** 4.1.3 (least privilege) and 4.2.1 (IDOR) are not met for scoped managers (NEW-02). 4.3.1 requires MFA on administrative interfaces at L1; there is none (NEW-07). `PROVEN_BY_TEST` |
| V5 Validation, sanitisation, encoding | Pydantic request models with `extra="forbid"` and a maximum on every client string. SQLAlchemy binds every value | `test_input_limits.py` (4). Passed | **PARTIAL** — `ILIKE` wildcards in the hosted login (NEW-04), the local manager-email check (NEW-04b) and search (SEC-010, accepted); C1-06 read/write mismatch. `PROVEN_BY_TEST` |
| V7 Error handling and logging | Generic envelopes; stack traces go to the server log only (`errors.py:200-219`). `safe_dump` redacts `SECRET_KEY` and the database password (`config.py:478-500`). Audit table `audit_logs` with RESTRICT on the actor | `test_audit.py` (15), `test_gemini_ai.py` caplog tests. Passed | **PARTIAL.** 7.1.1 ("does not log credentials") fails: NEW-01. Audit IP can be forged (NEW-11). No log retention or alerting is defined (`NOT_VERIFIED` on Render). `PROVEN_BY_TEST` |
| V8 Data protection | `Cache-Control: no-store` on `/api/` (`main.py:207-208`, local only). Document numbers masked. Files private, served only to the owner or a fleet reader | `TestSecurityHeaders::test_api_bodies_are_never_cached_but_avatars_keep_their_own_policy`. Passed | **PARTIAL.** 8.2.2/8.2.3 (browser storage): NEW-08. 8.3.8 (retention, L2): NEW-14. `PROVEN_BY_SOURCE` |
| V9 Communications | TLS terminates at Render (`NOT_VERIFIED`: no hosted request was made). HSTS outside development (`main.py:209-210`, local only). `DB_REQUIRE_SSL` setting. Android cleartext refused except for one private IP in the `lan-demo` profile (`driver-app/plugins/withDemoNetworkSecurity.js:6-19`) | none ran here | **PARTIAL.** `PROVEN_BY_SOURCE` |
| V12 Files and resources | Type decided by magic bytes; SVG and HTML refused; 5 MB and 512 KB caps; bytes stored in PostgreSQL by UUID, so no file paths exist; `nosniff` on local | `test_files_documents.py::TestFiles` (6), `TestUploadIsBoundedBeforeItIsBuffered`. Passed | **PARTIAL** — NEW-05 (no quota); SEC-004 live on hosted. `PROVEN_BY_TEST` |
| V13 API and web service | Auth on every route except 6. `allow_methods` limited to GET, POST, PATCH, DELETE, OPTIONS. JSON envelopes. OpenAPI off in production | route walk (section 2a, API5) | **PARTIAL** — API9 inventory drift. `PROVEN_BY_RUNTIME` |
| V14 Configuration | Direct Python dependencies pinned (14 `==` lines in `backend/requirements.txt`). npm lockfiles present. `scripts/secret_scan.py` exists | `test_config.py` (30), `test_db_target_guard.py` (16), `test_disposable_guard.py` (9). Passed | **PARTIAL** — transitive Python dependencies unpinned and unhashed; no SBOM; no CI gate (NEW-15). `PROVEN_BY_TEST` |

### 2c. NIST SSDF v1.1

Practice group and practice titles are `PROVEN_BY_WEB`. They were extracted with `pypdf`
from the PDF fetched at https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf
(fetched again at about 18:24 IST; the extract is `ssdf-titles.txt` in the lane scratch
directory). Titles are given in full.

| Practice | RASTA today | Status |
|---|---|---|
| PO.3 Implement Supporting Toolchains | Tests and the migration rollback job exist. No security toolchain in CI | GAP (NEW-15). `PROVEN_BY_SOURCE` |
| PS.1 Protect All Forms of Code from Unauthorized Access and Tampering | Git on GitHub. Branch protection `NOT_VERIFIED` | NOT_VERIFIED |
| PS.2 Provide a Mechanism for Verifying Software Release Integrity | APK signer recorded in `docs/POST_DEMO_STATE.md`. No published checksum or SBOM | PARTIAL. `PROVEN_BY_SOURCE` |
| PS.3 Archive and Protect Each Software Release | APKs held in the git-ignored `.runtime/` on one machine only | GAP. `PROVEN_BY_SOURCE` |
| PW.4 Reuse Existing, Well-Secured Software When Feasible Instead of Duplicating Functionality | Argon2, PyJWT, Pydantic, SQLAlchemy | COVERED. `PROVEN_BY_SOURCE` |
| PW.7 Review and/or Analyze Human-Readable Code to Identify Vulnerabilities and Verify Compliance with Security Requirements | Manual reviews (Day 2 assessment, this plan). No SAST | PARTIAL |
| PW.8 Test Executable Code to Identify Vulnerabilities and Verify Compliance with Security Requirements | 402 security-relevant tests passed in this lane (section 3) | PARTIAL: not in CI. `PROVEN_BY_TEST` |
| PW.9 Configure Software to Have Secure Settings by Default | `TRUSTED_PROXY_HOPS=0`, `client="web"`, docs off outside development | COVERED. `PROVEN_BY_SOURCE` |
| RV.1 Identify and Confirm Vulnerabilities on an Ongoing Basis | `npm audit` runs by hand; `pip-audit` not installed | PARTIAL |
| RV.2 Assess, Prioritize, and Remediate Vulnerabilities | This register | PARTIAL |
| RV.3 Analyze Vulnerabilities to Identify Their Root Causes | Incident records exist (`docs/INCIDENT_2026-09-06_SHARED_DB_WRITE.md`) | PARTIAL |

---

## 3. Test results (real counts)

**Command**, run from the repository root:

```bash
source .runtime/use-isolated-db.sh && cd backend && \
  .venv/Scripts/python.exe -m pytest -q -p no:cacheprovider <files>
```

**Target** `127.0.0.1:55432/ner_logistics_test` at revision `0013_state_district_inbox`
(`PROVEN_BY_DATABASE`: `select version_num from alembic_version`). The code under test is
the local dirty tree, **not** `e4043ce`.

**When.** All three runs below were made on 26 September 2026 between 18:25 and 18:28 IST,
after another session changed `backend/app/services/auth.py` (18:13) and
`backend/tests/test_auth.py` (18:12). The backend fingerprint at 18:28 was
`23ad9807f7e62c22` (see the header). The logs are in the lane scratch directory
`C:/Users/patel/AppData/Local/Temp/claude/.../scratchpad/company2/security-assurance/`,
outside the repository.

The first draft's figures are superseded. Its run 1 (17:51: 337 passed in 102.93 s, with
29 tests in `test_auth.py`) is kept as `pytest-security.log`. Its run-2 figure (62 passed
in 17.93 s) is **withdrawn**: the saved `run2.log` records an abort on the test-database
lock ("no tests ran"), not that result.

**Run 1** — 22 files, **340 passed, 0 failed, 0 skipped, 102.03 s** — `PROVEN_BY_TEST`
(`run1-rework.log`; per-file counts from `pytest --collect-only`, `collect-rework.txt`)

| File | Tests | File | Tests |
|---|---:|---|---:|
| test_auth.py | 32 | test_org_api.py | 11 |
| test_authorization.py | 27 | test_support_session.py | 1 |
| test_route_review_authorization.py | 29 | test_rls_boundary.py | 6 |
| test_rate_limit.py | 18 | test_config.py | 30 |
| test_trusted_proxy.py | 12 | test_db_target_guard.py | 16 |
| test_files_documents.py | 15 | test_disposable_guard.py | 9 |
| test_document_dates.py | 12 | test_audit.py | 15 |
| test_input_limits.py | 4 | test_gemini_ai.py | 11 |
| test_security_assessment.py | 14 | test_driver_self.py | 35 |
| test_scope_http_idor.py | 7 | test_test_account_hygiene.py | 10 |
| test_state_district_scope.py | 16 | test_login_workspace.py | 10 |

**Run 2** — `test_maplink.py` (13), `test_health.py` (9), `test_telemetry.py` (40):
**62 passed, 16.81 s** — `PROVEN_BY_TEST` (`run2-rework.log`)

**Total: 402 passed, 0 failed.**

**What the passes do not prove:**

- They say nothing about hosted, which runs `e4043ce` without the section-1b fixes.
- `test_rls_boundary.py` ran against the local cluster. Row-level security on hosted
  Supabase, which the public publishable key depends on, is `NOT_VERIFIED` in this lane.
- One passing test asserts a stale state: `TestTrustedProxyStillOpen` (C1-05).

**Run 3** — the section-7 reproduction tests, 5 tests, at 18:25 IST: **3 failed, 2 passed**
(`run3-rework.log`) — `PROVEN_BY_TEST`. Each test asserts the fixed behaviour, so it is red
until its finding is fixed. The three failures are NEW-01, NEW-02 and NEW-03, which are
still open. The two NEW-04 tests pass because the login query was fixed in the working
tree at 18:13. In the first draft's run (17:58, `run3.log`) all five failed.

---

## 4. Mobile (OWASP MASVS)

The MASVS control groups are `PROVEN_BY_WEB` from https://mas.owasp.org/MASVS/. That
page states no version number.

| Group | Finding | Status | Evidence |
|---|---|---|---|
| MASVS-STORAGE | The refresh token is kept in `expo-secure-store` with `WHEN_UNLOCKED` (`driver-app/src/auth/tokenStore.ts:43-45`); the access token stays in memory. The Supabase session uses chunked SecureStore (`src/api/supabaseClient.ts:82-179`). The GPS queue (`ner.gps.queue.v1`, `src/tracking/queueStore.ts:84`) and the offline trip package (`src/map/useRouteGeometry.ts:90`) are in plain AsyncStorage (NEW-09) | PARTIAL | `PROVEN_BY_SOURCE` |
| MASVS-STORAGE (backup) | The local prebuild manifest has `allowBackup="true"` with secure-store backup and data-extraction rules | PARTIAL | `PROVEN_BY_SOURCE` (`driver-app/android/app/src/main/AndroidManifest.xml`, untracked prebuild output). Values inside the release APK: `NOT_VERIFIED` |
| MASVS-CRYPTO | Not assessed. A grep of `driver-app/src`, `App.tsx` and `app.json` for crypto, encrypt, hash, HMAC, AES and random found no application-level cryptography. Key storage is delegated to `expo-secure-store` with `WHEN_UNLOCKED` (`src/auth/tokenStore.ts:43-45`, `src/api/supabaseClient.ts:119-130`). Two id generators fall back to `Math.random()` when `crypto.randomUUID` is missing (`src/screens/TripScreen.tsx:583-586`, `src/tracking/useLocationTracking.ts:162-170`). Those ids are retry keys, not secrets, and the server matches the stop-request key only within its own trip (`backend/app/services/driver_trips.py:801-809`); see NEW-19. How `expo-secure-store` protects its keys, and which runtime APIs the shipped build has, were not checked | NOT_VERIFIED | Grep result and cited lines: `PROVEN_BY_SOURCE`. Group status: `NOT_VERIFIED` |
| MASVS-NETWORK | Cleartext is refused by the plugin (`plugins/withDemoNetworkSecurity.js:18,25`), except one private IP when a build uses `http://` (the `lan-demo` profile). No certificate pinning | PARTIAL | `PROVEN_BY_SOURCE` |
| MASVS-PLATFORM (WebView) | `DriverRouteMap.native.tsx:188-199`: `originWhitelist={['*']}`, no `onShouldStartLoadWithRequest`. `onMessage` (`:114-122`) accepts only `ready/drag/tileerror/tileload/bounds/place` and grants no privileged action. Tooltips escaped with `esc()` (`:71`) (NEW-10) | PARTIAL | `PROVEN_BY_SOURCE` |
| MASVS-PLATFORM (components, deep links) | Only `MainActivity` is exported, as the launcher. `app.json` declares no `scheme`, so there are no custom deep links | COVERED (prebuild) | `PROVEN_BY_SOURCE` |
| MASVS-PRIVACY | Foreground location only: `isAndroidBackgroundLocationEnabled: false` (`app.json`). Among the 1.0.22 APK's `uses-permission` elements are `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `CAMERA`, `READ/WRITE_EXTERNAL_STORAGE` (`maxSdkVersion` 32), `USE_BIOMETRIC` and `USE_FINGERPRINT` (NEW-16; full list below the table). `android.permission.DUMP`, `BIND_JOB_SERVICE` and `c2dm.permission.SEND` appear only as `android:permission` guards on library components (`androidx.profileinstaller.ProfileInstallReceiver`, `JobInfoSchedulerService`, `FirebaseInstanceIdReceiver`). The app does not request them | PARTIAL | `PROVEN_BY_RUNTIME`: a standard-library parser of the binary `AndroidManifest.xml` in `.runtime/rasta-driver-1.0.22-local.apk` that reads elements and attributes, so requested permissions are kept apart from guard attributes (`axml_perms.py`, output `apk-1.0.22-permissions.txt`, lane scratch directory) |
| MASVS-CODE | `expo-updates` disabled in the manifest. `npm audit --omit=dev`: 10 moderate (section 5) | PARTIAL | `PROVEN_BY_RUNTIME` |
| MASVS-RESILIENCE | No root detection or attestation; GPS can be spoofed (known gap, `docs/SECURITY.md` §12) | GAP (accepted for the pilot) | `PROVEN_BY_SOURCE` |
| MASVS-AUTH | Server-side (section 2). The support-view token opens the web build read-only | COVERED server-side | `PROVEN_BY_TEST` (`test_support_session.py`) |

**Requested permissions of the 1.0.22 APK** (`uses-permission` elements, `PROVEN_BY_RUNTIME`
as above): `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `INTERNET`,
`READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` (both `maxSdkVersion` 32),
`RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `VIBRATE`, `CAMERA`, `RECEIVE_BOOT_COMPLETED`,
`POST_NOTIFICATIONS`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `ACCESS_NETWORK_STATE`,
`WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE`, the app's own
`DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, the Play install-referrer permission, and 16
launcher-badge permissions (Samsung, HTC, Sony, Huawei, OPPO and others).

### `EXPO_PUBLIC_*` variables — names only

Anything named `EXPO_PUBLIC_*` is compiled into the JavaScript bundle inside the APK, and
anyone holding the APK can read it. Found by grep of `driver-app/src`, `App.tsx`,
`app.config.js`, `eas.json`, `scripts` and `.env` — `PROVEN_BY_SOURCE`.

| Variable | Where set | Public by design? | What it needs |
|---|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `eas.json` profiles, `render.yaml` | yes — a URL | nothing |
| `EXPO_PUBLIC_BACKEND` | `eas.json` | yes — a mode switch | nothing |
| `EXPO_PUBLIC_INTELLIGENCE_BASE_URL` | build env | yes — a URL | nothing |
| `EXPO_PUBLIC_SUPABASE_URL` | `eas.json` (tracked) | yes — the project address | nothing |
| `EXPO_PUBLIC_SUPABASE_PROJECT_REF` | `eas.json` (tracked) | yes — an identifier | nothing |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `eas.json` (tracked in git) | yes, as a publishable (anon) key | Provider-side containment is RLS on every table exposed through the Data API. Proven on the local cluster only (`test_rls_boundary.py`, 6 passed). **Hosted RLS: `NOT_VERIFIED`** |
| `EXPO_PUBLIC_MAPTILER_KEY` | `driver-app/.env` (git-ignored) | client key, but inlined into the tile URL (`src/map/scene.ts:65-70`) | Must be restricted in the MapTiler dashboard to the Android package and web origins. `scene.ts:44-47` says it is; **restriction state `NOT_VERIFIED`** |

No `EXPO_PUBLIC_*` variable carries a server secret — `PROVEN_BY_SOURCE` (the list above
is complete for the files searched).

---

## 5. Supply chain

| Item | Result | Evidence |
|---|---|---|
| Lockfiles | `manager-web/package-lock.json` and `driver-app/package-lock.json` are tracked. Python has `backend/requirements.txt` with 14 pinned direct dependencies, no hashes, and no lock for transitive dependencies | `PROVEN_BY_SOURCE` |
| `npm audit --omit=dev` manager-web | **0** vulnerabilities (0 low, 0 moderate, 0 high, 0 critical); 41 production dependencies | `PROVEN_BY_RUNTIME` |
| `npm audit --omit=dev` driver-app | **10 moderate, 0 high, 0 critical**; 517 production dependencies. All trace to `uuid <11.1.1` (GHSA-w5hq-g745-h8pq) through `xcode` → `@expo/config-plugins` → `expo`. The suggested fix (`expo@46.0.21`) is a downgrade and is not usable. Same as SEC-009 | `PROVEN_BY_RUNTIME` |
| Python dependency audit | `pip-audit` is not installed in `backend/.venv`, and installing it is out of bounds for this lane | `NOT_VERIFIED` |
| SBOM | None in the repository (no CycloneDX or SPDX file) | `PROVEN_BY_SOURCE` |
| CI security gates | None. `.github/workflows/migrations.yml` is the only workflow | `PROVEN_BY_SOURCE` |
| Third-party code loaded at run time | Leaflet from unpkg, now SRI-pinned locally (C1-04). Tiles come from OpenStreetMap, OpenTopoMap and MapTiler | `PROVEN_BY_SOURCE` |

**Plan:** add a CI job that runs `npm audit --omit=dev --audit-level=high` for both apps,
runs `pip-audit -r backend/requirements.txt`, runs `scripts/secret_scan.py`, and runs the
section-3 test files. Generate a CycloneDX SBOM per release and archive it beside the APK
checksum. Move Python to a hashed lock (`pip-compile --generate-hashes` or equivalent).

---

## 6. Privacy

### PII inventory

`PROVEN_BY_SOURCE` from `backend/app/models/*.py`.

| Table | Personal data | Who can read it through the API |
|---|---|---|
| `users` | `email`, `phone` (the driver login), `display_name`, `last_seen_at`, `state_id`, `district_id` | self; managers through driver and presence views |
| `drivers` | `full_name`, `phone`, `emergency_contact_name`, `emergency_contact_phone`, `licence_number`, `licence_class`, `licence_expiry`, `photo_url`, `base_salary_monthly`, `push_token` | self; every `driver:read` holder (scoped managers included — NEW-02); salary only with `driver:read_sensitive` |
| `driver_documents`, `truck_documents` | `doc_number` (masked on output), dates | owner; managers |
| `stored_files` | raw photo and PDF bytes (`data` BYTEA): faces, licences, truck plates | owner; every `driver:update` holder (`files.py:167-172`) |
| `gps_points`, `trip_events`, `trip_stops` | precise location history of a named driver | trip-scoped fleet readers; track reads capped at 1000 points (`api/trips.py:1817`) |
| `shipments` | `client_name`, `client_contact`, `pickup_address`, `destination_address` | scoped by `shipment_scope_clause` |
| `emergencies` | location and time of a driver's incident | every `emergency:read` holder, unscoped |
| `refresh_tokens` | `user_agent`, `ip_address` (the token itself is stored only as a SHA-256 digest) | none |
| `audit_logs` | `ip_address`, `before`/`after` JSON snapshots | `audit:read` |
| `notifications`, `driver_notifications` | message bodies naming trips and places | recipient |

### Log redaction status

| Stream | Status | Evidence |
|---|---|---|
| Startup settings | redacted by `safe_dump` | `PROVEN_BY_SOURCE` (`config.py:478-500`) |
| Blocked AI prompts | text removed locally; still live on hosted (C1-03) | `PROVEN_BY_TEST` |
| Outbound HTTP (httpx) | full request URLs logged at INFO. That includes the Gemini key (NEW-01) and route coordinates in weather and geocoding queries (`services/weather/open_meteo.py:97,158`, `services/geocoding.py:281`) | `PROVEN_BY_TEST` (key) |
| Support view | logs the manager id, the driver user id and the path (`deps.py:94`) | `PROVEN_BY_SOURCE` |
| Hosted log retention, access list and drains on Render | unknown | `NOT_VERIFIED` |

### Screenshot policy

None exists (NEW-17). Proposed rule: evidence images go through a masking step before
they are committed. A phone number keeps its last two digits only, like `XXXXXXXX12`.
Only images on an allowlist file may be tracked under `docs/`. Before any public push, the
C1-01 images are either replaced with masked copies or the demo driver's login identifier
is changed. **Deleting them from `HEAD` does not remove them from history or from any
clone** — `INFERRED` from how git works.

### Retention gaps

`docs/SECURITY.md` §10 sets retention periods: GPS 90 days, audit logs 2 years, a 30-day
grace before a deactivated driver is anonymised, and more. It says they are "enforced by
a scheduled job". A search of `backend/app`, `backend/scripts` and `backend/alembic` for
retention, purge or anonymise code found none (NEW-14) — `PROVEN_BY_SOURCE`. Also open:

- 19,860 deactivated fixture users on hosted, contained but not deleted
  (`docs/POST_DEMO_CHANGE_INVENTORY.md` §7 item 3) — `PROVEN_BY_SOURCE` (as reported there)
- driver photo and document bytes stay forever in `stored_files`
- no DPIA (`docs/SECURITY.md` §12)

---

## 7. New findings: detail and regression tests

The reproduction tests are pytest tests against the local app through its own test
client (`tests.conftest` `api` and `session` fixtures) and the isolated test database.
They sit **outside the repository**, at
`C:/Users/patel/AppData/Local/Temp/claude/.../scratchpad/company2/security-assurance/test_new_findings.py`.
They make no network call and fetch nothing: NEW-01 uses `httpx.MockTransport`. Each
asserts the **fixed** behaviour, so it is red until its finding is fixed. At 18:25 IST the
NEW-01, NEW-02 and NEW-03 tests were red and the two NEW-04 tests were green (section 3).
To adopt one, copy it into `backend/tests/` with the fix.

**NEW-01 — Gemini API key in the log (P1, hosted and local).**
`backend/app/services/gemini.py:323` builds `...:generateContent?key={key}`.
`backend/app/main.py:36-39` sets the root logger to INFO. httpx logs every request line at
INFO with the full URL (`httpx/_client.py:1740`). The test captured
`HTTP Request: POST https://generativelanguage.googleapis.com/.../gemini-flash-lite-latest:generateContent?key=<the key>`
— `PROVEN_BY_TEST` (with a fake key). Identical code at `e4043ce` — `PROVEN_BY_SOURCE`.
Whether hosted has `GEMINI_API_KEY` set and whether Render's logs hold it: `NOT_VERIFIED`
(this lane may not read hosted logs).
*Fix:* send the key as the `x-goog-api-key` header, and set
`logging.getLogger("httpx").setLevel(logging.WARNING)` in `main.py`. Then rotate the key,
treating every past log line as exposed.
*Test:* `test_gemini_api_key_never_reaches_the_log`.

**NEW-02 — Scoped managers are fleet-wide outside trips (P1, local only).**
`STATE_MANAGER` and `DISTRICT_MANAGER` inherit the whole `_MANAGER_PERMISSIONS` set
(`permissions.py:170-176`). Row scoping exists only for trips, shipments, the fleet map and
presence. `services/drivers.py:73-74` filters only `DRIVER`. `services/trucks.py:46`
likewise. `api/emergencies.py:24-48` is unscoped, as is `files.py:160-173`, which admits
any `driver:update` holder. A district manager in one Assam district, acting on a driver
whose account sits in a Meghalaya district, got: listed = true, `GET` 200,
`support-session` 200 (a 15-minute token that reads the driver's app), `deactivate` 200 —
`PROVEN_BY_TEST`. `presence.py:102-110` already scopes people by `users.state_id` and
`district_id`, so the data needed exists.
*Fix, smallest safe first:* until row scoping exists, remove `DRIVER_UPDATE`,
`DRIVER_DEACTIVATE`, `DRIVER_SUPPORT_VIEW`, the `TRUCK_*` writes, the `ASSIGNMENT_*`
writes and `EMERGENCY_RESOLVE` from the two scoped roles. Then add a
`driver_scope_clause` beside `trip_scope_clause`, with the same list-and-detail agreement
tests as `test_scope_http_idor.py`.
*Test:* `test_district_manager_cannot_touch_a_driver_outside_their_district`.

**NEW-03 — Password change is unthrottled (P2, local only).**
`backend/app/api/auth.py:280-316` verifies `current_password` with no limiter. Twelve
wrong guesses with one access token returned twelve 401s and no 429 — `PROVEN_BY_TEST`.
A stolen 15-minute token becomes an unlimited online guess at the password, and a correct
guess is a permanent takeover.
*Fix:* `_enforce(_login_id_limiter, f"pw:{user.id}")` before `verify_password`.
*Test:* `test_password_change_guessing_is_rate_limited`.

**NEW-04 — Login identifier is a LIKE pattern (P2; open on hosted, fixed locally and
uncommitted).**
Hosted `backend/app/services/auth.py:95` (`e4043ce`) matches
`User.email.ilike(normalised)` and reads the result with `scalar_one_or_none()` —
`PROVEN_BY_SOURCE`. The local tree had the same query at `:148` (as in tag
`snapshot/post-demo-2026-09-26`) until 18:13. Tested against that tree at 17:58
(`run3.log`) — `PROVEN_BY_TEST`:
- the address with its first character replaced by `_` signed in (200);
- `%%%` matched many accounts and `scalar_one_or_none()` raised. The response was
  **503 `DATABASE_UNAVAILABLE`**, not 401, which tells a caller whether a pattern matches
  more than one account.

That hosted answers the same way is `INFERRED` (same query; no hosted request was made).
The per-identifier limit (`api/auth.py:194`) is keyed on the literal string, so on hosted
every wildcard spelling of one address gets a fresh 10-attempt budget — `INFERRED` from
source.

At 18:13 another session changed the local query to
`func.lower(User.email) == normalised.lower()` (`services/auth.py:166`) and added
`tests/test_auth.py::TestLogin::test_email_wildcards_are_literal`. Both scratch tests now
get 401 and pass, and the new repository test passed in run 1 — `PROVEN_BY_TEST`
(`run3-rework.log`, `run1-rework.log`). The fix is not committed and not deployed.
*Remaining:* commit and deploy the login fix. Apply the same comparison to
`api/org.py:355`, which still uses `ILIKE` (NEW-04b) — `PROVEN_BY_SOURCE`.
*Tests:* `test_login_identifier_is_matched_literally`,
`test_a_wildcard_matching_many_accounts_is_an_ordinary_401`,
`tests/test_auth.py::TestLogin::test_email_wildcards_are_literal`.

**NEW-05 — No upload quota (P2).** `files.py:80-150` caps each file but not the count or
total per principal. Each `POST /api/files` can add 5 MB to the database —
`PROVEN_BY_SOURCE`. The hosted database size quota: `NOT_VERIFIED`.
*Test needed:* `test_upload_quota_per_driver` — N+1 uploads, and the last one gets 429.

**NEW-06 — Driver credentials (P2).** A manager sets `initial_password`
(`schemas/domain.py:47`, `services/drivers.py:138`). Drivers never get
`must_reset_password`; only manager accounts do (`org.py:392`). Minimum 8 characters
(`schemas/auth.py:12`) against ASVS 2.1.1's 12. No breached-password list —
`PROVEN_BY_SOURCE`.
*Test needed:* `test_new_driver_must_change_password`.

**NEW-07 — No MFA for managers (P2).** Already listed in `docs/SECURITY.md` §12. ASVS
4.3.1 requires it at L1 for administrative interfaces — `PROVEN_BY_WEB`.

**NEW-08 — Manager list cache in `localStorage` (P3).**
`manager-web/src/api/connectivity.ts:77-110` writes `ner:cache:*`, including
`drivers:100` (`pages/AssignmentsPage.tsx:22`), which carries phone numbers. It is
cleared on logout (`auth/AuthProvider.tsx:130,155,169`), but not when a tab is simply
closed — `PROVEN_BY_SOURCE`.
*Test needed:* vitest — after `clearCache()` and after session expiry, no `ner:cache:`
key remains, and the driver cache holds no `phone` field.

**NEW-09 — Unencrypted on-device trip data (P3).** See section 4.
*Test needed:* a vitest check that the queue store's adapter is the SecureStore-backed one.

**NEW-10 — WebView origin (P3).** See section 4.
*Fix:* `originWhitelist={['https://*']}` plus `onShouldStartLoadWithRequest` limited to
the inline `baseUrl`, and drop any message whose `nativeEvent.url` is not that base.

**NEW-11 — Forgeable audit IP (P3).** `deps.py:186-195` stores the left-most
`X-Forwarded-For`. The limiter already uses `client_address` (`rate_limit.py:158`).
*Fix:* call the same function for audit.

**NEW-12 — Unpaginated presence (P3).** `presence.py:89-110` has no limit; for unscoped
roles it returns every active user.

**NEW-13 — Sliding refresh expiry (P3).** `services/auth.py:83` sets a new
`REFRESH_TOKEN_EXPIRE_DAYS` (30, `config.py:108`) on every rotation, and `:294-296` keeps
the family. Add a family `created_at` and refuse
after an absolute cap.

**NEW-14 — Retention not implemented (P2).** See section 6.

**NEW-15 — No CI security gate (P2).** See section 5.

**NEW-16 — APK permissions (P3).** See section 4. Remove each requested permission that
no feature uses, or record why it is needed. This applies to `uses-permission` entries only.
The first draft also listed `DUMP`; that was wrong. `DUMP` is the guard on the
`androidx.profileinstaller` receiver, not a permission the app requests, so there is
nothing to remove.

**NEW-17 — No screenshot policy (P3).** See section 6.

**NEW-18 — API inventory drift (P3).** `create_app()` mounts 98 `/api` routes. These 13
paths are not in `docs/API_CONTRACTS.md`: `/api/auth/password`, `/api/dashboard`,
`/api/driver/me/trip/stop-request`, `/api/notifications`, `/api/notifications/read`,
`/api/org/districts`, `/api/org/managers`, `/api/org/managers/{manager_id}/deactivate`,
`/api/org/regions`, `/api/org/states`, `/api/places`, `/api/presence`,
`/api/presence/heartbeat` — `PROVEN_BY_RUNTIME`.

**NEW-19 — Stop-request id may not be a UUID (P3 until verified; local only).**
`driver-app/src/screens/TripScreen.tsx:583-586` returns `crypto.randomUUID()` when it
exists, and otherwise `` `${Date.now()}-${hex}` ``. The API declares
`request_id: uuid.UUID` (`backend/app/api/driver.py:403`), so it would reject the fallback
value — `PROVEN_BY_SOURCE`. The id is sent with the driver's mid-trip stop request, which
the source comment calls an emergency. Whether the shipped runtime lacks
`crypto.randomUUID`, so that the fallback runs, is `NOT_VERIFIED`. If it does run, the stop
request fails validation and does not reach a manager — `INFERRED`.
*Fix:* use the RFC 4122 fallback already in `useLocationTracking.ts:162-170`.
*Test needed:* with `globalThis.crypto` removed, `makeRequestId()` matches the UUID pattern.

---

## 8. Incident response and secret rotation (outline)

### Secrets (names only)

| Secret | Where it lives | Rotation effect |
|---|---|---|
| `SECRET_KEY` | Render (generated; `render.yaml:117`) | Every access token becomes invalid (at most 15 minutes of work lost). Refresh tokens are opaque database rows and **survive** the rotation, so after a compromise also revoke them in bulk (below) |
| `DATABASE_URL` | Render (`sync: false`) | Reset the database password in Supabase, update Render, redeploy |
| `MIGRATION_DATABASE_URL` | operator machine only | as above |
| `GEMINI_API_KEY` | Render | Rotate in Google AI Studio. **Required once NEW-01 is fixed** |
| `OPENROUTER_API_KEY` | Render | Rotate at OpenRouter |
| `GOOGLE_PLACES_API_KEY` | backend environment | Rotate in Google Cloud and restrict to the API |
| `EXPO_ACCESS_TOKEN` | backend environment (optional) | Rotate at Expo |
| Supabase service-role / secret key | Supabase dashboard only; must never reach a client | Rotate in Supabase |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` | clients (public by design) | Rotate only if RLS failed. That requires a new APK |
| `EXPO_PUBLIC_MAPTILER_KEY` | `driver-app/.env`, then the APK | Rotate and restrict in MapTiler, then rebuild the APK |
| Android signing keystore | build machine or EAS (location `NOT_VERIFIED`) | Losing it blocks updates; a leak allows impersonation of updates |
| Demo and team credentials | `.runtime/*.private.json`, `.runtime/pgpass.txt` (git-ignored, one machine) | Change each account's password; demo drivers' login identifiers per C1-01 |
| GitHub, Render and Supabase account sessions and tokens | owners' accounts | Revoke sessions, rotate personal tokens, review collaborators |

### Runbook outline

1. **Detect.** Signals: a `LOGIN_FAILED` burst in `audit_logs`; the "Refresh token reuse
   detected" WARNING (`services/auth.py:279-282`); a support-view read on a driver nobody
   asked about (`deps.py:94`); an unexpected Supabase advisor or billing alert; a public
   report.
2. **Triage (CISO, within 1 hour).** Assign P0–P3 with the scale above. Open a record like
   `docs/INCIDENT_2026-09-06_SHARED_DB_WRITE.md`: timeline, what is known, what is not.
3. **Contain.**
   - Deactivate the affected accounts. `is_active` is checked on every request
     (`deps.py:70`) and on refresh (`services/auth.py:291`).
   - Revoke sessions: per user with `revoke_all_for_user`. For all users there is **no
     tool today** — write one:
     `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'incident' WHERE revoked_at IS NULL`,
     run by an operator after a backup.
   - Rotate the affected secrets from the table above.
   - `DEMO_SIMULATION_ENABLED` and the feature flags in `render.yaml` can switch
     subsystems off.
4. **Preserve evidence.** Export Render logs for the window (retention `NOT_VERIFIED`).
   Take a Supabase backup before any repair (`scripts/backup_hosted_db.py` exists; the
   backup/PITR state is **NOT CONFIRMED** per `docs/MIGRATION_0013_DEPLOYMENT_PACKET.md`).
5. **Eradicate and recover.** Fix with a regression test that is red first. Deploy from
   the integration branch. Verify with read-only checks.
6. **Notify.** The product owner decides on notifying drivers and the problem-statement
   owner. Legal duties for personal-data breaches in India: `NOT_VERIFIED` in this lane
   (no source was fetched). Get them confirmed before a real pilot.
7. **Learn.** Root cause (SSDF RV.3). Add the regression test to CI. Update this register.

---

## 9. Release gate checklist

Each item names its owner. The integration order is `docs/POST_DEMO_CHANGE_INVENTORY.md`.

| # | Gate | Closes |
|---|---|---|
| 1 | Masked copies of the evidence images, or a changed demo login identifier, before any further public push | C1-01 |
| 2 | Gemini key moved to a header, httpx logging at WARNING, key rotated. Can ship alone onto `e4043ce` | NEW-01 |
| 3 | Scoped-role permissions cut back, or row scoping added, before plan commits 25–38 deploy | NEW-02 |
| 4 | Deploy plan commits 1–5 so SEC-001 to SEC-005 reach hosted; then `curl -sI` the three hosted URLs | 1b |
| 5 | Password-change limiter; commit and deploy the literal login match (fixed locally, uncommitted); literal match in `api/org.py:355` | NEW-03, NEW-04, NEW-04b |
| 6 | `ShipmentRead` constraints removed before plan commit 25 | C1-06 |
| 7 | Written acceptance or fix for each open P2 (NEW-05, NEW-06, NEW-07, NEW-14, NEW-15, C1-08) | P2 set |
| 8 | CI job running section-3's files plus the section-7 tests, `npm audit`, `pip-audit` and the secret scan on every release commit | NEW-15 |
| 9 | Hosted RLS check (`test_rls_boundary.py` pointed at a clone of hosted, never hosted itself) and MapTiler key restriction confirmed | section 4 |

Until gates 1–3 are closed, this plan's answer to "are there known P1 findings?" is
**yes, three**.
