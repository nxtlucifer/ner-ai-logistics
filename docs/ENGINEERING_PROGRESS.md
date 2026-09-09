# Engineering Progress

Rolling record of the core-intelligence build. Newest entry first.
No secrets, no connection strings, no keys.

---

## 2026-09-05 — LS-8: both clients on one backend, and the stale-decision test

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · shared Supabase UNTOUCHED

### G1 — one API, two clients (verified on screen, not inferred)

| Surface | Startup | API origin | Auth | Updates |
|---|---|---|---|---|
| Manager website | `npm run dev` (vite, 5173) | `VITE_API_BASE_URL=http://localhost:8000` | project's own JWT + refresh | polling (see G3) |
| Driver web | `npx expo start --web --port 8081` | `EXPO_PUBLIC_API_BASE_URL`, else `http://<expo host>:8000` | SEPARATE driver session | on load / action |
| Driver native | not runnable | resolver would use the Expo LAN host | same | — |
| Desktop | NOT_IMPLEMENTED | — | — | — |

Both resolved to **the same isolated FastAPI on :8000**, and the driver app
prints its base URL on the sign-in screen - `http://localhost:8000` - so this
was read off the running app rather than inferred from config.

Different origins (5173 vs 8081) means the two sessions cannot collide in
storage. The database stayed bound to loopback; only the API is reachable, and
no client holds a connection string.

**A point worth writing into the handoff:** hosting Supabase does NOT host this
system. The clients talk to a FastAPI service that must itself be running and
reachable; Supabase is only where that service keeps its data. On a physical
phone `localhost` means the phone, which is why the driver resolver falls back
to the Expo host rather than a hardcoded loopback address.

### G2 — one linked trip, seen from both sides

Seeded through the project's own `tests.factories` (so the rows match what the
suite creates rather than hand-rolled inserts):

    trip_code    TTEST-60289233EF
    truck        AS27ZZ0320
    driver       Bipul Das / ASB90972C5BC8E

**Manager website** (signed in through the real form): Trips page lists
`TTEST-60289233EF | Bipul Das | AS27ZZ0320 | ASSIGNED`.

**Driver web** (signed in separately, by phone number): shows the SAME
`TTEST-60289233EF`, `AS27ZZ0320`, ASSIGNED, "Dispatched 2 min ago", both stops,
a Start trip action, and the honest "Your location is not being shared."

Two independent authenticated sessions, one backend, one database, identical
identifiers. Screenshots captured for both.

### What was NOT demonstrated through the UI, and why

Closure refusal was **not** driven through the running website. Injecting a
hazard scenario into the LIVE server would need a simulation hook the
architecture deliberately does not have, and the mission forbids adding one.
Closure enforcement is instead proven at real-HTTP level by
`tests/test_route_selection_hazard_api.py` (5 tests, real auth, real PostGIS,
real transaction, 422 `ROUTE_REJECTED_ACTIVE_HAZARD`, persisted state re-read).
That is a weaker claim than a UI demo and is stated as such.

### G4 — the deterministic stale-decision test, finally written

`tests/test_stale_selection_interleaving.py`.

`select_route` computes eligibility OUTSIDE the transaction, which is correct -
provider I/O must not be held across a row lock - and that creates a real
window. The test proves the mutation revalidates under the lock:

1. Request A assesses an eligible route.
2. A pauses on an explicit `asyncio.Event` between assessment and mutation.
3. A SEPARATE session supersedes the route and commits.
4. A resumes.
5. Refused with `ROUTE_SUPERSEDED`; a FRESH session confirms
   `selected_route_id` unchanged.

No sleeps, no patched guard, no forced decision - the barrier controls WHEN the
real code runs, never WHAT it decides.

**A defect in my own first version, worth recording.** I gave request A the
test's existing session, and it reached the audit write instead of being
refused: SQLAlchemy's identity map handed back a cached `TripRoute` still
holding its pre-supersede state, so the revalidation had nothing stale to
catch. The test would have "passed" the wrong thing had the actor been valid.
Fixed by giving request A its OWN session, which is what a real HTTP request
gets.

**What it does not prove:** exactly one application-owned state change - a
superseded route. It says nothing about freshness of the EXTERNAL hazard
evidence, and nothing can: no local transaction is atomic with a remote
authority, and recording a timestamp would not change that. The honest
guarantee is *application-owned route lifecycle is revalidated under the lock*.

### G5 — provenance wording corrected

An earlier entry said the downloaded archives "matched the advertised
Content-Length exactly", which implied integrity verification. **It does not.**
Content-Length proves transfer completeness - the download was not truncated -
and nothing about authenticity. No checksum or signature was verified. Both
archives came over HTTPS from the official project download paths
(`get.enterprisedb.com` via postgresql.org, `download.osgeo.org` via
postgis.net); that is the provenance claim, and the only one supported. The
progress entry now says so.

### Full suite after these changes

    793 passed, 5 skipped, 2 failed in 1m45s (isolated target)

The 2 failures are the SAME environmental pair as LS-7, unchanged and
un-weakened: `spatial_ref_sys` RLS (vanilla PostGIS puts it in `public`), and
`test_config::TestLocalProvider`, which passes in a clean environment and fails
only because env-var arming satisfies the condition it asserts is absent.

### Still open

- `spatial_ref_sys` RLS and the `test_config` env-inheritance finding are
  unchanged from LS-7; both remain classified environmental and neither test
  was weakened.
- Cross-app update latency (G3) was not measured this loop.
- Driver native: no adb, no emulator. Desktop: NOT_IMPLEMENTED.

## 2026-09-05 — LS-7: an isolated cluster, and the live HTTP proof at last

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · shared Supabase UNTOUCHED

### G1 — the isolated runtime exists

Built as a normal user, no admin, no service, no Docker, no WSL.

    PostgreSQL   18.2 (official Windows x86-64 binaries ZIP from
                 get.enterprisedb.com, linked from postgresql.org/download/windows,
                 337,822,057 bytes)
    PostGIS      3.6 (postgis-bundle-pg18-3.6.2x64.zip from
                 download.osgeo.org, linked from postgis.net released_versions,
                 124,037,332 bytes) - GEOS 3.14.1, PROJ 8.2.1

    CORRECTION (LS-8): an earlier draft said the byte counts "matched the
    advertised Content-Length exactly", implying integrity verification. They
    do not. Content-Length proves TRANSFER COMPLETENESS only - that the
    download was not truncated - and says nothing about authenticity. No
    published checksum or signature was verified for either archive. Both came
    over HTTPS from the official project download paths, which is the actual
    provenance claim and the only one supported.
    cluster      D:/Projects/ner-ai-logistics/.runtime/data
    listen       127.0.0.1:55432 ONLY
    auth         scram-sha-256, generated password, NO trust anywhere
    database     ner_logistics_test, user ner_test
    migrations   the repo's own alembic chain, 0001..0006, applied clean
                 (the pending road-memory SQL was NOT promoted)

Everything lives under `.runtime/`, excluded via `.git/info/exclude`. 2.0 GB of
binaries and data, and `git status` shows **zero** runtime paths.

**Two setup defects, both mine, both diagnosed rather than guessed:**

1. `bin/` copied only partially because the RUNNING server held
   `libcrypto-3-x64.dll`, so `postgis-3.dll` could not resolve GEOS/PROJ/GDAL.
   Fixed by stopping the server, copying, restarting.
2. I invoked `uvicorn` directly and every database call failed with an
   `InterfaceError`. The project's own `run.py` docstring warns about exactly
   this: uvicorn creates its event loop before importing the app, so the
   Windows selector-policy fix cannot take effect. Used `run.py`.

Isolation is armed by PROCESS environment variables through the project's OWN
`DATABASE_PROVIDER=local` mode - which already validates the host is local.
`backend/.env` was never read from, written to, or modified.

### G2 — the UNKNOWN policy is resolved, and it costs something

Three previous missions asked for UNKNOWN to become REQUIRES_REVIEW and I
declined, arguing it would make every route review-required forever. This
mission supplied the missing distinction and the argument no longer holds:

**required safety evidence** vs **optional roadmap factors**. Six of the seven
unavailable factors (flood, road quality, truck restrictions, historical
incidents, elevation, fuel) are roadmap items nothing ever supplied. Exactly
one - **landslide** - is required. Gating on the six would be gating on
features that were never built; gating on landslide is the point of the system.

So `REQUIRED_EVIDENCE = {"landslide"}` and:

    CRITICAL  -> REJECTED
    HIGH      -> REQUIRES_REVIEW
    UNKNOWN   -> REQUIRES_REVIEW   (changed)
    CAUTION   -> ELIGIBLE
    LOW       -> ELIGIBLE
    None      -> REQUIRES_REVIEW   (changed - absence is not permission)

`refuse_if_ineligible` now refuses REQUIRES_REVIEW too, with its own code,
because no audited acknowledgement mechanism exists and treating a manager's
click AS the review would be an unaudited bypass with no rationale, no actor
binding and no evidence version.

**The cost, stated plainly:** with no hazard source configured, every route is
UNKNOWN, so nothing is automatically recommended and nothing can be selected.
That is the honest consequence of the policy, not a bug. Tests supply a
labelled sufficient-evidence fixture for the happy path.

### G3 — the live HTTP proof

`tests/test_route_selection_hazard_api.py`, **5 tests**, real HTTP through the
ASGI app against real PostGIS:

    closed route selected     -> 422 ROUTE_REJECTED_ACTIVE_HAZARD
    unknown evidence          -> 422 ROUTE_SELECTION_REQUIRES_REVIEW
    forged body flags         -> 422, still refused
    anonymous caller          -> 401, and no hazard detail leaked
    eligible route            -> 200, selected_route_id persisted

Real login, real bearer token, real permission dependency, real trip and routes
in PostGIS, real geometry read, real transaction. **Only the landslide provider
is injected**, at the seam a real source would occupy. The guard is not patched.

Persisted state is READ BACK after each refusal - `selected_route_id` and every
route's lifecycle - because a non-2xx response proves nothing about the
database.

**A test-fixture defect worth recording:** the first version scattered a
0.5-degree lattice (~55 km spacing) of synthetic closures across the region and
the tests passed with **200 OK** - nothing landed inside the 5 km on-route
buffer. A hazard fixture has to be built FROM the route, not near it. Rebuilt
using the same `sample_positions` the service uses.

I also asserted 409 and a flat `{"code": ...}` body. Both wrong: this project
maps BusinessRuleError to **422** with `{"error": {"code": ...}}`. Corrected
against the real contract rather than bending the app to my assumption.

### A real integration gap the isolated database exposed

`route_recommendation._risk_for` called `assess()` **without** `landslide=`, so
every recommendation candidate carried `landslide=None`. Harmless while UNKNOWN
was eligible; once landslide became required evidence it meant the endpoint
recommended nothing. LS-3 wired `assess_route` and missed this second
assessment path. Fixed.

### Full backend suite, on the isolated target

    792 passed, 2 failed, 5 skipped in 1m45s

Against Supabase the same suite took **26 minutes**; locally it is 15x faster.

The 2 failures are ENVIRONMENTAL and neither test was weakened:

1. `test_domain_integrity::TestRowLevelSecurity` - `spatial_ref_sys` from
   vanilla PostGIS sits in `public` without RLS. The managed target handles
   this. The test correctly guards production and must stay.
2. `test_config::TestLocalProvider::test_local_mode_requires_local_url` -
   **passes in a clean environment**; it fails only because arming the target
   via `LOCAL_DATABASE_URL` satisfies the very condition it asserts is absent.
   Harness interaction, not an application defect.

### G4 — the manager website, on the real isolated backend

Backend `/ready` returned:

    {"status":"ready","provider":"local","checks":{
      "database":{"ok":true,"detail":"PostgreSQL 18.2"},
      "postgis":{"ok":true,"detail":"3.6 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"}}}

