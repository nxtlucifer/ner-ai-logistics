# Model registry

Every experimental hazard model, with its data, splits, metrics and status.
Status meanings: **EXPERIMENTAL** may appear in research/admin views and controls
nothing; **VALIDATED** may become one evidence input under the deterministic
policy; **REJECTED** is kept for the record. Nothing here is deployed unless its
row says VALIDATED, and today none does.

| Model | Version | Status | Training data | Features | Train | Validate | Where |
|---|---|---|---|---|---|---|---|
| landslide-day-logreg | 0.1 (13 Sep 2026) | **EXPERIMENTAL — not deployed** (held-out: temporal ROC-AUC 0.79, recall 0.70 @ FPR 0.19; geographic ROC-AUC 0.82, recall 0.69 @ FPR 0.21; rule baseline recall 0.30/0.23; calibration poor across regions) | NASA GLC NER slice (≤5 km accuracy) + ERA5-Land daily rain (Open-Meteo archive) + Copernicus DEM slope proxy; negatives = quiet days at the same sites | p1, p3, p7, p15, p30, max7, elevation, slope, month (sin/cos); lead-1 variant drops event-day rain | 2007–2014 (temporal) / lon < 93.5 E (geographic) | 2015–2017 / lon ≥ 93.5 E | `backend/scripts/hazard_validation/` → `docs/HAZARD_VALIDATION.md` |
| production rain rule (baseline) | route_risk RAIN_* thresholds (2.5 / 7.5 mm h⁻¹) | in production (deterministic, not a model) | — | hourly precipitation at corridor points | — | evaluated as the daily analogue (64.5 mm/day or 100 mm/3 d) in the same tables | `backend/app/domain/route_risk.py` |

Gate for VALIDATED: held-out set, no leakage, temporal AND geographic splits,
hazard-specific metrics with false-negative review, meaningful sample, and the
result must beat the baseline materially. Flood and weather hazard models:
none trained — flood evidence is GloFAS (provider model output) and weather is
Open-Meteo/MET Norway (provider model output); no ground-truth labels for
"road flooded/closed" exist in any source surveyed (see `docs/ROAD_MEMORY.md`).
