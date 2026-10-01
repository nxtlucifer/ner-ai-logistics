# Map data source ledger

Lane: docs-maps, fix round 1. Written 30 Sep 2026 against HEAD `5b5e474` plus the uncommitted working
tree. Documentation only: no source file, test, migration or configuration was changed. Evidence is in
`.runtime/production/fix1/docs-maps/`:

- `web_sources_read.tsv` lists every page read today, with its status.
- `terms_clause_extracts.txt` holds the clause text behind the PDF and JSON reads.
- `basemap_code_audit.txt` and `poi_hazard_data_checks.txt` hold the repository checks.

No tile, imagery or dataset was downloaded. Every request was one GET of a terms, documentation or
metadata page.

This ledger covers **map data**: basemaps, imagery, geography and map layers. Routing is in
`docs/ROUTING_GRAPH_FRESHNESS.md`. Weather, warnings and AI are in `docs/FINAL_SOURCE_ADMISSION_LEDGER.md`.
Where the two ledgers disagree, this one applies to **production** use. The 20 Sep ledger recorded demo
admission.

## 0. Labels and vocabulary

| Label | Meaning |
|---|---|
| `PROVEN_BY_SOURCE` | Read in this repository: code, config or a bundled data file (path given) |
| `PROVEN_BY_DOC(url)` | Read today on the publisher's page at that URL |
| `INFERRED` | Reasoned from the two above. It is not stated anywhere. Treat it as a claim to verify |
| `NOT_VERIFIED` | Nothing was read either way. For example, the page was blocked or JavaScript-only |

ADMISSION uses the statuses of `docs/FINAL_SOURCE_ADMISSION_LEDGER.md` (`ADOPT_NOW`, `OPTIONAL_KEYED`,
`VALIDATION_ONLY`, `RESEARCH_ONLY`, `REFERENCE_ONLY`, `BLOCKED`, `REJECT`) plus one more:

| Status | Meaning |
|---|---|
| `DEMO_ONLY` | Running code calls it today, but its terms do not cover a production fleet product. It must be replaced before production |

`PRODUCTION_TILE_USE_ALLOWED` answers one question: may a production RASTA build request this source's
tiles or imagery in its map for real users? Where the source is a dataset, not a tile service, the
answer says so. Two answers are possible for a dataset:

- `n/a (dataset)`: the source serves no tiles.
- `YES (as input to own tiles)`: its licence allows building tiles from it.

## 1. Summary

| # | Source | In code today | PRODUCTION_TILE_USE_ALLOWED | ADMISSION (production) |
|---|---|---|---|---|
| 1 | OpenStreetMap: data, and the Standard tile layer | Basemap in both apps. POI snapshot. Graph behind public OSRM | Tiles: **NO**. Data: YES (as input to own tiles) | Tiles `DEMO_ONLY`. Data `ADOPT_NOW` (through an own pipeline) |
| 2 | Overture Maps | No | n/a (dataset). YES (as input to own tiles) for non-boundary themes | `RESEARCH_ONLY` |
| 3 | Survey of India (OVSF/1M/7) | Importer only. 0 rows imported | n/a (dataset). Display is permitted (Guidelines clause xiii) | `BLOCKED` (`SOI_REAL_DATA = BLOCKED_USER_DOWNLOAD`) |
| 4 | Bhuvan / NRSC | No | **NO** | `RESEARCH_ONLY`. CartoDEM stays `BLOCKED` |
| 5 | data.gov.in (OGD, GODL) | No | n/a (tabular) | `VALIDATION_ONLY`, per dataset |
| 6 | MoRTH / NHAI | No | **NO** | `REFERENCE_ONLY` |
| 7 | AAI (eAIP India) | No | **NO** | `VALIDATION_ONLY` |
| 8 | IWAI | No | **NO** | `REFERENCE_ONLY` |
| 9 | Indian Railways (CRIS/FOIS) | No | **NO** | `REFERENCE_ONLY` |
| 10 | Copernicus Sentinel-2 | No | YES (as input to own tiles), inside CDSE quotas | `RESEARCH_ONLY` (needs a CDSE account) |
| 11 | MapTiler Cloud | Driver hillshade, when a key is built in | YES on a paid plan. **NO** on Free | `OPTIONAL_KEYED` |
| 12 | Mapbox Satellite | No | **NO** in the driver app as built. Manager: NOT_VERIFIED | `REJECT` for driver. `RESEARCH_ONLY` for manager |
| 13 | Google Maps Platform | Places client written, never executed. "Open in Google Maps" link | **NO** next to a non-Google map | `REJECT` (basemap). Places `OPTIONAL_KEYED` → review |
| 14 | Esri (World Imagery) | No | YES with a Location Platform account and attribution. Body terms NOT_VERIFIED | `RESEARCH_ONLY` |
| 15 | AWS Terrain Tiles (in code) | Manager Terrain and 3D DEM | YES (INFERRED), no SLA | `ADOPT_NOW` (mirror recommended) |
| 16 | OpenTopoMap (in code) | Driver relief fallback when there is no MapTiler key | **NO** (volunteer service, no availability guarantee) | `DEMO_ONLY` |

## 2. Per-source ledger

### 2.1 OpenStreetMap: data, and the Standard tile layer (`tile.openstreetmap.org`)

