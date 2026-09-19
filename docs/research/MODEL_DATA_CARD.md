# Model data card — experimental landslide-day model

Status: **`SHADOW_ONLY` / EXPERIMENTAL — not deployed.** It controls nothing, and this audit
did not change that.

Full metrics, splits and the rejection reasoning live in
[`docs/MODEL_REGISTRY.md`](../MODEL_REGISTRY.md), [`docs/HAZARD_VALIDATION.md`](../HAZARD_VALIDATION.md),
[`docs/HAZARD_EXPERIMENTS.md`](../HAZARD_EXPERIMENTS.md) and
[`docs/HAZARD_ERROR_ANALYSIS.md`](../HAZARD_ERROR_ANALYSIS.md). This card covers the **data**:
what went in, where it came from, and what it cannot support.

## What it predicts

Whether a given day at a given site is a landslide day. Daily resolution, point sites.

It does **not** predict: whether a road is passable, whether a corridor is safe, when a road
will reopen, or where a future landslide will occur.

## Training data

| | |
|---|---|
| Positives | NASA Global Landslide Catalog events, filtered to location accuracy ≤ 5 km |
| Negatives | Quiet days at the **same sites** (random), and a season-matched variant (±45 days-of-year, other years, k=6) |
| Rainfall | ERA5-Land daily totals via the Open-Meteo archive |
| Terrain | Copernicus DEM elevation, slope proxy |
| Susceptibility | NASA LHASA class (v0.3 only; added ≈0) |
| Features | p1, p3, p7, p15, p30, max7, elevation, slope, month (sin/cos) |
| Splits | Temporal (train ≤2014, test 2015–17) **and** geographic (west/east at 93.5 E; and all-India-minus-NER → NER) |
| Where it runs | `backend/scripts/hazard_validation/` — research scripts only, never in the request path |

## The finding that matters, and it is a negative one

Season-matched negatives collapsed the apparent skill: PR-AUC 0.74 → 0.49 (temporal),
0.33 (geographic). **Most of the earlier performance was the monsoon-versus-dry-season
contrast, not landslide-day discrimination.** Within-season, ERA5-Land daily totals plus a
slope proxy do not separate landslide days from wet days on this catalogue.

The best honest operating points on held-out data: recall 0.95 at FPR 0.50 (random
negatives), recall 0.93 at FPR 0.72 (season-matched). The target of recall ≥ 0.85 with
FPR < 0.30 is **not reached at any threshold**. Best held-out accuracy across every
experiment: 0.69.

**98% accuracy was never reached on any held-out split, and must not be claimed anywhere.**

## Known limitations of the data, not of the tuning

- **Site features are uninformative by construction.** Negatives are quiet days at event
  sites, so slope, elevation and susceptibility are identical between true and false
  positives. Cross-site negatives are needed before terrain can carry signal.
- **Daily rainfall is too coarse.** 72% of false positives are wet Jun–Sep days at event
  sites. Landslides respond to intensity; the feature set has totals.
- **The catalogue is news-derived.** Positives are where a journalist filed a story, with
  a location accuracy field that is frequently 25–50 km. Reporting density is a covariate.
- **It ends in 2017.** Nothing after that year is represented.
- **No field inventory.** GSI/Bhukosh is portal-only and was unreachable.

## The deployment bar it has not cleared

Held-out set, no leakage, temporal **and** geographic splits, hazard-specific metrics with
false-negative review, meaningful sample size, and a material beat over the deterministic
baseline. It meets the split and review requirements and fails the last one at an
acceptable false-positive rate.

Until it clears that bar: it stays out of route eligibility, out of hazard refusals, out of
reroute decisions, and out of anything a driver sees. Route policy remains deterministic —
`backend/app/domain/route_risk.py`, eleven factors, with `UNKNOWN` scored as unknown rather
than as safe. The production rain rule it was measured against (2.5 / 7.5 mm h⁻¹) is a
threshold, not a model, and is labelled as such.

`backend/app/domain/intelligence_inventory.py` is the machine-readable version of this
claim, served on `/api/system/providers` so the System page and this document cannot
disagree: production local ML = 0, experimental local ML = 1, experimental landslide model
= NOT DEPLOYED.

## What would make it useful

Sub-daily rain intensity (ERA5 hourly, or IMERG half-hourly), soil moisture (ERA5-Land
`swvl`, or SMAP), cross-site negatives, and a field inventory with real location accuracy.
Three of those four need credentials this project does not hold; none of them is in the
research package audited here.
