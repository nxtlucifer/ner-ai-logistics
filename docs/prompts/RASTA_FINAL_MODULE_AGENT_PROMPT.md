# PONYTAIL ULTRA — RASTA AI / NER-AI LOGISTICS (SIH26002) — FINAL MODULE BUILD

You are Claude Fable 5.1 running as a coding agent in `D:\Projects\ner-ai-logistics`
(branch `main`, HEAD `7c7410a` or later). START WORK NOW. Do not write a plan,
a summary, or an explanation before the first tool call. Inspect, then change,
then verify, then report — in that order, per work-order line.

Laziest correct solution wins: deletion over addition, reuse over new files,
one guard where all callers pass, one runnable check per non-trivial change.

--------------------------------------------------------------------------------
## 0. GROUND TRUTH — CERTIFIED, DO NOT REDO
--------------------------------------------------------------------------------

Read `docs/terrain/HANDOFF.md` §9–§12 first. These are PASS and stay PASS:

| Invariant | Where it lives |
|---|---|
| Trip state machine + audit on every transition | `backend/app/domain/trip_state.py`, `backend/app/services/trips.py` |
| Location model: address + lat/lon + provenance, text ≠ location, edit drops pin, pin named by reverse lookup | `manager-web/src/components/AddressPicker.tsx`, `manager-web/src/pages/planValidation.ts` |
| Server region guard (NE bbox 21.5–29.5 N, 88–97.5 E) | `backend/app/schemas/domain.py` `in_service_region` |
| Provider answers validated against stops (`ROUTE_VALIDATION_FAILED`) | `backend/app/domain/routing.py` `endpoint_mismatch` |
| 3 options requested, every DISTINCT extra stored as EMERGENCY_BACKUP, none fabricated | `backend/app/services/routes.py` `MAX_ROUTE_OPTIONS` |
| Routeless-dispatch gate (`ROUTE_SELECTION_REQUIRED` / `ROUTE_INVALID` / `ROUTE_REVIEW_REQUIRED`) | `trips.py` `_assert_dispatchable_route`, `tests/test_dispatch_route_gate.py` |
| Selection = eligibility + review authorisation spent in one transaction | `routes.py` `apply_selection`, `route_review.claim` |
| Reviewer least privilege (`AUTHORISED_REVIEWER`: trip:read, route:read, route:review_authorize only) | `backend/app/core/permissions.py`, `manager-web/src/auth/AuthProvider.tsx` |
| UNKNOWN ≠ SAFE everywhere; deterministic route policy; 0 production ML | `route_risk.py`, `intelligence_inventory.py` |
| Honest route cards (SELECTED/SELECTABLE/REVIEW REQUIRED/BLOCKED/NOT CHECKED/STALE) | `manager-web/src/components/RouteCandidateCards.tsx`, `FleetPage.tsx` |
| Driver perf: one GPS watcher, batched uploads, static/live map layers, stationary → 0 km/h | `driver-app/src/tracking/*`, `map/scene.ts`, `map/DriverRouteMap.web.tsx` |
| Offline package + turn-by-turn on manager-planned routes (`detailed=true`) | `backend/app/services/offline_package.py`, `driver-app/src/offline/packageStore.ts` |
| Hosted demo tooling | `.runtime/judge.sh reset|check`, `.runtime/demo.py`, `.runtime/rehearsal/*.mjs` |

Judge state at hand-over: `bash .runtime/judge.sh check` → READY. Keep it so.

--------------------------------------------------------------------------------
## 1. ABSOLUTE RULES (violating any one = stop and report)
--------------------------------------------------------------------------------

- Never print secrets. `.runtime/` is gitignored and holds credentials, keys,
  APKs, phone screenshots (real location). MapTiler key only via env.
- Git: commit + push to `main` only. No reset/clean/rebase/force-push/history edits.
- No fake claims, no fabricated routes, no simulated SMS, no Aadhaar, no OCR,
  no government/insurer verification claims, no "98%" without a validation run.
- UNKNOWN ≠ SAFE. A missing provider renders UNKNOWN/DEGRADED/FALLBACK, never CLEAR.
- No AI (Gemini/OpenRouter/FLYNN) decides physical safety. Advisory only; the
  deterministic policy and a human decide. Experimental ML is never deployed.
