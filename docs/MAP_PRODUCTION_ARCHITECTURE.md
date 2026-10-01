# Map production architecture

Lane: docs-maps, fix round 1. Written 30 Sep 2026 (08:40-09:30 IST) against HEAD `5b5e474` plus the
uncommitted working tree. Documentation only: no code was changed.

The audit reads the code as it stood at 08:46 IST. Other fix-round lanes were editing the tree in
parallel: for example, `manager-web/src/api/supabaseManagerApi.ts` was rewritten at 08:45 IST and no
longer calls public OSRM from the browser. Every map file cited below was checked for modification
time and diff state (`.runtime/production/fix1/docs-maps/basemap_code_audit.txt`).

Licences and terms are in `docs/MAP_DATA_SOURCE_LEDGER.md`. The routing graph is in
`docs/ROUTING_GRAPH_FRESHNESS.md`. Freshness is in `docs/ROAD_DATA_FRESHNESS_PLAN.md`. Merging rules are
in `docs/MAP_DATA_CONFLATION_POLICY.md`.

Labels: `PROVEN_BY_SOURCE` (code or data file read), `PROVEN_BY_DOC(url)` (publisher page read today),
`INFERRED`, `NOT_VERIFIED`. The target architecture in §4 is MODELED: a design, not a measurement.

## 1. Verdict: the current basemap

```
CURRENT_BASEMAP_PROVIDER   = OSM Standard raster tiles, https://tile.openstreetmap.org/{z}/{x}/{y}.png (OSMF)
                             - manager-web: MapLibre GL raster source 'osm' (mapSetup.ts:43-56), used by
                               FleetMap and MapPointPicker
                             - driver-app web: Leaflet tileLayer (DriverRouteMap.web.tsx:172-176)
                             - driver-app Android/iOS: Leaflet inside react-native-webview, with Leaflet 1.9.4
                               itself loaded from unpkg.com under SRI (DriverRouteMap.native.tsx:54-70)
CURRENT_BASEMAP_LICENSE    = data ODbL. The service is governed by the OSMF Tile Usage Policy
CURRENT_BASEMAP_RATE_LIMIT = none published; "may block access, without notice"; no SLA
CURRENT_BASEMAP_PRODUCTION_ALLOWED = NO  (ledger §2.1)
CURRENT_BASEMAP_ATTRIBUTION = "© OpenStreetMap contributors", plain text. No link to
                             openstreetmap.org/copyright and no ODbL statement (gap). Manager control is
                             compact (collapsible), which is allowed
CURRENT_BASEMAP_FAILURE_MODE =
  manager: MapLibre 'error' event -> "Some map data could not load. Check your connection. Route details
           remain available." (FleetMap.tsx:337,802-805). Route, track and markers are GeoJSON and DOM, so
           they still draw over a blank ground
  driver web: Leaflet 'tileerror' -> banner "Map tiles could not load. The route shown is from your trip
           and is still correct." (DriverRouteMap.web.tsx:179, :376)
  driver native: the same banner (DriverRouteMap.native.tsx:253-258). If unpkg.com is unreachable on a cold
           start, Leaflet never loads (`if(!window.L)` -> tileerror). Then not even the route overlay can
           draw: no map at all, only the banner
OVERLAY_SOURCES            = own API only (GeoJSON / Leaflet vectors built client-side); nothing private is
                             sent to a tile host except the viewport implied by the tile URL (see §5)
```

## 2. Provider inventory, from code

