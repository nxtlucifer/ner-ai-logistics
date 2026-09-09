# Supabase backend migration

Started 2026-09-07 IST, continuing from [TERRAIN_COMMAND_MISSION.md](TERRAIN_COMMAND_MISSION.md)
(its evidence is untouched). Mission brief:
`C:\Users\patel\Downloads\NER-AI-Supabase-Backend-Migration-Mission.txt`.

**Lead answer: no. A physical Driver APK cannot yet use a hosted backend without
the laptop.** The driver core journey — trip, accept, start, location — is now
implemented and proven locally (87/87 database checks, 89/89 route-progress
parity, 378 driver tests), and the transport switch is real. But **nothing is
deployed**, no Edge Function has ever been executed, and the manager surface is
untouched, so every hosted and phone gate remains NOT RUN. Details under
*Blocker*.

## State

- Repository `D:\Projects\ner-ai-logistics`, branch `main`, HEAD
  `f850de456d03bdcf776bafd1bcd8377f89b763c0` — **unchanged**.
  COMMITTED = NO; PUSHED = NO; DEPLOYED = NO.
- Terrain Command redesign preserved; no client screen was modified in this
  mission. The proven `.easignore` archive fix (`!/driver-app`, no trailing
  slash) is intact and was re-verified.

## Why the APK cannot reach a backend today — root cause, from the artifact

`driver-app/src/api/client.ts::resolveBaseUrl()` resolves, in order:
`EXPO_PUBLIC_API_BASE_URL` → Expo dev-server `hostUri` → `http://localhost:8000`.
The `preview` profile in `eas.json` sets the first to `http://172.24.85.80:8000`.

Confirmed in the shipped artifact rather than inferred from `.env`: the Hermes
bundle inside `final-eas-9e136a14-vc3.apk` contains exactly one API base string,
`http://172.24.85.80:8000`, and no surviving `localhost:8000` fallback literal.

So the effective endpoint is a **private RFC-1918 LAN address over plain HTTP**.
On mobile data that address is simply not routable from the handset, and the
failure is at the **network-reachability layer** — a connect timeout or
unreachable-host error.

**Correction to the previous mission's report.** It stated that a DHCP change
would produce "a cleartext-blocked failure rather than a timeout". That was
wrong, and it matters because it points at the wrong layer. The scoped network
security config permits cleartext *for `172.24.85.80` specifically*; if the
laptop moves to another address the APK still dials `172.24.85.80`, which fails
to connect. A cleartext-policy error would only appear if the app targeted some
*different* plain-HTTP host that the exception list does not cover.

The manager web client has the same class of default:
`VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'`.

## Verified Supabase facts

Read-only inspection of the project configured in `backend/.env` and `.mcp.json`
(`znaveeefzgfxsblsobdb`, ap-south-1, PostgreSQL 17.6). No writes were made.

| Fact | Value | Consequence |
| --- | --- | --- |
| PostGIS | 3.3.7, in schema `extensions` | `spatial_ref_sys` is *not* in `public` there, so the RLS audit test that fails locally passes on the real project. The prior mission's TC-07 is confirmed local-cluster-only. |
| Application tables | 18, **all RLS enabled, all with zero policies** | Deny-all. Safe today because only FastAPI (as `postgres`, `rolbypassrls`) connects — and the exact reason nothing works through the Data API until policies exist. |
| `auth.users` | **0 rows** | Supabase Auth is entirely unused. Every identity lives in `public.users`. |
| Schema version | `alembic_version` = `0006_current_assignment_unique` | The hosted project is **three migrations behind** the code (0007 review authorizations, 0008 driver acceptance, 0009 route maneuvers). `route_review_authorizations` does not exist there. |
| Password hashes | **argon2id, all 19,870**, PHC `$argon2id$v=19$m=65536,t=3,p=4$...` | Supabase documents support for bcrypt **and Argon2** via Auth Admin `createUser(password_hash)`. Import expected to work; **not yet verified end to end** - see Corrections 1. |

### The data is almost entirely fixture pollution

| Bucket | Rows | Active |
| --- | ---: | ---: |
| `%@p3test.invalid` (the incident's fixture pattern) | 19,827 | 0 |
| other `.invalid` | 33 | 0 |
| genuine accounts | 10 | 5 |

11,826 `DRIVER`-role users have no `drivers` row at all. `audit_logs` holds
31,147 rows from 2026-08-30 to 09-06. Referential integrity across the *real*
subset is clean — trip→driver, stop→trip, route→trip, gps→trip and driver→user
orphan counts are all **0**.

The real dataset is ~86 rows: 10 users (5 active), 5 drivers, 3 trucks, 4
assignments, 2 shipments, 2 cargo items, 3 trips, 6 stops, 4 routes, 16 events,
31 GPS points.

Superseded by the evidence-based manifest in Corrections 2: **10 include,
19,827 exclude_fixture, 33 unresolved**. Nothing is deleted; the 33 need a
decision from you.

## What is built and proven

`supabase/migrations/` — four ordered files, applied in this order:

| File | Contents |
| --- | --- |
| `20260907120000_app_authz_core.sql` | `app` schema (not Data-API exposed); `current_user_id`, `current_role`, `has_perm`, `current_driver_id`, `is_fleet_staff`, `can_read_trip`. All SECURITY DEFINER helpers pin `search_path=''`, schema-qualify every object, and have EXECUTE revoked from PUBLIC. |
| `20260907120100_data_api_grants_rls.sql` | Explicit Data API grants + RLS policies for 15 tables. Column-level grants keep `password_hash` and `base_salary_monthly` unreadable. **No write grants at all** on operational tables. `refresh_tokens`, `alembic_version`, `system_info` deliberately get no grant. |
| `20260907120150_auth_identity_mapping.sql` | The `auth.users.id == public.users.id` invariant, why there is no FK, and `app.identity_status()` for linkage health. |
| `20260907120200_guarded_transitions.sql` | `app.accept_trip()` and `app.submit_location()` — the only write paths a client has. |

### Proof

`backend/scripts/rls_harness.py` — **106/106 checks pass**.

It builds a disposable database (`ner_supabase_rls_test`), runs `alembic upgrade
head`, installs a faithful copy of Supabase's own `auth.uid()` (reading
`request.jwt.claim.sub`), applies the four migrations, seeds a manager and two
drivers, then asserts as `anon` / driver A / driver B / manager.

