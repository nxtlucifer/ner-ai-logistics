# CLAUDE HANDOFF

## 2026-09-06 — MAP-FIRST MISSION: navigation, layout, APK, local AI

**HEAD = `f850de4`** · committed NO · pushed NO · shared Supabase UNTOUCHED
Full suite: **942 passed, 1 failed, 5 skipped** (`.runtime/mission-final-gate.log`).
The one failure is the KNOWN baseline `spatial_ref_sys` RLS check - present in
every prior full run (910 passed, 1 failed) and caused by the isolated cluster
installing PostGIS into `public`. 32 new tests, no new failures.

### G1 — the blue line, diagnosed and fixed

**It was the observed GPS track, drawn as ONE unbroken LineString through every
fix.** Measured on `TRP-DEMO1560`, not inferred:

| Between fixes | Distance | Interval | Implied speed |
| --- | --- | --- | --- |
| 11 → 12 | 98,838 m | 21.5 s | 16,566 km/h |
| 107 → 108 | 2,002,509 m | 1,025 s | 7,030 km/h |

The 98.8 km pair is the Guwahati-Nagaon segment in the screenshot; the 2,000 km
pair is a junk fix at Khedbrahma, Gujarat that was drawing a line across India.
The assigned route was never the problem - it is persisted provider geometry and
follows real roads.

`manager-web/src/components/track.ts` splits the track into runs that were
actually sampled, breaking on a gap longer than `LOCATION_STALE_SECONDS` (600),
a speed above `IMPLAUSIBLE_SPEED_KMPH` (200) or a pair that cannot be ordered.
Both constants are mirrored from `backend/app/domain/telemetry_policy.py`. A run
of one fix is drawn as a POINT, never a line. Nothing is snapped, dropped or
interpolated. 8 tests pin the four cases; verified in the browser.

Also G1: layer toggles + a legend + "Fit trip" on the fleet map; spoken
maneuvers via `expo-speech` with a mute control (`src/map/speech.ts` policy +
`useSpokenGuidance.ts` transport, 10 tests). Voice is MUTED BY DEFAULT and is
cancelled on hold, route change, mute and unmount.

### G2 — layout and addresses

Detail panel: Overview / Route / Cargo / Activity tabs inside a viewport-bounded
scroll box. Measured at 1440x900: content 663 px inside a 368 px box, page 1,395
px (was an unbounded stack). No horizontal overflow at 1440x900, 768x1024,
390x844 or 200% zoom (720x450).

Trip planner: the four raw lat/lon boxes and their DEFAULT DEPOT COORDINATES are
gone. `AddressPicker` gives Google Places autocomplete (server-side key),
"Choose on map" and coordinates under Advanced. Every coordinate now carries a
provenance - GOOGLE / MAP / MANUAL - and an endpoint with none is refused rather
than substituted. That default was the real bug: changing only the address text
shipped a route to the depot with the right words on screen.

### G3 — APK

**Download:** https://expo.dev/artifacts/eas/VTfjQBFACrFzL0_rRQdHR2JHS8tyUFHdSJMv_gVxuOg.apk
(73.3 MB, build `4c9331fe`, verified HTTP 200). The earlier successful build
`bbe966dd` stays available at
https://expo.dev/artifacts/eas/2x3x6jJb1UJdAHup9NUzU2dG9xcnxFBuhf97JLxQJ_E.apk

**One known difference from the working tree:** build `4c9331fe` started before a
copy fix landed, so the Safety screen's AI-unavailable panel reads "The guidance
above below still works". Fixed in `src/ai/AiPanel.tsx`; it needs the next build
to reach a phone. Nothing else differs.

Built and downloadable. `com.nxtlucifer.nerlogistics.driver.preview`,
`@nxtlucifer2296/ner-driver-app`. Four failed attempts, all worth recording:

1. `.easignore` inside `driver-app/` - **EAS archives from the REPO ROOT**, so
   the first two uploads were 1,020 MB and included `.runtime/` (the Postgres
   data directory, server logs and the synthetic login files). See BLOCKERS.
2. `npm ci` refused an out-of-sync lockfile: `eas-cli` in devDependencies pulls
   `@expo/require-utils` with a `typescript@^5` peer against the app's
   TypeScript 6. Removed - it is a CLI, not an app dependency.
3. Metro could not resolve `../i18n/language`: `.easignore` patterns were
   unanchored, so `i18n/` also matched `driver-app/src/i18n/`. Every directory
   pattern now has a leading slash.
4. Archive after the fixes: **766 KB**.

### G4 — local AI

Written and wired end to end; **no model is installed on this laptop** (no
Ollama, no LM Studio, no gguf, no torch - checked). So every surface renders its
honest unavailable state, verified in the browser and against the running API:
`/api/ai/status` returns `available: false`, `/api/ai/ask` returns 503
`AI_UNAVAILABLE`. It has never generated a token.

One service (`app/services/inference.py`), three prompts
(`app/domain/ai_prompts.py`), three surfaces. Loopback-only by default,
one concurrent generation, bounded prompt and output, driver-scoped context with
no trip id in any signature.

## BLOCKERS

**BLOCKER-A — `.runtime/` was uploaded to Expo's build servers.** Two archives
(builds `46c75178` and `51382c18`, both errored) included `.runtime/`: the
synthetic login files, `pgpass.txt`, the local Postgres data directory and the
demo server logs. Cause in G3 item 1 above; fixed by the root `.easignore`.
These are synthetic local accounts on a loopback-bound backend, but they left
the machine. **Rotate them** with the existing guarded tool if that matters.

**BLOCKER-B — no Google Maps Platform credentials.** `GOOGLE_PLACES_API_KEY`
(server-side) is absent, so address autocomplete shows its unavailable state.
The phone map no longer needs a key (Leaflet/OSM in a WebView since 12 Sep).

**BLOCKER-C — Google's embedded Navigation SDK is not compatible.**
`@googlemaps/react-native-navigation-sdk@0.17.1` requires `react-native >=0.87.0`
(measured with `npm view`); this project is on 0.86.3 / Expo SDK 57. 0.16.3 has
loose peers but is an older release. Not attempted, and the existing
approved-route navigation is untouched.

**BLOCKER-D — no local model.** Installing a runtime and downloading weights is
a download to this machine, which needs the owner's go-ahead. Once Ollama is
running, `ollama pull llama3.2:3b` matches the configured `AI_MODEL` and every
surface lights up with no code change.

**BLOCKER-E — the APK has never run on a handset.** Build success is proven;
install, login, map and foreground GPS are NOT.

## DO NOT REPEAT

- Diagnosing the blue line. It is the observed track, with measured numbers.
- Looking for a local model runtime on this machine. There is none.
- Putting `.easignore` in `driver-app/`. EAS archives from the repo root.
- Writing unanchored directory patterns in `.easignore`.
- Adding `eas-cli` to `driver-app/devDependencies`.

---

# CLAUDE SESSION HANDOFF

LAST UPDATED:
2026-09-06 — RUNNABLE DEMO: ONE LAUNCHER, TWO SCENARIOS
(Start-Demo.cmd brings up database, backend, manager and driver and opens them;
Simulate-Journey.cmd drives the Assam route with a labelled simulated GPS;
see docs/DEMO.md. Deck and evidence unchanged.)

PROJECT:
NER-AI-LOGISTICS (SIH26002 — logistics + accessibility intelligence, North East India)

BRANCH:
main

HEAD:
f850de456d03bdcf776bafd1bcd8377f89b763c0 (== origin/main; nothing committed, nothing pushed)

WORKTREE:
modified — nothing staged

OTHER WRITER ACTIVE:
NO — verified. Files touched recently are this session's own edits. One
`python.exe` seen mid-session was the backend suite this session started.

---

## 2026-09-06 — A1-A4: A DEMO SOMEBODY ELSE CAN RUN

Full instructions: **`docs/DEMO.md`**. Summary of what was built and what it
cost to get right.

### One launcher

`scripts\Start-Demo.cmd` (double-clickable, works from anywhere — it resolves
the project from `%~dp0`). Starts only what is not already running, arms the
isolated target for the processes it starts, waits until each one answers, and
opens both apps. `scripts\Stop-Demo.cmd` stops **only** what the launcher
started, matched by recorded pid AND the port it was started for, so a recycled
pid belonging to something else is skipped. The database is left running — it
holds the demo data.

No migrations, tests, `npm install` or password resets on launch. Missing
prerequisites are reported with the exact command, never fixed silently.

**Three bugs found by running it, all in the launcher rather than the product:**

1. `Test-Port` used a default `TcpClient`, which is an **IPv4 socket**. Vite
   binds `localhost` — which on this machine listens on **::1 only** — so the
   launcher waited ninety seconds for a dev server that had been ready in under
   a second and was printing its URL to the log the whole time.
2. Passing the NAME `"localhost"` did not fix it either: .NET resolved it to
   127.0.0.1 and reported "actively refused it 127.0.0.1:5173". The fix is one
   socket per address family, tried in turn.
3. The state file was written with `-Encoding utf8`, which in PowerShell 5.1
   means **UTF-8 with a BOM**. PowerShell read it back happily; python, node and
   jq all failed with "Expecting value: line 1 column 1" on a file that looks
   perfectly fine in an editor.

### Two scenarios, and a way back to them

`backend/scripts/demo_scenario.py` — guarded by the same `db_target` check as
the suite:

    --status          show both scenarios
    --reset-pending   put "Accept trip" back on screen after someone taps it
    --tidy-test-data  clear accumulated TEST rows from the demo screens

Deliberately NOT in the launcher. A launcher that resets scenarios on every
start erases the state you were about to show someone.

**The Trips page was unusable and that was a real demo blocker.** The manager's
driver dropdown held **341 identical "Bipul Das" entries** and the fleet map
showed hundreds of ghost `AS__ZZ` trucks — test rows accumulated because cleanup
is correctly scoped to ids a run recorded, and these predate that ledger, so
nothing can identify them. `--tidy-test-data` removed 243 trips, 248 shipments,
341 drivers, 324 trucks, 410 refresh tokens and deactivated 573 accounts.

That is safe for a structural reason, not a careful one: the demo lives in
different namespaces entirely (`@ner.invalid`, `TRP-`, `AS09LS9001`) from the
test namespaces (`%@p3test.invalid`, `TTEST-`, `STEST-`, `AS__ZZ`), so the
predicates cannot reach it. Both scenarios verified intact afterwards. This is
the ISOLATED cluster; the shared-database cleanup remains unproposed.

