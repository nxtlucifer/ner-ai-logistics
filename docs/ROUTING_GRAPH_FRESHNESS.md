# Routing graph: source, freshness and production path

Lane: routing-android (REPRODUCE, DO NOT FIX). Written 30 Sep 2026 against HEAD `5b5e474` plus the
uncommitted working tree. No source file was changed. Evidence lives in
`.runtime/production/repro/routing-android/`.

Labels: PROVEN_BY_TEST, PROVEN_BY_RUNTIME, PROVEN_BY_DATABASE, PROVEN_BY_SOURCE, NOT_REPRODUCED.
Two more are used where they apply: PROVEN_BY_WEB means a public page, fetched today. NOT_VERIFIED means
no evidence either way. Numbers in the self-hosting plan are MEASURED only where marked. Everything
else there is MODELED.

## 1. Verdict

```
ROUTER_PROVIDER      = OSRM public demo server, https://router.project-osrm.org (operated by FOSSGIS)
                       - backend: the code default for ROUTING_FALLBACK_URL; ROUTING_PRIMARY_URL is unset
                         in backend/.env, backend/.env.example and render.yaml, so the chain is ONE provider
                       - manager-web Supabase target: hard-coded in the BROWSER, bypassing the backend chain
PUBLIC_DEMO          = YES
PRODUCTION_TERMS     = NO. The terms allow "reasonable, non-commercial use-cases" only. They also say
                       "no heavy usage", 1 request/s, a valid user agent, and attribution with a
                       "fix the map" link.
SOURCE_DATA_DATE     = 2026-09-27T16:00:00Z. This is the OSM data timestamp FOSSGIS publishes for the
                       car Europe+Asia dataset (probe 2026-09-30T02:15Z). It changes about every 2 days.
                       The app records none of it.
GRAPH_BUILD_DATE     = NOT KNOWABLE. Responses carry no `data_version`. The nearest proxy is the
                       timestamp file's Last-Modified, 2026-09-28T01:11:01Z, and that is not a build date.
RATE_LIMIT           = 1 req/s (provider policy). The app puts NO throttle, queue or cache in front of
                       it, and all hosted users share one egress IP.
SLA                  = NONE. The policy says "no guarantees wrt. uptime, latency, or data updates".
FALLBACK             = NONE in practice. With no primary set, the chain is [osrm]. An outage returns
                       503 ROUTING_UNAVAILABLE (see 3.2). Supabase-target manager: when OSRM fails, the
                       browser FABRICATES a route and stores it (see 3.3).
ROUTER_PRODUCTION_SAFE = NO   -> production routing NOT READY (add-on section 11 rule)
```

## 2. Antigravity claims in this lane, reproduced

| ID | Audit claim | Result | Evidence |
|---|---|---|---|
| RG-1 | "Routing uses the public demo server `router.project-osrm.org`" | REPRODUCED: PROVEN_BY_SOURCE, PROVEN_BY_RUNTIME, PROVEN_BY_DATABASE | `backend/app/core/config.py:181-183`, `backend/app/services/routes.py:107-133`. The in-process probe of the real `build_chain()` gave `chain=["osrm"]` with `provider_urls=["https://router.project-osrm.org"]` (`routing-chain-probe.log`). `ner_logistics_cert` (read-only SELECT): `trip_routes.routing_provider = 'osrm'` for 28 of 28 rows, 26-29 Sep. `osrm` is the name `build_chain` gives the fallback slot; a configured primary would read `primary`. |
| RG-1h | Same claim, for the HOSTED Render API | NOT_VERIFIED | `render.yaml` declares no `ROUTING_*` key. What the Render dashboard sets was not read (hosted is off-limits). Hosted phone runs on 13-14 Sep got real India-wide OSRM answers ("new road 2449.6 km"), which fits the public server but does not prove it. |
| RG-2 | "NO dedicated OSRM instance" | REPRODUCED: PROVEN_BY_SOURCE | `docker-compose.yml` has one service, `db` (postgis/postgis:18-3.6). No OSRM service, image or infra file exists in the repo, `.runtime` and `.venv` excluded. |
| RG-3 | "NO internal graph build or refresh process" | REPRODUCED: PROVEN_BY_SOURCE | No `osrm-extract`, `osrm-contract`, `osrm-partition`, `osrm-customize`, `osrm-routed`, `osrm-datastore` or `osrm/osrm-backend` reference outside `node_modules`, `.runtime`, `.venv` and `.git`. |
| RG-4 | "OSRM 704 ms median" (PRODUCTION_READINESS_AUDIT_2026) | PARTIAL | Two single requests today: `/nearest` 0.71 s and `/route` 0.62 s, TLS included (`osrm-nearest-guwahati.txt`, `osrm-route-agartala-kolkata.txt`). That is the same order of magnitude. n=2 is not a median, and a load test against a third party is not allowed. |

