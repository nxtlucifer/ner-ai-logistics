# RASTA AI — RATE LIMITING & BYPASS SECURITY AUDIT
**Auditor:** Antigravity Independent Review Organization  
**Target Repository:** `D:\Projects\ner-ai-logistics`  
**Date:** 29 September 2026  
**Scope:** Complete Endpoint Audit, Header Spoofing Attacks, Multi-Worker Analysis, and Bypass Vectors.  

---

## 1. EXECUTIVE RATE LIMITING ASSESSMENT

Rate limiting is declared as a per-route dependency rather than an application-wide middleware (`backend/app/core/rate_limit.py`). While this design prevents accidental throttling of GPS background telemetry streams, it has resulted in a **severe coverage deficit**:

- **Total API Endpoints Audited:** 56
- **Endpoints with Active Rate Limiting:** **2** (`POST /api/auth/login`, `POST /api/auth/refresh`)
- **Endpoints with ZERO Rate Limiting:** **54** (96.4% unprotected)
- **High / Critical Risk Unprotected Endpoints:** 8 (including `/api/trips/plan`, `/api/ai/ask`, `/api/files`, `/api/geocoding/search`)

---

## 2. ENDPOINT-BY-ENDPOINT PROTECTION AUDIT

| Endpoint | Method | Role / Auth | Limit | Window | Keying Strategy | Storage / Backend | Multi-Worker Safe? | Restart Safe? | 429 & Retry-After? | Tests | Bypass Vulnerability |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/auth/login` | POST | Public | 20 / IP, 10 / ID | 60 s | `peer_ip` / `sha256(identifier)` | In-memory dict (`rate_limit_windows` if MULTI_INSTANCE) | NO (default) / YES (MULTI_INSTANCE) | NO (cleared) / YES (DB) | YES (`Retry-After: N`) | `test_rate_limit.py` | Window-boundary 2x bursting; multi-worker budget multiplication |
| `/api/auth/refresh` | POST | Public/Cookie | 60 / IP | 60 s | `peer_ip` | In-memory dict | NO | NO | YES | `test_rate_limit.py` | NAT collision; worker multiplication |
| `/api/auth/logout` | POST | Authenticated | **NONE** | - | - | - | - | - | - | - | State thrashing |
| `/api/auth/change-password` | POST | Authenticated | **NONE** | - | - | - | - | - | - | - | CPU exhaustion via repeated Argon2id hashing |
| `/api/auth/me` | GET | Authenticated | **NONE** | - | - | - | - | - | - | - | DB query flood |
| `/api/trips/plan` | POST | `trip:create` | **NONE** | - | - | - | - | - | - | - | **CRITICAL DOS:** Calls external OSRM, Open-Meteo, DEM while holding DB connection pool |
| `/api/trips/{id}/routes/recalculate` | POST | `route:plan` | **NONE** | - | - | - | - | - | - | - | **CRITICAL DOS:** Holds PostgreSQL connection for 700–8,000 ms during OSRM call |
| `/api/ai/ask` & `/chat` | POST | Driver Role | **NONE** | - | - | Internal 10 RPM per-driver memory gate | NO | NO | NO (returns 429 JSON) | `test_gemini_ai.py` | **CRITICAL DOS:** Holds PostgreSQL connection for 1.2–12.0 s during LLM inference |
| `/api/files` | POST | Authenticated | **NONE** | - | - | - | - | - | - | - | **CRITICAL STORAGE DOS:** Uploads up to 5 MB into PostgreSQL `bytea` without rate limit |
| `/api/files/{id}` | GET | Owner/Manager | **NONE** | - | - | - | - | - | - | - | Bandwidth / memory exhaustion reading bytea |
| `/api/geocoding/search` | GET | `geocoding:search` | **NONE** | - | - | Internal 1s Nominatim lock only | NO | NO | NO | `test_warnings_geocoding_contract.py` | Google Places API billing exhaustion; Nominatim pool lock |
| `/api/driver/me/location` | POST | Driver Role | **NONE** | - | - | - | - | - | - | - | PostGIS GPS table bloat (500 fixes/batch) |
| `/api/driver/me/trip` | GET | Driver Role | **NONE** | - | - | - | - | - | - | - | High polling overhead (every 10 s per phone) |
| `/api/driver/me/route/reroute` | GET | Driver Role | **NONE** | - | - | - | - | - | - | - | Calls external OSRM highway engine |
| `/api/fleet/active` | GET | `fleet:location_read` | **NONE** | - | - | - | - | - | - | - | LATERAL join / DISTINCT ON scan polled every 10 s |
| `/api/presence` | GET | Manager Role | **NONE** | - | - | - | - | - | - | - | **PERFORMANCE COLLAPSE:** Sequential full table scan of 593,000+ GPS points |
| `/api/dashboard/kpis` | GET | Manager Role | **NONE** | - | - | - | - | - | - | - | Sequential full table scan of 593,000+ GPS points |
| `/api/emergencies/active` | GET | `emergency:read` | **NONE** | - | - | - | - | - | - | - | Polled every 10 s by dispatchers |
| `/ready` | GET | Public | **NONE** | - | - | - | - | - | - | - | Executes `SELECT version()` on database |
| `/health` | GET | Public | **NONE** | - | - | - | - | - | - | - | Unmetered ping |

---

## 3. ADVERSARIAL BYPASS VECTOR ANALYSIS

### Attack 1: Window-Boundary Bursting (2x Configured Limit)
`FixedWindowLimiter` tracks request counts within fixed discrete time windows (e.g. `[t0, t0 + 60s)`).
- **Attack Scenario:** Attacker fires 20 login attempts at `t0 + 59.9s`. All 20 are allowed.
- At `t0 + 60.0s`, the window expires and resets the counter to 0.
- Attacker fires 20 more login attempts at `t0 + 60.1s`. All 20 are allowed.
- **Outcome:** **40 brute-force attempts in 0.2 seconds** — double the configured 20/min threshold.
- **Remediation:** Replace fixed windows with a sliding window log or token bucket algorithm.

### Attack 2: Trusted Proxy Misconfiguration & Global NAT Lockout
`client_address()` in `backend/app/core/rate_limit.py`:
```python
if trusted_hops > 0 and forwarded_for:
    hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
    if hops:
        index = max(0, len(hops) - trusted_hops)
        return hops[index][:45]
