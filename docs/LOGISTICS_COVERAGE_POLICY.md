# Logistics coverage policy

Date: 30 September 2026. Lane: docs-policy (fix round 1). This document states the policy and what the code does about it. It changes no code. Evidence is in `.runtime/production/fix1/docs-policy/`.

Companion documents:
- `docs/NER_SERVICE_REGION_POLICY.md`: the location-by-location matrix.
- `docs/INTERNATIONAL_BORDER_LOGISTICS_SECURITY.md`: borders, cross-border routing and advisories.
- `docs/GEOSPATIAL_SOURCE_LEDGER.md`: where the geography comes from.
- `docs/PRODUCTION_DATA_BOUNDARY.md`: which rows are real.

Labels: PROVEN_BY_SOURCE, PROVEN_BY_TEST, PROVEN_BY_RUNTIME, PROVEN_BY_DATABASE, NOT_VERIFIED, INFERRED.

**The code is moving.** The fix-round lanes were editing `backend/app/services/trip_geography.py`, `shipments.py`, `trips.py` and `manager-web/src/api/supabaseManagerApi.ts` while this was written (file times 30 Sep 08:39-08:44). Code references here name functions, not line numbers. Anything marked "in flight" must be re-checked against that lane's evidence.

## 1. Owner decisions (binding, 29 Sep 2026)

| # | Decision |
|---|---|
| D1 | Logistics is **India-wide and NER-centred** |
| D2 | A point outside India is refused: **422 `OUTSIDE_SUPPORTED_COUNTRY`** |
| D3 | A trip with neither end in the North-East (`INDIA_EXTERNAL`) is refused: **422 `NOT_NER_CONNECTED`**. The flag `ALLOW_INDIA_EXTERNAL_TRIPS` stays off |
| D4 | **No outward border tolerance.** `BORDER_AMBIGUOUS` comes only from GPS accuracy |
| D5 | A domestic route must never cross an international boundary. Such a candidate is dropped with `ROUTE_CROSSES_COUNTRY_BOUNDARY`. If no candidate is left, the trip goes to `HOLD_AND_REVIEW` |
| D6 | No hard-coded hostile countries |
| D7 | The geography authority is the **Survey of India OVSF/1M/7**. It is not imported yet: the download needs a CAPTCHA the user must complete. `FIXTURE_*` synthetic geometry is used only in tests and scratch databases, and is never called production geography |
| D8 | Photo credits are shown through a small, accessible "Photo credits" control that opens the attribution dialog (not a geography item; listed for completeness) |

## 2. The coverage model

Two gates run in order, then one classification.

| Step | Question | Authority | Answer and code |
|---|---|---|---|
| 1. Country gate | Is each endpoint inside India? | PostGIS `ST_Covers(country_boundaries['IN'], point)` in `geo_classify.classify_point` | Yes: continue. No: 422 `OUTSIDE_SUPPORTED_COUNTRY` with `details.field`. No India outline loaded: **503 `GEOGRAPHY_UNAVAILABLE`**, which fails closed and never counts as "inside". A GPS fix whose accuracy circle reaches the boundary: 422 `BORDER_AMBIGUOUS` |
| 2. NER gate | Does the trip touch the North-East? | `states.is_ner` of the covering state polygon, through `geo_classify.require_ner_connected` | Proven INDIA_EXTERNAL: 422 `NOT_NER_CONNECTED`. Unknown membership is **not** refused (see G1) |
| 3. Classification | What kind of trip is it, and how deep is the intelligence? | `trip_scope_type`, `intelligence_coverage` | See the two tables below |

### Trip scope type (`geo_classify.TripScope`)

| Origin | Destination | Type | Allowed |
|---|---|---|---|
| NER | NER | `NER_INTERNAL` | Yes |
| NER | India, not NER | `NER_OUTBOUND` | Yes |
| India, not NER | NER | `NER_INBOUND` | Yes |
| India, not NER | India, not NER | `INDIA_EXTERNAL` | **No** (422 `NOT_NER_CONNECTED`) while `ALLOW_INDIA_EXTERNAL_TRIPS=False` |
| unknown on either end | | none | Yes (G1) |

