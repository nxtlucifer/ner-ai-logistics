# Data plugin findings (POI snapshot, Alembic chain, fixture guards)

Lane: plugins-engineering-data (Data Governance). Date: 2026-09-26.
Subject: the local working tree (main 5b5e474 plus the uncommitted post-demo tree, tag
`snapshot/post-demo-2026-09-26`), the isolated PostgreSQL cluster at 127.0.0.1:55432, and nothing
hosted.

Database access in this run:
- `ner_logistics_test`: read-only queries only, on connections opened with
  `default_transaction_read_only=on` and rolled back. No writes.
- `ner_logistics_cert`, `ner_logistics_demo`: not touched.
- `ner_lane_ped_proof`: a database this lane created, migrated, used and dropped. It is the only
  place a migration ran.

No file was fetched from the network and no package was installed. Evidence labels as in the
engineering document; each claim carries exactly one.

---

## 1. Plugin ledger

| PLUGIN | OWNER_ROLE | TASK | WHY_RELEVANT | INPUT | OUTPUT | EVIDENCE | STATUS | FOLLOW_UP |
|---|---|---|---|---|---|---|---|---|
| data:explore-data | Data Governance | Profile backend/app/services/places/data/corridor_snapshot.json | The snapshot is what the driver's roadside-services map shows | Skill loaded through the Skill tool. No warehouse connector is involved; the input is a file. I ran its profiling steps (shape, keys, nulls, duplicates, distributions, consistency) as a local Python script | Section 2 | PROVEN_BY_RUNTIME | USED_AND_USEFUL | Fix D1 to D3 in integration commit 6 before it lands |
| data:validate-data | Data Governance | Apply the pre-delivery QA checklist to the snapshot's provenance claims, the Alembic chain and the fixture guards | Checks that the stated limits and counts match the data | Skill loaded through the Skill tool. I applied its checklist myself (source, completeness, dedup, filters, reasonableness, caveats) | Sections 2 to 4. Snapshot verdict: share with caveats | See each finding | USED_AND_USEFUL | Caveats in section 2.4 go into the served `limits` text |
| Data plugin connectors (bigquery, hex, amplitude, definite) | Data Governance | Not needed | The data is a local file and a local PostgreSQL | None | None | PROVEN_BY_RUNTIME (session reported these servers need authentication) | NOT_RELEVANT | None |

---

## 2. POI snapshot: `backend/app/services/places/data/corridor_snapshot.json`

The working-tree file replaces the committed one. The committed (HEAD) file covers the
Guwahati-Jorhat corridor in 720 records. The working-tree file covers eight states in 4,366
records. Both facts were read from the files: PROVEN_BY_RUNTIME.

### 2.1 Profile (data:explore-data)

| Check | Result | Evidence |
|---|---|---|
| Rows | 4,366 raw records. The loader's `_dedupe` gives 4,306 unique places (60 records merged into 55 places) | PROVEN_BY_RUNTIME |
| Per-category counts vs the file's own `counts` block | Equal. EMERGENCY 1,984, HOTEL 1,261, FUEL 726, TYRES 325, REST 70 | PROVEN_BY_RUNTIME |
| Duplicate `provider_id` | 0 | PROVEN_BY_RUNTIME |
| Missing or non-numeric coordinates | 0 | PROVEN_BY_RUNTIME |
| Outside the declared union bbox, or outside every state box | 0 and 0 | PROVEN_BY_RUNTIME |
| Same category and same name within 50 m | 48 pairs. The loader's 150 m rule (snapshot.py:59) merges these | PROVEN_BY_RUNTIME |
| Identical coordinates (6 dp) | 2 groups, 4 records | PROVEN_BY_RUNTIME |
| Unnamed places | 562 of 4,366 (12.9%). FUEL is the worst: 253 of 726 (34.8%) | PROVEN_BY_RUNTIME |
| Element types | 3,870 OSM nodes, 496 OSM ways | PROVEN_BY_RUNTIME |
| Tag keys present | amenity, tourism, healthcare, shop, operator, brand, highway. Nothing else | PROVEN_BY_RUNTIME |
| Provenance block | Source, ODbL attribution, licence, endpoint, one file-level `retrieved_at` (2026-09-20T01:11:37Z), method, per-state boxes, cap 400 per category per state, limits text | PROVEN_BY_RUNTIME |

