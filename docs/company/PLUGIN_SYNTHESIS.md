# Plugin synthesis and lane decisions

**Owner** CTO (synthesis), then CEO (lane decisions). Lane `company2/cto-synthesis`.
**Written** 26 September 2026, about 20:00-20:10 IST.
**Baselines** hosted = `e4043ce` (`origin/main`, database revision 0012). Local = `5b5e474` plus the
uncommitted working tree (migration 0013), preserved in tag `snapshot/post-demo-2026-09-26`.
Integration plan: `docs/POST_DEMO_CHANGE_INVENTORY.md` (38 commits).

This document reads the nine lane deliverables listed in section 0.2, resolves the places where they
disagree, and decides what happens to each lane. It changes no code. Nothing hosted was contacted.
It is not a certificate: UNKNOWN is not SAFE, and a finding is never closed because nothing
contradicts it.

---

## 0. How to read this document

### 0.1 Evidence labels

Every claim carries exactly one label: `PROVEN_BY_TEST`, `PROVEN_BY_RUNTIME`, `PROVEN_BY_DATABASE`,
`PROVEN_BY_SOURCE`, `PROVEN_BY_WEB`, `INFERRED`, `NOT_VERIFIED`, `BLOCKED`.

- A label followed by a lane document (for example `PROVEN_BY_TEST · SAP §3`) is **carried** from
  that document. The lane collected the evidence; this document did not repeat it. A carried
  `PROVEN_BY_WEB` means the lane fetched the URL, not this synthesis.
- A label marked **CTO** was collected for this synthesis on 26 September 2026 between 20:00 and
  20:10 IST (section 1).
- A label carried from a **PARKED** lane (section 16) is shown, but no ADOPT_NOW decision here rests
  on it alone. Each such decision is backed by a CTO re-check or by an accepted lane.

### 0.2 Lane documents read (in full or by section)

| Code | Document | Lane | CEO decision (section 16) |
|---|---|---|---|
| TRACE | `docs/PROBLEM_STATEMENT_TRACEABILITY.md` | product-constitution | REWORK |
| SAP | `docs/SECURITY_ASSURANCE_PLAN.md` | security-assurance | REWORK |
| RSL | `docs/research/RESEARCH_PLUGIN_SOURCE_LEDGER.md` | research-ner | REWORK |
| NPE | `docs/NER_PLATFORM_EXPANSION.md` | platform-expansion | REWORK |
| SCP | `docs/SCALABILITY_AND_CAPACITY_PLAN.md` | scale-capacity | PARK |
| ENG | `docs/company/ENGINEERING_PLUGIN_FINDINGS.md` | plugins-engineering-data | ACCEPT |
| DATA | `docs/company/DATA_PLUGIN_FINDINGS.md` | plugins-engineering-data | ACCEPT |
| SLF | `docs/company/SECURITY_AND_LEGAL_PLUGIN_FINDINGS.md` | plugins-security-legal | REWORK |
| DPC | `docs/company/DESIGN_PLUGIN_COMPARISON.md` | plugins-design-brand | ACCEPT |
| BCG | `docs/company/BRAND_AND_COPY_GUIDE.md` | plugins-design-brand | ACCEPT |
| GEO | `docs/company/GEOSPATIAL_PLUGIN_FINDINGS.md` | plugins-geo-docs | PARK |
| PDF | `docs/company/PDF_EVIDENCE_MATRIX.md` | plugins-geo-docs | PARK |

### 0.3 Decision words

`ADOPT_NOW` = fits the current integration priorities (1 clean integration, 2 security and privacy
fixes, 3 migration correctness, 4 RBAC, 5 Manager, 6 Driver, 7 browser and device certification,
8 scaling, 9 research-backed expansion, 10 optional innovation) and can land with or before the
38-commit plan. `ROADMAP` = real, but later or needs a decision. `REJECT` = do not do it.
Hosted migration, hosted cleanup, force push, secret rotation and paid services are the **user's**
decisions and appear only in section 16.4.

---

## 1. Re-checks made for this synthesis (CTO)

| # | What was checked | Result | Label |
|---|---|---|---|
| K1 | Driver i18n coverage gate: `driver-app/node_modules/.bin/vitest run src/i18n/coverage.test.ts src/screens/AssignmentScreen.test.tsx` at 20:01 IST | 2 files, 3 tests passed | PROVEN_BY_TEST · CTO |
| K2 | `driver-app/src/screens/LoginScreen.tsx` | Modified 18:40:25 IST. Line 176 now reads `placeholder={t('login_phone_placeholder')}`; `appLanguage.ts:168,237,304,371,438` carry en/hi/gu/as/bn drafts | PROVEN_BY_SOURCE · CTO |
| K3 | Same file at `e4043ce` (`git show`) | Line 170 is a literal 10-digit placeholder ending in 77 (`XXXXXXXX77`) | PROVEN_BY_SOURCE · CTO |
| K4 | Gemini key handling in the working tree | `backend/app/services/gemini.py:322` builds `...:generateContent?key=...`; `backend/app/main.py:36` calls `logging.basicConfig`; no `httpx` logger level is set and no `x-goog-api-key` appears in `backend/app` | PROVEN_BY_SOURCE · CTO |
| K5 | `backend/app/core/permissions.py` | `_MANAGER_PERMISSIONS` has no `NOTIFICATION_READ` although the comment at :83-85 says every manager role has it; `_DISTRICT_MANAGER_PERMISSIONS` is `_MANAGER_PERMISSIONS` plus `NOTIFICATION_READ`, so it inherits `DRIVER_UPDATE`, `DRIVER_DEACTIVATE`, `DRIVER_SUPPORT_VIEW`, the truck and assignment writes and `EMERGENCY_RESOLVE` | PROVEN_BY_SOURCE · CTO |
| K6 | `backend/app/services/trips.py` `_load_truck` | The truck `select` at :718 has no `with_for_update()` | PROVEN_BY_SOURCE · CTO |
| K7 | `backend/app/services/auth.py:179` | `verify_password(...)` is called directly inside the async login; no `to_thread` | PROVEN_BY_SOURCE · CTO |
| K8 | `backend/app/api/presence.py:133-138`, `backend/app/api/dashboard.py:195-198` | `max(GpsPoint.received_at)` joined to every trip of the listed drivers, with no time bound | PROVEN_BY_SOURCE · CTO |
| K9 | `backend/Dockerfile:53` | `--workers 1` | PROVEN_BY_SOURCE · CTO |
| K10 | `manager-web/src/components/FleetMap.tsx:254`, `AddressPicker.tsx:692` | `attributionControl: { compact: true }` | PROVEN_BY_SOURCE · CTO |
| K11 | `backend/app/schemas/domain.py:281-290` | Service region is a lat/lon rectangle, 21.5-29.5 N, 88.0-97.5 E | PROVEN_BY_SOURCE · CTO |
| K12 | `driver-app/src/map/DriverRouteMap.native.tsx:66-71,128-136` | `window.scene` removes and redraws every layer; the whole scene JSON is re-sent whenever any input changes | PROVEN_BY_SOURCE · CTO |
| K13 | Design findings A2-A7 | Still present: `LoginScreen.tsx:294` motto, `MapScreen.tsx:1273` "PERSONAL ROUTE AI", `appLanguage.ts:166` subtitle, `LoginPage.tsx:444,448,728,733` slogans, `index.css:81` `--color-ok: #087F5B` | PROVEN_BY_SOURCE · CTO |
| K14 | Fuel model wiring | `backend/app/domain/fuel_model.py` exists; outside that file it is referenced only as a type in `route_risk.py:60` and by name in `intelligence_inventory.py:40`; `services/routes.py:404-406` stores no fuel estimate and its comment says "No fuel model exists" | PROVEN_BY_SOURCE · CTO |
| K15 | `manager-web/src/components/AddressPicker.tsx:71`; `backend/app/core/config.py:182`; `backend/app/services/weather/open_meteo.py:47` | 700 ms debounce search; OSRM demo server is the default fallback; User-Agent has no contact | PROVEN_BY_SOURCE · CTO |
| K16 | CLIs | `command -v qodo` and `command -v unity` return nothing; `~/.qodo` does not exist | PROVEN_BY_RUNTIME · CTO |
| K17 | Rule-breach residue (names only; contents not opened) | `.runtime/perf/` and `scratchpad/company2/scale-capacity-review/` each hold `perf-credentials.private.json`, `perf-secret.private.txt`, `tokens.private.json`; `npm-cache/_npx/b8d86e6551a4f492/node_modules` exists | PROVEN_BY_RUNTIME · CTO |
| K18 | Lane evidence artifacts | Present: `plugins-design-brand/uiux_search.txt`, `plugins-security-legal/httpx_log_probe.py`, `plugins-engineering-data/proof.py` and `proof_out.txt`, `plugins-geo-docs/mbx_docs.txt`, `security-assurance/axml_perms.py` and `run{1,2,3}-rework.log` | PROVEN_BY_RUNTIME · CTO |
| K19 | Session connectors | This session reports Zoom MCP servers failing with HTTP 401, and the engineering, data, legal, brand-voice, bio-research, mapbox and supabase connectors needing authentication | PROVEN_BY_RUNTIME · CTO |
| K20 | Repository state | `HEAD` is `5b5e474`; `docs/company/` is untracked | PROVEN_BY_RUNTIME · CTO |

