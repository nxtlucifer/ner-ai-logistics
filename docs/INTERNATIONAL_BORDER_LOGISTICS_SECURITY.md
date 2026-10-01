# International border: logistics security

Date: 30 September 2026. Lane: docs-policy (fix round 1). No code was changed. Official pages read for this document are listed in §2 and archived with SHA-256 hashes in `.runtime/production/fix1/docs-policy/sources/` (`FETCH_LOG.txt`, `SHA256SUMS.txt`).

Labels: PROVEN_BY_WEB (an official page read today), PROVEN_BY_SOURCE, PROVEN_BY_TEST, PROVEN_BY_RUNTIME, INFERRED, NOT_VERIFIED.

## 1. Verdict

```
NER_INTERNATIONAL_BORDERS_VERIFIED = YES at the level of "which state borders which country"
                                     (MHA Border Management-I page). Bangladesh lengths per state:
                                     YES (MHA answer, Lok Sabha USQ 1175, 11 Feb 2025). Per-state
                                     lengths for the Myanmar, Bhutan, China and Nepal borders:
                                     NOT VERIFIED (no MHA page read today gives them).
BORDER_GEOMETRY_IN_PRODUCT         = NONE. country_boundaries has 0 rows everywhere (S10). The SoI
                                     import is BLOCKED_USER_DOWNLOAD.
ENDPOINT_BORDER_GATE               = IMPLEMENTED in FastAPI, fails closed (503 today). ABSENT on the
                                     Supabase RPC path (NF-04). The deployed build uses the old box,
                                     which admits foreign points.
ROUTE_BORDER_GATE                  = NOT IMPLEMENTED (C-21, NF-05) as reproduced on 30 Sep. The public
                                     OSRM world graph routes at least one Indian pair through
                                     Bangladesh (RG-8).
BORDER_AMBIGUITY                   = GPS-accuracy only (D4). Unreachable from any API path (FC-01).
ADVISORY_SOURCE                    = NONE CONNECTED. The driver banner type exists; 0 emitters (NF-12).
HOSTILE_COUNTRY_ENCODING           = NONE found. No country is encoded as hostile, restricted or safe
                                     anywhere in backend/app, manager-web/src, driver-app/src or supabase/
                                     (grep, 30 Sep). The only country list is geocoding.NOMINATIM_COUNTRIES,
                                     which decides what address search may return, not where a trip may go
                                     (LOGISTICS_COVERAGE_POLICY.md G5).
```

## 2. NER international borders, checked against MHA

### 2.1 Sources read (PROVEN_BY_WEB, 30 Sep 2026)

| Source | What it gives |
|---|---|
| MHA, Border Management-I Division page, `mha.gov.in/en/divisionofmha/border-management-i-division` (footer: "Last Updated: 01 Jan 2023") | Length of each land border and the states it runs along |
| MHA, `BMdiv_I_Annexure_I_12032021.pdf` | The same list, word for word |
| MHA, `BMIntro-1011.pdf` | The same lengths, and the total land border of 15,106.7 km |
| MHA, Lok Sabha Unstarred Question 1175, answered 11 Feb 2025 | The Bangladesh border by state |
| MHA, Rajya Sabha Unstarred Question 2437, answered 17 Mar 2021 | The same Bangladesh per-state lengths in its fencing table, and the same total |
| MHA, Lok Sabha Unstarred Question 4125, answered 20 Mar 2018 | The four states that share a border with Myanmar; the Free Movement Regime "within 16 km" of the Indo-Myanmar border |

### 2.2 Borders by NER state

"Borders" means a country's MHA line names this state. The product never stores this table. It is here only to cross-check the geometry (§2.4).

| State | NER | Borders (MHA BM-I) |
|---|---|---|
| Arunachal Pradesh | yes | China, Bhutan, Myanmar |
| Assam | yes | Bangladesh (263 km), Bhutan |
| Meghalaya | yes | Bangladesh (443 km) |
| Tripura | yes | Bangladesh (856 km) |
| Mizoram | yes | Bangladesh (318 km), Myanmar |
| Nagaland | yes | Myanmar |
| Manipur | yes | Myanmar |
| Sikkim | yes | China, Nepal, Bhutan |
| West Bengal (the Siliguri corridor; not NER) | no | Bangladesh (2,216.7 km), Nepal, Bhutan |

