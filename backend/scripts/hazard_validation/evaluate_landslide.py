"""Held-out validation of "will a landslide be reported here today?" from rain,
terrain and season - the honest version of the 98% question.

  backend/.venv/Scripts/python.exe backend/scripts/hazard_validation/evaluate_landslide.py

Reads .runtime/data/hazard/landslide_dataset.csv (build_landslide_dataset.py),
writes .runtime/evidence/hazard-validation.json and docs/HAZARD_VALIDATION.md.

SPLITS (never random):
  TEMPORAL     train 2007-2014, validate 2015-2017
  GEOGRAPHIC   train west of 93.5 E (Assam, Meghalaya, west Arunachal),
               validate east of it (Nagaland, Manipur, Mizoram, east Arunachal)
MODELS, in the order the mission asks:
  RULE     the production rain rule's daily analogue: IMD "heavy rain" day
           (>= 64.5 mm) OR 3-day >= 100 mm. No fitting; the same on every split.
  LOGREG   logistic regression on standardised features, L2, gradient descent,
           written in plain Python so no dependency is added for research.
  Each LOGREG is reported at 0.5 and at a RECALL-FIRST threshold chosen on
  the TRAINING split (recall >= 0.90 there), because a missed landslide costs
  more than a cautious warning.
METRICS: accuracy, precision, recall, specificity, F1, FNR, FPR, ROC-AUC,
PR-AUC, Brier, confusion matrix, 5-bin calibration, counts. Lead time is 0
days for the same-day feature set and 1 day for the "lead-1" set (which drops
event-day rain) - both are reported.

No deep learning, no tree, no tuning against the validation split.
"""

from __future__ import annotations

import csv
import json
import math
import random
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / ".runtime" / "data" / "hazard" / "landslide_dataset.csv"
META = ROOT / ".runtime" / "data" / "hazard" / "landslide_dataset.meta.json"
OUT_JSON = ROOT / ".runtime" / "evidence" / "hazard-validation.json"
OUT_MD = ROOT / "docs" / "HAZARD_VALIDATION.md"
FEATURES_SAME_DAY = ["p1", "p3", "p7", "p15", "p30", "max7", "elevation", "slope", "sin_m", "cos_m"]
FEATURES_LEAD1 = ["p3_lead1", "p7", "p15", "p30", "elevation", "slope", "sin_m", "cos_m"]  # p7/p15/p30 include yesterday; p1 excluded
random.seed(26002)


def load() -> list[dict]:
    rows = []
    with DATA.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["slope"] in ("", "None") or r["elevation"] in ("", "None") or r["p3_lead1"] in ("", "None"):
                continue
            m = int(r["date"][5:7])
            rows.append({**{k: float(r[k]) for k in ("p1", "p3", "p7", "p15", "p30", "max7", "p3_lead1", "elevation", "slope", "site_lat", "site_lon")},
                         "label": int(r["label"]), "date": r["date"], "year": int(r["date"][:4]), "state": r["state"], "trigger": r["trigger"],
                         "event_id": r["event_id"], "accuracy": r["accuracy"],
                         "sin_m": math.sin(2 * math.pi * m / 12), "cos_m": math.cos(2 * math.pi * m / 12)})
    return rows


# --- plain-Python logistic regression -----------------------------------------
def standardise(train: list[dict], feats: list[str]):
    mu = {f: sum(r[f] for r in train) / len(train) for f in feats}
    sd = {f: (sum((r[f] - mu[f]) ** 2 for r in train) / len(train)) ** 0.5 or 1.0 for f in feats}
    return lambda r: [(r[f] - mu[f]) / sd[f] for f in feats], {"mean": mu, "sd": sd}


