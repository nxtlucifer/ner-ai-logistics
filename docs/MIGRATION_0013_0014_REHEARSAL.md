# Migration 0012 → 0013 → 0014: local rehearsal record

Rehearsed 26 September 2026 (20:00–20:11 IST) by the Database Lead, locally only.
**Nothing was applied to the hosted database, and no hosted connection was opened.**

| | |
|---|---|
| Chain rehearsed | `0012_push_notifications` → `0013_state_district_inbox` → `0014_shipment_state_geography` (head) |
| Files rehearsed (working tree, **untracked in git**) | `backend/alembic/versions/0013_state_district_inbox.py` sha256 `46012c2bd57d5142…`, `backend/alembic/versions/0014_shipment_state_geography.py` sha256 `3e313052bf93923b…`, `backend/app/core/scope.py` sha256 `9cc68fe6be49c3b9…`; repository HEAD `5b5e474` |
| Server | local PostgreSQL 18.2 + PostGIS 3.6.2, `127.0.0.1:55432`, role `ner_test` |
| Databases used | `ner_rehearsal_fresh`, `ner_rehearsal_populated`, `ner_rehearsal_hosted`, `ner_rehearsal_ref12`. All four were dropped at the end |
| Databases not touched | `ner_logistics_test`, `ner_logistics_cert`, `ner_supabase_rls_test`: no connection opened. `ner_logistics_demo` was used only as a `CREATE DATABASE … TEMPLATE` source, and only after confirming 0 active sessions on it |
| Result | **READY_TO_MIGRATE = NO, pending the owner's backup confirmation.** Every rehearsal step passed; the migration itself is ready. Read §8 before applying |

The evidence labels are:

- `PROVEN_BY_DATABASE`: I ran the query and the number is its result.
- `PROVEN_BY_RUNTIME`: a command's exit code, output or timing.
- `PROVEN_BY_SOURCE`: file:line.
- `NOT_VERIFIED`: nobody checked it in this rehearsal.
- `BLOCKED`: the step could not be run.

The recipe follows `.runtime/rehearsal/cert_build_db.py` and `clone_step2_build.py`. Each Supabase-shaped database got:

- `create schema extensions`
- `create extension postgis schema extensions` (plus `uuid-ossp` for the hosted clone)
- `alter role ner_test in database <db> set search_path = "$user", public, extensions`

Alembic ran from `backend/` with `DATABASE_PROVIDER=local` and `LOCAL_DATABASE_URL` = `MIGRATION_DATABASE_URL` = the rehearsal database. The rehearsal driver scripts lived in the session scratchpad and are not part of the repository.

---

## 1. Fresh database: `0001 → head`

`ner_rehearsal_fresh` was Supabase-shaped (PostGIS 3.6.2 in `extensions`). Running `alembic upgrade head` gave rc 0 in 1.4 s wall time, and all 14 revisions ran in order. `alembic current` returned `0014_shipment_state_geography (head)`, and `alembic heads` returned the same single head. `PROVEN_BY_RUNTIME`

| Check (SQL on the upgraded database) | Result | Label |
|---|---|---|
| `alembic_version` | `0014_shipment_state_geography` | PROVEN_BY_DATABASE |
| `states` rows | 8: arunachal-pradesh, assam, manipur, meghalaya, mizoram, nagaland, sikkim, tripura | PROVEN_BY_DATABASE |
| `districts` rows | 0. 0013 seeds none on purpose (`0013_state_district_inbox.py:9-19`) | PROVEN_BY_DATABASE |
| `users.state_id`, `users.district_id`, `users.must_reset_password` | present; `must_reset_password` is `boolean NOT NULL DEFAULT false` | PROVEN_BY_DATABASE |
| `ck_users_role_scope` | present and validated (`convalidated = true`) | PROVEN_BY_DATABASE |
| `user_role` labels | ADMIN, MANAGER, DRIVER, AUTHORISED_REVIEWER, NORTH_EAST_MANAGER, STATE_MANAGER, DISTRICT_MANAGER | PROVEN_BY_DATABASE |
| `shipments.origin_state_id`, `destination_state_id` | `uuid`, each with a FK to `states` (2 FKs) | PROVEN_BY_DATABASE |
| `shipments.geography_source` | `character varying(40)` | PROVEN_BY_DATABASE |
| Indexes `ix_shipments_origin_state_id`, `ix_shipments_destination_state_id` (plus the two 0013 district indexes) | present | PROVEN_BY_DATABASE |
| Trigger `trg_shipments_state_follows_district` | present: `BEFORE INSERT OR UPDATE OF origin_district_id, destination_district_id, origin_state_id, destination_state_id ON public.shipments FOR EACH ROW` | PROVEN_BY_DATABASE |
| `notifications` (0013) and `driver_notifications` (0012) | both exist | PROVEN_BY_DATABASE |
| RLS on every `public` table (the rule in `backend/tests/test_domain_integrity.py:461-476`) | 25 of 25 tables have RLS; 0 tables without it | PROVEN_BY_DATABASE |
| Policies in `public` | 0 | PROVEN_BY_DATABASE |
| `alembic check` (models vs head schema) | Only one finding: `system_info`, which `backend/tests/test_schema_drift.py:22-28` excludes as not ORM-owned. No other drift | PROVEN_BY_RUNTIME |