| Field | Value | Label |
|---|---|---|
| SOURCE | OSM data, and the OSMF Standard raster tile layer | — |
| PUBLISHER | Data: OpenStreetMap contributors. Tile service: OpenStreetMap Foundation (Operations) | PROVEN_BY_DOC(https://operations.osmfoundation.org/policies/tiles/) |
| URL | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. The policy says: "Use exactly" this URL, because "Other subdomains or hostnames may be slower or withdrawn" | PROVEN_BY_DOC(same) |
| VERSION_DATE | Data is continuous. The app cannot learn the render date of a tile, so it is UNKNOWN (`MAP_ROAD_DATE`, ROUTING_GRAPH_FRESHNESS §5). The policy page shows no version date. The Attribution Guidelines were last revised 10 Sep 2026 | PROVEN_BY_DOC(https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) |
| LICENSE | Data: Open Database License (ODbL). "If you alter or build upon our data, you may distribute the result only under the same license" | PROVEN_BY_DOC(https://www.openstreetmap.org/copyright) |
| ATTRIBUTION | Credit "OpenStreetMap" ("© OpenStreetMap contributors" is acceptable), linked to `openstreetmap.org/copyright`, and it "must also make it clear that the data is available under the Open Database License". Usually a map corner. It may collapse if an "(i)" control still reveals it. **Code today:** the plain text `© OpenStreetMap contributors`, with no link and no ODbL mention: `manager-web/src/components/mapSetup.ts:52`, `driver-app/src/map/DriverRouteMap.web.tsx:175`, `DriverRouteMap.native.tsx:70`. The manager uses `attributionControl: { compact: true }` (`FleetMap.tsx:331`, `MapPointPicker.tsx:65`), which is allowed | PROVEN_BY_DOC(Attribution_Guidelines) + PROVEN_BY_SOURCE |
| AUTH | None. Apps "must configure a distinct, stable `User-Agent` naming your app", must not "impersonate browsers or other apps" and must not use a library default. Web pages must send a valid Referer. **Code today:** the driver's native map is a `react-native-webview` page (`DriverRouteMap.native.tsx:238-251`) with **no `userAgent` / `applicationNameForUserAgent` prop**. It therefore requests tiles with the platform WebView's default UA, and its Referer comes from the page's `baseUrl` `https://driver.rasta.local/`, a hostname that does not exist. The manager is a normal web page (browser UA). Its descriptors set `Referrer-Policy: strict-origin-when-cross-origin`, which still sends the origin (`manager-web/vercel.json:35`, `netlify.toml:28`) | PROVEN_BY_DOC(tiles policy §3.4) + PROVEN_BY_SOURCE. The request headers the WebView actually sends were not captured: INFERRED |
| COST | Free. "Availability is best-effort: there is no SLA or guarantee" | PROVEN_BY_DOC(tiles policy) |
| RATE_LIMIT | No number is published. "We may block access, without notice, if your usage degrades the service". "Commercial services … should be especially aware that access may be withdrawn" | PROVEN_BY_DOC(tiles policy) |
| CACHE_POLICY | "Cache tiles locally according to HTTP caching headers (or at least 7 days…)". Never send `no-cache` by default | PROVEN_BY_DOC(tiles policy) |
| OFFLINE_POLICY | "Bulk downloading is any pre-emptive fetching of tiles other than those a user is actively viewing". "Download city/country for offline use" is prohibited. The code honours this: `offline_package.py:23-29,75,86` sends `BASEMAP_NOT_BUNDLED_LICENCE` / `BUNDLED_NONE` | PROVEN_BY_DOC + PROVEN_BY_SOURCE |
| UPDATE_FREQUENCY | Data: continuous. Tile re-render schedule: not published in what was read (UNKNOWN). Routing uses a separate copy, about 2 days old (ROUTING_GRAPH_FRESHNESS §1) | PROVEN_BY_DOC(routing.openstreetmap.de, via ROUTING_GRAPH_FRESHNESS §4) |
| INDIA_COVERAGE | World-wide, so India is included. Completeness varies by feature class and region and was not measured. The OSM India railway page calls historic rail coverage "quite poor" outside major urban areas | INFERRED + PROVEN_BY_DOC(https://wiki.openstreetmap.org/wiki/India/Railways) |
| NER_COVERAGE | Present. Completeness not measured by this lane | NOT_VERIFIED |
| PRODUCTION_TILE_USE_ALLOWED | **NO** for `tile.openstreetmap.org`. The reasons: no SLA; blockable without notice; commercial users warned; the native driver map does not identify itself as the policy requires. There is also a boundary issue: OSM follows the "on the ground" rule. Kashmir is mapped along the Line of Control, and alternative claims are "not rendered by the default style". The Geospatial Guidelines 2021 clause xiii make SoI boundary data "the standard to be used" for political maps of India. Whether a fleet basemap counts as a political map is a legal question for the owner (INFERRED risk). **OSM data**: YES, as input to own tiles, with attribution and ODbL share-alike on any derived database that is published | PROVEN_BY_DOC(https://wiki.openstreetmap.org/wiki/Disputed_territories) + PROVEN_BY_DOC(https://onlinemaps.surveyofindia.gov.in/GeospatialGuidelines.aspx) + INFERRED |
| WHAT_IT_SUPPORTS | Today, three things: the only STANDARD basemap in both apps; the POI snapshot (`corridor_snapshot.json`, via Overpass, ODbL); and, indirectly, the public OSRM graph | PROVEN_BY_SOURCE |
| LIMITATIONS | Raster only: no styling of road classes and no truck attributes on the map. The map and the route come from different data dates (ROUTING_GRAPH_FRESHNESS §3.6). Boundaries follow OSM, not SoI | PROVEN_BY_SOURCE + INFERRED |
| ADMISSION | Tile service: `DEMO_ONLY`. Data: `ADOPT_NOW`, as the input to a self-hosted basemap and graph (see `docs/MAP_PRODUCTION_ARCHITECTURE.md` §4) | — |

### 2.2 Overture Maps

| Field | Value | Label |
|---|---|---|
| SOURCE | Overture Maps Foundation open map data: themes addresses, base, buildings, divisions, places, transportation | PROVEN_BY_DOC(https://docs.overturemaps.org/blog/2026/09/23/release-notes/) |
| PUBLISHER | Overture Maps Foundation | same |
| URL | `s3://overturemaps-us-west-2/release/<RELEASE>` and `https://overturemapswestus2.blob.core.windows.net/release/<RELEASE>`. A STAC catalogue "always points to the latest release" | PROVEN_BY_DOC(https://docs.overturemaps.org/getting-data/cloud-sources/, https://docs.overturemaps.org/getting-data/) |
| VERSION_DATE | Latest `2026-09-23.1` (schema `v2.0.0`, a major release). Next scheduled `2026-10-21.0` | PROVEN_BY_DOC(https://docs.overturemaps.org/release-calendar/) |
| LICENSE | ODbL for base, buildings, divisions and transportation. Places: CDLA Permissive 2.0 (most sources), Apache 2.0 (Foursquare), CC0 (AllThePlaces). Addresses (alpha): mixed CC BY 4.0, CC0 and OGL, per source | PROVEN_BY_DOC(https://docs.overturemaps.org/attribution/) |
| ATTRIBUTION | "© OpenStreetMap contributors" for the ODbL themes. "Overture Maps Foundation, overturemaps.org" as the general citation. Per-source notices for addresses. Foursquare's notice file for its places | same |
| AUTH | None: anonymous S3 (`--no-sign-request`) | PROVEN_BY_DOC(cloud-sources) |
| COST | No licence fee. Egress and processing cost is not stated. It would be the project's own compute and transfer | PROVEN_BY_DOC + INFERRED |
| RATE_LIMIT | Not an API. No limit published | PROVEN_BY_DOC(cloud-sources) |
| CACHE_POLICY | Keeping a copy is inherent to a bulk dataset. The licence terms govern reuse | INFERRED |
| OFFLINE_POLICY | Allowed, because this is a bulk dataset. ODbL share-alike applies to a published derived database | INFERRED from the licences above |
| UPDATE_FREQUENCY | Monthly ("monthly data releases are tagged with the date") | PROVEN_BY_DOC(release-calendar) |
| INDIA_COVERAGE | Global. The 2026-09-23 notes carry no India-specific item. Buildings include Google Open Buildings and Microsoft ML Buildings (release notes); their India share was not read | PROVEN_BY_DOC(release notes) + NOT_VERIFIED |
| NER_COVERAGE | Not measured | NOT_VERIFIED |
| PRODUCTION_TILE_USE_ALLOWED | n/a (dataset). **YES (as input to own tiles)** for base, buildings, places and transportation. **NO** for India political boundaries: divisions are "as seen from a given political perspective", no India perspective is documented, and clause xiii names SoI data as the standard | PROVEN_BY_DOC(https://docs.overturemaps.org/guides/divisions/) + INFERRED |
| WHAT_IT_SUPPORTS | Nothing today. Candidates: BUILDINGS (footprints, and later extrusion where heights exist); POI augmentation with stable GERS ids; a transportation cross-check against the OSM extract; land and water for a self-built style | INFERRED |
| LIMITATIONS | Large GeoParquet. Schema v2 is a breaking change. The retention of old releases is unspecified ("an archive of releases is maintained"). Divisions are not SoI | PROVEN_BY_DOC(cloud-sources) |
| ADMISSION | `RESEARCH_ONLY`. First use would be the buildings theme in a self-hosted style | — |

### 2.3 Survey of India: OVSF/1M/7 (Administrative Boundary Database)

| Field | Value | Label |
|---|---|---|
| SOURCE | OVSF/1M/7, "Administrative Boundary Database", entire country, district level. The siblings are 1M/6 (taluk), 1M/9 and 1M/8 (per state) | PROVEN_BY_DOC(https://onlinemaps.surveyofindia.gov.in/Digital_Products.aspx) |
| PUBLISHER | Survey of India, Department of Science and Technology | PROVEN_BY_DOC(https://onlinemaps.surveyofindia.gov.in/AboutPortal.aspx) |
| URL | `https://onlinemaps.surveyofindia.gov.in/` (Online Maps Portal). A separate ABDB page on surveyofindia.gov.in lists a "State/District/Sub District_PAN INDIA.rar". It was **not downloaded**, and its terms are not stated there | PROVEN_BY_DOC(https://surveyofindia.gov.in/pages/administrative-boundary-data-base-abdb-) |
| VERSION_DATE | Scale 1:1M, format SHAPEFILE. Data vintage is not shown (UNKNOWN). The ABDB web page footer reads "Last Updated: 28-09-2026", which is a page date, not a data date | PROVEN_BY_DOC |
| LICENSE | No licence text appears on the product page, the FAQ or the pricing policy. The governing statement found is Guidelines 2021 clause xiii: SoI maps or SoI digital boundary data "are the standard to be used, which shall be made easily downloadable for free and their digital display and printing shall be permissible" | PROVEN_BY_DOC(https://onlinemaps.surveyofindia.gov.in/FAQs.aspx, …/PricingPolicy.aspx, …/GeospatialGuidelines.aspx) |
| ATTRIBUTION | Not specified on the pages read. Proposed: "Boundaries: Survey of India, OVSF/1M/7 (<download date>)" in the attribution control. That is an owner decision | INFERRED |
| AUTH | Portal registration. On the owner's record, the download needs a CAPTCHA and consent that only the user may perform (`AG-06`, `C-14`). The FAQ says Administrative Boundary products are "available free of cost to all users" | PROVEN_BY_DOC(FAQs) + owner decision |
| COST | ₹0 for OVSF/1M/6, /7, /8 and /9 | PROVEN_BY_DOC(Digital_Products) |
| RATE_LIMIT | n/a (a one-time download) | — |
| CACHE_POLICY | Keep the raw archive, hashed, outside the repository. Import into PostGIS (`country_boundaries`, `states`, `districts`, migration 0016) | PROVEN_BY_SOURCE (`backend/scripts/import_soi_boundaries.py`) |
| OFFLINE_POLICY | Display and printing are permissible (clause xiii). Nothing read restricts on-device use | PROVEN_BY_DOC + INFERRED |
| UPDATE_FREQUENCY | Not published (UNKNOWN). Proposal: re-check the product page quarterly and record `geometry_version` | INFERRED |
| INDIA_COVERAGE | Entire country, down to district level | PROVEN_BY_DOC |
| NER_COVERAGE | Included (part of the country product) | INFERRED |
| PRODUCTION_TILE_USE_ALLOWED | n/a (dataset). Rendering it as an own boundary overlay is permissible under clause xiii | PROVEN_BY_DOC(GeospatialGuidelines) |
| WHAT_IT_SUPPORTS | **Authority for geography (owner decision).** It feeds three things: outside-India refusal (422 `OUTSIDE_SUPPORTED_COUNTRY`), the not-yet-built route-crossing guard (`ROUTE_CROSSES_COUNTRY_BOUNDARY`), and the state/district scopes. Today `country_boundaries` has 0 rows and states and districts have NULL geometry, so every 0016 database refuses planning with 503 `GEOGRAPHY_UNAVAILABLE` (S10, C-17) | PROVEN_BY_SOURCE + PROVEN_BY_DATABASE (via ANTIGRAVITY_FINDINGS_REPRODUCTION) |
| LIMITATIONS | 1:1M generalisation, so a point near a border can fall on the wrong side. That is what `BORDER_AMBIGUOUS` (driven by GPS accuracy) exists for; FC-01 found the branch unreachable from the API today. `import_soi_boundaries.py` still has `FIELDS`/CRS "TODO(SoI schema)" (AX-20). Only `FIXTURE_*` synthetic geometry exists, in tests and scratch databases, and it must never be called production geography | PROVEN_BY_SOURCE |
| ADMISSION | `BLOCKED`: `SOI_REAL_DATA = BLOCKED_USER_DOWNLOAD` | — |

### 2.4 Bhuvan / NRSC (ISRO)

| Field | Value | Label |
|---|---|---|
| SOURCE | The Bhuvan geoportal, its OGC WMS/WMTS, and the NRSC Open EO Data Archive (NOEDA) | PROVEN_BY_DOC(https://bhuvan.nrsc.gov.in/wiki/index.php/How_to_use_WMS_services) |
| PUBLISHER | National Remote Sensing Centre, ISRO | same |
| URL | WMS `https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms` (v1.1.1). NOEDA `https://bhuvan-app3.nrsc.gov.in/data/download/index.php` | PROVEN_BY_DOC |
| VERSION_DATE | Per layer. For example, `lulc:BR_LULC50K_1112` is a 1:50,000 LULC layer | PROVEN_BY_DOC(WMS wiki) |
| LICENSE | The terms grant a "non-exclusive, non-transferable license to access the Bhuvan geo portal". You must not "Redistribute, sublicense … or otherwise make the content available to third parties". You must not access content "through any technology or means other than those provided by the Bhuvan portal" | PROVEN_BY_DOC(https://bhuvan.nrsc.gov.in/terms.php) |
| ATTRIBUTION | Not specified in the terms | PROVEN_BY_DOC(terms) |
| AUTH | WMS: none stated. NOEDA: login | PROVEN_BY_DOC |
| COST | Free portal. Commercial terms not stated | PROVEN_BY_DOC |
| RATE_LIMIT | Not stated | PROVEN_BY_DOC(WMS wiki) |
| CACHE_POLICY | Not addressed. The redistribution ban rules out a server cache shared by users | INFERRED |
| OFFLINE_POLICY | Same: no redistribution to devices | INFERRED |
| UPDATE_FREQUENCY | Per layer. Not stated | PROVEN_BY_DOC |
| INDIA_COVERAGE | National thematic layers (LULC, flood hazard, glacial lakes and others) | PROVEN_BY_DOC(WMS wiki) |
| NER_COVERAGE | Expected, because the layers are national. Not checked | INFERRED |
| PRODUCTION_TILE_USE_ALLOWED | **NO** | PROVEN_BY_DOC(terms) |
| WHAT_IT_SUPPORTS | Nothing today. Research context (flood hazard, LULC). CartoDEM through NOEDA | INFERRED |
| LIMITATIONS | Terms forbid third-party availability. No SLA | PROVEN_BY_DOC |
| ADMISSION | `RESEARCH_ONLY`. CartoDEM stays `BLOCKED` (registration), as in FINAL_SOURCE_ADMISSION_LEDGER §3 | — |

### 2.5 data.gov.in (Open Government Data Platform India)

| Field | Value | Label |
|---|---|---|
| SOURCE | The OGD Platform catalogue: datasets published by ministries | — |
| PUBLISHER | Government of India. Each dataset is published by its ministry | INFERRED |
| URL | `https://data.gov.in`. The `www.data.gov.in/Godl` and `/terms-of-use` pages returned **HTTP 403** to the fetcher. The GODL text was read on the data.gov.in subdomain mirror `smartcities.data.gov.in` | PROVEN_BY_DOC(https://smartcities.data.gov.in/government-open-data-license-india) |
| VERSION_DATE | Per dataset | — |
| LICENSE | Government Open Data License - India: "worldwide, royalty-free, non-exclusive license to use, adapt, publish" for "all lawful commercial and non-commercial purposes". Exempt: personal information, sensitive data, official symbols and logos, third-party IPR, RTI §8 material. No warranty | PROVEN_BY_DOC(GODL mirror) |
| ATTRIBUTION | "[Name of Data Provider], [Year of Publication], [Name of Data], [Name of Data Repository/Website], [Version Number and/or Date of Publication (dd/mm)], [DOI / URL / URI]. Published under [Name of License]: [URL of License]" | PROVEN_BY_DOC(GODL mirror) |
| AUTH | API key, free on registration | INFERRED (secondary sources only; terms page 403) |
| COST | Free | PROVEN_BY_DOC(GODL) |
| RATE_LIMIT | Not read (the terms page was 403) | NOT_VERIFIED |
| CACHE_POLICY | GODL permits storing, adapting and publishing | PROVEN_BY_DOC(GODL) |
| OFFLINE_POLICY | Permitted under GODL | PROVEN_BY_DOC(GODL) |
| UPDATE_FREQUENCY | Per dataset | — |
| INDIA_COVERAGE | Per dataset. Most are tabular, and many lack coordinates | INFERRED |
| NER_COVERAGE | Per dataset | — |
| PRODUCTION_TILE_USE_ALLOWED | n/a (tabular, no tile service) | — |
| WHAT_IT_SUPPORTS | Nothing today. A cross-check list for POI classes such as airports and stations, one dataset at a time, after reading its record | INFERRED |
| LIMITATIONS | Each dataset needs its own review of date, publisher and fields. Titles seen in the dead Phase-1 transcript were not re-verified | NOT_VERIFIED |
| ADMISSION | `VALIDATION_ONLY`, per dataset | — |

### 2.6 MoRTH / NHAI

| Field | Value | Label |
|---|---|---|
| SOURCE | The NHAI "Data Lake" GIS dashboard (National Highways projects under execution). Rajmargyatra. The MoRTH "GIS mapping of all National Highways" page | PROVEN_BY_DOC(https://nhai.gov.in/nhai/sites/default/files/mix_file/List_of_Extternal-Portal_Links.pdf) |
| PUBLISHER | Ministry of Road Transport and Highways. National Highways Authority of India | same |
| URL | `https://datalakeg.nhai.gov.in/nhai/mISC/DataLakeGISDashboard`. Rajmargyatra `https://rajmargyatra.nhai.gov.in/…` (the listed link ends in `#/otp`). The MoRTH page and circular returned a header only today | PROVEN_BY_DOC(https://datalakeg.nhai.gov.in/nhai/mISC/DataLakeGISDashboard) |
| VERSION_DATE | A live viewer. No data date shown | PROVEN_BY_DOC |
| LICENSE | None published on any page read | PROVEN_BY_DOC |
| ATTRIBUTION | n/a | — |
| AUTH | The dashboard is public to view. Rajmargyatra's listed link goes to an OTP screen | PROVEN_BY_DOC + INFERRED |
| COST | n/a | — |
| RATE_LIMIT | n/a | — |
| CACHE_POLICY | No licence, so no copying | INFERRED |
| OFFLINE_POLICY | Same | INFERRED |
| UPDATE_FREQUENCY | Unknown | NOT_VERIFIED |
| INDIA_COVERAGE | NH projects nationwide. Layers "India State Boundary", "Lok Sabha Constituencies", "UPC Based Alignment of NHAI Projects" | PROVEN_BY_DOC(dashboard) |
| NER_COVERAGE | Expected, because the portal is national. Not checked | INFERRED |
| PRODUCTION_TILE_USE_ALLOWED | **NO** | PROVEN_BY_DOC (no licence) |
| WHAT_IT_SUPPORTS | Manual reference only: NH numbers, and stretches under construction that a manager may enter as a closure with evidence (`docs/ROAD_DATA_FRESHNESS_PLAN.md` §4) | INFERRED |
| LIMITATIONS | No API, no download, no terms | PROVEN_BY_DOC |
| ADMISSION | `REFERENCE_ONLY` | — |

### 2.7 AAI: Aeronautical Information (eAIP India)

| Field | Value | Label |
|---|---|---|
| SOURCE | eAIP India (AD section: aerodrome data), NOTAMs | PROVEN_BY_DOC(https://aim-india.aai.aero/) |
| PUBLISHER | Airports Authority of India | same |
| URL | `https://aim-india.aai.aero/` | same |
| VERSION_DATE | "eAIP India AMDT 10/2026 (Effective Date: 29 OCT 2026)" is listed as the latest amendment | same |
| LICENSE | "© 2026 AIRPORTS AUTHORITY OF INDIA. All Rights Reserved." No reuse licence | same |
| ATTRIBUTION | n/a | — |
| AUTH | None to view | same |
| COST | Free to view | same |
| RATE_LIMIT | n/a | — |
| CACHE_POLICY | Not licensed for reuse | INFERRED |
| OFFLINE_POLICY | Not licensed | INFERRED |
| UPDATE_FREQUENCY | By amendment. The effective dates follow the aeronautical cycle | INFERRED |
| INDIA_COVERAGE | Indian aerodromes | PROVEN_BY_DOC |
| NER_COVERAGE | Included | INFERRED |
| PRODUCTION_TILE_USE_ALLOWED | **NO** | PROVEN_BY_DOC (all rights reserved) |
| WHAT_IT_SUPPORTS | A cross-check for a future airports layer built from OSM `aeroway=aerodrome` (ODbL) | INFERRED |
| LIMITATIONS | PDF and HTML publication. No open licence | PROVEN_BY_DOC |
| ADMISSION | `VALIDATION_ONLY` | — |

### 2.8 IWAI: National Waterways

| Field | Value | Label |
|---|---|---|
| SOURCE | National Waterway pages. Least Available Depth (LAD) and river notices | PROVEN_BY_DOC(https://iwai.gov.in/offerings/national-waterway/national-waterways2) |
| PUBLISHER | Inland Waterways Authority of India | same |
| URL | `https://iwai.gov.in/offerings/national-waterway/national-waterways2`, `https://iwai.gov.in/river-notices-lad` | PROVEN_BY_DOC |
| VERSION_DATE | The newest LAD PDFs listed are dated **July 2026**, including "NW 2" and "NW 16". Read on 30 Sep, that is at least 2 months old | PROVEN_BY_DOC(https://iwai.gov.in/river-notices-lad) |
| LICENSE | Not stated | PROVEN_BY_DOC(https://iwai.gov.in/least-available-depth-lad) |
| ATTRIBUTION | n/a | — |
| AUTH | None | PROVEN_BY_DOC |
| COST | Free | PROVEN_BY_DOC |
| RATE_LIMIT | n/a | — |
| CACHE_POLICY | No licence stated, so reference only | INFERRED |
| OFFLINE_POLICY | Same | INFERRED |
| UPDATE_FREQUENCY | LAD is "regularly monitored and published". The latest listed is July 2026 | PROVEN_BY_DOC |
| INDIA_COVERAGE | The declared National Waterways | PROVEN_BY_DOC |
| NER_COVERAGE | **NW-2 (Brahmaputra)**: "891 km between the Bangladesh Border and Sadiya". LAD is 2.5 m (Bangladesh border–Neamati, 629 km), 2.0 m (Neamati–Dibrugarh, 139 km) and 1.5 m (Dibrugarh–Sadiya). Terminals include Dhubri, Pandu and Dibrugarh. **NW-16 (Barak)**: an LAD PDF exists | PROVEN_BY_DOC(NW-2 page, LAD list) |
| PRODUCTION_TILE_USE_ALLOWED | **NO** (no tiles, no licence) | PROVEN_BY_DOC |
| WHAT_IT_SUPPORTS | Nothing today. Reference for a future waterways/terminals context layer, with geometry taken from OSM `waterway=*` | INFERRED |
| LIMITATIONS | PDF only. No geometry. No feed or API ("no RSS feed, API endpoint") | PROVEN_BY_DOC(river-notices-lad) |
| ADMISSION | `REFERENCE_ONLY` | — |

### 2.9 Indian Railways

| Field | Value | Label |
|---|---|---|
| SOURCE | The CRIS/FOIS "GIS View of Live Trains (Passenger and Freight) on IR Network" | PROVEN_BY_DOC(https://www.fois.indianrail.gov.in/foisweb/view/qry/MRDB_FOISMapLoadsRunIN.jsp) |
| PUBLISHER | Ministry of Railways, Centre for Railway Information Systems | same |
| URL | as above | — |
| VERSION_DATE | Live positions. Network date not shown | PROVEN_BY_DOC |
| LICENSE | None stated | PROVEN_BY_DOC |
| ATTRIBUTION | n/a | — |
| AUTH | Public viewer | PROVEN_BY_DOC |
| COST | n/a | — |
| RATE_LIMIT | n/a | — |
| CACHE_POLICY | No licence, so no copying | INFERRED |
| OFFLINE_POLICY | Same | INFERRED |
| UPDATE_FREQUENCY | Live (train positions) | PROVEN_BY_DOC |
| INDIA_COVERAGE | The whole IR network | PROVEN_BY_DOC |
| NER_COVERAGE | Included | INFERRED |
| PRODUCTION_TILE_USE_ALLOWED | **NO** | PROVEN_BY_DOC (no licence) |
| WHAT_IT_SUPPORTS | Nothing. A rail layer would come from OSM `railway=*` (ODbL). The OSM India railways wiki reports uneven coverage (last edited 24 Oct 2025) | PROVEN_BY_DOC(https://wiki.openstreetmap.org/wiki/India/Railways) |
| LIMITATIONS | No API, no download, no terms | PROVEN_BY_DOC |
| ADMISSION | `REFERENCE_ONLY` | — |

### 2.10 Copernicus Sentinel-2

| Field | Value | Label |
|---|---|---|
| SOURCE | Copernicus Sentinel-2 imagery, through the Copernicus Data Space Ecosystem (CDSE) | PROVEN_BY_DOC(https://dataspace.copernicus.eu/terms-and-conditions) |
| PUBLISHER | European Union Copernicus programme (European Commission). CDSE operates the access | PROVEN_BY_DOC(legal notice) |
| URL | `https://dataspace.copernicus.eu`. The legal notice is at `https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice` | PROVEN_BY_DOC |
| VERSION_DATE | Continuous acquisition. A basemap is a mosaic the project would build and date itself | INFERRED |
| LICENSE | EU law: "free, full and open access". Use is granted for "(a) reproduction; (b) distribution; (c) communication to the public; (d) adaptation, modification and combination" | PROVEN_BY_DOC(legal notice, PDF text in `terms_clause_extracts.txt`) |
| ATTRIBUTION | "Copernicus Sentinel data [Year]", or "Contains modified Copernicus Sentinel data [Year]" when adapted | same |
| AUTH | A CDSE account ("Registration is required") | PROVEN_BY_DOC(https://documentation.dataspace.copernicus.eu/Quotas.html) |
| COST | Free within quotas | same |
| RATE_LIMIT | Sentinel Hub: 10,000 requests/month, 300/min, 10,000 PU/month. OData/S3/STAC: 50,000 requests/month, 2,000/min, 4 concurrent connections, 20 MB/s per connection, 12 TB per rolling 30 days | same |
| CACHE_POLICY | Distribution is permitted, so derived tiles may be stored | PROVEN_BY_DOC(legal notice) |
| OFFLINE_POLICY | Permitted (distribution) | PROVEN_BY_DOC(legal notice) |
| UPDATE_FREQUENCY | New scenes arrive continuously. Clouds limit usable scenes in the NER monsoon | INFERRED |
| INDIA_COVERAGE | Global land, so India is included | INFERRED |
| NER_COVERAGE | Included. The cloud-free share is unmeasured | INFERRED |
| PRODUCTION_TILE_USE_ALLOWED | **YES (as input to own tiles)**. There is no production tile service inside the free quotas. The ready-made **EOxCloudless** mosaic is CC BY-NC-SA 4.0 for non-commercial use only, and commercial use "given that you obtained an EOX Commercial … License" | PROVEN_BY_DOC(legal notice) + PROVEN_BY_DOC(https://cloudless.eox.at/documentation/license) |
| WHAT_IT_SUPPORTS | The cheapest licence-clean SATELLITE layer: an own cloud-free mosaic, at regional scale rather than street scale | INFERRED |
| LIMITATIONS | Resolution is far coarser than commercial imagery. A processing pipeline is needed. Clouds | INFERRED |
| ADMISSION | `RESEARCH_ONLY` (Sentinel-1/Copernicus access stays `BLOCKED` on the account, FINAL_SOURCE_ADMISSION_LEDGER §3) | — |

### 2.11 MapTiler Cloud

| Field | Value | Label |
|---|---|---|
| SOURCE | MapTiler Cloud maps and tiles (hillshade in use; vector and satellite offered) | PROVEN_BY_SOURCE (`driver-app/src/map/scene.ts:59-72`) |
| PUBLISHER | MapTiler AG | PROVEN_BY_DOC(https://www.maptiler.com/copyright/) |
| URL | `https://api.maptiler.com/tiles/hillshade/{z}/{x}/{y}.webp?key=<key>` (`scene.ts:63`) | PROVEN_BY_SOURCE |
| VERSION_DATE | OSM-derived maps are "updated typically weekly" | PROVEN_BY_DOC(copyright) |
| LICENSE | Commercial terms. "Usage of the Free Plan is limited to non-commercial use and research & development" | PROVEN_BY_DOC(https://www.maptiler.com/terms/cloud/) |
| ATTRIBUTION | "© MapTiler" and "© OpenStreetMap contributors", both linked. Code: `© MapTiler` (`scene.ts:67`). The OSM credit comes from the base layer | PROVEN_BY_DOC(copyright) + PROVEN_BY_SOURCE |
| AUTH | API key in the URL. It is inlined at build time from `EXPO_PUBLIC_MAPTILER_KEY`, so it ships in the client. An untracked, git-ignored `driver-app/.env` holds a 20-character value (value not printed). Whether any shipped build carries it, and on which plan, is unknown | PROVEN_BY_SOURCE + NOT_VERIFIED |
| COST | Free $0: 5k sessions and 100k requests/month; "service will pause until the next month". Flex $30/month: 25k sessions and 500k requests, overage billed. Custom: contract | PROVEN_BY_DOC(https://www.maptiler.com/cloud/pricing/) |
| RATE_LIMIT | Plan quotas. "Usage … beyond these limits may result in temporary suspension" | PROVEN_BY_DOC(terms) |
| CACHE_POLICY | Only "a temporary personal cache … for use by a single end-user". No server-side store or redistribution | PROVEN_BY_DOC(terms) |
| OFFLINE_POLICY | Not covered by the Cloud plan text. On-prem is sold separately | PROVEN_BY_DOC(pricing) + NOT_VERIFIED |
| UPDATE_FREQUENCY | Weekly (OSM-derived) | PROVEN_BY_DOC(copyright) |
| INDIA_COVERAGE | Global | PROVEN_BY_DOC(copyright) |
| NER_COVERAGE | The 20 Sep ledger found tiles served over 26°N 92°E | FINAL_SOURCE_ADMISSION_LEDGER §5b |
| PRODUCTION_TILE_USE_ALLOWED | **YES on a paid plan**, with an origin/app-restricted key. **NO on Free** (non-commercial; it pauses at the quota). Boundaries follow OSM (INFERRED, same clause xiii question as §2.1) | PROVEN_BY_DOC + INFERRED |
| WHAT_IT_SUPPORTS | Driver relief overlay (`hillshade` is toggled with hazards, `MapScreen.tsx:827,858`). A candidate managed STANDARD vector basemap and SATELLITE (its satellite credits include Maxar and Sentinel-2) | PROVEN_BY_SOURCE + PROVEN_BY_DOC(copyright) |
| LIMITATIONS | The key is exposed in the client. The plan type is unknown. When the quota runs out on Free, the service stops | PROVEN_BY_DOC + PROVEN_BY_SOURCE |
| ADMISSION | `OPTIONAL_KEYED` (unchanged). Production requires a paid plan and a restricted key | — |

### 2.12 Mapbox Satellite

| Field | Value | Label |
|---|---|---|
| SOURCE | Tileset `mapbox.satellite` | PROVEN_BY_DOC(https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/) |
| PUBLISHER | Mapbox. Imagery from NASA MODIS (z0-8), Maxar and Landsat (z9-12), Maxar Vivid (z13-16), and Vexcel plus open sources (z16+) | same |
| URL | Mapbox APIs with an access token | same |
| VERSION_DATE | "not improved on a set schedule and is updated when and where it becomes available". The docs note a March 2022 "Updated 50cm Imagery In … India" | same |
| LICENSE | Mapbox Terms and Product Terms (dated 21 July 2026) | PROVEN_BY_DOC(Product Terms PDF, `terms_clause_extracts.txt`) |
| ATTRIBUTION | The Mapbox logo is always required, plus "© Mapbox", "© OpenStreetMap" and "Improve this map". Satellite also needs "© Maxar" | PROVEN_BY_DOC(https://docs.mapbox.com/help/getting-started/attribution/) |
| AUTH | Access token | PROVEN_BY_DOC |
| COST | GL JS: 50,000 loads/month free, then $5.00 per 1,000. Mobile SDK: 25,000 MAU free, then $4.00 per 1,000. Static/raster tiles: 750,000 free, then $0.25 per 1,000 | PROVEN_BY_DOC(https://www.mapbox.com/pricing) |
| RATE_LIMIT | Billing tiers. "not perform bulk or automated queries" | PROVEN_BY_DOC(Product Terms) |
| CACHE_POLICY | "not export, download, cache or store Licensed Map Content". On mobile, cache only "up to the limits set in the Mobile SDKs" | PROVEN_BY_DOC(Product Terms) |
| OFFLINE_POLICY | Only within Mobile SDK cache limits | PROVEN_BY_DOC(Product Terms) |
| UPDATE_FREQUENCY | Irregular | PROVEN_BY_DOC(tileset reference) |
| INDIA_COVERAGE | Global z16 at 1-2 m. The 50 cm India update was noted in 2022 | PROVEN_BY_DOC(tileset reference) |
| NER_COVERAGE | Not checked | NOT_VERIFIED |
| PRODUCTION_TILE_USE_ALLOWED | **NO for the driver app as built.** Mobile apps must use "the Mobile SDKs as Customer's exclusive means of accessing the Service Offerings", and the driver map is Leaflet in a WebView. Manager (MapLibre on the web): not established from what was read | PROVEN_BY_DOC(Product Terms) + NOT_VERIFIED |
| WHAT_IT_SUPPORTS | Nothing today | PROVEN_BY_SOURCE |
| LIMITATIONS | SDK lock-in on mobile. No caching. Tracing is allowed only "for non-commercial purposes or … for OpenStreetMap" | PROVEN_BY_DOC(Product Terms) |
| ADMISSION | `REJECT` for the driver app. `RESEARCH_ONLY` for the manager | — |

### 2.13 Google Maps Platform

| Field | Value | Label |
|---|---|---|
| SOURCE | Google Maps Platform: Map Tiles API (2D, Street View, Photorealistic 3D), Dynamic Maps, Places API (New) | PROVEN_BY_DOC(https://developers.google.com/maps/billing-and-pricing/pricing) |
| PUBLISHER | Google. In India, Google Cloud India Private Limited is the appointed reseller | PROVEN_BY_DOC(https://cloud.google.com/maps-platform/terms) |
| URL | `https://cloud.google.com/maps-platform/terms`. **Code:** `backend/app/services/geocoding.py` targets `https://places.googleapis.com/v1` and says of itself "WRITTEN, NEVER EXECUTED AGAINST GOOGLE" (`GOOGLE_PLACES_API_KEY` unset). The driver has an "open in Google Maps" hand-off link (`MapScreen.tsx:790`). The manager reads coordinates from a pasted Google Maps URL without reading any page body (`backend/app/services/maplink.py:1-21`) | PROVEN_BY_SOURCE |
| VERSION_DATE | The terms page's version list starts "Last modified August 26, 2026" | PROVEN_BY_DOC(terms) |
| LICENSE | Proprietary. §3.2.3: "(a) No Scraping … will not: (i) pre-fetch, index, store, reshare, or rehost Google Maps Content … (ii) bulk download Google Maps tiles". "(b) No Caching … except as expressly permitted". "(c) No Creating Content … (i) trace or digitize roadways … from the … Satellite base map type". "(e) No Use With Non-Google Maps … will not (i) display or use Places content on a non-Google Map" | PROVEN_BY_DOC(terms; text in `terms_clause_extracts.txt`) |
| ATTRIBUTION | "Customer will attribute all the Services in accordance with the Documentation" | PROVEN_BY_DOC(https://cloud.google.com/maps-platform/terms/maps-service-terms) |
| AUTH | API key and a billing account | INFERRED |
| COST | 2D Map Tiles: 100,000 free events/month; the listed paid band is $0.60 per 1,000. Photorealistic 3D Tiles: 1,000 free, then $6.00 per 1,000. Dynamic Maps: 10,000 free, then $7.00 per 1,000. India has its own price list (linked, **not read**) | PROVEN_BY_DOC(pricing) + NOT_VERIFIED (India list) |
| RATE_LIMIT | Per-API quotas. Not read | NOT_VERIFIED |
| CACHE_POLICY | Not allowed, except service-specific carve-outs (for example, some lat/lng values for 30 days) | PROVEN_BY_DOC(service terms) |
| OFFLINE_POLICY | Pre-fetch and store are prohibited (§3.2.3(a)) | PROVEN_BY_DOC(terms) |
| UPDATE_FREQUENCY | Not published | — |
| INDIA_COVERAGE | Serves India (India pricing and a reseller exist) | PROVEN_BY_DOC |
| NER_COVERAGE | Not checked | NOT_VERIFIED |
| PRODUCTION_TILE_USE_ALLOWED | **NO** in this architecture. Google content may not be shown "with or near a non-Google Map", and both apps draw OSM maps. The dormant Places client would put Places results on the OSM/MapLibre map and store the chosen location as a trip stop. That would conflict with §3.2.3(b) and (e)(i) if a key were ever configured | PROVEN_BY_DOC + INFERRED (conflict; the code is dormant) |
| WHAT_IT_SUPPORTS | Nothing live. The hand-off link opens Google's own app, which is not API use | PROVEN_BY_SOURCE |
| LIMITATIONS | Exclusive-map clause. No caching. No tracing | PROVEN_BY_DOC |
| ADMISSION | Basemap and tiles: `REJECT`. Places: `OPTIONAL_KEYED` today, and **recommend `REJECT`** while the basemap is non-Google (owner decision) | — |

### 2.14 Esri: World Imagery (ArcGIS Location Platform)

| Field | Value | Label |
|---|---|---|
| SOURCE | ArcGIS World Imagery basemap | PROVEN_BY_DOC(https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer?f=json) |
| PUBLISHER | Esri. The data credit is "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" | same (`copyrightText`) |
| URL | `services.arcgisonline.com/…/World_Imagery/MapServer`, used through an ArcGIS Location Platform account | PROVEN_BY_DOC |
| VERSION_DATE | Item modified 2026-08-07 (item `modified` epoch). Service version 11.3 | PROVEN_BY_DOC(https://www.arcgis.com/sharing/rest/content/items/10df2279f9684e4a9f6a7f08febac2a9?f=json) |
| LICENSE | "Esri Master License Agreement". "This layer is not intended to be used to export tiles for offline". A separate "World Imagery (for Export)" layer exists for ArcGIS applications | PROVEN_BY_DOC(item JSON) |
| ATTRIBUTION | "Powered by Esri", including when "you use an open source or third-party library", plus the data credit above | PROVEN_BY_DOC(https://developers.arcgis.com/documentation/esri-and-data-attribution/), read through a search-result extract because the page is JavaScript-only |
| AUTH | Location Platform account and API key | INFERRED |
| COST | Basemap tiles: 2M free, then $0.15 per 1,000. Sessions: 1K free, then $4 per 1,000. The pricing page lists "satellite imagery" among the basemap styles | PROVEN_BY_DOC(https://location.arcgis.com/pricing/) |
| RATE_LIMIT | Billing tiers | PROVEN_BY_DOC(pricing) |
| CACHE_POLICY | Not read (the Master Agreement body was not read) | NOT_VERIFIED |
| OFFLINE_POLICY | Not for offline export, except the "for Export" layer inside ArcGIS apps | PROVEN_BY_DOC(item JSON) |
| UPDATE_FREQUENCY | Not published in the metadata | PROVEN_BY_DOC |
| INDIA_COVERAGE | "1m resolution imagery across the rest of the world" (outside the US/Western Europe/metro areas). 15 m TerraColor at small scales | PROVEN_BY_DOC(service JSON) |
| NER_COVERAGE | Not checked | NOT_VERIFIED |
| PRODUCTION_TILE_USE_ALLOWED | YES with a paid or free-tier Location Platform account and attribution, **conditional**: the Master Agreement body was not read | PROVEN_BY_DOC(pricing) + NOT_VERIFIED |
| WHAT_IT_SUPPORTS | A managed SATELLITE candidate for the manager | INFERRED |
| LIMITATIONS | Offline export is restricted. Legal review of foreign-served imagery in India is needed (Guidelines clauses iv and viii concern accuracy thresholds and foreign licensing, INFERRED relevance) | PROVEN_BY_DOC(GeospatialGuidelines) + INFERRED |
| ADMISSION | `RESEARCH_ONLY` | — |

### 2.15 AWS Terrain Tiles (in code, manager)

| Field | Value | Label |
|---|---|---|
| SOURCE | Terrarium-encoded elevation tiles (tilezen/joerd) on AWS Open Data | PROVEN_BY_DOC(https://registry.opendata.aws/terrain-tiles/) |
| PUBLISHER | Managed by "Mapzen, a Linux Foundation project" | same |
| URL | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (`manager-web/src/components/mapTerrain.ts:57`), `maxzoom: 13` | PROVEN_BY_SOURCE |
| VERSION_DATE | Not published. "New data is added based on community feedback" | PROVEN_BY_DOC |
| LICENSE | Per constituent dataset. SRTM and GMTED2010 are USGS (credit requested) | PROVEN_BY_DOC(https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| ATTRIBUTION | Code: "Elevation: SRTM & GMTED2010 courtesy of the U.S. Geological Survey, via AWS Terrain Tiles" (`mapTerrain.ts:51-53`). It matches the joerd wording for those sources | PROVEN_BY_SOURCE + PROVEN_BY_DOC |
| AUTH | None | PROVEN_BY_SOURCE |
| COST | Free to the requester (public bucket) | INFERRED |
| RATE_LIMIT | Not published | NOT_VERIFIED |
| CACHE_POLICY | Public-domain constituents. Mirroring is permitted with credit | INFERRED |
| OFFLINE_POLICY | Same | INFERRED |
| UPDATE_FREQUENCY | Ad hoc | PROVEN_BY_DOC |
| INDIA_COVERAGE | SRTM/GMTED2010 cover India | INFERRED |
| NER_COVERAGE | z8-z10 over 26°N 92°E returned HTTP 200 on 20 Sep | FINAL_SOURCE_ADMISSION_LEDGER §5b |
| PRODUCTION_TILE_USE_ALLOWED | YES (INFERRED), but with no SLA. Mirror the India tiles into own storage before production | INFERRED |
| WHAT_IT_SUPPORTS | Manager Terrain (hillshade) and 3D (`setTerrain` plus a 55° pitch) | PROVEN_BY_SOURCE (`mapTerrain.ts:93-125`) |
| LIMITATIONS | Display only: the policy's gradients come from the backend DEM (Open-Meteo, then OpenTopoData). Coarse SRTM | PROVEN_BY_SOURCE |
| ADMISSION | `ADOPT_NOW`. Mirror before production | — |

### 2.16 OpenTopoMap (in code, driver fallback)

| Field | Value | Label |
|---|---|---|
| SOURCE | OpenTopoMap raster (topographic relief with contours) | PROVEN_BY_DOC(https://opentopomap.org/about) |
| PUBLISHER | OpenTopoMap, a volunteer project | same |
| URL | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` (`driver-app/src/map/scene.ts:64`). It overlays at 0.55 opacity, `maxNativeZoom` 12 (`DriverRouteMap.native.tsx:82`) | PROVEN_BY_SOURCE |
| VERSION_DATE | Database "up to date". Parts of the map may be up to 4 weeks older | PROVEN_BY_DOC |
| LICENSE | CC-BY-SA (cartography), over OSM data and SRTM | PROVEN_BY_DOC |
| ATTRIBUTION | Required: "Kartendaten: © OpenStreetMap-Mitwirkende, SRTM \| Kartendarstellung: © OpenTopoMap (CC-BY-SA)". Code: "Relief: © OpenTopoMap (CC-BY-SA), SRTM" (`scene.ts:68`) plus the base layer's OSM credit, which covers the same parts | PROVEN_BY_DOC + PROVEN_BY_SOURCE |
| AUTH | None | PROVEN_BY_SOURCE |
| COST | Free | PROVEN_BY_DOC |
| RATE_LIMIT | No number. Embedding is welcome "as long as our server is not overloaded, e.g. by mass downloads" | PROVEN_BY_DOC (translated from German) |
| CACHE_POLICY | Not stated | NOT_VERIFIED |
| OFFLINE_POLICY | Mass downloads would contradict the stated condition | INFERRED |
| UPDATE_FREQUENCY | Rolling, up to about 4 weeks behind | PROVEN_BY_DOC |
| INDIA_COVERAGE | Global | INFERRED |
| NER_COVERAGE | A z8 tile over 26°N 92°E answered on 20 Sep | FINAL_SOURCE_ADMISSION_LEDGER §5b |
| PRODUCTION_TILE_USE_ALLOWED | **NO**: "no availability can be guaranteed", and it is a volunteer server | PROVEN_BY_DOC + INFERRED |
| WHAT_IT_SUPPORTS | Driver relief when no MapTiler key is built in | PROVEN_BY_SOURCE |
| LIMITATIONS | It draws OSM boundaries and labels too, under the same clause xiii question as §2.1 | INFERRED |
| ADMISSION | `DEMO_ONLY`. This supersedes the 20 Sep `ADOPT_NOW` for production scope | — |

## 3. Cross-source findings

1. **Every tile the product draws today comes from a free community or best-effort service.** Both
   apps use OSM Standard. The manager adds AWS Terrarium. The driver adds OpenTopoMap or MapTiler.
   None has an SLA, and OSM and OpenTopoMap explicitly reserve the right to block.
   PROVEN_BY_SOURCE + PROVEN_BY_DOC.
2. **The native driver map does not identify itself to the OSM tile server.** Section 3.4 of the tile
   policy requires this (§2.1). PROVEN_BY_SOURCE. The headers actually sent were not captured.
3. **Attribution is incomplete.** There is no link to `openstreetmap.org/copyright` and no ODbL
   mention in either app (§2.1). PROVEN_BY_SOURCE against PROVEN_BY_DOC.
4. **India boundaries.** All OSM-derived rasters in use (OSM Standard, OpenTopoMap, MapTiler) draw
   OSM's on-the-ground boundaries. Guidelines 2021 clause xiii names SoI data as the standard for
   political maps of India. Until SoI is imported, and the basemap is self-built without OSM
   `admin_level=2` lines, the product has no compliant boundary depiction. The legal reading is INFERRED
   and is for the owner.
5. **Foreign-hosted map services and India law.** Clause viii restricts finer-than-threshold data to
   licensing through Indian entities, and clause vi reserves street view and terrestrial mobile
   mapping to Indian entities. A satellite or street-level layer from a foreign provider needs legal
   review before production. The rules are PROVEN_BY_DOC(GeospatialGuidelines). Their application here
   is INFERRED.
6. **Bundled map data is not clipped to India.** The POI snapshot holds 53 records in a small box
   around Sylhet (Bangladesh) and 38 around Thimphu (Bhutan). The NASA GLC slice has 50 rows labelled
   Bhutan, Myanmar, Bangladesh or China, plus 108 with a blank country (`poi_hazard_data_checks.txt`).
   PROVEN_BY_SOURCE. Handling is in `docs/MAP_DATA_CONFLATION_POLICY.md`.

## 4. What was not done

- No provider was switched and no key was created, read or printed.
- No tiles, imagery or datasets were downloaded. The SoI ABDB archive link was seen and not followed.
- These pages could not be read and were not bypassed: dst.gov.in (connection refused), pib.gov.in
  and www.data.gov.in (HTTP 403), and the MoRTH GIS page (header only). The Esri attribution page is
  JavaScript-only and was read through a search-result extract.
- Mapbox and Google terms beyond the clauses quoted, the Esri Master License Agreement body, and the
  Google India price list were not read.
