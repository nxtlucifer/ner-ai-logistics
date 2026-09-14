# PPT source of truth — RASTA AI (SIH26002)

Verified facts only, each with where it was verified. Anything not on this page does not go on a slide. Wording rules: say *historical landslide exposure*, *experimental landslide model*, *official warning*, *weather forecast*, *flood context*, *fleet traffic estimate*, *route decision*, *evidence coverage*, *suggested stop*, *UNKNOWN*. Never say "98 % disaster prediction", "AI detected landslide", "guaranteed safe route", "Google-level traffic", "live landslide detection" (claim audit of both clients, 14 Sep 2026: none of these strings exist in the product; the login motto is "Safe Routes. Stronger India.").

## 1. Problem
- NER essential-supply corridors close without notice: monsoon rain, landslides, floods, official warnings, single-lane hill roads, no phone signal. A shortest-path router still sends the truck.
- The fleet manager cannot see whether the corridor is *usable now*; the driver has no evidence, no language support and no offline fallback.

## 2. Solution
- RASTA AI does not only find the shortest road. It determines whether an essential-supply corridor is operationally usable now.
- Verified evidence (terrain, weather forecast, official warnings, flood context, historical landslide exposure, fleet traffic estimate) → deterministic safety policy → route decision CONTINUE / CAUTION / HOLD / REROUTE; UNKNOWN is never SAFE (`backend/app/domain/route_risk.py`).
- Manager reviews and dispatches; driver verifies the truck, navigates with real GPS, gets danger context in 23 languages; every reroute is human-approved (`backend/app/domain/reroute.py`).

## 3. Why Northeast logistics is difficult
- Demo corridor Guwahati depot → Shillong: 98.8 km of real OSRM road (judge check 14 Sep) climbing from the Brahmaputra plain to the Shillong plateau; terrain, weather and landslide history differ along one trip.
- NASA Global Landslide Catalog: the NER holdout alone has 154 catalogued events (≤5 km location accuracy) across 2007–2017 (`docs/MODEL_REGISTRY.md` v0.4).
- Official warnings arrive as CAP items on the NDMA SACHET feed, weather as provider forecasts, floods as GloFAS model output: different cadences, different freshness, none of them a road-level truth. The product shows evidence coverage instead of pretending.

## 4. Architecture
- One FastAPI backend (Python 3.11, SQLAlchemy async, Alembic to migration `0012`), PostgreSQL 17.6 + PostGIS 3.3 on Supabase (`/ready` 14 Sep).
- Two clients on one REST API: Manager web (React 18 + TypeScript + Vite + Tailwind, hosted static) and Driver app (React Native + Expo; Android APK 1.0.18; web export for QA).
- Provider adapters with health + freshness: `GET /api/system/providers` (NDMA_SACHET, GLOFAS, NASA_GLC static, OSRM, OPENTOPODATA … all HEALTHY/FRESH on the 14 Sep check).
- Hosting: Render (backend `ner-intelligence`, static sites `ner-manager`, `ner-driver-web`), `render.yaml`.
- Diagram source: `docs/ARCHITECTURE.md` §2 (mermaid).

## 5. Manager workflow
- Login (manager accounts only; a driver account is refused with "Manager account required.", `manager-web/src/auth/AuthProvider.tsx`, tested).
- Trips → JUDGE trip (DRAFT, route selected) → Review route → Check conditions (terrain summary, weather forecast, historical landslide exposure, official warnings, flood context, traffic estimate, evidence freshness, UNKNOWN factors named) → route decision + band → reviewer authorisation when hazard data is UNKNOWN (`select without authorisation 422` → `reviewer authorisation 201 HAZARD_DATA_UNKNOWN` → `select 200`, reset log 14 Sep) → Dispatch → reroute review → DELIVERED.
- Fleet, Drivers (portrait), Trucks (reference photo), Assignments (driver verification photo), View-as-Driver support view (read-only, `driver:support_view`).

## 6. Driver workflow
- One login screen, role decided by the server (`GET /api/auth/me`); driver shell tabs Trip / Navigate / Safety / More, manager accounts get a mobile manager shell (Overview / Trips / Map / Fleet / More). Physical certification 14 Sep: 9/9 steps (`docs/terrain/HANDOFF.md` §7).
- Trip arrives within ten seconds of dispatch → Accept → Check the truck (camera photo + registration, private files API) → Start (GPS live) → Navigate (turn steps, `GPS · ±15 m`) → danger card → off-route detected from real GPS → reroute proposal "awaits manager" → new road followed → stops (`1 / 2`) → Complete trip → DELIVERED; driver and truck AVAILABLE again.
- Safety: emergency panel (dialler intercept evidence in `docs/submission/evidence/24-emergency-dialler-intercepted.png`), suggested stops, offline package.

