# Overnight landslide experiments (research, nothing deployed)

Updated 2026-09-14T05:27:48.796301Z. Datasets: NER slice (241 events / 964 quiet days), India-wide (see meta).
Threshold chosen on TRAIN out-of-fold for recall >= 0.90; every number below is HELD-OUT. Best = mean PR-AUC across splits with min recall >= 0.70.

| dataset | run | mean PR-AUC | mean ROC-AUC | min recall | mean Brier | per split (recall / FPR / acc / F1) |
|---|---|---|---|---|---|---|
| NER | LOGREG/NO_MONTH/s0 | 0.635 | 0.817 | 0.85 | 0.168 | GEOGRAPHIC: 0.97 / 0.77 / 0.38 / 0.38; TEMPORAL: 0.85 / 0.35 / 0.72 / 0.68 |
| NER | LOGREG/NO_MONTH/s0/CALIBRATED | 0.629 | 0.817 | 0.86 | 0.160 | GEOGRAPHIC: 0.95 / 0.57 / 0.53 / 0.45; TEMPORAL: 0.86 / 0.35 / 0.72 / 0.69 |
| NER | LOGREG/FULL/s0 | 0.622 | 0.796 | 0.70 | 0.174 | GEOGRAPHIC: 0.96 / 0.68 / 0.45 / 0.41; TEMPORAL: 0.70 / 0.30 / 0.70 / 0.62 |
| NER | LOGREG/RAIN_ONLY/s0 | 0.619 | 0.796 | 0.72 | 0.175 | GEOGRAPHIC: 0.96 / 0.68 / 0.45 / 0.41; TEMPORAL: 0.72 / 0.33 / 0.69 / 0.62 |
| NER | LOGREG/LEAD1/s0 | 0.606 | 0.800 | 0.76 | 0.175 | GEOGRAPHIC: 0.95 / 0.68 / 0.45 / 0.41; TEMPORAL: 0.76 / 0.32 / 0.71 / 0.65 |
| INDIA | LOGREG/FULL/s0 | 0.576 | 0.827 | 0.85 | 0.173 | TEMPORAL: 0.85 / 0.38 / 0.68 / 0.57; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.49 / 0.59 / 0.48 |
| INDIA | LOGREG/FULL/s0/CALIBRATED | 0.576 | 0.827 | 0.85 | 0.132 | TEMPORAL: 0.85 / 0.37 / 0.68 / 0.57; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.52 / 0.57 / 0.47 |
| INDIA | LOGREG/RAIN_ONLY/s0 | 0.576 | 0.827 | 0.85 | 0.174 | TEMPORAL: 0.85 / 0.38 / 0.67 / 0.57; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.49 / 0.59 / 0.48 |
| INDIA | LOGREG/NO_MONTH/s0 | 0.569 | 0.823 | 0.90 | 0.177 | TEMPORAL: 0.90 / 0.39 / 0.68 / 0.58; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.50 / 0.59 / 0.48 |
| INDIA | RF/RAIN_ONLY/s1 | 0.566 | 0.828 | 0.87 | 0.149 | TEMPORAL: 0.87 / 0.35 / 0.70 / 0.59; GEOGRAPHIC_NER_HOLDOUT: 0.95 / 0.50 / 0.59 / 0.48 |
| INDIA | RF/RAIN_ONLY/s0 | 0.562 | 0.827 | 0.88 | 0.149 | TEMPORAL: 0.88 / 0.37 / 0.69 / 0.58; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.50 / 0.59 / 0.48 |
| INDIA | RF/RAIN_ONLY/s2 | 0.559 | 0.826 | 0.87 | 0.150 | TEMPORAL: 0.87 / 0.36 / 0.70 / 0.59; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.51 / 0.58 / 0.47 |
| NER | RF/FULL/s0 | 0.556 | 0.792 | 0.82 | 0.171 | GEOGRAPHIC: 0.93 / 0.47 / 0.61 / 0.49; TEMPORAL: 0.82 / 0.40 / 0.68 / 0.64 |
| NER | RF/NO_MONTH/s0 | 0.554 | 0.790 | 0.78 | 0.169 | GEOGRAPHIC: 0.92 / 0.48 / 0.60 / 0.48; TEMPORAL: 0.78 / 0.32 / 0.71 / 0.65 |
| INDIA | RF/FULL/s1 | 0.554 | 0.826 | 0.88 | 0.149 | TEMPORAL: 0.88 / 0.36 / 0.70 / 0.59; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.48 / 0.60 / 0.48 |
| INDIA | LOGREG/LEAD1/s0 | 0.553 | 0.813 | 0.86 | 0.182 | TEMPORAL: 0.86 / 0.39 / 0.67 / 0.57; GEOGRAPHIC_NER_HOLDOUT: 0.95 / 0.51 / 0.58 / 0.48 |
| NER | RF/FULL/s1 | 0.551 | 0.790 | 0.70 | 0.172 | GEOGRAPHIC: 0.94 / 0.51 / 0.58 / 0.47; TEMPORAL: 0.70 / 0.27 / 0.72 / 0.64 |
| NER | RF/RAIN_ONLY/s0 | 0.550 | 0.785 | 0.83 | 0.169 | GEOGRAPHIC: 0.95 / 0.69 / 0.44 / 0.40; TEMPORAL: 0.83 / 0.44 / 0.65 / 0.63 |
| INDIA | RF/FULL/s0 | 0.550 | 0.826 | 0.86 | 0.149 | TEMPORAL: 0.86 / 0.37 / 0.69 / 0.58; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.50 / 0.59 / 0.48 |
| NER | RF/NO_MONTH/s1 | 0.550 | 0.788 | 0.74 | 0.171 | GEOGRAPHIC: 0.94 / 0.50 / 0.59 / 0.47; TEMPORAL: 0.74 / 0.29 / 0.72 / 0.65 |
| NER | RF/RAIN_ONLY/s2 | 0.547 | 0.784 | 0.79 | 0.170 | GEOGRAPHIC: 0.95 / 0.69 / 0.44 / 0.40; TEMPORAL: 0.79 / 0.36 / 0.69 / 0.65 |
| NER | RF/FULL/s2 | 0.546 | 0.788 | 0.76 | 0.173 | GEOGRAPHIC: 0.92 / 0.47 / 0.61 / 0.48; TEMPORAL: 0.76 / 0.31 / 0.71 / 0.65 |
| INDIA | RF/FULL/s2 | 0.546 | 0.826 | 0.87 | 0.148 | TEMPORAL: 0.87 / 0.36 / 0.70 / 0.59; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.49 / 0.59 / 0.48 |
| NER | RF/NO_MONTH/s2 | 0.544 | 0.787 | 0.79 | 0.171 | GEOGRAPHIC: 0.93 / 0.46 / 0.61 / 0.49; TEMPORAL: 0.79 / 0.35 / 0.70 / 0.65 |
| INDIA | RF/NO_MONTH/s1 | 0.541 | 0.820 | 0.89 | 0.152 | TEMPORAL: 0.89 / 0.40 / 0.67 / 0.57; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.51 / 0.58 / 0.47 |