### 2.2 Findings

#### D1. Some Overpass queries were probably cut off at the 400 cap, and the served text says absence means "not mapped"

- Where: backend/scripts/acquire_places_snapshot.py:94 (`CAP_PER_CATEGORY_PER_STATE = 400`) and
  :104 (`out center qt 400`). The script records only how many new unique records each category
  added (:173-194), not which query came back full. The `limits` string
  (acquire_places_snapshot.py:233-238) is served to clients as `PlaceSource.limits`
  (backend/app/services/places/snapshot.py:252-259). It says "Absence means NOT MAPPED in
  OpenStreetMap at retrieval time".
- Measured: inside the Assam state box the file holds 1,523 EMERGENCY, 559 FUEL and 779 HOTEL
  records, each above the 400 cap. Meghalaya EMERGENCY is exactly 400 and Arunachal Pradesh
  EMERGENCY is 408. PROVEN_BY_RUNTIME.
- Inference: every one of those records matches the category's tags and lies inside the Assam
  box, so an uncapped Assam query would have returned at least 1,523 EMERGENCY elements. The
  Assam queries for those three categories therefore stopped at 400. Places inside Assam are in
  the file partly because neighbouring states' boxes overlap it. `qt` orders output by quadtile,
  so the gaps are likely clustered in space rather than spread out. INFERRED (the Overpass
  queries were not re-run).
- Effect: where a query was truncated, a missing hospital may be a truncated result rather than
  an unmapped one, and the text shown to users says otherwise.
- Severity: Medium
- Recommendation: (a) now, without any network call, change the limits text to say results were
  capped at 400 per category per state and that absence inside a capped area is not evidence of
  absence; (b) change the script to record, per (category, state), the element count returned and
  `truncated = count >= cap`, and write that into `coverage`; (c) later, re-acquire with smaller
  tiles. That is a network action and needs a user decision.
- Decision: ADOPT_NOW for (a) and (b). ROADMAP for (c).

#### D2. The expanded snapshot dropped every phone number, opening time and truck-access tag

- Where: backend/scripts/acquire_places_snapshot.py:139-143 keeps only amenity, shop, tourism,
  highway, healthcare, operator and brand. The loader reads phone, contact:phone, opening_hours,
  hgv, maxheight, access, fee, toilets and lit (backend/app/services/places/snapshot.py:84-103).
  The driver app shows phone, opening hours and HGV access
  (driver-app/src/screens/MapScreen.tsx:168, :195, :197, :942).
- Measured: 0 of 4,306 unique places have a phone, opening hours or an hgv value in the
  working-tree file. The committed 720-record file had 43 records with a phone and 19 with
  opening hours. PROVEN_BY_RUNTIME.
- Effect: every place on the driver's map, hospitals and police included, now shows those fields
  as unknown. This is a regression hidden inside a coverage expansion.
- Severity: Medium
- Recommendation: add the loader's keys to the script's allowlist. Re-acquiring to fill them is a
  network action and is ROADMAP.
- Decision: ADOPT_NOW (allowlist) in integration commit 6. ROADMAP (re-acquisition).

#### D3. Code comments still describe the old 720-record file

