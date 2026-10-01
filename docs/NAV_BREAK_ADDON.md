# Driver navigation essentials + driver breaks (1 Oct 2026)

Scope: `RASTA_AI_DRIVER_NAV_BREAK_ADDON.md`. All work is local: nothing is pushed or deployed, and hosted Supabase was not touched. Migration 0017 is applied to the local test and demo databases only.

## What was built

### Driver navigation

| Requirement | How |
|---|---|
| Always visible while navigating, in both sizes | **Next turn:** the maneuver card. **Speed:** the gauge. **Status line** (`nav-status`): the time now, "Arrive HH:MM", time left and distance left, all from the server's planned pace and never invented. **SOS**, and **Expand / Exit full screen**. |
| Show/hide controls | A **Hide map controls / Show map controls** toggle on the rail. It hides the secondary tools: layers, re-centre, route overview and Take a break. The essentials above never hide. |
| Break action | **Take a break** on the rail, shown only while the trip is under way and no break is open. |
| No trip | Browsing, search, terrain, quick services, SOS, full screen and the toggle still work. No break button is shown. Full screen shows the time. |

### Driver breaks

The break sheet offers **15 or 30 minutes** and a reason from six choices: Tea / rest, Food, Washroom, Fuel, Emergency, Other. Start stays disabled until a reason is picked.

Starting a break sends:
- one request id per sheet, reused on retry;
- the phone's fix, if the phone has one.

The server's answer drives the screen:
- **On break · reason · N min left · back by HH:MM**, with **Resume driving**, on the map in both sizes and on the Trip tab;
- "Overran by N min" once the planned time has passed.

The route, the stops, the GPS watch and the map all stay as they were. The trip stays **ACTIVE**.

### Backend

| Piece | Detail |
|---|---|
| Table `trip_breaks` (migration **0017_trip_breaks**) | Columns: id, trip, driver, truck, request_id (unique), started_at, planned_minutes (CHECK 15/30), reason (CHECK six values), note, location (geography point), location_at, location_source (PHONE / LAST_FIX), nav_state (trip status, selected route), ended_at, overdue_alerted_at, started_by / ended_by. A partial unique index enforces one open break per trip. RLS is enabled. |
| Enum values | `trip_event_kind`: BREAK_STARTED / BREAK_ENDED / BREAK_OVERDUE. `notification_kind`: DRIVER_BREAK_STARTED / ENDED / OVERDUE. Both are declared in `tests/test_schema_drift.py`. |
| `POST /api/driver/me/trip/break` | Idempotent on `request_id`. A second break while one is open is refused (409 `BREAK_ALREADY_ACTIVE`). A trip that is not under way is refused (409). The location comes from the phone fix, or else the trip's newest GPS point. It writes the row, a timeline event, an audit row and one inbox note per manager (scoped managers plus regional). |
| `POST /api/driver/me/trip/break/resume` | Idempotent: an already-ended break returns the trip unchanged. It records ended_at and the actual duration, writes a timeline event, an audit row and a "back on the road" note. |
| `CurrentTrip.active_break`, `FleetTrip.on_break` | Status is computed on every read (ACTIVE, OVERDUE or ENDED), so overdue shows at once. |
| `GET /api/trips/{id}/breaks` | Break history with location. Needs `fleet:location_read`, and the trip must be in scope (404 otherwise). |
| Break watch loop | `BREAK_WATCH_ENABLED` (on in `render.yaml` and the demo API), every 30 s. Each overdue break is claimed with UPDATE … RETURNING, then gets one BREAK_OVERDUE event and one WARNING note. This is safe with several instances. |

### Manager

- **Inbox:**
  - "Bipul Das is on a 15 min break on TRP-…", with reason, start time, due-back time and place, or "place not known".
  - "… is back on the road", with actual vs planned minutes and whether it overran.
  - "… has run past 15 min".
  - The Overview activity rail uses the same text.
- **Fleet list:** an ON BREAK / BREAK OVERRAN pill sits beside the GPS pill, never instead of it. So a break on stale GPS still reads STALE.
- **Fleet map:** the marker chip is dashed and labelled "· on break" or "· break overran". The colour stays the GPS freshness, so a break is distinct from offline, stale or emergency.
- **Full-screen Fleet card:** shows the break line.
- **Fleet Activity tab and trip review:** "Driver breaks" history, with reason, planned length, status (ON BREAK, OVERDUE, RESUMED or RESUMED LATE), start, due-back and resume times, and the place.
- **Journey history:** "Driver took a break", "Driver back on the road", "Break overran".

