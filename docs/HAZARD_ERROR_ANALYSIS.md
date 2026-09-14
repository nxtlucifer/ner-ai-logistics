# Landslide model error analysis (India-wide -> NER holdout, research)

Holdout n=770, events=154, sites=153. Operating threshold 0.31 chosen on TRAIN out-of-fold (recall >= 0.90); the table below only describes the trade-off on the holdout and is not used to choose anything.

| threshold | recall | precision | FPR | FNR | F1 | accuracy |
|---|---|---|---|---|---|---|
| 0.05 | 1.00 | 0.20 | 1.00 | 0.00 | 0.33 | 0.20 |
| 0.10 | 1.00 | 0.20 | 1.00 | 0.00 | 0.33 | 0.20 |
| 0.15 | 1.00 | 0.20 | 1.00 | 0.00 | 0.33 | 0.20 |
| 0.20 | 0.98 | 0.23 | 0.83 | 0.02 | 0.37 | 0.33 |
| 0.25 | 0.97 | 0.29 | 0.60 | 0.03 | 0.44 | 0.51 |
| 0.30 | 0.95 | 0.32 | 0.51 | 0.05 | 0.48 | 0.58 |
| 0.35 | 0.92 | 0.34 | 0.45 | 0.08 | 0.49 | 0.62 |
| 0.40 | 0.91 | 0.38 | 0.38 | 0.09 | 0.53 | 0.68 |
| 0.45 | 0.86 | 0.41 | 0.30 | 0.14 | 0.56 | 0.73 |
| 0.50 | 0.73 | 0.42 | 0.25 | 0.27 | 0.54 | 0.75 |
| 0.55 | 0.69 | 0.45 | 0.21 | 0.31 | 0.54 | 0.77 |
| 0.60 | 0.63 | 0.47 | 0.18 | 0.37 | 0.54 | 0.78 |
| 0.65 | 0.58 | 0.50 | 0.15 | 0.42 | 0.53 | 0.80 |
| 0.70 | 0.52 | 0.53 | 0.12 | 0.48 | 0.52 | 0.81 |
| 0.75 | 0.41 | 0.53 | 0.09 | 0.59 | 0.46 | 0.81 |
| 0.80 | 0.36 | 0.56 | 0.07 | 0.64 | 0.43 | 0.81 |
| 0.85 | 0.32 | 0.59 | 0.06 | 0.68 | 0.41 | 0.82 |
| 0.90 | 0.26 | 0.65 | 0.04 | 0.74 | 0.37 | 0.82 |
| 0.95 | 0.21 | 0.77 | 0.02 | 0.79 | 0.34 | 0.83 |

## True positives vs false positives (median [p25-p75])

| feature | TP | FP | TN |
|---|---|---|---|
| p1 | 21.6 [10.0-37.1] | 10.65 [5.3-19.2] | 0.0 [0.0-0.5] |
| p3 | 62.3 [34.9-105.5] | 34.7 [20.4-55.0] | 0.3 [0.0-3.9] |
| p7 | 117.2 [82.4-182.6] | 79.25 [54.5-116.7] | 2.5 [0.1-12.4] |
| p15 | 245.7 [171.7-307.9] | 173.55 [111.3-240.7] | 9.8 [1.6-36.3] |
| p30 | 436.3 [350.6-565.4] | 341.5 [248.3-479.7] | 27.8 [7.8-76.8] |
| max7 | 41.1 [24.5-58.6] | 25.95 [17.9-39.0] | 1.7 [0.1-6.1] |
| elevation | 719.0 [134.0-1372.0] | 782.5 [132.0-1409.0] | 704.0 [130.0-1260.0] |
| slope | 0.23 [0.11-0.35] | 0.27 [0.13-0.37] | 0.23 [0.1-0.33] |
| susc | 4.0 [3.0-5.0] | 4.0 [3.0-5.0] | 4.0 [3.0-5.0] |

## Clusters

```
{
 "fp_by_month": {
  "1": 2,
  "2": 4,
  "3": 14,
  "4": 16,
  "5": 34,
  "6": 46,
  "7": 50,
  "8": 49,
  "9": 52,
  "10": 31,
  "11": 6,
  "12": 2
 },
 "tp_by_month": {
  "2": 1,
  "4": 5,
  "5": 9,
  "6": 23,
  "7": 30,
  "8": 35,
  "9": 28,
  "10": 14
 },
 "tn_by_month": {
  "1": 38,
  "2": 48,
  "3": 44,
  "4": 32,
  "5": 11,
  "6": 9,
  "7": 3,
  "9": 3,
  "10": 25,
  "11": 48,
  "12": 49
 },
 "fp_by_state": {
  "Assam": 87,
  "N\u0101g\u0101land": 60,
  "Manipur": 32,
  "Meghalaya": 26,
  "Mizoram": 26,
  "Arunachal Pradesh": 23,
  "Nagaland": 22,
  "Arun\u0101chal Pradesh": 22
 },
 "fp_by_susceptibility": {
  "1.0": 21,
  "2.0": 25,
  "3.0": 54,
  "4.0": 60,
  "5.0": 146
 },
 "tp_by_susceptibility": {
  "1.0": 10,
  "2.0": 16,
  "3.0": 26,
  "4.0": 25,
  "5.0": 68
 },
 "fp_wet_share_p3_ge_50mm": 0.281,
 "tp_wet_share_p3_ge_50mm": 0.593,
 "fp_dry_share_p3_lt_10mm": 0.078,
 "events_location_accuracy": {
  "5km": 107,
  "1km": 43,
  "exact": 4
 },
 "events_trigger": {
  "downpour": 67,
  "continuous_rain": 37,
  "rain": 29,
  "monsoon": 12,
  "unknown": 7,
  "mining": 2
 }
}
```

## Reading

- Negatives are quiet days at the SAME sites as the events (build_landslide_dataset.py), so slope, elevation and susceptibility are identical between TP and FP by construction - they cannot lower FPR on this design; only rainfall features can.
- FPs concentrate in the monsoon months with high p3/p7: the model cannot tell a wet day WITH a slide from a wet day WITHOUT one at the same site from daily ERA5-Land totals alone.
- Missing signal (legitimate sources to test next): sub-daily rain intensity (peak 1h/3h/6h - IMERG half-hourly or ERA5 hourly via Open-Meteo), soil moisture (SMAP/ERA5-Land swvl), and cross-site negatives (quiet days at non-event sites) so site features carry information.

Logistic weights (standardised): `{'p1': 0.814, 'p3': 0.585, 'p7': -0.122, 'p15': -0.065, 'p30': 0.342, 'max7': 0.36, 'elevation': 0.134, 'slope': -0.02}`
