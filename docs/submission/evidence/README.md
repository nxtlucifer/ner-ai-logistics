# Capture evidence — SIMULATED GPS, BROWSER TEST

**Every position below is simulated.** Coordinates are vertices of the route
the backend had approved at capture time, fed through Chrome's own
geolocation in a dedicated test context. The app's `watchPosition`, its
uploader, the backend's ingestion and the ten-second trip poll all ran
normally; nothing in the application was stubbed, patched or told to report
success.

**This is not a physical device.** No claim is made here about native
behaviour, background tracking, or accuracy on a real road.

## How it was produced

Playwright driving the **installed Chrome** (`channel: 'chrome'`) in a fresh
context — not the user's profile, and not the Chrome extension. Geolocation
permission was granted the ordinary way, to the driver-app origin only, so
the app's own permission, freshness and route checks ran for real.

Scripts: `c1_capture.js`, `c1_capture2.js`, `c1_capture3.js` in the session
scratchpad. Route coordinates come from `GET /api/driver/me/trip/navigation`.

## Four of these files are duplicates — read before citing them

A checksum pass over this directory found two groups of **byte-identical**
files sitting under different scenario names:

```
bb5f3a56fd49ede5af6bab88db0df12a
    24-emergency-dialler-intercepted.png
    25-replan-preserves-assignment.png
    26-approved-replacement-switched.png

047966bd29ebdb8bb2df6ebf1a231e16
    31-baseline-live.png
    32-approved-replacement-driver-side.png
    33-contact-lost-hold.png
```

Within each group there is **one capture, not three**. The extra names are
copies, so the rows below that point at them do not independently evidence
anything.

**What each group actually shows.** `24` is a real capture of the emergency
panel: the dialler intercept line *"Last dialler request: tel:112"* is visible
in it, so **row 9 stands**. It shows no replan and no driver replacement, so
**rows 7 and 8 are not evidenced** by `25` and `26`. In the second group `31`
is the baseline; `32` and `33` are the same pixels, so neither shows a state
change away from that baseline — **row 8 (driver side) is not evidenced**, and
row 5 was already withdrawn as superseded by `42`.

**Status of the affected claims:**

| Row | Claim | Standing |
| --- | --- | --- |
| 9 | emergency-dialler-intercepted | **evidenced** by `24` |
| 7 | replan-preserves-assignment | **NOT EVIDENCED** — needs recapture |
| 8 | approved-replacement-switched (API side) | **NOT EVIDENCED** — needs recapture |
| 8 | approved-replacement-driver-side | **NOT EVIDENCED** — needs recapture |
| 5 | contact-lost-hold (31–33 group) | already superseded by `42` |

Two login shots are also duplicated across the `terrain-command` set
(`after-manager-login` / `iteration1-manager-login`, and the driver pair).
Those are expected: the login screen is identical before and after, and neither
is cited as proof that something changed.

Nothing here is deleted, so the recapture can be compared against what was
claimed. **Do not cite rows 7 or 8 until they have been recaptured.** The same
standard the rest of this file is written to applies: a missing capture is a
fact, a mislabelled one is not.

## The nine scenarios

| # | Shot | Panel showed | File |
| --- | --- | --- | --- |
| 1 | granted-fresh-on-route | 27 km Turn straight | `01-granted-fresh-on-route.png` |
| 2 | countdown-approaching | 4.0 km Turn straight | `02-countdown-approaching.png` |
| 2 | countdown-after-maneuver | 75 km Continue onto Nagaon Bypass | `03-countdown-after-maneuver.png` |
| 6 | off-route-hold | Off the planned route Directions are paused because your position is not on the assigned road... | `04-off-route-hold.png` |
| 6 | off-route-recovered | 35 km Continue | `05-off-route-recovered.png` |
| 9 | emergency-panel | 35 km Continue | `06-emergency-panel.png` |
| 2 | countdown-220 | 16 km Continue onto Nagaon Bypass | `21-countdown-220.png` |
| 2 | countdown-120 | 10 km Continue onto Nagaon Bypass | `22-countdown-120.png` |
| 2 | countdown-40 | 4.9 km Continue onto Nagaon Bypass | `23-countdown-40.png` |
| 9 | emergency-dialler-intercepted | 4.9 km Continue onto Nagaon Bypass | `24-emergency-dialler-intercepted.png` |
| 7 | replan-preserves-assignment | 4.9 km Continue onto Nagaon Bypass | `25-replan-preserves-assignment.png` **— DUPLICATE of 24, NOT EVIDENCE** |
| 8 (API side) | approved-replacement-switched | 4.9 km Continue onto Nagaon Bypass | `26-approved-replacement-switched.png` **— DUPLICATE of 24, NOT EVIDENCE** |
| 4 | stale-hold | Guidance paused Your last position is too old to guide from. The route is still shown. | `27-stale-hold.png` |
| 5 (superseded) | contact-lost-hold | 35 km Continue | `28-contact-lost-hold.png` |
| 3 (superseded) | permission-revoked-after-live-fix | (panel not found) | `29-permission-revoked-after-live-fix.png` |
| - | baseline-live | 33 km Continue | `31-baseline-live.png` |
| 8 | approved-replacement-driver-side | 33 km Continue | `32-approved-replacement-driver-side.png` **— DUPLICATE of 31, NOT EVIDENCE** |
| 5 (superseded) | contact-lost-hold | 33 km Continue | `33-contact-lost-hold.png` **— DUPLICATE of 31** |
| 3 (superseded) | permission-revoked-after-live-fix | 31 km Continue | `34-permission-revoked-after-live-fix.png` |
| - | recheck-baseline-live | 33 km Continue | `41-recheck-baseline-live.png` |
| 5 | contact-lost-hold-FIXED | Guidance paused No recent contact with the server, so your position cannot be confirmed. The ... | `42-contact-lost-hold-FIXED.png` |
| 3 | permission-revoked-after-live-fix-FIXED | Guidance paused Location is off. Turn it on to see turn-by-turn directions. The route is stil... | `43-permission-revoked-after-live-fix-FIXED.png` |

## Notes on two of them

**9 — the dialler.** The app itself records the attempt and prints
*"Last dialler request: tel:112"* under the emergency buttons, beside its own
disclaimer that it opens the dialler and does not place the call. That line
in the screenshot is the evidence: the app asked, and no call was placed.

**5 — polling loss.** An earlier attempt waited 80 seconds against a
90-second window and therefore showed guidance still running. That was a
test error, not a defect: `loadedAt` in `TripProvider` advances only on a
successful poll, which was checked in the source. The capture here waits
past the window.
