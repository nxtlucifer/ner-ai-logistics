# Geospatial source ledger

Date: 30 September 2026. Lane: docs-policy (fix round 1). No code was changed and no dataset was downloaded. Official pages read for this ledger are archived with SHA-256 hashes in `.runtime/production/fix1/docs-policy/sources/`.

**What this is.** One record per geospatial source the product uses or intends to use, with what is known and what is still pending. A source is production geography **only** when its record says `PRODUCTION_GEOGRAPHY = YES`, and none does today.

**Quotes** from source pages are kept short and attributed.

## 1. Survey of India, Administrative Boundary Database OVSF/1M/7 (the authority, owner decision D7)

```
SOURCE_ID              = SURVEY_OF_INDIA_OVSF_1M_7   (the constant `SOURCE` in scripts/import_soi_boundaries.py;
                                                      written to geometry_source on import)
PUBLISHER              = Survey of India, Department of Science and Technology, Government of India
                         (onlinemaps.surveyofindia.gov.in, AboutPortal.aspx)
PRODUCT                = Administrative Boundary Database, "For entire country Upto Distt. level with HQ"
PRODUCT_CODE           = OVSF/1M/7
FORMAT / SCALE         = Vector SHAPEFILE, 1:1M
PRICE                  = 0 (PricingPolicy.aspx row 14; Digital_Product_Show.aspx)
CONTENT                = state and district boundaries with headquarters, for the whole country
                         (AboutPortal.aspx). The country outline is derived by the importer as the union
                         of the country layer (importer step 5). Whether the download ships a separate
                         national-outline layer: NOT KNOWN until the files are inspected.
PORTAL                 = https://onlinemaps.surveyofindia.gov.in/ (Quick Access -> Administrative
                         Boundary Database)
ACCESS (portal FAQ)    = FAQ 7 lists the Administrative Boundary Database among datasets that can be
                         downloaded from Quick Access. The same FAQ says: "No registration or login is
                         required for datasets available under Quick Access."
ACCESS (project record)= The download step presents a CAPTCHA and a privacy-policy consent. Per owner
                         decision these are completed by the user personally and never by an agent
                         (importer docstring; productionization decision 29 Sep). Not attempted by this
                         lane.
PORTAL_NOTICE          = Digital_Product_Show.aspx carried a maintenance notice dated 04/10/2025-07/10/2025,
                         saying all services would be unavailable "from 07/10/2025 to __/__/____" (end
                         date blank as published). The portal answered HTTP 200 on 30 Sep 2026; download
                         availability was not tested.
STATUS                 = SOI_REAL_DATA = BLOCKED_USER_DOWNLOAD
DOWNLOADED_AT          = pending
EDITION / VERSION      = pending (record the edition/date printed on the download; importer --source-version)
RAW_SHA256             = pending. Hash every file in the archive as received (.zip, and each .shp .shx
                         .dbf .prj .cpg) BEFORE unpacking into any tool, and record the hashes here. The
                         importer's _sha256 covers .shp/.shx/.dbf/.prj per layer; the archive hash is
                         separate and comes first.
CRS                    = pending. The importer accepts WGS 84 geographic only; anything else needs a
                         reviewed reprojection step (TODO(SoI schema) in the importer).
ATTRIBUTE_FIELDS       = pending. FIELDS['state_name'] and FIELDS['district_name'] are None, and the
                         importer refuses until they are set from `ogrinfo -so -al` (AX-20).
ENCODING               = pending (.cpg)
IMPORTED_INTO          = none. country_boundaries 0 rows; states 8/8 geometry NULL; districts 0 geometries
                         (ner_logistics_test, S10). ner_logistics_cert is at 0015 and has no
                         country_boundaries table.
IMPORT_TARGETS_ALLOWED = local / isolated / cert only. The importer refuses non-local hosts (require_local).
                         A path to a hosted database does not exist yet; it is a hosted-migration gate
                         (MIGRATION_0013_DEPLOYMENT_PACKET.md, "Hosted gates").
ATTRIBUTION            = "Source: Survey of India, Government of India"
                         (the acknowledgement text required by the SoI website Copyright Policy)
PRODUCTION_GEOGRAPHY   = NO (not imported)
```

