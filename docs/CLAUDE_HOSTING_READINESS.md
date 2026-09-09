# HOSTED INTELLIGENCE PLANE — READINESS AND THE REAL BLOCKER

Continues `CLAUDE_ATOMICITY_PASS.md`. Nothing committed, pushed, or deployed in
this pass.

---

## THE BLOCKER IS NOT THE HOSTING ACCOUNT

This has been recorded as "FastAPI hosting blocked by hosting account / user
action" for several passes. That is not what is blocking it.

```
git ls-remote origin main  ->  f850de456d03
git rev-parse HEAD         ->  f850de456d03
```

**GitHub's `main` is byte-identical to the P7 baseline.** Everything since —
**77 modified files, 205 untracked paths, 14,256 insertions** — exists only in
this working tree.

Deploy-critical files that are **not on GitHub at all**:

| File | Git status |
| :--- | :--- |
| `backend/Dockerfile` | untracked |
| `backend/render.yaml` | untracked |
| `backend/app/auth/verifier.py` | modified, uncommitted |
| `supabase/migrations/20260909100000_manager_select_route.sql` | untracked |

Render deploys **from GitHub**. A Blueprint pointed at that repository today
would build commit `f850de4`, which has no Dockerfile, no `render.yaml`, and no
Supabase JWT verifier. It would fail at build, or — worse — succeed at
deploying the wrong application.

**So the human gate is: commit and push, then deploy.** I have been instructed
not to commit or push in every prompt of this project, so I have not. This is
the one thing standing between the current state and a hosted intelligence
plane.

---

## PHASE 1 — DEPLOYMENT READINESS: PASS

The artifacts are already correct. I verified rather than assumed.