### Intelligence coverage per point

| Value | When | What it means |
|---|---|---|
| `NER_DEEP` | Inside an NER state polygon | Full NER-first intelligence |
| `INDIA_BASELINE` | Inside India but not in an NER state | Baseline only. Never presented as NER-grade |
| `NONE` | Outside India | Nothing is offered |
| `UNKNOWN` | Ambiguous border point, or no state polygon covers the point | **UNKNOWN is never SAFE** |

### Management scope

Management scope is not the same thing as coverage. Every manager role lives inside the eight NER states. Non-NER state rows exist only so a point can be classified "India, not NER", and they grant nobody anything: see `scope.may_manage_user` and the state lists in `api/org.py` and `api/dashboard.py`. This is PROVEN_BY_TEST on fixture geometry: `TestNonNerStatesNeverWidenScope`, 5/5.

## 3. Error contract

| Code | HTTP | Raised by | Client copy exists |
|---|---|---|---|
| `OUTSIDE_SUPPORTED_COUNTRY` | 422, `details.field` ∈ pickup, destination, location | `geo_classify.require_in_india` | manager `components/ui.tsx` `GEOGRAPHY_ERRORS`; driver `components/ui.tsx` |
| `BORDER_AMBIGUOUS` | 422 | `require_in_india`, only when `accuracy_m` is passed. No API path passes it (FC-01) | driver `components/ui.tsx` |
| `NOT_NER_CONNECTED` | 422, `details.scope_type` | `geo_classify.require_ner_connected` | manager `ui.tsx` |
| `GEOGRAPHY_UNAVAILABLE` | 503, `retryable: true` | `classify_point` when there is no `IN` row | manager and driver `ui.tsx` |
| `ROUTE_CROSSES_COUNTRY_BOUNDARY` | policy D5 | **Not raised by any backend code as reproduced on 30 Sep** (C-21, NF-05). The manager copy was added on 30 Sep (in flight) | manager `ui.tsx` |
| `HOLD_AND_REVIEW` | policy D5 | Same as above | manager `ui.tsx` |

## 4. Where the policy is enforced (30 Sep 2026, working tree)

