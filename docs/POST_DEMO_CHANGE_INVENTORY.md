# RASTA AI — post-demo change inventory

**Produced** 26 September 2026 · **Baseline** `origin/main` = `e4043ce` (deployed)
**Scope** every dirty file in the working tree, per file, not per directory.

Nothing in this document has been committed, moved, deleted, or deployed. It is
a classification and a plan. See `POST_DEMO_STATE.md` for the repository state
it was taken against.

---

## 0. Integration status (cycle 3, 26 September 2026)

```text
BRANCH            post-demo-integration   (local only - NOT pushed, NOT deployed)
BASE              e4043ce                 (deployed; identical tree to the dry run's base)
WORKTREE          D:/Projects/ner-ai-logistics-integration
COMMITS           35 on e4043ce   (tip c60900b)
  plan 1-22, 24   23  replayed from the test-verified dry run, byte-identical trees
                      except three corrections applied from their first commit on:
                        14  sign-in placeholder uses the translated catalogue key,
                            not the demo driver's real login number
                        19  figures 09, 10, 32 redacted; Day 1 report .docx/.pdf rebuilt
                        20  07b screenshot = redacted figure 09 (same image)
                        21  03_xss_test.png redacted; Day 2 Task 2 .docx/.pdf rebuilt
  follow-ups      12  privacy (12 public screenshots), security (exact login match,
                      Indian phone forms, Gemini log text, routed-path cache rule),
                      lifecycle (DELIVERED stays open work, open-trips refresh,
                      no invented cargo weight, error only after input), reason-code
                      wording, delivered trip without "Resume navigation",
                      single-Alembic-head guard, PII record, address listbox
                      semantics, route-approval focus, Gemini key sent in a
                      header (never the URL; httpx URL logging off), SOS copy
                      that points at 112 instead of promising a dispatch
GATES             commit 18: backend 1254/0 fail, manager 282, driver 685, tsc clean,
                             remote-demo build OK (on a fresh Supabase-shaped 0012 DB)
                  tip:       backend 1260 passed / 23 skipped / 0 failed, manager 284,
                             driver 686, both tsc clean, remote-demo build OK
WORKING TREE      backend 1489 passed / 5 skipped / 0 failed (Supabase-shaped DB at
                  0014), manager 345, driver 705, both tsc clean
NOT LANDED        plan 23 and 25-38 - they need migration 0013 on hosted, which waits
                  for SUPABASE_BACKUP_CONFIRMED
```

Fixes made in the working tree for the gated RBAC commits (they land with 25-38):

