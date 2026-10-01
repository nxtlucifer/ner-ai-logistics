# Migration 0013 — deployment packet

Prepared, not executed. Nothing in this document has been applied to the hosted
database.

| | |
|---|---|
| Hosted revision now | `0012_push_notifications` — read from hosted, not assumed |
| Target revision | `0013_state_district_inbox` |
| Hosted code now | `e4043ce` (origin/main, pushed 20 Sep; recorded as deployed in `POST_DEMO_CHANGE_INVENTORY.md`). Hosted was not re-read on 30 Sep. None of this work is deployed. |
| Chain head in the working tree (30 Sep) | `0016_geography_boundaries`. Once the pdf branch merges it becomes `0017_device_events` (see "Migration 0017" below) |
| `READY_FOR_HOSTED_MIGRATION` | **NO** (30 Sep 2026). See "Hosted gates" below |
| Expected downtime | none. Every statement is additive; no table is rewritten and no column is dropped. |

## What it does

| Statement kind | Count |
|---|---|
| `CREATE TABLE` | 3 — `states`, `districts`, `notifications` |
| `ADD COLUMN` | 8 — 5 on `users`, 2 on `shipments`, 1 on `trucks` |
| `CREATE INDEX` | 9 |
| `CREATE CHECK CONSTRAINT` | 1 — `ck_users_role_scope` |
| `INSERT` | 1 — the eight states |
| `op.execute` | 7 — 3 enum `ADD VALUE`, 2 triggers, 2 `ENABLE ROW LEVEL SECURITY` |

## Destructive-statement scan — clean

No `DROP TABLE`, no `DROP COLUMN`, no `DELETE`, no `TRUNCATE`, no `UPDATE` of
existing rows. The only occurrence of the word UPDATE in the upgrade is inside
`CREATE TRIGGER … BEFORE UPDATE ON`, which is a definition, not a mutation.

Every new column is nullable or carries a server default, so existing rows stay
valid without a backfill. No shipment is assigned a district and no user is
assigned a scope: guessing either would be inventing data.

## Rehearsals run

| Gate | Result |
|---|---|
| Clean database, full chain `base → 0013` | **PASS** — 8 states seeded, 0 districts, 7 roles in `user_role` |
| Clone of the **hosted schema** (`pg_dump --schema-only`, restored locally, stamped at the revision READ from hosted, then upgraded) | **PASS** — see the table below |
| Controlled sample on the clone, visibility verified through the HTTP API | **PASS** — 30 checks, see below |
| Schema drift (`compare_metadata`) | **PASS** — only `spatial_ref_sys` and `system_info`, both non-ORM and already excluded |
| Downgrade | reviewed; see limits below |

### The clone rehearsal, 19 September 2026

Procedure, repeatable from `.runtime/rehearsal/clone_step{1..5}*.py`:

1. `pg_dump --schema-only --schema=public --schema=app` from hosted. Read-only:
   it issues catalog SELECTs and writes nothing. Asserted to contain no `COPY`
   block, so no hosted DATA was copied anywhere.
2. A local database with **PostGIS in `extensions`** and the role search_path
   **read from hosted** (`"$user", public, extensions`). Both are required:
   without the schema the geography columns cannot be created, and without the
   search_path `ST_GeogFromText` is not found and every location write fails.
3. Restored the hosted shape — **0 errors**, 22 tables, RLS policies and the
   `app` helper schema present.
4. Stamped at the revision read from hosted (`0012_push_notifications`) and
   ran `alembic upgrade head`.