| App / surface | Library | Layer | URL / host | Key | Attribution in code | Evidence |
|---|---|---|---|---|---|---|
| manager: fleet map, trip review, point picker | MapLibre GL (npm, worker bundled by Vite) | STANDARD raster | `tile.openstreetmap.org` | none | `© OpenStreetMap contributors` | `mapSetup.ts:35-56`, `FleetMap.tsx:331`, `MapPointPicker.tsx:65` |
| manager: Terrain and 3D modes | MapLibre `raster-dem` + `hillshade` + `setTerrain` | DEM | `s3.amazonaws.com/elevation-tiles-prod/terrarium` | none | "Elevation: SRTM & GMTED2010 … via AWS Terrain Tiles" | `mapTerrain.ts:51-64,93-125` |
| manager: state/district picker | inline SVG | schematic NER outline | none | — | captioned "Schematic", `aria-hidden` | `NorthEastMap.tsx:1-18` |
| driver: web export | Leaflet (npm) | STANDARD raster | `tile.openstreetmap.org` | none | `&copy; OpenStreetMap contributors` | `DriverRouteMap.web.tsx:43,172-176` |
| driver: Android/iOS | Leaflet from `unpkg.com` (SRI sha384) inside WebView, `baseUrl https://driver.rasta.local/`, no custom User-Agent | STANDARD raster | `tile.openstreetmap.org` | none | `&copy; OpenStreetMap contributors` | `DriverRouteMap.native.tsx:54-70,238-251` |
| driver: relief overlay (toggled with hazards) | Leaflet tileLayer, opacity 0.55, maxNativeZoom 12 | hillshade | `api.maptiler.com/tiles/hillshade` when `EXPO_PUBLIC_MAPTILER_KEY` is set at build time; otherwise `{s}.tile.opentopomap.org` | MapTiler key inlined into the client bundle | `© MapTiler`, or "Relief: © OpenTopoMap (CC-BY-SA), SRTM" | `scene.ts:59-72`, `DriverRouteMap.native.tsx:82`, `MapScreen.tsx:827,858` |
| driver: "navigate in Google Maps" | OS intent / URL | hand-off | `www.google.com/maps/dir/?api=1&destination=…` | none | n/a (opens Google's app) | `MapScreen.tsx:790` |
| manager: paste a Google Maps link | backend follows the share redirect only; no body is read | input | `maps.app.goo.gl`, `google.com/maps` | none | n/a | `backend/app/services/maplink.py:1-21` |
| manager CSP (candidate, security lane) | — | — | `img-src`/`connect-src` allow `tile.openstreetmap.org`, `s3.amazonaws.com` | — | — | `.runtime/production/repro/security/headers/vite.preview.csp.config.mjs:9-10` |

Nothing in either app's `src` references a satellite, building, rail, airport, waterway or offline-tile
source: `fill-extrusion`, `World_Imagery`, `mapbox.satellite`, `mbtiles`, `pmtiles`, `railway`,
`aerodrome` and `waterway` all return 0 matches outside tests (`basemap_code_audit.txt`).
PROVEN_BY_SOURCE.

## 3. Truthful layer status

STATUS values: `IMPLEMENTED`, `PARTIAL`, `NOT IMPLEMENTED`, `RASTER ONLY`. `RASTER ONLY` means the
feature appears only because the OSM Standard picture draws it: no data, no toggle, no query.
"Production" in the SOURCE column refers to the ledger's `PRODUCTION_TILE_USE_ALLOWED`.

| Layer | Manager | Driver | Source | STATUS | Evidence / label |
|---|---|---|---|---|---|
| STANDARD | MapLibre raster | Leaflet raster | OSM Standard tiles (production: NO) | IMPLEMENTED (demo terms only) | §2. PROVEN_BY_SOURCE |
| SATELLITE | — | — | none | **NOT IMPLEMENTED** | 0 imagery sources (AG-10). PROVEN_BY_SOURCE |
| TERRAIN | "Terrain" mode: hillshade from the AWS Terrarium DEM | relief overlay (MapTiler hillshade or OpenTopoMap), toggled with the hazard layer | AWS Terrain Tiles; MapTiler/OpenTopoMap | IMPLEMENTED (display) | `mapTerrain.ts:93-125`; `scene.ts:59-72`. PROVEN_BY_SOURCE |
| Route terrain classes (STEEP/HILLY stretches) | coloured over the planned route | coloured over the route | backend DEM (Open-Meteo elevation, OpenTopoData fallback). FLAT/ROLLING draw nothing; no data gives UNKNOWN, never FLAT | IMPLEMENTED | `terrain.ts:1-13`, `mapTerrain.ts:156-180`, `scene.ts:118-125`. PROVEN_BY_SOURCE |
| 3D | "3D" = `setTerrain(exaggeration 1.0)` + `pitch 55`. The label reads "Tilted, with the ground raised" | none (north-up, no rotation) | AWS Terrarium DEM | **PARTIAL: terrain tilt only, NOT buildings** | `mapTerrain.ts:74-77,116-119`; `FleetMap.tsx:878` (AG-12). PROVEN_BY_SOURCE |
| ROADS | as drawn in the raster | as drawn in the raster | OSM Standard | RASTER ONLY | No road source, no truck attributes on the map. The route itself comes from a different dataset (ROUTING_GRAPH_FRESHNESS §3.6) |
| BUILDINGS | footprints drawn in the raster at high zoom | same | OSM Standard | **NOT IMPLEMENTED** (RASTER ONLY footprints, no layer, no extrusion) | 0 `fill-extrusion` (AG-11). PROVEN_BY_SOURCE |
| POIs (all classes) | toggle chips; markers fetched by viewport (≤ 5° box) from `GET /api/places` | trip places from `/api/driver/me/trip/places` | bundled OSM snapshot via Overpass, retrieved **2026-09-20**, ODbL. The app never calls Overpass | PARTIAL | `PlacesLayer.tsx`, `PoiChips.tsx:15-21`, `places/snapshot.py:237-256`. PROVEN_BY_SOURCE |
| POI: FUEL (`amenity=fuel`) | yes | yes | snapshot | PARTIAL: 726 records | counts in `corridor_snapshot.json` |
| POI: EMERGENCY (hospital, clinic, police, fire_station) | yes | yes | snapshot | PARTIAL: 1,984 records | same |
| POI: TYRES (tyres, car_repair, vehicle_repair) | yes | yes | snapshot | PARTIAL: 325 records | same |
| POI: HOTEL (hotel, guest_house, motel) | yes | yes | snapshot | PARTIAL: 1,261 records | same |
| POI: REST (rest_area, services) | yes | yes | snapshot | PARTIAL: 70 records | same |
| POI coverage limits | — | — | — | — | Five problems: (1) **NER only**: 8 per-state bounding boxes, while the product is India-wide. (2) Capped at 400 per category per state, in `qt` order; Meghalaya EMERGENCY has exactly 400, which is consistent with truncation (INFERRED). (3) **Not clipped to India**: 53 records near Sylhet, BD, and 38 near Thimphu, BT. (4) No FUEL-specific freshness. (5) "Absence means NOT MAPPED" is stated in the snapshot. PROVEN_BY_SOURCE (`poi_hazard_data_checks.txt`) |
| RAIL | raster | raster | OSM Standard | **NOT IMPLEMENTED** (RASTER ONLY) | 0 references. PROVEN_BY_SOURCE |
| AIRPORTS | raster | raster | OSM Standard | **NOT IMPLEMENTED** (RASTER ONLY) | 0 references |
| WATERWAYS (rivers, IWAI NW-2/NW-16) | raster rivers | raster rivers | OSM Standard | **NOT IMPLEMENTED** (RASTER ONLY; no National Waterway or terminal layer) | 0 references |
| BOUNDARIES (country/state/district) | no data layer. The picker is a labelled SVG schematic | none | `country_boundaries` 0 rows; states/districts NULL geometry. The raster draws OSM's on-the-ground boundaries | **NOT IMPLEMENTED** (no authoritative layer; SoI blocked) | S10, C-09. Ledger §2.1, §2.3 |
| ROUTES | planned (dashed), observed track, isolated fixes; the trip review draws the previewed candidate | route with casing, driven part, backup (dashed) | own API. Geometry from public OSRM (`DEMO_ONLY`, ROUTING_GRAPH_FRESHNESS) | IMPLEMENTED | `FleetMap.tsx:345-438`; `scene.ts:100-117` |
| VEHICLES | truck markers from latest GPS | own position: GPS chevron/dot, NETWORK amber, LAST KNOWN grey, nothing when there is no fix | own API | IMPLEMENTED | `FleetMap.tsx:476`; `scene.ts:20-30` |
| HAZARDS | circles for historical landslides near the route | red dots "Recorded landslide (year)" | bundled NASA GLC slice, **2007-2017** (fetched 2026-09-11). 50 rows are labelled BT/MM/BD/CN and 108 have a blank country | IMPLEMENTED (historical inventory; not current incidents) | `TripRouteReview.tsx:482`; `MapScreen.tsx:857`; `backend/data/landslides/PROVENANCE.md` |
| TRAFFIC | thin stroke inside the route | same | own fleet GPS ("Fleet traffic"), KNOWN states only | IMPLEMENTED (fleet-derived; not live traffic) | `FleetMap.tsx:380-391`; `scene.ts:126-135` |
| ADVISORIES (official warnings) | **not drawn on the map**. Panels and cards match NDMA SACHET alerts to route districts and states by name (Nominatim reverse) | not drawn. The border-advisory banner never renders (NF-12) | NDMA SACHET | NOT IMPLEMENTED as a map layer | `backend/app/services/warnings.py:106-121`; NF-12 |
| OFFLINE_GUIDANCE | — | offline corridor package: route geometry, backup (if distinct), stops, risk snapshot with `captured_at` | own API | **PARTIAL** | `backend/app/services/offline_package.py:1-46`. OFFLINE_ROUTING (a new route offline) is not built |
| OFFLINE_BASEMAP | — | package says `basemap = BUNDLED_NONE`, reason `BASEMAP_NOT_BUNDLED_LICENCE` | none | **NOT IMPLEMENTED** | `offline_package.py:75,86` (AG-24). With no network on a cold start the native map cannot even load Leaflet |

## 4. Target architecture (MODELED)

The goal fixes two gaps at once. **One OSM snapshot, one data date, feeds three outputs: the
basemap, the routing graph and the POI layer.** Today the three come from three different dates, and
the app records none of them (ROUTING_GRAPH_FRESHNESS §3.6, §5). The design adds no new category of
service beyond what the routing plan already requires.

```
Geofabrik india-latest.osm.pbf   (osm_timestamp T; md5 checked; ROUTING_GRAPH_FRESHNESS §6.3 steps 1-4)
 ├─ OSRM truck.lua, MLD, --data_version=T          -> routing (ROUTING_GRAPH_FRESHNESS §6)
 ├─ Planetiler (OpenMapTiles schema) -> india-T.pmtiles   STANDARD vector basemap
 │     OSM admin_level=2 boundary lines are NOT emitted (see "Boundaries" below)
 ├─ osmium tags-filter (fuel, emergency, tyres, hotel, rest, aerodrome, railway stations, waterway terminals)
 │     -> places-T snapshot, clipped to the SoI India polygon  (MAP_DATA_CONFLATION_POLICY §3)
 └─ recorded as MAP_DATA_VERSION = T and shown in the attribution: "© OpenStreetMap contributors (ODbL) · data <T>"

SoI OVSF/1M/7 (after the user download) -> PostGIS country/states/districts -> boundary overlay (own
    PMTiles/GeoJSON). The ONLY international boundary the product draws

AWS Terrarium DEM, India bbox z<=12 -> mirrored terrain PMTiles -> manager Terrain/3D, driver hillshade
    (replaces OpenTopoMap and the MapTiler dependency)

Optional, behind an owner decision: SATELLITE = own Sentinel-2 mosaic (licence-clean, coarse) or a paid
    provider after legal review (ledger §3 item 5). BUILDINGS = Overture buildings theme (ODbL) in the
    same style; fill-extrusion only where a height exists

Serving: object storage + CDN, Mumbai region (docs/INDIA_HOSTING_DECISION.md), on the product's own origin
Clients: manager MapLibre GL (already) + the pmtiles protocol. The driver WebView loads MapLibre GL JS
    from a LOCAL asset (not unpkg), so the same style renders on both apps
Offline: per-corridor PMTiles extracts (NER corridors first), downloaded with the offline package.
    Allowed because the tiles are our own, built from ODbL data -> OFFLINE_BASEMAP becomes buildable
```

Each decision, and why it is the smallest safe one:

| Decision | Why | Alternative kept open |
|---|---|---|
| Self-host PMTiles built from the routing extract | It removes the OSM tile-policy problem, the UA problem and the data-date mismatch in one move. PMTiles is one static file behind a CDN: no tile server process | A paid managed basemap (MapTiler Flex, ledger §2.11) as a stop-gap. It still carries the boundary question and a client key |
| Drop OSM `admin_level=2` lines from the style; draw SoI only | Guidelines clause xiii names SoI data as the standard for political maps of India (PROVEN_BY_DOC). OSM draws on-the-ground lines (PROVEN_BY_DOC). Until SoI is imported, **no** international boundary is drawn, and the map says "Boundaries: not shown (authoritative data not loaded)" | none: owner rule |
| MapLibre in both apps | The manager already uses it. Leaflet cannot render vector tiles | Raster tiles rendered server-side (more infrastructure) |
| Leaflet/MapLibre as a local asset in the driver | A cold start without network currently shows no map at all (§1) | — |
| Mirror the DEM | AWS Terrain Tiles has no SLA. The mirror is small and public-domain | Keep live AWS while the manager's use stays light |
| Satellite optional and labelled | No current feature depends on it. Foreign imagery needs legal review | Sentinel-2 own mosaic |

**Status after the target is built** (for the future certification to check, not a claim today):
STANDARD, TERRAIN, 3D-terrain, ROADS (vector, styled), POIs (India-wide, clipped), RAIL, AIRPORTS,
WATERWAYS (from OSM, as vector layers), BOUNDARIES (SoI), OFFLINE_BASEMAP (corridor packs).
SATELLITE and BUILDINGS-3D stay NOT IMPLEMENTED until their decision is made.

**Gates before the switch.** Each is a check, not code in this lane:

1. The `data_version` stored on routes equals the basemap's `MAP_DATA_VERSION` for the same build.
2. No tile request leaves the product's own origin. CSP `img-src`/`connect-src` list only the own tile
   origin and the API.
3. The attribution shows OSM (linked, ODbL), SoI (when imported), the DEM credit and the data date.
4. An India view at z4-z6 draws no OSM `admin_level=2` line.
5. The driver map renders with networking disabled after one install, using the local library and one
   downloaded corridor pack.

## 5. Privacy of private overlays

**What third parties can see today.** PROVEN_BY_SOURCE for the request targets. The inference about
what can be reconstructed is INFERRED.

| Recipient | Request | What it can learn |
|---|---|---|
| `tile.openstreetmap.org` (OSMF) | every basemap tile (`z/x/y`), with client IP, UA, Referer and time | The viewport. In the driver's follow mode the camera sits at z13 on the truck (`FOLLOW_ZOOM = 13`, `DriverRouteMap.native.tsx:52,197`). A z13 tile is about 4.4 km wide at 26°N, so the tile sequence traces the truck's path and timing, keyed by the phone's IP (INFERRED) |
| `api.maptiler.com` / `tile.opentopomap.org` | hillshade tiles when hazards are shown | Same viewport information. MapTiler also receives the project's key |
| `s3.amazonaws.com` | DEM tiles in manager Terrain/3D | Manager viewport |
| `unpkg.com` | Leaflet JS/CSS at WebView load | Device IP, once per cold load |
| Google | only when the driver taps "navigate in Google Maps", which sends the destination | The destination address/coordinates, by user action |

**What is not sent.** Route geometry, GPS fixes, stops, customer addresses, driver identity and trip
codes are rendered client-side as MapLibre GeoJSON sources or Leaflet vectors, from the project's own
API (`FleetMap.tsx:345-438`, `scene.ts`). Tile URLs carry only `z/x/y`, plus the MapTiler key where
that source is used. PROVEN_BY_SOURCE.

**Rules for the target** (MODELED):

1. Tiles come from the product's own origin, so no third party receives viewports. The tile access
   log counts as **location data**: same retention and access rules as `gps_points`, and no user id in
   tile URLs or cookies on the tile host.
2. Private overlays (routes, fixes, stops, customer places, fleet traffic) never go into a
   third-party request, a tile URL, a style URL or a public PMTiles file. They stay behind the
   authenticated API, scoped by the existing RBAC.
3. A third-party map source is admitted only with the recipients table above filled in for it.
4. A client-side key (for example MapTiler) is origin/app-restricted and quota-capped at the provider.
   It is never treated as a secret, and nothing sensitive is authorised by it.
5. Offline corridor packs hold only public basemap data. Trip data stays in the existing offline
   package, with its `captured_at` staleness rules.

## 6. What was not done

- No code, style, CSP or configuration change. The target is a design.
- No tile server, PMTiles build or Planetiler run. None of the sizing in §4 is measured.
- No device or browser run in this lane. The failure modes in §1 are read from source, and the
  request headers the WebView actually sends were not captured.
