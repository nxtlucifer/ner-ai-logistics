# Data hygiene audit — where every row came from

Read-only against hosted Supabase. Nothing in this document was written,
altered or deleted on the hosted database.

Run on 19 September 2026. Hosted revision `0012_push_notifications`.

---

## The report that started this

A state manager's dashboard listed districts called **Api List**, **C Home**,
**Closed A**, **Closed B**, **Create Dup**, **Create Ok**, **Dash Att**,
**Dash Att Other**, and the regional dashboard counted **Assam 141**,
**Meghalaya 39**, **Mizoram 5**, **Nagaland 3**, **Tripura 2**.

Those are pytest fixture names, and those counts are counts of pytest rows.

## What was actually wrong — two different things

**1. The counts were the bug, and they were a product bug, not a data bug.**
`/api/dashboard` asked how many rows existed in `districts`. Every fixture the
suite had ever created answered. The screen the report came from was a LOCAL
console pointed at the LOCAL test database, so the rows it counted were the
suite's own — but the same query shipped to hosted would count whatever was
there, which is exactly how a number nobody can source ends up in front of a
ministry.

**2. Hosted carries real historic fixture contamination — from before the
guards existed, and not in the districts tables.** See below. This is the
finding that matters, and it was not visible from the dashboard at all.

---

## Hosted: what is actually in the database

| Table | Rows | Classification |
|---|---:|---|
| `users` | 19,879 | **19,860 TEST_FIXTURE**, 19 operational — see below |
| `drivers` | 9 | 4 DEMO_SEED, 1 SUSPENDED_UNKNOWN, 4 RUNTIME_USER_CREATED (18 Sep) |
| `trucks` | 9 | 4 DEMO_SEED / RUNTIME, **5 TEST_FIXTURE** (retired, 16 Sep) |
| `trips` | 121 | DEMO_SEED and RUNTIME — no pytest prefix present |
| `shipments` | 120 | DEMO_SEED and RUNTIME — no pytest prefix present |
| `gps_points` | 409 | RUNTIME (demo driving) |
| `audit_logs` | 33,665 | RUNTIME |
| `states` | — | **table does not exist** (0013 not applied) |
| `districts` | — | **table does not exist** |
| `notifications` | — | **table does not exist** |

`select to_regclass('public.states'), to_regclass('public.districts'),
to_regclass('public.notifications')` returns three NULLs.

### The user contamination, in detail

| Fixture email domain | Users | State |
|---|---:|---|
| `p3test.invalid` (the pytest `TEST_MARKER`) | 19,827 | all deactivated |
| `p5cert.invalid` | 14 | all deactivated |
| `dspcert.invalid` | 13 | all deactivated |
| `p7cert.invalid` | 6 | all deactivated |
| **total** | **19,860** | **all `is_active = false`** |

Created between **30 August and 6 September 2026**, the heaviest day being
1 September (9,747 rows). **None has a driver row**, none is active, and none
appears on any operational screen — the console lists drivers, not users.

This is the incident `.runtime/use-isolated-db.sh` refers to in its header
comment: a pytest run started from a shell where `backend/.env` said
`DATABASE_PROVIDER=supabase`, so the suite wrote its fixtures to the shared
project. Cleanup deactivates users rather than deleting them (a user is
referenced with RESTRICT), which is why they are still there.

### The truck contamination

Five trucks match the factory registration generator exactly
(`AS\d\dZZ\d{4}` — `AS99ZZ2617`, `AS99ZZ9142`, `AS99ZZ1985`, `AS99ZZ0016`,
`AS99ZZ0017`), created 16 September and all **RETIRED**. They do not appear in
the available-truck list.

### UNKNOWN, and therefore not cleared

Four drivers created on 30 August carry licence numbers matching the factory
generator (`AS` + 12 hex). Three are AVAILABLE and one is SUSPENDED. They may
be the demo drivers — the demo seeder and the test factory share a generator —
or they may be fixtures that were never removed. **Nothing in the row records
which**, so they are classified UNKNOWN, not clean. Resolving this needs a
person who knows which demo accounts are real, not a query.

---

## Classification of every source that writes rows

