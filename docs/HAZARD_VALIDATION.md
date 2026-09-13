# Hazard validation — landslide (rain + terrain + season)

Generated 2026-09-13T16:18:16.486722Z by `backend/scripts/hazard_validation/evaluate_landslide.py`. Raw numbers: `.runtime/evidence/hazard-validation.json`.

**Claim boundary.** These are held-out results for one narrow question — *given the rain ERA5-Land recorded at a catalogued site, would a landslide be reported there that day?* — on a news-derived inventory. They are NOT a claim that RASTA predicts landslides in operation, and no number below reaches the app: the deterministic route-risk rule stays the only authority. Model status: **EXPERIMENTAL** (see `docs/MODEL_REGISTRY.md`).

## Dataset

- Events: NASA Global Landslide Catalog, NER slice, 241 of 471 events with location accuracy exact/1 km/5 km and a date (2007–2017), 240 sites.
- Non-events: 964 quiet days at the same sites (no catalogued event within 25.0 km and ±10 days, any accuracy). Rows used after dropping incomplete features: 1205.
- Rain: ERA5-Land via Open-Meteo historical archive, daily precipitation_sum, Asia/Kolkata days. Terrain: Open-Meteo elevation (Copernicus DEM GLO-90), slope proxy from four samples ~250 m around the site.
- Known label noise: the catalogue is compiled from news reports, so an unreported slide on a 'quiet' day is a false negative in the LABELS, and event dates can be the report date rather than the failure date. Sample size is small for a 98% claim.

## Results (validation split only; nothing tuned on it)

### TEMPORAL — train 2007-2014, validate 2015-2017

**Same-day rain (lead 0 d)** — train 101 events / 704 non-events; validate 140 / 260

| Model | Acc | Prec | Recall | Spec | F1 | FNR | FPR | ROC-AUC | PR-AUC | Brier | TP/FP/FN/TN |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Rule (≥64.5 mm/day or ≥100 mm/3 d) | 0.738 | 0.857 | 0.300 | 0.973 | 0.444 | 0.700 | 0.027 | 0.6365 | 0.44 | 0.263 | 42/7/98/253 |
| LogReg @0.5 | 0.770 | 0.662 | 0.700 | 0.808 | 0.681 | 0.300 | 0.192 | 0.7859 | 0.7197 | 0.173 | 98/50/42/210 |
| LogReg recall-first @0.4 | 0.693 | 0.544 | 0.750 | 0.661 | 0.631 | 0.250 | 0.339 | 0.7859 | 0.7197 | 0.173 | 105/88/35/172 |

Calibration (LogReg): 0.0-0.2: pred 0.114 vs obs 0.148 (n=135), 0.2-0.4: pred 0.293 vs obs 0.208 (n=72), 0.4-0.6: pred 0.489 vs obs 0.304 (n=79), 0.6-0.8: pred 0.697 vs obs 0.567 (n=60), 0.8-1.0: pred 0.911 vs obs 0.87 (n=54)

False negatives at the recall-first point: 35 — DRY_IN_ERA5 (date or location uncertainty, or sub-grid rain): 3, NON_RAIN_TRIGGER: 16, MODEL_ERROR: 14, FLAT_SITE (location accuracy coarser than the DEM): 2

**Rain up to the day before (lead 1 d)** — train 101 events / 704 non-events; validate 140 / 260

| Model | Acc | Prec | Recall | Spec | F1 | FNR | FPR | ROC-AUC | PR-AUC | Brier | TP/FP/FN/TN |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Rule (≥100 mm/3 d to yesterday) | 0.715 | 0.750 | 0.279 | 0.950 | 0.406 | 0.721 | 0.050 | 0.6143 | 0.3899 | 0.285 | 39/13/101/247 |
| LogReg @0.5 | 0.748 | 0.615 | 0.743 | 0.750 | 0.673 | 0.257 | 0.250 | 0.7939 | 0.7216 | 0.176 | 104/65/36/195 |
| LogReg recall-first @0.48 | 0.748 | 0.611 | 0.764 | 0.739 | 0.679 | 0.236 | 0.262 | 0.7939 | 0.7216 | 0.176 | 107/68/33/192 |

Calibration (LogReg): 0.0-0.2: pred 0.117 vs obs 0.127 (n=126), 0.2-0.4: pred 0.281 vs obs 0.181 (n=72), 0.4-0.6: pred 0.503 vs obs 0.271 (n=70), 0.6-0.8: pred 0.694 vs obs 0.565 (n=69), 0.8-1.0: pred 0.901 vs obs 0.841 (n=63)

False negatives at the recall-first point: 33 — DRY_IN_ERA5 (date or location uncertainty, or sub-grid rain): 3, NON_RAIN_TRIGGER: 17, MODEL_ERROR: 11, FLAT_SITE (location accuracy coarser than the DEM): 2

