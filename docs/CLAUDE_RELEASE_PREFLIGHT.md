# RELEASE PRE-FLIGHT — SAFE PUBLICATION PLAN

Continues `CLAUDE_HOSTING_READINESS.md`.

**Nothing was staged, committed, pushed or deployed.** Commit/push authorization
was not granted in this session, so I stopped at Step 9 as instructed.

---

## STEP 1 — WORKTREE CLASSIFICATION

`git status --short` reports 206 untracked entries because it collapses
directories. Expanded, `git ls-files --others --exclude-standard` gives **406
untracked files**, plus **74 modified tracked files**.

| Class | Count | Decision |
| :--- | ---: | :--- |
| **A** Required application source | 96 | STAGE |
| **A** Required source (operational scripts) | 37 | STAGE |
| **B** Required test | 76 | STAGE |
| **C** Required migration | 15 | STAGE |
| **D** Required deployment config | 7 | STAGE |
| **E** Required documentation | 116 | STAGE |
| **I** Cache (`supabase/.temp/`) | 9 | EXCLUDE |
| **J** Temp tool output (`.claude/`) | 29 | EXCLUDE |
| **J** Temp tool output (other agent tooling) | 8 | EXCLUDE |
| **J** Temp tool output (prompt dumps) | 6 | EXCLUDE |
| **J** Temp tool output (`.artibot/`) | 3 | EXCLUDE |
| **K** Unclassified — needs your call | 4 | see below |

**WOULD STAGE: 348 untracked + 74 modified. WOULD EXCLUDE: 58.**

### The reassuring part

`.runtime/`, `backend/.env`, `manager-web/.env.production`, `node_modules/`,
`logs/`, `backend/.venv/` and every `.apk` **did not appear in the untracked
list at all** — they are already ignored. I verified this with `git check-ignore`
rather than inferring it from their absence.

### One fragile thing worth fixing

```
.runtime/pgpass.txt  ->  ignored by .git/info/exclude:9
```

`.git/info/exclude` is **local-only and never committed**. The directory holding
the local Postgres password and every built APK is protected by a rule that
exists on this machine and nowhere else. Anyone cloning the repo and recreating
`.runtime/` gets no protection. **Recommend moving `.runtime/` into the tracked
`.gitignore` before publishing.** Cheap, and it removes a footgun.

### The 4 unclassified

| Path | My reading | Suggested |
| :--- | :--- | :--- |
| `driver-app/vitest.config.ts` | test configuration; the driver suite will not run without it | **STAGE** |
| `manager-web/netlify.toml` | manager host config | STAGE, but see below |
| `manager-web/vercel.json` | manager host config | STAGE, but see below |
| `memory/.dreams/events.jsonl` | agent tool output | **EXCLUDE** |

**Netlify *and* Vercel configs both exist, alongside `render.yaml` for the
backend.** Three hosting descriptors for two deployables. Nothing breaks, but
publishing both invites a future reader to deploy the manager twice, to two
places, with different environment variables — and only one of them will have
`VITE_INTELLIGENCE_BASE_URL`. Decide which one the manager actually ships on and
delete the other.

---

## STEP 2 — SECRET SCAN: **PASS**

360 files scanned — every untracked staging candidate plus every modified
tracked file, because a secret introduced into an already-tracked file is just
as bad and easier to miss.

| File | Type | Verdict |
| :--- | :--- | :--- |
| `backend/scripts/rls_harness.py` ×4 | Postgres URL with password | SAFE — `{pw}` format placeholder |
| `backend/tests/test_select_route_rpc.py` ×2 | Postgres URL with password | SAFE — `{pw}` format placeholder |
| `backend/tests/conftest.py:429` | Postgres URL with password | SAFE — host is `db.unreachable.invalid` |
| `backend/tests/test_config.py:183,205` | Postgres URL with password | SAFE — fixture exercising URL parsing (a password containing `@`) |
| `backend/tests/test_db_target_guard.py:202` | Postgres URL with password | SAFE — fixture proving the guard does **not** leak credentials in refusals |
| `scripts/Start-Demo.ps1:161` | Postgres URL with password | SAFE — `$pw` PowerShell interpolation reading gitignored `.runtime/pgpass.txt` |

Searched for and **found none of**: `sb_secret_*`, a `service_role` JWT, Google
`AIza…` keys, OpenRouter `sk-or-v1-…`, OpenAI-style keys, private key blocks,
AWS access keys.

**SECRET_SCAN = PASS. Zero real credentials in the staging set.**

---

## STEP 3 — AI STATUS CONSOLIDATION: DONE

