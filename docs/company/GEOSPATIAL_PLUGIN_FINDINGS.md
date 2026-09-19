# Geospatial plugin findings: RASTA AI (SIH26002)

Lane: plugins-geo-docs (Geospatial Lead + Documentation). Written 26 Sep 2026.

Code read: local `main` at 5b5e474 plus the uncommitted working tree. In this document "hosted" means commit e4043ce (origin/main, served by Render). Where a finding differs between the two, both are given.

This lane was read-only. I made no code edits, sent no requests to hosted Render or Supabase, and ran no migrations. Section 11 lists one rule deviation.

## 0. Labels

Every claim carries exactly one label: PROVEN_BY_TEST, PROVEN_BY_RUNTIME, PROVEN_BY_DATABASE, PROVEN_BY_SOURCE (file:line), PROVEN_BY_WEB (a URL I actually fetched in this run), INFERRED, NOT_VERIFIED or BLOCKED. An INFERRED or NOT_VERIFIED item is not a fact, and UNKNOWN never means SAFE.

Two notes on web evidence:
- A PROVEN_BY_WEB item marked "(MCP)" came from the Mapbox docs MCP tool, which returned the full page text.
- A PROVEN_BY_WEB item marked "(WebFetch)" came through a summarising fetch. For those, the wording is the fetch tool's summary of the page, not my own full read of it.

---

## 1. Plugin ledger

### 1.1 Mapbox skills: mapbox-maplibre-migration, mapbox-web-performance-patterns, mapbox-navigation-patterns, mapbox-cartography

| Field | Value |
|---|---|
| PLUGIN | `mapbox` 1.0.0 (claude-plugins-official), four skills |
| OWNER_ROLE | Geospatial Lead |
| TASK | Use the skills' checklists to judge migration cost, map performance, the navigation-product choice and layer order in the current maps |
| WHY_RELEVANT | The manager map runs on MapLibre GL JS 6.6.0, which is the library the migration skill describes. The performance and cartography checklists apply unchanged because the two libraries share their API. |
| INPUT | `C:/Users/patel/.claude/plugins/cache/claude-plugins-official/mapbox/1.0.0/skills/{mapbox-maplibre-migration,mapbox-web-performance-patterns,mapbox-navigation-patterns,mapbox-cartography}/SKILL.md`, each read in full (425, 357, 148 and 228 lines) |
| OUTPUT | I read each SKILL.md and applied its checklist myself (sections 4 to 6). I did **not** invoke the skills through the Skill tool. The skills produced no output of their own, so nothing here is "according to" a skill beyond the checklist items it names. The migration skill includes vendor-promotional statements such as "Superior Tile Quality" and "Best-in-class vector tiles". I did not adopt them. |
| EVIDENCE | Skill file paths above. Checklist results are in sections 4 to 6, each with its own label. |
| STATUS | USED_AND_USEFUL |
| FOLLOW_UP | None |

### 1.2 Mapbox docs MCP (`mcp__plugin_mapbox_mapbox-docs__search_mapbox_docs_tool`, `get_document_tool`, `batch_get_documents_tool`)

| Field | Value |
|---|---|
| PLUGIN | `mapbox` docs MCP server |
| OWNER_ROLE | Geospatial Lead |
| TASK | Check Mapbox facts that matter for the NER: attribution rules, worldview, geocoding coverage, map-load billing, 3D terrain, React Native SDK status, offline limits, Directions API limits and truck parameters, Traffic tileset, Terrain-DEM |
| WHY_RELEVANT | The task asked for Mapbox versus the current open stack. The comparison has to rest on Mapbox's own documentation, not on memory. |
| INPUT | 11 searches. Pages fetched: `docs.mapbox.com/help/dive-deeper/attribution.md`, `help/glossary/worldview.md`, `help/dive-deeper/mapbox-data.md`, `help/dive-deeper/maps-internationalization.md`, `help/glossary/map-loads.md`, `mapbox-gl-js/example/add-terrain.md`, `help/glossary/maps-sdk-for-react-native.md`, `help/troubleshooting/manage-web-map-costs.md`, `android/maps/guides/offline.md`, `api/navigation/directions.md`, `data/tilesets/reference/mapbox-terrain-dem-v1.md`, `data/tilesets/reference/mapbox-traffic-v1.md` |
| OUTPUT | Quoted facts in sections 6 to 8, labelled PROVEN_BY_WEB (MCP) |
| EVIDENCE | The URLs above, fetched 26 Sep 2026 |
| STATUS | USED_AND_USEFUL |
| FOLLOW_UP | None |

### 1.3 Mapbox account MCPs (`plugin:mapbox:mapbox`, `plugin:mapbox:mapbox-devkit`)

| Field | Value |
|---|---|
| PLUGIN | `mapbox` account and devkit MCP servers |
| OWNER_ROLE | Geospatial Lead |
| TASK | Would be needed for any token-based evaluation (styles, tilesets, usage) |
| WHY_RELEVANT | Only needed if the team decides to run a Mapbox evaluation spike |
| INPUT | None. The session reported that both servers need OAuth, which a non-interactive session cannot complete. |
| OUTPUT | None. No token was requested, created or used. |
| EVIDENCE | Session notice listing both servers under "require authentication" |
| STATUS | NEEDS_USER_AUTH |
| FOLLOW_UP | Only if the user approves an evaluation spike. Authorise through `/mcp` in an interactive session. This research does not authorise any paid Mapbox service or any migration. |

### 1.4 Unity plugin (`unity-cli`; `optimize-web` partly)