### Location: two separate choices

`scripts\Simulate-Journey.cmd` opens a Chrome window whose **geolocation** is
simulated along the approved route, with a **SIMULATED GPS - 80x real time**
banner on screen throughout. Controls: space pause/resume, `s` stop replay and
keep the browser, `q` quit.

Only the position is simulated. Verified live: with the replay running the
backend reported `freshness LIVE`, `travelled 178.2 km`, `on_route True`,
`off_route_m 0.0` — positions travelled from Chrome through the app's own
watcher and uploader into the backend. Nothing was written directly and no API
response was faked.

The runner lives in `scripts/demo/` with its own `package.json`, because
Playwright is a demonstration dependency and has no business in the driver or
manager build. One `npm install` there, once.

A lock file prevents two replays publishing for the same driver, and the dialler
is intercepted so a demonstration cannot place a real call.

The alternative — real device location — needs no tooling: use the app and allow
location. Outside Assam that produces an off-route hold, which is the correct
answer rather than a fault.

### Android

**Not built.** Four things are missing and each is the owner's decision:
`android.package` is unset in `app.json` (permanent app identity); there is no
EAS `projectId` and creating one registers a project on the owner's Expo
account; `eas.json` still carries the placeholder
`EXPO_PUBLIC_API_BASE_URL=http://REPLACE-WITH-REACHABLE-HOST:8000`; and the
backend binds `127.0.0.1`, so no phone can reach it over Wi-Fi. The EAS CLI is
installed and signed in, so once those are decided the build is one command.

---

---

## 2026-09-06 — C0/C1/C2: GUIDANCE CAPTURED, DECK FINISHED

The previous blocker is gone. Live guidance no longer needed the Chrome
extension or a physical phone: **Playwright driving the installed Chrome**
(`channel: 'chrome'`) gives a dedicated test context where geolocation is
granted the ordinary way to the driver-app origin. No browser download, no
extension, and the user's own Chrome profile is untouched.

That distinction matters for honesty: the app's permission check, freshness
check and route checks all run for real. Nothing is stubbed. What is simulated
is only the **position**, and every coordinate is a vertex of the route the
backend had approved at capture time.

### The nine scenarios, with what the panel actually showed

| # | Scenario | Panel |
| --- | --- | --- |
| 1 | Granted permission, subscribed, fresh on-route | `27 km Turn straight` |
| 2 | Countdown on ONE maneuver | `16 km Continue onto Nagaon Bypass` -> `10 km Continue onto Nagaon Bypass` -> `4.9 km Continue onto Nagaon Bypass` |
| 2 | Maneuver transition | `75 km Continue onto Nagaon Bypass` |
| 3 | Permission revoked just after a LIVE fix | `Guidance paused Location is off. Turn it on to see turn-by-turn directions. The route is still shown.` |
| 4 | No new fixes, past the configured window | `Guidance paused Your last position is too old to guide from. The route is still shown.` |
| 5 | Polling/network loss | `Guidance paused No recent contact with the server, so your position cannot be confirmed. The route is still shown.` |
| 6 | Off route | `Off the planned route Directions are paused because your position is not on the assigned ...` |
| 6 | Recovered | `35 km Continue` |
| 7 | Replan preserves the assignment | `4.9 km Continue onto Nagaon Bypass` |
| 8 | Approved replacement | selected_route_id `e040cf7f` -> `4b7a6900`; navigation package follows it; 19 maneuvers |
| 9 | Emergency + dialler | app printed `Last dialler request: tel:112`; no call placed |

Evidence and per-shot notes: `docs/submission/evidence/README.md`.

### Gate after the change

    backend  910 passed, 1 failed, 5 skipped   (126.51s, isolated cluster)
    driver   192 passed, typecheck clean
    manager   64 passed, typecheck clean

The one failure is the known environment case: PostGIS's extension-owned
`spatial_ref_sys` has no RLS. Log: `.runtime/c1-final-gate.log`.

**Two defects the browser found that the unit tests could not.** With polling
blocked the panel kept a confident distance on screen indefinitely, and
revoking location in browser settings left guidance running. One cause: the
holds are time-based and evaluated during render, and nothing re-renders the
screen once polling stops - which is exactly the case the ageing exists for.
The tests call `guidanceHold` directly, so they always "re-render".

Fixed by `useGuidanceClock`: a five-second tick that fetches nothing and only
re-evaluates state the app already holds, plus asking `navigator.permissions`
rather than trusting the tracker's cached flag, because Chrome does not error an
already-running watch when permission is revoked. Three tests pin the platform
answer; the failing screenshots are kept alongside the fixed ones as the
evidence the fix was needed.

**The dialler is proven by the app's own audit line.** Under the emergency
buttons it prints *"Last dialler request: tel:112"*, beside its own disclaimer
that it opens the dialler and does not place the call. No call was placed. A
harness counter I added was the wrong instrument and read zero while the app's
own line read correctly — worth remembering: the app's visible state was the
better evidence.

**One earlier capture was a test error, not a defect.** An attempt at scenario 5
waited 80 seconds against a 90-second window and showed guidance still running.
`loadedAt` in `TripProvider` advances only on a SUCCESSFUL poll — checked in
the source — so the logic was right and the wait was short. Re-captured past
the window.

**Scenario 3 had to drop the page reload.** Reloading signs the driver out
(driver web holds no refresh token, by design). Revoking permission WITHOUT a
reload is also the honest scenario: a driver turning location off mid-journey
does not reload.

### Deck

`docs/submission/` holds the editable deck, a 6-page PDF, all six pages rendered
under `slides/`, and the capture evidence. All six inspected; the last defect
fixed this pass was "ENVIRONMENTA / L" wrapping in its badge on slide 5.

**One field still blocks submission: `Team ID` on slide 1.** Owner-supplied. It
must not be filled with the problem-statement ID.

### Remaining demo gaps

1. **The ~3-minute backup recording** is not captured. The screenshots cover all
   nine scenarios; the recording is a separate pass over the same script.
2. **Native/physical runtime still unverified.** Nothing here is device
   evidence, and the capture says so on its face.

---

---

## 2026-09-06 — S0/S1: GUIDANCE FRESHNESS, AND THE SUBMISSION PACKAGE

Deadline frame: PPT submission **10 September**, package freeze **9 September**,
Asia/Kolkata.

### S0 — the demo path, not another infrastructure mission

`seed_manager.py` and `seed_linked_trip.py` each carried their own substring
check on the display URL. Both now use `tests/db_target.py` — the same
registered target and `do_connect` veto the suite uses — so there is one policy
instead of three, and it sees the arguments actually handed to the driver rather
than a string.

Proven, not assumed:

    unarmed seed (inherits .env)                   -> EXIT=2, refused
    DATABASE_PROVIDER=local + synthetic remote URL -> EXIT=2, CONNECTION_ATTEMPTS=0
    armed                                          -> creates/refreshes on 127.0.0.1:55432

**A real defect on the demo path, fixed.** `seed_manager.py` wrote
`manager-login.txt` only when it CREATED the account; an existing account printed
"already exists" and left the file untouched. So the file drifted from the
database, and the failure surfaced as an unexplained 401 — which is what
happened last session. It now always resets the password, reactivates the
account (suite cleanup deactivates the ones it owns) and rewrites the file, so
the credential is true by construction. It also takes `--role`, because the demo
needs a reviewer and hand-rolling a throwaway script for the second account is
how an unguarded write path gets invented under time pressure.

All six credential files were verified to authenticate. The duplicate
`ls12-*-login.txt` pair from the previous session was removed; `manager-login.txt`
and `reviewer-login.txt` are canonical.

**Demo fixtures are safe from test cleanup, verified rather than asserted.**
After a 910-test run the demo trip, its selected route and five demo accounts
were all intact, and `factories.OWNED` is empty at import in a fresh process —
so a pytest run has no way to identify, let alone delete, the rehearsal data.
That is a property of the id-scoped cleanup, not a convention.

### S1 — four ways a confident countdown was wrong

The panel gated on `last_fix.freshness === 'LIVE'` alone. That reads as
conservative and is not: the label describes a moment that has already passed by
the time it renders. All four now go through one pure function,
`guidanceHold`, with the hold named on screen.

| Case | What used to happen |
| --- | --- |
| Permission revoked just after a LIVE fix | Server keeps saying LIVE for its whole 90s window. Up to ninety seconds of confident countdown from a position the truck had left |
| Polling or network stops | The trip payload freezes with `freshness: 'LIVE'` inside it and nothing ever contradicts it. Confident forever |
| Fix off the planned line | **Reproduced on the demo corridor:** a fix 2.4 km off the road projected 51 km further along, so the panel skipped every maneuver between and announced the wrong turn |
| Granted but not subscribed | Told the driver to turn location on when it already was |

The ageing window is the server's own `tracking.fresh_seconds`, not a constant
in the app, so the pause and the manager's LIVE badge cannot drift apart.

Off-route is **stated, never acted on**. Choosing a different road is a manager
decision with a hazard review behind it; a GPS reading is not permission to make
it. The panel says "Off the planned route ... ask your manager to replan".

Driver **192 passed** (14 new), typecheck clean. Backend untouched by this slice;
focused regression on the affected contracts **75 passed**. The full backend gate
from the previous slice stands at 910/1/5 with the known `spatial_ref_sys`
environment failure.

Browser evidence: the PERMISSION hold renders correctly with location denied,
route still drawn, zero console errors.

### S4 — submission package

`docs/submission/` now holds the editable deck and a 6-page PDF built on the
**actual supplied template**, which requires six slides maximum and PDF upload.
See `docs/submission/README.md` for what changed and how to rebuild.

Deck content gained turn-by-turn navigation and reviewer-authorised selection
(both work, neither was mentioned) and lost an imprecise persistence claim.
Rendered defects fixed: headings printed over their icons, a chip cut off at the
slide edge, a logo oval too narrow for its own word.

**One field blocks submission: `Team ID` on slide 1.** Not derivable from this
repository.

### Demo blockers

1. **Live turn-by-turn cannot be captured in this environment.** The correct
   permission gate means a countdown now requires a runtime that actually grants
   geolocation. The in-app browser pane reports `permission: denied` and no
   Chrome extension is connected. Options: a physical Android run, a Chrome
   profile with geolocation granted and coordinates overridden, or demonstrating
   the paused state honestly and showing the maneuver list from the API. Note
   that the earlier "44 km -> 1.1 km" capture was only possible **because** of
   the defect fixed above.