## 3. New findings in this lane

### 3.1 The only provider is the public server, with no data provenance per route (P1, PROVEN_BY_SOURCE)

`trip_routes` holds `routing_provider` (`osrm`/`primary`) and `provider_route_id`. It has no graph
version, OSM timestamp or base URL (`backend/app/models/operations.py:399-455`). Two routes on the
same trip, planned two days apart, can come from different graphs, and nothing can tell them apart.
The public server does not help: no `data_version` in the body, no `Last-Modified` on API responses
(`osrm-nearest-guwahati.txt`).

### 3.2 There is no real fallback (P1, PROVEN_BY_RUNTIME)

`routing_chain_probe.py` drives the real `build_chain()` and `OsrmRoutingProvider` against a local
fake OSRM. No public network is involved.

| scenario | result |
|---|---|
| default config | chain `[osrm]` -> `https://router.project-osrm.org`, timeout 8.0 s |
| primary 500, fallback OK | OK via `osrm`, 0.64 s, attempts `primary:RoutingUnavailable, osrm:ok` |
| primary slow (3 s) with a 1 s timeout, fallback OK | OK via `osrm`, 1.6 s |
| fallback only, 500 | `RoutingUnavailable: No routing provider could answer. Tried: osrm`, i.e. 503 ROUTING_UNAVAILABLE |

The chain works as designed. With the shipped configuration it has one link, so one outage or one
block of the shared egress IP stops all route planning, rerouting and driver reroute requests. Each
provider waits 8 s before failing. With a primary configured, the worst case stacks to 16 s. Provider
answers are not cached (no cache in `app/services/routes.py` or `app/services/routing/`). Routes
already stored stay usable.

### 3.3 Supabase-target manager fabricates a route when OSRM is unreachable (P1, PROVEN_BY_TEST)

`manager-web/src/api/supabaseManagerApi.ts:511-665` (`planRoute`, active when `VITE_BACKEND=supabase`,
which `manager-web/.env.production` sets) does four things:

- It calls `https://router.project-osrm.org/route/v1/driving/...` from the browser with
  `overview=full&steps=true&alternatives=true`. That is up to 2 requests per plan: a second one
  forces a hard-coded Tezpur waypoint (`92.80,26.63`) when both endpoints fall near Guwahati and
  Jorhat.
- On any failure it inserts a `cached_corridor` route. That route has a fixed 305.39 km / 315 min,
  8 vertices, and 6 hard-coded Guwahati-to-Jorhat interior points, whatever the trip's real stops are.
- `public.select_route` (`supabase/migrations/20260909100000_manager_select_route.sql`) has no
  provider guard, so the route can be selected. `dispatch_trip` exists in the same client.
- It sets `User-Agent` on a browser `fetch`. Browsers do not let a page choose that header, so the
  policy's identification requirement is met only by the browser's own UA and Referer.

Red test `supabase_planroute_fabricated_fallback.test.ts` (run with `vitest.red.config.mjs`, log
`red-supabase-planroute.log`) uses a Shillong-to-Aizawl trip with every fetch failing:

```
PERSISTED {"provider":"cached_corridor","distance_km":305.39,"estimated_duration_min":315,"vertices":8,"second_vertex_lonlat":[91.82,26.195]}
Tests 1 failed | 1 passed
```

Test 1 passes: the browser really calls the public server. Test 2 is RED: a fabricated route is
persisted. Acceptance for the fix round: with routing failing, no `trip_routes` row is written and a
routing-unavailable error is raised. Whether the hosted manager builds with the Supabase target is
NOT_VERIFIED, because Vercel/Netlify env is set in their dashboards (`manager-web/vercel.json`).

### 3.4 The public graph is world-wide and routes through Bangladesh (P1, PROVEN_BY_RUNTIME + PROVEN_BY_SOURCE)

One GET, Agartala (23.8315, 91.2868) to Kolkata (22.5726, 88.3639), returned `distance 422487.5 m,
duration 19626.7 s` (`osrm-route-agartala-kolkata.txt`). The great-circle distance is 329.9 km. The
only road link between the two cities that avoids Bangladesh goes round through the Siliguri corridor
and is far longer (not measured here). So a 422 km answer implies an international crossing. That is
an inference from the geography: the probe did not trace the route geometry.

