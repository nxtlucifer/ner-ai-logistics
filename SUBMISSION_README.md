# RASTA AI — SIH26002 submission (NER-AI LOGISTICS)

**PROJECT NAME.** RASTA AI — route intelligence for essential-supply trucking in the North Eastern Region. Team NER-AI LOGISTICS, problem statement SIH26002 (*AI-Based Smart Logistics and Accessibility Intelligence Platform for North Eastern Region*, theme Smart Automation, category Software — confirm against the portal notice; the Team ID is not in this repository).

**PROBLEM STATEMENT.** Hill corridors in the NER close without notice: monsoon rain, landslides, floods, official warnings, single-lane roads and no phone signal. A shortest-path router still sends the truck. Fleet managers need to know whether a corridor is *operationally usable now*, and drivers need that answer on a cheap Android phone, in their own language, with or without network.

**CORE SOLUTION.** RASTA AI does not only find the shortest road. It decides whether an essential-supply corridor is usable now, from verified evidence (terrain, weather forecast, official warnings, flood context, historical landslide exposure, fleet traffic estimate) under a deterministic safety policy where UNKNOWN is never treated as SAFE. Managers review the evidence and dispatch; drivers verify the truck, navigate, get danger context, and every reroute is human-approved.

## ARCHITECTURE
One FastAPI backend (PostgreSQL 17 + PostGIS on Supabase, Alembic migrations to `0012`), two clients on the same REST API: the Manager web console (React + TypeScript + Vite) and the Driver app (React Native + Expo; Android APK, also exported to web). Provider adapters with health and freshness sit behind the backend (`GET /api/system/providers`). Deterministic domain code makes every decision; online LLMs only phrase answers. Details: `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`, `docs/DATA_MODEL.md`.

## KEY FEATURES
- Route generation with alternatives and turn steps (OSRM), 11-factor route risk (distance, duration, weather, landslide, flood, road quality, truck restrictions, historical incidents, elevation, fuel model, official warnings) → bands, reason codes and a decision CONTINUE / CAUTION / HOLD / REROUTE; missing evidence is shown as UNKNOWN.
- Manager: trip → route review → conditions (terrain, weather, historical landslide exposure, official warnings, flood context, traffic estimate, evidence freshness) → reviewer authorisation → dispatch → reroute review. Manager-only console ("Manager account required." for any other role).
- Driver: one login, server-decided role (driver shell or a mobile manager shell), assignment, truck photo verification, start, navigation with real GPS, off-route detection, reroute proposal awaiting the manager, danger cards, stops, delivery, emergency panel, whole-trip offline package with an honest OFFLINE state.
- 23-language selector (verified translations for Hindi, Gujarati, Assamese, Bengali; core phrases in nine more; the rest fall back to English, marked as such), RTL for Urdu / Sindhi / Kashmiri, local deterministic assistant (16 intents) plus a Gemini online assistant that answers in the app language.
- Route-ahead worker (60 s tick) and backend push relay with dedupe; in-app alerts work today, background Android push needs Firebase config (see limits).
- Demo simulation scenarios (heavy rain, landslide warning ahead, flood, road incident, provider failure), always labelled `DEMO_SIMULATION_ACTIVE`.

## TECH STACK
Python 3.11, FastAPI, SQLAlchemy (async), Alembic, PostgreSQL 17 + PostGIS 3.3 (Supabase); React 18, TypeScript, Vite, Tailwind; React Native, Expo, MapTiler tiles; providers OSRM, Open-Meteo, MET Norway, NDMA SACHET (CAP), GloFAS, OpenTopoData, Nominatim, Overpass / OSM, NASA Global Landslide Catalog; Google Gemini (`gemini-flash-lite-latest`) with an OpenRouter fallback path; hosting on Render (backend + two static sites).

## AI REALITY (audited, `docs/AI_INVENTORY.md`)
TRUE_LOCAL_ML = 0 · LOCAL_LLM = 0 · TRUE_LOCAL_ML_EXPERIMENTAL = 1 · DETERMINISTIC_INTELLIGENCE = 20 · GEOMETRIC_ALGORITHM = 5 · OFFLINE_KNOWLEDGE_SYSTEM = 4 · ONLINE_LLM = 2 · PROVIDER_MODEL_OUTPUT = 5 · TOTAL_LOCAL_INTELLIGENCE = 29.
The landslide-hazard model (logistic regression on NASA GLC events + ERA5-Land rain + DEM slope, India-wide training, NER held out) is EXPERIMENTAL and controls nothing: on the NER holdout it reaches recall 0.95 at a false-positive rate of 0.50 (precision 0.32, PR-AUC 0.55, ROC-AUC 0.83, Brier 0.12). No "98 %" claim exists anywhere in the product. Registry: `docs/MODEL_REGISTRY.md`, `docs/HAZARD_ERROR_ANALYSIS.md`.