2. **Team ID unknown** (above).
3. **Native runtime still unverified.** No device evidence exists.

---

---

## 2026-09-06 — G2.1 / G2.2: NAVIGATION ON THE ACCEPTED ROUTE

Resumed from the existing detailed-provider and maneuver storage rather than
rebuilding them. Migration head confirmed at **0009**; nothing reapplied.

### The defect found first, because everything else rests on it

`Maneuver.distance_m` was documented as *"the length of the step that ENDS at
this maneuver, which is what 'in 400 m, turn left' is measured against"*. That is
the opposite of its value. OSRM's `step.distance` measures **forward** — from a
maneuver to the next one.

Verified against the provider rather than argued from the docs: a 5,942 m
Guwahati route returns 17 steps summing to 5,942.5 m with a final `arrive` step
of **0.0 m**. Neither is possible for a backward measurement. The demo corridor
agrees: 19 maneuvers summing to 305,393 m against a route distance of 305,393 m.

Renamed to `step_distance_m` with the semantics stated, and the package now
publishes `distance_from_start_m` — cumulative along the route — which is what a
next-turn panel subtracts travelled distance from. **Measured on the demo
corridor at 79.2 km travelled: the correct distance to the next maneuver is
42,867 m; that maneuver's own step is 4,918 m.** Rows written under the old key
still parse.

### What shipped

| | |
| --- | --- |
| `app/services/navigation.py` | builds the package from the trip's `selected_route_id`; four reason codes; refuses maneuvers that do not address this geometry |
| `GET /api/driver/me/trip/navigation` | 404 only for no trip. No trip id in the path — no parameter in which to ask for another driver's guidance |
| `?detailed=true` on `routes/recalculate` | the service supported it; the API never exposed it. Off by default (5,213 points vs 52) |
| `driver-app` `useNavigationPackage` | follows the SAME `selected_route_id` the geometry hook does. No second poller. Discards a package whose `route_id` does not match |
| `driver-app` `maneuvers.ts` | the arithmetic, in its own module so it is testable without importing React Native |
| `NextTurnPanel` | distance, instruction, and the three honest empty states |
| i18n | 3 new codes in the catalogue and both mirrors (en/hi/as). **The Hindi and Assamese strings are machine-drafted and NOT reviewed by a fluent speaker** |

### Runtime proof, in the running driver app

Isolated backend, real ACTIVE trip `TRP-MTO9WQ6E`, browser at localhost:8081.

1. **Before acceptance** — the legacy 52-vertex overview route returned
   `available: false`, `GUIDANCE_NOT_AVAILABLE`, geometry intact, no crash.
2. **Detailed candidate planned** — 5,213 points, 19 maneuvers, one provider
   response. `sum(step_distance_m) = 305,393 m`; `arrive` at geometry index
   5212 with step 0.0.
3. **The old selection stayed selected through planning.** Verified by reading
   it back, not assumed.
4. **Normal acceptance, not a shortcut** — manager select refused with
   `422 ROUTE_SELECTION_REQUIRES_REVIEW`; reviewer issued an authorisation
   (`HAZARD_DATA_UNKNOWN`, 30 min); a **different** account spent it; route
   became current. Hazard evidence was never relabelled.
5. **Guidance ran.** Controlled fixes through the real `/api/driver/me/location`
   endpoint (SIMULATION — coordinates are route vertices, not a device):
   panel counted **44 km → 1.1 km** on one maneuver, then advanced to
   *"At the roundabout, take exit 3 onto Nagaon Bypass"*.
6. **GPS denied** — *"Guidance paused. Waiting for a location fix. The route is
   still shown."* Zero console errors throughout.

### A defect the runtime proof caught, that the tests did not

The panel first showed *"43 km, Continue onto Nagaon Bypass"* **with location
permission denied**. `progress` is non-null whenever the server has ever had a
fix, so the panel was steering from a position hours old and looked completely
convincing.

Fixed by gating on `last_fix.freshness === 'LIVE'` — the server's own label, the
same one the map marker and the manager's screen use. Judging freshness with a
local constant is how two parts of a product come to disagree about whether the
same truck is live.

Worth recording as method: this passed every unit and API test. Only opening the
screen found it.

### Not done

- **No voice.** G2.4's speech channel is untouched.
- **No off-route detection, no reroute synchronisation, no detour previews**
  (G2.3 remainder, G2.5).
- **Maneuver selection is server-progress-driven only.** No client-side
  projection, no jitter/parallel-road handling — the server's `route_progress`
  does the projection and its limits are unchanged.
- **Native unverified.** Web only.
- Reason-code translations are drafts.

---

---

## 2026-09-06 — TEST ISOLATION INCIDENT: CONTAINED

Full record, with the evidence behind every number:
[INCIDENT_2026-09-06_SHARED_DB_WRITE.md](INCIDENT_2026-09-06_SHARED_DB_WRITE.md).

### What was actually wrong

Three pytest runs started from Bash without arming the isolated cluster,
resolved `backend/.env` (`DATABASE_PROVIDER=supabase`) and executed **105
tests** against the shared project. Each executed test then ran the autouse
teardown, which deleted **by global prefix** — every `TTEST-%` trip, every
`STEST-%` shipment, every `AS__ZZ%` truck, every `%@p3test.invalid` driver —
and set `is_active = false` across the whole marker domain, then committed.

**Corrections to the previous report:**

- "36 test users created" is the smallest part. Two of the three runs created
  **zero** rows and still ran that teardown 46 times. Creation count does not
  measure this incident; teardown scope does.
- The guard the last checkpoint reported as working **did not work**. It called
  `db_target.enforce` and `db_target.check_url` without importing `db_target`,
  so it raised `NameError`, not a refusal, and every run aborted with an
  `INTERNALERROR`. Reproduced before it was fixed.
- The 36 figure is now **explained but still not attributable**. A replay of the
  05:43 command against the isolated cluster executes the same 54 tests and
  creates exactly 36 users. That corroborates the origin; it names no row.

### I1 — the suite cannot reach anything but the isolated cluster

`tests/db_target.py` vetoes connections on SQLAlchemy's `do_connect` event, so
the driver is never called and no socket opens. One listener on `Engine` covers
the async application engine, the advisory-lock engine, the `db` fixture and
`test_migrations.py`'s separate migration URL. It judges the **final merged
connection parameters**, so a `connect_args` or URL-query host override cannot
present a safe-looking URL and dial elsewhere. `DATABASE_PROVIDER` is not
consulted — `.env`'s own `LOCAL_DATABASE_URL` is a different local database and
would have been written to just as readily.

`ALLOW_SHARED_DB_TESTS=1` is **removed**, and a test asserts that setting it
changes nothing.

`.runtime/use-isolated-db.sh` added — Bash previously had no armed path at all,
which is how this happened. `use-isolated-db.ps1` now exports
`MIGRATION_DATABASE_URL`; it had been setting `ALEMBIC_DATABASE_URL`, which
nothing in the project reads.

Proven, not asserted: `tests/test_db_target_guard.py` (16 cases) builds a real
engine per case with `psycopg.connect` replaced by a tripwire, so a refusal that
reached the driver fails the test. Process level, with the removed override set:

    ALLOW_SHARED_DB_TESTS=1 pytest tests/test_health.py tests/test_database.py
      -> PYTEST_EXIT=3   CONNECTION_ATTEMPTS=0

Bash and PowerShell both refuse an unarmed run with exit code 3 before any test
runs. An armed run reaches the isolated cluster normally.

### I2 — cleanup removes only this run's rows

`factories.OWNED` records the id of every row created; `factories.cleanup`
deletes exactly those, in FK order. No prefix, no time window.

Ownership is recorded by an `after_flush` listener on `Session`, not by each
factory. The per-factory version was written first and was wrong: several tests
create their trips by POSTing to `/api/trips`, so the row is made by the
application's own session and no factory sees it — those trips then pinned
factory shipments with RESTRICT. The listener catches every ORM insert whichever
session makes it. Raw `text("INSERT ...")` deliberately does **not** register,
because that is how the tests simulate another process's rows.

`tests/test_cleanup_ownership.py` (9 cases): another run's whole graph survives
while this run's is removed; a `%@p3test.invalid` account from another run is
not deactivated; a failed cleanup keeps its ids and does not widen.

### I3 — impact assessment, read-only, nothing executed

Written from local session transcripts, the committed teardown code and
`backend/.env`. **Nothing connected to the shared database.**

**No remediation manifest is proposed.** The rows cannot be identified:
identifiers are random, nothing recorded them, and prefix-plus-timestamp is not
ownership. The 19,791 older records are pre-existing relative to the reported
count and nothing more. The incident record carries the read-only queries that
would settle what is still unknown — chiefly whether the mass
`is_active = false` committed.

Preserved locally (git-excluded, credential-free):
`.runtime/incident-evidence/`.

### Gate after the change

    910 passed, 1 failed, 5 skipped   (132.05s, isolated cluster)

The single failure is the known environment one:
`test_no_table_in_public_lacks_rls` — PostGIS's extension-owned
`spatial_ref_sys`. Previous reported checkpoint was 858 passed / 5 skipped /
1 failed with the same failure. Counts are as reported by the run, not
reconciled arithmetic.

Driver app: 181 passed, typecheck clean. Manager web: 64 passed, typecheck now
clean - two pre-existing errors in `ReviewPage.tsx` (a stale `listTrips(50)`
call signature and an `EmptyState body=` prop that no longer exists) were fixed
in passing.

### Not done, deliberately

- No shared-database contact, cleanup, migration or role change.
- Seed and admin scripts (`backend/scripts/create_user.py`,
  `.runtime/seed_*.py`) are **not** guarded. They resolve the same
  configuration and would reach shared if run unarmed. They are operator tools
  that may legitimately target shared, so they were left alone — but nothing
  above protects them.
- `backend/.env` still points at shared Supabase. That is the intended runtime
  configuration; the guard makes *tests* safe, not a plain `python run.py`.

---

## LS-11 RESULT — LOCAL_PROTOTYPE_VERIFIED (isolated cluster only)

**Approval used, exactly as granted 2026-09-05 in conversation:**