def fit_logreg(X: list[list[float]], y: list[int], l2: float = 1.0, epochs: int = 400, lr: float = 0.1) -> list[float]:
    n, d = len(X), len(X[0])
    w = [0.0] * (d + 1)  # bias last
    pos = sum(y); neg = n - pos
    wpos, wneg = n / (2 * pos), n / (2 * neg)  # balanced classes
    for _ in range(epochs):
        g = [0.0] * (d + 1)
        for xi, yi in zip(X, y):
            z = sum(wi * xj for wi, xj in zip(w[:-1], xi)) + w[-1]
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            e = (p - yi) * (wpos if yi else wneg)
            for j in range(d):
                g[j] += e * xi[j]
            g[-1] += e
        for j in range(d):
            w[j] -= lr * (g[j] / n + l2 * w[j] / n)
        w[-1] -= lr * g[-1] / n
    return w


def predict(w: list[float], X: list[list[float]]) -> list[float]:
    out = []
    for xi in X:
        z = sum(wi * xj for wi, xj in zip(w[:-1], xi)) + w[-1]
        out.append(1 / (1 + math.exp(-max(-30, min(30, z)))))
    return out


# --- metrics --------------------------------------------------------------------
def auc_roc(p: list[float], y: list[int]) -> float | None:
    pos = [pi for pi, yi in zip(p, y) if yi]; neg = [pi for pi, yi in zip(p, y) if not yi]
    if not pos or not neg:
        return None
    s = 0.0
    for a in pos:
        for b in neg:
            s += 1.0 if a > b else 0.5 if a == b else 0.0
    return s / (len(pos) * len(neg))


def auc_pr(p: list[float], y: list[int]) -> float | None:
    if not any(y):
        return None
    order = sorted(range(len(p)), key=lambda i: -p[i])
    tp = fp = 0; fn = sum(y)
    prev_r, prev_p, area = 0.0, 1.0, 0.0
    for i in order:
        if y[i]:
            tp += 1; fn -= 1
        else:
            fp += 1
        r = tp / (tp + fn); pr = tp / (tp + fp)
        area += (r - prev_r) * (pr + prev_p) / 2
        prev_r, prev_p = r, pr
    return area