Findings the harness produced that assertion-by-inspection would have missed:

1. **A bug in the harness itself.** `rollback()` reverts `SET ROLE` to the
   session user, who *owns* the tables and therefore bypasses RLS. Four checks
   were silently passing/failing as the owner. Every statement now
   re-establishes its identity.
2. **`app.current_user_id()` needs `USAGE` on `auth`.** It is SECURITY INVOKER,
   so it depends on a grant hosted Supabase happens to provide. The migration
   now declares that dependency instead of inheriting it.
3. **A hole that would have been real in RLS only.** `DRIVER` holds
   `has_perm('driver:read')`, so a policy resting on it alone would let any
   driver read the whole roster. `app.is_fleet_staff()` closes it. The existing
   FastAPI API does **not** have this weakness - see Corrections 4.

Checks cover: anon reads 0 rows from 4 non-empty tables; driver A/B trip and
location isolation; roster scoping; `password_hash` and salary unreadable even
by a manager; direct UPDATE/DELETE/INSERT refused for reassignment, role
self-promotion and GPS injection; guarded accept idempotent under replay with
exactly one `ACCEPTED` event; accept not inheritable across drivers; location
replay deduplicated on `(trip_id, device_fix_id)`; future-dated and
out-of-range fixes rejected; identity linkage reporting.

**Scope limit, stated plainly:** this is a *database-layer* proof. GoTrue token
issuance, PostgREST routing, Realtime authorization and Edge Function auth are
**not** exercised. `supabase start` needs Docker, which this machine does not
have (`docker` and `deno` are both absent; Supabase CLI 2.116.0 is present).

## Corrections to this report's earlier revision

Four claims in the first revision were wrong. They are retracted here with the
evidence that settles each. Two of them would have caused real harm if acted on.

### 1. RETRACTED: "argon2id cannot be imported into Supabase Auth"

**Wrong.** Supabase's Auth0 migration guide states that Supabase supports
**bcrypt and Argon2** password hashes, imported through the Auth Admin
`createUser` method's `password_hash` parameter (stored in
`auth.users.encrypted_password`).

This application produces standard PHC-format hashes:
`$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>` (97 chars), parameters from
`docs/SECURITY.md` section 1 - t=3, m=64 MiB, p=4 - verified against
`app/core/security.py`.

**Consequence: no password reset is required, and none should be performed.**
The earlier plan to issue new credentials for the 5 active accounts is
withdrawn. No reset email was sent and no plaintext password was requested.

**Still NOT RUN:** an end-to-end import + sign-in of a synthetic argon2id
account. It needs either a local Supabase stack (`supabase start`, which needs
Docker - absent) or Auth Admin access to the project (blocked). Exact procedure,
to run as soon as either exists:

1. Mint a synthetic hash with the app's own hasher at the same parameters.
2. `POST /auth/v1/admin/users` with `{email, password_hash, email_confirm:true}`
   using the service_role key.
3. `POST /auth/v1/token?grant_type=password` with the plaintext and assert 200
   plus a JWT whose `sub` equals the supplied id.

Until that runs, argon2id import is **supported-by-documentation,
unverified-in-this-project**. It must not be reported as a proven capability.

### 2. CORRECTED: the account inventory now reconciles on evidence

The earlier split classified accounts by email pattern. `inactive` is not
`disposable`, and a deactivated real account is indistinguishable from a fixture
by address alone. `backend/scripts/migration_manifest.py` (read-only; no DDL, no
DML) classifies every account by whether anything depends on the row - a
`drivers` record, an authored trip or trip event, or session history.

| Bucket | Accounts | Rule |
| --- | ---: | --- |
| `include` | **10** | active, or has a drivers row, or authored a trip/event, or has sessions |
| `exclude_fixture` | **19,827** | `%@p3test.invalid` **and** no driver row, no trip, no event, no session |
| `unresolved` | **33** | everything else - needs a human decision |
| total | **19,870** | reconciles exactly |

The 33 are **unresolved, not excluded**, and are now a recorded decision:
preserved exactly as they are, not imported into Auth at cutover. All 33 are
uniformly inactive, `.invalid`, with no driver row, no authored trip or event
and **no session** — see Revision 3 for the correction to an earlier sentence
that mis-described them. Nothing is deleted by any of this.

**Table-count reconciliation:** `public` holds **20 relations** locally, of
which `spatial_ref_sys` is PostGIS-owned, giving **19 application tables**. The
hosted project has **18**: it lacks `route_review_authorizations` (migration
0007, unapplied) and has no `spatial_ref_sys` in `public` because PostGIS lives
in `extensions` there. 19 - 1 = 18. Manifest at
`.runtime/supabase-migration/manifest.json`.

Referential integrity across the whole hosted dataset: **all six orphan checks
are 0** (trip to driver, trip to shipment, stop to trip, route to trip, gps to
trip, driver to user).

### 3. RETRACTED: "importing the fixtures would blow past Free-tier MAU"

**Wrong.** Supabase bills **monthly active users** - distinct users who sign in
or refresh a token during the billing cycle. Stored rows in `auth.users` are not
MAU. Importing 19,860 dormant identities would not, by itself, incur any MAU.

The case for excluding them rests on different and better grounds: they are test
residue with nothing depending on them, and importing them would make the
identity table meaningless. That is hygiene, not billing.

### 4. RETRACTED: "any driver can list every colleague's contact details"

**Wrong, and I should have caught it.** The permission string `driver:read` is
coarse, but object-level scoping is enforced one layer down, in
`app/services/drivers.py`:

- `get()` - a driver reading another driver's record gets **404, not 403**,
  deliberately, because a 403 confirms the record exists.