| Check on the upgraded clone | Result |
|---|---|
| revision | `0013_state_district_inbox` |
| `states` / `districts` / `notifications` | all created |
| `users`: `state_id`, `district_id`, `must_reset_password`, `created_by_user_id`, `last_seen_at` | all present |
| `shipments.origin_district_id` / `destination_district_id`, `trucks.display_name` | present |
| `districts.source_status` | type `district_source`, default `'UNVERIFIED'` |
| `district_source` values | VERIFIED_OFFICIAL, DEMO, TEST, UNVERIFIED |
| `user_role` | gained the three new values |
| `ck_users_role_scope` | present |
| `uq_active_state_manager`, `uq_active_district_manager` | present |
| RLS enabled on `states`, `districts`, `notifications` | yes, **with no policy** — deny-all for Supabase's `authenticated` role, which is the intent: the API connects as the owner and is not subject to RLS, so a client holding a valid Supabase JWT reads nothing from these tables directly |
| existing tables kept their RLS and policies | yes, 15 tables, 1 policy each |
| seed | 8 states, 0 districts, every state names its source |

### Sample dataset on the clone

1 North-East manager, 1 Assam state manager, 2 Assam district managers,
1 Meghalaya state manager, 1 Meghalaya district manager, 2 drivers, 2 trucks,
2 trips: **A** Assam A → Assam B, **B** Assam A → Meghalaya A. Three districts,
all `DEMO` provenance.

Every read went through the real HTTP API, both the list endpoint and the
direct-id one, because a scope bug that hides a row from a list while serving
it by id is the more dangerous of the two.

| Who | `/api/trips` | Trip A by id | Trip B by id | dashboard "under way" |
|---|---|---|---|---|
| North-East manager | A, B | 200 | 200 | 2 |
| Assam state manager | A, B | 200 | 200 | 2 |
| Assam DM (district A) | A, B | 200 | 200 | 2 |
| Assam DM (district B) | A | 200 | **404** | 1 |
| Meghalaya state manager | B | **404** | 200 | 1 |
| Meghalaya DM | B | **404** | 200 | 1 |
| driver on A | — | — | **403** | — |
| driver on B | — | **403** | — | — |

404 for a scoped manager out of scope; 403 for a driver, who has no manager
read permission at all and is refused at the permission gate before any row is
looked up. `/api/driver/me/trip` served each driver exactly their own trip.
District counts read Assam 2, Meghalaya 1, Nagaland 0 — the DEMO districts and
nothing else.

**The clone was then dropped.** Only the clone: `ner_logistics_test`,
`ner_logistics_demo` and `ner_supabase_rls_test` were untouched.

### `ck_users_role_scope` against the REAL hosted rows

The clone was schema-only, so the constraint was validated against an empty
table. Checked separately, read-only, against the 19,879 rows hosted actually
holds: `user_role` today contains only ADMIN, MANAGER, DRIVER and
AUTHORISED_REVIEWER, so **no existing row can violate the constraint** — the
two role values it restricts are not yet representable in the type. The
`users` table is 7,944 kB; every added column is nullable or has a default, so
there is no rewrite.

The clone rehearsal exposed one real difference worth recording: **Supabase
installs PostGIS into an `extensions` schema**, not `public`, so every location
column is typed `extensions.geography`. A rehearsal environment with PostGIS in
`public` cannot even create those tables. That is a property of the real target
and is now part of the procedure.

## Rollback limitations — read before applying

`downgrade()` drops everything the upgrade created. Two things it cannot undo:

1. **Enum values.** PostgreSQL has no `DROP VALUE`. `NORTH_EAST_MANAGER`,
   `STATE_MANAGER` and `DISTRICT_MANAGER` stay in `user_role` after a
   downgrade. Harmless — no row can use them once the check constraint and the
   accounts are gone, and re-upgrading is idempotent because the migration uses
   `ADD VALUE IF NOT EXISTS`.
2. **Rows created after the upgrade.** Downgrading drops `notifications`,
   `districts` and `states`, with whatever was written into them. That is a
   data loss, not a schema rollback, and it is the reason to take a backup
   first rather than to rely on the downgrade.