**Border totals (MHA).**

| Border | Length |
|---|---|
| Bangladesh | 4,096.70 km |
| Myanmar | 1,643 km |
| Bhutan | 699 km |
| China | 3,488 km |
| Nepal | 1,751 km |

The Bangladesh per-state figures in brackets are from LS USQ 1175, and they sum to 4,096.7.

**Not verified.** Per-state lengths for Myanmar, Bhutan, China and Nepal. One search (restricted to mha.gov.in) and the pages above did not give them. They are left blank rather than filled from memory.

### 2.3 What follows for logistics

- **Every NER state has an international border.** All eight appear in at least one MHA line, so no NER state is "interior" for border purposes.
- **Every road link from the NER to the rest of India passes through West Bengal (INFERRED).** West Bengal itself borders three countries. This is inferred from general geography and must be confirmed from the SoI geometry once it is imported: Assam and Sikkim are the NER states that touch West Bengal.
- **A world-wide router finds shorter paths through a neighbour.** RG-8: Agartala→Kolkata on public OSRM was 422.5 km, against 329.9 km great-circle, which implies a Bangladesh transit. Border-crossing prevention is therefore a routing requirement, not an edge case (§4).

### 2.4 How MHA facts are used

- **The product's border is the SoI India outline** (`ST_Covers` on `country_boundaries['IN']`).
- **MHA text is not geometry.** Its figures are never converted into shapes, buffers or country lists.
- **One use only:** the post-import check that all eight NER states share part of their boundary with the India outline (`NER_SERVICE_REGION_POLICY.md` §5). A failure there means the import or the field mapping is wrong, not MHA.

## 3. Ambiguity policy

| Situation | Answer | Why |
|---|---|---|
| Planner point (no accuracy) exactly on the outline | Inside India | `ST_Covers` is a closed set (D4); fixture-tested |
| Planner point any distance outside | 422 `OUTSIDE_SUPPORTED_COUNTRY` | No outward tolerance (D4) |
| GPS fix whose `accuracy_m` circle reaches the outline | `BORDER_AMBIGUOUS`: `in_india` None, coverage `UNKNOWN`, refused with 422 if used as an endpoint | Uncertainty is reported, never resolved in India's favour and never declared foreign |
| Point on a shared edge between two Indian states | The covering state, NER first, then slug | Deterministic; fixture-tested (`P_STATE_EDGE`) |
| 1:1M generalisation of the SoI line | **Not modelled as tolerance.** The SoI line is the standard (Geospatial Guidelines 2021, item xiii: "SoI published maps or SoI digital boundary data are the standard to be used") | The portal pages read do not state the positional accuracy of OVSF/1M/7 (NOT_VERIFIED). Residual risk: a genuine Indian point just inside the true border, but outside the generalised line, is refused. That is a false refusal, which is the safe direction. A manager sees 422 with the field named |
| No India outline loaded | 503 `GEOGRAPHY_UNAVAILABLE` | Fails closed; never "inside" and never "outside" |
| An advisory or high-attention distance | `BORDER_ADVISORY_DISTANCE_M` and `BORDER_HIGH_ATTENTION_DISTANCE_M` stay **UNSET** | Setting them needs a written owner decision. They may only raise attention; they can never move a point into India or out of it. An official zone, such as the 16 km FMR band in LS USQ 4125, would arrive as an advisory with provenance (§5), not as a constant |

**GPS spoofing near a border.** `is_mock_location` is set only from Android's `mocked` field (`driver-app/src/tracking/adapter.ts`: "Android only; absent elsewhere"). A web or iOS fix is always sent as not-mock, so `is_mock_location=false` is not proof of a real fix. Border decisions must never rest on a single driver-reported fix.

## 4. Preventing cross-border routes (D5)

