# Running the demo

## Judge demo (remote - the laptop is not required)

| | |
| --- | --- |
| Manager | https://ner-manager.onrender.com |
| API | https://ner-intelligence.onrender.com (open `/health` five minutes before the slot: the free dyno sleeps) |
| Driver | `release/RASTA-AI-1.0.18.apk` installed on the phone (package `com.nxtlucifer.nerlogistics.driver.preview`, see `release/README.md`) |

ONE reset, ONE check, both remote:

```bash
bash .runtime/judge.sh reset     # one JUDGE-xxxxxx trip at DRAFT, driver + truck AVAILABLE, evidence warmed
bash .runtime/judge.sh check     # backend, DB, manager, providers, trip state, driver, truck -> RESULT READY
```

Flow: manager opens the JUDGE trip (Drivers/Trucks pages show the demo driver
portrait and truck reference image) -> Review route -> Check conditions (terrain,
landslide history, weather, warnings, flood, unknown factors named) -> Use this
route -> Dispatch. The phone receives it within ten seconds -> Accept -> **Check
the truck: Take photo (camera) -> plate -> Confirm** (the reset made a fresh
assignment, so this step is real every time; the Assignments page then reads
"driver photo" with the trip verification photo) -> Start -> Navigate (Personal Route AI, hazards, traffic UNKNOWN until two
trucks share a road) -> drives off the corridor -> real OSRM reroute -> manager
accepts -> phone follows the new road -> stops -> Complete trip -> manager shows
DELIVERED, driver and truck AVAILABLE. Rehearsed end to end on the physical phone
(`.runtime/evidence/judge_e2e_r*.log`).

## Local fallback

Everything below runs on your laptop against the isolated local database. It
never touches shared Supabase.

## Start

**Double-click `scripts\Start-Demo.cmd`.** It works from anywhere — it finds the
project from its own location, so you can put a shortcut on the desktop.

It starts only what is not already running, waits until each part actually
answers, and opens both applications:

| | |
| --- | --- |
| Manager + reviewer | http://localhost:5173 |
| Driver | http://localhost:8081 |

