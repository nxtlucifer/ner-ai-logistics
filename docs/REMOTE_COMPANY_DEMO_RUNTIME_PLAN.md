# Remote company demo — runtime plan (1 Oct 2026, 3:00 PM IST)

Everything here runs on hosted services. Nothing depends on the owner's laptop, a localhost URL, the home LAN, USB or `adb reverse`.
Passwords are NOT in this file. They are in the private sheet the owner shares with the team.

```text
PUBLIC_MANAGER_URL       = https://ner-manager.onrender.com
PUBLIC_BACKEND_URL       = https://ner-intelligence.onrender.com
PUBLIC_BACKEND_READY_URL = https://ner-intelligence.onrender.com/ready
DRIVER_WEB_FALLBACK      = https://ner-driver-web.onrender.com
APK_DOWNLOAD_URL         = https://github.com/nxtlucifer/ner-ai-logistics/releases/download/company-remote-demo-2026-10-01/RASTA-AI-driver-1.0.28-company-remote-demo.apk
APK_RELEASE_PAGE         = https://github.com/nxtlucifer/ner-ai-logistics/releases/tag/company-remote-demo-2026-10-01
APK                      = 1.0.28 (versionCode 28), package com.nxtlucifer.nerlogistics.driver.preview, app name "RASTA AI"
APK_SHA256               = deba490c09f9b92c030a647b5d29e6e0e8fd97a33a2a480c56abb9d124596a22
RELEASE_COMMIT           = a496ac3 (main; tag company-remote-demo-freeze)
ROLLBACK_COMMIT          = e4043ce (code). The database cannot simply roll back: see "Rollback" below.
HOSTED_SCHEMA            = 0017_trip_breaks, Survey of India OVSF/1M/7 geography loaded
```

## Accounts (names only; passwords in the private sheet)

| Role | Login | Scope |
|---|---|---|
| Regional manager | regional@rasta.demo | North-East, all 8 states |
| State manager | assam.sm@rasta.demo | Assam |
| District manager | kamrup.dm@rasta.demo | Assam, Kamrup Metro |
| Driver 1 (phone) | RASTA Demo Driver, truck AS86QQ7606 | — |
| Driver 2 (fallback) | Bipul Das, truck AS06QQ1107 | — |

On the region step, choose North-East, Assam, or Assam then Kamrup Metro, so it matches the account.

## Prewarm (about 14:30, and again 5 minutes before going on)

Render's free plan sleeps after 15 idle minutes, and the first request then takes about 30 seconds. Warm, `/ready` measured p50 0.68 s and p95 0.88 s; a Manager page loads in about 0.2 s.

1. Open `PUBLIC_BACKEND_READY_URL` and wait until it shows `"status":"ready"`. The response should include `schema` at_head and `geography` loaded.
2. Open the Manager URL. Pick the region, sign in, and open **Fleet**.
3. Open the driver app on the phone. It should restore the session; if not, sign in.
4. Keep the Manager tab open. Its own polling keeps the server warm. Do not add any other keep-alive.

## Reset (before the talk, and between runs)

- Use the hosted reset script, `.runtime/demo/reset_hosted.py`.
- It closes or cancels open trips held by the two demo drivers, plus any `TRP-RD-*` trips.
- It never deletes anything and touches nothing else. A second run reports 0.
- From a laptop with the repo:

  ```bash
  python .runtime/demo/reset_hosted.py
  ```

- Without a laptop: in the Manager, open **Trips**, open the demo trip, and use **Close** (delivered) or **Cancel**.

## Demo flow, as proven remotely on 1 Oct

1. **Manager plans a trip.** Guwahati Depot → Shillong Depot; RASTA Demo Driver / AS86QQ7606. The route is planned (about 98.8 km, about 1 h 17 min at planned pace). Its review shows terrain, past landslides (inventory to 2017) and official warnings. It is approved with a written reason, then dispatched.
2. **Phone, "RASTA AI" app on its own internet.** The New Trip Request appears; Accept.
   - **Navigate** shows the route, the next turn, speed, and the line "time · Arrive · time left · km left".
   - **Safety:** 112, 108 and 1033 open the dialler only.
   - **Assistant:** "Is my route risky?" gets an evidence answer.
   - Language switches to Hindi and back; the app is in Dark.
3. **Truck check.** The driver photographs the truck, or the manager verifies the plate by hand: Trucks / assignment → verify-manual.
4. **Start trip.** The Manager's Fleet shows the truck as **LIVE** to the regional, Assam and Kamrup managers.
5. **Manager adds a stop.** The phone shows "Journey updated by your manager"; the driver taps **Acknowledge**.
6. **Take a break**, 15 min, Tea / rest. The Manager sees **ON BREAK**; the driver taps **Resume driving**.
7. **Stops.** Arrive and finish the pickup, the checkpoint and the destination. **Complete trip** → "Trip complete… Location sharing has stopped."
8. **Manager Close** (Trips). The driver and truck are **AVAILABLE**, and the same pair can be planned again immediately.

## Failover

| Problem | Do |
|---|---|
| The first request hangs | Cold start: wait 30–60 s and refresh `/ready` |
| The phone cannot reach the server | Check the phone has internet; open `PUBLIC_BACKEND_READY_URL` in the phone browser |
| Phone app trouble | **Fallback 1:** Driver 2 on `DRIVER_WEB_FALLBACK` in a laptop or phone browser (same hosted backend) |
| Route planning returns ROUTING_UNAVAILABLE | The public OSRM demo router is busy: wait 30 s and retry once; otherwise show an existing trip |
| Anything else | **Fallback 2:** the recorded evidence (`.runtime/evidence/company-remote/`, `docs/COMPANY_VISIT_READINESS.md`) plus a read-only walk through the hosted Manager |

## Say out loud (true limits)

- **Routing** uses the public OSRM demo server: no SLA, and a car profile.
- **Map tiles** are OSM standard tiles. There is no offline basemap, no satellite and no 3D buildings.
- **Landslide** information is history to 2017. There is no live landslide feed; the route is never called "safe".
- **Hosting** is Render free tier, which cold-starts. This is a pilot, not production-grade.
- **APK signing:** the APK is signed with the project's debug key, for demo distribution.

## Rollback

| Part | How |
|---|---|
| **Code** | Point `main` back to `e4043ce`; Render redeploys. |
| **Database** | A full logical backup of hosted `public` + `app` was taken before migrating: `.runtime/hosted-backup/hosted_public_app_pre0013_*.dump`, 35 MB, on the owner's laptop only. It was restore-tested into a local clone (19,879 users, 136 trips, 429 GPS points, 215 routes). Supabase PITR is not confirmed on this plan. Restoring would discard everything written after 12:00 on 1 Oct. |
| **Compatibility** | 0013–0017 are additive. The old code ran against the new schema during the deploy window without errors. |