**Rule.** For every route candidate before it is stored or offered:
1. `ST_CoveredBy(route_geometry, country_boundaries['IN'].geometry)` must be true. Use the full stored geometry, not a simplified display line.
2. Otherwise the candidate is dropped with reason `ROUTE_CROSSES_COUNTRY_BOUNDARY`, logged with the trip id and provider (not the driver).
3. If no candidate is left, the trip goes to `HOLD_AND_REVIEW`: nothing is selected, a manager reviews it, and nothing is auto-dispatched.
4. A route is never trimmed, snapped or "repaired" into India.
5. With no India outline loaded, route checking is 503, like the endpoint gate.

**Paths that must all go through the rule.**

| Path | Code today (as reproduced) | Status |
|---|---|---|
| Plan, alternatives, emergency backup | `routes.py`: `endpoint_mismatch` and the detour ratio only | NOT_IMPLEMENTED |
| Recalculate and manager reroute | same | NOT_IMPLEMENTED |
| Driver reroute request | same chain | NOT_IMPLEMENTED |
| Supabase-target manager | Browser OSRM plus a fabricated `cached_corridor` (NF-06). On 30 Sep the manager lane moved it to the FastAPI plane (in flight) | Depends on the FastAPI rule |
| Offline package | Carries the route already selected; computes nothing offline | Safe once the rule guards selection |
| Future self-hosted graph | `ROUTING_GRAPH_FRESHNESS.md` §6: clip the India extract to the SoI outline, and include "no golden route leaves India" in the smoke test | Defence in depth, not a substitute for the per-route check |

**Red test (from NF-05).** A fake OSRM returns geometry through a point outside the India outline. Expect the candidate dropped and 422 or `HOLD_AND_REVIEW`; today it is stored. Mutation check: delete the `ST_CoveredBy` clause and the test must fail.

The manager copy for both codes exists (`manager-web/src/components/ui.tsx` `GEOGRAPHY_ERRORS`, added 30 Sep). Whether the backend guard landed this round is for the backend lane to report. This document does not claim it.

## 5. Advisory source model

The driver type exists (`driver-app/src/api/client.ts` `BorderAdvisory`: status `NORMAL | ADVISORY | RESTRICTED | UNKNOWN`, message, source, verified_at). Nothing emits it (NF-12). The rules below apply before anything may emit it.

| Rule | Detail |
|---|---|
| Official source only | An advisory must name its publisher (a ministry, a state government or a border authority), a URL or document reference, `retrieved_at`, and an effective period. The app **never decides** a border status by itself: no model, heuristic or distance creates one |
| Provenance travels | `source` and `verified_at` are always shown next to the status |
| UNKNOWN is never SAFE | A missing advisory shows nothing, and **never** "clear" or "NORMAL". A stale advisory (past its period or `verified_at` too old) shows as UNKNOWN |
| Geometry, not nationality | An advisory attaches to a corridor, a road segment or a zone polygon with its own provenance. It is never keyed to a country name. No list of countries is ever hard-coded as hostile, restricted or safe (D6) |
| Manager review | An advisory ingested from a feed is shown to managers first. Driver-facing text is the official text, attributed and not paraphrased by AI |
| Permits are out of scope | MHA publishes permit regimes for protected and restricted areas (`FAQs-onPAPandRAP.pdf`). The product does not model them, and must not imply that a route is permitted. At most, an official advisory may say that a permit regime applies |
| Places near the border | Roadside places come from an OSM snapshot with no country filter. **121 name-marked facilities outside India** are bundled, 105 of them EMERGENCY or FUEL (`places_foreign_scan.txt`). Until the snapshot is filtered by the SoI outline, a place outside India must not be offered as a stop or an emergency option on a domestic trip. Fix after import: `ST_Covers(IN, place)` at snapshot build time, and label `country` |

## 6. Privacy and RBAC

