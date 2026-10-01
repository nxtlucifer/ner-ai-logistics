# RATE LIMIT & ABUSE-PROTECTION AUDIT (P0-B)

**Reproduction lane, not the Antigravity auditor.** Every claim below is
labelled with how it was established:
`PROVEN_BY_TEST` / `PROVEN_BY_RUNTIME` / `PROVEN_BY_DATABASE` / `PROVEN_BY_SOURCE`
/ `NOT_REPRODUCED`. Read-only on all source; no repo code was changed.

- **Method:** the FastAPI app was imported and every route enumerated; then a
  fresh `uvicorn` was started per attack case on a throwaway Postgres 18 database
  (`repro_rate_limit_1`, migrated to head `0016`, dropped afterward). Every
  external provider (OSRM/Gemini/OpenRouter/Nominatim/weather/flood/RSS/Ollama)
  was pointed at one local fake HTTP server. No third-party network was touched,
  the stale API on `:8033`/`:8034` was left alone, and every process started here
  was killed.
- **Evidence:** `/.runtime/production/repro/rate-limit/` —
  `inventory.json` (working tree, 100 ops), `inventory_head.json` (committed
  `HEAD`, 86 ops), `endpoint_table.md`, `attack_results.json`,
  `attack_multi_results.json`, and the harness (`inventory.py`, `attack.py`,
  `attack_multi.py`, `fake_provider.py`, `serve.py`, `seed.py`, `classify.py`).

---

## 1. What is actually rate-limited

`PROVEN_BY_SOURCE` + `PROVEN_BY_RUNTIME`. Rate limiting is a per-route
dependency, never app-wide middleware (deliberate: see the docstring in
`backend/app/core/rate_limit.py` — a global limiter would throttle a truck
flushing an offline GPS backlog).

| Endpoint | Hard HTTP limit? | Limit | Algorithm | Key | 429 + Retry-After |
|---|---|---|---|---|---|
| `POST /api/auth/login` | **YES** | 20/IP **and** 10/identifier per 60 s | fixed-window | `client_address` (peer, or XFF-from-right w/ `TRUSTED_PROXY_HOPS`) + casefold(identifier) | yes |
| `POST /api/auth/refresh` | **YES** | 60/IP per 60 s | fixed-window | `client_address` | yes |
| `POST /api/ai/ask` | **soft only** | 10/min per driver | sliding-window (in-proc, `gemini.RateLimiter`) | `driver.id` | **no** — silently downgrades to the offline answer, HTTP 200 |

Everything else has **no HTTP rate limit**. Non-limiter resource bounds that do
exist (`PROVEN_BY_SOURCE`): upload cap 5 MB / profile-photo 512 KB
(`files.py`), GPS batch ≤ 500 fixes (`schemas/domain.py`), track read ≤ 1000
points (`telemetry.py`), Argon2 concurrency semaphore of 2 (`security.py`),
local inference semaphore of 1 (`inference.py`), Nominatim 1 req/s lock
(`geocoding.py`), `/api/org/regions` 300 s cache. These cap per-request cost or
one provider's pace; none throttle a caller's request *rate*.

## 2. Endpoint inventory (100 operations, working tree)

Class key: **A** auth-sensitive · **B** expensive external provider · **C**
write/mutation · **D** telemetry/high-frequency · **E** emergency/SOS · **F**
ordinary authenticated read · **G** public metadata.

Class counts (`PROVEN_BY_RUNTIME`, from `inventory.json`): **A 5 · B 15 · C 38 ·
D 14 · E 4 · F 21 · G 3 = 100 operations across 88 paths.** Committed `HEAD`
(`5b5e474`) has **86 operations / 75 paths**; the working tree adds 14
(org/managers, presence, dashboard, notifications, places, auth/password,
stop-request). Full per-row table with all columns:
`.runtime/production/repro/rate-limit/endpoint_table.md`.

### Class B — expensive external provider, ALL unprotected (`PROVEN_BY_SOURCE`)
`POST /api/trips/plan`, `POST /api/trips/{id}/routes/recalculate`,
`GET /api/trips/{id}/routes/{route_id}/risk`, `GET /api/trips/{id}/reroute`,
`GET /api/trips/{id}/routes/recommendation`, `POST /api/driver/me/trip/reroute`,
`GET /api/driver/me/trip/route-risk`, `GET /api/driver/me/trip/navigation`,
`GET /api/driver/me/trip/offline-package`, `GET /api/driver/me/trip/places`,
`GET /api/places`, `GET /api/geocoding/suggest`, `GET /api/geocoding/details`,
`POST /api/geocoding/resolve-link`, plus `POST /api/ai/ask` (soft gate only).
These reach OSRM / Gemini / OpenRouter / Nominatim / Open-Meteo. No caller-rate
throttle exists on any of them.

