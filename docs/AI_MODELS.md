# AI Models

**Status: design specification. No model has been trained. No accuracy is claimed anywhere in this
document, and none may be claimed until a model has been evaluated on a held-out set and the
numbers written here with the evaluation date.**

---

## 0. Rules That Apply To Every Model

1. **Every model ships with a baseline it must beat.** A model that does not beat its baseline on
   the held-out set is not deployed. The baseline stays in the code permanently as the fallback.
2. **Every model has a fallback path.** If inference fails, times out, or the model file is absent,
   the system returns the baseline result or an explicit `null` — never a fabricated number.
3. **No model output is authoritative.** Model outputs inform manager decisions and are labelled as
   estimates in the UI. See [ARCHITECTURE.md](ARCHITECTURE.md) §8.
4. **Provenance is returned with every prediction** — `source`, `model_version`, and where
   applicable the baseline value alongside it.
5. **Synthetic training data is disclosed as synthetic**, in this document, in the UI copy, and in
   the SIH presentation. Metrics on synthetic data measure *learnability of the generator*, not
   real-world accuracy, and must be described that way.

Rule 5 is the one most likely to be quietly broken under deadline pressure. It is the one that
would most damage the project's credibility in judging.

### 0a. Why the landslide model is blocked, specifically (surveyed 2026-09-01)

Not "not built yet" — **not buildable yet from the sources that exist.** The survey is in
[ROAD_MEMORY.md](ROAD_MEMORY.md); the part that decides it:

**No source surveyed publishes "this road is open again."** GSI publishes hazard forecasts and a
historical inventory, ASDMA publishes damage reports, IMD publishes weather. Reopening is decided
by PWD/NHAI/BRO and communicated ad hoc, so nothing machine-readable carries it.

That is not merely a missing feature. It means there is **no ground truth** for "was this road
passable on this date", which is the label any landslide or route-risk model would have to be
trained and validated against. A model fitted on these inputs would produce a number with no way
to check it — which Rule 1 forbids, because it could not be shown to beat a baseline, and Rule 5
would then be broken by describing it as anything at all.

`AI_ML = BLOCKED_BY_DATA`. Consequences, all of them deliberate:

- `app/domain/road_memory.py` records evidence and enforces that **silence is not evidence** —
  no elapsed time may move a road toward VERIFIED_OPEN. That evidence log is what would one day
  become a labelled dataset.
- `app/domain/monsoon_risk.py` is a **weighted rule** over recurrence, rainfall, season and
  observed road status, named `monsoon-risk-engine-v1`. Not a forecast.
- `route_risk`, `route_recommendation` and `reroute` each carry a `version` naming a rule, and
  each has a test asserting no `confidence`, `probability` or `model_version` field reaches the
  wire.

The honest sequence is: collect evidence first, label it, then ask whether a model beats the
rule. Reversing that order is how Rule 5 gets broken.

---

## 1. Fuel AI

### Problem
Estimate diesel consumption for a proposed route so route options can be compared on true cost.
Regression: features of route + truck + load + conditions → litres consumed.

Distance-only estimation is specifically wrong in NER. A 300 km route through the Barail hills and
a 300 km route along the Brahmaputra valley have materially different consumption for the same
truck and load. Gradient is the dominant term this model exists to capture.

### Input features

| Group | Features |
| --- | --- |
| Route | `distance_km`, `cumulative_ascent_m`, `cumulative_descent_m`, `mean_abs_gradient_pct`, `pct_distance_above_4pct_grade`, `max_gradient_pct`, `road_class_mix` |
| Truck | `truck_type`, `axle_count`, `kerb_weight_kg`, `engine_capacity_l`, `manufacture_year`, `baseline_mileage_kmpl` |
| Load | `payload_kg`, `load_ratio` (payload / max_capacity) |
| Conditions | `is_monsoon`, `rainfall_mm_forecast`, `mean_speed_kmph_expected`, `road_quality_index`, `night_fraction` |
| Historical | `truck_historical_kmpl_mean`, `truck_historical_kmpl_std`, `driver_historical_kmpl_mean` |

**Deliberately excluded:** driver identity as a raw categorical. It would let the model encode
individual drivers, and a fuel estimate that varies by *who* is driving invites disciplinary misuse
of an advisory number. Aggregate driver history is included; identity is not.

