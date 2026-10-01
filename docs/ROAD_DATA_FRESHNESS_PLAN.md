# Road data freshness plan

Lane: docs-maps, fix round 1. Written 30 Sep 2026 against HEAD `5b5e474` plus the working tree.
Documentation only.

This plan extends `docs/ROUTING_GRAPH_FRESHNESS.md`, which owns the routing graph: its build pipeline,
cadence and provenance fields. It does not repeat that material. It covers every **road-related**
dataset the product shows or decides with, and says how old each one may be before the product must
say so.

Labels: `PROVEN_BY_SOURCE`, `PROVEN_BY_DOC(url)`, `INFERRED`, `NOT_VERIFIED`. Sections 3-6 are a plan
(MODELED). Nothing in them is built.

## 1. Principle

A road fact is only as good as its date. So:

- Every road-related thing on screen or in a decision carries a **source** and a **data date**.
- An unknown date is shown as **UNKNOWN**, never as current.
- Time may only increase doubt. This reuses the rule already enforced in `app/domain/road_memory.py`
  (`docs/ROAD_MEMORY.md` §3).
- UNKNOWN is never SAFE.

## 2. Current state (30 Sep 2026)

| Dataset | Used for | Source | Data date the app knows | Age today | Label |
|---|---|---|---|---|---|
| Basemap roads (drawn) | what the manager and driver see | OSM Standard tiles | **none**: `MAP_ROAD_DATE = UNKNOWN` | unknown | PROVEN_BY_SOURCE (ROUTING_GRAPH_FRESHNESS §5) |
| Routing graph | route geometry, distance, ETA, reroute | FOSSGIS public OSRM, car profile | **none per route**. The provider published an OSM timestamp of 2026-09-27T16:00Z at probe time | about 2-3 days, unrecorded | PROVEN_BY_SOURCE + PROVEN_BY_DOC (ROUTING_GRAPH_FRESHNESS §1, §4) |
| Roadside POIs | fuel, emergency, tyres, hotels, rest | bundled OSM snapshot (Overpass) | `retrieved_at` 2026-09-20T01:11Z, shown in the layer | 10 days; never refreshed automatically | PROVEN_BY_SOURCE (`corridor_snapshot.json`) |
| Historical landslides | exposure evidence, map dots | NASA GLC slice | events 2007-2017, fetched 2026-09-11, flagged as aged | 9+ years of event data | PROVEN_BY_SOURCE (`backend/data/landslides/PROVENANCE.md`) |
| Official warnings | advisories on a route | NDMA SACHET (live) | per alert, with `captured_at` in the offline package | live | PROVEN_BY_SOURCE (FINAL_SOURCE_ADMISSION_LEDGER §1; `offline_package.py:31-39`) |
| Closures / blockages | whether a road is passable now | **none**. No closure table, no closure source. `road_memory` is a pure model with no persistence (`docs/migrations/PENDING_road_memory_tables.sql`, not applied) | — | — | PROVEN_BY_SOURCE |
| Fleet traversal | observed speed ("Fleet traffic"), off-route distance | own GPS | per fix, `received_at` | live | PROVEN_BY_SOURCE (`route_progress.py:70-74`, `OFF_ROUTE_THRESHOLD_M = 200`) |
| Terrain / gradient | STEEP/HILLY stretches | backend DEM (Open-Meteo elevation, OpenTopoData fallback) | static elevation | static (fine) | PROVEN_BY_SOURCE |
| Border / country geometry | India check, route-crossing guard | SoI OVSF/1M/7 | **not imported**: planning answers 503 `GEOGRAPHY_UNAVAILABLE` on 0016 databases | — | PROVEN_BY_DATABASE (S10, via ANTIGRAVITY_FINDINGS_REPRODUCTION) |

**Consequences.** All three are INFERRED from the table.

1. A driver can see a road that the route engine does not know, or the other way round, and nothing
   says which. The drawn map and the graph have different, unrecorded dates.
2. A new bypass or a washed-out bridge reaches routing only when OSM is edited *and* FOSSGIS rebuilds.
   Nothing in the product notices either event.