- `list_drivers()` - scoped **in the query** (`where Driver.user_id == actor.id`),
  not post-filtered, precisely so one forgotten filter cannot leak rows.

`app/core/permissions.py` says exactly this, and I quoted it before drawing the
opposite conclusion. The regression coverage requested already exists and
passes: `tests/test_authorization.py::TestObjectLevelScoping` -
`test_driver_cannot_read_another_driver`, `test_driver_list_shows_only_self`,
`test_manager_sees_all_drivers` - **4 passed** against the isolated cluster.

**There is no live vulnerability in the existing API, and nothing to fix there.**

The RLS tightening remains correct for a different reason: RLS has no service
layer beneath it. A policy resting on `has_perm('driver:read')` alone *would*
have been a real hole in the new system, because `DRIVER` holds that permission.
`app.is_fleet_staff()` closes it. The fix was right; the diagnosis of the
existing system was wrong.

### 5. Confirmed already satisfied: the hosted database is protected from tests

`backend/tests/db_target.py` vetoes on SQLAlchemy's `do_connect` event - before
any socket opens - and permits exactly one target. It has **no override**; an
earlier `ALLOW_SHARED_DB_TESTS=1` escape hatch was deliberately removed.
Verified live this session: an unarmed `pytest` aimed at the hosted project
**refused to run**, naming both the rejected and the permitted target. No
further work is needed for this item.

## Endpoint migration matrix

59 application routes (62 total minus `/docs`, `/docs/oauth2-redirect`,
`/openapi.json`). Destinations below; **9 are implemented and proven**, the rest
are designed but not written.

| Group | n | Destination | Status |
| --- | ---: | --- | --- |
| `/api/auth/*` (login, refresh, logout, me) | 4 | Supabase Auth | NOT IMPLEMENTED — unblocked (Argon2 import is supported); pending Auth Admin access |
| Driver trip reads (`/api/driver/me`, `/me/trip`, `/me/assignment`) | 3 | Data API + RLS | **PROVEN** (policies + harness) |
| `/api/driver/me/trip/accept` | 1 | `app.accept_trip()` | **PROVEN** |
| `/api/driver/me/location` | 1 | `app.submit_location()` | **PROVEN** |
| Trip/route/stop/event reads (`/api/trips`, `/{id}`, `/routes`, `/track`, `/fleet/active`) | ~8 | Data API + RLS | **PROVEN** for the tables; per-endpoint response shapes not yet adapted |
| Trip state transitions (dispatch, cancel, close, start, complete, stop arrive/complete, assignment verify) | 9 | Postgres functions, same pattern as `accept_trip` | DESIGNED |
| Route planning, recalculate, recommendation, risk, select, reroute (+accept) | 7 | Edge Functions (call OSRM) + a guarded `select_route` function that re-checks closure inside the writing transaction | DESIGNED |
| Review authorizations (get/create/revoke) | 3 | Guarded functions | DESIGNED — table does not exist on the hosted project yet (migration 0007) |
| Fleet CRUD (drivers, trucks, assignments, shipments: create/update/deactivate/retire/end) | ~16 | Edge Functions | DESIGNED |
| `/api/geocoding/*` | 2 | Edge Function → existing Google Places integration | DESIGNED |
| `/api/driver/me/trip/navigation`, `/offline-package`, `/places` | 3 | Edge Functions | DESIGNED |
| `/health`, `/ready` | 2 | Minimal Edge Function | DESIGNED |
| `/api/ai/ask`, `/api/ai/status` | 2 | **BLOCKER — see below** | NOT MIGRATABLE AS-IS |

REQUIRED_ENDPOINTS_MIGRATED = **9 / 59** proven at the database layer.

### The one genuine runtime blocker

`app/services/inference.py` calls **Ollama** over HTTP (`OLLAMA_BASE_URL`,
defaulting to loopback) and refuses non-local hosts unless explicitly allowed.
It is not in-process ML — the backend declares no numpy/scipy/torch, only
FastAPI, SQLAlchemy, psycopg, geoalchemy2, argon2-cffi and pyjwt — so nothing
here needs a native Python runtime. But a local LLM server is not something
Supabase hosts. Options, in order of honesty:

1. Point `OLLAMA_BASE_URL` at a hosted inference endpoint and call it from an
   Edge Function. Keeps behaviour; adds a provider and a cost.
2. Leave the AI surfaces degraded-but-honest. The client already handles this:
   `AiPanel` renders "AI answers are off" with the fallback guide, and the
   phrasebook/safety content is bundled and works with no model. **The core
   demo journey does not touch AI.**

Recommendation: (2) for the migration, (1) as a separate decision. The AI
surfaces are the only thing that would still need the laptop, and they already
fail honestly without it.

## Client implementation (this revision)

Written while management authentication is pending. Missing Docker/Deno prevents
*running* a Supabase stack; it does not prevent writing and unit-testing the
client half, and the two are reported separately below.

### New database objects

| File | Contents |
| --- | --- |
| `20260907120200_guarded_transitions.sql` (extended) | `app.submit_location_batch(jsonb)` - contract parity with `POST /api/driver/me/location`, which the app calls with a **batch** and expects `{trip_id, accepted, duplicates_ignored, rejected, rejected_reasons}`. One unacceptable fix does not abort the batch: a queue flushed after an hour offline always contains some, and discarding the good ones would retry forever. |
| `20260907120400_rpc_surface.sql` | Thin SECURITY INVOKER wrappers `public.accept_trip` and `public.submit_location_batch`. |

**Why the wrappers exist - a gap found by writing the client.** The guarded
functions live in schema `app`, which is deliberately not exposed to the Data
API, so `supabase.rpc('accept_trip')` could never have reached them. Exposing
the whole schema would also publish `has_perm`, `current_role`,
`is_fleet_staff`, `can_read_trip` and `identity_status` as callable RPC. A
security surface should be what you meant to expose, so `public` carries exactly
two wrappers and the policy internals stay unreachable - asserted by three
checks.

### A real defect the harness caught