### Target
`litres_consumed` for the completed trip segment. Reported as litres and as derived cost using a
configured diesel price — **price is never learned**, it is a lookup, so a price change does not
require retraining.

### Baseline
```
litres = distance_km / truck.baseline_mileage_kmpl
       * (1 + load_ratio * LOAD_PENALTY)
       * (1 + cumulative_ascent_m / distance_km / 1000 * GRADIENT_PENALTY)
```
A physics-informed heuristic with hand-set constants. This is what dispatchers already do
implicitly. **If the ML model cannot beat this, the ML model has no reason to exist**, and the
honest outcome is to ship the baseline and say so.

### Candidate models
1. LightGBM regressor — primary. Handles mixed types, small data, non-linear gradient interaction.
2. XGBoost — comparison.
3. Ridge on engineered physics features — interpretable third point of comparison.

Gradient boosting rather than a neural network: the dataset is small, the features are tabular, and
a tree model can be explained to a judge in one sentence.

### Training data — honest position

We do **not** have real NER truck fuel logs. Options, in order of preference:

| Source | Status |
| --- | --- |
| Real fleet fuel logs | Not available. Would require an operator partnership. |
| Public heavy-vehicle datasets | Being surveyed; none NER-specific, and terrain is the point. |
| **Physics-informed synthetic generator** | **What we will use.** |

The generator produces trips over real NER road geometry with real SRTM elevation, computes
consumption from a tractive-effort model (rolling resistance, aerodynamic drag, grade resistance,
engine efficiency curve), then injects realistic noise and per-truck bias.

**What this can and cannot show.** It can demonstrate the full pipeline, the serving path, the
fallback behaviour, and that the model recovers a known non-linear relationship better than the
linear baseline. It **cannot** produce a real-world accuracy claim. Any metric computed on this
data must be reported as "on synthetic data" every single time it appears.

### Evaluation
- MAE (litres), RMSE, MAPE, and **MAE relative to baseline MAE** — the headline number.
- Segmented by gradient band and load ratio; a model that only wins on flat terrain is uninteresting.
- Split by *route corridor*, never randomly by row, to avoid leaking near-identical segments.

### Failure handling and fallback
| Failure | Behaviour |
| --- | --- |
| Model file missing | Baseline formula, `source: "BASELINE_KMPL"` |
| Inference exceeds 500 ms | Baseline; log timeout |
| Feature unavailable (no elevation) | Baseline; never impute silently |
| Prediction outside sanity bounds (< 0, or > 3× baseline) | Reject, use baseline, log for review |
| `baseline_mileage_kmpl` also null | Return `null`; UI shows "unavailable" |

---

## 2. Route Risk AI

### Problem
Score a candidate route's likelihood of disruption, to rank routes that have **already passed** the
deterministic passability filter. Ranking, not gating.

### Input features
Segment-level, aggregated to route: `pct_length_in_landslide_zone`,
`rainfall_mm_24h` / `_72h` along corridor, `days_since_monsoon_onset`,
`historical_incident_count_5km`, `mean_gradient_pct`, `pct_single_lane`,
`bridge_count`, `elevation_range_m`, `hours_since_last_confirmed_passage`.

`hours_since_last_confirmed_passage` — derived from our own GPS data — is the feature most likely
to carry real signal, because a road another truck traversed two hours ago is empirically open.

### Target
Binary: did a trip on this route experience a disruption (delay > threshold attributable to a road
incident) within its window. Output a calibrated probability.

### Baseline
Rule table: `IMPASSABLE` incident within 5 km → risk 1.0; heavy-rain warning in a known
landslide zone → 0.7; monsoon season → 0.4; else 0.1.

### Candidate models
Logistic regression (calibrated, interpretable) first; LightGBM with `scale_pos_weight` if the
class imbalance warrants it. Interpretability weighs heavily here — a manager rejecting a route
needs to know why.

### Training data
Historical incidents joined to trips that were and were not affected. **Severely limited: we will
not accumulate enough real incidents before 19 September.** Realistic MVP outcome is that the
**rule-based baseline ships** and the ML path is demonstrated as an architecture, not a trained
artefact. Stated plainly rather than papered over.

