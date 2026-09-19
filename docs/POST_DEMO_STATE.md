# RASTA AI — post-demo repository state

**Taken** 26 September 2026, before any integration work.
**Purpose** A record of exactly what existed at the moment the project left
emergency demo mode, so nothing can be lost silently during reconciliation.

Nothing was deleted, reset, stashed or cleaned to produce this document.

---

## 1. The headline problem

The deployed baseline and the development tree are **not on the same commit**,
and the development tree is the one that is behind.

```
origin/main   e4043ce   ← DEPLOYED. Hosted backend and manager run this.
                  │
local main    5b5e474   ← the dirty tree is built on THIS, one commit back
   + 84 modified
   + 193 untracked (103 lines when directories are collapsed)
```

`e4043ce` was pushed from an isolated worktree during the demo hotfix, so the
local checkout never advanced. Every uncommitted change therefore sits on a
parent that production has already moved past.

Seven files carry changes that are **already live** in `e4043ce` *and* still
present locally. Re-applying them would conflict:

| file | what is already deployed |
|---|---|
| `backend/app/services/trips.py` | `close()` calls `release_resources` |
| `backend/app/services/driver_trips.py` | delivery no longer releases the pair |
| `backend/tests/test_trip_execution.py` | corrected lifecycle assertion |
| `backend/tests/test_trip_release_after_delivery.py` | new regression suite |
| `manager-web/src/api/client.ts` | in-flight GET coalescing |
| `manager-web/src/api/dedupe.test.ts` | new coalescing tests |
| `manager-web/src/pages/TripsPage.tsx` | `reloadAfterLifecycleChange` |

`git diff origin/main -- <path>` is the only honest way to see what is *extra*
in each of those, and it is what the change inventory uses.

---

## 2. Recorded state

```text
HOSTED_COMMIT          = e4043ce  (origin/main)
LOCAL_HEAD             = 5b5e474  (main, 1 behind origin/main)
SAFETY_SNAPSHOT        = snapshot/post-demo-2026-09-26  ->  1b50237
                         937 files, tracked + untracked, .gitignore respected
DIRTY_TREE_FILES       = 277 per file  (git status --porcelain -uall)
  MODIFIED             = 84 tracked files
  UNTRACKED            = 193 files — shown as 103 lines by plain
                         `git status --porcelain`, which collapses each
                         untracked directory into a single "?? dir/" line.
                         The first inventory pass counted the collapsed 103
                         and missed files inside those directories.
CURRENT_DB_REVISIONS   = isolated cluster 127.0.0.1:55432 (restarted 13:38)
                           ner_logistics_test     0013_state_district_inbox
                           ner_logistics_cert     0013_state_district_inbox
                           ner_logistics_demo     0012_push_notifications
                           ner_supabase_rls_test  0009_route_maneuvers
HOSTED_DB_REVISION     = 0012_push_notifications
                         (basis: 0013 was never applied to hosted; the clone
                          rehearsal dumped hosted and it stamped at 0012)
MIGRATION_CHAIN_ON_DISK= ... 0010_emergencies, 0011_files_verification,
                         0012_push_notifications, 0013_state_district_inbox
CURRENT_APK            = .runtime/rasta-driver-1.0.22-local.apk (30.8 MB,
                         versionCode 22, signer fac61745…033b9c)
ROLLBACK_APK           = .runtime/rasta-driver-1.0.21-local.apk (certified)
DEVICE                 = b519d9d3 NOT CONNECTED at time of writing
CURRENT_MANAGER_BUILD  = manager-web/dist/assets/index-D3sMIiI6.js (1.73 MB)
HOSTED_MANAGER_BUILD   = /assets/index-CJVgbOhe.js (deployed from e4043ce)
```

### How the snapshot was taken

A temp-index commit, so the working tree and the real index were never touched:

```bash
GIT_INDEX_FILE=/tmp/snap.idx git read-tree HEAD && git add -A
TREE=$(GIT_INDEX_FILE=/tmp/snap.idx git write-tree)
git tag snapshot/post-demo-2026-09-26 $(git commit-tree "$TREE" -p HEAD -m "…")
```

Verified afterwards: still 84 modified / 103 collapsed untracked lines.
A later check with `git hash-object` against the tag found all 276 of the
then-existing dirty files byte-identical — and one absent: this document, which
was written after the snapshot. A second snapshot (§2a) covers it. To inspect it:
`git show snapshot/post-demo-2026-09-26 --stat`. To recover a single file:
`git show snapshot/post-demo-2026-09-26:path/to/file`.

The snapshot respects `.gitignore`, so it does **not** contain `.runtime/`
(APKs, evidence, private credential files). Those live only on this machine.

---

## 3. Branches

| ref | commit | note |
|---|---|---|
| `origin/main` | `e4043ce` | deployed |
| `main` (local) | `5b5e474` | 1 behind |
| `release/close-releases-resources` | `e4043ce` | the hotfix worktree at `/tmp/rasta-release` |
| `origin/claude/pdf-master-mission-gohuj5` | `1baa4c8` | unmerged, not inventoried |
| `origin/claude/rasta-ai-sih26002-deck-e8xagd` | `4eed250` | unmerged, not inventoried |
| `origin/claude/video-navigation-impl-ejdxwo` | `d37e7a4` | unmerged, not inventoried |

### The three `claude/*` branches, inventoried

All three are substantial and all three are badly behind. None is a stale
duplicate that can simply be deleted.