### GEOGRAPHIC — train lon < 93.5E (west), validate lon >= 93.5E (east)

**Same-day rain (lead 0 d)** — train 131 events / 524 non-events; validate 110 / 440

| Model | Acc | Prec | Recall | Spec | F1 | FNR | FPR | ROC-AUC | PR-AUC | Brier | TP/FP/FN/TN |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Rule (≥64.5 mm/day or ≥100 mm/3 d) | 0.820 | 0.641 | 0.227 | 0.968 | 0.336 | 0.773 | 0.032 | 0.5977 | 0.3531 | 0.180 | 25/14/85/426 |
| LogReg @0.5 | 0.773 | 0.455 | 0.691 | 0.793 | 0.549 | 0.309 | 0.207 | 0.821 | 0.5417 | 0.170 | 76/91/34/349 |
| LogReg recall-first @0.23 | 0.474 | 0.271 | 0.964 | 0.352 | 0.423 | 0.036 | 0.648 | 0.821 | 0.5417 | 0.170 | 106/285/4/155 |

Calibration (LogReg): 0.0-0.2: pred 0.186 vs obs 0.032 (n=94), 0.2-0.4: pred 0.281 vs obs 0.049 (n=203), 0.4-0.6: pred 0.486 vs obs 0.291 (n=141), 0.6-0.8: pred 0.688 vs obs 0.405 (n=74), 0.8-1.0: pred 0.896 vs obs 0.684 (n=38)

False negatives at the recall-first point: 4 — DRY_IN_ERA5 (date or location uncertainty, or sub-grid rain): 2, NON_RAIN_TRIGGER: 2

**Rain up to the day before (lead 1 d)** — train 131 events / 524 non-events; validate 110 / 440

| Model | Acc | Prec | Recall | Spec | F1 | FNR | FPR | ROC-AUC | PR-AUC | Brier | TP/FP/FN/TN |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Rule (≥100 mm/3 d to yesterday) | 0.796 | 0.474 | 0.164 | 0.955 | 0.243 | 0.836 | 0.045 | 0.5591 | 0.2728 | 0.204 | 18/20/92/420 |
| LogReg @0.5 | 0.765 | 0.444 | 0.691 | 0.784 | 0.541 | 0.309 | 0.216 | 0.8201 | 0.5028 | 0.172 | 76/95/34/345 |
| LogReg recall-first @0.22 | 0.455 | 0.264 | 0.964 | 0.327 | 0.414 | 0.036 | 0.673 | 0.8201 | 0.5028 | 0.172 | 106/296/4/144 |

Calibration (LogReg): 0.0-0.2: pred 0.184 vs obs 0.029 (n=103), 0.2-0.4: pred 0.281 vs obs 0.05 (n=200), 0.4-0.6: pred 0.489 vs obs 0.304 (n=135), 0.6-0.8: pred 0.703 vs obs 0.467 (n=75), 0.8-1.0: pred 0.9 vs obs 0.568 (n=37)

False negatives at the recall-first point: 4 — DRY_IN_ERA5 (date or location uncertainty, or sub-grid rain): 2, NON_RAIN_TRIGGER: 2

## Verdict

- `98_PERCENT_TARGET_REACHED = NO` — no model reaches 98% recall AND 98% specificity on either held-out split.
- Best held-out figures (logistic regression, threshold 0.5): temporal ROC-AUC 0.7859, recall 0.7, FPR 0.1923, F1 0.6806; geographic ROC-AUC 0.821, recall 0.6909, FPR 0.2068. Best ROC-AUC 0.821.
- The production-style rain rule has recall 0.3 (temporal) / 0.2273 (geographic): the learned model roughly doubles recall at the cost of a 19%-21% false-positive rate. Pushing recall to 96% (geographic, threshold 0.23) costs a 65% false-positive rate - an alarm that fires on two of every three quiet days is not a warning.
- Calibration is poor across regions (east: predicted 0.28 vs observed 0.05 in the 0.2-0.4 bin), so the score must NOT be shown as a probability. Status stays **EXPERIMENTAL**; it controls nothing and reaches no screen.
- False negatives are dominated by non-rain triggers (mining, construction, unknown) and model error; a few are dry days in ERA5-Land (date/location uncertainty in a news-derived catalogue).
- Honest phrasing for judges: *on a held-out 2015-2017 set the rain+terrain model reaches ROC-AUC 0.79 and recall 0.70 at a 19% false-positive rate; the rule it would replace has recall 0.30.* Not "98%".

## Gate

98% is the target, not the result. The 98% claim gate (held-out set, no leakage, temporal AND geographic splits, hazard-specific metrics, false-negative review, meaningful sample) is applied above; the outcome is written in the final report as ACHIEVED / NOT_ACHIEVED with the actual best figures, never rounded up.