### Evaluation
PR-AUC (not ROC-AUC — disruptions are rare and the negative class dominates), Brier score for
calibration, and recall at a fixed low false-positive rate. Under-predicting a landslide is far
worse than over-predicting one, and the operating point is chosen accordingly.

### Failure handling
Model unavailable → rule baseline, `source: "RULE_BASELINE"`. Uncalibrated or stale model → rule
baseline. **A risk score never blocks a route on its own** — only a confirmed `IMPASSABLE` incident
does that, deterministically.

---

## 3. ETA Prediction

### Problem
Predict arrival time better than the routing engine's free-flow estimate, which systematically
underestimates on NER hill roads because it does not model loaded-truck climb speed, checkpoints,
or mandatory rest.

### Approach — residual correction
Predict the **correction** to the routing engine's ETA, not the ETA itself:
```
predicted_eta = engine_eta + model_correction
```
This is deliberate. The correction target is small and well-behaved; the model inherits the
engine's road knowledge instead of relearning it; and if the model fails, `correction = 0` degrades
exactly to the engine's own estimate — a graceful and obviously-correct fallback.

### Features
`engine_eta_min`, `distance_km`, `cumulative_ascent_m`, `load_ratio`, `truck_type`,
`departure_hour`, `is_weekend`, `is_monsoon`, `pct_single_lane`, `checkpoint_count`,
`driver_historical_eta_ratio`, `progress_fraction` (for in-trip re-estimation).

### Baseline
`engine_eta * static_multiplier` (per road-class), fitted on whatever completed trips exist.

### Evaluation
MAE in minutes; **percentage of trips within ±15% of actual**, which is closer to what a manager
cares about than raw MAE; segmented by trip length. Compared against both raw engine ETA and the
static multiplier.

### Failure handling
No model → `correction = 0`, `source: "ENGINE_RAW"`. Correction beyond ±50% of engine ETA →
clamped and logged. Trip re-estimation continues from GPS progress regardless of model state.

---

## 4. Fleet Sentinel

**This is not a machine learning model, and the section exists to make that explicit and permanent.**

Fleet Sentinel is deterministic application logic: a scheduled query, threshold comparisons, and a
state machine. It appears in this document only because it must be documented that **no model may
ever be introduced into its decision path.**

| Aspect | Position |
| --- | --- |
| Problem | Detect a stationary active truck outside an approved stop and escalate on driver silence |
| Method | Scheduled query + `ST_DWithin` + timer comparison. No inference. |
| Input | `gps_points`, `trips.status`, geofences, configured thresholds |
| Output | State transitions in `emergencies` |
| Baseline | N/A — it *is* the rule |
| Failure handling | If the scheduler fails, the failure is alarmed loudly. A missed safety check is a Sev-1. |
| Fallback | None needed; there is nothing to fall back from |

**Why no ML here.** Three independent reasons:
1. **Explainability under scrutiny.** After a real incident, "the truck had not moved more than
   50 m in 60 minutes and the driver did not answer in 30" is defensible. "The model scored 0.83"
   is not.
2. **No training data, and the cost of error is asymmetric.** A missed genuine emergency is
   catastrophic; a false positive costs one driver one button press.
3. **Availability.** The safety path must not have a dependency that can be down.

Where ML *may* eventually assist — strictly outside the decision path — is reducing false positives
by learning genuine rest stops from historical patterns. Even then it would only *suggest geofences
for manager approval*; it would never suppress a check directly.

An LLM may summarise a resolved incident for a report **after** resolution. It may not participate
in detection, escalation, or resolution.

---

## 5. Vehicle Photo Verification

### Problem
When a driver photographs a newly assigned truck, check that the visible registration plate matches
the assignment record.

### Method
PaddleOCR text detection + recognition on the plate region, normalised (uppercase, strip
separators, disambiguate O/0 and I/1), then fuzzy-matched against the expected registration.

### Input / target
Input: driver-uploaded photo, expected registration string.
Output: `match | mismatch | unreadable` plus confidence and the extracted text.

### Baseline
Manual manager review of the photo — which is also the permanent fallback.

### Evaluation
Character-level accuracy and exact-match rate on Indian plate formats, over photos captured in
realistic conditions: low light, rain, mud, oblique angles. Evaluation set must include deliberately
poor images, because that is what a 04:00 depot photo looks like.