| Decision | Answer | Implemented as |
|---|---|---|
| Who holds `route:review_authorize` | distinct **AUTHORISED_REVIEWER** role | new `user_role` enum value + `_AUTHORISED_REVIEWER_PERMISSIONS` |
| Build scope | isolated local DB only | migration applied to 127.0.0.1:55432/ner_logistics_test and nowhere else |
| Expiry / basis | 30 min, single use, **UNKNOWN only** | `AUTHORIZATION_TTL`, `AUTHORIZABLE_RISK` |

Shared Supabase was never connected to. No commit, push or deploy.

> **Scope note added 2026-09-06.** That statement is about LS-11's own
> checkpoint and remains accurate for it. It does not extend forwards: the
> later partial-G2 work did contact shared Supabase — see the incident
> section above. Do not quote this line as evidence that the project has
> never written to the shared database.

### What it is

A reviewer accepts a SPECIFIC, incomplete evidence picture so ONE selection of
ONE route may proceed. It is not a statement about a road, and the code cannot
make it into one: after a consumed authorisation the route still reports
`landslide: NOT_AVAILABLE` / `LANDSLIDE_DATA_NOT_CONFIGURED`. That was verified
live, not just unit-tested.

### Migration — `0007_route_review_authorizations` (head)

Alembic head moved 0006 -> 0007. One revision, applied ONLY to the isolated
cluster. Contents: the `AUTHORISED_REVIEWER` enum value, the
`route_review_basis` type, the `route_review_authorizations` table with its
check constraints, the partial unique index, RLS enabled (AGENTS.md), and an
UPDATE trigger pinning the authorised facts.

`ALTER TYPE ... ADD VALUE` inside a transaction was TESTED on the 18.2 cluster
with a rollback before being written, and nothing in the migration uses the new
value, so alembic's single-transaction wrapper is fine.

Downgrade drops the table, the trigger and the basis type. It does NOT remove
the enum value — PostgreSQL has no DROP VALUE, and a downgrade that claimed to
would be lying.

### A defect I introduced and fixed mid-build

The first trigger forbade DELETE, copied from `audit_logs`. But these rows are
`ON DELETE CASCADE` from trips, so the two contradicted each other and deleting
any trip became impossible — caught by the suite's own cleanup failing. The
durable compliance record is the `audit_logs` row (its `entity_id` is a plain
column, so it survives the cascade); this table is operational state. Trigger is
now UPDATE-only.

### Three mechanisms, not one

Atomicity does NOT rest on the partial unique index alone:

  * `uq_rra_one_live_per_route` — at most one LIVE row per route
  * the trips row lock — orders concurrent selections (and since LS-9 re-reads
    with `populate_existing`, so the locked read is not served stale)
  * the conditional UPDATE — check and spend in ONE statement, in the
    selection's own transaction

A failed selection rolls the claim back with it. Proven: a refused attempt left
the authorisation `consumed = f`, still valid.

### Two-person control

`AUTHORISED_REVIEWER` has `route:review_authorize` and NOT `route:select`;
MANAGER has the reverse. That is structural. But ADMIN holds both via
`ALL_PERMISSIONS`, so `reviewer_user_id != actor.id` is ALSO enforced in the
claim's WHERE clause — and the test that proves it deliberately uses an ADMIN,
because that is the only actor for whom the role split alone would not save you.

### Verified live (plain server, no hazard source — the real UNKNOWN state)

1. Manager alone: candidate disabled, "An authorised reviewer must accept it
   before this can be used."
2. Reviewer signs in, sees "Hazard data incomplete", writes a rationale,
   authorises -> 201. Evidence line still reads "Landslide data is not
   available".
3. Manager signs back in: candidate now enabled, "Hazard data incomplete —
   authorized for this selection", expiry shown. Chooses it -> `reroute/accept`
   200.
4. Persisted: PRIMARY 305.39 SELECTED + is_current; authorisation
   `consumed = t`, `two_people = t`, reviewer `ls11.reviewer@`, selector
   `ls7.manager@`.
5. Route STILL reports `landslide: NOT_AVAILABLE`.
6. Driver web shows 229.0 km — the authorised route.
7. Closure introduced AFTER issue, before acceptance: valid authorisation
   presented -> **422 ROUTE_REJECTED_ACTIVE_HAZARD**, assignment retained,
   authorisation NOT consumed.

### Synthetic accounts (isolated DB only)

    reviewer  ls11.reviewer@ner.invalid  / ls11-local-throwaway-not-a-secret
    manager   ls7.manager@ner.invalid    / ls7-local-throwaway-not-a-secret
    driver    9000090009                 / ls9-local-throwaway-not-a-secret

ONE demonstrator operated two separate accounts. That is two accounts and two
recorded user ids; it is NOT two humans reviewing a road, and no evidence here
claims otherwise.

### Known limitation found while demonstrating

Manager web and the reviewer screen are BOTH web clients, so they share the
backend's `ner_refresh` cookie and cannot be signed in simultaneously in one
browser profile. The demo switches accounts sequentially. LS-9's cookie finding
covered web-vs-mobile; this is web-vs-web and is a different case. Separate
browser profiles would allow simultaneous sessions.

### Test totals — measured

    command   python -m pytest -q --no-header
    target    127.0.0.1:55432/ner_logistics_test (isolated)
    result    821 passed, 5 skipped, 1 failed in 121.22s
    log       .runtime/ls11-full-suite.log

Reconciles against LS-10's full run (803 passed / 5 skipped / 1 failed):
+18 new review-authorisation tests = 821, and failures stay at 1. Collected
809 -> 827.

Manager web 64 passed, tsc clean. Driver app 160 passed, tsc clean (re-run
because the manager/driver contract was touched, though no driver source
changed).

One intermediate run showed 2 failures: `test_migration_enum_definitions_match_python_enums`
broke because it asserted migration 0002 held EVERY enum, which stopped being
true at 0007. It was widened to the whole chain rather than loosened - later
additions must be DECLARED and the declared revision is opened and checked to
really contain them. Verified by removing the declaration and watching it fail.

`spatial_ref_sys` remains the single failure, unchanged and still deliberately
not "fixed". `route_review_authorizations` has RLS - confirmed by query, it is
not part of that failure.

### Files changed

`app/models/enums.py`, `app/models/review.py` (new), `app/models/__init__.py`,
`app/core/permissions.py`, `app/services/route_review.py` (new),
`app/services/route_risk.py`, `app/services/routes.py`, `app/services/reroute.py`,
`app/api/trips.py`, `alembic/versions/0007_route_review_authorizations.py` (new),
`scripts/create_user.py`, `tests/test_route_review_authorization.py` (new),
`tests/test_reroute_api.py`, plus manager-web `api/client.ts`, `App.tsx`,
`pages/ReviewPage.tsx` (new), `pages/FleetPage.tsx`.

### Still open

- `spatial_ref_sys` RLS — unchanged, still deliberately not "fixed".
- Candidate retention (same-corridor candidates accumulating) — deliberately
  kept separate from this feature, still undecided.
- HIGH remains non-authorisable by policy. The enum value is kept so widening
  later needs no migration.

---


**Approval state: GRANTED 2026-09-05, in conversation, with this exact scope:**

| Decision | Answer given |
|---|---|
| Who holds `route:review_authorize` | A **distinct AUTHORISED_REVIEWER role** (accepts the enum migration cost) |
| Build scope | **Yes — build and test in the isolated local database only** (127.0.0.1:55432/ner_logistics_test) |
| Expiry / basis | **30 minutes**, single consumption; **assessed HAZARD_DATA_UNKNOWN only** — HIGH and REJECTED cannot use this flow |

NOT granted, and still out of scope: shared Supabase changes of any kind,
account grants there, deployment, commit/push, road-memory migrations, and any
unrelated schema change. Candidate-retention cleanup stays a separate question.

G0 inspection is DONE and its findings are recorded as section 9 of
`docs/migrations/PENDING_route_review_authorizations.sql`. Three things it
settled that the design had left implicit:

1. **The role question is a schema question.** `users.role` is a native
   Postgres enum and permissions are a static role→set map; there is no
   per-user permission table. So a distinct `AUTHORISED_REVIEWER` needs
   `ALTER TYPE ... ADD VALUE` on top of the new table (two revisions, and
   Postgres can never drop an enum value). **Admin-only needs no role
   migration at all** — `ADMIN` already maps to `ALL_PERMISSIONS`, so adding
   the constant grants it implicitly. "Attribute on managers" is the most
   expensive, not the least: it requires inventing a mechanism that does not
   exist.
2. **Questions 1 and 2 interact.** With a distinct role, reviewer≠selector is
   structural (the reviewer lacks `route:select`). With admin-only it is a
   code check only, because ADMIN holds both permissions.
3. **The evidence digest is stable** — verified against the real dataclasses.
   `LandslideAssessment` has no timestamp; `RouteRisk.assessed_at` is
   deliberately outside the digest; `considered_count` is excluded so
   off-corridor incidents cannot invalidate an authorization.

Also recorded: atomicity rests on three separate mechanisms (partial unique
index, the trips row lock, the conditional UPDATE) and the concurrency test
must exercise the service path, not assert the index exists.

**Blocked on:** section 6 question 1. It decides whether the migration is one
revision or two, so there is no migration to write until it is answered.

---

## LS-10 RESULT — 2026-09-05 (newest; read before LS-9 below)

### The defect, and why it mattered

`plan()` superseded every PROPOSED **and SELECTED** route, so re-planning
retired the trip's own `selected_route_id`. SUPERSEDED is terminal in this
codebase - `apply_selection` refuses it, `route_recommendation` drops it from
candidates, and a replaced route is deliberately demoted to PROPOSED instead
*because* superseded means never again. The trip was left following a row the
rest of the system treats as dead, and the manager UI (which looked for
`state === 'SELECTED'`) could no longer see the driver's road.

Fix, in `plan()`: read `selected_route_id` from the trip row **just locked**
and exclude it from the supersede set. Obsolete UNSELECTED candidates are still
superseded. Nothing clears `selected_route_id` - stripping a moving truck's
route would be worse than the bug.

The lock re-read is load-bearing and depends on LS-9's `populate_existing`:
`plan()` releases the database before calling the provider, so a replacement
can be accepted while it is away. There is a barrier test for exactly that.

### Files changed (LS-10 only)