## 7. Route intelligence
- 11 factors: distance, duration, weather, landslide, flood, road quality, truck restrictions, historical incidents, elevation, fuel model, official warnings (`route_risk.py` FACTOR_* constants).
- Output: points, band, reason codes (translated in the driver app), decision; reviewer authorisation required to select a route whose hazard data is UNKNOWN.
- Route-ahead worker: 60 s tick, 30–100 km window by speed, material change → alert event (`services/route_watch.py`, tested).
- Fleet traffic estimate from RASTA trucks' own GPS fixes; "N % of the road graded from M RASTA trucks"; UNKNOWN until two trucks share a road (`backend/app/domain/traffic.py`: "NOT Google live traffic").
- Demo simulation scenarios (HEAVY_MONSOON_RAIN, LANDSLIDE_WARNING_AHEAD, FLOOD_HIGH_DISCHARGE, ROAD_INCIDENT, PROVIDER_FAILURE) on the selected road only, always labelled `DEMO_SIMULATION_ACTIVE`.

## 8. Offline / degraded operation
- Whole-trip offline package (`backend/app/services/offline_package.py`): route, risk summary, terrain, evidence, emergency numbers, stops cached on the phone; navigation continues with an honest OFFLINE label, reconnect resumes (`.runtime/evidence/19-offline-navigation.png`, `20-reconnected.png`).
- Provider failure keeps factors UNKNOWN (never SAFE): all-night virtual-truck runs, 347 decisions, provider-failure case held UNKNOWN (`.runtime/evidence/sim-overnight-summary.json`).
- Render cold start shows "No connection" with a retry; warm `/health` before the slot.

## 9. AI architecture
- Audited inventory (`docs/AI_INVENTORY.md`, `backend/app/domain/intelligence_inventory.py`): TRUE_LOCAL_ML 0 · LOCAL_LLM 0 · TRUE_LOCAL_ML_EXPERIMENTAL 1 · DETERMINISTIC_INTELLIGENCE 20 · GEOMETRIC_ALGORITHM 5 · OFFLINE_KNOWLEDGE_SYSTEM 4 · ONLINE_LLM 2 · PROVIDER_MODEL_OUTPUT 5 · TOTAL_LOCAL_INTELLIGENCE 29.
- Online AI: Google Gemini (`gemini-flash-lite-latest`) answers driver questions in the app language (Hindi answer in 1.5 s on the hosted API, 14 Sep); failover Gemini → OpenRouter → local library; the LLM never decides physical safety (`services/gemini.py`, `ai_prompts.py`).
- Local assistant: deterministic intent engine, 16 intents, aliases in 14 scripts and romanised Hindi (`driver-app/src/assistant/intents.ts`).
- Languages: 23 in the selector (status VERIFIED / DRAFT / FALLBACK_ENGLISH per language, RTL for ur / sd / ks), search by name, native name or code.

## 10. Natural disaster research (EXPERIMENTAL, never deployed)
- Dataset: NASA GLC events ≤5 km accuracy, India-wide 605 events / 3,025 rows; ERA5-Land daily rain (Open-Meteo archive), Copernicus DEM slope; negatives = quiet days at the same sites (season-matched variant also built).
- Splits: temporal (train ≤2014, test 2015–17) and geographic (train all-India minus NER, test NER n=770, 154 events; no NER row in training).
- Best held-out result (calibrated logistic regression, threshold chosen on train out-of-fold only): NER recall 0.95, FPR 0.50, precision 0.32, F1 0.48, PR-AUC 0.55, ROC-AUC 0.83, Brier 0.12; rule baseline recall 0.25 @ FPR 0.03. Season-matched negatives: recall 0.93 @ FPR 0.72 (ROC 0.72) — most apparent skill is monsoon-vs-dry.
- Error analysis: site features are identical between true and false positives by construction; false positives are wet monsoon days; recall ≥ 0.85 with FPR < 0.30 is not reachable on daily rain. Next data: sub-daily intensity, soil moisture, cross-site negatives (`docs/HAZARD_ERROR_ANALYSIS.md`).
- Decision: EXPERIMENTAL, REJECTED for production on FPR; 98 % not reached on any held-out split (best accuracy 0.72 temporal). Judge answer: "We have an experimental locally trained landslide-hazard model, but it is not allowed to control routing because held-out testing still produces too many false positives. The production system therefore combines verified current evidence, official warnings, terrain, weather and historical exposure with deterministic safety policy."

