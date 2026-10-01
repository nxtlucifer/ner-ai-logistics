# Final source admission ledger

Every external source, document and repository this project has been handed, with one
status each and the reason for it. Nothing is unclassified.

Compiled 20 September 2026. Supersedes nothing — it indexes and completes
`docs/research/SOURCE_ADMISSION_MATRIX.md` (supplied documents),
`docs/research/GITHUB_REFERENCE_AUDIT.md` (repositories) and
`docs/research/SPATIAL_SOURCE_AUDIT.md`, and adds the per-source fields the mission
brief asks for.

| Status | Meaning |
|---|---|
| `ADOPT_NOW` | Called by running code. A test proves it. |
| `OPTIONAL_KEYED` | Integrated, dormant until a credential the user must obtain is present. |
| `VALIDATION_ONLY` | May check RASTA's output. Never a feed. |
| `RESEARCH_ONLY` | Readable and quotable with attribution. Creates no route state, no label. |
| `REFERENCE_ONLY` | A pattern, a list, or a duplicate of something already here. |
| `BLOCKED` | Relevant, but no lawful machine access exists today. |
| `REJECT` | Not usable — no licence, empty, or contradicted by something stronger. |

---

## 1. Live providers — `ADOPT_NOW`

These are called at runtime. Host list verified against the source tree, not against memory:
`grep -rhoE "https?://..." backend/app` returns exactly these.

| Source | Purpose | Auth | Rate limit | Implementation | Test |
|---|---|---|---|---|---|
| **OSRM** `router.project-osrm.org` | Road routing and geometry. The only thing allowed to say a road exists. | none | public demo server, fair use | `backend/app/services/routing/osrm.py` | `tests/test_route_api.py` |
| **Open-Meteo** `api.open-meteo.com` | Forecast and observed weather along a corridor. | none | fair use, no key | `backend/app/services/weather/open_meteo.py` | `tests/test_weather*.py` |
| **Open-Meteo Flood** `flood-api.open-meteo.com` | River discharge context. **Not** road water depth, and labelled as discharge. | none | fair use | `backend/app/services/flood.py` | `tests/test_flood_context.py` |
| **MET Norway** `api.met.no` | Weather fallback when Open-Meteo rate-limits. Its presence is why a 429 reads AVAILABLE VIA FALLBACK rather than FAILED. | none (User-Agent required) | fair use | `backend/app/services/weather/` | `tests/test_provider_health.py` |
| **OpenTopoData** `api.opentopodata.org` | SRTM elevation for slope and terrain. | none | 1,000 calls/day, 1/sec, 100 points/request | `backend/app/services/terrain.py` | `tests/test_terrain*.py` |
| **Nominatim** `nominatim.openstreetmap.org` | Forward and reverse geocoding for the location picker. | none (User-Agent required) | 1 req/sec absolute | `backend/app/services/geocoding.py` | `tests/test_geocoding.py` |
| **Overpass** `overpass-api.de` | Corridor-bounded POI/roadside queries. Never called per GPS tick. | none | fair use; heavy queries throttled | `backend/app/services/places/` | `tests/test_places_snapshot.py` |
| **NDMA SACHET** `sachet.ndma.gov.in` | Official Government of India alerts. The only source permitted to produce an OFFICIAL_WARNING. | none | unstated | `backend/app/services/warnings.py` | `tests/test_official_warnings.py` |

## 2. Integrated but dormant — `OPTIONAL_KEYED`

Wired, tested, and correctly reported as NOT CONFIGURED until the user supplies a credential.
**No key can be obtained on the user's behalf** — the supplied geospatial PDF says so in its
own opening paragraph, and it is right.

| Source | Setting | State | Note |
|---|---|---|---|
| **Gemini** | `GEMINI_API_KEY` | not set on Render | Explains and translates. Cannot override deterministic safety policy. |
| **OpenRouter** | `OPENROUTER_API_KEY` | not set on Render | Second AI provider in the failover chain. |
| **Google Places** | `GOOGLE_PLACES_API_KEY` | keyed | Official API only. No scraping of undocumented endpoints. |
| **MapTiler** | env only, never in source | keyed | Terrain/vector tiles for the map client. |
| **Expo Push** | `EXPO_ACCESS_TOKEN` | — | In-app notifications work regardless; remote push needs FCM credentials that do not exist. |