3. No source tells the product that a road has closed or re-opened. `docs/ROAD_MEMORY.md` §0 surveyed
   this: "No source surveyed publishes 'this road is open again.'"

## 3. Freshness classes and targets (MODELED)

| Class | Changes on the scale of | Target max age before a **warning** | Max age before **refusal / hold** | Where the age is shown |
|---|---|---|---|---|
| Road network (graph + basemap from one extract) | weeks | 14 days since `osm_timestamp` | 45 days: routes still plan, but carry `ROAD_DATA_STALE`, and the manager's approval dialog says so. No automatic refusal, because an old graph is still the best graph available | route card "Road data: OSM <date>", attribution |
| Closures and blockages | hours | `road_memory.FRESHNESS_WINDOW` = 7 days: an old `VERIFIED_OPEN` goes `STALE` (existing rule) | A `CLOSED` segment on a route puts the route on HOLD_AND_REVIEW. There is no time-based reopening; `REPAIR_REPORTED` goes to `AWAITING_VERIFICATION` after 48 h (existing rule) | route review, driver reroute prompt |
| Official warnings | minutes-hours | as today (live, with `captured_at`) | — | advisory panel |
| Roadside POIs | months | 60 days per category | never refuse. Past 120 days the layer title reads "Places mapped as of <date>, may be out of date" | layer footer (already shows `retrieved_at`) |
| Historical hazard inventory | years | always shown as historical with its year range | — | map dot tooltip (already "Recorded landslide (year)") |
| Boundaries (SoI) | years | re-check the SoI product page quarterly | missing: planning fails closed (existing 503) | attribution "Boundaries: Survey of India <version>" |

The 14/45/60/120-day figures are starting values for the owner to adjust. They are not derived from
measurements.

## 4. How each class is kept fresh (MODELED)

### 4.1 Road network: one extract, three products

- Rebuild weekly and on demand, from the **same** `india-latest.osm.pbf`, the routing graph
  (ROUTING_GRAPH_FRESHNESS §6.3), the vector basemap and the POI snapshot
  (`docs/MAP_PRODUCTION_ARCHITECTURE.md` §4).
- One value `T` = the extract's OSM replication timestamp (`osmium fileinfo -e`) is written three
  times:
  - into OSRM as `--data_version=T`, and so onto every `trip_routes` row (the gated migration named in
    fix list P1-F);
  - into the PMTiles metadata;
  - into the POI snapshot `retrieved_at`.
- The build is refused and N kept when either check fails:
  - ROUTING_GRAPH_FRESHNESS §6.3 step 4: the `highway=*` way count or length moves more than 1%
    India-wide or 0.2% inside the NER box;
  - the golden route set fails, including "no golden route leaves India".
- **Why not follow OSM minutely diffs:** the graph needs a rebuild anyway, and weekly with a known date
  beats "fresher but unknowable" (ROUTING_GRAPH_FRESHNESS §6.2).

### 4.2 Closures: an overlay, not a graph rebuild

- Closures never wait for OSM. They are `road_memory` evidence on a route segment, and they need the
  pending tables (`docs/migrations/PENDING_road_memory_tables.sql`). Applying them is a gated migration
  that needs approval. It is **not** part of this lane.
- Evidence sources and their asymmetry, unchanged from `docs/ROAD_MEMORY.md` §3:

  | Source | May close / raise doubt | May open |
  |---|---|---|
  | `OFFICIAL_AGENCY` | yes | yes |
  | `FLEET_TRAVERSAL` | yes | yes |
  | `OPERATOR_REPORT` | yes | **no** |
  | `UNVERIFIED_REPORT` | yes | **no** |

- A manager-entered closure is `OPERATOR_REPORT` and carries three things: evidence (link or photo),
  an entry time and a segment.
  - It can raise doubt.
  - Only an official notice or a truck actually driving through re-opens the segment.
  - The MoRTH/NHAI project viewer and IWAI notices are **reference** material a manager may cite
    (MAP_DATA_SOURCE_LEDGER §2.6, §2.8). They are not feeds.