| fix | files |
|---|---|
| Trips planned in the console had no geography, so state and district managers never saw them. Migration `0014_shipment_state_geography` adds shipment state columns, a backfill and a state-follows-district trigger; `app/services/trip_geography.py` resolves each endpoint once, exactly, from a reverse geocode (state = one of the 8 rows; district = an operational one only); unknown stays NULL. Proven by tests and live in the browser. | `backend/alembic/versions/0014_*`, `app/services/trip_geography.py`, `app/services/geocoding.py`, `app/services/shipments.py`, `app/core/scope.py`, `app/services/notifications.py`, `app/api/dashboard.py`, `app/models/operations.py`, `tests/test_trip_geography.py`, `tests/conftest.py` |
| `ShipmentCreate` accepted a 1-2 character address that `ShipmentRead` then refused (a 500). Validation moved to create (min 3, a 422); the read model refuses nothing. | `app/schemas/domain.py`, `tests/test_shipment_address_contract.py` |
| The header named no state or district for scoped managers. | `manager-web/src/App.tsx`, `App.test.tsx` |
| "Your district" heading shown to state managers. | `manager-web/src/pages/OverviewPage.tsx` |
| Last-stop confirmation said "moves the trip to the next one". | `driver-app/src/screens/TripScreen.tsx` |
| NEW-02: State and District Managers held fleet-wide writes (a district manager could deactivate another state's driver). Scoped roles lose driver/truck/assignment/emergency writes; MANAGER, NORTH_EAST_MANAGER and ADMIN keep them. | `app/core/permissions.py`, `tests/test_scoped_role_writes.py` |
| E4/E5: a driver's stop request reached no inbox when no scoped manager covered the trip, yet the driver was told a manager had it. Regional managers are always notified; the acknowledgement says so only when someone was. | `app/services/notifications.py`, `app/services/driver_trips.py`, `tests/test_driver_stop_request.py` |

**Migration numbering.** The chain now ends at `0015_instance_coordination` (added 27 Sep).
`claude/pdf-master-mission-gohuj5`'s `0013_device_events` must be re-parented
to become `0016_device_events` (`down_revision = "0015_instance_coordination"`)
before that branch merges; `tests/test_migration_chain.py` fails if it is not.

## 0b. All-India latency cycle (26–27 Sep 2026): working-tree changes

These changes are in the main working tree only, not on `post-demo-integration`, not pushed and not
deployed. Snapshot tag `snapshot/post-demo-2026-09-27-latency` (d88c503) preserves the tree as it stood
after the first three fix rounds; the later rounds are in the working tree. 121 files changed in this
cycle (git status entries modified since 26 Sep 15:45 UTC), listed below by change;
`manager-web/mutants.txt` was a stray test log and has been moved out of the repo.

| Change | Files | Verified by |
|---|---|---|
| Latency, hosting and capacity evidence | `docs/INDIA_LATENCY_MATRIX.md`, `docs/INDIA_HOSTING_DECISION.md`, `docs/SCALABILITY_AND_CAPACITY_PLAN.md` §15, `docs/MIGRATION_0013_DEPLOYMENT_PACKET.md` (0015 checks), `docs/NER_PLATFORM_EXPANSION.md` (revision numbering), this file | adversarial reviews of the probe data and load results |
| Global driver SOS: a stop request opens or escalates an `SOS_ESCALATED` emergency; the list is scoped; the schema 500 is fixed; the dossier reads the real briefing keys; the banner features the most severe incident; the driver sends position + `fix_at`, reuses its request id on retry and re-arms after resolve | `backend/app/services/driver_trips.py`, `sentinel.py`, `backend/app/domain/sentinel.py` (SOP wording), `backend/app/api/emergencies.py`, `backend/app/api/driver.py`, `backend/app/schemas/domain.py`, `manager-web/src/pages/FleetPage.tsx`, `manager-web/src/api/client.ts`, `manager-web/src/hooks/useEmergencies.ts`, `EmergencyProvider.tsx`, `manager-web/src/App.tsx`, `driver-app/src/screens/TripScreen.tsx`, `driver-app/src/api/client.ts`, `driver-app/src/i18n/phrases.ts` + tests | `tests/test_driver_sos_emergency.py`, FleetPage/App/TripScreen tests, final browser proof |
| Evidence path: per-source deadlines (shielded), per-point weather bound, 10-min weather cache, bounded offline-package risk, shared Nominatim throttle + negative cache, issuer false positive | `backend/app/services/route_risk.py`, `weather/open_meteo.py`, `offline_package.py`, `warnings.py`, `geocoding.py`, `backend/app/domain/warnings.py`, `backend/app/core/config.py` + tests | `test_evidence_bounds.py`, `test_weather.py`, `test_official_warnings.py`, `test_warnings_geocoding_contract.py` |
| Ops and security hardening: Argon2 off the event loop, push after commit on cancel, sentinel locks and stale re-checks, request id, hop-aware audit IP, route-change pushes release their connection | `backend/app/core/security.py`, `services/auth.py`, `api/auth.py`, `services/trips.py`, `services/sentinel.py`, `main.py`, `core/errors.py`, `api/deps.py`, `services/notify.py`, `services/routes.py`, `services/route_review.py`, `services/drivers.py`, `api/org.py`, `backend/Dockerfile` (comment) + tests | `test_ops_hardening.py`, `test_route_review_authorization.py`, `test_security_assessment.py` |
| Replica safety behind `MULTI_INSTANCE` (default false): leases, global Nominatim pacing, shared rate limits, simulation forced off; migration 0015 | `backend/alembic/versions/0015_instance_coordination.py`, `backend/app/models/coordination.py`, `models/__init__.py`, `services/coordination.py`, `services/route_watch.py`, `services/simulation.py`, `db/session.py`, `core/rate_limit.py`, `render.yaml` (switch + budget comment) + `tests/test_coordination.py` | tests with mutants, two-process proof, three review rounds |
| Manager latency and UX: silent refresh on the 60 s budget, 30 s open-trips poll, in-flight guard, hidden-tab pause, lazy map chunk (entry 1.50 MB → 518 kB), stale-chunk reload with offline/prefetch guards, map load boundary, places bbox guard, disabled-control reasons, swap guard, draft reservation shown per server rule, immutable caching of hashed assets, desktop-sticky topbar so the SOS badge stays in view | `manager-web/src/**` (index.css, api/client.ts, api/connectivity.ts, hooks/useResource.ts, hooks/useFleetPoll.ts, components/AddressPicker.tsx, MapPointPicker.tsx, mapSetup.ts, FleetMap.tsx, PlacesLayer.tsx, TripRouteReview.tsx, ui.tsx, staleChunk.ts, main.tsx, pages/TripsPage.tsx, TripListControls.tsx, ReportsPage.tsx, TrucksPage.tsx, DriversPage.tsx) + tests, `render.yaml` (headers) | 381+ manager tests, build check, browser proof |
| Driver cache-first and field reliability: refresh token kept except on 401/403, offline launch from cached identity/trip (no licence or contact data cached), cached route first, backlog batches up to 100 that halve on timeout, newest fixes kept, route-risk remount cache, GPS marker/header fixes, stale cancel notice, stepper, map dot on an old seed | `driver-app/src/**` (api/client.ts, auth/AuthProvider.tsx, auth/sessionCache.ts, trip/TripProvider.tsx, map/useRouteGeometry.ts, map/locationLabel.ts, tracking/tracker.ts, tracking/useLocationTracking.ts, hooks/useRouteRisk.ts, assistant/assistant.ts, screens/MapScreen.tsx, screens/TripScreen.tsx, screens/AssistantScreen.tsx, i18n/phrases.ts), `driver-app/App.tsx` + tests | 744 driver tests; network lab; device check pending |
| Test infrastructure | `backend/tests/factories.py` (cleanup owns API-created trucks, wider registration space), `test_cleanup_ownership.py`, `conftest`-free contract tests | full suite |

**Integration rules for these changes:**

1. `backend/app/services/warnings.py` imports `_throttle` from `geocoding.py`. They must land in one commit,
   or geocoding first. `tests/test_warnings_geocoding_contract.py` fails at import otherwise. Proven: the
   working-tree `warnings.py` against the committed `geocoding.py` raises `ImportError`.
2. Migration 0015 ships with the hosted database migration (step C), after backup/PITR is confirmed.
   `MULTI_INSTANCE` stays false until the two-instance check.
3. The pdf branch's `device_events` migration becomes `0016_device_events`
   (`down_revision = "0015_instance_coordination"`).
4. The driver's new `fix_at` field needs the matching backend deployed first. `StopRequest` forbids unknown
   fields, so an APK built from this tree sends a field an older backend rejects with 422. Deploy the
   backend before shipping a driver build.

## 1. The result

```text
DIRTY FILES (git status --porcelain -uall)   277
  KEEP        212   integrate as-is
  REWORK       24   integrate after a stated change
  BLOCKED      18   integrate only after a named precondition
  DROP         21   do not integrate (all preserved in the snapshot tag)
  DEPLOYED      2   already live in e4043ce, byte-identical
  UNEXPLAINED   0

INTEGRATION PLAN                             38 commits onto e4043ce
  runs on hosted's 0012 as-is                commits 1-22, 24
  needs migration 0013 on hosted first       commits 23, 25-38
  gated on BLOCKED files                     commits 30-38

COMPLETENESS CRITIC                          PASS
  coverage 277 / 277 · unscheduled 0 · duplicated 0 · ordering defects 0
```

## 2. How this was produced — including the pass that failed

Nine classifiers each owned one subsystem slice and judged every file from its
real diff: `git diff origin/main -- <file>` for anything the deployed hotfix
also touched, so the part already live could be separated from what is new.

**The first pass was rejected by its own critic, and the fault was mine.** The
synthesis step received `JSON.stringify(results).slice(0, 90000)` against a
215,048-character payload. Results arrive in completion order, so the driver-app
and manager-pages slices landed past the cut. The classifiers *had* judged all
63 of those files; the planner simply never saw them, and produced a plan with no
frontend. The critic reported 81 unexplained files and three structural defects:

- `backend/app/main.py`'s router wiring belonged to no commit, so five new
  routers would never have been registered.
- `manager-web/src/App.tsx` imports pages that were scheduled nowhere, so no
  position existed at which the manager build could typecheck.
- The migration-0013 commit's backup precondition was documented nine commits
  *after* the migration it was meant to guard.

It also found the file count wrong in both directions. `git status --porcelain`
collapses an untracked directory into one `?? dir/` line, so the true figure is
277, not the 188 that were first counted.

The second pass kept the nine classifiers byte-identical — they replayed from
cache — and replaced everything after them: compact rows instead of truncated
JSON, payload sizes logged, a gap classifier over `git status --porcelain -uall`,
and the three defects written into the planner's instructions as rules it must
not repeat. The critic was then required to open `backend/app/main.py`,
`manager-web/src/App.tsx` and `driver-app/App.tsx` itself and trace every import
to its commit position.

It passed. It also hash-checked both DEPLOYED files against their `origin/main`
blobs rather than trusting `git diff`, which prints a misleading "deleted file
mode" for untracked files.

## 3. Findings that change decisions

These came out of the inventory and are not visible from the commit list alone.

### A second migration 0013 exists, and it forks the chain

`origin/claude/pdf-master-mission-gohuj5` adds
`backend/alembic/versions/0013_device_events.py` with
`down_revision = 0012_push_notifications`. The dirty tree's
`0013_state_district_inbox.py` has the same parent. Merging that branch as-is
gives Alembic two heads. It must be renumbered to follow
`0013_state_district_inbox` before any merge.

### Migration 0013 is partly irreversible

The new `user_role` labels (`NORTH_EAST_MANAGER`, `STATE_MANAGER`,
`DISTRICT_MANAGER`) are added inside an `autocommit_block` and survive a
downgrade. A hosted upgrade that fails halfway does not return cleanly to 0012.
This is why the Supabase backup gate is not a formality.

### Commit 25 makes some shipments unreadable — REWORK required

The planner reported this as "raises `min_length` to 3 on pickup/destination,
so short input gets a 422". **That is not what the diff does**, and I checked
before repeating it. The input schema `ShipmentCreate` keeps `min_length=1`
(it only gains `max_length=500`). The `min_length=3` is on **`ShipmentRead`** —
the *response* model.

Reproduced against the dirty tree, with distinct coordinates so no other rule
interferes:

```text
ShipmentCreate(pickup_address="AB", destination_address="CD", ...)  -> ACCEPTED
ShipmentRead.model_validate(<that same row>)                        -> ValidationError
    pickup_address       String should have at least 3 characters
    destination_address  String should have at least 3 characters
```

So a shipment with a one- or two-character address can be **written but never
read back**. Every endpoint that serialises it through `ShipmentRead` fails
response validation — a 500, not a 422 — and that includes any such row already
stored on hosted.

The fix is to take the constraints **off `ShipmentRead`**. A response model
describes data that already exists; it has no business refusing it. If three
characters is the real rule, it belongs on `ShipmentCreate`, where it can be
refused with a 422 *before* the row is written. I scanned the rest of that diff for the same
mistake: these two lines are the only constraints added to a `Read` model.

Hosted is safe today: this is uncommitted work and only bites once commit 25
deploys.

### Commit 28 can start refusing hosted dispatch

The dispatch compliance gate (7-day grace; contact and insurance on the active
assignment) applies to every hosted demo driver. Check them against it before
deploying, or dispatch begins returning `DRIVER_COMPLIANCE_OVERDUE` mid-demo.

### SEC-006 is not closed on the branch until commit 31

The Day 2 Task 2 assessment (commit 21) records SEC-006 as CLOSED. That is true
of the working tree. On the integration branch it is only true from commit 31,
where `api/auth.py` starts calling `client_address`. `render.yaml`'s
`TRUSTED_PROXY_HOPS=1` (commit 4) is inert until then.

### Two submission screenshots carry phone login identifiers

`docs/submission/day1/…/09-drivers-desktop.png` and
`docs/submission/day2/…/07b_manager_drivers_list.png` show demo-driver names with
10-digit phone logins. They are **untracked** — they have never been pushed. That
decision needs to be made before they are.

### The SRI digests could not be checked offline

`DriverRouteMap.native.tsx` (commit 16) pins two sha384 digests for Leaflet
1.9.4. A wrong digest does not raise an error — it silently blanks the driver
map. Verify both against what unpkg serves before shipping an APK.

### Build the branch by copying files, never by applying diffs

Five files carry hunks that are already live in `e4043ce`: `trips.py`,
`driver_trips.py`, `test_trip_execution.py`, manager `client.ts` and
`TripsPage.tsx`. A HEAD-relative diff would re-add those hunks and conflict. Every
dirty file except `POST_DEMO_STATE.md` hash-matches the snapshot tag, so the tag
is a safe source to copy whole files from.

### Changed after the inventory — copy these from the working tree, not the tag

Fixes made on 26 September 2026 after this inventory, each shown failing before
the change and passing after, none committed. For every file below the snapshot
tag is **stale**: copy it from the working tree.

**Live on hosted `e4043ce` too — each applies to `e4043ce` on its own and is a
hotfix candidate (deploying is the user's decision):**

| defect | files | proof |
|---|---|---|
| Blocked AI prompts logged their first 50 characters (driver words + trip facts) at WARNING | `backend/app/services/gemini.py`, `backend/tests/test_gemini_ai.py` | log-leak assertions red then green |
| Login matched the identifier as a SQL `LIKE` pattern: `%%%` hit every account and returned 503 instead of 401 | `backend/app/services/auth.py`, `backend/tests/test_auth.py` | `test_email_wildcards_are_literal` 503 then 401 |
| A DELIVERED trip left "Open trips" for a History tab labelled read-only, although it still holds its driver and truck until Close; the "Close to release the truck" filter could never match | `backend/app/services/trips.py` (`HISTORY_STATUSES`), `backend/tests/test_midtrip_stops_and_history.py`, `manager-web/src/pages/TripsPage.tsx` | test red then green; browser: delivered trip now listed with Close |
| After Close/Cancel the planner kept "reserved by" labels for up to 5 s (the open-trips list was not reloaded) | `manager-web/src/pages/TripsPage.tsx`, `manager-web/src/pages/TripsPage.test.tsx` | test fails without the line, passes with it |
| Planner pre-filled a cargo weight of 1000 kg that nobody entered | `manager-web/src/pages/TripsPage.tsx`, `manager-web/src/pages/TripsPage.test.tsx` | field starts empty; blocked until a weight is typed |
| "Landslide data is not available" printed above a landslide-history panel with 23 records; it meant *live reports* | `i18n/reason_codes.json` and its two byte-identical mirrors in `manager-web/src/i18n/` and `driver-app/src/i18n/` | parity test 23/23; hi/as wording not reviewed by a native speaker |

**Local only (never shipped):**

| defect | files | lands in |
|---|---|---|
| DEP-6: the must-reset gate read `request.url.path`, which a forged `Host` rewrites | `backend/app/api/deps.py`, `backend/tests/test_org_api.py` | commits 31 / 32 |
| `Cache-Control: no-store` rule read `request.url.path` too | `backend/app/main.py` | commit 4 (security_headers hunk) |
| A driver stored as `+91…` could never sign in from the app, which sends ten digits; exact match still wins, ambiguous forms are refused | `backend/app/services/auth.py`, `backend/tests/test_auth.py` | with the auth commit |
| Overview "Stale GPS" hint said "Online, but the position is old" — stale GPS is counted regardless of presence | `manager-web/src/pages/OverviewPage.tsx` | commit 34 |
| Driver sign-in placeholder was the demo driver's real login number; now the existing translated catalogue key | `driver-app/src/screens/LoginScreen.tsx` | commit 14 |

Backend full suite after the DEP-6 fix: **1456 passed, 5 skipped, 0 failed**.
Manager **342/342**, driver **704/704**, both `tsc` clean after every change above.

**Found, not fixed — blocks the state/district RBAC commits (25–32):** nothing in
the API ever writes `shipments.origin_district_id` / `destination_district_id`.
Scope, district notifications and the dashboard read them; only seed data sets
them. A trip planned in the console is therefore invisible to every state and
district manager (proven in the browser and by direct-ID requests). Choosing how
a district is resolved (geocoder address, dispatcher choice, boundaries) is a
product decision; it must be made before those commits can pass.

## 3a. What was verified, and what was not

**Frontends: verified at every position.** The plan was replayed cumulatively
onto a scratch extract of `origin/main`, and `tsc` plus `vitest` ran at each
frontend commit. All green, ending where the dirty tree ends — manager 268 → 342
tests, driver 624 → 704.

**Backend: import-verified only.** Each position was checked with `create_app()`
and `pytest --collect-only`. **The DB-backed suites were not executed** during
planning. Every backend `testCommand` below still has to be run for real on the
isolated cluster as each commit lands.

The isolated test database is at `0013_state_district_inbox`. Commits 2–24 run
against its extra nullable 0013 columns, which proves the code but not the 0012
schema. A strict 0012 proof needs a database built at 0012 — and because of the
irreversible enum labels above, *downgrading* this one is not a clean substitute.


## 4. Integration order — 38 commits onto `e4043ce`

`0012` = runs on hosted today as-is. `0013` = needs migration 0013 on hosted first.

| # | runs on | subsystem | files | commit |
|---:|---|---|---:|---|
| 1 | 0012 | DOCS | 3 | Record the post-demo reconciliation state and the hosted certifications |
| 2 | 0012 | SECURITY | 3 | SEC-006 groundwork: exact database-host parsing, a trusted-hop client address, and new settings |
| 3 | 0012 | TOOLING | 4 | Refuse to let seed and demo loaders write anywhere but a local database |
| 4 | 0012 | SECURITY | 3 | Response hardening headers, streamed upload cap, Render static-site headers |
| 5 | 0012 | SECURITY | 5 | Scope TRUCK_READ and driver documents to the caller; one date rule for both document endpoints; refuse expired |
| 6 | 0012 | POI | 4 | Offer FUEL only because the snapshot now carries it: a reproducible OpenStreetMap extract |
| 7 | 0012 | DRIVER_APP | 2 | AI prompts: answer in the driver's chosen language, understand any input language |
| 8 | 0012 | MANAGER_REDESIGN | 2 | Manager tokens: forest palette, the missing --color-faint, optional Field icon/trailing/large |
| 9 | 0012 | MANAGER_REDESIGN | 8 | Manager client extras beyond e4043ce; fleet utilisation that can be unknown |
| 10 | 0012 | TRIPS | 2 | Trips page: yard name beside the registration, visible row selection (extra beyond e4043ce) |
| 11 | 0012 | DRIVERS | 3 | Drivers page fits 320 px; 'Valid till'; export XSS regression case |
| 12 | 0012 | DRIVER_APP | 5 | Driver phrasebook for this slice, and document dates a driver can actually type |
| 13 | 0012 | DRIVER_APP | 3 | Guidance and background notices follow the language the driver chose |
| 14 | 0012 | DRIVER_APP | 4 | Driver palette with WCAG-checked contrast, sign-in screen, honest cold-start copy |
| 15 | 0012 | DRIVER_APP | 4 | Fuel gauge replaces the free-text fuel percentage |
| 16 | 0012 | SECURITY | 5 | SEC-008: Subresource Integrity on the Leaflet WebView assets; keyless relief fallback |
| 17 | 0012 | DOCS | 2 | Reference audit and single-status source admission ledger |
| 18 | 0012 | TOOLING | 1 | Shared Markdown to DOCX/PDF build engine |
| 19 | 0012 | DOCS | 24 | Day 1 Task 3 report with its evidence and the 18 figures it embeds |
| 20 | 0012 | DOCS | 34 | Day 2 Task 1 backend, API and database evidence (frozen at 7c176f3) |
| 21 | 0012 | SECURITY | 37 | Day 2 Task 2 security assessment rebuilt from its Markdown; Task 3 mitigation |
| 22 | 0012 | DOCS | 1 | Final deck regenerated together with its tracked PDF and preview |
| 23 | **0013** | MAP | 4 | Manager map: 2D/terrain/3D modes that fall back to flat, roadside services layer |
| 24 | 0012 | MIGRATIONS | 3 | Migration 0013 deployment packet (backup precondition), data hygiene audit, RBAC design of record |
| 25 | **0013** | MIGRATIONS | 13 | Migration 0013: states, districts, notification inbox, scoped roles; models, factories and drift ledger |
| 26 | **0013** | RBAC | 4 | Row-scope predicates for state and district managers |
| 27 | **0013** | AUTH | 3 | Session payload carries scope; the workspace hint can only refuse |
| 28 | **0013** | TRIPS | 11 | Trip lifecycle: scope-aware loads, dispatch compliance gate, district notifications (extra beyond e4043ce only |
| 29 | **0013** | NOTIFICATIONS | 2 | Announce approved route changes to the driver and the districts |
| 30 | **0013** | TRIPS | 2 | HTTP row scoping for trips, shipments and the fleet map |
| 31 | **0013** | AUTH | 1 | Forced password reset and workspace-checked sign-in; SEC-006 wired |
| 32 | **0013** | STATE_DISTRICT | 13 | Org hierarchy, dashboard, presence, notification inbox, manager places, driver stop request, and the router wi |
| 33 | **0013** | AUTH | 4 | Scope-then-credentials sign-in for the manager console |
| 34 | **0013** | MANAGER_REDESIGN | 6 | Console shell: overview landing, states, managers, notifications, reports |
| 35 | **0013** | DRIVER_APP | 2 | Driver API client: timeout flag, 60 s auth budget, FUEL, heartbeat and stop-request calls |
| 36 | **0013** | MAP | 1 | Driver map: FUEL chip and a quieter idle card |
| 37 | **0013** | TRIPS | 1 | Driver trip: confirm sheets, from-to hero, stop request, presence heartbeat, localized background notices |
| 38 | **0013** | DRIVER_APP | 7 | Driver tutorial, Light/Dark wording, version 1.0.22 |

<details><summary>Rationale and test command for every commit</summary>

### 1. Record the post-demo reconciliation state and the hosted certifications

**Files:** `docs/POST_DEMO_STATE.md`, `docs/REMOTE_SUPABASE_RUNTIME_CERTIFICATION.md`, `docs/REDESIGN_CERTIFICATION.md`

This goes first because docs/POST_DEMO_STATE.md is the only dirty file missing from snapshot/post-demo-2026-09-26. I compared all 277 dirty files with `git hash-object` against the tag: 276 match byte for byte and this one is absent, so a clean or reset before this commit would lose it. REWORK POST_DEMO_STATE before committing: the untracked count is 193 per file, not the collapsed 103, and apply the classification's second fix too. The other two docs are dated records. REDESIGN_CERTIFICATION line 6 still says hosted runs 5b5e474, but hosted runs e4043ce; correct that line when committing. No runtime effect.

```bash
grep -q 193 docs/POST_DEMO_STATE.md && python -c "import re,os,sys; bad=[(m,r) for m in sys.argv[1:] for r in set(re.findall(r'[(]([^()#<> ]+[.](?:png|svg|json|txt|pdf|docx))[)]', open(m,encoding='utf8').read())) if not (os.path.exists(os.path.join(os.path.dirname(m),r)) or os.path.exists(r))]; assert not bad, bad" docs/POST_DEMO_STATE.md docs/REMOTE_SUPABASE_RUNTIME_CERTIFICATION.md docs/REDESIGN_CERTIFICATION.md
```

### 2. SEC-006 groundwork: exact database-host parsing, a trusted-hop client address, and new settings

**Files:** `backend/app/core/config.py`, `backend/app/core/rate_limit.py`, `backend/tests/test_trusted_proxy.py`

Additive and 0012-safe. In config.py, `_host_of` now parses with SQLAlchemy make_url, which fixes passwords containing / ? #. TRUSTED_PROXY_HOPS defaults to 0, where behaviour matches the deployed request.client.host. DRIVER_COMPLIANCE_GRACE_DAYS is added and first read in commit 28. rate_limit.client_address is a pure function. Its only production caller is the `_peer` hunk of api/auth.py, which is BLOCKED and joins commit 31, so this commit does NOT close SEC-006 on its own. It must come before commit 3 (disposable.py depends on _host_of) and commit 4 (render.yaml sets TRUSTED_PROXY_HOPS). Replay: create_app() gives 89 routes and 1249 tests collect. The isolated test cluster is already at 0013_state_district_inbox. Code at commits 2-24 cannot resolve that revision, so do not run `alembic upgrade head` before commit 25. The targeted tests run fine against the extra nullable columns.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_trusted_proxy.py tests/test_rate_limit.py tests/test_config.py tests/test_db_target_guard.py tests/test_auth.py
```

### 3. Refuse to let seed and demo loaders write anywhere but a local database

**Files:** `backend/app/core/disposable.py`, `backend/tests/test_disposable_guard.py`, `backend/scripts/demo_scenario.py`, `backend/scripts/terrain_seed.py`

A fail-closed guard (stdlib plus config._host_of from commit 2). Both fixture loaders call assert_disposable before get_settings and db_target.enforce. The app never imports it at runtime. No 0013 dependency. Replay: 1258 tests collect.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_disposable_guard.py
```

### 4. Response hardening headers, streamed upload cap, Render static-site headers

**Files:** `backend/app/main.py`, `backend/app/api/files.py`, `render.yaml`

main.py is deliberately split, and this is its only commit. Stage ONLY hunks 2 and 3 of `git diff origin/main -- backend/app/main.py`: @@ -156 (corrected API description) and @@ -181 (the security_headers middleware). Leave hunks 1, 4 and 5 unstaged (@@ -17: five router imports; @@ -191 and @@ -199: five include_router calls). They are held in `blocked` and land in commit 32 in the same commit as the five routers they import, never before them. I replayed hunks 2 and 3 onto e4043ce: they apply cleanly and create_app() still has 89 routes. files.py replaces the whole-body read with a Content-Length pre-check and a streaming cap. render.yaml adds SEC-005 headers on both static sites and TRUSTED_PROXY_HOPS=1. That variable stays inert until api/auth.py (commit 31) calls client_address, which is harmless, but it means SEC-006 is not closed on hosted by deploying this commit. This is the 'hosted headers pending deploy' item from the Day 2 security work.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -c "from fastapi.testclient import TestClient; from app.main import create_app; a=create_app(); h=TestClient(a).get('/health').headers; assert h['x-frame-options']=='DENY' and h['x-content-type-options']=='nosniff' and h['referrer-policy']=='no-referrer', dict(h); assert not [r.path for r in a.routes if r.path.startswith(('/api/org','/api/dashboard','/api/presence','/api/notifications','/api/places'))], 'router wiring leaked into commit 4'" && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_files_documents.py tests/test_health.py
```

### 5. Scope TRUCK_READ and driver documents to the caller; one date rule for both document endpoints; refuse expired licences at creation

**Files:** `backend/app/api/fleet.py`, `backend/app/services/trucks.py`, `backend/app/api/documents.py`, `backend/app/services/drivers.py`, `backend/tests/test_document_dates.py`

These are Day 2 BOLA fixes and are 0012-safe. fleet.py and trucks.py must be one commit: list_trucks now takes a keyword-only `actor` with no default. documents.py resolves the driver through drivers.get(actor=), which already exists at e4043ce. Both /api/driver/me/documents and /api/driver/me/truck-documents live in documents.py, so test_document_dates needs nothing from the BLOCKED driver.py. It uses only factories that exist at origin. REWORK drivers.py: move the LICENCE_EXPIRED check above `db.add(user)` / `await db.flush()`, so it refuses before the INSERT. No existing test creates an expired driver through the API; test_api_fleet:426 uses the factory. Replay: 1270 tests collect.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_document_dates.py tests/test_files_documents.py tests/test_api_fleet.py tests/test_driver_self.py tests/test_authorization.py
```

### 6. Offer FUEL only because the snapshot now carries it: a reproducible OpenStreetMap extract

**Files:** `backend/app/domain/places.py`, `backend/app/services/places/snapshot.py`, `backend/app/services/places/data/corridor_snapshot.json`, `backend/scripts/acquire_places_snapshot.py`

places.py and snapshot.py must share a commit: snapshot.py passes is_extent=True, which the old frozen dataclass rejects with a TypeError at import. The snapshot has ODbL provenance and 726 FUEL records, and acquire_places_snapshot.py is the recipe that produced it. The deployed driver endpoint requires a category, so the deployed APK never receives FUEL rows it cannot draw. This data lands before the two consumers (manager /api/places in commit 32 and the driver FUEL chip in commit 36), so neither chip is ever offered without data behind it.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_places_snapshot.py tests/test_driver_self.py
```

### 7. AI prompts: answer in the driver's chosen language, understand any input language

**Files:** `backend/app/domain/ai_prompts.py`, `backend/tests/test_ai_language.py`

Prompt text only: no schema, no new import. The test asserts the prompt, never model behaviour. Replay: 1277 tests collect.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_ai_language.py
```

### 8. Manager tokens: forest palette, the missing --color-faint, optional Field icon/trailing/large

**Files:** `manager-web/src/index.css`, `manager-web/src/components/ui.tsx`

Neither file was touched by e4043ce. This lands first on the manager side because FleetPage (.fleet-detail--empty), App.tsx (.topbar/.rail-region/.app-main), text-faint users and buttonClasses.test all read index.css. The ui.tsx Field props are optional, so existing call sites do not change. Replay: tsc clean, 268 vitest tests pass.

```bash
cd manager-web && npx tsc -b --noEmit && npx vitest run
```

### 9. Manager client extras beyond e4043ce; fleet utilisation that can be unknown

**Files:** `manager-web/src/api/client.ts`, `manager-web/src/api/coldStart.test.ts`, `manager-web/src/api/supabaseManagerApi.ts`, `manager-web/src/hooks/useFleetPoll.test.ts`, `manager-web/src/components/FleetKpiBar.tsx`, `manager-web/src/components/FleetKpiBar.test.tsx`, `manager-web/src/pages/FleetPage.tsx`, `manager-web/src/pages/FleetPage.test.tsx`

client.ts carries ONLY its delta beyond origin/main. e4043ce already has the in-flight GET coalescing (inFlight + shareable), and `git diff origin/main` shows no logic change there, only two reworded comments; drop those if you want the deployed block byte-identical. Build the file on top of e4043ce, never from the HEAD-relative diff. These eight files must be one commit: FleetSnapshot.trucks_total becomes a required field; supabaseManagerApi, useFleetPoll.test and FleetPage.test.tsx all build typed FleetSnapshot objects; and FleetKpiBar renames its props, which FleetPage and FleetKpiBar.test follow. coldStart.test reads AUTH_TIMEOUT_MS out of client.ts. The new methods (dashboard/org/notifications/presence/places) are unreferenced until commits 23, 33 and 34. On hosted, trucks_total is absent, so the KPI shows an em dash instead of the old always-100%. Replay: 280 tests pass.

```bash
cd manager-web && npx tsc -b --noEmit && npx vitest run
```

### 10. Trips page: yard name beside the registration, visible row selection (extra beyond e4043ce)

**Files:** `manager-web/src/pages/TripsPage.tsx`, `manager-web/src/pages/TripsPage.test.tsx`

TripsPage.tsx carries ONLY its delta beyond origin/main. reloadAfterLifecycleChange is already live in e4043ce, and re-applying the HEAD-relative hunk would conflict. display_name is optional and falls back to the registration on a 0012 backend. TripsPage.test.tsx is entirely new relative to origin/main (the hotfix did not touch it). It pins that terminal actions reload drivers, trucks and assignments. Replay: 281 tests pass.

```bash
cd manager-web && npx tsc -b --noEmit && npx vitest run
```

### 11. Drivers page fits 320 px; 'Valid till'; export XSS regression case

**Files:** `manager-web/src/pages/DriversPage.tsx`, `manager-web/src/components/DriverProfileDrawer.tsx`, `manager-web/src/pages/tripExport.test.ts`

Self-contained, and every other page must precede App.tsx (commit 34): a layout wrap fix, a one-word label change, and SEC-XSS-003 run against the unmodified tripExport.ts. Replay: 282 tests pass.

```bash
cd manager-web && npx tsc -b --noEmit && npx vitest run
```

### 12. Driver phrasebook for this slice, and document dates a driver can actually type

**Files:** `driver-app/src/i18n/phrases.ts`, `driver-app/src/components/ui.tsx`, `driver-app/src/screens/documentDates.ts`, `driver-app/src/screens/documentDates.test.ts`, `driver-app/src/screens/MyDetailsScreen.tsx`

The replay forced this grouping. The local phrases.ts deletes three origin keys. 'Valid until' is used only by the origin MyDetailsScreen, so MyDetailsScreen (and the ui.tsx Field maxLength/error and documentDates it needs) must share this commit; otherwise coverage.test.ts fails with 'untranslated: Valid until'. 'Day — light surfaces' and 'Night — dark cab surfaces' are used by the origin MoreScreen, which cannot move before commit 38 (it is gated behind TripScreen). So there is an ORDERING-FORCED REWORK on phrases.ts: keep those two origin entries, copied verbatim from origin/main (nothing invented). Without them, coverage.test fails at every commit from 12 to 37. With them, the full chain passes, and unused keys fail nothing (themeWording.test scans only t()/tx()/labels). documentDates REWORK: add its two validation messages to phrases.ts here, so phrases.ts stays in one commit. phrases.ts must precede commits 13-15, which use its new strings. ConfirmSheet in ui.tsx has no caller until TripScreen (commit 37). Replay: 637 tests pass.

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 13. Guidance and background notices follow the language the driver chose

**Files:** `driver-app/src/i18n/language.ts`, `driver-app/src/screens/SafetyScreen.tsx`, `driver-app/src/trip/notificationLanguage.test.ts`

language.ts adds currentAppLanguage() (TripProvider needs it in commit 37) and useGuidanceLanguage(). SafetyScreen now says when no reviewed translation exists. notificationLanguage.test only needs PHRASES/tx, not TripProvider. The language.ts <-> AppLanguageProvider import cycle is benign today because only hoisted functions are involved. Replay: 640 tests pass.

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 14. Driver palette with WCAG-checked contrast, sign-in screen, honest cold-start copy

**Files:** `driver-app/src/theme.ts`, `driver-app/src/theme.contrast.test.ts`, `driver-app/src/screens/LoginScreen.tsx`, `driver-app/src/auth/authErrors.ts`

REWORK theme.ts: remove the stacked duplicate 'Day palette' JSDoc. REWORK authErrors.ts: remove the repeated timedOut explanation and the orphaned one-liner. authErrors duck-types `timedOut`, so it works before the driver client.ts lands (the web abort message already matches); the React Native flag arrives in commit 35. Its 'Server is waking up' copy comes from commit 12. Replay: 668 tests pass.

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 15. Fuel gauge replaces the free-text fuel percentage

**Files:** `driver-app/src/components/FuelGauge.tsx`, `driver-app/src/components/fuelLevels.ts`, `driver-app/src/components/FuelGauge.test.ts`, `driver-app/src/screens/AssignmentScreen.tsx`

Five fixed marks, with no SVG dependency. parseReadings narrows to FuelPct \| null, so the removed 0-100 validation is not lost. Its strings come from commit 12. Replay: 673 tests pass.

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 16. SEC-008: Subresource Integrity on the Leaflet WebView assets; keyless relief fallback

**Files:** `driver-app/src/map/DriverRouteMap.native.tsx`, `driver-app/src/map/subresourceIntegrity.test.ts`, `driver-app/src/map/scene.ts`, `driver-app/src/map/hillshadeSource.test.ts`, `driver-app/src/map/DriverRouteMap.web.tsx`

DriverRouteMap.web.tsx drops the null guard, so it needs scene.ts's always-a-string HILLSHADE_URL in the same commit. REWORK scene.ts per its classification on the OpenTopoMap fallback. Check in particular that the attribution also credits OpenStreetMap contributors, which OpenTopoMap asks for. The FUEL colour key is inert data. The two sha384 digests have not been checked against what unpkg serves. The test proves the attributes are present, not that the hashes are correct, and a wrong digest blanks the map for every driver. Replay: 684 tests pass.

**Gate:** DEPLOY-ONLY: verify both sha384 digests against https://unpkg.com/leaflet@1.9.4/dist/leaflet.{css,js} before any APK or web build ships this commit

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 17. Reference audit and single-status source admission ledger

**Files:** `docs/research/GITHUB_REFERENCE_AUDIT.md`, `docs/FINAL_SOURCE_ADMISSION_LEDGER.md`

Documentation only. It replaces a blanket NOT_AUDITED record with per-repository facts, and the ledger gives every source one status. No runtime effect.

```bash
python -c "import re,os,sys; bad=[(m,r) for m in sys.argv[1:] for r in set(re.findall(r'[(]([^()#<> ]+[.](?:png|svg|json|txt|pdf|docx))[)]', open(m,encoding='utf8').read())) if not (os.path.exists(os.path.join(os.path.dirname(m),r)) or os.path.exists(r))]; assert not bad, bad" docs/research/GITHUB_REFERENCE_AUDIT.md docs/FINAL_SOURCE_ADMISSION_LEDGER.md
```

### 18. Shared Markdown to DOCX/PDF build engine

**Files:** `docs/submission/day1/build_docs.py`

This is a hard prerequisite for the three build_report.py scripts in commits 19-21, which all `import build_docs as bd`. pair_screenshots() imports Pillow lazily. I checked that the module imports cleanly with no arguments.

```bash
python -c "import sys; sys.path.insert(0,'docs/submission/day1'); import build_docs; assert hasattr(build_docs,'pair_screenshots')" && python -c "import PIL, docx"
```

### 19. Day 1 Task 3 report with its evidence and the 18 figures it embeds

**Files:** `docs/submission/day1/task3/RASTA_AI_Task_Report.md`, `docs/submission/day1/task3/RASTA_AI_Task_Report.docx`, `docs/submission/day1/task3/RASTA_AI_Task_Report.pdf`, `docs/submission/day1/task3/build_report.py`, `docs/submission/day1/task3/evidence-results.json`, `docs/submission/day1/task3/evidence-driver-results.json`, `docs/submission/day1/task3/screenshots/00-architecture.png`, `docs/submission/day1/task3/screenshots/01-login-desktop.png`, `docs/submission/day1/task3/screenshots/02-login-mobile.png`, `docs/submission/day1/task3/screenshots/03-login-error.png`, `docs/submission/day1/task3/screenshots/04-fleet-desktop.png`, `docs/submission/day1/task3/screenshots/05-fleet-tablet.png`, `docs/submission/day1/task3/screenshots/06-fleet-mobile.png`, `docs/submission/day1/task3/screenshots/07-trips-desktop.png`, `docs/submission/day1/task3/screenshots/08-trips-mobile.png`, `docs/submission/day1/task3/screenshots/09-drivers-desktop.png`, `docs/submission/day1/task3/screenshots/10-drivers-validation-422.png`, `docs/submission/day1/task3/screenshots/11-trucks-desktop.png`, `docs/submission/day1/task3/screenshots/12-assignments-desktop.png`, `docs/submission/day1/task3/screenshots/13-review-desktop.png`, `docs/submission/day1/task3/screenshots/14-diagnostics-desktop.png`, `docs/submission/day1/task3/screenshots/15-diagnostics-tablet.png`, `docs/submission/day1/task3/screenshots/32-driver-a.png`, `docs/submission/day1/task3/screenshots/33-driver-b.png`

The .md, .docx and .pdf are in sync (built 18 Sep 17:37-38). The report links exactly these 18 images, and the link check confirms it does not reference the 8 dropped frames. build_report.py is path-clean and needs build_docs.py from commit 18. 09-drivers-desktop.png shows demo-driver names with 10-digit login identifiers; the owner should decide on redaction before any public push.

```bash
python -c "import re,os,sys; bad=[(m,r) for m in sys.argv[1:] for r in set(re.findall(r'[(]([^()#<> ]+[.](?:png|svg|json|txt|pdf|docx))[)]', open(m,encoding='utf8').read())) if not (os.path.exists(os.path.join(os.path.dirname(m),r)) or os.path.exists(r))]; assert not bad, bad" docs/submission/day1/task3/RASTA_AI_Task_Report.md && python -c "import ast; ast.parse(open('docs/submission/day1/task3/build_report.py',encoding='utf8').read())"
```

### 20. Day 2 Task 1 backend, API and database evidence (frozen at 7c176f3)

**Files:** `docs/DAY2_TASK1_API_TEST_RESULTS.md`, `docs/DAY2_TASK1_CRUD_DOCUMENTATION.md`, `docs/DAY2_TASK1_ER_DIAGRAM.md`, `docs/DAY2_TASK1_INTEGRATION_EVIDENCE.md`, `docs/DAY2_TASK1_FINAL_REPORT.md`, `SUBMISSION_README.md`, `docs/submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.md`, `docs/submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.pdf`, `docs/submission/day2/task1/api-results.json`, `docs/submission/day2/task1/api_evidence.py`, `docs/submission/day2/task1/build_report.py`, `docs/submission/day2/task1/er-diagram.png`, `docs/submission/day2/task1/er-diagram.svg`, `docs/submission/day2/task1/evidence-results.json`, `docs/submission/day2/task1/evidence-results-pass2.json`, `docs/submission/day2/task1/evidence-results-pass3.json`, `docs/submission/day2/task1/render_er.mjs`, `docs/submission/day2/task1/render_figs.mjs`, `docs/submission/day2/task1/figures/arch.png`, `docs/submission/day2/task1/figures/ercore.png`, `docs/submission/day2/task1/screenshots/01_backend_health.png`, `docs/submission/day2/task1/screenshots/02_backend_ready_database.png`, `docs/submission/day2/task1/screenshots/03_fastapi_swagger.png`, `docs/submission/day2/task1/screenshots/03b_fastapi_swagger_trips.png`, `docs/submission/day2/task1/screenshots/07_manager_backend_integration_fleet.png`, `docs/submission/day2/task1/screenshots/07b_manager_drivers_list.png`, `docs/submission/day2/task1/screenshots/07c_manager_trucks_list.png`, `docs/submission/day2/task1/screenshots/07d_manager_diagnostics_providers.png`, `docs/submission/day2/task1/screenshots/08_driver_backend_integration_trip.png`, `docs/submission/day2/task1/screenshots/08b_driver_navigate_guidance.png`, `docs/submission/day2/task1/screenshots/08c_driver_more.png`, `docs/submission/day2/task1/screenshots/09_trip_workflow_trips_list.png`, `docs/submission/day2/task1/screenshots/09c_trip_review_panel.png`, `docs/submission/day2/task1/screenshots/09d_trip_journey_history.png`

These are dated snapshots pinned to 7c176f3 and the 86 deployed routes. They are correct as frozen records and must not be retrofitted with the post-0013 routes. REWORKs to apply first: in DAY2_TASK1_FINAL_REPORT.md, rewrite §16 'Files changed this session (uncommitted)' now that the files are committed; in render_er.mjs and render_figs.mjs, drop the gitignored ../../../../.runtime/rehearsal/cdp.mjs import and the hardcoded D:/ root (derive paths from import.meta.url); in api_evidence.py, drop the hardcoded ROOT (reading gitignored credentials stays, and is intentional). Keep render_figs.mjs: it holds the only Mermaid source for figures/arch.png and ercore.png. SUBMISSION_README points at DAY2_TASK1_FINAL_REPORT, so it rides here. 07b is byte-identical to day1's 09-drivers screenshot and carries the same identifier-redaction question.

```bash
! grep -lE "D:.Projects|runtime/rehearsal" docs/submission/day2/task1/render_er.mjs docs/submission/day2/task1/render_figs.mjs docs/submission/day2/task1/api_evidence.py && ! grep -q "Files changed this session (uncommitted)" docs/DAY2_TASK1_FINAL_REPORT.md && node --check docs/submission/day2/task1/render_er.mjs && node --check docs/submission/day2/task1/render_figs.mjs && python -c "import re,os,sys; bad=[(m,r) for m in sys.argv[1:] for r in set(re.findall(r'[(]([^()#<> ]+[.](?:png|svg|json|txt|pdf|docx))[)]', open(m,encoding='utf8').read())) if not (os.path.exists(os.path.join(os.path.dirname(m),r)) or os.path.exists(r))]; assert not bad, bad" docs/submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.md docs/DAY2_TASK1_FINAL_REPORT.md docs/DAY2_TASK1_INTEGRATION_EVIDENCE.md docs/DAY2_TASK1_API_TEST_RESULTS.md docs/DAY2_TASK1_ER_DIAGRAM.md docs/DAY2_TASK1_CRUD_DOCUMENTATION.md SUBMISSION_README.md
```

### 21. Day 2 Task 2 security assessment rebuilt from its Markdown; Task 3 mitigation

**Files:** `docs/DAY2_TASK2_SECURITY_TEST_PLAN.md`, `docs/submission/day2/task2/DAY2_TASK2_SECURITY_RESULTS.md`, `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.md`, `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.docx`, `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.pdf`, `docs/submission/day2/task2/build_report.py`, `docs/submission/day2/task2/security_probe.py`, `docs/submission/day2/task2/render_evidence.mjs`, `docs/submission/day2/task2/xss_browser_check.mjs`, `docs/submission/day2/task3/RASTA_AI_DAY2_TASK3_MITIGATION.md`, `docs/submission/day2/task2/evidence/01_scope_environment.png`, `docs/submission/day2/task2/evidence/02_sqli_test.png`, `docs/submission/day2/task2/evidence/03_xss_test.png`, `docs/submission/day2/task2/evidence/03b_xss_trips.png`, `docs/submission/day2/task2/evidence/04_security_headers.png`, `docs/submission/day2/task2/evidence/05_file_upload_validation.png`, `docs/submission/day2/task2/evidence/06_session_security.png`, `docs/submission/day2/task2/evidence/07_api_unauthorized_access.png`, `docs/submission/day2/task2/evidence/08_api_role_access.png`, `docs/submission/day2/task2/evidence/09_rate_limit.png`, `docs/submission/day2/task2/evidence/10_secret_scan.png`, `docs/submission/day2/task2/evidence/10b_secret_scan_full.png`, `docs/submission/day2/task2/evidence/10c_bundle_dependencies.png`, `docs/submission/day2/task2/evidence/11_security_tests.png`, `docs/submission/day2/task2/evidence/12_final_regression.png`, `docs/submission/day2/task2/evidence/backend_full_suite.txt`, `docs/submission/day2/task2/evidence/dependency_audit.txt`, `docs/submission/day2/task2/evidence/driver_regression.txt`, `docs/submission/day2/task2/evidence/headers_before_after.txt`, `docs/submission/day2/task2/evidence/manager_regression.txt`, `docs/submission/day2/task2/evidence/probe_postfix.txt`, `docs/submission/day2/task2/evidence/probe_prefix_baseline.txt`, `docs/submission/day2/task2/evidence/regression_tests.txt`, `docs/submission/day2/task2/evidence/regression_tests_fail_without_fix.txt`, `docs/submission/day2/task2/evidence/results.json`, `docs/submission/day2/task2/evidence/secret_scan.txt`, `docs/submission/day2/task2/evidence/xss_browser_results.json`

This lands after the fixes it describes: headers and the upload cap (commit 4), BOLA and truck scoping (commit 5), SRI (commit 16). REWORK: rebuild the .docx and .pdf with this folder's build_report.py. They are dated 19 Sep 14:44, against a .md edited 20 Sep 01:17 that marks SEC-006 and SEC-008 CLOSED; today the .docx does not contain 'CLOSED 20 Sep' (checked). REWORK render_evidence.mjs and xss_browser_check.mjs the same way as commit 20 (remove the gitignored cdp.mjs/human.mjs imports and the hardcoded root). SEC-006 'CLOSED' is true of the working tree; on this branch it only becomes true at commit 31, when api/auth.py wires client_address. I grepped the evidence for secrets and found nothing to scrub.

```bash
python -c "import docx,pypdf; b='docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL'; d=docx.Document(b+'.docx'); t=' '.join(' '.join([p.text for p in d.paragraphs]+[c.text for tb in d.tables for r in tb.rows for c in r.cells]).split()); p=' '.join(' '.join(pg.extract_text() for pg in pypdf.PdfReader(b+'.pdf').pages).split()); assert t.count('CLOSED 20 Sep')>=2, 'docx stale'; assert p.count('CLOSED 20 Sep')>=2, 'pdf stale'" && ! grep -lE "D:.Projects|runtime/rehearsal" docs/submission/day2/task2/render_evidence.mjs docs/submission/day2/task2/xss_browser_check.mjs && node --check docs/submission/day2/task2/render_evidence.mjs && node --check docs/submission/day2/task2/xss_browser_check.mjs && python -c "import re,os,sys; bad=[(m,r) for m in sys.argv[1:] for r in set(re.findall(r'[(]([^()#<> ]+[.](?:png|svg|json|txt|pdf|docx))[)]', open(m,encoding='utf8').read())) if not (os.path.exists(os.path.join(os.path.dirname(m),r)) or os.path.exists(r))]; assert not bad, bad" docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.md docs/submission/day2/task2/DAY2_TASK2_SECURITY_RESULTS.md docs/submission/day2/task3/RASTA_AI_DAY2_TASK3_MITIGATION.md docs/DAY2_TASK2_SECURITY_TEST_PLAN.md
```

### 22. Final deck regenerated together with its tracked PDF and preview

**Files:** `docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pptx`

The .pptx is a real regeneration: image9 was removed, images 1-8 renumbered, slide3.xml changed, and the thumbnail rebuilt. REWORK: re-render the tracked companions RASTA_AI_SIH26002_TEAM17_FINAL.pdf and _PREVIEW.png (docs/submission/render_final_deck.ps1 or build_final_deck.py) and include them in this commit. They are tracked and not dirty today, so they are not rows. Without this the submitted PDF contradicts the deck. The unmerged claude/rasta-ai-sih26002-deck-e8xagd branch touches 65 files under docs/submission; compare it before regenerating.

```bash
! git diff --quiet HEAD~1 HEAD -- docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pdf && ! git diff --quiet HEAD~1 HEAD -- docs/submission/RASTA_AI_SIH26002_TEAM17_PREVIEW.png && python -c "import pptx,pypdf; n=len(pptx.Presentation('docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pptx').slides); m=len(pypdf.PdfReader('docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pdf').pages); assert n==m,(n,m)"
```

### 23. Manager map: 2D/terrain/3D modes that fall back to flat, roadside services layer

**Files:** `manager-web/src/components/mapTerrain.ts`, `manager-web/src/components/mapTerrain.test.ts`, `manager-web/src/components/PlacesLayer.tsx`, `manager-web/src/components/FleetMap.tsx`

FleetMap's props are unchanged, so it is independent of FleetPage (commit 9). FleetMap is lazy-loaded by FleetPage and TripRouteReview. PlacesLayer uses api.placesInArea from commit 9. mapTerrain uses the keyless AWS terrain tiles, returns UNKNOWN (never FLAT) when it has no readings, and every failure path falls back to the flat map. This is not deployable: the category group calls GET /api/places, which exists only once commit 32 wires places_router. Replay: 299 tests pass.

**Gate:** DEPLOY-ONLY: /api/places is served only from commit 32 (places_router plus the main.py wiring)

```bash
cd manager-web && npx tsc -b --noEmit && npx vitest run
```

### 24. Migration 0013 deployment packet (backup precondition), data hygiene audit, RBAC design of record

**Files:** `docs/MIGRATION_0013_DEPLOYMENT_PACKET.md`, `docs/DATA_HYGIENE_AUDIT.md`, `docs/STATE_DISTRICT_RBAC_AND_NOTIFICATIONS.md`

Placed immediately BEFORE the migration it guards, so the branch carries the precondition (the packet's 'Backup and recovery — NOT CONFIRMED' section: a Supabase backup from today or PITR enabled) no later than commit 25. The RBAC design doc is referenced by the 0013 docstring. Packet lines 10 and 205 say hosted runs 5b5e474; hosted runs e4043ce, so correct those lines. None of these docs seed district data.

```bash
grep -q "Backup and recovery" docs/MIGRATION_0013_DEPLOYMENT_PACKET.md && python -c "import re,os,sys; bad=[(m,r) for m in sys.argv[1:] for r in set(re.findall(r'[(]([^()#<> ]+[.](?:png|svg|json|txt|pdf|docx))[)]', open(m,encoding='utf8').read())) if not (os.path.exists(os.path.join(os.path.dirname(m),r)) or os.path.exists(r))]; assert not bad, bad" docs/MIGRATION_0013_DEPLOYMENT_PACKET.md docs/DATA_HYGIENE_AUDIT.md docs/STATE_DISTRICT_RBAC_AND_NOTIFICATIONS.md
```

### 25. Migration 0013: states, districts, notification inbox, scoped roles; models, factories and drift ledger

**Files:** `backend/alembic/versions/0013_state_district_inbox.py`, `backend/app/models/enums.py`, `backend/app/models/geography.py`, `backend/app/models/notifications.py`, `backend/app/models/identity.py`, `backend/app/models/operations.py`, `backend/app/models/fleet.py`, `backend/app/models/__init__.py`, `backend/app/schemas/domain.py`, `backend/app/core/permissions.py`, `backend/tests/factories.py`, `backend/tests/test_schema_drift.py`, `docs/DATA_MODEL.md`

These files must land together. identity, operations and fleet map columns that 0013 adds, so on a 0012 database every SELECT on users, trucks or shipments fails. permissions.py names the new UserRole members from enums.py. models/__init__ re-exports geography and notifications. schemas/domain.py's display_name is coupled to models/fleet through Truck(**payload.model_dump()). factories.make_user writes 0013 columns, so from here on every DB-backed test needs 0013. test_schema_drift must land with 0013. down_revision is 0012_push_notifications, the last migration at origin/main. REWORKs: DATA_MODEL.md must name 0013 as in the tree but not applied on hosted; schemas/domain.py per its row (note that min_length=3 on existing pickup/destination fields tightens a deployed contract). Irreversible parts: the user_role labels are added in an autocommit_block and survive downgrade; re-upgrade is idempotent (ADD VALUE IF NOT EXISTS). Seeds 8 states with a recorded source and zero districts. Replay: imports and collection clean (1277). On the isolated cluster, which is already at 0013, `alembic upgrade head` is a no-op.

**Gate:** DEPLOY-ONLY: a confirmed Supabase backup or PITR restore point (precondition documented one commit earlier, in the commit-24 packet), then an operator runs `alembic upgrade 0013_state_district_inbox` on hosted. Schema and this code must go live together.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && [ "$(/d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m alembic heads 2>/dev/null | grep -c head)" = "1" ] && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m alembic upgrade head && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q
```

### 26. Row-scope predicates for state and district managers

**Files:** `backend/app/core/scope.py`, `backend/app/services/shipments.py`, `backend/app/services/telemetry.py`, `backend/tests/test_state_district_scope.py`

scope.py imports app.models.geography (commit 25). shipments.list_shipments and telemetry.active_fleet gain actor=None, so the deployed-shape api/trips.py keeps working until the BLOCKED api/trips.py threads actor through (commit 30). scope.is_scoped is False for every role that exists on hosted today, so this is inert for existing roles. A null district is treated as nobody's, not everyone's. Replay: 1293 tests collect.

**Gate:** DEPLOY-ONLY: same gate as commit 25 (hosted at 0013)

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_state_district_scope.py tests/test_telemetry.py tests/test_shipment_trip_atomicity.py tests/test_schema_drift.py
```

### 27. Session payload carries scope; the workspace hint can only refuse

**Files:** `backend/app/schemas/auth.py`, `backend/app/services/auth.py`, `backend/tests/test_auth.py`

test_auth's exact key-set assertion on /api/auth/me depends on AuthenticatedUser gaining state_id, district_id and must_reset_password here. The deployed /me handler validates that schema, so it needs no router change. services.auth takes workspace=None by default. Until api/auth.py forwards the hint (commit 31), it is ignored, never trusted. PasswordChange is defined here and first used in commit 31. REWORK schemas/auth.py: the MIN_PASSWORD_LENGTH constant splits the import block (cosmetic). Replay: 1293 tests collect.

**Gate:** DEPLOY-ONLY: same gate as commit 25 (hosted at 0013)

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_auth.py tests/test_authorization.py tests/test_schemas.py
```

### 28. Trip lifecycle: scope-aware loads, dispatch compliance gate, district notifications (extra beyond e4043ce only)

**Files:** `backend/app/services/notifications.py`, `backend/app/services/notify.py`, `backend/app/domain/driver_compliance.py`, `backend/app/services/trips.py`, `backend/app/services/driver_trips.py`, `backend/app/services/reroute.py`, `backend/tests/test_trip_execution.py`, `backend/tests/test_notifications.py`, `backend/tests/test_delay_notifications.py`, `backend/tests/test_notification_lifecycle.py`, `backend/tests/test_driver_compliance.py`

trips.py, driver_trips.py and test_trip_execution.py carry ONLY their delta beyond origin/main. e4043ce already has `await release_resources(db, trip)` in close() and its removal from complete(), plus the flipped AVAILABLE->ON_TRIP assertion, so do not re-apply those. What remains is reworded comments plus the new work; for test_trip_execution it is comment prose only. trips.py imports services.notifications at module load, so notifications.py and its models (commit 25) must be at or before this commit. notify.py's EVENTS whitelist must precede routes.py (commit 29). reroute.py's actor= only works with this trips.py. driver_trips.request_stop has no caller until commit 32. REWORK trips.py: in _trip_filters the docstring now sits after the inserted scope lines; move it back to the top. The new dispatch compliance gate refuses drivers past the 7-day grace window without contact or insurance, so check the hosted demo drivers before deploying. recipients_for_trip returns [] when a shipment names no districts. Replay: 1327 tests collect.

**Gate:** DEPLOY-ONLY: hosted at 0013 (commit 25 gate), and hosted demo drivers checked against the compliance window

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_notifications.py tests/test_delay_notifications.py tests/test_notification_lifecycle.py tests/test_driver_compliance.py tests/test_trip_execution.py tests/test_trip_release_after_delivery.py tests/test_notify.py tests/test_reroute.py tests/test_dispatch_route_gate.py tests/test_midtrip_stops_and_history.py
```

### 29. Announce approved route changes to the driver and the districts

**Files:** `backend/app/services/routes.py`, `backend/app/services/route_review.py`

route_review calls routes.announce_route_change, so they share a commit. Both need trips.load_for_update(actor=) and the ROUTE_CHANGED push event from commit 28. The actor pass-throughs enforce scope and need no router change. Replay: 1327 tests collect.

**Gate:** DEPLOY-ONLY: hosted at 0013 (commit 25 gate)

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_route_review_authorization.py tests/test_route_api.py tests/test_reroute_api.py tests/test_driver_reroute_api.py tests/test_notifications.py
```

### 30. HTTP row scoping for trips, shipments and the fleet map

**Files:** `backend/tests/test_scope_http_idor.py`, `backend/tests/test_fleet_utilisation.py`

GATED. The BLOCKED backend/app/api/trips.py joins this commit when released. It threads actor through about 14 reads (404 before disclosure) and adds FleetRead.trucks_total, which test_fleet_utilisation asserts is null, not 0, for scoped roles. test_scope_http_idor imports _trip_between from test_state_district_scope (commit 26). The trips router is already mounted at e4043ce, so no main.py change is needed. Replay with api/trips.py joined: 89 routes, 1340 tests collect.

**Gate:** INTEGRATION-GATE: backend/app/api/trips.py (BLOCKED) must be released into this commit. Deploy additionally needs hosted at 0013.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_scope_http_idor.py tests/test_fleet_utilisation.py tests/test_state_district_scope.py tests/test_telemetry.py
```

### 31. Forced password reset and workspace-checked sign-in; SEC-006 wired

**Files:** `backend/tests/test_login_workspace.py`

GATED. The BLOCKED api/auth.py and api/deps.py join this commit together. deps.py's PASSWORD_RESET_ALLOWED names /api/auth/password, which only api/auth.py provides; landing deps.py alone would lock out every must-reset account. api/auth.py forwards the workspace hint and adds POST /api/auth/password (routes 89 -> 90 in the replay). Its _peer now calls client_address, so only from here does render.yaml's TRUSTED_PROXY_HOPS=1 (commit 4) take effect. Do not raise it above 1. Replay: 1350 tests collect.

**Gate:** INTEGRATION-GATE: backend/app/api/auth.py and backend/app/api/deps.py (BLOCKED) released together into this commit. Deploy additionally needs hosted at 0013.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q tests/test_login_workspace.py tests/test_auth.py tests/test_rate_limit.py tests/test_trusted_proxy.py
```

### 32. Org hierarchy, dashboard, presence, notification inbox, manager places, driver stop request, and the router wiring that registers them

**Files:** `backend/app/domain/presence.py`, `backend/tests/test_org_api.py`, `backend/tests/test_public_regions.py`, `backend/tests/test_fixture_residue_stays_excluded.py`, `backend/tests/test_district_provenance.py`, `backend/tests/test_dashboard.py`, `backend/tests/test_presence.py`, `backend/tests/test_driver_stop_request.py`, `backend/tests/test_manager_places.py`, `backend/tests/test_places_fuel.py`, `backend/tests/test_input_limits.py`, `backend/tests/test_security_assessment.py`, `docs/API_CONTRACTS.md`

GATED, and the router-wiring commit. The BLOCKED api/org.py, api/dashboard.py, api/presence.py, api/notifications.py and api/driver.py join here TOGETHER with main.py's held hunks 1, 4 and 5 (the five router imports and five include_router calls). The wiring therefore lands in the same commit as every router it imports. main.py imports them unconditionally, so if any one is missing the whole app fails to import. Replay: routes 90 -> 103, 1461 tests collect, which matches the dirty tree. This must come after commit 30 (test_org_api and test_fixture_residue use scoped /api/trips and /api/fleet/active) and commit 31 (test_org_api uses /api/auth/password). test_input_limits comes last in the backend because it asserts StopRequest from driver.py and sweeps every served model. REWORKs: test_manager_places (remove the stale 'There is no FUEL category' docstring and the dead CATEGORIES constant); test_security_assessment (replace TestTrustedProxyStillOpen with closed-state assertions, now true since commit 31); API_CONTRACTS.md §15 (add the 14 routes mounted beyond the documented 86: /api/auth/password plus these 13). The check below fails today on exactly those 14.

**Gate:** INTEGRATION-GATE: backend/app/api/{org,dashboard,presence,notifications,driver}.py (BLOCKED) plus main.py hunks 1/4/5 released together into this commit, after commits 30 and 31. Deploy additionally needs hosted at 0013.

```bash
source /d/Projects/ner-ai-logistics/.runtime/use-isolated-db.sh && cd backend && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -c "from app.main import create_app; doc=open('../docs/API_CONTRACTS.md',encoding='utf8').read(); miss=[r.path for r in create_app().routes if r.path.startswith('/api') and r.path not in doc]; assert not miss, miss" && /d/Projects/ner-ai-logistics/backend/.venv/Scripts/python -m pytest -q
```

### 33. Scope-then-credentials sign-in for the manager console

**Files:** `manager-web/src/components/NorthEastMap.tsx`, `manager-web/src/components/TerrainScene.tsx`, `manager-web/src/auth/AuthProvider.tsx`, `manager-web/src/pages/scopeSelector.test.tsx`

GATED. The BLOCKED LoginPage.tsx joins here. It imports AuthProvider (WorkspaceChoice, login(workspace)), NorthEastMap and TerrainScene, all of which land in this same commit, plus client.ts and ui.tsx from commits 8-9. AuthProvider, LoginPage and backend auth form one unit. The deployed APIModel is extra='forbid', so LoginPage against a backend before commit 31 returns 422 on every scoped sign-in, and listRegions needs /api/org/regions (commit 32). NorthEastMap is an aria-hidden schematic of the 8 states with no district geometry. The origin App.tsx still compiles against the new LoginPage. Replay with LoginPage joined: 308 tests pass.

**Gate:** INTEGRATION-GATE: manager-web/src/pages/LoginPage.tsx (BLOCKED) released into this commit, after commits 31-32

```bash
cd manager-web && npx tsc -b --noEmit && npx vitest run
```

### 34. Console shell: overview landing, states, managers, notifications, reports

**Files:** `manager-web/src/pages/ReportsPage.tsx`, `manager-web/src/pages/OverviewPage.test.tsx`, `manager-web/src/pages/OverviewPage.test.ts`, `manager-web/src/pages/NotificationsPage.test.tsx`, `manager-web/src/components/buttonClasses.test.ts`, `manager-web/src/components/tableScroll.test.ts`

GATED. The BLOCKED App.tsx, App.test.tsx, OverviewPage, StatesPage, ManagersPage and NotificationsPage join here. I checked every App.tsx import: Assignments, System, Trucks and Review are unchanged from origin; Drivers is commit 11, Fleet commit 9, Trips commit 10, Login, TerrainScene and AuthProvider commit 33, ui commit 8; Overview, States, Managers, Notifications and Reports are here. So App.tsx lands in the same commit as, or after, every page it imports. App.test.tsx imports scopeLabel from App.tsx and moves with it. The two whole-tree scans go last, after index.css and every page. REWORK ReportsPage: remove the hard gate on api.dashboard at lines 86-87; the report body already comes from /api/trips. App.tsx makes /overview the landing page for the hosted MANAGER role, so it must not deploy before commit 32 runs on 0013. Replay: 342 tests pass, which matches the dirty tree.

**Gate:** INTEGRATION-GATE: manager-web/src/{App.tsx,App.test.tsx,pages/OverviewPage.tsx,pages/StatesPage.tsx,pages/ManagersPage.tsx,pages/NotificationsPage.tsx} (BLOCKED) released into this commit, after commits 32-33

```bash
cd manager-web && npx tsc -b --noEmit && npx vitest run
```

### 35. Driver API client: timeout flag, 60 s auth budget, FUEL, heartbeat and stop-request calls

**Files:** `driver-app/src/auth/coldStart.test.ts`, `driver-app/src/api/stopRequest.test.ts`

GATED. The BLOCKED driver-app/src/api/client.ts joins here. coldStart.test reads AUTH_TIMEOUT_MS and REQUEST_TIMEOUT_MS from its source. stopRequest.test pins the /api/driver/me/trip/stop-request wire contract: the same request_id on retry, and lat/lon omitted rather than zero. It must follow commit 32 because heartbeat and requestTripStop target routes that exist only from there. Replay with client.ts joined: 696 tests pass.

**Gate:** INTEGRATION-GATE: driver-app/src/api/client.ts (BLOCKED) released into this commit, after commit 32

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 36. Driver map: FUEL chip and a quieter idle card

**Files:** `driver-app/src/screens/MapScreen.tsx`

CATEGORY_LABELS is typed PlaceCategory and includes 'FUEL', so tsc needs the client.ts union from commit 35. The data behind the chip has been in the snapshot since commit 6, so the chip is never offered empty. REWORK per its classification row; the idle-card restyle part is clean. Replay: 696 tests pass.

**Gate:** INTEGRATION-GATE: follows commit 35 (driver client.ts)

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 37. Driver trip: confirm sheets, from-to hero, stop request, presence heartbeat, localized background notices

**Files:** `driver-app/src/trip/TripProvider.test.tsx`

GATED. The BLOCKED TripProvider.tsx and TripScreen.tsx join here. They need client.ts heartbeat and requestTripStop (commit 35), ConfirmSheet from ui.tsx (commit 12), currentAppLanguage (commit 13), and the backend presence and stop-request routes (commit 32). TripProvider.test's heartbeat mock belongs with the TripProvider that calls it. TripScreen's ARRIVE and FINISH_STOP ConfirmSheet details are template literals that t() cannot translate (known gap). Replay: 696 tests pass.

**Gate:** INTEGRATION-GATE: driver-app/src/trip/TripProvider.tsx and driver-app/src/screens/TripScreen.tsx (BLOCKED) released into this commit, after commits 32 and 35

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

### 38. Driver tutorial, Light/Dark wording, version 1.0.22

**Files:** `driver-app/App.tsx`, `driver-app/src/screens/MoreScreen.tsx`, `driver-app/src/screens/TutorialScreen.tsx`, `driver-app/src/screens/tutorialSteps.ts`, `driver-app/src/screens/tutorialSteps.test.ts`, `driver-app/src/themeWording.test.ts`, `driver-app/app.json`

These form one atomic unit: MoreScreen's onOpenTutorial is a required prop that App.tsx supplies, and App.tsx renders TutorialScreen. tutorialSteps.test greps TripScreen for 'request a stop', so this must follow commit 37. A tutorial describing an emergency control that is not there would mislead a driver. Every driver App.tsx import is at or before this commit: Safety 13, MyDetails and ui 12, Login and theme 14, Assignment 15, client 35, MapScreen 36, TripScreen and TripProvider 37, the rest unchanged from origin. themeWording.test needs the App.tsx and MoreScreen wording. After this commit the two legacy Day/Night keys kept in phrases.ts (commit 12) are unused; pruning them is a later cleanup. app.json 1.0.18 -> 1.0.22: the 1.0.22 APK was built from the dirty tree but never installed on a device, so it is NOT certified. An APK built from this branch will differ from that build under the same versionCode; consider bumping again. Replay: 704 tests pass, which matches the dirty tree.

**Gate:** INTEGRATION-GATE: follows commit 37 (TripScreen released). Device use additionally needs physical APK recertification.

```bash
cd driver-app && npx tsc --noEmit && npx vitest run
```

</details>

## 5. Blocked — 18 files, 20 entries

| item | precondition |
|---|---|
| `backend/app/api/trips.py` | Joins commit 30. Release: the owner accepts 0013-dependent HTTP surface onto the integration branch (commit 25 already puts 0013 there) after commits 25-28 (scope.py, geography, services/trips actor=). Deploy: hosted migrated to 0013 after a confirmed Supabase backup/PITR (commit 24 packet). |
| `backend/app/api/auth.py` | Joins commit 31 in the SAME commit as api/deps.py, after commit 27 (PasswordChange, workspace fields, users.must_reset_password). Recommended: the SEC-006 _peer->client_address hunk is 0012-safe and could be reclassified and landed right after commit 2. Without it SEC-006 stays open on hosted even though render.yaml sets TRUSTED_PROXY_HOPS=1. |
| `backend/app/api/deps.py` | Joins commit 31 together with api/auth.py and never alone: its PASSWORD_RESET_ALLOWED allowlist names /api/auth/password, and the gate reads users.must_reset_password (0013) on every authenticated request. |
| `backend/app/api/org.py` | Joins commit 32 together with the other four routers and main.py hunks 1/4/5, after commits 30-31. It reads states, districts and users.state_id/district_id/must_reset_password/created_by_user_id from 0013. Security review before deploy: GET /api/org/regions is unauthenticated with no rate limit of its own. |
| `backend/app/api/dashboard.py` | Joins commit 32 (needs scope.trip_scope_clause, districts, shipments.origin_district_id, users.last_seen_at from commits 25-26). It filters districts to OPERATIONAL_SOURCES, so unseeded states show an empty list, not invented districts. |
| `backend/app/api/presence.py` | Joins commit 32 (users.last_seen_at from 0013; domain/presence.py lands in the same commit). GET /api/presence has no pagination; review before deploy. |
| `backend/app/api/notifications.py` | Joins commit 32 (the notifications table and enums from 0013; services/notifications.py from commit 28). |
| `backend/app/api/driver.py` | Joins commit 32. The stop-request half needs 0013 (notifications). The places_router half is 0013-free but is imported by main.py's wiring hunk, so it cannot land before the wiring. Splitting places_router into its own module would let it ship earlier. |
| `HUNK of backend/app/main.py (the KEEP file itself lands in commit 4): hunk 1 = five router` | Deliberately held out of commit 4 and landed in commit 32 together with every router it imports. Never before them: the imports are unconditional, so wiring any router that is not present breaks app import. |
| `manager-web/src/pages/LoginPage.tsx` | Joins commit 33 after backend commits 31 (login accepts and verifies workspace fields; the deployed extra='forbid' schema returns 422) and 32 (/api/org/regions). It moves with AuthProvider, NorthEastMap and TerrainScene. |
| `manager-web/src/pages/OverviewPage.tsx` | Joins commit 34 after commit 32 (/api/dashboard reads 0013 tables). It says 'Official list pending' rather than 0 for a state without verified districts. |
| `manager-web/src/pages/StatesPage.tsx` | Joins commit 34 after commit 32 (/api/org/states and /api/org/districts). |
| `manager-web/src/pages/ManagersPage.tsx` | Joins commit 34 after commit 32 (/api/org/managers, the STATE_MANAGER/DISTRICT_MANAGER enum values and the issued temporary password flow from commit 31). |
| `manager-web/src/pages/NotificationsPage.tsx` | Joins commit 34 after commit 32 (/api/notifications). |
| `manager-web/src/App.tsx` | Joins commit 34 in the same commit as Overview, States, Managers and Notifications, after commit 33 (LoginPage, TerrainScene, AuthProvider) and commits 8-11 (ui, index.css, Fleet, Trips, Drivers pages). It makes /overview the MANAGER landing page, so it must not deploy before commit 32 runs on 0013. |
| `manager-web/src/App.test.tsx` | Joins commit 34 with App.tsx: it imports scopeLabel, which exists only in the local App.tsx, and mocks the new pages. REWORK noted by the gaps slice: scopeLabel shows only 'State'/'District', not the place name. |
| `driver-app/src/api/client.ts` | Joins commit 35 after backend commit 32 (POST /api/presence/heartbeat, POST /api/driver/me/trip/stop-request). Recommended split: NetworkError.timedOut, AUTH_TIMEOUT_MS and the FUEL union are 0012-safe and could ship earlier. The heartbeat fires every 60 s with a silent catch and would fail unnoticed against 0012. |
| `driver-app/src/trip/TripProvider.tsx` | Joins commit 37 after commits 35 (client.heartbeat), 13 (currentAppLanguage) and 32 (presence route). |
| `driver-app/src/screens/TripScreen.tsx` | Joins commit 37 after commits 35 (requestTripStop), 12 (ConfirmSheet) and 32 (stop-request route). The emergency stop request must work on the backend it is shipped against. Must precede commit 38, whose tutorial describes it. |
| `Hosted deployment of commit 23 and commits 25-38` | 1) A confirmed Supabase backup or PITR restore point (commit 24 packet, section 'Backup and recovery — NOT CONFIRMED'). 2) An operator runs alembic upgrade 0013_state_district_inbox on hosted. 3) The code and the schema go live together. 4) Hosted demo drivers are checked against the commit-28 compliance gate. Commits 1-22 and 24 are deployable to the 0012 baseline as-is (commit 16 only after its SRI digests are veri |

## 6. Dropped — 21 files

Every one is preserved in `snapshot/post-demo-2026-09-26`. Dropping means *not integrated*, never *deleted*.

| path | why |
|---|---|
| `docs/prompts/RASTA_FINAL_MODULE_AGENT_PROMPT.md` | A session agent prompt pinned to stale HEAD 7c7410a. No code, doc or test references it. Preserved in snapshot/post-demo-2026-09-26. |
| `docs/submission/final-render/Slide1.PNG` | Manual render of the deck from 14 Sep; stale against the regenerated .pptx (commit 22). Can be regenerated. Preserved in the snapshot tag. |
| `docs/submission/final-render/Slide2.PNG` | Same stale final-render set as Slide1. |
| `docs/submission/final-render/Slide3.PNG` | Same stale final-render set as Slide1. |
| `docs/submission/final-render/Slide4.PNG` | Same stale final-render set as Slide1. |
| `docs/submission/final-render/Slide5.PNG` | Same stale final-render set as Slide1. |
| `docs/submission/final-render/Slide6.PNG` | Same stale final-render set as Slide1. |
| `docs/submission/day1/task3/screenshots/20-driver-login.png` | Source frame merged into composite 32-driver-a. The report cites only the composite; the commit-19 link check passes without it. Preserved in the snapshot tag. |
| `docs/submission/day1/task3/screenshots/21-driver-login-error.png` | Source frame for composite 32-driver-a; not referenced. |
| `docs/submission/day1/task3/screenshots/22-driver-trip.png` | Source frame for composite 32-driver-a; not referenced. |
| `docs/submission/day1/task3/screenshots/23-driver-navigate.png` | Source frame for composite 33-driver-b; not referenced. |
| `docs/submission/day1/task3/screenshots/24-driver-safety.png` | Source frame for composite 33-driver-b; not referenced. |
| `docs/submission/day1/task3/screenshots/25-driver-more.png` | Source frame for composite 33-driver-b; not referenced. |
| `docs/submission/day1/task3/screenshots/30-manager-mobile-390.png` | Responsive composite left out of the compact final report; referenced only by a gitignored .runtime draft. |
| `docs/submission/day1/task3/screenshots/31-manager-tablet-768.png` | Responsive composite left out of the final report; not referenced. |
| `manager-web/dist-cert/assets/index-B0FUNc0p.js` | Vite build output from 20 Sep with the local cert backend http://127.0.0.1:8027 baked in; useless anywhere else. |
| `manager-web/dist-cert/assets/index-BazBWXml.css` | Build output of the same cert build. |
| `manager-web/dist-cert/assets/maplibre-gl-worker-Bml_7JYB.js` | Build output of the same cert build. |
| `manager-web/dist-cert/brand-mark.svg` | Build copy of manager-web/public/brand-mark.svg. |
| `manager-web/dist-cert/favicon.svg` | Build copy of manager-web/public/favicon.svg. |
| `manager-web/dist-cert/index.html` | Built index.html pointing at the hashed cert bundle. |

## 7. Work no dirty file covers

The integration branch cannot finish the mission on its own. These need a person, a
decision, or an external source.

1. Official district source: no VERIFIED_OFFICIAL district exists anywhere. 0013 seeds 8 states and zero districts. Until an official list is obtained, provenance-checked, and loaded as VERIFIED_OFFICIAL (a candidate is Government of India's Local Government Directory; verify it), district managers cannot be scoped meaningfully and recipients_for_trip returns [] for every trip. Do not fill districts from any other source.
2. Supabase backup/PITR confirmation: the packet says NOT CONFIRMED. Someone with dashboard access must see a backup from today, or PITR enabled, before anyone runs alembic 0013 on hosted. Then an operator applies 0013, and the commit 25+ code is deployed in the same window.
3. Fixture-cleanup plan for hosted Supabase: 19,860 deactivated fixture users and 5 retired trucks are contained (test_fixture_residue_stays_excluded) but not deleted. Deletion needs its own reviewed plan and backup; nothing in this branch deletes them.
4. Physical APK recertification: the 1.0.22 APK was built from the dirty tree and never installed on a device. Build from the integration branch (consider versionCode 1.0.23 so two different binaries do not share 1.0.22), install it on a real phone, and rerun the physical matrix against hosted.
5. Verify the two sha384 SRI digests in DriverRouteMap.native.tsx against what unpkg serves for leaflet@1.9.4. A wrong digest silently blanks the driver map. This was not checkable offline.
6. Triage the three unmerged remote branches. origin/claude/pdf-master-mission-gohuj5 (10 commits, based on 7c7410a) adds backend/alembic/versions/0013_device_events.py with down_revision 0012_push_notifications. That forks Alembic against 0013_state_district_inbox, so it must be renumbered to chain after it before any merge; also confirm hosted never ran it. origin/claude/rasta-ai-sih26002-deck-e8xagd (5 commits, 65 docs/submission files) overlaps the commit-22 deck regeneration. origin/claude/video-navigation-impl-ejdxwo (1 commit, 12 driver-app/src files) overlaps MapScreen and TripScreen.
7. Deploy the 0012-safe prefix (commits 1-22 and 24) to hosted, then verify with curl -sI that the API and both static sites return the new headers. Confirm Render applied render.yaml's env and headers (a blueprint sync may be needed). SEC-006 is only live once the api/auth.py _peer hunk is deployed.
8. Before deploying commit 28, check every hosted demo driver against the new dispatch compliance gate (7-day grace; contact and insurance on the active assignment). Otherwise dispatch starts refusing with DRIVER_COMPLIANCE_OVERDUE.
9. Add manager-web/dist-cert/ (or dist-*/) to .gitignore on the integration branch; the existing dist/ rule does not match it. This file is not in the classified set.
10. Privacy decision before any public push: day1 09-drivers-desktop.png and day2 07b_manager_drivers_list.png show demo-driver names with 10-digit phone login identifiers. 10-drivers-validation-422 and 12-assignments were not opened.
11. Correct the stale 'hosted runs 5b5e474' lines in MIGRATION_0013_DEPLOYMENT_PACKET.md (lines 10, 205) and REDESIGN_CERTIFICATION.md (line 6); hosted runs e4043ce.
12. Run each backend testCommand for real on the isolated cluster. This planning pass was read-only: backend positions were verified by create_app() and pytest --collect-only only, and the DB-backed suites were not executed. The last full backend run on record is 19 Sep (1210 passed).
13. Translation follow-ups the passing suite cannot see: TripScreen's ARRIVE and FINISH_STOP ConfirmSheet details are template literals t() cannot match. After commit 38, prune the two legacy Day/Night keys kept in phrases.ts.
14. Axe local branch release/close-releases-resources (it points at e4043ce) once the integration branch exists, to avoid confusion.

## 8. Recommended next step

Create `post-demo-integration` from `origin/main` (`e4043ce`) in its own worktree
and land commits 1–22 and 24 in order — the part that runs on hosted's 0012 today —
running each commit's `testCommand` for real as it lands. That is also what turns
the backend from *import-verified* into *test-verified*.

Stop at commit 24. Commits 25–38 need a confirmed Supabase backup, a decision on
the `ShipmentRead` rework, and the BLOCKED files released, none of which can be
decided by the branch itself.

Before anything reaches GitHub: the two screenshots with phone logins.

## Appendix — every dirty file (277)

Grouped by where the plan puts it. `s` = `mod` (tracked, modified) or `new` (untracked).

### commit 1 — 3

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/POST_DEMO_STATE.md` | new | REWORK | LOW | Useful dated record of the reconciliation (hosted vs local commit, DB revisions, branch divergence, env var names only, no values). Two fixes: it says 103 untracked, which is the c |
| `docs/REDESIGN_CERTIFICATION.md` | new | KEEP | LOW | Per-reference certification against the seven supplied images, opening with 'Nothing here was deployed. Hosted still runs schema 0012 and the 5b5e474 build.' Its 'Deliberate differ |
| `docs/REMOTE_SUPABASE_RUNTIME_CERTIFICATION.md` | new | KEEP | LOW | Proves the claim 'the real application does not depend on a database on anyone's laptop' against the hosted service rather than from config: pasted /ready response showing provider |

### commit 2 — 3

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/core/config.py` | mod | KEEP | LOW | Three additive changes, all verified. (1) `_host_of` now parses with SQLAlchemy `make_url` instead of `urlsplit` — a real fix, not cosmetic: a password containing `/`, `?` or `#` e |
| `backend/app/core/rate_limit.py` | mod | KEEP | LOW | Adds one pure function `client_address(peer, forwarded_for, trusted_hops)`; nothing existing is modified, so FixedWindowLimiter behaviour is unchanged. The security reasoning is ri |
| `backend/tests/test_trusted_proxy.py` | new | KEEP | LOW | Closes SEC-006 properly and explains why the obvious fix was worse than the bug: reading X-Forwarded-For blindly turns a shared limit into no limit. Tests the attacker's side at ev |

### commit 3 — 4

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/core/disposable.py` | new | KEEP | LOW | A single fail-closed guard (`is_disposable` / `assert_disposable`) that refuses to let a fixture or demo loader write to anything but a local host. Stdlib plus one import from conf |
| `backend/scripts/demo_scenario.py` | mod | KEEP | LOW | Adds `assert_disposable('demo_scenario.py')` as the first statement of `main()`, before `get_settings()` and the existing `db_target.enforce`, so a fixture loader cannot be pointed |
| `backend/scripts/terrain_seed.py` | mod | KEEP | LOW | Identical guard to demo_scenario.py: `assert_disposable('terrain_seed.py')` first in `main()`, ahead of `db_target.install()`/`enforce`. Same new dependency, same zero runtime reac |
| `backend/tests/test_disposable_guard.py` | new | KEEP | LOW | Tests app/core/disposable.py, the guard that stops seed scripts and demo resets from writing to hosted Supabase (the pytest-level veto in tests/db_target.py only covers the suite). |

### commit 4 — 3

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/api/files.py` | mod | KEEP | LOW | Replaces await request.body() with a declared-Content-Length pre-check plus a streaming read that aborts past MAX_BYTES, so a 500 MB body no longer costs 500 MB of RAM to be told 4 |
| `backend/app/main.py` | mod | KEEP | MEDIUM | Two unrelated things plus prose. The deployable value is the `security_headers` HTTP middleware (nosniff, X-Frame-Options DENY, CSP frame-ancestors none, Referrer-Policy, `setdefau |
| `render.yaml` | mod | KEEP | MEDIUM | Two SEC fixes with no scratch: TRUSTED_PROXY_HOPS="1" on the backend (SEC-006) and X-Frame-Options / CSP frame-ancestors / Referrer-Policy / Permissions-Policy on both static sites |

### commit 5 — 5

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/api/documents.py` | mod | KEEP | LOW | Two self-contained changes, neither touching 0013 columns. (1) The Day 2 Task 2 BOLA fix: driver_documents now resolves the driver through driver_service.get(db, driver_id, actor=a |
| `backend/app/api/fleet.py` | mod | KEEP | LOW | Two call-site changes only: list_trucks and get_truck now pass actor= into truck_service. The scoping behind it (trucks._own_trucks) restricts a DRIVER to trucks on a non-ENDED ass |
| `backend/app/services/drivers.py` | mod | REWORK | LOW | The intent is right — refuse a driver whose licence already expired at creation instead of only at assignment and dispatch — but the check is placed AFTER `db.add(user)` and `await |
| `backend/app/services/trucks.py` | mod | KEEP | MEDIUM | One of the five Day-2 security fixes: TRUCK_READ is held by drivers so they can load their truck's photo, and it let any driver page the whole fleet register. `_own_trucks(actor)`  |
| `backend/tests/test_document_dates.py` | new | KEEP | LOW | Parametrised across both document endpoints so the shared validator cannot drift - insurance accepting a date the licence refuses is the failure it names. Verified the rules live i |

### commit 6 — 4

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/domain/places.py` | mod | KEEP | LOW | Two additive changes, both verified against the data and the call sites. (1) `PlaceCategory.FUEL` — the snapshot genuinely has the records: I parsed backend/app/services/places/dat |
| `backend/app/services/places/data/corridor_snapshot.json` | mod | KEEP | LOW | Sampled the metadata and validated the structure programmatically rather than reading 45k lines. Real provenance, not invented: source OpenStreetMap via Overpass, ODbL 1.0, `retrie |
| `backend/app/services/places/snapshot.py` | mod | KEEP | MEDIUM | Passes `is_extent=True` when building the coverage BoundingBox, because the eight-state union (~7.6 x 9.6 degrees) exceeds the per-query size cap that BoundingBox enforces. Hard co |
| `backend/scripts/acquire_places_snapshot.py` | new | KEEP | LOW | Read in full. Not scratch, despite being a one-off: it is the reproducible provenance for corridor_snapshot.json, which is the reason the ODbL attribution and the 'we did not colle |

### commit 7 — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/domain/ai_prompts.py` | mod | KEEP | LOW | Prompt text only — no schema, no DB, no new imports. Separates two things that were conflated: the ANSWER language (the driver's Settings choice) from the INPUT language (whatever  |
| `backend/tests/test_ai_language.py` | new | KEEP | LOW | Separates output language (what the driver reads) from input language (whatever their keyboard produced), and asserts only the prompt, explicitly refusing to assert model behaviour |

### commit 8 — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `manager-web/src/components/ui.tsx` | mod | KEEP | LOW | Purely additive optional Field props (icon, trailing, large) with padding driven off them; existing call sites are untouched in behaviour. The input does get wrapped in a new `<spa |
| `manager-web/src/index.css` | mod | KEEP | LOW | Pure CSS, not in e4043ce: forest palette retune with measured contrast ratios, adds the missing --color-faint token (text-faint was already used in FleetMap and LoginPage and rende |

### commit 9 — 8

| path | s | class | risk | why |
|---|---|---|---|---|
| `manager-web/src/api/client.ts` | mod | KEEP | MEDIUM | The deployed part (in-flight GET coalescing: `inFlight` Map + the `shareable` guard) is already in e4043ce — `git diff origin/main` shows ZERO logic delta there, only reworded pros |
| `manager-web/src/api/coldStart.test.ts` | new | KEEP | LOW | The guard behind AUTH_TIMEOUT_MS. Records the measured hosted cold start (32.85 s first request after a Render free-tier sleep, then 0.17-0.42 s) and asserts four things about clie |
| `manager-web/src/api/supabaseManagerApi.ts` | mod | KEEP | LOW | Single additive hunk in activeFleet(): a `head: true` exact count on `trucks` excluding RETIRED, returned as `trucks_total: trucksTotal ?? null`. It is the Supabase-direct mirror o |
| `manager-web/src/components/FleetKpiBar.test.tsx` | new | KEEP | LOW | 80 lines, 6 tests, passing when I ran them. The load-bearing case is 'is not stuck at 100 — the bug it replaced could report nothing else', plus the em-dash-not-0% case. Written ag |
| `manager-web/src/components/FleetKpiBar.tsx` | mod | KEEP | MEDIUM | Replaces `fleetUtilizationRatio` with `fleetUtilizationPercent: number \| null` + `fleetSize: number \| null`, and renders an em dash instead of 0% when there is no denominator. Dr |
| `manager-web/src/hooks/useFleetPoll.test.ts` | mod | KEEP | LOW | One fixture line, `trucks_total: 4`, added to the snapshot() helper so the test object still satisfies the widened FleetSnapshot type. Mechanically required by the client.ts change |
| `manager-web/src/pages/FleetPage.test.tsx` | mod | KEEP | LOW | Mocks ../auth/AuthProvider with a mutable role fixture, adds trucks_total: 4 to the snapshot fixture, and adds two cases asserting a district manager is told the map is scoped to t |
| `manager-web/src/pages/FleetPage.tsx` | mod | KEEP | MEDIUM | Real correctness fix plus polish. Replaces the utilisation figure that divided the snapshot's active trips by the snapshot's own length (/api/fleet/active returns only active trips |

### commit 10 — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `manager-web/src/pages/TripsPage.test.tsx` | mod | KEEP | LOW | All 34 lines are extra beyond deployed — the e4043ce hotfix did not touch this file (diff vs origin/main equals diff vs HEAD). Adds the regression test that a terminal action reloa |
| `manager-web/src/pages/TripsPage.tsx` | mod | KEEP | MEDIUM | Mixed file. `git diff origin/main` shows the deployed hotfix (reloadAfterLifecycleChange) is already live; the EXTRA local delta is: truckLabel() rendering `display_name · registra |

### commit 11 — 3

| path | s | class | risk | why |
|---|---|---|---|---|
| `manager-web/src/components/DriverProfileDrawer.tsx` | mod | KEEP | LOW | One word in licenceHealth: 'Valid to' -> 'Valid till'. Grepped the tree — no test or other caller asserts either string. |
| `manager-web/src/pages/DriversPage.tsx` | mod | KEEP | LOW | Pure layout fix: the fixed w-56 search box plus the Add button was 322px of content in a 320px viewport, so the whole document scrolled sideways. Now flex-wrap with a flexible sear |
| `manager-web/src/pages/tripExport.test.ts` | mod | KEEP | LOW | One added case (SEC-XSS-003) feeding an attribute-breaking payload through every report column and the header and asserting no <img/<svg survives reportHtml. Self-contained: tripEx |

### commit 12 — 5

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/components/ui.tsx` | mod | KEEP | LOW | Two additive primitives, no existing behaviour changed. Field gains multiline/maxLength/error (error replaces the hint when present and carries accessibilityLiveRegion). New Confir |
| `driver-app/src/i18n/phrases.ts` | mod | KEEP | LOW | 188 added lines of hi/gu/as/bn for the new surfaces: push notifications, the cold-start copy, all ten tutorial steps, Light/Dark theme wording, Close, Fuel level. coverage.test.ts  |
| `driver-app/src/screens/MyDetailsScreen.tsx` | mod | KEEP | LOW | Wires documentDates into the document/insurance form: autoFormat on change (the numeric keypad has no hyphen, so the form was asking for a format it would not let the driver type), |
| `driver-app/src/screens/documentDates.test.ts` | new | KEEP | LOW | Good coverage of the pure functions: autoFormat idempotence (so re-rendering the value cannot corrupt it) and backspace behaviour (deleting a digit must not re-add the hyphen and t |
| `driver-app/src/screens/documentDates.ts` | new | REWORK | LOW | Logic is right and worth keeping: isCalendarDate re-compares the parsed parts against the input because new Date('2024-02-31') silently rolls over to 2 March, so a licence cannot b |

### commit 13 — 3

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/i18n/language.ts` | mod | KEEP | LOW | Adds currentAppLanguage() for code outside React (how the two notifications ended up permanently English), and useGuidanceLanguage()/guidanceIsTranslated() so the safety guide foll |
| `driver-app/src/screens/SafetyScreen.tsx` | mod | KEEP | LOW | Switches guidance from resolveLanguage() (device locale) to useGuidanceLanguage() (chosen app language) and adds an on-screen line saying the guide is reviewed in English/Hindi/Ass |
| `driver-app/src/trip/notificationLanguage.test.ts` | new | KEEP | LOW | Asserts the four background-notification strings exist in PHRASES and that tx() returns something DIFFERENT from English in all four drafted languages (hi/gu/as/bn) - a presence ch |

### commit 14 — 4

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/auth/authErrors.ts` | mod | REWORK | LOW | Correct fix: reads NetworkError.timedOut OR the message, because neither signal alone covers both runtimes (RN says 'Network request failed' for an abort; web throws a DOMException |
| `driver-app/src/screens/LoginScreen.tsx` | mod | KEEP | LOW | Pure presentation. Two more ridge triangles plus a horizon bar so the hero reads as depth rather than cut paper, and the language selector moves from between the heading and the ca |
| `driver-app/src/theme.contrast.test.ts` | new | KEEP | LOW | Computes WCAG luminance/contrast in-test and asserts all 10 readable tokens against all 4 grounds for DAY and NIGHT, plus onAccent/accent inversion, status ink-on-chip pairs, and t |
| `driver-app/src/theme.ts` | mod | REWORK | MEDIUM | Full forest/cream repalette of COLORS (night) and DAY, with dim raised 7D8E85 -> 93A79C to clear 4.5:1 on `raised` rather than only on the canvas. Verified: theme.contrast.test.ts  |

### commit 15 — 4

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/components/FuelGauge.test.ts` | new | KEEP | LOW | Pins the two properties that stop the old defect returning: a fixed five-mark set (0/25/50/75/100, E/quarter/half/three-quarters/F) and a needle angle that is a function of the lev |
| `driver-app/src/components/FuelGauge.tsx` | new | KEEP | LOW | Half-disc dial plus five tap targets at TOUCH_TARGET, no SVG dependency (bordered half-disc + rotated View) - correct call, a drawing library for one dial would be bigger than the  |
| `driver-app/src/components/fuelLevels.ts` | new | KEEP | LOW | React-free data + needleAngle(), split out precisely so the rule (which marks exist) is testable without a native runtime. needleAngle clamps 0-100 before mapping to -90..+90, with |
| `driver-app/src/screens/AssignmentScreen.tsx` | REWORK-note-see-classification | KEEP | LOW | Replaces the free-text 'Fuel level (%)' box with FuelGauge and narrows parseReadings to take `fuelPct: FuelPct \| null`. The removed 0-100 integer validation is correctly removed,  |

### commit 16 — 5

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/map/DriverRouteMap.native.tsx` | mod | KEEP | HIGH | SEC-008: pins sha384 integrity + crossorigin=anonymous on both unpkg assets loaded into the WebView that draws a driver's route. A version pin is not integrity - it trusts unpkg to |
| `driver-app/src/map/DriverRouteMap.web.tsx` | mod | KEEP | LOW | Drops the now-unreachable `HILLSHADE_URL === null` guard, since scene.ts always resolves a string. Verified this does not orphan the disabled path: the native bridge still calls wi |
| `driver-app/src/map/hillshadeSource.test.ts` | new | KEEP | LOW | Asserts the property that matters - HILLSHADE_URL is never null whatever the environment - plus a {z}/{x}/{y} template, HILLSHADE_SOURCE naming which source won, branch-appropriate |
| `driver-app/src/map/scene.ts` | mod | REWORK | MEDIUM | Two changes. The FUEL category colour is inert additive data. The rework is HILLSHADE_URL: it goes from `string \| null` to always-a-string by falling back to OpenTopoMap when EXPO |
| `driver-app/src/map/subresourceIntegrity.test.ts` | new | KEEP | LOW | Parses the WebView HTML for every external link/script and asserts each carries integrity= AND crossorigin= - the second is the one people miss, and without CORS the browser silent |

### commit 17 — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/FINAL_SOURCE_ADMISSION_LEDGER.md` | new | KEEP | LOW | Single-status ledger over every external source with a defined vocabulary (ADOPT_NOW / OPTIONAL_KEYED / VALIDATION_ONLY / RESEARCH_ONLY / REFERENCE_ONLY / BLOCKED / REJECT) and not |
| `docs/research/GITHUB_REFERENCE_AUDIT.md` | mod | KEEP | LOW | Replaces a blanket NOT_AUDITED record with a per-repository table carrying language, licence, stars and commit counts for all 16 references, and states plainly that the earlier ver |

### commit 18 — 1

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/submission/day1/build_docs.py` | mod | KEEP | LOW | Generalises the day-1 doc builder into the shared engine: Markdown path from argv, outputs beside it, --compact mode, ![](path) screenshot blocks, ```flow tables, and pair_screensh |

### commit 19 — 24

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/submission/day1/task3/RASTA_AI_Task_Report.docx` | new | KEEP | LOW | Built 09-18 17:38 from the .md at 09-18 17:37 — in sync, so unlike the Task 2 binaries it needs no rebuild. Submission deliverable. |
| `docs/submission/day1/task3/RASTA_AI_Task_Report.md` | new | KEEP | LOW | The Day 1 Task 3 deliverable named in project memory as a real report. 559 lines, sampled. Its .docx/.pdf siblings are in sync with it (all three 09-18 17:37-38), unlike the Task 2 |
| `docs/submission/day1/task3/RASTA_AI_Task_Report.pdf` | new | KEEP | LOW | Built 09-18 17:38, in sync with its Markdown source. Submission deliverable. |
| `docs/submission/day1/task3/build_report.py` | new | KEEP | LOW | Path-clean, unlike the .mjs renderers: HERE = Path(__file__).resolve().parent, sys.path.insert(HERE.parent), MD = HERE / '...'. No absolute paths, no gitignored imports. Must land  |
| `docs/submission/day1/task3/evidence-driver-results.json` | new | KEEP | LOW | Driver-side counterpart to evidence-results.json for the same Task 3 run; the driver screenshots 20-25 and 32-33 are the visual half of the same evidence set. |
| `docs/submission/day1/task3/evidence-results.json` | new | KEEP | LOW | Timestamped machine capture (at: 2026-09-18T10:46:44Z) of named checks with ok flags and notes, e.g. 'fleet: no horizontal overflow at 1440' overflow=0. Raw backing for the Task 3  |
| `docs/submission/day1/task3/screenshots/00-architecture.png` | new | KEEP | LOW | Shared classification for the 18 day1/task3 screenshots that RASTA_AI_Task_Report.md uses as Figures 1-18 (00-15, 32, 33). build_report.py embeds them from the .md, so the report c |
| `docs/submission/day1/task3/screenshots/01-login-desktop.png` | new | KEEP | LOW | Figure 2 of the Day 1 Task 3 report, embedded by build_report.py. I opened it: login form with a placeholder identifier only, no credentials. |
| `docs/submission/day1/task3/screenshots/02-login-mobile.png` | new | KEEP | LOW | Figure 4 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/03-login-error.png` | new | KEEP | LOW | Figure 3 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/04-fleet-desktop.png` | new | KEEP | LOW | Figure 5 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/05-fleet-tablet.png` | new | KEEP | LOW | Figure 6 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/06-fleet-mobile.png` | new | KEEP | LOW | Figure 7 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/07-trips-desktop.png` | new | KEEP | LOW | Figure 8 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/08-trips-mobile.png` | new | KEEP | LOW | Figure 9 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/09-drivers-desktop.png` | new | KEEP | LOW | Figure 10 of the Day 1 Task 3 report. I opened it: it shows 5 demo-driver names with their 10-digit phone login identifiers, the same identities as .runtime/demo-credentials.privat |
| `docs/submission/day1/task3/screenshots/10-drivers-validation-422.png` | new | KEEP | LOW | Figure 11 of the Day 1 Task 3 report (same shared classification as the other report figures). Not opened; it may show driver identifiers like Figure 10. |
| `docs/submission/day1/task3/screenshots/11-trucks-desktop.png` | new | KEEP | LOW | Figure 12 of the Day 1 Task 3 report. Byte-identical to day2 07c_manager_trucks_list.png. |
| `docs/submission/day1/task3/screenshots/12-assignments-desktop.png` | new | KEEP | LOW | Figure 13 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/13-review-desktop.png` | new | KEEP | LOW | Figure 14 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/14-diagnostics-desktop.png` | new | KEEP | LOW | Figure 15 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/15-diagnostics-tablet.png` | new | KEEP | LOW | Figure 16 of the Day 1 Task 3 report (same shared classification as the other report figures). |
| `docs/submission/day1/task3/screenshots/32-driver-a.png` | new | KEEP | LOW | Figure 17 of the Day 1 Task 3 report: composite of the driver login, login error and trip screens, embedded by build_report.py. |
| `docs/submission/day1/task3/screenshots/33-driver-b.png` | new | KEEP | LOW | Figure 18 of the Day 1 Task 3 report: composite of the Navigate, Safety and More screens, embedded by build_report.py. |

### commit 20 — 34

| path | s | class | risk | why |
|---|---|---|---|---|
| `SUBMISSION_README.md` | mod | KEEP | LOW | One-line factual refresh: run command corrected to `python run.py` (not bare uvicorn on Windows), test counts updated to the 19 Sep figures (backend 1210/5 skipped, driver 624, man |
| `docs/DAY2_TASK1_API_TEST_RESULTS.md` | new | KEEP | LOW | Dated capture of a real HTTP run (2026-09-19T09:53:29 IST, local 127.0.0.1:8010 clone, 'Supabase was not written to'), 56/56 PASS, tokens and passwords redacted, raw results cross- |
| `docs/DAY2_TASK1_CRUD_DOCUMENTATION.md` | new | KEEP | LOW | One-page CRUD view of the 86-route deployed surface, cited by API_CONTRACTS.md and DAY2_TASK1_FINAL_REPORT.md. Confirmed it contains no /api/org, /api/dashboard, /api/notifications |
| `docs/DAY2_TASK1_ER_DIAGRAM.md` | new | KEEP | LOW | Current-schema ER page scoped explicitly to '0001 … 0012 (linear, head 0012_push_notifications)' and verified against a live `alembic current` on 19 Sep — 20 domain tables. Deliber |
| `docs/DAY2_TASK1_FINAL_REPORT.md` | new | REWORK | LOW | Body is solid, dated, measured evidence. But §16 is titled 'Files changed this session (uncommitted)' and lists these very files as uncommitted, and calls docs/prompts/ and docs/su |
| `docs/DAY2_TASK1_INTEGRATION_EVIDENCE.md` | new | KEEP | LOW | Frontend->backend->database evidence with the method stated: headless Chromium signed in as demo manager and driver, recorded every /api response, 24/24 checks across three passes, |
| `docs/submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.md` | new | KEEP | LOW | The bound Task 1 deliverable, pinned to backend commit 7c176f3 and 19 Sep 2026, with the standing rule stated up front: anything unverified is marked NEEDS TESTING or NOT IMPLEMENT |
| `docs/submission/day2/task1/RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.pdf` | new | KEEP | LOW | mtime 09-19 11:26, identical to its .md — in sync, no rebuild needed. Contrast with the Task 2 pdf/docx, which are 11 hours behind their source. |
| `docs/submission/day2/task1/api-results.json` | new | KEEP | LOW | 43 KB of raw per-request results written by api_evidence.py, the checkable substrate under DAY2_TASK1_API_TEST_RESULTS.md's 56/56 PASS claim. Secrets redacted at write time by the  |
| `docs/submission/day2/task1/api_evidence.py` | new | REWORK | LOW | Hardcodes `ROOT = Path(r"D:\\Projects\\ner-ai-logistics")` at module level and reads the gitignored .runtime/demo-credentials.private.json. Reading creds from an ignored file is co |
| `docs/submission/day2/task1/build_report.py` | new | KEEP | LOW | Path-clean (HERE = Path(__file__).resolve().parent, sys.path.insert(HERE.parents[1] / 'day1')). Must land after the modified docs/submission/day1/build_docs.py, which it imports as |
| `docs/submission/day2/task1/er-diagram.png` | new | KEEP | LOW | 850 KB render of the Mermaid block in DAY2_TASK1_ER_DIAGRAM.md, mtime 09-19 10:12 — same session as its source. Figure in the Task 1 submission. |
| `docs/submission/day2/task1/er-diagram.svg` | new | KEEP | LOW | 468 KB vector form of the same ER render, same 09-19 10:12 timestamp. Worth keeping over the PNG alone because it stays legible at print size. |
| `docs/submission/day2/task1/evidence-results-pass2.json` | new | KEEP | LOW | Pass 2, the run against trip HILL-F5BF1C created through the real APIs (plan -> route -> approval -> dispatch -> accept -> verification -> start). 9.5 KB. Cited by the integration  |
| `docs/submission/day2/task1/evidence-results-pass3.json` | new | KEEP | LOW | Pass 3, only 545 bytes — small enough to look like scratch, but it is the third of three passes the integration doc counts, so it is cited evidence rather than a stray probe. |
| `docs/submission/day2/task1/evidence-results.json` | new | KEEP | LOW | Pass 1 of the three integration passes cited by DAY2_TASK1_INTEGRATION_EVIDENCE.md (24/24 checks, zero 5xx). 13.7 KB of recorded method/path/status per response. |
| `docs/submission/day2/task1/figures/arch.png` | new | KEEP | LOW | Architecture figure that RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.md uses, produced by render_figs.mjs. |
| `docs/submission/day2/task1/figures/ercore.png` | new | KEEP | LOW | Core ER figure. The Day 2 Task 1 final .md references it and build_report.py loads it. |
| `docs/submission/day2/task1/render_er.mjs` | new | REWORK | LOW | Imports `../../../../.runtime/rehearsal/cdp.mjs`, and .runtime/ is gitignored (.gitignore:106) with zero tracked files — so this cannot run in any fresh clone. Also hardcodes ROOT  |
| `docs/submission/day2/task1/render_figs.mjs` | new | REWORK | LOW | Same two defects as render_er.mjs (gitignored .runtime/rehearsal/cdp.mjs import, hardcoded D:/ root). Higher value than the other renderers: the FIGS object holds the inline Mermai |
| `docs/submission/day2/task1/screenshots/01_backend_health.png` | new | KEEP | LOW | Shared classification for the 14 day2/task1 screenshots: each one is cited either in RASTA_AI_DAY2_TASK1_BACKEND_API_DATABASE_FINAL.md or in the evidence tables of DAY2_TASK1_INTEG |
| `docs/submission/day2/task1/screenshots/02_backend_ready_database.png` | new | KEEP | LOW | Cited in the Day 2 Task 1 final .md. I opened it: a local /ready JSON response with no host or credential. |
| `docs/submission/day2/task1/screenshots/03_fastapi_swagger.png` | new | KEEP | LOW | Cited in the Day 2 Task 1 final .md (same shared classification as the other day2/task1 screenshots). |
| `docs/submission/day2/task1/screenshots/03b_fastapi_swagger_trips.png` | new | KEEP | LOW | Cited in the Day 2 Task 1 final .md (same shared classification as the other day2/task1 screenshots). |
| `docs/submission/day2/task1/screenshots/07_manager_backend_integration_fleet.png` | new | KEEP | LOW | Cited in the Day 2 Task 1 final .md. At 1.8 MB it is the largest image in this slice. |
| `docs/submission/day2/task1/screenshots/07b_manager_drivers_list.png` | new | KEEP | LOW | Cited by DAY2_TASK1_INTEGRATION_EVIDENCE.md row A3. Byte-identical to day1 09-drivers-desktop.png, with the same demo names and phone login identifiers, so it needs the same redact |
| `docs/submission/day2/task1/screenshots/07c_manager_trucks_list.png` | new | KEEP | LOW | Cited by DAY2_TASK1_INTEGRATION_EVIDENCE.md and DAY2_TASK1_FINAL_REPORT.md. Byte-identical to day1 11-trucks-desktop.png. |
| `docs/submission/day2/task1/screenshots/07d_manager_diagnostics_providers.png` | new | KEEP | LOW | Cited by DAY2_TASK1_INTEGRATION_EVIDENCE.md and DAY2_TASK1_FINAL_REPORT.md. |
| `docs/submission/day2/task1/screenshots/08_driver_backend_integration_trip.png` | new | KEEP | LOW | Cited in the Day 2 Task 1 final .md (same shared classification as the other day2/task1 screenshots). |
| `docs/submission/day2/task1/screenshots/08b_driver_navigate_guidance.png` | new | KEEP | LOW | Cited in the Day 2 Task 1 final .md (same shared classification as the other day2/task1 screenshots). |
| `docs/submission/day2/task1/screenshots/08c_driver_more.png` | new | KEEP | LOW | Cited by DAY2_TASK1_INTEGRATION_EVIDENCE.md row B5 and DAY2_TASK1_API_TEST_RESULTS.md. I opened it: the demo driver name and a truck plate only. |
| `docs/submission/day2/task1/screenshots/09_trip_workflow_trips_list.png` | new | KEEP | LOW | Cited in the Day 2 Task 1 final .md (same shared classification as the other day2/task1 screenshots). |
| `docs/submission/day2/task1/screenshots/09c_trip_review_panel.png` | new | KEEP | LOW | Cited by DAY2_TASK1_API_TEST_RESULTS.md, DAY2_TASK1_INTEGRATION_EVIDENCE.md and DAY2_TASK1_FINAL_REPORT.md. |
| `docs/submission/day2/task1/screenshots/09d_trip_journey_history.png` | new | KEEP | LOW | Cited by DAY2_TASK1_API_TEST_RESULTS.md, DAY2_TASK1_INTEGRATION_EVIDENCE.md and DAY2_TASK1_FINAL_REPORT.md. |

### commit 21 — 37

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/DAY2_TASK2_SECURITY_TEST_PLAN.md` | new | KEEP | LOW | Scoped, authorised test plan for our own app only: runtime cases against an isolated clone ner_logistics_sec on 127.0.0.1:55432, hosted limited to non-destructive HEAD/GET plus one |
| `docs/submission/day2/task2/DAY2_TASK2_SECURITY_RESULTS.md` | new | KEEP | LOW | Machine-generated verdict table from the probe run (19 Sep 09:07 UTC, isolated clone ner_logistics_sec): FINDING 2, INFO 1, PASS 46, with observed-vs-expected per row. Checked the  |
| `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.docx` | new | REWORK | LOW | Built 09-19 14:44, but the source .md was edited 09-20 01:17 to add 'CLOSED 20 Sep' annotations for SEC-006 and SEC-008 (md lines 28, 98, 100). The binary therefore states SEC-006/ |
| `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.md` | new | KEEP | LOW | The Task 2 deliverable, 486 lines. Handles the awkward case well: rather than silently rewriting history it annotates SEC-006 and SEC-008 as 'CLOSED 20 Sep' while preserving the en |
| `docs/submission/day2/task2/RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.pdf` | new | REWORK | LOW | Same staleness as the .docx: mtime 09-19 14:44 against a source .md edited 09-20 01:17. A submitted PDF that contradicts the repo's own Markdown on whether two findings are closed  |
| `docs/submission/day2/task2/build_report.py` | new | KEEP | LOW | Path-clean (HERE from __file__, sys.path.insert(HERE.parents[1] / 'day1')). Needed on the branch precisely because the Task 2 .docx/.pdf must be rebuilt. Must land after the modifi |
| `docs/submission/day2/task2/evidence/01_scope_environment.png` | new | KEEP | LOW | Shared classification for the 15 day2/task2 evidence PNG cards: RASTA_AI_DAY2_TASK2_SECURITY_ASSESSMENT_FINAL.md cites every one as a figure, and render_evidence.mjs renders them f |
| `docs/submission/day2/task2/evidence/02_sqli_test.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/03_xss_test.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/03b_xss_trips.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/04_security_headers.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/05_file_upload_validation.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/06_session_security.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment. I opened it: cookie and token values are shown as <REDACTED>. |
| `docs/submission/day2/task2/evidence/07_api_unauthorized_access.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/08_api_role_access.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/09_rate_limit.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/10_secret_scan.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment. It is rendered from secret_scan.txt, which never reproduces a secret value. |
| `docs/submission/day2/task2/evidence/10b_secret_scan_full.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/10c_bundle_dependencies.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/11_security_tests.png` | new | KEEP | LOW | Figure 14 of the Day 2 Task 2 security assessment: regression tests failing without the fix and passing with it. |
| `docs/submission/day2/task2/evidence/12_final_regression.png` | new | KEEP | LOW | Figure in the Day 2 Task 2 security assessment (same shared classification as the other evidence cards). |
| `docs/submission/day2/task2/evidence/backend_full_suite.txt` | new | KEEP | LOW | Shared classification for the 12 raw .txt/.json evidence logs: the security assessment cites them by name and render_evidence.mjs reads them. A scan for JWT, API-key, DSN-with-pass |
| `docs/submission/day2/task2/evidence/dependency_audit.txt` | new | KEEP | LOW | Raw dependency-audit output, cited by the assessment and read by render_evidence.mjs. |
| `docs/submission/day2/task2/evidence/driver_regression.txt` | new | KEEP | LOW | Raw driver-app regression result, cited by the assessment and read by render_evidence.mjs. |
| `docs/submission/day2/task2/evidence/headers_before_after.txt` | new | KEEP | LOW | curl -sI captures of security headers before and after the fix (local and hosted), cited 4 times in the assessment. Contains no secrets. |
| `docs/submission/day2/task2/evidence/manager_regression.txt` | new | KEEP | LOW | Raw manager-web regression result, cited by the assessment and read by render_evidence.mjs. |
| `docs/submission/day2/task2/evidence/probe_postfix.txt` | new | KEEP | LOW | Post-fix probe output (46 PASS / 1 INFO / 2 FINDING, all values redacted), cited as evidence after the fix. |
| `docs/submission/day2/task2/evidence/probe_prefix_baseline.txt` | new | KEEP | LOW | Pre-fix baseline probe, cited 3 times for the SEC-HDR-001 and SEC-API-005 FAIL lines. The run ends in a probe-script traceback that includes an absolute local path (D:\Projects\... |
| `docs/submission/day2/task2/evidence/regression_tests.txt` | new | KEEP | LOW | Regression tests passing with the fixes, cited 3 times in the assessment. |
| `docs/submission/day2/task2/evidence/regression_tests_fail_without_fix.txt` | new | KEEP | LOW | Six test_security_assessment failures captured without the fixes. Nothing cites it by name, but it is the only raw backing for the assessment's claim that the tests 'demonstrably f |
| `docs/submission/day2/task2/evidence/results.json` | new | KEEP | LOW | Machine-readable probe results (redacted), written by security_probe.py and read by render_evidence.mjs and xss_browser_check.mjs. Cited 4 times. |
| `docs/submission/day2/task2/evidence/secret_scan.txt` | new | KEEP | LOW | Secret-scan output: 15 DSN-pattern hits, each triaged as a placeholder or local/CI value with the value itself never reproduced. Cited 4 times. |
| `docs/submission/day2/task2/evidence/xss_browser_results.json` | new | KEEP | LOW | Browser XSS check results (no alerts, no live handlers), written by xss_browser_check.mjs and cited by the assessment. |
| `docs/submission/day2/task2/render_evidence.mjs` | new | REWORK | LOW | Same pattern: imports the gitignored `.runtime/rehearsal/cdp.mjs` and hardcodes HERE = 'D:/Projects/ner-ai-logistics/docs/submission/day2/task2'. It renders the 15 evidence PNGs fr |
| `docs/submission/day2/task2/security_probe.py` | new | KEEP | LOW | The only path-clean script in the day2 tooling set: ROOT = HERE.parents[3], no absolute paths. Reads credentials from gitignored .runtime/*.private.json, which is the right call —  |
| `docs/submission/day2/task2/xss_browser_check.mjs` | new | REWORK | LOW | Imports two gitignored modules, `.runtime/rehearsal/cdp.mjs` and `.runtime/rehearsal/human.mjs`, so it is unrunnable from a clone. It is the only executable proof behind SEC-XSS-00 |
| `docs/submission/day2/task3/RASTA_AI_DAY2_TASK3_MITIGATION.md` | new | KEEP | LOW | Closes the loop on all 13 Task 2 findings with before/after and retest per item, and is honest about what is not live: SEC-001 and SEC-005 read 'FIXED — hosted pending deploy', mat |

### commit 22 — 1

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/submission/RASTA_AI_SIH26002_TEAM17_FINAL.pptx` | mod | REWORK | LOW | Genuine regeneration, not a stray save: unzipped the committed vs working copy — ppt/media/image9.png is gone, image1-8 all shift by one, slide3.xml changes 55190->55422, docProps/ |

### commit 23 — 4

| path | s | class | risk | why |
|---|---|---|---|---|
| `manager-web/src/components/FleetMap.tsx` | mod | KEEP | MEDIUM | Adds the 2D/Terrain/3D mode group (applyMapMode, with every failure path landing back on the flat map and the failure shown in words), the roadside-services category group backed b |
| `manager-web/src/components/PlacesLayer.tsx` | new | KEEP | MEDIUM | 177 lines, read in full. Viewport-scoped marker layer with a 400ms moveend debounce, AbortController per load, and clear() on every category change and unmount. Renders the snapsho |
| `manager-web/src/components/mapTerrain.test.ts` | new | KEEP | LOW | 17 tests, all passing when I ran vitest on it. Covers the keyless-source property, terrarium encoding, the attribution, the 2D fallback when addSource throws, teardown on an alread |
| `manager-web/src/components/mapTerrain.ts` | new | KEEP | LOW | 192 lines, read in full. Only imports maplibre-gl types. DEM source is the keyless AWS Open Data Terrain Tiles endpoint with terrarium encoding and the required attribution string; |

### commit 24 — 3

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/DATA_HYGIENE_AUDIT.md` | new | KEEP | LOW | Read-only provenance audit against hosted Supabase at 0012, explicit that nothing was written. Separates a product bug (/api/dashboard counted every districts row, so pytest fixtur |
| `docs/MIGRATION_0013_DEPLOYMENT_PACKET.md` | new | KEEP | LOW | The runbook for the blocked migration, and it is honest about it: 'Prepared, not executed', hosted revision read from hosted as 0012, hosted code named as the 5b5e474 build. Statem |
| `docs/STATE_DISTRICT_RBAC_AND_NOTIFICATIONS.md` | new | KEEP | LOW | The design-of-record for the new role model and scope enforcement, with per-section IMPLEMENTED / PARTIALLY_IMPLEMENTED / NOT_IMPLEMENTED / BLOCKED status. Load-bearing across the  |

### commit 25 — 13

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/alembic/versions/0013_state_district_inbox.py` | new | KEEP | HIGH | Read in full. Correctly chained (down_revision='0012_push_notifications', and 0012 is the last migration tracked at origin/main, so no fork). Purely additive: every new column on u |
| `backend/app/core/permissions.py` | mod | KEEP | LOW | Purely additive: two permission strings (NOTIFICATION_READ, MANAGER_ACCOUNT_MANAGE, both added to ALL_PERMISSIONS) and three role entries in ROLE_PERMISSIONS. No existing role's pe |
| `backend/app/models/__init__.py` | mod | KEEP | LOW | Full diff read - re-export only: imports State/District/Notification and NotificationKind/NotificationSeverity and adds them to __all__. P2_TABLES is untouched, which is right: tes |
| `backend/app/models/enums.py` | mod | KEEP | MEDIUM | Full diff read. Adds NORTH_EAST_MANAGER / STATE_MANAGER / DISTRICT_MANAGER to UserRole, plus DistrictSource, NotificationKind, NotificationSeverity, and registers all three new typ |
| `backend/app/models/fleet.py` | mod | KEEP | HIGH | Full diff read - one column: Truck.display_name, String(60), nullable, not unique, registration_number keeps its unique constraint. Matches op.add_column('trucks', display_name Str |
| `backend/app/models/geography.py` | new | KEEP | MEDIUM | Read in full. State/District ORM tables matching 0013 exactly (uq_states_slug, uq_districts_state_slug, ix_districts_state_id from index=True). Provenance is a queryable column (so |
| `backend/app/models/identity.py` | mod | KEEP | HIGH | Full diff read. Adds five User columns (state_id, district_id, must_reset_password, last_seen_at, created_by_user_id) plus uq_active_state_manager, uq_active_district_manager and c |
| `backend/app/models/notifications.py` | new | KEEP | MEDIUM | Read in full. Durable per-recipient inbox row; columns, the uq_notifications_recipient_dedupe constraint and the (recipient_user_id, created_at DESC) index all match 0013 one-for-o |
| `backend/app/models/operations.py` | mod | KEEP | HIGH | Full diff read - two nullable FKs on Shipment: origin_district_id, destination_district_id, both ondelete=RESTRICT, both index=True (names match 0013's explicit create_index). Expl |
| `backend/app/schemas/domain.py` | mod | REWORK | MEDIUM | Full diff read. Most of it is good input hardening (max_length on previously unbounded free-text fields: photo_url 200, handling_notes 500, damage/resolution notes 1000, addresses  |
| `backend/tests/factories.py` | mod | KEEP | MEDIUM | Adds make_district/get_state/operational plus state_id, district_id, must_reset_password on make_user and origin/destination_district_id on make_shipment. Imports app.models.geogra |
| `backend/tests/test_schema_drift.py` | mod | KEEP | LOW | Registers the enum labels and types 0013 ships: NORTH_EAST_MANAGER / STATE_MANAGER / DISTRICT_MANAGER on user_role, and district_source, notification_kind, notification_severity as |
| `docs/DATA_MODEL.md` | mod | REWORK | LOW | Rewrites the status line to 'implemented through Alembic 0012_push_notifications (head, linear chain 0001 -> 0012)' and adds an accurate 0003-0012 table. True of hosted, but backen |

### commit 26 — 4

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/core/scope.py` | new | KEEP | MEDIUM | The row-scoping linchpin of the whole state/district feature, and it holds up under checking. Same predicate feeds the list path (`shipment_scope_clause` / `trip_scope_clause`) and |
| `backend/app/services/shipments.py` | mod | KEEP | LOW | `list_shipments` gains `actor=None` and applies `scope.shipment_scope_clause` when the caller is a scoped role. Verified the caller backend/app/api/trips.py:84 already passes `acto |
| `backend/app/services/telemetry.py` | mod | KEEP | LOW | `active_fleet` gains `actor=None` and scopes the fleet map to the caller's district/state. Verified backend/app/api/trips.py:1770 already passes `actor=actor`. The `.where(*([claus |
| `backend/tests/test_state_district_scope.py` | new | KEEP | LOW | The keystone suite of the whole slice, and the best-reasoned file in it: every rule asserted twice, once against a list and once against a direct id, because 'the list is filtered, |

### commit 27 — 3

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/schemas/auth.py` | mod | REWORK | MEDIUM | Full diff read. Substance is good and verified wired: LoginRequest.workspace is a hint that is checked, not trusted - services/auth.py:97 _workspace_matches rejects a mismatch with |
| `backend/app/services/auth.py` | mod | KEEP | MEDIUM | Two additions. `WORKSPACE_ROLES` + `_workspace_matches` gate which console a role may sign in to; it can only ever refuse (`workspace=None` leaves every existing login untouched),  |
| `backend/tests/test_auth.py` | mod | KEEP | MEDIUM | Replaces the weak `"password" not in text.lower()` check with name-based assertions (password_hash, the plaintext, the argon2 prefix) plus an exact key-set assertion on /api/auth/m |

### commit 28 — 11

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/domain/driver_compliance.py` | new | KEEP | MEDIUM | A pure stdlib module — frozen dataclass, str Enum, one `assess()` function, derived-never-stored, `today` injectable for tests. No ORM, no SQL, no 0013 dependency: every field it c |
| `backend/app/services/driver_trips.py` | mod | KEEP | HIGH | The DEPLOYED part is only the 3-line comment replacing `await trips.release_resources(db, trip)` in `complete()` — already in e4043ce; the local tree rewords that same comment (5 l |
| `backend/app/services/notifications.py` | new | KEEP | HIGH | The recipient-resolution and inbox core every other notification caller in this slice imports. Read in full. Honest about unknowns: `recipients_for_trip` returns [] when the shipme |
| `backend/app/services/notify.py` | mod | KEEP | LOW | Three new names in the `EVENTS` whitelist: ROUTE_CHANGED, EMERGENCY_STOP_ACK, EMERGENCY_RESOLVED. Pure allow-list extension to the existing push service, no schema and no 0013 depe |
| `backend/app/services/reroute.py` | mod | KEEP | LOW | A single `actor=actor` pass-through on `trip_service.load_for_update` in `accept()`. Meaningless on its own and a TypeError without the trips.py change, so it must not be committed |
| `backend/app/services/trips.py` | mod | REWORK | HIGH | The DEPLOYED part is `await release_resources(db, trip)` in `close()` — present in e4043ce and byte-identical here; only its comment was reworded locally, so do NOT re-apply the fi |
| `backend/tests/test_delay_notifications.py` | new | KEEP | MEDIUM | Covers the three things a delay notice gets wrong: wrong recipients, a fabricated ETA, and repetition. The ETA-honesty test (null, not invented) is the one that matters - a dock is |
| `backend/tests/test_driver_compliance.py` | new | KEEP | MEDIUM | Splits the rule into a hard gate (a licence is required to create a driver) and a window (contact and insurance block the NEXT dispatch, never a running trip), and the last test pi |
| `backend/tests/test_notification_lifecycle.py` | new | KEEP | MEDIUM | Narrow on purpose: only the LAST stop is an arrival the districts hear about, every earlier stop is timeline detail. The transactional test is the valuable one - a delivery that ro |
| `backend/tests/test_notifications.py` | new | KEEP | LOW | Core recipient and dedupe suite: a truck's own fleet manager is not the district it is arriving in, origin hears DISPATCHED and destination hears INCOMING, a deactivated manager st |
| `backend/tests/test_trip_execution.py` | mod | KEEP | LOW | The functional part - flipping the delivery assertion from AVAILABLE to ON_TRIP - is already live in e4043ce. `git diff origin/main` leaves only an expanded comment on that same as |

### commit 29 — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/services/route_review.py` | mod | KEEP | MEDIUM | Four lines: import trips, then after the existing commit fetch the trip with `actor=actor` and call `route_service.announce_route_change`, then commit again. Verified `approve_and_ |
| `backend/app/services/routes.py` | mod | KEEP | HIGH | Two separable things: three one-line `actor=actor` pass-throughs to `trips.load_for_update` (scope enforcement, no 0013 need) and a new `announce_route_change()` that pushes ROUTE_ |

### commit 30 — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/tests/test_fleet_utilisation.py` | new | KEEP | LOW | Pins trucks_total: null (not zero) for a scoped role, because trucks carry no district and only trips do - so a district manager's numerator is scoped and the denominator is not. ' |
| `backend/tests/test_scope_http_idor.py` | new | KEEP | LOW | The IDOR matrix at the HTTP boundary: list, detail, events and routes must agree, out-of-scope is 404 not 403 so the id space is not an oracle, mutations on another district's trip |

### commit 31 — 1

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/tests/test_login_workspace.py` | new | KEEP | MEDIUM | Guards both directions: the workspace picker can only ever refuse (it never grants a console), and a mismatch returns the identical 401 'Invalid credentials.' as a wrong password s |

### commit 32 — 13

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/domain/presence.py` | new | KEEP | LOW | Pure stdlib (dataclass, Enum, datetime), derived-on-read, `now` injectable. The module itself takes datetimes as arguments and touches no model or column, so it imports and runs on |
| `backend/tests/test_dashboard.py` | new | KEEP | LOW | Per-role dashboard counts asserted against fixtures where the out-of-scope rows exist and must not be counted - the right shape for a leak-by-counting bug. Also pins that every fie |
| `backend/tests/test_district_provenance.py` | new | KEEP | LOW | The suite that makes 'UNKNOWN != SAFE' enforceable for districts: source_status defaults to UNVERIFIED, UNVERIFIED is not in OPERATIONAL_SOURCES, and one test walks the whole suite |
| `backend/tests/test_driver_stop_request.py` | new | KEEP | MEDIUM | A driver cannot end a loaded job alone: the request records a reason, raises an urgent notification carrying the number to call, and leaves the trip running. Idempotency is covered |
| `backend/tests/test_fixture_residue_stays_excluded.py` | new | KEEP | LOW | Containment tests for the 19,860 deactivated fixture users and five retired trucks sitting in hosted Supabase, which are deliberately NOT being deleted. Three properties: inactive  |
| `backend/tests/test_input_limits.py` | new | KEEP | MEDIUM | A sweep, not a list: it walks every request model create_app() actually serves and fails on any unbounded client string, with each exemption carrying a written reason. The right de |
| `backend/tests/test_manager_places.py` | new | REWORK | LOW | The tests themselves are good (who may ask, bounded box, honest answer - no 'safe', distance labelled straight_line_m). The file is stale on fact: a 20-line docstring block states  |
| `backend/tests/test_org_api.py` | new | KEEP | LOW | The HTTP half of the hierarchy - explicitly paired with test_state_district_scope.py, which proves the service rules ('a rule enforced in a function nothing calls is not enforced a |
| `backend/tests/test_places_fuel.py` | new | KEEP | MEDIUM | Holds the right invariant - not 'FUEL exists' but 'every offered category has data behind it', so a sixth category added without an extract fails. Also checks the snapshot carries  |
| `backend/tests/test_presence.py` | new | KEEP | LOW | Presence is a heartbeat this server received and nothing else - not navigator.onLine, not signal bars, not an open tab. The fourth case is the one that earns the file: a driver in  |
| `backend/tests/test_public_regions.py` | new | KEEP | LOW | The one unauthenticated read, and the four properties that keep it safe are each a test: it answers without a token, it carries exactly names and ids (four keys on a region, three  |
| `backend/tests/test_security_assessment.py` | new | REWORK | MEDIUM | SEC-001 through SEC-005 and SEC-007 are solid regression tests. TestTrustedProxyStillOpen is stale and says so itself: 'SEC-006: OPEN, deliberately... REPLACE these tests when the  |
| `docs/API_CONTRACTS.md` | mod | REWORK | LOW | Header asserts 'Section 15 is the authority on what exists ... checked against the routers mounted in backend/app/main.py', and §15 was regenerated as exactly 86 routes at commit 7 |

### commit 33 — 4

| path | s | class | risk | why |
|---|---|---|---|---|
| `manager-web/src/auth/AuthProvider.tsx` | mod | KEEP | MEDIUM | Two coupled changes. (1) CONSOLE_ROLES grows from ['MANAGER','ADMIN','AUTHORISED_REVIEWER'] to include NORTH_EAST_MANAGER, STATE_MANAGER, DISTRICT_MANAGER — the comment records a r |
| `manager-web/src/components/NorthEastMap.tsx` | new | KEEP | LOW | 125 lines, read in full. Hand-drawn schematic of the eight NE states, aria-hidden decoration with the selection announced in text beside it. States only — no district geometry and  |
| `manager-web/src/components/TerrainScene.tsx` | new | KEEP | LOW | 107 lines, read in full. Pure inline SVG decoration (ridges, conifers, a road), aria-hidden, no animation, no imports at all. Written to avoid shipping the redesign's unlicensed re |
| `manager-web/src/pages/scopeSelector.test.tsx` | new | KEEP | LOW | 168 lines, jsdom with api.listRegions mocked, so the test itself needs no backend. Defends the right property: the scope step is navigation and never authority, a mismatch is refus |

### commit 34 — 6

| path | s | class | risk | why |
|---|---|---|---|---|
| `manager-web/src/components/buttonClasses.test.ts` | new | KEEP | MEDIUM | 127 lines. Scans every non-test .tsx/.ts under manager-web/src and asserts each colour utility resolves to a --color-* token declared in index.css, and that no btn-* class is used. |
| `manager-web/src/components/tableScroll.test.ts` | new | KEEP | MEDIUM | 84 lines, 10 tests, passing. Structural source scan: every <table> under manager-web/src must have an overflow-x-auto ancestor within three levels, checked by indentation. Includes |
| `manager-web/src/pages/NotificationsPage.test.tsx` | new | KEEP | LOW | 95 lines of pure unit tests over the exported headline() and detail() — no network, no jsdom needed, so not blocked by 0013 itself. Good assertions: the destination district is tol |
| `manager-web/src/pages/OverviewPage.test.ts` | new | KEEP | LOW | 65 lines. Not a duplicate of OverviewPage.test.tsx despite the near-identical name — this is a pure unit test of the exported presenceLine(), asserting presence and GPS freshness s |
| `manager-web/src/pages/OverviewPage.test.tsx` | new | KEEP | LOW | 123 lines, jsdom render tests with api mocked — no live backend, so it is not itself blocked by 0013. Guards the exact failure the hard constraints care about: a state with no veri |
| `manager-web/src/pages/ReportsPage.tsx` | new | REWORK | MEDIUM | 213 lines. The report body is built from /api/trips, which exists and is scoped at e4043ce, and it reuses the unmodified tripExport.ts so a report and a CSV of the same filter cann |

### commit 35 — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/api/stopRequest.test.ts` | new | KEEP | LOW | Stubs fetch and asserts the wire contract: the /api/driver/me/trip/stop-request path, request_id echoed identically across a retry (so one press cannot become four emergencies), an |
| `driver-app/src/auth/coldStart.test.ts` | new | KEEP | LOW | Reads AUTH_TIMEOUT_MS and REQUEST_TIMEOUT_MS out of client.ts source rather than copying them, so it asserts the real budget against the measured 32.9s cold start with 1.5x margin, |

### commit 36 — 1

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/screens/MapScreen.tsx` | mod | REWORK | MEDIUM | The idle-card restyle is a clean KEEP - 'Route not selected' no longer renders in the blue maneuver card, since blue means route geometry here and painting an absence in it made no |

### commit 37 — 1

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/src/trip/TripProvider.test.tsx` | mod | KEEP | LOW | Adds a resolved heartbeat mock to the api module mock rather than stubbing the method away, with the stated reason that a missing method would hide a wiring bug. Harmless on its ow |

### commit 38 — 7

| path | s | class | risk | why |
|---|---|---|---|---|
| `driver-app/App.tsx` | mod | KEEP | LOW | Adds tutorial gating (tri-state firstRun: null while AsyncStorage is read, so the tour cannot flash at a driver who dismissed it) and fixes the header theme toggle wording Day/Nigh |
| `driver-app/app.json` | mod | KEEP | LOW | Version/versionCode bump 1.0.18 -> 1.0.22 only; nothing else in the manifest changed. Required for any new Android preview build of this slice. |
| `driver-app/src/screens/MoreScreen.tsx` | mod | KEEP | LOW | Adds the 'How RASTA works' row (onOpenTutorial prop, testID more-tutorial), converts row icons to a single aqua disc, and finishes the Day/Night -> Light/Dark rename on both the su |
| `driver-app/src/screens/TutorialScreen.tsx` | new | KEEP | LOW | Scrollable list rather than a ten-panel carousel, with the stated reason (a driver wants the one thing they forgot, not nine swipes) - no gesture dependency, one screen-reader pass |
| `driver-app/src/screens/tutorialSteps.test.ts` | new | KEEP | LOW | Checks the ten mission topics are all present with unique ids, bounds titles at 34 and bodies at 40-260 chars, and - the useful one - forbids /safe\|guarantee\|always works\|never  |
| `driver-app/src/screens/tutorialSteps.ts` | new | KEEP | MEDIUM | Content split from the view so it is testable. Ten steps, stable ids, icons typed as Feather's own IconName (verified: IconName = ComponentProps<typeof Feather>['name'], so an inve |
| `driver-app/src/themeWording.test.ts` | new | KEEP | LOW | Walks every non-test .ts/.tsx under driver-app and fails on any user-facing 'Day'/'Night' theme label, with a non-vacuous counter-check that App.tsx and MoreScreen do say Light/Dar |

### BLOCKED — 18

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/app/api/auth.py` | mod | BLOCKED | HIGH | Three independent additions. (1) SEC-006 rate-limit peer now resolves via core.rate_limit.client_address + settings.TRUSTED_PROXY_HOPS instead of request.client.host — no DB depend |
| `backend/app/api/dashboard.py` | new | BLOCKED | MEDIUM | GET /api/dashboard, one server-computed overview per role. Built entirely on scope.trip_scope_clause and joins against districts / shipments.origin_district_id — 0013 tables and co |
| `backend/app/api/deps.py` | mod | BLOCKED | HIGH | Adds PASSWORD_RESET_ALLOWED and a forced-password-reset gate inside get_current_user: every authenticated request whose path is not in the allowlist is refused with PASSWORD_RESET_ |
| `backend/app/api/driver.py` | mod | BLOCKED | HIGH | One file, two unrelated additions with different preconditions. (a) ~95 lines: a second router, places_router (GET /api/places), serving the same local snapshot to managers over a  |
| `backend/app/api/notifications.py` | new | BLOCKED | LOW | GET /api/notifications and POST /api/notifications/read, both delegating to services/notifications against the notifications table, its two enums and its indexes — all created by 0 |
| `backend/app/api/org.py` | new | BLOCKED | MEDIUM | The whole states/districts/managers router. Every route reads the states or districts tables or the users.state_id / district_id / must_reset_password / created_by_user_id columns, |
| `backend/app/api/presence.py` | new | BLOCKED | MEDIUM | POST /api/presence/heartbeat and GET /api/presence. Both read or write users.last_seen_at, added by 0013, so neither runs on hosted. Design is honest about uncertainty: presence (O |
| `backend/app/api/trips.py` | mod | BLOCKED | HIGH | Threads actor= through ~14 trip/shipment/route/telemetry reads (including three endpoints that previously disclosed existence before scoping: stop_simulation, reroute_assessment, a |
| `driver-app/src/api/client.ts` | mod | BLOCKED | MEDIUM | Four independent changes, two of them blocked. KEEP-worthy: NetworkError.timedOut flag (the /abort/i message test never matched on RN, which is why cold starts were blamed on the d |
| `driver-app/src/screens/TripScreen.tsx` | mod | BLOCKED | HIGH | Three parts. (a) ConfirmSheet on Arrive / Finish stop / Complete trip, driven by one `confirming` union rather than three booleans so two sheets cannot open at once - pure client,  |
| `driver-app/src/trip/TripProvider.tsx` | mod | BLOCKED | HIGH | Two changes. The i18n one is good and self-contained: background notifications now go through tx(currentAppLanguage(), en) instead of English literals, which is the one place a dri |
| `manager-web/src/App.test.tsx` | mod | BLOCKED | LOW | It imports scopeLabel, which only exists in the local App.tsx, and it mocks the new Notifications, States and Managers pages, so it has to land in the same commit as App.tsx. It pa |
| `manager-web/src/App.tsx` | mod | BLOCKED | HIGH | e4043ce did not touch this file (diff against origin/main equals diff against HEAD). The change puts /overview first in NAV for the existing MANAGER role, so it becomes the landing |
| `manager-web/src/pages/LoginPage.tsx` | mod | BLOCKED | HIGH | 690 insertions: a two-step scope-then-credentials sign-in. It POSTs `workspace`/`workspace_state_id`/`workspace_district_id` to /api/auth/login, and backend/app/schemas/common.py s |
| `manager-web/src/pages/ManagersPage.tsx` | new | BLOCKED | HIGH | 254 lines (read the header, the role picker and the issued-password panel; sampled the table). Creates and retires subordinate managers via app/api/org.py. Needs the STATE_MANAGER/ |
| `manager-web/src/pages/NotificationsPage.tsx` | new | BLOCKED | HIGH | 188 lines (read the header, headline() and the imports; sampled the list body). Reads /api/notifications, backed by the new app/api/notifications.py and app/services/notifications. |
| `manager-web/src/pages/OverviewPage.tsx` | new | BLOCKED | HIGH | 328 lines (read the header, the Metric component and the state-table region; sampled the middle). Renders /api/dashboard exclusively. I read backend/app/api/dashboard.py: it select |
| `manager-web/src/pages/StatesPage.tsx` | new | BLOCKED | HIGH | 123 lines, read in full. Entirely api.listStates() / api.listDistricts(), which are /api/org/* in the new app/api/org.py against the states and districts tables from migration 0013 |

### DEPLOYED — 2

| path | s | class | risk | why |
|---|---|---|---|---|
| `backend/tests/test_trip_release_after_delivery.py` | new | DEPLOYED | LOW | Byte-identical to origin/main:backend/tests/test_trip_release_after_delivery.py - diffed the two and there is no delta. It shows as '??' only because local HEAD (5b5e474) is one co |
| `manager-web/src/api/dedupe.test.ts` | new | DEPLOYED | LOW | Shows as untracked (??) only because local HEAD 5b5e474 predates e4043ce. The file on disk is byte-identical to origin/main's copy — `diff` of `git show origin/main:manager-web/src |

### DROP — 21

| path | s | class | risk | why |
|---|---|---|---|---|
| `docs/prompts/RASTA_FINAL_MODULE_AGENT_PROMPT.md` | new | DROP | LOW | A session agent prompt addressed to a coding agent ('You are Claude Fable 5.1 ... START WORK NOW'), pinned to a stale HEAD 7c7410a. Pure session scratch: no code, doc or test refer |
| `docs/submission/day1/task3/screenshots/20-driver-login.png` | new | DROP | LOW | Shared classification for 20-25: single 390x844 phone frames that were merged into the 1218x844 composites 32-driver-a (20-22) and 33-driver-b (23-25). The report cites only the co |
| `docs/submission/day1/task3/screenshots/21-driver-login-error.png` | new | DROP | LOW | Source frame for composite 32-driver-a. No reference in the report or any doc. Preserved in the snapshot tag. |
| `docs/submission/day1/task3/screenshots/22-driver-trip.png` | new | DROP | LOW | Source frame for composite 32-driver-a. No reference in the report or any doc. Preserved in the snapshot tag. |
| `docs/submission/day1/task3/screenshots/23-driver-navigate.png` | new | DROP | LOW | Source frame for composite 33-driver-b. No reference in the report or any doc. Preserved in the snapshot tag. |
| `docs/submission/day1/task3/screenshots/24-driver-safety.png` | new | DROP | LOW | Source frame for composite 33-driver-b. No reference in the report or any doc. Preserved in the snapshot tag. |
| `docs/submission/day1/task3/screenshots/25-driver-more.png` | new | DROP | LOW | Source frame for composite 33-driver-b. No reference in the report or any doc. Preserved in the snapshot tag. |
| `docs/submission/day1/task3/screenshots/30-manager-mobile-390.png` | new | DROP | LOW | Responsive composite that no current file references. The only mention is in the gitignored .runtime/task3 draft, so the compact final report left it out. Preserved in the snapshot |
| `docs/submission/day1/task3/screenshots/31-manager-tablet-768.png` | new | DROP | LOW | Responsive composite that no current file references. The final report left it out. Preserved in the snapshot tag. |
| `docs/submission/final-render/Slide1.PNG` | new | DROP | LOW | Shared classification for final-render/Slide1-6.PNG: a manual PowerPoint render of the deck dated 14 Sep 20:42, the same time as commit 8913bb6 and the tracked FINAL.pdf. It is sta |
| `docs/submission/final-render/Slide2.PNG` | new | DROP | LOW | Part of the stale final-render set (see Slide1). Can be regenerated from the pptx. |
| `docs/submission/final-render/Slide3.PNG` | new | DROP | LOW | Part of the stale final-render set (see Slide1). Can be regenerated from the pptx. |
| `docs/submission/final-render/Slide4.PNG` | new | DROP | LOW | Part of the stale final-render set (see Slide1). Can be regenerated from the pptx. |
| `docs/submission/final-render/Slide5.PNG` | new | DROP | LOW | Part of the stale final-render set (see Slide1). Can be regenerated from the pptx. |
| `docs/submission/final-render/Slide6.PNG` | new | DROP | LOW | Part of the stale final-render set (see Slide1). Can be regenerated from the pptx. |
| `manager-web/dist-cert/assets/index-B0FUNc0p.js` | new | DROP | LOW | Shared classification for the 6 dist-cert files: a Vite build from 20 Sep with the local cert backend http://127.0.0.1:8027 baked in, so it is useless anywhere else. ENGINEERING_PR |
| `manager-web/dist-cert/assets/index-BazBWXml.css` | new | DROP | LOW | Build output from the cert build (see index-B0FUNc0p.js). |
| `manager-web/dist-cert/assets/maplibre-gl-worker-Bml_7JYB.js` | new | DROP | LOW | Build output from the cert build (see index-B0FUNc0p.js). |
| `manager-web/dist-cert/brand-mark.svg` | new | DROP | LOW | A copy of the public asset that the build made. The source lives in manager-web/public. |
| `manager-web/dist-cert/favicon.svg` | new | DROP | LOW | A copy of the public asset that the build made. The source lives in manager-web/public. |
| `manager-web/dist-cert/index.html` | new | DROP | LOW | Built index.html pointing at the hashed cert bundle (see index-B0FUNc0p.js). |
