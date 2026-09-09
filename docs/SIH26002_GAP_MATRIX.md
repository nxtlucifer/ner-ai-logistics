# SIH26002 Gap Matrix

**Problem statement:** SIH26002 — AI-Based Smart Logistics and Accessibility
Intelligence Platform for the North Eastern Region (MDoNER, Smart Automation).

**Prepared:** 2026-09-08. Every status below is from a command run in this
session or a file read in this session. Nothing is inherited from an earlier
report. Where a previous report's number was checked, the result is stated.

---

## 0. The finding that governs every row below

**There are two implementations of the manager and driver API contracts, and
the well-tested one is not the one that ships.**

| | Implementation | Tests | Ships to |
| --- | --- | --- | --- |
| A | FastAPI backend (`backend/app`) | **959 passed, 5 skipped, 0 failed** (verified this session) | `localhost:8000` only — **not hosted anywhere** |
| B | Supabase direct + Edge Functions (`supabaseManagerApi.ts`, `supabaseApi.ts`) | no equivalent suite | the production website and the APK |

`manager-web/.env.production` sets `VITE_BACKEND=supabase`, and
`manager-web/src/api/client.ts:1009` selects `supabaseManagerApi` on that flag.
`driver-app/eas.json` sets `EXPO_PUBLIC_BACKEND=supabase` for both the
`preview` and `production` profiles.

So the 959 passing backend tests certify code that **no shipped artifact
executes**. This is the single largest source of false confidence in the
project, and it is why the phase table below separates "works in dev" from
"works in the artifact a judge will touch".

Evidence that implementation B ships, taken from the built bundle
(`manager-web/dist/assets/index--1fmSP1o.js`, built this session):

```
is not yet migrated to Supabase
1.2 mm/h light rain
8.2 mm/h rain on corridor
explainable-route-recommendation-v2
```

---

## 1. Verified test baseline

Re-run from scratch this session. The previously reported numbers were **not**
inherited.

| Suite | Command | Result | Prior claim | Verdict |
| --- | --- | --- | --- | --- |
| Backend | `pytest -q` on isolated cluster `127.0.0.1:55432/ner_logistics_test` | **959 passed, 5 skipped, 0 failed** (140.36s) | 959 / 0 / 5 | **confirmed** |
| Manager | `vitest run` | **124 passed** (12 files) | 124 | **confirmed** |
| Driver | `vitest run` | **490 passed** (36 files) | ~490 | **confirmed** |
| Driver typecheck | `tsc --noEmit` | clean | — | confirmed |
| Manager typecheck | `tsc -b --noEmit` | clean | — | confirmed |
| Manager prod build | `npm run build` | succeeds, 608 ms | — | confirmed |

Two notes on how that baseline was obtained, because both affect whether it can
be reproduced:

- **The backend venv was broken.** `backend/.venv/pyvenv.cfg` pointed at
  `C:\Users\patel\...`, a different user account, so every `pytest` invocation
  failed with `No Python at ...`. Repaired by repointing `home`/`executable` at
  the local 3.11.9 (`.venv/` is git-ignored; original saved as
  `pyvenv.cfg.bak`). No tracked file was touched.
- **One driver run reported 4 failures and it was my fault, not the product's.**
  An earlier invocation with a non-existent `--reporter=basic` crashed and left
  a partial Vite transform cache; the next run consumed it and threw
  `ReferenceError: Cannot access 'voice' before initialization` at a stale line
  offset in `MapScreen.tsx`. Six subsequent consecutive runs are 490/490. Not a
  product defect — recorded so the transcript is not misread later.

The 5 skips are legitimate and named: 1 non-Windows event-loop test, 4
destructive migration tests gated behind `RUN_DESTRUCTIVE_MIGRATION_TESTS=1`.

### Database safety

