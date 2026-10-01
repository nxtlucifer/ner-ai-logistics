# Company visit readiness — 1 Oct 2026, 3:00 PM IST

Status words: READY · PARTIAL · BLOCKED · NOT_APPLICABLE. Every READY below was observed today on the local demo stack
(`docs/COMPANY_DEMO_RUNTIME_PLAN.md`); nothing was deployed, pushed or migrated on hosted systems.

| Area | Status | Evidence (today) |
|---|---|---|
| Manager web | READY | Presentation build (production mode) on :4173; browser lane: 10 pages × Light/Dark at 1366×768, 0 console exceptions, 0 overflow, no DEV/demo UI — `.runtime/evidence/company-demo/browser/` |
| Driver APK | READY | 1.0.27 / versionCode 27, `rasta-driver-1.0.27-company-demo.apk`, SHA-256 442e8f23…be440ac (adds navigation status line, show/hide controls, driver breaks; replaces 1.0.24 5406200c…18ac74), debug signer (same as earlier builds); installed over 1.0.26 on OPPO CPH2691 (Android 16), session kept, package `…driver.preview.landemo`, label "RASTA AI LAN DEMO" |
| Manager login | READY | Region step → login, session restore after reload, sign-out (browser lane step 7) |
| Driver login | READY | Phone login on the device; force-close → reopen restores session; Sign Out revokes the session (DB: 1 logout + 3 rotated, 0 live) |
| Regional role | READY | regional@rasta.demo sees all-NER data |
| State role | READY | assam.sm sees the Guwahati→Shillong trip (list + direct link); wrong workspace refused generically |
| District role | READY | kamrup.dm (official SoI district Kamrup Metro) sees the trip; geometry-backed district |
| Trip creation | READY | Browser lane (address search) + phone trip TRP-CO-C400E; scope NER_INTERNAL |
| Routing | PARTIAL | Works (97–99 km, ~1 h 17 min) but uses the public OSRM demo server: non-commercial, 1 req/s, no SLA |
| Route evidence | READY | Terrain, landslide inventory (2007–2017, marked aged), rivers, official alerts, fleet traffic UNKNOWN, live landslide feed UNAVAILABLE — shown honestly |
| Approval | READY | REQUIRES_REVIEW → manager approval with written reason + "incomplete evidence is not SAFE" acknowledgement |
| Dispatch | READY | Browser lane + phone trip → ASSIGNED |
| Driver acceptance | READY | Phone: "New Trip Request" → Accept trip → Navigate |
| Navigation | READY | Phone: route + distance/time at planned pace, route check CAUTION, SOS/re-centre/overview controls |
| Location | READY | Phone real GPS (owner-approved for this test; 7 fixes deleted afterwards); browser lane simulated GPS → manager Fleet LIVE "reported 7 s ago" |
| Reroute / journey change | READY | Manager added a stop → phone "Journey updated by your manager" → Acknowledge → stop completed |
| Safety | READY | 112/108/1033 open the dialler chooser only (no call placed); Dark theme black/charcoal |
| Assistant | READY | Answers from trip evidence, states what is not included |
| Language | READY | Hindi switch and back; Hindi strings marked Draft |
| Offline | PARTIAL | USB link cut → "Offline" chip, trip stays ACTIVE, "Saved route — no connection"; reconnect clears it. No offline basemap tiles; turn-by-turn not cached across a restart |
| Delivery | READY | Phone: arrive → finish stop → complete trip → confirm → DELIVERED; honest "Trip complete… location sharing has stopped" |
| Close / reuse | READY | Manager Close → driver + truck AVAILABLE → same pair re-planned immediately (draft cancelled) |
| Rate limits | READY (local) | GCRA on auth/expensive/write/public classes; per-process unless MULTI_INSTANCE (single process today) |
| Security | PARTIAL | P0 = 0, P1 = 0 locally. Open P3s: driver-web memory-only session not revocable on reload (321 stale harness tokens for the demo driver from 26–28 Sep), driver refusal on manager console confirms password, MapTiler public key embedded for hillshade (client key, restrict per app) |
| Dark theme | READY | Phone and manager Dark are black/charcoal; green only for accents |
| Browser | READY | Browser lane 8/8 PASS |
| Full-screen map | READY | Driver Navigate and Manager Fleet; evidence `docs/PREDEPLOY_FULLSCREEN_ADDON.md` |
| Driver breaks | READY | 15/30 min with reason; manager inbox, Fleet ON BREAK pill + dashed marker, history with place, overdue alert; migration 0017 on the local demo DB; evidence `docs/NAV_BREAK_ADDON.md` |
| Credits UI | READY | No credit control on any photo; one "Legal & attributions" entry per app (driver More, manager account menu); map attribution kept on every map |
| Physical Android | READY (demo matrix) | 1.0.24 re-check (fullscreen in no-trip, ASSIGNED, ACCEPTED, ACTIVE, AT_PICKUP, offline, reconnect, journey change; credits; 0 crash records). Morning device run on 1.0.23: launch, login, session restore, profile, Light, Dark, trip, incoming, accept, Navigate, permission, GPS, route, start, pickup arrive/complete, journey change, Safety dialler, Assistant, language, offline, reconnect, arrival, two-step delivery, DELIVERED, Close, reuse, force-close/reopen, 0 crash records, no server secrets in APK |
| Demo reset | READY | `reset.py` idempotent (second run releases 0); all 3 demo drivers/trucks AVAILABLE; 0 open trips |
| Fallback environment | PARTIAL | Same stack with driver web on the laptop, or recorded screenshots; hosted pilot runs the older build only |

## Geography (new today)
Survey of India OVSF/1M/7 imported locally (India outline, 40 state features, 131 NER districts, 0 invalid, 0 repairs).
22/22 real-city tests pass: Guwahati/Shillong/Aizawl/Itanagar = NER; Kolkata/Delhi/Mumbai/Siliguri = India non-NER; Dhaka/Sylhet/Thimphu = outside India.

## Defer until after the visit
Hosted migration/deploy (needs authorisation + backup/PITR), self-hosted OSRM, satellite, 3D buildings, offline basemap,
revoking stale harness sessions, importer fixes (projected CRS, Z, unnamed disputed districts, SoI glyph decoding — done by
recorded preprocessing/SQL today), real-time load tests.