### Failure handling — the important part
`unreadable` is the **expected common case**, not an error. Mud, rain and darkness are normal.

- OCR never blocks a driver. A mismatch or unreadable result sets `mismatch_flagged` and routes to
  manager review; the driver proceeds.
- OCR never auto-rejects an assignment.
- If PaddleOCR is unavailable, verification falls back to manager photo review and the workflow is
  unchanged.

This is a convenience layer over a manual process that must work without it.

---

## 6. Model Serving and Governance

- Models are trained **offline** in `ml/`, versioned artefacts committed to storage (not to git),
  loaded by the backend at startup.
- `GET /api/fuel/model-info` exposes version, training date, feature list, baseline comparison and
  the synthetic-data disclosure.
- Every prediction logs input hash, output, latency and source for later audit.
- No online learning. No model updates itself from production data during the hackathon.
- Retraining is a deliberate, reviewed, versioned step.

## 7. Metrics Table — Empty By Design

| Model | Version | Trained | Baseline | Model | Improvement | Data |
| --- | --- | --- | --- | --- | --- | --- |
| Fuel | — | not trained | — | — | — | — |
| Route Risk | — | not trained | — | — | — | — |
| ETA | — | not trained | — | — | — | — |
| Photo Verification | — | not evaluated | — | — | — | — |

This table is filled in only from a real evaluation run, with the date and the data type stated.
Until then it stays empty, and nothing anywhere in the project — UI, README, or presentation —
claims a number that is not in this table.

---

## 8. Local Language Model — Assistant, Safety Explanations, Talk

Added 2026-09-06. **This is not one of the models above and it never enters their
decision paths.** Sections 1–5 are deterministic or predictive systems with
safety authority; this is a language model that rewords facts those systems have
already produced.

### Status: implemented, never executed

No model runtime exists on the demo laptop — no Ollama, no LM Studio, no
`.gguf`, no `torch` or `transformers` — checked on 2026-09-06 rather than
assumed. `GET /api/ai/status` therefore returns `available: false`, every AI
surface renders its unavailable state, and **no token has ever been generated by
this code**. The request shape follows Ollama's documented `/api/chat` and has
not been validated against a running server.

To enable: install Ollama, `ollama pull llama3.2:3b` (matching `AI_MODEL`), and
the three surfaces work with no code change.

### What it is allowed to do

| Surface | Given | May produce |
| --- | --- | --- |
| Assistant | Facts computed from the signed-in driver's own trip | A restatement of those facts |
| Safety | The bundled, reviewed guidance the driver is reading | A rewording of that text |
| Talk | One short message plus a language pair | A translation, labelled as machine output |

### What it may never do

- Decide route eligibility, a hazard refusal, capacity, a review authorisation
  or any lifecycle transition. It has no write path to any of them.
- Turn an unavailable fact into a value. `unavailable` travels through the
  prompt as the word, and the prompts forbid guessing a distance, a time, a road
  name, a phone number or whether a road is open.
- Add medical advice, medicine names or doses, a road-is-clear verdict, or a
  promise that help is coming (`SAFETY_SYSTEM`, pinned by tests).
- Replace the offline guide, the deterministic assistant or the reviewed phrase
  pack. All three still work with no model, no server and no internet, and each
  screen states which of the two the reader is looking at.

### Boundaries that are structural, not conventions

- **Local only.** `looks_local()` refuses a non-loopback host unless
  `AI_ALLOW_NON_LOCAL_HOST` is deliberately set. Pointing the URL at a hosted
  endpoint would otherwise send a driver's trip off the machine silently.
- **Driver-scoped.** Every route takes `CurrentDriver` and no id, so there is no
  parameter that could select whose trip is described.
- **Bounded.** One concurrent generation process-wide, a prompt-length cap and
  an output-token cap, so a local decode cannot starve GPS ingestion.
- **Stateless.** No conversation is stored; each question carries its own facts.

### Metrics

None, and none may be quoted. Nothing has been evaluated because nothing has
run. When a model is installed, translation quality for Assamese, Bengali,
Gujarati and Hindi must be checked against the reviewed phrase pack before any
claim is made about coverage — the five-language list in `ai_prompts.py` is what
the demo is prepared to show, not a measured capability.