| Field | Value |
|---|---|
| PLUGIN | Unity plugin (`.../rpm/plugin_014AH5hoCLbfMtN3eRfR7BYD/skills/unity-cli/SKILL.md`) |
| OWNER_ROLE | Geospatial Lead |
| TASK | Produce UNITY_FEASIBILITY for a 3D terrain or training-simulation idea (section 9) |
| WHY_RELEVANT | The task explicitly asked for this |
| INPUT | `unity-cli/SKILL.md`, read in full (449 lines). `optimize-web/SKILL.md` was searched with grep, not read in full. |
| OUTPUT | Requirements taken from the skill: a Unity 6 editor, a CLI installed through a vendor script, and a sign-in and licence. Local check: `which unity` found nothing and `C:/Program Files/Unity` does not exist [PROVEN_BY_RUNTIME]. No Unity project was created. |
| EVIDENCE | Section 9 |
| STATUS | USED_NO_ACTION |
| FOLLOW_UP | None, because the recommendation is REJECT |

### 1.5 PDF Viewer plugin (`mcp__plugin_pdf-viewer_pdf__list_pdfs`)

| Field | Value |
|---|---|
| PLUGIN | `pdf-viewer` |
| OWNER_ROLE | Documentation |
| TASK | Open the project PDFs for `PDF_EVIDENCE_MATRIX.md` |
| WHY_RELEVANT | The PDF lane |
| INPUT | `list_pdfs` |
| OUTPUT | `{"localFiles":[],"allowedDirectories":[]}`. No local directory is allowed, so the tool cannot open the repository or Downloads PDFs. [PROVEN_BY_RUNTIME] |
| EVIDENCE | The tool result above |
| STATUS | BLOCKED |
| FOLLOW_UP | Text extraction used PyMuPDF 1.28.2, which was already installed in the system Python 3.11. Nothing was installed. Details are in `PDF_EVIDENCE_MATRIX.md`. |

Tools used that are not plugins: git, PyMuPDF, the project's existing Vitest binaries, the backend virtualenv's Python, and WebFetch. I fetched 8 public pages with WebFetch: the OSM tile policy, the OSRM demo-server policy, the Nominatim policy, OpenTopoMap, MapTiler pricing, AWS Terrain Tiles, the tilezen/joerd attribution page, and Protomaps downloads. I also fetched the DST 2021 geospatial guideline PDF, which WebFetch could not parse. It saved the file to the session's tool-results folder and I extracted its text with PyMuPDF. I also fetched the Mapbox pricing page (www.mapbox.com/pricing).

---

## 2. Current geospatial stack: layer architecture

