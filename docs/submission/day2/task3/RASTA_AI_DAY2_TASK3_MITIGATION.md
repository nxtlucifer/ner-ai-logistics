# Day 2 Task 3 — Vulnerability Mitigation, Bug Resolution & Security Hardening

**RASTA AI / NER-AI Logistics · SIH26002 · Team NER-AI LOGISTICS**

Companion to `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.md`.
Task 2 identified thirteen items. This document records what was done about each,
the evidence before and after, and the retest.

Compiled 20 September 2026.

---

## 1. Final vulnerability status

| ID | Finding | Severity | Task 2 status | **Task 3 status** |
|---|---|---|---|---|
| SEC-001 | No security headers on any API response | Low | FIXED (local) | **FIXED** — hosted pending deploy |
| SEC-002 | BOLA: a driver could read another driver's document metadata | Medium | FIXED | **FIXED** |
| SEC-003 | DRIVER role could list the whole truck register | Low | FIXED | **FIXED** |
| SEC-004 | `POST /api/files` buffered the whole body before the size check | Low | FIXED | **FIXED** |
| SEC-005 | Hosted static sites lacked framing/referrer/permissions headers | Low | FIXED (config) | **FIXED** — hosted pending deploy |
| SEC-006 | Login rate limiter keyed on the TCP peer, so one budget was shared by every client behind Render's proxy | Low | **OPEN** | **FIXED** — 12 new tests |
| SEC-007 | Swagger UI open when `APP_ENV=development` | Info | ACCEPTED | ACCEPTED — 404 on hosted, verified |
| SEC-008 | Leaflet loaded from a CDN into the driver's WebView with no Subresource Integrity | Info | **OPEN** | **FIXED** — 5 new tests |
| SEC-009 | Dependency advisories, build-time only | Info | OPEN | OPEN — 0 in either production dependency set |
| SEC-010…013 | Informational observations | Info | Recorded | Unchanged; SEC-013 remains mitigated by SEC-001 |

**Two findings were closed in this task. No finding was closed by weakening a test.**

Counts after the work: **P0 = 0, P1 = 0.** One informational item (SEC-009) stays open
because it concerns dev-only toolchain advisories with no production exposure.

---

## 2. SEC-006 — rate limiter counted every client as one client

**Category** API security / improper access control · **Severity** Low → closed
**Files** `backend/app/core/rate_limit.py`, `backend/app/api/auth.py`,
`backend/app/core/config.py`, `render.yaml`
**Tests** `backend/tests/test_trusted_proxy.py` — 12 cases

### Before

```python
def _peer(request: Request) -> str:
    return request.client.host if request.client else "unknown-peer"
```

`request.client.host` is the TCP peer. Render terminates TLS and forwards, so on the
hosted service that value is Render's proxy for **every** request. The per-address login
budget was therefore shared by the entire internet: one noisy client locked everyone out,
and on a quiet day a single attacker had the whole budget to themselves. The per-account
budget still applied, which is why the severity was Low rather than High.

### Why this stayed open through Task 2

Because the obvious fix is worse than the bug.

```python
# NOT the fix. This removes the control entirely.
return request.headers["x-forwarded-for"].split(",")[0]
```

`X-Forwarded-For` is client-controlled. Anyone may send a different value on every
request and receive a fresh budget each time — turning a shared limit into no limit.
Reading the **leftmost** entry, the usual way to "get the original client", reads exactly
the part an attacker writes. Task 2 recorded the finding as OPEN rather than shipping that.

### After

Trust the number of proxies that are really in front of the service, and read from the
right, because a conforming proxy *appends* the address it received from:

```python
def client_address(peer, forwarded_for, trusted_hops):
    if trusted_hops > 0 and forwarded_for:
        hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
        if hops:
            index = max(0, len(hops) - trusted_hops)
            return hops[index][:45]
    return peer or "unknown-peer"
```

- `TRUSTED_PROXY_HOPS` defaults to **0** — the header is ignored entirely, which is the
  safe default for any deployment that is not behind a proxy.
- `render.yaml` sets it to **1**, because Render adds exactly one hop.
- `max(0, …)` stops a short chain from indexing past the start and silently selecting the
  proxy again, which would quietly restore the original bug.

### Retest