### Class D — telemetry/high-frequency, unprotected
`POST /api/driver/me/location` (GPS ingestion), `GET /api/fleet/active`,
`GET /api/presence`, `POST /api/presence/heartbeat`, `GET /api/dashboard`,
`GET /api/emergencies/active`, `GET /api/driver/me/trip`, `.../notices`, etc.
(GPS ingestion being un-limited is **intended** — see §5.)

### Class E — emergency/SOS, unprotected (intentional)
`POST /api/driver/me/trip/check-in` (NEED_HELP → SOS escalation),
`POST /api/driver/me/trip/stop-request`, `POST /api/emergencies/sweep`,
`POST /api/emergencies/{id}/resolve`.

### Public (no auth dependency)
`GET /health`, `GET /ready`, `POST /api/auth/login`, `POST /api/auth/refresh`,
`POST /api/auth/logout`, `GET /api/org/regions` (G — 300 s-cached names only).

## 3. Attack results (`PROVEN_BY_RUNTIME`; local API, scratch DB)

Login body sends a **wrong** 8-char password so an under-limit attempt returns
`401` and an over-limit one returns `429`. Full JSON in `attack_results.json`.

| Case | Setup | Result | Verdict |
|---|---|---|---|
| A same IP, same id ×25 | default | 10×401, **15×429**, Retry-After 59 | per-identifier 10 binds |
| B same IP, 25 distinct ids | default | 20×401, **5×429** | per-IP 20 binds |
| D NAT: 30 distinct users, 1 IP, 1 try each | default | 20×401, **10×429** | 21st+ real user locked out |
| E same id, 25 distinct IPs | hops=1 | 10×401, 15×429 | per-id binds regardless of IP |
| F forged XFF+X-Real-IP, hops=0 | default | 20×401, 5×429 | header ignored; forgery gains nothing |
| G forged **left** XFF, constant trusted right, hops=1 | hops=1 | 20×401, 5×429 | forging the client-controlled left entry does **not** reset the limit |
| G2 rotate trusted **right** entry, same id | hops=1 | 10×401, 15×429 | rotating the real client key varies IP, but per-id still binds |
| H IPv6 XFF client, same id | hops=1 | 10×401, 5×429 | IPv6 accepted as key |
| H2 malformed chain (blanks/commas) | hops=1 | 10×401, 2×429 | blanks stripped, index does not wrap |
| C **window-boundary 2×** | 4 s window | 20 pass, 21st=429 (Retry 3), then **20 more pass after the edge** | fixed-window 2× **confirmed** |
| I restart | kill+restart | pre: 10×401/5×429; first after restart = **401** | in-memory state cleared on restart |
| J 2 procs, same id | no MULTI_INSTANCE | **10 pass per process = 20 total** | budget is process-local |
| J 4 procs, same id | no MULTI_INSTANCE | **10 pass per process = 40 total** | budget is process-local |
| MULTI 2 procs, same id, shared DB | **MULTI_INSTANCE=true** | **10 pass total** (not 20); `rate_limit_windows` id-key=20, ip-key=24 hits | 0015 table shares the budget |

## 4. Antigravity claims — reproduced or refuted

