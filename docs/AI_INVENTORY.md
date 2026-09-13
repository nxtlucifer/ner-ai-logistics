# Local AI / intelligence inventory (code-audited, 13 Sep 2026)

Source of truth: `backend/app/domain/intelligence_inventory.py`, served on `GET /api/system/providers` and shown on the manager System page. Searched: backend/, driver-app/, manager-web/, supabase/ for model loading, TensorFlow, PyTorch, ONNX, TFLite, scikit-learn, transformers, embeddings, LLM clients (Gemini, OpenRouter, Ollama), intent classifiers, rules/decision engines, risk scoring, computer vision, speech, translation, forecast/statistical models. Hits: none for any ML framework or model file; the only model clients are the Gemini/OpenRouter proxy (`services/gemini.py`), the Supabase `gemini-ai` edge function (same provider, not used by the Render build), and `services/inference.py` (an Ollama client that has never had a model installed).

```
TRUE_LOCAL_ML               = 0
LOCAL_LLM                   = 0
DETERMINISTIC_INTELLIGENCE  = 20
GEOMETRIC_ALGORITHM         = 5
STATISTICAL_MODEL           = 0
OFFLINE_KNOWLEDGE_SYSTEM    = 4
ONLINE_LLM                  = 2
PROVIDER_MODEL_OUTPUT       = 5
TOTAL_TRUE_LOCAL_AI         = 0   (trained local ML + local LLM + statistical models)
TOTAL_LOCAL_INTELLIGENCE    = 29   (deterministic + geometric + offline knowledge)
```

| Category | Module | What it is |
|---|---|---|
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/route_risk.py` | 11-factor route risk: points, bands, reason codes; UNKNOWN is not safe |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/route_eligibility.py` | landslide-inventory refusal rule |
| DETERMINISTIC_INTELLIGENCE | `backend/app/services/route_watch.py` | route-ahead worker: corridor window by speed, material-change detection -> push events |
| DETERMINISTIC_INTELLIGENCE | `backend/app/services/notify.py` | push dedupe: fingerprint + per-event cooldown |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/route_recommendation.py` | compare route options by evidence |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/reroute.py` | reroute governance: human authorises, never automatic |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/monsoon_risk.py` | monsoon-risk-engine-v1 weighted rule |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/road_memory.py` | evidence log; silence is not evidence |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/sentinel.py` | fleet sentinel: stationary/escalation rules |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/weather.py` | weather thresholds, freshness |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/flood.py` | discharge-vs-30-day-mean context bands |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/landslide.py` | historical exposure by distance to recorded events |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/warnings.py` | CAP alert parsing, expiry, corridor district match |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/traffic.py` | fleet traffic: median observed vs planned pace |
| DETERMINISTIC_INTELLIGENCE | `backend/app/domain/fuel_model.py` | physics-informed fuel baseline (hand-set constants) |
| DETERMINISTIC_INTELLIGENCE | `driver-app/src/navigation/routeAi.ts` | Personal Route AI: fixed policy + explanation over route_risk |
| DETERMINISTIC_INTELLIGENCE | `driver-app/src/assistant/intents.ts` | offline NLU: keyword intent matching, five languages |
| DETERMINISTIC_INTELLIGENCE | `driver-app/src/assistant/assistant.ts` | assistant answers from application state; health guidance |
| DETERMINISTIC_INTELLIGENCE | `driver-app/src/safety/breaks.ts` | break advice thresholds |
| DETERMINISTIC_INTELLIGENCE | `driver-app/src/notify/local.ts` | danger alert dedupe/cooldown |
| GEOMETRIC_ALGORITHM | `backend/app/domain/route_progress.py` | projection onto the route line, off-route threshold |
| GEOMETRIC_ALGORITHM | `backend/app/domain/terrain.py` | slope/gradient from sampled DEM heights |
| GEOMETRIC_ALGORITHM | `driver-app/src/map/navState.ts` | on-device projection with hysteresis (200/80 m, 3 fixes) |
| GEOMETRIC_ALGORITHM | `driver-app/src/map/maneuvers.ts` | next-turn selection from OSRM steps |
| GEOMETRIC_ALGORITHM | `driver-app/src/tracking/speed.ts` | stationary-speed filter: accuracy-aware displacement + hysteresis |
| OFFLINE_KNOWLEDGE_SYSTEM | `driver-app/src/phrasebook` | roadside phrasebook (bundled) |
| OFFLINE_KNOWLEDGE_SYSTEM | `driver-app/src/safety/guide.json` | reviewed safety guide en/hi/as |
| OFFLINE_KNOWLEDGE_SYSTEM | `driver-app/src/i18n/reasonCodes.json` | reason-code catalogue en/hi/as |
| OFFLINE_KNOWLEDGE_SYSTEM | `backend/app/services/places/snapshot.py` | OSM corridor snapshot of roadside services |
| ONLINE_LLM | `backend/app/services/gemini.py` | Gemini Developer API (primary) - wording only |
| ONLINE_LLM | `backend/app/services/gemini.py` | OpenRouter free models (fallback) - wording only |
| PROVIDER_MODEL_OUTPUT | `backend/app/services/weather/open_meteo.py` | Open-Meteo current/hourly (ECMWF/GFS/ICON blend) |
| PROVIDER_MODEL_OUTPUT | `backend/app/services/weather/open_meteo.py` | MET Norway locationforecast (fallback) |
| PROVIDER_MODEL_OUTPUT | `backend/app/services/flood.py` | GloFAS river discharge via Open-Meteo flood API |
| PROVIDER_MODEL_OUTPUT | `backend/app/services/terrain.py` | Copernicus DEM (Open-Meteo elevation) / SRTM (OpenTopoData) |
| PROVIDER_MODEL_OUTPUT | `backend/app/services/routing/osrm.py` | OSRM routing engine |

Not counted: device speech recognition/TTS (the phone's engine), `services/inference.py` (no model ever installed), `supabase/functions/gemini-ai` (same online provider, alternative transport).

Honest phrasing for judges: *evidence-based decision support with deterministic rules; online language models word the answers and never decide.*