**Step 1: PASS.**

## 2. Populated 0012 database: `ner_logistics_demo` template → head

`CREATE DATABASE ner_rehearsal_populated TEMPLATE ner_logistics_demo` ran after confirming 0 sessions on the template. It took 2.0 s and produced 52 MB. The starting revision was `0012_push_notifications`, with PostGIS 3.6.2 in `extensions`. `PROVEN_BY_DATABASE`

The template copy does **not** carry per-database settings. The demo database's `search_path=public, extensions` lives in `pg_db_role_setting` for its own OID. The clone got the Supabase recipe's role setting before migrating. This is a rehearsal-environment detail, not a hosted concern. `PROVEN_BY_DATABASE`

Users by role before and after: ADMIN 108, MANAGER 7,931, DRIVER 11,836, AUTHORISED_REVIEWER 1 (19,876 in total). `PROVEN_BY_DATABASE`

`alembic upgrade head` gave rc 0. Only `0012 → 0013` and `0013 → 0014` ran. `PROVEN_BY_RUNTIME`

**Timing:** 1.25 s wall time for the upgrade. A no-op `alembic current` on the same database took 1.13 s, which is interpreter and Alembic startup. That puts the migration work itself at roughly **0.1 s** on 19,876 users and 73 shipments. The two wall times are `PROVEN_BY_RUNTIME`; the 0.1 s is derived from them.

### Row counts: every `public` table, before and after

| table | before (0012) | after (0014) |
|---|---:|---:|
| alembic_version | 1 | 1 |
| audit_logs | 32,752 | 32,752 |
| cargo_items | 73 | 73 |
| driver_documents | 0 | 0 |
| driver_notifications | 28 | 28 |
| driver_truck_assignments | 25 | 25 |
| drivers | 10 | 10 |
| emergencies | 0 | 0 |
| gps_points | 2,530 | 2,530 |
| refresh_tokens | 1,073 | 1,073 |
| route_review_authorizations | 76 | 76 |
| shipments | 73 | 73 |
| stored_files | 12 | 12 |
| system_info | 1 | 1 |
| trip_events | 561 | 561 |
| trip_routes | 88 | 88 |
| trip_stops | 148 | 148 |
| trips | 74 | 74 |
| truck_documents | 0 | 0 |
| truck_maintenance | 0 | 0 |
| trucks | 7 | 7 |
| users | 19,876 | 19,876 |
| **states** (new, 0013) | n/a | 8 |
| **districts** (new, 0013) | n/a | 0 |
| **notifications** (new, 0013) | n/a | 0 |

No pre-existing table changed its row count. The only differences are the three tables the migrations create. `PROVEN_BY_DATABASE`

### Backfill, trigger and constraint