---

## 2. Cross-lane conflicts and how they are resolved

| # | Conflict | Resolution | Label of the resolution |
|---|---|---|---|
| X1 | TRACE run C (18:22) and NPE (18:21) say the driver phrase-coverage test fails on "10-digit mobile number" | Superseded. Another session added the phrase to the catalogue at 18:40, and the test passes at 20:01 (K1, K2). The translations are still unreviewed drafts | PROVEN_BY_TEST · CTO |
| X2 | DPC A1 says `LoginScreen.tsx:176` shows the demo driver's login number | True on `e4043ce` (K3), no longer true in the working tree (K2). The hosted half joins the C1-01 user decision | PROVEN_BY_SOURCE · CTO |
| X3 | SLF L-4 says MET Norway **requires** contact details and `If-Modified-Since`. RSL 0.5, reworked after the research gate refuted the same wording by re-fetching the terms, says both are **should**, with a stated risk of being blocked without warning | RSL stands. SLF L-4 must be reworded (section 16). The action (add a contact to the User-Agent) is unchanged | PROVEN_BY_WEB · RSL 0.5 |
| X4 | SLF L-5 says a collapsing OSM credit is allowed (OSMF attribution guidelines). GEO-01 says the OSM tile policy forbids attribution behind toggles | Both lanes read MapLibre's compact control the same way (open first, collapses on interaction). They cite two different OSMF documents. `compact: false` plus a copyright link satisfies both readings at no cost, so it is adopted without settling the reading | INFERRED |
| X5 | GEO L12 says whether the shipped APK holds the MapTiler key is not established. SLF S-2a found the key inside `release/RASTA-AI-1.0.18.apk` | SLF stands | PROVEN_BY_RUNTIME · SLF S-2a |
| X6 | TRACE §5 and PS-18 list the physics fuel model among working engines ("cost per route"). PDF C2 says no fuel estimate is ever produced | The module exists but no service calls it and route rows store no fuel estimate (K14). TRACE needs one line corrected; the `routes.py` comment "No fuel model exists" is also stale | PROVEN_BY_SOURCE · CTO |
| X7 | Nominatim search-as-you-type: SLF L-6 ROADMAP, GEO G10 ADOPT_NOW, RSL P3 "needs a decision" | ADOPT_NOW: search on Enter or a button. It is a small manager change, and a ban would also stop the NDMA warning district lookup that shares the host (SLF L-6) | PROVEN_BY_SOURCE · SLF L-6 |
| X8 | User-Agent contact: RSL ROADMAP, SLF L-4 ADOPT_NOW | ADOPT_NOW with the public repository URL in one shared constant; no personal email or phone | INFERRED |
| X9 | Line drift from concurrent edits: SAP and SLF cite `gemini.py:323`; it is :322 now (K4). SAP re-read `services/auth.py` after an 18:13 edit | Cite by function name as well as line when integrating | PROVEN_BY_SOURCE · CTO |
| X10 | GEO §2 reports 19 manager terrain tests; GEO §8-§9 say 17 | Internal inconsistency in a parked lane; not used here | PROVEN_BY_SOURCE · GEO |
| X11 | Data connectors: DATA §1 says NOT_RELEVANT; the lane's summary says NEEDS_USER_AUTH | Both hold: they need auth (K19) and no task needed them | PROVEN_BY_RUNTIME · CTO |

---

## 3. ENGINEERING

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | E4: a driver's stop request writes 0 manager-inbox rows when the shipment has no districts, yet the driver is told "Your manager has been alerted". Working tree only; enters with plan commit 32 | PROVEN_BY_RUNTIME · ENG E4 |
| 2 | E1: two plans for two different drivers both committed onto one free truck, because only the driver's row is locked. The same code is on `e4043ce` | PROVEN_BY_RUNTIME · ENG E1 |
| 3 | E3: cancel, hold, redirect and cargo-unloaded send the Expo push before the commit, under the trip lock; an independent database session read ASSIGNED at the moment the cancel push was sent | PROVEN_BY_RUNTIME · ENG E3 |
| 4 | E2: repeating a post-pickup RETURN_TO_DEPOT creates a second drop-off, two ROUTE_CHANGED acknowledgements and two pushes; there is no idempotency key | PROVEN_BY_RUNTIME · ENG E2 |
| 5 | None of E1-E4, E6 or E7 is covered by a test; the current suite passes with all of them present | PROVEN_BY_SOURCE · ENG E11 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | E4 + E5 before commit 32 lands: when no district or state recipient exists for an urgent kind, fall back to active MANAGER and NORTH_EAST_MANAGER accounts; word the driver acknowledgement by whether an inbox row was written; decide MANAGER `notification:read` in the same change | ADOPT_NOW | 1, 6 | Safety message states an action the system did not take [PROVEN_BY_RUNTIME · ENG E4] |
| 2 | E1: `with_for_update()` on the truck row in `_load_truck`, plus a two-drivers-one-truck test; check lock order against dispatch and deactivate | ADOPT_NOW | 1 | The truck row is read without a lock [PROVEN_BY_SOURCE · CTO K6] |
| 3 | E3 (ADR-1 option A): move the four `notify.send` calls after `db.commit()`; E2: client `request_id` on cancel and redirect, reusing the `request_stop` pattern | ADOPT_NOW | 1, 8 | Driver told before the database agrees; duplicate instructions [PROVEN_BY_RUNTIME · ENG E2, E3] |
| 4 | E6/E7: scope check before `_load_driver` in dispatch and `actor=` at `routes.py:233`; C1-06: align `ShipmentRead` with `ShipmentCreate` before commit 25 | ADOPT_NOW | 4 | Out-of-scope callers get driver state or spend provider calls before the 404 [PROVEN_BY_SOURCE · ENG E6, E7] |
| 5 | Partial unique index on `trips(truck_id)` for open statuses, and a durable push outbox now | REJECT | - | Legacy rule-breaking rows would fail the migration; option A fixes E3 without a new moving part [PROVEN_BY_SOURCE · ENG R1] |

**Risks**