Sign-in details are in `.runtime\` and are **not printed anywhere**:

| File | Who |
| --- | --- |
| `.runtime\manager-login.txt` | manager — plans routes, selects, dispatches |
| `.runtime\reviewer-login.txt` | reviewer — authorises UNKNOWN hazard evidence |
| `.runtime\driver-login.txt` | driver on the ACTIVE trip, for navigation |
| `.runtime\driver2-login.txt` | second driver with a trip waiting to be accepted |
| `.runtime\demo-account-login.txt` | **your demo driver, phone `7016551560`** |

### Your demo account

One password, two logins. A phone number can belong to only one account
(`uq_users_phone` is unique) and drivers must sign in by phone — so the phone
goes to the driver and the manager gets an email:

| Where | Sign in with |
| --- | --- |
| Driver app — http://localhost:8081 | **`7016551560`** |
| Manager web — http://localhost:5173 | **`demo@ner.invalid`** |

The driver already has trip **TRP-DEMO1560** (Guwahati → Jorhat) dispatched, with
an approved detailed route and 19 turn instructions. So this one login walks the
whole journey: **Accept trip → Map → check the truck → Start trip → navigate.**

To recreate it, or reset the password:

```
cd backend
.venv\Scripts\python.exe scripts\demo_account.py --password "your-password"
```

It is re-runnable: an account that already exists has its password reset and is
reactivated rather than failing.

Each file is two lines: the sign-in identifier, then the password. Drivers sign
in with a **phone number**, managers and reviewers with an **email**.

Launching a second time starts nothing new. It does **not** run migrations,
tests, `npm install` or password resets — a launcher that reseeds on every start
destroys the rehearsal it was meant to open.

## Five steps to show someone

1. **Manager: see the fleet and the trip.** Sign in at
   http://localhost:5173 with `manager-login.txt`. Open trip **TRP-MTO9WQ6E** —
   the Guwahati → Jorhat corridor, 305 km, with its approved route on the map.

2. **Manager: plan a route and hit the safety gate.** Plan a new candidate. Try
   to select it: it is refused with `ROUTE_SELECTION_REQUIRES_REVIEW`, because no
   landslide source is configured and the system will not pretend the evidence is
   complete. **This refusal is the product**, not a bug.

3. **Reviewer: authorise, manager selects.** Sign in as the reviewer (a separate
   browser profile, or sign the manager out first — they share one session
   cookie). Record a rationale and issue the authorisation. Back as the manager,
   select the route: it now succeeds. The route stays UNKNOWN afterwards —
   reviewing evidence is not declaring a road safe.

4. **Driver: accept a job.** At http://localhost:8081 sign in with
   `driver2-login.txt`. The trip is waiting with **Accept trip**. Accept it and
   the dedicated Map page opens. **Back** returns to the trip page; **Resume**
   reopens the map without accepting or starting anything again.

5. **Driver: navigation and help.** Sign in with `driver-login.txt` and press
   **Resume navigation**. Then run the journey simulation below to see the
   next-turn panel count down, the position move along the route, roadside
   categories, and the Emergency panel — which stays reachable throughout.

## Location: two separate choices

**1. Your device's location.** Just use the driver app in your browser and allow
location when asked. Honest and real — and if you are not in Assam, guidance
pauses with *"Off the planned route"*, because you are. That is the correct
answer, not a fault.

**2. Simulate the Assam journey.** Double-click
`scripts\Simulate-Journey.cmd`. It opens a Chrome window whose **geolocation** is
simulated along the approved route, with a **SIMULATED GPS** banner on screen for
as long as it runs.

Only the position is simulated. The app's own location watcher, its uploader, the
backend, the permission checks, the freshness rules and the route policy all run
exactly as normal — nothing is faked, and no API response is stubbed. If guidance
pauses during a demo, the product is telling the truth.

**It waits for the driver to take the job.** A truck does not move before its
driver accepts it, and tracking only runs once the trip is ACTIVE. So the replay
opens the app, signs the demo driver in, and then waits — telling you whether it
is waiting for **Accept trip** or for **Start trip**. Do those in the browser
window it opened, and the drive begins.

Controls, in the terminal window it opens:

| Key | |
| --- | --- |
| `space` | pause / resume |
| `s` | stop the replay, leave the browser open to drive by hand |
| `q` | stop and close |

Options:

| Flag | |
| --- | --- |
| `--kmh 50` | **ground speed, default 50 km/h.** A real speed, not a multiplier |
| `--from 0.4` | start 40% along the route, near a turn |
| `--tick 2` | seconds between position updates |
| `--driver <file>` | which `.runtime` login to drive as (default: the demo account) |

50 km/h is a truck's real speed, so the full 305 km takes about six hours. For a
short demonstration either raise it (`--kmh 400`) or start near a turn
(`--from 0.4`), which puts a maneuver a couple of minutes ahead. Measured against
the backend at the default: **50.0 km/h, on route, LIVE**.

Two safety properties worth knowing: only **one replay can run at a time** — two
would fight over the same driver's position — and the dialler is intercepted, so
a demonstration can never place a real emergency call.

**One-time setup** before first use:

```
cd scripts\demo
npm install
```

## Reset the Accept scenario

Demonstrating **Accept trip** consumes it, and pressing **Start trip** consumes
it further. To rewind a trip to before the driver touched it:

```
cd backend
.venv\Scripts\python.exe scripts\demo_scenario.py --reset-pending --trip TRP-DEMO1560
```

Without `--trip` it rewinds **every** demo trip and prints which ones — useful
for a clean slate, surprising if you only meant one. `--status` shows the
scenarios without changing anything.

This is deliberately not part of the launcher: a launcher that resets on every
start erases the state you were about to show someone.

## Stop

**Double-click `scripts\Stop-Demo.cmd`.** It stops only the services
Start-Demo started, checked by recorded pid *and* the port each was started for,
so a recycled pid belonging to something else is skipped.

It leaves the isolated database running — it holds the demo trip, the accounts
and the approved route, and starting it again is cheap. To stop it too:

```
.runtime\pg\pgsql\bin\pg_ctl.exe -D .runtime\data stop
```

## If something goes wrong

The launcher names the log to read. They are all in `.runtime\`:
`demo-backend.err`, `demo-manager.err`, `demo-driver.err`, `server.log`.

The slow one is the driver app: Expo builds its web bundle on the first request,
which can take a couple of minutes on a cold start. That is normal.

## Android

The four blockers this section used to list are resolved. What is configured now:

| | |
| --- | --- |
| Package | `com.nxtlucifer.nerlogistics.driver.preview` (`driver-app/app.json`) |
| EAS project | `@nxtlucifer2296/ner-driver-app` |
| API the APK calls | `http://192.168.1.6:8000` (`driver-app/eas.json`, preview profile) |
| Build command | `cd driver-app; $env:EAS_NO_VCS=1; npx --yes eas-cli@latest build -p android --profile preview` |

### Before a demo with a phone

1. **Check the laptop's Wi-Fi address hasn't changed.** DHCP reassigns, and a
   stale address baked into the APK is a phone that cannot sign in.

   ```
   Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' }
   ```

   If it differs from the table above, update `driver-app/eas.json` and rebuild.

2. **Start the demo in LAN mode** so the API listens where the phone can reach
   it. Without this it binds `127.0.0.1` and a phone cannot see it at all:

   ```
   powershell -File scripts\Start-Demo.ps1 -Lan
   ```

   This changes nothing on disk — the switch sets `API_HOST` for that one
   process. The database stays on `127.0.0.1:55432`; only the authenticated API
   moves.

3. **Allow inbound TCP 8000 on the private profile.** This needs an
   administrator PowerShell and is the one step that is yours to run, because it
   changes a Windows security setting:

   ```
   New-NetFirewallRule -DisplayName "NER demo API" -Direction Inbound -Protocol TCP -LocalPort 8000 -Profile Private -Action Allow
   ```

   Remove it after the demo with
   `Remove-NetFirewallRule -DisplayName "NER demo API"`.

### The map in the APK

The phone map is Leaflet over OpenStreetMap inside a WebView
(`driver-app/src/map/DriverRouteMap.native.tsx`) — the same map the web app
draws, no Google key, works in Expo Go. Tiles need a connection; offline the
route draws over a blank ground with a notice saying so.

### Cleartext HTTP

Android blocks plain HTTP by default. The preview build enables it, but ONLY
because its own `EXPO_PUBLIC_API_BASE_URL` starts with `http://` — see the gate
in `driver-app/app.config.js`. Point it at an `https://` address and the
exemption disappears by itself.
