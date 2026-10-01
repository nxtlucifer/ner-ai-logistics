# NER service region policy

Date: 30 September 2026. Lane: docs-policy (fix round 1). No code was changed to write this. Evidence is in `.runtime/production/fix1/docs-policy/`.

The policy it applies is in `docs/LOGISTICS_COVERAGE_POLICY.md`. This document answers one question per location: what should happen, and why.

## 1. Header

```
SERVICE_REGION        = India-wide logistics, NER-centred. Every endpoint must be inside India;
                        every trip must start or end in one of the 8 NER states
                        (INDIA_EXTERNAL refused while ALLOW_INDIA_EXTERNAL_TRIPS=False).
NER_STATES            = Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim,
                        Tripura. These are the 8 seeded `states` rows, is_ner backfilled BY NAME in
                        migration 0016. Every other Indian state the importer adds gets is_ner = false.
STATE_GEOMETRY_SOURCE = Survey of India, Administrative Boundary Database, product OVSF/1M/7:
                        "Entire country, up to District level with HQ", SHAPEFILE, 1:1M, price 0
                        (onlinemaps.surveyofindia.gov.in pricing and product pages, read 30 Sep 2026).
                        NOT IMPORTED. The download needs a CAPTCHA and consent that only the user may
                        complete (SOI_REAL_DATA = BLOCKED_USER_DOWNLOAD). See GEOSPATIAL_SOURCE_LEDGER.
COUNTRY_OUTLINE       = India = union of the SoI country layer (import_soi_boundaries.py, step 5),
                        in country_boundaries code 'IN'. 0 rows in every database today (S10).
DISTRICTS             = SoI districts for NER states only, marked VERIFIED_OFFICIAL on import.
                        Today: 0 geometries. The only operational district rows in any DB read are
                        DEMO (ner_logistics_cert: 4) or TEST (ner_logistics_test).
TOLERANCE             = NONE OUTWARD. ST_Covers on a closed set: a point exactly on the boundary is
                        inside, and a point one metre outside is outside. No buffer, snap or "near
                        India" rule ever widens India. BORDER_AMBIGUOUS is returned ONLY when a GPS
                        fix's accuracy_m circle reaches the boundary. That is uncertainty, not
                        tolerance, and it refuses (422) rather than accepting.
CORRIDOR_POLICY       = No corridor polygon is added to the NER. Siliguri and the rest of West Bengal
                        are India, not NER: a valid NER_OUTBOUND/INBOUND endpoint, and a valid place
                        to drive through. A route that leaves India (for example through Bangladesh)
                        is dropped (ROUTE_CROSSES_COUNTRY_BOUNDARY); with no candidate left, the trip
                        is HOLD_AND_REVIEW. The retired box 21.5-29.5 N x 88.0-97.5 E, which
                        "included the Siliguri corridor", is not a policy input anywhere.
FAIL_MODE             = No India outline loaded: 503 GEOGRAPHY_UNAVAILABLE, never "inside".
                        Unknown state: not a refusal; intelligence_coverage UNKNOWN, which is never SAFE.
LAST_VERIFIED         = 2026-09-30. Code read (geo_classify.py, trip_geography.py, shipments.py,
                        trips.py); fixture tests (test_geo_classify.py: 40 pass, 22 skip, S13); old
                        box evaluated arithmetically; SoI rows = 0 (S10). NOT verified against real
                        geometry: nothing real is loaded.
```

## 2. Location matrix

**Coordinates** come from `backend/tests/test_geo_classify.py::REAL` unless marked otherwise. Two extra points come from bundled third-party data:
- Sylhet: NASA Global Landslide Catalog row 9308 in `backend/data/landslides/glc_ner.csv`, country "Bangladesh".
- Tamabil Immigration Office: OSM `node/5158255558` in `backend/app/services/places/data/corridor_snapshot.json`.

The geometric cases get no invented coordinate. Their test points must be **derived from the imported SoI geometry itself** (§5).

**Columns.**
- **OLD BOX**: the deployed build `e4043ce`, where `in_service_region` accepts inclusive 21.5 ≤ lat ≤ 29.5 and 88.0 ≤ lon ≤ 97.5. PROVEN_BY_SOURCE plus arithmetic.
- **TODAY**: the working tree against a 0016 database with 0 SoI rows.
- **EXPECTED**: this policy, once SoI is imported.