| Check | Result | Label |
|---|---|---|
| Shipments with any district recorded (the only rows 0014's backfill may touch, `0014_shipment_state_geography.py:47-54`) | 0 | PROVEN_BY_DATABASE |
| Shipments with any state after the upgrade | 0. The backfill touched nothing, as expected on this data | PROVEN_BY_DATABASE |
| Shipments with `geography_source`; users with state or district; users with `must_reset_password` | 0; 0; 0 | PROVEN_BY_DATABASE |
| **Trigger, INSERT:** inserted a shipment with a TEST district in Assam and a deliberately wrong `origin_state_id` (Meghalaya) | stored `origin_state_id` = Assam; `destination_state_id` stayed NULL | PROVEN_BY_DATABASE |
| **Trigger, UPDATE:** set `destination_district_id` on an existing shipment | `destination_state_id` became Assam | PROVEN_BY_DATABASE |
| **Trigger, override attempt:** set `destination_state_id` to Meghalaya while the district is Assam | still Assam: the trigger keeps state and district in agreement | PROVEN_BY_DATABASE |
| No district: state written directly | kept (Meghalaya). The trigger never clears a state | PROVEN_BY_DATABASE |
| `ck_users_role_scope`: an existing DRIVER set to `STATE_MANAGER` with no state | rejected with `CheckViolation` | PROVEN_BY_DATABASE |
| After `ROLLBACK` | 0 districts, 0 rehearsal shipments, 0 shipments with a state; all row counts identical to the post-upgrade counts | PROVEN_BY_DATABASE |
| Head schema checks (the same list as §1) | all pass; 25 of 25 `public` tables with RLS; 0 policies | PROVEN_BY_DATABASE |

**Step 2: PASS.**

## 3. Hosted-shaped database: `.runtime/supabase-public.dump`

The dump is a custom-format archive: 4,707,516 bytes, sha256 `3cf71e820813428c…`. It was created 2026-09-12 09:28 from PostgreSQL 17.6 by pg_dump 18.2, and holds 266 table-of-contents entries. It covers the `public` schema only, **with data** (20 `TABLE DATA` entries). It was restored into `ner_rehearsal_hosted`, built with the `clone_step2_build.py` recipe (PostGIS and `uuid-ossp` in `extensions`, plus the role search_path). No row content was printed. The database was dropped afterwards. `PROVEN_BY_RUNTIME`

**Restore errors, exactly:** `pg_restore --no-owner --no-privileges` returned rc 1 with `errors ignored on restore: 16`. `PROVEN_BY_RUNTIME`

1. One error was `ERROR: schema "public" already exists` (`Command was: CREATE SCHEMA public;`). This is benign.
2. Fifteen errors were `ERROR: schema "app" does not exist`, one for each hosted RLS policy. Each policy is `FOR SELECT TO authenticated USING (...)` and calls helper functions in an `app` schema that this public-only dump does not contain:
   - `app.has_perm(text)`
   - `app.current_driver_id()`
   - `app.current_user_id()`
   - `app.is_fleet_staff()`
   - `app.can_read_trip(uuid)`

   The policies are:
   - `assignments_read`
   - `audit_logs_read`
   - `cargo_items_read`
   - `driver_documents_read`
   - `drivers_read_self_or_staff`
   - `gps_points_read`
   - `shipments_read`
   - `trip_events_read`
   - `trip_routes_read`
   - `trip_stops_read`
   - `trips_read`
   - `truck_documents_read`
   - `truck_maintenance_read`
   - `trucks_read`
   - `users_read_self_or_staff`

All tables and data were restored:

| Table | Rows |
|---|---:|
| users | 19,871 (ADMIN 108, MANAGER 7,931, DRIVER 11,831, AUTHORISED_REVIEWER 1) |
| shipments | 17 |
| trips | 18 |
| audit_logs | 31,308 |

The clone also held 17 functions in `public` and 8 non-internal triggers. `PROVEN_BY_DATABASE`

**Revision in the dump: `0010_emergencies`.** That is older than 0012, so the clone was upgraded in two runs, the same way hosted will be:

| Run | Revisions executed | rc | Wall time | Label |
|---|---|---|---|---|
| `alembic upgrade 0012_push_notifications` | `0010 → 0011_files_verification`, `0011 → 0012_push_notifications` | 0 | 0.98 s | PROVEN_BY_RUNTIME |
| `alembic upgrade head` | `0012 → 0013_state_district_inbox`, `0013 → 0014_shipment_state_geography` | 0 | 1.03 s | PROVEN_BY_RUNTIME |

**Migration errors: none.** None of the 20 dumped tables changed its row count at 0012 or at head. The new tables were `stored_files` and `driver_notifications` (0 rows, from 0011 and 0012), and `states` (8), `districts` (0) and `notifications` (0). The backfill touched 0 shipments, `user_role` gained the three labels, and every check from §1 passed. There were 25 `public` tables, all with RLS. `alembic check` reported only `system_info`. `PROVEN_BY_DATABASE`

**Second run with the policy shapes rebuilt.** The first run had no policies, so I rebuilt the clone from scratch. I restored again (the same 16 errors), then created an `app` schema inside the rehearsal database with stub functions of the five signatures above. I then replayed the 15 `CREATE POLICY` statements taken from the dump itself, with `TO authenticated` changed to `TO PUBLIC`. The Supabase `authenticated` role is cluster-global, so I did not create it. After that I upgraded `0010 → 0012` (0.91 s) and `0012 → head` (1.01 s). Results:

- rc 0 for both runs, with no errors.
- **15 policies on 15 tables before and after, with identical definitions.** No new table received a policy.
- No row count changed.
- Head checks: all pass.

`PROVEN_BY_RUNTIME` / `PROVEN_BY_DATABASE`

### What the 12 September dump proves

- On hosted's shape and data as of 12 September, the chain `0010 → 0012 → 0014` runs clean. That covers the 20 enum types, PostGIS in `extensions`, 19,871 real user rows, 8 triggers, and the 15 policy expressions. The 17 public functions were present but not exercised: 13 are wrappers whose real bodies live in the `app` schema, which the dump does not contain. `PROVEN_BY_RUNTIME`
- Ownership was not rehearsed. On hosted, all 20 types are owned by `postgres` (the dump's table of contents). The clone was restored `--no-owner`, so there they belonged to `ner_test`. Whether hosted's migration role may run `ALTER TYPE … ADD VALUE` is covered under the limits below.
- `ck_users_role_scope` validated against 19,871 real user rows. At 0012, `user_role` cannot even represent the two restricted roles, so no existing row can violate it. `PROVEN_BY_DATABASE`
- Whether a hosted RPC function writes `shipments` (and so fires the new trigger) is `NOT_VERIFIED`: 13 of the 17 public functions are wrappers around bodies in the `app` schema, which the dump does not contain. The reviewer refuted an earlier claim here.

### What it does not prove

- **Hosted as it is today.** Hosted is reported to be at `0012_push_notifications`: the task statement says so, and `docs/MIGRATION_0013_DEPLOYMENT_PACKET.md:8` records a read on 19 September. This rehearsal did not connect to hosted, so that revision is `NOT_VERIFIED` here. The clone applied 0011 and 0012 itself; hosted applied them on its own schema and data at some point after 12 September. Rows written since then, and any out-of-band DDL since then, are not represented. `NOT_VERIFIED`
- **The real `app` helper bodies, the `authenticated`/`anon` roles, and grants.** The dump is public-only, and the restore used `--no-privileges`. Only the shape of the policies was rehearsed, not their behaviour. `NOT_VERIFIED`
- **Supabase-platform behaviour.** This covers whether the migration role on hosted may run `ALTER TYPE … ADD VALUE`, whether `MIGRATION_DATABASE_URL` points at the direct endpoint or a pooler, and what lock and wait times look like over the network. `NOT_VERIFIED`. The 19 September schema-only clone in the 0013 packet reports `ALTER TYPE` succeeding on hosted's real schema, including the `app` schema. That run was for 0013 only, and I did not re-run it here.

**Step 3: PASS**, with the fidelity limits above.

## 4. Visibility on the populated database after the upgrade

I built each count with the app's own predicate: `app.core.scope.trip_scope_clause` and `shipment_scope_clause` (`backend/app/core/scope.py:94-138`). Each ran against `ner_rehearsal_populated` for unsaved, synthetic `User` objects. The DISTRICT_MANAGER was given Assam and a random district id, because `districts` is empty. `PROVEN_BY_RUNTIME` / `PROVEN_BY_DATABASE`

| Synthetic user | Trips visible (of 74) | Shipments visible (of 73) |
|---|---:|---:|
| MANAGER (baseline, unscoped) | 74 | 73 |
| NORTH_EAST_MANAGER | 74 | 73 |
| STATE_MANAGER (Assam) | **0** | **0** |
| STATE_MANAGER (Meghalaya) | **0** | **0** |
| DISTRICT_MANAGER (Assam, synthetic district) | **0** | **0** |

The same five users on the hosted-shaped clone (18 trips, 17 shipments) gave 18, 18, 0, 0, 0. `PROVEN_BY_DATABASE`

Why the scoped counts are zero:

- NORTH_EAST_MANAGER is in `UNSCOPED_ROLES` (`scope.py:60-62`), so it gets no filter at all.
- STATE_MANAGER filters on `shipments.origin_state_id`/`destination_state_id`, and DISTRICT_MANAGER on the district columns (`scope.py:103-115`).
- Every existing shipment has NULL in all four columns, because:
  - 0013 creates the district columns empty (`0013_state_district_inbox.py:17-19`);
  - `districts` has no rows;
  - 0014's backfill only copies the state of a district that is already recorded (`0014_shipment_state_geography.py:47-54`).
- NULL geography is invisible to scoped managers by design (`scope.py:30-35`).

So **on hosted, every existing trip will be invisible to State and District Managers after this migration.** Only trips whose shipment is created through the resolving path become visible. That path is `create_shipment`, which calls `trip_geography.resolve()` for pickup and destination (`backend/app/services/shipments.py:116-125`, `backend/app/services/trip_geography.py:48-72`).

As a positive control, I gave one existing shipment `origin_state_id` = Assam inside a transaction that I rolled back. The same predicate then showed the Assam State Manager **2 trips and 1 shipment**, while Meghalaya and the district manager stayed at 0. After the rollback, 0 shipments carried a state. `PROVEN_BY_DATABASE`

**Step 4: PASS.** The result is the designed behaviour, not a defect.

## 5. Downgrade on the fresh database

| Action | rc | Wall time | What changed |
|---|---|---|---|
| `alembic downgrade 0013_state_district_inbox` | 0 | 1.16 s | These were removed: `shipments.origin_state_id`, `destination_state_id`, `geography_source`; their 2 indexes and 2 FKs; function `shipments_state_follows_district`; trigger `trg_shipments_state_follows_district`. Nothing else changed |
| `alembic downgrade 0012_push_notifications` | 0 | 1.28 s | version is now `0012_push_notifications` |
| `alembic upgrade head` (re-upgrade) | 0 | 1.36 s | the snapshot of tables, columns, types, functions, triggers, indexes and constraints is **identical** to the first head |

All three rows are `PROVEN_BY_RUNTIME` / `PROVEN_BY_DATABASE`.

**What survives the downgrade:** I compared the downgraded 0012 against a pristine 0012 built the same way (`ner_rehearsal_ref12`). The comparison covered the catalog snapshot and a `pg_dump --schema-only` text diff. **The only difference is the three `user_role` labels NORTH_EAST_MANAGER, STATE_MANAGER and DISTRICT_MANAGER.** That is 7 diff lines, all in the `user_role` enum. `states`, `districts` and `notifications` were dropped, as were the `district_source`, `notification_kind` and `notification_severity` types, every column 0013 added, and every 0014 object. `PROVEN_BY_DATABASE`

**Downgrade with scoped accounts present (step 5b):** I created one STATE_MANAGER (Assam) and one NORTH_EAST_MANAGER, then downgraded to 0012 (rc 0).

- **Both accounts survived with their roles**, but without scope columns.
- The re-upgrade then **failed** with `psycopg.errors.CheckViolation: check constraint "ck_users_role_scope" of relation "users" is violated by some row`.
- The failed run left the revision at `0012_push_notifications`. `states` did not exist and `users.state_id` was absent: the transactional part rolled back cleanly.
- I then applied the remedy the migration prescribes (`0013_state_district_inbox.py:21-29`): demote and deactivate the scoped user. The next upgrade to head returned rc 0.

`PROVEN_BY_RUNTIME`

**Step 5: PASS.**

## 6. Cleanup

I dropped all four `ner_rehearsal_*` databases. The cluster now lists `ner_logistics_cert`, `ner_logistics_demo`, `ner_logistics_test`, `ner_supabase_rls_test`, `postgres`, `template0` and `template1`. No per-database role settings were left orphaned. `PROVEN_BY_DATABASE`

## 7. Irreversible parts

1. **The three `user_role` labels are permanent.** PostgreSQL has no `DROP VALUE`, and after a downgrade they are the only schema difference from a pristine 0012. `PROVEN_BY_DATABASE` (§5)
2. **They commit before everything else.** `ALTER TYPE … ADD VALUE` runs in an `autocommit_block` (`0013_state_district_inbox.py:81-84`). The rest of 0013 and all of 0014 then run in one transaction (`backend/alembic/env.py:79-87`), so any later failure leaves hosted at 0012 with the labels already added. That is harmless, and the re-run is idempotent (`ADD VALUE IF NOT EXISTS`). `PROVEN_BY_RUNTIME` (§5b) for a failure in 0013; `PROVEN_BY_SOURCE` for a failure in 0014.
3. **A downgrade destroys data, it does not restore a schema.** Everything written after the upgrade is lost:
   - the `states`, `districts` and `notifications` tables;
   - the user columns `state_id`, `district_id`, `must_reset_password`, `created_by_user_id` and `last_seen_at`;
   - `trucks.display_name`;
   - the shipment district and state columns, and `geography_source`.

   The shipment geography came from OSM reverse geocoding when each shipment was created. Getting it back means geocoding again. `PROVEN_BY_SOURCE` (`0013_state_district_inbox.py:224-254`, `0014_shipment_state_geography.py:78-84`); the objects' removal is `PROVEN_BY_DATABASE` (§5).
4. **Scoped accounts outlive a downgrade and block the re-upgrade** until someone demotes them. Deactivating is not enough: `ck_users_role_scope` checks inactive rows too (the reviewer refuted "or deactivates"). `PROVEN_BY_RUNTIME` (§5b). What a 0012-era build (`5b5e474`) does when it reads a user whose role it does not know is `NOT_VERIFIED`.

## 8. Preconditions that remain for hosted

| # | Precondition | Status |
|---|---|---|
| 1 | **SUPABASE_BACKUP_CONFIRMED**: a backup from today, or PITR, visible in the Supabase dashboard, and a known restore procedure (`docs/MIGRATION_0013_DEPLOYMENT_PACKET.md:181-197`) | **Not given. This is the owner's call**, and it is excluded from the verdict below |
| 2 | A **fresh read-only hosted dump** (`--schema=public --schema=app`, as in `clone_step1_dump.py`) would make §3 current. The dump used here is from 12 September and at 0010. A fresh one starts at the real 0012 and carries the real `app` schema and policies | Recommended. `NOT_VERIFIED` without it |
| 3 | **Ship migration and code together.** `0013`, `0014`, `app/core/scope.py` and `app/services/trip_geography.py` are **untracked** in git today (`git status`: `??`). Commit the exact rehearsed bytes (hashes at the top), then deploy the code in the same window as `alembic upgrade head` | Open. `PROVEN_BY_RUNTIME` (git status) |
| 4 | **`upgrade head` now lands on 0014, not 0013.** The deployment packet's post-migration checks now expect `0014_shipment_state_geography` and check the 3 new `shipments` columns, the trigger, and that existing shipments have no state yet | Done (packet updated 26 Sep) |
| 5 | **Existing hosted trips will be invisible to State and District Managers** (§4). Only NORTH_EAST_MANAGER, MANAGER and ADMIN see them. This is by design and needs no fix, but it has to be said to whoever tests the console afterwards | Expected behaviour |
| 6 | **No DISTRICT_MANAGER can be created** until `districts` holds rows. `ck_users_role_scope` requires `district_id`, and that column is a FK to `districts` (`0013_state_district_inbox.py:143,157-158`) | By design. Needs a verified district source |
| 7 | New shipments get a state only if hosted can reach the OSM Nominatim reverse geocoder. If it cannot, `geography_source = GEOCODER_UNAVAILABLE` and the state stays NULL (`shipments.py:116-125`) | `NOT_VERIFIED` from hosted |
| 8 | Which endpoint `MIGRATION_DATABASE_URL` uses on hosted (direct or pooler), and the lock time over the network. Locally the migration work took about 0.1 s on 19,876 users | `NOT_VERIFIED` |

Observation, not a blocker: hosted carries 15 `TO authenticated` read policies and 17 RPC functions. The migration chain does not create them: no `CREATE POLICY` exists in `backend/alembic/versions/`. The project's own `test_no_permissive_policies_exist` (`backend/tests/test_domain_integrity.py:478-493`) would therefore fail against hosted. That predates 0013 and 0014, and neither migration touches those objects (§3). `PROVEN_BY_DATABASE`, as of the 12 September dump.

## 9. Verdict

| Step | Result |
|---|---|
| 1. Fresh `0001 → 0014` | PASS |
| 2. Populated 0012 clone → 0014: counts preserved, backfill touches only rows with districts (0), trigger and constraint work | PASS |
| 3. Hosted-shaped (12 September dump, 0010 → 0012 → 0014), with and without the 15 policy shapes | PASS (dump is two weeks old; see limits) |
| 4. Visibility with the app's predicate | PASS (scoped managers see 0 existing trips, as designed) |
| 5. Downgrade → 0013 → 0012, re-upgrade; plus the scoped-account failure mode and its remedy | PASS |
| 6. Cleanup | PASS |

**READY_TO_MIGRATE = NO until the owner confirms the backup (precondition 1).** Every rehearsal step passed, so the migration itself is ready; the gate is the recovery path, which only the owner can confirm. Preconditions 3 and 4 are about how to apply the migration, not whether it works: commit and deploy the rehearsed files together, and expect `0014`. Precondition 2 is recommended so that §3 reflects hosted as it is today.
