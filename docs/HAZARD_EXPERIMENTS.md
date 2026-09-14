# Overnight landslide experiments (research, nothing deployed)

Updated 2026-09-14T00:45:46.754465Z. Datasets: NER slice (241 events / 964 quiet days).
Threshold chosen on TRAIN out-of-fold for recall >= 0.90; every number below is HELD-OUT. Best = mean PR-AUC across splits with min recall >= 0.70.

| dataset | run | mean PR-AUC | mean ROC-AUC | min recall | mean Brier | per split (recall / FPR / acc / F1) |
|---|---|---|---|---|---|---|
| NER | LOGREG/NO_MONTH/s0 | 0.635 | 0.817 | 0.85 | 0.168 | TEMPORAL: 0.85 / 0.35 / 0.72 / 0.68; GEOGRAPHIC: 0.97 / 0.77 / 0.38 / 0.38 |
| NER | LOGREG/NO_MONTH/s0/CALIBRATED | 0.629 | 0.817 | 0.86 | 0.160 | TEMPORAL: 0.86 / 0.35 / 0.72 / 0.69; GEOGRAPHIC: 0.95 / 0.57 / 0.53 / 0.45 |
| NER | LOGREG/FULL/s0 | 0.622 | 0.796 | 0.70 | 0.174 | TEMPORAL: 0.70 / 0.30 / 0.70 / 0.62; GEOGRAPHIC: 0.96 / 0.68 / 0.45 / 0.41 |
| NER | LOGREG/RAIN_ONLY/s0 | 0.619 | 0.796 | 0.72 | 0.175 | TEMPORAL: 0.72 / 0.33 / 0.69 / 0.62; GEOGRAPHIC: 0.96 / 0.68 / 0.45 / 0.41 |
| NER | LOGREG/LEAD1/s0 | 0.606 | 0.800 | 0.76 | 0.175 | TEMPORAL: 0.76 / 0.32 / 0.71 / 0.65; GEOGRAPHIC: 0.95 / 0.68 / 0.45 / 0.41 |
| NER | RF/FULL/s0 | 0.556 | 0.792 | 0.82 | 0.171 | TEMPORAL: 0.82 / 0.40 / 0.68 / 0.64; GEOGRAPHIC: 0.93 / 0.47 / 0.61 / 0.49 |
| NER | RF/NO_MONTH/s0 | 0.554 | 0.790 | 0.78 | 0.169 | TEMPORAL: 0.78 / 0.32 / 0.71 / 0.65; GEOGRAPHIC: 0.92 / 0.48 / 0.60 / 0.48 |
| NER | RF/FULL/s1 | 0.551 | 0.790 | 0.70 | 0.172 | TEMPORAL: 0.70 / 0.27 / 0.72 / 0.64; GEOGRAPHIC: 0.94 / 0.51 / 0.58 / 0.47 |
| NER | RF/RAIN_ONLY/s0 | 0.551 | 0.785 | 0.83 | 0.169 | TEMPORAL: 0.83 / 0.44 / 0.65 / 0.63; GEOGRAPHIC: 0.95 / 0.69 / 0.44 / 0.40 |
| NER | RF/NO_MONTH/s1 | 0.550 | 0.788 | 0.74 | 0.171 | TEMPORAL: 0.74 / 0.29 / 0.72 / 0.65; GEOGRAPHIC: 0.94 / 0.50 / 0.59 / 0.47 |
| NER | RF/RAIN_ONLY/s2 | 0.547 | 0.784 | 0.79 | 0.170 | TEMPORAL: 0.79 / 0.36 / 0.69 / 0.65; GEOGRAPHIC: 0.95 / 0.69 / 0.44 / 0.40 |
| NER | RF/FULL/s2 | 0.546 | 0.788 | 0.76 | 0.173 | TEMPORAL: 0.76 / 0.31 / 0.71 / 0.65; GEOGRAPHIC: 0.92 / 0.47 / 0.61 / 0.48 |
| NER | RF/NO_MONTH/s2 | 0.544 | 0.787 | 0.79 | 0.171 | TEMPORAL: 0.79 / 0.35 / 0.70 / 0.65; GEOGRAPHIC: 0.93 / 0.46 / 0.61 / 0.49 |
| NER | RF/LEAD1/s2 | 0.496 | 0.787 | 0.82 | 0.173 | TEMPORAL: 0.82 / 0.36 / 0.70 / 0.66; GEOGRAPHIC: 0.92 / 0.43 / 0.64 / 0.51 |
| NER | RF/LEAD1/s0 | 0.494 | 0.785 | 0.82 | 0.173 | TEMPORAL: 0.82 / 0.38 / 0.69 / 0.65; GEOGRAPHIC: 0.90 / 0.40 / 0.66 / 0.52 |
| NER | RF/LEAD1/s1 | 0.490 | 0.785 | 0.76 | 0.174 | TEMPORAL: 0.76 / 0.29 / 0.73 / 0.66; GEOGRAPHIC: 0.92 / 0.42 / 0.65 / 0.51 |
| NER | RF/RAIN_ONLY/s1 | 0.552 | 0.784 | 0.69 | 0.170 | TEMPORAL: 0.69 / 0.25 / 0.73 / 0.64; GEOGRAPHIC: 0.96 / 0.71 / 0.43 / 0.40 |
| NER | HGB/FULL/s0 | 0.477 | 0.737 | 0.51 | 0.228 | TEMPORAL: 0.51 / 0.22 / 0.69 / 0.54; GEOGRAPHIC: 0.87 / 0.45 / 0.62 / 0.48 |
| NER | HGB/FULL/s1 | 0.477 | 0.737 | 0.51 | 0.228 | TEMPORAL: 0.51 / 0.22 / 0.69 / 0.54; GEOGRAPHIC: 0.87 / 0.45 / 0.62 / 0.48 |
| NER | HGB/FULL/s2 | 0.477 | 0.737 | 0.51 | 0.228 | TEMPORAL: 0.51 / 0.22 / 0.69 / 0.54; GEOGRAPHIC: 0.87 / 0.45 / 0.62 / 0.48 |
| NER | HGB/RAIN_ONLY/s0 | 0.456 | 0.717 | 0.57 | 0.227 | TEMPORAL: 0.57 / 0.26 / 0.68 / 0.56; GEOGRAPHIC: 0.83 / 0.53 / 0.54 / 0.42 |
| NER | HGB/RAIN_ONLY/s1 | 0.456 | 0.717 | 0.57 | 0.227 | TEMPORAL: 0.57 / 0.26 / 0.68 / 0.56; GEOGRAPHIC: 0.83 / 0.53 / 0.54 / 0.42 |
| NER | HGB/RAIN_ONLY/s2 | 0.456 | 0.717 | 0.57 | 0.227 | TEMPORAL: 0.57 / 0.26 / 0.68 / 0.56; GEOGRAPHIC: 0.83 / 0.53 / 0.54 / 0.42 |
| NER | HGB/LEAD1/s0 | 0.450 | 0.740 | 0.61 | 0.231 | TEMPORAL: 0.61 / 0.26 / 0.69 / 0.58; GEOGRAPHIC: 0.86 / 0.43 / 0.63 / 0.48 |
| NER | HGB/LEAD1/s1 | 0.450 | 0.740 | 0.61 | 0.231 | TEMPORAL: 0.61 / 0.26 / 0.69 / 0.58; GEOGRAPHIC: 0.86 / 0.43 / 0.63 / 0.48 |

98% target: NOT reached on any held-out split (see accuracy column; recall-first thresholds trade accuracy for recall by design).
Status: EXPERIMENTAL. See `docs/MODEL_REGISTRY.md`. Raw checkpoints: `.runtime/data/hazard/experiments/`.