- Do not change passwords, DB schema (unless a work-order line says so), the
  Manager website's structure, auth/RBAC, or the routing architecture.
- Certify on the hosted site (`https://ner-manager.onrender.com`,
  `https://ner-driver-web.onrender.com`, API `https://ner-intelligence.onrender.com`).
  One browser owner: create `.runtime/manager-human-cert.lock`, kill only your own
  `cdp-profile-*` Chromium instances, remove the lock when done.
- Fleetbase is a UX REFERENCE ONLY (naming, information hierarchy). No code,
  schema, or dependency from it enters this repo.
- Never re-run the 20-minute human workflow for a cosmetic change. Targeted
  scripts first; the full flow only after every P1 is closed.

--------------------------------------------------------------------------------
## 2. TRIP STATE MACHINE — EXACT
--------------------------------------------------------------------------------

Current edges (`trip_state.py`, do not remove any):

```
DRAFT ─────────────┬──► ASSIGNED ──┬──► VERIFICATION_PENDING ──┬──► ASSIGNED
                   │               │                           └──► MANAGER_REVIEW ──► ASSIGNED
                   │               └──► ACTIVE ◄──────────────────────┐
                   │                      │  ▲                        │
                   │                      ▼  │                        │
                   │                   DELAYED ───► INCIDENT ─────────┘
                   │                      │            │
                   │                      ▼            │
                   │                  DELIVERED ──► CLOSED
                   └──► CANCELLED ◄── (from every non-terminal state)
```

Required behaviour, split at the PICKUP boundary (`trip_stops` sequence 0
`status == COMPLETED` = "loaded"):

```
                 BEFORE PICKUP                     AFTER PICKUP (cargo on truck)
Cancel      manager: allowed, reason optional     manager: reason REQUIRED (≥10 chars)
            driver: refuse/decline via app        + driver push "TRIP_CANCELLED" + event
                                                  + audit; 422 CANCEL_REASON_REQUIRED
                                                  driver: cannot cancel; SOS/incident only
Redirect    edit destination on the DRAFT          new DROPOFF via replan → assessment →
(dest.      (region guard applies)                 selection (+review auth if UNKNOWN)
change)                                            → reroute/accept with from_route_id;
                                                   NEVER an in-place stop coordinate edit
Silent      —                                      FORBIDDEN: every post-pickup cancel or
change                                             redirect writes a TripEvent + audit row
                                                   and reaches the driver's app
```

Work: read `trips.cancel` (signature already takes `reason`); add the
post-pickup reason gate and the driver notification (`notify.send`, event
`TRIP_CANCELLED`) — one guard in the service, not in each caller. Red tests:
cancel after pickup without reason → 422; with reason → CANCELLED + event +
notification row; before pickup without reason → allowed; driver cannot
cancel after pickup (existing driver endpoints unchanged).

--------------------------------------------------------------------------------
## 3. PICKUP-FIRST NAVIGATION
--------------------------------------------------------------------------------

Guidance targets the NEXT PENDING STOP, always the pickup first. `navigation.py`
and `driver-app/src/map/useNavigationPackage.ts` already project onto the
selected route; verify that `next_stop_sequence` drives the target and that
arrival at the pickup (geofence `geofence_radius_m`, default 200) marks the stop
COMPLETED before the destination leg is announced. Red test: a fix inside the
pickup geofence completes stop 0; guidance text then names the destination.
No auto-completion from time or distance alone.

--------------------------------------------------------------------------------
## 4. ROUTING — REAL OPTIONS ONLY
--------------------------------------------------------------------------------

```
plan(trip) ─► endpoints = stops[0], stops[-1] (region-validated at creation)
   │
   ▼
provider.route_options(limit=3, detailed=true when navigated)
   │  RoutingRejected → 422 NO_VIABLE_ROUTE      RoutingUnavailable → 503 ROUTING_UNAVAILABLE
   ▼
for each candidate: endpoint_mismatch(candidate, origin, destination)
   │  mismatch on PRIMARY → 422 ROUTE_VALIDATION_FAILED, nothing stored
   │  mismatch on extra   → dropped
   ▼
PRIMARY stored PROPOSED; extras kept only if is_distinct_corridor against
PRIMARY and every kept extra → EMERGENCY_BACKUP (cap at 2 — add the cap,
one line, one test)
   │
   ▼
candidates → recommendation (deterministic, explainable, margin 10 pts)
   │  UNKNOWN evidence → REQUIRES_REVIEW; active hazard → REJECTED
   ▼
selection (apply_selection) → dispatch gate → driver
```

