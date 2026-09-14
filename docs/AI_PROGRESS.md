# AI progression dashboard

Status words: IMPLEMENTED (live, tested, evidence on hand) · PARTIAL · EXPERIMENTAL (research only, controls nothing) · BLOCKED (needs a credential or a source that does not exist yet) · NOT_IMPLEMENTED.
Updated 14 Sep 2026 (morning). Every row names its evidence; nothing here is a claim without one.

| Category | Item | Status | Evidence |
|---|---|---|---|
| ROUTE INTELLIGENCE | 11-factor deterministic route risk, CONTINUE/CAUTION/HOLD/REROUTE decision, UNKNOWN ≠ SAFE | IMPLEMENTED | `backend/app/domain/route_risk.py`, `reroute.py`; backend suite 1138 passed |
| ROUTE INTELLIGENCE | Route-ahead worker (60 s tick, 30–100 km window by speed, material-change → push) | IMPLEMENTED | `services/route_watch.py`; local log "route watch: … ROUTE_DANGER_AHEAD"; `tests/test_route_watch.py` |
| ROUTE INTELLIGENCE | Verified news / incident evidence layer | NOT_IMPLEMENTED | no licensable machine-readable news source verified; NDMA CAP is the official input (`services/warnings.py`) |
| ROUTE INTELLIGENCE | No-signal zone prediction + extended prefetch | NOT_IMPLEMENTED | whole-trip offline package exists (`services/offline_package.py`); no coverage data source |
| LOCAL ASSISTANT | Deterministic intent engine, 16 intents, aliases in 14 scripts + romanised Hindi | IMPLEMENTED | `driver-app/src/assistant/intents.ts`, `intents.test.ts`; phone: Hindi health card (13 Sep) |
| LOCAL ASSISTANT | Answers in all 23 app languages | PARTIAL | full drafts hi/gu/as/bn; core keys ta/te/kn/ml/mr/pa/or/ur/ne; 9 languages render English (`i18n/appLanguage.ts` status per row) |
| ONLINE AI | Gemini (`gemini-flash-lite-latest`) answer in the app language, one retry | IMPLEMENTED | remote: Hindi answer 1.5 s, provider GOOGLE_GEMINI (`demo.py` smoke 14 Sep) |
| ONLINE AI | OpenRouter fallback | BLOCKED (hosted) | code + `tests/test_gemini_ai.py` failover test; verified locally; Render has no `OPENROUTER_API_KEY` |
| ONLINE AI | Failover Gemini → OpenRouter → local library; LLM never decides | IMPLEMENTED | `services/gemini.py`; `ai_prompts.in_language` for 23 scripts |
| AUTO DATA | Open-Meteo, MET Norway, NDMA SACHET (poll), GloFAS, OSRM, OpenTopoData, Nominatim, Overpass with health + freshness | IMPLEMENTED | `GET /api/system/providers`; judge check "NDMA FRESH · GLOFAS FRESH · OSRM FRESH" |
| AUTO DATA | NASA Global Landslide Catalog (static inventory 2007–17) | IMPLEMENTED (static) | `services/landslide/history.py`, `backend/data/landslides/PROVENANCE.md` |
| AUTO DATA | IMD, GSI Bhukosh, USGS, FIRMS, LHASA | NOT_IMPLEMENTED | Bhukosh portal refused connections on 14 Sep and publishes no API; FIRMS/LHASA need Earthdata keys; documented FUTURE/MANUAL |
| HAZARD MODELS | Landslide-day model (logistic regression, NER slice) | EXPERIMENTAL | `docs/MODEL_REGISTRY.md` v0.2: temporal recall 0.85 @ FPR 0.35, geographic recall 0.95 @ FPR 0.57; not deployed |
| HAZARD MODELS | V2: season-matched negatives + NASA LHASA susceptibility + SoilGrids texture | EXPERIMENTAL (confound found) | `experiments_v2.py` 14 Sep: with season-matched negatives ROC-AUC falls to ~0.69 (PR 0.49 temporal) — earlier skill was mostly monsoon-vs-dry; susceptibility adds ≈0. Registry v0.3-research |
| HAZARD MODELS | India-wide dataset (605 GLC events ≤5 km, 3,025 rows) with the NER as geographic holdout | EXPERIMENTAL (REJECTED for production) | landed 14 Sep 10:53 IST; calibrated logreg on the NER holdout (n=770, 154 events): recall 0.95, FPR 0.50, precision 0.32, PR-AUC 0.55, ROC 0.83, Brier 0.12 — generalizes, but FPR too high; season-matched negatives: recall 0.93 @ FPR 0.72. Registry v0.4-research |
| HAZARD MODELS | Error analysis of the India→NER model (FP vs TP, threshold sweep, operating-point policy) | DONE (research) | `docs/HAZARD_ERROR_ANALYSIS.md`: site features identical between TP and FP by construction (same-site negatives); FPs = wet monsoon days; recall ≥ 0.85 with FPR < 0.30 not reachable on daily ERA5 (best 0.86 @ 0.30 descriptively; leak-free policy 0.92 @ 0.39). Next data: sub-daily intensity, soil moisture, cross-site negatives |
| HAZARD MODELS | Weather-hazard model, flood model | BLOCKED (no ground truth) | provider outputs + deterministic components only |
| HAZARD MODELS | 98% validated prediction | NOT_ACHIEVED | best held-out accuracy 0.72 temporal; recall-first thresholds by design |
| ALERTING | In-app danger cards, hold/reroute banners | IMPLEMENTED | driver web sweep 60/60; phone 13 Sep |
| ALERTING | Backend push (Expo relay, dedupe, audit rows), dispatch/reroute/route-ahead hooks | IMPLEMENTED (backend) | `services/notify.py`, `tests/test_notify.py`; hosted DB migration 0012 |
| ALERTING | Background Android delivery | BLOCKED | APK has no `google-services.json` (FCM); `notify/push.ts` reports UNAVAILABLE honestly |
| SIMULATION | DEMO SIMULATION scenarios (5), labelled `DEMO_SIMULATION_ACTIVE`, selected road only | IMPLEMENTED | `services/simulation.py`, `tests/test_simulation.py`; live: band HIGH/100 then cleared |
| SIMULATION | All-night virtual truck, 8 stress cases per run | IMPLEMENTED | `.runtime/evidence/sim-overnight-summary.json`: 4 runs, 347 decisions (CAUTION 229 / HOLD 118), provider failure kept UNKNOWN; reroute recovery not exercised (fixed for the next run) |
| AUTH / ROLE | Manager console refuses drivers; one mobile login, server role → shell | IMPLEMENTED | `role_probe.mjs` 13/13 (14 Sep); `AuthProvider.test.tsx` both apps |

## Counts (re-audited)
TRUE_LOCAL_ML = 0 · LOCAL_LLM = 0 · DETERMINISTIC_INTELLIGENCE = 20 · GEOMETRIC = 5 · STATISTICAL = 0 · OFFLINE_KNOWLEDGE = 4 · ONLINE_LLM = 2 · PROVIDER_MODEL_OUTPUT = 5 · **TOTAL_LOCAL_INTELLIGENCE = 29** (`app/domain/intelligence_inventory.py`).