1. Other sessions keep editing the tree during review (LoginScreen.tsx at 18:09 and 18:40, `services/auth.py` at 18:13), so line citations go stale within hours [PROVEN_BY_RUNTIME · CTO K2].
2. The backend DB-backed suites were not executed while the 38-commit plan was built; each commit's tests still have to run for real [PROVEN_BY_SOURCE · docs/POST_DEMO_CHANGE_INVENTORY.md §3a].
3. The `pdf-master` branch carries a second `0013_device_events.py` that forks the Alembic chain; it must become 0014 [PROVEN_BY_SOURCE · NPE step 0014].

**What not to do**

- Do not run a Qodo review of the post-demo tree: the CLI is absent (K16) and it would upload the unmerged diff to a third party without a user decision.
- Do not merge the `pdf-master` event queue as it is; its cycle-1 defects are NOT_VERIFIED, not fixed.
- Do not write lifecycle tests against any database other than `ner_logistics_test`, and do not loosen `tests/db_target.py`.
- Do not stage, commit or push from a lane.

---

## 4. SECURITY

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | NEW-01 (P1): the Gemini API key travels in the URL query and httpx logs that URL at INFO, on hosted `e4043ce` and locally; still open in the working tree at 20:02 (K4) | PROVEN_BY_TEST · SAP §7 |
| 2 | NEW-02 (P1): a district manager in one Assam district listed, read, opened a support session for and deactivated a driver in a Meghalaya district; local 0013 roles only | PROVEN_BY_TEST · SAP §7 |
| 3 | Hosted source `e4043ce` `LoginScreen.tsx:170` uses a literal 10-digit login placeholder ending in 77, which DPC A1 identifies as the demo driver's login number (K3). It joins cycle-1 finding C1-01 (public evidence images showing that driver's number), whose image content was not re-checked by any lane this cycle. Whether the number belongs to a real person is not known | PROVEN_BY_SOURCE · CTO K3 |
| 4 | SEC-001 to SEC-005 are fixed only in the working tree; nothing in the register is FIXED_HOSTED | PROVEN_BY_SOURCE · SAP §1b |
| 5 | NEW-03: twelve wrong current-password guesses returned twelve 401s and no 429; NEW-04 (ILIKE login) is fixed locally and open on hosted; NEW-04b (`api/org.py:355`) is open | PROVEN_BY_TEST · SAP §3 run 3 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | NEW-01: key in the `x-goog-api-key` header (backend and `supabase/functions/gemini-ai/handler.ts:766`), `logging.getLogger("httpx").setLevel(logging.WARNING)` in `main.py`; ship as a standalone 0012-compatible commit ahead of the plan. Rotation afterwards is the user's call | ADOPT_NOW | 2 | A fake key reached the captured log in the lane's test [PROVEN_BY_TEST · SAP §7] |
| 2 | NEW-02: before any hosted 0013, remove `DRIVER_UPDATE`, `DRIVER_DEACTIVATE`, `DRIVER_SUPPORT_VIEW`, truck and assignment writes and `EMERGENCY_RESOLVE` from the two scoped roles; then add `driver_scope_clause` with list-and-detail agreement tests | ADOPT_NOW | 2, 4 | The scoped roles inherit the fleet-wide driver, truck, assignment and emergency write set [PROVEN_BY_SOURCE · CTO K5] |
| 3 | NEW-03 limiter on `POST /api/auth/password`; commit the NEW-04 literal login match; apply it at `api/org.py:355` (NEW-04b) | ADOPT_NOW | 2 | Unthrottled guessing; hosted still wildcard-matches [PROVEN_BY_TEST · SAP §3] |
| 4 | NEW-19: test that `makeRequestId()` returns a UUID with `globalThis.crypto` removed; reuse the RFC 4122 fallback from `useLocationTracking.ts:162-170` | ADOPT_NOW | 6 | Cheap guard on the stop-request path that E4 also touches [PROVEN_BY_SOURCE · SAP NEW-19] |
| 5 | CI job running the section-3 security tests, `npm audit --omit=dev`, the secret scan and an APK `uses-permission` allowlist; removing `android.permission.DUMP` is REJECT (it is a library guard, not a requested permission) | ROADMAP | 2 | No security gate in CI [PROVEN_BY_SOURCE · SAP NEW-15] |

**Risks**

1. Hosted Render logs likely already hold the real Gemini key [INFERRED · SLF S-1].
2. Row-level security on hosted Supabase, which the public publishable key depends on, has not been checked [NOT_VERIFIED · SAP §4].
3. The MapTiler key is inside the 1.0.18 APK and its provider-side restriction has not been checked [NOT_VERIFIED · SLF S-2a].

**What not to do**

- Do not paste any key value into a document, issue, commit or chat; refer to env var names.
- Do not restrict or revoke the current MapTiler key while the certified 1.0.18 APK is in use; a present-but-rejected key blanks the relief layer [INFERRED · SLF S-2a].
- Do not read the 402 local passes as a statement about hosted.
- Do not rewrite git history or force push without the user.

---

