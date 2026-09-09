# Cross-Client Contract Matrix

**Prepared:** 2026-09-08, from code read in this session. Scope is the **shipped**
transport for both clients — Supabase direct + Edge Functions — because that is
what the production website and the APK execute. The laptop FastAPI path is a
different implementation with different gaps; see
[SIH26002_GAP_MATRIX.md](SIH26002_GAP_MATRIX.md) §0.

Manager and Driver do **not** have the same controls, and should not. They have
different authority. What they must share is the same backend truth.

## Role authority

| Manager may | Driver may |
| --- | --- |
| plan, select route, authorize, dispatch, inspect, monitor | verify assignment, accept, start, arrive, complete stop, complete trip, send GPS, report incident |

The driver must **not** select the manager-approved route, override a closure,
change truck assignment or destination, or approve a risk recommendation. This
is enforced by which operations exist in `driver-app/src/api/supabaseApi.ts` —
the driver client has no route-selection or assignment-mutation call to make —
and by RLS. The absence of the capability, rather than a disabled button, is
the right enforcement.

## Field matrix

`W` = writes, `R` = reads, `—` = no access.

| Field | Authoritative source | Mgr | Drv | Sync status |
| --- | --- | --- | --- | --- |
| `trip_id` | `trips.id` | R | R | **OK** |
| `trip_status` | `trips.status` | R/W (dispatch) | R/W (lifecycle) | **OK** — disjoint transitions, no contention |
| `driver_id` | `trips.driver_id` | R/W | R | **OK** |
| `truck_id` | `trips.truck_id` | R/W | R | **OK** |
| `assignment_id` | `trips.assignment_id` | R/W | R (verify) | **OK** |
| cargo / `total_weight_kg` | `shipments` | R/W via `plan_trip` | R | **OK** |
| origin / destination | `trips` + stops | R/W via `plan_trip` | R | **OK** |
| `selected_route_id` | `trips.selected_route_id` | R/**W** | R | **DEFECT — non-atomic**, see below |
| `trip_routes.state` | `trip_routes` | R/**W** | — | **DEFECT — can hold two `SELECTED` rows** |
| `route_revision` | `navigation` package | R | R | **OK** — binds package to corridor; client discards a mismatched package |
| route geometry | offline package (hosted plane) | R | R | **FIXED 2026-09-08** — served by the intelligence plane; falls back to the cached package for this same trip *and* route, else an honest error |
| maneuvers | navigation package (hosted plane) | R | R | **FIXED 2026-09-08** — no stale fallback by design; losing turns is a degradation, losing the corridor is not |
| stops / `stop_status` | `trip_stops` | R | R/W | **OK** |
| GPS fixes | `gps_points` | R | **W** | **OK** — `sendLocation` → RPC; the one field the driver owns |
| GPS freshness | derived from fix age | R | R | **NEEDS TESTING** — thresholds not yet confirmed centralised |
| accessibility / risk | `route_risk` engine (hosted plane) | R | R | **FIXED 2026-09-08** — fixture deleted; UNASSESSED when the plane is unreachable |
| weather state | provider (hosted plane) | R | R | **FIXED 2026-09-08** — no longer claimed AVAILABLE without a call |
| landslide state | `domain/landslide` (hosted plane) | R | R | **FIXED 2026-09-08** — same |
| delivery state | `trips` + stops | R | R/W | **OK** |

## The three defects, precisely

### 1. Manager and Driver do not see the same risk — because the Manager's is invented

This is the only row where the two clients would show *contradictory* truth, and
it is the most damaging one, because risk is the product.

`manager-web/src/api/supabaseManagerApi.ts:602-673` computes risk from the route
*kind*:

```js
const score = isPrimary ? 14 : isFuel ? 38 : 68
```

and reports fabricated supporting evidence — `'1.2 mm/h light rain'`,
`'Winds 15 km/h'`, `observations_used: 5` — together with

```js
inputs: { weather: 'AVAILABLE', landslide: 'AVAILABLE', ... }
```

which asserts that datasets were consulted when none were. The driver, reading
the same trip, gets whatever the real engine says (or an honest unavailable).
So the two clients can disagree, and the client that disagrees is the one the
judge is looking at.

This also breaks the project's own published invariant, `UNKNOWN != SAFE`. The
backend implements that invariant correctly and comments on why
(`route_risk.py`: *"'no data' and 'no rain' are opposite operational facts"*).
The shipped manager path overwrites that care with a fixture.

**Required:** delete the fixture. Serve risk from the real engine on the hosted
path, or return an honest `UNASSESSED` — which the manager UI already models
(`RouteRiskComparison.tsx`: `riskBand: … | 'UNASSESSED'`, `riskScore: number | null`).
An honest `UNASSESSED` is shippable today and is strictly better than a
confident lie.

### 2. Route switch is not atomic

`selectRoute` and `acceptReroute` issue two and three independent client-side
writes with no transaction. A failure between them leaves `selected_route_id`
disagreeing with `trip_routes.state`; `selectRoute` additionally never demotes
the previous route, so two rows can be `SELECTED` at once.

The driver reads `selected_route_id`, so a half-applied switch means the driver
follows one route while the manager's route list highlights another — the exact
divergence Phase 15 exists to prevent, on the flaky connectivity this product is
built for.

**Required:** `select_route` and `accept_reroute` server-side RPCs, matching the
`plan_trip` / `dispatch_trip` pattern the project already uses correctly.

### 3. The Driver has no corridor on a fresh install

`offlinePackage` (geometry, stops) and `navigationPackage` (maneuvers) both
throw `NotMigratedError` in the APK build. `CurrentTrip` deliberately excludes
geometry (`driver-app/src/api/client.ts:434`), so there is no second source.

The handling is honest — `useRouteGeometry` falls back to a stored package
scoped to the same trip *and* route, and otherwise renders an error rather than
an empty map pretending to be a clear road. But with no cache there is nothing
to fall back to, so the driver's primary screen has no route line and no turn
guidance.

**Required:** migrate both packages to the hosted path. Until then the APK
cannot demonstrate NAVIGATE.

## What is genuinely well built here

Worth stating because it is not obvious and it should not be broken while
fixing the above:

- **Reroute-race safety.** Both geometry and navigation hooks discard a response
  whose `route_id` no longer matches the current selection, with the reasoning
  written down: *"showing the old turns in the meantime is the one thing not to
  do."* Late responses from a superseded route cannot paint the map. This is the
  hard half of atomic rerouting and it is already correct on the client.
- **Codes, not sentences, cross the wire.** The backend emits stable reason
  codes and the client owns the wording (`i18n/reasonCodes.json`), so Hindi and
  Assamese need no LLM in the loop. A translated string computed server-side
  would be untranslatable by the time it reached the phone.
- **Stub policy.** `supabaseApi.ts` throws named errors instead of returning
  `[]`, on the stated grounds that an empty array is indistinguishable from "no
  trip". That policy is right; §1 and `reviewAuthorization` are where it is not
  being followed.