| Scenario | Header sent by the caller | Key selected | Correct? |
|---|---|---|---|
| No proxy configured | `1.2.3.4` | the TCP peer | yes — header ignored |
| One proxy, honest client | `203.0.113.9` | `203.0.113.9` | yes |
| One proxy, **forged prefix** | `1.2.3.4, 203.0.113.9` | `203.0.113.9` | yes — forgery not read |
| One proxy, 20 forged entries | `1.2.3.4 ×20, 203.0.113.9` | `203.0.113.9` | yes |
| Two proxies, forged prefix | `1.2.3.4, 203.0.113.9, 10.1.1.1` | `203.0.113.9` | yes |
| Chain shorter than configured | `203.0.113.9`, hops=3 | `203.0.113.9` | yes — clamped, no wrap |
| Empty / whitespace header | `"  ,  "` | the TCP peer | yes |
| Over-long entry | 500 chars | truncated to 45 | yes |
| Two different clients | `198.51.100.1` / `.2` | two different keys | yes — the point of the fix |

`12 passed`. Existing auth and rate-limit suites re-run: `61 passed`.

---

## 3. SEC-008 — the driver's map loaded code with nothing checking it

**Category** Insecure dependency loading · **Severity** Informational → closed
**File** `driver-app/src/map/DriverRouteMap.native.tsx`
**Tests** `driver-app/src/map/subresourceIntegrity.test.ts` — 5 cases

### Before

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

A version pin is not integrity. It asks the CDN for a name and trusts it to answer
honestly. A compromised or substituted response would execute inside the WebView that
draws the route a driver is following on a mountain road.

### After

Both assets carry a `sha384` digest computed from the bytes actually served on
20 September 2026, plus `crossorigin="anonymous"` — **without which the browser silently
ignores `integrity` entirely**, leaving the attribute as decoration:

| Asset | Bytes | Digest |
|---|---:|---|
| `leaflet.js` | 147,552 | `sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH` |
| `leaflet.css` | 14,806 | `sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H` |

### Retest

The five cases check the mitigation and its two failure modes: that every external asset
has a digest, that each also sets `crossorigin` (or the digest is never enforced), that
versions stay exact so digests can be stable, and that a **refused** script still degrades
to the existing `tileerror` path rather than to a blank screen. `5 passed`.

---

## 4. Verification that the fixes did not break the application

Run after the final code change of the session.

| Suite | Result |
|---|---|
| Backend (`pytest`) | **1,386 passed, 5 skipped** |
| Manager Web (`vitest`) | **291 passed** |
| Driver App (`vitest`) | **662 passed** |
| Manager typecheck (`tsc -b`) | clean |
| Driver typecheck (`tsc`) | clean |
| Manager production build | success |
| Driver APK (release, arm64) | built — `1.0.20` |
| Security suites specifically | **124 passed** |
| Role/scope browser certification, 3 roles | PASS, 0 console errors |
| Responsive sweep, 3 roles × 7 widths × 4 pages | overflow 0, offscreen controls 0 |

---

## 5. Secrets scan

Working tree, tracked and untracked, excluding gitignored paths: **no new secret**.

The one JWT in the tree remains `driver-app/eas.json`'s Supabase **publishable
(`role=anon`)** key, which is designed to be shipped to clients and is gated by RLS. It is
recorded here as known and accepted, not as a leak. Demo credentials live only in
`.runtime/demo-credentials.private.json`, which is gitignored.

---

## 6. Residual risks, stated plainly

1. **Hosted still runs the pre-fix build.** SEC-001 and SEC-005 are fixed in the working
   tree; the hosted service and static sites will answer with the old headers until a
   deploy happens. Task 2 recorded those two rows as FINDING rather than PASS for exactly
   this reason, and that remains the honest status. SEC-006's `TRUSTED_PROXY_HOPS=1` is
   likewise configured but not deployed.
2. **SEC-009** — build-time dependency advisories (2 moderate dev-only in Manager Web,
   10 moderate in the Expo build toolchain). Zero in either production dependency set.
3. **No full `script-src` CSP** on the manager console. Adding one blind would risk
   blanking the map during a demo; it is a deliberate residual, not an oversight.
4. **19,860 deactivated test-fixture users remain in hosted Supabase** — see
   `docs/DATA_HYGIENE_AUDIT.md`. Inert, but removal is a destructive operation against
   shared data and needs a confirmed backup first. Not performed.