There is now **one** function, `buildStatus()`, and both status routes call it.
Previously each assembled its own object and they disagreed — the POST branch
ignored `openRouterKey` entirely, so a backup-only deployment reported OFFLINE on
POST and online on GET. Two implementations of one question always eventually
differ.

States, computed from what the providers actually did rather than from key
presence:

| State | Meaning |
| :--- | :--- |
| `OFFLINE` | no provider key configured at all |
| `CONFIGURED` | a key exists; nothing attempted yet in this isolate |
| `USABLE` | the last attempt produced a real generated answer |
| `QUOTA_EXHAUSTED` | the last attempt was refused for quota |
| `FALLBACK` | the primary failed and the backup engine answered |

`available` is true only for `USABLE` and `FALLBACK`.

Covered by tests, all passing:

- Gemini usable → `USABLE`, available
- Gemini 429 + backup answers → **`FALLBACK`, available** (a generated answer
  *is* obtainable, just not from the primary)
- Gemini timeout + backup answers → `FALLBACK`
- Backup-only configuration → GET and POST agree on state, availability and provider
- All providers spent → `QUOTA_EXHAUSTED`, **not** available, answer
  `generated: false`
- Cold isolate → `CONFIGURED`, not available

Honest about its own limits: the record is per-isolate and Edge isolates are
ephemeral, so a cold isolate says `CONFIGURED` rather than claiming knowledge.
It is deliberately **not** a live probe on GET — spending a request against a
rate-limited tier to discover it is rate-limited makes the problem worse.

**Not deployed.** That is a separate authorization.

---

## STEP 4 — HOSTED SURFACE CONTRACT

Four endpoints. Everything else on the image is unused by production clients.

| # | Method | Path | Auth | Request | Response | Client | On failure |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | GET | `/api/trips/{id}/routes/recommendation` | Supabase JWT | path id | `RouteRecommendation` — candidates, score-or-null, eligibility, evidence freshness, unavailable factors | Manager | `IntelligenceUnavailableError` → `UNASSESSED`, null score |
| 2 | POST | `/api/trips/{id}/reroute` | Supabase JWT | path id | `RerouteAssessment` | Manager | surfaced as unavailable; **silence would read as safety** |
| 3 | GET | `/api/driver/me/trip/navigation` | Supabase JWT | — | `NavigationPackage` — `trip_id`, `route_id`, `route_revision`, geometry, maneuvers | Driver | no stale fallback; panel says directions unavailable |
| 4 | GET | `/api/driver/me/trip/offline-package` | Supabase JWT | — | `OfflinePackage` — trip kit for offline use | Driver | cached package with its age, or absent |
| — | GET | `/health`, `/ready` | none | — | liveness / readiness | platform | `/ready` 503 when DB or PostGIS is down |

**No client depends on a FastAPI-only endpoint for the demo workflow.** Auth,
trips, fleet, assignments, GPS and route selection all go to Supabase. If the
intelligence plane is down, accessibility reads `UNASSESSED` and every other
workflow keeps working — the property that makes hosting it a small risk.

---

## STEP 5 — CLIENT ORIGIN CONTRACT

Read from source. **No URL was hardcoded.**

| Client | Variable (actual name) | Currently |
| :--- | :--- | :--- |
| Manager | `VITE_INTELLIGENCE_BASE_URL` | **not set** in `.env.production` |
| Driver | `EXPO_PUBLIC_INTELLIGENCE_BASE_URL` | **not set** in `eas.json`, either profile |

Note the brief called these `..._API_ORIGIN`. The code says `..._BASE_URL`.

**Missing-value behaviour, verified rather than assumed.** `intelligence.ts`
evaluates `originProblem(RAW_BASE)` at module load; if unset or not a public
HTTPS origin, `BASE` becomes `''` and every call throws
`IntelligenceUnavailableError` *before any fetch is attempted*.
`routeRecommendation` catches it and returns `UNASSESSED`.

`localhost`, `127.0.0.1`, `::1`, `0.0.0.0` and empty are all rejected outright,
so **there is no localhost fallback in production** — a copied dev profile fails
rather than silently pointing a release at somebody's laptop.

Full table in **`docs/DEPLOYMENT_ENV_MATRIX.md`** (Step 6, written).

---

## STEP 7 — STAGING PLAN

### Stage (348 untracked + 74 modified)

| Group | Why |
| :--- | :--- |
| `backend/app/**`, `driver-app/src/**`, `manager-web/src/**`, `supabase/functions/**` | the application |
| `backend/tests/**`, `**/*.test.ts(x)`, `driver-app/vitest.config.ts` | the evidence; a suite that cannot run proves nothing |
| `supabase/migrations/**`, `backend/alembic/**`, `supabase/rollback/**` | schema history, including the atomic-route RPC |
| `backend/Dockerfile`, `backend/render.yaml`, `driver-app/eas.json`, `driver-app/app.config.js`, `driver-app/scripts/**`, `.easignore` | **without these Render cannot build anything** |
| `docs/**`, `design-system/**`, `CLAUDE.md`, `AGENTS.md` | the decision record |
| `backend/scripts/**`, `scripts/**` | operational tooling (RLS harness, demo seeding, verification) |