Labels come from figures (CURRENT / RECOMMENDED / FASTEST / SHORTEST /
EMERGENCY BACKUP). Measured live: Guwahati→Shillong 1 road, Guwahati→Jorhat 1,
Guwahati→Itanagar 2. "1 distinct road route available" is the honest answer;
never pad to three.

--------------------------------------------------------------------------------
## 5. LOW CONNECTIVITY — 9 KM PREFETCH, NO SIGNAL-BAR ASSUMPTIONS
--------------------------------------------------------------------------------

```
tick (each fix, ≤1/5 s)
   │
   ├─► online? = age(last successful API round-trip) ≤ 60 s   ← NEVER navigator.onLine
   │                                                              NEVER signal bars
   ├─► ahead = route slice [progress, progress + 9 km]
   │
   ├─► if online and ahead not cached:
   │       prefetch tiles (z12–z15 along `ahead`, bounded to 9 km, ≤ N tiles/tick)
   │       prefetch maneuvers for `ahead` (already in the offline package — verify)
   │       refresh offline package if selected_route_id changed
   │
   └─► if offline:
           guidance from cached geometry + maneuvers (exists)
           telemetry queued (queueStore, exists) and flushed on next success
           UI: "Offline · guidance from saved route · last sync HH:MM" (words, not a bar)
           reroute requests: queued, sent on reconnect, "awaits manager" only after 2xx
```

Implement the 9 km tile prefetch in the driver web map (Leaflet) and native
map (WebView) behind the existing `useNavigationPackage`; cap cache size; no
new dependency. Red test: with `fetch` failing, guidance still advances on a
mocked fix stream; with `fetch` succeeding, tiles requested are within 9 km of
the current projection and never beyond.

SMS fallback: ONLY if an SMS provider is configured (`SMS_PROVIDER` +
credentials in env). None is today → the setting reads NOT_CONFIGURED in
Diagnostics and no SMS is ever "sent". Do not stub, do not simulate.

--------------------------------------------------------------------------------
## 6. FLYNN / GRU DECISION ENGINE — EXPERIMENTAL, SHADOW-ONLY
--------------------------------------------------------------------------------

Location: `backend/app/experimental/flynn/` (new package, flag
`FLYNN_SHADOW_ENABLED=false` default). It never writes trip, route or
selection state and never appears in the driver app.

```
DecisionFrame(t)
  inputs:  route_risk components, weather samples (age), landslide history,
           flood ratio, official warnings, fleet traffic, terrain, position age
  masks:   valid[i]  = value present and in range
           fresh[i]  = age ≤ freshness window per input
  ──────────────────────────────────────────────────────────────────────
  GRU cell (numpy, ≤ 64 hidden, weights loaded from file or zeros)
  ──────────────────────────────────────────────────────────────────────
  outputs: advisory { continue | caution | hold | reroute } + confidence
  ──────────────────────────────────────────────────────────────────────
  VETO LAYER (deterministic, runs LAST, cannot be disabled):
    any required input !valid or !fresh        → output = UNKNOWN, confidence 0
    policy says REJECTED (active hazard)        → output = HOLD (policy wins)
    policy says REQUIRES_REVIEW                 → output ≤ CAUTION, "review required"
    model disagrees with policy by > 1 band     → output = policy band, flag DISAGREEMENT
  ──────────────────────────────────────────────────────────────────────
  sink: shadow log row (trip_id, route_id, frame digest, policy band,
        model band, veto reason) — read by Diagnostics only
```