The shared-Supabase write incident (`docs/INCIDENT_2026-09-06_SHARED_DB_WRITE.md`)
is **genuinely fixed**, and the fix is better than the incident required.
`backend/tests/db_target.py` installs a `do_connect` listener on SQLAlchemy's
`Engine` class with an exact-match allowlist of one target, so a wrong target is
never dialled rather than merely discouraged; `pytest_collection_modifyitems`
additionally refuses the run with one clear message. Cleanup is now id-scoped
via `factories.OWNED` instead of deleting by global prefix. `backend/.env` still
reads `DATABASE_PROVIDER=supabase`, which is now safe by construction rather
than by discipline.

---

## 2. Smart Logistics

"Dev" = FastAPI on the laptop. "Shipped" = the production website / the APK.

A stub only matters if something calls it. Every `NotMigratedError` below was
checked against its actual consumers in `pages/`, `components/` and `hooks/`,
because grepping for stubs alone overstates the damage — five of them are dead
code the UI never reaches.

| Capability | Shipped | Status | Evidence |
| --- | --- | --- | --- |
| **Trip planning** | **yes** | **IMPLEMENTED** | `TripsPage.tsx:125` calls `planTrip` → `supabase.rpc('plan_trip')`, one atomic server-side call |
| **Dispatch** | **yes** | **IMPLEMENTED** | `dispatchTrip` → `supabase.rpc('dispatch_trip')` |
| Fleet / trip read + map | yes | IMPLEMENTED | real PostgREST reads |
| Route selection | yes | IMPLEMENTED but **not atomic** — see §5 | `selectRoute` = 2 unguarded writes |
| Address search | degraded | **DEGRADED, HONESTLY** | `addressSuggestions`/`resolveAddress` throw, caught at `AddressPicker.tsx:248`, rendered as `PROVIDER_ERROR` with a working **"Choose on map"** alternative that yields the same coordinate |
| Trip cancel / close | **throws** | **BROKEN (shipped)** | `cancelTrip`, `closeTrip` — 1 live consumer each |
| Driver create / deactivate | **throws** | **BROKEN (shipped)** | `createDriver`, `deactivateDriver` — 1 live consumer each |
| Truck create / retire | **throws** | **BROKEN (shipped)** | `createTruck`, `retireTruck` — 1 live consumer each |
| Assignment end | **throws** | **BROKEN (shipped)** | `endAssignment` — 1 live consumer |
| Revoke authorization | **throws** | **BROKEN (shipped)** | `revokeReviewAuthorization` — 1 live consumer |
| Driver trip lifecycle (accept → start → arrive → complete stop → complete trip) | yes | IMPLEMENTED | all five backed by real Supabase objects |
| Driver assignment verification | yes | IMPLEMENTED | `verifyAssignment`, `startGate` |
| GPS upload | yes | IMPLEMENTED | `sendLocation` → real RPC |