| LOCATION | lat, lon | OLD BOX | TODAY | EXPECTED | REASON |
|---|---|---|---|---|---|
| Guwahati | 26.1445, 91.7362 | accepted | 503 `GEOGRAPHY_UNAVAILABLE` | In India, **NER** (Assam); `NER_DEEP`; accepted as either end | NER state capital region |
| Shillong | 25.5788, 91.8933 | accepted | 503 | In India, **NER** (Meghalaya); `NER_DEEP` | NER |
| Aizawl | 23.7271, 92.7176 | accepted | 503 | In India, **NER** (Mizoram); `NER_DEEP` | NER |
| Itanagar | 27.0844, 93.6053 | accepted | 503 | In India, **NER** (Arunachal Pradesh); `NER_DEEP` | NER |
| Kolkata | 22.5726, 88.3639 | **accepted** (lon ≥ 88.0) | 503 | In India, **not NER** (West Bengal); `INDIA_BASELINE`. Accepted only when the other end is NER. Kolkata→Delhi: 422 `NOT_NER_CONNECTED` | The old box admitted it by accident of longitude, not by policy |
| Delhi | 28.6139, 77.2090 | **refused** | 503 | In India, not NER; `INDIA_BASELINE`. Guwahati→Delhi `NER_OUTBOUND`; Delhi→Guwahati `NER_INBOUND` | India-wide logistics (D1). The old box wrongly refused it |
| Mumbai | 19.0760, 72.8777 | **refused** | 503 | In India, not NER. Guwahati→Mumbai `NER_OUTBOUND` | D1 |
| Ahmedabad | 23.0225, 72.5714 | **refused** | 503 | In India, not NER. Guwahati→Ahmedabad `NER_OUTBOUND` | D1. A trip to Ahmedabad (TRP-08726C5F) was the reason the old box was added |
| Bengaluru | 12.9716, 77.5946 | refused | 503 | In India, not NER. Guwahati→Bengaluru `NER_OUTBOUND` | D1 |
| Dhaka | 23.8103, 90.4125 | **accepted** (inside the box) | 503 | **422 `OUTSIDE_SUPPORTED_COUNTRY`** (`field` = pickup or destination); nothing stored | Outside India (D2). The old box admitted a foreign capital |
| Bangladesh point inside the old box: Sylhet | 24.9007, 91.8644 (GLC 9308) | **accepted** | 503 | **422 `OUTSIDE_SUPPORTED_COUNTRY`** | Outside India (the GLC row's country field says "Bangladesh"). It sits inside the old box, so a lat/lon box cannot tell it apart from Shillong |
| Siliguri | 26.7271, 88.3953 | accepted | 503 | In India, **not NER** (West Bengal); `INDIA_BASELINE`. Shillong→Siliguri `NER_OUTBOUND`; Siliguri→Shillong `NER_INBOUND`; Kolkata→Siliguri 422 `NOT_NER_CONNECTED` | The corridor is Indian territory but not NER; the corridor policy adds no NER polygon |
| Exact boundary: a point exactly on the SoI India outline | derived from the geometry | depends on the box | 503 | **In India** (closed set). State = the covering state, NER first, then slug. With `accuracy_m` whose circle crosses the line: 422 `BORDER_AMBIGUOUS`, which no API path reaches yet (FC-01) | D4: no outward tolerance, and the boundary itself is inside |
| Just outside a NER state, foreign side: Tamabil Immigration Office | 25.18327, 92.03194 (OSM node/5158255558) | **accepted** | 503 | **422 `OUTSIDE_SUPPORTED_COUNTRY`** however close to Meghalaya | D4: metres outside is outside. The country is INFERRED from the OSM name (the Bangladesh side of the Dawki-Tamabil crossing); the SoI outline decides, and if it puts this point inside India the row must be replaced, not the rule |
| Just outside a NER state, India side (for example West Bengal next to Assam) | derived from the geometry | depends on the box | 503 | In India, **not NER**; `INDIA_BASELINE`. The trip type follows the other end | Crossing a state line inside India changes coverage depth, not admission |
| Outside India, far (fixture analogue `P_OUTSIDE` 40.0, 60.0) | fixture only | refused | 503 | 422 `OUTSIDE_SUPPORTED_COUNTRY` | D2 |

**TODAY, other paths.**
- The Supabase-target manager: `app.plan_trip` has no geography check (NF-04). The manager lane moved planning to the FastAPI "plane" on 30 Sep (in flight; see `LOGISTICS_COVERAGE_POLICY.md` §4).
- The deployed build: the OLD BOX column. Hosted runtime is NOT_VERIFIED.

## 3. What the old box got wrong (arithmetic, PROVEN_BY_SOURCE)

Of the 13 named points above, the old box made 7 wrong decisions.

| Wrong in this direction | Points |
|---|---|
| Refused Indian places | Delhi, Mumbai, Ahmedabad, Bengaluru |
| Admitted foreign places | Dhaka, Sylhet, Tamabil |

It also admitted Kolkata and Siliguri, which is correct under today's policy but only by accident of longitude. A box cannot express "India, and touch the NER". That is why the working tree removed it (`schemas/domain.py`: the `ShipmentCreate` comment; `test_schemas.py` asserts it is gone).

Stale non-authoritative copies of the box remain:
- `schemas/common.py` `NER_LAT_RANGE`/`NER_LON_RANGE` (dead)
- the Nominatim search bias in `geocoding.py`
- the per-state boxes of the places snapshot, which admit foreign POIs (see `PRODUCTION_DATA_BOUNDARY.md` L3)
- `docs/API_CONTRACTS.md`, which still documents `OUTSIDE_SERVICE_REGION` (stale doc, P3)

## 4. Trip matrix

Rows 1-11 are `MATRIX` in `test_geo_classify.py`, skipped until SoI. Rows 12-16 are added by this policy and are not tests yet.

| # | Origin → Destination | Expected |
|---|---|---|
| 1 | Guwahati → Shillong | `NER_INTERNAL` |
| 2 | Guwahati → Kolkata | `NER_OUTBOUND` |
| 3 | Guwahati → Delhi | `NER_OUTBOUND` |
| 4 | Guwahati → Mumbai | `NER_OUTBOUND` |
| 5 | Guwahati → Bengaluru | `NER_OUTBOUND` |
| 6 | Guwahati → Ahmedabad | `NER_OUTBOUND` |
| 7 | Delhi → Guwahati | `NER_INBOUND` |
| 8 | Shillong → Siliguri | `NER_OUTBOUND` |
| 9 | Siliguri → Shillong | `NER_INBOUND` |
| 10 | Dhaka → Guwahati | 422 `OUTSIDE_SUPPORTED_COUNTRY` (field pickup) |
| 11 | Guwahati → Dhaka | 422 `OUTSIDE_SUPPORTED_COUNTRY` (field destination) |
| 12 | Kolkata → Delhi | 422 `NOT_NER_CONNECTED`, nothing stored |
| 13 | Kolkata → Siliguri | 422 `NOT_NER_CONNECTED` |
| 14 | Guwahati → Sylhet | 422 `OUTSIDE_SUPPORTED_COUNTRY` |
| 15 | Shillong → Tamabil Immigration Office | 422 `OUTSIDE_SUPPORTED_COUNTRY` |
| 16 | Agartala → Kolkata, route level | Each candidate whose geometry leaves India is dropped (`ROUTE_CROSSES_COUNTRY_BOUNDARY`); none left gives `HOLD_AND_REVIEW`. Public OSRM answered 422.5 km against a 329.9 km great-circle distance, which implies a Bangladesh transit (RG-8; `INTERNATIONAL_BORDER_LOGISTICS_SECURITY.md` §4) |

Note on row 16: Agartala has no coordinate in `REAL`. Take one from the SoI district HQ layer after import, not from memory. The RG-8 probe used 23.8315, 91.2868.

## 5. Tests this policy requires

| Test | Where | State on 30 Sep |
|---|---|---|
| 11 `REAL` cities + 11 `MATRIX` trips | `test_geo_classify.py::TestRealCities` | Written, **skipped** (the `soi_imported` fixture needs an `IN` row with `geometry_source = SURVEY_OF_INDIA_OVSF_1M_7`) |
| Sylhet and Tamabil added to `REAL` (`in_india` False) | same | **Missing** |
| Trip rows 12-15 added to `MATRIX` | same | **Missing** |
| Exact boundary on the real outline: take a vertex of `ST_Boundary(country_boundaries['IN'])`, assert `in_india` True and `border_ambiguous` False | same, run after import | **Missing** (the fixture analogues `P_ON_INDIA_EDGE` and `P_ON_HOLE_EDGE` pass) |
| Just outside, foreign side: a point derived 1 m outside the outline (along an outward normal, computed in PostGIS), expecting 422 | same | **Missing** (fixture analogue `P_NEIGHBOUR` passes) |
| Just outside a NER state, India side: `ST_PointOnSurface` of (a West Bengal polygon ∩ a 1 km buffer of Assam), expecting `is_ner` False and `in_india` True | same | **Missing** (fixture analogue `P_WEST_BENGAL` passes) |
| Post-import validation: all eight NER states share part of their boundary with the India outline. MHA lists an international border for each of the eight (`INTERNATIONAL_BORDER_LOGISTICS_SECURITY.md` §2) | importer summary or a new test | **Missing** |
| Post-import validation: 0 real-city unknowns (G1) | same | **Missing** |
| `BORDER_AMBIGUOUS` through the API when GPS is classified (FC-01) | new | **Missing** (direct classifier tests only) |

## 6. Change control

Any change needs the same evidence as the original: an owner decision, a matrix row and a test. That covers changing the NER state list, `is_ner`, the tolerance, the corridor policy or `ALLOW_INDIA_EXTERNAL_TRIPS`. A new SoI edition is a data change, not a code change: re-hash it, re-import it into an isolated database, and re-run §5 before any shared database sees it.