Inventory: add ("TRUE_LOCAL_ML_EXPERIMENTAL", path, "FLYNN GRU shadow — not
deployed") so the count reads 2, still 0 production. Tests: masks reject
stale/absent inputs; veto overrides a confident wrong model; the engine has no
import path into `trips`, `routes`, `reroute` (assert by grep in a test).
No training run, no accuracy number, no claim in docs beyond "shadow".

--------------------------------------------------------------------------------
## 7. DRIVER PERFORMANCE BUDGET (preserve, then prove)
--------------------------------------------------------------------------------

- Exactly one `watchPositionAsync` at a time (tracker XOR browse).
- No network call per fix; uploads batched by `FLUSH_TICK_MS`.
- Map: static layers redraw only on plan change; live layers per fix; no
  redraw on the 5 s clock (age quantised to 30 s).
- Stationary noisy GPS → 0 km/h (`speed.test.ts` stays green).
Add one budget test: 60 mocked fixes while stationary → ≤ 1 static redraw,
0 network calls, speed 0.

--------------------------------------------------------------------------------
## 8. CI, MIGRATIONS, PR SAFETY
--------------------------------------------------------------------------------

- Every new alembic revision has a real `downgrade()`; `.github/workflows/migrations.yml`
  runs upgrade → downgrade → upgrade on a throwaway PostGIS. Keep it green.
- Tests run ONLY against the isolated cluster: `source .runtime/use-isolated-db.sh`
  (start with `.runtime/pg/pgsql/bin/pg_ctl.exe -D .runtime/data -l .runtime/server.log -w start`).
  `tests/db_target.py` refuses anything else — never bypass it.
- Before every push: `manager-web` `npx tsc -b --noEmit && npx vitest run`,
  `driver-app` `npx tsc --noEmit && npx vitest run`, backend `pytest tests -q`,
  `git diff --cached | grep -iE "api_key|secret|password|token" → must be empty`.
- APK 1.0.18 is certified. Rebuild only if a driver-app change in this mission
  affects the phone (native map, tracking, navigation); then `npm run check:release`,
  EAS build, install, `phone_e2e.py`, update `release/*.sha256`.

--------------------------------------------------------------------------------
## 9. TEST MATRIX
--------------------------------------------------------------------------------

| Subsystem | Targeted | Checkpoint |
|---|---|---|
| State machine + cancel/redirect | `pytest tests/test_trip_state.py tests/test_trip_execution.py tests/test_dispatch_route_gate.py` + new cancel tests | full backend suite |
| Location/region | `npx vitest run src/pages/planValidation.test.ts src/components/AddressPicker.test.tsx`, `pytest tests/test_schemas.py` | — |
| Routing | `pytest tests/test_routing.py tests/test_route_api.py tests/test_route_recommendation*.py` | full |
| Low connectivity | `driver-app` vitest (new prefetch test), `pytest tests/test_offline_package.py` | — |
| Reviewer RBAC + dispatch gate | `pytest tests/test_authorization.py tests/test_route_review_authorization.py tests/test_dispatch_route_gate.py` | — |
| FLYNN shadow | `pytest tests/test_flynn_shadow.py` (new, no DB) | — |
| Driver perf | `driver-app` `speed.test.ts`, `scene.test.ts`, new budget test | — |
| Hosted browser | `MANAGER_URL=https://ner-manager.onrender.com node .runtime/rehearsal/manager_probe.mjs` (34/34), `node .runtime/rehearsal/map_pick_check.mjs`, `python .runtime/smoke_dispatch_gate.py` | `node .runtime/rehearsal/manager_human_cert_guidance.mjs` once, after all P1 closed |
| Android | `python .runtime/phone_e2e.py` only if the APK was rebuilt | — |
| Demo | `bash .runtime/judge.sh reset && bash .runtime/judge.sh check` → READY | after every hosted mutation |

--------------------------------------------------------------------------------
## 10. STRICT REPAIR LOOP
--------------------------------------------------------------------------------

```
        ┌──────────────────────────────────────────────────────┐
        │ INSPECT: read the code path end to end, print facts  │
        └──────────────────────┬───────────────────────────────┘
                               ▼
                 CLASSIFY: APP / BACKEND / DATA / AUTOMATION /
                           ENVIRONMENT / EXTERNAL_PROVIDER
                               │
                  not APP/BACKEND ──► fix the tool or record it, continue
                               │
                               ▼
                 RED TEST (fails now for the right reason)
                               ▼
                 SMALLEST FIX at the shared point all callers pass
                               ▼
                 TARGETED TESTS green ──► typecheck ──► commit ──► push
                               ▼
                 DEPLOY LIVE? (poll the served bundle / behaviour, ≤ 10 min)
                               ▼
                 REPEAT ONLY THE FAILED HUMAN ACTION on the hosted site
                               │
                    PASS ──► next work-order line
                    FAIL ──► back to INSPECT (max 3 rounds, then report P-level)
```

Rules: no full 20-minute flow for a small change; no fix without its red test;
no "fixed" without the hosted repeat; every hosted mutation ends with
`judge.sh reset && judge.sh check` READY.

--------------------------------------------------------------------------------
## 11. WORK ORDER — EXECUTE IN THIS ORDER, ONE COMMIT PER LINE
--------------------------------------------------------------------------------

1. `git log -1`, `judge.sh check`, read HANDOFF §12, print the current
   `trip_state.py` matrix and `trips.cancel`. Change nothing yet.
2. Cancel/redirect gate after pickup (§2): service guard + push + event; 4 tests.
3. Pickup-first navigation proof (§3): 1 test; fix only if it fails.
4. EMERGENCY_BACKUP cap = 2 (§4): one line + one test; recommendation cap stays 3.
5. Connectivity truth (§5): `online` from last round-trip age, not `navigator.onLine`;
   1 test.
6. 9 km tile/maneuver prefetch (§5): web map first, native second; 2 tests.
7. SMS: `SMS_PROVIDER` setting → Diagnostics row NOT_CONFIGURED; no send path.
8. FLYNN shadow package (§6): frame, masks, GRU cell, veto, shadow log, flag,
   inventory line; 4 tests; no wiring into decisions.
9. Driver budget test (§7).
10. CI: migrations workflow green on a no-op revision if one was added; secret grep.
11. Hosted targeted checks (§9 row "Hosted browser"), fix P0/P1 via §10.
12. One full `manager_human_cert_guidance.mjs` run; `judge.sh reset && check` READY.
13. HANDOFF §13 (facts only, with numbers), commit, push.

--------------------------------------------------------------------------------
## 12. FINAL REPORT — EXACT FIELDS
--------------------------------------------------------------------------------

```
HEAD = <sha>
PREVIOUS_CERTIFICATION_PRESERVED = YES / NO
TRIP_STATES_EXACT = YES / NO
POST_PICKUP_SILENT_CANCEL = IMPOSSIBLE / POSSIBLE
POST_PICKUP_REDIRECT_AUDITED = YES / NO
PICKUP_FIRST_NAVIGATION = PASS / FAIL
ROUTES = <primary> + <emergency, ≤2> on canonical corridor, FABRICATED = 0
REGION_GUARD = CLIENT + SERVER
DISPATCH_GATE = SERVER (codes)
REVIEWER_LEAST_PRIVILEGE = PASS
CONNECTIVITY_TRUTH = ROUND_TRIP_AGE (not bars)
PREFETCH_9KM = PASS / FAIL (web / native)
SMS_FALLBACK = NOT_CONFIGURED (no send path) / CONFIGURED
FLYNN_SHADOW = PRESENT, FLAG_OFF, WRITES_STATE = NO, VETO_TESTED = YES
DRIVER_BUDGET_TEST = PASS
MIGRATION_ROLLBACK_CI = GREEN
SECRETS_IN_DIFF = 0
BACKEND_TESTS / MANAGER_TESTS / DRIVER_TESTS = <n passed>
HOSTED_PROBE = 34/34 ; MAP_PICK = n/12 ; DISPATCH_SMOKE = PASS
HUMAN_REROUTE_WORKFLOW = n/22 (misses classified)
APK_REBUILT = YES(<version>, sha256) / NO (why)
JUDGE = READY
P0 = 0 ; P1 = 0 ; P2/P3 = <list>
FINAL_DEMO_READY = YES / NO
```

--------------------------------------------------------------------------------
## 13. STOP
--------------------------------------------------------------------------------

Stop when every line of §11 is done and §12 shows P0 = 0, P1 = 0, JUDGE =
READY, FINAL_DEMO_READY = YES — or when an absolute rule (§1) would be
violated, in which case report the exact line and stop. No summary before the
first tool call. Begin with work-order line 1 now.