- Where: backend/app/services/places/snapshot.py:17 ("The file holds 720 raw category records")
  and :79-81 ("677 of the 720 records have no phone"); backend/app/domain/places.py:9-11 ("720
  places, of which 43 carry a phone number and 19 carry opening hours").
- Evidence: PROVEN_BY_SOURCE (compared with the measured 4,366, 4,306 and 0 in 2.1 and D2)
- Severity: Low. Decision: ADOPT_NOW (comments only)

#### D4. Row-level provenance is thin

- Each row carries `provider_id`, category, name, coordinates and a filtered tag set. It does not
  carry the OSM element version or timestamp, or which state query produced it
  (acquire_places_snapshot.py:133-144). PROVEN_BY_SOURCE.
- A place that matches two categories is kept only under the first category processed, because
  deduplication is on `provider_id` across categories (acquire_places_snapshot.py:186-190).
  PROVEN_BY_SOURCE. How many places this affects is unknown: NOT_VERIFIED.
- Severity: Low. Decision: ROADMAP

### 2.3 Validation verdict (data:validate-data)

**Share with caveats.** The structure is clean: no duplicate ids, no bad coordinates, counts
reconcile. The caveats in 2.4 must reach users because the served limits text currently
overstates completeness (D1) and the contact fields are empty (D2).

### 2.4 Caveats that must travel with the snapshot

- Results were capped at 400 per category per state. Several queries hit the cap (D1, INFERRED).
- No contact, hours or access tags in this extract (D2, PROVEN_BY_RUNTIME).
- One file-level retrieval date. Nothing is verified against the business (already in the
  limits text: PROVEN_BY_SOURCE).

---

## 3. Alembic chain: `backend/alembic/versions`

| # | Finding | Where | Evidence | Severity | Decision |
|---|---|---|---|---|---|
| A1 | The chain is linear: 0001_bootstrap, 0002_core_domain and on to 0013_state_district_inbox, each `down_revision` naming the one before. One head | backend/alembic/versions/0001 to 0013, `revision` and `down_revision` lines | PROVEN_BY_SOURCE | None | No action |
| A2 | On an empty database the full chain upgraded to head, downgraded to base and upgraded to head again. `alembic heads` reported one head | Lane-owned `ner_lane_ped_proof` | PROVEN_BY_RUNTIME | None | No action. A downgrade with data in the tables was not tried: NOT_VERIFIED. This does not contradict the known partial irreversibility of 0013 (new `user_role` labels survive a downgrade, POST_DEMO_CHANGE_INVENTORY.md:81-86). A clean round trip on an empty database does not test that |
| A3 | `0013_state_district_inbox.py` is untracked in git (`??`), while `ner_logistics_test` is already at `0013_state_district_inbox`. It is present in tag `snapshot/post-demo-2026-09-26` | `git status`, `git ls-tree` of the tag, `alembic_version` in ner_logistics_test | PROVEN_BY_DATABASE | Medium: a `git clean` would leave local databases at a revision the tree no longer has. The tag limits this | ADOPT_NOW: commit it as integration commit 25. The second 0013 on the pdf-master branch is already known and not repeated here |
| A4 | 20 of 49 foreign keys have no index that leads with their columns | Catalog query on ner_logistics_test at 0013 | PROVEN_BY_DATABASE | Low | See A5 and A6 |
| A5 | Of those, `trips.assignment_id` is read on a live path: `Trip.assignment_id.in_(...) ... FOR UPDATE` when an assignment ends or a driver is deactivated | backend/app/services/assignments.py:98-117 | PROVEN_BY_SOURCE | Low: trips is small today, and the scan only locks the rows that match | ROADMAP: add `ix_trips_assignment` in the next migration |
| A6 | The other 19 are audit or actor columns (`created_by`, `verified_by`, `resolved_by_user_id`, `superseded_by`, `replaced_by_id` and so on), plus `gps_points.driver_id` and `truck_id`. No application query filters on any of them. They matter only for foreign-key checks when a parent row is hard-deleted, and drivers and trucks are soft-deleted | grep of backend/app for these columns in WHERE clauses; the model's soft-delete columns | PROVEN_BY_SOURCE | Low | REJECT indexing them now: every index costs writes on the busiest table (gps_points) and nothing reads through them |

---

## 4. Fixture contamination guards

| # | Finding | Where | Evidence | Severity | Decision |
|---|---|---|---|---|---|
| G1 | The pytest guard is strict. It allows exactly one target (postgresql+psycopg, 127.0.0.1, 55432, ner_logistics_test), vetoes at `do_connect` before a socket opens, and has no override | backend/tests/db_target.py:77-84, :189-203 | PROVEN_BY_SOURCE | None | No action |
| G2 | The seed-loader guard is looser than the pytest guard. `is_disposable` accepts any database on any local host and any port. db_target.py itself names the case this misses: an SSH tunnel to a remote database on 127.0.0.1. It would also accept `ner_logistics_cert`, the database the main session uses for certification | backend/app/core/disposable.py:43-53 against backend/tests/db_target.py:73-76 | PROVEN_BY_SOURCE | Medium in principle. Mitigated today: every script that calls it (demo_scenario.py:201-208, terrain_seed.py:31-33) also calls `db_target.enforce` | ROADMAP: have `assert_disposable` require the port and a named database allowlist, the way db_target does |
| G3 | Guard use is opt-in per script, and one fixture writer opts out. `backend/scripts/certify_fleet.py` creates and deletes marked fixture rows through the application session (:92, :104, :468, :490) against whatever `DATABASE_PROVIDER` selects. Its docstring says it certifies "against Supabase". It calls neither `assert_disposable` nor `db_target`. No test lists the scripts; test_disposable_guard.py tests the function only | backend/scripts/certify_fleet.py; backend/tests/test_disposable_guard.py:30-73 | PROVEN_BY_SOURCE | Medium: one command on a shell armed for Supabase writes to the shared database. This is by design, but nothing makes the operator confirm it | ADOPT_NOW: one test that scans backend/scripts and fails when a file writes rows without calling a guard, unless it is on a short named allowlist (certify_fleet.py, create_user.py). ROADMAP: an explicit `--target hosted` flag on certify_fleet.py |
| G4 | Seed and demo scripts can only reach `ner_logistics_test`, because they enforce db_target, whose only allowed target is that database. Demo fixtures and pytest fixtures therefore share one database. How `ner_logistics_demo` is seeded was not found | demo_scenario.py:201-208, terrain_seed.py:31-33, demo_account.py:298-302 | PROVEN_BY_SOURCE | Low | ROADMAP: add a named demo target to the allowlist, so pytest's database holds only pytest data |
| G5 | Residue in `ner_logistics_test` is contained. 1,660 users (1,640 at `p3test.invalid`, 19 at `example.invalid`, 1 with no email), and all 1,660 are inactive. 0 trips, 0 shipments, 0 driver rows, 1 truck, 2,194 audit_logs. Ownership-based cleanup removes trips, shipments and drivers. Users stay because `audit_logs.actor_user_id` is RESTRICT, and they stay inactive | Read-only counts, printed as counts only | PROVEN_BY_DATABASE | Low: grows with every run but is inert | ROADMAP: since the database is pytest-only and disposable, recreate it on a schedule rather than letting users pile up |
| G6 | Personal data is copied into event payloads. `request_stop` writes the driver's full phone number into `trip_events.payload` and into the notification payload. The inbox renders it as a `tel:` link. Copies in an append-only timeline cannot be corrected or erased when the number changes, and they leave the `drivers` table's access controls behind | backend/app/services/driver_trips.py:825, :857; manager-web/src/pages/NotificationsPage.tsx:160-166 | PROVEN_BY_SOURCE | Medium (data governance). Working tree only; enters with integration commit 32 | ROADMAP: store `driver_id` only and resolve the phone at read time behind a permission. The inbox's call button can keep working |

Not repeated here because cycle 1 already recorded them: the 12 public images showing the demo
driver's phone number, the corrupt day-2 docx, the second migration 0013 on the pdf-master branch,
and the unguarded `pickup_address` write in a Supabase SQL migration.

---

## 5. Priority for the integration plan

1. D1 (a, b) and D2 allowlist, before integration commit 6 lands. It ships the snapshot.
2. A3, commit 0013 (integration commit 25, already planned).
3. G3 scripts-scan test.
4. D3 comments.
5. ROADMAP: G2, G4, G5, G6, A5, D4, D1 (c) and D2 re-acquisition. Re-acquisition needs a user
   decision because it queries Overpass.

---

## 6. Reproduction (scratch, outside the repository)

Scripts in the session scratchpad under `company2/plugins-engineering-data/`: `fk_index.py`
(read-only foreign-key and index catalog query), `residue.py` (read-only counts, no identifiers
printed), and an inline profiling script for the snapshot. The snapshot figures can be reproduced
by loading the JSON with the standard library and calling
`app.services.places.snapshot._load()` and `snapshot_counts()`, which read only the local file.