| branch | ahead | behind | files | diff | content |
|---|---:|---:|---:|---|---|
| `claude/pdf-master-mission-gohuj5` | 10 | **34** | 62 | +7956/−74 | resilience work, reason codes, API/data-model docs |
| `claude/rasta-ai-sih26002-deck-e8xagd` | 5 | **45** | 66 | +3796/−226 | submission deck variants (`docs/submission/variants/`) |
| `claude/video-navigation-impl-ejdxwo` | 1 | **20** | 15 | +4347/−65 | driver navigation: one guidance scheduler, route-aware matching, `navigationControls.test.tsx` |

**They collide with the dirty tree.** Files touched by both:

- video-nav ∩ dirty tree — 2 files: `driver-app/src/screens/MapScreen.tsx`,
  `driver-app/src/i18n/phrases.ts`
- pdf-master ∩ dirty tree — **15 files**, including `backend/app/api/trips.py`,
  `backend/app/models/enums.py`, `backend/app/schemas/domain.py`,
  `driver-app/src/screens/MapScreen.tsx`, `driver-app/src/screens/SafetyScreen.tsx`

`MapScreen.tsx` is modified in the dirty tree **and** in two separate branches.
Whatever integration order is chosen has to resolve that file deliberately
rather than by whichever merge happens to run last.

This is a fourth divergence on top of the three already known, and it is the
reason the integration must be commit-by-commit rather than a bulk merge.

---

## 4. Environment inventory — names only, no values

No secret value is recorded here or anywhere in `docs/`.

| file | variables |
|---|---|
| `backend/.env` | `APP_NAME` `APP_ENV` `DEBUG` `API_HOST` `API_PORT` `SECRET_KEY` `ACCESS_TOKEN_EXPIRE_MINUTES` `REFRESH_TOKEN_EXPIRE_DAYS` `DATABASE_PROVIDER` `DATABASE_URL` `LOCAL_DATABASE_URL` `SUPABASE_URL` `DB_POOL_SIZE` `DB_MAX_OVERFLOW` `DB_ECHO` `DB_REQUIRE_SSL` `DB_CONNECT_TIMEOUT_SECONDS` `CORS_ORIGINS` `GEMINI_API_KEY` `OPENROUTER_API_KEY` |
| `manager-web/.env` | `VITE_API_BASE_URL` |
| `manager-web/.env.production` | `VITE_BACKEND` `VITE_API_BASE_URL` `VITE_SUPABASE_URL` `VITE_SUPABASE_ANON_KEY` `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `manager-web/.env.remote-demo` | `VITE_BACKEND` `VITE_API_BASE_URL` |
| `driver-app/.env` | `EXPO_PUBLIC_MAPTILER_KEY` |
| `render.yaml` | `APP_ENV` `AUTH_PROVIDER` `CORS_ORIGINS` `DATABASE_PROVIDER` `DATABASE_URL` `DB_MAX_OVERFLOW` `DB_POOL_SIZE` `DB_REQUIRE_SSL` `DEMO_SIMULATION_ENABLED` `EXPO_PUBLIC_API_BASE_URL` `FLOOD_ENABLED` `GEMINI_API_KEY` `OPENROUTER_API_KEY` `REFRESH_COOKIE_SAMESITE` `ROUTE_WATCH_ENABLED` `SECRET_KEY` `SUPABASE_URL` `TERRAIN_ENABLED` `TRUSTED_PROXY_HOPS` `VITE_API_BASE_URL` `VITE_BACKEND` `VITE_DRIVER_WEB_URL` `WARNINGS_ENABLED` `WARNINGS_POLL_ENABLED` `WEATHER_ENABLED` |

**A live-configuration gap worth naming:** `manager-web/.env.production` says
`VITE_BACKEND=supabase`, but `render.yaml` overrides it to `local` with
`VITE_API_BASE_URL=https://ner-intelligence.onrender.com`. The deployed bundle
was checked and contains only that host — one transport, FastAPI. The
`.env.production` file is therefore misleading to anyone reading it locally and
should be reconciled during integration.

Secrets confirmed git-ignored: `.runtime/demo-credentials.private.json`,
`.runtime/team-credentials.private.json`, `.runtime/pgpass.txt`,
`driver-app/.env`.

---

## 5. Environment that must be restored before integration testing

| thing | state | how to restore |
|---|---|---|
| isolated PostgreSQL cluster | **restarted 26 Sep 13:38** | `.runtime/pg/pgsql/bin/pg_ctl.exe -D .runtime/data -l .runtime/server.log start` |
| `ner_logistics_test` schema | **restored to 0013** — was left at 0012 by the hotfix release gate | done: `alembic upgrade head` |
| device `b519d9d3` | disconnected | reconnect over USB |
| `/tmp/rasta-release` worktree | present at `e4043ce` | `git worktree remove` when finished, or keep as the integration base |

The test database was deliberately rebuilt at 0012 during the release gate so
the hotfix could be verified against hosted's exact schema. It has now been
brought back to head.

**That upgrade is itself a data point for the 0013 rehearsal:** it ran
`0012 → 0013` against a populated database (852 rows in `users`) and completed
with no error and no manual intervention. It is not the full rehearsal Phase 4
asks for — that needs a fresh `0001 → 0013` chain and a clone of hosted data —
but it is one honest piece of evidence that the step is not inert.

---

## 6. What this document does not decide

Per-file classification, the integration commit order, and what is blocked are
in `POST_DEMO_CHANGE_INVENTORY.md`. Nothing here authorises deleting,
committing, deploying, or applying a migration.