There is also a precondition on **re-upgrading after a downgrade**: scoped
manager accounts survive while their scope columns do not, so adding
`ck_users_role_scope` a second time fails loudly. Correct behaviour — those are
real accounts with no scope and somebody must decide what happens to them.
Demote or deactivate, then upgrade again. Do not add the constraint `NOT VALID`
to get past it.

## Before applying: the hosted database is not clean

`docs/DATA_HYGIENE_AUDIT.md` records the full audit. The part that matters here:

- **19,860 deactivated users at fixture domains** (`p3test.invalid` and three
  `*cert.invalid` domains), written between 30 August and 6 September 2026 by
  test runs that reached the shared project before the isolated-database guard
  existed. All inactive, none with a driver row, none visible on any screen.
- **5 retired trucks** matching the test factory's registration generator.
- **4 drivers of UNKNOWN provenance** — licence numbers matching the factory
  generator, created the same day as the demo fleet. UNKNOWN is not SAFE.

None of this blocks 0013 — every statement is additive and none of these rows
can violate the new constraint. It is recorded because `select count(*) from
users` on this database returns a number that is 99.9% test residue, and
because deleting those rows is a destructive operation against shared data
that needs a confirmed backup first.

Both write paths are now closed: `tests/db_target.py` vetoes the pytest
connection, and `app/core/disposable.py` refuses any fixture or demo loader
whose target is not a local host. Neither has an override.

## Post-migration checks

Run in this order; each is read-only except the last.

```sql
select version_num from alembic_version;                        -- the head that was applied: 0016_geography_boundaries today, 0017_device_events after the pdf merge
select count(*) from states;                                    -- 8
select count(*) from districts;                                 -- 0, deliberately
select unnest(enum_range(null::user_role));                     -- 7 values
select count(*) from users where must_reset_password;           -- 0
select count(*) from trips;                                     -- unchanged from before
select count(*) from information_schema.columns
  where table_name = 'shipments'
    and column_name in ('origin_state_id','destination_state_id','geography_source'); -- 3
select count(*) from pg_trigger where tgname = 'trg_shipments_state_follows_district'; -- 1
select count(*) from shipments where origin_state_id is not null; -- 0: existing rows have no geography
select count(*) from information_schema.tables
  where table_name in ('instance_leases','rate_limit_windows','provider_pacing'); -- 3, all empty, RLS on
-- 0016
select count(*) from states where is_ner;                       -- 8
select count(*) from states where not is_ner;                   -- 0 until the SoI import adds the other states
select count(*) from country_boundaries;                        -- 0 until the SoI import: every plan then answers 503 GEOGRAPHY_UNAVAILABLE (gate H4)
select relrowsecurity from pg_class where relname = 'country_boundaries';  -- t
```

`upgrade head` now runs four revisions: 0013, `0014_shipment_state_geography`,
`0015_instance_coordination` and `0016_geography_boundaries` (30 Sep; a fifth, 0017, arrives with the pdf branch).
0016 is covered in "Migration 0016" below. 0013 and 0014 were rehearsed locally on fresh,
populated and hosted-shaped databases (`docs/MIGRATION_0013_0014_REHEARSAL.md`).
0015 (three empty coordination tables, RLS on; used only when `MULTI_INSTANCE`
is true) was added on 27 Sep. It is upgraded and downgraded in the test suite but
has NOT been through the hosted-clone rehearsal. Rehearse it before the hosted run. The code that resolves trip geography
(`app/services/trip_geography.py`, `app/core/scope.py`) must deploy in the same
window. Existing trips carry no geography, so State and District Managers see
none of them until trips are created through the resolving path; backfilling
old rows would be a separate, reviewed data change.

Then: `GET /ready` returns `provider: supabase`; the manager console signs in;
`GET /api/trips` returns the same count as before; one existing trip opens.

## Backup and recovery — NOT CONFIRMED

**This is the one gate that is not green.**