The backend checks endpoints (`endpoint_mismatch`) and the detour ratio (`routes.py:309-334`). It
does not check that route geometry stays inside India, and grep finds no route-to-country test in
`backend/app`. Also, `country_boundaries` is reported empty (SoI lane).

End-to-end storage of such a route through the API was not exercised (NOT_REPRODUCED end to end).
Doing that would need a scratch DB and a fake OSRM, and that proves only the fake. It also conflicts
with the product's "no outward border tolerance" rule.

### 3.5 Car profile, not a truck profile (P2, PROVEN_BY_SOURCE + PROVEN_BY_WEB)

`OsrmRoutingProvider` defaults to `profile="driving"` (`osrm.py:104`). The public service offers only
car, bike and foot ("worldwide", routing.openstreetmap.de/about.html). No `maxweight`, `maxheight`,
`hgv=*` or ghat-road restriction applies to a 10-40 t truck.

### 3.6 Map roads and routing roads are different datasets (INFO, PROVEN_BY_SOURCE)

The basemap both apps draw is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
(`manager-web/src/components/mapSetup.ts:48`, `driver-app/src/map/DriverRouteMap.native.tsx:70`,
`DriverRouteMap.web.tsx:172`). Those tiles are rendered from live OSM on the tile server's own
schedule. The route line comes from a graph that is about 2 days old. A road can appear on the map
but not in the graph, or the other way round, and nothing shows which.

## 4. What the public router's policy says (PROVEN_BY_WEB, 30 Sep 2026)

- The OSRM wiki page "Demo server" (github.com/Project-OSRM/osrm-backend/wiki/Demo-server) says:
  - FOSSGIS sponsors the server, reachable as `router.project-osrm.org` and `routing.openstreetmap.de`.
  - "Do not exceed 1 request per second".
  - Use is "restricted to reasonable, non-commercial use-cases".
  - "no guarantees wrt. uptime, latency, or data updates".
- routing.openstreetmap.de/about.html says:
  - Attribution and a "fix the map" link are required.
  - "One request per second max."
  - "Use a valid user agent and, if applicable, a correct referrer."
  - "No scraping, no heavy usage."
  - "The routing data are updated roughly every two days."
  - Status is published at map.project-osrm.org/timestamps/.
- The FOSSGIS terms page (fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/) answered with a
  bot-protection (Anubis) challenge. It was NOT read and was not bypassed.
  - The backend docstring quotes an older wording: "withdrawn at any time and without giving a
    reason" (`backend/app/services/routing/osrm.py:19-22`). That quote was NOT re-verified today.
- Requests made in total:
  - 3 data/API requests to FOSSGIS hosts: 1 timestamp file, 1 `/nearest`, 1 `/route`. Each carried
    an identifying UA and they were at least 2 s apart.
  - 4 policy/status page reads: wiki, about.html, the timestamps index, and the blocked terms page.
  - 1 Geofabrik page request.
  - No load.

## 5. Field definitions (for any future provenance column or status page)

| field | meaning | value today | label |
|---|---|---|---|
| `MAP_ROAD_SOURCE` | Where the roads DRAWN on the basemap come from | OSM Standard tiles, tile.openstreetmap.org (OSMF) | PROVEN_BY_SOURCE |
| `MAP_ROAD_DATE` | Data date of the drawn roads | UNKNOWN. Tiles re-render on their own schedule, and the app records nothing | - |
| `OSRM_PROVIDER` | Which operator answered | FOSSGIS public demo (`routing_provider='osrm'`) | PROVEN_BY_RUNTIME/DB |
| `OSRM_BASE_URL` | Endpoint actually used | `https://router.project-osrm.org` (local); hosted NOT_VERIFIED | PROVEN_BY_RUNTIME |
| `OSRM_PROFILE` | Vehicle model | `driving` (car) | PROVEN_BY_SOURCE |
| `OSRM_DATA_SOURCE` | Raw data behind the graph | OpenStreetMap, via the FOSSGIS pipeline; extract region not published per request | PROVEN_BY_WEB |
| `OSRM_DATA_DATE` | OSM timestamp the graph was built from | 2026-09-27T16:00:00Z for car Europe+Asia at probe time. The India-to-dataset mapping is INFERRED from the dataset name. | MEASURED |
| `OSRM_GRAPH_BUILD_DATE` | When extract/contract ran | UNKNOWN (no `data_version`, no build header) | - |
| `OSRM_DATA_VERSION` | `data_version` echoed in responses (`osrm-extract --data_version`) | absent | PROVEN_BY_RUNTIME |
| `OSRM_ALGORITHM` | CH or MLD | UNKNOWN for the public server | - |