`app.submit_location_batch` originally delegated all authorization to the
per-fix function. An **empty array never entered the loop**, so a manager - or
an anonymous caller - received a cheerful `200` with counters. An entrypoint
that is only safe for non-empty input is not safe. It now verifies the caller
itself, and resolves the trip once up front rather than after the loop (which
had returned `trip_id: null` alongside accepted fixes when a trip ended
mid-batch). Three checks lock this in.

### Client files

| File | Purpose |
| --- | --- |
| `driver-app/src/api/supabaseClient.ts` | One configured client. Native session in expo-secure-store; **web persists nothing**, preserving the deliberate policy in `auth/tokenStore.ts` rather than quietly "improving" a security decision during a backend migration. One refresh loop only. |
| `driver-app/src/api/supabaseApi.ts` | Adapter shape-compatible with the `api` object, so no screen changes. `me`, `acceptTrip`, `sendLocation` are backed by proven objects. Everything else throws `NotMigratedError` naming the operation. |
| `driver-app/src/api/supabaseApi.test.ts` | 10 contract tests. |
| `driver-app/src/api/supabaseClient.test.ts` | 10 configuration tests. |

`@supabase/supabase-js@2.115.0` added to `driver-app`.

**Unmigrated operations throw; they do not return empty.** A stub returning
`null` or `[]` is indistinguishable on screen from "you have no trip" or "no
hotels nearby" - exactly the fake-success failure this project forbids.

**`myTrip` is deliberately not a table read.** `CurrentTrip` carries
`can_start` with its blocking reason, tracking configuration, route progress and
next stop - all server-computed from rules that must not move into a client
where they could be edited. It belongs in an Edge Function composing the same
payload FastAPI does. That function is **not written and not deployed**, so
`myTrip` throws rather than returning a half-built trip.

### Release configuration fails closed

`configurationProblem()` refuses, at build time, exactly the mistake the vc3 APK
shipped: a private-IP or `localhost` endpoint, plain HTTP, a missing URL or key,
and any `sb_secret`/`service_role` key embedded in the bundle. Expo SDK 57
inlines every `EXPO_PUBLIC_` variable into the bundle, so a secret key shipped
in an APK cannot be recalled; the guard is what keeps that from happening.

The private-address check runs **before** the HTTPS check on purpose. Both fire
for `http://172.24.85.80:8000`, but "must be HTTPS" would send someone off to
obtain a certificate for a LAN IP - the wrong fix for the failure this project
actually had. A test asserts the ordering.

### Test results this revision

| Suite | Result | Scope |
| --- | --- | --- |
| `backend/scripts/rls_harness.py` | **48/48** | Database layer, disposable DB, real `auth.uid()` predicate, every statement as `authenticated` |
| `driver-app` vitest | **250 passed** (was 230) | 20 new tests; no regression |
| `driver-app` typecheck | **exit 0** | |
| `tests/test_authorization.py::TestObjectLevelScoping` | **4 passed** | Proves Corrections 4 |

**Not run, and not runnable here:** GoTrue token issuance, PostgREST routing,
Realtime, Edge Function auth, and any end-to-end hosted call. No Docker, no
Deno, no Auth Admin access.

## Revision 3 — reported defects, account decision, start workflow

### Manifest contradiction — the JSON was right, my prose was wrong

I wrote that four of the 33 unresolved accounts were "MANAGER accounts on
real-looking domains that logged in and held sessions". That describes accounts
in the **`include`** bucket, not the unresolved one, and the manifest says so:

```
include     MANAGER active=False invalid=False driver_row=False session=True  n=4
unresolved  DRIVER  active=False invalid=True  driver_row=False session=False n=14
unresolved  MANAGER active=False invalid=True  driver_row=False session=False n=12
unresolved  DRIVER  active=False invalid=True  driver_row=False session=False n=7
```

The classifier includes any account with a session, so an account with one can
never be unresolved. All 33 unresolved rows are uniformly `is_active=false`,
`invalid_pattern=true`, no driver row, no authored trip or event, **no session**.
The four real-domain managers are part of the 10 included. The evidence was not
overwritten; the sentence describing it was wrong and is corrected here.

`include` (10) breaks down as: 4 inactive MANAGERs with sessions on real domains
(deactivated staff), 3 active DRIVERs with driver rows, 1 active MANAGER with
trips + events + sessions, 1 inactive DRIVER with a driver row and a session,
1 active DRIVER with a driver row and an event.

### Account decision, recorded

**All 33 unresolved accounts are preserved exactly as they are.** Not deleted,
not archived, not activated, not imported into Auth during the initial cutover.
Their rows, relationships and `is_active` status are untouched, and they remain
listed in the manifest for later review. Fixture relocation has been **removed**
from the deployment plan entirely — nothing in the plan now moves or deletes any
account row.

### Configuration validator — three reported defects, all reproduced and fixed

The rules moved to `driver-app/src/api/releaseConfig.ts`, which is pure and
imports nothing native, so the **same code** runs in the app and in the
pre-bundle gate. Each defect has a regression test that fails against the old
implementation.

| Defect | Cause | Fix |
| --- | --- | --- |
| Synthetic legacy `service_role` JWT **accepted** | The check searched the raw string for `service_role`; in a JWT that text lives inside base64 and never appears literally | `classifyKey()` decodes the payload and reads the `role` claim. `anon` is accepted; **any** other role is refused by name |
| Arbitrary text **accepted** | The check only ever looked for things to reject and had no notion of a valid key | Positive classification: `sb_publishable_…` or a JWT with `role:"anon"`. Everything else defaults to `unknown` and is refused |
| `https://[::1]` **accepted** | WHATWG URL reports IPv6 hosts bracketed (`[::1]`); the regex tested a bare `::1` | Brackets stripped, plus IPv6 loopback, ULA `fc00::/7`, link-local `fe80::`, and IPv4-mapped forms in **both** spellings — WHATWG normalises `::ffff:127.0.0.1` to `::ffff:7f00:1` |

Decoding is **classification, not authentication** — no signature is verified and
nothing in the token is trusted; the payload is read only to decide whether this
key may be embedded in a public bundle.

