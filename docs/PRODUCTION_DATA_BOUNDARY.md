# Production data boundary

Date: 30 September 2026. Lane: docs-policy (fix round 1). No code was changed.

**Method.**
- Code reading.
- Read-only SQL on `ner_logistics_cert` on the isolated cluster 127.0.0.1:55432. The session ran with `default_transaction_read_only=on`, and every query was an aggregate: no names, e-mails, phones or licence numbers were printed.
- Two read-only scans of bundled data files.

Queries and outputs are in `.runtime/production/fix1/docs-policy/` (`cert_counts.sql/.out`, `cert_provenance.sql/.out`, `cert_provenance2.out`, `places_foreign_scan.*`, `places_find_border_probe.*`). Hosted Supabase was not read (NOT_VERIFIED).

## 1. Provenance classes

| Class | Meaning | How a row proves it |
|---|---|---|
| `PRODUCTION` | Written by a real operation in the production deployment | Only by where it lives: the hosted database, through the real API, by a real account. No column marks it |
| `VERIFIED_OFFICIAL` | Taken from an official source with a recorded reference and date | A provenance column, for example `districts.source_status`, or `geometry_source = SURVEY_OF_INDIA_OVSF_1M_7` |
| `DEMO` | Hand-made so a demonstration can run; real enough to operate against | `districts.source_status = 'DEMO'`, code prefixes (`SHP-DEMO-`, `TRP-DEMO`), `stored_files.kind = 'DEMO_REFERENCE'`, demo e-mail domains |
| `TEST` | Written by a test, fixture or certification script | `districts.source_status = 'TEST'`, `geometry_source = 'FIXTURE_SYNTHETIC_TEST_ONLY'`, prefixes `STEST-`/`TTEST-`/`DSPCERT-`, e-mail `*.invalid` / `rasta.test`, registrations `AS__ZZ%` / `AS66CT` |
| `UNVERIFIED` | Source not established | The default for `districts.source_status`, and every row whose writer cannot be named |

**Rule.** A class is claimed only from evidence. If no marker and no writer can be named, the row is UNVERIFIED. UNKNOWN is never SAFE.

## 2. The cert database is not production

`ner_logistics_cert` is a local certification database at `0015_instance_coordination` (so it has no `country_boundaries` table). **None of its rows is PRODUCTION.**

- **Users.** Its 9 users are at `rasta.demo` (6) and `rasta.test` (3). `.test` is an RFC 6761 reserved name; `.demo` is not one of the reserved names.
- **Shipments.** 36 in all:
  - 3 are `SHP-DEMO-nnnn` seeds from 19 Sep, with geography NULL.
  - 33 were created through the API between 26 and 29 Sep. 31 of them have `geography_source = OSM_NOMINATIM_REVERSE`; 2 have NULL.
- **Trips.** 3 are `TRP-DEMO-nnn` and 33 are API-created.
- **Districts.** All 4 are `DEMO` ("demo deployment - not a government notification"): Kamrup Metropolitan, Nagaon and Dibrugarh in Assam, and East Khasi Hills in Meghalaya.
- **Where the seed came from.** The seed that wrote the `SHP-DEMO` rows and the DEMO districts was **not found** in any tracked or `.runtime` script (grep, 30 Sep). Its writer is therefore UNVERIFIED, even though the rows are labelled DEMO.

## 3. Per-table boundary

**Cert rows** are exact counts from 30 Sep. **Marker** says whether the schema can tell DEMO or TEST apart from PRODUCTION.