| Path | Country gate | NER gate | Route stays in India | Status |
|---|---|---|---|---|
| FastAPI shipment/trip planning (`shipments.create` → `trip_geography.locate`) | Yes | Yes | No | Implemented, and fails closed today: 0 SoI rows gives 503 on every plan (AX-21) |
| FastAPI mid-trip `NEW_DESTINATION` redirect (`trips.py`) | Yes | **No**. The code comment reads "leaving the NER is not refused" | No | Gap G2 |
| FastAPI mid-trip add-stop (`trips.py`) | Yes | Not applicable (the trip's ends do not change) | No | Implemented (country gate) |
| Route recalculation, alternatives, driver reroute (`routes.py`) | Endpoints only (`endpoint_mismatch`) | Not applicable | **No** | NOT_IMPLEMENTED (D5; C-21) |
| Supabase-target manager (`VITE_BACKEND=supabase`, `app.plan_trip` RPC) | None in the RPC (NF-04) | None | Browser OSRM plus a fabricated fallback (NF-06) | Fixed so far only in the client, in flight: the manager lane now sends planning to the FastAPI "plane" and writes nothing without it (`supabaseManagerApi.ts`, 30 Sep 08:39). The RPC itself is unchanged (`supabase/migrations/20260907120800_manager_plan_trip.sql`, last modified 8 Sep). It still has no geography check and keeps PUBLIC EXECUTE; it checks authorisation internally (AX-27). So a signed-in manager who calls it directly bypasses the client change, and **server-side enforcement on this path is still absent** |
| Deployed build `e4043ce` (hosted) | Old box 21.5-29.5 N × 88.0-97.5 E only | None | No | PROVEN_BY_SOURCE (`git show origin/main:backend/app/schemas/domain.py`). The box admits Dhaka, Sylhet and parts of Bhutan and Myanmar, and refuses Delhi, Mumbai and Ahmedabad (`docs/NER_SERVICE_REGION_POLICY.md` §3). Hosted runtime: NOT_VERIFIED |

## 5. Gaps and decisions

| ID | Gap | Evidence | Policy position | Owner of the fix |
|---|---|---|---|---|
| G1 | Unknown NER membership is accepted | `require_ner_connected(None, x)` returns None (PROVEN_BY_TEST, `test_india_external_is_refused_by_default_and_unknown_is_not`). The OSM fallback in `trip_geography` can only say "NER" or "unknown", never "not NER", so with no state polygons no trip is ever proven INDIA_EXTERNAL | Acceptable **only** while states and the India outline arrive together. The importer loads country, states and districts in one transaction (`import_soi_boundaries.py` docstring), so after a real import "unknown" happens only for a point in India that no state polygon covers (a sliver or gap in 1:1M data). A partial state (outline without states) is reachable only through the test fixture `fixture_india` or manual SQL. After import, the real-city matrix must show 0 unknowns | backend (post-import check) |
| G2 | A mid-trip redirect can turn a trip INDIA_EXTERNAL | `NEW_DESTINATION` checks the country only. For example, an NER_INBOUND Kolkata→Guwahati trip redirected to Delhi becomes Kolkata→Delhi | D3 applies to the trip as it will be driven. The redirect should re-run `require_ner_connected(origin, new destination)` and refuse with 422. Needs a red test and a fix | backend |
| G3 | `trip_scope_type` is computed and then dropped | Not on `TripRead`/`FleetTripRead`, not persisted, not shown (C-22) | Should be returned, so a manager can see `NER_OUTBOUND` versus `INBOUND` and `INDIA_BASELINE` coverage | backend + manager |
| G4 | `NORTH_EAST_MANAGER` is unscoped for trips | `scope.UNSCOPED_ROLES`, and the `ponytail:` note in `scope.py` | Safe **only** while D3 holds. Before `ALLOW_INDIA_EXTERNAL_TRIPS` is ever turned on, add a trip clause (AG-04) | backend (gate on the flag) |
| G5 | Address search offers places in neighbouring countries | `geocoding.NOMINATIM_COUNTRIES = "in,np,bt,bd,mm"`; the manager picker footer lists the same countries | Not a hostility list, the opposite: an inclusion list. But D2 means every non-`in` result is refused later with 422. Recommendation (product decision): search `in` only for planning, so the picker cannot offer a place the server will refuse. The server gate stays the authority either way | product owner → backend |
| G6 | Roadside places include facilities outside India | 121 name-marked foreign POIs in the bundled snapshot. A map box on the Meghalaya border returns 2 Bangladesh upazila health complexes and the Tamabil immigration office among 7 EMERGENCY results (PROVEN_BY_RUNTIME, in-process) | See `docs/PRODUCTION_DATA_BOUNDARY.md` L3 and `INTERNATIONAL_BORDER_LOGISTICS_SECURITY.md` §5 | backend (after SoI) |
| G7 | `BORDER_AMBIGUOUS` is unreachable from the API | FC-01: no caller passes `accuracy_m` | Correct for planner points, which have no accuracy. Wire it when GPS fixes are classified | backend (when used) |

## 6. What must be true before production coverage claims

1. The SoI OVSF/1M/7 import is done and hashed (`docs/GEOSPATIAL_SOURCE_LEDGER.md`), and the 22 `TestRealCities` tests pass instead of skipping.
2. The rows added in `NER_SERVICE_REGION_POLICY.md` §5 pass.
3. The route-crossing guard (D5) is implemented with a red→green test, and every route-producing path runs through it.
4. The Supabase path has server-side enforcement, or refuses planning outright (NF-04).
5. G2 is fixed.

Until then the correct public statement is: **coverage policy is defined and fails closed; production geography is NOT LOADED.**