return peer or "unknown-peer"
```
- In `backend/app/core/config.py:135`, `TRUSTED_PROXY_HOPS` defaults to **`0`**.
- When deployed behind Render, Cloudflare, or AWS ALB, the peer IP seen by FastAPI is the reverse proxy's private IP (`10.x.x.x`).
- Because `trusted_hops == 0`, `X-Forwarded-For` is completely ignored.
- **Outcome:** **Every client on the public internet shares one single IP rate-limit bucket!** After 20 failed logins from any user anywhere in the world within 60 seconds, ALL users globally are locked out with HTTP 429.

### Attack 3: Multi-Worker & Multi-Replica Budget Multiplication
When deployed with multiple uvicorn workers (e.g. `uvicorn --workers 4`) and `MULTI_INSTANCE=False` (the default setting):
- Each worker maintains its own local memory dictionary `_windows: dict[str, Window]`.
- An incoming request routed by the OS or load balancer to Worker 1 increments Worker 1's counter.
- Requests routed to Workers 2, 3, and 4 increment separate counters.
- **Outcome:** A 4-worker cluster allows **$4 \times 20 = 80$ login attempts per minute** from the same IP address.
- When container pods restart or auto-scale, all in-memory rate-limit counters are reset to zero.

### Attack 4: Unauthenticated Exhaustion of Downstream Services
Because `/api/trips/plan`, `/api/trips/{id}/routes/recalculate`, and `/api/ai/ask` lack route-level rate limits:
- An authenticated user (e.g. rogue driver or compromised manager account) can run a basic script firing 50 concurrent requests.
- Each request triggers an outbound HTTP call to OSRM (704 ms median) or Gemini AI (1,200 ms median).
- The single Uvicorn event loop holds open database connections while waiting for these HTTP calls.
- **Outcome:** The database connection pool (`pool_size=5, max_overflow=10`) is exhausted within 100 ms, causing immediate denial of service across all other API endpoints.

---

## 4. RECOMMENDATIONS & IMMEDIATE FIXES

1. **Implement Route-Level Rate Limiting on All Mutating Routes:**
   Apply `require_rate_limit(limit=N, window=60)` to:
   - `/api/trips/plan`: Max 5 per minute per manager.
   - `/api/trips/{id}/routes/recalculate`: Max 5 per minute per manager.
   - `/api/ai/ask`: Max 10 per minute per driver.
   - `/api/files`: Max 5 uploads per minute per user.
   - `/api/geocoding/search`: Max 20 searches per minute per manager.
2. **Enforce `TRUSTED_PROXY_HOPS=1` in Production Configuration:**
   Ensure production environments behind Render or reverse proxies explicitly set `TRUSTED_PROXY_HOPS=1`.
3. **Enable `MULTI_INSTANCE=True` with Redis or PostgreSQL Shared Windows:**
   Synchronize rate limit counters using the existing `rate_limit_windows` table in PostgreSQL or an in-memory Redis cluster.
4. **Transition to Sliding Window Rate Limiting:**
   Eliminate window-boundary doubling by tracking timestamps of recent hits.