Supabase's backup behaviour depends on the project's plan: daily backups on some
tiers, point-in-time recovery only where it has been enabled. I cannot read the
project's billing plan or its PITR setting, and I will not assert a recovery
path I have not seen.

Before applying, confirm in the Supabase dashboard:

- **Database → Backups** shows a backup from today, **or** PITR is on;
- you know how to restore it and roughly how long that takes.

A migration with no destructive statements and no rollback need is still a
migration against shared data.

## Migration 0016: what it adds to this packet (30 Sep 2026)

`0016_geography_boundaries` (untracked, working tree) adds:
- nullable MultiPolygon/4326 `geometry` on `states` and `districts`;
- `geometry_source`, `geometry_source_version` and `geometry_verified_at`;
- `states.is_ner` (NOT NULL, default false, backfilled by name for the eight NER states);
- the `country_boundaries` table, with GiST indexes, an updated_at trigger and RLS on.

What the rehearsals cover:

| Rehearsal | Result |
|---|---|
| Fresh `0001 -> 0016` | Succeeded on 4 scratch databases on 30 Sep (`docs/ANTIGRAVITY_FINDINGS_REPRODUCTION.md` C-13) |
| `0015 -> 0016` on an empty scratch database | Succeeded (`.runtime/production/repro/phase1/red_ready_schema_gap.out`) |
| Hosted-schema clone | **Not run** |
| Populated database | **Not run** |

Three properties matter for hosted:

1. **With no Survey of India rows, every trip plan answers 503 `GEOGRAPHY_UNAVAILABLE`.** It fails closed by design. Applying 0016 to hosted before the boundary data can be loaded in the same window stops all planning. The importer refuses non-local hosts (`scripts/import_soi_boundaries.py` `require_local`), so no hosted load path exists yet (gate H4).
2. **Its downgrade is destructive.** It deletes every non-NER state row, drops shipment references to them, and fails loudly if a user is scoped to one (0016 docstring). Take the backup first (gate H3).
3. **`/ready` stays 200 while the schema is behind the code** (NF-02, `red_ready_schema_gap.py` exit 1). A 0016 build against an unmigrated database looks healthy while `/api/org/regions` fails. Do not rely on `/ready` as the post-migration check until it compares `alembic_version` with the script head. Use the SQL above.

## Migration 0017: the `device_events` renumber rule (30 Sep 2026)

`origin/claude/pdf-master-mission-gohuj5:backend/alembic/versions/0013_device_events.py` (commit `1baa4c8`, 16 Sep) declares `revision = "0013_device_events"` and `down_revision = "0012_push_notifications"`. Merged as it is, it would be a second head, and `tests/test_migration_chain.py` fails. **The rule:**

```
file           backend/alembic/versions/0017_device_events.py
revision       "0017_device_events"
down_revision  "0016_geography_boundaries"
```

If the fix round lands its own `0017` first (for example an index migration from the backend lane), the pdf migration becomes `0018_device_events` with `down_revision` = that 0017. Whichever is the last file wins the next number; there is never a second head. This supersedes the earlier `0016_device_events` / `down_revision 0015` wording in `POST_DEMO_CHANGE_INVENTORY.md` (corrected there on 30 Sep). `docs/NER_PLATFORM_EXPANSION.md` still carries older roadmap numbers (`0014_device_events`, `0016_field_reports`, `0017_hubs`); those are ROADMAP labels, not revisions, and must be renumbered when written.

**Renaming alone is not enough.** Reading the file shows two things to reconcile before the merge (PROVEN_BY_SOURCE):

- **It relaxes three `emergencies` columns to NULL** (`stationary_since`, `check_sent_at`, `response_deadline_at`) for a driver-pressed SOS. The main tree's model declares them non-optional (`app/models/emergency.py`), and its own global driver SOS writes values into them. After the merge, the model, the migration and the SOS code must agree, or `compare_metadata` reports drift and one of the two SOS designs silently wins.
- **Its `downgrade()` runs `UPDATE emergencies SET <col> = triggered_at WHERE <col> IS NULL`.** That is a data-changing downgrade, and it goes into the rollback notes.