## 5. DATA

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | D2: the expanded POI snapshot keeps 7 tag keys; 0 of 4,306 places carry a phone, opening hours or HGV value, where the committed 720-record file had 43 phones | PROVEN_BY_RUNTIME · DATA D2 |
| 2 | D1: queries were capped at 400 per category per state and the Assam box holds 1,523 EMERGENCY records, so some Assam queries were likely truncated, while the served limits text says absence means "not mapped" | INFERRED · DATA D1 |
| 3 | A3: `0013_state_district_inbox.py` is untracked while `ner_logistics_test` is at 0013 | PROVEN_BY_DATABASE · DATA A3 |
| 4 | G6: `request_stop` copies the driver's full phone into the append-only `trip_events` payload and the notification payload | PROVEN_BY_SOURCE · DATA G6 |
| 5 | Shipment status never advances: 73 of 73 demo shipments are DRAFT and NORMAL, including 49 whose trips are CLOSED or DELIVERED | PROVEN_BY_DATABASE · NPE §1.3 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | Before commit 6: D1(a) reword the limits text (capped results; absence in a capped area is not evidence), D1(b) record per-query counts and `truncated`, D2 add the loader's keys to the script allowlist, D3 fix the 720-record comments | ADOPT_NOW | 1 | 0 of 4,306 places carry a phone, opening hours or HGV value [PROVEN_BY_RUNTIME · DATA D2] |
| 2 | Commit migration 0013 as plan commit 25 | ADOPT_NOW | 3 | The test database is at 0013 while the migration file is untracked [PROVEN_BY_DATABASE · DATA A3] |
| 3 | G6 (upgraded from the lane's ROADMAP): before commit 32 lands, stop writing the full phone into `trip_events.payload`; resolve it at read time behind a permission later | ADOPT_NOW | 2 | Copies in an append-only log cannot be corrected or erased once written [PROVEN_BY_SOURCE · DATA G6] |
| 4 | G3: one test that fails when a script under `backend/scripts` writes rows without calling a guard, with a short named allowlist | ADOPT_NOW | 1 | `certify_fleet.py` writes to whatever `DATABASE_PROVIDER` selects [PROVEN_BY_SOURCE · DATA G3] |
| 5 | Index the 19 audit and actor foreign keys | REJECT | - | No reader; adds write cost on `gps_points` [PROVEN_BY_SOURCE · DATA A6] |

**Risks**

1. No verified official district seed exists, so shipments without districts are the expected case and E4 is the normal path, not an edge case [INFERRED · ENG E4].
2. A truncated snapshot can make a missing hospital look unmapped [INFERRED · DATA D1].
3. The shared `ner_logistics_test` lock aborts parallel runs, so test counts only reproduce when no other run holds it [PROVEN_BY_RUNTIME · SAP §3].

**What not to do**

- Do not re-acquire the Overpass snapshot as part of the D1/D2 fix; that is a network action and a user decision.
- Do not touch `ner_logistics_cert` or `ner_logistics_demo`.
- Do not create district rows without a verified official source.
- Do not add ISRO and GSI landslide figures together.

---

## 6. GEOSPATIAL

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | The service-region gate is a rectangle (K11), so any point inside it passes; the geo lane's test points in it lie in Bangladesh, Bhutan and Myanmar | PROVEN_BY_SOURCE · CTO K11 |
| 2 | Routing depends on the public OSRM demo server, whose policy is reasonable non-commercial use at no more than 1 request per second with no guarantee; the routing package has no pacing | PROVEN_BY_WEB · SLF L-2 |
| 3 | Both clients use `tile.openstreetmap.org`, and the offline package deliberately carries no basemap because that policy forbids offline use | PROVEN_BY_SOURCE · CTO (`backend/app/services/offline_package.py:26-30`) |
| 4 | The manager OSM credit uses MapLibre's compact control (K10) and has no link to the copyright page; weather and elevation carry no Open-Meteo credit | PROVEN_BY_SOURCE · SLF L-5 |
| 5 | The native driver map re-sends and redraws the whole scene on any change (K12); the web renderer already splits static and live layers | PROVEN_BY_SOURCE · CTO K12 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | `attributionControl: { compact: false }`, OSM credit linked to `openstreetmap.org/copyright`, "Weather: Open-Meteo.com (CC BY 4.0)" where weather shows, full joerd attribution link for terrain tiles | ADOPT_NOW | 5 | Both manager maps use compact attribution today (X4) [PROVEN_BY_SOURCE · CTO K10] |
| 2 | Address search on Enter or a button instead of a 700 ms debounce | ADOPT_NOW | 5 | Nominatim forbids client-side autocomplete [PROVEN_BY_WEB · SLF L-6] |
| 3 | Self-hosted OSRM (NER extract, existing `ROUTING_PRIMARY_URL` slot) and a self-hosted NER tile extract before any pilot | ROADMAP | 8 | Public services are non-commercial and can withdraw access [PROVEN_BY_WEB · SLF L-2] |
| 4 | Region gate from verified Survey of India boundary data; never hand-drawn | ROADMAP | 9 | Rectangle admits foreign points (finding 1) [PROVEN_BY_SOURCE · CTO K11] |
| 5 | Mapbox GL JS, Mapbox geocoding, traffic and Navigation SDK; any Unity project | REJECT | - | The Unity CLI is not installed [PROVEN_BY_RUNTIME · CTO K16]. India is absent from Mapbox's geocoding coverage table [PROVEN_BY_WEB · GEO §7 item 6 (parked lane)] |

The native-map static/live split (finding 5) is ROADMAP: it ships with the next APK build.

**Risks**

1. OSMF or the OSRM operators can block traffic without notice, which would stop routing, tiles and the NDMA district lookup together [INFERRED · SLF L-1, L-6].
2. Cross-border points and POIs pass the gate and appear on maps [INFERRED · GEO §7].
3. Any hi-resolution terrain or boundary work falls under the DST 2021 geospatial guidelines [PROVEN_BY_WEB · GEO §9 (parked lane)].

**What not to do**

- Do not bulk-download or prefetch `tile.openstreetmap.org` tiles.
- Do not draw or seed state or district boundaries by hand.
- Do not call the manager map "vector tiles" or the driver map "react-native-maps".
- Do not present the schematic `NorthEastMap` as geographic data.

---

## 7. RESEARCH

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | GSI's own note says operational landslide bulletins covered no NE state as of August 2024; no source of current closures is connected to RASTA | PROVEN_BY_WEB · RSL 0.7 |
| 2 | Copernicus DEM GLO-90 is the primary DEM in code, but the admission records disagree or are silent | PROVEN_BY_SOURCE · RSL 0.3 |
| 3 | MET Norway's terms say contact details and caching "should" be provided, and warn of blocking without warning; RASTA's User-Agent has no contact (K15) | PROVEN_BY_WEB · RSL 0.5 |
| 4 | Overpass is used only at developer time; the final ledger's "called at runtime" is wrong | PROVEN_BY_SOURCE · RSL 0.1 |
| 5 | Nine academic abstracts were returned; the landslide thresholds in them are site-specific (Sikkim, NH-10) and none is admitted as a threshold or weight | PROVEN_BY_RUNTIME · RSL §K |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | Ledger owner records one decision for Copernicus DEM via Open-Meteo elevation and fixes the "SRTM via OpenTopoData" line | ADOPT_NOW | 1 | Primary data source without a consistent record [PROVEN_BY_SOURCE · RSL 0.3] |
| 2 | One shared outbound User-Agent constant carrying the public repository URL (six modules today) | ADOPT_NOW | 2 | MET Norway warns that clients it cannot contact risk being blocked without warning [PROVEN_BY_WEB · RSL 0.5] |
| 3 | MET Norway caching with `If-Modified-Since`, together with a weather cache | ROADMAP | 8 | Weather answers are not cached today [PROVEN_BY_SOURCE · SLF L-3] |
| 4 | Official district directory from LGD (a person downloads it and solves any CAPTCHA); USGS earthquake and FIRMS fire context layers | ROADMAP | 9 | Unblocks PS-08 and adds context layers [PROVEN_BY_WEB · RSL "What this unlocks"] |
| 5 | Reclassify GSI Bhusanket from web evidence alone; use academic thresholds as RASTA weights | REJECT | - | No licence text and no API were found for Bhusanket [PROVEN_BY_WEB · RSL 0.7] |

**Risks**

1. WebFetch returns a model summary, so quoted terms were not diffed byte for byte [PROVEN_BY_SOURCE · RSL Method].
2. Whether a ministry or operator deployment counts as non-commercial for Open-Meteo and OSRM is unknown [NOT_VERIFIED · SLF L-3].
3. MDoNER, data.gov.in, Census and Bhukosh pages could not be read [BLOCKED · RSL Index].

**What not to do**

- Do not claim official NE landslide forecasts, live road closures, road water depth, mobile coverage along a route, integrated rail/air/water freight, earthquake or fire layers, or a district count.
- Do not use Bright Data or any bypass for pages that return 403.
- Do not state the Bhuvan/CartoDEM status until the two ledgers agree.

---

## 8. DESIGN

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | Manager status pills: `#087F5B` on `#DFEFE4` at 11px measure 4.19:1, below AA 4.5:1; the driver app already uses `#076C4D` (5.40:1) | PROVEN_BY_RUNTIME · DPC §3.2 |
| 2 | `ErrorState` detail text measures 4.32:1 | PROVEN_BY_RUNTIME · DPC §3.2 |
| 3 | The route-blue focus ring on the dark rail measures 2.44-3.11:1, below the 3:1 non-text bar; `#93B4FF` measures 6.14-7.81:1 | PROVEN_BY_RUNTIME · DPC §3.3 |
| 4 | 96 manager `text-[9-11px]` sites and 48 driver font sizes of 9-11 | PROVEN_BY_RUNTIME · DPC §3.4 |
| 5 | Map code bypasses tokens; Hotel POIs are drawn in route blue, breaking "blue means route or focus" | PROVEN_BY_SOURCE · DPC §3.6 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | A7: `--color-ok: #076C4D` (K13 shows it is still `#087F5B`) plus a manager token contrast test copied from `driver-app/src/theme.contrast.test.ts` | ADOPT_NOW | 5 | Below AA [PROVEN_BY_RUNTIME · DPC A7] |
| 2 | A8 drop `/80` on ErrorState detail; A10 `.app-rail :focus-visible { outline-color: #93B4FF }` | ADOPT_NOW | 5 | Below AA and below 3:1 [PROVEN_BY_RUNTIME · DPC A8, A10] |
| 3 | R3 text floor 12px (console) and 13px (driver); R1 map colours from tokens | ROADMAP | 5, 6 | 96 manager and 48 driver sites would change [PROVEN_BY_RUNTIME · DPC §3.4] |
| 4 | R2 retone the brand mark to forest | ROADMAP | 10 | The mark still uses the pre-redesign charcoal field and blue stroke [PROVEN_BY_SOURCE · DPC §3.6 (`brand/mark.svg:2-3`)] |
| 5 | Blue-primary or HUD palettes, moving off forest and cream, and generating variants with Superdesign | REJECT | - | The product reserves blue for route and focus [PROVEN_BY_SOURCE · DPC X1 (`manager-web/src/index.css:14-20`)] |

**Risks**

1. Token changes on map layers need visual re-certification of 2D, terrain and 3D [INFERRED · DPC R1].
2. The four driver Day-palette screenshots are byte-identical, so Day mode on three tabs has no visual evidence [PROVEN_BY_RUNTIME · DPC §3.4].
3. The redesign is in the working tree only; hosted shows the old palette until plan commits 8 and 14 land [PROVEN_BY_SOURCE · docs/POST_DEMO_CHANGE_INVENTORY.md §4].

**What not to do**

- Do not fix contrast by changing what a hue means; change lightness within the hue.
- Do not re-tone away from the reference images.
- Do not copy mockup numbers ("120+ Districts", "+12%", "Route Status: Safe") into the product.

---

## 9. UX

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | Driver hazard-alert buttons are 40px and "Find a place to stop" is 32px with no `hitSlop`, below the app's own `TOUCH_TARGET` of 52 | PROVEN_BY_SOURCE · DPC §3.3 |
| 2 | The driver is told "Your manager has been alerted" when no inbox row was written (E4) | PROVEN_BY_RUNTIME · ENG E4 |
| 3 | Error copy shows system words ("backend", "API", "server-side", "rows") and vague titles ("Something went wrong", "Conflict") | PROVEN_BY_SOURCE · DPC §3.5 |
| 4 | No user research exists: `docs/ux-discovery/` is absent, so personas, journeys and jobs are INFERRED | PROVEN_BY_RUNTIME · DPC §2.3 |
| 5 | With `ROUTING_PRIMARY_URL` set, a redirect can outlast the console's 15 s timeout, and a retry then triggers E2 | INFERRED · ENG E12 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | A9: `minHeight: TOUCH_TARGET` or `hitSlop` on the stop link and hazard-alert actions first | ADOPT_NOW | 6 | Safety actions below target size [PROVEN_BY_SOURCE · DPC A9] |
| 2 | Honest stop-request acknowledgement (part of engineering action 1) | ADOPT_NOW | 6 | See finding 2 [PROVEN_BY_RUNTIME · ENG E4] |
| 3 | A11: rewrite system-word errors in user terms in both apps | ADOPT_NOW | 5, 6 | Error text names "backend", "API" and "rows" [PROVEN_BY_SOURCE · DPC A11] |
| 4 | R8: re-capture the Day palette on all four driver tabs and one capture at the largest system font, inside the certification pass | ADOPT_NOW | 7 | The four Day-palette captures are byte-identical [PROVEN_BY_RUNTIME · DPC §3.4] |
| 5 | Client-side product analytics and invented JTBD importance scores | REJECT | - | No interviews exist: `docs/ux-discovery/` is absent [PROVEN_BY_RUNTIME · DPC §2.3] |

ROADMAP: walk both journeys with one real dispatcher and one real driver; pass the 27 literal driver `accessibilityLabel`s through `t()`.

**Risks**

1. Translations in hi, gu, as and bn are drafts not reviewed by native speakers [PROVEN_BY_SOURCE · TRACE PS-12].
2. The Hindi login subtitle may read as "safe" rather than "safer" [INFERRED · DPC A4].
3. Journey stages are derived from documents, not from users [INFERRED · DPC §2.4].

**What not to do**

- Do not show raw server error text to drivers.
- Do not treat INFERRED personas or journeys as research findings.
- Do not promise an action in safety copy unless a row proves it happened.

---

## 10. AI/ML

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | No trained model makes a routing decision in production; the LLM only words answers and translations | PROVEN_BY_SOURCE · TRACE PS-18 (`backend/app/domain/intelligence_inventory.py:27`) |
| 2 | The Gemini key is in the URL in both the backend and the Supabase edge function (NEW-01 / S-1) | PROVEN_BY_SOURCE · SLF S-1 |
| 3 | Driver free text and up to 2,000 characters of client context go to Gemini and to OpenRouter `:free` models; Google's unpaid terms allow human review and say not to submit personal information | PROVEN_BY_WEB · SLF P-4 |
| 4 | "AI-based" alternate routes (PS-03) are not met: the comparison is a published rule | PROVEN_BY_SOURCE · TRACE PS-03 (`route_recommendation.py:6`) |
| 5 | The deterministic decision card is labelled "PERSONAL ROUTE AI" (K13); the AI rate limiter lives in process memory and resets on restart | PROVEN_BY_SOURCE · CTO K13 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | NEW-01 fix (security action 1) | ADOPT_NOW | 2 | Credential exposure [PROVEN_BY_TEST · SAP §7] |
| 2 | Driver assistant line "Do not type names, phone numbers or ID numbers here."; rename the card to "ROUTE DECISION" through `t()` | ADOPT_NOW | 2, 6 | Google's unpaid terms allow human review of API input [PROVEN_BY_WEB · SLF P-4] |
| 3 | Judge narrative and speaker notes: rule-based engines, cite the intelligence inventory and the rejected experimental model; no prediction claims | ADOPT_NOW | 1 | "AI" is the first word of the title and will be probed [INFERRED · TRACE PS-18] |
| 4 | Data-processing terms with AI providers | ROADMAP | 2 | DPDP processor duties [NOT_VERIFIED · SLF §5] |
| 5 | Training or deploying a landslide model, or using academic thresholds as weights, now | REJECT | - | The returned thresholds were fitted to Sikkim and NH-10 sites [PROVEN_BY_RUNTIME · RSL §K] |

**Risks**

1. The key may already sit in Render log retention [INFERRED · SLF S-1].
2. Whether the hosted Gemini key is on a paid tier, and OpenRouter's training setting, are unknown [NOT_VERIFIED · SLF P-4].
3. Judges may read "AI-based" in the title as a promise the product does not make [INFERRED · TRACE §6].

**What not to do**

- Do not say "AI predicts", "AI-based routing" or "the AI decided the route".
- Do not let the LLM decide or approve a route.
- Do not send personal data to free-tier providers.

---

## 11. PERFORMANCE

The scale-capacity lane is PARKED (section 16). Its measurements exist in its evidence directory but are
not relied on here; the findings below rest on source re-checks.

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | The hosted API is one uvicorn worker (K9) on a Render free instance | PROVEN_BY_SOURCE · CTO K9 |
| 2 | Argon2 `verify_password` runs synchronously inside the async login (K7), so concurrent logins can stall other requests on the one process | PROVEN_BY_SOURCE · CTO K7 |
| 3 | Presence and dashboard compute each driver's latest fix over every GPS point of every trip, with no time bound (K8); both endpoints are local only and arrive with commit 32 | PROVEN_BY_SOURCE · CTO K8 |
| 4 | Pushes with an 8 s timeout run inside the request transaction and under the trip lock (E3), so slow pushes could hold a pool of 3+2 connections | INFERRED · ENG E3 |
| 5 | Whether the 0.1 CPU free instance carries the Tier-A estimate is unresolved; the parked lane's own estimate straddles it | NOT_VERIFIED · SCP §1 item 3 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | Push after commit (engineering action 3) | ADOPT_NOW | 1, 8 | Also a correctness fix [PROVEN_BY_RUNTIME · ENG E3] |
| 2 | Bound the presence and dashboard latest-fix query (per-driver LATERAL lookup, open trips only) before commit 32 lands | ADOPT_NOW | 1, 8 | The query has no time bound [PROVEN_BY_SOURCE · CTO K8] |
| 3 | Argon2 in `asyncio.to_thread` behind a small semaphore; GPS batching in the driver app; `trips (created_at DESC, id DESC)` index; re-measure each with a lane-compliant harness | ROADMAP | 8 | Source-proven causes; measured effect not accepted here [PROVEN_BY_SOURCE · CTO K7] |
| 4 | More than one API process only after limiter, leader-loop and simulation state leave process memory | ROADMAP | 8 | Limiter, route-watch and simulation state live in process memory [PROVEN_BY_SOURCE · SCP §10.1 row 3] |
| 5 | Redis, a message broker or read replicas now | REJECT | - | No measured need was accepted [INFERRED] |

**Risks**

1. The free plan spins down when idle and may restart at any time [PROVEN_BY_WEB · SCP §4 row 1a (parked lane)].
2. Hosted backup and PITR are unconfirmed, so RPO and RTO are unbounded [PROVEN_BY_SOURCE · SCP §10.2 (`docs/MIGRATION_0013_DEPLOYMENT_PACKET.md:181-193`)].
3. In-process state (rate limits, route watch, simulation, provider health) vanishes on restart [PROVEN_BY_SOURCE · SCP §10.1].

**What not to do**

- Do not load-test any hosted URL.
- Do not claim "horizontally scalable", "stateless API" or any user count.
- Do not raise `--workers` before the in-process state moves out.

---

## 12. LEGAL

Not legal advice. The legal lane's plugin supplied a scoring framework only; the findings are that
lane's analysis.

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | `docs/SECURITY.md` describes a consent record, a scheduled retention job and driver export/deletion that the code does not implement; the same text is on `e4043ce` | PROVEN_BY_SOURCE · SLF P-1 |
| 2 | No retention job, export or erasure path, consent record or DPIA exists; the DPDP Act's full provisions commence on 13 May 2027 according to the summary the lane read | PROVEN_BY_WEB · SLF §5 |
| 3 | Aadhaar and PAN document numbers are stored in full and masked only on read | PROVEN_BY_SOURCE · SLF P-3 |
| 4 | Open-Meteo's free API is non-commercial with a 10,000-calls-per-day limit; the OSRM demo server is reasonable non-commercial use at 1 request per second | PROVEN_BY_WEB · SLF L-2, L-3 |
| 5 | No third-party notices file or licences screen; `driver-app/LICENSE` is Expo's template; no root licence | PROVEN_BY_SOURCE · SLF L-8, L-9 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | Mark the three `SECURITY.md` statements "planned, not implemented" or move them to Known Gaps | ADOPT_NOW | 2 | A reader should not learn this from the code [PROVEN_BY_SOURCE · SLF P-1] |
| 2 | Attribution fixes (geospatial action 1) | ADOPT_NOW | 5 | ODbL and CC BY credit duties [PROVEN_BY_WEB · SLF L-5] |
| 3 | Before real drivers: retention job, export and erasure path, versioned privacy notice, DPIA; store only the last four characters of ID numbers | ROADMAP | 2 | No retention, erasure or consent code exists [PROVEN_BY_SOURCE · SLF P-2] |
| 4 | Notices file generated from `node_modules/*/package.json`; licence-file decision | ROADMAP | 1 | MIT notice duty [PROVEN_BY_SOURCE · SLF L-8] |
| 5 | Bright Data or any bypass of government 403 pages; Aadhaar authentication | REJECT | - | Policy; authentication would create requesting-entity duties [INFERRED · SLF P-3] |

**Risks**

1. Whether drivers fall under the DPDP "employment" legitimate use is unknown [NOT_VERIFIED · SLF §5].
2. The API runs in Render's Singapore region while older PDFs say "data stays in India" [PROVEN_BY_SOURCE · SLF §5 (`render.yaml:36`)].
3. Production use of the free Open-Meteo and OSRM services may breach their terms [NOT_VERIFIED · SLF L-3].

**What not to do**

- Do not call any of this legal advice.
- Do not write "according to the legal plugin" about a finding.
- Do not store full Aadhaar or PAN numbers in new code.

---

## 13. PRODUCT

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | PS-07 (field officials upload geo-tagged reports and photos) is NOT_BUILT; the six upload kinds include no incident report | PROVEN_BY_SOURCE · TRACE PS-07 (`backend/app/api/files.py:54`) |
| 2 | PS-08 (connectivity by district) is NOT_BUILT; the local dashboard counts trips and districts are deliberately unseeded | PROVEN_BY_TEST · TRACE PS-08 |
| 3 | A simulated ROAD_INCIDENT raises the band LOW to HIGH but eligibility stays REQUIRES_REVIEW; no closure input, live or simulated, reaches the refusal gate | PROVEN_BY_RUNTIME · TRACE run E |
| 4 | Shipment priority has existed since migration 0002, but the manager plan form never sends it and hardcodes `cargo_type: 'GENERAL'` | PROVEN_BY_SOURCE · NPE §1.3 (`manager-web/src/pages/TripsPage.tsx:357-376`) |
| 5 | The official SIH page lists the theme as Transportation & Logistics; the repository says Smart Automation | PROVEN_BY_WEB · TRACE §1.3 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | Demo scripts and speaker notes never say a simulated closed road is refused | ADOPT_NOW | 1 | It would be false in front of judges [PROVEN_BY_RUNTIME · TRACE run E] |
| 2 | A0: priority and a fixed cargo-category list in the plan form, no migration, after plan commit 10 (the driver gate is green again, K1) | ADOPT_NOW | 5 | The API already accepts `priority` [PROVEN_BY_SOURCE · NPE §1.3 (`backend/app/schemas/domain.py:248`)] |
| 3 | Step 0016 field reports (new FIELD_OFFICIAL role, review before evidence, a report can never open a road), R1 shipment status, PS-08 after a verified district source | ROADMAP | 9 | Named requirements; new trust boundary on a safety path [INFERRED · NPE step 0016] |
| 4 | If refusal must be demonstrated, the DEMO SIMULATION injects a labelled synthetic CRITICAL landslide assessment | ROADMAP | 10 | A product decision and a code change outside the current plan [INFERRED · product-constitution lane summary] |
| 5 | Rename trucks to vehicles; multi-carrier tenancy; road-air handover; live tracking of trains, aircraft or vessels | REJECT | - | A rename would touch at least 1,465 source references [PROVEN_BY_RUNTIME · NPE G12] |

**Risks**

1. The largest judge-facing gaps are PS-07 and PS-08, both NOT_BUILT [INFERRED · TRACE §6].
2. TRACE §5 lists the fuel model as a working engine although no service calls it (X6) [PROVEN_BY_SOURCE · CTO K14].
3. Several features trace to no requirement (health mode, roadside places, 3D) and could crowd out PS gaps [INFERRED · TRACE §5].

**What not to do**

- Do not claim district connectivity status, field reporting, AI-based routing or a refused simulated road.
- Do not start 0015-0018 before hosted 0013 and the 0014 renumber.
- Do not let priority, class or hub values relax a route safety decision.

---

## 14. BRAND

**Findings**

| # | Finding | Label |
|---|---|---|
| 1 | The driver sign-in footer says "Safe Routes. Stronger India." (K13), against UNKNOWN is not SAFE and the prompt policy at `backend/app/domain/ai_prompts.py:45-46` | PROVEN_BY_SOURCE · CTO K13 |
| 2 | The manager sign-in carries "Smarter logistics", "Safer routes" and "Real-time intelligence" (K13) | PROVEN_BY_SOURCE · CTO K13 |
| 3 | The "Verified districts" stat counts DEMO rows, because operational sources include DEMO | PROVEN_BY_SOURCE · DPC A6 (`backend/app/models/geography.py:110`) |
| 4 | Submission PDFs claim live GSI/IMD/NHAI integration, fuel and CO2 per corridor, `react-native-maps`, vector tiles, "data stays in India" and 12/12 on APK 1.0.18; the code and the team's own ledger do not support these | PROVEN_BY_SOURCE · PDF §4 (parked lane; GSI and closures corroborated by TRACE PS-02, Singapore by SLF §5, fuel by CTO K14) |
| 5 | The product name appears in at least five variants in the UI | PROVEN_BY_SOURCE · BCG §8 V12 |

**Actions**

| # | Action | Decision | Priority | Why |
|---|---|---|---|---|
| 1 | A3-A6: one plain line on the manager sign-in, no gold accent; new driver `login_subtitle` (retranslate); "ROUTE DECISION" label; relabel or re-count "Verified districts" | ADOPT_NOW | 5, 6 | Unproven safety and verification claims on screen [PROVEN_BY_SOURCE · CTO K13] |
| 2 | A13: banned-phrase list in the existing `driver-app/src/themeWording.test.ts`, and a matching manager test | ADOPT_NOW | 1 | The existing driver test already scans user-facing literals [PROVEN_BY_SOURCE · DPC A13] |
| 3 | A12: `noindex`, a factual description and `theme-color` in `manager-web/index.html` | ADOPT_NOW | 5 | `index.html` has no robots, description or theme-color tag [PROVEN_BY_SOURCE · DPC A12] |
| 4 | One product name; brand-mark retone | ROADMAP | 10 | User decisions [PROVEN_BY_SOURCE · DPC §7] |
| 5 | Sitemap, JSON-LD or other indexation work | REJECT | - | Serves no user of a sign-in page [INFERRED · DPC X3] |

The motto removal (A2) waits for the user's yes (section 16.4). New material must not reuse PDF claims
C1-C15; use the D20 and R7 wording that the PDF matrix names.

**Risks**

1. Public PDFs on `origin/main` keep the unsupported claims until the user decides to annotate or replace them [PROVEN_BY_SOURCE · PDF §6].
2. The team identity used in submissions is unconfirmed [NOT_VERIFIED · PDF X1].
3. Hindi drafts may strengthen "safer" to "safe" [INFERRED · DPC A4].

**What not to do**

- Do not add "safe", "safer", "real-time", "live traffic", "predictive" or "AI predicts" anywhere.
- Do not copy any Team ID value between documents until the user confirms it.
- Do not call demo districts verified.

---

## 15. Plugin status

Statuses are those the lanes evidenced. Where a CTO re-check exists it is noted.

| Plugin | Skill or server | Status | Lane | Evidence |
|---|---|---|---|---|
| qodo | qodo-review, qodo-codebase-wisdom | UNAVAILABLE | plugins-engineering-data | PROVEN_BY_RUNTIME · CTO K16 (CLI absent) |
| engineering | code-review, tech-debt, architecture, testing-strategy | USED_AND_USEFUL (checklists applied by hand) | plugins-engineering-data | PROVEN_BY_RUNTIME · ENG §2 (E1-E4 proofs; `proof_out.txt` exists, K18) |
| engineering | github, linear, asana, datadog, pagerduty connectors | NEEDS_USER_AUTH | plugins-engineering-data | PROVEN_BY_RUNTIME · CTO K19 |
| data | explore-data, validate-data | USED_AND_USEFUL | plugins-engineering-data | PROVEN_BY_RUNTIME · DATA §2 |
| data | bigquery, hex, amplitude, definite connectors | NEEDS_USER_AUTH; not relevant to any task (X11) | plugins-engineering-data | PROVEN_BY_RUNTIME · CTO K19 |
| legal | legal-risk-assessment | USED_AND_USEFUL (framework only) | plugins-security-legal | PROVEN_BY_RUNTIME · SLF §1.1 |
| brightdata | all skills | REJECTED_BY_POLICY | plugins-security-legal | PROVEN_BY_RUNTIME · SLF §1.3 (token variables unset) |
| bio-research | consensus search | USED_NO_ACTION (9 abstracts, RESEARCH_ONLY) | research-ner | PROVEN_BY_RUNTIME · RSL §K (the gate reviewer re-ran the queries) |
| pdf-viewer | list_pdfs | BLOCKED (`allowedDirectories: []`) | plugins-geo-docs (parked) | PROVEN_BY_RUNTIME · GEO §1.5 |
| mapbox | mapbox-token-security | USED_AND_USEFUL | plugins-security-legal | PROVEN_BY_RUNTIME · SLF §1.2 |
| mapbox | maplibre-migration, web-performance, navigation, cartography (SKILL.md read, not invoked) | USED_AND_USEFUL | plugins-geo-docs (parked) | PROVEN_BY_SOURCE · GEO §1.1 |
| mapbox | docs MCP | USED_AND_USEFUL | plugins-geo-docs (parked) | PROVEN_BY_WEB · GEO §1.2 (`mbx_docs.txt` exists, K18) |
| mapbox | account and devkit MCP | NEEDS_USER_AUTH | plugins-geo-docs (parked) | PROVEN_BY_RUNTIME · CTO K19 |
| figma | whoami | USED_NO_ACTION (authenticated, View seat) | plugins-design-brand | PROVEN_BY_RUNTIME · DPC §2.9 |
| ui-ux-pro-max | ui-ux-pro-max (`scripts/search.py`, 5 queries) | USED_AND_USEFUL | plugins-design-brand | PROVEN_BY_RUNTIME · DPC §2.1 (`uiux_search.txt` exists, K18) |
| frontend-design | frontend-design | USED_AND_USEFUL (rules applied by hand) | plugins-design-brand | PROVEN_BY_SOURCE · DPC §2.2 |
| superdesign | superdesign 0.6.0 | REJECTED_BY_POLICY (credits, npx CLI) | plugins-design-brand | PROVEN_BY_RUNTIME · DPC §2.10 |
| ux-superpowers | ux-validate, user-journey | USED_AND_USEFUL (outputs INFERRED; ux-validate ran without its discovery document) | plugins-design-brand | PROVEN_BY_RUNTIME · DPC §2.3-2.4 |
| ux-superpowers | jobs-to-be-done | USED_NO_ACTION | plugins-design-brand | INFERRED · DPC §2.5 |
| ponytail | ponytail-audit | USED_AND_USEFUL | plugins-engineering-data | PROVEN_BY_SOURCE · ENG §7 |
| brand-voice | discover-brand | BLOCKED (connectors need auth) | plugins-design-brand | PROVEN_BY_RUNTIME · BCG §0 |
| brand-voice | brand-voice-enforcement | USED_AND_USEFUL (applied by hand) | plugins-design-brand | PROVEN_BY_SOURCE · BCG §0 |
| searchfit-seo | technical-seo | USED_AND_USEFUL | plugins-design-brand | PROVEN_BY_SOURCE · DPC §2.8 |
| zoom | zoom-mcp, zoom-docs-mcp, zoom-whiteboard-mcp | BLOCKED (HTTP 401); NOT_RELEVANT | plugins-security-legal | PROVEN_BY_RUNTIME · CTO K19 |
| unity | unity-cli (read), optimize-web (grep only) | USED_NO_ACTION (REJECT) | plugins-geo-docs (parked) | PROVEN_BY_RUNTIME · CTO K16 (CLI absent) |

**UNPROVEN plugin claims: 0.** No lane attributed a finding to a plugin's own output without evidence.
Every lane that applied a checklist by hand (engineering, legal, frontend-design, brand-voice,
ux-superpowers, ponytail, searchfit-seo, mapbox skills) says so in its own document, and no finding is
written as "according to" a plugin. Evidence-quality notes, none of which is an unproven claim:

1. The Mapbox performance, migration, navigation and cartography skills were read as files, not invoked [PROVEN_BY_SOURCE · GEO §1.1].
2. `ux-validate` ran without the `docs/ux-discovery/` document its own trigger requires, on a proxy; its outputs are INFERRED [PROVEN_BY_SOURCE · DPC §2.3].
3. The pdf-viewer, Mapbox docs and Unity statuses come from a lane that broke a hard rule (section 16) [PROVEN_BY_RUNTIME · CTO K17].
4. Plugin sub-components that no lane touched (for example the legal document connectors, the other bio-research servers) have no lane status and are not listed.

---

## 16. CEO decisions

### 16.1 Constraints this CEO cannot override

| Constraint | Item | Effect |
|---|---|---|
| P1 security | NEW-01 Gemini key in logs (hosted and local) | Fix is ADOPT_NOW; rotation is the user's step after deploy |
| P1 security | NEW-02 scoped managers fleet-wide | Blocks any hosted 0013 deploy until fixed |
| P1 privacy | C1-01 images, plus the same number as a placeholder on `e4043ce` (K3) | Blocks any further public push until the user decides |
| P1 core workflow | E4 stop request reaches no manager while the driver is told it did | Blocks plan commit 32 until fixed |
| Refuted claims | TRACE C4, C6; SAP C21; RSL C4; NPE X2; SCP C1-C4 | Those lanes cannot be ACCEPT; the corrected text still needs a re-gate |
| Missing backup | Hosted Supabase backup and PITR unconfirmed; RTO never timed [PROVEN_BY_SOURCE · SCP §10.2] | No hosted migration until the user confirms a backup |
| Unverified facts | Hosted RLS, MapTiler restriction, Gemini tier, Render env for `SENTINEL_SCHEDULER_ENABLED`, portal theme, Team ID | Stay NOT_VERIFIED; none is stated as fact anywhere in this document |

### 16.2 Lane decisions

| Lane | Decision | Why |
|---|---|---|
| product-constitution | REWORK | Gate FAILED with C4 and C6 REFUTED. CTO spot-check: PS-10 and PS-06 now say no closure input reaches the gate, and PS-07 lists all six upload kinds. Remaining: re-gate; update run C (green at 20:01, K1); correct the fuel-model row (X6) |
| security-assurance | REWORK | Gate FAILED with C21 REFUTED; §4 now lists `DUMP` as a guard only. Remaining: re-gate. Its three P1s bind regardless of the lane decision |
| research-ner | REWORK | Gate FAILED with C4 REFUTED; §0.5 and O2 now use the terms' "should". Remaining: re-gate |
| platform-expansion | REWORK | Gate FAILED with X2 REFUTED; step 0016 now separates source from design choice. Remaining: re-gate; replace "driver gate red" in §1.2, §4.2, §8 with the 20:01 result |
| scale-capacity | PARK | Gate FAILED, four claims REFUTED, and two hard-rule breaches: files outside the owned scope inside the repository tree, including a JWT secret, tokens and 300 synthetic full 10-digit phone numbers (K17). The lane failed. Unpark only after those files are deleted (user decision), a re-gate passes, and any re-measurement uses a harness that writes nothing inside the repository |
| plugins-engineering-data | ACCEPT | No gate recorded and no rule breach; CTO re-checks K5 and K6 agree with E5 and E1; only defect is the connector-status wording (X11) |
| plugins-security-legal | REWORK | L-4 repeats the MET Norway "requires" wording that the research gate refuted by re-fetch (X3); L-5 needs to reference the tile-policy reading (X4). S-1, P-1 and P-4 stand and are adopted |
| plugins-design-brand | ACCEPT | CTO re-check K13 confirms A2-A7 still hold; A1 is superseded in the working tree (K2) and open on `e4043ce` (K3) |
| plugins-geo-docs | PARK | Self-reported hard-rule breach: `npx jest` downloaded Jest into the user npm cache (K17). The lane failed. Its findings enter this synthesis only where an accepted lane or a CTO re-check backs them (K10-K12, K14, X4, X5) |

### 16.3 ADOPT_NOW queue, in landing order

| Order | Item | Priority | Lands |
|---|---|---|---|
| 1 | NEW-01 header and httpx level (backend and edge function) | 2 | Standalone, ahead of commit 1 |
| 2 | E1 truck lock, E2 request id, E3 push after commit, each with its test | 1 | Any trips-touching commit; 0012-compatible |
| 3 | D1(a,b), D2 allowlist, D3 comments | 1 | Before commit 6 |
| 4 | NEW-03 limiter, NEW-04 commit, NEW-04b | 2 | With commit 31 or earlier |
| 5 | C1-06 `ShipmentRead`; migration 0013 committed | 3 | Before and as commit 25 |
| 6 | NEW-02 permission cut, then `driver_scope_clause`; E6, E7 | 4 | Commits 26-30 |
| 7 | E4 + E5, G6 phone copy, presence/dashboard bound, NEW-19 | 1, 2, 6 | Before commit 32 lands |
| 8 | G3 scripts guard test; A13 banned-phrase tests | 1 | Any tooling commit |
| 9 | Manager: attribution, search on submit, A3, A6, A7, A8, A10, A11, A12, A0 | 5 | After commits 8-10 and 34 |
| 10 | Driver: A9 targets, A4 subtitle, A5 label, assistant privacy line | 6 | With commit 14 or the next APK |
| 11 | Docs: SECURITY.md "planned" lines, Copernicus ledger decision, demo script, judge narrative, shared User-Agent | 1, 2 | Docs commits |
| 12 | Certification: Day-palette re-capture (R8) | 7 | Certification pass |

### 16.4 Decisions that belong to the user

1. C1-01: masked copies of the evidence images or a changed demo login identifier, and whether to rewrite history (force push). The `e4043ce` placeholder (K3) is part of the same decision.
2. Rotate `GEMINI_API_KEY` after the NEW-01 fix is deployed; confirm the Gemini billing tier and set OpenRouter to exclude training providers.
3. Confirm hosted Supabase backup and PITR, and time one restore, before any hosted migration (0013 included).
4. Hosted 0013 migration timing, after NEW-02 is fixed; hosted cleanup of the deactivated fixture users.
5. Paid services: always-on API instance, Supabase Pro and PITR, self-hosted routing and tiles.
6. Delete the rule-breach residue: `.runtime/perf/` (including its three `*.private.*` files), the three `*.private.*` files in `scratchpad/company2/scale-capacity-review/`, and `npm-cache/_npx/b8d86e6551a4f492`.
7. MapTiler dashboard: check the key restriction and set a usage alert; confirm the plan (logo requirement).
8. Registered team identity and Team ID, and the portal theme (Transportation & Logistics or Smart Automation).
9. Approval of an official district source (LGD download by a person).
10. Motto removal (A2), one product name, the brand-mark palette, the licence file, and whether to annotate or replace the public PDFs.
11. Whether Qodo may be installed and given the post-demo diff; whether Superdesign credits may be spent; whether Mapbox MCPs should be authorised for an evaluation spike.
12. Lawyer review of P-2, P-3, P-4 and L-3 before a real-driver pilot or a government deployment.

### 16.5 Next five steps

1. Land NEW-01 as a standalone 0012-compatible commit with its red-first test; the user then rotates the key.
2. Land E1, E2 and E3 with the four tests from ENG §6 against `ner_logistics_test` only, before the trips-touching plan commits.
3. Before plan commits 25-32 land: NEW-02 permission cut, E4 and E5, G6, the bounded presence/dashboard query, C1-06 and NEW-19, each red first.
4. Re-gate TRACE, SAP, RSL and NPE with the listed updates, and rework SLF L-4 and L-5.
5. The user decides items 1, 3 and 6 of section 16.4; until item 3 is done, no hosted migration.