## 3. Named by the research, not integrated

| Source | Status | Why not |
|---|---|---|
| **ISRO Bhuvan / CartoDEM** | `BLOCKED` | Best India-calibrated DEM (1 arc-sec, built for India). Needs a registered NOEDA account and per-dataset approval. No automated path. |
| **Copernicus Data Space / Sentinel Hub** | `BLOCKED` | Sentinel-1 SAR is the right tool for Assam monsoon flood extent. Needs account + OAuth client ID/secret. 10,000 req/month free once obtained. |
| **NASA GPM / IMERG** | `BLOCKED` | Sub-daily rainfall, the single most valuable missing input for landslide triggering. Needs an Earthdata login. |
| **NASA FIRMS** | `BLOCKED` | Free MAP_KEY, issued instantly — the cheapest of these to unblock. Fire is supplementary context, so it is not urgent. |
| **JAXA GSMaP** | `VALIDATION_ONLY` | Cross-check for GPM. Registration required; no operational need. |
| **ISRO MOSDAC** | `BLOCKED` | INSAT-3D rainfall. Registration plus approval for some products. |
| **OpenTopography** | `BLOCKED` | Free key; would add COP30/COP90. OpenTopoData already covers the need without a key. |
| **GSI / Bhusanket** | `BLOCKED` | Would be the authoritative CURRENT_OFFICIAL_EVENT source for landslides. No machine interface found. This is the most important blocked source in the project. |
| **ISRO/NRSC Landslide Atlas** | `RESEARCH_ONLY` | Historical inventory. Usable as HISTORICAL_INVENTORY with attribution; never as a current-event claim. |
| **IMD** | `VALIDATION_ONLY` | Official Indian weather. No open programmatic interface without a data request. Live weather stays Open-Meteo/MET Norway. |
| **USGS earthquake** | `BLOCKED` | Open and keyless, but no earthquake layer exists yet. Cheap to add; P3. |
| **Planet, Maxar/Vantor** | `REJECT` | Application-based academic approval / event-only releases. Neither gives continuous NER coverage. |
| **Commercial live traffic** | `BLOCKED` | No free nationwide commercial-quality feed is assumed to exist. Traffic stays a fleet-telemetry estimate with an honest coverage gate, never inferred from OSM geometry. |
| **geoBoundaries / GADM** | `RESEARCH_ONLY` — **open item** | Named by `awesome-spatial-data`. A possible district-polygon source. Not a Government of India notification, so it could only ever be `DEMO` provenance. See the note in the GitHub audit; the decision is the user's. |

## 4. Supplied documents

All nineteen PDFs were extracted to text and read. Per-document status is in
`docs/research/SOURCE_ADMISSION_MATRIX.md`; the summary is that **not one is `ADOPT_NOW`**,
because not one is a machine interface. They are compilations, catalogues and methodology
notes. Admitting their numbers into a route decision would mean a PDF deciding whether a
truck may use a road.

Three dataset-discipline rules are taken directly from the supplied research and are now
enforced in `docs/research/LANDSLIDE_DATA_DICTIONARY.md`:

1. **Seasonal, event-based and route-wise inventories are different products.** The supplied
   statewise dataset says so itself, and its own "ISRO table total" column does not equal the
   sum of its monsoon columns. They may not be added without record-level deduplication.
2. **A missing state/year is `NOT AVAILABLE`, never zero.**
3. **Historical exposure is not a current prediction.** A district with many 2017 landslides
   is not a district having one today.

## 5. Repositories

Sixteen references, all audited on 20 September 2026 — see
`docs/research/GITHUB_REFERENCE_AUDIT.md` for the full table.