It also adds `trip_events.device_event_id` and `device_reported_at`, the partial unique index `uq_trip_events_device_event`, and three `trip_event_kind` values (`ADD VALUE IF NOT EXISTS`; they cannot be dropped on downgrade). Rehearse `0016 -> 0017` fresh, populated, and on a hosted clone before it counts as safe. Today it is **unproven**: never renumbered, never run (C-13).

## Hosted gates (add-on §7), 30 Sep 2026

`READY_FOR_HOSTED_MIGRATION = NO` until **every** row reads YES. The first six are the add-on's gates. H7-H11 come from this round's evidence.

| # | Gate | Holds? | Evidence (30 Sep) |
|---|---|---|---|
| H1 | Open P0 defects = 0 | **NO** | AG-17 (the DB pool is held across the Gemini call) and AG-20 (security headers only in the uncommitted tree) were open as reproduced (`ANTIGRAVITY_FINDINGS_REPRODUCTION.md` §2.4). Fix lanes are in flight; each needs its red-to-green evidence and a green full suite before this reads YES |
| H2 | Rehearsals: fresh `0001 -> head`; populated 0012 -> head; populated 0015 -> head; hosted-schema clone stamped at the revision **read** from hosted -> head; downgrade review | **PARTIAL** | Fresh -> 0016: yes. 0013/0014 on fresh, populated and hosted-shaped: yes (`MIGRATION_0013_0014_REHEARSAL.md`). 0015 and 0016 on a hosted clone: **no**. 0016 populated: **no**. 0017: not written |
| H3 | Backup / PITR confirmed on the Supabase project | **NO** | "Backup and recovery - NOT CONFIRMED" above |
| H4 | Survey of India strategy: real OVSF/1M/7 geometry, hashed, loadable into hosted in the same window as 0016, with the real-city tests green | **NO** | `SOI_REAL_DATA = BLOCKED_USER_DOWNLOAD`; importer local-only; 22 `TestRealCities` skipped (`docs/GEOSPATIAL_SOURCE_LEDGER.md`) |
| H5 | The latest integrated Android build installed and certified on a physical device | **NO** | No APK from the integrated tree; no device attached (`PHYSICAL_ANDROID_EVIDENCE_RECONCILIATION.md`) |
| H6 | Explicit owner authorisation for this hosted migration | **NO** | None recorded. Recommendations in audit documents are not authorisation (AX-37 rejected) |
| H7 | Hosted revision re-read immediately before applying | **NO** | Last read `0012_push_notifications` on 19 Sep; not re-read (hosted off-limits this round) |
| H8 | `/ready` detects a schema behind the code (NF-02) | **NO** | `red_ready_schema_gap.py` RED |
| H9 | One Alembic head after the pdf branch merge, with 0017 (or 0018) reconciled as above | **NO** | Not merged |
| H10 | Code and migration deploy in one window; backend before any driver build that sends `fix_at` | Plan only | `POST_DEMO_CHANGE_INVENTORY.md` integration rules |
| H11 | Production data boundary checks pass on hosted (no DEMO/TEST geography, no fixture outline, fixture accounts inactive) | **NOT_VERIFIED** | `docs/PRODUCTION_DATA_BOUNDARY.md` §5 |

## Apply, when authorised

**Not authorised.** `READY_FOR_HOSTED_MIGRATION = NO` (see "Hosted gates"). Note also that `backend/.venv` cannot currently run for this Windows user (NF-01), so the command below would first need a working interpreter.

```bash
cd backend
DATABASE_PROVIDER=supabase ./.venv/Scripts/python.exe -m alembic upgrade head
```

Then deploy the code — the two must go together. The application at `5b5e474`
does not know about any of these tables, and the new code requires them.
