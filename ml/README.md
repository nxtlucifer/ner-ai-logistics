# ml/

Offline model training and evaluation. **Nothing here is trained yet.**

Models are trained here, exported as versioned artefacts, and loaded by the
backend at startup. Training never runs inside the API process, and no model
updates itself from production data.

## Planned structure

```
ml/
  fuel/          Fuel consumption model (phase P10)
    generate.py    Physics-informed synthetic trip generator
    features.py    Feature engineering
    baseline.py    The km/l heuristic the model must beat
    train.py       LightGBM training + held-out evaluation
  risk/          Route risk model (phase P10+)
  eta/           ETA residual-correction model
  artifacts/     Trained binaries - git-ignored, never committed
```

## Rules

Every model in this directory must satisfy
[docs/AI_MODELS.md](../docs/AI_MODELS.md) §0:

1. It ships with a baseline it must beat, and the baseline stays in the code as
   the permanent fallback.
2. Evaluation is on a held-out set, split by route corridor rather than randomly.
3. No accuracy figure is stated anywhere unless it is recorded in
   [docs/AI_MODELS.md](../docs/AI_MODELS.md) §7 with its date and whether the
   data was synthetic.
4. Training is reproducible from a fixed seed.

The fuel model will be trained on **synthetic** data, because no real NER truck
fuel logs exist. That must be disclosed every time a number from it is shown.

See [docs/DEVELOPMENT_ROADMAP.md](../docs/DEVELOPMENT_ROADMAP.md) phase P10.