98% target: NOT reached on any held-out split (see accuracy column; recall-first thresholds trade accuracy for recall by design).
Status: EXPERIMENTAL. See `docs/MODEL_REGISTRY.md`. Raw checkpoints: `.runtime/data/hazard/experiments/`.

## V2 experiments (2026-09-14T05:29:21.540941Z)

Season-matched negatives (NER_SM), NASA LHASA susceptibility (+SUSC), SoilGrids texture (+SOIL) where fetched. Threshold on TRAIN out-of-fold; board = min recall >= 0.80 then mean PR-AUC.

| dataset | run | mean PR-AUC | min recall | max FPR | mean Brier | per split (recall / FPR / acc / precision) |
|---|---|---|---|---|---|---|
| INDIA | V2/LOGREG/BASE/s0 | 0.569 | 0.90 | 0.50 | 0.177 | TEMPORAL: 0.90 / 0.39 / 0.68 / 0.43; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.50 / 0.59 / 0.32 |
| INDIA | V2/LOGREG/BASE+SUSC/s0 | 0.567 | 0.90 | 0.50 | 0.177 | TEMPORAL: 0.90 / 0.42 / 0.66 / 0.41; GEOGRAPHIC_NER_HOLDOUT: 0.94 / 0.50 / 0.59 / 0.32 |
| INDIA | V2/HGB/BASE+SUSC/s0 | 0.492 | 0.89 | 0.61 | 0.180 | TEMPORAL: 0.89 / 0.49 / 0.60 / 0.37; GEOGRAPHIC_NER_HOLDOUT: 0.95 / 0.61 / 0.51 / 0.28 |
| INDIA | V2/HGB/BASE+SUSC/s1 | 0.492 | 0.88 | 0.65 | 0.180 | TEMPORAL: 0.88 / 0.48 / 0.61 / 0.38; GEOGRAPHIC_NER_HOLDOUT: 0.96 / 0.65 / 0.47 / 0.27 |
| INDIA | V2/HGB/BASE/s0 | 0.491 | 0.88 | 0.61 | 0.182 | TEMPORAL: 0.88 / 0.48 / 0.61 / 0.38; GEOGRAPHIC_NER_HOLDOUT: 0.95 / 0.61 / 0.50 / 0.28 |
| INDIA | V2/HGB/BASE/s1 | 0.491 | 0.88 | 0.65 | 0.182 | TEMPORAL: 0.88 / 0.46 / 0.62 / 0.39; GEOGRAPHIC_NER_HOLDOUT: 0.96 / 0.65 / 0.47 / 0.27 |