## DATA SOURCES
OSRM (routing), Open-Meteo and MET Norway (weather forecast), NDMA SACHET CAP feed (official warnings, polled), GloFAS (flood context), OpenTopoData / Copernicus DEM (terrain), NASA Global Landslide Catalog 2007–2017 (historical landslide exposure, static, `backend/data/landslides/PROVENANCE.md`), OpenStreetMap via Nominatim / Overpass (places, road attributes), the fleet's own GPS fixes (traffic estimate — never Google traffic).

## HOW TO RUN
Hosted (no laptop needed): open the Manager URL below and sign in with a manager account; install the APK on an Android phone and sign in with a driver account. Local: `docs/DEMO.md` (backend `uvicorn app.main:app`, `manager-web` `npm run dev`, `driver-app` `npx expo start`). Tests: backend `pytest` (1138 passed / 5 skipped), driver `npm test` (621), manager `npm test` (170), both `tsc`. Demo accounts are handed over separately, never committed.

## HOSTED URL
| | |
| --- | --- |
| Manager console | https://ner-manager.onrender.com |
| Backend health / readiness | https://ner-intelligence.onrender.com/health · https://ner-intelligence.onrender.com/ready |
| Driver web (QA only; the phone APK is the product) | https://ner-driver-web.onrender.com |
| Repository | https://github.com/nxtlucifer/ner-ai-logistics |

## APK
`release/RASTA-AI-1.0.18.apk` — versionName 1.0.18, versionCode 18, package `com.nxtlucifer.nerlogistics.driver.preview`, built 14 Sep 2026 against the hosted backend, SHA256 `5d374766c626dcf79c80e03162950c32e0d0fa1e1d904578197a22ed59c25cab` (`release/README.md`). Certified on a physical phone on 14 Sep 2026.

## DEMO FLOW (Guwahati → Shillong, one canonical judge trip)
Before the slot: **T-10 min** open `/health` (Render free tier sleeps; the first call takes up to a minute) · **T-5 min** `bash .runtime/judge.sh check` → `RESULT READY` (team laptop) · **T-2 min** open the Manager and sign in; keep both tabs open.
1. Manager login → Trips → the `JUDGE-xxxxxx` trip (DRAFT, route selected).
2. Review route (real OSRM road, 98.8 km) → Check conditions: terrain, weather forecast, historical landslide exposure, official warnings, flood context, traffic estimate, evidence freshness, UNKNOWN factors named.
3. Route decision and band → Dispatch.
4. Phone: trip arrives within ten seconds → Accept → Check the truck (camera photo + plate) → Start → Navigate (GPS live, danger context, Route AI evidence, assistant, language, emergency).
5. Drive off the corridor → reroute proposal "awaits manager" → Manager reviews and accepts → phone follows the new road.
6. Stops → Complete trip → Manager shows DELIVERED; driver and truck AVAILABLE again.

Recovery for anything (cold start, phone call, phone lock, dirty trip state, sign-out): `bash .runtime/judge.sh reset` then `bash .runtime/judge.sh check`; never edit the database by hand. GPS or weather unavailable → the app says UNKNOWN / OFFLINE, which is the honest state to show. Optional backup: the offline navigation screen (rehearsed, never forced live).

## KNOWN LIMITS
- Render free tier cold start (first request up to ~60 s; the app shows "No connection" and a retry) — warm it before the slot.
- Background push on Android needs a Firebase `google-services.json` in the build; in-app alerts and the backend relay work. OpenRouter fallback needs `OPENROUTER_API_KEY` on the host; Gemini is live.
- Landslide model is research only; no live landslide detection, no prediction claims. NASA GLC is a static 2007–2017 inventory.
- Traffic is a fleet estimate from RASTA trucks (UNKNOWN until two trucks share a road), not live traffic.
- Nine of the 23 languages render English with a visible fallback mark; no Aadhaar, OCR or government-verification workflows.
