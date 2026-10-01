# Pre-deploy add-on: full-screen maps and the credits UI (1 Oct 2026)

Scope: `RASTA_AI_MAP_FULLSCREEN_PREDEPLOY_ADDON.md`. Local only: nothing pushed, deployed or migrated.

## What changed

| Area | Change | Files |
|---|---|---|
| Driver Navigate | An **Expand map to full screen** control on the map's control rail. Full screen is a layout switch on the same map: the hero, search, cards below the map and the tab bar step aside, and the map card fills the screen. The same Leaflet map, GPS watch and polls stay mounted. Overlays: **Exit full screen** (top left, green), SOS, the maneuver card or speed, layers, re-centre and route overview. The summary at the foot carries the route check, ETA/distance and the GPS/offline word. A danger alert floats above the map attribution until acknowledged. **Android Back** closes an open sheet first, then full screen, then leaves the screen. Exit restores the page's scroll position. | `driver-app/src/screens/MapScreen.tsx`, `driver-app/App.tsx` (hides the tab bar) |
| Manager Fleet | A **Full screen** button in the map card header (`aria-label` "Expand fleet map"). Full screen is a class change on the same card (`fixed inset-0`); MapLibre follows its container's size. The freshness filters move into the header. The selected truck shows as a compact card: registration, driver, trip, status, **GPS fix** freshness from the server label and its age, and next stop. **Esc** or **Exit full screen** returns with the selection, filters and camera unchanged. | `manager-web/src/pages/FleetPage.tsx` |
| Credits UI | Removed every per-photo (i) "Photo credits" control: driver hero, login and Safety banner; manager login and Overview. One **Legal & attributions** entry per app (driver More, manager account menu) opens the "Attributions" list: every photo with author, licence link and source page, plus "Map data © OpenStreetMap contributors (ODbL)". Map attribution controls are unchanged on every map. | `driver-app/src/components/scenic.tsx`, `MoreScreen.tsx`, `LoginScreen.tsx`, `SafetyScreen.tsx`, `i18n/phrases.ts`; `manager-web/src/components/ScenicImage.tsx`, `ProfileMenu.tsx`, `LoginPage.tsx`, `OverviewPage.tsx`, `imageCredits.ts`; ledger `docs/REDESIGN_IMAGE_ATTRIBUTION.md` |

Licence reasoning (CC BY / CC BY-SA "reasonable manner"): see `docs/REDESIGN_IMAGE_ATTRIBUTION.md`.

## Tests

- Driver: new `src/screens/MapScreen.fullscreen.test.tsx` (7 tests). It covers:
  - expand label;
  - page hidden and map controls kept;
  - exit restores the page, and the map is mounted once;
  - Back closes full screen first;
  - active navigation keeps the maneuver card, SOS, ETA and route check, and the route is unchanged;
  - the offline saved-route word;
  - SOS sheet before Back;
  - the tab bar comes back on unmount.

  Credits tests were rewritten to the new rule: no control on any photo, "Legal & attributions" lists the photos and OpenStreetMap.
- Manager: 3 new `FleetPage.test.tsx` tests:
  - expand and Esc, with filters kept, no second map mount and no extra fleet poll;
  - selected truck kept, with a STALE fix never shown as LIVE;
  - scope unchanged.

  Credits tests were rewritten the same way.
- These were written with the implementation; they fail on the previous build (no Expand control, credits present). No red run was recorded separately.

## Evidence

Paths are under `.runtime/evidence/company-demo/fullscreen/`.

### Manager

Headless Chrome on the local stack, driven with mouse and keyboard (`fs-proof.mjs`). Selected truck: a simulated Bipul Das trip near Guwahati.

| Viewport | Theme | Full card = viewport | H-scroll | Controls off-screen | Attribution covered | Esc exits | Filter kept | Selection kept |
|---|---|---|---|---|---|---|---|---|
| 1024×768 | Light | yes | no | 0 | no | yes | yes | yes |
| 1366×768 | Light | yes | no | 0 | no | yes | yes | yes |
| 1366×768 | Dark (card rgb 14,17,16) | yes | no | 0 | no | yes | yes | yes |
| 1440×900 | Light | yes | no | 0 | no | yes | yes | yes |
| 1920×1080 | Light | yes | no | 0 | no | yes | yes | yes |
| 2560×1440 | Light | yes | no | 0 | no | yes | yes | yes |