## V2 experiments (2026-09-14T05:31:55.436295Z)

Season-matched negatives (NER_SM), NASA LHASA susceptibility (+SUSC), SoilGrids texture (+SOIL) where fetched. Threshold on TRAIN out-of-fold; board = min recall >= 0.80 then mean PR-AUC.

| dataset | run | mean PR-AUC | min recall | max FPR | mean Brier | per split (recall / FPR / acc / precision) |
|---|---|---|---|---|---|---|
| INDIA_SM | V2/LOGREG/BASE/s0 | 0.347 | 0.87 | 0.77 | 0.212 | TEMPORAL: 0.87 / 0.68 / 0.42 / 0.23; GEOGRAPHIC_NER_HOLDOUT: 0.93 / 0.77 / 0.33 / 0.17 |
| INDIA_SM | V2/LOGREG/BASE+SUSC/s0 | 0.346 | 0.88 | 0.75 | 0.212 | TEMPORAL: 0.88 / 0.68 / 0.42 / 0.23; GEOGRAPHIC_NER_HOLDOUT: 0.93 / 0.75 / 0.35 / 0.17 |
| INDIA_SM | V2/HGB/BASE/s0 | 0.264 | 0.88 | 0.85 | 0.188 | TEMPORAL: 0.88 / 0.78 / 0.34 / 0.20; GEOGRAPHIC_NER_HOLDOUT: 0.93 / 0.85 / 0.26 / 0.15 |
| INDIA_SM | V2/HGB/BASE/s1 | 0.264 | 0.88 | 0.85 | 0.188 | TEMPORAL: 0.88 / 0.78 / 0.34 / 0.20; GEOGRAPHIC_NER_HOLDOUT: 0.93 / 0.85 / 0.26 / 0.15 |
| INDIA_SM | V2/HGB/BASE+SUSC/s0 | 0.263 | 0.87 | 0.87 | 0.190 | TEMPORAL: 0.87 / 0.80 / 0.33 / 0.20; GEOGRAPHIC_NER_HOLDOUT: 0.93 / 0.87 / 0.24 / 0.15 |
| INDIA_SM | V2/HGB/BASE+SUSC/s1 | 0.263 | 0.85 | 0.85 | 0.190 | TEMPORAL: 0.85 / 0.76 / 0.35 / 0.20; GEOGRAPHIC_NER_HOLDOUT: 0.90 / 0.85 / 0.26 / 0.15 |