def metrics(p: list[float], y: list[int], thr: float) -> dict:
    tp = sum(1 for pi, yi in zip(p, y) if pi >= thr and yi)
    fp = sum(1 for pi, yi in zip(p, y) if pi >= thr and not yi)
    fn = sum(1 for pi, yi in zip(p, y) if pi < thr and yi)
    tn = sum(1 for pi, yi in zip(p, y) if pi < thr and not yi)
    n = tp + fp + fn + tn
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    spec = tn / (tn + fp) if tn + fp else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    bins = []
    for b in range(5):
        lo, hi = b / 5, (b + 1) / 5
        idx = [i for i, pi in enumerate(p) if lo <= pi < hi or (b == 4 and pi == 1.0)]
        if idx:
            bins.append({"bin": f"{lo:.1f}-{hi:.1f}", "n": len(idx), "mean_pred": round(sum(p[i] for i in idx) / len(idx), 3), "observed": round(sum(y[i] for i in idx) / len(idx), 3)})
    return {"threshold": thr, "n": n, "events": tp + fn, "non_events": fp + tn,
            "accuracy": round((tp + tn) / n, 4), "precision": round(prec, 4), "recall": round(rec, 4), "specificity": round(spec, 4),
            "f1": round(f1, 4), "false_negative_rate": round(1 - rec, 4), "false_positive_rate": round(1 - spec, 4),
            "roc_auc": None if (a := auc_roc(p, y)) is None else round(a, 4), "pr_auc": None if (a := auc_pr(p, y)) is None else round(a, 4),
            "brier": round(sum((pi - yi) ** 2 for pi, yi in zip(p, y)) / n, 4),
            "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn}, "calibration": bins}


def rule(r: dict) -> float:
    return 1.0 if (r["p1"] >= 64.5 or r["p3"] >= 100.0) else 0.0


def rule_lead1(r: dict) -> float:
    return 1.0 if r["p3_lead1"] >= 100.0 else 0.0


def evaluate(train: list[dict], valid: list[dict], feats: list[str], lead: int) -> dict:
    yt = [r["label"] for r in train]; yv = [r["label"] for r in valid]
    out = {"lead_days": lead, "train": {"events": sum(yt), "non_events": len(yt) - sum(yt)}, "valid": {"events": sum(yv), "non_events": len(yv) - sum(yv)}}
    rf = rule_lead1 if lead else rule
    out["RULE"] = metrics([rf(r) for r in valid], yv, 0.5)
    norm, scaler = standardise(train, feats)
    w = fit_logreg([norm(r) for r in train], yt)
    pt = predict(w, [norm(r) for r in train]); pv = predict(w, [norm(r) for r in valid])
    # recall-first threshold chosen on TRAIN only
    thr = 0.5
    for cand in [i / 100 for i in range(50, 4, -1)]:
        if metrics(pt, yt, cand)["recall"] >= 0.90:
            thr = cand; break
    out["LOGREG_0.5"] = metrics(pv, yv, 0.5)
    out["LOGREG_RECALL_FIRST"] = metrics(pv, yv, thr)
    out["LOGREG_train_0.5"] = metrics(pt, yt, 0.5)
    out["weights"] = {f: round(wi, 3) for f, wi in zip(feats, w[:-1])} | {"bias": round(w[-1], 3)}
    # false negatives at the recall-first point, with why
    missed = [r for r, pi in zip(valid, pv) if r["label"] and pi < thr]
    tax = Counter()
    fn_rows = []
    for r in missed:
        if r["trigger"] in ("mining", "construction", "other", "unknown"):
            cause = "NON_RAIN_TRIGGER"
        elif r["p3"] < 20 and r["p7"] < 40:
            cause = "DRY_IN_ERA5 (date or location uncertainty, or sub-grid rain)"
        elif r["slope"] < 0.05:
            cause = "FLAT_SITE (location accuracy coarser than the DEM)"
        else:
            cause = "MODEL_ERROR"
        tax[cause] += 1
        fn_rows.append({"event_id": r["event_id"], "date": r["date"], "state": r["state"], "trigger": r["trigger"], "accuracy": r["accuracy"],
                        "p1": r["p1"], "p3": r["p3"], "p7": r["p7"], "slope": r["slope"], "cause": cause})
    out["false_negatives"] = {"count": len(missed), "taxonomy": dict(tax), "rows": fn_rows[:40]}
    return out


def main() -> None:
    rows = load()
    meta = json.loads(META.read_text(encoding="utf-8"))
    results = {"built_at": datetime.utcnow().isoformat() + "Z", "dataset": meta, "rows_used": len(rows), "splits": {}}
    splits = {
        "TEMPORAL": ([r for r in rows if r["year"] <= 2014], [r for r in rows if r["year"] >= 2015], "train 2007-2014, validate 2015-2017"),
        "GEOGRAPHIC": ([r for r in rows if r["site_lon"] < 93.5], [r for r in rows if r["site_lon"] >= 93.5], "train lon < 93.5E (west), validate lon >= 93.5E (east)"),
    }
    for name, (train, valid, desc) in splits.items():
        results["splits"][name] = {"description": desc,
                                   "same_day": evaluate(train, valid, FEATURES_SAME_DAY, 0),
                                   "lead_1": evaluate(train, valid, FEATURES_LEAD1, 1)}
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(results, indent=2), encoding="utf-8")
    write_md(results)
    print(json.dumps({s: {k: {m: results["splits"][s][k][m]["recall"] for m in ("RULE", "LOGREG_0.5", "LOGREG_RECALL_FIRST")} for k in ("same_day", "lead_1")} for s in results["splits"]}, indent=1))