| Source | Writes | Class | Can it reach hosted now? |
|---|---|---|---|
| `alembic/versions/*` | schema, 8 states | OFFICIAL_SEED | Yes — by design, applied deliberately |
| `backend/scripts/demo_scenario.py` | demo fleet and trips | DEMO_SEED | **No** — `assert_disposable` refuses |
| `backend/scripts/terrain_seed.py` | terrain fixtures | DEMO_SEED | **No** — `assert_disposable` refuses |
| `backend/tests/factories.py` | everything the suite needs | TEST_FIXTURE | **No** — `tests/db_target.py` vetoes the connection |
| `backend/tests/conftest.py` | suite setup | TEST_FIXTURE | **No** — same veto |
| `.runtime/rehearsal/cert_seed.py` | certification data | DEMO_SEED | **No** — `assert_disposable` refuses |
| `.runtime/rehearsal/clone_step5_sample.py` | clone rehearsal data | TEST_FIXTURE | **No** — `assert_disposable` refuses |
| `.runtime/provision_team.py`, `seed_manager.py` | team accounts | RUNTIME_USER_CREATED | Yes — operator tools, run deliberately |
| The API itself | everything else | RUNTIME_USER_CREATED | Yes — that is the product |

---

## The two guards, and what each covers

**`backend/tests/db_target.py`** — vetoes the CONNECTION the pytest suite
opens, at `do_connect`. Only `127.0.0.1:55432/ner_logistics_test` is allowed.
This is what stops the original incident recurring.

It cannot help anything outside the suite. A seed script reaches the database
through the ordinary application engine, which is what it is supposed to do,
so the veto is not in its path.

**`backend/app/core/disposable.py`** (new) — the guard for those. One call,
first line of `main()`:

```python
assert_disposable("demo_scenario.py")
```

It reads the HOST of the URL the application would actually dial — not the
provider label, which can say `local` while `LOCAL_DATABASE_URL` points
anywhere — and refuses unless that host is local. The refusal names the host
and says how to arm an isolated database.

**There is deliberately no override flag.** An override is how a guard becomes
a comment: somebody sets it once to get through an afternoon and it stays set.
`backend/tests/test_disposable_guard.py` fails if one appears in the code.

Nine tests cover the guard, including the parsing defect that made an earlier
version useless: `urlsplit` returned the USERNAME as the host for a password
containing a slash, so the guard could not tell local from remote. It now
parses with SQLAlchemy's `make_url`.

---

## The product fix: provenance, not a name filter

Filtering names in the frontend would have hidden the symptom and left the
count wrong. Districts now carry their provenance in a column:

```python
class DistrictSource(_StrEnum):
    VERIFIED_OFFICIAL = "VERIFIED_OFFICIAL"
    DEMO = "DEMO"
    TEST = "TEST"
    UNVERIFIED = "UNVERIFIED"
```

- The column defaults to `UNVERIFIED`, so anything written by something that
  did not say where it came from is **not counted**.
- `OPERATIONAL_SOURCES = (VERIFIED_OFFICIAL, DEMO)` — only these reach an
  operational screen or a count.
- `tests/factories.py` stamps every district it creates `TEST`.
- `/api/dashboard`, `/api/org/states` and `/api/org/districts` all filter.

A state with no verified list shows **"Official district list pending"**, never
`0`: zero is a measurement of a state with no districts, and this is the
absence of a list, which is a different claim.

`backend/tests/test_district_provenance.py` (9 tests) holds the line, including
a suite-wide assertion that no row whose `source_name` starts with
`test fixture` is ever operational.

---

## What is still open

1. **19,860 deactivated fixture users remain in hosted.** They are inert —
   deactivated, no driver rows, invisible to every screen — but they are 99.9%
   of the `users` table, and `select count(*) from users` is a misleading
   number for anyone who runs it. Removing them is a deliberate, destructive
   operation against shared data and is **not** something to do automatically:
   it needs a confirmed backup, and `RESTRICT` foreign keys mean the order
   matters. Recommended, not performed.
2. **Five retired fixture trucks** remain, for the same reason.
3. **Four drivers of unknown provenance** (above). UNKNOWN is not SAFE.
4. **`DISTRICT_SEED = BLOCKED_NEEDS_OFFICIAL_DISTRICT_SOURCE`.** No verified
   district list has been found for the eight states. None has been invented.