| Table | Written by | Marker in schema | Cert rows | Cert class | Leak risk into production queries |
|---|---|---|---|---|---|
| `states` | Migration 0013 seed; importer adds non-NER rows (0016) | `source_name`, `geometry_source` | 8 (names from the SIH26002 problem statement; geometry NULL) | UNVERIFIED names (not a gazette); no geometry | Low. A non-NER row grants nothing (`scope.py`) |
| `districts` | Seeds, fixtures, the importer (VERIFIED_OFFICIAL) | `source_status` (enum), `source_name`, `geometry_source` | 4 DEMO | DEMO | **HIGH, see L1.** DEMO is in `OPERATIONAL_SOURCES` |
| `country_boundaries` | Importer; test fixture | `geometry_source` | table absent (0015) | n/a | **HIGH, see L2.** The classifier does not check `geometry_source` |
| `users` | API, `create_user.py`, `demo_account.py` (isolated only, guarded by `db_target.enforce`), certification scripts | None. The e-mail domain is a convention only | 9 | DEMO/TEST by domain | Medium (L5): nothing but naming separates a demo account; `is_active` is the containment |
| `drivers` | API (`POST /api/drivers`) | None | 3 | DEMO | Medium (L5) |
| `driver_documents`, `truck_documents`, `truck_maintenance` | API | None | 0 | n/a | Low |
| `trucks` | API; factories (`AS__ZZ`), certify (`AS66CT`) | Registration pattern (convention) | 5 | DEMO | Medium (L5) |
| `driver_truck_assignments` | API | `verification_source` (who verified) | 3 | DEMO | Low |
| `shipments` | API | `geography_source` (how geography was obtained); code prefix | 36 | DEMO/TEST | Medium. Scope comes from DEMO districts (L1); `OSM_NOMINATIM_REVERSE` is third-party (L7) |
| `cargo_items` | API | None | 36 | DEMO/TEST | Low |
| `trips`, `trip_stops`, `trip_events` | API | Code prefix only | 36 / 73 / 209 | DEMO/TEST | Medium. Dashboards and utilisation count them like any trip (L5) |
| `trip_routes` | API from the router | `routing_provider` | 28, all `osrm` (the public demo server) | Third-party, `PUBLIC_DEMO` provider, no data version | **HIGH, see L6.** Route provenance is not production-grade |
| `gps_points` | Driver app | `is_mock_location` | 1,374 (19-29 Sep), all `is_mock_location = false` | DEMO/TEST | **Medium, see L4.** The flag is false on web and iOS by construction |
| `driver_notifications`, `notifications` | Server | `kind` | 43 / 210 | DEMO/TEST | Low |
| `emergencies` | Sentinel, driver SOS | None | 5 (all RESOLVED) | DEMO/TEST | Low |
| `route_review_authorizations` | API | None | 25 | DEMO/TEST | Low |
| `stored_files` | API | `kind = DEMO_REFERENCE` | 0 | n/a | **Medium, see L8.** The label does not follow the photo URL |
| `audit_logs` | Server | None | 1,221 | DEMO/TEST | Low (records only) |
| `refresh_tokens` | Server | None | 2,233 (752 unrevoked and unexpired) | TEST residue | Low for data. Hygiene: many live tokens on a cert DB |
| `instance_leases`, `rate_limit_windows`, `provider_pacing` | Coordination (`MULTI_INSTANCE`) | n/a | 0 | n/a | None |
| `system_info` | Migration 0001 | `schema_marker` | 1 (`foundation-p1`) | Schema bootstrap | None |

### Bundled data files (not tables, but served as data)

| File | Serves | Class | Leak risk |
|---|---|---|---|
| `backend/app/services/places/data/corridor_snapshot.json` | `/api/places` (manager) and driver places | Third-party OSM (ODbL), static, 4,366 records | **HIGH, see L3.** Not filtered by country |
| `backend/data/landslides/glc_ner.csv` | `historical_incidents` risk evidence | Third-party NASA GLC, 471 events, 2007-2017 | Low-Medium (L9) |
| `backend/tests/geo_fixtures.py` | Tests only | TEST (`FIXTURE_SYNTHETIC_TEST_ONLY`) | See L2 |

## 4. Where DEMO or TEST can leak into production queries

