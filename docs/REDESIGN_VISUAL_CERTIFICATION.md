# RASTA AI: Redesign visual certification

**Date** 28–29 September 2026 (final state: re-certification, audit 2, the final fix round, fix round 3, the final verification, audit 3, then fix round 4) · **Scope** Manager web (16 screens) and driver app (11 screens), in Light and Dark, measured against the seven reference images · **Replaces** the first certification of 28 Sep (verdict PARTIAL), this document's re-certification text of 15:45 IST, its final-fix-round text of 18:25 IST and its final-verification text of 22:36 IST (all kept in §11 and §12 as history), and `docs/REDESIGN_CERTIFICATION.md` (20 Sep, pre-B2)

Times are IST on 28 Sep unless a date is given. Nothing here was deployed, committed or pushed. The hosted site still runs the older build. Every number below comes from an evidence file under `.runtime/redesign/` (gitignored). Paths are relative to that folder unless they start with `docs/`, `manager-web/`, `driver-app/` or `backend/`, or with `scratchpad/`, which is the orchestrating session's scratch folder (`C:/Users/patel/AppData/Local/Temp/claude/D--Projects-ner-ai-logistics/2f919799-51fd-4107-9011-42ec4e7339f3/scratchpad/`).

| Folder | What | When (IST) |
|---|---|---|
| `cert/` | First certification, cited only for before-and-after figures | 06:04–09:58 |
| `recert/<lane>/` | Re-certification lanes (perf, regression, driver, manager, e2e) | 12:50–15:36 |
| `recert/audit2/` | Second hostile audit (read-only on source) | 16:02–16:30 |
| `recert/final/` | Final fix round: fixes in manager-web and driver-app, live checks, one lifecycle trip | 16:31–18:25 |
| `recert/final/manager/avif/`, `scratchpad/drv09/`, `scratchpad/redesign_fix3.json` | Fix round 3: backend `proposed_reroute`, the manager's reroute attention, AVIF heroes, map colour tokens, Tailwind `source('.')`; driver attribution room, map palettes, maneuver wording and icons | about 18:30–19:05 |
| `final-verify/<lane>/` | Final verification on the round-3 code, cert API restarted on the round-3 backend: `experiment/` (PERF-3 early preload, reverted), `perf/` (four builds, one session), `regression/`, `manager/`, `driver/`, `e2e/` (lifecycle trip with a driver reroute and an SOS) | 19:07–22:32 |
| `scratchpad/audit3/` | Audit 3 (read-only on source): 50 claims checked, 9 refuted, 10 defects (A3-01..10), 12 document corrections | 22:58–23:18 |
| `final-fix/` | Fix round 4: fixes in manager-web and driver-app (backend untouched); `regression/` (full suites, builds, scans), `e2e/` (one lifecycle trip with a driver reroute seen in an already-open review, an SOS, and a draft cancelled under an open review) | 23:20 (28 Sep)–00:45 (29 Sep) |

---

## 1. Verdict, scope and method

### Verdict

```text
REDESIGN_CERTIFIED = YES (Chrome/web; physical Android pending)
Every condition of the verdict rule holds (table below). Physical Android stays BLOCKED: adb is not installed.
```

**What changed since the final verification.** Audit 3 (22:58–23:18 IST) checked 50 claims and refuted 9, all of them wording (§12). It confirmed FV-E2E-1 and added one finding: the stale review's enabled "Plan route" would post a plan for a cancelled trip, and the server does not refuse it (A3-01). Fix round 4 (23:20–00:45 IST, `final-fix/`) changed manager-web and driver-app only:
- **FV-E2E-1**: an open Trip Review now follows its polled row. It re-reads the trip when the row's status, selected route or driver's proposal changes, or when the row leaves the list. A row that says the trip ended hides "Plan route" at once. This also closes **A3-01's UI half**.
- **A3-02**: Trips says "Needs a route" for a moving trip with no road, as Overview does.
- **FV-E2E-3**: Fleet re-reads its snapshot after an approve or accept.
- **FV-E2E-2**: the driver sees "Reroute approved" on Navigate and Trip.
- **FV-DRV-01**: the "Then" line wraps below 420 dp.
- **FV-DRV-02**: a roundabout's own exit step is not told a second time.
- **RE2E-2**: the empty Trip page keeps "Trip complete" for 30 minutes after a delivery (tests only).
- **DEAD-1**: three unreferenced template images and two unused phrase keys are deleted.
- The FV-M-1 harness is fixed, and audit 3's 12 document corrections are applied.

It then ran a new browser lifecycle on that code, `TRP-82192454-4D98-4BD4` (§7). It included a driver reroute seen in a Trip Review that had been open since before the trip was planned, the SOS dossier walked in both themes, and a second draft cancelled under an open review. Results: manager **536/536** and driver **935/935** (each twice); both `tsc` clean; both builds pass. The backend is unchanged since the final verification's **1586 passed, 5 skipped**: all 115 changed backend files are hash-identical to its list.

**Before that (fix round 3 and the final verification).** Fix round 3 closed the backend half of E2E-R2 without a migration: `TripRead`, `TripDetail` and `FleetTripRead` now carry `proposed_reroute`, derived from audit rows and failing closed (`docs/API_CONTRACTS.md` §7), and the manager shows "Driver asked for a new road" in the warning tone on Trips, the trip review and Fleet, with a "Review new road" button that opens Fleet's Route tab. It also served the manager heroes as AVIF (18–26% fewer bytes, one download per page), moved the manager's marker and pin colours and every driver map hue into theme tokens (in Dark the LIVE marker and the driver's GPS marker are now the accent itself), cut the manager CSS by 6.9% (Tailwind `source('.')`), kept the Leaflet attribution clear under large text, and fixed the driver's maneuver wording and icons. The final verification then ran on that code, with the cert API restarted on the round-3 backend: one full lifecycle trip with a driver reroute and an SOS, the 462-cell manager matrix and 200% zoom, 739 driver captures, four production builds timed in one quiet session, and every suite. Manager **530/530** and driver **929/929** (each twice), backend **1586 passed, 5 skipped**, both `tsc` clean, both builds pass.

**The verdict rule, applied literally.** `YES (Chrome/web; physical Android pending)` needs all six conditions.

| # | Condition | Result | Evidence |
|---|---|---|---|
| (a) | No open P0 or P1 | **Met.** Audit 3 and fix round 4 found no P0 or P1, and neither did fix round 3 or the final verification. LAZY-1, the last P1, stays fixed | §11 |
| (b) | Every open P2 is an owner decision in §14 with its trade-off, or needs a physical device to measure or fix | **Met.** FV-E2E-1 is fixed and was seen live (§7). Two P2s stay open, and both are owner decisions with their trade-offs stated. **PERF-3** (§14 #2): the hero photo is the mobile LCP (+51.8% / +47.8%), and the lever that was tested costs FCP. **PERF-4** (§14 #3): pre-decoding the tab photos after sign-in spends memory and CPU on every phone to save a cost measured on the web (+21.1% / +31.5% / +20.8% on mobile); its fix needs no device, and an APK measurement is the follow-up, not the reason it qualifies. The rest of E2E-R2 (a trip event and a manager notification) is P3 here and in §11: the manager is now told, and what is missing is the record, the same class as E2E-R5; it waits for migration 0016 (§14 #1). A3-01's server half is P3 once no screen offers the action (§11) | §7, §11, §14 |
| (c) | Manager, driver and backend suites green; `tsc` clean; builds pass | **Met.** Manager 536/536 and driver 935/935, each twice; `tsc` exit 0 in both apps; `vite build --mode remote-demo` exit 0; `expo export --platform web` exit 0 (555 modules). No backend file changed in fix round 4 or since the final verification: all 115 changed backend files are hash-identical to its list. That code's last runs were 1586 passed, 5 skipped (the final verification's second run and audit 3's re-run). Disclosure: REG-T1 (P3, test data) can still fail a backend run by chance, as it did once in the final verification | `final-fix/regression/`, `final-verify/regression/` |
| (d) | Dark measures black on every UI surface in both apps; green is accent-only | **Met.** Every Dark page, card, rail, topbar, drawer and dialog is `#070808`, `#0E1110`, `#151918` or `#1B201E`. The driver's tab bar adds the neutrals `#121514` (shell) and `#232826` (shellActive). The other fills are semantic chips: danger, warning and neutral discs. Green comes only from the accent `#39D8A0`, its soft tints (REG-10, §14 #7) and the dimmed disabled primary `#207054` (§14 #6). Every Dark map hue is non-green except the accent LIVE/GPS marker. Audit 3 re-rendered 10 manager and 7 driver Dark screens and got the same result. The only colour use new in fix round 4 is the driver's "Reroute approved" banner: Dark `#131816` (the neutral `successSoft`) under accent text. The Region's forest photo is a photo, not a surface | §3 |
| (e) | The latest browser E2E lifecycle passed, including the driver-reroute attention and the SOS dossier checks | **Met.** On `TRP-82192454-4D98-4BD4` every step passed: plan, approve, dispatch, accept, start, pickup and drive; then the driver's off-route request. The attention showed on the Trips row (+3.67 s), in the Trip Review assam.sm had had open since before the plan (+3.72 s), and on the Fleet row and detail (+7.49 s). The manager approved the new road: Fleet cleared in 0.25 s and the open review in 3.19 s, and the driver saw "Reroute approved" and new guidance after 4.84 s. Then the SOS and the dossier: masked phone, focus in, 25 Tab and 25 Shift+Tab presses stayed inside, and Escape and the X each returned focus, in Dark and in Light. Then resolve, deliver and close. A second draft cancelled while its review was open read CANCELLED, with no "Plan route", after 3.19 s. Disclosure: the steps up to Close ran before the last two edits (the review's "row left the list" signal, then RE2E-2 on the driver). The cancel check ran on the final manager code. RE2E-2's fix is test-only | §7 |
| (f) | No fake data, Day/Night wording or uncredited photo found | **Met.** No mockup values and no Day/Night theme words, in source or in either new build; the 2 bundle matches are Metro dependency arrays, and the unused "Day"/"Night" phrase keys are deleted. 21 of 21 shipped photo files map to a credit and to one attribution row, and the attribution doc's tests pass after its edit. FV-E2E-1, the one stale-as-current finding, is fixed | §8, §10 |

"Physical Android pending" in the verdict means exactly that: nothing here was measured on a phone, and the physical-Android check stays BLOCKED (`adb` is not installed).

**Also open, P3 and below** (§11): the rest of E2E-R2 and E2E-R5 (Journey History has no record of the approval or of the driver's request; migration 0016); A3-01's server half (a direct API call can still plan a finished trip); FV-DRV-03 and the rest of the web-only CSS large-text class; RC-DRV-05; RC-DRV-08; FPERF-1, FPERF-2, FPERF-3 and PERF-6; REG-T1; FV-M-2 (the attribution toggle's ring metric, wording only); and unrevoked refresh tokens. HYG-R1 is recorded as accepted exceptions (§9).

**Dark.** Every Dark UI surface measures on the black tokens in both apps.
- **Manager:** non-photo luminance is 0.006–0.039 once the drawer and dialog states are included; they are the darkest (trucks dialog 0.0058, drivers drawer 0.0086, image credits 0.0102). `body`, `html` and `main` are `#070808` and the topbar `#0E1110`; the largest surfaces are `#070808`, `#0E1110`, `#151918` and `#1B201E`.
- **Driver:** every screen uses `#070808`, `#0E1110`, `#151918` and `#1B201E` (surfaceSoft), plus the neutral `#121514` (shell) and `#232826` (shellActive) of the tab bar. The other fills are documented semantic tokens: danger, warning, neutral discs and the disabled primary. Fix round 4's "Reroute approved" banner is `#131816`.

Green shows only as the accent and accent-derived items: the accent-soft KPI tiles (REG-10), the disabled Log In and Create draft trip (`#207054`), the Fleet LIVE marker (the accent itself since fix round 3; was `#34D399`) and the driver's live GPS disc, dot and truck arrow (the accent; was `#087F5B`). Not UI surfaces: the Region's lower half (the licensed Mawkdok forest photo under the neutral scrim: whole frame 7.08% green-hue with the AVIF, 6.31% with the WebP; non-photo 1.13%, unchanged) and the Login photo panel's hills.

**Counting.**
- **Re-certification:** §11 marks **42 rows** fixed. 2 are fixed "in code" only, 1 "on the device path" only, and E2E-D4 appears in two tables.
- **Final fix round:** 30 more fixed, and 3 in part.
- **Fix round 3:** changed 11 items. The final verification checked all 11: 8 were confirmed fully and 3 with named exceptions. E2E-R2's manager attention failed on an already-open review (FV-E2E-1), the E2E-R6 wording class kept FV-DRV-02, and PERF-3 stayed open. It also saw 2 earlier test-only fixes live for the first time (DOSSIER-1 and the dossier half of E2E-R1), and raised 15 new items: 1 P2 (FV-E2E-1) and 14 P3. 4 of the P3s are about the harness or this document (FV-M-1, FV-M-2, FPERF-DOC, REG-T1).
- **Fix round 4:** fixed 10 items and applied audit 3's 12 document corrections. The items are FV-E2E-1, A3-01's UI half, A3-02, FV-E2E-2, FV-E2E-3, FV-DRV-01, FV-DRV-02, RE2E-2, DEAD-1 and FV-M-1. 7 were seen live in the browser; RE2E-2 was checked in tests, DEAD-1 in the build and FV-M-1 in the harness source. It closed HYG-R1 as recorded exceptions. It raised no new defect. It reproduced RE2E-2 (P3) before fixing it (§11, "Fix round 4").

**Earlier verdicts** (history): the first run PARTIAL; the re-certification NO (LAZY-1, P1); the final fix round NO (open P2s E2E-R2 backend half, PERF-3, PERF-4); the final verification NO (conditions (b) and (e), on FV-E2E-1). Their reasons are in §11 and §15.

### Scope

- **Manager** (Chrome, 1600×900, DPR 1). Screens: Region, Login, Overview, Shell, Fleet, Trips, Trip review, Review, Assignments, Drivers, Trucks, States & districts, Managers, Reports, Notifications and Diagnostics. Roles: NORTH_EAST_MANAGER (`regional`), STATE_MANAGER (`assam.sm`) and DISTRICT_MANAGER (`kamrup.dm`). The E2E lane also checked the Meghalaya state manager and the East Khasi Hills and Nagaon district managers. The final verification used `regional` (manager, perf and experiment lanes, E2E), `assam.sm` and `cert.nagaon` (E2E, for scope), and the driver Tenzing Bhutia. Fix round 4 used `regional` and `assam.sm` (E2E) and the driver Tenzing Bhutia, one sign-in each.
- **Driver** (Expo web in Chrome, 450×800 CSS at DPR 2 = 900×1600, plus 360×640, 412×915, 480×1040 and 768×1024). Screens: Login, Navigate, Safety, More, Trip, Truck check, My Details, Assistant, Translator, Tutorial, and the manager shell inside the driver app (ManagerRoot).
- **Not in scope:** the hosted site, the native APK on a phone, and the ADMIN role (the cert DB has no ADMIN account).

### References

`.runtime/sources/redesign/redesgin/`, used as the visual target only and never as data:

| File | Target | Size |
|---|---|---|
| `manger1.jpeg` | Manager operational region | 1600×901 |
| `manger2.jpeg` | Manager login | 1600×901 |
| `manger3.jpeg` | Manager dashboard; also the system for every other manager page | 1600×900 |
| `driver1.jpeg` | Driver login | 900×1600 device px (450×800 CSS) |
| `driver2.jpeg` | Driver Navigate | 900×1600 |
| `driver3.jpeg` | Driver Safety | 900×1600 |
| `driver4.jpeg` | Driver More | 900×1600 |

### Method

- **History of this certification.**
  1. **First run** (06:04–09:58 IST, `cert/`). Six lanes; verdict PARTIAL. The cert API and driver web stopped answering at about 09:36 IST, so three manager checks never ran.
  2. **Audit 1** (from about 10:16 IST). 52 claims checked, 15 refuted, 14 defects (AUD-01..14) and 18 document corrections (§12).
  3. **Fix round 1.** Stopped part-way on a network failure; left uncommitted edits and no report.
  4. **Fix round 2** (to 12:45 IST). Verified round 1, finished the fixes, ran the full suites.
  5. **Stack restart** on the fixed backend.
  6. **Re-certification** (12:50–15:36 IST, `recert/`). Verdict NO (LAZY-1).
  7. **Audit 2** (16:02–16:30 IST, `recert/audit2/`). 94 claims checked, 11 refuted, LAZY-1 reproduced, 10 new defects (AUD2-01..10) and 17 document corrections; the perf lane's RPERF-DOC also asked for §6. All are dealt with in §12.
  8. **Final fix round** (16:31–18:25 IST, `recert/final/`). Fixes in manager-web and driver-app (backend untouched), live checks on the same stack, one full trip through the manager UI and the driver app, full suites, and this document.
  9. **Fix round 3** (about 18:30–19:05 IST; `scratchpad/redesign_fix3.json`). Three lanes: backend (`proposed_reroute`, 3 tests, no migration), manager-web (reroute attention, AVIF, REG-1 tokens, Tailwind `source('.')`) and driver-app (RC-DRV-09, REG-5, REG-6, maneuver wording and icons). The cert API was then restarted on the round-3 backend.
  10. **Final verification** (19:07–22:32 IST, `final-verify/`). Six lanes on the round-3 code: a PERF-3 experiment (it kept nothing), a four-build performance session, the regression suites, the manager and driver visual sweeps, and the browser E2E with a reroute and an SOS. No source file was changed; this document, `docs/API_CONTRACTS.md` and `docs/REDESIGN_IMAGE_ATTRIBUTION.md` were then updated from the evidence.
  11. **Audit 3** (22:58–23:18 IST, `scratchpad/audit3/`). 50 claims checked, 9 refuted (all wording), FV-E2E-1 confirmed three ways (code, shots, notes), 10 defects (A3-01..10) and 12 document corrections; it re-ran every suite and matched them. All are dealt with in §11 and §12.
  12. **Fix round 4** (23:20 on 28 Sep to 00:45 IST on 29 Sep, `final-fix/`). Fixes in manager-web and driver-app (backend untouched), the full suites twice, both builds, the source and bundle scans, one browser lifecycle trip through the manager UI and the driver web, and this document, `docs/API_CONTRACTS.md` and `docs/REDESIGN_IMAGE_ATTRIBUTION.md`.
- **Code state.** Working tree on `main` at `5b5e474` plus uncommitted changes. The re-certification measured the code as of 12:37 IST. The final round changed `manager-web/src` and `driver-app/src` (plus `driver-app/App.tsx`) between 16:31 and 18:15 IST; `backend/app` was not touched. Fix round 3 changed `backend/app` (schemas, trips service, trips API; no migration), `backend/tests`, `manager-web/src`, `manager-web/public/assets/redesign/` (8 AVIF files added) and `driver-app/src` plus `driver-app/App.tsx`. The final verification changed no source: the regression lane hashed all 497 modified and untracked files before and after (identical), the perf lane hashed 333 manager-web and driver-app source files (unchanged), and the experiment restored `manager-web/index.html` byte for byte (SHA-1 `0d087ac0…`, re-checked for this document). Figures from earlier lanes are labelled as such where a later round changed the code under them. Fix round 4 changed `manager-web/src` (`TripRouteReview.tsx`, `TripsPage.tsx`, `tripExport.ts`, `FleetPage.tsx` and their tests; `src/assets/` deleted) and `driver-app/src` (`map/maneuvers.ts`, `screens/MapScreen.tsx`, `screens/TripScreen.tsx`, `trip/TripProvider.tsx`, the new `trip/tripNotices.ts`, `i18n/phrases.ts` and tests). It kept each file's line endings (CRLF in `FleetPage.tsx`, `MapScreen.tsx`, `maneuvers.ts`, `API_CONTRACTS.md` and the attribution doc) and changed no backend file.
- **Stack.** API `http://127.0.0.1:8033` (DB `ner_logistics_cert`); manager `http://localhost:5176` (Vite dev server, hence the "DEV" badge); driver web `http://localhost:8124` (Metro dev bundle). The performance lanes measured production builds instead (§6). The orchestrator restarted the API once, after fix round 3, so that it served `proposed_reroute`; no lane restarted anything. Fix round 4 restarted nothing. The manager dev server hot-reloaded its edits; one of them reloaded both signed-in manager pages, which kept their sessions.
- **Harness.** Headless Chrome 153 over CDP.
  - Re-certification: the first run's scripts, copied into each `recert/<lane>/` (the manager crop fix and scripts s14–s23; the driver `ctx` helpers rebuilt in `steps/s02_define.js`; the perf lane's same-session controls).
  - Final verification (`final-verify/<lane>/`): each lane copied its earlier harness (`recert/final/bridge.mjs` for the E2E, on port 9641; `recert/manager/` on 9880/9881; `recert/driver/` with logout allowed; `recert/perf/` with one origin that switches build root between cold runs) and added probes: MutationObserver timestamp watchers (`rrwatch.js`, `soswatch.js`, `drvwatch.js`), `fleetpix.py` (green-pixel clustering on the map), `poll_reroute.sh` (read-only DB poll), `s24_green_map`, `s25_landmarks_pre`, `s26_dossier`, `s27_zoom_drawer`, the driver's `s30_mapcol` and `mnv.mjs` (maneuver wording run on a recorded real package), and the perf lane's `waterfall.mjs`, `themeprobe.mjs` and `pollprobe.mjs`.
  - Final round (`recert/final/`): the E2E lane's `bridge.mjs`, copied, on port 9631, with its Chrome profiles under `recert/final/profiles/` (kept across one bridge restart so no account signed in twice for that reason, then deleted). New probes: `lt.js` (large text: the driver lane's cut, mid-word and scaling definitions plus a whole-page cut and mid-word scan, and the Dimensions font-scale hook for the Android path), `large.sh`, `attr.js` (what covers the OSM attribution), `landmarks.js`, `lazy.sh`, `pix.py` (whole-frame colour statistics). Results transcribed from the harness output are in `recert/final/manager/checks.json` and `recert/final/driver/checks.json`.
  - Fix round 4 (`final-fix/e2e/`): the final verification's `bridge.mjs`, copied, on port 9651. It adds one change: the sign-in step can choose a state region. New probes: `rvwatch.js` (every change of an open Trip Review and its row), `fwatch.js` (the Fleet row and detail attention), `dwatch.js` (the driver's banner, card and chip), `thencheck.sh` (FV-DRV-01 at 360×640 on both paths) and `dossierwalk.sh` (focus in, 25 Tab and 25 Shift+Tab presses, Escape, the X).
- **Loop** (audit §13). Side-by-side and onion-skin PNGs; box measurements; pixel statistics with photos, canvas and maps masked (re-certification lanes) or whole-frame (final round, stated where used); text contrast measured against the real pixels under each text run.
- **GPS** was simulated only, with CDP `Emulation.setGeolocationOverride` along the selected Guwahati–Shillong route. Phones are masked to the last two digits in every capture and every file here.
- **Lanes, 28 Sep 2026 (IST).**

  | Lane | Time | Evidence | Sign-ins | Writes |
  |---|---|---|---|---|
  | Performance | 12:50–13:52 | `recert/perf/` | regional 1; driver 18 (≥15 s apart) | none |
  | Regression suites | 13:59–14:26 | `recert/regression/` | none | none |
  | Driver visual | 13:59–15:25 | `recert/driver/` | driver 2, regional 1, assam.sm 1 | none (non-GET failed in the browser except auth and `ai/*`) |
  | Manager visual | about 14:00–15:36 | `recert/manager/` | regional 1, assam.sm 1, kamrup.dm 1 | 1 draft planned by keyboard and cancelled |
  | Browser E2E | 14:04–15:02 | `recert/e2e/` | regional 2, driver 2, 5 scoped managers 1 each | the lifecycle trip and 1 re-plan draft (cancelled) |
  | Audit 2 | 16:02–16:30 | `recert/audit2/` | regional 1, driver 1 | auth only; regional signed out |
  | **Final round** | 16:31–18:25 | `recert/final/` | regional 1, kamrup.dm 1, driver 3 | 1 trip planned, approved, dispatched, driven, rerouted, delivered and closed; auth; logouts |
  | Fix round 3 checks | about 18:30–19:05 | `recert/final/manager/avif/`, `scratchpad/drv09/` | driver 3 (read-only harness; logout blocked) | none (AVIF timed signed out; one heartbeat blocked) |
  | PERF-3 experiment | 19:07–19:28 | `final-verify/experiment/` | regional 1 (reused for 24 loads) | auth only; signed out |
  | Final performance | 19:33–21:26 | `final-verify/perf/` | regional 1; driver 33 (≥15 s apart) | auth only; UI sign-out after every run |
  | Final regression | 21:30–21:44 | `final-verify/regression/` | none | isolated test DB only |
  | Final manager visual | 21:31–22:28 | `final-verify/manager/` | regional 1 | auth only; signed out |
  | Final driver visual | 21:32–22:32 | `final-verify/driver/` | driver 1 | auth only (heartbeats and location posts blocked); signed out |
  | **Final E2E** | 21:30–22:25 | `final-verify/e2e/` | regional 1, assam.sm 1, cert.nagaon 1, driver 1 | 1 trip planned, approved, dispatched, driven, rerouted, SOS sent and resolved, delivered and closed; 1 re-plan draft cancelled; all 4 signed out |
  | Audit 3 | 22:58–23:18 | `scratchpad/audit3/` | not stated in its report | read-only on source; its backend re-run used the isolated test DB |
  | **Fix round 4** | 23:20–00:45 | `final-fix/` | regional 1, assam.sm 1 (plus 1 refused attempt on the North-East region; the account is Assam-scoped), driver 1 | 1 trip planned, approved, dispatched, driven, rerouted, SOS sent and resolved, delivered and closed; 1 draft cancelled; auth; all 3 signed out |

  No lane saw an HTTP 429. The final round signed the driver in three times: the driver web keeps its session in memory only (E2E-D1, by design), so each of the two page reloads that loaded new driver code needed a new sign-in.
- **Trips created.** Re-certification: `TRP-AFC3D6D6-6B8D-4132` (CLOSED), `TRP-B1D7C606-22D1-47C8` and `TRP-902EEE49-D9AA-448E` (CANCELLED). Final round: `TRP-EF31DD41-6DA9-4306` (CLOSED 18:04:37 IST). Read-only DB check at 18:05 IST: the only open trips are the seeded TRP-DEMO-001 (ACTIVE) and TRP-DEMO-002 (DELAYED); 32 trips; 0 open emergencies (3, all resolved); Tenzing Bhutia and AS01AB1003 AVAILABLE. Both lifecycle trips keep their driver's reroute proposal (EMERGENCY_BACKUP, PROPOSED) on a closed trip. Final verification: `TRP-F0C0537E-2D0A-4AF7` (CLOSED 22:15:51 IST) and `TRP-65D782CE-B00E-42FF` (CANCELLED 22:19:56 IST), both by the E2E lane through the manager UI; no other lane created a trip. Read-only DB check for this document at 22:36 IST: 34 trips; the only open ones are TRP-DEMO-001 (ACTIVE) and TRP-DEMO-002 (DELAYED); 4 emergencies, all RESOLVED. Fix round 4: `TRP-82192454-4D98-4BD4` (CLOSED 00:27:56 IST, 29 Sep) and `TRP-211560AD-7A7D-4A44` (CANCELLED 00:30:27 IST), both through the manager UI. Read-only DB check at 00:33 IST: 36 trips; the only open ones are TRP-DEMO-001 (ACTIVE) and TRP-DEMO-002 (DELAYED); 5 emergencies, all RESOLVED; Tenzing Bhutia and AS01AB1003 AVAILABLE.
- **Chrome profiles.** Re-certification lanes: 14 created, 0 left. Audit 2: 3 created, 0 left. Final round: 5 created (the manager, driver, kamrup.dm and pre-login sessions, and one launched by a malformed bridge call and killed within a minute), 0 left. At 18:10 IST `%TEMP%` held 0 `cdp-profile-*` and 0 `recert-*` directories. The 21 `chrome_BITS_14044_*` directories belong to LegionSpace.exe (PID 14044, not a harness) and fluctuate (21 at 16:15 IST, one created at 16:15). The 62 `scoped_dir*` and 11 `playwright*` directories predate this run. Fix round 3 and the final verification: every lane deleted the profiles it created (manager lane 2, driver lane 1, E2E 4 under `final-verify/e2e/profiles/`, perf 1, experiment 1, fix-3 checks 2; regression none) and reported 0 left. Re-counted for this document at 22:36 IST: `%TEMP%/cdp-profile-*` = **0**. Fix round 4: 4 created, all deleted. One was launched with an undefined port by a malformed bridge call; it was killed within about 3 minutes and its profile deleted. The other three were the E2E sessions, removed by the bridge's `quit`. Re-counted at 00:33 IST on 29 Sep: `%TEMP%/cdp-profile-*` = **0**.
- **Tokens.** Audit 2 checked token revocation (read-only count): 51 refresh tokens issued 06:00–09:59 IST are unrevoked and unexpired; the cookie jars that held six of them are deleted. The final round signed out regional, kamrup.dm and its last driver session (`POST /api/auth/logout` 204 each); the first two driver sessions' refresh families lived only in page memory and are unrevoked. Nobody revoked the old tokens with SQL: that is a write to the cert DB outside this round's remit (§14). **Final verification.** The manager, driver, E2E (4 accounts) and experiment lanes signed out through the UI, and their families are revoked with reason `logout`. Fix round 3's driver checks left 3 families live (the read-only harness blocks logout). A read-only count at 22:36 IST found **15 of the perf lane's 33 driver families (first issued 20:35–21:23 IST) still live**, none of them rotated. Audit 3 found the cause. The 15 are exactly the runs of the pre-redesign snapshot (`d88c503`) and c1 builds: fast 6, mobile 6 and extra 3. Those web builds keep no refresh token, so their logout posts `{}` and the server cannot revoke the family. All 18 r2/now runs were revoked with reason `logout`. The "200" the lane logged beside the 204 is the CORS preflight. In all, 18 families first issued since 18:30 IST were live, and 750 across the cert DB (380 of them issued before 28 Sep).

  The `cert.ekh@rasta.test` family that is still rotating is `3fde1a5b`. It was first issued on **26 Sep at 20:09:06 IST** and had 305 tokens by 00:28:55 IST on 29 Sep. It rotates about every 15–16 minutes from a non-headless Windows Chrome. So it predates this certification and belongs to no lane; it is probably a long-open browser tab. The 14:18–14:19 IST family `55f3ec9e` is live but idle (§14 #11).

  **Fix round 4**'s three families (regional, assam.sm, the driver) are revoked with reasons `rotated` and `logout` (read-only check, 00:33 IST).
- **Housekeeping.** At 15:41 IST the E2E lane's `recert/e2e/watch.sh` loop was stopped (read-only). The perf lane records that `chrome.exe --version` from Git Bash opened in the user's running Chrome; nothing was loaded there. During the final verification an untracked `notes.jsonl` (one "drive" step line from the E2E harness) appeared at the repo root at 21:37 IST; fix round 4 moved it to `final-verify/e2e/notes-stray-repo-root.jsonl`. `expo export` appended to the git-ignored `driver-app/.expo/dev/logs/export.log` in both rounds; fix round 4's export went to the scratch folder.
- **Tolerances** (audit §13.2): region edges ±2% of W or H; type ±10% within the same weight class; flat colour ±8 per channel against the token. "Exact" is never claimed.
- **Status rule.**
  - **FAIL:** an open P1 on the screen, or an audit §13 responsive gate that is not zero.
  - **PARTIAL:** open P2/P3 items, unmeasured fields, or states not seen live.
  - **PASS:** every field matches or its difference is documented with a reason, both themes are captured, functions are test-proven, and the responsive matrix is clean. A page whose code a later round did not change keeps its earlier evidence; the final verification re-captured every manager state at 1600×900 in both themes and re-ran the whole matrix on the round-3 code.

---

## 2. Screen by screen

### Manager

The re-certification capped every lazy page at PARTIAL under the shell's P1 (LAZY-1). That cap is gone: LAZY-1 is fixed (M4). Figures come from `recert/manager/summary-1600.txt` unless noted. "Green" is the share of non-photo pixels with HSL saturation over 0.25 and hue 90–170. The final round did not re-run the 462-cell responsive matrix; its changes are listed per screen, and where one could move a box it was checked live. **Final verification** (`final-verify/manager/`): all 21 states re-captured at 1600×900 in both themes (42 captures, 21 states × 2 themes, plus 1 settled Fleet-drawer frame. Every one has 0 overflow, 0 text AA failures, 0 unnamed and 0 clipped. There are 0 overlaps except the by-design script taglines on Region and Login in both themes. The only case-insensitive day/night hit is Diagnostics' "30-day mean"), the 462-cell matrix and the 38 states at 200% zoom re-run on the round-3 code with 0 on every gate (§4), and both contact sheets read. The figures in the rows below are the re-certification's unless a row says "final verification" or "fix round 4". **Fix round 4** changed only what Trips, the trip review and Fleet say and when they re-read (FV-E2E-1, A3-02, FV-E2E-3). It added no box: the review's reroute box and status pills already existed. These changes were seen live on the new lifecycle trip (`final-fix/e2e/shots/m00`–`m07`, both themes); the 462-cell matrix was not re-run.

