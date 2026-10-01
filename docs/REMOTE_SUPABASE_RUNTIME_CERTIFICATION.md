# Remote Supabase runtime — certification

Claim under test: **the real application does not depend on a database on anyone's laptop.**

Status: `PASS`. Verified against the hosted services on 19 September 2026, not inferred
from configuration.

---

## 1. What the hosted backend answers

```
GET https://ner-intelligence.onrender.com/ready
{"status":"ready","provider":"supabase",
 "checks":{"database":{"ok":true,"detail":"PostgreSQL 17.6"},
           "postgis":{"ok":true,"detail":"3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"}}}
```

`provider` is reported, the version is proved by a query rather than asserted, and no
credential appears in the payload — `redact_url()` strips it before anything is logged or
returned.

## 2. Why there is no silent fallback

`backend/app/core/config.py` selects the URL from `DATABASE_PROVIDER` with no fallback
branch:

```
DATABASE_PROVIDER=supabase  ->  DATABASE_URL        (rejected if it names a local host)
DATABASE_PROVIDER=local     ->  LOCAL_DATABASE_URL  (required to be set)
```

A validator refuses `supabase` pointed at a local address, and refuses `local` with no
`LOCAL_DATABASE_URL`. There is deliberately no code path from one to the other: connecting
to a stale local copy when the managed database is unreachable would let the application
look healthy while serving the wrong data, which is worse than an honest outage.

TLS is required whenever the provider is not local. psycopg defaults to `sslmode=prefer`,
which silently downgrades to plaintext on a failed handshake; the engine sets `require` so
a failed handshake is an error.

## 3. A defect found and fixed during this certification

`_host_of()` parsed connection URLs with `urlsplit`. `urlsplit` follows RFC 3986 and a
generated database password does not: one containing `/`, `?` or `#` ends the authority
early, and the "hostname" returned is then part of the credential.

Observed: the isolated test cluster's URL returned **`ner_test`** — the username — as its
host. Two guards read that function:

- the validator that refuses `DATABASE_PROVIDER=supabase` pointed at localhost;
- the gate that refuses to run table-dropping migration tests against a non-local host.

Both fail closed, so nothing was damaged and the destructive tests simply never ran. But a
security check that mis-reads its input is not a check. `_host_of()` now parses with
SQLAlchemy's `make_url`, keeping the old reading only as a last resort for a URL shape
SQLAlchemy rejects. With the fix the same URL resolves to `127.0.0.1` and the destructive
migration gate works as designed.

## 4. Test isolation is not a fallback

The "no local database" requirement is about the **running application**. Tests must never
point at the shared database, and three things stop them:

1. `tests/db_target.py` vetoes the connection at `do_connect` — before a socket opens, on
   the final parameter set, registered against `Engine` so every engine in the suite is
   covered. There is no override flag; an authorised remote target would have to be added
   to `ALLOWED_TARGETS` by a person editing that file.
2. `.runtime/use-isolated-db.sh` arms a disposable local cluster for one shell, without
   touching `backend/.env`.
3. Destructive migration tests additionally require an opt-in **and** a local host.

The full suite ran against the isolated cluster for this certification. No test in this
work connected to the hosted database.

## 5. Schema

Migration head: `0013_state_district_inbox`. Applied to the isolated cluster and verified
by `alembic.autogenerate.compare_metadata`, which reports **no drift** between
`Base.metadata` and the migrated schema — the only entries are `spatial_ref_sys` (PostGIS)
and `system_info` (the migration marker), neither of which is an ORM model and both of
which the project's drift test already excludes.

**Not yet applied to the hosted database.** Applying 0013 there is a shared-data action and
is not done without explicit authorisation. Until it is, the hosted backend runs at
`0012_push_notifications` and none of the new tables or roles exist there.

## 6. What remains local — nothing, for the application

| Concern | Where it lives |
|---|---|
| Operational data | Supabase PostgreSQL 17.6 + PostGIS 3.3 |
| Private files (photos, documents) | `stored_files` in the same database |
| Manager Web | static build on Render, talks to the API over HTTPS |
| Driver App / Driver Web | same API, same database |
| Terrain/route evidence cache | the hosted service's own disk — a cache, rebuilt on demand |
| Isolated test cluster | this laptop, used by `pytest` only |

Nothing the hosted demo serves comes from a developer machine.