- **Timing:** enter 250–414 ms and exit 38–102 ms. This is measured through CDP and includes the 250 ms polling granularity.
- **Fleet polls:** 0 or 1 per window, which is the normal 10 s cadence. The unit test pins "no extra poll".
- **Other checks:** the Exit button works, there are 0 Photo credits buttons, and the account menu opens the "Attributions" list (3 photos and OSM). JS errors: 0.
- **First-run finding, fixed:** the selected-truck card covered MapLibre's attribution. It was moved up and re-measured as not covered.

Files:
- `mgr-01-fleet-normal-1366-light.png`
- `mgr-02-fleet-full-<w>x<h>-<theme>.png`
- `mgr-03-…`
- `mgr-04-legal-attributions.png`
- `manager-fullscreen-report.json`

### Driver web

Same screen, react-native-web, `fs-proof-driver.mjs`. Simulated geolocation; ACTIVE simulated trip.

- The map card fills the viewport exactly at 360×800, 390×844 and 412×915, and Leaflet resizes to match.
- The tab bar and hero are hidden in full screen and return on exit.
- No horizontal scroll and 0 JS errors.
- Exit, SOS, layers, re-centre and overview are 48×48. The maneuver card shows, the ETA reads "94.6 km · 1 h 14 min at planned pace", and the attribution is visible.
- Dark: surfaces are charcoal or black (card rgb 27,32,30; rail rgb 14,17,16), with green only on the Exit and re-centre accents.

Files: `drv-fullscreen-<w>x<h>.png`, `drv-fullscreen-412x915-dark.png`, `driver-web-fullscreen-report.json`.

### Physical Android

APK 1.0.24 on an OPPO CPH2691 (Android 16), 1264×2780 px. Checks used text-only UI dumps (`.runtime/demo/uib.sh`), with no screenshots, so no real-location map imagery was captured.

| State | Result |
|---|---|
| Normal Navigate | Map card boxed at y 890–1723; Expand on the rail |
| No trip, full screen | Map card [0,0]–[1264,2779], tab bar hidden, Exit, SOS, layers and re-centre at y ≥ 168 (below the status bar), Leaflet/OSM attribution at the foot |
| Back | Exits full screen and stays on Navigate |
| Exit button | Returns to the boxed map |
| ASSIGNED | Full screen with route summary "Guwahati Depot → Shillong Depot · 98.8 km · 1 h 17 min · Route check: CAUTION" and the overview control |
| ACCEPTED | Full screen OK |
| ACTIVE | Maneuver card, speed, SOS, layers, re-centre, overview, nav chip, "Route check: CAUTION", "96.1 km · 1 h 15 min at planned pace", GPS accuracy only. Layers panel and re-centre work; the danger alert floats above the attribution and is acknowledged in full screen |
| AT_PICKUP | Full screen OK |
| Offline | Adb reverse removed: the nav chip reads "Offline", and the route and ETA stay |
| Reconnected | The nav chip reads "Following" |
| Mid-trip change | Manager added a stop while full screen: no reset; "Journey updated by your manager", then Acknowledge, then full screen again OK |
| Credits | Trip, Safety and Navigate show no credit control; More → Legal & attributions lists OSM and the photos |
| Crashes | 0 crash records |

Real GPS was used only for this trip, with the owner's approval of 1 Oct. Its 7 `gps_points` rows were deleted afterwards (0 left; no event, emergency or other copies). Both demo trips were released by `reset.py`; a second run released 0.

## Not proven

- **Large-text accessibility:** not re-proven on the phone, because changing the phone's font scale is a phone setting. The map height logic for large text is unchanged.
- **Landscape:** not added. The app is portrait.
- **"Saved route" in full screen:** shown by a unit test only. On the device the route was already live when the link was cut.