| Antigravity claim | Verdict | Evidence |
|---|---|---|
| "2 protected, 54 unprotected" (of "56") | **PARTIAL / directionally true, counts wrong** | `PROVEN_BY_RUNTIME`: **exactly 2** endpoints carry the hard limiter (login, refresh); `/api/ai/ask` has a soft gate. The API is **86 ops (HEAD) / 100 ops (working tree)**, not 56 — so "54 unprotected" understates it (84 unprotected in HEAD, 97 in the working tree). The "2 protected" figure is correct. |
| "process-local unless multi-instance" | **PROVEN_BY_RUNTIME + PROVEN_BY_DATABASE** | J: 2 procs → 20, 4 procs → 40 for one identifier. MULTI_INSTANCE: 2 procs → 10 total, shared via `rate_limit_windows` (migration 0015). Restart (case I) clears the window. |
| Window-boundary 2× bursting | **PROVEN_BY_RUNTIME** | Case C: 40 accepted across one window edge; fixed-window is window-length independent. Already documented as an accepted trade-off in `rate_limit.py`. |
| `TRUSTED_PROXY_HOPS=0` default → global NAT lockout behind a proxy | **PROVEN_BY_SOURCE (code default) + already mitigated in deploy** | `config.py` default is `0`, but `render.yaml` sets `TRUSTED_PROXY_HOPS=1` (`PROVEN_BY_SOURCE`). At hops=0 (case F) every caller shares the peer IP — behind a real proxy that peer is the proxy, so one shared per-IP bucket **is** real if the deploy var is ever missing. The code reads XFF **from the right** (case G), so it is not spoofable once hops is set. `docs/INDIA_HOSTING_DECISION.md` flags Cloud Run's hop count as `NOT_VERIFIED`. |
| Expensive endpoints unprotected: route planning, AI, geocoding, uploads, GPS, notifications, SOS, public | **PROVEN_BY_SOURCE** for all that exist (§2 classes B/D/E) | route plan/recalculate, ai/ask (soft only), geocoding suggest/details/resolve-link, uploads (`POST /api/files`), GPS (`/api/driver/me/location`), notifications, SOS check-in/stop-request, and public `/health` `/ready` `/api/org/regions` all lack a caller-rate limit. |
| "exports/reports" unprotected endpoint | **NOT_REPRODUCED** | There is no server-side CSV/export/report route. The manager CSV export is client-side (`manager-web/src/pages/tripExport.ts`); nothing to rate-limit at the API. |
| Multi-worker (`--workers N`) multiplies the budget N× | **PARTIAL / re-demonstrated differently** | The mechanism (unshared in-memory state per process) is `PROVEN_BY_RUNTIME` via the J cases. `uvicorn --workers N` was **not** used on Windows because worker subprocesses miss the selector-event-loop fix (`run.py`) and every DB call fails there — N independent single-worker processes prove the identical "process-local" property. |
| Identifier-key evasion via Unicode (PRODUCTION_READINESS §5.4) | **NOT_REPRODUCED (not tested this lane)** | login casefolds+strips the identifier for the key (`auth.py`); full NFKC normalization is not applied. No PoC attempted; flagged for the fix lane. |

## 5. Design context the audit omitted

- **GPS being un-limited is intended.** A reconnecting truck flushes a backlog
  of hundreds of fixes; the batch cap is 500 fixes/request and idempotency is by
  `(trip_id, device_fix_id)`. A request-rate limit here would drop real
  telemetry. (`PROVEN_BY_SOURCE`, `telemetry.py`.)
- **The XFF-from-right reading is correct and tested** (`test_trusted_proxy.py`,
  10 tests). The residual risk is purely operational: the safe value lives in
  `render.yaml`, not in the code default, so a new deploy target that forgets it
  reverts to the shared-bucket behaviour (Cloud Run is explicitly `NOT_VERIFIED`).
- **MULTI_INSTANCE default is `false`** (`render.yaml`), single instance, so the
  in-memory limiter is exact today. The DB-backed shared window (0015) is proven
  to work but is dormant until scale-out.

## 6. What the fix lane should weigh (no code changed here)

1. **Class B (expensive provider) has no caller-rate limit** — highest-value
   gap. An authenticated user can drive OSRM/Gemini/Nominatim load and (Gemini)
   real API spend with a loop against `/api/trips/plan`, `/routes/recalculate`,
   `/geocoding/*`. `/api/ai/ask`'s soft gate protects Gemini quota but returns
   200 and still costs a DB read + fact assembly per call.
2. **Class A gaps:** `change-password` runs Argon2 (CPU/128 MiB) with no limit;
   `logout`/`me` unlimited. Low severity but cheap to close.
3. **Uploads** (`POST /api/files`) — 5 MB into Postgres `bytea` per call, no rate
   limit (SEC-005 storage concern is a separate lane).
4. **Fixed-window 2×** is real but an accepted trade-off for a coarse
   auth limit; only worth revisiting if a tighter bound is required.
5. **SOS/emergency (class E) must stay abuse-resistant WITHOUT blocking a real
   SOS** — any limit added here needs a per-driver, generous, never-hard-fail
   shape.