#### M1. Operational Region

| Field | Value |
|---|---|
| REFERENCE | `manger1.jpeg` |
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-region-{light,dark}-1600x900.png`; `recert/manager/sheets/sbs-region.png`; `recert/manager/dk1/region-*-{light,dark}.png`; `recert/final/manager/proof-region-dark-1600x900.png`; `final-verify/manager/proof/proof-region-{light,dark}-1600x900.png` |
| STRUCTURE_MATCH | PASS. Brand row, step eyebrow, H1, scope card, North-East map, benefit card, stats row and script tagline over a landscape photo. |
| SPACING_MATCH | PARTIAL. The card is 405 px tall against 303 px (it also holds the four-scope control, §16.3 #4); the eyebrow is at y139 against y157; the map box is landscape. |
| TYPOGRAPHY_MATCH | PASS by side-by-side reading (not re-measured against ±10%). |
| COLOR_MATCH_LIGHT | PASS. 0 text AA failures (minimum 4.85:1). The map keeps the reference's green selection fill. |
| COLOR_MATCH_DARK | PASS. Every scope fills the states neutral (`rgb(56,62,59)`) with an accent outline; map-box green 2.91% (North-East, outline) and 0.51% unchosen. Non-photo green 1.13% (was 13.99%). The whole frame including the photo averages RGB 25,32,26 with 6.11% green-hue pixels, measured with `frame_mean.mjs` on `recert/manager/proof/proof-region-dark-1600x900.png` (`dk1/region-dk1.json` holds only the map-box figures); the final capture gives 25,32,26 and 6.31% (`recert/final/pixstats-final.json`). That green is the forest photo under the neutral scrim, not a fill. Final verification, with the AVIF photo: whole frame 7.08% green-hue, non-photo 1.13% (unchanged); minimum contrast 6.5:1. |
| IMAGE_TREATMENT_MATCH | PARTIAL. Licensed Mawkdok valley photo with a visible, linked credit ("Photo: Sanjibroy56 · CC BY-SA 4.0"); no road, truck or river like the reference. |
| FUNCTIONS_PRESERVED | PASS. Keyboard-only scope choice and Continue (`recert/manager/kbd-signin.json`); "Districts on file". |
| ACCESSIBILITY | PASS. Banner 1, main 1, contentinfo 1. **A11Y-7 fixed** (final): the credit sits in a complementary landmark named "Photo credit"; 0 focusable elements outside a landmark (`recert/final/manager/checks.json`). Credit ring 100% (A11Y-2). |
| RESPONSIVE | PASS. The final round added a positioned `<aside>` round the credit (no layout change) and a phone `sizes` slot; fix round 3 wrapped the image in a `<picture>` (a 0×0 inline element; the photo box is identical to the pixel). Final verification: 0 on every gate in the re-run matrix. |
| KNOWN_DIFFERENCES | "STEP 1 OF 2", four-option control, gold pin, real stats, static map (§16.3 #16), photo subject. **RPERF-1 fixed:** a 390 px phone at DPR 3 now fetches the 1280w file, 125,678 B on the wire (was the 1920w file, 235,223 B). **PERF-3 open (owner decision, §14 #2):** at 1600 px the hero is still the LCP. Since fix round 3 it is `ner-mawkdok-valley-1600.avif`, 132,119 B on the wire (WebP 177,797 B, −25.7%), and a DPR-3 phone fetches the 1280w AVIF, 97,106 B; mobile LCP 2684 ms against the same-session snapshot's 1768 ms (+51.8%, §6). |
| STATUS | **PARTIAL** (spacing, PERF-3 as an owner decision, photo subject) |

#### M2. Login

| Field | Value |
|---|---|
| REFERENCE | `manger2.jpeg` |
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-login-{light,dark}-1600x900.png`; `recert/manager/sheets/sbs-login.png`; `recert/final/manager/proof-login-dark-1600x900.png`; `final-verify/manager/proof/proof-login-{light,dark}-1600x900.png` |
| STRUCTURE_MATCH | PASS. Photo panel (headline, four capability rows, script tagline, credit) and form panel. |
| SPACING_MATCH | PARTIAL. Fields about 42 px lower (the "Opening North-East · Change" chip). |
| TYPOGRAPHY_MATCH | PASS by side-by-side reading. |
| COLOR_MATCH_LIGHT | PASS. Minimum 4.27:1 on large text over the photo. |
| COLOR_MATCH_DARK | PASS for surfaces: right panel `#070808`, charcoal fields. 5.14% green, all of it the disabled Log In, a `#207054` bar (§16.3 #12, owner decision); the photo panel shows green hills under the scrim. |
| IMAGE_TREATMENT_MATCH | PARTIAL. Licensed Cherrapunji road photo with its credit; no bridge or truck. Below 1024 px the panel and its image are not loaded. |
| FUNCTIONS_PRESERVED | PASS. Keyboard-only sign-in, exactly 1 `POST /api/auth/login`; Log In `aria-disabled` until both fields are filled. |
| ACCESSIBILITY | PASS. Banner 1, main 1. **A11Y-7 fixed:** the credit is in the "Photo credit" complementary landmark; 0 focusables outside landmarks. |
| RESPONSIVE | PASS (re-certification matrix; the final change adds no box). |
| KNOWN_DIFFERENCES | No "Forgot password?", SSO or "or" divider (nothing backs them). Photo subject. PERF-3: since fix round 3 the hero is `ner-cherrapunji-road-1440.avif`, 106,775 B at 1600 (WebP 129,879 B, −17.8%); mobile LCP 2608 ms against the same-session snapshot's 1764 ms (+47.8%, §6). |
| STATUS | **PARTIAL** (spacing, PERF-3 as an owner decision, photo subject) |

#### M3. Overview

| Field | Value |
|---|---|
| REFERENCE | `manger3.jpeg` |
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-overview-{light,dark}-1600x900.png`, `proof-overview-livemap-*`; `recert/manager/sheets/sbs-overview.png`; `recert/final/manager/proof-overview-{light,dark}-1600x900.png`; `recert/final/manager/schem1-kamrup-schematic-{dark,light}.png`; `final-verify/manager/proof/proof-overview{,-livemap}-{light,dark}-1600x900.png` |
| STRUCTURE_MATCH | PASS with documented swaps ("Awaiting a decision" for Weather & Road Alerts, §16.3 #6; "Who is on / States" for Top Districts). |
| SPACING_MATCH | PARTIAL, as measured in the first run: KPI cards 116 px against 113 px (they keep the §16.1 hints). |
| TYPOGRAPHY_MATCH | PASS by side-by-side reading. |
| COLOR_MATCH_LIGHT | PASS. Minimum 4.56:1. |
| COLOR_MATCH_DARK | PASS. Luminance 0.030, 1.54% green (re-certification). Final capture, whole frame including the truck photo: luminance 0.027, 2.03% green-hue, mean RGB 25,29,27, 83.8% near-black neutral pixels. The schematic is neutral with an accent outline for all three roles. |
| IMAGE_TREATMENT_MATCH | PASS. Licensed goods-truck panorama, credited "Photo: Ashwin Kumar · CC BY-SA 2.0". Since fix round 3 it loads `ner-khasi-truck-800.avif`, 55,674 B on the wire on desktop (WebP 68,216 B, −18.4%) and the 1280w AVIF, 130,167 B, on a DPR-3 phone (first measured in the final verification). |
| FUNCTIONS_PRESERVED | **PASS (final).** Re-certification: stated PASS; audit 2 corrected it to **PARTIAL**: "Urgent alerts" read 3 (the lane's proof, 14:11) with the hint "A driver asking for help" while 0 emergencies were open; the figure was unread URGENT notifications (`dashboard.py urgent_notifications`; `OverviewPage.tsx:212`) (**AUD2-01**, P2). Final: the figure counts open SOS from the shell's own SOS poll (the topbar badge's list); the unread notices are the caption. Live: "Urgent alerts 0 · No driver is asking for help · 5 unread · 4 marked urgent" with 0 open emergencies in the DB. It says "—, Checking for an open SOS" until the poll answers, and "last known" when it fails. Three new tests. Also live: "Who is on" names drivers by their driver record, and "Districts on file". |
| ACCESSIBILITY | PASS. 0 text failures, 0 unnamed controls, correct landmarks. |
| RESPONSIVE | PASS. Final verification: 0 on every gate in the re-run matrix, which now includes the KPI and presence text the final round changed. |
| KNOWN_DIFFERENCES | No global search, no Change Region. Live map on request (owner decision). **AUD2-08 fixed:** "Who is on" read "GPS 12605 min ago (stale) · seen 11891 min ago" while Fleet said "210 h" and Notifications "9 d"; it now uses the shared age words ("GPS 9 d ago (stale) · seen 8 d ago", live). **SCHEM-1 fixed:** for kamrup.dm the "Kamrup Metropolitan" callout hangs level with the Assam label's top and overlaps no state label (live, 334 px map; "Nagaland" whole). |
| STATUS | **PARTIAL** (KPI spacing as measured in the first run) |

#### M4. Shell (rail, topbar, profile menu, phone Menu)

| Field | Value |
|---|---|
| REFERENCE | `manger3.jpeg` (sidebar and header) |
| IMPLEMENTATION_SCREENSHOT | every proof; `recert/manager/menu/*.png`; `recert/final/manager/lazy/lazy1-{dark,light}-*.png`; `recert/final/manager/menu/menu{1,2}-*-390.png` |
| STRUCTURE_MATCH / SPACING / TYPOGRAPHY | PASS / PASS (region card y596 against y630, 10 nav items) / PASS |
| COLOR_MATCH_LIGHT / DARK | PASS / PASS. Topbar `#0E1110`; the lazy-error page in Dark: luminance 0.008, 0.14% green, 97.2% near-black neutral (whole frame). |
| IMAGE_TREATMENT_MATCH | n/a |
| FUNCTIONS_PRESERVED | **PASS (final; was FAIL).** **LAZY-1 fixed:** an error boundary keyed on the path wraps the page area (`manager-web/src/components/RouteBoundary.tsx`, `App.tsx`). Live, fresh document, cache off, offline, nav click: `/states` (Dark) and `/trucks` (Light) keep the shell (`#root` 14,649 characters, nav and topbar present) and show "This screen could not be loaded · … The rest of the console still works · Try again" (`role=alert`). Back online, Try again loaded States (8 rows) and Trucks (5 rows). Try again first re-imported the chunk in place; in Chrome 153 that failed at once with the network back, because the browser keeps a failed module import for the life of the document (`recert/final/manager/lazy/first-attempt.txt`), so it now reloads the page when the browser is online and says "Still offline. Try again once the connection is back." when it is not (live on `/reports`). A page that throws while rendering is re-rendered. Tests: `RouteBoundary.test.tsx` (3) and an App test with a rejecting page import. Nav per role: regional 10, assam.sm 9, kamrup.dm 8. |
| ACCESSIBILITY | PASS. **MENU-1 fixed:** a page chosen from the phone Menu moves focus to the page (`#main-content`, `tabIndex -1`, the 2 px `.focus-target` ring); live at 390 px: after Enter on Drivers, focus on main with `:focus-visible`, next Tab "Search drivers by name or licence". **MENU-2 fixed:** Escape folds the open Menu and returns focus to the Menu button (live). **LAZY-2 fixed:** with 300 ms latency, "Loading…" (`role=status`) shows 104 ms after the click and the page at 739 ms, instead of the old page under the new address. A11Y-1 stays fixed (scroll padding 116 px). |
| RESPONSIVE | PASS. Re-certification matrix: 0 on every gate in 462 cells and at 200% zoom. The final changes add no box (a focus ring on main, a boundary with no element of its own, a keyed Suspense); the Menu was re-checked live at 390. Final verification: 0 on every gate again in 462 cells and 38 states at 200%; Tab walks on Trips (39 stops) and Fleet (44) go skip link → navigation → header → main with 0 back-steps. |
| KNOWN_DIFFERENCES | No search box, no nav count badge, no "Change Region". |
| STATUS | **PASS** |

#### M5. Fleet

| Field | Value |
|---|---|
| REFERENCE | none; the `manger3.jpeg` system |
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-fleet-*`; `recert/manager/dossier/assam.sm-*.png`; `recert/final/manager/proof-fleet-drawer-{light,dark}-1600x900.png`, `a11y8-fleet-ring-dark*.png`, `e2er2-route-options-dark-1600x900.png`; `final-verify/manager/proof/proof-fleet{,-drawer}-{light,dark}-1600x900.png`, `proof-fleet-drawer-light-1600x900-settled.png`, `responsive/fleet-dark-1920x1080.png`; `final-verify/e2e/shots/m07`–`m10`, `m15`, `m16`, `m19`, `m20`, `m22`; `final-fix/e2e/shots/m02-fleet-trip-selected-dark.png`, `m04-fleet-reroute-asked-{light,dark}.png`, `m05-sos-dossier-{light,dark}.png` |
| STRUCTURE / SPACING / TYPOGRAPHY | PASS / PASS (Details panel below the topbar, RESP-1) / PASS |
| COLOR_MATCH_LIGHT / DARK | PASS (minimum 5.36:1) / PASS (1.85% green; POI pins violet, red, slate, amber, blue). Final drawer capture, whole frame including the map: luminance 0.027, 2.14% green-hue, 82.4% near-black neutral. **REG-1 fixed (fix round 3), seen live:** marker and pin colours are tokens (`--marker-*`, `--pin-*`, `--on-pin-*`) in both themes; in Dark the LIVE marker is the accent `#39D8A0` (286 px on the "Tenzing Bhutia" marker) on a `#151918` chip (was `#34D399` on navy `#0F172A`), NO CONTACT `#F87171`; every green-hue pixel in the Dark map crop is at hue 156–164° with `#39D8A0` the top colour (`final-verify/manager/green/green-map.json`, `final-verify/e2e/fleetpix.py`). Light is unchanged (LIVE `#34D399`). |
| FUNCTIONS_PRESERVED | PARTIAL. **Final verification:** **E2E-R2 fixed end to end except the event and notification (§14 #1).** With the round-3 backend, a driver's road request shows on the Fleet row ("Driver asked for a new road" in the warning tone `#E6AE4A`, plus an underlined "Review new road") and in the detail box ("Proposed 9:52:24 PM · 88.12 km from where the truck was …"), 10.57 s after the request (one 10 s poll); "Review new road" opens the Route tab, where the EMERGENCY BACKUP 88.12 km says "Starts at a different point…" and "Route evidence is incomplete — check route conditions before this road can be chosen"; "Review & approve route" → "Approve & reroute" took it (`approve` 200) and the attention cleared 7.8 s later (9.0 s for assam.sm). **FV-E2E-3 fixed (fix round 4):** a successful choose, approve or accept now re-reads the fleet snapshot at once, as the SOS resolve already did. Live: after "Approve & reroute" the detail box and the row cleared 0.24 s and 0.25 s later. Before the fix it took 7.8 s, and the box flickered back on first. One 187 ms off-on of the detail box was seen while the approval dialog was being opened, before any write. **DOSSIER-1 and E2E-R1 seen live** (a real SOS): focus lands on "Close incident dossier", the phone reads `+••••••••••03` on the driver line and in SOP step 1 (0 full numbers in the text; one `tel:` link with 12 digits), SOP 1–4 numbered once, coordinates match the drive log, Escape and the X return focus to "View Incident Dossier" (once each: Escape in Dark, the X in Light, `notes.jsonl`), and Resolve moves focus to `main`. **Fix round 4 walked the rest live in both themes:** 25 Tab and 25 Shift+Tab presses stayed inside, and both Escape and the X returned focus in Dark and in Light (`final-fix/e2e/dossier-walk.jsonl`). SPEED reads "Unavailable" for a LIVE truck, because web fixes carry no speed. Earlier in this row (history): Fixed in the final round: **DATA-1** (live: TRP-DEMO-001 "NO CONTACT · reported 211 h ago" now shows Speed "Unavailable" and GPS accuracy "Unavailable"; a STALE fix shows its value with "Last known · <age>"; 3 tests). **E2E-R1** (P2, the E2E lane's rating): the Fleet detail "Phone" is masked (live "+••••••••••01") and "Call Driver" dials the full number; the dossier's "Phone:" lines are masked with "Call driver" and "Call contact" buttons carrying the number only in their `tel:` link, and the SOP steps are shown with those numbers masked (the server still writes the number into SOP step 1, `backend/app/domain/sentinel.py:331`). **E2E-R2, manager half:** while the Route tab is open its options are re-read on the Fleet poll (live: the driver's backup appeared about 16 s after `POST /reroute`, no re-selection), a road from a different start point says "Starts at a different point from the current route, so its distance and time are not compared with theirs", and no FASTEST/SHORTEST chip is awarded across different starts (live; 2 tests). At the final fix round E2E-R2's backend half was open and the dossier had not been seen live; both are covered above. |
| ACCESSIBILITY | PASS. **DOSSIER-1 fixed:** Escape, the X and Close return focus to the button that opened the dossier; after Resolve (whose button may leave with the SOS) focus goes to the page (tests; seen live in the final verification). **A11Y-8 fixed:** the table's scroll box leaves 6 px round the trip button, so its 3 px ring at 2 px offset is whole (live: the left edge is 3 ring columns). Map rings 96–100% (A11Y-3) except the round OSM attribution toggle, which scores 66.7% on the square-perimeter metric in both themes, in the re-certification and now; its close-up shows a whole circular 3 px ring (FV-M-2, a wording correction). |
| RESPONSIVE | PASS. The final round's scroll-box change is a negative margin inside the card's padding (no page overflow). Final verification: 0 on every gate in the matrix; the row attention and "Review new road" pass every gate at 320 Dark (`final-verify/manager/sheets/window-fleet-320-row.png`); at 200% the details panel is present with 0 overflow, 0 clipped and 0 words lost in both themes (`zoom200/recheck-fleet-drawer.json`; the matrix harness had measured "No truck selected" instead, FV-M-1). |
| KNOWN_DIFFERENCES | **RPERF-2 re-timed (final verification):** on the mobile profile the map chunk now starts with FleetPage (1715 ms) and the first truck marker comes 8.5% sooner than in the pre-redesign snapshot (3898 against 4261 ms; first tile −6.2%). The cost is **FPERF-1 (P3):** the page's text LCP is +15.6% (2672 against 2312 ms), because the map chunk shares the 1.6 Mbps HTTP/1.1 link with the page's chunks. Unthrottled, **FPERF-2 (P3):** LCP +30.1%, marker +15.8%, since the re-certification: React 19 holds a Suspense reveal for 300 ms after the route fallback commits (§6). |
| STATUS | **PARTIAL** (FPERF-1, FPERF-2; both P3) |

#### M6. Trips (planner and lists)

| Field | Value |
|---|---|
| REFERENCE | none; the `manger3.jpeg` system |
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-trips-{light,dark}-1600x900.png`; `recert/manager/keyboard/planner-*.png`; `recert/e2e/shots/m01..m04`, `m10..m12`, `m17`, `m28`, `m29`, `m32` |
| STRUCTURE / SPACING / TYPOGRAPHY | PASS |
| COLOR_MATCH_LIGHT / DARK | PASS (minimum 5.77:1) / PASS (0.56% green) |
| FUNCTIONS_PRESERVED | PASS. The E2E covered plan, the no-route gate, approve, dispatch, "Accepted — awaiting start", close, re-plan and cancel; exports were clicked. The final round planned, approved, dispatched and closed `TRP-EF31DD41-6DA9-4306` through this page (§7). `attention()` moved into `tripExport.ts` unchanged, so Reports writes the same words. **Final verification:** `TRP-F0C0537E-2D0A-4AF7` planned, approved, dispatched, closed and a second draft cancelled here (§7). The row showed "Driver asked for a new road" (text-warning: `#8A4B09` Light, `#E6AE4A` Dark; never the success tone) and a "Review new road" button 1.83 s after the driver's request, as assam.sm; the button opened Fleet's Route tab; after the accept the row went back to "On the road". The "All attention" filter lists the new phrase. Export CSV: 3 data rows = "3 shown of 3 matching", no phone column. Seen, not scored: Close on a DELIVERED row has no confirm, while Cancel asks. **A3-02 fixed (fix round 4):** a trip under way with no road selected reads "Needs a route" in the warning tone, the same rule as Overview's "Awaiting a decision". Live: TRP-DEMO-001 (ACTIVE) and TRP-DEMO-002 (DELAYED) (`final-fix/e2e/shots/m00-trips-demo-needs-a-route-*`). Before, the ACTIVE one read "On the road", and the "Needs a route" filter missed it. **Fix round 4 lifecycle:** `TRP-82192454-4D98-4BD4` was planned, approved, dispatched and closed here, and `TRP-211560AD-7A7D-4A44` was planned and cancelled (§7). |
| ACCESSIBILITY | PASS (0 stops under the topbar; the Change journey dialog traps and returns focus). |
| RESPONSIVE | PASS (phone cards below 768; sticky actions from 768; RESP-2). Final verification: the phone card's Attention line and filled "Review new road" pass every gate at 320 Dark. |
| KNOWN_DIFFERENCES | The empty Trip Review explainer shows its step tiles only from 1536 px. |
| STATUS | **PASS** |

#### M7. Trip review (panel on Trips, with route map)

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-trips-review-{light,dark}-1600x900.png`; `recert/e2e/shots/m05..m09`, `m15`, `m25`, `m32`; `final-verify/manager/proof/proof-trips-review-{light,dark}-1600x900.png`; `final-verify/e2e/shots/m12`, `m14`, `m17`, `m23`, `m29`; `final-fix/e2e/shots/m01-approval-filled-dark.png`, `m03-open-review-reroute-asked-assam-{light,dark}.png`, `m06-trips-delivered-close-{light,dark}.png`, `m07-open-review-cancelled-draft-{light,dark}.png` |
| STRUCTURE / SPACING / TYPOGRAPHY / COLOUR | PASS (minimum 4.53:1; 0.56% green in Dark) |
| FUNCTIONS_PRESERVED | PARTIAL. REQUIRES_REVIEW approval with a 20+ character reason and the "incomplete is not SAFE" box works (again in the final round, `approve` 200). **E2E-R5 (P3, backend, open):** the approval and its reason, and the driver's reroute request, are in `audit_logs` only; Journey History goes from "Trip created" to "Driver and truck assigned". Re-confirmed on TRP-EF31DD41: its `trip_events` are CREATED, ASSIGNED, ACCEPTED, STARTED, STOP_ARRIVED ×2, STOP_COMPLETED ×2, DELIVERED and CLOSED. **Final verification:** a review opened after the driver's request shows a warning box, "Driver asked for a new road · Proposed 9:52:24 PM · 88.12 km from where the truck was. The trip stays on its current road until a manager accepts the new one on Fleet's Route tab.", with "Review new road" (accent in Dark); there is no accept control here by design. Journey History shows "Journey changed by Regional Head" (ROUTE_CHANGED to EMERGENCY_BACKUP 88.12 km) and "Incident resolved by Regional Head", but still neither the approval nor the driver's request (E2E-R5). **FV-E2E-1 fixed (fix round 4), seen live:** the review re-reads its trip when its polled row's status, selected route or the driver's proposal changes, or when the row leaves the list. A row that says the trip ended hides "Plan route" even before the read lands. In the new lifecycle, assam.sm opened the review of `TRP-82192454-4D98-4BD4` before the route was planned and never clicked it again. It followed on its own: ROUTE SELECTED 1.87 s after the approve; ASSIGNED, then ACTIVE, each 60–125 ms after its row; "Driver asked for a new road" with "Review new road" 3.72 s after the request (52 ms after its row); cleared 3.19 s after the manager's approve; CLOSED 0.47 s after the Close. A second draft cancelled from regional's row read CANCELLED with no "Plan route" 3.19 s later, in a review that was open before the cancel (`final-fix/e2e/shots/m03`, `m06`, `m07`). History: in the final verification assam.sm's review, open since 21:41:46 IST, never showed the request, and a cancelled trip's review still said DRAFT with an enabled "Plan route" 3 minutes later. That button posts `/routes/recalculate?detailed=true`, which the server does not refuse for a finished trip (A3-01, from audit 3's code reading; not executed). The UI half of A3-01 is fixed with FV-E2E-1 and the terminal-row guard; the server half is open, P3 (§11) |
| ACCESSIBILITY / RESPONSIVE | PASS / PASS |
| STATUS | **PARTIAL** (E2E-R5, P3) |

#### M8. Review (`/review`)

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-review-{light,dark}-1600x900.png`; `recert/e2e/shots/rbac-rb-*-review-url-light.png` |
| All but functions | PASS (minimum 5.77:1; 0.13% green) |
| FUNCTIONS_PRESERVED | PARTIAL. `/review?trip=<id>` mentions the trip for the four in-scope managers and not for Nagaon DM. Authorise and Revoke were **not seen live** (no unheld REQUIRES_REVIEW route); unit tests cover them. |
| STATUS | **PARTIAL** (states not seen live) |

#### M9. Assignments

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-assignments-{light,dark}-1600x900.png`; `recert/manager/responsive/assignments-*.png` |
| All but functions | PASS (minimum 5.12:1; 0.89% green; phone cards below 768) |
| FUNCTIONS_PRESERVED | PARTIAL. The manual plate-verify form was not seen live (every cert assignment is VERIFIED). |
| STATUS | **PARTIAL** |

#### M10. Drivers (with profile drawer)

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-drivers-{light,dark}-1600x900.png`, `proof-drivers-drawer-*`; `recert/manager/keyboard/dialog-driver-profile-*.png` |
| All fields | PASS. Rows 57 px (avatar plus two lines); minimum 4.53:1; 0.25% green (drawer 0.45%); the drawer traps focus, closes on Escape and returns focus; the list masks phones (`maskPhone` now lives in `manager-web/src/utils/phone.ts`, re-exported unchanged). |
| KNOWN_DIFFERENCES | The profile drawer shows the full number (owner decision R6, phase-b3 mismatch-log row 22; it covers this drawer only, §14 #4). |
| STATUS | **PASS** |

#### M11. Trucks (with Assign dialog)

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-trucks-{light,dark}-1600x900.png`, `proof-trucks-dialog-*`; `recert/final/manager/lazy/lazy1-light-after-retry.png` |
| All fields | PASS. Minimum 4.53:1; 0.58% green (dialog 0.36%); the dialog opens with Enter, traps focus and returns it. LAZY-1 was reproduced and recovered live on this route in Light. |
| STATUS | **PASS** |

#### M12. States & districts

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-states-{light,dark}-1600x900.png`; `recert/final/manager/lazy/lazy1-dark-*.png` |
| All fields | PASS. Minimum 5.36:1; 0.74% green; regional only; the state button wraps at 320 (RESP-3). LAZY-1 was reproduced and recovered live on this route in Dark. |
| STATUS | **PASS** |

#### M13. Managers

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-managers-{light,dark}-1600x900.png` |
| All fields | PASS. Minimum 5.12:1 (Light) and 7.94:1 (Dark); 0.87% green; Deactivate outlined and confirmed; regional and assam.sm only. The LAZY-2 pending cue was measured on this route. |
| STATUS | **PASS** |

#### M14. Reports

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-reports-{light,dark}-1600x900.png`; `recert/final/downloads/rasta-report-2026-09-28.csv` |
| STRUCTURE / SPACING / TYPOGRAPHY / COLOUR | PASS. Minimum 5.77:1 and 7.94:1; 0.40% green. |
| FUNCTIONS_PRESERVED | **PASS (final).** **REPORT-1 / E2E-R4 fixed:** Build report now also reads the driver and truck lists and writes Driver, Truck and Attention as the Trips export does (`ReportsPage.tsx`). Live CSV: 31 rows = "31 trips in your scope", 0 rows with an empty Driver, Truck or Attention, 0 phone-like cells (Tenzing Bhutia 29, Bipul Das 1, Rina Kalita 1). Print / PDF uses the same rows (not re-clicked in the final round). New test. |
| ACCESSIBILITY / RESPONSIVE | PASS / PASS |
| STATUS | **PASS** |

#### M15. Notifications

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-notifications-{light,dark}-1600x900.png`; `recert/final/manager/proof-notifications-{light,dark}-1600x900.png` |
| STRUCTURE / SPACING / TYPOGRAPHY / COLOUR | PASS. Minimum 5.48:1 and 5.68:1. Final Dark capture: luminance 0.018, 0.18% green-hue, 92.3% near-black neutral. |
| FUNCTIONS_PRESERVED | **PASS (final).** Re-certification: stated PASS; audit 2 corrected it to **PARTIAL**: resolved SOS rows still said "needs an answer now" in red with a primary Call button (`NotificationsPage.tsx:146`; **AUD2-04**, P3). Final: whether a stop request still needs an answer comes from the SOS list, not the notice's severity; live, all 4 SOS rows read "· no SOS is open on this trip now" with an outlined Call button. Until the SOS poll answers, or when it fails, a notice keeps its urgency. New test. |
| ACCESSIBILITY | PASS. Selected "Unread" ring 3.85/3.98:1 (A11Y-4). |
| STATUS | **PASS** |

#### M16. Diagnostics

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/manager/proof/proof-diagnostics-{light,dark}-1600x900.png` |
| All fields | PASS. Minimum 5.12:1 (Light) and 7.61:1 (Dark; audit 2 measured 5.68:1 on later live data); 1.29% green; semantic pills; details-summary ring 95–100%. |
| STATUS | **PASS** |

### Driver

Captures are at 450×800 CSS, DPR 2, unless stated otherwise. Region measurements are in device px (`recert/driver/regions.json`). The re-certification captured every with-trip state read-only from the E2E lane's trip; the final round drove its own trip, `TRP-EF31DD41-6DA9-4306`, and measured the active-trip states live. **Final verification** (`final-verify/driver/`): 22 Dark and 21 Light screens at 450×800 (both proof sheets read), 739 measured captures at 360, 412, 450, 480 and 768 with 0 overflow, 0 targets under 48 dp and 0 unnamed controls; with-trip states observed read-only on the E2E lane's `TRP-F0C0537E-2D0A-4AF7`, and the E2E lane drove the driver side of that trip (`final-verify/e2e/shots/d*.png`). **Fix round 4** drove the driver side of `TRP-82192454-4D98-4BD4` (`final-fix/e2e/shots/d*.png`, `fvdrv01-*.png`).

#### D1. Login

| Field | Value |
|---|---|
| REFERENCE | `driver1.jpeg` |
| IMPLEMENTATION_SCREENSHOT | `recert/driver/sbs-login.png`, `onion-login-light.png`, `sheet-login-450.png`; `recert/driver/shots/login-*` |
| STRUCTURE_MATCH | PASS. Language pill, shield mark, wordmark, glass card, Sign In and a three-item trust row over a photo. |
| SPACING_MATCH | PARTIAL. Card ends at 63.2% H against 61.4%; Sign In 40 px higher (no Forgot-password line). |
| TYPOGRAPHY_MATCH | PARTIAL. Trust labels 11 against 9.5 CSS px (+16%). |
| COLOR_MATCH_LIGHT / DARK | PASS / PASS (`#070808`, glass `#0E1110`). |
| IMAGE_TREATMENT_MATCH | PARTIAL. Licensed Cherrapunji road photo with its credit; no truck, milestone or river. |
| FUNCTIONS_PRESERVED | PASS. Sign-in (three times in the final round), language sheet, password reveal; Dark survives a reload. **REG-8 fixed:** the dead `login_forgot` "Forgot password?" key is gone from the type and all five language tables. |
| ACCESSIBILITY / RESPONSIVE | PASS / PASS (5 sizes, both themes). |
| KNOWN_DIFFERENCES | No "Forgot password?" (no reset flow). Different photo. Feather outline icons. |
| STATUS | **PARTIAL** |

#### D2. Navigate

| Field | Value |
|---|---|
| REFERENCE | `driver2.jpeg` |
| IMPLEMENTATION_SCREENSHOT | `recert/driver/sbs-navigate.png`, `onion-navigate-light.png`; `recert/final/driver/nav-guiding-{light,dark}-{450x800,360x640}.png`, `nav-accepted-dark-450x800.png`, `offroute-rerouting-dark-450x800.png`, `navigate-fuel-dark-450x800.png`, `large/large-*-navigate-*.png`; `final-verify/driver/sbs-navigate.png`, `shots/nav-{notrip,active,guiding}-*`, `shots/mapcol-*`; `final-verify/e2e/shots/d04-navigate-guiding-km10-*`, `d05-offroute-new-road-awaits-manager-*`, `d06-new-road-guidance-*`; `final-fix/e2e/shots/d01-navigate-reroute-approved-{light,dark}.png`, `fvdrv01-{css,android}{1.3,1.5}-{light,dark}-360x640.png` |
| STRUCTURE_MATCH | PASS. Hero, search, map card with floating buttons and a summary overlay, CTA, four quick tiles, Route Information and a scenic strip; while guiding the guidance panel replaces the quick actions (§16.2). |
| SPACING_MATCH | PARTIAL (**RC-DRV-05** = CERT-DRV-07, P3, open). Hero 0–322 against about 240; search 96 tall against 75; map 386–866 against 333–772; quick row 210 against 155; tab bar 124 against 107. While guiding the map is now at least as tall as the overlays on it (a 450 px screen keeps 320 px; 346 px at 360×640). |
| TYPOGRAPHY_MATCH | PARTIAL. Title 30 CSS px; subtitle +25% (legibility decision). |
| COLOR_MATCH_LIGHT / DARK | PASS / PASS. Green only on CTAs, the active tab and accent text. **REG-5 fixed (final):** after a Fuel search in Dark the FUEL pins are `#6D28D9` (411 device px) with 0 px of `#15803D` (audit 2 had measured 2 green pins, 422 px); FUEL and TYRES now match the manager's `--poi-fuel` and `--poi-tyres`. **REG-5 fully fixed (fix round 3):** every map hue comes from `MAP_LIGHT`/`MAP_DARK` in `theme.ts` (0 hex left in `scene.ts`). Live in Dark (final verification): the GPS disc, dot and truck arrow are the accent `#39D8A0` (the arrow `border-bottom-color #39D8A0`, `rotate(122deg)`, which fix round 3 had not seen live); route `#62A8FF` on a `#070808` casing; steep `#B42318`, hilly `#B45309`, completed `#6B746F`; FUEL `#6D28D9`, REST `#CA8A04`, TYRES `#475569`, the same in Light; no green hue but the accent in any Dark map probe. Light is unchanged (live marker `#087F5B`). |
| IMAGE_TREATMENT_MATCH | PARTIAL. Licensed Mayodia Pass hero and Barapani strip; no satellite map or mountains like the reference. |
| FUNCTIONS_PRESERVED | PASS. Real guidance on TRP-EF31DD41 ("Keep slight right onto Bhangagarh Flyover · Then Continue onto G.S. Road"), landslide cards, off-route "Rerouting" with "new road 82.9 km awaits manager", SOS and the quick searches. **E2E-R6 fixed:** an OSRM turn with modifier straight reads "Continue" (live "Then Continue" before the turn at 92.5 km; it read "Then ↑ Turn straight"). **E2E-R3 fixed:** a site off the road says so ("Recorded landslide site 2.0 km off the road, near here", live), and one acknowledgement covers a stretch of sites closer than the 3 km approach window (live: one card at km 19.94, acknowledged, none after it to km 24.6; the re-certification's E2E saw new cards at km 0.44, 0.55, 0.99, 1.52, 1.72 and 2.89). **Final verification:** guidance at km 10, "180 m Continue slight left onto NH37 · Then Turn right"; held 400 m off the line, the app asked for a road itself (`POST /api/driver/me/trip/reroute` 201) and read "Guidance paused · Off the planned road · new road 88.1 km awaits manager" with the "Rerouting" chip; 5.75 s after the manager's accept it switched to "90 m Turn right · Then Keep left", 88.1 km remaining, "Following" (`d05`, `d06`). **Maneuver wording (fix round 3):** on the recorded real OSRM package (24 maneuvers) no raw "straight", "exit roundabout" or ramp wording is left, "turn straight" reads "Continue onto …", and "Keep slight right onto Bhangagarh Flyover" now gets the slight-right arrow (it drew the straight arrow before; live: "380 m Keep slight right onto Bhangagarh Flyover / Then ↑ Continue onto G.S. Road"). **FV-DRV-02 fixed (fix round 4):** an "exit roundabout" or "exit rotary" step that directly follows its own entry is no longer told. It is dropped from what the card, the "Then" line and the voice use, because the entry already carries the exit number. On the recorded package the exit steps were 6.5 m and 67 m after their entries (2 tests). Live at the km 9.87 roundabout: the card read "At the roundabout, take exit 1 / Then Continue slight left onto NH37" on approach, and "230 m Continue slight left onto NH37 / Then Turn right" just after the entry. Before the fix it said "Then At the roundabout, take exit 1", and repeated it after the entry. **FV-E2E-2 fixed (fix round 4):** when the trip poll sees the manager move the trip onto a new road, Navigate shows "Reroute approved" for 5 minutes and Trip adds "Your manager approved a new road. Open Navigate to follow it." Both phrases were already translated (1 test). Live: 4.84 s after the manager's approve, at the same moment as the switch to "120 m Turn right · Then Keep left" and the "Following" chip. |
| ACCESSIBILITY | PASS on the device path. **RC-DRV-06 fixed here:** Tab now reads Search, Back to trip, Emergency help, Map layers, Re-centre, Map, the Leaflet link, the four quick tiles, the credit, then the tabs (the map is after the controls in the DOM and drawn under them). **RC-DRV-04 fixed:** "Fuel: search this area" (live). **RC-DRV-11 fixed in code:** "Loading guidance…" while the directions are on their way; "Guidance unavailable" only when they are not (not seen live; the package loaded at once in this run). |
| RESPONSIVE | PASS on the device path; see §4. **RC-DRV-01 and RC-DRV-02 fixed (final):** below 420 dp of room the maneuver instruction takes the card's full width on up to four lines; the route verdict, ETA values, AI facts, the alert's where/detail/evidence lines and the AI stamp wrap instead of cutting; the hero says the place ("Shillong · TRP-…"), and the next-stop tile says "Shillong" (both cut "793001, Indi" before). Live at 360×640 on the active trip: 9/9 checks per run in all four runs (CSS and Android paths × Light and Dark; ×1.0, ×1.3, ×1.5 at top, middle and bottom, each with a whole-page cut and mid-word scan); at 412 and 450 the Android path cuts nothing after the route tiles began to stack by width over font scale (FINAL-1); the CSS-only web path at 450 still cuts two route tiles, "No weather flag" and "Terrain · max grade 17%", because the web build reports font scale 1. The alert's evidence line was cut even at normal size at 450 ("… weather: current (5 obs) ·"); it now wraps. **RC-DRV-09 partly fixed:** at normal size nothing covers the OSM attribution at 360 or 450 (live, every text run visible); under large text the room kept for it grows with the font scale, but on the web CSS emulation, which also enlarges Leaflet's own 12 px text, the summary pill and the rail's lower buttons still sit on it at ×1.3/×1.5 (measured before the font-scale room was added; not re-measured). **RC-DRV-09 fixed (fix round 3, verified in the final verification):** the web map measures the attribution's real height and keeps the summary, rail and map growth clear of it; 108 probes (360 guiding, 360 browse, 450, 412; both paths, both themes, ×1.0/×1.3/×1.5) found no overlay on it, and it was fully visible at some scroll position in all 36 combinations (at 360 ×1.3/×1.5 it sits below the fold or under the floating tab bar at scroll-top). **FV-DRV-01 fixed (fix round 4):** below 420 dp of room the "Then" line wraps on up to 4 lines, like the instruction. Live at 360×640 on the new trip, on both paths at ×1.3 and ×1.5 in both themes, it was never cut (12 probes). With "Then Continue slight left onto NH37" it took 3 lines (78 px) at ×1.5, which the old 2-line clamp would have cut (`final-fix/e2e/then-check.jsonl`). The final verification had measured 49/51 (Android) and 47/51 (CSS) per theme at 360 while guiding. **FV-DRV-03 (P3, web-only):** on the CSS path at 412 and 450 the browse-mode quick actions cut or break ("Lay-bys …", "Punctur\|e & tyres", "Request\| help"); the Android path passes 21/21 at the same sizes. Not measured: the pre-start state (accepted, not started) with 3 rail buttons at 360. |
| KNOWN_DIFFERENCES | 4 tabs (§16.3 #5); a blue route (§16.3 #13); OSM raster (§16.3 #14); no Food Stop and no mic; the subtitle is the destination place; Route Information shows real values. |
| STATUS | **PARTIAL** (RC-DRV-05; web-only large text FV-DRV-03 and two route tiles at 450; PERF-4) |

#### D3. Safety

| Field | Value |
|---|---|
| REFERENCE | `driver3.jpeg` |
| IMPLEMENTATION_SCREENSHOT | `recert/driver/sbs-safety.png`, `onion-safety-light.png`; `recert/driver/shots/safety-*` |
| STRUCTURE_MATCH | PASS. Hero, Emergency Numbers (3 tiles), "Need immediate help?" with Call 112, the Safety Tools grid and the "Stored on this phone" banner. |
| SPACING_MATCH | PARTIAL: numbers 436–748 against 466–710, help 764–920 against 727–850, tools from 936 against 864 (up to 4% H). |
| TYPOGRAPHY_MATCH | PARTIAL. Numbers and tool titles +20% (legibility decision). |
| COLOR_MATCH_LIGHT / DARK | PASS / PASS. Call 112 red; 108/1033 neutral. |
| IMAGE_TREATMENT_MATCH | PASS. The licensed goods-truck photo matches the reference's subject. |
| FUNCTIONS_PRESERVED | PASS. The E2E sent a real stop request and saw it re-arm after resolve. |
| ACCESSIBILITY | PASS on the device path (CERT-DRV-02/03 fixed). |
| RESPONSIVE | PARTIAL. 0 overflow. On the **web build only**, CSS-only text scaling breaks "All emergenci\|es" (×1.3) and "All emergenc\|ies" and "Ambulan\|ce" (×1.5) (break index @13, @12 and @7 in `recert/driver/large-css*.json`), because react-native-web reports font scale 1 and the number tiles stack by font scale (owner item, §14). **New in the final round (FINAL-1, fixed):** the Safety Tools grid went to one column by width only, so on Android a 412 dp phone at ×1.3 cut "Offline guidance and the translator" in two columns; it now stacks by width over font scale (Android path: 0 cut at 412 and 450, ×1.3/×1.5, live). The CSS-only web path still cuts those tool lines at 412 and 450 (the same web-only class). Final verification: the Android path passes 21/21 at 412 and 450; the CSS path still breaks "emergenc\|ies" and "Ambulan\|ce" at 360 and cuts "Offline guidance and the translator", "Emergency contact" and "All emergencies" at 412/450 (§14 #8). |
| KNOWN_DIFFERENCES | No back arrow on a tab root; the banner shows a true line; no carousel dots. |
| STATUS | **PARTIAL** (web-only large-text cuts and breaks; spacing; PERF-4) |

#### D4. More

| Field | Value |
|---|---|
| REFERENCE | `driver4.jpeg` |
| IMPLEMENTATION_SCREENSHOT | `recert/driver/sbs-more.png`, `onion-more-light.png`; `recert/final/driver/credits-sheet-dark-450x800.png` |
| STRUCTURE / SPACING / TYPOGRAPHY | PASS / PASS (the four shared rows within 3 device px) / PASS |
| COLOR_MATCH_LIGHT / DARK | PASS / PASS. The Theme row reads "Light" or "Dark". |
| IMAGE_TREATMENT_MATCH | PARTIAL. Overcast Laitmawsiang ridges, unlike the sunny reference. |
| FUNCTIONS_PRESERVED | PASS. The theme toggles with no request; the choice persists. |
| ACCESSIBILITY | PASS. **RC-DRV-03 fixed:** the Image credits sheet's backdrop is a non-focusable, `aria-hidden` view (the Language sheet's fix); live, the sheet opens with focus on "Close" (role button), the backdrop has `tabIndex -1`. **RC-DRV-06 (More part) refuted:** "Image credits" is after Sign Out in the DOM and drawn below it (document y 757 against 655); the lane's `@y` figures were viewport positions after the page had scrolled. Large text passes (CERT-DRV-04). |
| RESPONSIVE | PASS. |
| KNOWN_DIFFERENCES | 5 rows against 4 ("How RASTA Works" is required); no back arrow, "R" mark or script tagline (§16.3 #2, #3). |
| STATUS | **PARTIAL** (photo subject; PERF-4 on the first visit) |

#### D5. Trip (no reference; system)

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/driver/shots/trip-*`; `recert/final/driver/trip-active-{light,dark}-{450x800,360x640}.png`, `trip-delivered-dark-450x800.png`, `large/large-*-trip-*.png`; `final-verify/driver/shots/trip-*`; `final-verify/e2e/shots/d01`, `d03`, `d09`, `d13`, `d15`; `final-fix/e2e/shots/d02-trip-reroute-approved-{light,dark}.png`, `d03-trip-complete-90s-after-delivery-dark.png` |
| STRUCTURE / SPACING / TYPOGRAPHY | PASS. Photo hero (compact while a trip is loaded), cards riding up. The trip is titled by its places, "Guwahati → Shillong", with the full addresses under PICKUP and DESTINATION. |
| COLOR_MATCH_LIGHT / DARK | PASS / PASS. Green only on the action CTA ("Arrived at Delivery"), the stepper's done step and the status dot. |
| IMAGE_TREATMENT_MATCH | PASS. The login photo, with its credit. |
| FUNCTIONS_PRESERVED | PASS. Accept, start, arrive and complete at both stops, delivery and the SOS were driven again in fix round 4. The no-trip wording (E2E-D3) is the re-certification's (`d17`) and its test. **FV-E2E-2 fixed:** "Reroute approved · Your manager approved a new road. Open Navigate to follow it." (live, `d02`). |
| ACCESSIBILITY | PASS on the device path. Re-certification, corrected by audit 2: large text **failed** on both paths; at 360×640, ×1.3 and ×1.5, the pickup and destination addresses were cut ("Guwahati, Kamrup Metropolitan, Assam, 78…", "Shillong, Mylliem, East Khasi Hills, Meg…"); Trip was 0 of 6 in every run (`recert/driver/large-{css,android}{light,dark}.json`) (**AUD2-02**, P3; it hid half of the large-text failures). Final: fixed; the addresses wrap to four lines and the title is the place names; Trip 9/9 in all four runs at 360×640 (×1.0/×1.3/×1.5, top, middle and bottom, whole-page scans). **RC-DRV-07 fixed (tests):** the foot of the page follows the tracking state: "not reaching your fleet manager yet … sent as soon as the connection returns" while uploads fail, "not being shared" when permission is denied (not seen live; uploads did not fail in this run). |
| RESPONSIVE | PARTIAL. 0 overflow at every size and scale checked. **RC-DRV-08 (P3, app-wide, device-unverified):** scrolled content passes under the transparent status bar with no scrim. |
| KNOWN_DIFFERENCES | **RE2E-2 (P3), reproduced, then fixed in code (fix round 4).** The "DELIVERED · Trip complete" card comes from the `/complete` response. The server's current trip is an open one, so the next poll, 8.5 s later, returned no trip, and the page became "No active trip". The notices read, which only the empty page makes, fired at that moment. 90 s after delivery, before the manager's Close, the page still read "No active trip" (`d03`). The final verification's reading ("until then", with Close at 47 s) had not been checked continuously. Fix: when the poll drops a trip the app last knew as DELIVERED, the empty Trip page keeps "Trip complete · Your manager can see the delivery. Location sharing has stopped." for 30 minutes (3 tests; not seen live, because the lifecycle had closed before the fix). Seen, not scored: SOS sent read "SOS sent: your manager has been alerted". |
| STATUS | **PARTIAL** (RC-DRV-08; RE2E-2's fix not seen live) |

#### D6. Truck check (no reference; system)

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/driver/shots/assignment-*.png` (12) |
| STRUCTURE / COLOUR | PASS. Compact hero, 4-step strip. |
| FUNCTIONS_PRESERVED | PARTIAL. Reached only through a browser-only rewrite of `GET /api/driver/me/assignment`; the gate did not apply in either E2E (the assignment is verified, `can_start` true). |
| ACCESSIBILITY / RESPONSIVE | PARTIAL. Not in the large-text set. |
| STATUS | **PARTIAL** |

#### D7–D10. My Details, Assistant, Translator, Tutorial

| Screen | Evidence | Result | Status |
|---|---|---|---|
| D7 My Details | `recert/driver/shots/details-*`, `kb-doc-number-*`, `large-*-details-*` | PASS on the screen; large text passes on both paths; keyboard keeps the field visible | **PARTIAL** (RC-DRV-08 only) |
| D8 Assistant | `recert/driver/shots/assistant-*`, `kb-assistant-*` | PASS on the screen; 360×340 keyboard layout keeps 120 px of conversation | **PARTIAL** (RC-DRV-08 only) |
| D9 Translator | `recert/driver/shots/translator-*` | PASS on the screen | **PARTIAL** (RC-DRV-08 only) |
| D10 Tutorial | `recert/driver/shots/tutorial-*`; the first-run tour shown again at sign-in in the final round | PASS on the screen; Skip/Close first | **PARTIAL** (RC-DRV-08 only) |

REG-9's unused imports were removed from `AiPanel.tsx` and `TranslateBox.tsx` (no behaviour change).

#### D11. Manager inside the driver app (ManagerRoot)

| Field | Value |
|---|---|
| IMPLEMENTATION_SCREENSHOT | `recert/driver/mgrshots/*.png` (48) |
| COLOR_MATCH_DARK | PASS. Green only on the Map CTA and the active tab. |
| FUNCTIONS_PRESERVED | PASS. Paging (CERT-DRV-09/AUD-02) and health counts (AUD-08) fixed in the re-certification. |
| KNOWN_DIFFERENCES | **RC-DRV-10 fixed in code (tests; not seen live):** providers by name ("Open-Meteo elevation", "Google Gemini", "MET Norway"), a state said once when its freshness is the same word ("Unknown", not "Unknown · Unknown"), and the language by its own name ("English", not "en"). |
| STATUS | **PARTIAL** (RC-DRV-10 not seen live) |

---

## 3. Theme proof

### Tokens (Dark)

`bg #070808 · surface #0E1110 · raised #151918 · soft #1B201E · border #2A302D · text #F5F6F2 · muted #AAB2AD · accent #39D8A0 · accentStrong #19B97F · danger #FF5D67 · warning #E6AE4A · info #62A8FF`

### Manager, 21 page states in Dark (re-certification, `recert/manager/summary-1600.json`)

- **Computed backgrounds.** `html` `#070808`; rail gradient neutral, ending at `#070808`; topbar and cards `#0E1110`; dialogs `#151918`/`#0E1110` over `#000` at 0.60–0.64. The only tinted fills are small accent-soft or danger/warning-soft chips: KPI icon tiles `#13291F`, success pills `#12241C`, alert discs `#2E1517` and `#2A2111`.
- **Mean relative luminance** 0.006 (trucks dialog) to 0.039 (Region).
- **Green share** of non-photo pixels:

  | Share | Pages |
  |---|---|
  | Under 1% | review 0.13, drivers 0.25, trucks-dialog 0.36, reports 0.40, drivers-drawer 0.45, trips 0.56, trips-review 0.56, trucks 0.58, states 0.74, managers 0.87, assignments 0.89 |
  | 1–3% | region 1.13 (was 13.99), notifications 1.18, diagnostics 1.29, overview-livemap 1.33, image-credits 1.47, overview 1.54, profile-menu 1.54, fleet 1.85, fleet-drawer 2.41 |
  | 3–6% | login 5.14 (the disabled CTA, §16.3 #12) |

- Audit 2 re-rendered ten of these in Dark and matched the figures within about 0.3 points, except Notifications (1.53% against 1.18%) and Diagnostics' minimum contrast (5.68:1 against 7.61:1, live data).

### Final-round captures, whole frame (`recert/final/pixstats-final.json`)

Whole-frame figures include photos and maps, so they read higher than the masked non-photo shares above.

| Capture | Luminance | Green-hue | Mean RGB | Near-black neutral |
|---|---|---|---|---|
| Manager Overview (Dark) | 0.027 | 2.03% | 25,29,27 | 83.8% |
| Manager Notifications (Dark) | 0.018 | 0.18% | 19,21,20 | 92.3% |
| Manager Fleet drawer (Dark) | 0.027 | 2.14% | 26,30,28 | 82.4% |
| Manager LAZY-1 error page, offline (Dark) | 0.008 | 0.14% | 11,12,12 | 97.2% |
| Manager Region (Dark, forest photo) | 0.036 | 6.31% | 25,32,26 | 72.7% |
| Driver Navigate guiding, 450 (Dark, map tiles and route) | 0.080 | 3.38% | 43,51,56 | 48.6% |
| Driver Trip active, 450 (Dark; the mint CTA and the photo) | 0.077 | 6.49% | 31,44,40 | 78.3% |
| Driver Navigate after a Fuel search (Dark) | 0.038 | 1.10% | 30,31,29 | 81.2% |

### Final verification, Dark (round-3 code)

Evidence: `final-verify/manager/summary-1600.json`, `pixstats-whole-frame.json`, `green/green-map.json`, `measure/*-dark-1600x900.json`; `final-verify/driver/pixstats-dark.{txt,json}`, `agg.txt`, `r-s30.json`, `r-s30b.json`; `final-verify/e2e/fleetpix.py`.

- **Manager, non-photo pixels** (photos and maps masked): luminance 0.013–0.039 on the full pages, and 0.006–0.039 once the drawer and dialog states are counted. Those are darker: trucks dialog 0.0058, drivers drawer 0.0086, image credits 0.0102. Computed `body`, `html` and `main` `#070808`; topbar `#0E1110`; the largest surfaces `#070808`, `#0E1110`, `#151918` and `#1B201E`. Green share and what holds it: Region 1.13% (map outline, the accent Continue); Login 5.14% (the disabled Log In, `#207054`); Overview 1.54% (accent-tinted KPI tiles, Show live map, the schematic outline, New trip, the avatar); Fleet 1.85% and drawer 2.41% (KPI tiles, + New trip, the All trips chip, Route options); Trips 0.56% and Trip review 0.55% (the disabled Create draft trip, `#207054`, and the Open Trips tab); Notifications 0.20%; Diagnostics 1.29% (Healthy, Ready, ACTIVE and Online pills). The only green colour buckets are the accent `#39D8A0` family, the accent-soft tiles, the disabled primary and anti-aliasing.
- **Manager, whole frame** (photos and maps included): Region 7.08% green-hue (the forest photo, now AVIF; 6.31% with the WebP), Login 3.07%, Overview 2.21%, Fleet 1.63%, drawer 2.13%, Trips 0.62%, Trip review 0.64%, Notifications 0.18%, Diagnostics 1.40%; near-black neutral pixels 63–93%.
- **Manager map tokens (REG-1, fix round 3):** resolved in Dark, `--marker-live #39D8A0` (= `--accent`), `--marker-bg #151918`, stale `#FBBF24`, no contact `#F87171`, none `#64748B`, selected `#F1F5F9`, `--pin-destination #2457D6`, pickup and edge `#FFFFFF`. With a live trip at 1920 Dark, the "Tenzing Bhutia" LIVE marker is `#39D8A0` (286 px) on a `#151918` chip (412 px); in the E2E's map crop every green-hue pixel sits at hue 156–164° with `#39D8A0` the top colour, and there is no `#16A34A` or `#34D399`. Light keeps LIVE `#34D399`.
- **Driver:** every Dark screen paints `#070808`, `#0E1110`, `#151918` and `#1B201E` (surfaceSoft), and the tab bar the neutral `#121514` (shell) and `#232826` (shellActive); its other fills are documented semantic tokens (discNeutral `#1B1F21`, dangerSoft `#2E1517`, warningSoft `#2A2111`, dangerStrong `#C62A2F`, primaryDisabled `#8FA59C`, the maneuver card's route blue `#2563EB`). At 450 Dark the green pixels are only the accent, for example 4.05% on Trip with no trip ("Open map"), 6.2% on the active Trip ("Arrived at Delivery"), 0.14% on Safety and 0.32% on More. On the map the GPS disc, dot and truck arrow are the accent; no other hue is green (§2 D2).
- Under the stop-request scrim the accent "Resume navigation" reads as a dark-green slab (5.65% of the frame): it is the accent under `rgba(0,0,0,0.64)`, not a surface.
- **Audit 3** re-rendered 10 manager and 7 driver screens in Dark with a live theme toggle. Surfaces were only the tokens above, and nothing read dark green as a surface. Its green shares matched these within 0.1–0.2 points: Region 1.15% against 1.13%, whole frame 7.00% against 7.08%, driver Trip 4.06% against 4.05%.
- **Fix round 4** added one coloured element, the driver's "Reroute approved" banner, measured live. In Dark it is `#131816` (the neutral `successSoft`) with accent text `#39D8A0`; in Light `#DFEFE4` with `#076C4D`.

### Where green shows in Dark

- **UI surfaces:** none. Every page background, card, rail, topbar, drawer and dialog is on the black tokens in both apps.
- **Photos:** the Region's lower half (forest under the neutral scrim; whole frame 25,32,26, bottom half 25,35,26 with the WebP; 7.08% green-hue with the AVIF) and the Login photo panel's hills.
- **Disabled primary:** the Log In bar and the planner's Create draft trip, `#207054` at 50% mint (§16.3 #12; owner decision, §14 #6).
- **Accent tints (REG-10, accepted):** Dark `--accent-soft #13291F` and `--success-soft #12241C` on the 64 px KPI tiles, success pills, the avatar disc and the reroute advisory at 40%. They are small tints under accent text, not page surfaces; the driver uses a neutral `successSoft #131816`, so the two apps differ here, and the owner may neutralise them (§14 #7).
- **Accent elements:** primary buttons, the active tab, "Following", accent links and outlines; since fix round 3 also the manager's Fleet LIVE marker and the driver's GPS disc, dot and truck arrow (§14 #16).
- **Driver map data pins:** re-certification: "not measured". Measured by audit 2: after a Fuel search in Dark, 2 FUEL pins rendered `#15803D` (`recert/audit2/driver/a2-navigate-fuel-dark-450x800.png`), a green data pin (REG-5, P3). Final: FUEL `#6D28D9` and TYRES `#475569`, as the manager's POI tokens; 0 px of `#15803D` after the same search (`recert/final/driver/navigate-fuel-dark-450x800.png`). Final verification: FUEL `#6D28D9` (17 pins), REST `#CA8A04`, TYRES `#475569` (40), identical in Light (`final-verify/driver/shots/mapcol-quick-{fuel,rest,tyres}-*`).

### Dark-theme block (brief §18)

| Screen | DARK_BG_VISUAL | GREEN_USAGE | MAP_LABELS_READABLE | PHOTO_TINT |
|---|---|---|---|---|
| Manager Region | BLACK/NEAR-BLACK; the forest photo shows under a neutral scrim | ACCENT_ONLY (outline on a neutral fill) | yes | NEUTRAL scrim over a green photo |
| Manager Login | BLACK/NEAR-BLACK | ACCENT_ONLY; the disabled Log In is a green bar (§16.3 #12) | n/a | NEUTRAL |
| Manager Overview | BLACK/NEAR-BLACK | ACCENT_ONLY (plus REG-10 tints) | yes | NEUTRAL |
| Manager Fleet | BLACK/NEAR-BLACK | ACCENT_ONLY (POI pins violet/red/slate/amber/blue; the LIVE marker is the accent since fix round 3) | yes | n/a |
| Manager Trips | BLACK/NEAR-BLACK | ACCENT_ONLY; the disabled Create draft trip is a green bar (§16.3 #12); "Driver asked for a new road" is the warning tone `#E6AE4A` | yes | n/a |
| Driver Login | BLACK/NEAR-BLACK | ACCENT_ONLY | n/a | NEUTRAL |
| Driver Navigate | BLACK/NEAR-BLACK | ACCENT_ONLY; FUEL pin violet since the final round (green at the re-certification, REG-5); the GPS marker is the accent since fix round 3 (was `#087F5B`) | yes | NEUTRAL |
| Driver Safety | BLACK/NEAR-BLACK | ACCENT_ONLY | n/a | NEUTRAL |
| Driver More | BLACK/NEAR-BLACK | ACCENT_ONLY | n/a | NEUTRAL |

### Light

- **Manager.** 0 text AA failures on 21 states (minimum 4.53:1; 4.27:1 on large text over the photo). Audit 2 matched Overview (4.56:1), Trips (5.77) and Fleet (5.36).
- **Driver.** Green on the forest tab bar, the active pill and forest CTAs. Hero text over photos at least 4.97:1 (small) and 3.39:1 (large).
- **Final verification.** Manager: 0 text AA failures in all 42 captures at 1600 and all 463 matrix cells; minimum contrast Region 4.85, Login 4.27 (large text over the photo), Overview 4.56, Fleet 5.36, drawer 4.53, Trips 5.77, Trip review 4.53, Notifications 5.48, Diagnostics 5.12. Photo credits 14.1–19.9:1 over the photos. The only runs below AA are `aria-hidden` decoration (the Light Region map label "Mizoram" 2.22:1, separators) and disabled controls. The first Light Fleet-drawer frame caught over-zoomed parent map tiles while the child tiles loaded; 8 s later the tiles are sharp (`proof-fleet-drawer-light-1600x900-settled.png`). Driver: 0 flat-surface low-contrast runs in 739 captures; Light map colours unchanged value for value; the Light Leaflet container behind the tiles is Leaflet's default `#DDDDDD`, not `MAP_LIGHT.ground` `#E8EDEB` (seen, not a defect).

### Wording, switching, persistence

- 0 Day/Night wording in either app (re-certification scans; the final round's new strings are "Loading guidance…", "Still offline…", "No driver is asking for help", "no SOS is open on this trip now", "Starts at a different point…" and the location footer).
- Switching causes no request; the choice survives reload and sign-in; no light flash (re-certification, `recert/perf/raw/theme-switch-requests.json`). The final round switched the driver theme from More several times during its runs; it did not measure requests around those switches.
- **Final verification.** Wording: 0 "Day"/"Night" theme words in 21 manager states and 739 driver captures, in source and in the 30 manager and 4 driver shipped bundle files; the profile menu offers only "Light" and "Dark"; the only case-insensitive "day" on screen is Diagnostics' "30-day mean"; the two driver `phrases.ts` keys "Day"/"Night" are unreferenced time-of-day words (DEAD-1; deleted in fix round 4, so the source scan now finds 0 in code, `final-fix/regression/hygiene_scan.txt`). Switching: manager, 8 profile-menu switches each on `/fleet` and `/states` gave 0 requests within 300 ms (the requests while toggling are the pages' own 10 s polls, the same cadence as a 20 s window with no switch); the perf lane's 24 timed and 120 probe switches gave 0 non-API requests, and every API request in a switch window was a scheduled poll (10.0–10.9 s or 14.6–16.0 s since the previous one). Driver: 0 non-API requests; only the `/api/driver/me/trip` poll. Input-to-next-paint medians (Event Timing), unthrottled: manager Overview 16 ms, Fleet 24 ms; driver 16 ms (`final-verify/manager/theme/theme-requests.json`, `final-verify/perf/raw/theme-probe-mobile.json`).

---

## 4. Responsive matrix

### Manager (`recert/manager/responsive/summary.json`, `zoom200/zoom200.json`, `menu/menu.json`; final verification: `final-verify/manager/responsive/summary.json`, `zoom200/zoom200.json`, `zoom200/recheck-fleet-drawer.json`)

462 cells: Region and Login plus 19 signed-in states × 11 widths × 2 themes. The final verification re-ran all 462 on the round-3 code, plus one cell (the SOS dossier at 2560 Dark) that became openable while another lane's SOS was open: 463.

| Gate | First run | Re-certification | Final round | Final verification |
|---|---|---|---|---|
| HORIZONTAL_OVERFLOW | 0 | **0** | not re-run; the changes add no box except a 6 px negative-margin scroll box inside the Fleet card | **0** of 463 |
| Controls clipped / unnamed / dialogs that do not fit | 0 / 0 / 0 | 0 / 0 / 0 | — | **0 / 0 / 0**; the live dossier at 2560 Dark fits, 6 controls, 0 unreachable |
| OFFSCREEN_PRIMARY_CONTROL | up to 24 cells | **0** (every row action counted) | — | **0**; controls reachable only by sideways scroll 0 |
| Text overlap | 1 (RESP-3) + AUD-10 | **0** (script taglines by design) | SCHEM-1 callout overlap fixed (live) | 32 cells are the script taglines (by design, as before) and 1 false positive (the profile menu at 1920 Dark over a KPI hint it covers; crop checked) |
| Sticky under the topbar | 8 cells | **0** | — | **0** |
| 200% zoom | main at y≈400 | overflow 0; main at y=148 | — | 38 states at 683×384 DPR 2: overflow, clipped, off-screen, sideways-only and overlap all 0; every dialog fits or scrolls; main at 148 px; only rail labels fold into the Menu. The Fleet details panel was re-checked on a fresh page (0 overflow, 0 clipped, 0 words lost against 100%) because the harness's second row click had unselected the trip in this run and in the re-certification (FV-M-1). Fix round 4 fixed the harness: `s6_zoom.mjs` (both copies) now leaves the page before reopening a clicked state at 200%. It was not re-run |
| Phone Menu | — | folded by default; MENU-1 (P2), MENU-2 (P3) open | **MENU-1 and MENU-2 fixed**, live at 390 | unchanged |
| Lazy routes | — | 0 blank frames on a slow chunk; **FAIL on chunk error (LAZY-1)** | **LAZY-1 fixed**; a slow chunk shows "Loading…" (LAZY-2 fixed) | not re-run (no change since) |
| Reroute attention (new) | — | — | — | Fleet row and Trips phone card at 320 Dark pass every gate |

### Driver (`recert/driver/shots/capture.json`; final: `recert/final/driver/large-*.jsonl`, `large-*.txt`; final verification: `final-verify/driver/agg.txt`, `r-large-*.json`, `r-s13.json`, `r-s16.json`)

| Check | Re-certification | Final round | Final verification |
|---|---|---|---|
| HORIZONTAL_OVERFLOW | 0 of 594 (and 0 of 48 ManagerRoot) | 0 in every final-round check (360, 412, 450; ×1.0/×1.3/×1.5; both paths) | **0 of 739** measured captures (339 at 360×640, 98 at 412×915, 56 at 480×1040, 56 at 768×1024, 182 at 450×800 and 8 at 360×340 with the keyboard open); `shots/` holds 740 files, 183 of them at 450×800 |
| Targets under 48 CSS px / unnamed | 0 / 1 role-less focusable (RC-DRV-03) | RC-DRV-03 fixed (live) | **0 / 0**; the tab bar never covers the last control at the bottom scroll position |
| Keyboard open (360×340) | 38/38 | not re-run (screens unchanged) | **38/38** in both themes (assistant keeps ≥120 px of conversation) |
| **Large text at 360×640** | **Per theme: CSS 34/48** = More, Details, Assistant, Translator, Tutorial 30/30, Safety 4/6 (mid-word, web-only), **Trip 0/6** (addresses cut), **Navigate 0/6** (RC-DRV-01/02); **Android 36/48** = the same, except Safety 6/6. The re-certification text said "More, Details, Assistant, Translator and Tutorial pass; active-trip Navigate fails; Safety breaks mid-word on the CSS path" and left out Trip (audit 2). | **Trip and Navigate 9/9 in each of 8 runs = 72/72** (CSS and Android paths × Light and Dark; ×1.0, ×1.3 and ×1.5 at top, middle and bottom; each check also scans the whole page for cut text and mid-word breaks, which the viewport-only check had missed below the fold). Whole-page scans: More at 450, 0 cut at ×1.3/×1.5 on both paths; Safety at 360, 0 on the Android path and the known web-only mid-word breaks on the CSS path. | Active trip, guiding (observed on the E2E trip): **Android 49/51, CSS 47/51 per theme.** Both paths cut the guidance card's "Then … Keep slight right onto …" line at ×1.3 and ×1.5 (FV-DRV-01; the final round's 72/72 were measured where that line was short); the CSS path also breaks Safety mid-word ("emergenc\|ies", "Ambulan\|ce"). Browse mode (Trip and Navigate): 15/15 on both paths and themes. **Fix round 4:** FV-DRV-01 fixed. At 360×640 on the live trip the "Then" line was not cut in any of 12 probes: both paths, ×1.3 and ×1.5, Dark and Light, with "Then Continue slight left onto NH37" and "Then Continue onto G.S. Road". At ×1.5 it took 3 lines (`final-fix/e2e/then-check.jsonl`). The whole-page scan was not re-run. |
| Large text at 412 and 450 | not measured | Android path: Trip, Navigate and Safety 0 cut at ×1.3/×1.5 after FINAL-1 (Safety tools and Navigate route tiles stack by width over font scale). CSS web-only path: Safety tools cut at 412 and 450, and at 450 two Navigate route tiles ("No weather flag", "Terrain · max grade 17%"). | Android path 21/21 at 450 and at 412 (the trip closed during the run, so Navigate was mostly in browse mode). CSS path 14/21 at each: the browse quick actions "Lay-bys & rest", "Puncture & tyres", "Request help" and the Safety tool lines cut or break mid-word (FV-DRV-03, web-only) |
| Safe areas (24/34) | photo under the status bar; no scrim once scrolled (RC-DRV-08) | unchanged | Both themes, 10 screens: the chip, title and first control move down 24 px, the tab bar bottom sits at 756 (790 without), the hero still starts under the status bar, scroll width 450; RC-DRV-08 unchanged |
| Cut text at normal size | road name lost at 360 (RC-DRV-01) | fixed at 360; the alert evidence line, cut at 450 at normal size, now wraps | nothing cut except the intentional one-line pickup address on the ASSIGNED card |
| GPS chip | honest wording | unchanged; "Rerouting" and "new road 82.9 km awaits manager" seen live off route | "Rerouting" and "new road 88.1 km awaits manager" live, then "Following" on the new road (E2E) |
| OSM attribution (RC-DRV-09) | covered under large text | clear at normal size; web large text not re-measured | **fixed:** 108 probes, 0 overlays; fully visible at some scroll position in all 36 combinations |

---

## 5. Accessibility

| Area | Manager | Driver |
|---|---|---|
| Text contrast (AA, on real pixels) | 0 failures on 42 page states, the roles and the dossier (re-certification). Minimum 4.53:1 (Light) and 5.35:1 (Dark). | 0 failures on opaque grounds. Hero text: Light 4.97:1 small / 3.39:1 large; Dark 16.8 / 7.56. |
| Non-text contrast | Fields 3.49–4.2:1; selected states 3.85–12.6:1. | — |
| Focus visible | Credit rings 100% (A11Y-2); map rings 96–100% (A11Y-3), except the round OSM attribution toggle at 66.7% on the square-perimeter metric (its close-up shows a whole circular ring; FV-M-2 corrects the range); **A11Y-8 fixed** (the Fleet table's first-column ring is whole). | Every stop shows a ring. |
| Focus order | 12 pages × 2 themes, 0 back-steps. | Navigate complete in both directions (CERT-DRV-01); **RC-DRV-06 fixed** on Navigate (controls before the map); the More part was refuted. |
| Focus not obscured | PASS (A11Y-1). | n/a |
| Focus after navigation or close | Image credits, profile drawer, Assign a Truck, Change journey and the profile menu return focus. **DOSSIER-1 fixed** (tests; live in both themes and by both close paths in fix round 4) and **MENU-1 fixed** (live). | Language sheet and Image credits open on "Close" (CERT-DRV-06; **RC-DRV-03 fixed**, live). |
| Dialogs | Focus trapped; Escape closes; the dossier returns focus (DOSSIER-1). **MENU-2 fixed:** Escape folds the Menu. | Stop sheet: Send aria-disabled while empty. |
| Landmarks and names | App pages: 1 banner, 1 main, "Main navigation", "Sidebar". Region and Login: banner and main; **A11Y-7 fixed**, the credit is in the "Photo credit" complementary landmark and 0 focusables are outside a landmark. | One `tablist` with 4 tabs. **RC-DRV-04 fixed:** "Fuel: search this area". |
| Error announcement | **LAZY-1**: a chunk failure is a `role=alert` in the page area with a working "Try again"; a slow chunk is a `role=status` "Loading…" (LAZY-2). | "Loading guidance…" while directions load (RC-DRV-11, code). |
| Reduced motion | 0 transitions over 0.02 s under reduce. | Leaflet moves use `animate: !reduceMotion()`. |
| Resize text | n/a (200% zoom passes) | **Fixed on the device path** (RC-DRV-01/02, AUD2-02, FINAL-1; FV-DRV-01 on both paths in fix round 4); the web-only CSS emulation still breaks Safety and the browse quick actions (FV-DRV-03). The map attribution is clear since fix round 3 (RC-DRV-09). |

**Final verification** (`final-verify/manager/keyboard/`, `landmarks-pre.json`, `pre-extra.json`, `summary-1600.json`; `final-verify/driver/r-s10-*.json`, `r-s12.json`, `r-large-*.json`; `final-verify/e2e/dossier_open_*.json`):

- **Manager.** 0 unnamed interactive controls and 0 text AA failures in all 42 captures at 1600 and all 463 matrix cells. Tab walk: Trips 39 stops and Fleet 44 in each theme, skip link → Main navigation → header → main, 0 back-steps, 0 stops without `:focus-visible` or a ring; Shift+Tab from the end of `main` puts 0 stops under the sticky topbar (scroll padding 116 px, topbar 104 px). Rings: the sign-in credits 100% at 3:1 in both themes (white 2 px ring, worst 5.37–14.14:1), Overview credit 100%, Region scope radio passes (3 px), zoom-in 100%, zoom-out 98.6%, map canvas 96.5–98.6%, 2D 100%, Terrain 98.9%, Fit fleet 96.1–99%, legend checkbox, POI chip, search and row trip 100%; the attribution toggle 66.7% (round control, FV-M-2). Landmarks: every signed-in state has 1 banner, 1 main, "Main navigation" and "Sidebar"; Region and Login have 1 banner, 1 main and the "Photo credit" complementary landmark, with 0 focusables outside a landmark. **Dossier live** (E2E, a real SOS). In both themes, focus opens on "Close incident dossier" inside the dialog; `dossier_open_{dark,light}.json` record only this focus-in. The focus return is in `notes.jsonl`, once per path: Escape in Dark and the X in Light. After Resolve, focus goes to `main#main-content`. **Fix round 4** walked the rest live in both themes (`final-fix/e2e/dossier-walk.jsonl`):
  - 25 Tab and 25 Shift+Tab presses stayed inside the dialog. The stops were Close incident dossier, Call driver, the resolve note, the false-alarm box, Close, and Confirm & Resolve Incident.
  - Escape and the X each returned focus to "View Incident Dossier", in Dark and in Light. "Review new road" on the Trips row is described by its Attention cell, and Fleet's "Route options" by the detail box (fix round 3, `aria-describedby`; not audited live).
- **Driver.** Navigate Tab order while guiding, at 360 and 450: search, Back, SOS, Map layers, Re-centre, Route overview, Map region, the Leaflet link, View route details, Find a place to stop, Acknowledge alert, Route details, three "Show route details" controls, the footer photo credit, then the tabs; in browse mode the four quick actions come after the Leaflet link. Shift+Tab is the exact reverse, there are no traps, the map region is the only focusable in the map, and the ring shows. Trip, Safety and More follow reading order; Image credits and Language keep focus inside. Resize text: see §4 (FV-DRV-01 fixed in fix round 4; FV-DRV-03 and Safety on the web CSS path only); RC-DRV-09 fixed. Seen, not scored: at ×1.5 the speed gauge's "km/h" label sits on its ring on both paths; five controls open the same route-details sheet, three of them named "Show route details".

---

## 6. Performance

### Final verification: four builds in one session (`final-verify/perf/summary.json`, `raw/`, `logs/`)

**Method.** The re-certification's harness (production builds served over gzip HTTP/1.1 against the cert API; Chrome 153 headless; a new browser context per run; 3 runs, medians; manager 1600×900 DPR 1; driver 390×844 DPR 2 with touch; "Mobile" = 150 ms RTT, 1.6 Mbps down, 750 kbps up, 4× CPU) with three changes: every build is served from one loopback origin (`http://localhost:8123`, with `image/avif`) whose root switches before each cold run; each run visits the four builds back to back, in an order that rotates per run and screen; and the driver signs out through the UI after every run. Builds: **snap** = the pre-redesign snapshot `d88c503`; **c1** = the first certification's build; **r2** = the re-certification's; **now** = the working tree after fix round 3 (manager entry `index-B47ZPbn-.js`). Flag rule, as in the re-certification: a regression is flagged when it is more than 10% **and** at least 20 ms slower than snap in the same session.

**The session was quiet.** c1 reproduced its first-certification absolute numbers (theme switch 16 ms, driver Navigate 27 ms), which confirms that the re-certification's 5–7× slowdowns were environmental, as it said. Absolute numbers from different sessions are history only; every judgement below is same-session.

| Measure | snap | c1 | r2 | now | now vs snap | Status |
|---|---|---|---|---|---|---|
| Manager entry JS, raw / gzip (Vite) | 518.15 / 154.21 kB | 577.42 / 173.47 | 333.17 / 105.47 | 336.89 / 106.51 | −35.0% / −30.9% | PASS |
| First-load JS on the wire: Region, Login, Overview | 153,219 B (1 script) | 172,495 (1) | 109,129 (3) | 109,232 (2) | −28.7% | PASS |
| Fleet as the first route, JS on the wire | 410,229 B (4) | 430,574 (4) | 400,930 (12) | 404,364 (13) | −1.4% | PASS |
| Index CSS, raw / gzip; on the wire | 50.57 / 10.31 kB; 10,483 B | 77.52 / 15.88; 15,986 | 79.39 / 16.40; 16,509 | 73.95 / 15.55; 15,659 | +46.2% / +50.8%; +49.4% | PARTIAL (PERF-6, P3): render-blocking, about +84 ms per request on mobile; FCP is still earlier than snap |
| First useful render, fast: Region / Login / Overview | 243 / 238 / 315 ms | 248 / 240 / 381 | 58 / 57 / 122 | 68 / 59 / 124 | −72.0% / −75.2% / −60.6% | PASS |
| First useful render, mobile | 1567 / 1577 / 2223 ms | 1670 / 1726 / 2467 | 1390 / 1407 / 2163 | 1358 / 1379 / 2148 | −13.3% / −12.6% / −3.4% | PASS |
| FCP, mobile: Region / Login / Overview / Fleet | 1324 / 1336 / 1364 / 1376 ms | 1432 / 1488 / 1500 / 1508 | 1140 / 1168 / 1192 / 1180 | 1124 / 1136 / 1176 / 1188 | −13.7% to −15.1% | PASS |
| LCP, mobile: Region / Login | 1768 / 1764 ms (text) | 3232 / 3272 | 2924 / 2720 | 2684 / 2608 (the AVIF hero) | **+51.8% / +47.8%** | PARTIAL (**PERF-3**, P2, owner decision §14 #2) |
| LCP, mobile: Overview / Fleet | 2244 / 2312 ms | 2272 / 2464 | 1968 / 2332 | 1932 / 2672 | −13.9% / **+15.6%** | Overview PASS; Fleet flagged (**FPERF-1**, P3) |
| LCP, fast: Fleet | 332 ms | 372 | 428 | 432 | **+30.1%** | flagged (**FPERF-2**, P3) |
| Fleet map, mobile: first tile / first truck marker | 6038 / 4261 ms | 5824 / 4206 | 5812 / 4254 | 5665 / 3898 | −6.2% / −8.5% | PASS (RPERF-2 fixed, now re-timed) |
| Fleet map, fast: first tile / first truck marker | 933 / 620 ms | 976 / 660 | 993 / 713 | 1040 / 718 | +11.5% / +15.8% | flagged (FPERF-2) |
| Manager theme switch, fast, Event Timing median: Overview / Fleet | — | 16 / 24 ms | 16 / 24 | 16 / 24 | — | PASS. Mobile, 20 switches per page per build on a settled page: Overview 48 / 48 / 40 ms, Fleet 64 / 64 / 68 ms (c1 / r2 / now); 0 non-API requests |
| Driver launch to sign-in usable, fast / mobile | 182 / 4090 ms | 166 / 4301 | 166 / 4240 | 164 / 4263 | −9.9% / +4.2% | PASS |
| Driver sign-in to Trip usable, fast / mobile | 116 / 912 ms | 131 / 944 | 127 / 930 | 139 / 917 | **+19.8%** (+23 ms) / +0.5% | fast flagged (**FPERF-3**, P3) |
| Driver main JS on the wire | 603,061 B | 622,305 | 623,204 | 624,478 | +3.6% | PASS |
| Driver tab, first visit, fast, click to selected: Navigate / Safety / More | 24 / 14 / 7 ms | 27 / 19 / 11 | 28 / 21 / 10 | 28 / 20 / 10 | +4 / +6 / +3 ms, under one frame (not flagged) | PASS; settled Navigate 43 → 407 ms (photo decode, Leaflet, tiles) |
| Driver tab, first visit, mobile, click to selected | 142 / 92 / 48 ms | 186 / 130 / 80 | 191 / 140 / 67 | 172 / 121 / 58 | **+21.1% / +31.5%** / +20.8% (+10 ms, not flagged) | PARTIAL (**PERF-4**, P2, owner decision §14 #3; APK confirmation to follow) |
| Driver tab, first visit, mobile, settled | 317 / 92 / 48 ms | 785 / 208 / 112 | 773 / 227 / 95 | 662 / 199 / 84 | +109% / +116% / +75% | PARTIAL (PERF-4) |

The driver was measured with no active trip in all 33 runs; the with-trip tab switch is UNAVAILABLE (no trip may be created for perf).

**Image bytes on the wire at load**, cold cache, unthrottled (`final-verify/perf/raw/mgr-bytes.json`). The snapshot has no photos (it fetches only the 511 B brand mark).

| Screen | Viewport | c1 | r2 | now (file) | now vs r2 |
|---|---|---|---|---|---|
| Region | 1366×768 | 177,797 B | 125,613 | 97,106 (`mawkdok-1280.avif`) | −22.7% |
| Region | 1600×900 | 177,797 | 177,797 | 132,119 (`1600.avif`) | −25.7% |
| Region | 2560×1440 | 462,549 | 235,223 | 177,109 (`1920.avif`) | −24.7% |
| Region | 390×844 @1 / @2 / @3 | 166,035 | 125,613 / 235,223 / 235,223 | 97,106 (`1280.avif`) at each | −22.7% / −58.7% / −58.7% |
| Login | 1366 / 1600 / 2560 | 82,538 / 173,047 / 279,897 | 62,532 / 129,879 / 211,047 | 50,498 / 106,775 / 165,887 (`960`/`1440`/`1920.avif`) | −19.2% / −17.8% / −21.4% |
| Login | 390 @1–@3 | 0 | 0 | 0 (panel hidden) | — |
| Overview card (signed in) | 1366 / 1600 / 2560; 390 @1 and @2 | 68,216 (390: 164,611) | 68,216 | 55,674 (`khasi-truck-800.avif`) | −18.4% |
| Overview card | 390 @3 | 164,611 | 164,611 | 130,167 (`khasi-truck-1280.avif`) | −20.9% |

Every "now" load fetches at most one photo file, so there is no double download; Login below 1024 px fetches none, because its panel is hidden. The 12 Region and Login loads carry one image preload, React's AVIF preload (`type=image/avif`, `media=(min-width: 1024px)`, `fetchpriority=high`); the 6 Overview loads carry none. Scrolling everything into view fetches no further photo. Driver photos are unchanged since the first certification: 700,364 B over all tabs on the web (Login 185,013; Navigate 236,505; Safety 159,493; More 119,353), 0 B on Trip.

**PERF-3 experiment** (`final-verify/experiment/`, reverted; `manager-web/index.html` is byte-identical to before, SHA-1 `0d087ac0…`). An inline script in `index.html` preloaded the Region or Login hero (the same AVIF set, `media=(min-width: 1024px)`) before the entry module ran, only for a signed-out visit to `/`. On the mobile profile at 1600×900 it cut the LCP by 20.2% (Region, 2648 → 2112 ms) and 17.8% (Login), but pushed FCP back by about 500 ms (+44%) and the usable form by about 490–530 ms (+35–39%), because on HTTP/1.1 the photo shares the 1.6 Mbps link with the entry JS and CSS; `fetchpriority=low` did not help. Adding the preload at DOMContentLoaded had no FCP cost but saved only 5.6% / 6.4% at 1600×900. It also downloaded a 97–132 KB hero it never showed for a signed-in visit to `/` with no `ner:cache:*` key (for example the reviewer role). Nothing was kept; the trade-off is §14 #2's.

**Performance defects (final verification):** PERF-1, 2, 5 and 7 fixed (re-certification); RPERF-1 fixed (final round) and RPERF-2 fixed and re-timed; **PERF-3 (P2) open** as an owner decision, 8.2% / 4.1% better than r2 with AVIF; **PERF-4 (P2) open** as the §14 #3 owner decision; it was measured on the web, its fix needs no device, and an APK measurement is the follow-up. It is 10–14% better than r2 on mobile, but within run spread; PERF-6 (P3) partly fixed (−5.1% on the wire vs r2, still +49.4% vs snap); new **FPERF-1** (P3, the Fleet text LCP pays for RPERF-2's parallel map download), **FPERF-2** (P3, React's 300 ms Suspense reveal throttle on the lazy Fleet route, present since r2), **FPERF-3** (P3, +23 ms sign-in to Trip on a desktop-class CPU) and **FPERF-DOC** (this section; applied here). Not flagged after a controlled re-check: the manager mobile theme switch in the 3-run timing (refuted by the 20-switch probe) and Overview "Show live map" on mobile (noise: equal first runs, identical bytes and unthrottled times). Not measured: HTTP/2 or a CDN (HTTP/1.1 here exaggerates the contention behind FPERF-1 and the preload trade-off), browsers without AVIF, the driver with an active trip, and the APK.

**Fix round 4 was not re-timed.** Its changes add one trip read when an open review's row changes and one fleet read after a route decision, and they filter the maneuver list once per package. The manager build is the same size (entry 336.92 / 106.55 kB) with the same CSS file (`index-C7eS2s4_.css`, 73.95 / 15.55 kB). The driver bundle has one more module (555).

### Re-certification and final round (history)

**Method** (`recert/perf/summary.json`, `raw/`, `logs/`). Production builds (manager `vite build --mode remote-demo`; driver `expo export --platform web`) served over gzip HTTP/1.1 against the cert API, Chrome 153 with GPU, a new browser context per run, 3 runs, medians. Manager at 1600×900 DPR 1, driver at 390×844 DPR 2 with touch. "Mobile" = 150 ms RTT, 1.6 Mbps down, 750 kbps up, 4× CPU.

**Environment caveat** (settled since: the final verification's quiet session confirmed it was environmental). The re-certification session was far noisier than the first run: the first run's own build (`c1`), re-measured in the same session, gives 72 ms for a theme switch (16 ms then) and 165 ms for driver Navigate (22 ms then). Absolute times are not comparable across sessions; every judgement below uses the same-session pre-redesign snapshot (`d88c503`) and `c1`.

| Measure | First cert | Re-certification | Snapshot (same session) | Re-cert vs snapshot | Status |
|---|---|---|---|---|---|
| Manager entry JS (raw / gzip) | 577.42 / 173.47 kB | 333.17 / 105.47 kB | 518.15 / 154.21 | −35.7% / −31.6% | PASS (PERF-1 fixed) |
| First-load JS on the wire | 172,495 B | 109,129 B | 153,219 B | −28.8% | PASS |
| Manager index CSS | 77.52 / 15.88 kB | 79.39 / 16.40 kB | 50.57 / 10.31 | +57.0% / +59.1% | PARTIAL (PERF-6) |
| First useful render, mobile: Region / Login / Overview KPIs | 1742 / 1714 / 2494 ms | 1386 / 1438 / 2001 ms | 1601 / 1612 / 2079 | −13.4% / −10.8% / −3.8% | PASS (PERF-2 fixed) |
| FCP, mobile | 1484–1500 ms | 1160–1188 ms | 1360–1376 | −13.5% to −15.2% | PASS (PERF-5 fixed) |
| LCP, mobile: Region / Login | 3352 / 3316 ms | 3076 / 2772 ms | 1832 / 1856 | **+67.9% / +49.4%** | PARTIAL (PERF-3 open) |
| LCP, mobile: Overview / Fleet | 2224 / 2432 ms | 1912 / 2312 ms | 2108 / 2228 | −9.3% / +3.8% | PASS |
| Fleet map, mobile: first tile / first truck marker | 5580 / 3967 ms | 6527 / 4872 ms | 6282 / 4370 | +3.9% / +11.5% | PARTIAL at the re-cert (RPERF-2) |
| Theme switch (manager, driver) | 16–76 ms | 48–560 ms | — | environment, not code (JS 0–50 ms) | PASS |
| Driver launch, sign-in to Trip, main JS | — | +0.5% / −2.1%; −6.4% / −28%; +3.3% | — | — | PASS |
| Driver tab switch, fast: Navigate / Safety / More | 28 / 20 / 11 ms | 161 / 116 / 63 ms | 153 / 81 / 39 | +5.2% / **+43.2% / +61.5%** | PARTIAL (PERF-4 open) |

**Image bytes fetched, cold cache** (`recert/perf/raw/mgr-bytes-cur.json`; final: `recert/final/manager/checks.json`):

| Screen | Viewport | First cert | Re-certification | Final round |
|---|---|---|---|---|
| Region | 1366×768 | 177,797 B | 125,613 B (1280w) | unchanged |
| Region | 1600×900 | 177,797 B | 177,797 B | 177,862 B on the wire (PERF-3) |
| Region | 2560×1440 | 462,549 B | 235,223 B (1920w) | unchanged |
| Region | 390×844 @1 | 166,035 B | 125,613 B | unchanged |
| Region | 390×844 @3 | 166,035 B (1280w) | **235,223 B** (1920w, RPERF-1) | **125,678 B** (1280w; RPERF-1 fixed with a phone slot in `sizes`) |
| Login | 1366 / 1600 / 2560 | 82,538 / 173,047 / 279,897 B | 62,532 / 129,879 / 211,047 B | unchanged |
| Overview card | 390 @1 / @3 | 164,611 B | 68,216 / 164,611 B | unchanged |

**Final round, not re-timed with the perf harness.**
- The production entry is **335.61 / 106.12 kB** gzip (was 333.20 / 105.50: the route boundary and the Overview and Reports changes); index CSS 79.44 / 16.40 kB; 0 INEFFECTIVE_DYNAMIC_IMPORT; the >500 kB warning is still the MapLibre `mapSetup` chunk (969.93 kB).
- **RPERF-2 fixed in structure:** the built entry's Fleet loader starts `import("./FleetMap-*.js")` (with its `mapSetup` preloads) in the same call as `import("./FleetPage-*.js")`, so the map chunk no longer waits for the page chunk. Its marker time was not re-measured then; the final verification re-timed it (above).

**Performance defects:** PERF-1, 2, 5 and 7 fixed (re-certification); RPERF-1 fixed and RPERF-2 fixed in structure (final); PERF-3 (P2) and PERF-4 (P2) open; PERF-6 (P3) open; PERF-8 superseded by RPERF-1. RPERF-DOC: this section was rewritten from `recert/perf/summary.json` by the re-certification, and the phone figure the fix-round-2 note got wrong is corrected above.

---

## 7. E2E lifecycle and RBAC

### Fix round 4 lifecycle, `TRP-82192454-4D98-4BD4` (23:53 IST on 28 Sep to 00:28 IST on 29 Sep): PASS

The manager UI ran as `regional` (Dark) and as `assam.sm` (Light, Assam scope). The driver web ran as Tenzing Bhutia (Dark; Light for the probes and captures that say so). Simulated GPS followed the route geometry. Fix round 4's code ran on the unchanged cert API. Evidence: `final-fix/e2e/notes.jsonl`, `drive.log`, `then-check.jsonl`, `dossier-walk.jsonl`, `dossier_open_{dark,light}.json` and 27 screenshots in `shots/`, key steps in both themes. Times are IST; the steps after midnight are on 29 Sep. Watchers timed every change on the page: `rvwatch.js` on assam.sm's Trips page, `fwatch.js` on regional's Fleet and `dwatch.js` on the driver.

1. **A3-02, at sign-in (23:43).** regional's Trips Attention column read "Needs a route" for TRP-DEMO-001 (ACTIVE, no route) and TRP-DEMO-002 (DELAYED, no route), as Overview does (`m00`, both themes).
2. **Plan (23:53:02).** The Trips form took Tenzing Bhutia, with truck AS01AB1003 filled in from the live pairing, and Guwahati → Shillong from the suggestions (straight line 68 km). `POST /api/trips/plan` 201. assam.sm opened the new draft's Trip Review at 23:53:35 and **left it open and unclicked until the trip closed**.
3. **Route and approval.** `recalculate?detailed=true` 201: 97.21 km, 72 min, osrm. REQUIRES REVIEW; approved with a reason and the not-SAFE box, `approve` 200 at 23:54:30.5 (`m01`). assam.sm's open review followed by itself at 23:54:32.4 (+1.87 s): "ROUTE SELECTED · DRAFT" with "Replan route", "Check conditions & review" and "Route assigned", 36 ms after its row turned "Ready to dispatch".
4. **Dispatch (23:54:44), accept (23:55:23), start (23:55:47), pickup (23:56:26 and 23:56:39).** All 200. assam.sm's review read ASSIGNED 60 ms after its row, then ACTIVE 125 ms after its row, and dropped "Replan route".
5. **Drive.** km 0 → 10.05 at 45–60 km/h with a fix every 3 s, and a 3 km/h crawl near km 8 for the FV-DRV-01 probes (§4). **FV-DRV-02, live:** approaching the km 9.87 roundabout, the card read "At the roundabout, take exit 1 / Then Continue slight left onto NH37". Just after the entry it read "230 m Continue slight left onto NH37 / Then Turn right". Before the fix it said "Then At the roundabout, take exit 1", and said it again after the entry.
6. **Off-route request (00:12:23.655).** From km 10.05 the offset ramped from 60 to 400 m, then held. The app asked for a road itself: `POST /api/driver/me/trip/reroute` 201, 88.12 km. The driver screen read "Guidance paused · Off the planned road · new road 88.1 km awaits manager", with the "Rerouting" chip.
7. **Manager attention.**
   - assam.sm's Trips row: +3.67 s.
   - **The Trip Review assam.sm had had open since 23:53:35:** "Driver asked for a new road · Proposed … · 88.12 km from where the truck was" with "Review new road", at +3.72 s. That was 52 ms after its row. The text was `rgb(138,75,9)`, the Light text-warning (`m03`, both themes). **FV-E2E-1 is fixed.**
   - regional's Fleet row and detail box: +7.49 s, one 10 s poll (`m04`).
8. **Approve the driver's road (00:13:49.177).** On Fleet, "Review new road" opened the Route tab. "Check route conditions" showed the backup as REVIEW REQUIRED. "Review & approve route" (reason and the not-SAFE box), then "Approve & reroute": `approve` 200.
   - Fleet re-read its snapshot at once (`GET /api/fleet/active` +0.21 s). The detail box went off at +0.24 s and the row at +0.25 s, with no flicker afterwards. **FV-E2E-3 is fixed.**
   - assam.sm's row read "On the road", and its open review's box was gone, at +3.19 s.
   - `trip_events` got ROUTE_CHANGED at 00:13:49.
9. **Driver (FV-E2E-2 fixed).** At +4.84 s, "Reroute approved" appeared on Navigate: Dark `#131816` with accent text, Light `#DFEFE4` with `#076C4D` (`d01`). At the same moment guidance switched to "120 m Turn right · Then Keep left", with the "Following" chip. The Trip tab showed "Reroute approved · Your manager approved a new road. Open Navigate to follow it." (`d02`, both themes).
10. **SOS (00:19:23).** Trip tab, "Emergency: request trip stop", reason, Send request: `stop-request` 200. The driver saw "SOS sent: your manager has been alerted". The "SOS 1" badge appeared at +2.60 s for assam.sm and +9.07 s for regional (10 s poll).
11. **Dossier** (regional, Fleet), in Dark and then in Light:
    - Focus opens on "Close incident dossier". 25 Tab and 25 Shift+Tab presses all stayed inside. Escape returned focus to "View Incident Dossier"; reopened, the X returned it too.
    - The phone read `+••••••••••03` on the driver line and in SOP step 1. There was one `tel:` link (12 digits, ending 03) and 0 phone numbers in full; the one 8-digit run in the text is the trip code. SOP steps are numbered once (`dossier_open_{dark,light}.json`, `dossier-walk.jsonl`, `m05`).
12. **Resolve (00:22:25).** With a note, Confirm & Resolve: `resolve` 200. Focus went to `main#main-content`; both sessions' badges cleared within 0.3 s. `trip_events` got INCIDENT_OPENED and INCIDENT_RESOLVED.
13. **Deliver (00:25:07–00:25:35).** Delivery arrive 200, complete 200, then "Yes, delivery complete": `/complete` 200. The screen read "DELIVERED · Trip complete". **RE2E-2 reproduced:** the next trip poll (+8.5 s) returned no trip and the page became "No active trip". It still read that 90 s after delivery (`d03`). This was fixed afterwards in code and tests (§2 D5); the fix was not seen live.
14. **Close (00:27:56.911).** Row Close: `close` 200. DB: CLOSED, and Tenzing Bhutia and AS01AB1003 AVAILABLE. assam.sm's still-open review read CLOSED 0.47 s later (`m06`).
15. **A draft cancelled under an open review (FV-E2E-1, the cancel half).**
    - `TRP-211560AD-7A7D-4A44` was planned for the same pair (201 at 00:29:56.917) and opened in assam.sm's review: DRAFT, with "Plan route".
    - regional cancelled it from its row. The native confirm read "Cancel TRP-211560AD-7A7D-4A44?"; `cancel` 200 at 00:30:27.038.
    - The row left assam.sm's Open Trips at 00:30:30.196. At 00:30:30.225 (+3.19 s) the open review read "NO ROUTE SELECTED · CANCELLED", with no "Plan route" (`m07`, both themes).
    - This ran on the final manager code, which re-reads when the row leaves the list. Steps 2–14 ran just before that edit; it changes nothing while the row is in the list.
16. **Driving honesty.** About 15.1 km were driven: route 1 from km 0 to 10.05, plus the 0.3 km off-route leg; then the new road from km 0.03 to 3.2 and from 86.8 to 88.29. Two jumps were made, both disclosed: from the point 400 m off the road onto km 0.03 of the approved road, and 83.6 km from new-road km 3.2 to 86.8.

**End state** (read-only DB):
- `TRP-82192454-4D98-4BD4` is CLOSED and `TRP-211560AD-7A7D-4A44` CANCELLED. The only open trips are TRP-DEMO-001 (ACTIVE) and TRP-DEMO-002 (DELAYED). There are 36 trips and 5 emergencies, all RESOLVED.
- The lifecycle's `trip_events`: CREATED, ASSIGNED, ACCEPTED, STARTED, STOP_ARRIVED, STOP_COMPLETED, ROUTE_CHANGED, INCIDENT_OPENED, INCIDENT_RESOLVED, STOP_ARRIVED, STOP_COMPLETED, DELIVERED, CLOSED. There is no event for the approval or for the driver's request (E2E-R5; §14 #1).

**Sessions.**
- regional, assam.sm and the driver signed out through the UI: `logout` 204 each, at 00:31:45–00:32:01. Their three refresh families are revoked, with reasons `rotated` and `logout`.
- There was one refused sign-in: the harness first tried assam.sm on the North-East region, and the account is Assam-scoped. There was no 429.
- 4 Chrome profiles were created and all deleted.

Seen, not scored: after the reroute, Fleet's Route tab lists the old PRIMARY route as PROPOSED (the server's state).

### Final-verification lifecycle, `TRP-F0C0537E-2D0A-4AF7` (21:32–22:20 IST): PASS except two reroute parts (history; both fixed in fix round 4)

Manager UI as `regional` (both themes; key steps captured in Light and Dark) and as `assam.sm` for the scoped view, driver web as Tenzing Bhutia, simulated GPS along the route geometry, on the round-3 code with the round-3 backend (`final-verify/e2e/e2e-evidence.json`, `notes.jsonl`, `drive.log`, `alerts.log`, 82 screenshots in `shots/`). Times are IST.

1. **Plan (21:32:38).** Trips form: Tenzing Bhutia, truck AS01AB1003 filled in from the live pairing, Guwahati and Shillong from the suggestions; `POST /api/trips/plan` 201 (`m01`).
2. **Route and approval.** 97.21 km, 72 min, osrm, 4453 points. Conditions **REQUIRES REVIEW** (weather, terrain and warnings available; traffic UNKNOWN); the approval dialog showed 4 of 7 evidence items, landslide incidents UNAVAILABLE and history STALE; approved with a reason and the not-SAFE box, `approve` 200 (`m02`–`m04`).
3. **Dispatch (21:34:36) and accept (21:35:22).** The row read "ASSIGNED · Accepted — awaiting start" at the first check after the next poll (`m05`, `m06`, `d01`, `d02`).
4. **Start and drive (from 21:36:11).** Start 200; pickup arrive and complete 200; km 0–10 at 45 km/h. Guidance at km 10: "180 m Continue slight left onto NH37 · Then Turn right". 137 location POSTs returned 202 (`d03`, `d04`).
5. **Off-route request (21:52:22).** At km 10.05 the offset ramped 60 → 400 m and was held at 400 m. The app asked for a road itself: `POST /api/driver/me/trip/reroute` 201, EMERGENCY_BACKUP 88.12 km / 64 min. Screen: "Guidance paused · Off the planned road · new road 88.1 km awaits manager", chip "Rerouting" (`d05`). It came about 60 s after the last ramp fix, because the tracker keeps one fix per 60 s once the truck counts as parked; the harness had also re-set the GPS override once, about 1 m from the simulated point, just before, and that fix may be the one that triggered it.
6. **Manager attention (E2E-R2).** assam.sm's Trips row: "Driver asked for a new road" and "Review new road" **1.83 s** after the request, settled tone text-warning (`#8A4B09` Light, `#E6AE4A` Dark), never the success tone (`m11`, `m13`). Fleet, open with the trip selected: row and detail box **10.57 s** after (one 10 s poll) (`m09`, `m10`). A review opened after the request shows the warning box and the button (`m14`). **The review assam.sm had open since 21:41:46 never showed it, and clicking Open again did not re-read the trip (FV-E2E-1, P2)** (`m12`). All three "Review new road" buttons opened `/fleet` on the Route tab with the EMERGENCY BACKUP 88.12 km and "Starts at a different point from the current route…" (`m15`).
7. **Accept (21:57:14).** "Check route conditions" advised "No change advised", so there was no "Accept and reroute"; the backup card read REVIEW REQUIRED, and "Review & approve route" → "Approve & reroute" went through the moving-trip reroute path: `approve` 200; the backup became CURRENT/SELECTED (`m16`). `trip_events` got ROUTE_CHANGED ("route changed to EMERGENCY_BACKUP (88.12 km) by Regional Head"), shown as "Journey changed by Regional Head" (`m17`); the driver's request itself is in `audit_logs` only (E2E-R5).
8. **Driver switch.** Navigate switched 5.75 s after the accept: "90 m Turn right · Then Keep left", 88.1 km remaining, "Following"; later guidance led back onto NH37 (`d06`). **No foreground notice (FV-E2E-2, P3):** the REROUTE_APPROVED notice was written (delivery NO_TOKEN) and `/api/driver/me/notices` returns it, but the app does not show it.
9. **Attention clears.** regional's Fleet row and detail 7.8 s after the accept, assam.sm's Fleet 9.0 s after; the Trips rows went back to "On the road" and a fresh review shows no box (`m18`). The Fleet detail flickered off and on and kept the box until the next poll (FV-E2E-3, P3). The clear was read in the UI; the API reads were not queried directly after the accept.
10. **SOS (22:07:19).** `POST /api/driver/me/trip/stop-request` 200; the driver saw "SOS sent: your manager has been alerted" (`d09`). The "SOS 1" badge appeared **4.868 s** later for regional (Dark) and **0.521 s** for assam.sm (Light), on the 10 s badge poll (`sos_latency.json`, `m19`).
11. **Dossier.** Focus lands on "Close incident dossier" inside the dialog. The phone shows as `+••••••••••03` on the driver line and in SOP step 1, with 0 full numbers in the text; one "Call driver" `tel:` link holds 12 digits ending 03; no emergency contact is on file ("None listed"). SOP steps 1–4 are numbered once (`list-style: none`). The coordinates match `drive.log` (km 4.984). Escape (in Dark) and the X (in Light) each returned focus to "View Incident Dossier", once each. The source is `notes.jsonl`; `dossier_open_{dark,light}.json` record only the focus-in (`m20`).
12. **Resolve (22:09:09)** with a note: `resolve` 200; the dialog closed, focus went to `main#main-content` and the badge cleared. DB: RESOLVED by regional, exactly 1 audit row (STATUS_CHANGE, after RESOLVED, reason = the note). Journey History: "Incident opened by Tenzing Bhutia", "Incident resolved by Regional Head" (`m21`–`m23`).
13. **Deliver and close.** Arrive, finish and "Confirm delivery" 200 (delivered 22:15:04); the phone read "DELIVERED · Trip complete · Your manager can see the delivery. Location sharing has stopped." and Navigate "No active trip"; while DELIVERED the DB kept the driver and truck ON_TRIP and the row said "Close to release the truck". Close 200 at 22:15:51: CLOSED, and Tenzing Bhutia and AS01AB1003 AVAILABLE in the DB and on the Drivers and Trucks pages; the phone said "No active trip" (`d13`–`d15`, `m24`–`m26`).
14. **Re-plan and cancel.** `TRP-65D782CE-B00E-42FF` for the same pair, 201 at 22:17:34; cancelled from its row through the native confirm "Cancel TRP-65D782CE-B00E-42FF?", `cancel` 200 at 22:19:56; the pair stayed AVAILABLE (`m27`, `m28`). Its already-open review still said DRAFT with an enabled "Plan route" more than 3 minutes later (FV-E2E-1, `m29`). That button posts `/routes/recalculate?detailed=true`, which the server does not refuse for a finished trip. Audit 3 found this by reading the code (A3-01); nobody clicked it.
15. **Export.** Trips "Export CSV": `downloads/rasta-trips-2026-09-28-16-09.csv`, 3 data rows = "3 shown of 3 matching", no phone column, 0 phone-like digit runs.
16. **Driving honesty.** 17.4 km driven (route 1 km 0–10.46 with the off-route leg; new road km 0.034–5 and 86.4–88.29); 81.5 km skipped in two disclosed jumps (123 m onto the accepted road, and 81.4 km from new-road km 5.0 to 86.4).

End state (read-only DB): `TRP-F0C0537E-2D0A-4AF7` CLOSED, `TRP-65D782CE-B00E-42FF` CANCELLED; the only open trips are TRP-DEMO-001 (ACTIVE) and TRP-DEMO-002 (DELAYED); 0 open emergencies. All four sessions (regional, assam.sm, cert.nagaon, Tenzing Bhutia) signed out through the UI (`logout` 204 each; the lane's 4 refresh families revoked with reason `logout`); 4 Chrome profiles created and deleted. Seen, not scored: Close on a DELIVERED row has no confirm while Cancel does; the driver's Trip tab offered "Arrived at Delivery" 83 km from the destination; Fleet SPEED reads "Unavailable" for a LIVE truck (web fixes carry no speed); seed row TRP-DEMO-001 has Started (9/19 8:04 PM) before Created (10:04 PM) in the CSV.

### Re-certification lifecycle, `TRP-AFC3D6D6-6B8D-4132` (14:04–15:02 IST): PASS

Through the manager UI (Light for m01–m16, Dark for m17–m32) and the driver web (Dark) on simulated GPS (`recert/e2e/e2e-evidence.json`, `drive.log`, `shots/`). The lane's hand-off was cut off after its step E2E-12; the rest comes from its evidence files and a read-only DB check at about 15:45 IST.

1. **Plan (14:05–14:06).** De-duplicated suggestions (E2E-D7); Create disabled until a driver was chosen; `POST /api/trips/plan` 201.
2. **No-route gate.** Dispatch `disabled`/`aria-disabled` with its reason; a click sent 0 writes.
3. **Route and conditions.** 97.21 km, 72 min free-flow, osrm; **REQUIRES REVIEW** with 0 of 7 evidence available; approve with a 20+ character reason and the not-SAFE box; `approve` 200 plus an `audit_logs` row.
4. **Dispatch and reload** (14:08:42): the session survived the reload.
5. **Accept (14:13:26):** "ASSIGNED · Accepted — awaiting start" within 12 s (E2E-D4).
6. **Truck-check gate: BLOCKED** (the assignment was already verified).
7. **Start and drive (from 14:14:03).** The first landslide card showed at km 0 and was acknowledged at km 0.09. The Byrnihat site was announced at km 20.08 ("in 2.9 km"), changed to "here" at km 22.79 and was acknowledged at km 22.83. A new card came for almost every recorded site: `alerts.log` shows the card change at km 0.44, 0.55, 0.99, 1.52, 1.72 and 2.89, and "Recorded landslide site here" is used for sites 2.0–3.6 km off the road (**E2E-R3**, P3; `ahead.ts` ignored the off-road distance). 198 location POSTs returned 202.
8. **Off-route excursion (14:47:51–14:49:27): PARTIAL.** `POST /reroute` 201; EMERGENCY_BACKUP PROPOSED 75.05 km. Manager side **E2E-R2** (P2): no notification, attention or Journey History entry; the open Fleet detail kept "1 distinct road route"; Route options chipped the backup FASTEST and SHORTEST against the full 97.21 km route while about 72.3 km of the current road remained.
9. **Driver session (E2E-D1 fixed):** three silent refreshes.
10. **SOS (14:51:10):** "SOS sent"; the manager badge appeared 3.82 s later.
11. **Dossier.** Real data; coordinates match `drive.log`; the SOP list is numbered once (E2E-D8). The phone number was **not** masked in the UI: the "Phone:" line and SOP step 1 showed the full number (**E2E-R1**, rated P2 by the E2E lane; R6 covers only the Drivers profile drawer, phase-b3 mismatch-log row 22). The Fleet detail panel (`FleetPage.tsx:1163-1165`) and the server-built SOP step 1 (`backend/app/domain/sentinel.py:331`) also showed the full number. The first run's "masked to **03" came from the harness's own masking.
12. **Resolve (14:52:13; E2E-D2 fixed):** Journey History "Incident resolved by Regional Head" and an `audit_logs` row.
13. **Rest of the route.** The harness jumped from km 24.966 to km 95.0 (70.03 km not driven) and drove to km 97.38; 27.35 km driven in total (the first run skipped about 82 km; AUD-12).
14. **Delivery and close** (14:58:35 / 14:59:36); Tenzing and AS01AB1003 AVAILABLE.
15. **Re-plan and cancel** of `TRP-B1D7C606-22D1-47C8`.

The same trip showed two more E2E-lane items: **E2E-R5**, the incomplete-evidence approval and the driver's reroute request are in `audit_logs` only, with no `trip_events` row; and **E2E-R6**, "Then ↑ Turn straight" in the maneuver panel. **Exports:** Open trips 3 = UI; History 26 = DB; Reports 29 = DB but Driver, Truck and Attention empty (**REPORT-1** = E2E-R4). No phone numbers in any export.

### Final-round lifecycle, `TRP-EF31DD41-6DA9-4306` (17:10–18:05 IST): PASS

Manager UI as `regional` (Dark), driver web as Tenzing Bhutia (Dark, then Light for proofs), simulated GPS along the selected route (`recert/final/drive.log`, `summary.json`).

1. **Plan (17:10:57).** Client, weight, Tenzing Bhutia (truck AS01AB1003 paired), "Guwahati" and "Shillong" from the suggestions; `POST /api/trips/plan` 201.
2. **Route (17:11:14).** Plan route: 97.21 km, 72 min, osrm, the same geometry as the re-certification's (4,453 points). Check conditions: **REQUIRES REVIEW** (weather, terrain and warnings available; traffic unknown; landslide inventory to 2017).
3. **Approve (17:12:06)** with a reason and the not-SAFE box; `approve` 200.
4. **Dispatch (17:12:26)**; the driver accepted (the app moved to Navigate), started, arrived at and finished the pickup.
5. **Guidance.** At km 1.5, "Keep slight right onto Bhangagarh Flyover · Then Continue onto G.S. Road"; the large-text runs were measured here (§4) with a fresh fix every 3 s. Alert cards read "Recorded landslide site 2.0 km off the road, near here (2010)" and "… 1.0 km off the road, near here (2016)" (E2E-R3 fixed).
6. **Jump** km 1.68 → 16.6 (not driven), then km 16.6–18.0 at 50 km/h. At km 18 the panel read "60 km · Turn right · Then Continue" (E2E-R6 fixed; the next-but-one maneuver is the turn/straight at 92.5 km).
7. **Off route (17:50).** Drift 60 → 150 → 250 → 400 m off the line at km 18.05, held at 400 m. `POST /reroute` 201 at 17:50:30; the chip read "Rerouting" and the card "Off the planned road · new road 82.9 km awaits manager". On Fleet, the Route tab that had been open since 17:47 showed "2 distinct road routes" by about 17:50:46 without re-selecting the trip; the EMERGENCY BACKUP (82.87 km) says "Starts at a different point from the current route…" and neither road is chipped FASTEST or SHORTEST (E2E-R2 manager half fixed). No notification or trip event was created (E2E-R2 backend half, open).
8. **Back on route**, km 18.4–24.6 at 50 km/h: one landslide card at km 19.94 ("Recorded landslide site in 3.0 km (2015)"), acknowledged at once; no further card to km 24.6 (E2E-R3 cluster key, `recert/final/alerts-final.log`).
9. **Jump** km 24.6 → 96.4 (not driven), then km 96.4–97.38 at 30 km/h. In total 9.52 km were driven and 87.9 km were not: the fix went from the pickup (km 0) straight to km 1.2, and the two jumps above skipped 14.9 km and 71.8 km.
10. **Delivery** arrived and finished; "Complete trip" → DELIVERED (about 18:03). **Close** from the Trips row, 18:04:37 (`close` 200).

End state (DB, 18:05): as in §1 Method. `trip_events` for the trip: CREATED, ASSIGNED, ACCEPTED, STARTED, STOP_ARRIVED ×2, STOP_COMPLETED ×2, DELIVERED, CLOSED (E2E-R5 still open). No SOS was sent in the final round, so the dossier was not opened live.

### RBAC (final verification, `final-verify/e2e/rbac-assam.txt`, `rbac-nagaon.txt`)

| Account (role) | List | Search | Fleet | `/review?trip=`, `/fleet?trip=` | `GET /api/trips/{id}` and `/routes` | After close |
|---|---|---|---|---|---|---|
| assam.sm (STATE) | 3 of 3, trip present | found | trip present; "Review new road" works | mention it | 200 / 200 | in Trip History and its search |
| cert.nagaon (DISTRICT, not on the route) | TRP-DEMO-001 only | 0 (API total 0) | not shown; `fleet/active` lists only TRP-DEMO-001 | no mention | **404 / 404** | Trip History search 0 |

### RBAC (re-certification, `recert/e2e/rbac-*.txt`)

| Account (role) | List | Search | Fleet | `/review?trip=` | `GET /api/trips/{id}` and `/routes` | Random id |
|---|---|---|---|---|---|---|
| assam.sm (STATE) | 3 of 3, trip present | 1 | trip + driver | mentions it | 200 / 200 | 404 |
| Meghalaya state manager | 2 of 2, trip present | 1 | trip + driver | mentions it | 200 / 200 | 404 |
| kamrup.dm (DISTRICT, pickup) | 3 of 3, trip present | 1 | trip + driver | mentions it | 200 / 200 | 404 |
| East Khasi Hills DM (destination) | 2 of 2, trip present | 1 | trip + driver | mentions it | 200 / 200 | 404 |
| Nagaon DM (not on the route) | 1 of 1 (TRP-DEMO-001 only) | 0 | neither | no mention | **404 / 404** | 404 |

Nav per role: regional 10, assam.sm 9, kamrup.dm 8. `/api/org/states` and `/api/org/districts` still accept any `trip:read` holder (owner decision, §14 #14).

`MANAGER_BROWSER_E2E = PARTIAL` at the final verification: every step passed except the reroute attention on a review that was already open (FV-E2E-1, P2) and the driver's approval notice (FV-E2E-2, P3). History: PASS for both earlier lifecycles, with the off-route manager side PARTIAL (E2E-R2 backend half, since fixed).

---

## 8. Truth scan

**Source grep** (`recert/e2e/truth-grep-raw.txt`, `recert/regression/hygiene_scan.txt`): 0 mockup figures ("128", "1,248", "320 km", "Route Status: Safe"…); "Safe" only in "UNKNOWN is not SAFE" copy, the check-in answers and enum names. The driver's dead `login_forgot` "Forgot password?" key is deleted (REG-8, final).

**Rendered pages** (`recert/e2e/scan/`, `recert/manager/textscan.json`): 0 mockup values; every UNKNOWN / NOT ASSESSED / UNAVAILABLE / STALE label in a neutral or warning tone, 0 in a success tone.

**By eye** (proof sheets): at the re-certification every figure was live, **except the Overview "Urgent alerts" hint, which claimed a driver was asking for help when none was (AUD2-01)**. Final: it counts open SOS ("0 · No driver is asking for help", live).

**Fixed since the first run:** TRUTH-1, E2E-D3, AUD-08, CERT-DRV-09 (re-certification). **Fixed in the final round:** AUD2-01 (urgent KPI), DATA-1 (stale speed shown as current), REPORT-1 (blank Driver/Truck read as "no driver"), AUD2-04 (resolved SOS "needs an answer now"), E2E-R2's "SHORTEST" across different starts (manager-web), E2E-R3 ("here" for sites kilometres off the road), E2E-R1 (full phone numbers on screen; the SOP text still carries the number from the server and is masked on display), RC-DRV-07 (footer said "shared" under a banner saying it was not reaching the server; tests), RC-DRV-11 ("unavailable" while loading; code).

**Final verification** (`final-verify/regression/hygiene_scan.txt`, `bundle_scan.{txt,json}`; `final-verify/manager/textscan.json`; `final-verify/driver/shots/capture.json`):

- **Source:** 0 banned mockup strings in code (6 in comments that explain why the mockup value is not used); 0 Day/Night theme wording; "Safe" only in the check-in answer "I Am Safe / Routine Pause".
- **Shipped bundles** (30 manager files, 4 driver files): 0 real hits; the 2 "1,248" matches are inside Metro dependency arrays (`[121,248]`).
- **Rendered manager states (21):** 0 Day/Night words; SAFE appears only in "Unknown stays UNKNOWN, never safe" (Trips) and "never scored as safe" (Diagnostics); the one mockup-pattern hit is "42" inside the timestamp 12:42:44 (real data). Honest-state words show on Fleet, its drawer, Trips, the driver drawer and Diagnostics.
- **Driver (739 captures):** "SAFE" only in the translator's question phrases ("Is this road safe for a truck?"); the route check reads "CAUTION"; 0 console errors.
- **By eye** (both manager and both driver proof sheets, and the E2E shots read for this document): every figure shown is live data or an honest label (for example Fleet SPEED "Unavailable" for a LIVE truck whose web fixes carry no speed; "Route evidence is incomplete — check route conditions before this road can be chosen" on the driver's road).
- **Fixed in fix round 3:** E2E-R2's backend half as far as the manager's attention goes: a driver's road request now reaches Trips, the trip review and Fleet without anyone opening Route options (§7).

**Fix round 4** (`final-fix/regression/hygiene_scan.txt`, `bundle_scan.txt`; `final-fix/e2e/`):
- **Source:** 0 Day/Night theme wording in code. There were 2 hits before: the unused driver phrase keys "Day"/"Night", now deleted. 0 banned mockup strings in code.
- **Bundles:** the new manager build (30 files) and driver export (4 files) have 0 real hits; the same 2 "1,248" matches sit inside Metro dependency arrays.
- **Fixed and seen live:**
  - **FV-E2E-1:** an open Trip Review no longer shows stale data as current.
  - **A3-02:** Trips and Overview now say the same thing for a moving trip with no road ("Needs a route"). Trips used to say "On the road", in the route tone.
  - **FV-E2E-2:** the driver is told that the road was approved.

**Open truth items:**
- **E2E-R5 and the rest of E2E-R2 (P3, backend; migration 0016, §14 #1):** Journey History omits the incomplete-evidence approval and the driver's reroute request; both are in the audit log only. These are omissions; nothing shown is false.
- **A3-01, server half (P3):** `recalculate` would plan a finished trip if called directly. No screen offers it any more (§11).

```text
REAL_DATA_ONLY   = PASS (no invented value and no stale-as-current value found; FV-E2E-1 fixed and seen live; E2E-R5 and E2E-R2's record are omissions from Journey History; everything shown is real or labelled UNKNOWN/UNAVAILABLE/NOT ASSESSED/STALE)
FAKE_SAFE_LABELS = 0
UNKNOWN_NOT_SAFE = PASS
```

History: at the final verification the open truth items were FV-E2E-1 (P2, stale data shown as current), E2E-R5 and FV-E2E-2, and REAL_DATA_ONLY was PARTIAL. At the final fix round they were E2E-R5 and E2E-R2's backend half ("a driver's reroute reaches the manager only if they happen to open Route options").

---

## 9. Regression counts

### Fix round 4 (`final-fix/regression/`, 00:05–00:40 IST on 29 Sep, on the final code)

| Suite | Result |
|---|---|
| manager-web `npx vitest run` | **54 files, 536/536**, run twice. +6 tests: TripRouteReview 3 (re-read on a row change, the terminal-row guard, the row leaving the list) and TripsPage 3 (the polled row reaches an open review, a cancel from an open-only list, A3-02). FleetPage's route test now also checks the snapshot re-read |
| manager-web `npx tsc -b --noEmit` | exit 0 |
| manager-web `npx vite build --mode remote-demo` (to scratch) | exit 0. Entry `index-nGqFSTpo.js` 336.92 / 106.55 kB; CSS `index-C7eS2s4_.css` 73.95 / 15.55 kB (the same file). The only >500 kB warning is the lazy `mapSetup` (969.93 / 252.57 kB) |
| driver-app `npx vitest run` | **78 files, 935/935**, run twice. +6 tests: maneuvers 2 (FV-DRV-02 on the recorded sequences), TripProvider 3 (reroute approved, delivered, not delivered) and TripScreen 1 (Trip complete after the poll) |
| driver-app `npx tsc --noEmit` | exit 0 |
| driver-app `expo export --platform web` (to scratch) | exit 0, 555 modules (+1, `trip/tripNotices.ts`) |
| backend `pytest` | Not re-run: no backend file changed. All 115 changed backend files are hash-identical to `final-verify/regression/tree_hash_after.txt`. The last runs on that code: 1586 passed, 5 skipped (the final verification's second run and audit 3's re-run) |
| Mutation checks | Each new guard was removed once, its test failed, and it was restored: the review's re-read, the terminal-row guard, the "row left the list" signal, TripsPage's polled row, Fleet's snapshot re-read and the driver's delivered marker. The FV-DRV-02 filter is tested directly |
| oxlint (manager `npx oxlint src`; driver with manager-web's config) | 0 errors in both. Warnings: manager 61 (was 60; the new one is the review re-read effect's deliberate dependency list: it depends on the row key, not on `read`), driver 61 (was 59; both new ones sit on lines this round did not write: the render-time `new Date()` of TripScreen's greeting and a `Date` read in AssistantScreen, now flagged by the React-compiler purity rule) |

A note on process: a `sed -i` used for a mutation check rewrote `FleetPage.tsx` with LF endings. It was converted back to CRLF, and its SHA-1 with the round's two edits removed equals the final verification's (`cd5e09d8…`). Every other edited file kept its endings.

### Final verification (`final-verify/regression/`, 21:30–21:44 IST, on the round-3 code)

| Suite | Final verification | Fix round 3 (`scratchpad/redesign_fix3.json`) |
|---|---|---|
| manager-web `npx vitest run` | **54 files, 530/530**, run twice (53.8 s, 22.0 s); one benign jsdom stderr line in `ReportsPage.test` | 530/530 twice (was 522; +8: TripsPage 2, FleetPage 2, TruckContextDrawer 1, TripRouteReview 2, theme 1) |
| manager-web `npx tsc -b --noEmit` | exit 0 (9.4 s) | exit 0 |
| manager-web `npx vite build --mode remote-demo` (to scratch) | exit 0, 1980 modules, 905 ms; entry `index-KnI0LNTw.js` 336.92 / 106.55 kB; one modulepreload (`jsx-runtime`, 8.43 / 3.21 kB); CSS `index-C7eS2s4_.css` 73.95 / 15.55 kB; 0 INEFFECTIVE_DYNAMIC_IMPORT; the only >500 kB warning is the lazy `mapSetup` (969.93 / 252.57 kB); 16 photos shipped (8 WebP + 8 AVIF) | exit 0; entry 336.92 / 106.55 kB; CSS 73.95 / 15.55 kB |
| manager-web `npx oxlint src` | 0 errors, 60 warnings (unchanged) | 0 / 60 |
| driver-app `npx vitest run` | **78 files, 929/929**, run twice (22.5 s, 8.8 s) | 929/929 twice (was 922; +7) |
| driver-app `npx tsc --noEmit` | exit 0 | exit 0 |
| driver-app oxlint (manager-web's config) | 0 errors, 59 warnings; 0 `no-unused-vars` | — |
| driver-app `expo export --platform web` | exit 0, 554 modules, 25 assets, 7.0 MB; bundle 2,363,878 B raw / 615,328 B gzip-9 (re-certification 2,358,881 / 615,602); 5 photos | — |
| backend `pytest` (isolated Postgres 127.0.0.1:55432 only) | run 1: 1585 passed, **1 failed** (REG-T1: `unique_phone()` drew a number a retained test driver already had; `uq_users_phone`), 5 skipped; the file passed 25/25 on rerun; **run 2: 1586 passed, 5 skipped**, 0 failed (316.5 s) | 1586 passed, 5 skipped, twice (was 1583; +3 in `test_driver_reroute_api.py`, each guarded by a mutation check) |

Skips: 1 non-Windows event-loop test and 4 destructive migration tests. The test DB keeps every test user by design (49,536 users, 27,054 with "9…" phones), so REG-T1's collision chance grows with every run (about 1.8% per full run now; §11).

**Colour literals outside the token files (final verification):** 5 raw hex in code, down from 43 at the re-certification, all in the print-only stylesheet of `manager-web/src/pages/tripExport.ts:176-184`. **REG-1, REG-5 and REG-6 are closed in source:** FleetMap and PlacesLayer use `var(--marker-*/--pin-*/--poi-*)`, each defined in `:root` and the Dark block; the driver's `scene.ts` has 0 hex and reads `MAP_LIGHT`/`MAP_DARK`; `App.tsx` uses `shadowColor: COLORS.shadow`. Left (HYG-R1, P3): 3 `rgb()` in `manager-web/src/index.css` (two hairline insets and the on-image focus halo), `text-white` on the SOS button (`App.tsx:250`) and a `bg-black/60` backdrop (`FleetPage.tsx:1726`). **Recorded as accepted exceptions (fix round 4, HYG-R1 closed as documented):** the print stylesheet's 5 hex values are paper output, never themed. The hairlines and the on-image halo must read the same over the shell gradient and over photos in both themes. The SOS button is always the danger fill with white text. The modal backdrop is a scrim, the same in both themes. None is a Dark surface or a green. Theme branching: 27 code hits, all legitimate (toggle state, status bar, map palette lookups, the pre-paint boot); none selects a colour literal; 0 Tailwind `dark:` variants.

### Final round and earlier (history)

| Suite | Final round (after the last edit) | Re-certification (13:59–14:26) | First run | Before the redesign |
|---|---|---|---|---|
| manager-web `npx vitest run` | **54 files, 522/522**, run twice (14.1 s and 15.2 s) | 50 files, 502/502 | 49 files, 492/492 | 43 files, 385 |
| manager-web `npx tsc -b --noEmit` | exit 0 | exit 0 | exit 0 | clean |
| manager-web `npx vite build --mode remote-demo` (to scratch) | exit 0 in 584 ms; entry `index-4AhoM_0H.js` 335.61 / 106.12 kB; CSS 79.44 / 16.40 kB; 0 INEFFECTIVE_DYNAMIC_IMPORT; the >500 kB warning is `mapSetup` 969.93 kB | entry 333.20 / 105.50 kB | entry 577.45 kB | — |
| manager-web `npx oxlint src` | 0 errors, 60 warnings | 0 errors, 60 warnings | 0 / 60 | — |
| driver-app `npx vitest run` | **78 files, 922/922**, run twice (6.2 s for the first) | 78 files, 913/913 | 74 files, 902/902 | 66 files, 744 |
| driver-app `npx tsc --noEmit` | exit 0 | exit 0 | exit 0 | clean |
| driver-app oxlint (manager-web's config; driver-app has none) | **0 errors, 59 warnings** | 1 error, 69 warnings | not run | — |
| driver-app `expo export --platform web` | not re-run (not in this round's list) | exit 0, 554 modules | exit 0 | — |
| backend `pytest` (isolated Postgres) | not re-run: no backend file changed | 1583 passed, 5 skipped | 1579 passed | — |

**REG-9** (the driver oxlint items; the re-certification text called it REG-8): the `react-hooks/rules-of-hooks` error on the lowercase test mock `box` in `TripScreen.test.tsx:22` (now `Box`), and 9 unused imports and variables in production code (`App.tsx:28`, `ManagerRoot.tsx:17` ×4, `NextTurnPanel.tsx:24`, `AiPanel.tsx:22`, `TranslateBox.tsx:28`, `MapScreen.tsx:469`) plus one in `guide.test.ts`: all removed. **REG-8:** the dead `login_forgot` "Forgot password?" key in 5 languages (`appLanguage.ts:106,173,242,309,376,443`): deleted. **REG-10:** Dark `--accent-soft #13291F` / `--success-soft #12241C` on 64 px KPI tiles, pills, the avatar disc and the reroute advisory at 40%: accepted as accent tints (audit 2's verdict; the owner may neutralise them, §14 #7).