| # | Layer | What it is | Where | Hosted e4043ce | Label |
|---|---|---|---|---|---|
| L1 | Manager renderer | MapLibre GL JS 6.6.0, licence BSD-3-Clause | `manager-web/package.json:18`; installed version and licence from `manager-web/node_modules/maplibre-gl/package.json` | same | PROVEN_BY_SOURCE |
| L2 | Manager base map | OSM **raster** tiles from `tile.openstreetmap.org`, inline style, attribution "© OpenStreetMap contributors" | `manager-web/src/components/FleetMap.tsx:81-94` | same | PROVEN_BY_SOURCE |
| L3 | Manager data layers | GeoJSON line and circle layers, bottom to top: planned route (dashed #2563EB), terrain overlay, traffic overlay, hazard sites, observed track, isolated fixes. Trucks are DOM markers and are drawn only when a real position exists. | `FleetMap.tsx:263-367`, `:386-412` | same | PROVEN_BY_SOURCE |
| L4 | Manager terrain / 3D | `raster-dem` from AWS Terrain Tiles (terrarium encoding, maxzoom 13), hillshade layer, `setTerrain` exaggeration 1.0, pitch 55. Any failure falls back to 2D. | `manager-web/src/components/mapTerrain.ts:47-56, :66, :69, :85-130` | **absent**: the file is untracked in the working tree (`git cat-file -e e4043ce:...mapTerrain.ts` fails) | PROVEN_BY_SOURCE |
| L5 | Manager roadside POIs | Viewport query, 400 ms debounce, DOM markers with a Popup each. The server caps results at 60 and bounding boxes at 5 degrees. | `manager-web/src/components/PlacesLayer.tsx:95-162`; `backend/app/domain/places.py:100,104` | **absent** (untracked) | PROVEN_BY_SOURCE |
| L6 | Manager address picker map | A second MapLibre map using the same OSM style, used for pin-drop | `manager-web/src/components/AddressPicker.tsx:687-712` | same | PROVEN_BY_SOURCE |
| L7 | Manager decorative "maps" | `NorthEastMap.tsx` is a **hand-drawn schematic** of the 8 states (aria-hidden, used on the login state picker). `TerrainScene.tsx` is decorative vector art. Neither is geodata. | `NorthEastMap.tsx:1-17`, `TerrainScene.tsx:1-14`; `pages/LoginPage.tsx:591` | **absent** (both untracked) | PROVEN_BY_SOURCE |
| L8 | Driver renderer (Android/iOS) | Leaflet 1.9.4 (BSD-2-Clause) loaded from unpkg inside `react-native-webview` 13.16.1. The WebView page draws the scene. | `driver-app/src/map/DriverRouteMap.native.tsx:1-10, :46-75`; `driver-app/package.json:22,28` | same, but **without SRI** on the unpkg assets | PROVEN_BY_SOURCE |
| L9 | Driver renderer (web build) | Leaflet imported directly, static and live layers drawn in separate passes | `DriverRouteMap.web.tsx:43-44, :187-226` | same | PROVEN_BY_SOURCE |
| L10 | Driver base map | OSM raster tiles from `tile.openstreetmap.org` | `DriverRouteMap.native.tsx:60`, `DriverRouteMap.web.tsx:125-128` | same | PROVEN_BY_SOURCE |
| L11 | Driver relief overlay | MapTiler hillshade (`api.maptiler.com/tiles/hillshade`) when `EXPO_PUBLIC_MAPTILER_KEY` is set at build time. Otherwise OpenTopoMap. | `driver-app/src/map/scene.ts:65-78` | MapTiler if the key is set, otherwise **no relief** (`HILLSHADE_URL` could be null) | PROVEN_BY_SOURCE |
| L12 | Where the MapTiler key comes from | The variable **name** appears only in the git-ignored `driver-app/.env`. It is not in `eas.json`, and I printed no value. Whether the shipped APK or the hosted driver-web build contains the key is not established. | `driver-app/.gitignore:5`; eas.json env names per profile | n/a | NOT_VERIFIED |
| L13 | Routing | OSRM. `ROUTING_PRIMARY_URL` is optional; the fallback is the public demo server `router.project-osrm.org` with an 8 s timeout, `overview=full` when detailed, and alternatives as a count. | `backend/app/core/config.py:181-183`; `backend/app/services/routing/osrm.py:78, :148-169` | same | PROVEN_BY_SOURCE |
| L14 | Geocoding | Nominatim public instance (Google Places when a key is set). Requests are serialised with a 1 s sleep, cached, and limited to `in,np,bt,bd,mm`. | `backend/app/services/geocoding.py:98-116, :148-163` | same | PROVEN_BY_SOURCE |
| L15 | POI data | A bundled Overpass snapshot. Working tree: 4,366 records, 8 per-state boxes, retrieved 2026-09-20. Hosted: 720 records covering only the Guwahati–Jorhat corridor, retrieved 2026-09-05, with **no FUEL category**. | `backend/app/services/places/data/corridor_snapshot.json` (keys `source`, `coverage`, `counts`); `git show e4043ce:` of the same file | differs | PROVEN_BY_SOURCE |
| L16 | Elevation for risk (backend) | Open-Meteo elevation (Copernicus DEM GLO-90), with OpenTopoData SRTM 30 m as fallback | `config.py:265-282`; `services/terrain.py` | same | PROVEN_BY_SOURCE |
| L17 | Service region gate | A lat/lon **rectangle**: south 21.5, north 29.5, west 88.0, east 97.5 | `backend/app/schemas/domain.py:281-290` | same | PROVEN_BY_SOURCE |
| L18 | Administrative geography | Migration 0013 seeds the 8 state names. There are **no district rows and no boundary geometry**. | `backend/alembic/versions/0013_state_district_inbox.py:9-18` | not applied (hosted DB is at 0012) | PROVEN_BY_SOURCE |
| L19 | Offline basemap | `basemap: BUNDLED_NONE`, a deliberate choice because the OSM tile policy forbids prefetch | `backend/app/services/offline_package.py:26-33`; `backend/app/api/driver.py:617-621` | same | PROVEN_BY_SOURCE |

The map tests in the working tree pass:
- manager `mapTerrain.test.ts` and `terrain.test.ts`: 2 files, 19 tests [PROVEN_BY_TEST];
- driver `scene.test.ts`, `hillshadeSource.test.ts`, `subresourceIntegrity.test.ts` and `terrainOverlay.test.ts`: 4 files, 21 tests [PROVEN_BY_TEST].

Both ran on 26 Sep 2026 with the local Vitest binaries.

---

## 3. Route rendering

1. **Planned and observed routes are drawn so they cannot be confused.** The planned route is a dashed blue line under the observed track, which is solid dark ink. A GPS gap is cut rather than bridged: isolated fixes are drawn as points, and the legend says "A gap is not a road". [PROVEN_BY_SOURCE `FleetMap.tsx:263-283, :333-367, :432-468, :821-823`] This follows the cartography skill's rule that the app's own data sits above the base map. I checked that by reading the code.
2. **The driver scene has one builder shared by both platforms.** Draw order: casing, route, driven part (live), backup dashed, terrain, traffic, hazards, stops, position, places last. [PROVEN_BY_SOURCE `driver-app/src/map/scene.ts:115-176`]
3. **The native WebView redraws the whole scene on every change. This is a defect.**
   - `scene.ts` says the static and live sets are redrawn separately "so a 4,000-point polyline is not torn down and rebuilt each time the phone reports where it is" [PROVEN_BY_SOURCE `scene.ts:99-106`].
   - The web renderer does this [PROVEN_BY_SOURCE `DriverRouteMap.web.tsx:187-226`].
   - The native renderer does not. On any change, including every new position, it serialises the **whole** layer list and injects `window.scene(...)` [PROVEN_BY_SOURCE `DriverRouteMap.native.tsx:128-136`]. The page then removes and rebuilds every Leaflet layer [PROVEN_BY_SOURCE `DriverRouteMap.native.tsx:62-71`].
   - The same code is on hosted e4043ce [PROVEN_BY_SOURCE `git show e4043ce:driver-app/src/map/DriverRouteMap.native.tsx:53,122`].
   - The Day 2 Task 1 PDF reports a 4,341-point, 98.82 km route geometry for the demo trip [PROVEN_BY_SOURCE `RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.pdf` p7].
   - The route is pushed twice (casing and line), so each position fix crosses the bridge carrying roughly 8,700 coordinate pairs [INFERRED]. The phone-side cost is not measured [NOT_VERIFIED].
4. **Route alternatives are not invented.** Extra OSRM options are kept only when they form a distinct corridor, as EMERGENCY_BACKUP, capped at 2. FUEL_EFFICIENT routes are never produced. [PROVEN_BY_SOURCE `backend/app/services/routes.py:8-20`]

---

## 4. Terrain and 3D feasibility

| Item | Finding | Label |
|---|---|---|
| Existing 3D | MapLibre `setTerrain` (exaggeration 1.0, pitch 55) over AWS terrarium DEM, with a hillshade under the route. Any failure returns to 2D and shows a message. | PROVEN_BY_SOURCE `mapTerrain.ts:85-130` |
| Tests | `mapTerrain.test.ts` passes (17 of the 19 manager tests above) | PROVEN_BY_TEST |
| Hosted | Not deployed. The terrain module is untracked; e4043ce has only the route terrain-class overlay. | PROVEN_BY_SOURCE |
| DEM detail | The AWS source is capped at maxzoom 13 in the config. Mapbox Terrain-DEM carries data "up to zoom 14". Neither DEM is survey-grade for road-cut geometry. | PROVEN_BY_SOURCE `mapTerrain.ts:54`; PROVEN_BY_WEB (MCP) `docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1.md` |
| What each DEM is built from | Mapbox: "Elevation data is not improved on a set schedule". The fetched page names no source for the NER. AWS/joerd: the project claims SRTM and GMTED2010 over the NER, but the joerd attribution page does not say which sources cover India. | NOT_VERIFIED |
| Mapbox 3D terrain | Available through `setTerrain` with `mapbox://mapbox.mapbox-terrain-dem-v1`. It needs a token and each map load is billed. | PROVEN_BY_WEB (MCP) `docs.mapbox.com/mapbox-gl-js/example/add-terrain.md`, `.../help/glossary/map-loads.md` |
| Conclusion | 3D terrain already works on the open stack and needs no vendor change | INFERRED |

---

## 5. Map performance (Mapbox performance checklist applied by me)

| Checklist item | Current code | Result | Label |
|---|---|---|---|
| Handle `map.on('error')` | FleetMap sets `mapError` and shows a banner | PASS | PROVEN_BY_SOURCE `FleetMap.tsx:257, :614` |
| Handle `map.on('error')` | AddressPicker map has no error handler, so a tile failure is silent | FAIL (minor) | PROVEN_BY_SOURCE `AddressPicker.tsx:687-712` |
| Call `map.remove()` on unmount | Both maps do | PASS | PROVEN_BY_SOURCE `FleetMap.tsx:371-376`, `AddressPicker.tsx:709-712` |
| Load map code lazily | `FleetMap` goes through `React.lazy`. But `AddressPicker.tsx:39` imports `maplibre-gl` directly and `:44` imports constants from `./FleetMap`, and TripsPage imports AddressPicker statically. So MapLibre ends up in the main chunk. | FAIL | PROVEN_BY_SOURCE `pages/FleetPage.tsx:50`, `TripRouteReview.tsx:9`, `AddressPicker.tsx:39,44`, `pages/TripsPage.tsx:37` |
| Bundle outcome | The existing `manager-web/dist/assets` build (dated 20 Sep, which may not match the current tree) has one 1,727,897-byte `index-*.js` plus a 477,721-byte worker, and no separate map chunk | Consistent with the row above | PROVEN_BY_SOURCE (file sizes in `manager-web/dist/assets`) |
| More than 100 markers: use GPU layers | Trucks are DOM markers, one per active trip. Places are DOM markers capped at 60 per answer. | PASS within the skill's "< 100 markers: HTML markers OK" threshold | PROVEN_BY_SOURCE `domain/places.py:104`, `PlacesLayer.tsx:114-130` |
| Reuse popups | PlacesLayer creates a new Popup for every marker on every load | Minor; acceptable at 60 | PROVEN_BY_SOURCE `PlacesLayer.tsx:122-128` |
| Debounce `moveend` | 400 ms debounce, with AbortController | PASS | PROVEN_BY_SOURCE `PlacesLayer.tsx:156-162, :97-99` |
| Defer non-critical layers | Terrain and hillshade are added only when the user picks the mode | PASS | PROVEN_BY_SOURCE `FleetMap.tsx:596-603` |
| Update data without rebuilding layers | GeoJSON `setData` on existing sources | PASS | PROVEN_BY_SOURCE `FleetMap.tsx:424-535` |
| No camera moves on poll | The camera follows selection only | PASS | PROVEN_BY_SOURCE `FleetMap.tsx:552-567` |
| Driver native redraw | Full teardown on every fix (section 3.3) | FAIL | PROVEN_BY_SOURCE |
| MapLibre worker | The worker URL is fixed statically and a build test checks it | PASS | PROVEN_BY_SOURCE `FleetMap.tsx:40-62`; test file `FleetMap.worker.build.test.ts` exists (not run by me) |

---

## 6. Attribution and licensing

| Source | Obligation (fetched) | Current state | Gap | Label |
|---|---|---|---|---|
| OSM standard tiles (`tile.openstreetmap.org`) | "visible licence attribution". Do not "hide attribution beneath UI, behind toggles". A unique app User-Agent and a valid Referer are required. "Offline use is not permitted". Access may be "withdrawn at any point". Commercial services "should be especially aware". | Attribution text is present in all four renderers. In the manager, `attributionControl: { compact: true }` (`FleetMap.tsx:254`, `AddressPicker.tsx:692`). In MapLibre 6.6.0, compact attribution collapses behind a toggle on the first map drag. | Attribution goes behind a toggle after the first drag | Policy: PROVEN_BY_WEB (WebFetch) https://operations.osmfoundation.org/policies/tiles/ ; behaviour: PROVEN_BY_SOURCE `manager-web/node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs:22698-22734` |
| OSM tiles in the driver WebView | Same policy as above | The WebView `baseUrl` is `https://driver.rasta.local/`, so the Referer is a non-resolvable local name. The User-Agent is the system WebView's. | May fail the "valid Referer" and "not a library default User-Agent" clauses | Code: PROVEN_BY_SOURCE `DriverRouteMap.native.tsx:191-192`; compliance: INFERRED |
| OSRM demo server | "Do not exceed 1 request per second". "reasonable, non-commercial use-cases". No uptime guarantees. | This is the only routing provider when no primary URL is set. No process-wide rate limiter was found in `osrm.py` or `base.py`. | Fine for the demo; not usable for a commercial or government pilot | Policy: PROVEN_BY_WEB (WebFetch) https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server ; code: PROVEN_BY_SOURCE `config.py:182`; no limiter: PROVEN_BY_SOURCE (grep of `backend/app/services/routing/*.py` for Semaphore/Lock/sleep/throttle found nothing) |
| Nominatim | At most 1 request/s, caching, a real User-Agent, and "Auto-complete search ... you must not implement such a service on the client side" | Server side is compliant: lock, 1 s sleep, cache, UA. The manager picker searches after a 700 ms typing pause once 3 or more characters are entered. | The search-as-you-type pattern may count as the autocomplete the policy forbids | Policy: PROVEN_BY_WEB (WebFetch) https://operations.osmfoundation.org/policies/nominatim/ ; code: PROVEN_BY_SOURCE `geocoding.py:98-116,157-163`, `AddressPicker.tsx:71,74,254-284`; compliance: INFERRED |
| Overpass snapshot (ODbL) | ODbL attribution | Attribution string stored in the snapshot and shown by the UI | None found | PROVEN_BY_SOURCE `corridor_snapshot.json` `source.attribution`; `FleetMap.tsx:682-687` |
| AWS Terrain Tiles (tilezen/joerd) | The attribution page gives a **full** list. It "does not specify that you may list only sources covering your displayed area". | Shortened to SRTM and GMTED2010, on the stated basis that the other sources contribute no pixel over the NER | The shortening is not supported by the licence page, and the coverage claim is unchecked | PROVEN_BY_WEB (WebFetch) https://github.com/tilezen/joerd/blob/master/docs/attribution.md ; code: PROVEN_BY_SOURCE `mapTerrain.ts:38-45` |
| MapTiler (driver hillshade) | FREE plan: "Suitable for testing, PoC, prototyping, personal, or non-commercial use". "MapTiler logo on the map" is required. On overage the service pauses. | Text link only ("© MapTiler") | No logo. Which plan the key is on is unknown [NOT_VERIFIED]. | Plan terms: PROVEN_BY_WEB (WebFetch) https://www.maptiler.com/cloud/pricing/ ; code: PROVEN_BY_SOURCE `scene.ts:72-73` |
| OpenTopoMap (driver fallback) | CC-BY-SA, attribution required, "no reliability guarantees", no heavy downloads | Attribution is present | None found. The server has limited capacity. | PROVEN_BY_WEB (WebFetch) https://opentopomap.org/about ; PROVEN_BY_SOURCE `scene.ts:74` |
| Mapbox (if ever adopted) | The logo **and** text attribution are required. With Leaflet or other libraries the Mapbox logo is "still required". The Maps SDK for Unity also needs the logo. | n/a | n/a | PROVEN_BY_WEB (MCP) https://docs.mapbox.com/help/dive-deeper/attribution.md |
| Government map rules (India) | DST guidelines of 15 Feb 2021, clause 8(xiii): "For political Maps of India of any scale including national, state and other boundaries, SoI published maps or SoI digital boundary data are the standard to be used". Clause 8(vii) and 8(ix): data finer than 1 m horizontal or 3 m vertical may be created and owned only by Indian Entities and must be stored in India. | `NorthEastMap.tsx` is a hand-drawn schematic, labelled as such, used for state picking. It is not a political map, but it does show state outlines. | Any real state or district boundary layer must use SoI data. Whether the 2021 text is still the current version was not checked. | Rule text: PROVEN_BY_WEB (WebFetch saved the PDF; text extracted with PyMuPDF) https://dst.gov.in/sites/default/files/Final%20Approved%20Guidelines%20on%20Geospatial%20Data.pdf ; currency: NOT_VERIFIED |

---

## 7. NER coverage caveats

1. **The service-region gate accepts points outside India.** `in_service_region()` returned True for all four test points: 23.81N 90.41E, 27.47N 89.64E, 22.00N 96.00E and 26.14N 91.74E [PROVEN_BY_RUNTIME, backend virtualenv, 26 Sep 2026]. The first three coordinates lie in Bangladesh, Bhutan and Myanmar respectively [INFERRED, general geography with no boundary data in the repo]. The gate is a rectangle, not state polygons [PROVEN_BY_SOURCE `schemas/domain.py:281-290`].
2. **The POI snapshot can contain cross-border records.** Acquisition used per-state rectangles that overlap neighbouring countries [PROVEN_BY_SOURCE `backend/scripts/acquire_places_snapshot.py:55-58`; snapshot `coverage.states`]. Example: the record named "Natherpetua Police Station" at 23.1109, 91.1150 [PROVEN_BY_SOURCE snapshot `places[100]`] is probably in Bangladesh [INFERRED]. The snapshot records carry no country tag (0 of 4,366 have `addr:country`) [PROVEN_BY_RUNTIME].
3. **Truncated Overpass queries cannot be detected from the file.** Each query was capped at `out center qt 400` [PROVEN_BY_SOURCE `acquire_places_snapshot.py:94,104`]. The file stores only per-category counts of new records after de-duplication, not the raw count for each query [PROVEN_BY_SOURCE `acquire_places_snapshot.py:184-197`]. Whether any state/category query hit 400 is unknown [NOT_VERIFIED].
4. **The snapshot module's docstring is stale.** It still says "The file holds 720 raw category records", but the working-tree file has 4,366 [PROVEN_BY_SOURCE `backend/app/services/places/snapshot.py:17`].
5. **Hosted POIs have no fuel stations.** The hosted snapshot (e4043ce) has no FUEL category and covers only Guwahati–Jorhat [PROVEN_BY_SOURCE `git show e4043ce:backend/app/services/places/data/corridor_snapshot.json`]. An empty fuel layer on hosted would mean "not collected", not "no fuel stations" [INFERRED].
6. **Mapbox geocoding lists no India coverage.** India does not appear in Mapbox's Geocoding/Search coverage table. The page adds that "Some data are available at a city level and do not appear in this list". [PROVEN_BY_WEB (MCP) https://docs.mapbox.com/help/dive-deeper/mapbox-data.md]
7. **Mapbox has an Indian worldview but no NER-relevant label languages.** Mapbox offers an `IN` worldview [PROVEN_BY_WEB (MCP) https://docs.mapbox.com/help/dive-deeper/maps-internationalization.md]. Its label-language list includes no Hindi, Assamese, Bengali or other Indian language [PROVEN_BY_WEB (MCP), same page]. How OSM standard tiles draw India's external boundary in the NER, compared with SoI, was not checked [NOT_VERIFIED].
8. **Mapbox traffic coverage in the NER is unknown.** The Traffic tileset "is built from de-identified sensor data" collected by Mapbox SDKs, and its road geometries are "based on OpenStreetMap" [PROVEN_BY_WEB (MCP) https://docs.mapbox.com/data/tilesets/reference/mapbox-traffic-v1.md]. Coverage in the NER was not checked [NOT_VERIFIED]. Mapbox road geometry in the NER would come from the same OSM base the project already uses [INFERRED].
9. **Mapbox truck parameters exist, but NER data for them is unknown.** The Directions API accepts `max_height`, `max_width` and `max_weight` on `driving` and `driving-traffic`, allows up to 25 waypoints and 300 requests per minute, and falls back to `driving` where there is no traffic coverage [PROVEN_BY_WEB (MCP) https://docs.mapbox.com/api/navigation/directions.md]. Whether NER roads carry the restriction data those parameters need was not checked [NOT_VERIFIED]. RASTA's own `truck_restrictions` risk factor is always NOT_AVAILABLE today [PROVEN_BY_SOURCE `backend/app/domain/route_risk.py:102-107` (`UNAVAILABLE_FACTORS`)].
10. **District geometry does not exist.** Migration 0013 has no district rows and no boundaries. The district data is a CANDIDATE only [PROVEN_BY_SOURCE `0013_state_district_inbox.py:9-18`].
11. **There is no offline basemap.** It is deliberately absent [PROVEN_BY_SOURCE `offline_package.py:26-33`]. The phone shows the cached route over a blank background when it has no connection [PROVEN_BY_SOURCE `DriverRouteMap.native.tsx:12-15`].

---

## 8. Current stack vs Mapbox vs other lawful options

Decisions: ADOPT_NOW means a small change inside the current stack, with no new vendor and no new dependency. ROADMAP means it needs a decision, money, data or a larger change. REJECT means not now.

| # | Capability | Current (evidence in section 2) | Mapbox option | Other lawful options | Decision | Why | Label |
|---|---|---|---|---|---|---|---|
| G1 | Manager renderer | MapLibre GL JS 6.6.0, BSD-3 | Mapbox GL JS v3 is proprietary. It needs a token and each Map initialisation is one billed load (free tier "Up to 50,000" per month). | Keep MapLibre | **ADOPT_NOW: keep MapLibre**; Mapbox GL JS **REJECT** | Migrating buys no NER-specific capability that was found. It adds a token, billing and telemetry. The skill itself says the APIs are about 95% the same, so the switch could be made later if ever needed. | PROVEN_BY_WEB (WebFetch) https://www.mapbox.com/pricing ; PROVEN_BY_WEB (MCP) map-loads page |
| G2 | Manager attribution | compact, collapses on drag | n/a | `attributionControl: { compact: false }` | **ADOPT_NOW** | Brings the maps in line with the OSM tile policy at no cost | PROVEN_BY_SOURCE `FleetMap.tsx:254`, `AddressPicker.tsx:692` |
| G3 | Base tiles (both clients) | `tile.openstreetmap.org` raster | Mapbox Vector or Raster Tiles APIs (free "Up to 200,000" vector or "Up to 750,000" raster tile requests per month) | Self-hosted NER extract as PMTiles from Protomaps builds: ODbL, "OpenStreetMap attribution required", planet about 120 GB, region extract through the CLI. Or a paid OSM-based tile service. | **ROADMAP** (before any pilot); Mapbox tiles **REJECT** for now | The OSM policy allows access to be withdrawn and warns commercial users. A self-hosted extract keeps ODbL terms and removes the third-party dependency. | PROVEN_BY_WEB (WebFetch) https://docs.protomaps.com/basemaps/downloads ; PROVEN_BY_WEB (WebFetch) Mapbox pricing |
| G4 | Offline basemap | none (BUNDLED_NONE) | Mapbox mobile offline tile regions: limit of 750 unique tile packs; Maps SDK free for "Up to 25,000" monthly active users | Own NER PMTiles pack, lazily cached. Needs a renderer that can read it: MapLibre Native, or a Leaflet or WebView plugin. | **ROADMAP**; Mapbox offline **REJECT** now | This is a real gap for dead zones, but the licensed-data and renderer choice is a product decision | PROVEN_BY_WEB (MCP) https://docs.mapbox.com/android/maps/guides/offline.md ; plugin feasibility: NOT_VERIFIED |
| G5 | Driver renderer | Leaflet in WebView, chosen because Expo Go cannot run native map SDKs (team's own rationale) | rnmapbox is "community-maintained"; "Mapbox is unable to provide formal support". It wraps the native SDKs. | MapLibre React Native, which needs a dev or EAS build | Leaflet **ADOPT_NOW: keep, and port the static/live split to the WebView page**; rnmapbox **REJECT**; MapLibre Native **ROADMAP** (only together with G4) | The fix in section 3.3 is small and local. A native SDK is a platform change. | PROVEN_BY_WEB (MCP) https://docs.mapbox.com/help/glossary/maps-sdk-for-react-native.md ; rationale: PROVEN_BY_SOURCE `DriverRouteMap.native.tsx:4-10` |
| G6 | Terrain / 3D (manager) | AWS terrarium plus MapLibre `setTerrain` (not hosted yet) | Mapbox Terrain-DEM v1 up to z14, needs a token | Keep AWS. Fix its attribution. | **ADOPT_NOW** (keep, full joerd attribution); Mapbox DEM **REJECT** | Already built and tested. Mapbox adds cost for one extra zoom level. | PROVEN_BY_TEST (19 tests); PROVEN_BY_WEB (WebFetch) joerd attribution |
| G7 | Driver hillshade | MapTiler (key) or OpenTopoMap | n/a | Keep OpenTopoMap, or add the MapTiler logo on a plan that allows the use | **ADOPT_NOW**: confirm the MapTiler plan, then either show the logo or remove the key | The FREE plan requires the logo and excludes commercial use | PROVEN_BY_WEB (WebFetch) MapTiler pricing; plan: NOT_VERIFIED |
| G8 | Routing | Public OSRM demo | Directions API: `driving-traffic`, truck parameters, free "Up to 100,000" requests per month, 300 per minute | Self-hosted OSRM, or Valhalla with an NER extract, through the existing `ROUTING_PRIMARY_URL` slot | Self-host **ROADMAP**; Mapbox Directions **ROADMAP (evaluation only, needs user approval and auth)** | The demo server policy is non-commercial at 1 request/s. Mapbox truck parameters could fill the `truck_restrictions` gap only if NER restriction data exists. The code deliberately has no key setting for a keyed router; a provider class would be needed. | PROVEN_BY_WEB (WebFetch) OSRM demo policy; PROVEN_BY_WEB (MCP) directions.md; PROVEN_BY_SOURCE `config.py:167-181` |
| G9 | Turn-by-turn | OSRM steps plus device TTS | Navigation SDK (native, billed per MAU or trip; free "Up to 100" MAU / "Up to 1,000" trips for metered) | Keep | **REJECT** (Mapbox Nav SDK) | Native-only and billed. Nothing shown that the current guidance lacks for the demo. | PROVEN_BY_WEB (WebFetch) pricing; skill `mapbox-navigation-patterns` (read) |
| G10 | Geocoding | Nominatim (public) | Mapbox Geocoding: India absent from the coverage table | Nominatim with search on explicit submit; self-hosted Nominatim later | Explicit submit **ADOPT_NOW**; Mapbox geocoding **REJECT** | Policy risk (section 6); no documented Mapbox coverage in India | PROVEN_BY_WEB (MCP) mapbox-data.md; PROVEN_BY_WEB (WebFetch) Nominatim policy |
| G11 | POIs | Overpass snapshot (ODbL) | Mapbox Search / POIs: coverage in India not documented | Keep the snapshot. Store raw per-query counts. Fix the stale docstring. | **ADOPT_NOW** (counts, docstring); cross-border filter **ROADMAP** (needs verified boundaries) | Lawful, offline-friendly, labelled as a snapshot | PROVEN_BY_SOURCE `acquire_places_snapshot.py:184-197`, `snapshot.py:17` |
| G12 | Boundaries and region gate | Rectangle gate; hand-drawn schematic | Mapbox Boundaries is a premium tileset; the `IN` worldview exists | SoI digital boundary data (DST 2021, 8(xiii)) | **ROADMAP**; Mapbox Boundaries **REJECT** | Government boundary depiction must follow SoI. No verified boundary set is in the repo, and none should be hand-drawn. | PROVEN_BY_WEB (WebFetch) DST guideline; PROVEN_BY_WEB (MCP) mapbox-data.md |
| G13 | Traffic | Own fleet probes, UNKNOWN below 2 vehicles | Mapbox Traffic v1 (SDK telemetry; NER coverage unknown) | Keep | **REJECT** (Mapbox Traffic) | Coverage unverified. Sending location data to a vendor needs a privacy review first. | PROVEN_BY_WEB (MCP) mapbox-traffic-v1.md |
| G14 | Manager bundle | MapLibre in the main chunk (section 5) | n/a | Move `NER_CENTRE`, `NER_ZOOM` and `OSM_STYLE` into a small module and lazy-load the pin-drop map | **ADOPT_NOW** | Smaller first load; no dependency change | PROVEN_BY_SOURCE `AddressPicker.tsx:39,44` |
| G15 | Driver native redraw | Full teardown on every fix | n/a | Two layer groups in the WebView page, matching `DriverRouteMap.web.tsx:187-226` | **ADOPT_NOW** | The web renderer already solved this | PROVEN_BY_SOURCE section 3.3 |

---

## 9. UNITY_FEASIBILITY

**Decision: REJECT** for the current product and cycle.

Reasons:

1. **3D terrain inspection is already built on the web stack.** MapLibre `setTerrain` with hillshade and a 2D fallback exists and is tested [PROVEN_BY_SOURCE `mapTerrain.ts:85-130`; PROVEN_BY_TEST 17 terrain tests]. Unity would duplicate it in a second runtime.
2. **Nothing needed for Unity is installed.** The CLI is absent and no editor is installed [PROVEN_BY_RUNTIME]. The skill's install path is a vendor script plus sign-in and a licence [PROVEN_BY_SOURCE `unity-cli/SKILL.md` "Install the CLI"]. This lane is not allowed to download software.
3. **Delivery cost is high for the field device.** The Unity web-build skill lists a 2048 MB default maximum memory and iOS memory limits [PROVEN_BY_SOURCE `optimize-web/SKILL.md:164,194`; grep only, not a full read]. The driver app is an Expo APK that already embeds a WebView map [PROVEN_BY_SOURCE]. A Unity runtime is a second platform to build, sign and test [INFERRED].
4. **The terrain data would not support a training simulator.** Available DEMs are SRTM 30 m, GLO-90 and tile DEMs to z13 or z14 (sections 4 and 2). A road-level driving simulation would need finer terrain and road geometry [INFERRED]. Under DST 2021, 8(vii) and 8(ix), data finer than 1 m horizontal or 3 m vertical must be created and owned by Indian Entities and stored in India [PROVEN_BY_WEB (WebFetch) DST PDF], which constrains any hi-res sourcing.
5. **There is no validated user need.** No training-simulation requirement appears in the problem statement or in the PDFs reviewed. The 19 Sep master-prompt PDF told the team not to turn work into "a new map provider, 3D project" [PROVEN_BY_SOURCE `RASTA_FINAL_UI_VALIDATION_LANDSLIDE_DATA_GITHUB_AUDIT_MASTER_PROMPT.pdf` p2].
6. **Mapbox also has a Maps SDK for Unity.** Its logo and attribution rules would apply if this idea is ever revived [PROVEN_BY_WEB (MCP) attribution.md].

Revisit only as a separate funded project, with a named training user, a data licence and a device budget [INFERRED].

---

## 10. Findings register (most severe first)

| ID | Finding | Where | Severity | Decision | Label |
|---|---|---|---|---|---|
| GEO-01 | Manager OSM attribution collapses behind a toggle after the first drag, which conflicts with the OSM tile policy | `FleetMap.tsx:254`, `AddressPicker.tsx:692` | Medium (licence) | ADOPT_NOW | PROVEN_BY_SOURCE |
| GEO-02 | The public OSRM demo server is the only routing provider. Its policy allows non-commercial use only, at 1 request/s, with no guarantee. | `config.py:182` | Medium for a pilot (low for the demo) | ROADMAP | PROVEN_BY_WEB (WebFetch) OSRM wiki |
| GEO-03 | `tile.openstreetmap.org` is the base map for both clients and allows no offline use. The driver has no offline basemap. | `FleetMap.tsx:86`, `DriverRouteMap.native.tsx:60`, `offline_package.py:26-33` | Medium for a pilot | ROADMAP | PROVEN_BY_SOURCE |
| GEO-04 | The service-region gate is a rectangle that accepts points in neighbouring countries | `schemas/domain.py:281-290` | Medium (correctness) | ROADMAP | PROVEN_BY_RUNTIME |
| GEO-05 | The native driver map re-sends and rebuilds the whole scene, including a route of about 4,341 points, on every change | `DriverRouteMap.native.tsx:62-71,128-136` | Medium (performance) | ADOPT_NOW | PROVEN_BY_SOURCE |
| GEO-06 | The terrain-tile attribution is shortened beyond what the joerd licence page allows | `mapTerrain.ts:38-45` | Low (licence) | ADOPT_NOW | PROVEN_BY_WEB (WebFetch) joerd page |
| GEO-07 | MapTiler hillshade shows text attribution, not the logo the FREE plan requires. The plan is unknown. | `scene.ts:72-73` | Low (licence) | ADOPT_NOW | PROVEN_BY_WEB (WebFetch) MapTiler pricing |
| GEO-08 | Nominatim search runs on a 700 ms typing pause, which may breach the ban on client-side autocomplete | `AddressPicker.tsx:71,254-284` | Low (policy) | ADOPT_NOW | INFERRED |
| GEO-09 | The POI snapshot has cross-border records and does not record whether queries were truncated | `acquire_places_snapshot.py:94,104,184-197` | Low (data quality) | ADOPT_NOW (counts) / ROADMAP (filter) | PROVEN_BY_SOURCE |
| GEO-10 | MapLibre is pulled into the manager's main chunk despite `React.lazy` | `AddressPicker.tsx:39,44` | Low (performance) | ADOPT_NOW | PROVEN_BY_SOURCE |
| GEO-11 | The WebView Referer is `https://driver.rasta.local/`, which may not satisfy the OSM "valid Referer" rule | `DriverRouteMap.native.tsx:191` | Low | ROADMAP (goes away with G3) | INFERRED |
| GEO-12 | The AddressPicker map has no error handler | `AddressPicker.tsx:687-712` | Low | ADOPT_NOW | PROVEN_BY_SOURCE |
| GEO-13 | The snapshot docstring says 720 records; the file has 4,366 | `snapshot.py:17` | Low (docs) | ADOPT_NOW | PROVEN_BY_SOURCE |
| GEO-14 | Hosted POIs contain no FUEL records and cover only one corridor | e4043ce snapshot | Low (demo) | Ships with the plan commits | PROVEN_BY_SOURCE |
| GEO-15 | The 3D and terrain modes and the manager places layer exist only in the working tree | `mapTerrain.ts`, `PlacesLayer.tsx` untracked | Info | Ships with the plan commits | PROVEN_BY_SOURCE |

All ADOPT_NOW items belong to the code-owning lanes. This lane made none of these edits.

---

## 11. Verification runs and deviations

- `manager-web/node_modules/.bin/vitest` (run as `npx vitest`, which resolved to the local binary): `mapTerrain.test.ts` and `terrain.test.ts`, 19 passed [PROVEN_BY_TEST].
- `driver-app/node_modules/.bin/vitest run src/map/{scene,hillshadeSource,subresourceIntegrity,terrainOverlay}.test.ts`: 21 passed [PROVEN_BY_TEST].
- `backend/.venv/Scripts/python.exe` called `in_service_region()` on four coordinates; all returned True [PROVEN_BY_RUNTIME].
- **Deviation from the "no downloading packages" rule.** A first attempt to run the driver tests used `npx jest`. Jest is not a project dependency, so npx downloaded it into the user npm cache at `C:/Users/patel/AppData/Local/npm-cache/_npx/b8d86e6551a4f492` (created 26 Sep 2026 17:56 IST). The run failed before executing any test. I then used the project's own Vitest. I did not delete the downloaded folder: it is outside the repository, and deleting it is the user's call.
- No request was sent to Render, Supabase or any hosted URL. No database was touched.

## 12. What not to do

- Do not migrate to Mapbox, or buy any Mapbox product, on the basis of this research. It found no NER-specific gain, and Mapbox's geocoding coverage table omits India.
- Do not bulk-download, prefetch or cache `tile.openstreetmap.org` tiles for offline use.
- Do not draw or seed state or district boundaries by hand. Use SoI data (DST 2021, 8(xiii)) once it has been obtained and verified.
- Do not send production or pilot routing traffic to `router.project-osrm.org`.
- Do not describe the manager map as "vector tiles"; the configured source is raster.
- Do not present the schematic `NorthEastMap` as geographic data.
- Do not start a Unity project.
- Do not put any tile or API key in a document, a commit, or `eas.json` in plain text. Refer to env var names only (for example `EXPO_PUBLIC_MAPTILER_KEY`).
