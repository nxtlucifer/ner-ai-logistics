# Map data conflation policy

Lane: docs-maps, fix round 1. Written 30 Sep 2026 against HEAD `5b5e474` plus the working tree.
Documentation only.

This is the policy for **combining** map data: which source decides what, how records from different
sources may be matched, and what must never be mixed. It applies to everything the product stores,
shows or decides with that has a location.

It rests on three bodies of rules:

- the owner decisions of 29 Sep 2026 (India-wide, NER-centred; Survey of India as the geography
  authority);
- the licences in `docs/MAP_DATA_SOURCE_LEDGER.md`;
- the evidence rules already in the code (`app/domain/road_memory.py`, `app/services/places/snapshot.py`).

Labels: `PROVEN_BY_SOURCE`, `PROVEN_BY_DOC(url)`, `INFERRED`. A "MUST" is policy for new work. §9
records how far today's code meets it.

## 1. Authority by feature class

One class has one deciding source. Other sources may **validate** it or **add context**, but they never
overwrite it.

| Feature class | Deciding source | May validate or add context | Never |
|---|---|---|---|
| International boundary; India/not-India | **Survey of India OVSF/1M/7** (owner decision). Guidelines 2021 clause xiii: SoI data "the standard to be used" for political maps of India (PROVEN_BY_DOC(https://onlinemaps.surveyofindia.gov.in/GeospatialGuidelines.aspx)) | — | OSM, Overture divisions, geoBoundaries, GADM, a bounding box, or any `FIXTURE_*` shape outside tests |
| State and district of a point | SoI (same product family) | Nominatim reverse, for labels only while SoI is absent, always labelled as such | Treating a Nominatim name as the scope decision |
| Road exists / road geometry | the routing graph built from the OSM extract (FINAL_SOURCE_ADMISSION_LEDGER: OSRM is "the only thing allowed to say a road exists") | Overture transportation (cross-check); fleet traversal (review queue, ROAD_DATA_FRESHNESS_PLAN §4.3) | Satellite or basemap pixels; any Google, Mapbox or Esri content |
| Road passable now | `road_memory` evidence, with its asymmetry: official or fleet traversal may open; operator or unverified reports may only raise doubt (`docs/ROAD_MEMORY.md` §3) | NDMA SACHET warnings (doubt only) | Elapsed time ("no news" never re-opens) |
| Roadside POIs (fuel, emergency, tyres, hotel, rest) | OSM snapshot (ODbL) | AAI (airports), data.gov.in lists, Overture places: as **validation links**, not merged records | Google Places content on the non-Google map (ToS §3.2.3(e), ledger §2.13) |
| Hazard history | NASA GLC slice, labelled `HISTORICAL_INVENTORY` with its year range | future official inventories, as separate sources | Presenting it as a current incident or a susceptibility map |
| Official warnings | NDMA SACHET only (FINAL_SOURCE_ADMISSION_LEDGER §1) | — | Any other source producing `OFFICIAL_WARNING` |
| Imagery (if ever added) | display only | — | As a data source for any class above |

## 2. Layer, do not merge

**Rule.** Data from different sources lives in separate layers or tables, each with its own
provenance. Links are made by reference (a link table of `source_a_id ↔ source_b_id` with a match
confidence), never by folding two sources into one record.

**Why.**

1. **Licence.** The OSMF Collective Database Guideline treats non-OSM data that only *references* OSM
   features as independent. An example is phone numbers linked to OSM restaurants, which are "not
   subject to share-alike". But "merging your proprietary restaurant list with OSM data while removing
   duplicates creates a Derivative Database", which would put share-alike on the project's own data
   when it is published. PROVEN_BY_DOC(https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline).
   The POI snapshot (4,366 features, systematic) is well above the "Less than 100 Features"
   insubstantial line. PROVEN_BY_DOC(https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline) + PROVEN_BY_SOURCE.
2. **Evidence.** A merged record hides which source said what. The project already refuses that
   inside one source: `_merge_group` keeps every `provider_id` and every disagreeing value in
   `conflicts` (`backend/app/services/places/snapshot.py:126-183`).

**Allowed merge (within one source only).** The snapshot's existing rule stays:

- same category, same case-folded name, within `DUPLICATE_RADIUS_M = 150`;
- unnamed records never merge;
- all ids and conflicts are kept.

PROVEN_BY_SOURCE (`snapshot.py:59,186-234`).

## 3. Geography: clip to India, with no outward tolerance

These MUST rules follow the owner decisions of 29 Sep 2026:

1. **Service country.** Every displayed or offered location layer (POIs, stops, places near a route)
   is clipped to the SoI India polygon. A record outside is excluded from the product layer. It is
   not moved, snapped or relabelled.
2. **No outward tolerance.** Clipping uses `ST_Covers` against the SoI polygon with **no buffer**. The
   only ambiguity allowed is `BORDER_AMBIGUOUS`, and it comes from a GPS fix's own accuracy circle
   touching the boundary (`geo_classify.py:24-25`). It never comes from a fixed margin, and it never
   applies to POIs or plans, which have no accuracy.
3. **No country lists.** The test is "inside India or not". No code, table or style names a foreign
   country as hostile or special. A record outside India is excluded because it is outside the service
   country.
4. **Until SoI is imported**, nothing can be clipped correctly. Layers keep their records, but they
   are not presented as India-only. The fix is the import (`SOI_REAL_DATA = BLOCKED_USER_DOWNLOAD`),
   not a bounding-box stand-in.
   - The per-state bounding boxes are why foreign records exist today: 53 in a small box around
     Sylhet (Bangladesh) and 38 around Thimphu (Bhutan) (`poi_hazard_data_checks.txt`).
     PROVEN_BY_SOURCE.
5. **Hazard evidence near a border** (proposal for the owner). A landslide across the border inside
   the corridor buffer is physical evidence about the terrain the road crosses. It may be counted as
   exposure, but it MUST keep its recorded `country_name` on display. A blank country is shown as
   UNKNOWN. It is never attributed to an Indian district. The GLC slice has 313 India rows, 50 foreign
   rows and 108 blank rows (PROVEN_BY_SOURCE).
6. **Routes.** A domestic route never crosses an international boundary. A candidate that does is
   dropped with `ROUTE_CROSSES_COUNTRY_BOUNDARY`. With no candidate left, the trip goes to
   HOLD_AND_REVIEW (owner decision; not implemented, NF-05). Outside India is refused with 422
   `OUTSIDE_SUPPORTED_COUNTRY`. `INDIA_EXTERNAL` is refused while the flag is off, with 422
   `NOT_NER_CONNECTED`.
7. **Fixtures.** `FIXTURE_*` geometry (`geometry_source = FIXTURE_SYNTHETIC_TEST_ONLY`,
   `backend/tests/geo_fixtures.py:35`) exists only in tests and scratch databases. It is never called
   production geography. Runtime code MUST refuse it as the India boundary outside tests. See §9 row 3:
   today it does not refuse it.

## 4. Provenance every record carries

| Field | Meaning | Exists today |
|---|---|---|
| `source` | publisher/dataset name | POI snapshot `source.name` (yes). Hazards `source_name` per GLC row (yes) |
| `source_id` | id in that source (`osm:node/…`, GLC `event_id`) | POI `provider_id` / `provider_ids` (yes). GLC `event_id` (yes) |
| `retrieved_at` / `version` | when we fetched it, or its release | POI `retrieved_at` (yes). GLC fetch date in `PROVENANCE.md` (yes). Boundaries `geometry_source_version` (column exists, 0016) |
| `licence` | licence id | POI `ODbL 1.0` (yes). Others per the ledger |
| `conflicts` | disagreeing values, kept | POI (yes) |
| `country_check` | `IN` / `OUTSIDE` / `UNKNOWN` against SoI | **no** (needs SoI) |

A record without `source` and `retrieved_at` MUST NOT be shown as fact.

## 5. Matching rules across sources

When two sources describe what may be the same thing (for example an OSM hospital and a data.gov.in
hospital list entry):

1. Match on **class, distance and name similarity** together. The distance and name thresholds are
   stated per class and kept in the link table. Distance alone is not enough: the snapshot docstring
   gives the hospital-and-police-station-40-m example. Name alone is not enough: it gives "Maruti
   Suzuki" 48 km apart (`snapshot.py:186-208`).
2. The output is a **link row** with `match_confidence` and the rule that produced it. It never edits
   either record's geometry or attributes.
3. On disagreement (names, phone, opening hours), both values are kept and shown as disagreeing.
   Nothing is resolved silently. A newer date does not automatically win: each source's date is shown.
4. Absence in one source is **"not mapped there"**, never "does not exist". The snapshot already says
   so: "Absence means NOT MAPPED in OpenStreetMap at retrieval time" (`corridor_snapshot.json`
   `coverage.limits`).
5. UNKNOWN is never SAFE. A record with an unknown country, date or status is shown as unknown and
   never counted as passing a check.

## 6. What may never become map data

| Content | Rule | Basis |
|---|---|---|
| Google Maps content (tiles, satellite, Places) | never traced, stored, cached (beyond the explicit carve-outs) or shown next to a non-Google map | PROVEN_BY_DOC(https://cloud.google.com/maps-platform/terms) §3.2.3(a)(b)(c)(e) |
| Mapbox Licensed Map Content | never cached or stored. Satellite tracing is allowed only "for non-commercial purposes or … for OpenStreetMap" | PROVEN_BY_DOC(Mapbox Product Terms, 21 Jul 2026) |
| MapTiler tiles | only a temporary per-user cache. No server-side store | PROVEN_BY_DOC(https://www.maptiler.com/terms/cloud/) |
| Bhuvan content | never redistributed or made available to third parties | PROVEN_BY_DOC(https://bhuvan.nrsc.gov.in/terms.php) |
| AAI eAIP | "All Rights Reserved": validation only | PROVEN_BY_DOC(https://aim-india.aai.aero/) |
| NHAI / MoRTH / IWAI / CRIS viewers | no licence published: reference only, with the manager citing them | PROVEN_BY_DOC (ledger §2.6, §2.8, §2.9) |
| OSM Standard tiles | never bulk-downloaded or prefetched for offline | PROVEN_BY_DOC(https://operations.osmfoundation.org/policies/tiles/) |

**Contributing back to OSM.** Allowed only from a person's own knowledge, or from sources that OSM
accepts. Never from fleet GPS traces of customers' trips (§7), and never from Google content.

## 7. Private data

- Fleet GPS, stops, customer addresses, driver identity and trip codes are **private overlays**. They
  are never conflated into a shared or public dataset. They are never uploaded to OSM or any third
  party, and never placed in a tile, style or third-party URL (`docs/MAP_PRODUCTION_ARCHITECTURE.md` §5).
- Derived fleet signals (traffic, possible unmapped road, possible closure) stay internal. Where they
  are shown, they carry `FLEET_OBSERVED`, a count of distinct vehicles and a time.

## 8. Licence compatibility (for a combined product)

| Source licence | Combine in own tiles or DB? | Obligation |
|---|---|---|
| ODbL (OSM; Overture base, buildings, divisions, transportation) | yes | attribution. Share-alike on a **published** derived database. Keep other data in separate, reference-linked layers (§2) |
| CDLA Permissive 2.0 / Apache 2.0 / CC0 (Overture places) | yes | notices per source |
| GODL (data.gov.in) | yes | the GODL attribution statement |
| EU Copernicus (Sentinel) | yes | "Contains modified Copernicus Sentinel data [Year]" |
| USGS public domain (SRTM, GMTED2010, via AWS Terrain Tiles) | yes | credit |
| CC-BY-SA (OpenTopoMap cartography) | display only (it is a produced work, not data) | attribution; share-alike on adapted cartography |
| SoI OVSF | yes, for display (clause xiii) | credit (owner decision). Other terms not found |
| Proprietary (Google, Mapbox, MapTiler, Esri) | **no** (display through their service only) | their terms (§6) |
| No licence published (NHAI, IWAI, CRIS, AAI) | **no** | reference or validation only |

## 9. Compliance of today's code with this policy

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | Boundary authority is SoI only | Design MET, data BLOCKED: no SoI rows, so planning fails closed with 503 `GEOGRAPHY_UNAVAILABLE` | S10, C-17. PROVEN_BY_SOURCE + PROVEN_BY_DATABASE (via ANTIGRAVITY_FINDINGS_REPRODUCTION) |
| 2 | No bounding box as a geography authority | MET in the working tree: `SERVICE_REGION` bbox removed; leftovers are non-authoritative | C-10. PROVEN_BY_SOURCE |
| 3 | `FIXTURE_*` never accepted as the India boundary outside tests | **NOT MET.** `classify_point` reads `country_boundaries WHERE code = :code` with no `geometry_source` filter (`backend/app/services/geo_classify.py:74-99`). The db-pool lane's scratch database planned trips after inserting a `FIXTURE_SYNTHETIC_TEST_ONLY` India row (`.runtime/production/repro/db-pool/seed.py:51-53`; C-17). No production database has such a row today, so this is a guard gap, not an incident | PROVEN_BY_SOURCE |
| 4 | POI layers clipped to India | **NOT MET**: foreign records are present (§3.4) | PROVEN_BY_SOURCE |
| 5 | Hazard rows keep the recorded country on display | NOT MET: tooltips show year and name only (`scene.ts:136-138`) | PROVEN_BY_SOURCE |
| 6 | Within-source dedupe keeps ids and conflicts | MET | `snapshot.py:126-234` |
| 7 | Every POI response carries source, licence and retrieved_at | MET | `domain/places.py:279-296`, `snapshot.py:252-260` |
| 8 | No merge of OSM with private POIs | MET (no private POI store exists) | table list, `backend/app/models` |
| 9 | Google content never on a non-Google map | MET while dormant. **Would fail** if `GOOGLE_PLACES_API_KEY` were set (Places results shown and stored on the OSM/MapLibre map) | `backend/app/services/geocoding.py:1-28` |
| 10 | OSM attribution linked, with ODbL stated | NOT MET | ledger §2.1 |
| 11 | Route never crosses a border | NOT MET (NF-05) | ANTIGRAVITY_FINDINGS_REPRODUCTION NF-05 |
| 12 | Absence shown as "not mapped" | MET in the snapshot metadata. The layer UI wording was not re-checked this round | `corridor_snapshot.json` |

## 10. Acceptance checks for the implementation (to be written with the fixes, not here)

1. `classify_point` with a `FIXTURE_SYNTHETIC_TEST_ONLY` India row and a non-test setting answers
   `GEOGRAPHY_UNAVAILABLE`. With a `SURVEY_OF_INDIA_OVSF_1M_7` row it classifies. Mutation: remove the
   filter and the first assertion must fail.
2. With a SoI (or, in tests, fixture) India polygon loaded, `/api/places` for a box straddling the
   border returns no record outside the polygon. A record exactly on the boundary is inside
   (`ST_Covers`). A record 1 m outside is excluded (no buffer).
3. A hazard event with `country_name = 'Bangladesh'` near a route is shown with that country. A blank
   country is shown as UNKNOWN.
4. A conflation of two sources produces link rows only: both source tables are byte-identical before
   and after.
5. With a Places key configured, no Places-derived coordinate is persisted as a trip stop and none is
   drawn on the MapLibre map. Or the Places client is removed (owner decision, ledger §2.13).