## Tests

| Suite | Result | New |
|---|---|---|
| Backend | **1818 passed, 27 skipped** | `tests/test_breaks.py` (8) |
| Driver | **975 / 975**, tsc clean | `MapScreen.break.test.tsx` (10), Trip-tab break test |
| Manager | **591 / 591**, tsc clean, build OK | `BreakHistory.test.tsx` (7), 3 Fleet break tests |

The backend tests cover:
- 15 and 30 minute breaks;
- the reason and location (phone fix or last fix);
- the trip staying ACTIVE on the same route;
- a retried start is one row, one event and one note;
- a second break refused;
- resume twice is one end;
- 404 on a foreign break;
- refusal outside an active trip, and a 422 for a bad length or reason;
- overdue visible at once, and the sweep alerting exactly once;
- RESUMED LATE in the history;
- Fleet `on_break`, the timeline, and scope (404).

Existing guardrails that this work had to satisfy, and that were not weakened:
- **RLS on every public table:** enabled for `trip_breaks`.
- **Tight free-text bounds:** `reason` has `max_length` 20 plus a pattern.
- **Enum drift:** labels added to a post-0002 type are now checked against their own declared revision.
- **0016 head check:** it now asserts a single head with 0016 in its history.

Tests whose rule this add-on deliberately changed:
- The guiding summary previously excluded distance and ETA (B2D-05). It now requires the status line.
- The full-screen ETA test id became `nav-status`.

## Physical and browser proof

### Phone

APK **1.0.26** on the OPPO CPH2691, checked with text-only UI dumps (no screenshots, so no real-location imagery).

- **Browse:** the toggle hides layers and re-centre, while SOS and Expand stay.
- **Layout bug found and fixed:** the extra rail button pushed Expand off the bottom of the map card. The map now grows to hold its whole rail; a regression test was added.
- **Active trip:**
  - The normal view showed the maneuver card, speed, "11:25 am · Arrive 12:40 pm · 1 h 15 min left · 96.1 km", Take a break and Expand.
  - Full screen showed the same, plus layers, re-centre and overview.
  - Hiding the controls left Exit, the maneuver card, SOS, the toggle and the status line.
- **15-minute Tea / rest break:** the banner read "15 min left · back by 11:41 am" in both sizes. Regional, Assam and Kamrup managers all saw `on_break` ACTIVE/TEA_REST/15 with location source PHONE, the inbox note and one history row. Resume driving removed the banner and brought back Take a break; Fleet showed no open break and the inbox had "back on the road".
- **30-minute Food break:** the banner read "30 min left · back by 11:57 am", then resume.
- **Real GPS**, used with the owner's approval of 1 Oct, was erased afterwards:
  - 4 `gps_points` rows were deleted;
  - break, event and notification locations were cleared (break `location_source` = ERASED).

  Every count was checked at 0.
- **Found on the phone:** the Trip tab did not mention an open break. A notice was added (tested), and APK **1.0.27** carries it.

### Manager browser

Headless Chrome on the local stack (`brk-proof.mjs`), driving a simulated truck with simulated GPS. All of the following passed through the real API:

- the inbox started-break note, with place;
- Fleet: STALE plus ON BREAK, and the dashed marker labelled "on break";
- the Activity history and the full-screen line;
- after moving the start back 20 minutes, the live break-watch loop flagged it: BREAK OVERRAN on Fleet and "has run past 15 min" in the inbox;
- after resume: "back on the road" and "RESUMED LATE (21 min)".

JS errors: 0. Screenshots are `.runtime/evidence/company-demo/fullscreen/brk-0*.png`.

## Limitations

- **No offline queue for break and resume.** If the network drops, the sheet shows the server or network error and keeps the same request id, so pressing Start again is safe. Nothing is stored for later sending.
- **A trip cancelled or delivered during a break leaves the break row open.** The sweep and every read ignore breaks on finished trips, but the row has no `ended_at`.
- **Sentinel stationary check:** a stop longer than 60 minutes can still raise a driver check during an overrun break. That is intended: a long overrun deserves the check.
- **Driver-web variant of the break flow:** its proof script failed. The phone run and the unit tests cover the flow.
- **Hosted:** 0017 is NOT applied to hosted Supabase. It ships with the deployment step only after your authorization.