| Check | Result |
| :--- | :--- |
| `backend/Dockerfile` | present, python:3.11-slim, non-root uid 10001, `$PORT` honoured, single worker (pool sized for Supabase's session pooler) |
| `backend/render.yaml` | present, docker runtime, region singapore, plan free |
| **Health endpoint** | **`/health` → 200.** `/ready` → 200. **`/api/health` → 404** — that was the wrong assumption; the system router is mounted at root while application routers are under `/api` |
| `healthCheckPath` in render.yaml | already `/health`, and the file explains why not `/ready` (a Supabase blip would make the platform kill a healthy process) |
| Env var names | **every** var in `render.yaml` matches a real `Settings` field — no silent mismatch |
| `/docs`, `/openapi.json` | already gated to `is_development`; `APP_ENV=production` closes them |
| CORS | `CORS_ORIGINS` marked `sync: false`; comment correctly notes the APK is native and not subject to CORS |
| Secrets in the descriptor | none — `DATABASE_URL`, `SECRET_KEY`, `CORS_ORIGINS`, `GEMINI_API_KEY` are all `sync: false` |

### One thing I checked because it would have failed *after* deployment

`AUTH_PROVIDER=supabase` verifies tokens against the project JWKS. The anon key
is a **legacy HS256** JWT, and the verifier deliberately rejects symmetric
algorithms — so if the project were still on legacy signing there would be no
usable JWKS and hosted auth would fail on the first request.

```
GET https://znaveeefzgfxsblsobdb.supabase.co/auth/v1/.well-known/jwks.json
-> HTTP 200   {"keys":[{"alg":"ES256","kty":"EC","kid":"37ceb9c4-…"}]}
```

Asymmetric signing is enabled, and the URL is exactly what the verifier builds
from `SUPABASE_URL` (`{base}/auth/v1/.well-known/jwks.json`). **Hosted auth will
work.**

Residual risk to check after deploying, not assumable now: if the project has
both legacy HS256 and ES256 active, any token still issued HS256 would be
refused. I cannot test that without a real user session, and I do not enter
passwords.

---

## PHASE 2 — MINIMAL HOSTED SURFACE

The clients call **exactly four** intelligence endpoints. Everything else on the
hosted service is unused by production clients.

| Endpoint | Caller | Verdict |
| :--- | :--- | :--- |
| `GET /api/trips/{id}/routes/recommendation` | Manager | **REQUIRED** |
| `POST /api/trips/{id}/reroute` | Manager | **REQUIRED** |
| `GET /api/driver/me/trip/navigation` | Driver | **REQUIRED** — fresh-install navigation |
| `GET /api/driver/me/trip/offline-package` | Driver | **REQUIRED** — offline trip kit |
| `/health`, `/ready` | platform | REQUIRED (unauthenticated by design) |
| everything else (auth, drivers, trucks, assignments, shipments, fleet, GPS) | nobody | **UNUSED in production** — Supabase serves these |

The image deliberately serves the whole application rather than a cut-down
build, and the Dockerfile explains why: the value of hosting it is that the code
with a passing test suite behind it is the code answering a judge's questions.
The unused routes are reachable but require a valid Supabase session and are
authorised from our own `users` table.

---

## PHASE 3 — AUTH: PASS (17/17)

`backend/tests/test_supabase_verifier.py`, all passing, covers every case the
brief asked for and several it did not:

| Required | Covered by |
| :--- | :--- |
| valid Supabase JWT accepted | `test_a_valid_supabase_token_yields_its_subject` |
| expired denied | `test_an_expired_token` |
| unknown kid denied | `test_an_unknown_kid_is_a_bad_token_not_an_outage` |
| HS256 confusion denied | `test_hs256_signed_with_the_public_key` |
| anonymous denied | `test_a_token_with_no_subject`, `alg_none` |

Beyond the brief: a **forged `role: admin` claim does not become our role**
(`test_a_forged_admin_role_claim_does_not_become_an_admin_claim`), tokens from
another Supabase project, wrong audience, and — the subtle one — an unreachable
JWKS endpoint is reported as a **verifier outage, not an invalid token**, so a
JWKS blip does not read as "your session is bad".

No second auth system was created. Supabase says *who*; our `users` table says
*what*.

---

## PHASE 6 — TWO CONFIG GAPS THAT WOULD BREAK VC10

Neither client currently carries an intelligence origin:

| File | Missing |
| :--- | :--- |
| `manager-web/.env.production` | `VITE_INTELLIGENCE_BASE_URL` |
| `driver-app/eas.json` (both profiles) | `EXPO_PUBLIC_INTELLIGENCE_BASE_URL` |

For the manager this is merely honest degradation — accessibility renders
`UNASSESSED` / `null`, which the comparison UI already models.

**For the driver it is fatal to Phase 8.** A VC10 built today would ship with no
intelligence origin, so a fresh install with no cached package has nowhere to
fetch a NavigationPackage from. **Do not build VC10 before this line exists.**

Note the variable name: the brief says `..._API_ORIGIN`, the code says
**`..._BASE_URL`**. The code is what matters.

Both clients already refuse a non-public-HTTPS origin (`assertHostedOrigin`
rejects localhost, `127.0.0.1`, `::1`, `0.0.0.0`), so a copy-paste error fails
the build rather than the demo.

---

## PHASE 11 — AI STATUS TRUTH: FIXED

The P2 honesty bug is closed. `available` was computed from **key presence**, so
with both provider quotas spent the hosted function reported `available: true`
while every answer came from the offline assistant.

New contract, with five states as the brief specified:

| State | Meaning |
| :--- | :--- |
| `OFFLINE` | no provider key configured at all |
| `CONFIGURED` | a key exists, nothing attempted yet in this isolate |
| `USABLE` | the last attempt produced a real generated answer |
| `QUOTA_EXHAUSTED` | the last attempt was refused for quota |
| `FALLBACK` | the primary failed and the backup engine answered |

`available` is now true only for `USABLE` and `FALLBACK`. Outcomes are recorded
at four call sites from what the providers actually did.

**Honest about its own limits:** the record is per-isolate and Edge isolates are
ephemeral, so a cold isolate answers `CONFIGURED` rather than claiming knowledge
it does not have. It is deliberately **not** a live health probe on GET —
spending a request against a rate-limited free tier to discover it is
rate-limited makes the problem worse.

Also fixed: the POST `mode:'status'` path was a **second, different
implementation** that ignored `openRouterKey` entirely, so a backup-only
deployment reported offline on POST and online on GET. One source of truth now,
pinned by a test.

**+4 driver tests. Not deployed** — that is a shared production change and I do
not have authorisation for it in this pass. The core SIH demo is independent of
generative AI, so this is not on the critical path.

---

## PHASE 12 — RPC ACL: RECORDED AS DEBT, NOT CHANGED

Every RPC on the project carries `anon=X/postgres`, from Supabase's
`ALTER DEFAULT PRIVILEGES` — `revoke all … from public` does not remove it,
because `PUBLIC` and the explicit `anon` grant are different things.

**Not exploitable.** Verified live against hosted: anon receives **HTTP 401
"permission denied for schema app"** — the invoker wrapper cannot reach schema
`app`, so execution stops before the function body.

**Deliberately not changed before the demo.** It affects all six RPCs, not the
two this work added, and destabilising the whole permission surface days before
a demo to fix a hole that is already closed by a second mechanism is a bad
trade. Post-demo: explicit `revoke execute … from anon` across the RPC surface
plus a default-privileges fix.

---

## PHASE 13 — FULL REGRESSION

| Suite | Result |
| :--- | :--- |
| **Backend** | **994 passed**, 5 skipped, 0 failed |
| **Manager** | **156 passed**, 0 failed |
| **Driver** | **514 passed** (510 + 4 AI-status), 0 failed |
| Manager `tsc -b` | clean |
| Driver `tsc --noEmit` | clean (single tsconfig — not a references stub) |
| Manager production build | clean |
| Supabase verifier | 17/17 |
| Atomic RPC suite | 18/18 |

No regression. No test weakened.

---

## FINAL REPORT

| Gate | Verdict |
| :--- | :--- |
| FASTAPI_HOSTED | **NO** — blocked on commit+push, see below |
| HOSTED_HEALTH | **NOT TESTABLE YET** — `/health` proven 200 locally; `healthCheckPath` already correct |
| SUPABASE_AUTH_ON_FASTAPI | **PASS (proven offline)** — 17/17, and the project's ES256 JWKS is live at the exact URL the verifier builds |
| REAL_ROUTING | **PASS (provider level)** — live OSRM verified previously; not yet through a hosted service |
| REAL_WEATHER | **NOT TESTABLE YET** — needs the hosted plane |
| LANDSLIDE | **SOURCE_BACKED**, scored; not reachable by clients until hosted |
| FLOOD | **UNAVAILABLE** — not implemented, declared as such |
| ACCESSIBILITY_HOSTED | **FAIL** — UNASSESSED by design while unhosted |
| UNKNOWN_SEMANTICS | **PASS locally** (23/23); **not yet re-proven through the hosted path** |
| FRESH_INSTALL_NAV_PACKAGE | **BLOCKED** — needs hosting *and* the missing `EXPO_PUBLIC_INTELLIGENCE_BASE_URL` |
| MANAGER_ROUTE_SELECTION | **PASS** — atomic, deployed, anon refused |
| ATOMIC_REROUTE | **PASS** — atomic, deployed, anon refused |
| MANAGER_DRIVER_CONVERGENCE | **PASS at the state layer**; end-to-end unproven without hosting |
| 9_MANAGER_CONTROLS | working 0 · **disabled-with-reason 8** · removed 0 · honest-error 1 · **broken 0** |
| BACKEND | **994** / 5 skipped |
| MANAGER | **156** |
| DRIVER | **514** |
| VC10_BUILT | **NO** — deliberately blocked on the missing driver intelligence origin |
| PHYSICAL_ANDROID_CERTIFIED | **NO** |
| **DEMO_READY** | **NO** |

---

## WHAT YOU NEED TO DO — EXACT STEPS

### Step 1 — Get the code onto GitHub (the actual blocker)

Nothing else can proceed until this happens. From `D:\Projects\ner-ai-logistics`:

```bash
git add -A
git commit -m "Hosted intelligence plane, Supabase auth, atomic route RPCs, UI pass"
git push origin main
```

Review `git status` first if you want — it is 77 modified files and 205 new
paths. **I have not run any of this**, per your standing instruction.

### Step 2 — Render

1. Render → **New** → **Blueprint**
2. Connect `nxtlucifer/ner-ai-logistics`
3. Render reads `backend/render.yaml` — root directory **`backend`**, runtime
   **Docker**, health check path **`/health`** (already set)
4. Fill the four dashboard values marked `sync: false`:
   - `DATABASE_URL` — the Supabase **session pooler** connection string
     (port 5432 pooler, not the direct 6543 one; the pool is sized 3+2 for it)
   - `SECRET_KEY` — any strong random value; it must not be the `.env.example`
     placeholder or the app refuses to start with `APP_ENV=production`
   - `CORS_ORIGINS` — the manager web origin only
   - `GEMINI_API_KEY` — **leave unset**; the driver assistant uses the
     `gemini-ai` Edge Function, which already holds the key server-side
5. Deploy, then confirm `https://<service>.onrender.com/health` returns
   `{"status":"ok"}` and `/ready` returns `"status":"ready"`

### Step 3 — Tell me the URL

I then add the two missing lines, re-run everything, and drive the hosted path:

```
manager-web/.env.production   VITE_INTELLIGENCE_BASE_URL=https://<service>.onrender.com
driver-app/eas.json           EXPO_PUBLIC_INTELLIGENCE_BASE_URL=https://<service>.onrender.com
```

Only then are Phases 7–9 (real accessibility E2E, fresh-install navigation,
cross-client E2E) testable, and only then is VC10 worth building.

### A caution about Render free tier

Free instances sleep after inactivity and cold-start in tens of seconds. For a
live demo, either keep it warm with a ping shortly beforehand, or accept a slow
first accessibility analysis. Worth knowing before it happens on stage.
