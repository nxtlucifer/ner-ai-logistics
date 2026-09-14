# Screenshot package (SIH26002 PPT)

Real current screens, captured 14 Sep 2026 (evening re-capture) on the hosted stack (manager https://ner-manager.onrender.com, driver web build with a corridor GPS mock at `.runtime/rehearsal/evidence.mjs`) and on the physical phone with APK 1.0.18. No mock-ups. The phone's real location never appears: every map is on the Guwahati -> Shillong corridor.

| File | What it shows |
|---|---|
| `01-manager-overview.png` | Manager web, Fleet command after sign-in (hosted, 14 Sep 18:47 IST) |
| `02-trip-route.png` | Manager web, JUDGE trip route review map: real OSRM road Guwahati depot -> Shillong, 98.8 km |
| `03-route-evidence.png` | Manager web, Check conditions: LANDSLIDE HISTORY - HIGH EXPOSURE, 22 recorded landslides within 5 km, nearest 0.4 km (NASA GLC) |
| `03b-governance-review.png` | Manager web, governance: hazard evidence incomplete -> authorised reviewer must review before selection |
| `04-terrain-risk.png` | Manager web, TERRAIN summary: 49-1436 m, 1975 m climb, steepest 10.3 %, flat/rolling/hilly/steep km (Copernicus DEM) |
| `05-driver-trip.png` | Driver (web build of the same app, corridor GPS mock): NEW TRIP REQUEST received automatically after dispatch |
| `06-truck-verification.png` | Driver (web build of the same app, latest version): Check the truck — YOUR TRUCK card, photo (Camera / Gallery), registration, odometer, Verify |
| `06b-trip-after-verification.png` | Driver phone 1.0.18, trip page after the truck check: ASSIGNED, truck AS86QQ7606, route Caution with landslide exposure HIGH |
| `07-navigation.png` | Driver, turn-by-turn on the corridor: GPS +-8 m, Following, CAUTION, next terrain HILLY, landslide exposure HIGH, weather not available (provider rate-limited at capture), 5 of 11 evidence factors |
| `07b-offline-navigation.png` | Driver, navigation continuing offline from the cached whole-trip package |
| `08-route-ai.png` | Driver, PERSONAL ROUTE AI panel: CAUTION with reasons (steep gradients, recorded landslides) and evidence coverage |
| `09-reroute.png` | Driver, real off-route: 'Off the planned road - new road 74.2 km awaits manager' (human-governed reroute) |
| `09b-reroute-manager-review.png` | Manager web, ALTERNATIVE ROUTES review of the driver's reroute proposal (74.17 km, needs review) |
| `10-manager-mobile.png` | Manager account on the phone APK 1.0.18: mobile manager shell Overview (no driver identity), provider health shown honestly |
| `11-language-selector.png` | Driver phone 1.0.18, language sheet with search: 23 languages, status per language (Verified / Draft / English fallback) |
| `12-delivery.png` | Driver after Complete trip: No active trip, available for assignment |
| `12a-stops.png` | Driver, STOPS 1 / 2 with route progress before delivery |
| `12b-manager-final.png` | Manager web after delivery: driver and truck AVAILABLE again |
| `02b-trip-planner-gate.png` | Manager web, planner gate: typed addresses are not locations — Create draft trip disabled with the one reason; driver pick fills the paired truck |
| `10b-driver-profile.png` | Manager web, Driver profile drawer: facts, licence status, assigned truck + verification, current trip, masked documents, support/danger zone collapsed |
| `06d-navigation-no-gps-fix.png` | Driver, navigation with no GPS fix: 'Guidance paused - Waiting for a GPS fix', route still drawn, CAUTION context still shown (honest degraded state) |
| `13-diagnostics.png` | Manager web, Diagnostics: capability states (Weather and Terrain "Available via fallback" while Open-Meteo is rate limited), honest ML inventory |

Provider states in the captures are what the system showed at that moment (official alerts checked: NONE ON CORRIDOR from the NDMA SACHET feed; fleet traffic UNKNOWN until two trucks share a road); UNKNOWN states are honest, not defects. Re-capture with `node .runtime/rehearsal/evidence.mjs` against the hosted URLs after `bash .runtime/judge.sh reset`.

The 14 Sep evening re-capture wrote a navigation screen over `06-truck-verification.png`; the file did not match its row above. The truck-check capture from the same package was restored under that name and the navigation screen kept as `06d-navigation-no-gps-fix.png`, so every file now matches its description. The driver app has not changed since either capture (`0b49c84` and `5302d3e` touch `manager-web/` only), so both still show the current UI.