| File | Change |
|---|---|
| `backend/app/services/routes.py` | `plan()` preserves the current assignment; docstring corrected |
| `backend/app/api/trips.py` | `TripRouteRead.is_current`; `RouteComparisonRead.eligibility`; serializer + 3 call sites |
| `backend/tests/test_route_current_assignment.py` | NEW - 7 tests |
| `manager-web/src/api/client.ts` | `is_current`, `RouteEligibility`, `eligibility` |
| `manager-web/src/pages/FleetPage.tsx` | route chooser; current-route from server; detail reload |
| `manager-web/src/pages/FleetPage.test.tsx` | fixtures gained `is_current` (contract change, assertions unchanged) |

### API additions (both server-computed, additive, backward compatible)

- `is_current` on each route — from `trips.selected_route_id`, NOT from `state`.
  This is the field to trust. It is what makes a legacy selected-but-superseded
  row visible instead of vanishing.
- `eligibility` on each recommendation candidate — so the chooser never
  re-derives eligibility by pattern-matching reason codes.

### Chooser behaviour

- Header always shows the CURRENT assignment; freshly planned routes go to
  Alternatives. (Previously the header showed whatever was planned last, so a
  re-plan replaced the truck's road with an unchosen candidate.)
- In transit → `reroute/accept` (records ROUTE_CHANGED, 409s on a stale
  `from_route_id`). Not in transit → `select`. The endpoint is chosen by trip
  state, never by which is easier to call.
- Candidates are unchoosable until an assessment has actually run, and the
  disabled reason says why. REJECTED/REQUIRES_REVIEW stay disabled.
- An assessment is cleared after any route change or re-plan, because it
  described a different comparison.
- Candidates show their plan time — two plans of one corridor otherwise render
  as two identical rows.

### Verified in the running apps (scenario server, isolated cluster)

1. Legacy trip whose current route was SUPERSEDED: now shown as current with a
   plain explanation, and still refused for re-selection (ROUTE_SUPERSEDED).
2. Assessment → both candidates ELIGIBLE with translated reasons → chose
   PRIMARY via the chooser → `reroute/accept` 200 → PRIMARY SELECTED +
   is_current, `ROUTE_CHANGED` 7→8 (exactly one transition).
3. Driver followed it: 257.4 km → 229.0 km without a manual reload.
4. Re-plan while following: current route stayed SELECTED + current; driver
   unchanged at 229.0 km; two new candidates appeared. **This is the fix.**
5. closure scenario: candidate showed "Blocked by an active hazard", button
   `disabled: true`. API companion check confirmed the server refuses
   independently (422 ROUTE_REJECTED_ACTIVE_HAZARD) and the assignment was
   retained.
6. UI-driven change → driver render: 9.10 s and 10.23 s (10 s poll).
7. 35 s driver outage: stale banner, last-good retained, manager change made
   meanwhile, reconnect recovered it in 6.12 s and cleared the banner.

### Demo trip

`TRP-MTO9WQ6E` / trip `4f014532-af97-4fae-ad69-49c95d008efd`. Six routes now
(three plan generations). Prefixes still outside `factories.cleanup`.

### Test totals — measured, and reconciled

    command   python -m pytest -q --no-header
    target    127.0.0.1:55432/ner_logistics_test (isolated)
    result    803 passed, 5 skipped, 1 failed in 109.61s
    log       .runtime/ls10-full-suite.log

Reconciliation against the one real LS-9 full run (795 passed / 5 skipped /
2 failed, 802 collected):

    795  LS-9 measured
    + 7  tests/test_route_current_assignment.py (new this mission)
    + 1  test_config.py::test_local_mode_requires_local_url, fixed in LS-9 but
         never re-measured in a full run until now
    = 803 passed, and failures 2 -> 1.  Collected 802 -> 809.

Focused runs behind that: 7/7 the new lifecycle file, 196 across every route
path (api, routing, reroute, recommendation, hazard, enforcement, interleaving,
concurrency, execution), 55 after the API additions. Manager web: 64 passed,
tsc clean. Driver app NOT re-run - no driver source changed this mission.

### Correction to the LS-9 report

LS-9 closed with "795 passed, 5 skipped, 1 failed". That number was NOT
measured - the only full run that session produced **795 passed / 5 skipped /
2 failed**, and the config fix was verified by running `test_config.py` alone
afterwards. The reviewer was right to flag the arithmetic. Treat the LS-9
"1 failed" line as an inference, not a result.

### Still open

- `spatial_ref_sys` RLS failure — unchanged, still deliberately not "fixed".
  Extension-owned, PUBLIC SELECT, EPSG reference data; scoping the assertion
  needs the real Supabase grants, which no session has had access to.
- `docs/migrations/PENDING_route_review_authorizations.sql` — still UNAPPLIED.
  Section 6 has four questions; question 1 (who holds `route:review_authorize`)
  blocks the rest.

### Boundaries

No commit, push, deploy or migration. `backend/.env` untouched. Shared Supabase
never connected to. `.runtime/` preserved.

---

## LS-9 RESULT — 2026-09-05 (read before the older transfer notes below)

Everything here was RUN. The LS-8 notes further down remain true except where
this section supersedes them.

### Code changed

| File | Change |
|---|---|
| `backend/app/services/trips.py` | `load_for_update` now issues `populate_existing=True`. **Real defect, reproduced first.** |
| `backend/tests/test_stale_selection_interleaving.py` | +2 tests: the identity-map pin, and the stale-lock case that reproduced the defect. |
| `backend/tests/test_config.py` | autouse fixture clears ambient env; the leaky-harness failure is GONE. |
| `backend/scripts/ls9_scenario_server.py` | NEW. Private scenario launcher. Fails closed off the isolated cluster. |
| `backend/scripts/ls9_scenarios/*.json` | NEW. `clear` / `closure` / `high`, all labelled SYNTHETIC. |
| `driver-app/src/trip/TripProvider.tsx` | NEW polling (`TRIP_POLL_MS` 10 s) + `isStale`. Single-flight, no duplicate timers, stops at sign-out, cannot go backwards. |
| `driver-app/src/screens/TripScreen.tsx` | Renders the stale banner; stale comment corrected. |
| `driver-app/src/auth/tokenStore.ts` | Comment fix only — it wrongly credited the HttpOnly cookie on web. |
| `docs/migrations/PENDING_route_review_authorizations.sql` | NEW. The G6 proposal. **NOT APPLIED.** |
| `.runtime/use-isolated-db.ps1` | Was exporting `+asyncpg`; the app requires `+psycopg`. Arming was broken. |

### The G2 defect, stated exactly

`with_for_update()` takes the lock but does NOT refresh an object already in the
session's identity map, so a locked read returned pre-lock values.
`routes.plan()` is a live path with that shape (load trip -> commit -> up to 8 s
at the provider -> lock). It was LATENT (no attribute is read after that lock
today), so this is not an exploit report - it is the shared function fixed
before a caller turns it into one. The test asserted `selected_route_id` was
still `None` after another transaction committed a real value; it passes now.

**Selection was already safe, and is now pinned.** `route_risk._route_facts`
selects COLUMNS, not the `TripRoute` entity, so the assessment leaves nothing
cached for the mutation's re-read. A test now fails if anyone changes that.

### Demo data (survives a pytest run - the prefixes sit outside `factories.cleanup`)

    trip TRP-MTO9WQ6E   shipment SHP-MTO9WQ6E   truck AS09LS9001
    driver "LS9 Demo Driver"  phone 9000090009 / ls9-local-throwaway-not-a-secret
    manager ls7.manager@ner.invalid / ls7-local-throwaway-not-a-secret
    trip id 4f014532-af97-4fae-ad69-49c95d008efd

LS-8's `TTEST-60289233EF` / `AS27ZZ0320` are GONE - this session's regression run
deleted them, because `TTEST-` and `AS__ZZ%` are exactly what the suite cleans.
Do not seed demo data with those prefixes again.

### Scenario server

    . .\.runtime\use-isolated-db.ps1
    python scripts/ls9_scenario_server.py --scenario clear|closure|high

Only `build_landslide_provider` is swapped. The guard is never patched. It
refuses to start unless the target is `127.0.0.1:55432/ner_logistics_test` -
verified by running it two wrong ways. Plain `run.py` = the honest UNKNOWN state.

### Measured (local loopback, not production latency)

Manager mutation -> driver render, 5 real route changes at `TRIP_POLL_MS` 10 s:
min 1.48 s, median 6.37 s, max 8.33 s, mean 5.12 s. Reconnect after a 37 s
outage recovered the manager's change in 2.34 s. Two concurrent identical
reroutes: 1x200, 1x409; the `ROUTE_CHANGED` count matched successful accepts
exactly (7), so no duplicate transition was written.

### Suite

795 passed, 5 skipped, **1 failed**, 108 s (was 2 failed).
Remaining: `test_no_table_in_public_lacks_rls` - `spatial_ref_sys`.
Evidence gathered, deliberately NOT "fixed": it is owned by the **postgis
extension**, is the only such table, and carries PostGIS's own `PUBLIC SELECT`.
It holds EPSG definitions, no user data. Whether to scope the test to
project-created tables needs a look at the real Supabase grants, which this
session had no access to. Left failing on purpose.

### Gaps found, NOT fixed (next session)

1. ~~The manager UI has no route chooser.~~ **FIXED IN LS-10.**
2. ~~Re-planning leaves `trips.selected_route_id` pointing at a SUPERSEDED
   row.~~ **FIXED IN LS-10** - planning no longer supersedes the current
   assignment. Rows written before that fix still exist and are handled: the
   API's `is_current` keeps them visible, and they are shown with an
   explanation rather than relabelled.

### Still true

No commit, no push, no deploy. `backend/.env` untouched. Shared Supabase never
connected to. No migration applied. `.runtime/` not deleted.

---

---

## SESSION TRANSFER STATE — read this first

Written when handing this project to a new chat. Everything below was measured,
not remembered.

### Repository

    branch          main
    HEAD            f850de456d03bdcf776bafd1bcd8377f89b763c0  (== origin/main)
    commits ahead   0        pushed 0        staged 0
    modified        44 tracked files
    untracked       58 entries
    diff            44 files changed, 13421 insertions(+), 1530 deletions(-)

**All work is uncommitted and must be preserved.** Nothing was committed,
pushed, stashed or reset at any point. `backend/.env` is unmodified. The shared
Supabase database was never written to.

### No editing task is running

Verified at transfer time: no source file under `backend/app`, `backend/tests`,
`driver-app/src`, `manager-web/src` or `docs` modified in the preceding five
minutes, and **no pytest process alive**. The only Python processes are the
backend and its reload workers.

### Servers left RUNNING deliberately — reuse them, do not rebuild

    127.0.0.1:55432   PostgreSQL 18.2 + PostGIS 3.6   isolated cluster
    127.0.0.1:8000    FastAPI backend (backend/run.py) on that cluster
    localhost:5173    manager-web (vite dev)
    0.0.0.0:8081      driver-app Expo web

Restarting the database if it is stopped:

    .runtime\pg\pgsqlin\pg_ctl.exe -D .runtime\data -l .runtime\server.log start

**The backend process is alive but no longer has a live task handle.** The
shell wrapper that launched it exited 127 after the server detached, so a
future session will NOT find it through task-tracking tools. Verify it the way
its state actually presents itself:

    curl http://127.0.0.1:8000/ready

which should return `{"status":"ready","provider":"local",...}` naming
PostgreSQL 18.2 and PostGIS 3.6. Confirmed responding at transfer time. If it
is gone, restart from `backend/` with the isolated target armed:

    backend\.venv\Scripts\python.exe run.py

Backend must be started with `backend/run.py`, **never `uvicorn` directly** —
uvicorn creates its event loop before importing the app, leaving the Windows
ProactorEventLoop in place, and every psycopg3 call then fails. `run.py`'s own
docstring documents this.

### Isolated database (no secrets)

    engine       PostgreSQL 18.2  /  PostGIS 3.6 (GEOS 3.14.1, PROJ 8.2.1)
    host/port    127.0.0.1:55432   (loopback only)
    database     ner_logistics_test
    role         ner_test
    auth         scram-sha-256 — no trust auth anywhere
    data dir     D:/Projects/ner-ai-logistics/.runtime/data
    migrations   repo's own alembic 0001..0006 applied; pending road-memory
                 SQL deliberately NOT promoted
    password     .runtime/pgpass.txt (git-excluded, never printed)

Arm it for a test/tool process by dot-sourcing `.runtime/use-isolated-db.ps1`,
which sets PROCESS env vars only and fails closed if the cluster is not up. It
uses the project's own `DATABASE_PROVIDER=local` mode, which already validates
the host is local.

**`.runtime/` is ~2.0 GB** (PostgreSQL + PostGIS binaries, the cluster,
credentials, seed scripts). It is excluded via `.git/info/exclude`, so
`git status` shows zero runtime paths. **Do not delete it** — rebuilding costs
a ~460 MB download and a full setup.

### Synthetic accounts (isolated DB only, non-secret fixtures)

    manager   ls7.manager@ner.invalid   password ls7-local-throwaway-not-a-secret
    driver    phone 9373361737          password ls8-local-throwaway-not-a-secret
    trip      TTEST-60289233EF   truck AS27ZZ0320   driver "Bipul Das"

These values are deliberately non-secret: they exist only in a throwaway local
database and must be typeable into a browser.

### Test results at transfer (isolated target)

    backend FULL              793 passed, 5 skipped, 2 failed   1m45s
    live HTTP hazard suite      5 passed
    stale interleaving          1 passed
    driver-app                160 passed / 13 files, tsc clean
    manager-web                64 passed /  6 files, tsc clean, build OK

The 2 backend failures are ENVIRONMENTAL and neither test was weakened:
  1. `test_domain_integrity::TestRowLevelSecurity` — `spatial_ref_sys` sits in
     `public` without RLS on vanilla PostGIS.
  2. `test_config::TestLocalProvider` — passes in a clean environment; fails
     only because env-var arming satisfies the condition it asserts is absent.

### Completed (verified, this project's work to date)

  - Driver Safety & First-Aid guide, offline phrasebook, break guidance,
    Driver Assistant V1 (deterministic, read-only, cannot mutate)
  - DRV-002 fixed: tracking lifted to trip scope
  - Landslide domain + provider seam + application integration
  - Route eligibility as a REFUSAL, enforced on recommendation, direct
    selection and reroute acceptance
  - Live HTTP proof: closed route refused 422 ROUTE_REJECTED_ACTIVE_HAZARD
    with persisted state re-read and unchanged
  - Deterministic stale-decision interleaving test
  - Isolated PG18/PostGIS 3.6 runtime; manager website and driver web both
    authenticated against it showing the SAME trip

### Pending / not done

  - **Audited review resolution** — the blocking product gap (see EXACT NEXT
    TASK). With no hazard source, every route is REQUIRES_REVIEW, so nothing
    can be selected.
  - Cross-app update latency never measured.
  - Closure refusal never driven through the manager UI (needs a
    provider-injection seam for the running server that does not exist).
  - Driver native: no adb, no emulator. Desktop: NOT_IMPLEMENTED.
  - Live hazard data and a shared manager credential remain external blockers.


## SESSION OBJECTIVE

Extend the certified core-navigation build toward the AI/UX expansion mission:
driver assistance, offline safety, translation, landslide intelligence, UI/UX.

---

## COMPLETED

**1. Driver Safety & First-Aid Guide (Phase 9)**
`driver-app/src/safety/{guide.json,guide.ts,guide.test.ts}` +
`src/screens/SafetyScreen.tsx`. 11 topics × en/hi/as, versioned
(`safety-guide-v1`), sourced (MHA ERSS for 112, NHS for FAST).
Key invariant: every topic is either `emergency: true` **or** carries a
non-empty `escalate` list — enforced as an XOR by test, because a topic that
answers neither still renders and still looks fine.
Evidence: 12/12 pass; `SEVERE_BLEEDING` found inside the exported Hermes
`.hbc`, proving it ships offline.

**2. Offline phrasebook (Phase 11 fallback)**
`driver-app/src/phrasebook/*` + `src/screens/PhrasebookScreen.tsx`.
21 operational phrases × en/hi/as/**bn**. Evidence: 7/7 pass; `NEED_MECHANIC`
confirmed in the bundle.

**3. DRV-002 — FULLY FIXED (tracking lifted to trip scope)**
`driver-app/src/trip/TripProvider.tsx` now owns trip state **and**
`useLocationTracking`, mounted inside the signed-in branch and above the tab
navigation. `TripScreen` consumes `useTrip()` and is a pure view.
The earlier interim mitigation (never unmount TripScreen) is **deleted**, and
`App.tsx` is back to plain conditional rendering.
Evidence: driver suite green, typecheck clean, `expo export` exit 0.

**4. Break guidance (Phase 8) — driver-facing only**
`driver-app/src/safety/breaks.ts` (pure, injected clock) +
`breakStore.ts` (AsyncStorage) + `BreakCard` in `SafetyScreen.tsx`.
Levels NONE / DUE_SOON / RECOMMENDED / OVERDUE at 3h30 / 4h / 5h.
**It measures ELAPSED time, never driving time** — this build cannot tell
driving from waiting at a dock, so the mission's "2h 45m continuous driving"
phrasing is deliberately NOT used. Thresholds are project constants, not law.
It advises and never blocks.
LIMITATION: a manager cannot see break status — no backend field exists and
adding one needs a schema change (BLOCKER-2). `breakStore.ts` is the seam.
Evidence: 10 + 4 pass.

**5. Driver screens RENDERED for the first time (runtime verification)**
Expo Web, real app. Boots with **zero console errors** (only an expected
`ERR_CONNECTION_REFUSED` from the absent backend). Verified rendering of:
SafetyScreen (numbers, disclaimer, emergency topics sorted first with literal
`EMERGENCY` text), a topic detail with the single-source `EMERGENCY - ACT NOW`
block, PhrasebookScreen (each language in its own script; listener language
correctly defaults away from the driver's), BreakCard correctly hidden with no
trip, and TripScreen's "No connection" error state.
Accessibility checked in the real a11y tree, not the source:
`button "Suspected stroke - FAST. Emergency topic."`
No horizontal overflow at **375 px** or **320 px** (the tightest driver width,
where the 4-tab strip was most at risk).
METHOD: the auth gate was TEMPORARILY forced open in `App.tsx`. Files were
copied to scratch before editing and restored after; **revert proven by md5
match** and by `grep TEMP-VISUAL-CHECK -> none`. Suite re-run after restore:
134 passed, tsc clean.

**6. Driver Assistant V1 (Phases 6-7) — deterministic, offline, cannot act**
`src/assistant/assistant.ts` (context + 8 allowlisted READ tools + question
catalogue + resolver), `assistant.test.ts` (26), `screens/AssistantScreen.tsx`,
`src/raw-modules.d.ts`. Fifth tab wired.
Answers are STRUCTURED facts, not prose, so a cloud model could later word them
without deciding what is true. No LLM exists in this repo — that half is
NOT_IMPLEMENTED by design, not stubbed.
SECURITY (structural, not a guard): the module imports no api client, no
storage, no network. Asserted against the SOURCE, distinguishing `import type`
(allowed, compile-time erased) from a value import (fails), plus a no-`api.`
check. **The assertion was proven to fail** by injecting a value import before
being trusted.
Honest by construction: cached risk always labelled with age + STALE; never
suggests a safe stop (`VERIFIED_SAFE_STOP` unavailable); emergency intents
return topic IDs into the one curated guide, never prose; "online" derived from
evidence (trip loaded + uploader not failing), never assumed.
Evidence: 26 pass; rendered at 320 px, no overflow; restore md5-verified.

**7. Landslide Phase 1 — domain verified and mapped (no code written)**
The previous handoff's "81 tests" for this layer was WRONG — that was four
files combined. Measured: `test_road_memory.py` 13 + `test_monsoon_risk.py` 18
= **31**, and both import only `app.domain.*`, so they are pure unit tests of
pure functions. Correct claim: "the landslide DOMAIN RULES are tested in
isolation", NOT "the landslide subsystem is tested".
Zero application callers confirmed by grep.
Full COMPONENT | EXISTS | TESTED | CALLED | GAP matrix is in the newest
ENGINEERING_PROGRESS entry — start there, do not re-derive it.
KEY FINDING: `monsoon_risk` already refuses to turn absent data into low risk
(`passable = UNVERIFIED`, absent inputs named not zeroed, `NOT_PASSABLE`
separate from `score`). So the first integration needs NO fixture data.

**8. Landslide Intelligence V1 - steps 1a + 1b (IMPLEMENTED, no live data)**
`app/domain/landslide.py` (incident, source, verification, `assess_corridor`),
`app/services/landslide/` (Protocol, validated `BoundingBox`,
`NullLandslideProvider`), and the wiring in `app/services/route_risk.py`
(`corridor_box`, `landslide_for`) plus `app/domain/route_risk.py`.
`FACTOR_LANDSLIDE` was REMOVED from `UNAVAILABLE_FACTORS` - it is now
COMPUTED from a provider answer, not stamped by a constant.
THE INVARIANT (3 tests): INSUFFICIENT_DATA never becomes LOW.
  NOT_CONFIGURED -> UNKNOWN; provider exception -> UNKNOWN/SOURCE_FAILED;
  AVAILABLE + zero incidents -> LOW (the ONLY road to LOW).
Policy: OFFICIAL+closure -> CRITICAL; OFFICIAL/CORROBORATED -> HIGH;
UNVERIFIED alone -> CAUTION (never rejects a route); RESOLVED -> no raise.
Incidents with no coordinates are counted, reported, and NEVER placed on a
route. Queries bounded by `corridor_box` + 5-degree `BoundingBox` ceiling.
`landslide_for` never raises - trip planning survives a provider that
explodes (tested).
Evidence: 19 + 19 targeted PASS; 104 PASS landslide+route-risk subsystem;
reason-code coverage 16 PASS; driver 160; manager 64; typechecks clean.
NOT done: recurrence over real data, deduplication, route-recommendation and
reroute do NOT yet consume landslide risk.

**9. A11Y-1 (manager-web)**
8 `outline-none` suppressions removed; one global `:focus-visible` rule in
`src/index.css`, plus `cursor:pointer` on enabled controls and a
`prefers-reduced-motion` block.
Evidence measured in a live browser: `cursor: pointer`; focus ring
`2px solid oklch(0.765 0.177 163.223)`; reduced-motion rule present in
`document.styleSheets`; login at 375 px has no horizontal overflow.

**10. OBS-CLAIM-1 closed** — `SystemPage.tsx` no longer understates the product.
"**automatic** rerouting is not built" deliberately KEPT.

---

## PARTIALLY COMPLETE

**Manager-web responsive / a11y — login page only.**
Authenticated pages (Fleet, Trips, Drivers, Trucks, Assignments) are
UNVERIFIED at tablet/laptop widths. Blocked on a credential (BLOCKER-3).

**TripProvider lifecycle has no automated test.**
There is no renderer in driver-app's test setup, so provider mount/unmount is
verified by typecheck, code reading and a clean bundle — **not by execution**.

**Driver screens: rendered, but never INTERACTED with.**
Tab switching, topic tapping, the language picker and the "I stopped for a
break" button were all rendered but never actually pressed — the Browser pane
kept hiding (clicks time out against an unpainted pane) and react-native-web's
`Pressable` ignores a synthetic `onClick` invoked from JS. Screens were reached
by setting initial state instead. Widths 360 / 390 / 412 were not separately
measured; 320 and 375 bracket them and are clean.

---

## FAILED ATTEMPTS

| Attempt | Result | Why abandoned |
|---|---|---|
| `gis.earthdata.nasa.gov/.../COOLR_Events_Points/FeatureServer/0` | **404** | Endpoint does not exist |
| `maps.nccs.nasa.gov/.../COOLR_Events_Point/FeatureServer` | **timeout (curl 000)** | Unreachable |
| `data.nasa.gov/.../Global_Landslide_Catalog_Export_rows.csv` | **302 → presigned S3 → 403** | Presigned URL rejects the follow |
| `mausam.imd.gov.in/api/warnings_district_api.php` | **401** | Credential required |
| `npx prettier --write` on driver-app | churned 463 lines into semicolons + double quotes | **No prettier config in repo**; house style is no-semi/single-quote. Fixed with `--no-semi --single-quote`. **Do not run prettier here.** |
| Bash heredocs with mixed-script/quoted content | `unexpected EOF` parse error | Use the Write tool for such files |
| Clicking react-native-web `Pressable` via a JS-synthesised `onClick` | RNW ignores synthetic events | Use a REAL click. **Corrected LS-9:** `computer` clicks DO work on the driver web app - the earlier failure was the pane being HIDDEN, not RNW. Front the tab (`tabs_select`) and login, truck verification, start-trip and tab switching all click normally. |

---

## BLOCKERS

**BLOCKER-1 — landslide historical inventory**
TYPE: external API / missing dataset
EVIDENCE: all four probes above (404 / timeout / 403 / 401).
SAFE NEXT ACTION: do NOT build the read path — with no data its only honest
output is `landslide: NOT_AVAILABLE`, which the API already returns correctly.
Ask the user for an IMD credential or a Bhukosh/COOLR export on disk.
**Never manufacture coordinates.**

**BLOCKER-2 — `road_memory` persistence**
TYPE: shared database
EVIDENCE: `DATABASE_URL` → shared hosted Supabase
(`aws-0-ap-south-1.pooler.supabase.com`).
`docs/migrations/PENDING_road_memory_tables.sql` states in its own header that
promoting it to an alembic revision IS the approval step, because anything in
`alembic/versions/` is applied by the next `alembic upgrade head` — including
the one the test suite runs.
SAFE NEXT ACTION: require explicit user approval. NOT APPLIED; no schema
change was made this session.

**BLOCKER-3 — authenticated UI verification**
TYPE: credential
EVIDENCE: manager login needs an account; none available.
SAFE NEXT ACTION: ask the user for a non-production manager credential.
Note `backend/scripts/create_user.py` exists, but running it **writes to the
shared database** — get approval first.

**BLOCKER-5 - RESOLVED 2026-09-05 (LS-8)**
An isolated PostgreSQL 18.2 + PostGIS 3.6 cluster now exists under
`.runtime/` (127.0.0.1:55432, db `ner_logistics_test`, scram auth,
git-excluded). Arm it by dot-sourcing `.runtime/use-isolated-db.ps1`, and
start the backend with `backend/run.py` - NOT uvicorn directly, see its
docstring about the Windows event-loop policy. The full suite runs there in
1m45s versus 26 minutes against Supabase.

**BLOCKER-4 — device/native verification**
TYPE: infrastructure
EVIDENCE: no Android SDK/adb/gradle, java 1.8 (Expo SDK 57 needs JDK 17+), no
`android/` dir, not logged in to Expo.
SAFE NEXT ACTION: treat native-module work as unverifiable here.

---

## SECURITY STATE

- auth / RBAC / rate limiting: unchanged — no backend source modified.
- secrets: scan clean across every file changed this session.
- database: **no migrations applied, no schema change, no user rows created.**
  The backend test suite was run, which uses its own managed fixtures.
- new attack surface: none. Both new features are read-only local JSON — no
  network call, no `eval`, no dynamic import, no user input.
- `tel:` links open the dialler and do NOT place a call (deliberate).

---

## TEST STATE

    driver-app FULL        160 PASS / 13 files
    driver-app typecheck   PASS
    driver-app expo export PASS (exit 0; guide content confirmed in .hbc)

    manager-web FULL        64 PASS / 6 files
    manager-web typecheck  PASS
    manager-web lint       PASS (0 errors; 2 pre-existing warnings)
    manager-web build      PASS

    backend targeted        81 PASS (risk+monsoon+road_memory+progress)
    backend landslide        19 PASS provider + 19 PASS route-risk wiring
    backend subsystem       104 PASS landslide + route-risk (2m06s)
    reason code coverage     16 PASS (3 mirrors byte-identical)
    LS-8 FULL SUITE          793 PASS / 5 skip / 2 env-fail, 1m45s
    LS-8 stale interleaving    1 PASS - route superseded between assessment
                             and mutation is refused ROUTE_SUPERSEDED
    LS-8 cross-app            manager website + driver web, separate sessions,
                             ONE backend, SAME trip TTEST-... / AS27ZZ0320
    LS-7 FULL SUITE          792 PASS / 5 skip / 2 env-fail, 1m45s
                             on ISOLATED PostgreSQL 18.2 + PostGIS 3.6
    LS-7 live HTTP hazard      5 PASS - real auth, real PostGIS, real txn
                             422 ROUTE_REJECTED_ACTIVE_HAZARD proven
    LS-6 contract (live path)  9 PASS - real select_route/reroute/guard,
                            scenario injected at the PROVIDER seam
    LS-6 pure regression     171 PASS 2m40s (NO shared-DB writes)
    LS-5 pure regression     146 PASS 1m48s
    LS-5 API layer          NOT RUN - no isolated DB (BLOCKER-5)
    LS-4 subsystem          187 PASS 9m36s exit 0 (eligibility gate)
    scoring regression      127 PASS 2m02s (after LS-3 fix)
    backend broader         120 PASS 6m24s exit 0 (recommendation, reroute,
                            offline_package, routing, golden_path_e2e)
    backend FULL           724 PASS / 5 skipped / 0 failed, exit 0 (25m52s)
                           Re-certified THIS session; identical to 2026-09-02.
                           Skips: 4x destructive migration tests (gated behind
                           RUN_DESTRUCTIVE_MIGRATION_TESTS=1 - they drop every
                           table) + 1x non-Windows platform test. All correct.

    browser                PARTIAL — login page only (BLOCKER-3)

---

## IMPORTANT DECISIONS

1. **No `expo-speech` / STT / machine translation.** Managed Expo, no
   `android/`, no toolchain — a native module cannot be verified here. A
   microphone button backed by nothing gets discovered at the worst moment.
   There is deliberately no microphone control on the phrasebook screen.

2. **No landslide read path until data exists.** See BLOCKER-1.

3. **Rejected the `ui-ux-pro-max` palette.** It returned HUD / Sci-Fi FUI —
   neon `#00FF41`, glow + scanning animation, self-reported
   `accessibility risk: high`, and a marketing landing-page pattern for an
   authenticated console. Contradicts the mission brief. Its density scale,
   reduced-motion rule and checklist were kept. Design input, not authority.

4. **MapLibre needs no reduced-motion code.** 6.6.0 handles it internally
   (verified in the shipped bundle), and `FleetMap.easeTo` is keyed on
   operator selection and a button press, NOT on GPS polls. Do not "fix" it.

5. **Global CSS for focus/cursor, not per component.** Componentising it means
   every new hand-rolled element re-acquires the bug — which is exactly how 5
   pages ended up without a focus ring while the shared `Field` had one.

6. **No `useMemo` on the TripProvider context value.** `useLocationTracking`
   returns a fresh object with a fresh closure every render, so `tracking` can
   never be a stable dep and the memo recomputed regardless. Code implying a
   guarantee it cannot make is worse than no code.

7. **Do not run prettier in this repo.** No config, not a dependency.

9. **The assistant explains; it never acts.** Its inability to mutate comes
   from importing nothing that could, not from a validator. Keep it that way:
   if a future version needs to act, the action belongs in the screen with its
   own confirmation, never in a tool.

10. **`?raw` over `@types/node`.** The security test reads the module's own
    source. Vite's `?raw` import (declared in `src/raw-modules.d.ts`) does that
    without adding a Node types dependency to a React Native app. Metro never
    sees it — nothing in the app imports a `?raw` module.

8. **Break guidance says "elapsed", never "driving".** Nothing measures
   driving time in this build. Labelling elapsed time as driving time would be
   the app asserting something false about the person reading it. If driving
   time is ever wanted, accumulate the tracker's moving/stationary signal
   first — do not relabel the existing number.

---

## CURRENT DEFECTS

ID: LS-6a — FIXED
SEVERITY: MEDIUM (a closed reroute target took a row lock before refusal)
DESCRIPTION: reroute.accept computed eligibility early but refuse_if_ineligible
only ran downstream inside apply_selection - after trip_service.load_for_update
had locked the trip and read its routes.
FOUND BY: the contract test, whose ExplodingSession fails if the database is
touched before the refusal. My own grep had wrongly concluded there was no DB
work before the eligibility call.
FIX: refuse immediately after computing, before the lock. Also corrected the
now-false docstring "No risk assessment runs here".

ID: LS-5a — FIXED
SEVERITY: P1 (the guard enforced nothing on any live path)
DESCRIPTION: refuse_if_ineligible accepted decision=None and returned quietly.
Every live caller passed None. An LS-4 test asserted this was correct.
FIX: None and NOT_ASSESSED both refuse (ROUTE_ELIGIBILITY_NOT_ASSESSED);
apply_selection(eligibility=...) is now REQUIRED (no default) so omission is a
TypeError at the call site; select_route and reroute both compute it via
route_risk.eligibility_for_route BEFORE taking the row lock.
The stale LS-4 test was REVERSED (strengthened), not deleted.
STILL UNPROVEN: no live HTTP exercise - see BLOCKER-5.

ID: LS-4a — FIXED (earlier loop)
SEVERITY: HIGH (broke 33 tests)
DESCRIPTION: adding `landslide` to RouteRisk as a REQUIRED field broke every
existing construction site: TypeError missing 1 required positional argument.
ROOT CAUSE: required field on a widely-built dataclass = backward-incompatible.
FIX: defaulted to None, moved after the non-default fields. 187 green after.

ID: LS-4b — FIXED (caught by an existing guard)
SEVERITY: LOW
DESCRIPTION: new codes marked speak:true pushed the spoken set to 21 vs a
documented cap of 20. This build has NO TTS, so speak:true claimed a capability
that does not exist.
FIX: LS-4 outcomes are manager decisions - set quiet. Spoken set back to 17.

ID: LS-3 — FIXED
SEVERITY: P1 (a closed road could win a route comparison)
DESCRIPTION: a corridor with an OFFICIAL road closure scored 7/LOW, identical
to a clear corridor. Step 1b wired the landslide DATA STATUS through but added
NO POINTS, and route_recommendation._sort_key ranks on risk.score - so the
closed road won whenever it was quicker.
ROOT CAUSE: availability flag set, score untouched. Invisible because existing
tests either passed no landslide argument or asserted only the flag.
FIX: LANDSLIDE_POINTS (CRITICAL 45 / HIGH 30 / CAUTION 12 / UNKNOWN 5 / LOW 0)
contributed as a scored component. Red first (3 failures), then 22 green,
then 127 PASS regression.
NOTE: ranking is fixed; REJECTION is not built - see EXACT NEXT TASK.

ID: LS-1 — FIXED
SEVERITY: MEDIUM (a safety warning reaching a driver as raw SNAKE_CASE)
DESCRIPTION: 8 new landslide reason codes had no translation, and the coverage
suite stayed GREEN because tests/test_reason_code_coverage.py scans an
EXPLICIT MODULE ALLOWLIST rather than walking app.domain.
ROOT CAUSE: added a module that emits human-facing reason codes without
registering it in that allowlist.
FIX: registered `app.domain.landslide` (red: all 8 named), added en/hi/as.
NOTE FOR FUTURE WORK: any new app/domain module that defines REASON_* MUST be
added to that allowlist or its codes ship untranslated, silently.

ID: LS-2 — FIXED
SEVERITY: LOW
DESCRIPTION: there are THREE reason-code mirrors, not two - i18n/ (source),
driver-app/src/i18n/, and manager-web/src/i18n/. Syncing only the driver left
the manager copy drifted.
FIX: synced all three; coverage test asserts byte-identical. The TEST caught
this, which is what it is for.

ID: ASSIST-1 — FIXED
SEVERITY: LOW (honesty)
DESCRIPTION: with no trip loaded, "Am I online?" reported
`Queue storage: memory`. That is `TrackerState`'s INITIAL default, not a
measurement, and it implied a driver's positions would be lost on restart.
ROOT CAUSE: the answer described the queue before a tracker existed.
FIX: describe the queue only when tracking is running OR a backlog exists.
Red test first, then fix. Found by RENDERING — every unit test passed before
and after.

ID: I18N-REVIEW
SEVERITY: MEDIUM (safety-relevant)
DESCRIPTION: hi / as / bn strings in `guide.json` and `phrases.json` are
UNREVIEWED by native speakers, and the first-aid content has had NO clinical
review. Disclaimers are on screen in both features.
NEXT ACTION: human review before any demo claims these are verified
translations or medical guidance.

(DRV-002 is closed. DRV-002-RESIDUAL from the previous handoff is closed —
the mitigation it described was replaced by the real fix.)

---

## EXACT NEXT TASK

**LS-9 DID THE DESIGN.** See `docs/migrations/PENDING_route_review_authorizations.sql`
- a complete, priced, unapplied proposal: schema, the partial unique index that
makes concurrent consumption safe, the single conditional UPDATE that claims an
authorization atomically with the selection, the new `route:review_authorize`
permission (deliberately NOT given to MANAGER by default), 11 acceptance tests,
and the four policy questions only the owner can answer. **Answer section 6 of
that file first; nothing else should be built until who may authorise is
decided.** The original brief follows for context.

**Audited review resolution - design first, then implement.**

This is now the biggest product blocker. With no hazard source configured
every route is REQUIRES_REVIEW, so NOTHING can be selected. Correct safety
behaviour, unusable product. There is deliberately no acknowledgement feature
and one must NOT be added unaudited.

Required design, all of it, before any code:
  - AUTHORIZED REVIEWER: a distinct permission, not merely 'a manager'.
  - RATIONALE: free text, required, stored - not a boolean.
  - BINDING: the acknowledgement is bound to (route_id, trip_id, evidence
    version/assessment identity). A review of yesterday's evidence must not
    authorise today's mutation.
  - EXPIRY: an acknowledgement goes stale. Choose and document a window.
  - INVALIDATION: any change to the route, trip lifecycle or evidence voids
    it. Reuse the LS-8 interleaving test shape to prove this.
  - AUDIT: actor, route, trip, time, policy version, evidence version,
    rationale - through the EXISTING audit facility.
  - ATOMIC APPLICATION: validated and consumed inside the same transaction
    as the selection, under the existing lock order.
  - HARD LIMIT: it can NEVER override REJECTED. A verified closure is not
    reviewable.

It almost certainly needs a new table, i.e. a migration - which is NOT
authorized. Price that first and ask, rather than half-building it. If the
answer is no, the honest fallback is to connect a real hazard source so
routes stop being UNKNOWN.

Smaller items if that is blocked: measure cross-app update latency (G3, not
done), and drive a closure refusal through the manager UI - which needs a
provider-injection seam for the RUNNING server that does not yet exist.

Runtime: `.runtime/`. Backend `backend/run.py` (NOT uvicorn directly).
Stop DB: `.runtime/pg/pgsql/bin/pg_ctl.exe -D .runtime/data -m fast stop`.

## NEXT TASKS AFTER THAT

1. **Component test harness for driver-app.** `react-native-web` and
   `react-dom` are ALREADY dependencies, so the cost is roughly `jsdom` +
   `@testing-library/react` + a vitest alias `react-native -> react-native-web`.
   This makes the manual render check of 2026-09-05 00:50 repeatable and finally
   lets `TripProvider`'s mount/unmount lifecycle be asserted. Devbuild only —
   nothing ships.
2. Authenticated manager pages at 768 / 1024 / 1440 px — the moment BLOCKER-3
   clears.
3. Surface break status to the manager. Needs a backend field, so it needs
   BLOCKER-2 cleared first. `breakStore.ts` is the seam.
4. Manager mobile (Phase 4) — LARGE. Driver app has NO map dependency; treat as
   multi-session and split into milestones.

## DO NOT REPEAT

- The four landslide data-source probes. All exhausted.
- Checking whether MapLibre honours `prefers-reduced-motion` — it does (6.6.0).
- Checking whether `queueStore` is wired — it IS
  (`useLocationTracking.ts:118`), despite an older doc entry saying otherwise.
- Searching for a driver-app component test harness — there is none.
- Running prettier (see FAILED ATTEMPTS).
- Auditing the whole repository.
- Trying to click a react-native-web `Pressable` via a synthetic `onClick` —
  RNW ignores it. Real `computer` clicks DO work with the tab FRONTED (LS-9).
- Re-verifying that the driver screens render at all. Done 2026-09-05 00:50
  with screenshots; SafetyScreen, its detail view and PhrasebookScreen all
  render clean at 320 px and 375 px with no console errors.

---

## RESUME COMMAND

    CONTINUE FROM EXISTING PROJECT STATE.

    Read first:
      docs/CLAUDE_HANDOFF.md
      the newest section of docs/ENGINEERING_PROGRESS.md

    Then verify git state (branch, HEAD, status --short) and check for
    another writer.

    Do not repeat completed work and do not re-audit the repository.

    Resume from the `EXACT NEXT TASK` section above.

    Follow the Context-Aware Autonomous Engineering Protocol. READ THE ACTUAL
    context figure if it is displayed rather than estimating it — a
    conservative guess ended a previous session with 69% of the window unused.
