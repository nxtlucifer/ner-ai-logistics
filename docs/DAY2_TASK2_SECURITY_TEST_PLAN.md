# Day 2 Task 2 — Security Test Plan (RASTA AI)

Authorised assessment of our own application only. Runtime tests run against a local
backend (`.runtime/start-sec-backend.sh`, port 8020) bound to an isolated PostgreSQL clone
`ner_logistics_sec` on the local test cluster (127.0.0.1:55432), created from the local demo
clone and dropped afterwards. Hosted checks are limited to non-destructive reads
(`HEAD`/`GET` of public pages, one login/logout to read cookie flags). No third-party service
is targeted, no volume or denial-of-service test is run, no production data is written.

Executed by `docs/submission/day2/task2/security_probe.py`; results in
`docs/submission/day2/task2/DAY2_TASK2_SECURITY_RESULTS.md` and `evidence/results.json`.

| ID | Area | Target | Technique | Expected secure behaviour | Risk if failed |
| --- | --- | --- | --- | --- | --- |
| SEC-SQLI-001 | SQL Injection | `POST /api/auth/login` | classic tautology / comment payloads in `identifier` and `password` | 401 for every payload, identical envelope, no DB error text | authentication bypass |
| SEC-SQLI-002 | SQL Injection | `GET /api/drivers?search=` | payloads in the ILIKE search | 200, literal match (0 rows), never 5xx | data exposure |
| SEC-SQLI-003 | SQL Injection | `GET /api/trucks?search=` | same | same | data exposure |
| SEC-SQLI-004 | SQL Injection | `GET /api/trips?search=` | same, incl. sub-select on client name | same | data exposure |
| SEC-SQLI-005 | SQL Injection | `GET /api/trips?cursor=` | raw and base64-wrapped SQL in the opaque cursor | 400 `INVALID_CURSOR` | ordering / filter tampering |
| SEC-SQLI-006 | SQL Injection | `GET /api/trips/{id}` | SQL in a UUID path parameter | 422 `VALIDATION_ERROR` | filter tampering |
| SEC-SQLI-007 | SQL Injection | `GET /api/trips?status=` | SQL in an enum filter | 422 | filter tampering |
| SEC-SQLI-008 | SQL Injection | code review | grep for `text(`, f-string SQL, dynamic ORDER BY | only constant `text()` in the health probe; all queries parameterised by SQLAlchemy | injection surface |
| SEC-XSS-001 | XSS | stored: driver name, truck, client name via API | `<img src=x onerror=alert(1)>` and `<svg onload>` stored through the API | stored verbatim, returned as a JSON string | stored XSS |
| SEC-XSS-002 | XSS | Manager Web Drivers / Trips pages | render the stored payloads in the browser | shown as text; no `img[onerror]` in the DOM, no dialog | stored XSS in the privileged console |
| SEC-XSS-003 | XSS | printable trip report (`tripExport.ts`) | payload through `reportHtml()` | HTML-escaped (`&lt;img`) | XSS in the export window |
| SEC-XSS-004 | XSS | driver WebView map tooltips | code review of `esc()` in `DriverRouteMap.native.tsx` | escaped before `bindTooltip` | XSS inside the driver map |
| SEC-XSS-005 | XSS | reflected: 404 / 422 error envelopes | payload in path and query | JSON, `Content-Type: application/json`, no reflection as HTML | reflected XSS |
| SEC-XSS-006 | XSS | code review | `dangerouslySetInnerHTML`, `innerHTML`, `document.write` | only the escaped report writer | DOM XSS |
| SEC-CFG-001 | Misconfiguration | hosted API `/docs`, `/openapi.json`, `/redoc` | GET | 404 in production (development only) | API reconnaissance |
| SEC-CFG-002 | Misconfiguration | `render.yaml`, `Settings` | review | `APP_ENV=production`, `DEBUG=false`, placeholder `SECRET_KEY` refused outside development | debug mode / weak key |
| SEC-CFG-003 | Misconfiguration | CORS | preflight from an unknown origin and from an allowed one | no `Access-Control-Allow-Origin` for the unknown origin, exact match for the allowed one, never `*` with credentials | cross-origin credential use |
| SEC-CFG-004 | Misconfiguration | repository | `git ls-files` for `.env`, `scripts/secret_scan.py` plus a tracked-file pattern scan | no `.env`, no keys, no DSN with password | secret leak |
| SEC-CFG-005 | Misconfiguration | error handling | DB error, malformed JSON | generic envelopes (503/422), stack trace only in the server log | information leak |
| SEC-CFG-006 | Misconfiguration | `/ready` | GET | reports the provider enum only, never a host or DSN | information leak |
| SEC-CFG-007 | Misconfiguration | frontend bundle (`manager-web/dist`) | build and grep for key patterns | no service-role key, no `sk-`, no `AIza`; only intended public config | secret in bundle |
| SEC-CFG-008 | Misconfiguration | Supabase RLS | existing suite `tests/test_rls_boundary.py` | RLS on every application table; no permissive policy | Data API exposure |
| SEC-CFG-009 | Misconfiguration | response `Server` header | GET | no version string beyond the product name | fingerprinting (informational) |
| SEC-UP-001 | File upload | `POST /api/files` | valid PNG / JPEG / PDF as driver | 201, type from magic bytes | — |
| SEC-UP-002 | File upload | `POST /api/files` | text, HTML, SVG, empty body | 415 `UNSUPPORTED_FILE_TYPE` | active content served |
| SEC-UP-003 | File upload | `POST /api/files` | PDF as `PROFILE_PHOTO` | 415 | wrong type in an image slot |
| SEC-UP-004 | File upload | `POST /api/files` | 5 MB + 1 body; 600 KB profile photo | 413 | storage / memory abuse |
| SEC-UP-005 | File upload | `POST /api/files` | JPEG polyglot with `<script>` inside | stored as `image/jpeg`; served with `nosniff` so it is never interpreted as HTML | polyglot XSS |
| SEC-UP-006 | File upload | `POST /api/files?driver_id=<other>` | driver A tries to attach a photo to driver B | ignored for a driver (owner stays A) | cross-account write |
| SEC-UP-007 | File upload | `POST /api/files` | no token | 401 | anonymous upload |
| SEC-UP-008 | File upload | storage design | review | bytes in PostgreSQL by UUID; no filename, no filesystem path | path traversal |
| SEC-UP-009 | File upload | `GET /api/files/{id}` | read own / another driver's / manager | owner or fleet reader only; the other driver gets 404 | private photo exposure |
| SEC-HDR-001 | Headers | local + hosted API | GET | matrix: `X-Content-Type-Options`, `Referrer-Policy`, `Cache-Control: no-store` on `/api/*`, CSP `frame-ancestors 'none'`, HSTS (hosted) | clickjacking / sniffing / cached tokens |
| SEC-HDR-002 | Headers | hosted manager + driver web | HEAD | `X-Frame-Options`/`frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS | clickjacking |
| SEC-SESS-001 | Session | `POST /api/auth/login` (web) | inspect `Set-Cookie` | `HttpOnly`, `Path=/api/auth`, `SameSite`, `Secure` outside development; body carries no refresh token | token theft via XSS |
| SEC-SESS-002 | Session | `POST /api/auth/login` (mobile) | inspect body and headers | refresh token in the body, no cookie | — |
| SEC-SESS-003 | Session | `POST /api/auth/refresh` | rotate, then replay the old token | replay → 401 and the whole family is revoked (the new token is also dead) | stolen refresh token reuse |
| SEC-SESS-004 | Session | `POST /api/auth/logout` then refresh | logout, replay | 401 | session persists after logout |
| SEC-SESS-005 | Session | any protected route | malformed JWT, wrong signature, `alg=none`, expired, refresh-type token, tampered role | 401 for every case | forgery |
| SEC-SESS-006 | Session | deactivated account | deactivate a driver, then use its still-valid access token | 401 `Account is disabled.` | revocation lag |
| SEC-SESS-007 | Session | access token lifetime | `expires_at` − now | 15 minutes | long-lived bearer |
| SEC-SESS-008 | Session | manager support-view token | POST with the read-only token | 403 | escalation from a support token |
| SEC-API-001 | API security | every mounted route | request with no token | 401 (except `/health`, `/ready`) | anonymous access |
| SEC-API-002 | API security | manager endpoints | driver token | 403 | privilege escalation |
| SEC-API-003 | API security | driver-only endpoints | manager token | 403 | role confusion |
| SEC-API-004 | API security | `GET /api/files/{id}` | driver A reads driver B's photo | 404 | BOLA on private files |
| SEC-API-005 | API security | `GET /api/drivers/{B}/documents` | driver A | 403 | BOLA on documents |
| SEC-API-006 | API security | `GET /api/trips/{id}` | unknown UUID, non-UUID | 404 / 422 | — |
| SEC-API-007 | API security | `PATCH /api/drivers/{id}`, `POST /api/trips/plan` | mass assignment (`role`, `id`, `user_id`, `status`) | 422 (unknown field forbidden) | privilege / identifier control |
| SEC-API-008 | API security | method restrictions | `DELETE /api/drivers/{id}`, `PUT /api/trips` | 405 | unintended verbs |
| SEC-API-009 | API security | SSRF via `POST /api/geocoding/resolve-link` | loopback, link-local, look-alike hosts | 400 `NOT_A_MAPS_LINK`, nothing contacted | SSRF |
| SEC-API-010 | API security | driver trip execution | driver acts on a stop that is not on their trip | 404/409 | cross-trip action |
| SEC-XS-001 | Excessive access | pagination | `limit=0`, `-1`, `999999`, `abc` | 422; `limit=100` capped | table dump |
| SEC-XS-002 | Excessive access | `GET /api/trips/{id}/track?limit=` | 100000 | 422 | telemetry dump |
| SEC-XS-003 | Excessive access | data minimisation | `/api/auth/me`, `/api/drivers`, `/api/drivers/{id}/documents` | no `password_hash`; salary only for `driver:read_sensitive`; document numbers masked | over-exposure |
| SEC-XS-004 | Excessive access | enumeration | driver lists drivers / users | 403 | user enumeration |
| SEC-XS-005 | Excessive access | manager-only account surface | `POST /api/drivers` as driver | 403 | account creation |
| SEC-RL-001 | Rate limiting | `POST /api/auth/login` | 11 wrong passwords on one identifier | 11th → 429 with `Retry-After` | password guessing |
| SEC-RL-002 | Rate limiting | per-IP and window reset | unit tests `tests/test_rate_limit.py` (clock injected) | per-IP 20/min, reset after the window | password spraying |
| SEC-RL-003 | Rate limiting | GPS ingestion path | review | limiter is per-route, never global, so telemetry cannot be throttled by it | availability |
| SEC-REV-001 | Code review | backend | `eval`, `exec`, `shell=True`, `subprocess`, `pickle`, `yaml.load` | none | RCE |
| SEC-REV-002 | Code review | clients | `localStorage` tokens, hard-coded secrets | tokens in memory / secure store only | token theft |
| SEC-DEP-001 | Dependencies | `pip-audit` / `npm audit` | run if available | no known critical advisory | supply chain |