### Exclude (58)

| Group | Why |
| :--- | :--- |
| `.claude/**` (29) | this agent's own session state, caches, transcripts |
| `.artibot/**`, `.agentic-*`, `.agentops/**`, `.coworker/**`, `.context-os/**`, `.remember/**`, `.thumbgate/**`, `.semgrep/**`, `.codex/**` (8) | other agent tooling |
| `supabase/.temp/**` (9) | Supabase CLI cache |
| `full_user_request*.txt`, `latest_user_prompt*.txt`, `scratch_user_prompt.txt`, `mission_prompt_full_clean.txt` (6) | **prompt dumps — publishing these puts the whole working conversation in a public repo** |
| `memory/.dreams/events.jsonl` | agent tool output |

Already ignored, so not even candidates: `.runtime/**` (APKs, `pgpass.txt`),
every `.env`, `node_modules/`, `logs/`, `backend/.venv/`, `dist/`, `coverage/`.

### The commit I would make, if authorized

```
git add <the 348 + 74 above>          # explicit paths, never `git add -A`
git commit -m "SIH26002: hosted intelligence plane, Supabase auth, atomic route RPCs, UI pass"
git push origin main
git ls-remote origin main             # verify remote HEAD == the pushed commit
```

I would **not** run `git add -A`: it would sweep in 58 paths of agent state and
prompt dumps, and it is exactly the habit that puts a `.env` into a public repo
the one time `.gitignore` has a gap.

---

## STEP 8 — RELEASE GATE

| Suite | Result |
| :--- | :--- |
| **Backend** | **994 passed**, 5 skipped, 0 failed |
| **Manager** | **156 passed**, 0 failed |
| **Driver** | **517 passed** (514 + 3 AI fallback/exhaustion), 0 failed |
| Manager `tsc -b` | clean (exit 0) |
| Manager production build | clean |
| Driver `tsc --noEmit` | clean |

---

## STEP 9 — STOPPED AT AUTHORIZATION

```
READY_TO_COMMIT          = YES
SAFE_STAGING_SET         = 422   (348 untracked + 74 modified)
EXCLUDED_RUNTIME_FILES   = 58    (+ everything already gitignored)
SECRET_SCAN              = PASS  (0 real credentials in 360 files)
TESTS                    = backend 994 / manager 156 / driver 517
                           tsc -b clean · production build clean
```

**No `git add`, `git commit` or `git push` was run.** Nothing was reset,
cleaned, rebased or discarded. VC10 was not built. Nothing was deployed.

### Two decisions I need from you before publishing

1. **`.runtime/` is ignored only via `.git/info/exclude`**, which is not
   committed. Move it into the tracked `.gitignore` first?
2. **`netlify.toml` and `vercel.json` both exist** for the manager. Which one
   ships? Publishing both risks a second deployment without the intelligence
   origin.

### And the one after that

Even once this is pushed and Render is up, **VC10 must not be built until
`EXPO_PUBLIC_INTELLIGENCE_BASE_URL` is in `eas.json`.** A fresh install has no
cached package, so without it the driver has no source of route geometry at all.

---

# ADDENDUM — STATE CHANGED DURING THIS PASS

A commit was made **by something other than me** while this pre-flight was
running. I did not run `git add`, `git commit` or `git push` at any point.

```
HEAD        66f3008  "feat: ship hosted SIH26002 intelligence plane and navigation integration"
remote main f850de4  (committed, NOT pushed)
```

428 files, 84,704 insertions.

## The commit was audited against the exclusion list above: CLEAN

| Category | In the commit |
| :--- | :--- |
| `.claude/`, `.artibot/`, other agent tooling | **0** |
| prompt dumps (`full_user_request*`, `mission_prompt*`, …) | **0** |
| `.env` / `.env.*` | **0** |
| `.apk` / `.aab` | **0** |
| `.runtime/` | **0** |
| `memory/`, `supabase/.temp/` | **0** |

Whoever made it followed the exclusion list correctly.

## Secret scan re-run across the ENTIRE TRACKED TREE

That is the right question before a push — not just the working set.
464 tracked files, 17 credential-shaped matches, **all benign**:

| File | Type | Verdict |
| :--- | :--- | :--- |
| `driver-app/eas.json` ×2 | Supabase JWT | **SAFE — decoded, `role: anon`**, correct project ref. Anon keys are public by design and must be in the APK |
| `backend/.env.example` ×2 | Postgres URL | SAFE — `YOUR_PROJECT_REF` / `REPLACE_WITH_POOLER_HOST` templates, one commented out |
| `.github/workflows/migrations.yml` | Postgres URL | SAFE — throwaway CI service container on localhost |
| `backend/scripts/rls_harness.py` ×4, `test_select_route_rpc.py` ×2 | Postgres URL | SAFE — format placeholders |
| `backend/tests/conftest.py`, `test_config.py` ×2, `test_db_target_guard.py` | Postgres URL | SAFE — fixtures (`db.unreachable.invalid`, URL-parsing cases) |
| `scripts/Start-Demo.ps1` | Postgres URL | SAFE — PowerShell variable reading gitignored `.runtime/pgpass.txt` |
| `docs/DEPLOYMENT_ENV_MATRIX.md` | Postgres URL | SAFE — documentation placeholder |

Searched for and found **none of**: `sb_secret_*`, a `service_role` JWT, Google
`AIza…`, OpenRouter `sk-or-v1-…`, OpenAI-style keys, private key blocks, AWS
keys.

**SECRET_SCAN (tracked tree) = PASS. The commit is safe to push.**

The scanner now lives at **`scripts/secret_scan.py`** rather than a temp
directory, and exits non-zero on any UNSAFE finding — usable as a pre-push gate
rather than something someone has to remember to run.

## A silent deployment failure found and fixed

`manager-web/.env.production` is matched by `.gitignore` (`.env.*`), so a hosted
build never sees it — every `VITE_` value must come from the host dashboard.
**My earlier matrix said the production location was "repo". That was wrong.**

Acting on it produced a failure that was invisible:

- `SUPABASE_URL` fell back to a **hardcoded project URL**, which made the
  `if (!SUPABASE_URL) throw` beneath it **unreachable dead code**.
- The key fell back to the literal string `anon-placeholder`, so `createClient`
  succeeded, the app rendered, and every request returned 401. The reported
  symptom would be "login is broken", several layers from the cause.

The driver already fails closed here; the manager failing open was an
inconsistency, not a design. Both fallbacks are gone: `getSupabase()` now throws,
names the missing variable, and says the values belong in the hosting dashboard.
Pinned by **5 new tests** in `manager-web/src/api/supabaseClient.test.ts`,
including one asserting the placeholder key is never substituted again.

It throws **lazily rather than at build time**, deliberately — the manager also
supports a local FastAPI transport where Supabase is unused, and a build-time
check would forbid that valid configuration.

## A test that only passed by luck

`test_select_route_rpc.py` began erroring on all 18 cases. Cause: it invoked
`backend/.venv/Scripts/alembic.exe`, and that console script hardcodes the path
of the interpreter that created the venv — which for this checkout points at a
different machine's user profile. It now runs `sys.executable -m alembic`,
re-using the interpreter already running the suite. **18/18 restored.**

## Regression after all of the above

| Suite | Result |
| :--- | :--- |
| **Backend** | **1024 passed**, 5 skipped, 0 failed |
| **Manager** | **161 passed** (156 + 5 config), 0 failed |
| **Driver** | **537 passed**, 0 failed |
| Manager `tsc -b` | clean |
| Manager production build | clean |
| Driver `tsc --noEmit` | clean |
| Secret scan (tracked tree) | **PASS** |

One driver run showed a transient failure mid-pass; it did not reproduce, and
files were being rewritten by concurrent work at the time.

## STATUS

```
COMMITTED     = YES  (66f3008, not by me)
PUSHED        = NO   (remote still f850de4)
SECRET_SCAN   = PASS (464 tracked files, 0 unsafe)
EXCLUSIONS    = CLEAN (0 agent-state or prompt-dump files in the commit)
TESTS         = backend 1024 / manager 161 / driver 537
```

There are uncommitted changes on top of `66f3008` from this pass — the
fail-closed Supabase client and its tests, the alembic fix,
`scripts/secret_scan.py`, and this document. They need a second commit before
the push.

**Still unanswered, and still blocking a correct deploy:**

1. **`.runtime/` is ignored only via `.git/info/exclude`**, which is not
   committed. Anyone cloning this repo and recreating that directory gets no
   protection for `pgpass.txt` or the built APKs.
2. **`netlify.toml` and `vercel.json` are both committed.** The env matrix now
   names Vercel canonical — delete the other, or the manager can be deployed
   twice with only one carrying `VITE_INTELLIGENCE_BASE_URL`.
3. **VC10 must not be built** until `EXPO_PUBLIC_INTELLIGENCE_BASE_URL` exists
   in `eas.json`.