New tests in the final round: manager `RouteBoundary.test.tsx` (3), `RouteCandidateCards.test.tsx` (2), `TruckContextDrawer.test.tsx` (3), `utils/phone.test.ts` (2), App (LAZY-1, MENU-2; MENU-1 as an added assertion), Overview (3 urgent-KPI, 1 age), Fleet (dossier masking, dossier focus), Reports (export columns), Notifications (resolved SOS); driver `ahead.test.ts` (1), `alerts.test.ts` (2), `maneuvers.test.ts` (1), `scene.test.ts` (1), `labels.test.ts` (2), `TripScreen.test.tsx` (2), `scenic.test.tsx` (backdrop assertions).

**Raw hex outside the token files** (at the final round; closed since, above): FleetMap marker colours and pills (REG-1, open); the print CSS in `tripExport.ts`; `driver-app/src/map/scene.ts` Light map values, data hues, category pins and rims (REG-5: the green FUEL pin is fixed and FUEL/TYRES now use the manager's token values, but the pins are still literals outside the palette, open); `App.tsx` `shadowColor '#000'` (REG-6, open). REG-2, REG-3 and REG-4 fixed earlier.

---

## 10. Licensed images

The full record is in **[`docs/REDESIGN_IMAGE_ATTRIBUTION.md`](REDESIGN_IMAGE_ATTRIBUTION.md)** (author, licence, source page, original URL, sizes, local original, shipped files with q72 sizes, the retired 2560 file, totals, screen usage and bytes fetched).

- 10 photographs downloaded from Wikimedia Commons, 6 shipped (CC BY 2.0 ×2, CC BY 4.0 ×1, CC BY-SA 2.0 ×1, CC BY-SA 4.0 ×2). The Viswema photo's author was never recorded; it is not shipped.
- Every screen that shows a photo carries a visible on-image credit; the manager's Region and Login credits now sit in a "Photo credit" landmark (A11Y-7). The manager Image credits dialog lists 3 photos; driver More → Image credits lists 5 files.
- Bytes: manager 15,141,357 → 1,173,280 B (8 files); driver 17,714,842 → 699,340 B (5 files); both apps 25,552,954 → 1,872,620 B (7.3%). No photo file changed in the final round; only the Region's `sizes` (RPERF-1). The attribution document's Region row was updated for that and for the credit landmark (CRLF kept; the doc-parsing tests pass: `ScenicImage.test.tsx` 8/8, `photoCredits.test.ts` 7/7).
- **Fix round 3 (AVIF).** Each manager WebP gained an AVIF twin of the same crop and width, at the lowest quality whose SSIM against the original's 1:1 resize is at least the WebP's: 913,698 B for the 8 AVIFs against 1,173,280 B for the WebPs they mirror (−22.1%). The manager folder now ships **16 files, 2,086,978 B**; the driver keeps its 5 WebP files (699,340 B); all shipped files together are **2,786,318 B**. No WebP changed (SHA-1 identical). `ScenicImage` renders a `<picture>` with an AVIF `<source>` and the WebP `<img>` fallback, so a page still downloads one file per photo (§6). The fallback was not tested in a browser without AVIF.
- **Final verification** (`final-verify/regression/photo_credit_coverage.{txt,json}`): all 16 manager files map to `imageCredits.ts` `PHOTOS` by base and width, all 5 driver files to `photoCredits.ts` `PHOTOS` by name; for all 21 the attribution document has exactly one row with the same author and licence and the same byte count as the source, and each shipped file is byte-identical to its source. Every credited width and format is shipped. Every render site uses `ScreenHero`/`ScenicImage` (which always render the credit) or pairs its photo with a `PhotoCredit`. The only other image, `manager-web/src/assets/hero.png`, was an unreferenced Vite template file that the build did not ship (DEAD-1). Fix round 4 deleted it along with the two unreferenced template icons, `react.svg` and `vite.svg`, so `manager-web/src/assets/` is gone. The attribution document was updated for that and for the suite counts; its CRLF endings were kept, and the doc-parsing tests pass after the edit (`ScenicImage.test.tsx` 8/8, `photoCredits.test.ts` 7/7). Credits were read on both apps' proof sheets (Region, Login, Overview, every driver hero; driver More → Image credits lists 5 photos with source and licence links). Shipped sizes re-checked for this document: 1,173,280 + 913,698 + 699,340 B.

---

## 11. Fix history

### ID map (the E2E lane's IDs and the re-certification's)

| E2E lane | Re-certification text | Item | State after the final verification |
|---|---|---|---|
| E2E-R1 | "RE2E-3" (cited once, never defined) | Full phone number in the dossier, SOP step 1 and Fleet detail | Fixed in manager-web and seen live in the dossier (final verification); the SOP text is masked on display, the server still writes the number (§14 #5) |
| E2E-R2 | RE2E-1 | Driver reroute not surfaced; FASTEST/SHORTEST across different starts | Fixed: manager half in the final round; the attention (backend `proposed_reroute` and manager UI) in fix round 3, seen live. A trip event and a manager notification need migration 0016 (§14 #1). FV-E2E-1 found on an already-open review |
| E2E-R3 | missing | A landslide card per site; "here" for sites kilometres off the road | Fixed (driver) |
| E2E-R4 | REPORT-1 | Reports export blank Driver/Truck/Attention | Fixed |
| E2E-R5 | missing | Approval and reroute in `audit_logs` only | Open (backend; migration 0016, §14 #1) |
| E2E-R6 | missing | "Then Turn straight" | Fixed (driver); the rest of its class (end of road, merge, fork, roundabout exits, ramps) in fix round 3 |
| — | RE2E-2 | "Trip complete" card dropped before Close | Open (candidate; not re-tested: the final E2E closed 47 s after delivery) |

### Re-certification (fix rounds 1–2, verified 12:50–15:36)

These tables are the re-certification's, unchanged. They mark **42 rows** fixed: two "in code" only (A11Y-6, REG-4), one "on the device path" only (CERT-DRV-02), and E2E-D4 in both the manager and the backend tables. (The re-certification's verdict said "40".)

#### Manager

| Defect (sev) | Fix | Verified by | Now |
|---|---|---|---|
| A11Y-1 / AUD-01 (P1) sticky topbar hides focus | `--topbar-h`; `scroll-padding-top` | `keyboard/walk-app.json` | Fixed |
| RESP-1 (P2) Fleet panel under topbar | `.fleet-detail` top uses `--topbar-h` | `misc/misc.json` | Fixed |
| RESP-2 (P2) off-screen row actions | phone cards; sticky actions | `responsive/summary.json` | Fixed |
| RESP-3 (P2) States overlap at 320 | wrap | 0 overlaps | Fixed |
| RESP-4 (P3) 200% zoom opens on chrome | "Menu" disclosure | `zoom200/zoom200.json` | Fixed (MENU-1/2 found, fixed in the final round) |
| RESP-5 (P3) dangling separator | hidden below 400 px | live | Fixed |
| DK-1 / AUD-06 (P2) green map fill in Dark | neutral fill + accent outline | `dk1/`, `roles/` | Fixed |
| REG-2 (P3) dark-green POI pins | `--poi-*` tokens | `dk1/fleet-poi.json` | Fixed |
| A11Y-2 (P2) credit ring | two-tone ring | `rings/` | Fixed |
| A11Y-3 (P2) map control rings | inset 3 px outline | `rings/rings.json` | Fixed |
| A11Y-4 (P3) Unread 1.36:1 | ring on the pressed option | 3.85/3.98 | Fixed |
| A11Y-5 (P3) sign-in landmarks | `<main>`, `<header>` | landmarks | Fixed (A11Y-7 found, fixed in the final round) |
| A11Y-6 (P3) small targets | `min-h-6` | code | Fixed in code |
| MAP-1 / E2E-D5 (P3) labels hide LIVE | label collision | unit tests; live | Fixed |
| COPY-1, COPY-2 (P3) | wording | test; proof | Fixed |
| TRUTH-1 (P2) "Verified districts" | "Districts on file" | textscan | Fixed |
| E2E-D4 (P3) "Awaiting driver" after accept | `driver_accepted_at`; `attention()` | E2E step 5 | Fixed |
| E2E-D7, E2E-D8 (P3) | de-dupe; `list-none` | E2E | Fixed |
| AUD-10 (P3) "Terrain-aware" | wrap | `sheets/pre-320.png` | Fixed |
| PERF-1 (P2), PERF-2 (P2), PERF-5 (P3), PERF-7 (P3) | lazy pages; DashboardFirst; fonts; `sizes` | `recert/perf/` | Fixed |
| PERF-3 (P2), PERF-8 (P3) | q72 re-encodes; Region `sizes` | LCP +67.9%/+49.4%; 390@3 +41.7% | Partial (RPERF-1 fixed in the final round; PERF-3 open) |
| PERF-6 / REG-3 (P3) | TerrainScene deleted | CSS still +57% | Open |
| REG-7 (P3), TESTS | as PERF-1; test tooling | 502/502 twice | Fixed |

#### Driver

| Defect (sev) | Fix | Verified by | Now |
|---|---|---|---|
| CERT-DRV-01 (P2) focus drops to BODY | tooltip shapes `tabindex=-1` | `focus-*.json` | Fixed |
| CERT-DRV-02 (P2) mid-word breaks | quick grid by width/font scale | Android path | Fixed on the device path |
| CERT-DRV-03 (P2), CERT-DRV-04 (P3) | credit placement; RowCard lines | large text | Fixed |
| CERT-DRV-05 (P3) maneuver clamp | 2 lines | 360 still cut | Partial → RC-DRV-01 (fixed in the final round) |
| CERT-DRV-06 (P3) Language sheet | non-focusable backdrop | initial focus Close | Fixed (RC-DRV-03 fixed in the final round) |
| CERT-DRV-07 (P3) Navigate spacing | — | unchanged | Open (RC-DRV-05) |
| CERT-DRV-08 (P3) hero below status bar | TopInset | `safearea.json` | Fixed (RC-DRV-08 open) |
| CERT-DRV-09 / AUD-02 (P2), AUD-08 (P3), AUD-11 (P3) | paging; health; codeWords | `mgr-regional.json` | Fixed (RC-DRV-10 fixed in the final round, code) |
| E2E-D1 / AUD-04 (P2), E2E-D3 / AUD-09 (P3) | memory refresh; copy | E2E | Fixed |
| REG-4 (P3) | warning tokens | code | Fixed in code |

#### Backend

| Defect (sev) | Fix | Now |
|---|---|---|
| E2E-D2 / AUD-05 (P2) resolve records nothing | INCIDENT_RESOLVED + audit row | Fixed |
| E2E-D6 (P3) two names for one driver | `drivers.full_name` | Fixed |
| E2E-D4 backend half | `TripRead.driver_accepted_at` | Fixed |

### Final round (16:31–18:25 IST)

#### Manager (`manager-web/src`)

| Defect (sev) | Fix | Verified by | Now |
|---|---|---|---|
| **LAZY-1 (P1)** console blanks on a failed chunk | `components/RouteBoundary.tsx`: a boundary keyed on the path round the page area; chunk error → `role=alert` + Try again (reload when online, "Still offline" otherwise); render error → re-render | live, both themes, recovered (`final/manager/lazy/`); 4 tests | **Fixed** |
| LAZY-2 (P3) no pending cue | the keyed Suspense shows "Loading…" on a first visit | live: 104 ms | Fixed |
| MENU-1 (P2) focus to `<body>` after Menu navigation | focus `#main-content` (`tabIndex -1`, `.focus-target`) | live at 390; test | Fixed |
| MENU-2 (P3) Escape keeps the Menu open | Escape folds it and focuses the Menu button | live; test | Fixed |
| DOSSIER-1 (P2) focus lost on close | opener stored from the click; every close path refocuses it; after Resolve, the page | tests | Fixed (not seen live) |
| DATA-1 (P2) stale speed as current | `TruckContextDrawer`: Unavailable for NO_CONTACT/NO_LOCATION; "Last known · age" for STALE | live; 3 tests | Fixed |
| REPORT-1 / E2E-R4 (P2) blank export columns | Reports reads the driver and truck lists; `attention()` shared from `tripExport.ts` | live CSV 31/31; test | Fixed |
| AUD2-01 (P2) urgent KPI claims a driver needs help | the figure is open SOS from the shell poll; unread notices are the caption | live; 3 tests | Fixed |
| E2E-R1 / AUD2-03 (P2) full phone on screen | `utils/phone.ts` `maskPhone`/`maskPhonesIn`; Fleet detail masked; dossier `PhoneLine` with Call buttons; SOP masked on display | live (Fleet detail); tests (dossier) | Fixed in manager-web (server SOP text unchanged) |
| E2E-R2 (P2) reroute not surfaced; FASTEST/SHORTEST across starts | Route tab re-reads options on the Fleet poll; no chips across different starts; "Starts at a different point" | live after a real reroute; 2 tests | Manager half fixed; backend half open |
| AUD2-04 (P3) resolved SOS "needs an answer now" | urgency from the SOS list; Call demoted | live; test | Fixed |
| AUD2-08 (P3) ages in raw minutes | `ageLabel` in `presenceLine` | live; test | Fixed |
| A11Y-7 (P3) credit outside landmarks | `ScenicImage creditLabel` → `<aside aria-label="Photo credit">` | live | Fixed |
| A11Y-8 (P3) clipped ring | scroll box `-mx-1.5 px-1.5` | live | Fixed |
| SCHEM-1 (P3) callout over "Nagaland" | Assam's callout level with the label's top | live (kamrup.dm) | Fixed |
| RPERF-1 (P3) DPR-3 phone fetches 235 KB | phone slot in the Region `sizes` | live: 125,678 B | Fixed |
| RPERF-2 (P3) Fleet chunk waterfall | Fleet loader starts FleetMap with FleetPage | built entry | Fixed in structure (not re-timed) |
| Button API | `Button.onClick` passes the click event (to know the opener) | tsc | — |

#### Driver (`driver-app/src`, `driver-app/App.tsx`)

| Defect (sev) | Fix | Verified by | Now |
|---|---|---|---|
| RC-DRV-01 (P2) road name lost at 360 | instruction full-width under the icon below 420 dp room, 4 lines; map grows to fit the overlays; camera top follows the card | live, 72/72 | Fixed |
| RC-DRV-02 (P2) verdict, ETA, traffic cut | wrap: summary 2, ETA 2, AI facts 2, AI headline 2, AI lines 4, stamp 2, alert where 3 / detail 4 / evidence 3; factor names keep their width | live, 72/72 | Fixed |
| AUD2-02 (P2 doc / P3 product) Trip addresses cut | place-name title; addresses 4 lines; Navigate hero and next-stop tile say the place; details trip line 5 lines | live, Trip 36/36 | Fixed |
| FINAL-1 (P3, new) Safety tools and route tiles cut at 412/450 on Android large text | stack by width over font scale | live (Android path) | Fixed (CSS web-only path still cuts) |
| RC-DRV-03 (P3) credits backdrop takes focus | non-focusable `aria-hidden` View | live; test | Fixed |
| RC-DRV-04 (P3) "search search" | label = category + mode | live | Fixed |
| RC-DRV-06 (P3) focus order | map canvas after the controls in the DOM | live (Navigate) | Fixed; More part refuted |
| RC-DRV-07 (P3) footer contradicts the banner | footer by tracking state | test | Fixed (not seen live) |
| RC-DRV-09 (P3) attribution covered | map tall enough for the overlays; room scales with font scale | live at normal size | Partial (web emulation under large text) |
| RC-DRV-10 (P3) raw provider ids, "en" | `providerName`, `providerState`, language by name | 2 tests | Fixed (not seen live) |
| RC-DRV-11 (P3) "unavailable" while loading | "Loading guidance…" | code | Fixed (not seen live) |
| E2E-R3 / AUD2-05 (P3) | off-road distance; one card per stretch | live; 3 tests | Fixed |
| E2E-R6 / AUD2-07 (P3) | turn + straight → "Continue" | live; test | Fixed |
| REG-5 (P3) green FUEL pin | FUEL `#6D28D9`, TYRES `#475569` | live pixels; test | Green pin fixed; literals remain |
| REG-8 (P3) dead "Forgot password?" key | deleted | coverage tests | Fixed |
| REG-9 (P3) lint error and unused code | `Box`; 10 unused removed | oxlint 0 errors | Fixed |

#### Process and documentation

| Item | Now |
|---|---|
| AUD-03 / AUD2-09 tokens | **Tokens not revoked:** 51 live from the first-run window (audit 2's read-only count); 2 more from this round's first two driver sessions. Revoke or sign out at run end (§14). This round signed out every session it could. |
| AUD2-10 ID hygiene | ID map above; REG-8/REG-9 corrected; REG-10 named; E2E-R1, R3, R5, R6 listed; "RE2E-3" removed. |
| Chrome profiles | 0 left from any lane of this run. |

### Fix round 4 (audit 3 + this round)

Audit 3 (22:58–23:18 IST) read the final verification's evidence and code. Fix round 4 (23:20 IST on 28 Sep to 00:45 IST on 29 Sep) fixed what could be fixed in manager-web and driver-app without a migration or invented data, then checked it with a new lifecycle trip on the same stack (§7). The backend was not touched: this round could change it only for a P0 or P1.

#### Fixed in fix round 4

| ID (sev) | Fix | Verified by | Now |
|---|---|---|---|
| **FV-E2E-1** (P2) an open Trip Review never re-read its trip | `TripsPage` passes the review the newest polled row, not the row that was clicked, and says whether the row is still listed. `TripRouteReview` re-reads the trip (without a spinner, and not blocked by a busy action) when the row's status, selected route or `proposed_reroute.route_id` changes, or when the row leaves the list. `editable` also needs a row that does not say CANCELLED, CLOSED or DELIVERED | 5 tests, each guard mutation-checked. Live: the review assam.sm opened before the plan followed approve, dispatch, start, the driver's request (+3.72 s), the approve (+3.19 s) and the Close; a draft cancelled under an open review read CANCELLED with no "Plan route" at +3.19 s (§7) | **Fixed** |
| **A3-01** (P2, audit 3), UI half: the stale review's "Plan route" would post a plan for a cancelled trip | The same re-read, plus the terminal-row guard | test "a draft cancelled from its row stops offering Plan route … before and after the re-read"; live (§7 step 15) | **Fixed** in the UI; the server half is open (below) |
| **A3-02** (P3) Trips said "On the road" for an ACTIVE trip with no route, while Overview said "Needs a route" | `attention()`: ACTIVE or DELAYED with no `selected_route_id` reads "Needs a route" in the warning tone, after the reroute check | a test that checks `attention()` against Overview's `decisionFor`; live on TRP-DEMO-001/002 (`m00`) | **Fixed** |
| **FV-E2E-3** (P3) the Fleet attention outlived an approve by a poll | `fleet.refresh()` after a successful choose, approve or accept (`FleetPage.tsx`), as the SOS resolve did | FleetPage test (mutation-checked); live: cleared 0.25 s after the approve (was 7.8 s) | **Fixed** |
| **FV-E2E-2** (P3) no foreground notice to the driver | `TripProvider` records a road change it sees in the foreground (`rerouteApproved`). Navigate shows "Reroute approved" for 5 minutes; Trip adds "Your manager approved a new road. Open Navigate to follow it." Both phrases already existed in every language | 1 test (the provider's record and the 5-minute window); live at +4.84 s on both screens (`d01`, `d02`) | **Fixed** |
| **FV-DRV-01** (P3) the "Then" line cut at 360 under large text | `numberOfLines={narrowCard ? 4 : 2}` (below 420 dp of room, as the instruction) | 12 live probes at 360×640, both paths, ×1.3/×1.5, both themes: 0 cut; 3 lines at ×1.5 | **Fixed** |
| **FV-DRV-02** (P3) a roundabout told twice | `toldManeuvers()` drops an exit roundabout/rotary step that directly follows its own entry; the card, the "Then" line and the voice use it | 2 tests on the recorded package's sequences; live at km 9.87 | **Fixed** |
| **RE2E-2** (P3, confirmed here) "Trip complete" lasted one poll | `TripProvider` marks a trip it last knew as DELIVERED when the poll drops it (`act()` now also updates what the poll compares against); the empty Trip page shows "Trip complete · Your manager can see the delivery. Location sharing has stopped." for 30 minutes | 3 tests (mutation-checked) | **Fixed in code**, not seen live |
| **DEAD-1** (P3) | `manager-web/src/assets/` deleted (`hero.png`, and the equally unreferenced `react.svg` and `vite.svg`); the unused driver phrase keys "Day"/"Night" deleted | build and both suites; source scan 0 Day/Night in code | **Fixed** |
| **FV-M-1** (P3, harness) | `s6_zoom.mjs` (both copies) leaves the page before reopening a clicked state at 200% | harness source (not re-run) | **Fixed** in the harness |
| **HYG-R1** (P3) | Recorded as accepted exceptions with their reasons (§9) | — | **Closed** as documented |
| Stray `notes.jsonl` at the repo root | Moved to `final-verify/e2e/notes-stray-repo-root.jsonl` | `git status` | **Done** |

#### Audit 3's defects

| ID | Sev | What | Now |
|---|---|---|---|
| A3-01 | P2 (plausible) | The stale review's "Plan route" and a server with no trip-status guard on planning | UI half fixed (above). **Server half open, P3:** `routes.plan` and `recalculate` still accept a CANCELLED, CLOSED or DELIVERED trip. A direct API call by a holder of `route:plan` would store a PROPOSED candidate, supersede the older unselected ones and spend a provider call. The followed route is never changed, because planning never selects. No screen offers it any more. Fix: `409 TRIP_NOT_PLANNABLE` for terminal trips, with a test. It is outside this round, which could change the backend only for a P0 or P1. `docs/API_CONTRACTS.md` §7 records the gap |
| A3-02 | P3 | Trips and Overview disagreed on an ACTIVE trip with no route | Fixed |
| A3-03 | P3 (doc) | The perf-lane token families "not investigated"; the rotating cert.ekh family misdated | Corrected (§1 Tokens, §14 #11, §15) |
| A3-04 | P3 (doc) | "41 captures … 0 overlaps, 0 wording hits" | Corrected (§2, §15) |
| A3-05 | P3 (doc) | "exactly one request and one preload in all 18 loads" | Corrected (§6) |
| A3-06 | P3 (doc) | The driver overflow breakdown summed to 731 | Corrected (§4) |
| A3-07 | P3 (doc) | Focus return cited to files that record only focus-in | Corrected (§5, §7, §11); both paths re-walked in both themes (§7) |
| A3-08 | P3 (doc) | (b) rated the rest of E2E-R2 P2 and PERF-4 device-bound | Corrected (§1, §14) |
| A3-09 | P3 (doc) | The luminance range and the driver's neutrals were incomplete | Corrected (§1, §3) |
| A3-10 | P3 (process) | One unmasked login phone echoed into audit 3's own tool output (not written anywhere); its backend re-run added retained test users (REG-T1) | Noted. Fix round 4 listed only the accounts file's keys and printed no credential or phone. REG-T1 is open |

#### Process (fix round 4)

| Item | Now |
|---|---|
| Sessions | regional, assam.sm and the driver signed in once each (plus one refused attempt on the wrong region) and out through the UI; their families are revoked (`logout`) |
| Chrome profiles | 4 created, 4 deleted; `%TEMP%/cdp-profile-*` = 0 |
| Git | no git state change (HEAD `5b5e474`; the index untouched); no deploy, no hosted access, the stack not restarted |
| DB | writes only through the UI (2 trips, 1 SOS, auth); every other query read-only |

### Still open after fix round 4 (final)

| ID | Sev | Next step |
|---|---|---|
| PERF-3 | P2 | Owner decision (§14 #2) |
| PERF-4 | P2 | Owner decision (§14 #3); an APK measurement to follow |
| E2E-R2 record (trip event, manager notification); E2E-R5 | P3 | Migration 0016 (§14 #1) |
| A3-01, server half | P3 | Refuse planning on terminal trips (`409 TRIP_NOT_PLANNABLE`) with a test; backend work for a later round |
| Web-only large text (FV-DRV-03; Safety tiles at 360; two route tiles at 450) | P3 | §14 #8 |
| RC-DRV-05, RC-DRV-08 | P3 | §14 #9, #10 |
| FPERF-1, FPERF-2, FPERF-3, PERF-6 | P3 | §14 #17 |
| REG-T1 | P3 (test) | NULL the retained test users' phones in `factories.cleanup`, or retry `unique_phone` on a collision (backend tests; not this round's remit) |
| FV-M-2 | P3 (doc) | Worded (§5); score round controls on their circle if the metric is re-used |
| Unrevoked refresh tokens | P3 | §14 #11 |
| RE2E-2 live check | — | Deliver a trip and look at the empty Trip page before and after Close |
| Not seen live | — | the pre-start 3-rail state at 360; the AVIF fallback in a browser without AVIF; Route Review authorise/revoke; manual plate verify; RC-DRV-07/10/11 |
| Physical Android | BLOCKED | `adb` not installed |

### Final verification (fix round 3 + this round)

History: the state after fix round 4 is in the section above; FV-E2E-1, FV-E2E-2, FV-E2E-3, FV-DRV-01, FV-DRV-02, DEAD-1, HYG-R1 and FV-M-1 below are closed there. Fix round 3 (about 18:30–19:05 IST) changed the code; the final verification (19:07–22:32 IST) checked it on the restarted stack. "Verified by" names final-verification evidence unless it says otherwise.

#### Fixed in fix round 3

| Defect (sev) | Fix | Verified by | Now |
|---|---|---|---|
| **E2E-R2, backend half** (P2): a driver's reroute reached no manager | `ProposedRerouteRead` and `proposed_reroute` on `TripRead`, `TripDetail` and `FleetTripRead`, derived in one SQL statement per request from `trip_routes` and their audit rows (a PROPOSED EMERGENCY_BACKUP on an ACTIVE/DELAYED trip, planned after the selected route, whose CREATE audit row's actor is the trip's driver and which has no STATUS_CHANGE row); no migration; fails closed (`backend/app/services/trips.py` `proposed_reroutes`; `docs/API_CONTRACTS.md` §7) | 3 backend tests, each rule guarded by a mutation check (fix round 3); live: the UI fed by the list, detail and fleet reads showed the request within one poll and cleared after the accept (the API responses were not queried directly after the accept) | **Fixed** for the manager's attention; a trip event and a manager notification → §14 #1 |
| **E2E-R2, manager attention** (P2) | `REROUTE_ASKED` "Driver asked for a new road" checked first in `attention()` (tone text-warning; ACTIVE/DELAYED only); Trips row with "Review new road" (for holders of `fleet:location_read`); a warning box in the trip review; Fleet row, detail box and opening on the Route tab; the "All attention" filter and both CSVs through `attention()` | E2E: Trips row +1.83 s, a freshly opened review, Fleet row and detail +10.57 s, all three buttons open the Route tab, cleared 7.8–9.0 s after the accept (`m09`–`m18`); manager lane: 320 Dark cells pass every gate; 8 tests | **Fixed**, except FV-E2E-1 (a review already open) and FV-E2E-3 (one poll of lag after an approve) |
| **PERF-3** (P2) hero LCP | 8 AVIF twins through `<picture>` and a typed preload (`optimize_assets.py --avif-only`, SSIM ≥ the WebP's) | four-build timing: hero bytes −17.8% to −25.7% at 1600, one request per page, mobile LCP −8.2% / −4.1% vs r2; experiment: early preload trades FCP for LCP (§6) | **Open**, +51.8% / +47.8% vs snap: owner decision (§14 #2) |
| REG-1 (P3) raw marker and pin hex | `--marker-*`, `--pin-*`, `--on-pin-*` in both themes; Dark LIVE = the accent, chip `#151918`; `theme.test.tsx` contrast and no-literal checks | live pixels: Dark LIVE marker `#39D8A0` on `#151918` at 1920; E2E map crop; hygiene scan | **Fixed** |
| PERF-6 (P3) CSS size | Tailwind `@import 'tailwindcss' source('.')`: the stale untracked `manager-web/dist-cert/` build had been scanned; 75 unused utilities dropped, 0 used ones lost | build 79.44 → 73.95 kB (−6.9%); on the wire −5.1% vs r2 | **Partly fixed** (+49.4% on the wire vs snap) |
| RC-DRV-09 (P3) attribution covered under large text (web) | the web map reports the attribution's measured height (`onAttributionHeight`); room = max(22 × font scale, measured + 5); the browse map grows under large text | 108 probes, 0 overlays, fully visible in 36 of 36 combinations, first live check while guiding; tests | **Fixed** on the web (native keeps 22 × font scale; unverified on a device) |
| REG-5 (P3) map literals outside the palette | `MAP_LIGHT`, `MAP_DARK`, `MAP_PALETTES` in `theme.ts`; `scene.ts` 0 hex; the truck arrow takes the layer's colour | live Dark map probes (`r-s30*.json`); hygiene scan; tests | **Fixed** |
| REG-6 (P3) `shadowColor '#000'` | `COLORS.shadow` | hygiene scan | **Fixed** |
| E2E-R6 class (P3) raw OSRM wording | a "straight" modifier never reaches the words (end of road → "Continue", merge → "Merge onto X", fork → "Keep ahead"); exit roundabout/rotary, ramps, roundabout turn, notification and use lane mapped to existing phrases | the real 24-maneuver package: 0 raw wording (`maneuvers-real-package.json`); live card; 2 tests | **Fixed**, except FV-DRV-02 |
| Maneuver icons (P3, found in fix round 3) | OSRM's space-spelt modifiers ("slight right") normalised | live: "Keep slight right onto Bhangagarh Flyover" draws the slight-right arrow | **Fixed** |
| Truck-arrow colour (fix round 3's untested item) | the arrow's colour comes from the layer in both renderers | live: `border-bottom-color #39D8A0`, `rotate(122deg)`, white halo | **Verified** |

#### Earlier fixes seen live for the first time

| Item | Verified by | Now |
|---|---|---|
| DOSSIER-1 (P2) | E2E, a real SOS: focus opens inside on "Close incident dossier" in both themes; Escape (Dark) and the X (Light) returned it to "View Incident Dossier", once each (`notes.jsonl`); Resolve moves it to `main` | **Fixed, seen live** (the Tab trap and both paths in both themes: fix round 4, §7) |
| E2E-R1, dossier half (P2) | E2E: `+••••••••••03` on the driver line and in SOP step 1, 0 full numbers in the text, one `tel:` link | **Fixed, seen live** |
| RPERF-2 (P3) | four-build timing: mobile first truck marker −8.5% and first tile −6.2% vs snap | **Fixed, re-timed** (its cost is FPERF-1) |

#### New in the final verification

| ID | Sev | Where | Problem | Suggested fix |
|---|---|---|---|---|
| **FV-E2E-1** | **P2** | `manager-web/src/components/TripRouteReview.tsx:210-236` (reads only on mount), `:307`; `pages/TripsPage.tsx:686` (`key={reviewTrip.id}`) | An open Trip Review never re-reads its trip: it missed "Driver asked for a new road", and kept a cancelled trip's DRAFT and an enabled "Plan route" for more than 3 minutes | Re-read when the polled row's `status`, `selected_route_id` or `proposed_reroute.route_id` changes, or prefer the newer row fields; a test that a changed trip prop shows REROUTE_ASKED and the new status |
| FV-E2E-2 | P3 | `driver-app/src/screens/TripScreen.tsx:583-597`, `notify/local.ts:69-70`, `trip/TripProvider.tsx:255-261` | No foreground notice when the manager approves the driver's road (only TRIP_CANCELLED notices render) | A one-time banner when `selected_route_id` changes on the same trip or a newer REROUTE_APPROVED notice arrives |
| FV-E2E-3 | P3 | `manager-web/src/pages/FleetPage.tsx:628-665`; `components/TruckContextDrawer.tsx:72` | After "Approve & reroute" the detail box flickers and keeps the attention until the next 10 s poll | `fleet.refresh()` after a successful choose or approve, as the SOS resolve does |
| FV-DRV-01 | P3 | `driver-app/src/screens/MapScreen.tsx:1397` (`numberOfLines={2}`) | At 360×640 under ×1.3/×1.5, on both paths and themes, the "Then" line loses the next street name | Let it wrap below 420 dp or when the font scale is above 1 |
| FV-DRV-02 | P3 | `driver-app/src/map/maneuvers.ts:175-178`, `MapScreen.tsx:1047` | A roundabout entry and its "exit roundabout" step read the same sentence, so the card says it twice | Skip an exit step that follows its own entry (next turn and "Then"), or word it as the road after the ring; a test on this package |
| FV-DRV-03 | P3 | driver Navigate quick actions and Safety tiles, web CSS text-zoom path | Cut or mid-word at 412/450 under ×1.3/×1.5; the Android path passes | Lay out by rendered width, or accept as web-only (§14 #8) |
| FPERF-1 | P3 | `manager-web/src/App.tsx:35-40` | Fleet first-route text LCP +15.6% on mobile (the map chunk shares the link) | Accept (the map is the page; HTTP/2 eases it), or start the map import once FleetPage's chunks resolve, and re-time (§14 #17) |
| FPERF-2 | P3 | `App.tsx` lazy Fleet route, React 19.2.8 Suspense | Unthrottled Fleet LCP +30.1%, marker +15.8% (300 ms reveal throttle) | Start the first fleet read in the route loader, or avoid a committed fallback (preload on idle or hover, `startTransition`) |
| FPERF-3 | P3 | driver Trip after sign-in | +23 ms unthrottled (+0.5% on mobile) | Accept, or profile the Trip first render on the APK |
| REG-T1 | P3 (test) | `backend/tests/factories.py:180` `unique_phone()`, `:243`, `cleanup` (about line 564) | Random driver phones collide with the 49,536 retained test users (about 1.8% per full run, rising) | NULL the retained users' phones in cleanup, or retry on collision; clear today's backlog in the isolated DB |
| HYG-R1 | P3 | `tripExport.ts:176-184` (print), `index.css:508,716,771`, `App.tsx:250`, `FleetPage.tsx:1726` | Colour literals outside the tokens (paper output, scrims) | Tokens `--on-danger`, `--scrim-backdrop`, or record the print stylesheet as an exception |
| DEAD-1 | P3 | `manager-web/src/assets/hero.png`; `driver-app/src/i18n/phrases.ts:211-212` | An unreferenced template image; unused "Day"/"Night" phrase keys | Delete |
| FV-M-1 | P3 (harness) | `recert/manager/s6_zoom.mjs` | The 200% pass clicked the Fleet row twice and measured "No truck selected" (here and in the re-certification) | Reload before the 200% state; the clean re-check passed (§4, §12) |
| FV-M-2 | P3 (doc) | this document, §2 M5 and §5 | "Map rings 96–100%" left out the attribution toggle's 66.7% | Corrected (§12) |
| FPERF-DOC | P3 (doc) | this document, §6 | §6 stopped at the re-certification build | Applied (§6, §12) |

#### Process

| Item | Now |
|---|---|
| Sessions | Every final-verification lane that signed in signed out through the UI; 15 of the perf lane's 33 driver families are nevertheless live, and fix round 3 left 3 (§1 Tokens, §14 #11) |
| Chrome profiles | 0 left (`%TEMP%/cdp-profile-*` = 0 at 22:36 IST) |
| Source | Unchanged by the final verification (hashes before and after); a stray untracked `notes.jsonl` from the E2E harness sits at the repo root |

### Still open after the final verification (history)

| ID | Sev | Next step |
|---|---|---|
| FV-E2E-1 | **P2** | Fix and re-run the E2E reroute step with a review open; it alone blocks conditions (b) and (e) |
| PERF-3 | P2 | Owner decision (§14 #2) |
| PERF-4 | P2 | Needs the APK (§14 #3) |
| E2E-R2 event and notification; E2E-R5 | P3 | Migration 0016 (§14 #1) |
| FV-E2E-2, FV-E2E-3, FV-DRV-01, FV-DRV-02 | P3 | Front-end fixes (table above) |
| Web-only large text (FV-DRV-03; Safety tiles at 360; two route tiles at 450) | P3 | §14 #8 |
| RC-DRV-05, RC-DRV-08 | P3 | §14 #9, #10 |
| RE2E-2 | P3 cand. | Re-test with Close more than 60 s after delivery |
| FPERF-1, FPERF-2, FPERF-3, PERF-6 | P3 | §14 #17 |
| HYG-R1, DEAD-1, REG-T1 | P3 | Table above |
| Unrevoked refresh tokens | P3 | §14 #11 |
| Physical Android | BLOCKED | `adb` not installed |

### Still open after the final fix round (history)

| ID | Sev | Where | Problem | Suggested fix |
|---|---|---|---|---|
| E2E-R2 (backend half) | P2 | `backend/app/api/driver.py` reroute | No notification, trip event or Trips/Fleet attention on a driver reroute | REROUTE_REQUESTED trip event + manager notification; show "Driver off route — new road proposed" in `attention()` and on the Fleet row; backend test |
| PERF-3 | P2 | Region/Login heroes | Mobile LCP +67.9% / +49.4% (the photo) | Owner: accept, or 1280w up to 1600 px on Region, or AVIF |
| PERF-4 | P2 | driver tabs | First visit Safety/More +43%/+62% | Measure on the APK; then pre-decode the tab photos after sign-in |
| E2E-R5 / AUD2-06 | P3 | route approve and reroute → `trip_events` | Journey History omits them | ROUTE_APPROVED (approver, reason) and REROUTE_REQUESTED events; tests |
| RC-DRV-09 (web) | P3 | Navigate overlays vs Leaflet attribution | Covered under large text on the web emulation | Report the attribution's height from `DriverRouteMap.web`, or move the summary above it |
| RC-DRV-05 | P3 | Navigate spacing | outside ±2% | Tighten or accept |
| RC-DRV-08 | P3 | status bar | no scrim once scrolled | Scrim; check on a device |
| Web-only large text | P3 | Safety tiles and tools, Navigate route tiles; CSS-only scaling | Safety mid-word breaks at 360 and tool cuts at 412/450; two route tiles cut at 450 | Owner: accept as web-only, or also stack by width |
| RE2E-2 | P3 cand. | driver Trip | "Trip complete" disappears before Close | Triage |
| PERF-6, REG-1, REG-5 (literals), REG-6 | P3 | hygiene | CSS +57%; raw hex | Prune CSS; tokens |
| AUD-03 / AUD2-09 | P3 | cert DB `refresh_tokens` | 51 + 2 unrevoked | Revoke the harness families; sign out at run end |

---

## 12. Corrections

### The first audit's 15 refuted claims and 18 corrections

Resolved in the re-certification (this document's earlier text) and unchanged: large text was 17/64 (not 26/64); paging was CERT-DRV-09's cause; the driver web sign-out was a P2 (fixed); profiles were not deleted (now 0); theme-switch "0 requests" meant 0 non-API; OFFSCREEN_PRIMARY_CONTROL was data-dependent; GREEN_ACCENT_ONLY was NO and Region Dark was FAIL then (both fixed); LIGHT_THEME_MANAGER was PARTIAL (fixed); exports had not been clicked; REAL_DATA_ONLY had omitted items; the E2E teleport was undisclosed; pages under a shell P1 were PARTIAL; M1 RESPONSIVE had "Terrain-aware" overflowing; D2 cited a missing file; the attribution author cell was empty. The fixes behind them are in §11's re-certification tables.

### Audit 2's 11 refuted claims

| Refuted claim (re-certification text) | What the evidence showed | Now |
|---|---|---|
| D5 Trip: "Large text passes on both paths" | Trip failed 6/6 in all four runs (addresses cut) | Corrected (D5, §4); fixed (AUD2-02, 36/36) |
| §4/§15: failures are active-trip Navigate plus a web-only Safety break | CSS per theme: Trip 6, Navigate 6, Safety 2 fails; Android: Trip 6, Navigate 6 | Corrected (§4); Trip and Navigate fixed |
| M3: "FUNCTIONS_PRESERVED PASS … every figure is live" | "Urgent alerts 3 · A driver asking for help" with 0 open emergencies | Corrected (M3, §8); fixed (AUD2-01) |
| M15: "FUNCTIONS_PRESERVED PASS" | Resolved SOS rows "needs an answer now" + primary Call | Corrected (M15); fixed (AUD2-04) |
| §7/§14: the dossier's full number is owner decision "B3 R6" | R6 covers the Drivers drawer only; E2E lane rated it P2; Fleet detail and SOP also show it | Corrected (§7 step 11, §14 #2 at the time, now #4); fixed in manager-web (E2E-R1) |
| §7/§11 carry the E2E lane's defects | E2E-R3, R5, R6 missing | Corrected (§7, §11 ID map); R3 and R6 fixed, R5 open |
| §9/§11: the oxlint error is REG-8 | It is REG-9 (with 9 unused items); REG-8 is `login_forgot`; REG-10 unnamed | Corrected (§9); all three dealt with |
| GREEN_ACCENT_ONLY: FUEL dot "not measured" | 2 FUEL pins `#15803D`, 422 device px | Corrected (§3); fixed (REG-5, 0 px) |
| M1 COLOR_MATCH_DARK cites `region-dk1.json` for the whole frame | That file has no whole-frame figure; `frame_mean.mjs` on the proof reproduces it | Corrected (M1) |
| §1: "40 of the first run's defects are now fixed" | §11 marks 42 rows (2 code-only, 1 device-path-only, E2E-D4 twice) | Corrected (§1, §11) |
| D3: the ×1.3 CSS break is "All emergenc\|ies" | It is "All emergenci\|es" (@13); "emergenc\|ies" (@12) and "Ambulan\|ce" (@7) are ×1.5 | Corrected (D3) |

### Audit 2's 17 document corrections

| # | Correction | Where applied |
|---|---|---|
| 1 | D5 ACCESSIBILITY: large text FAILS on both paths; Trip 0/6; new ID | D5 (AUD2-02) |
| 2 | §4 Driver large-text row per theme; §15 RESPONSIVE and ACCESSIBILITY with Trip | §4; §15 |
| 3 | M3 FUNCTIONS_PRESERVED → PARTIAL with AUD2-01; §8 open truth; REAL_DATA_ONLY; REDESIGN_CERTIFIED P2 list | M3; §8; §15 (history, then fixed) |
| 4 | M15 → PARTIAL with AUD2-04 | M15 |
| 5 | §8 "every figure is live" → "except the Urgent alerts hint" | §8 |
| 6 | §7 step 11 phone wording; §14 #2 (now #4); E2E-R1 in §11 | §7; §14; §11 |
| 7 | §7 step 7 E2E-R3; §11 E2E-R3, R5, R6 | §7; §11 |
| 8 | §9 REG-9 naming, unused list, REG-8, REG-10 verdict | §9 |
| 9 | §3 and GREEN_ACCENT_ONLY: FUEL pin measured green | §3; §15 |
| 10 | §1 Dark qualification; §15 DARK_BG_BLACK; M1 citation | §1; §15; M1 |
| 11 | §1 token revocation; §11 AUD-03 row | §1 Method; §11 |
| 12 | §1 chrome_BITS attribution | §1 Method |
| 13 | §1 "40 fixed" → 42 rows | §1; §11 |
| 14 | D3 break wording | D3 |
| 15 | M3 AUD2-08 | M3 |
| 16 | §11 add AUD2-01, AUD2-04, AUD2-05/E2E-R3, AUD2-06/E2E-R5, AUD2-07/E2E-R6, the Trip item, E2E-R1; ID map; remove "RE2E-3" | §11 |
| 17 | §15 REDESIGN_CERTIFIED: NO stands; LAZY-1 reproduced; AUD2-01 and E2E-R1 in the P2 list | §15 (as history; both fixed since) |

The perf lane's **RPERF-DOC** (§6 carried first-cert figures and a wrong phone claim) was applied by the re-certification; §6 also records the final round's RPERF-1 figure.

### The final verification's document corrections

| # | What this document (final-round text) said | What the evidence shows | Where applied |
|---|---|---|---|
| 1 | §4 and §15: 200% zoom passes for every state, including the Fleet details panel (re-certification matrix) | The harness opened each state at 100% and clicked the Fleet row again at 200%, which unselected the trip; the re-certification and this run both measured "No truck selected" (FV-M-1). A clean re-check on a fresh page: panel present, 0 overflow, 0 clipped, 0 words lost, both themes | §2 M5, §4 |
| 2 | §2 M5 and §5: "Map rings 96–100% (A11Y-3)" | The OSM attribution toggle scores 66.7% on the perimeter metric in both themes, then and now; its close-up shows a whole circular ring (FV-M-2) | §2 M5, §5 |
| 3 | §6: RPERF-2 "fixed in structure … not re-timed"; tables stop at the re-certification build; the environment caveat an open question; no AVIF, Overview-AVIF or DPR-2 phone figures (FPERF-DOC) | Re-timed: mobile marker −8.5% vs snapshot, at the cost of FPERF-1; the quiet session confirmed the caveat; four-build figures for PERF-3, PERF-4, PERF-6 and the new FPERF-1/2/3 | §6 |
| 4 | §4: large text on an active trip 72/72 at 360×640 | True where it was measured (a short "Then" line); at a point where the "Then" line names a road, both paths cut it at ×1.3/×1.5 (FV-DRV-01) | §2 D2, §4 |
| 5 | The perf lane's session note: all 33 driver runs signed out, "logout 200" | 15 of those 33 refresh families are still live (read-only count for this document), and the logout endpoint returns 204, not 200 | §1 Tokens, §14 #11 |
| 6 | `docs/REDESIGN_IMAGE_ATTRIBUTION.md`: the Overview AVIF "not measured here"; suites 502/502 and 913/913 | Measured: 55,674 B on desktop and 130,167 B on a DPR-3 phone; the suites are 530/530 and 929/929 | that document |
| 7 | §9: raw hex in FleetMap (REG-1), `scene.ts` (REG-5) and `App.tsx` (REG-6) | All three closed in source; 5 raw hex left, in the print-only export stylesheet | §9 |

### Audit 3's 9 refuted claims and 12 document corrections (applied in fix round 4)

| # | What this document (final-verification text) said | What the evidence shows | Where applied |
|---|---|---|---|
| 1 | §2 and §15: "41 captures plus a settled frame … 0 overlaps, 0 wording hits" | 42 captures (21 states × 2 themes) plus 1 settled frame; the script taglines overlap on Region and Login in both themes (by design); Diagnostics has "30-day mean" | §2, §15 |
| 2 | §4: driver overflow "339 + 98 + 56 + 56 + 182" | That sums to 731; the 8 keyboard captures at 360×340 make 739; `shots/` holds 740 files | §4 |
| 3 | §1 and §14 #11: a cert.ekh family "first issued at 14:19 IST" still rotating | The rotating family is `3fde1a5b`, first issued on 26 Sep at 20:09:06 IST (305 tokens by 00:28:55 IST on 29 Sep, non-headless Windows Chrome); the 14:18–14:19 family `55f3ec9e` is live but idle | §1 Tokens, §14 #11 |
| 4 | §1, §12 and §14: the 15 live perf-lane families "not investigated"; "logged 200 while the endpoint returns 204" | They are exactly the snapshot and c1 builds' runs (fast 6, mobile 6, extra 3), which keep no refresh token, so their logout posts `{}`; all 18 r2/now runs were revoked; the 200 is the CORS preflight | §1 Tokens, §14 #11, §15 |
| 5 | §6: "exactly one assets/redesign request … and exactly one image preload" in all 18 loads | Login at 390 fetches no photo; the 6 Overview loads carry no preload; only the 12 Region and Login loads have one | §6 |
| 6 | §5, §7 step 11, §11: "Escape and the X return focus", citing `dossier_open_*.json` | Those files record focus-in only; the return is in `notes.jsonl`, once per path (Escape in Dark, the X in Light) | §5, §7, §11; re-walked in both themes (§7) |
| 7 | §1 and §3: manager non-photo luminance "0.013–0.039 on every page" | The drawer and dialog states are darker (0.0058–0.0102): the range is 0.006–0.039 | §1, §3 |
| 8 | §1 (b): the rest of E2E-R2 an open P2 | §11 rated it P3; it is P3 everywhere now (the manager is told; the record is missing) | §1, §14 |
| 9 | §1 (b): PERF-4 qualifies because it "needs the APK" | It was measured on the web and its fix needs no device; it qualifies as the §14 #3 owner decision with its trade-off | §1, §6, §14 #3 |
| 10 | §2 M7, §8, §11 FV-E2E-1: no word on what the stale "Plan route" would do | It posts `/routes/recalculate?detailed=true`, which has no trip-status guard (code-read, not executed) | §2 M7, §7, §11 (A3-01) |
| 11 | §1 Counting: "the final verification confirmed all 11" | 11 checked; 8 confirmed fully and 3 with named exceptions (FV-E2E-1, FV-DRV-02, PERF-3) | §1 |
| 12 | Nothing on A3-02 | Trips said "On the road" for an ACTIVE trip with no route while Overview said "Needs a route" | §2 M6, §8 (fixed) |

The driver's neutral surfaces (`#1B201E`, `#121514`, `#232826`) were added to §1 and §3 with correction 7.

---

## 13. Known visual differences, and why

| Difference | Where | Why |
|---|---|---|
| Real values, dashes and UNKNOWN / UNAVAILABLE / STALE instead of the mockup's figures | All | Data truth. UNKNOWN is never SAFE. |
| No sparklines or trend deltas | Overview KPIs | No time series is stored. |
| "Urgent alerts" counts open SOS; unread notices are its caption | Overview | A resolved SOS is not a driver asking for help (AUD2-01). |
| No global search, SSO, "Forgot password?" or "Change Region" | Shell, logins | Nothing backs them. |
| Photos differ in subject (except the two truck scenes) | Region, Login, driver heroes | Only licensed Commons photos are used. |
| Region card 405 vs 303 px; login fields about 42 px lower | M1, M2 | The four-scope control (§16.3 #4) and the "Opening X · Change" chip. |
| Region/Overview map: neutral fill + accent outline in Dark, green fill in Light | M1, M3 | Green is an accent in Dark (DK-1). |
| Gold map pin, red only for emergencies; blue route | Region, Navigate | §16.3 #13. |
| Live map on request on Overview | M3 | Owner decision (B2R2). |
| Phone numbers masked on screen; the full number only behind a Call button | Drivers list, Fleet detail, SOS dossier | Masked by requirement; the Drivers profile drawer shows it in full (R6). |
| Driver trip titled by places ("Guwahati → Shillong"); Navigate subtitle and next-stop tile show the place | D2, D5 | The full postal address was cut on phones; it stands whole on the Trip tab. |
| The guiding map grows under large text at narrow widths | D2 | Room for the maneuver card, gauge and rail. |
| 4 driver tabs, no centre disc, no Home | Driver | §16.3 #5 |
| Larger type on driver Safety and the Navigate subtitle; 48 dp targets; Navigate regions outside ±2% | D2, D3 | Legibility for a moving cab; RC-DRV-05 open. |
| Disabled primary CTA at 50% (forest in Light, mint in Dark) | Logins, planner | §16.3 #12 (owner decision). |
| OSM raster basemap, not satellite | Maps | §16.3 #14 |
| Extra screens with no reference | Driver | Required functions (§16.2). |
| Hero photos run under the status bar | Driver | CERT-DRV-08; scrim open (RC-DRV-08). |
| "Menu" disclosure on phones and at 200% zoom | Manager shell | RESP-4. |
| "Driver asked for a new road" in the warning tone, with "Review new road"; accepting happens only on Fleet's Route tab | Trips, trip review, Fleet | A driver's request is neither an incident nor a success; the new road is only taken through the existing reroute path, where eligibility is checked (E2E-R2) |
| Hero and card photos served as AVIF with the WebP as fallback | Region, Login, Overview | 18–26% fewer bytes; the photo differs from the WebP by 0.4–1.1 levels per channel and its box by 0 px (PERF-3) |
| The Dark Fleet LIVE marker and the driver's GPS marker are the accent green | Fleet, driver Navigate | Green is the accent in Dark; a second green data hue would break accent-only (§14 #16). Light keeps its own greens |
| SPEED "Unavailable" for a LIVE truck | Fleet detail | The web build's fixes carry no speed; a missing value is never shown as 0 |
| "Reroute approved" in the success tone (accent text) on Navigate for 5 minutes, and on Trip with "Your manager approved a new road…" | Driver | The manager's decision is made, so it is a done thing, unlike the manager's warning-toned request that still waits for a decision (FV-E2E-2) |
| "Trip complete" on the empty Trip page for 30 minutes after a delivery | Driver | The server's current trip is an open one, so the delivered trip leaves the poll within 10 s; the app keeps saying what the driver just did (RE2E-2) |

---

## 14. Owner decisions still open

Each item says what is to be decided and what each choice costs. Items 2 and 3 hold the two open P2s, which the verdict rule lets stand as owner decisions with their trade-offs (§1). Item 1 is P3, the missing record of a reroute; it is listed here because it needs a migration.

1. **Migration 0016: record the driver's reroute and notify on it** (the rest of E2E-R2, and E2E-R5; both P3). `proposed_reroute` now tells the manager without a migration, but nothing lands in `trip_events` when a driver asks for a road or when a manager approves a route on incomplete evidence (Journey History goes from "Stop completed" to "Journey changed"), no manager notification is written, and a request that a re-plan supersedes disappears without a record. A migration would add `REROUTE_REQUESTED` and `ROUTE_APPROVED` to `trip_event_kind` and a reroute kind to `notification_kind` (enum `ADD VALUE` in an autocommit block), with their writers and tests; the prepared `docs/migrations/PENDING_reroute_decision_events.sql` (decline events) could be folded in, and a real `proposed_by` column would replace the audit-row derivation. **Trade-off:** the next free revision is 0016, which `docs/POST_DEMO_CHANGE_INVENTORY.md` (lines 58–59 and 88) already assigns to the pdf branch's `device_events` migration once it is renumbered from 0013. Taking 0016 here means re-planning that renumbering (`device_events` becomes 0017 with a new `down_revision`); waiting keeps the timeline and the notifications incomplete. Either way it is a schema change on a shared database and needs explicit approval.
2. **PERF-3: the hero photo is the LCP on Region and Login.** Mobile LCP is +51.8% / +47.8% against the same-session snapshot (2684 / 2608 ms against 1768 / 1764 ms, where the snapshot's LCP is text), after AVIF saved 8.2% / 4.1%. The sign-in form is usable 13% sooner than in the snapshot and FCP is 14–15% sooner; only the photo paints later. **Choices and costs:** accept it as the price of the photo (no work); preload the hero from `index.html` (the reverted experiment: LCP −18 to −20% at 1600×900, but FCP +44% and the usable form +35–39% later on HTTP/1.1, and a wasted 97–132 KB download for a signed-in visit to `/` with no cache key); preload it at DOMContentLoaded (no FCP cost, but only −5.6% / −6.4%); or draw a smaller file at 1600 px (the 1280w file upscaled 25% under the scrim). HTTP/2 hosting was not measured and may change the preload trade.
3. **PERF-4: pre-decode the driver's tab photos, or accept the first-visit cost.** On the web mobile profile, the first visit to Navigate / Safety / More is +21.1% / +31.5% / +20.8% to "selected" and +75–116% to settled (the hero photo decode, heavier trees, Leaflet). On the fast profile it is under one frame. **Trade-off:** pre-decoding the three tab photos after sign-in (about 515 KB of compressed WebP) and memoising `ScreenHero` spends memory and CPU right after sign-in, on every phone, to save a cost measured only in a browser. Not doing it keeps the first visit to each tab slower on a slow phone. The fix needs no device. An APK measurement is the follow-up that would size the saving; the perf lanes asked for it first, and it needs a phone (`adb` is not installed).
4. **Full phone number in the Drivers profile drawer** (B3 R6, phase-b3 mismatch-log row 22). Everywhere else the number is masked, with the full number only in a Call button's `tel:` link. **Trade-off:** keeping it lets a manager read it out or copy it to another phone; masking it matches the rest of the console and reduces screenshot and shoulder-surfing exposure.
5. **SOP step 1's server wording.** The server writes the driver's full number into the dossier's SOP step 1 (`backend/app/domain/sentinel.py:331`); the manager masks it on display (`+••••••••••03`, seen live). **Trade-off:** rewording the step on the server ("Attempt voice contact with the driver: use Call driver above") removes the number from the stored text and from any client that does not mask, at the cost of a backend change and a step that no longer stands alone when copied or printed.
6. **Dark disabled primary** (§16.3 #12). A disabled primary in Dark is the accent at 50% on black, a `#207054` bar (Log In, the planner's Create draft trip), which still reads as a green button. **Trade-off:** keeping it says "this is the action, not ready yet" in the accent's own colour; a neutral grey disabled state removes the last green bar from Dark but loses that cue.
7. **REG-10 accent-soft tints.** Dark `--accent-soft #13291F` and `--success-soft #12241C` sit under accent icons and text on the KPI tiles, success pills, the avatar disc and the reroute advisory; the driver uses a neutral `successSoft #131816`. **Trade-off:** keeping them groups accent elements (audit 2 accepted them as accent tints); neutralising them makes the two apps agree and the Dark surfaces strictly neutral, at the cost of flatter KPI tiles.
8. **Web-only large text.** React Native Web reports font scale 1, so under CSS-only text zoom the Safety number tiles break mid-word at 360, the Safety tools and the Navigate quick actions cut or break at 412/450 (FV-DRV-03), and two route tiles cut at 450. The Android font-scale path passes all of them. **Trade-off:** accepting treats the web build as a demo surface (drivers use the APK); fixing means laying these tiles out by measured text width, as FINAL-1 did for the route tiles, which is more layout code and tests for a path drivers do not use.
9. **Navigate spacing (RC-DRV-05).** The hero, search, map, quick row and tab bar sit outside ±2% of `driver2.jpeg`. **Trade-off:** tightening moves the screen towards the reference but shrinks the 48 dp targets and type chosen for a moving cab.
10. **Driver status-bar scrim (RC-DRV-08).** Scrolled content passes under the transparent status bar. **Trade-off:** a scrim keeps the clock and icons legible over content but darkens the top of every hero photo; it can only be judged on a device.
11. **Old refresh tokens.** A read-only count at 22:36 IST found 750 live refresh-token families in the cert DB. 18 of them were first issued after 18:30 IST: 15 from the perf lane's driver runs and 3 from fix round 3's read-only driver checks.
    - **The 15 are explained** (audit 3). They are exactly the runs of the pre-redesign snapshot and c1 builds. Those builds keep no refresh token, so their UI sign-out posts `{}` and the server cannot revoke the family. Every r2/now run was revoked.
    - **The rotating `cert.ekh` family (`3fde1a5b`)** was first issued on 26 Sep at 20:09:06 IST. It rotates about every 15–16 minutes from a non-headless Windows Chrome, so it predates this certification and is probably a long-open browser tab.
    - Fix round 4's three families are revoked.

    **Trade-off:** revoking the harness families by SQL is a write to the cert DB and could end a session someone is using, such as that `cert.ekh` tab. Letting them expire leaves valid tokens for demo accounts until then. A pre-redesign build can never revoke its own family, so future perf runs of the snapshot should either end with an SQL revocation (an owner-approved write) or accept the leftovers.
12. **Overview live map on landing** (B2R2). The map loads on request today. **Trade-off:** loading it on landing shows positions at once but adds the map chunk (about 250 KB on the wire) and tile traffic to every Overview visit.
13. **Photo alt text.** The photos are decorative (empty `alt`) with a visible credit. **Trade-off:** descriptive alt text tells screen-reader users what the scene is, at the cost of extra speech on every sign-in.
14. **Scoping `/api/org/states` and `/api/org/districts`** for state and district managers. Any `trip:read` holder can list every state and district. **Trade-off:** scoping hides geography outside a manager's area; leaving it lets pickers and schematics show the whole region, and the lists hold no personal data.
15. **North-East region gate** (B3 D4, backend). Pickup and destination points outside the service box (21.5–29.5 N, 88–97.5 E) are refused. **Trade-off:** the gate keeps trips where the routing and risk sources were validated; widening it would accept legs whose evidence nobody has checked.
16. **Dark "live" markers are the accent.** Fix round 3 made the manager's Fleet LIVE marker and the driver's live GPS disc, dot, truck arrow and NORMAL traffic stroke the accent `#39D8A0` in Dark, so no data hue in Dark is a second green. **Trade-off:** "live" and "action" now share one colour in Dark; a non-green live hue (two lines in `MAP_DARK` in `driver-app/src/theme.ts` and the manager's Dark `--marker-live`) would separate them, and must still meet the chip contrast that `theme.test.tsx` checks. Light keeps its greens.
17. **The remaining P3 performance costs.** PERF-6 (CSS +49.4% on the wire, the redesign's own utilities), FPERF-1 (Fleet mobile text LCP +15.6%, the price of RPERF-2's −8.5% truck marker), FPERF-2 (unthrottled Fleet +30.1% from React's Suspense reveal throttle) and FPERF-3 (+23 ms sign-in to Trip on a desktop CPU). **Trade-off:** each is small next to the redesign's gains (first-load JS −28.7%, FCP −14%); fixing FPERF-1/2 means restructuring the lazy Fleet route and its first fetch, close to the LAZY-1 recovery path.

Closed in fix round 4: none of the owner items. A3-01's server half is not an owner decision; it is backend work, listed in §11. Closed since the re-certification: LAZY-1's recovery behaviour (reload on Try again, never while offline) was a design choice within the fix, not an owner item. Closed since the final fix round: "Driver-initiated reroute: notify, flag, record a trip event" is now item 1 for the event and notification; the flag shipped in fix round 3.

---

## 15. FINAL REPORT

```text
REFERENCE_AUDIT            = DONE. docs/REDESIGN_REFERENCE_AUDIT.md (§16 decisions applied; §16.3 #1 "Ten ... downloaded, six shipped"); all 7 references (manger1-3, driver1-4) read and used as the visual target only
LICENSED_IMAGES            = PASS. 6 Wikimedia Commons photos shipped (of 10 downloaded) as 21 files: manager 16 (8 WebP + their 8 AVIF twins), driver 5 WebP. Every photo on screen carries a visible credit; credits lists in both apps (manager 3 photos, driver 5 files); the sign-in credits sit in a "Photo credit" landmark
IMAGE_ATTRIBUTION          = PASS. docs/REDESIGN_IMAGE_ATTRIBUTION.md matches the shipped files: one row per file with author, licence and bytes for all 21, each shipped file byte-identical to its source (final-verify/regression/photo_credit_coverage); WebP and AVIF sections, totals, and screen usage with the measured AVIF bytes (Overview included); fix round 4 recorded the deleted template images and the new suite counts (CRLF kept; ScenicImage.test 8/8, photoCredits.test 7/7 after the edit)
IMAGE_BYTES_BEFORE_AFTER   = originals -> shipped: manager 15,141,357 -> 1,173,280 B WebP, plus 913,698 B of AVIF twins (2,086,978 B in 16 files); driver 17,714,842 -> 699,340 B; all shipped files 2,786,318 B; a page fetches one format of one width per photo. On the wire at 1600x900: Region 177,797 -> 132,119 B, Login 129,879 -> 106,775 B, Overview card 68,216 -> 55,674 B; Region on a DPR-3 phone 235,223 B (re-certification) -> 97,106 B
MANAGER_REGION             = PARTIAL (card spacing; PERF-3 as an owner decision; photo subject). Dark non-photo green 1.13% (outline and Continue); AVIF hero; 0 on every responsive gate
MANAGER_LOGIN              = PARTIAL (fields about 42 px lower; PERF-3 as an owner decision; photo subject)
MANAGER_OVERVIEW           = PARTIAL (KPI spacing as measured in the first run). Matrix re-run clean after the KPI text change; AVIF card 55,674 B; AUD2-01, AUD2-08 and SCHEM-1 fixes stand
MANAGER_OTHER_PAGES        = Shell and Trips PASS (the reroute attention live on Trips; A3-02 fixed live: 'Needs a route' for a moving trip with no road). Drivers, Trucks, States, Managers, Reports, Notifications and Diagnostics PASS (re-captured at 1600 in both themes; matrix clean). Fleet PARTIAL (FPERF-1, FPERF-2, both P3; FV-E2E-3 fixed live, cleared 0.25 s after an approve; the dossier's focus trap and both close paths walked live in both themes). Trip review PARTIAL (E2E-R5, P3; FV-E2E-1 fixed and seen live on an already-open review: the driver's request +3.72 s, a cancel +3.19 s). Review and Assignments PARTIAL (authorise/revoke and the manual plate verify not seen live)
DRIVER_LOGIN               = PARTIAL (Sign In higher; trust labels +16%; photo subject)
DRIVER_NAVIGATE            = PARTIAL (RC-DRV-05 spacing; web-only FV-DRV-03; PERF-4). Fixed in fix round 4 and seen live: FV-DRV-01 (the 'Then' line wraps at 360 under large text; 12 probes, 0 cut), FV-DRV-02 (a roundabout told once; live at km 9.87), FV-E2E-2 ('Reroute approved' +4.84 s after the manager's approve, with the switch to the new road). Earlier: RC-DRV-09 (108 probes, 0 overlays), REG-5 palette, maneuver wording and icons, the driver's off-route request
DRIVER_SAFETY              = PARTIAL (web-only CSS large text: mid-word at 360, tool lines at 412/450; spacing; PERF-4). Android path 21/21
DRIVER_MORE                = PARTIAL (photo subject; PERF-4)
LIGHT_THEME_MANAGER        = PASS (0 AA text failures in 42 captures and 463 cells; minimum 4.27:1 on large text over the photo; Light markers unchanged)
DARK_THEME_MANAGER         = PASS (surfaces #070808/#0E1110/#151918/#1B201E; non-photo luminance 0.013-0.039 on full pages and 0.006-0.039 with drawers and dialogs; green only the accent, its soft tints and the disabled primary; the LIVE marker is the accent; audit 3's live re-render agrees)
LIGHT_THEME_DRIVER         = PASS (21 Light screens at 450; 0 flat-surface low-contrast runs; Light map unchanged value for value; the 'Reroute approved' banner #DFEFE4 with #076C4D text)
DARK_THEME_DRIVER          = PASS (22 Dark screens; #070808/#0E1110/#151918/#1B201E, tab bar #121514/#232826; green only the accent; the GPS marker is the accent, service pins violet/amber/slate; the 'Reroute approved' banner is the neutral #131816 under accent text)
DARK_BG_BLACK              = YES for every Dark UI surface in both apps (manager body, html and main #070808, topbar #0E1110, largest surfaces #070808/#0E1110/#151918/#1B201E; driver #070808/#0E1110/#151918/#1B201E plus the neutral #121514 and #232826 of the tab bar), confirmed by audit 3's live re-render of 10 manager and 7 driver screens. Not surfaces: the Region's licensed forest photo under the neutral scrim (7.08% whole-frame green-hue) and the Login panel's hills
GREEN_ACCENT_ONLY          = YES. Green in Dark is the accent #39D8A0 (CTAs, active tab, links, the LIVE and GPS markers), its accent-soft tints (REG-10, §14 #7) and the dimmed disabled primary #207054 (§14 #6); no Dark map, marker, pin or POI hue is green except the accent (manager tokens and pixels; driver palette and live probes)
REAL_DATA_ONLY             = PASS. No invented value and no stale-as-current value found (FV-E2E-1 fixed and seen live). Open omissions, not false values: E2E-R5 and E2E-R2's record (Journey History has no entry for the incomplete-evidence approval or the driver's request; migration 0016). Everything shown is real or labelled UNKNOWN/UNAVAILABLE/NOT ASSESSED/STALE
FAKE_SAFE_LABELS           = 0 (SAFE only in "never safe" copy, the check-in answer and the translator's phrases; UNKNOWN is never SAFE)
FUNCTIONS_PRESERVED        = PASS on the web for every function exercised. Fix round 4's lifecycle TRP-82192454-4D98-4BD4 passed plan -> route -> approve on incomplete evidence -> dispatch -> accept -> start -> pickup -> drive -> driver off-route request -> manager attention (Trips row, an already-open review, Fleet) -> approve the new road -> 'Reroute approved' and guidance switch -> SOS -> dossier -> resolve -> deliver -> close, and a draft cancelled under an open review; the final verification also passed Export CSV and RBAC in and out of scope. Open, P3: E2E-R5 and E2E-R2's record (migration 0016), A3-01's server half, RE2E-2's fix not seen live. Not seen live: Route Review authorise/revoke, manual plate verify, the truck-check gate, the driver's Acknowledge of a journey change, RC-DRV-07/10/11, the pre-start 3-rail state at 360, the AVIF fallback in a browser without AVIF
MANAGER_TESTS              = GREEN (536/536, 54 files, twice in fix round 4; 530/530 in the final verification)
DRIVER_TESTS               = GREEN (935/935, 78 files, twice in fix round 4; 929/929 in the final verification)
TSC                        = CLEAN (manager tsc -b --noEmit exit 0; driver tsc --noEmit exit 0; fix round 4)
BUILD                      = PASS (fix round 4: manager vite build --mode remote-demo exit 0, entry index-nGqFSTpo.js 336.92/106.55 kB, CSS index-C7eS2s4_.css 73.95/15.55 kB, the only warning the lazy mapSetup chunk; driver expo export --platform web exit 0, 555 modules). Backend pytest on the isolated DB: not re-run because no backend file changed (115 changed backend files hash-identical to the final verification's list); its last runs on that code gave 1586 passed, 5 skipped (the final verification's second run and audit 3's re-run; REG-T1 can fail a run by chance, P3 test data)
CHROME_VISUAL_PROOF        = PASS. Final verification: manager 42 captures (21 states x 2 themes) plus 1 settled frame at 1600, 463 matrix cells, 38 states at 200%, rings and landmarks; 0 overlaps except the by-design script taglines on Region/Login, and the only day/night hit Diagnostics' '30-day mean'; driver 22 Dark and 21 Light proof screens and 739 measured captures (740 files); E2E 82 shots. Fix round 4: 27 E2E shots (key steps in both themes: the open review with the driver's request, the cancelled draft, Fleet, the dossier, the driver's banners, the FV-DRV-01 probes). All were read for this document. Gaps: the manager matrix was not re-run after fix round 4 (content-only changes, seen live)
PHYSICAL_ANDROID           = BLOCKED (adb not installed: not on PATH, no platform-tools; nothing installed on a phone)
RESPONSIVE                 = PARTIAL. Manager: 0 on every gate in 463 cells and in 38 states at 200% (the Fleet details panel re-checked cleanly; the FV-M-1 harness fixed). Driver: 0 overflow, 0 small targets and 0 unnamed controls in 739 captures; keyboard 38/38; safe areas pass; FV-DRV-01 fixed (12 live probes at 360, both paths, both themes, 0 cut). Open: the web CSS path's large-text class (FV-DRV-03 and Safety at 360; two route tiles at 450), web-only; the Android path passes
ACCESSIBILITY              = PARTIAL. No P1. Manager: 0 unnamed controls, 0 AA failures, Tab walks with 0 back-steps and 0 stops under the topbar, rings 96-100% (the round attribution toggle 66.7% on a square metric, with a whole round ring), correct landmarks; the dossier walked live in both themes (focus in, 25 Tab and 25 Shift+Tab inside, Escape and the X each return focus). Driver: Navigate order complete in both directions, no traps; RC-DRV-09 and FV-DRV-01 fixed. Open: web-only resize text (FV-DRV-03), RC-DRV-08 (device)
PERFORMANCE                = PARTIAL. Four builds in one quiet session (final verification): entry JS -35.0%, first-load JS on the wire -28.7%, FCP -13.7..-15.1%, first useful render -3.4..-13.3% (mobile) and -60..-75% (fast), Fleet first truck marker -8.5% (RPERF-2 re-timed), hero bytes -18..-59% against the re-certification build (AVIF). Open: PERF-3 (Region/Login mobile LCP +51.8%/+47.8%, owner decision §14 #2), PERF-4 (driver first tab visits +21.1%/+31.5%/+20.8% on the web mobile profile, owner decision §14 #3, APK measurement to follow), PERF-6 (CSS +49.4% on the wire), FPERF-1, FPERF-2, FPERF-3 (P3). Fix round 4 not re-timed (same manager entry size and CSS file; +1 driver module)
KNOWN_VISUAL_DIFFERENCES   = See §13. Data truth; licensed photos with other subjects, served as AVIF with a WebP fallback on the manager; legibility (type, targets, place names on the driver); §16.3 decisions #2-#6, #12-#14, #16, #18, #19; Dark map fill neutral with an accent outline; the Dark LIVE and GPS markers are the accent; masked phones; 'Driver asked for a new road' in the warning tone and 'Reroute approved' in the success tone; 'Trip complete' kept 30 min on the driver's empty Trip page; edge-to-edge driver heroes; phone Menu
REDESIGN_CERTIFIED         = YES (Chrome/web; physical Android pending). Verdict rule applied literally: (a) MET, no open P0 or P1. (b) MET: FV-E2E-1 fixed and seen live; the two open P2s are owner decisions with their trade-offs (PERF-3 = §14 #2, PERF-4 = §14 #3); E2E-R2's record and A3-01's server half are P3. (c) MET: manager 536/536 and driver 935/935 twice, tsc clean in both, both builds pass; backend unchanged since 1586 passed, 5 skipped. (d) MET: Dark black on every UI surface in both apps, green accent-only (audit 3's re-render agrees). (e) MET: TRP-82192454-4D98-4BD4 passed the whole lifecycle, the driver-reroute attention (including a review open since before the plan) and the SOS dossier checks in both themes; disclosed: RE2E-2's later fix is test-only. (f) MET: no fake data, no Day/Night wording, every photo credited. Physical Android BLOCKED (adb not installed). History: first run PARTIAL; re-certification NO (LAZY-1 P1 and eleven P2s); final fix round NO (E2E-R2 backend half, PERF-3, PERF-4); final verification NO ((b) and (e) on FV-E2E-1)
SAFE_INDEPENDENT_WORK_REMAINING = Backend, needing no owner decision: A3-01's server half (refuse planning on CANCELLED/CLOSED/DELIVERED trips, 409 TRIP_NOT_PLANNABLE, with a test); REG-T1 (NULL the retained test users' phones in factories.cleanup, or retry unique_phone; clear the backlog in the isolated DB). Checks: see RE2E-2's fix live on a delivered trip; measure the pre-start 3-rail state at 360; re-run the manager matrix once on the fix-round-4 code. After owner decisions: migration 0016 (§14 #1), PERF-3, PERF-4, SOP step 1 wording, REG-10, the Dark disabled primary, web-only large text, RC-DRV-05, RC-DRV-08, token revocation (the perf lane's snapshot/c1 families; the long-open cert.ekh tab), the Dark live-marker hue, the P3 performance items. With a phone: APK checks (PERF-4, RC-DRV-08, the native attribution room, large text on a device)
```