Signed in through the REAL login form (native value setter + `requestSubmit`,
so React's own handlers ran):

    POST /api/auth/login  -> 200
    GET  /api/auth/me     -> 200

Fleet page rendered with live data from the isolated database, header showing
"LS-7 Synthetic Manager", map tiles loaded. The only console errors are the
pre-login `auth/refresh` 401s, which are expected.

The synthetic manager's password is a deliberately self-describing NON-secret
fixture value in a throwaway database, so nothing sensitive transited a tool
call.

### Surfaces

    WEBSITE_REAL_BACKEND     PASS - authenticated, real backend, real PostGIS
    DRIVER_WEB_REAL_BACKEND  NOT RUN this loop (prior render evidence 00:50)
    DRIVER_NATIVE            BLOCKED - no adb, no emulator, no device
    DESKTOP_APP              NOT_FOUND - re-checked, no Electron/Tauri/PWA

### Stop and cleanup

    backend       stop the `run.py` process (port 8000)
    manager-web   stop the vite dev server (port 5173)
    database      .runtime\pg\pgsql\bin\pg_ctl.exe -D .runtime\data -m fast stop
    remove all    delete .runtime\  (2.0 GB; binaries, cluster, credentials)

Nothing in `.runtime/` is tracked. The shared Supabase database was not read
from or written to at any point in this mission.

## 2026-09-05 — LS-6: the live path is proven to reach the guard

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

### Phase A — environment discovery, done once, definitively

    docker / psql / pg_isready        ABSENT
    wsl -l -q                         NO distros
    C:\Program Files\PostgreSQL\*     does not exist
    initdb.exe (C:\ depth 4)          not found
    services matching postgre|pgsql   none
    listening 5432-5435               nothing

There is **no PostgreSQL on this machine at all** - not stopped, not
unregistered, not off PATH. `docker-compose.yml` pins `postgis/postgis:18-3.6`
and there is no Docker to run it.

**But the local route IS viable**, which the previous session had not
established. PostGIS publishes **3.6.2 Windows bundles for PostgreSQL 14-18**,
and the `.zip` form is explicitly "just the binaries you can copy into your
PostgreSQL installation" - no installer, no admin. Combined with PostgreSQL's
own Windows binary ZIP, a project-local, normal-user cluster is buildable.
That is now the ONE prepared setup action rather than a guess.

### Phase C — what was actually proven without a database

`tests/test_selection_enforcement_contract.py`, **9 tests**. These run the
REAL `routes.select_route`, REAL `reroute.accept`, REAL
`route_risk.eligibility_for_route`, REAL `route_eligibility.evaluate` and REAL
`refuse_if_ineligible`. The scenario enters through the **provider interface** -
the same seam a live hazard source would occupy - not by monkeypatching the
guard, which would only have proven the guard works, a thing already known.

The design trick that makes it evidence rather than theatre: **the session
explodes.** `ExplodingSession.execute` raises. So a refusal that arrives
before any database work surfaces as `BusinessRuleError`, and a refusal that
arrives late surfaces as the session's own error. The test cannot pass by
accident.

Proven:

    select_route + official closure     -> ROUTE_REJECTED_ACTIVE_HAZARD,
                                           raised BEFORE any DB access
    reroute accept + official closure   -> same, before the trip lock
    assessment raises                   -> ROUTE_ELIGIBILITY_NOT_ASSESSED
                                           (refused, not allowed)
    provider down / clear source        -> passes the guard, reaches the DB
    select_route signature              -> no `eligibility` parameter exists,
                                           so no caller can assert clearance
    apply_selection signature           -> `eligibility` has NO default

### LS-6a — a real ordering defect, found by the test premise being wrong

I had asserted from a grep that `accept` did no database work before computing
eligibility. The test disagreed: **"database was touched before the route was
refused."**

Root cause: `accept` computed the decision early, but `refuse_if_ineligible`
only ran downstream inside `apply_selection` - which happens AFTER
`trip_service.load_for_update` has locked the trip and after the
selected-route checks. So a closed target still took a row lock and did read
work that could never be used.

Fix: refuse immediately after computing, before the lock. Not a security hole
(it did refuse), but the mission's requirement is that evidence is obtained and
acted on before locks, and it was not.

Also corrected: `accept`'s docstring still said **"No risk assessment runs
here"**, which the LS-5 edit had made false. It now distinguishes the two
honestly - no risk SCORE is recomputed (a manager may overrule a score), but
ELIGIBILITY is re-established at the moment of mutation, because nobody may
move a truck onto a road an authority has closed.

### Tests

    contract (live path)                   9 PASS
    pure regression                      171 PASS  2m40s
      route_eligibility, selection_enforcement_contract,
      route_recommendation, route_risk, landslide_provider,
      landslide_route_risk, monsoon_risk, road_memory,
      reason_code_coverage, reroute

### What is STILL not proven - the honest boundary

The contract tests do **not** establish: HTTP status codes, authentication,
PostGIS geometry, persistence, row locking, transaction rollback, or
serialization. No API-level suite was run, because no isolated database exists
and mission rule 5 forbids writing to the shared one.

So: **the live service path is proven to reach and obey the guard. The live
HTTP path is not.** Those are different claims and only the first is made.

### Surfaces

    WEBSITE_REAL_BACKEND      BLOCKED - needs isolated DB + synthetic account
    DRIVER_WEB_REAL_BACKEND   BLOCKED - same
    DRIVER_NATIVE             BLOCKED - no adb, no emulator; note that absence
                              of android/ is NOT proof native is impossible
                              (Expo generates it), but no device/tooling exists
    DESKTOP_APP               NOT_FOUND - re-checked, no Electron/Tauri/PWA
    UI_FIXTURE_ONLY           prior driver-web render evidence (00:50) stands

### Policy still unresolved

UNKNOWN remains ELIGIBLE. LS-4/5/6 all requested it become REQUIRES_REVIEW.
The reasoning for deviating is recorded in `route_eligibility.py` and has not
changed: landslide is UNKNOWN on every route and six other factors are
permanently unavailable, so gating on unknown evidence would make every route
review-required forever. Implementing the review flow properly needs an
audited acknowledgement bound to route+evidence version, which needs schema
work that is not authorized. **Recorded as unresolved rather than silently
kept.**

## 2026-09-05 — LS-5: the guard stops being optional

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

### The defect LS-4 left, stated exactly

`refuse_if_ineligible(decision)` accepted `decision=None` and returned quietly.
Every live caller passed `None`. So the guard existed, was tested, and
**enforced nothing on any real path**. An LS-4 test even asserted that
behaviour was correct - it encoded the hole.

### What changed

**A missing decision now REFUSES.** `decision=None` and
`Eligibility.NOT_ASSESSED` both raise `ROUTE_ELIGIBILITY_NOT_ASSESSED`.
Absence of an assessment is an integration failure in this application, and
the safe answer to "did anyone check?" being "no" is to refuse.

**`NOT_ASSESSED` is a distinct state from assessed-UNKNOWN**, which the mission
required be distinguishable:

    "we asked, the hazard is UNKNOWN"   -> supported domain result, permits the mutation
    "we never managed to ask"           -> integration failure, refuses it

**`apply_selection(eligibility=...)` is now a REQUIRED argument.** No default,
so a future caller cannot omit it silently - the failure becomes a TypeError at
the call site rather than a permitted mutation at runtime.

**Both live mutation paths now compute it**, server-side:
- `routes.select_route` (reached by `POST /trips/{id}/routes/{id}/select`)
- `reroute` acceptance

Both call `route_risk.eligibility_for_route(db, route_id)` - the canonical
function - **before** taking the trip row lock, because assessment is provider
I/O and holding a lock across somebody else's server is the cost `route_risk`
already avoids. The evidence comes from the route's own persisted geometry;
there is no parameter through which a client could assert its own eligibility.

A failed assessment returns `not_assessed()`, which refuses. That is the exact
inversion of the old default.

### A test was reversed, and that is the point

`test_an_unassessed_route_is_not_blocked` asserted a missing decision was
allowed. It is now `test_a_missing_decision_is_refused_not_allowed`. This is a
STRENGTHENING, not a weakened assertion: the behaviour deliberately inverted,
so the test that pinned the old behaviour had to invert with it. A second test
pins the UNKNOWN-vs-NOT_ASSESSED distinction so they cannot collapse later.

### Reason-code chain (LS-1 checklist)

`ROUTE_ELIGIBILITY_NOT_ASSESSED` -> module already in the coverage allowlist ->
en/hi/as -> all three mirrors byte-identical. 61 codes, 17 spoken (cap 20).
Wording says explicitly that it is a system fault, **not a clear road**.

### Tests

    backend PURE regression      146 PASS  1m48s
      route_eligibility(12), route_recommendation, route_risk,
      landslide_provider, landslide_route_risk, monsoon_risk,
      road_memory, reason_code_coverage
    manager-web                   64 PASS · tsc clean · build OK
    driver-app                   160 PASS · tsc clean

### What is NOT proven, and why - this matters more than the above

**The live HTTP mutation path was NOT exercised.** The mission's own bar is
"do not call the API bypass closed until the real HTTP mutation path has
rejected the injected blocked route." That bar is **NOT met**.

Capability checks, all run this loop:

    docker            ABSENT
    psql / pg_isready ABSENT
    WSL distros       NONE
    adb               ABSENT
    driver-app/android ABSENT (managed Expo)
    electron/tauri/desktop manifests  NONE FOUND

`DATABASE_URL` resolves to the shared hosted Supabase pooler and **no isolated
test database can be created on this machine**. Mission rule 5 is explicit that
identifying the shared database is not authorization to write to it and that a
fixture prefix or suite lock does not make it isolated. So the API-level tests
(`test_route_risk_api`, `test_reroute_api`,
`test_route_recommendation_api`) were **deliberately not run this loop**, and
with them the end-to-end proof.

Consequence to be honest about: `select_route` and the reroute path were
changed and their API-level behaviour is **unverified**. The pure layer is
green; the HTTP layer is untested against these edits.

### Runtime surfaces

    WEBSITE              NOT VERIFIED this loop - authenticated workflows need a
                         manager credential against the shared DB; no isolated
                         env in which to create a test account.
    DRIVER_NATIVE        BLOCKED - no adb, no android/ directory, no emulator.
    DRIVER_WEB_FALLBACK  Previously verified (2026-09-05 00:50) - boots, screens
                         render, 320/375 px clean. NOT re-run this loop and it
                         does not certify native GPS or background behaviour.
    DESKTOP_APP          NOT_FOUND - no Electron, Tauri or desktop manifest
                         anywhere in the repository.

## 2026-09-05 — LS-4: eligibility becomes a refusal, not a penalty

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO
**DB target verified before any suite:** shared hosted Supabase pooler. No
migration applied, no shared account created, no destructive gate enabled.

### The correction that started this

An external review supplied a counterexample that disproves a claim implied by
LS-3:

    a closed route scoring   7 + 45 = 52
    beats
    an open route scoring    70

LS-3 made landslide severity contribute points, which fixed RANKING. It did not
make a closed road unusable, because **a penalty can always be out-voted by the
other components and a refusal cannot**. The review was right, and the fix is
architectural rather than numeric.

### G1 — reproduced first

`tests/test_route_eligibility.py`, red before any implementation:

    test_a_sole_closed_candidate_is_never_recommended   FAILED (returned 'r-a')
    test_every_candidate_closed_yields_no_safe_route    FAILED (returned 'r-a')

Note which test PASSED while red: `test_a_closed_shortcut_loses_to_a_longer_open_route`.
LS-3's scoring genuinely helps - it just cannot refuse. That is the distinction
the whole change rests on.

### What was built

`app/domain/route_eligibility.py` - ELIGIBLE / REQUIRES_REVIEW / REJECTED,
decided from hazard evidence and kept **separate from the score**. CRITICAL
rejects; HIGH requires review; CAUTION/LOW/UNKNOWN stay eligible.

`recommend()` now consults eligibility BEFORE ranking:
- rejected candidates are **removed**, not penalised;
- all rejected -> `NO_SAFE_ROUTE_AVAILABLE`, worded as "no usable route among
  those assessed" and deliberately NOT "every road in the region is shut",
  which would be a claim about a survey nobody performed;
- usable but nothing auto-selectable -> review-required, no route returned.

`app/services/routes.py::refuse_if_ineligible` - the server-side gate on the
mutation path. `apply_selection` previously checked only trip ownership and
SUPERSEDED state, so **a route with a validated active closure could be
selected directly through the API**, bypassing ranking entirely. A disabled
button in the manager UI is not a control. Refused BEFORE the row lock is
taken, because a hazard lookup is network I/O and holding a lock across it is
the rule `route_risk` already avoids.

### The design decision worth defending

Eligibility is **derived**, not passed. `RouteCandidate.decision` computes it
from the `RouteRisk` the candidate already carries.

The first implementation had callers supply it, and the red tests kept failing
because the fixture did not - which is exactly the bug that would reach
production. A gate that depends on every present and future call site
remembering an argument is a gate that will be bypassed silently by the next
one. So `RouteRisk` now carries its `LandslideAssessment` and eligibility falls
out of it wherever a risk travels.

### The UNKNOWN deviation, stated rather than hidden

The proposed policy said an UNKNOWN required hazard input should force
REQUIRES_REVIEW. This implementation deliberately does NOT, and the reasoning
is recorded in `route_eligibility.py`:

- no landslide source is configured, so landslide is UNKNOWN on EVERY route;
- six other factors are permanently unavailable in this build as well;
- so unknown-forces-review would make every route review-required forever, no
  route would ever be recommended, and the gate would carry no information.
  A control that fires on everything is one operators learn to click through.

UNKNOWN therefore stays ELIGIBLE, is reported through `unavailable_inputs`, and
still carries the non-zero uncertainty penalty from LS-3 so it can never tie
with a corridor that was checked and found clear. `REJECTING_BANDS` is the
single constant a deployment with real data tightens.

**Consequence today: this change alters no production behaviour.** No route is
ever CRITICAL because no provider exists. The gate is a safety net that arms
itself the moment data arrives.

### Defects found and fixed this loop

**LS-4a · APPLICATION_DEFECT · mine.** Adding `landslide` to `RouteRisk` as a
REQUIRED field broke **33 tests** with
`TypeError: RouteRisk.__init__() missing 1 required positional argument`.
Root cause: a required field on a widely-constructed dataclass is a
backward-incompatible contract change. Fixed by defaulting it to `None` and
moving it after the non-default fields. 187 green afterwards.

**LS-4b · caught by an existing guard.** Marking new codes `speak: true` pushed
the spoken set to 21 against a documented cap of 20
("a monologue, not an alert system"). Since this build has **no TTS at all**,
`speak: true` was claiming a capability that does not exist. The LS-4 outcomes
are manager decisions - a driver does not choose routes, and
`ROAD_DECLARED_CLOSED` already carries the driver-facing closure alert - so
they were set quiet. Spoken set back to 17.

### Reason-code chain completed (the LS-1 trap)

constant -> `app.domain.route_eligibility` registered in the coverage
allowlist -> en/hi/as translations -> **all three** mirrors synced
byte-identical (`i18n/`, driver-app, manager-web). 60 codes, 17 spoken.

### Tests

    tests/test_route_eligibility.py          11 PASS  (2 red first)
    LS-4 affected subsystem                 187 PASS  9m36s  exit 0
      route_risk, route_risk_api, recommendation(+api), reroute(+api),
      landslide_provider, landslide_route_risk, eligibility,
      reason_code_coverage, offline_package
    driver-app                              160 PASS / 13 files, tsc clean
    manager-web                              64 PASS /  6 files, tsc clean,
                                             lint 0 errors

### NOT done - do not read this as complete

- **No authenticated runtime proof.** G5 is not met; manager credential still
  missing.
- **Nothing computes eligibility on the live selection path yet.** The guard
  refuses a decision when one is supplied; `select_route` does not yet build
  one. So the API bypass is CLOSED IN THE SERVICE but not yet ARMED end to end.
- Reroute application does not yet pass a decision either.
- Manager/driver UI show no rejected/review state.
- Hazard-to-road matching still uses point-to-sampled-vertex distance; the
  review's simplified-geometry and parallel-road concerns are unaddressed.

## 2026-09-05 11:10 IST — LS-3: a CRITICAL corridor scored the same as a clear one

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

### What inspection found before any code was written

The next task was "make recommendation and reroute consume landslide risk".
Reading them first changed the task: `route_recommendation.py` **already**
consumes `RouteRisk` — candidates carry `risk: RouteRisk`, `_sort_key` ranks on
`risk.score`, and `unavailable_inputs` already propagates `landslide` upward,
so the data status was reaching a dispatcher.

The defect was one layer down, in my own step-1b work.

### LS-3 · APPLICATION_DEFECT · P1

**Symptom.** A corridor with an OFFICIAL road closure on it produced
`score=7, band=LOW` — **byte-identical to a clear corridor**.

**Root cause.** Step 1b wired the landslide DATA STATUS through to
`inputs[FACTOR_LANDSLIDE]` and appended reason codes, but **added no points**.
`route_recommendation._sort_key` ranks on `risk.score`. So a closed road and a
clear road were indistinguishable to the ranking, and the closed one won
whenever it happened to be quicker. Exactly the mission's own hostile-review
question: *can CRITICAL still win because it is shortest?*

It was invisible because every existing test either passed no landslide
argument at all or only asserted the availability flag — the flag was right,
the number was not.

**Red first.** Three tests, all failing, printing the identical `score=7` for
closed and clear. Then the fix. Then 22 green.

### The fix, and why the weights look the way they do

`LANDSLIDE_POINTS` — CRITICAL 45, HIGH 30, CAUTION 12, **UNKNOWN 5**, LOW 0.

**Ordered rather than large.** CRITICAL is the heaviest single contribution in
this engine, enough to outrank any plausible distance or duration saving, but
it is deliberately **not 100**. A score is an ordinal for comparing routes;
REFUSING a route is a different decision and belongs to recommendation policy,
not to a number that can lose a comparison narrowly. That is the same argument
`monsoon_risk` already makes about passability, and it is why rejection is the
NEXT task rather than part of this one.

**UNKNOWN is small and non-zero on purpose.** A corridor nobody checked must
not tie with one checked and found clear, or ranking silently prefers the
unexamined road whenever it is slightly quicker. But absence of data is not
evidence of danger either, so it must not approach the weight of a reported
incident. 5 points.

Note what that means today: every production route is UNKNOWN, so every route
gains the same 5 and **no ranking changes**. The penalty only bites once some
routes have data and others do not — which is precisely when it should.

### Tests

    tests/test_landslide_route_risk.py    22 PASS  (3 red first)
    scoring-change regression            127 PASS  2m02s
      route_risk, route_risk_api, route_recommendation, reroute,
      landslide_provider, landslide_route_risk, reason_code_coverage

No regression: existing callers that pass no landslide argument add no
component, and the API tests' assertions held.

### Still NOT implemented — do not blur this

`route_recommendation` now **ranks** landslide severity correctly, but it does
not yet **reject**. There is no `REJECTED` state, no `REQUIRES_REVIEW`, and no
`NO_SAFE_ROUTE_AVAILABLE`. A CRITICAL route can no longer win for being
shorter, but it can still be recommended if it is the only candidate. That is
the next task and it is written up as such.

Reroute consumption is likewise still only via the shared `risk.score`.

## 2026-09-05 10:45 IST — Step 1b: landslide becomes a computed result

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

### The gap that closed

`app/domain/route_risk.py` listed `FACTOR_LANDSLIDE` in `UNAVAILABLE_FACTORS`,
a tuple whose every member was stamped `NOT_AVAILABLE` by a loop. The value a
dispatcher saw was correct, but it was a **constant**, not a finding — nothing
had been asked and nothing could ever change it.

It is now computed end to end:

    assess_route
      -> sample_positions (existing)
      -> corridor_box            bounded, validated
      -> build_landslide_provider().incidents_near(box, since, until)
      -> assess_corridor(result, route=positions)
      -> assess(..., landslide=...)

The observable API output is unchanged today — still
`landslide: NOT_AVAILABLE` — which is exactly right: the null provider is
honest and the answer is the same. What changed is that it is now the
**conclusion of a real path** rather than a hardcoded string, and it will move
the moment a source exists.

### The invariant, and the three roads to breaking it

    INSUFFICIENT_DATA MUST NEVER BECOME LOW.

`assess_corridor` resolves the provider's STATE before it looks at a single
incident, so there is no code path on which an empty list produced by "no
source" reaches the same branch as an empty list produced by a successful
query. Three separate tests pin the three roads:

- `NOT_CONFIGURED` -> `UNKNOWN` / `DataStatus.NOT_CONFIGURED`
- `UNAVAILABLE` (provider blew up) -> `UNKNOWN` / `SOURCE_FAILED`
- `AVAILABLE` + zero incidents -> `LOW` — **the only road to LOW**, because it
  is the only case where "no incidents" is a fact about a road rather than
  about our configuration.

A fourth test asserts a caller can actually TELL those apart (`risk`,
`data_status` and `reason_codes` all differ), because a client that cannot
distinguish them will render both as "safe".

### Policy, deliberately asymmetric

- OFFICIAL + `road_blocked` on route -> **CRITICAL**. An authority saying the
  road is shut is not a high score, it is a road you may not plan over.
- OFFICIAL or CORROBORATED on route -> **HIGH**.
- UNVERIFIED only -> **CAUTION**, never CRITICAL. One unsourced report must not
  shut a corridor: that strands cargo and teaches dispatchers to ignore the
  system, which costs more than it saves.
- RESOLVED -> does not raise current exposure, but stays in the record.

Incidents without coordinates are **counted and reported** (`unlocatable_count`,
`LANDSLIDE_INCIDENT_LOCATION_UNKNOWN`) and are **never placed on the route**.
Putting them on it would be inventing a position the source never gave;
dropping them would understate recurrence.

### Two defects found by hostile review, both fixed

**LS-1 — new reason codes would have reached a driver untranslated.**
`tests/test_reason_code_coverage.py` scans an **explicit module allowlist**,
not `app.domain` by walking, and `app.domain.landslide` was not in it. So the
suite went green while 8 new human-facing codes had no translation. Root cause:
I added a module that emits rendered reason codes without registering it.
Registered it (red: all 8 named), then added en/hi/as for all 8 (green).

**LS-2 — there are THREE reason-code mirrors, not two.**
After syncing `driver-app`, the suite still failed:
`manager-web/src/i18n/reasonCodes.json` is a third copy the coverage test also
asserts byte-identical. Fixed by syncing both. **The test caught this, not
me** — exactly what it exists for.

### Service degrades, never crashes

`landslide_for` catches `LandslideQueryError` (our bug — logged loudly) and
bare `Exception` (their outage) and resolves both to `SOURCE_FAILED`/`UNKNOWN`.
A test injects an exploding provider and asserts trip planning survives it.
Definition of done required that route planning not break because no landslide
provider is configured; it does not.

Queries are bounded by construction: `corridor_box` pads the SAMPLED positions
by 0.1 degrees and the `BoundingBox` constructor rejects anything over 5
degrees, so a route query can never become a national one.

### Tests

    tests/test_landslide_route_risk.py         19 PASS   (red first, twice)
    tests/test_landslide_provider.py           19 PASS
    landslide + route-risk subsystem          104 PASS   2m06s
      (route_risk, route_risk_api, monsoon_risk, road_memory,
       landslide_provider, landslide_route_risk)
    tests/test_reason_code_coverage.py         16 PASS   (was 15; +1 module)
    driver-app                                160 PASS / 13 files, tsc clean
    manager-web                                64 PASS /  6 files, tsc clean
    backend broader regression                120 PASS  6m24s  exit 0
      (route_recommendation, reroute, offline_package, routing,
       golden_path_e2e - none regressed by the UNAVAILABLE_FACTORS change)

Notably the route-risk **API** tests passed unchanged — the observable
contract did not move, which is the correct outcome for a refactor from
constant to computation.

### Status, unblurred

    LANDSLIDE DOMAIN RULES          IMPLEMENTED (31 isolated unit tests)
    LANDSLIDE PROVIDER SEAM         IMPLEMENTED
    LANDSLIDE APPLICATION WIRING    IMPLEMENTED  (provider actually called)
    LOW vs UNKNOWN INVARIANT        IMPLEMENTED + TESTED
    RECURRENCE OVER REAL DATA       NOT_IMPLEMENTED (needs the evidence log)
    DEDUPLICATION                   NOT_IMPLEMENTED
    ROUTE SAFETY POLICY INTEGRATION NOT_IMPLEMENTED (recommendation/reroute
                                    do not yet consume landslide risk)
    LIVE LANDSLIDE INTELLIGENCE     BLOCKED / NEEDS_DATA_PROVIDER

This is **not** "landslide AI complete". No live source is connected, no
incident has ever been ingested, and every route in production reports
landslide exposure as UNKNOWN.

## 2026-09-05 02:00 IST — Landslide step 1a: the provider seam

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

Continues the Phase 1 map recorded below. Small, self-contained, and safe to
stop at: nothing existing imports these modules yet, so nothing is half-wired.

### What was built

- `backend/app/domain/landslide.py` — normalized incident, source, and the
  states a source can be in. Pure types and pure rules, no I/O, mirroring the
  `app/domain/routing.py` ÷ `app/services/routing/` split.
- `backend/app/services/landslide/{__init__,base}.py` —
  `LandslideIncidentProvider(Protocol)`, a validated `BoundingBox`,
  `NullLandslideProvider`, and `build_provider()`.
- `backend/tests/test_landslide_provider.py` — **19 tests**.

### The one distinction the whole design turns on

    "we have no source"            is not
    "we looked and found nothing"  is not
    "this corridor is safe"

`NullLandslideProvider` returns `SourceState.NOT_CONFIGURED` and **not an empty
success**. An empty success is a claim about a ROAD; `NOT_CONFIGURED` is a
claim about US, and only the second one is true today.

`IncidentQueryResult.usable` exists so a caller cannot reach for `.incidents`
and read an empty tuple as good news — the failure mode is a caller that
compiles, runs, and quietly reports a never-examined corridor as clear.
A provider outage is a third state again (`UNAVAILABLE`), because a feed being
down says nothing about the hillside.

### Nothing is manufactured

Every field a source might not publish defaults to `None`, and `None` means
"not published" — never zero, never false. The sharpest case is coordinates:
an incident whose source gave none is **kept**, with `is_locatable` returning
False, because dropping it would understate recurrence (the one direction this
system must not fail in) and defaulting it to `0.0` would place a marker in
the Gulf of Guinea. A test asserts `latitude != 0.0`.

### Verification cannot be bought with volume

`promote()` reaches `CORROBORATED` only on two or more **independent source
names**, compared case- and whitespace-insensitively. Three syndicated copies
of one wire story stay `UNVERIFIED`. Reporting volume tracks how interesting an
event was, not how real it was, and letting it become confidence is how a press
cycle turns into a route rejection. Only an `OFFICIAL_AGENCY` can reach
`OFFICIAL` alone — a news article never does.

### Road quality is never inferred

`quality_evidence` returns `INSUFFICIENT` for an incident that merely blocked a
road, and `REPORTED` only when restoration or slope stabilisation was actually
reported. Repeated landslides are evidence about a **slope**; concluding "badly
built" needs engineering data no surveyed source publishes. The user's question
— "does repeated failure mean a bad corridor?" — is answered with evidence
states, not with an engineering verdict this system cannot support.

### Bounded by construction

`incidents_near` requires a bounding box and a time window; there is no
"fetch everything" call. `BoundingBox` validates range, inversion and a 5°
ceiling **in its constructor**, so a new provider cannot forget. The null
provider still validates the time window even though it queries nothing —
a broken query must be found now, not on the day a real source is connected
and the same call quietly returns a national inventory.

### Tests

    tests/test_landslide_provider.py    19 PASS   18.3s
    app imports OK, build_provider().name == 'none'

A test pins that the configured provider IS the null one. When that fails, a
real source was wired in and the docs must stop saying NEEDS_LIVE_DATA.

### Status, unblurred

    LANDSLIDE PROVIDER SEAM      IMPLEMENTED_ARCHITECTURE
    LANDSLIDE RISK INTEGRATION   NOT_STARTED  (route_risk still reports a
                                 hardcoded landslide: NOT_AVAILABLE)
    LIVE LANDSLIDE INTELLIGENCE  BLOCKED / NEEDS_DATA_PROVIDER

No fixture incident exists outside the test file. Nothing was written to the
database and the pending migration remains unapplied.

## 2026-09-05 01:35 IST — Landslide Phase 1: the map, and a corrected number

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO
**No source was modified this loop.** Verification only.

### A number in my own previous handoff was wrong

The last handoff said the landslide domain had **81 passing tests**. It does
not. 81 was the total of **four** files I ran together earlier
(`test_route_risk` + `test_monsoon_risk` + `test_road_memory` +
`test_route_progress`), and it got carried into the handoff as though it
described the landslide layer alone.

Measured:

    tests/test_road_memory.py     13 tests
    tests/test_monsoon_risk.py    18 tests
    landslide domain TOTAL        31 tests

And what those 31 prove matters as much as the count. Both files import only
`app.domain.*`. They are **pure unit tests of pure functions** — no service, no
API, no database, no route, no provider. So the correct statement is:

> the landslide DOMAIN RULES are well tested in isolation

not

> the landslide subsystem is tested.

Recorded rather than quietly fixed, because an inflated test count in a handoff
is exactly the kind of thing a later session trusts instead of re-measuring.

### COMPONENT | EXISTS | TESTED | CALLED | GAP

| Component | Exists | Tested | Called | Gap |
|---|---|---|---|---|
| `road_memory` fold (Evidence → Knowledge, `recurrence()`) | YES | 13 unit | **NO** | nothing supplies the evidence list |
| `monsoon_risk.assess()` (recurrence + rainfall + season + status) | YES | 18 unit | **NO** | nothing builds its `SegmentHistory` / `Knowledge` |
| `route_risk` domain — `FACTOR_LANDSLIDE`, `NOT_AVAILABLE` | YES | YES | YES | landslide is a hardcoded constant, not computed |
| `route_risk` service — sampling, weather fan-out, DB released before I/O | YES | YES | YES | never consults `monsoon_risk` |
| `LandslideIncident` normalized model | **NO** | — | — | absent entirely |
| `LandslideIncidentProvider` | **NO** | — | — | absent; the pattern to mirror exists |
| Verification states (OFFICIAL/CORROBORATED/UNVERIFIED/RESOLVED) | **NO** | — | — | absent |
| Incident deduplication | **NO** | — | — | absent |
| Route proximity (incident → route geometry) | PARTIAL | — | — | `sample_positions` + `parse_wkt_linestring` exist; no point-to-line distance |
| Recurrence analysis over real data | PARTIAL | YES | NO | `recurrence()` folds a list nobody produces |
| Persistence (`road_segments`, `road_evidence`) | PENDING SQL | NO | NO | BLOCKER-2, shared database |
| Route safety policy | PARTIAL | YES | YES | `route_recommendation` / `reroute` score distance+weather; no landslide input |
| Safe-hold contract | **NO** | — | — | absent |
| Data-quality reporting (`AVAILABLE` / `NOT_AVAILABLE`) | YES | YES | YES | the pattern is already right and is directly reusable |

### Why it has zero callers — the actual reason

Not neglect. `monsoon_risk.assess()` takes `history: SegmentHistory | None` and
`knowledge: Knowledge | None`. **Both are optional and both are currently
unbuildable**, because the only source of either is the `road_evidence` table,
whose migration is deliberately unapplied against a shared database. The domain
was written ahead of its data on purpose, and the seam is exactly where it
should be.

### The finding that makes the integration safe to do next

`monsoon_risk` **already refuses to turn absent data into low risk** — the
property the mission calls mandatory:

- a segment with no observation reports `passable = UNVERIFIED`, which is a
  refusal a caller cannot read as a number and ignore;
- absent inputs are named in `inputs` / `unavailable`, never scored as zero;
- `NOT_PASSABLE` is a separate field from `score`, so a closed road cannot lose
  a comparison narrowly to an open one.

So the smallest correct integration needs **no fixture data at all**: wiring a
`NullProvider` through to `assess()` yields an honest
`INSUFFICIENT_DATA` / `UNVERIFIED` result instead of today's hardcoded
`landslide: NOT_AVAILABLE`. That converts a constant into a real computed path
while remaining true, and it is the increment that unblocks every later phase.

### The pattern to mirror (do not invent a new one)

- `app/services/routing/base.py` — `class RoutingProvider(Protocol)` plus a
  chain with per-attempt outcomes. This is the house style for providers.
- `app/services/weather/` — a provider package with `open_meteo.py`, consumed
  by `app/services/route_risk.py`, which releases the DB connection **before**
  provider I/O and returns 200 with `NOT_AVAILABLE` on provider failure.

A landslide provider should look like the weather one, and the risk service
already demonstrates every hard part: bounded sampling, concurrent fan-out,
connection lifetime, and failure that degrades rather than 503s.

### Nothing was built this loop

No file was modified. Context budget reached the stop-coding threshold during
Phase 1, and starting an M-sized backend integration that could not be finished
would have left the tree worse than not starting. The map above is the
deliverable; the next session executes against it instead of against a wrong
premise.

## 2026-09-05 01:15 IST — Driver Assistant V1 (Phases 6-7)

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

### What it is, and what it deliberately is not

There is **no LLM anywhere in this repository** — no client, no provider, no
credential — and `docs/AI_MODELS.md` records `AI_ML = BLOCKED_BY_DATA` as a
deliberate position. So V1 answers from application state and nothing else.

That is not a placeholder. `answer()` returns **structured facts**, not prose,
precisely so a cloud model could later be handed those facts to word nicely
without ever being the thing that decides what is true. Truth here, wording
there. The cloud half is `NOT_IMPLEMENTED`; the interface it would plug into
exists.

### The security property is structural, not a guard

`assistant.ts` imports **no API client, no storage, no network**. Every tool is
a pure function of an `AssistantContext` the caller already fetched. The
assistant cannot change a route, close a trip or send a fix because there is no
code path here that could — not because a validator says no. A validator is
bypassed by whoever adds the next tool; an absent import is not.

Asserted against the **source**, and the assertion distinguishes import KIND:
`import type { CurrentTrip }` is erased at compile time and is allowed;
`import { api }` is not. Plus `expect(src).not.toMatch(/\bapi\s*\./)` as the
teeth — even an imported client would have to be called.

**The assertion was proven to fail before it was trusted.** A value import
(`import { api, type CurrentTrip }`) was injected deliberately; the test failed
with `value import from ../api/client — the assistant must not hold a live
client`. Reverted, md5-verified, green again. A security test that has never
failed is a false green, and this project has been bitten by one before (the
EPQ `assert not task.done()` incident).

### ASSIST-1 — a defect only rendering could find

**Symptom.** With no trip loaded, "Am I online?" reported
`Queue storage: memory`.

**Root cause.** `TrackerState`'s INITIAL value carries `persistence: 'memory'`
because no tracker has been constructed yet. It is a **default, not a
measurement**. Reporting it told a driver their positions would be lost on a
restart, which is not what that value means.

**Fix.** Describe the queue only when there is one — tracking running, or a
backlog present. A stopped tracker holding unsent fixes is the deliberate
exception: a backlog is exactly what someone needs to be told about.

Red test first (2 failures), then the fix, then green. Found by looking at the
screen, not by reading the code — every unit test passed both before and after.

### Honest definitions that shaped the design

**"Online" is evidence, not assumption.** There is no NetInfo in this app, so
connectivity is inferred from what actually happened: the trip loaded (we
reached the server) and the uploader is not failing. `idle` is not treated as
proof of anything. Getting this wrong optimistically would put "You are online"
in front of a driver in a dead zone.

**Cached is never called live.** Route risk comes from the offline package,
which is a snapshot with a capture time. Every answer built on it is labelled
`Stored copy — may be out of date`, carries its age, and propagates the
package's own STALE flag.

**No safe stop is ever suggested.** Break answers carry
`unavailable: ['VERIFIED_SAFE_STOP']`. There is no verified safe-stop dataset
in this build and inventing a place to park a truck at night is precisely the
thing the mission forbids.

**No medical knowledge is duplicated.** Emergency intents return topic IDs into
the one curated catalogue. A test asserts the assistant's facts are IDs
(`/^[A-Z_]+$/`), so prose cannot creep in and become a second copy to drift.

**Quick actions, no text box.** Mission Phase 10 requires minimising keyboard
interaction while moving, and this build has no reliable moving/stationary
signal to gate a text field behind. Rather than invent one, the interface is
quick-action-first universally. A test caps label length at 24 chars so the
grid stays usable at 320 px.

### Files

New
- `driver-app/src/assistant/assistant.ts` — context, 8 allowlisted read tools,
  question catalogue, resolver
- `driver-app/src/assistant/assistant.test.ts` — 26 invariants
- `driver-app/src/screens/AssistantScreen.tsx`
- `driver-app/src/raw-modules.d.ts` — declares Vite's `?raw`, used so the
  security test can read the module's own source **without** pulling in
  `@types/node`

Modified
- `driver-app/src/trip/TripProvider.tsx` — `loadedAt`, so freshness can be stated
- `driver-app/src/navigation.ts`, `App.tsx` — fifth tab (Trip, Truck,
  Assistant, Safety, Talk)

### Runtime verification

Rendered at **320 px** via Expo Web with the same temporary-bypass method as
before. Nine quick actions wrap into a readable grid, the answer card renders
headline / facts / "Not included" / "What you can do", the footer states that
nothing here can change a route. **No horizontal overflow** (`scrollWidth 320
== clientWidth`). The five-tab strip scrolls correctly.

Restoration proven:

    md5 App.tsx              f65f6800d189bc87543309736bbcf766  (== backup)
    md5 AssistantScreen.tsx  d6728806ae0a6c4a0c5b5ac49ac39c24  (== backup)
    grep TEMP-VISUAL-CHECK   -> no TEMP markers

### Tests

    driver-app assistant   26 PASS
    driver-app FULL       160 PASS / 13 files   (was 134/12)
    driver-app typecheck  clean
    driver-app expo export exit 0, artefact deleted

### Not done

- The assistant was rendered but **not interacted with** — quick-action taps
  were never actually pressed (the Browser pane hides, and RNW `Pressable`
  ignores synthetic clicks). Answers were reached by seeding initial state.
- Cloud LLM wording layer: `NOT_IMPLEMENTED`, no provider or credential exists.
- `CONTACT_DISPATCH` is currently advice text, not a dial action — there is no
  dispatch number in the trip payload to dial.

## 2026-09-05 00:50 IST — The driver screens are rendered for the first time

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

### Why this ran instead of the recorded next task

`CLAUDE_HANDOFF.md` named "verify authenticated manager pages" as EXACT NEXT
TASK. That task is **blocked**: it needs a manager credential the user has not
supplied, and the alternative (`backend/scripts/create_user.py`) **writes to a
shared database** and was not approved. Per the resume protocol, a blocked
next-task means selecting the highest-value unblocked work and recording why.

The chosen work was higher priority anyway. Three driver features had been
built, tested and bundled — and **not one of them had ever been rendered**.
Every test in this project for those screens is pure logic; a component that
throws on mount would pass all of them. "Application cannot run" is P0.

### Method, stated because it involved touching app code

Expo Web (`npx expo start --web`) serves the real app. The three new screens
sit behind the auth gate and there is no backend running and no driver
credential, so they cannot be reached normally.

So `App.tsx` was **temporarily** modified — the gate forced open, and the
initial tab pointed at each screen in turn — and `SafetyScreen.tsx` likewise
to open one topic detail. Both files were copied to a scratch directory
BEFORE editing and restored from those copies afterwards.

**The revert is proven, not asserted:**

    md5  driver-app/App.tsx                    ff6fb8ab609ecadbfa4700f7122a413c
    md5  scratchpad/App.tsx.ORIGINAL           ff6fb8ab609ecadbfa4700f7122a413c
    md5  driver-app/src/screens/SafetyScreen.tsx   88ddde5d28d065cc485d3b932338f6b8
    md5  scratchpad/SafetyScreen.tsx.ORIGINAL      88ddde5d28d065cc485d3b932338f6b8

    grep -rn "TEMP-VISUAL-CHECK" driver-app/   -> none
    gate                                        -> return driver ? <Signed /> : <LoginScreen />
    initial tab                                 -> useState<Tab>('trip')
    driver suite after restore                  -> 134 passed, tsc clean

Recorded in full because temporarily disabling an auth gate is exactly the
kind of change that gets left behind, and a reader three weeks from now
deserves to see the proof rather than the promise.

### What was actually verified

**The app boots.** Login screen renders, **zero console errors**. That alone
exercises every module body in the graph — `guide.json` and `phrases.json`
parsing, `StyleSheet.create` in both new screens, the `BREAK_TONE` /
`TAB_LABELS` tables — none of which any unit test executes.

**SafetyScreen renders.** Emergency numbers 112 / 108 / 1033, disclaimer,
emergency topics sorted ahead of the rest, each carrying the literal text
`EMERGENCY` rather than relying on the red border.

**The detail view renders**, including the single-source
`EMERGENCY - ACT NOW` block with all four escalation steps — the thing the
whole "escalation text lives in one place" design exists to produce.

**PhrasebookScreen renders.** Language picker shows each language in its own
script (English / हिन्दी / অসমীয়া / বাংলা). Devanagari and Bengali render
correctly. The listener language defaulted to Hindi for an English device,
confirming the "never default to the driver's own language" rule — two
identical columns would have looked broken.

**BreakCard correctly renders nothing** with no trip loaded, which is the
intended behaviour (`elapsedMinutes === null`) rather than "0m since you
started".

**TripScreen's error state renders correctly** — "No connection … nothing was
sent" — verified by accident, because there was no backend. Worth having seen.

**Accessibility, verified in the real accessibility tree** rather than by
reading the source. `find` returned:

    button "Suspected stroke - FAST. Emergency topic."

The `accessibilityLabel` reaches assistive technology, so the emergency signal
is not colour-only.

**No horizontal overflow at either width tested:**

    375 px   scrollWidth 375 == clientWidth, widest element 375
    320 px   scrollWidth 320 == clientWidth

320 px is the tightest width in the mission's driver list, and it is where the
four-tab strip was most at risk. It fits — the horizontal ScrollView added
earlier does its job, and the "1033 National highway helpline" label wraps to
three lines without clipping.

### Not verified

- 360 / 390 / 412 px were not separately measured. 320 and 375 bracket the
  interesting behaviour and both are clean; the intermediate widths are
  extremely unlikely to break where the tightest does not, but they were not
  measured and are not claimed.
- Interaction. The Browser pane kept hiding, and `computer` clicks time out
  against a pane that is not being painted; react-native-web's `Pressable`
  also ignores a synthetic `onClick` invoked from JS. So tab switching,
  topic tapping, the language picker and the "I stopped for a break" button
  were rendered but **never actually pressed**. Screens were reached by
  setting initial state instead.
- The break card in any state other than hidden — it needs a live trip.
- Any physical device. The Android toolchain is still absent.

### Tests after restore

    driver-app  134 passed / 12 files
    driver-app  tsc --noEmit  clean

### Known risk unchanged

There is still no renderer in the automated test setup, so this verification
was manual and will not repeat itself on the next change. A component-test
harness remains the durable fix; `react-native-web` and `react-dom` are
already dependencies, so the cost is roughly `jsdom` + a vitest alias.

## 2026-09-05 00:25 IST — Full tree re-certified (backend 724)

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · staged 0
**OTHER_WRITER_ACTIVE** NO

### Backend full suite — re-certified

    724 passed, 5 skipped, 0 failed, exit 0    25m 52s

**Identical to the 2026-09-02 certification** (724/5). The backend tree is
unchanged by this session — no backend source was touched — and this run
confirms the frontend work did not disturb it.

All five skips accounted for, not waved through:

- 4 × `tests/test_migrations.py` — gated behind
  `RUN_DESTRUCTIVE_MIGRATION_TESTS=1` because they downgrade to base and drop
  every table. Correctly skipped against a **shared** database.
- 1 × `tests/test_event_loop.py` — "non-Windows behaviour", correctly skipped
  on this host.

Wall time 25m52s against the historical 18m17s. Not treated as a regression:
manager-web's suite, typecheck and lint were run concurrently against the same
machine, and the database is a hosted pooler over the network. Recorded rather
than ignored, because the last time this suite got slower it was an
infrastructure signal (see the 2026-09-01 suite-lock incident).

### Final state of all three clients, one consistent tree

    backend      724 passed, 5 skipped, exit 0
    driver-app   134 passed / 12 files · tsc clean · expo export exit 0
    manager-web   64 passed /  6 files · tsc clean · oxlint 0 errors · build OK

### Delivered this session

1. Driver Safety & First-Aid Guide (Phase 9) — offline, versioned, sourced
2. Offline phrasebook (Phase 11 fallback) — 21 phrases × en/hi/as/bn
3. DRV-002 — found, mitigated, then **properly fixed** by lifting tracking to
   trip scope
4. Break guidance (Phase 8) — elapsed time, never "driving time"
5. A11Y-1 — focus-visible / cursor / reduced-motion, verified in a live browser
6. OBS-CLAIM-1 closed — SystemPage no longer understates the product
7. `docs/CLAUDE_HANDOFF.md` created and kept current

### Defects found in my OWN work this session

    BUG-SAFE-1   a prose-shaped regex banned "you have" and failed on
                 "the cleanest cloth you have"
    BUG-TRIP-1   a useMemo that could never memoise anything
    BUG-TRIP-2   the refactor silently dropped refresh-on-tab-return
    (process)    prettier run with no project config churned 463 lines

All four were found by reviewing the diff for CONSEQUENCES rather than for
correctness. Each individual change was fine; three of the four defects existed
only in what the changes did to code they did not touch.

### Not done, and why

- **Landslide intelligence** — BLOCKED. Four data routes, all shut
  (404 / timeout / 403 / **401**). No coordinates were manufactured.
- **`road_memory` persistence** — BLOCKED on approval to touch a shared
  database. Migration NOT applied, NOT promoted.
- **Authenticated manager pages** — never rendered. Needs a credential.
  Only the login screen has been seen in a browser, at 375 px.
- **Manager mobile (Phase 4)** — LARGE, not started. Driver app has no map
  dependency at all.
- **Speech recognition / TTS / machine translation** — deliberately not built.

### Nothing was written to the shared database

No migration applied, no schema change, no user rows created. The backend
suite manages its own fixtures and deactivates them at teardown.

### Next task
See `docs/CLAUDE_HANDOFF.md` → EXACT NEXT TASK.

## 2026-09-05 00:05 IST — Break guidance (Phase 8), and one refused claim

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO

### The claim this feature refuses to make

The mission's own example output is:

    BREAK RECOMMENDED
    Reason: 2h 45m continuous driving

**This build cannot say that, and does not.** It has no measurement of driving
time. A driver who started at 06:00 and spent two of the last four hours
waiting at a loading dock has not driven for four hours, and "4h continuous
driving" would be the app making a false statement about the person reading
it. The tracker distinguishes moving from stationary for GPS cadence, but that
signal is not accumulated anywhere, and a stationary truck in traffic is not a
resting driver.

So the honest quantity is **elapsed time since the trip started or since the
last recorded break**, and every string says "since". The screen names the
measurement out loud - "elapsed time, not time spent driving" - rather than
leaving the caveat in a source comment where no driver will read it.

It also does not detect fatigue. There is no sensor and no model; fatigue
detection needs validated hardware this product does not have. This is a clock,
and it says so.

### What was built

- `driver-app/src/safety/breaks.ts` — pure, no platform imports, injected
  clock. Four levels (NONE / DUE_SOON / RECOMMENDED / OVERDUE) at 3h30 / 4h /
  5h. Emits **reason codes, not sentences**, following the backend convention:
  a sentence built here arrives in English no matter who holds the phone.
- `driver-app/src/safety/breakStore.ts` — AsyncStorage, every path swallows
  failure. `recordBreak` returns whether it actually stored, so the screen
  never tells a driver their break was logged when it was not.
- `BreakCard` in `SafetyScreen.tsx` — minute tick, not per-second: the
  thresholds are hours apart and a per-second timer would wake the JS thread
  60× more often for a number that changes once a minute.

**Thresholds are project constants, not law.** Stated the same way
`route_risk` states its rainfall cut-offs. They are NOT a transcription of the
Motor Transport Workers Act or of EU drivers' hours, and nothing here should be
presented as regulatory compliance.

**Advice, never enforcement.** Nothing blocks a trip. Whether it is safe to
continue depends on where the next safe place to stop is, which the phone does
not know.

### The cases the tests actually protect

Every interesting one is where a naive implementation would **understate** the
elapsed span, because understating it is what tells a tired driver they are
fine:

- a break recorded **before this trip began** (yesterday's trip) is ignored and
  the span falls back to trip start — which can only ever make it longer;
- a break timestamped **in the future** (a jumped clock) is ignored, rather
  than silently resetting the counter and hiding an overdue break;
- `now` before the start yields `0`, never a negative span;
- an unparseable timestamp degrades to "not started" instead of throwing on
  the safety screen;
- storage failure degrades to "measure from trip start" — again, the longer,
  safer direction.

Elapsed time is rendered `4h 07m`, not `247 min`. The project already makes
this argument about distance (`"1300 m" is a number a driver has to convert
while driving`); it applies at least as strongly to a duration being used to
decide whether to stop.

### Honest limitation

**A manager cannot see break status.** There is no backend field for a break
and adding one means a schema change against a shared database (BLOCKER-2), so
this is driver-facing guidance only. `breakStore.ts` is the seam to replace
when a break becomes a real domain event. Recorded rather than glossed: the
mission's Phase 26 wants driver break status on the manager console, and this
does not deliver it.

### Tests

    driver-app breaks.test.ts        10 PASS
    driver-app breakStore.test.ts     4 PASS
    driver-app FULL                 134 PASS / 12 files
    driver-app typecheck            clean
    driver-app expo export          exit 0, artefact deleted

## 2026-09-05 00:00 IST — DRV-002 fixed properly: tracking lifted to trip scope

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · OTHER_WRITER_ACTIVE NO

### Why this ran at all

The previous checkpoint stopped on a **mis-estimated context budget**. Actual
usage was **31%** (DEEP WORK), not the 60–70% assumed, so an L-sized task was
allowed the whole time. Correcting the estimate is the reason this milestone
exists. Lesson: when exact usage is displayable, read it — a conservative
guess cost a milestone.

### The real fix

`useLocationTracking` no longer lives in `TripScreen`. Trip state **and** the
tracker now live in `src/trip/TripProvider.tsx`, mounted inside the signed-in
branch and **above** the tab navigation.

The mitigation shipped earlier tonight (never unmount `TripScreen`) is gone,
and `App.tsx` is back to plain conditional rendering. `KEEPS_RUNNING` /
`staysMounted` and their two tests were deleted with the problem they
described.

**Trip state moved with the tracker, not separately.** The tracker's three
inputs (`id`, `tracking_expected`, `tracking`) all come out of the trip
payload. Leaving the fetch in the screen and lifting only the hook would have
meant two components calling `api.myTrip()` and disagreeing. One owner, one
fetch.

**The render body needed zero changes.** Before editing, every identifier the
285-line render body uses was counted: `trip, phase, loadError, actionError,
isBusy, isRefreshing, load, act, tracking` — and **no setters**. Exposing the
same names from `useTrip()` meant the diff is the state block and the imports,
nothing else.

`useTrip()` throws outside the provider rather than returning a null default:
a screen that silently rendered "no trip" because somebody moved it out of the
tree would look like a driver with nothing to do, which is the most misleading
possible failure for this app.

### Two defects found reviewing my own refactor

**BUG-TRIP-1** · A `useMemo` around the context value was **theatre**.
`useLocationTracking` returns `{ ...state, requestPermission: () => ... }` — a
fresh object with a fresh closure on every render — so `tracking` can never be
a stable dependency and the memo recomputed every time regardless. Removed
rather than kept, because code that implies a guarantee it cannot make is
worse than no code. It costs nothing: the provider only re-renders when its
own state changes, and the one consumer needs to re-render then anyway.

**BUG-TRIP-2** · The refactor silently dropped a real behaviour. Previously,
switching tabs unmounted `TripScreen`, and returning to it **refetched the
trip by accident** — which is how a driver picked up a route change a manager
made while they were on another tab. Nothing polls, so losing it would have
left a driver on a stale route until they pulled to refresh. Restored
deliberately in `TripScreen` with a mount-only effect that uses `phase` to
tell the first mount (provider's load still in flight) from every later one.
Behaviour preserved, not narrowed.

### A self-inflicted mess, and its cleanup

Ran `npx prettier --write` on three files with **no project config present**.
Prettier's defaults are semicolons + double quotes; this project uses
**neither**. That churned 157 lines of `App.tsx` and 306 of `TripScreen.tsx`
into formatting noise.

Caught by diffing rather than by assuming, and confirmed against an untouched
file: `AssignmentScreen.tsx` has **zero** semicolon-terminated lines. Re-ran as
`prettier --no-semi --single-quote`, which restored the house style (verified:
0 semicolon line-endings across all three files). The residual diff is
pre-existing work from earlier sessions plus the intended edit.

**Do not run prettier in this repo** — it has no config and is not in
`devDependencies`; it was pulled transiently by npx.

### Files changed

New
- `driver-app/src/trip/TripProvider.tsx`

Modified
- `driver-app/src/screens/TripScreen.tsx` — consumes `useTrip()`; dead imports
  (`useCallback`, `CurrentTrip`, local `Phase`) removed; `TrackingBanner` prop
  retyped to `TripContextValue['tracking']`; refresh-on-return restored
- `driver-app/App.tsx` — `<TripProvider>` above the tabs; conditional
  rendering restored; `hidden` style removed
- `driver-app/src/navigation.ts` + `navigation.test.ts` — mitigation deleted

### Tests

    driver-app FULL     120 PASS / 10 files   (122 before; 2 mitigation
                                               tests deleted with the mitigation)
    driver-app typecheck  clean  (one real catch: a stale
                                  `ReturnType<typeof useLocationTracking>`)
    driver-app expo export exit 0, safety guide still present in the .hbc

Backend full suite started this loop; result recorded in the session-close
entry. Artefacts deleted; no build output entered the tree.

### Known risks

- No renderer in the driver-app test setup, so the provider's mount/unmount
  lifecycle is **not** covered by an automated test. Verified by typecheck,
  by reading the tree, and by a clean bundle — not by execution.
- Not verified on a physical device (Android toolchain still absent).

## 2026-09-04 23:45 IST — SESSION CLOSE (context budget) — SUPERSEDED

> **This entry was wrong and is kept rather than deleted.** It closed the
> session on an ESTIMATED context budget of 60-70%. The real figure was
> **31%**. The session continued and delivered the DRV-002 fix recorded
> above. Retained because the mistake is the useful part: a conservative
> guess, made when the true number was displayable, cost a milestone.

**HEAD = origin/main = `f850de4`** · committed NO · pushed NO · staged 0
**Tracked modified** 41 · **untracked entries** 44 · **OTHER_WRITER_ACTIVE** NO

Session ended on the **context budget**, not on a failure and not on a
blocker. Stopped in LAND-THE-SESSION mode with a milestone complete, green
targeted tests and a written handoff — which is the intended way to end.

**Deliberately NOT started:** lifting `useLocationTracking` to trip scope.
It is the recorded next task and it is a safety-critical architectural
refactor (L). Beginning an L-sized change on the GPS path at this budget would
risk leaving the core demo half-refactored and unverified. The interim
mitigation (DRV-002) is in place and tested, so the tree is safe to leave.

**Handoff:** `docs/CLAUDE_HANDOFF.md` — current truth, blockers with
evidence, failed attempts not to repeat, and one exact next task.

**Not re-run this session:** backend FULL suite. No backend source changed, so
the 2026-09-02 run (724 passed / 5 skipped) still describes the backend tree.
Re-running it would have spent context to learn nothing.

## 2026-09-04 (night, later) — DRV-002: a defect my own feature created

**TIME** 23:35 IST · **HEAD = origin/main = `f850de4`** · **committed** NO · **pushed** NO

### The defect

**DRV-002** · **P1** · Adding tabs stops the truck reporting its position.

`useLocationTracking` is mounted inside `TripScreen`, and its effect cleanup
calls `tracker.stop()` — which ends both the GPS watch and the flush timer. The
render was `{tab === 'trip' ? <TripScreen/> : ...}`, so navigating away
unmounted the screen and silently stopped tracking.

This was already true with two tabs and was rarely reached. Adding **Safety**
and **Talk** turned it from an edge case into a likely one, and made it worse
in the specific direction that matters: **Safety is the tab a driver opens
during an incident**, so the app would go silent at exactly the moment a
dispatcher most needs to see where the truck is.

Found by reviewing my own diff for consequences rather than for correctness —
each new tab was individually fine, and the defect only existed in what they
did to a screen I never edited.

### Root cause

Tracking's lifetime was bound to a **screen's mount**. It is a **trip**-level
concern and must outlive any screen.

### Fix

`TripScreen` is now rendered **always** and merely hidden (`display: none`)
when another tab is active, so the tracker it owns keeps running.

Cheap, and checked before choosing it: `TripScreen` has exactly one effect and
**no polling**, so a hidden instance does no repeated work. The tracker is the
only ongoing work, and it is the part that must not stop.

Hidden also means hidden from assistive technology —
`accessibilityElementsHidden` and `importantForAccessibility` are set, or the
inactive screen's contents stay in the accessibility tree and get read out over
the tab the driver actually opened.

**The real fix** is to lift tracking above navigation entirely so its lifetime
is the trip. That is a larger refactor than belongs in a night's work, and
`src/navigation.ts` documents it as the upgrade path.

### The test, and its honest limit

There is **no renderer in this project's test setup** — driver-app tests are
pure logic, with no jsdom and no react-native testing library. Adding one at
this hour is exactly the risky architectural change the mission says to avoid.

So the *decision* was extracted into `src/navigation.ts` (`KEEPS_RUNNING`) and
pinned by `navigation.test.ts`. This **cannot** prove React keeps the screen
mounted. It can and does fail loudly if someone removes `trip` from the
always-mounted set — which is the change that would silently reintroduce the
bug. Stated plainly rather than dressed up as a regression test.

### UI/UX work this loop — accessibility, verified at runtime

The `ui-ux-pro-max` search returned **HUD / Sci-Fi FUI**: neon `#00FF41`, glow
and scanning animations, self-reported `accessibility risk: high`, and a
landing-page section pattern (hero, "Start trial") for what is an
authenticated operator console. **Rejected as a palette**, on the mission's own
brief: "do not overuse neon/glow", "minimal visual noise", "never animate
critical safety information". Its density scale, reduced-motion rule and
pre-delivery checklist were kept. Design input, not authority — the same rule
the mission sets for Stitch.

Real defects found and fixed instead:

**A11Y-1** · Eight `focus:outline-none` / `outline-none` suppressions across
`ui.tsx` and five pages left keyboard users with only a border-colour change as
a focus indicator, while the shared `Field` had a ring — the inconsistency that
happens when call sites hand-roll classes instead of routing through a
component. Fixed **once, globally**, in `index.css` with a `:focus-visible`
rule, and the suppressions removed so it can apply. A global rule was chosen
deliberately: componentising it means each new hand-rolled element re-acquires
the bug.

Also added there: `cursor: pointer` on enabled controls (browsers default
`<button>` to an arrow, which on a console of buttons reads as "not
clickable"), and a `prefers-reduced-motion` block.

**A11Y-2 — investigated and NOT a defect.** `FleetMap` calls `easeTo`, which
looked like animation on every GPS poll. It is not: it is keyed on operator
selection and a button press, and the code says so. And MapLibre **6.6.0
handles `prefers-reduced-motion` itself** — verified by finding the media query
inside the shipped bundle, not assumed. No change made. Recorded because "we
checked and there is nothing here" is worth as much as a fix.

### Runtime verification — the part that mattered

A global CSS rule seen only in a build artefact is not verified. Ran the dev
server and measured the real computed styles in the browser:

    enabled button        cursor: pointer
    focus-visible ring    2px solid oklch(0.765 0.177 163.223)  (emerald-400)
    outline-offset        present
    reduced-motion rule   found in document.styleSheets
    login at 375px        scrollWidth == clientWidth, no overflow

The focus ring was the one worth checking hardest: had `--color-emerald-400`
not resolved, `outline: 2px solid <invalid>` would be an invalid declaration
and drop the outline entirely — leaving focus **worse** than before the change.
It resolves to a real oklch value; confirmed in both the built CSS and the live
DOM.

The disabled Sign-in button reported `cursor: not-allowed`, which confirms the
`:not(:disabled)` guard works rather than blanket-applying pointer.

**Not verified:** the authenticated pages. Login needs credentials this session
does not have, so tablet/laptop responsive behaviour of Fleet, Trips, Drivers
and Trucks is **unverified this loop**. Not claimed as passing.

### Files changed

New
- `driver-app/src/phrasebook/phrases.json` — 21 phrases × 4 languages
- `driver-app/src/phrasebook/phrases.ts`
- `driver-app/src/phrasebook/phrases.test.ts` — 7 invariants
- `driver-app/src/screens/PhrasebookScreen.tsx`
- `driver-app/src/navigation.ts` + `navigation.test.ts` — DRV-002
- `.claude/launch.json` — dev server for runtime checks

Modified
- `driver-app/App.tsx` — fourth tab, scrollable tab strip, DRV-002 fix
- `manager-web/src/index.css` — focus-visible, cursor, reduced motion
- `manager-web/src/components/ui.tsx` + 5 pages — outline suppressions removed

### Phase 11 — what was built and what was NOT

Built: an **offline phrasebook**, 21 operational phrases (breakdown, injury,
police, blocked road, safe parking) in en/hi/as/**bn**. Bengali is a phrasebook
target only, typed separately from the app's `Language` so adding one can never
imply the interface was translated.

**NOT built, and deliberately: speech recognition, speech playback, machine
translation.** There is no `expo-speech` and no STT provider. The app is
managed Expo with no `android/` directory and the Android toolchain is absent,
so any native module added tonight could not be verified at all. A microphone
button backed by nothing is discovered at the worst possible moment. There is
no microphone control anywhere on the screen.

### Tests run

    driver-app  full suite    122 passed / 10 files   (was 96/6 at baseline)
    driver-app  tsc --noEmit  clean
    manager-web full suite     64 passed / 6 files
    manager-web tsc -b        clean
    manager-web oxlint        0 errors (2 pre-existing warnings, untouched)
    manager-web vite build    OK

### Known risks

- DRV-002's test pins the decision, not the rendering. A future refactor that
  keeps `KEEPS_RUNNING` but changes how App.tsx renders could reintroduce the
  bug without failing anything.
- Authenticated manager pages unverified at tablet/laptop widths this loop.
- Bengali, Hindi and Assamese strings remain unreviewed by native speakers.

### Next task

Lift tracking above navigation so its lifetime is the trip (the real DRV-002
fix). Then authenticated-page responsive verification, which needs a manager
credential.

## 2026-09-04 (night) — Safety guide shipped; two data routes proved blocked

**TIME** 23:25 IST · **HEAD = origin/main = `f850de4`** · **branch** main
**WORKTREE** dirty, uncommitted · **committed** NO · **pushed** NO
**OTHER_WRITER_ACTIVE** NO — no python process, no source file touched in the
preceding 24h, node processes are editors rather than dev servers.

### Current task / phase
New mission (AUTONOMOUS CORE + AI + UX EXPANSION). Phase 9 delivered. Phases
13–21 investigated and BLOCKED on data, with evidence rather than assumption.

### Two claims from the previous checkpoint, re-checked against code

**`queueStore` IS wired.** The 2026-09-02 entry recorded offline GPS as PARTIAL
because "queueStore is not wired into useLocationTracking". It is:
`useLocationTracking.ts:118` passes `createQueueStore()`, and
`queueStorage.test.ts` is the regression test guarding exactly that (DRV-001).
The doc was behind the code. Verified by grep, not by re-reading the entry.

**`monsoon_risk` / `road_memory` still have zero application callers.** That
part was accurate. `monsoon_risk` imports `road_memory`; nothing imports
`monsoon_risk`.

### Landslide intelligence — BLOCKED, with evidence

Four independent routes to the data were tried tonight. All four are shut:

| Route | Result |
|---|---|
| NASA COOLR ArcGIS FeatureServer (`gis.earthdata.nasa.gov`) | **404** |
| NASA COOLR FeatureServer (`maps.nccs.nasa.gov`) | **timeout, no response** |
| NASA Global Landslide Catalog CSV (`data.nasa.gov`) | 302 to a presigned S3 URL returning **403** |
| IMD Highway Warning API (`mausam.imd.gov.in`) | **401 — authentication required** |

The IMD result is the important one. `docs/ROAD_MEMORY.md` recorded that IMD's
public reference documents no auth, no rate limit and no licence, and flagged
that "terms undetermined" is not the same as "free to use". A 401 settles it.
That is a **missing-credential blocker**, which the mission names as a
legitimate stop condition for the affected task.

**The database route is also shut, deliberately.** `DATABASE_URL` points at a
**shared hosted Supabase instance**, not a local container. The pending
`docs/migrations/PENDING_road_memory_tables.sql` says in its own header that
promoting it to an alembic revision IS the approval step, because anything in
`alembic/versions/` is applied by the next `alembic upgrade head` — including
the one the test suite runs. Applying it unattended against a shared database
is exactly the "shared database ownership ambiguity" the mission forbids.
**NOT APPLIED. NOT PROMOTED. Nothing was written to the database this loop.**

Consequence, stated plainly: building the read path tonight would have produced
a pipeline whose only honest output is `landslide: NOT_AVAILABLE` — which is
what the API already reports, from one constant, correctly. No coordinates were
manufactured to make a demo look better.

### Completed — Driver Safety & First-Aid Guide (Phase 9)

Offline, curated, versioned, trilingual (en/hi/as, matching the existing
catalogue). No network call, no model, no new dependency.

The structural decision worth defending: **every topic must answer "when do I
call for help"**. A topic is either `emergency: true` — call now, no judgement
asked of the driver — or it carries a non-empty `escalate` list of red flags
that make it one. `guide.test.ts` enforces that as an XOR. A topic answering
neither would still render, and would still look fine, which is precisely why
it needs a test rather than a review.

The escalation text ("stop safely, call 112, tell dispatch") lives in **one**
place and is rendered for every emergency topic. Eleven hand-copied versions
across three languages is eleven chances for one to drift, and the one that
drifts is the one being read at the roadside.

It does not diagnose. Heart attack and stroke are titled "Suspected …", and a
test asserts that rather than trusting it. It names no drug in any language
(denylist test) while still being allowed to say "do not take any medicine
unless a doctor has already prescribed it to you" — the check is on drug
names, not on the word "medicine".

### Files changed

New
- `driver-app/src/safety/guide.json` — 11 topics × 3 languages, sourced, versioned
- `driver-app/src/safety/guide.ts` — resolution + fallback chain, makes no decisions
- `driver-app/src/safety/guide.test.ts` — 12 invariants
- `driver-app/src/screens/SafetyScreen.tsx` — list/detail, no text input anywhere

Modified
- `driver-app/App.tsx` — third tab
- `manager-web/src/pages/SystemPage.tsx` — OBS-CLAIM-1 closed

### Bug found and fixed — in my own test

**BUG-SAFE-1** · P3 · A `\byou have\b` ban intended to catch diagnostic
phrasing failed on "press with the cleanest cloth **you have**" and "unless
**you have** been trained". Root cause: a prose-shaped rule catches prose, not
meaning. Replaced with the specific structural promise — the two topics naming
a clinical condition rather than an observation must be titled "Suspected …" —
which is checkable and does not false-positive. Red first, then green.

### OBS-CLAIM-1 — closed

`SystemPage.tsx` said route risk "is not displayed here yet" and listed
rerouting as not built. Verified against the code before rewriting:
`FleetPage.tsx` renders risk score and band and a reroute proposal with its
tradeoff in minutes and kilometres. Both claims were stale in the
UNDERCLAIMING direction — the page told a judge the product could not do
something it does one tab away.

The phrase "**automatic** rerouting is not built" was KEPT and strengthened to
"nothing here changes a route on its own", because that remains true and is the
more important claim. Landslide risk is now stated as not built, with the
reason.

### Tests run

    driver-app  src/safety/guide.test.ts     12 passed (1 red first, BUG-SAFE-1)
    driver-app  full suite                  110 passed / 8 files   (was 96/6)
    driver-app  tsc --noEmit                clean
    manager-web full suite                   64 passed / 6 files
    manager-web tsc -b --noEmit              clean
    backend     route_risk, monsoon_risk,
                road_memory, route_progress  81 passed

### Runtime verification

`npx expo export --platform android` exited 0, and `SEVERE_BLEEDING` is present
inside the emitted Hermes bytecode (`index-*.hbc`, 1.6 MB) — so the guide is
genuinely bundled and genuinely available with the radio off, which is the only
claim that matters for this feature. Export artefact deleted; no build output
entered the tree.

Not verified on a physical device — the Android toolchain is still absent
(recorded in DRIVER_APP_MISSION_BASELINE, unchanged).

### Known risks

- hi/as safety strings are **unreviewed by a native speaker**, and for medical
  content that caveat is stronger than for reason codes. The disclaimer is on
  screen. Must not be presented as certified translation.
- The guide is first-aid content written against reputable public sources
  (MHA ERSS for 112, NHS for FAST). It has had **no clinical review**.
- `tel:` opens the dialler and does not place the call. Correct, and it means
  the driver still needs one more tap in an emergency.

### Blockers

- Landslide historical inventory — no reachable machine-readable source.
- IMD highway warnings — **credential required** (401).
- `road_memory` persistence — needs explicit approval to touch a shared database.

### Next task

Remaining unblocked UX work. Manager mobile (Phase 4) is a large architectural
add — the driver app has no map dependency at all — and is deliberately NOT
started at this hour.

## 2026-09-02 (morning) — FINAL CHECKPOINT CERTIFICATION

**TIME** 07:40 IST · **HEAD = origin/main = `f850de4`** · **committed** NO · **pushed** NO

Purpose: the 722-pass run did not certify the final tree - `driver.py` and the
EPQ race tests changed after it. This closes that gap.

### Quiescence and reconciliation

`OTHER_WRITER_ACTIVE = NO`. No python process, ports free, no source touched in
20 minutes. **70 files: 31 modified + 39 untracked**, every one classified into
exactly one class, zero UNEXPECTED.

The earlier report said "31 untracked". That was the `git status` ENTRY count,
which collapses directories. Expanded, it is 39 files across 32 entries (5 of
them directories holding 12 files). Current measured state used throughout.

### Defects found and fixed

**My own EPQ test was a false green.** `assert not start_task.done()` proves the
request has not FINISHED - equally true if it is waiting on auth, on another
statement, or is merely slow. That is sleep-only synchronisation. Replaced with
evidence from the database: `pg_stat_activity` where `wait_event_type='Lock'`
and the query is the `FOR UPDATE OF trips` statement. The watcher connection is
now taken BEFORE the lock, because acquiring it afterwards competes with the
request under test and a watcher that cannot connect reports "no lock wait" -
false green on the only assertion that makes the test worth running. 5/5 clean.

**A schema defect in my own pending migration.** `ix_road_evidence_kind_time`
led with `kind`, so the recurrence query - which is equality on `segment_id`,
equality on `kind`, range on `observed_at` - would have scanned every incident
across every segment. Corrected to
`ix_road_evidence_segment_kind_time (segment_id, kind, observed_at DESC)`. My
own requirement note had asserted the wrong index served it; corrected too.

### Phase 4 dispositions

`_stops_for` — **ACCEPTED, not capped.** A LIMIT would silently drop a driver's
last stops from the package they rely on offline, which is worse than a large
download. Served by `uq_trip_stops_sequence` as an index-ordered scan. The count
is not product-bounded (`TripPlanTrip.stops` has no `max_length`); if that ever
matters the fix belongs at the DOOR as request validation - bound what may be
created, never truncate what was. Documented in the function.

`road_memory.apply()` — not live, so not prematurely optimised. The pending
migration now carries a REQUIREMENT on the read path: bound the belief read by
rows (N>=2, index-ordered), and compute recurrence as a database aggregate,
never a truncated read - understating recurrence makes a bad road look safe,
the one direction this system must not fail in.

### Results

    Backend targeted (21 suites)  408 passed, 0 failed        9m58s
    Backend AUTHORITATIVE FULL    724 passed, 5 skipped, 0 failed, exit 0   18m17s
    manager-web  63 passed · tsc 0 · oxlint 0 errors · build OK
    driver-app   96 passed · tsc 0 · expo export OK (231 modules, 455 KB)
    Golden demo  27/27 stages against the OWNED runtime, live providers

**724 supersedes 722.** Source fingerprints identical before and after the full
run (tracked `08a4cc3e`, untracked `2c69c885`) - zero drift, so the result
certifies exactly this tree.

Expo export was required (driver source newer than `dist/`) and succeeded,
which also proves the i18n mirror decision: Metro bundles
`src/i18n/reasonCodes.json` with no config change. Artefact exported to
`dist-cert` and deleted so no build output enters the tree.

### Golden demo — live providers, nothing simulated

Ran against port 8151, PID 14576, user `patel`, over real HTTP with the LIVE
OSRM and Open-Meteo providers: `backup_planned=true` (a genuine second
corridor), `weather=AVAILABLE`, `score=15 band=LOW`, progress `frac=0.477
left=159.7km off=0m`, reroute `NO_ACTION` - correct, the weather really was
calm, which is what the floor is for. All 27 stages passed; own rows cleaned.

### Database - a wrong reading, corrected

A mid-certification sweep showed **2 active test users and 1 refresh token** and
looked like a hygiene failure. It was not: the authoritative suite was IN FLIGHT
and its fixtures are deactivated at teardown. Re-measured with nothing running:
**0 active, 0 tokens**, 18,930 retained users (deliberate - `audit_logs`
`actor_user_id` is RESTRICT), 0 test accounts off a `.invalid` domain, 5 real
accounts untouched. Both pending migrations confirmed NOT applied
(`road_segments`, `road_evidence`, `REROUTE_*` all absent). **Nothing deleted.**

### Claim audit

Every forbidden-claim hit in shipped code is a DENIAL. `monsoon_risk` has zero
application callers and `road_memory` is referenced only by it - both
FOUNDATION. `ml/` is a README, zero model artefacts repo-wide. `queueStore` is
not wired into `useLocationTracking`, so `persistence:'memory'` - offline GPS
PARTIAL. No `expo-speech`, no TTS reference - voice PARTIAL.

**OBS-CLAIM-1 (open, not fixed):** `manager-web/src/pages/SystemPage.tsx:122`
says route risk "is not displayed here yet" and lists rerouting as not built.
Both are now stale in the UNDERCLAIMING direction - the page tells a judge the
product cannot do something it visibly does one tab away. Not fixed:
`SystemPage.tsx` is outside the 70-file tree and the mission forbids further UI
work. The phrase "**automatic** rerouting" must be KEPT - nothing reroutes
itself, and that remains true and important.

---

## 2026-09-02 (early hours) — A suspicion chased down, and disproved

**TIME** 2026-09-02 ~02:10 IST · **HEAD** `f850de4` (unchanged) · **committed** NO

Nothing was failing. This was the one open suspicion logged during the Task 2
trace and never verified, chased rather than left in the risk list.

### The hypothesis

`driver_trips.current_trip` issues

    SELECT ... WHERE status IN (open) ORDER BY ... LIMIT 1 FOR UPDATE

PostgreSQL's EvalPlanQual recheck was the worry. When `FOR UPDATE` waits on a
row another transaction is changing, and that transaction commits a change
making the row no longer satisfy the WHERE clause, the row is dropped. The
concern was that with a LIMIT the planner has already chosen its row, so the
query returns ZERO rows rather than moving to the next candidate - which would
mean a driver tapping Start at the moment a manager cancels their first trip is
told **"You have no trip to work on right now"** while a second, perfectly
startable trip sits in their queue.

### Method

An opportunistic `asyncio.gather` version passed five times in a row - and
proves nothing, because `gather` gives no guarantee the two statements
overlapped. A race test that passes because it never raced reports a property
it did not check.

So the interleaving was constructed by hand: a third session takes the row lock
on the queue head and HOLDS it, the driver's start is fired and blocks inside
`current_trip`, and only then is the head cancelled and committed.

### Result — NO DEFECT

    start blocked on the lock?  True      <- the EPQ window was genuinely entered
    start -> HTTP 200
      started d83207ed... = the QUEUED trip (correct)
      status  ACTIVE
      head    842dbc4b... -> CANCELLED
      queued  d83207ed... -> ACTIVE

PostgreSQL re-evaluates after the concurrent commit and **continues the scan**
to the next matching row rather than returning empty. The driver started the
queued trip; the cancelled head stayed cancelled. The premise about
EPQ-with-LIMIT was simply wrong.

**No code changed.**

### Kept anyway

`backend/tests/test_start_race_epq.py`, both versions. The deterministic one
asserts `not start_task.done()` BEFORE drawing any conclusion, so it fails
loudly if the window is ever missed instead of quietly degrading into a test
that races nothing.

Verified: 60 passed across the race file, the multiplicity invariant and trip
execution.

---

## 2026-09-02 (early hours) — Certification

**TIME** 2026-09-02 01:35 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO

### Writer quiescence and tree

`OTHER_WRITER_ACTIVE = NO`. No python process on the machine after teardown;
source mtimes all this session's own. HEAD still
`f850de456d03bdcf776bafd1bcd8377f89b763c0`.

    31 modified, 29 untracked
    31 tracked files changed, +4395 / -60

### Secret scan

Clean across the tracked diff and every untracked file. Two matches, both
inspected and both correct: `certify_dispatchability.py` imports `secrets` and
generates an ephemeral password with `secrets.token_urlsafe(24)` which it
hashes and **never prints** - verified by grepping every `password` reference
for a print/log/format sink. No `.env`, key, or credential file added.

### Runtime, on the final tree

Port 8141, verified free before binding.

    PID          29836
    WINDOWS USER LAPTOP-VQP9OF8E\\patel     <- own process
    COMMAND LINE python.exe run.py
    STARTED      2026-09-02 01:30:28
    PARENT PID   27756 (this session's shell)

    /health {"status":"ok"}
    /ready  {"status":"ready",
             "database":{"ok":true,"PostgreSQL 17.6"},
             "postgis":{"ok":true,"3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"}}

Six endpoints probed anonymously, all 401 - registered and auth-guarded:
route recommendation, reroute assessment, reroute accept, offline package,
driver trip, route select.

Teardown verified: parent and its spawned worker both confirmed as this
session's own (`parent_pid=29836`, user `patel`) before stopping. Port
released; **no python process left on the machine**. No other session's process
was touched at any point tonight.

### DB cleanup - and a wrong first conclusion, corrected

A read-only sweep found **17,267 test users retained** and flagged them as
leftovers. That was wrong, and reading the cleanup routine before acting is
what caught it.

The retention is deliberate and documented in `tests/factories.py`:
`audit_logs.actor_user_id` is RESTRICT (migration 0004), so an audit row pins
its actor and a user who has done anything auditable - including a failed login
- **cannot** be deleted. That is the intended production behaviour, and the
suite lives with it rather than weakening the constraint to tidy a development
database.

They are DEACTIVATED instead, which is the property that actually matters.
Verified read-only:

    retained test users          17,267
      still ACTIVE                    0   <- refresh tokens deleted, is_active false
      with refresh tokens             0
    cert-mgr users                    7   (dspcert.invalid, p7cert.invalid)
      still ACTIVE                    0
      with refresh tokens             0
    test accounts off .invalid        0   RFC 6761; only unique_email() produces these
    non-test accounts                 5   (1 active) - untouched by this session

A retained account has no way in: the password path fails the `is_active` check
in `app/api/deps.py`, and the token path has nothing to present.

**Nothing was deleted.** No mass-delete was performed and none was warranted.
Had the count been a genuine leak, the correct action would still have been to
report it rather than clear 17,000 rows from a shared database at 01:35.

### Two more guards, after certification

**The offline package is small enough to actually download.** Measured across
realistic geometry sizes: 10-25 KB for `overview=simplified`, which is 2-5
seconds on a 40 kbit/s rural 2G link; `overview=full` would be 243 KB and
around 50 seconds. A package a driver cannot fetch in the field is not an
offline feature, and the retry happens wherever they are when they notice it
failed. Now guarded by a test that plants a 500-vertex route and asserts the
response stays under 120 KB - generous on purpose, because it exists to catch
an order-of-magnitude regression and a ceiling tight enough to fail on ordinary
drift is one somebody raises without thinking.

**The driver screen's honesty is now tested logic.** `ProgressCard` formatted
its numbers inline on a screen this project has no way to test - there is no
React Native testing library installed, and the app's convention is that logic
is tested and screens are thin. The formatting IS logic: it is where "null is a
word, never a number" is enforced, and the backend's care in sending `null`
rather than `0` is undone entirely by a formatter that renders it as "0.0 km".

Extracted to `src/screens/progressFormat.ts` with 15 tests covering the
distinction that matters - a MEASURED zero still renders as "0.0 km", because a
truck that has genuinely arrived should say so, while an ABSENT figure renders
as a word. NaN and Infinity are refused rather than rendered, since JSON can
carry both. And nothing any formatter produces contains a clock time or the
word "arrival".

driver-app is now **96 passed**, up from 25 at the start of the session.

### Final test state

- backend — **721 passed, 5 skipped, 0 failed**
- driver-app — **84 passed**, `tsc --noEmit` clean
- manager-web — **63 passed**, `tsc -b` clean, oxlint 0 errors, `vite build` OK

Baselines entering the session: backend 548, driver-app 25, manager-web 48.

---

## 2026-09-02 (early hours) — Calibration, and a feature that barely fired

**TIME** 2026-09-02 ~00:35 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · `OTHER_WRITER_ACTIVE = NO`

Three findings this loop, all from running the real rules over realistic
numbers rather than from a failing test. Every existing test used synthetic
inputs where the defect could not appear.

### BUG NER-B05 — four of five weather samples inside 17% of the route

Recorded in full above. Sampling by INDEX followed the vertex clustering that
`overview=simplified` produces at bends, putting four of five points in the
first 43.6 km of a 263.7 km corridor. Fixed by sampling by cumulative distance;
the same corridor now samples at exact quarters.

### Calibration check — is the reroute floor reachable at all?

Before changing anything, the scoring rule was run over realistic monsoon
values on the 305 km / 221 min corridor:

    dry, calm                  15  LOW
    moderate rain              33  MODERATE
    heavy rain (~IMD heavy)    60  HIGH    <- triggers
    extreme + severe gusts     85  HIGH    <- triggers

Sound: it does not fire on ordinary weather and does fire on heavy rain. The
threshold lands where IMD's own "heavy rainfall" line does, which is a
defensible place for it to be.

Rain intensity saturates at 7.5 mm/h, so a heavy shower and a cloudburst score
the same on rain. That is deliberate - the same bounded saturation the
distance, duration and recurrence components use - and it is now PINNED by
test rather than left implicit, because it is also a real limit on what the
recommendation can distinguish. Raising the ceiling is not free: the floor of
60 is calibrated against this exact curve, so stretching the scale would drop
heavy rain below the floor and stop the feature firing at all. Re-tuning both
together needs calibration data this project does not have.

### BUG NER-B06 — the reroute advisory barely fired on real NER corridors

- **SEVERITY** P2, **live**, and in the flagship feature.
- **SYMPTOM** heavy rain along the WHOLE corridor, by route length:

        60 km /  60 min    48   no
       150 km / 130 min    53   no
       250 km / 190 min    58   no
       305 km / 221 min    60   YES
       500 km / 420 min    73   YES

  Rain alone could not raise an alert below roughly 300 km. **Most NER
  logistics corridors run 100-300 km** - Guwahati to Shillong is about 100,
  Guwahati to Tezpur about 180 - so the advisory would have stayed silent on
  the majority of real trips while every test stayed green.
- **ROOT_CAUSE** `route_risk.score` mixes CONDITION (weather, up to 70 points)
  with EXPOSURE (distance and duration, up to 30). That mix is correct for
  CHOOSING BETWEEN two routes, where a longer detour genuinely costs more time
  on the road. It is the wrong question for "has this road deteriorated":
  exposure is a property of the journey, not of the storm sitting on it, and
  gating on the total gives a short trip a 20-25 point handicap it can never
  make up. **A cloudburst does not become acceptable because the trip is
  short.**
- **RED_TEST** `TestSevereConditionsDoNotNeedALongTrip`, five tests.
- **FIX** a second, ADDITIVE trigger. `RouteRisk.condition_points` sums the
  rain and wind components only, and deterioration is now
  `score >= DETERIORATION_FLOOR` **or**
  `condition_points >= SEVERE_CONDITIONS_FLOOR`. Additive by construction, so
  nothing that raised an alert before can stop doing so.
- **THE THRESHOLD, AND ITS ARITHMETIC** 35 out of a 70-point conditions
  ceiling. In the rule's own terms that is heavy rain over about three fifths
  of the corridor or more - heavy rain at full coverage scores 45, at 4/5
  coverage 41, at 3/5 coverage 36 - while a single heavy sample in five scores
  27 and does NOT trigger, because a squall crossing the road is not the road
  going bad. Published on the API as `severe_conditions_points` for the same
  reason the floor is: a rule nobody can see is a rule nobody can argue with.
- **VERIFIED BEHAVIOUR** exposure alone still cannot raise an alert - a long
  trip in fine weather (29 total, 0 conditions) stays NO_ACTION. A long trip
  that already fired still fires.

New reason code `SEVERE_CONDITIONS_ON_ROUTE`, named separately from
`SELECTED_ROUTE_DETERIORATED` because "the whole corridor is under heavy rain"
and "this is a long trip in poor weather" call for different phone calls.

**The coverage guard caught me, which is what it is for.** Adding a reason code
without translating it fails the backend suite; all three catalogue copies were
updated together and the mirrors re-verified byte-identical. 47 codes, 16
spoken.

### Verification after all three fixes

- **full backend regression — 714 passed, 5 skipped, 0 failed** (19m11s)
- manager-web — 63 passed, tsc clean, oxlint 0 errors, build OK
- driver-app — 84 passed, tsc clean

One failure appeared in an EARLIER run and was classified rather than patched:
`test_the_catalogue_has_no_codes_the_backend_cannot_emit` failed because that
suite had imported `reroute.py` before `REASON_SEVERE_CONDITIONS` existed and
then read a catalogue that already contained `SEVERE_CONDITIONS_ON_ROUTE`. A
race between a running suite and this session's own edits - **TEST_INFRA, not
an APPLICATION_DEFECT**. Re-run cleanly: 90 passed. The orphan check was doing
its job; it simply saw a half-applied change.

Type drift caught in the same pass: `severe_conditions_points` had been added
to the API response and not to the manager client's `RerouteAssessment` type.
TypeScript would not have complained - extra JSON fields are silently ignored -
so the type would have quietly stopped describing the wire.

### Property sweep, and one trap closed by construction

**1,600 candidate pairs** across a grid of realistic scores and route shapes,
asserting the four properties that must hold for EVERY pair rather than for the
handful somebody thought to write:

- never advise the riskier route;
- never switch below the published margin;
- every switch carries its tradeoff;
- asymmetric evidence never switches, **at any score gap** - the gap it
  produces is largest exactly when the missing factor matters most, because
  weather only ever ADDS points and the unmeasured route looks best when the
  storm is worst.

Zero violations. Kept as `TestPropertiesHoldAcrossTheWholeInputRange` rather
than thrown away as a script: a rule fails in the gaps between examples, and a
dispatcher acting on a recommendation cannot check it against the components
the way a reviewer can.

**A latent trap of NER-B01's shape, closed before it could bite.**
`condition_points` originally listed its component codes inline. A future
visibility or flood component would then have been scored, shown on screen, and
still invisible to the reroute trigger - a factor missing from the one set that
decides. `CONDITION_COMPONENT_CODES` and `EXPOSURE_COMPONENT_CODES` are now
named constants, and a test asserts they do not overlap and together cover
everything `assess` can emit. Adding a component now forces a decision about
which side of the line it falls on.

### Files changed this loop

- `backend/app/domain/routing.py` — distance-based `sample_positions`
- `backend/app/domain/route_risk.py` — `RouteRisk.condition_points`
- `backend/app/domain/reroute.py` — `SEVERE_CONDITIONS_FLOOR`, second trigger
- `backend/app/api/trips.py` — `severe_conditions_points` on the wire
- `backend/tests/test_routing.py`, `test_route_risk.py`, `test_reroute.py`
- `i18n/reason_codes.json` + both mirrors

---

## 2026-09-01 (late night) — A P1 found by reading the diff, and the docs caught up

**TIME** 2026-09-01 ~23:15 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · `OTHER_WRITER_ACTIVE = NO`

### BUG NER-B03 — nothing could select a route

- **SEVERITY** P1. Not latent. It broke the core demo workflow.
- **SYMPTOM** No UI path set `trips.selected_route_id`, so **three separate
  features silently degraded to their empty states** and looked like features
  that do not work:
    - the driver's `progress` returned `null`;
    - the reroute advisory answered `NO_SELECTED_ROUTE` -> `NO_ACTION`;
    - the offline package returned `selected_route: null`,
      `NO_ROUTE_SELECTED`.
- **ROOT_CAUSE** `api.selectRoute` had existed in the manager client since P7
  and **no component ever called it**. Planning wrote `trip_routes` rows; the
  hinge between planning and execution had no control attached to it.
- **HOW IT WAS FOUND** grepping the session diff for consumers of every API
  method, not by a failing test - nothing tested it because nothing called it.
  This is the shape of gap that a green suite is worst at catching.
- **RED_TEST** `FleetPage.test.tsx` -> "choosing which route the trip follows",
  four tests, all red.
- **FIX** a "Use this route" action and a "Following this route" state in the
  planned-route panel. `activeRoute.state === 'SELECTED'` is surfaced rather
  than implied by list order, because a planned route and the route a trip is
  FOLLOWING are different things and the whole reroute feature turns on the
  difference. Accepting a selection clears any advisory on screen: it was
  computed against a different selected route, or none, so it now describes the
  wrong comparison.
- **VERIFY** manager-web 63 passed, `tsc -b` clean, oxlint 0 errors, build OK.

#### Two of my own mistakes, caught by tooling and fixed rather than worked around

`tsc` rejected a test helper typed `(typeof ROUTE)[]` - the fixture's literal
narrows `state` to `'PROPOSED'`, so it could not accept a SELECTED route.
Widened to `TripRoute[]`.

`oxlint` flagged `useThisRoute` as a rules-of-hooks violation. It was right:
the `use` prefix is reserved, and a plain async click handler is not a Hook.
Renamed to `followThisRoute`, which is also the clearer name.

### Documentation caught up with the code

`docs/API_CONTRACTS.md` documented the route surface only as far as P8, so four
implemented endpoints were undocumented - and the document's own banner names
**section 15 as the authority on what exists**, which made the gap a
correctness problem rather than a tidiness one.

Added: the section 9 table rows, four detail sections (route recommendation,
reroute, offline corridor package, route progress) each carrying the refusals
that make them defensible, and four rows in section 15.

`docs/AI_MODELS.md` gained **§0a — why the landslide model is blocked,
specifically.** It already said no model has been trained; it did not say why
that is not merely "not built yet". The reason is that no surveyed source
publishes "this road is open again", so there is **no ground truth** for "was
this road passable on this date" - the label any such model would need. A model
fitted on these inputs could not be shown to beat a baseline, which that
document's own Rule 1 forbids. `AI_ML = BLOCKED_BY_DATA`, with the consequence
that the honest sequence is collect evidence, label it, then ask whether a
model beats the rule.

### Files changed this loop

- `manager-web/src/pages/FleetPage.tsx` — selection state, `followThisRoute`,
  "Use this route" / "Following this route"
- `manager-web/src/pages/FleetPage.test.tsx` — 4 new tests
- `manager-web/src/i18n/reasonCodes.ts` + `reasonCodes.json` (third mirror)
- `backend/tests/test_reason_code_coverage.py` — parametrised over both mirrors
- `backend/tests/test_reroute_api.py` — concurrent-accept test
- `docs/API_CONTRACTS.md`, `docs/AI_MODELS.md`

### Golden-path E2E

`backend/tests/test_golden_path_e2e.py` — one test, the whole journey, in
order, over real HTTP. It exists for the failure every other suite here is
worst at: a chain where each link is tested and the chain is not connected.

That is not hypothetical. NER-B03 was exactly that shape - server tested,
client method present, nothing calling it, everything green. The gap was only
visible by walking the path.

    plan routes (backup_planned: true)
      -> recommendation advises the BACKUP - storm on the primary, beating the
         published margin
      -> the manager selects the PRIMARY anyway   (the rule advises; a person
         decides, and the reroute path then has somewhere to propose away from)
      -> dispatch DRAFT -> ASSIGNED
      -> the driver sees it, can_start, starts -> ACTIVE
      -> offline package: selected route, a real backup, basemap BUNDLED_NONE,
         risk snapshot stamped with when it was taken
      -> a GPS fix -> progress on_route, 0 < fraction < 1, still no ETA
      -> reroute assessment: PROPOSE, primary -> backup
      -> a person accepts -> the trip is on the backup, the primary is demoted
         to PROPOSED (not SUPERSEDED), one ROUTE_CHANGED event with the manager
         recorded as the actor
      -> the driver is now measured against the NEW road: off_route,
         VEHICLE_OFF_PLANNED_ROUTE

The last assertion is the one worth defending. The truck has not moved but the
road under it has, so the honest answer is off-route - which is exactly what a
dispatcher needs to see after rerouting a truck that is already driving. A
version that silently re-projected onto the new corridor would hide the one
fact that matters at that moment.

It also pins the precondition NER-B03 broke: after planning and before
selecting, `trips.selected_route_id` must still be `None`.

### BUG NER-B04 — the driver's distance and the manager's did not agree

- **SEVERITY** P2. Not latent; it would have shown at the first demo where
  anyone compared the two screens.
- **SYMPTOM** `travelled + remaining` was measured along the stored polyline.
  That geometry is `overview=simplified` - this project asks OSRM for it
  deliberately, because `full` returns 5,213 points for one Guwahati-Jorhat
  route (`osrm.py:129`) - and a simplified polyline is **always shorter** than
  the road, because smoothing only ever cuts corners. The manager's panel shows
  the provider's `distance_km` for the same route. One road, two numbers, and
  nobody able to say which was wrong.
- **HOW IT WAS FOUND** not by a failing test. By running the projection over
  the real Guwahati-Jorhat coordinates as a sanity check and noticing the
  polyline came to 254.9 km against a stated 305 km. Every test until then used
  synthetic straight lines, where the two agree by construction.
- **ROOT_CAUSE** distances derived from the geometry rather than from the
  provider's own total.
- **RED_TEST** `TestDistanceAgreesWithTheProvider`, five tests.
- **FIX** `planned_distance_km` scales the reported distances to the provider's
  total. The **fraction is untouched** - it comes from the geometry, because
  that is the shape and the shape is what a position projects onto; scaling a
  length must not move the truck along it. The pace now derives from the same
  distance the driver is shown, so remaining time and remaining distance cannot
  disagree with each other. A zero or negative total is ignored rather than
  obeyed: a nonsense figure must not erase the geometry's honest answer.
- **VERIFY** route_progress 24 passed; offline_package + golden-path E2E 20
  passed.

Also checked while there, and correct: progress is monotonic non-decreasing
along the corridor, 0.0 at the origin and 1.0 at the destination, 50 m off the
line reads on-route and 5 km reads off-route with the right separation.

### BUG NER-B05 — four of five weather samples in 17% of the route

- **SEVERITY** P2, and **live**, not latent. It affected real routing data.
- **SYMPTOM** `sample_positions` spread its points evenly **by index**. This
  project asks OSRM for `overview=simplified`, which keeps more vertices where
  the road bends and few on long straight legs - so on a NER corridor the
  vertices crowd into the hills, and index sampling follows them there.

  Measured on a corridor shaped like that: **four of five points fell inside
  the first 43.6 km of a 263.7 km route.** 220 km - 83% of the corridor - was
  represented by a single reading.
- **WHY IT MATTERS** `route_risk` scores from these samples; the recommendation
  and the reroute assessment score from that. A storm sitting on the unsampled
  stretch would be seen once out of five times and scored as a local shower -
  and the whole reroute feature exists to notice exactly that storm.
- **HOW IT WAS FOUND** not by a failing test. By running the sampler over a
  corridor shaped the way `simplified` output actually is, and looking at where
  the points landed. Every existing test used evenly-spaced synthetic lines,
  where by-index and by-distance agree by construction.
- **RED_TEST** `TestWeatherSamplingIsSpreadByDistance`, six tests.
- **FIX** sample by cumulative distance. Endpoints are always included -
  origin and destination are the two places a dispatcher assumes were looked
  at. After the fix the same corridor samples at 0 / 65.9 / 131.8 / 197.8 /
  263.7 km: exact quarters.

  The old docstring argued that spacing does not matter because weather varies
  over tens of kilometres. True of mild unevenness, false of a 4-in-17%
  cluster. It also worried about a cumulative pass over "thousands of points" -
  but `simplified` returns hundreds, and one O(n) walk is nothing beside the
  five HTTP requests the samples exist to make.

- **A second defect inside the fix, caught before it shipped.** Snapping each
  target to the nearest real vertex looked tidier, and on a sparse leg it
  collapsed: with no vertex between 128 km and 263 km, two different targets
  snapped to the same endpoint and **one of five weather requests was spent
  asking about a place already asked about**. Switched to interpolating along
  the segment - the point is still ON the route, and where it is on the road is
  the only thing a weather query cares about. Five distinct points now.

- **SCOPE** `is_distinct_corridor` deliberately still uses the by-index
  sampler. It compares two routes against each other rather than covering one,
  and its 2 km threshold is tuned against that behaviour. Changing it would be
  a different decision needing its own evidence.

- **The test's own measurement was wrong too.** Its helper located each sample
  by nearest VERTEX, which reports an interpolated point 66 km along as being
  at 44 km. The assertions happened to pass either way - which is exactly the
  problem, since a test that measures the wrong thing can pass for the wrong
  reason. Rewritten to project onto the segments.

### Tests

- manager-web — **63 passed**, tsc clean, oxlint 0 errors, build OK
- driver-app — **84 passed**, tsc clean
- backend reroute — 28 passed; reason-code coverage — 15 passed
- golden-path E2E — 1 passed
- full backend regression — **694 passed, 5 skipped, 0 failed**; re-running
  with the E2E added

---

## 2026-09-01 (late night) — Diff audit, and the driver app catches up

**TIME** 2026-09-01 ~22:45 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · `OTHER_WRITER_ACTIVE = NO`

### Code review over the whole session diff

Ran the review loop across everything written tonight rather than only
per-task.

**Secret scan** — clean across every changed and new file: no keys, no
connection strings, no tokens. **Debug scan** — clean; the single `TODO` hit is
a comment in `offline_package.py` explaining that `BUNDLED_NONE` is *not* a
TODO.

**Lock-order audit.** Every path touching both `trips` and `trip_routes` takes
`trips` first: `routes.plan` (after the provider call, deliberately),
`routes.apply_selection`, and `reroute.accept`. No `users` lock was added
tonight, so the existing users-then-trips ordering that closes the
dispatch/deactivate ABBA is untouched. `reroute.accept` re-locks the same trip
row inside `apply_selection`, which is a no-op within one transaction rather
than a deadlock.

**Transaction lifetime.** `candidates_for_trip` and `assess_route` both END the
transaction before any provider call, so every DB read in
`offline_package.build_for_trip` happens BEFORE the risk assessment. Asserted
from inside the stub in three separate suites.

#### Two findings, both fixed

1. **Dead code.** `reroute.selected_route()` had no callers - I wrote it and
   never used it. Removed, along with the `select` import it was the only user
   of. A helper that reads as a used contract and is not one costs a reader
   more than it saves.

2. **A broad `except` that could hide my own bug.**
   `offline_package.build_for_trip` catches everything around the risk
   assessment so a weather outage cannot block the download of a route that
   cannot be recomputed on the roadside. That is right - but a bare swallow
   would hide an `AttributeError` in this module just as quietly as a provider
   timeout, and the two need very different responses. Now
   `logger.exception(...)` before the reason code, so a real bug surfaces as a
   traceback instead of a field that is mysteriously always absent.

### Driver app: progress, offline storage, and language

**`CurrentTrip.progress` had drifted.** The backend started returning it and
the driver client's type did not know. Added, with the same no-ETA
documentation the backend carries.

**`ProgressCard` on the trip screen.** Distance left, travelled, and time left
at the planned pace - each rendering as a WORD when null rather than a zero,
because "0 km left" at the start of a shift is a lie the app would be telling
by itself. Off-route is stated first and in words, never colour alone, because
it is the fact that decides whether anything below it means anything.

**`OfflinePackageStore`** (`src/offline/packageStore.ts`), built on the same
`KeyValueStore` seam as the GPS queue - one storage boundary, one set of
corruption rules. The age is the product: `read()` never returns a bare
package, only one with its `ageMs` and `CURRENT`/`STALE`, computed from the
device clock so it works with no network. Every freshness guarantee upstream is
undone by a screen that renders a nine-hour-old snapshot silently, and this is
the last place that rule can be enforced.

Its write REJECTS on a storage failure, which is the opposite of the GPS
queue's behaviour and deliberately so: the queue must keep collecting through a
full disk because a truck is moving, whereas a download that did not save is a
download that did not happen, and a driver told it succeeded would go offline
with nothing.

A package left over from the previous trip is refused by `isFor` - a
plausible-looking route to somewhere the driver is not going, with every figure
reading as current, is worse than having none.

**Language, with no new dependency.** `Intl` ships with Hermes, so the device
locale is readable without `expo-localization` and without a native module
nobody can verify on hardware tonight. English is the FALLBACK, not the
default: a phone set to Bengali gets English because this build has no Bengali,
and the moment one is added to the catalogue it wins. A missing `Intl` falls
back rather than crashing - an internationalisation API must not be the reason
a driver cannot see their trip.

**Task 11's loop is now closed.** The trip screen renders
`progress.reason_codes` through `translateReasonCode` in the resolved language.
Backend emits a code, the catalogue turns it into a sentence, the phone shows
it - with no model and no network call anywhere in that path.

### Files changed this loop

New
- `driver-app/src/offline/packageStore.ts` + `.test.ts` (18)
- `driver-app/src/i18n/language.ts` + `.test.ts` (10)

Modified
- `backend/app/services/reroute.py` — dead helper removed
- `backend/app/services/offline_package.py` — log the swallowed exception
- `driver-app/src/api/client.ts` — `RouteProgress`, `OfflinePackage` and
  friends, `offlinePackage()`
- `driver-app/src/screens/TripScreen.tsx` — `ProgressCard`, translated codes

### Tests

- driver-app — **84 passed** (was 56), `tsc --noEmit` clean
- backend reroute + offline package — 46 passed after the two fixes
- full backend regression — **692 passed, 5 skipped, 0 failed** (taken before
  the two fixes above; being re-run)
- manager-web — 59 passed, build OK

### Manager app reads the same catalogue

`manager-web/src/i18n/reasonCodes.ts` over a third mirror of the root
catalogue, and the advisory now renders every reason code the server sent in
words rather than restating them in hand-written prose. A manager and the
driver they are about to phone must not be reading two different wordings of
the same warning.

`test_reason_code_coverage.py` was parametrised to cover both mirrors, and
**the guard was verified by breaking it**: a one-byte change to the manager
copy failed the test, restoring it passed. A drift guard that cannot fail is
not a guard.

### Concurrency: two managers accepting a reroute at once

`trips.load_for_update` issues `SELECT ... FOR UPDATE`, but SQLAlchemy returns
the identity-map object when one is already present rather than overwriting it
with the freshly-read row. Whether the second transaction sees the first one's
committed `selected_route_id` therefore rests on the Trip NOT already being in
that request's session - which is true today, and was an argument rather than a
guarantee.

Now measured. `TestConcurrentAccepts` races two independent app instances at
one trip: exactly `[200, 409]`, the trip lands on the backup, and **exactly one**
`ROUTE_CHANGED` event exists. Two would mean the trip recorded a change it did
not make, and an incident review would read a reroute that never happened.

### Known risks

- `ProgressCard` is untested UI. That matches the app's existing convention -
  logic is tested, screens are not - and the report must not imply otherwise.
- `OfflinePackageStore` still has no durable backing store wired, for the same
  reason the GPS queue does not: the dependency is not installed and no claim
  about device behaviour will be made without hardware. The logic is complete
  and tested; the wiring is one constructor argument.
- The manager web app still renders reason codes as hardcoded English. The
  catalogue is shared and the resolver is driver-app-local.

---

## 2026-09-01 (late night) — Reroute reaches a dispatcher

**TIME** 2026-09-01 ~22:20 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · `OTHER_WRITER_ACTIVE = NO`

Phase 7's reroute was a backend contract with no way for a human to use it,
which is the same problem as a feature that does not exist. The manager fleet
screen now has a **Route advisory** section, so a dispatcher watching a live
truck can check the road it is on and accept a reroute.

### Where it sits, and why

Directly below "Planned route" in the selected-trip panel, because it is a
statement ABOUT that route: has the road got worse, and is there anywhere
better to send it.

**Nothing is assessed until a dispatcher asks.** FleetPage already refuses to
plan routes on selection - "doing that merely because someone clicked a truck
would spend a provider budget on idle curiosity" - and the advisory follows the
same rule for the same reason: one assessment costs up to ten requests to a
free weather service, and polling it would multiply that by every open browser
tab. A test spies on `rerouteAssessment` and asserts it was never called.

### The three outcomes, rendered as three different things

`ALERT_ONLY` gets its own block: *"Conditions have worsened. No better route
exists. Contact the driver."* - and **no Accept button**, because there is
nothing to accept. This is the case a propose-or-stay-silent UI has no words
for, and on a single corridor it is the common one. The words carry it, never
colour alone.

`PROPOSE` shows the tradeoff in the units the decision was made in: risk
points, minutes, kilometres. `queryByText(/%/)` is asserted null - "54% safer"
is a claim about probability of harm that nothing here measures.

`NO_ACTION` states the current score and the floor it did not reach, so a
dispatcher can see the rule rather than infer it.

### What the tests pin

- **Rendering a proposal is not applying it.** `acceptReroute` is asserted
  never called after a proposal appears, and the panel says so in words.
- **The stale-screen guard reaches the wire.** Accept sends the route id that
  was ON SCREEN - asserted as `(tripId, 'r1', 'r2')` - which is the only thing
  that makes the server's 409 `ROUTE_SUPERSEDED` meaningful. A 409 surfaces its
  message rather than being swallowed.
- **It re-assesses after accepting** rather than leaving a stale proposal up:
  the trip is now on a different road, so every figure in the old advisory
  describes the wrong one, and leaving it would invite a second click the
  server would refuse.
- The datasets it was made WITHOUT are named on screen.
- `RISK_INPUTS_NOT_COMPARABLE` renders as a warning that the scores are not
  directly comparable.

### Two of my own assertions were wrong, and the tests were the bug

`queryByText(/predict/i)` failed on the panel's own disclaimer, which reads
"not a prediction" - the sentence doing the work. `queryByText(/accuracy/i)`
failed on the panel's GPS accuracy reading, a measured metres figure with
nothing to do with a model metric. Both were narrowed rather than the UI being
changed: banning those words would have been banning honest text to catch a
claim nobody was making.

### Files changed this loop

- `manager-web/src/api/client.ts` — `RouteRecommendation`, `RerouteAssessment`,
  `RouteTradeoff`, `RouteComparison`, `RerouteAccepted` types;
  `routeRecommendation`, `rerouteAssessment`, `acceptReroute`
- `manager-web/src/pages/FleetPage.tsx` — advisory state, two actions, render
- `manager-web/src/pages/FleetPage.test.tsx` — 11 new tests

### Tests

- manager-web — **59 passed** (was 48), `tsc -b --noEmit` clean, oxlint 0
  errors (2 pre-existing warnings), `vite build` OK
- full backend regression — re-running at time of writing

### Known risks

- The advisory is only on the fleet screen. There is no planning-time
  recommendation UI on TripsPage; the endpoint exists and nothing consumes it.
- The driver app does not consume the offline-package endpoint either. Both are
  tested contracts without a screen, and the final report must say so.

### Runtime verification (22:30 IST)

Port 8137, verified free before binding.

    PID           15116
    WINDOWS USER  LAPTOP-VQP9OF8E\patel      <- own process, not another session's
    EXECUTABLE    ...\Python311\python.exe
    COMMAND LINE  python.exe run.py
    STARTED       2026-09-01 22:30:09
    PARENT PID    36088 (this session's shell)

    /health  {"status":"ok"}
    /ready   {"status":"ready",
              "database": {"ok": true, "PostgreSQL 17.6"},
              "postgis":  {"ok": true, "3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"}}

All four new endpoints registered and auth-guarded, 401 anonymous:
`GET /api/trips/{id}/routes/recommendation`, `GET /api/trips/{id}/reroute`,
`POST /api/trips/{id}/reroute/accept`,
`GET /api/driver/me/trip/offline-package`.

**One finding, classified rather than patched.** The first attempt used
`python -m uvicorn` and `/ready` answered
`database: unreachable (InterfaceError)`. That is TEST_INFRA - an operator
error - not an APPLICATION_DEFECT: `run.py` exists precisely because uvicorn
creates its event loop before importing the application, so the Windows
selector-policy fix has to run before uvicorn is even imported, and
`app/main.py:48` already warns about exactly this. Re-running through `run.py`
gave a fully ready service. **No application code was changed**, which is the
correct outcome - patching the app for a DNS/loop/invocation failure is how a
real defect gets manufactured.

Teardown: the uvicorn worker outlived its parent and kept the port. It was
confirmed as this session's own child (`parent_pid=15116`, user `patel`) before
being stopped; port 8137 no longer serves. No other session's process was
touched.

### Next task

Certification: diff audit, secret scan, and the final report.

---

## 2026-09-01 (late night) — Route progress, and multilingual reason codes

**TIME** 2026-09-01 ~22:00 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · `OTHER_WRITER_ACTIVE = NO`

**FULL BACKEND REGRESSION: 655 passed, 5 skipped, 0 failed** (17m49s), taken
before the two test files below were added.

### TASK 10 — Driver route progress (not an ETA)

`app/domain/route_progress.py`. Pure arithmetic over a geometry the caller
already has: no provider call, nothing persisted, cheapest thing in the routing
stack.

**The planned route is not the observed track.** Progress is measured by
PROJECTING the last fix onto the planned line, and the distance between the two
comes back as `off_route_m` rather than being discarded - that gap is the most
useful number here, because it is how a dispatcher learns a truck has left the
corridor. When off-route the figures still return WITH the warning code;
suppressing them would leave a dispatcher with less than they had.

**It does not produce an ETA, and the naming is part of the guarantee.** A
provider's `duration` is a free-flow estimate over a road graph; it knows
nothing about this truck's load, the driver's break, a checkpoint queue, or
that it is already two hours behind. Publishing it as an arrival time would put
a timestamp on a screen that a customer gets told and nothing here stands
behind.

What ships instead is `remaining_at_planned_pace_min`, with
`planned_average_speed_kmph` beside it and the code
`REMAINING_TIME_ASSUMES_PLANNED_PACE`. The name states the assumption and the
assumption travels with the number. A test greps the dataclass for `eta`,
`arrival`, `arrives`, `due_at` and `arrive` and fails on any of them.

No provider duration means `None`, never a guess from a default speed - an
invented speed produces a figure indistinguishable on screen from a measured
one. Likewise no position means `None`, not zero: a truck with no fix has not
arrived.

`OFF_ROUTE_THRESHOLD_M = 200` is wide on purpose. Consumer GPS in a hill valley
is routinely tens of metres out, a dual carriageway's two directions can be
forty metres apart, and a provider polyline is a simplification of the road
rather than a survey of it. A tighter threshold produces an alert a dispatcher
learns to ignore, which is worse than no alert.

A dog-leg test pins that progress follows the ROUTE and not straight-line
distance: on a route that doubles back, a truck near the end is physically near
the start, and straight-line distance would call it barely started.

### TASK 11 — Multilingual reason codes (English, Hindi, Assamese)

`i18n/reason_codes.json` - 45 codes across five backend modules, each with
`en`/`hi`/`as` and an explicit `speak` boolean.

This is the payoff for a convention the project has followed from the start:
the backend NEVER builds a sentence. It emits `HEAVY_RAIN_ON_ROUTE`, and the
app turns that into Assamese from a file shipped inside it - no model, no
network call, no server round trip. A driver in a valley with no signal reads
the same warning as one parked in Guwahati.

**The drift guard is the valuable part.** `test_reason_code_coverage.py` fails
the backend suite when:

- a `REASON_*` constant has no entry (it would reach a driver as raw
  SHOUTING_SNAKE_CASE, which on a safety alert is unreadable at exactly the
  moment someone needs to read it);
- an entry is missing a language;
- an entry has no `speak` decision - voice is opt-in per code, never inferred;
- a reason code contains a space or is not upper-case, i.e. a sentence escaped
  from the backend;
- the catalogue carries a code no module emits;
- the driver app's mirror differs from the root file by a byte.

The mirror exists because Metro will not resolve imports above the app root
without extra configuration, so the app bundles `src/i18n/reasonCodes.json`. A
copy nobody checks is a fork with a delay on it, hence the byte-identical
assertion.

`driver-app/src/i18n/reasonCodes.ts` resolves a code with the fallback chain
requested-language -> English -> the code itself. It never throws and never
renders nothing: an unknown code is a newer backend or a rolled-back app, and
the raw code on screen is ugly but a dispatcher on a support call can act on
`VEHICLE_OFF_PLANNED_ROUTE` and nobody can act on "".

**Voice scope is deliberately narrow** and asserted from both sides. Spoken:
road closed, route deteriorated, off planned route, better route available, no
better alternative, heavy rain, strong gusts, basemap not bundled. Silent:
season, missing datasets, un-estimated distances, stale readings. Reading
narration aloud would bury the warnings that matter, and a driver who learns to
tune the voice out has lost the feature entirely. `MAX_SPOKEN_ALERTS = 3` -
anything cut is still on screen. There is no voice-triggered mutation of any
kind; the layer only reads.

**HONEST BOUNDARY - the Hindi and Assamese strings are UNREVIEWED by a native
speaker.** They are careful; they are not certified. This is recorded inside
the catalogue file itself rather than only here, so it cannot be lost. Nothing
should be demonstrated to a judge as verified translation until someone fluent
has read them.

Also not built: static UI translation for the driver app's own labels, and any
speech engine binding. The reason-code layer is the part that could not be done
later without the backend convention holding, and it is the part that is done.

### Files changed this loop

New
- `backend/app/domain/route_progress.py`
- `backend/tests/test_route_progress.py` (20)
- `backend/tests/test_reason_code_coverage.py` (13)
- `i18n/reason_codes.json`
- `driver-app/src/i18n/reasonCodes.json` (enforced mirror)
- `driver-app/src/i18n/reasonCodes.ts`
- `driver-app/src/i18n/reasonCodes.test.ts` (14)

### Tests

- **full backend regression — 655 passed, 5 skipped, 0 failed**
- route_progress + reason_code_coverage — 33 passed
- driver-app — **56 passed** (was 42), `tsc --noEmit` clean

### TASK 10 (continued) — progress wired to the driver's screen

`GET /api/driver/me/trip` now carries a `progress` block. Null ONLY when the
trip has no selected route - progress along a corridor nobody chose is not a
degraded answer, there is no corridor. Every other gap, including having no
position at all, is expressed inside the object through its reason codes, so
the app has one shape to render rather than two.

Verified end to end with a real fix posted through `/api/driver/me/location`:
`on_route` true, `off_route_m` under the threshold, fraction strictly between 0
and 1, and `remaining_at_planned_pace_min` present alongside
`REMAINING_TIME_ASSUMES_PLANNED_PACE`.

A test walks the progress object's FIELD NAMES and rejects any containing
`eta`, `arrival`, `arrives`, `due_at` or `arrive`. Scoped to that block on
purpose: a stop's `planned_arrival_at` is a schedule somebody set, which is a
different thing entirely from a time this system derived and would then be
believed for. The first version of that test was too broad and failed on the
stop schedule - narrowing it was the right fix, not deleting it.

Cost: one extra statement per trip screen, reading one row's geometry through
`ST_AsText` like everywhere else. The assessment itself is arithmetic - no
provider call, no write.

### Known risks

- Translations unreviewed, as above.

### Blockers

None new. `AI_ML = BLOCKED_BY_DATA` stands.

### Next task

Wire `route_progress` to an endpoint, or stop and certify. Nothing large after
05:15.

---

## 2026-09-01 (late night) — Offline corridor and store-and-forward

**TIME** 2026-09-01 ~21:45 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · `OTHER_WRITER_ACTIVE = NO`

### TASK 8 — Offline corridor foundation

**The legal check came first and it changed the design.** The OSM Foundation
tile usage policy prohibits prefetch and "download area for offline use"
against `tile.openstreetmap.org`, which is exactly the source
`manager-web/src/components/FleetMap.tsx:56` uses. So no tile caching was
built, and none will be without a licensed source. Interactive browsing, which
is what the manager map does today, remains permitted.

Three things kept apart, because conflating them is how this feature gets
overclaimed:

    offline ROUTE     BUILT. The corridor already chosen, its geometry, stops
                      and estimates - computed online, carried offline. A
                      driver following a known road needs the road, not a
                      solver.
    offline ROUTING   NOT BUILT, NOT CLAIMED. Computing a NEW route with no
                      network needs a road graph on the device.
    offline BASEMAP   BLOCKED ON LICENCE. Declared as `BUNDLED_NONE` with
                      reason `BASEMAP_NOT_BUNDLED_LICENCE`, because a driver
                      discovering that gap in a valley is worse than being
                      told now.

`GET /api/driver/me/trip/offline-package`. Subject from the token like every
other driver route - no trip id in the path, nothing to bend. 404 rather than
null when there is no trip: `GET /me/trip` returns null because between-trips
is a normal screen, but asking to DOWNLOAD a journey that does not exist is a
request that cannot be satisfied, and null would leave the app guessing whether
to retry.

Honesty properties, each under test:

- **No invented backup.** On a single corridor `backup_route` is null with
  `NO_DISTINCT_BACKUP_CORRIDOR`. Handing a driver an escape road that does not
  exist, at the moment they most need one, is the worst thing this endpoint
  could do.
- **The risk block is a SNAPSHOT with `risk_captured_at`,** never presented as
  live. A weather panel still reading LIGHT RAIN ten hours into a signal
  blackout is the failure the timestamp exists to prevent.
- **A weather outage does not block the download.** The route is the part that
  cannot be recomputed on the roadside.
- **`package_hash` covers only durable parts** - identity, stops, geometry -
  so a driver on a thin connection does not re-download an unchanged route
  every time the sky changes. Tested: weather moving the score does not move
  the hash.
- Coordinates asserted inside the NER bounding box. A lat/lon swap fails
  silently on a map, so it is pinned rather than trusted.

Two small dedups fell out and were taken: `parse_wkt_point` now lives in
`app/domain/routing.py` beside `parse_wkt_linestring` (the lon/lat swap belongs
in one place) and replaces an inline copy in `routes._endpoints`; and
`_risk_read` became public `risk_read` now that two routers use it - importing
a private name across modules is how a refactor quietly breaks a caller it
could not see.

### TASK 9 — Offline GPS store-and-forward

**Verified rather than rebuilt.** The tracker already had a bounded queue with
oldest-first drop, exponential backoff, retryable/non-retryable classification
and `queueDepth`/`droppedCount` telemetry. The server already deduplicates on
`uq_gps_trip_device_fix` with `ON CONFLICT DO NOTHING`, returning
`duplicates_ignored` - which is what makes replay safe and is why the client
persists BEFORE sending and clears only AFTER acknowledgement.

The real gap was persistence: the queue lived in memory and died with the
process.

New `src/tracking/queueStore.ts`: a `QueueStore` boundary in the same shape and
for the same reason as the existing `LocationAdapter`, with `MemoryQueueStore`
(the default) and `PersistentQueueStore` over any `KeyValueStore`.

- **Hydrate merges restored fixes IN FRONT** of newly collected ones - they are
  older and the queue replays chronologically - dedupes on `device_fix_id`, and
  **re-applies the bound**, so a store written by a build with a larger limit
  cannot reintroduce an unbounded queue.
- **Corruption is expected, not exceptional.** Truncated JSON, a wrong envelope
  version, and entries that parse but are not fixes all yield an empty queue
  rather than a crash loop on a driver's phone at the start of a shift. Losing
  unsent positions is the lesser failure by a wide margin.
- **A failing disk degrades; it does not stop tracking.** New
  `persistence: 'memory' | 'durable' | 'degraded'`. A full disk keeps
  collecting and uploading from memory and stops CLAIMING durability, and
  recovers to `durable` when writes succeed again. A screen that went on
  claiming durability would be lying to a dispatcher about what happens if the
  phone reboots in a valley.
- `stop()` clears the store: the server refuses location for an ended trip, so
  a persisted queue would come back and retry forever against an endpoint that
  will never accept it.

**HONEST BOUNDARY - no device-backed store is wired in.**
`@react-native-async-storage/async-storage` and `expo-file-system` are not
installed, and no claim is made about Android or iOS process-death behaviour
without hardware. The app reports `persistence: 'memory'` today, which is the
truthful value. `KeyValueStore` matches AsyncStorage's shape, so wiring one is
a constructor argument.

### Files changed this loop

New
- `backend/app/services/offline_package.py`
- `backend/tests/test_offline_package.py` (15)
- `driver-app/src/tracking/queueStore.ts`
- `driver-app/src/tracking/queueStore.test.ts` (17)

Modified
- `backend/app/api/driver.py` — offline-package endpoint
- `backend/app/api/trips.py` — `risk_read` made public
- `backend/app/domain/routing.py` — `parse_wkt_point`
- `backend/app/services/routes.py` — uses it
- `driver-app/src/tracking/tracker.ts` — hydrate/persist, `persistence` state
- `driver-app/src/tracking/useLocationTracking.ts` — initial state

### Tests

- backend offline package — 15 passed
- backend driver_self + trip_execution + route_api + routing + telemetry +
  authorization — 200 passed
- driver-app — **42 passed** (was 25), `tsc --noEmit` clean
- full backend regression — re-running at time of writing

### Known risks

- The offline package is a backend contract with no driver-app consumer yet.
  It is tested over real HTTP and is not wired into a screen.
- `persistence: 'memory'` is the current truth. Anyone reading the code should
  not mistake the tested persistence LOGIC for a durable queue on a phone.

### Blockers

None new.

### Next task

Phase 10 driver live directions, or Phase 11 multilingual. Both are P2/P3;
neither should start after 05:15.

---

## 2026-09-01 (late night) — Reroute foundation, road memory, monsoon risk

**TIME** 2026-09-01 ~21:30 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · `OTHER_WRITER_ACTIVE = NO`

**FULL BACKEND REGRESSION: 609 passed, 5 skipped, 0 failed** (17m34s).
Baseline entering this session was 548 passed / 5 skipped.

### TASK 4 — Dynamic reroute foundation

`GET /api/trips/{trip_id}/reroute` · `POST /api/trips/{trip_id}/reroute/accept`

Three outcomes, not two:

    NO_ACTION     the road is not bad enough to reconsider
    ALERT_ONLY    it IS bad, and there is nothing better to offer
    PROPOSE       it is bad, and a genuinely better road exists

`ALERT_ONLY` is the one that makes this honest. Most of the North East is a
single corridor: when NH-715 floods there is frequently no second road, and a
system that only knows how to propose alternatives falls silent in exactly the
situation that matters most.

`DETERIORATION_FLOOR` is imported from `route_risk.BAND_HIGH_AT` rather than
repeated, so "we reconsider once it reads HIGH" stays one number. The floor is
necessary rather than tidy: without it every marginally-better parallel road
becomes an interruption, and proposals that arrive when nothing is wrong are
the ones that get dismissed unread.

The comparison is NOT re-invented - it is `route_recommendation.recommend`,
extended with an explicit `baseline_route_id`. A trip already rerouted once
must be compared against the road it is ON, not the primary it left; comparing
against the abandoned primary would measure the wrong gap and could propose
sending a driver back down a road abandoned for a reason.

Guarantees, each proven by test rather than asserted in prose:

- **Nothing reroutes itself.** Three consecutive assessments leave
  `selected_route_id` and the trip event count unchanged.
- **Stale screens are refused.** `from_route_id` must match the live
  selection; a second manager gets 409 `ROUTE_SUPERSEDED`, not a silent
  overwrite of a decision they never saw.
- **Atomic.** `routes.select_route` was split into a non-committing
  `apply_selection`, so the route change and its `ROUTE_CHANGED` timeline event
  land in ONE transaction. Monkeypatching the event write to fail leaves the
  trip on its original route - tested.
- **No model on the write path.** `RerouteAcceptRequest.model_fields` is
  asserted to be exactly `{from_route_id, to_route_id}`, and the event
  payload's six keys are asserted exactly.
- The road left behind is demoted to PROPOSED, **not** SUPERSEDED. Weather is
  not permanent; a corridor abandoned this afternoon may be right this evening,
  and marking it dead would make a reroute a one-way door.

#### BUG NER-B02 — the candidate cap could hide the road being driven

- **SEVERITY** P2, latent (unreachable while planning stores two routes).
- **SYMPTOM** with a third live route, `_live_route_facts`' LIMIT dropped the
  SELECTED route. `assess` then found no selected route among the candidates
  and returned NO_ACTION - a truck on a road that had just gone bad being told
  nothing at all, in the one case the cap was meant to make cheap rather than
  wrong.
- **ROOT_CAUSE** ordering was PRIMARY-then-oldest under a LIMIT.
- **RED_TEST** `test_reroute_api.py::TestTheSelectedRouteIsNeverTruncatedAway`
- **FIX** order SELECTED first, joining `Trip.selected_route_id`.
- **VERIFY** 80 passed across the routing subsystem; 609 in full regression.

`SCHEMA_APPLICATION_REQUIRES_APPROVAL = YES` for one narrow thing: recording a
DECLINED proposal. No existing `trip_event_kind` value honestly means "a
manager was offered a safer road and stayed", and misusing one would be a lie
in the audit trail. Prepared as
`docs/migrations/PENDING_reroute_decision_events.sql`, deliberately NOT an
alembic revision so no test run can apply it to shared Supabase. An ACCEPTED
reroute needs no migration and is fully recorded today.

### TASK 5 — Landslide/monsoon source research, and the road memory model

Survey written up in `docs/ROAD_MEMORY.md` with sources.

| Source | Machine-readable | Verdict |
|---|---|---|
| GSI Bhusanket forecasts | portal + app, no API | **BLOCKED** - began Darjeeling/Kalimpong + Nilgiris; Assam/NE coverage not confirmed |
| GSI Bhukosh / NGDR inventory | shapefile bulk download | **FEASIBLE** - offline one-time ingest |
| IMD api.imd.gov.in | 28 JSON endpoints, incl. Highway Nowcast Warning | **FEASIBLE** - but no auth, rate limit or licence stated in the public reference |
| ASDMA | web pages and PDFs | human-in-loop evidence source |
| Open-Meteo | already integrated | live rainfall on the corridor |

**The finding that drove the design: no source publishes "this road is open
again."** Reopening is decided by PWD/NHAI/BRO and communicated ad hoc. A
system fed by these sources watches roads break and never watches them mend, so
"no recent bad news" quietly reopens every closed road in the database a few
days after it closes. That is the default behaviour of the naive build and the
most dangerous failure this feature has available to it.

`app/domain/road_memory.py` therefore enforces, with tests:

- **Silence never repairs a road.** Asserted exhaustively over every starting
  state at horizons out to 400 days. The single time-driven transition is
  `REPAIR_REPORTED -> AWAITING_VERIFICATION`, which is strictly LESS usable.
  Time may only increase doubt.
- **Silence never closes one either.** An old `VERIFIED_OPEN` stays open and
  goes STALE. Freshness ages; status does not. Inventing closures strands cargo
  and teaches dispatchers to ignore the system.
- **Only observation opens a road.** `OPERATOR_REPORT` and `UNVERIFIED_REPORT`
  may raise doubt and never remove it. A driver saying "I heard it is clear" is
  hearsay; the same driver's truck actually driving through arrives as
  `FLEET_TRAVERSAL` and counts. That asymmetry is deliberate: refusing to
  record a rumoured slide until confirmed is how a truck gets sent into one.
- **UNKNOWN is not OPEN.** A road nobody has looked at is not a road known to
  be fine.

The belief is a FOLD over an append-only evidence log, never a stored status
column - so every belief traces to an observation, and a wrong answer traces to
the observation that caused it rather than to whoever last wrote the row.

`FLEET_TRAVERSAL` is the quiet advantage: every other participant in this
problem reads bulletins, while this system watches its own trucks and can
observe passability directly from GPS tracks it already stores.

`SCHEMA_APPLICATION_REQUIRES_APPROVAL = YES` -
`docs/migrations/PENDING_road_memory_tables.sql`, prepared and not applied. Two
additive tables plus two enums; no existing table touched. It restates
`CAN_OPEN` as a CHECK constraint, because an application guard is bypassed by
any script with a connection string and the failure it prevents puts a truck on
a hillside.

### TASK 6 — Monsoon Risk Engine V1

`app/domain/monsoon_risk.py`. Recurrence (40) + rainfall (35) + season (15) +
road-status doubt (10), summing to 100, on the same band thresholds as
`route_risk` so a dispatcher does not have to learn two scales.

The structural decision worth defending: **passability is not a score.** A road
an authority declared CLOSED is `NOT_PASSABLE`, not "risk 100" - because a
closed segment scoring 100 against an open one scoring 96 would be a
four-point preference for the road that exists. `passable` is a separate field
with three values and `NOT_PASSABLE` is a refusal, not a number.

`UNVERIFIED` is its own answer. A segment nobody has observed is neither safe
nor dangerous, and a caller treating it as passable has made a decision this
module declined to make for it.

Absent inputs are named: `recorded_incidents=None` ("no inventory coverage") is
distinct from `0` ("we looked and found none"), and the second is much rarer
than a naive ingest would suggest.

Recurrence saturates at four recorded incidents, not forty - the GSI inventory
records what was REPORTED, and demanding more would mostly measure how well an
area was surveyed.

### TASK 7 — ML gate: NOT MET

`AI_ML = BLOCKED_BY_DATA`, and honestly so. There is no labelled dataset of
road-segment outcomes - no ground truth for "was this road passable on this
date" - so there is nothing to train on and nothing to validate against. A
model on these inputs would produce a number with no way to check it, which is
worse than no number. Nothing in the codebase claims otherwise: `route_risk`,
`route_recommendation`, `reroute`, `road_memory` and `monsoon_risk` each carry a
version string naming a rule, and each has a test asserting no `confidence`,
`probability` or `model_version` field reaches the wire.

### Files changed this loop

New
- `backend/app/domain/reroute.py`, `backend/app/services/reroute.py`
- `backend/app/domain/road_memory.py`
- `backend/app/domain/monsoon_risk.py`
- `backend/tests/test_reroute.py` (11), `test_reroute_api.py` (16)
- `backend/tests/test_road_memory.py` (14), `test_monsoon_risk.py` (17)
- `docs/ROAD_MEMORY.md`
- `docs/migrations/PENDING_reroute_decision_events.sql` (NOT APPLIED)
- `docs/migrations/PENDING_road_memory_tables.sql` (NOT APPLIED)

Modified
- `backend/app/services/routes.py` — `apply_selection` extracted, non-committing
- `backend/app/services/route_recommendation.py` — `candidates_for_trip`
  extracted and shared; SELECTED-first ordering (NER-B02)
- `backend/app/domain/route_recommendation.py` — explicit `baseline_route_id`
- `backend/app/api/trips.py` — reroute endpoints, `_recommendation_read`
  extracted

### Tests

- **full backend regression — 609 passed, 5 skipped, 0 failed**
- road_memory + monsoon_risk — 31 passed
- reroute domain + API — 27 passed
- routing subsystem — 80 passed

### Known risks

- `DETERIORATION_FLOOR` and `MIN_RISK_MARGIN_POINTS` are project constants, not
  calibrated thresholds. They are defensible, in one place, and returned in
  every response so they can be argued with. Nothing claims they are tuned.
- `road_memory` and `monsoon_risk` have no persistence and no adapter to any
  source. They are a tested foundation, not a running feature, and the progress
  report must not describe them as one.
- IMD's public API reference documents no licence or rate limit. Fine for a
  prototype; not a dependency to lean on without checking.

### Blockers

`AI_ML = BLOCKED_BY_DATA`. Persistence for road memory blocked on migration
approval.

### Next task

Phase 8 — offline corridor research and foundation. Verify current provider and
licence position for offline map data BEFORE implementing, and keep OFFLINE MAP
separate from OFFLINE ROUTING.

---

## 2026-09-01 (night) — Trip multiplicity semantics, and route recommendation

**TIME** 2026-09-01 ~22:15 IST · **HEAD** `f850de4` (unchanged) · **committed** NO
· **pushed** NO · **WORKTREE** dirty, previous certified work preserved intact

`OTHER_WRITER_ACTIVE = NO` (no python/pytest/uvicorn processes; only this
session's own vite dev server, pid 2992). The repo directory is owned by Windows
user `nxtlu` while this session runs as `patel`, so a `safe.directory` exception
was added to this user's global git config. Config only; nothing in the tree was
touched by it.

### TASK 1 — certified dirty-tree review

`BASELINE_CERTIFIED_DIRTY_TREE = YES`. Sixteen modified files, two untracked,
+771/-17 against `f850de4`. Secret scan clean, no debug output, no stale TODO.
`Trip.driver_id` confirmed write-once (`trips.py:377` is the only assignment),
which is what makes the unlocked pre-read in `dispatch()` sound. Lock order
users-then-trips is consistent across `trips.dispatch`, `drivers.deactivate` and
`assignments._refuse_if_a_trip_is_underway`, all three sorting by `Trip.id`.
Not re-run: the certified totals stand, and source was unchanged at that point.

### TASK 2 — multiple non-terminal trips: SEMANTICS, then one real defect

The reviewed observation was that a driver can hold several non-terminal trips.
Traced rather than assumed. It is three questions with three answers:

| trips per driver | verdict | why |
|---|---|---|
| many DRAFT | allowed | planning; nothing is committed to anybody |
| many ASSIGNED | **intended** | `driver_trips.current_trip` orders by `dispatched_at` and takes one — a queue that only means something if more than one can exist |
| many in-transit | **forbidden** | and structurally impossible: `driver_trips.start` (line 232) is the ONLY writer of ACTIVE, and can only act on the single trip `current_trip` resolves |

So the multiplicity itself is not a defect and **no database uniqueness
constraint is needed**. `SCHEMA_APPLICATION_REQUIRES_APPROVAL = NO` for this
task; no migration was written or applied.

The structural invariant had no test, which is one refactor away from being an
accident, so it now has five — including two concurrent starts over independent
app instances landing exactly one ACTIVE.

#### BUG NER-B01 — an incident trip is silently replaced by a queued one

- **SEVERITY** P2. Latent: no service writes INCIDENT yet, so it is not live.
- **SYMPTOM** With a trip at INCIDENT and another ASSIGNED, the driver's app
  shows the ASSIGNED one as current and will start it. `COMMITS_DRIVER_TO_TRUCK`
  already asserts the driver is physically with the first truck, so the system
  would contradict a fact it states elsewhere, and the fleet map would show one
  person driving away from a vehicle they are standing next to.
- **ROOT_CAUSE** `trips.OPEN_TRIP_STATUSES` listed ASSIGNED/ACTIVE/DELAYED. It
  is the only filter `current_trip` applies, so INCIDENT was not merely sorted
  late — it was invisible, and the queue head advanced past it.
- **RED_TEST** `tests/test_trip_multiplicity_invariant.py::TestIncidentTripIsNotAbandoned`
- **FIX** two lines. `OPEN_TRIP_STATUSES += INCIDENT`; and `current_trip`'s first
  sort key changed from `IN_PROGRESS_STATUSES` to
  `COMMITS_DRIVER_TO_TRUCK ∩ OPEN_TRIP_STATUSES`. The second came out of
  reviewing the first: membership alone left the incident trip winning only
  because no reachable sequence produces an earlier-dispatched queued trip — a
  safety invariant resting on an argument about reachability.
- **SIDE_EFFECT** none. `OPEN_TRIP_STATUSES` has exactly one consumer. Every
  mutating driver path still gates on `IN_PROGRESS_STATUSES`, so an INCIDENT
  trip is now visible and blocking but not actionable — `TRIP_NOT_STARTABLE`,
  which is the correct failure while a stuck truck waits on a human.
- **VERIFY** 124 passed across multiplicity + trip_execution + trip_state +
  driver_self.

### TASK 3 — Explainable Route Recommendation V1

`GET /api/trips/{trip_id}/routes/recommendation`. Not called AI anywhere, and
`version` is pinned by a test to `explainable-route-recommendation-v1`.

New: `app/domain/route_recommendation.py` (pure rule),
`app/services/route_recommendation.py` (evidence gathering), plus the endpoint
and three response schemas in `app/api/trips.py`. `_risk_read` was extracted so
the standalone risk endpoint and the per-candidate blocks cannot drift into
describing one score two different ways.

The rule: baseline is PRIMARY; a switch is advised only when a comparable
alternative is lower by `MIN_RISK_MARGIN_POINTS = 10`. Below that the gap is
noise on inputs this coarse and a detour is not free — but the figures are still
returned, because a manager overruling the rule deserves the numbers the rule
used.

What makes it defensible is what it refuses to do:

- **One corridor stays one corridor.** No backup is invented;
  `ONLY_ONE_ROUTE_AVAILABLE`, `comparable: false`. Much of the North East is a
  single road, and that is a truthful answer rather than a degraded one.
- **No percentages.** Deltas in points, minutes and kilometres — the units the
  inputs arrived in. A test asserts `%`, `confidence`, `probability`,
  `predicted` and `model_version` never reach the wire. "54% safer" is a claim
  about probability of harm, and nothing here measures that.
- **Asymmetric evidence refuses to recommend.** The failure a naive comparison
  walks into: weather only ever ADDS points, so a route the provider failed on
  scores lower purely from the missing factor — and it fails most readily in a
  storm, which is exactly when it matters. When the available-input sets differ
  the comparison is declined with `RISK_INPUTS_NOT_COMPARABLE` and the baseline
  is kept.
- **NULL stays NULL.** A route with no duration estimate reports a `None` delta,
  never 0, and sorts last among equals rather than first.
- Superseded and blocked routes are excluded: history is evidence, advice is
  about what to do next.

Bounded cost: `MAX_CANDIDATE_ROUTES (2) × ROUTE_SAMPLES (5)` = at most ten
weather requests per call. The endpoint is a considered read, not a feed, and a
client must not poll it.

The database connection is released before any provider call, asserted from
inside the stub at the moment the request leaves the database's hands.

### Files changed this loop

New
- `backend/app/domain/route_recommendation.py`
- `backend/app/services/route_recommendation.py`
- `backend/tests/test_route_recommendation.py` (15)
- `backend/tests/test_route_recommendation_api.py` (11)
- `backend/tests/test_trip_multiplicity_invariant.py` (8)

Modified
- `backend/app/services/trips.py` — `OPEN_TRIP_STATUSES`
- `backend/app/services/driver_trips.py` — `current_trip` ordering key
- `backend/app/api/trips.py` — recommendation endpoint, schemas, `_risk_read`

### Tests

- multiplicity + trip_execution + trip_state + driver_self — **124 passed**
- recommendation + risk + route_api + routing — **103 passed**
- authorization + rls_boundary + schema_drift + schemas — **70 passed**
- full backend regression — not yet re-run this loop

### Runtime

Not runtime-verified against a bound port this loop. Everything above is
exercised over real HTTP through ASGI.

### Known risks

- `MIN_RISK_MARGIN_POINTS = 10` is a project constant, not a derived threshold.
  It is defensible and lives in one place; it is not calibrated, and nothing
  claims it is.
- NER-B01's fix makes an INCIDENT trip visible and blocking. Whoever implements
  the ACTIVE→INCIDENT transition still needs a resume path, or a driver will see
  a trip they cannot act on. That is the safe failure, not a finished one.
- The keyless routing fallback is still the public OSRM demo server, and
  Open-Meteo still has no contractual uptime.

### Blockers

None.

### Next task

Phase 7 — dynamic reroute foundation on an ACTIVE trip: fresh risk evaluation, a
meaningful-deterioration test, explicit propose/accept. No silent rerouting and
no model writing trip state.

---

## 2026-09-01 (evening) — Driver dispatchability: foreign work adopted, deadlock fixed

**HEAD** `f850de4` (unchanged) · **committed** NO · **pushed** NO

### FOREIGN_DRIFT_BASELINE

`AUTHORED_BY_CURRENT_SESSION = NO` · `ADOPTED_FOR_REVIEW = YES`

Twelve files arrived in the working tree between 18:05 and 18:16 from another
session, after this session pushed `f850de4` at ~17:45. This session detected
them, stopped, and waited for that writer to go quiet (files stable from 18:14,
their pytest exited 18:30:37) before touching anything.

Baseline fingerprints (sha256 prefix, at 18:30:57) are in the run log. The ten
files this session did NOT modify were re-verified byte-identical afterwards.

### The foreign work, reviewed

It is sound, and it covers the defect properly:

- `_load_driver` joins `User.is_active`, locks `FOR UPDATE OF users`, refuses
  with `409 DRIVER_LOGIN_INACTIVE` - and genuinely runs on the dispatch path,
  not only at trip creation.
- `drivers.deactivate()` takes the users lock BEFORE scanning for live trips,
  with a correct argument for that order, and refuses with
  `409 DRIVER_HAS_LIVE_TRIP`.
- `REQUIRES_DRIVER_LOGIN` is a new canonical state set, correctly distinguished
  from `COMMITS_DRIVER_TO_TRUCK`: "would disabling this login strand a trip"
  versus "is this pairing a physical fact".
- `DriverRead.login_is_active`, and a `LOGIN INACTIVE` / "Cannot be dispatched"
  badge stated in words rather than by colour.

Baseline before any edit by this session: **100 passed**.

### Defect found in it: ABBA deadlock

    dispatch    load_for_update(trip)  ->  _load_driver  = trips, then users
    deactivate  lock users             ->  lock trips    = users, then trips

Opposite orders on the same two rows. PostgreSQL breaks that by aborting one
side with SQLSTATE 40P01, and nothing in `app/` handles 40P01 - so the operator
meets a 500 exactly where the design promises a clean 409, under precisely the
race the feature exists to defend.

The existing race test could not catch it: it accepts either winner, and a
deadlock aborts the loser without writing a bad row, so the final state still
looks consistent.

**Fixed on the dispatch side**, because deactivation's order is load-bearing -
it must hold the login before it looks for live trips, or a dispatch in flight
turns a DRAFT trip into an ASSIGNED one behind its check. Dispatch now reads
the write-once `trip.driver_id` unlocked, takes the users lock, then the trip
lock. Proven red first (`order=['trips', 'users']`), then restored
byte-identical and green.

### Added by this session

- `test_dispatch_takes_the_login_lock_before_the_trip_lock` - asserts the order
  directly, so it catches the bug every run instead of when timing cooperates.
- `test_the_race_never_answers_with_a_server_error` - a deadlock is a 500, not
  a corruption; that is the symptom worth pinning.
- `test_deactivate_refuses_a_driver_on_an_active_trip` - Phase 5 case C.
- `scripts/certify_dispatchability.py` - bound-port runtime certification.

### A clarification worth recording

`POST /api/drivers/{id}/deactivate` is a coherent soft-delete: it sets
`deleted_at`, moves the driver to SUSPENDED and disables the login together,
and the driver then leaves the listing. It **cannot** produce the reported
state. `AVAILABLE` + inactive login + still listed only arises when
`users.is_active` is cleared OUT OF BAND - a direct database edit, or the
test-account hygiene sweep. That is what the runtime certification reproduces,
and it is the case the `login_is_active` badge exists for.

### Results

- foreign patch, unchanged: 100 passed
- targeted matrix: 202 passed · concurrency: 7 passed
- manager: 48 passed, typecheck PASS, build PASS, 0 lint errors, 2 pre-existing warnings
- authoritative backend: **547 passed, 5 skipped, 0 failed** (15m59s, no source drift)
- runtime, bound port 8014, PID 12752 owner patel: **17/17**, both flows, cleanup clean

### OBS-DB-1 (attribution UNKNOWN, authorization UNKNOWN)

Read-only. Not cleaned. Surviving non-test rows: trips `TRP-MTII4P75` (CLOSED)
and `CERT-9FDC249C` (CANCELLED), shipment `SHP-MTII4P75`, 2 trip_routes,
10 gps_points, 5 active users (1 MANAGER, 4 DRIVER). Both trips are terminal,
so nothing is stranded. 15,870 audit rows untouched.

### ENV-1 (attribution UNKNOWN)

`backend/.venv/pyvenv.cfg` was repointed from `nxtlu` to `patel`.
`pyvenv.cfg.bak` preserves the original exactly, so **restoration is possible**
and is a five-line file. `.venv/` is gitignored, so none of this reaches git.
NOT executed. Recommended: restore the `.bak` so nxtlu's environment works
again, and keep per-user venvs outside the tree - note there are now two
patel-owned ones (`.venvs
er-ai-logistics`, `.venvs
er-backend`).

---

## 2026-09-01 — Infrastructure defect: the suite lock leaks behind the pooler

**HEAD** `7914251` (unchanged) · **committed** NO · **pushed** NO

### What happened

The full backend regression launched after the risk engine returned
**74 failed, 436 passed, 242 errors in 2h14m** — against ~510 passed in ~10
minutes earlier the same day.

That result is **INVALID, not a regression.** Two distinct causes, both
environmental:

**1. The network dropped mid-run.** The dominant error was
`[Errno 11001] getaddrinfo failed` (DNS resolution failure) alongside
`server closed the connection unexpectedly`. Every database-dependent test then
failed or errored, and the 13x duration is retries against an unreachable host.
DNS and TCP to the database were re-verified healthy afterwards.

**2. A stale advisory lock then blocked every retry.** This is the real find,
and it is a genuine defect in the test infrastructure.

    pytest run dies without teardown
      -> client process gone
      -> Supabase's pooler (Supavisor) keeps the SERVER session alive and idle
      -> the session-level advisory lock survives on that session
      -> every future run is refused, indefinitely

Confirmed by inspection: holder backend `state='idle'`,
`application_name='Supavisor'`, idle for over four minutes and not recycling,
while **zero** pytest processes existed on the machine.

`pg_advisory_unlock_all()` only affects the calling session, so there is no way
to release another session's lock except to end that session. Recovery was a
guarded `pg_terminate_backend` that fired only for a pid still holding this
exact 64-bit lock identity. No rows were read, written or deleted.

Afterwards `tests/test_rate_limit.py` returned **18 passed** — so the 7 failures
seen mid-incident were contamination, not a rate-limiter regression.

### Why this matters beyond today

The suite lock exists to stop two runs destroying each other's fixtures, and it
does that well. But its failure mode is silent and total: a crashed run leaves
the project untestable with an error message that tells the operator to "wait
for the other run to finish" when there is no other run. Anyone hitting this
without the `pg_locks` query would conclude the database was broken.

### Fixed

`tests/conftest.py` now names the holder when it refuses. Verified by holding
the lock from a second session and observing the real output:

    Held by backend pid=284211, state='idle', idle for 0:00:12, session age 0:00:13.

    If NO pytest process is running on this machine, that session is orphaned:
    its client died and the pooler kept the server session alive, so the lock
    leaked. Confirm there is no live run, then release it with
        SELECT pg_terminate_backend(284211);
    which ends only that connection and changes no data.

Deliberately **not** auto-terminating. A legitimately running suite also sits
`idle` between statements, so any heuristic here would eventually kill
somebody's real run. The diagnostic informs a human and lets them decide.

The change is confined to the `if not acquired:` branch plus a module-level
newline constant; the acquire path is untouched. Re-verified that a normal run
still takes the lock (`tests/test_health.py` — 9 passed) and re-ran the full
suite afterwards, because conftest is foundational.

### Lesson recorded
A long run that gets dramatically slower is an infrastructure signal, not a
code signal. Reading the error signatures first (`getaddrinfo failed`) cost two
minutes and prevented chasing 74 imaginary regressions.

---

## 2026-08-31 — Route Risk Engine V1 (Phases 4 + 5)

**HEAD** `7914251` (unchanged) · **worktree** dirty, uncommitted · **committed** NO · **pushed** NO

### Current phase
Phase 4 (weather becomes useful) and Phase 5 (deterministic route risk V1) — delivered.
Phases 6–15 not started.

### Completed this loop

Weather stopped being an orphan library and became an application feature.

Before this loop `app/domain/weather.py` and `app/services/weather/` were
imported by nothing outside their own tests — a provider with no consumer.
There is now a path from a persisted route to an explained risk score:

    trip route geometry (PostGIS)
      -> parse_wkt_linestring
      -> sample_positions (5 points along the corridor)
      -> release the DB connection
      -> Open-Meteo, 5 requests concurrently
      -> WeatherObservation, freshness-checked
      -> route_risk.assess  (deterministic, published constants)
      -> GET /api/trips/{trip_id}/routes/{route_id}/risk

### Files changed

New
- `backend/app/domain/route_risk.py` — scoring rule, no I/O
- `backend/app/services/route_risk.py` — sampling, provider fan-out, DB lifetime
- `backend/tests/test_route_risk.py` — 19 tests, injected clock
- `backend/tests/test_route_risk_api.py` — 9 tests over real HTTP

Modified
- `backend/app/domain/routing.py` — `sample_positions`, `parse_wkt_linestring`
- `backend/app/api/trips.py` — `RouteRiskRead`, risk endpoint, WKT parser deduplicated
- `backend/app/services/routes.py` — `ensure_belongs_to_trip`
- `backend/app/core/config.py` — `WEATHER_PROVIDER_URL`, `WEATHER_TIMEOUT_SECONDS`, `WEATHER_ENABLED`

### Design decisions worth defending

**It is not AI, and it does not pretend to be.** A weighted rule with constants
in one file. There is no `confidence`, no `model_version`, no
`predicted_delay`. A test asserts those fields are absent, because the moment
one appears the system is claiming training and validation that never happened.

**Absent datasets are named, not omitted.** The response carries
`inputs` and `unavailable`, so `landslide: NOT_AVAILABLE` is visible next to
the score. A dispatcher shown a bare "37/100" assumes it is complete, and that
assumption is the dangerous one.

**Stale observations are never scored.** A reading older than the freshness
window is counted and reported but excluded. A test pins the specific failure:
a stale *calm* reading must not dilute live heavy rain, which is exactly when a
naive average would understate risk.

**A weather outage is not a request failure.** The endpoint returns 200 with
`weather: NOT_AVAILABLE` and a `WEATHER_UNAVAILABLE` reason code. Distance and
duration remain real evidence, and a 503 would show a dispatcher nothing at all
because a free API had a bad minute.

**Reason codes, not sentences.** `HEAVY_RAIN_ON_ROUTE`, not "Heavy rain is
affecting your route." Phase 11 needs the driver app to render Hindi and
Assamese from local files with no LLM in the loop; a sentence built on the
server arrives untranslatable.

**Nothing is persisted.** A risk score is a statement about *now*. Storing one
would leave a number that looks current long after it stopped being true — the
same failure as a stale GPS fix rendered LIVE. No migration was needed.

**Thresholds are project-defined and labelled as such.** The rain and gust
cut-offs are this project's operational constants, not an official
meteorological standard, and the module says so.

### Root causes fixed earlier in the same session
- `routes.plan()` held a pooled connection across the provider call
  (measured `pool.checkedout() == 1`, `idle in transaction`) → released with
  `commit`, not `rollback`, because rollback expires the `actor` and raises
  MissingGreenlet.
- A successful login cleared the **per-IP** rate-limit budget, so one valid
  credential bought unlimited credential spraying → per-IP reset removed.
- `POST /api/assignments/{id}/end` had no guard against a live trip, and
  `create()` reached the same state inline in one call → `COMMITS_DRIVER_TO_TRUCK`
  guard on both paths, with `FOR UPDATE` on non-terminal trips to close the race.

### Test results
- `tests/test_route_risk.py` — 19 passed
- `tests/test_route_risk_api.py` — 9 passed
- routing + weather + risk + config + schemas subsystem — 155 passed
- full backend regression — running at time of writing

### Runtime results
Not runtime-verified against a live server this loop. The weather provider was
verified against the real Open-Meteo service in an earlier loop (Guwahati,
units asserted). The risk endpoint has been exercised over real HTTP through
ASGI, not through a bound port.

### IMPLEMENTED
- Deterministic route risk V1 with explainable components
- Weather sampled along a real route corridor
- Explicit input-availability reporting
- Freshness handling that refuses to score stale data
- Route-scoped authorization on the risk endpoint (IDOR closed)
- DB connection released before provider I/O

### PARTIALLY_IMPLEMENTED
- P7 routing — PRIMARY always, EMERGENCY_BACKUP only for a genuinely distinct
  corridor, FUEL_EFFICIENT never; no driver-app rendering; no scoring of routes
  against each other yet
- Weather — one provider, no fallback chain, no caching

### NOT_IMPLEMENTED
- Phase 6 weather-aware route comparison and recommendation
- Phase 7 dynamic rerouting
- Phase 8 offline corridor mode
- Phase 10 physical Android certification
- Phase 11 multilingual, Phase 12 voice
- Phases 13–15 POIs, battery/network risk, SOS

### Known risks
- The keyless fallback is the public OSRM demo server. Its policy grants no
  quality guarantee and allows withdrawal without notice. Acceptable for
  development; a live demo depending solely on it is a real risk.
- Open-Meteo is free for non-commercial use and has no contractual uptime.
- Five weather requests per assessment. Bounded, but a UI that polls this
  endpoint would multiply it — the client must not poll it like telemetry.

### Blockers
None.

### Next task
Phase 6 — weather-aware comparison of PRIMARY against a real EMERGENCY_BACKUP,
with a recommendation that states its reason in the same units it compares
(minutes and risk points), and no invented percentage claims.

## DRIVER_APP_MISSION_BASELINE

Recorded before any Driver-App mission edit, so new work is separable from the
already-certified dirty tree. Not a commit; a fingerprint.

    HEAD / origin/main   f850de456d03bdcf776bafd1bcd8377f89b763c0 (identical)
    tracked modified     32 files
    untracked            40 files
    diff                 32 files changed, 4701 insertions(+), 60 deletions(-)

    manager MapLibre fix PRESENT - FleetMap.tsx setWorkerUrl(?worker&url),
                         FleetMap.worker.build.test.ts, production
                         route + observed-track rendering certified
    manager tests        64 passed
    backend tests        544 passed / 5 skipped (last full run)
    driver tests         96 passed across 6 files

    android toolchain    ABSENT - no Android SDK, no adb, no gradle,
                         java 1.8.0_401 (Expo SDK 57 / RN 0.86 needs JDK 17+)
    expo account         NOT LOGGED IN, eas-cli not installed, no eas.json
    driver-app native    no android/ or ios/ - managed Expo, prebuild required