**Dead stubs — no consumer, no impact:** `createTrip`, `createShipment`,
`listShipments`, `updateDriver`, `updateTruck`. `createTrip`/`createShipment`
were deliberately superseded by the atomic `plan_trip` RPC; `client.ts:857`
records why ("Calling createShipment then createTrip cannot be atomic across a
network"). They should be deleted, but they break nothing.

**Consequence:** the core planning path — plan a trip, dispatch it — **does
work** in the shipped website, and it works through an atomic RPC, which is the
right design. What is broken is the surrounding fleet administration: six
buttons a manager can press that will throw. The Phase 9 planner workflow
completes, because the one degraded step (address search) has a working
alternative that the UI names explicitly.

## 3. Accessibility Intelligence

This is the core SIH innovation and it is where the divergence does the most
damage.

### 3a. The engine itself (backend, dev path) — genuinely good

`backend/app/domain/route_risk.py` is a deterministic weighted rule with
published constants. It is **explicitly not** presented as ML, and the module
docstring says so and says why. Its central invariant is implemented correctly:

```python
else:
    # No usable reading. Say so rather than scoring the route as calm -
    # "no data" and "no rain" are opposite operational facts.
    codes.append(REASON_WEATHER_UNAVAILABLE)
```

`RouteRisk` carries `inputs` (factor → AVAILABLE/NOT_AVAILABLE), `unavailable`,
`reason_codes`, `observations_used` and `observations_stale` alongside `score`,
and `RouteRiskRead` returns all of them. The manager renders the gap
(`TripRouteReview.tsx:142`), and the reason-code catalogue carries the exact
semantic the problem statement needs:

> "Hazard data for this route is unavailable. This is not a clear route - it is
> an unchecked one."

| Factor | Status | Note |
| --- | --- | --- |
| Weather | IMPLEMENTED | real provider, freshness-aware, stale readings counted and never scored |
| Landslide | IMPLEMENTED | `domain/landslide.py`, `is_known` distinguishes exposure from current hazard |
| Fuel model | IMPLEMENTED | `domain/fuel_model.py`, availability-gated |
| Distance / duration exposure | IMPLEMENTED | separated from conditions via `condition_points` |
| Flood | **NOT IMPLEMENTED** | permanently in `UNAVAILABLE_FACTORS` |
| Road quality | **NOT IMPLEMENTED** | permanently in `UNAVAILABLE_FACTORS` |
| Truck restrictions | **NOT IMPLEMENTED** | permanently in `UNAVAILABLE_FACTORS` |
| Historical incidents | **NOT IMPLEMENTED** | permanently in `UNAVAILABLE_FACTORS` |
| Elevation / terrain | **NOT IMPLEMENTED** | permanently in `UNAVAILABLE_FACTORS` |
| Field reports | PARTIAL | `UNVERIFIED` state exists in the model |

Five of the eleven evidence factors the mission names are declared unavailable
rather than computed. That is **honest**, and it is the right way to ship an
incomplete engine — but it means "multi-factor accessibility intelligence" today
rests on weather + landslide + exposure, and the demo narration must say so.

### 3b. The engine as shipped — **fabricated**

`manager-web/src/api/supabaseManagerApi.ts:602-673`, the production
implementation of `routeRecommendation`, does not consult any provider. It
assigns risk from the route's *kind*:

```js
const score = isPrimary ? 14 : isFuel ? 38 : 68
```

and then reports invented evidence for it, including
`'1.2 mm/h light rain'`, `'Winds 15 km/h'`, `observations_used: 5`,
`observations_stale: 0`, and — most seriously —

```js
inputs: { weather: 'AVAILABLE', landslide: 'AVAILABLE', fuel_model: 'AVAILABLE', ... }
```

**It claims the weather and landslide datasets were consulted when nothing was
consulted.** `rerouteAssessment` is likewise a constant returning
`NO_ACTION` / `selected_risk_score: 14`.

This is a direct violation of the project's own stated invariants
(`UNKNOWN != SAFE`, `STALE != LIVE`, "provider failure must never become
risk = 0") and of the no-fake-telemetry rule. It is worse than a provider
failure scoring zero, because a zero is at least visibly absent — this
manufactures a plausible number *and* a provenance claim to back it up. All
four strings are present in the built bundle, so this is what a judge would see.

**Status: FIXED 2026-09-08.** The fixture is deleted, not demoted to a
fallback. Route risk now comes from the hosted intelligence plane, and when that
plane is unreachable or unconfigured every candidate returns `score: null`,
`band: 'UNASSESSED'`, `eligibility: 'NOT_ASSESSED'` and
`ACCESSIBILITY_ASSESSMENT_UNAVAILABLE`. All six fabricated strings are confirmed
absent from the rebuilt production bundle. See
[HOSTED_INTELLIGENCE_PLANE.md](HOSTED_INTELLIGENCE_PLANE.md) §3.

The deployment of that plane is **not** done — no hosting account or CLI is
available on this machine — so the honest UNASSESSED path is what ships today.
`backend/Dockerfile` and `backend/render.yaml` are ready; §5 of that document
records the exact blocker.

## 4. Resilience

| Capability | Shipped | Status | Evidence |
| --- | --- | --- | --- |
| Offline route package | hosted plane | **FIXED 2026-09-08** | `offlinePackage` → `GET /api/driver/me/trip/offline-package`; refuses rather than returning an empty package |
| Navigation package | hosted plane | **FIXED 2026-09-08** | `navigationPackage` → `GET /api/driver/me/trip/navigation` |
| Cached-package fallback | yes | IMPLEMENTED | `useRouteGeometry.ts:145-158` falls back to stored package, else honest error state |
| Stale-vs-live labelling | yes | IMPLEMENTED | `source: 'LIVE' | 'CACHED'`, `capturedAt` carried |
| Reroute-race safety | yes | IMPLEMENTED | `matches()` discards geometry whose route id changed mid-flight |
| GPS loss | yes | NEEDS TESTING | handled in code; not yet runtime-verified |
| Provider failure | partial | NEEDS TESTING | dev path honest; shipped path fabricates (§3b) |

The failure handling here is well written — a fresh APK does not crash when
`offlinePackage` throws, it falls back to cache and otherwise shows an error.
But on a **fresh install with no cache there is no route geometry at all**, so
the driver's primary screen has no corridor to draw. Navigation is not
functional in the shipped APK.

## 5. Operational intelligence

| Capability | Status | Note |
| --- | --- | --- |
| Explainable risk | IMPLEMENTED (dev) / **fabricated (shipped)** | reason codes + components + gaps; see §3 |
| Reason-code i18n | IMPLEMENTED | `i18n/reasonCodes.json`, backend sends codes not sentences — correct design for Hindi/Assamese without an LLM |
| Manager authorization | IMPLEMENTED (dev) | `revokeReviewAuthorization` throws in shipped path |
| Driver synchronisation | IMPLEMENTED | trip lifecycle + GPS are real on both paths |
| Incident evidence | PARTIAL | `UNVERIFIED` modelled; review flow not verified |
| Evidence-mode taxonomy | **PARTIAL** | `LIVE`, `UNAVAILABLE`, `UNVERIFIED` exist. `SOURCE_BACKED_SNAPSHOT`, `SIMULATED` and `FIXTURE` do not appear anywhere in the backend — so a simulated demo hazard event currently has **no vocabulary to label itself with**, which Phase 27 scene 14 requires |
| Route versioning | IMPLEMENTED | `route_revision` (not `route_version`) binds a navigation package to one corridor — `app/services/navigation.py`, `app/api/driver.py:641`. The client discards a package whose `route_id` no longer matches, so a reroute landing mid-request cannot draw a new line with old turns |

### Atomic route switch — a real correctness defect in the shipped path

Phase 15 requires the route switch to be one consistent state change. In
`supabaseManagerApi.ts` it is **several independent client-side writes with no
transaction and no rollback**:

```js
// selectRoute
await supabase.from('trip_routes').update({ state: 'SELECTED' }).eq('id', routeId)   // 1
await supabase.from('trips').update({ selected_route_id: routeId }).eq('id', tripId) // 2

// acceptReroute
await supabase.from('trips').update({ selected_route_id: toRouteId })...             // 1
await supabase.from('trip_routes').update({ state: 'SELECTED' }).eq('id', toRouteId) // 2
await supabase.from('trip_routes').update({ state: 'PROPOSED' }).eq('id', fromRouteId) // 3
```

Two concrete failure modes, both reachable on a dropped connection — which is
the *normal* condition this product is designed for:

- **`selectRoute` never demotes the previously selected route.** Nothing sets
  the old row out of `SELECTED`, so after two selections two `trip_routes` rows
  are both `SELECTED` for one trip. Any consumer that reads "the selected
  route" by state rather than by `trips.selected_route_id` can now pick either.
- **A failure between writes leaves the trip pointing at a route whose state
  disagrees.** In `acceptReroute`, a failure after write 1 leaves
  `selected_route_id = toRouteId` while `toRouteId` is still `PROPOSED` and
  `fromRouteId` is still `SELECTED` — the exact inconsistency the driver's
  atomic-switch requirement exists to prevent.

The project already knows the right shape here and uses it elsewhere:
`plan_trip` and `dispatch_trip` are server-side RPCs precisely so the operation
is atomic. Route selection and reroute acceptance should be `select_route` and
`accept_reroute` RPCs for the same reason. This is a small, well-scoped fix.

Note also `reviewAuthorization` returns `null` unconditionally in the shipped
path. That contradicts the policy the driver's own API file states in its
header — "a stub returning `null` is indistinguishable, on screen, from 'you
have no trip'". A missing authorization and "not migrated" must not render
identically.

---

## 6. Architecture truth (Phase 1 answers)

| Question | Answer | Basis |
| --- | --- | --- |
| `DRIVER_LAPTOP_REQUIRED` | **NO** | both EAS profiles set `EXPO_PUBLIC_BACKEND=supabase`; `scripts/check-release-config.mjs` **rejects the build** if `EXPO_PUBLIC_API_BASE_URL` is set, so a laptop fallback cannot ship |
| `AI_LAPTOP_REQUIRED` | **NO** | `supabase/functions/gemini-ai` holds `GEMINI_API_KEY` server-side |
| `MANAGER_PRODUCTION_LAPTOP_REQUIRED` | **YES, for anything that writes** | reads work against Supabase; `createTrip`, `createShipment`, `resolveAddress`, driver/truck CRUD all throw `NotMigratedError`, and only the laptop FastAPI implements them |

No hosted FastAPI deployment exists. `netlify.toml` and `vercel.json` publish
the static `dist/` only; a repository-wide search for a hosted backend origin
(`onrender.com`, `fly.dev`, `railway.app`, `run.app`, …) returns nothing.

The driver release gate deserves specific credit: refusing to *build* when a LAN
fallback is configured is the only control that actually prevents a
laptop-dependent APK, and it is the reason the driver answer above is "NO"
rather than "probably".

---

## 7. What this means for the demo

The judge story is **PREDICT → EXPLAIN → COMPARE → AUTHORIZE → NAVIGATE →
TRACK → ADAPT → DELIVER**. Against the shipped artifacts:

| Stage | Shipped verdict |
| --- | --- |
| PLAN | **works** — atomic `plan_trip` RPC; address search degrades to map-pick |
| PREDICT | **fabricated** — score derived from route kind, not evidence |
| EXPLAIN | **fabricated** — invented rain/wind figures and a false provenance claim |
| COMPARE | **fabricated** — constant deltas, `comparable: true` unconditionally |
| AUTHORIZE | partial — selection writes (non-atomically); revoke throws |
| NAVIGATE | **broken** — no geometry and no maneuvers on a fresh install |
| TRACK | **works** — GPS is real end to end |
| ADAPT | **fabricated** — `rerouteAssessment` returns a constant |
| DELIVER | **works** — driver lifecycle is real |

`DEMO_READY = NO`. The blocker is not polish and it is not breadth — it is
concentrated in exactly two places:

1. **Accessibility Intelligence is fabricated in the shipped website** (§3b).
   This is the SIH innovation itself, and it currently asserts a provenance it
   does not have.
2. **The APK cannot draw a route on a fresh install** (§4), because its only
   geometry source is a stubbed operation.

Everything else — planning, dispatch, lifecycle, GPS, authorization,
reason-code i18n, the risk engine itself — is real and, in the dev path,
carries 959 passing tests. The remediation is therefore narrower than the
symptom count suggests: **migrate route risk and the navigation/offline
packages onto the hosted path** (Edge Functions calling the same domain logic,
or a hosted FastAPI), and delete the fabricated fixture rather than leaving it
as a fallback.

The one thing that must not happen is shipping §3b as-is. A judge who asks
"where did 1.2 mm/h come from?" gets an answer the project cannot defend, and
the honesty that the rest of this codebase is unusually careful about is what
would be called into question.