| ID | Leak | Evidence | Effect | Control today | Recommended control (not implemented) |
|---|---|---|---|---|---|
| **L1** | DEMO districts count as operational | `models/geography.py` `OPERATIONAL_SOURCES = (VERIFIED_OFFICIAL, DEMO)`. It is used in `geo_classify._SQL` (district), `trip_geography` (OSM fallback), `api/org.py` and `api/dashboard.py` | In cert, every one of the 34 shipments that carry geography points at DEMO districts: 65 origin and destination references in all (`cert_provenance2.out`). In a production database any DEMO district row would scope real trips to District Managers, and would be counted and offered | `DATA_HYGIENE_AUDIT.md` / 0013: hosted was seeded with 0 districts on purpose | In production (`APP_ENV=production`), `OPERATIONAL_SOURCES` = VERIFIED_OFFICIAL only, with a startup or `/ready` check that fails if a DEMO or TEST district exists. Decide with the owner: until official districts load, District Managers see nothing, which is the honest answer |
| **L2** | A leftover fixture India outline admits foreign points | `geo_classify._SQL` reads `country_boundaries WHERE code = 'IN'` with **no `geometry_source` filter**. `FIXTURE_INDIA` is 70-97 E × 8-35 N minus one rectangular hole (85-88 × 14-18), so it **covers Dhaka (90.41, 23.81) and Sylhet (91.86, 24.90)** (arithmetic). `geo_fixtures.unload` removes it only when a test finishes cleanly. The db-pool lane also had to insert a synthetic outline to plan on a scratch DB (`db-pool/seed.py`) | Any database left with a fixture outline would silently accept foreign endpoints as India | `tests/db_target.py` keeps the suite on the isolated cluster; `geo_fixtures.load` refuses to overwrite a non-fixture outline | The classifier (or `/ready`) refuses any `geometry_source` other than the SoI source when `APP_ENV=production`. Better still, a DB CHECK or trigger on `country_boundaries.geometry_source` in production. Red test: a fixture row plus production settings gives 503, not "inside" |
| **L3** | Foreign facilities are served as roadside places | `places.find` filters by category and box only. The snapshot's per-state boxes (for example Tripura 22.9-24.6 N × 91.0-92.4 E) cover neighbouring territory. **121 records whose names or operators identify them as outside India**: Bangladesh 107, Bhutan 12, Myanmar 1, China 1. 105 of them are EMERGENCY or FUEL. This is a lower bound, because unnamed stations carry no marker (`places_foreign_scan.txt`). In-process probe of the real `find()` for a Meghalaya-border box: 7 EMERGENCY results, including the Companygonj and Jaintapur Upazila Health Complexes and the Tamabil Immigration Office (`places_find_border_probe.txt`) | A driver or manager can be offered a hospital, police station or fuel stop across the border as an option on a domestic trip | The response says `is_live=False` and carries attribution; no country control | After the SoI import: drop or tag every record not `ST_Covers(IN, point)` when the snapshot is built, and store `country`. Until then, do not label the list as "along your route in India" |
| **L4** | Simulated GPS looks real | `driver-app/src/tracking/adapter.ts`: `isMock` comes from Android's `mocked` field, "absent elsewhere". Web and iOS fixes are always sent as not-mock. The 16 Sep human-driven trip had its MOVING leg on simulated GPS in the driver **web** build (`PHYSICAL_ANDROID_EVIDENCE_RECONCILIATION.md`) | Demo movement is indistinguishable from real movement in `gps_points` (1,374 cert fixes, all `false`) | None | Record the platform per fix, or make the flag nullable (`null` = unknown) so "false" is claimed only where the platform can say it. Keep demo trips on demo accounts |
| **L5** | Demo and test entities sit in production tables with no class column | `users`, `drivers`, `trucks`, `trips`, `shipments` have no provenance column; separation relies on naming conventions and `is_active`. Hosted held **19,860 deactivated fixture users** and 5 retired fixture trucks when last audited (19 Sep; not re-read 30 Sep), written 30 Aug-6 Sep before the guard existed (`DATA_HYGIENE_AUDIT.md`, `test_fixture_residue_stays_excluded.py`) | Counts such as users, dashboards and utilisation are exact only while the containment rules hold | `tests/db_target.py` (suite), `core/disposable.py` (fixture loaders), `demo_account.py` → `db_target.enforce`; `test_fixture_residue_stays_excluded` holds the containment | A reviewed hosted cleanup plan (needs backup and permission: `HOSTED_FIXTURE_CLEANUP_PERFORMED = NO`). Certification against hosted must stay namespaced, and deactivation-not-deletion is documented. Consider a `data_class` column only if a real mixed tenant appears |
| **L6** | Route provenance is a public demo service | `trip_routes.routing_provider = 'osrm'` for 28/28 cert rows; the chain is `['osrm']` = `router.project-osrm.org`, with no `data_version` (RG-1, §3.1). The Supabase-target manager could store a **fabricated** `cached_corridor` (NF-06; being removed in flight by the manager lane) | Every stored route is third-party, unversioned and not production-safe (`ROUTER_PRODUCTION_SAFE = NO`) | None | `ROUTING_GRAPH_FRESHNESS.md` §6 (self-hosted, `data_version` stored per row). Guard: refuse to select a route whose provider is not an approved production provider when `APP_ENV=production` |
| **L7** | Third-party geography written into shipments | `shipments.geography_source = OSM_NOMINATIM_REVERSE` for 31/36 cert shipments; the OSM fallback runs only when **no** state geometry is loaded (`trip_geography.locate`) | Scope decisions rest on a non-authoritative answer, correctly labelled | The label is stored; the fallback can never prove "not NER" | After the SoI import every new shipment should read `POSTGIS_ADMIN_BOUNDARY`. A post-import report counts rows still on the OSM label; backfilling them is a separate reviewed change |
| **L8** | The DEMO photo label does not follow the photo | `api/files.py`: `DEMO_REFERENCE` sets `truck.photo_url` / `driver.photo_url` to the same `/api/files/{id}` shape as a real photo | A demo reference picture shows as the real truck or driver photo, with no demo label at the point of display | `stored_files.kind` keeps the label | Surface `kind` with the photo, or refuse `DEMO_REFERENCE` when `APP_ENV=production` |
| **L9** | Hazard history includes events outside India | `glc_ner.csv`: 313 India, 108 blank, and 50 in neighbouring countries (Bhutan 20, Myanmar 16, Bangladesh 12, China 2), chosen by a lat/lon box (`PROVENANCE.md`) | A cross-border event within the corridor distance can raise exposure for a domestic road. Physically defensible (terrain does not stop at a border), but unlabelled | Accuracy honoured; inventory flagged as aged | Keep the events, but show the country with the evidence. Never let a foreign event be described as "on your route" |

## 5. What the production database must satisfy

These are checks, not implemented. They belong in the hosted gate list.

```sql
-- no DEMO/TEST geography
select count(*) from districts where source_status in ('DEMO','TEST');                 -- 0
select count(*) from states where geometry_source is not null
  and geometry_source <> 'SURVEY_OF_INDIA_OVSF_1M_7';                                  -- 0
select count(*) from country_boundaries where geometry_source <> 'SURVEY_OF_INDIA_OVSF_1M_7'; -- 0
-- no fixture entities active
select count(*) from users where is_active and (email ilike '%.invalid' or email ilike '%@rasta.test');  -- 0
select count(*) from trucks where registration_number ~ '^AS[0-9]{2}ZZ' and status <> 'RETIRED';        -- 0
-- route provenance
select routing_provider, count(*) from trip_routes group by 1;   -- reported; 'osrm' = public demo server
```

Hosted values for all of these: NOT_VERIFIED (hosted was off-limits). The last hosted read is the 19 Sep hygiene audit.