- Applying closures to routing:
  - **First step:** at application level, reject or flag candidate routes that cross a `CLOSED`
    segment. This fits the existing hold/review flow.
  - **Later:** with self-hosted MLD, reapply weights at `osrm-customize` time in minutes
    (ROUTING_GRAPH_FRESHNESS §6.1).

### 4.3 Detecting that the map is wrong: fleet evidence

The product's own trucks are the only positive observation of road reality it can make
(`docs/ROAD_MEMORY.md` §0). Three signals, all MODELED:

| Signal | How | Produces |
|---|---|---|
| Possible unmapped road | map-match completed trips' GPS against the self-hosted graph (OSRM `match`). Flag stretches of 500 m or more with no matching road that 2 or more distinct trucks drove | review item "possible road missing from map". Never an automatic graph edit |
| Possible closure | reroutes or U-turns concentrated on one segment (today `off_route_m > 200`, `VEHICLE_OFF_PLANNED_ROUTE`), 2 or more trucks within 24 h | `UNVERIFIED_REPORT` doubt on that segment. It raises doubt and never opens anything |
| Re-opening | a truck's matched traversal of a `CLOSED` or `AWAITING_VERIFICATION` segment | `FLEET_TRAVERSAL`. This is the existing re-opening path |

Privacy: fleet traces are **never** uploaded to OpenStreetMap or any third party. A person who has
local knowledge, not the traces, may fix OSM, following `docs/MAP_DATA_CONFLATION_POLICY.md` §6.

### 4.4 POIs

- Rebuild the snapshot from the weekly extract (§4.1), not from the public Overpass endpoint.
  Overpass's own commons guidance, quoted in `backend/scripts/acquire_places_snapshot.py:6-10`, asks
  that public instances not back an application.
- Carry per-category counts, and remove the 400-per-state cap, so an absence means "not mapped in OSM"
  and never "truncated".
- Clip to the SoI India polygon (`docs/MAP_DATA_CONFLATION_POLICY.md` §3).

## 5. Provenance fields (proposed; they extend ROUTING_GRAPH_FRESHNESS §5)

| Field | Where | Value |
|---|---|---|
| `MAP_DATA_VERSION` | basemap PMTiles metadata, attribution text | `T` (OSM timestamp of the extract) |
| `OSRM_DATA_VERSION` | every `trip_routes` row | `T` of the graph that answered (gated migration) |
| `ROAD_DATA_AGE_DAYS` | route response, approval dialog | now − `OSRM_DATA_VERSION`. UNKNOWN when there is no version (public OSRM) |
| `ROAD_DATA_STALE` | route reason code | set when the age exceeds the §3 warning threshold |
| `CLOSURE_EVIDENCE_AT` | `road_memory` evidence row | observed time, source, reference |
| `POI_SNAPSHOT_VERSION` | `/api/places` response `retrieved_at` (exists) | `T` once §4.4 lands |

Until `OSRM_DATA_VERSION` exists, the correct display for road data age is **UNKNOWN**, not a date
guessed from the FOSSGIS timestamp page.

## 6. Checks that would prove this plan once built

1. Each route stores a non-null `data_version`, and it equals the basemap's `MAP_DATA_VERSION` for the
   same weekly build.
2. A graph older than the warning threshold produces `ROAD_DATA_STALE` on new routes. The test clock
   is injected.
3. With the time-driven transition held at 48 h, no `CLOSED` segment becomes usable by time alone
   (this extends the existing exhaustive `test_road_memory.py` property).
4. A manager `OPERATOR_REPORT` cannot re-open a segment. A `FLEET_TRAVERSAL` can.
5. A route crossing a `CLOSED` segment is held for review, never auto-approved.
6. The POI layer states its snapshot date. A category with 0 records in view says "none mapped", not
   "none".

## 7. What was not done

- Nothing implemented. No migration drafted or applied. The road-memory tables stay pending, with
  approval required.
- No OSM replication, Geofabrik or FOSSGIS request was made by this lane. The figures come from
  ROUTING_GRAPH_FRESHNESS, which made those requests.
- The thresholds in §3 are proposals.