Headline: **eight of the ten hazard repositories publish no licence at all** (two are
entirely empty), which makes their code legally unusable regardless of quality. One carries
PolyForm Noncommercial, also unusable here. The six permissively licensed references are
`REFERENCE_ONLY` or `RESEARCH_ONLY`; none is adopted, because each would trade a working
part of RASTA for an unvalidated one days before a deadline.

## 5b. Adopted on 20 September 2026

Three sources were verified and wired in this session. Each was checked for
licence, key requirement and actual coverage over the North-East **before**
any code referenced it.

| Source | Use | Auth | Licence | Verified | Status |
|---|---|---|---|---|---|
| **AWS Terrain Tiles** (tilezen/joerd) | `raster-dem` behind the manager map's Terrain and 3D modes | none | every constituent source permits commercial use; attribution required and given | z8/z9/z10 tiles fetched over 26°N 92°E — HTTP 200, 256×256 PNG. Over the North-East the data is SRTM / GMTED2010 (USGS, public domain). | `ADOPT_NOW` |
| **OpenTopoMap** | keyless relief fallback for the driver map when `EXPO_PUBLIC_MAPTILER_KEY` is absent | none | CC-BY-SA 3.0, embedding in applications permitted with attribution | z8 tile fetched over the same point — HTTP 200 | `ADOPT_NOW` |
| **OSM corridor snapshot** (already held) | now also served to the manager map via `GET /api/places` | none | ODbL, attributed in the layer | 720 records, snapshot dated 2026-09-05 | `ADOPT_NOW` |

MapTiler terrain-RGB remains `OPTIONAL_KEYED` and is still preferred for the
driver when a key is configured; the OpenTopoMap fallback exists so that a
build without one has terrain rather than a feature that silently disappears.

### The gap this exposed: there is no fuel layer

The brief asks for a fuel/petrol-pump layer, and for a truck it is the most
useful of the lot. The snapshot in
`backend/app/services/places/data/corridor_snapshot.json` holds **720 records
in four categories** — EMERGENCY 281, HOTEL 311, TYRES 118, REST 10 — and
**no `amenity=fuel` records at all**.

Adding a `FUEL` category without the data would render an empty layer, which
a manager would read as *"there are no petrol stations on this corridor"*
rather than *"we did not collect them"*. That is the exact failure the
district-count work spent a whole session removing, so it was not done.

**Unblocking it is a data task, not a code one:** one corridor-bounded
Overpass extract for `amenity=fuel`, merged into the same snapshot with its
own `retrieved_at`. The category enum, the endpoint, the layer and the
attribution line all already handle a fourth-plus category without change.

## 6. Judge-safe wording

What may be said out loud, and what may not:

| Say | Do not say |
|---|---|
| "Routing is OSRM against real road geometry." | "We compute our own optimal routes." |
| "Weather is Open-Meteo with a MET Norway fallback; the screen shows which answered and how old it is." | "Live weather." (without freshness) |
| "Official warnings come from NDMA SACHET." | "We predict warnings." |
| "Flood context is modelled river discharge." | "Road water depth." |
| "Landslide history is a historical inventory, with its source and year on screen." | "Landslide prediction." |
| "Traffic is estimated from our own fleet, and says so when coverage is thin." | "Live traffic." |
| "Terrain is SRTM elevation via OpenTopoData." | "Our terrain model." |
| "The landslide model is experimental and not deployed." | "98% accurate." |
| "No verified district directory has been loaded yet." | Any district count. |
| "TLS in transit, protected storage at rest." | "End-to-end encrypted." |
| "Unknown is shown as UNKNOWN." | "Safe." |

## 7. What would change this ledger

Four credentials, each obtainable only by the user in person, in descending order of value:

1. **Earthdata login** → GPM/IMERG sub-daily rainfall. The biggest single upgrade to landslide
   evidence.
2. **Copernicus Data Space account + OAuth client** → Sentinel-1 flood extent for Assam.
3. **Bhuvan/NOEDA registration** → CartoDEM, an India-calibrated DEM better than global SRTM.
4. **NASA FIRMS MAP_KEY** → instant, free; adds a fire layer.

None is required for the demo. All four are recorded so the next person knows the ceiling is
a registration form, not an engineering problem.
