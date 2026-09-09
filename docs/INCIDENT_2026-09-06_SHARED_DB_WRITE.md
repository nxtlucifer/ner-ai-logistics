# Incident: the test suite ran against the shared Supabase database

**Status:** contained. Impact partly established, partly unknown. **No remediation
executed, and none proposed** — see [Attribution](#attribution-is-insufficient).

**Prepared:** 2026-09-06, from local evidence only. Nothing in this assessment
connected to the shared database.

---

## 1. Summary

`backend/.env` sets `DATABASE_PROVIDER=supabase` and points at the shared
Supabase project. Isolation from it was procedural: it lived in
`.runtime/use-isolated-db.ps1` and worked only when a caller remembered to
dot-source it. Bash had no equivalent at all.

Three pytest runs started from Bash without arming anything. They resolved to
the shared database and executed **105 tests** against it. Each of those tests
created fixture rows there, and — the larger effect — each ran an autouse
teardown that deleted **by global prefix**: every `TTEST-%` trip, every
`STEST-%` shipment, every `AS__ZZ%` truck and every `%@p3test.invalid` driver in
the database, regardless of which process created them, followed by a commit.

The reported framing of this incident as "36 test users created" describes the
smallest part of it. Two of the three runs created **no rows at all** and still
ran that teardown 46 times. The reach was never 36 rows; it was every
test-shaped row in the shared project, on every one of the 105 tests.

The 36 figure is now explained — a replay of the 05:43 command on the isolated
cluster creates exactly 36 users from exactly 54 tests — but explaining a count
is not identifying rows, and no row can be identified.

---

## 2. What ran

Reconstructed from the local Claude Code session transcripts under
`~/.claude/projects/D--Projects-ner-ai-logistics/`, which retain each command,
its UTC timestamp and its output. Extraction preserved at
`.runtime/incident-evidence/unarmed-runs.txt`.

A run is **armed** when the command itself names the isolated cluster (via the
script or an inline `export`). Shell state does not survive between tool calls,
so every invocation had to arm itself or inherit `backend/.env`.

Window: from 2026-09-05T09:00Z, when the isolated cluster was created and became
the required target. Before that date the project ran its suite against shared
Supabase deliberately, so earlier runs are prior practice, not this incident.

| UTC | Command | Result | Tests executed |
| --- | --- | --- | --- |
| 2026-09-05T09:40:02Z | `pytest tests/test_config.py::TestLocalProvider` (env deliberately cleared) | 4 passed | 4 |
| 2026-09-05T17:45:25Z | `pytest tests/test_places_snapshot.py -q --tb=line` | 21 passed, 12.45s | 21 |
| 2026-09-06T05:37:00Z | `pytest tests/test_places_snapshot.py -q --tb=short` | 25 passed, 13.85s | 25 |
| 2026-09-06T05:43:00Z | `pytest tests/test_routing.py tests/test_route_api.py` (after a heredoc patched `app/services/routes.py`) | 23 failed, 31 passed, 52.37s | 54 |
| 2026-09-06T05:44:00Z | `pytest tests/test_route_api.py::TestBackupRoute::test_a_separate_corridor_is_stored_as_a_backup` | `UndefinedColumn: column "driver_accepted_at" of relation "trips" does not exist` | 1 |

**105 tests executed against the shared database.** Over the same window 78
other pytest invocations were correctly armed at
`127.0.0.1:55432/ner_logistics_test`.

The `UndefinedColumn` at 05:44 is the first moment the wrong target became
visible: migration 0008 had been applied locally and not to shared, so the
application's own `INSERT` named a column shared does not have. Nothing before
that announced anything — the earlier runs reported clean passes.

The 09:40 run is included for completeness. `test_config.py` writes nothing
itself, but the autouse fixtures below run for every test in any file.

### The two fixtures that make every executed test a write

Both are autouse and both are in the committed tree at `HEAD` (`f850de4`), so
they applied to all 105 tests:

- `exclusive_suite_lock` (session-scoped) opens a dedicated connection and takes
  a PostgreSQL advisory lock.
- `_cleanup_test_rows` runs `factories.cleanup()` after **every** test, pass or
  fail.

### What `cleanup()` executed, per test

The committed version at the time, in order, then `COMMIT`:

```sql
DELETE FROM trips   WHERE trip_code      LIKE 'TTEST-%';
DELETE FROM shipments WHERE reference_code LIKE 'STEST-%';
DELETE FROM driver_truck_assignments a USING drivers d, users u
      WHERE a.driver_id = d.id AND d.user_id = u.id AND u.email LIKE '%@p3test.invalid';
DELETE FROM drivers d USING users u
      WHERE d.user_id = u.id AND u.email LIKE '%@p3test.invalid';
DELETE FROM refresh_tokens r USING users u
      WHERE r.user_id = u.id AND u.email LIKE '%@p3test.invalid';
UPDATE users SET is_active = false
      WHERE email LIKE '%@p3test.invalid' AND is_active;
DELETE FROM trucks WHERE registration_number LIKE 'AS__ZZ%';
```

None of these is scoped to the run. Every one of them selects on a name that
every run this project has ever executed also used.

---

## 3. Tables affected

| Table | Statement | Scope | Cascade |
| --- | --- | --- | --- |
| `trips` | INSERT, DELETE | all `TTEST-%`, any owner | `trip_stops`, `trip_routes`, `trip_events`, `gps_points` |
| `shipments` | INSERT, DELETE | all `STEST-%`, any owner | `cargo_items` |
| `trucks` | INSERT, DELETE | all `AS__ZZ%`, any owner | — |
| `drivers` | INSERT, DELETE | all with a `%@p3test.invalid` user | — |
| `driver_truck_assignments` | INSERT, DELETE | same | — |
| `refresh_tokens` | INSERT, DELETE | same | — |
| `users` | INSERT, **UPDATE** `is_active = false` | all `%@p3test.invalid` | — |
| `audit_logs` | INSERT only | append-only trigger rejects DELETE | — |

`users` is the row that matters most and is the one nobody counted. The reported
**19,827** test-marked users in shared are all inside
`email LIKE '%@p3test.invalid'`. Every executed test's teardown set `is_active =
false` across that whole set.

**This is testable read-only.** See [section 6](#6-read-only-queries-that-would).

### How many rows each run created

Measured by replaying the same commands against the **isolated** cluster with
the new ownership ledger counting inserts. Nothing here touched shared.

| Run | Tests | Rows created | Users created |
| --- | --- | --- | --- |
| `test_places_snapshot.py` (both runs) | 21, then 25 | **0** | **0** |
| `test_routing.py` + `test_route_api.py` | 54 | 127 | **36** |

Two things follow.

**A run that creates nothing still deletes everything.** The two
`test_places_snapshot.py` runs wrote no fixture rows at all — and still ran the
global teardown 46 times against shared, once per test. Counting created rows
does not measure this incident.

**The reported "36 recently created" figure is now explained.** The 05:43
command executed 54 tests, exactly the number it executes today, and a replay
of it creates exactly 36 users. `test_routing.py` creates nothing; all 127 rows
come from the 18 tests in `test_route_api.py`, each of which makes a manager and
a driver account.

This is a match in **volume, not identity**. It corroborates that run as the
origin of the reported 36 and it does not name a single row: any run of the same
command produces the same counts with entirely different ids. It is not a basis
for deleting anything — see [section 4](#4-attribution-is-insufficient).

The incident run reported 23 failures where a replay now passes 54, because
shared lacked the `driver_accepted_at` column that migration 0008 added locally.
Those failures happened at the **trip** insert, after each test had already
committed its user, driver, truck and shipment through separate transactions —
so the 36 user creations stand, while fewer than 18 trips would have survived.

### Migration state

Shared Alembic version is reported to remain **0006**. That is consistent: none
of these runs invoked Alembic, and the `UndefinedColumn` error is itself
evidence that the shared schema had not advanced. It says nothing about data.

### Whether the deletes committed

`_cleanup_test_rows` wraps the call and on failure rolls back and emits a
warning, so each teardown is atomic — a given test's cleanup committed entirely
or not at all. The retained transcript output is tail-truncated (`| tail -8`,
`| tail -20`), so per-test warnings are not visible and **the number of
teardowns that committed cannot be established from local evidence**. One
committed teardown is sufficient for the full effect.

---

## 4. Attribution is insufficient

**No exact-ID remediation manifest is proposed, and none should be executed.**

The rows created by these runs cannot be distinguished from rows created by any
other run:

- Identifiers are random. `unique_email()` produces
  `driver-<uuid4 hex[:10]>@p3test.invalid` — no run marker, no process id, no
  sequence.
- The old cleanup recorded nothing. It selected on a prefix, so there was never
  a list of what a run had made.
- The prefixes are shared by every run in the project's history.
- `created_at` plus a prefix is not ownership. Two runs in the same window are
  indistinguishable, and the window itself is only as good as the clock
  agreement between the shared database and the local machine.

The reported "36 recently created" figure is a **count of candidates in a time
window**, not an attribution. Acting on it would delete rows on the strength of
a timestamp.

The remaining 19,791 test-marked users are **pre-existing relative to that
count**. That is all it means. It does not establish another owner, and it is
not permission to touch them.

### What the volume match does and does not add

The replay in section 2 explains the reported count: 54 tests, 36 users, exactly
what shared reported. That is worth having — an unexplained number invites worse
guesses than an explained one.

It changes nothing about remediation. Knowing that a run created 36 users is not
knowing *which* 36 rows those are, and the difference is the whole question. Two
runs of that command are identical in every observable except the random ids
that were never recorded.

---

## 5. Evidence used, and evidence that does not exist

**Used:**

- Local session transcripts (commands, UTC timestamps, outputs) — the primary
  record. Preserved extraction: `.runtime/incident-evidence/unarmed-runs.txt`.
- The committed `tests/factories.py` and `tests/conftest.py` at `HEAD`
  (`f850de4`), which establish exactly what teardown executed.
- `backend/.env`, which establishes the resolved target of an unarmed run.

**Preserved but weak:** `.runtime/incident-evidence/pytest-*-preserved.json`,
copied from `backend/.pytest_cache`. This cache is **cumulative across runs and
was already overwritten** by later work in this session before it was copied. It
shows which tests exist and have failed at some point; it does not show which
ran during the incident. It is kept for completeness and should not be cited as
run evidence.

**Does not exist:**

- No pytest log was written for any of the three runs. `.runtime/` holds logs
  for armed runs only.
- No database audit log, statement log or backup of the shared project is known
  to this assessment. Nothing here should be read as implying one exists.
- No before-state snapshot of the shared database.

---

## 6. Read-only queries that would settle what is currently unknown

**Not executed.** They require access this assessment deliberately does not
take, and they need explicit authorisation. If run, they belong in a narrowly
scoped `READ ONLY` transaction, not in the test harness and not through any
write-capable session:

```sql
BEGIN TRANSACTION READ ONLY;

-- Did the mass deactivation commit? 0 active means it did.
SELECT count(*) FILTER (WHERE is_active)     AS still_active,
       count(*) FILTER (WHERE NOT is_active) AS deactivated
  FROM users WHERE email LIKE '%@p3test.invalid';

-- Consistent with a committed global teardown if both are 0.
SELECT count(*) FROM trips     WHERE trip_code      LIKE 'TTEST-%';
SELECT count(*) FROM shipments WHERE reference_code LIKE 'STEST-%';
SELECT count(*) FROM trucks    WHERE registration_number LIKE 'AS__ZZ%';

-- Creation shape over the incident window. CANDIDATES, not attribution.
SELECT date_trunc('hour', created_at) AS hour, count(*)
  FROM users
 WHERE email LIKE '%@p3test.invalid'
   AND created_at >= TIMESTAMPTZ '2026-09-05 17:00Z'
 GROUP BY 1 ORDER BY 1;

COMMIT;
```

A `count` of 0 for the first query would confirm the deactivation committed. A
non-zero `still_active` would mean it did not — and would also mean the shared
project still holds thousands of usable accounts, which is its own finding.

---

## 7. What has been fixed

| Was | Now |
| --- | --- |
| Isolation depended on remembering a PowerShell script; Bash had no armed path | `.runtime/use-isolated-db.sh` added. Both shells arm the same target |
| A `pytest_collection_modifyitems` guard existed but `db_target` was never imported — it raised `NameError` and refused nothing | Guard wired, and moved to SQLAlchemy's `do_connect` event so it vetoes *every* engine before the driver is called |
| `ALLOW_SHARED_DB_TESTS=1` turned the protection off | Removed. `tests/test_db_target_guard.py` asserts setting it changes nothing |
| Only the configured URL was checked | The final merged connection parameters are checked, so a `connect_args` or URL-query host override cannot slip past |
| Only the async engine was covered; the advisory-lock engine, the `db` fixture and `test_migrations.py` built their own | One listener on `Engine` covers all of them |
| Only `DATABASE_URL` was checked | `MIGRATION_DATABASE_URL` is checked too |
| Cleanup deleted by global prefix | Cleanup deletes recorded ids only (`factories.OWNED`) |
| Ownership recorded per factory call, so API-created rows were invisible | Recorded by an `after_flush` listener, so every ORM insert is owned whichever session makes it |

Proof: `tests/test_db_target_guard.py` (16 cases, each building a real engine
with `psycopg.connect` replaced by a tripwire — a refusal that reached the
driver fails the test) and `tests/test_cleanup_ownership.py` (another run's
whole graph survives; this run's is removed in dependency order; a failed
cleanup does not widen).

Process-level check, with the removed override set:

```
ALLOW_SHARED_DB_TESTS=1 pytest tests/test_health.py tests/test_database.py
  -> PYTEST_EXIT=3  CONNECTION_ATTEMPTS=0
```

Both shells refuse an unarmed run with exit code 3 before any test executes.

---

## 8. Still open

- **Shared impact is partly unknown.** Which teardowns committed is not
  determinable locally. Section 6 would settle it read-only.
- **No remediation is proposed.** Attribution is insufficient, so there is
  nothing safe to delete. If the shared project needs its test rows cleared,
  that is a separate decision about *all* test-marked rows, made by the owner —
  not a reconstruction of this run.
- **Seed and admin scripts are not guarded.** `backend/scripts/create_user.py`,
  `.runtime/seed_manager.py` and `.runtime/seed_linked_trip.py` resolve the same
  configuration and would reach shared if run unarmed. They are operator tools
  that may legitimately target shared, so they were left alone — but they are
  not protected by anything described here.
- **`backend/.env` still points at shared Supabase.** That is the project's
  intended runtime configuration. The guard makes it safe for tests; it does not
  make a plain `python run.py` safe. Use `.runtime/use-isolated-db.ps1` or
  `.sh` before starting the backend for local work.