| Topic | Rule | State |
|---|---|---|
| Who sees a trip's border outcomes | The same people who see the trip: the scoped manager (`core/scope.py`) and the assigned driver. A refusal (`OUTSIDE_SUPPORTED_COUNTRY` and similar) returns only `field` and `scope_type`, never coordinates of other trips | PROVEN_BY_SOURCE (`details` payloads) |
| NE manager reach | Unscoped for trips, which is safe while INDIA_EXTERNAL is refused (AG-04). The flag must not flip before a trip clause exists | OPEN (gated) |
| Location near a border is sensitive | No new store of "near border" events tied to a person. If drift-to-border alerts are ever built, they record trip id, time and an aggregate distance band, not a raw position trail beyond the existing `gps_points` retention | Policy |
| Logs | Route-drop logs name the trip and provider, not the driver's name or phone. Phones are masked to the last two digits in any report | Policy |
| Third parties | No border-related data leaves the backend. The public OSRM receives the coordinates being routed; for a reroute that includes the truck's reported position (`routes.py` `reroute_from`). The self-hosted graph removes even that (`ROUTING_GRAPH_FRESHNESS.md` §6) | Partly (public OSRM in use) |
| Supabase direct access | The geography tables have RLS enabled with no policy: `country_boundaries` (0016, "RLS on, no policy"), and `states` and `districts` (0013). A client holding a Supabase JWT reads nothing from them directly | PROVEN_BY_SOURCE (migrations) |

## 7. Offline behaviour

- **Offline, nothing about borders is decided.** Geography gates and route checks run only on the server. The offline package carries the corridor selected online (`offline_package.py`), which will have passed §4 once it is implemented.
- **Offline routing does not exist** (`offline_package.py`: offline ROUTING is not included). So an offline driver cannot generate a cross-border route. A reroute needs the network, and the network path is gated.
- **A cached advisory keeps its `verified_at`,** and is shown stale or UNKNOWN when old. Offline never upgrades to "clear".
- **No basemap is bundled** (`BASEMAP_NOT_BUNDLED_LICENCE`). The driver cannot see the border line offline; that is recorded, not hidden.

## 8. Test matrix

| ID | Case | Layer | Expected | State (30 Sep) |
|---|---|---|---|---|
| B-01 | Point exactly on the outline | classifier | In India | Passes on fixtures; real outline MISSING |
| B-02 | Point just outside, no accuracy | classifier + plan API | 422 `OUTSIDE_SUPPORTED_COUNTRY`, nothing stored | Passes on fixtures (`P_NEIGHBOUR`); real MISSING |
| B-03 | Near-boundary GPS fix with 500 m accuracy | classifier | `BORDER_AMBIGUOUS` | Passes (`P_NEAR_HOLE`) |
| B-04 | The same fix through an API path | API | 422 `BORDER_AMBIGUOUS` | MISSING (FC-01) |
| B-05 | Accuracy never pulls a foreign point in | classifier | `in_india` False | Passes |
| B-06 | No outline loaded | plan API | 503, nothing stored | Passes |
| B-07 | Route geometry leaves India | routes | Candidate dropped, `ROUTE_CROSSES_COUNTRY_BOUNDARY` | MISSING (NF-05 red test to add) |
| B-08 | All candidates leave India | routes | `HOLD_AND_REVIEW`, nothing selected | MISSING |
| B-09 | Driver reroute returns a crossing route | driver API | Not offered | MISSING |
| B-10 | Supabase `app.plan_trip` with a Dhaka endpoint | SQL | Raises | MISSING (today it inserts, NF-04) |
| B-11 | Real cities Dhaka, Sylhet, Tamabil | classifier | Outside | Dhaka written and skipped; the other two MISSING |
| B-12 | All eight NER states touch the India outline | import validation | True for all 8 | MISSING |
| B-13 | A foreign POI near the border on a domestic corridor | places | Not returned | FAILS today (in-process probe: at least 3 of 7 results are across the border, going by their names) |
| B-14 | Advisory absent or stale | driver UI | Nothing, or UNKNOWN; never "clear" | Driver lane (NF-12 / P1R-18 in flight) |
| B-15 | No hard-coded country decision | grep gate | 0 matches of neighbour-country names in decision code | Passes by grep today. `geocoding.NOMINATIM_COUNTRIES` is a search inclusion list (G5), not a decision |

## 9. What this document does not do

- It does not import, download or approximate any boundary.
- It does not encode, rank or characterise any country.
- It does not set the advisory distances.
- It does not claim the route guard exists.