def write_md(res: dict) -> None:
    d = res["dataset"]
    lines = [
        "# Hazard validation — landslide (rain + terrain + season)",
        "",
        f"Generated {res['built_at']} by `backend/scripts/hazard_validation/evaluate_landslide.py`. Raw numbers: `.runtime/evidence/hazard-validation.json`.",
        "",
        "**Claim boundary.** These are held-out results for one narrow question — *given the rain ERA5-Land recorded at a catalogued site, would a landslide be reported there that day?* — on a news-derived inventory. They are NOT a claim that RASTA predicts landslides in operation, and no number below reaches the app: the deterministic route-risk rule stays the only authority. Model status: **EXPERIMENTAL** (see `docs/MODEL_REGISTRY.md`).",
        "",
        "## Dataset",
        "",
        f"- Events: NASA Global Landslide Catalog, NER slice, {d['usable_events']} of {d['events_in_slice']} events with location accuracy exact/1 km/5 km and a date (2007–2017), {d['sites']} sites.",
        f"- Non-events: {d['negatives']} quiet days at the same sites (no catalogued event within {d['exclusion_km']} km and ±{d['exclusion_days']} days, any accuracy). Rows used after dropping incomplete features: {res['rows_used']}.",
        f"- Rain: {d['rain_source']}. Terrain: {d['dem_source']}, slope proxy from four samples ~250 m around the site.",
        "- Known label noise: the catalogue is compiled from news reports, so an unreported slide on a 'quiet' day is a false negative in the LABELS, and event dates can be the report date rather than the failure date. Sample size is small for a 98% claim.",
        "",
        "## Results (validation split only; nothing tuned on it)",
        "",
    ]
    for split, s in res["splits"].items():
        lines += [f"### {split} — {s['description']}", ""]
        for key, title in (("same_day", "Same-day rain (lead 0 d)"), ("lead_1", "Rain up to the day before (lead 1 d)")):
            e = s[key]
            lines += [f"**{title}** — train {e['train']['events']} events / {e['train']['non_events']} non-events; validate {e['valid']['events']} / {e['valid']['non_events']}", "",
                      "| Model | Acc | Prec | Recall | Spec | F1 | FNR | FPR | ROC-AUC | PR-AUC | Brier | TP/FP/FN/TN |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
            for m, label in (("RULE", "Rule (≥64.5 mm/day or ≥100 mm/3 d)" if key == "same_day" else "Rule (≥100 mm/3 d to yesterday)"), ("LOGREG_0.5", "LogReg @0.5"), ("LOGREG_RECALL_FIRST", f"LogReg recall-first @{e['LOGREG_RECALL_FIRST']['threshold']}")):
                r = e[m]; c = r["confusion"]
                lines.append(f"| {label} | {r['accuracy']:.3f} | {r['precision']:.3f} | {r['recall']:.3f} | {r['specificity']:.3f} | {r['f1']:.3f} | {r['false_negative_rate']:.3f} | {r['false_positive_rate']:.3f} | {r['roc_auc'] if r['roc_auc'] is not None else '—'} | {r['pr_auc'] if r['pr_auc'] is not None else '—'} | {r['brier']:.3f} | {c['tp']}/{c['fp']}/{c['fn']}/{c['tn']} |")
            cal = e["LOGREG_0.5"]["calibration"]
            lines += ["", "Calibration (LogReg): " + ", ".join(f"{b['bin']}: pred {b['mean_pred']} vs obs {b['observed']} (n={b['n']})" for b in cal), ""]
            fn = e["false_negatives"]
            lines += [f"False negatives at the recall-first point: {fn['count']} — " + ", ".join(f"{k}: {v}" for k, v in fn["taxonomy"].items()), ""]
    lines += ["## Gate", "",
              "98% is the target, not the result. The 98% claim gate (held-out set, no leakage, temporal AND geographic splits, hazard-specific metrics, false-negative review, meaningful sample) is applied above; the outcome is written in the final report as ACHIEVED / NOT_ACHIEVED with the actual best figures, never rounded up.", ""]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