## 11. Technology stack
Python 3.11 · FastAPI · SQLAlchemy async · Alembic · PostgreSQL 17 + PostGIS 3.3 (Supabase) · React 18 · TypeScript · Vite · Tailwind · React Native · Expo · MapTiler tiles · OSRM · Open-Meteo · MET Norway · NDMA SACHET CAP · GloFAS · OpenTopoData · Nominatim / Overpass · NASA GLC · Google Gemini (OpenRouter fallback path) · Render hosting · pytest / Jest / Vitest · scikit-learn (research venv only).

## 12. Innovation
- Corridor usability decision instead of shortest path: 11-factor evidence engine with UNKNOWN ≠ SAFE and reviewer authorisation for missing hazard data.
- Human-governed reroute: the driver's real off-route triggers a real OSRM alternative; a manager accepts before the phone follows it.
- Evidence classes kept separate (forecast, official warning, historical inventory, provider model output, fleet observation) with freshness on screen — no merged "risk %" invented.
- One APK, server-decided role; 23-language driver UX with deterministic local assistant plus online LLM phrasing.
- Honest AI accounting published in the repo (inventory, model registry, error analysis).

## 13. Real validation
- Backend 1138 passed / 5 skipped; driver app 621 tests; manager web 170 tests; TypeScript strict on both; Expo export and manager production build (14 Sep 2026, commit `0b89ddf`).
- Physical phone (OPPO, APK 1.0.18): driver login, manager login, driver→manager and manager→driver switches, no role data leak (manager APIs 403 for a driver token) — 9/9; judge flow on the hosted API: dispatch, accept, truck photo verify, start, navigate `GPS · ±15 m`, real off-route → reroute, manager accept, new road, stops, deliver, final state (`.runtime/evidence/phone-certify.json`, `phone-e2e-certify*.log`; final run log `final-demo-run.log`).
- Hosted judge check 14 Sep: backend /health + /ready OK, manager index 200, OSRM / Open-Meteo / NDMA reachable, providers FRESH, exactly one JUDGE trip at DRAFT, route risk answers in 2.8 s, driver and truck AVAILABLE → RESULT READY.
- Role probe 13/13 (local and hosted); browser judge flow 25 screenshots (`.runtime/evidence/01…25`).

## 14. Known limitations
- Render free tier cold start (~60 s first request). Background Android push needs Firebase config (BLOCKED); in-app alerts work. OpenRouter needs a hosted key (BLOCKED); Gemini live.
- Landslide model experimental; NASA GLC static 2007–17; no live landslide detection; NDMA feed occasionally rate-limited (shown as freshness).
- Traffic = fleet estimate only. Nine languages fall back to English (marked). No Aadhaar / OCR / government verification.
- Truck verification records the photo and the reported registration (a mismatch is flagged for the manager, never blocks the driver); no image-content check.

## 15. Future scope
- Firebase push, OpenRouter key, IMD / GSI Bhukosh / NASA FIRMS / LHASA adapters when machine-readable sources and licences exist (documented FUTURE / MANUAL in `docs/AI_PROGRESS.md`).
- Landslide research with sub-daily rain intensity (ERA5 hourly, IMERG), soil moisture, cross-site negatives; a model enters routing only after the VALIDATED gate in `docs/MODEL_REGISTRY.md`.
- Coverage-based no-signal prefetch once a signal-coverage dataset exists; verified incident feed when a licensable source exists.

## 16. Demo sequence (Guwahati → Shillong)
T-10 min `/health` · T-5 min `bash .runtime/judge.sh check` → READY · T-2 min Manager open and signed in.
Manager login → open JUDGE trip → show real route → show route intelligence (terrain / weather / landslide exposure / warnings / flood / traffic / freshness) → route decision → Dispatch → phone receives → Accept → truck photo verify → Start → Navigation → Route AI / evidence → off-route → reroute proposal → Manager approves → driver follows new road → stops → delivery → driver / truck AVAILABLE.
Recovery: `bash .runtime/judge.sh reset` then `check`; cold start → wait for /health; phone call / lock → resume the app, state is server-side; GPS or weather unavailable → UNKNOWN / OFFLINE is the honest screen; driver sign-out → sign in again, the trip is still assigned. Optional backup: offline navigation screen (rehearsed, never forced live).
Screenshot package: `docs/submission/screenshots/` (01 manager overview … 12 delivery).