Also added: the approved origin must be `<20-char-ref>.supabase.co|.in`, and
`EXPO_PUBLIC_SUPABASE_PROJECT_REF` pins a build to one project. Private ranges
now include link-local `169.254/16` and CGNAT `100.64/10`. No message ever
contains the key — these strings land in CI logs.

**34 tests** in `releaseConfig.test.ts`. `supabaseClient.test.ts` was reduced to
delegation only, so the rules have exactly one owner.

### Pre-bundle build gate

`driver-app/scripts/check-release-config.mts`, wired as `npm run check:release`.
A runtime check cannot un-inline a secret — by the time the app runs, Expo has
already baked `EXPO_PUBLIC_*` into a readable APK. This runs under plain Node
(v24 native type-stripping, so it shares the app's source rather than a copy),
exits non-zero, prints no credentials, and additionally refuses a build that
still carries `EXPO_PUBLIC_API_BASE_URL` — the laptop fallback.

Exercised: valid config exits 0; a synthetic `service_role` JWT exits 1 without
echoing the key; a leftover LAN fallback exits 1.

### Transport selector — a false claim in my own code, corrected

`supabaseClient.ts` carried a comment saying "only one transport is ever active:
see the switch in client.ts". **There is no such switch, and there never was.**
`client.ts` still exports the REST `api`, and nothing imports `supabaseApi`, so
**nothing routes through Supabase at runtime**. The comment now says that.

The switch is deliberately withheld rather than written now: enabling it today
would either break the app (most operations still throw) or need per-operation
fallback to the laptop backend — and a silent fallback to a LAN address is the
exact failure this migration exists to end. It goes in as one all-or-nothing
selection once the workflow is served.

### Start workflow — ported and tested

`20260907120500_start_trip.sql` ports `evaluate_start` and `start` exactly.

`app.start_gate()` is the single definition of every prerequisite, used by both
the read (why the button is disabled) and the write (the refusal) — the property
the Python docstring insists on, because a second copy is how a screen shows an
enabled button the server then rejects.

Blocker matrix, all tested in order: `TRIP_NOT_STARTABLE`, `TRUCK_MISSING`,
`TRUCK_NOT_OPERATIONAL`, `NO_ACTIVE_ASSIGNMENT`, `ASSIGNMENT_NOT_VERIFIED`.
Also tested: start is idempotent on an already-running trip and writes exactly
one `STARTED` event; driver and truck move to `ON_TRIP`; and a driver a manager
deliberately marked `OFF_DUTY` is **not** silently overwritten.

### `myTrip` — deliberately still not implemented, with the reason

`CurrentTrip.progress` is a `RouteProgress`: it projects the last GPS fix onto
the planned polyline and reports `fraction_complete`, `off_route_m`,
`on_route`, `remaining_at_planned_pace_min` and reason codes — 260 lines of
domain logic in `app/domain/route_progress.py`. Porting that to SQL half-well
would put wrong numbers on a navigation screen, which is worse than an honest
missing capability. `myTrip` therefore still throws `NotMigratedError`, and the
start gate it depends on is now available separately as `startGate()`.

### Test results, revision 3

| Suite | Result |
| --- | --- |
| `backend/scripts/rls_harness.py` | **65/65** (was 48) |
| Rollback verification | **5/5**, no data lost |
| `driver-app` vitest | **281 passed** (was 250) |
| `driver-app` typecheck | exit 0 |
| Migration idempotency | all 6 re-apply cleanly |
| `backend` full suite | 942 passed, 1 pre-existing fail, 5 skipped |

### Deployment order (revised)

1. `pg_dump` of `public`; record row counts. Keep until cutover is accepted.
2. `alembic upgrade head` — applies **0007, 0008, 0009**.
3. Apply the **eight** `supabase/migrations/*.sql` in filename order:
   `…120000_app_authz_core`, `…120100_data_api_grants_rls`,
   `…120150_auth_identity_mapping`, `…120200_guarded_transitions`,
   `…120400_rpc_surface`, `…120500_start_trip`,
   `…120600_driver_trip_payload`, `…120700_stops_and_completion`.
   All are idempotent.
4. Run the synthetic Argon2id import test before importing anyone real.
5. Auth import for the **10 `include`** accounts only, with `id = public.users.id`
   and the existing argon2id `password_hash`. The 33 unresolved and all fixtures
   are left untouched. Verify `app.identity_status().unlinked_active = 0`.
6. Expose `public` only; `app` stays unexposed.
7. Edge Functions (none written yet) with `verify_jwt` on.
8. Client config + `npm run check:release`, then rebuild the APK above versionCode 3.

**Recovery — and exactly what it does and does not cover.**

`supabase/rollback/rollback_supabase_migration.sql`, tested end to end (5/5).
Drops the policies by name, the public RPCs, every Data API grant and the `app`
schema with `RESTRICT` — not `CASCADE`, so an unexpected dependency fails loudly
instead of being silently dropped. Verified to restore the exact pre-migration
posture (RLS on, zero policies) with **no application data altered**.

**Its scope is the Supabase SQL migrations only — steps 3 above.** It is not a
rollback for the deployment as a whole. The remaining scope, and why each part
is not automated:

| Deployment step | Recovery status |
| --- | --- |
| Supabase migrations (step 3) | **Covered and tested** by the rollback script |
| Alembic 0007–0009 (step 2) | **Not covered.** Alembic has `downgrade` revisions; they have not been exercised against this project, and `tests/test_migrations.py` gates downgrade tests behind `RUN_DESTRUCTIVE_MIGRATION_TESTS=1` because they drop every table. Recovery is the `pg_dump` from step 1, restored deliberately by a human. |
| Auth import (step 5) | **Not covered, deliberately.** Deleting `auth.users` rows would sign real people out. Reversal is a decision, not a script. Identities are additive and break nothing if left in place, and `app.identity_status()` reports the linkage either way. |
| Edge Functions (step 7) | **Not covered by SQL.** Reverting is redeploying the previous version, or deleting the function; either way the database rollback above is independent of it. |
| Client cutover (step 8) | **Not covered by SQL, and does not need to be.** `usingSupabase` is decided from build configuration, so reverting is rebuilding without `EXPO_PUBLIC_SUPABASE_URL` — the app returns to the REST transport. An already-installed APK keeps its baked configuration and must be replaced. |

No destructive default is introduced anywhere: nothing above deletes account
rows, application data or Auth identities.

## Revision 4 — route progress, myTrip, and the transport switch

### Route progress: ported, not deferred

`app/domain/route_progress.py` is now ported to
`supabase/functions/_shared/routeProgress.ts` — Deno-compatible, dependency-free,
importable by Edge Functions. The previous revision treated its 260 lines as a
reason to defer; length is work, not a blocker, and that was the wrong call.

**Parity is measured, not asserted.** `backend/scripts/route_progress_fixtures.py`
runs the *real Python implementation* over 84 cases and writes the results;
`driver-app/src/api/routeProgress.parity.test.ts` replays them through the port.
Fixtures are generated rather than hand-written because a hand-written
expectation only proves the porter and the tester made the same mistake.

Tolerance is **1e-9 relative**, not a loose epsilon — both languages use IEEE-754
doubles over the same operation sequence, so a wide tolerance would hide the
algorithmic divergence this test exists to catch.

Coverage: progress boundaries (start, end, mid-vertex, within-segment), clamping
before the start and past the end, missing position, empty/single-vertex/
zero-length geometry, off-route distance and the 200 m threshold, figures still
returned when off route, remaining-time semantics (present, zero, negative,
absent duration), provider-distance scaling including zero and negative totals,
a self-crossing route where the nearest segment must win, and a deterministic
60-case sweep. Plus invariants: no field ever reads as an arrival time,
travelled + remaining equals the route length, and nulls never become zeroes.

**89/89 pass.** Two behaviours were preserved that a "tidier" port would have
broken, and both are commented in the port: the segment projection is planar in
degrees with longitude deliberately unscaled, and the nearest-segment loop uses
strict `<` so the first segment wins a tie.

### `myTrip` implemented

Split so that the part which decides anything is testable without Deno:

* **`app.driver_trip_payload()`** (migration `…120600`) composes the whole
  `CurrentTrip` except `progress`: trip, truck summary, stops in sequence, next
  actionable stop, the start gate's own verdict, `last_fix` with freshness, and
  the geometry/position/provider figures the calculation needs.
* **`supabase/functions/driver-trip/index.ts`** is a thin shell: verify caller,
  call the payload through a **caller-scoped** client so RLS still applies (not
  service_role), compute `progress` with the shared port, strip the internal
  input, return.

**Coordinate order is decided once, in SQL.** The project speaks `(lat, lon)`;
PostGIS and GeoJSON speak `(lon, lat)`. Doing the swap in the Edge Function would
put it where no database test can see it. `ST_Y`/`ST_X` emit `[lat, lon]` and the
harness asserts it — the single most likely way this port could have gone wrong
silently.

Preserved subtleties, each with a test: an in-progress trip reports **no** start
blocker; `driver_accepted_at` is returned **only** when this driver is the one
who accepted, so a reassigned trip does not open on a job the new driver never
acknowledged; a missing trip is `null` and HTTP 200, not a 404, because "no
assignment yet" is an ordinary state.

### Transport switch — now real

`client.ts` selects the transport at module load: `restApi` when Supabase is not
configured, `supabaseApi` when it is. Previously this was only claimed in a
comment.

**All or nothing.** There is deliberately no per-operation fallback. An
unmigrated operation throws `NotMigratedError` naming itself rather than routing
back to the laptop — a partial fallback would silently reintroduce a private-LAN
dependency and leave a driver on mobile data with one screen hanging and nothing
saying why. Six tests cover this, including that the choice is refused for a
laptop endpoint or an elevated key rather than half-switching.

### Build gate: the hook, and a defect in my own gate

Registered as **`eas-build-post-install`** in `driver-app/package.json`, which
EAS Build runs after dependency installation and before the project is bundled.

**A claim here was wrong and is retracted.** This section previously said the
`.mts` gate "would have crashed the build" on EAS because the SDK-57 Android
image ships Node 22.23.1. That is not established and is almost certainly false:
Node enables type stripping **by default from v22.18.0**, so 22.23.1 would have
run the TypeScript gate unflagged.

The gate is still plain ESM JavaScript (`releaseConfig.mjs` +
`releaseConfig.d.ts`), for a narrower and honest reason: a check whose entire
job is to fail reliably should not depend on the runtime's TypeScript support,
which a pinned Node version or a `--no-experimental-strip-types` flag can remove.
One source of truth either way.

Verified: valid configuration exits 0; a synthetic `service_role` JWT exits 1;
the rejected output contains **no credential**; a leftover
`EXPO_PUBLIC_API_BASE_URL` also fails the build.

### Test results, revision 4

| Suite | Result | What it proves |
| --- | --- | --- |
| `rls_harness.py` | **87/87** (was 65) | Database layer, real `auth.uid()`, every statement as `authenticated` |
| Route-progress parity | **89/89** | The TS port matches Python at 1e-9 relative over generated fixtures |
| `driver-app` vitest | **378 passed** (was 281) | Adapter contracts, config rules, transport selection |
| `driver-app` typecheck | exit 0 | |
| EAS hook | exit 0 / exit 1 | Gate runs, fails closed, leaks nothing |
| Migration idempotency | all 7 re-apply | |
| Rollback | 5/5, no data lost | Supabase SQL migrations only — see the scope table |

**Test categories, kept distinct:** mocked handler tests (vitest, adapter and
transport), database tests (harness, real Postgres with the Supabase auth
predicate), and **runtime integration and hosted verification — neither run**.
No Edge Function has been executed: this machine has no Docker and no Deno, and
the project is not reachable for deployment.

### Workflow status, honestly

| Step | State |
| --- | --- |
| Manager assignment | **Not migrated** — manager-web untouched, still FastAPI |
| Driver current trip | **Implemented** (payload + Edge Function + progress) |
| Accept | **Implemented and tested** |
| Start | **Implemented and tested**, full blocker matrix |
| Separate navigation screen | Screen unchanged; consumes `myTrip`, so it follows the adapter |
| Location updates | **Implemented and tested**, single + batch, replay-safe |
| Manager visibility | **Not migrated** |
| Completion | **Not migrated** — `completeTrip`, `arriveAtStop`, `completeStop` still throw |

Still throwing, tracked not dropped: `myAssignment`, `verifyAssignment`,
`completeTrip`, `arriveAtStop`, `completeStop`, `places`, `offlinePackage`,
`navigationPackage`, `aiStatus`, `aiAsk`, `ready` — 11 operations, plus the
entire manager surface. Completing the driver slice has not removed them from
scope.

## Revision 5 — handler defects, explicit transport, driver journey complete

### Two reported Edge Function defects, both real

Reproduced and fixed. The handler moved to `driver-trip/handler.ts` so it can be
tested without a Deno runtime; `index.ts` is now only the runtime binding.

| Defect | Cause | Now |
| --- | --- | --- |
| Timeout returned **400** | `.abortSignal()` does not throw. postgrest-js catches the fetch `AbortError` and **resolves** with `{data:null, error}`, so the `catch` that checked `aborted` never ran and the abort was read as an ordinary database error | `abort.signal.aborted` is checked **before** any error interpretation, and again in `catch` — **504 TIMEOUT** either way |
| `PGRST301` returned **400** | Every database error mapped to 400 | Explicit map: `PGRST301`/`PGRST302`/`28000` → **401**, `42501` → **403**, `55000`/`40001`/`40P01` → **409**, `08*`/`53*`/`57*`/`58*` → **503**, unrecognised → **500** |

Two further weaknesses fixed while in there:

* **Codes are no longer echoed from the database.** The old version returned
  `error.details.code` verbatim, so any future `RAISE` could inject a string
  into the client contract. Only an allowlist (`NOT_AUTHENTICATED`, `FORBIDDEN`,
  `NO_ACTIVE_TRIP`, `TRIP_NOT_ACCEPTABLE`) is ever returned; everything else is
  `INTERNAL`.
* **An unrecognised database error is 500, not 400.** A database fault is ours
  to explain, not the caller's to fix.

Preserved: caller-scoped authorization, safe messages, request IDs on success
and failure, and `clearTimeout` in `finally`. **24 handler regression tests**,
including that the raw database message never reaches the response body.

### Transport selection is now explicit, not inferred

The reported flaw was real: invalid Supabase configuration selected REST, so a
cloud release with a typo silently fell back to dialling a laptop on a private
LAN — the failure this migration exists to remove, reintroduced by the error
path.

`EXPO_PUBLIC_BACKEND` now decides outright (`supabase` | `local`). Without it,
the presence of **any** Supabase variable means cloud was intended, so a
half-set cloud build is diagnosed rather than demoted. In cloud mode with bad
configuration every operation throws `ConfigurationError` and **zero REST
requests are made** — asserted with a `fetch` spy. REST is reachable only as an
explicit local-development choice. **9 transport tests.**

### Driver journey complete and proven

New migrations `…120700_stops_and_completion.sql`:
`verify_assignment`, `arrive_at_stop`, `complete_stop`, `complete_trip`.

Ported faithfully, each with a test:

* **Idempotency is checked BEFORE ordering.** The Python module records getting
  this wrong once: completing stop 1 settles it, the next actionable stop
  becomes stop 2, and a retry of the same finish came back as "stop 2 is next" —
  a conflict for an action that had already succeeded, at a depot, where signal
  is worst and retries likeliest.
* **A registration mismatch is flagged, never refused.** A driver at the wrong
  truck still needs to tell someone.
* `delivered_at` uses the **server clock**; driver and truck are released only
  **conditionally** on `ON_TRIP`, so a manager's deliberate `OFF_DUTY` or
  `MAINTENANCE` is not overwritten.
* A stop id from another trip is **not found**, not forbidden — confirming it
  exists would disclose something about a trip that is not the caller's.

**Manager visibility is on the same authoritative rows**, asserted as the
manager identity: the completed status, the driver's submitted GPS points, and
the driver's timeline events.

### Workflow status

| Step | State |
| --- | --- |
| Manager assignment / dispatch | **Not migrated** — manager-web still FastAPI |
| Driver current trip | Implemented (payload + Edge Function + progress) |
| Accept | Implemented, tested |
| Truck verification | Implemented, tested |
| Start | Implemented, tested, full blocker matrix |
| Navigation screen | Unchanged; consumes `myTrip`, so it follows the adapter |
| Location updates | Implemented, tested, replay-safe |
| Stop arrival / completion | Implemented, tested, in-order + idempotent |
| Trip completion | Implemented, tested |
| Manager observes | **Read path proven** at the database layer |

Still throwing, tracked not dropped: `myAssignment`, `places`,
`offlinePackage`, `navigationPackage`, `aiStatus`, `aiAsk`, `ready` — 7
operations, plus the entire manager mutation surface (create trip, plan route,
select route, dispatch, cancel, close, fleet CRUD).

### Corrections to my own earlier claims

* **Parity tolerance.** The comparison divides by `max(1, abs(expected))`, so it
  is an **absolute** 1e-9 near zero and a **relative** 1e-9 above 1. Calling it
  "1e-9 relative" was inaccurate; the comment now states both.
* **The distance invariant was partly tautological.** With no provider distance
  it compared the computed sum against itself. It now measures the polyline with
  an independent haversine written out in the test file. Still 89/89, so the
  invariant was genuinely satisfied rather than merely unasserted.
* **The Node claim was wrong.** I said the `.mts` gate "would have crashed" on
  EAS. Node enables type stripping **by default from v22.18.0**, and the SDK-57
  image ships 22.23.1, so it would have run. The gate stays plain `.mjs` for a
  narrower reason: a check whose job is to fail reliably should not depend on
  runtime TypeScript support that a pinned Node or
  `--no-experimental-strip-types` can remove.

### Test results, revision 5

| Suite | Result | Category |
| --- | --- | --- |
| `rls_harness.py` | **106/106** (was 87) | Database — real Postgres, Supabase `auth.uid()`, every statement as `authenticated` |
| Route-progress parity | **89/89** | Local — port vs Python-generated fixtures |
| `driver-app` vitest | **411 passed** (was 378) | Mocked handler / adapter / transport |
| typecheck | exit 0 | |
| Migrations | 8, all idempotent | |
| Rollback | **5/5**, no data lost, 9 RPCs removed | Database |
| EAS gate | exit 0 / exit 1, no credential printed | Local |
| Backend suite | 942 passed, 1 pre-existing fail | Local |

**Categories kept distinct, and two are still empty:**

* **Mocked handler tests** — the 24 driver-trip tests. They prove the mapping,
  not that the function runs.
* **Database tests** — the harness, against real Postgres.
* **Actual runtime execution** — **NOT RUN.** No Deno, no Docker; the Edge
  Function has never been executed. Dependency resolution (`jsr:@supabase/supabase-js@2`),
  gateway JWT verification and PostgREST RPC exposure are unverified.
* **Hosted workflow, APK installation, mobile-data operation** — **NOT RUN.**

## Blocker — why nothing is deployed

Target selected: **`znaveeefzgfxsblsobdb`** (the project `backend/.env` and
`.mcp.json` already point at).

- Its MCP server (`.mcp.json`) is listed as **requiring authentication**, and
  this session is non-interactive, so the OAuth flow cannot be run here.
  Management-API operations — **deploying Edge Functions**, setting secrets,
  configuring exposed schemas — are therefore unavailable.
- The connected Supabase connector is bound to `patelpranay2296@gmail.com`,
  whose only project is `xhapouexwacixuvvgdde` (INACTIVE) — a *different*
  project, not referenced anywhere in the repository.
- The direct Postgres connection in `backend/.env` **does** reach
  `znaveeefzgfxsblsobdb` as `postgres`, so the four SQL migrations *could* be
  applied from here. They were not: the option chosen was the one that reads
  "I'd finish all code + migrations now and deploy after you authorize", and
  this project holds real data that the 2026-09-06 incident already damaged
  once. Applying DDL to it is not something to do on an inferred mandate.

### To unblock

Authorize the Supabase MCP server for `znaveeefzgfxsblsobdb` in an interactive
session (`/mcp`, or `claude mcp`), then say so. That single step enables Edge
Function deployment, project configuration and the hosted gates.

Applying only the SQL is separately possible with an explicit go-ahead, but it
buys little on its own: without Edge Functions and the client cutover the APK
still has no HTTPS endpoint to call.

## ~~Deployment plan (reviewable, not executed)~~ — SUPERSEDED

> **This section is obsolete and must not be executed.** Two of its steps are
> now known to be wrong:
>
> * **Step 3, "fixture quarantine"** — proposed moving 19,860 accounts to an
>   archive table. **Withdrawn.** All 33 unresolved accounts and every fixture
>   row are preserved exactly as they are. Nothing in the current plan moves,
>   archives or deletes any account.
> * **Step 9, `drop schema app cascade`** — CASCADE would silently drop whatever
>   came to depend on `app`, including policies on application tables, leaving
>   them RLS-enabled with their policies gone and no record of it. Replaced by
>   an explicit, tested rollback that uses `RESTRICT`.
> * It also refers to "the four migrations"; there are now **seven**.
>
> **The authoritative plan is [Deployment order (revised)](#deployment-order-revised)
> in Revision 3.** This block is kept only so the change is visible rather than
> quietly rewritten.

## Gates

| Gate | Result |
| --- | --- |
| SUPABASE_BACKEND_MIGRATION | **PARTIAL** — DB security layer for the first slice only |
| REQUIRED_ENDPOINTS_MIGRATED | **18 / 59** proven at the database layer; 10 wired in the client adapter (`me`, `myTrip`, `acceptTrip`, `startTrip`, `startGate`, `sendLocation`, `verifyAssignment`, `arriveAtStop`, `completeStop`, `completeTrip`) |
| HOSTED_BACKEND_DEPLOYED | **NO** |
| LAPTOP_BACKEND_REQUIRED_FOR_CORE | **YES** (unchanged this session) |
| MANAGER_AND_DRIVER_SHARE_AUTHORITATIVE_DATA | NOT RUN |
| AUTH_AND_ROLE_ISOLATION | **PASS** — database layer, 34/34, `authenticated` role |
| CLOSED_ROUTE_AND_TRANSITION_GUARDS | **PARTIAL** — accept/location proven; closed-route selection still in FastAPI |
| FINAL_APK_STATIC_CHECKS | PASS (unchanged artifact from the previous mission) |
| FINAL_APK_PHYSICAL_INSTALL | NOT RUN |
| PHONE_MOBILE_DATA_WITH_LAPTOP_BACKEND_OFF | NOT RUN |
| NATIVE_RELEASE_WITHOUT_METRO | NOT RUN |
| CORE_END_TO_END_HOSTED_DEMO | NOT RUN |
| ORIGINAL_INSTALLER_FAILURE_FIXED | NEEDS DEVICE EVIDENCE |

## Changed files

Added: `supabase/migrations/` (5 files), `backend/scripts/rls_harness.py`,
`backend/scripts/migration_manifest.py`, `driver-app/src/api/supabaseClient.ts`,
`driver-app/src/api/supabaseApi.ts` and their two test files, this document.
Modified: `driver-app/package.json` + lockfile (adds `@supabase/supabase-js`).
No existing application source file was changed; no screen was touched.

## Next

1. Authorize the MCP server for `znaveeefzgfxsblsobdb` (one interactive step).
2. Then: schema catch-up → migrations → Auth import for 5 accounts → Edge
   Functions → client cutover → new APK → phone gates.