### Terms read (PROVEN_BY_WEB, 30 Sep 2026)

| Page | What it says (short quote or summary) | Consequence for the product |
|---|---|---|
| SoI Guidelines for acquiring and producing Geospatial Data (2021), shown on the portal as `GeospatialGuidelines.aspx`, item xiii | For political maps of India, "SoI published maps or SoI digital boundary data are the standard to be used". The same item says such data is to be freely downloadable, with digital display and printing permitted | The India outline and state lines must come from SoI. geoBoundaries and OSM are not substitutes (importer docstring). Displaying the boundary is permitted |
| The same guidelines, item ii(1) | No prior approval or licence is needed for geospatial data within India, apart from the negative list of sensitive attributes | Using the boundary for classification needs no licence. The negative list was not read today (NOT_VERIFIED) |
| SoI website Copyright Policy (`surveyofindia.gov.in/pages/copyright-policy`, footer dated 28-09-2026) | Reproduced material must carry the acknowledgement "Source: Survey of India, Government of India." It also restricts reproducing website material without written permission | Every surface that shows or exports SoI-derived geometry carries the attribution string (§1.2). Whether that restriction covers the downloadable **data** rather than website material is **not determined** from the pages read. Treat redistribution of derived geometry to clients (offline packages, exports) as needing confirmation from SoI (`mtr.soi@gov.in`, the portal's contact) |
| SoI website Terms and Conditions and Disclaimer | Website content "should not be construed as a statement of law". SoI accepts no liability for loss from use | Border outcomes are operational controls, not legal determinations; the UI must not present them as legal rulings |

`LICENCE_FOR_REDISTRIBUTION = NOT DETERMINED.` Classification on the server is covered by item ii(1). Shipping polygons to devices or in exports waits for confirmation.

### 1.2 Where the attribution must appear, once imported

- **The manager map**, whenever a boundary layer or a geography-derived label is drawn: the map attribution control, next to the OSM attribution.
- **Any export or report** that includes state, district or border-derived fields.
- **The driver app**, if boundary geometry is ever shown, and inside any offline package that carries it.
- **API responses do not carry it.** The geography payloads are identifiers and codes, not geometry.

### 1.3 Import procedure (owner performs the download)

1. The user downloads OVSF/1M/7 through the portal, completing the CAPTCHA and consent themselves.
2. Hash the archive and each member. Record them in §1 `RAW_SHA256` together with `DOWNLOADED_AT` and the edition.
3. Run `ogrinfo -so -al` on each layer. Record the CRS, the fields and the encoding. Set `FIELDS` (or pass `--field`).
4. Import into an **isolated** database. Read the JSON summary, including repaired geometries, which are recorded rather than silently fixed.
5. Run `NER_SERVICE_REGION_POLICY.md` §5 (the real-city tests and post-import validations). Un-skip the 22 `TestRealCities` tests; they must pass.
6. Only then consider cert, and hosted through the gated path.

## 2. Other geospatial sources in the product

None of these is production geography. Each is listed with its class so nothing is mistaken for an authority. "Recorded" means taken from the cited repository file, not re-verified today unless marked.

| Source | Role in product | Class | Licence / terms (as recorded) | Production-safe? | Record |
|---|---|---|---|---|---|
| OpenStreetMap standard tiles (`tile.openstreetmap.org`) | Basemap in both apps | Third-party display | OSMF tile usage policy; offline bundling not allowed (`BASEMAP_NOT_BUNDLED_LICENCE`) | Display only; **not** a border authority. OSM depictions of borders may differ from SoI; the product's border is SoI | `ROUTING_GRAPH_FRESHNESS.md` §3.6, §5 |
| OSRM public demo (`router.project-osrm.org`, FOSSGIS) | The only router today | Third-party, `PUBLIC_DEMO` | "reasonable, non-commercial use-cases", 1 req/s, no SLA (PROVEN_BY_WEB on 30 Sep in that doc) | **NO** (`ROUTER_PRODUCTION_SAFE = NO`). World-wide graph; routes through Bangladesh (RG-8) | `ROUTING_GRAPH_FRESHNESS.md` §1, §4 |
| Nominatim (OSM) geocoding | Address search; reverse lookup used as a fallback state and district label **only when no state geometry is loaded** | Third-party, non-authoritative | 1 req/s, identifying UA (`geocoding.py`) | Fallback only; can confirm NER, never "not NER" (`trip_geography.py`). Search includes `in,np,bt,bd,mm` (G5) | `geocoding.py`, `trip_geography.py` |
| OSM Overpass corridor snapshot (`corridor_snapshot.json`, retrieved 2026-09-20T01:11Z, 4,366 records) | Roadside places (fuel, emergency, hotels, rest, tyres) | Third-party, ODbL 1.0, static | Attribution "(c) OpenStreetMap contributors, ODbL" in the file | **Not filtered by country**: 121 name-marked foreign facilities (L3) | File header; `places_foreign_scan.txt` |
| NASA Global Landslide Catalog slice (`glc_ner.csv`, 471 events, 2007-2017) | `historical_incidents` exposure evidence | Third-party historical inventory | "License not specified" on the portal; cite Kirschbaum et al. | Evidence only, aged. It includes 50 events whose country field is not India (Bhutan 20, Myanmar 16, Bangladesh 12, China 2) and 108 blank | `backend/data/landslides/PROVENANCE.md`; count re-run 30 Sep |
| AWS Terrarium DEM | 3D terrain tilt in the manager map | Third-party elevation | Not recorded in this ledger | Display only | AG-12, `security/` lane |
| States seed names (migration 0013) | The 8 NER state rows | Names from the SIH26002 problem statement (MDoNER), per `states.source_name` | n/a | Names only; geometry NULL. The source is a problem statement, not a gazette notification | cert SQL, `cert_provenance.out` |
| `FIXTURE_SYNTHETIC_TEST_ONLY` (`backend/tests/geo_fixtures.py`) | Test rectangles for the classifier | TEST | n/a | **NEVER.** See `PRODUCTION_DATA_BOUNDARY.md` L2: a leftover fixture outline would admit Dhaka | `geo_fixtures.py` |
| MHA border pages (§3) | Text facts for the border cross-check | Official text | Government website | Not geometry; never converted into shapes | This ledger §3 |

## 3. Official pages read for border facts (reference)

| Page | Date read | SHA-256 (first 16) |
|---|---|---|
| MHA Border Management-I Division page | 30 Sep 2026 | `234b715e2a28f40c` |
| MHA `BMdiv_I_Annexure_I_12032021.pdf` | 30 Sep 2026 | `23a1de5ae51042c3` |
| MHA `BMIntro-1011.pdf` | 30 Sep 2026 | `9b6d7705a497ce7b` |
| MHA Lok Sabha USQ 1175 (11 Feb 2025) | 30 Sep 2026 | `ea0fca415e2c93bd` |
| MHA Rajya Sabha USQ 2437 (17 Mar 2021) | 30 Sep 2026 | `40587b9b2de1f12a` |
| MHA Lok Sabha USQ 4125 (20 Mar 2018) | 30 Sep 2026 | `3d926266a80a34d7` |
| SoI portal pricing page (OVSF/1M/7 row) | 30 Sep 2026 | `fb6160ee11931647` |
| SoI portal FAQ | 30 Sep 2026 | `f50e1107b8d411fa` |
| SoI geospatial guidelines page | 30 Sep 2026 | `71a7ffc954895573` |
| SoI Copyright Policy | 30 Sep 2026 | `e2929be3b2478734` |

The full hashes and URLs are in `.runtime/production/fix1/docs-policy/sources/SHA256SUMS.txt` and `FETCH_LOG.txt`. Page hashes identify what was read that day; dynamic pages will hash differently later.