For self-hosting, `OSRM_DATA_VERSION` should equal the OSM replication timestamp of the extract. It
should be stored on every `trip_routes` row next to `routing_provider`. That is a recommendation, and
nothing was implemented.

## 6. Production path: self-hosted OSRM (recommended) (MODELED unless marked)

### 6.1 Sizing

| item | value | label |
|---|---|---|
| Geofabrik `india-latest.osm.pbf` | 1.6 GB, data up to 2026-09-29T20:22:51Z | MEASURED (page, 30 Sep; `geofabrik-india-page.txt`) |
| Geofabrik North-Eastern Zone | 104 MB | MEASURED (same page) |
| Extract choice | ALL-INDIA. The product is India-wide and NER-centred. NER-only would refuse valid India trips (add-on section 8). | decision input |
| Border handling | Clip to the India boundary (SoI, once imported), or mark border crossings as barriers in the profile, so RG 3.4 cannot happen | MODELED |
| `osrm-extract` peak RAM, truck.lua | about 8-12 GB, i.e. 5-8x the PBF size, as a planning ratio | MODELED |
| `osrm-partition` + `osrm-customize` (MLD) | about 4-8 GB, minutes | MODELED |
| `osrm-contract` (CH) | similar or higher RAM, with markedly longer wall time; queries are faster but no fast re-weighting | MODELED |
| `osrm-routed` serving (MLD, India) | about 3-6 GB resident | MODELED |
| Temp and dataset disk | about 20 GB scratch, 5-8 GB per kept dataset (keep N and N-1) | MODELED |
| Build host | 32 GB RAM / 8 vCPU for build headroom. Serve on 2 x 8 GB (blue/green). | MODELED |

All MODELED figures must be MEASURED on the first staging build before anyone quotes them.
Recommendation: use MLD, not CH. MLD lets `osrm-customize` reapply weights (closures, landslide
avoidance) in minutes without re-extracting, which matters on NER hill roads.

### 6.2 Cadence

- A weekly scheduled rebuild, plus one on demand.
- Closures and landslides are not handled by waiting for OSM. They need an avoid/closure layer
  applied at customize time, or at the application level.
- The public server rebuilds about every 2 days. A pinned weekly graph is FRESHER-KNOWN rather than
  fresher, which is the point: every route can name its data date.

### 6.3 Safe pipeline (every stage gates the next; any failure keeps serving N)

1. **Source update.** Download `india-latest.osm.pbf` together with its `.md5`. Record the OSM
   replication timestamp from `osmium fileinfo -e`.
2. **Staging.** Write to `graphs/<osm_timestamp>/`, never over the serving directory.
3. **Validation.**
   - md5 matches.
   - The timestamp is newer than N's.
   - The bounding box is inside the expected India bounds.
   - `osmium check-refs` is clean.
   - Size delta is within ±5% of N.
4. **Change-volume check.** Compare the `highway=*` way count and total length against N. Abort for
   review if either moves by more than 1%, or by more than 0.2% inside the NER bounding box. This
   catches vandalism and truncated extracts.
5. **OSRM rebuild.** Run `osrm-extract -p truck.lua --data_version=<osm_timestamp>`, then
   `osrm-partition`, then `osrm-customize`.
6. **Smoke test** against a golden set of about 40 origin/destination pairs (NER corridors plus
   India-wide):
   - Every pair returns `Ok`.
   - Distance and duration are within ±10% of N, or the pair is flagged for review.
   - `data_version` matches.
   - No golden route leaves India.
   - `/nearest` snaps to within 50 m on 20 known points.
   - p95 is under 300 ms locally.
7. **Atomic promote.** Start green, health-check it, then switch the stable URL (load-balancer target
   or `osrm-datastore` shared-memory swap). `ROUTING_PRIMARY_URL` points at the stable URL, and the
   public server is removed from the chain (terms).
8. **Rollback.** Keep N-1 on disk and flip the target back. Record promote and rollback events with
   the `data_version` values.

## 7. What was not done

- No source change: the fixes belong to the fix round.
- No hosted access.
- No load against any third party.
- No provider switch.
- Nothing was downloaded beyond one Geofabrik HTML page.

The red test lives in the evidence directory and should move to `manager-web/src/api/` with the fix.
