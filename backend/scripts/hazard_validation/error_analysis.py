"""Error analysis for the India-wide -> NER landslide model (research only).

    .runtime/ml-venv/Scripts/python.exe backend/scripts/hazard_validation/error_analysis.py

Fits the registry's v0.4 candidate (logistic regression, BASE features,
all-India minus NER, negatives as built), then on the UNTOUCHED NER holdout:
  * threshold table (recall / precision / FPR / FNR / F1 per threshold) - the
    thresholds are only DESCRIBED here; the operating point stays the one chosen
    on TRAIN out-of-fold (never on this holdout)
  * false positives vs true positives: median / IQR of every feature, season,
    susceptibility class, GLC location accuracy and trigger of the matched event
  * where the FPs cluster (month, state, susceptibility)
Writes .runtime/evidence/hazard-error-analysis.json and docs/HAZARD_ERROR_ANALYSIS.md.
No new model, no new feature: this is the "missing signal?" step of the loop.
"""

from __future__ import annotations

import json
import statistics as st
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate_landslide as ev  # noqa: E402
import experiments_v2 as v2  # noqa: E402
import overnight as ov  # noqa: E402

ROOT = ov.ROOT
FEATS = v2.BASE
OUT_JSON = ROOT / ".runtime" / "evidence" / "hazard-error-analysis.json"
OUT_MD = ROOT / "docs" / "HAZARD_ERROR_ANALYSIS.md"


def q(values):
    vals = sorted(float(v) for v in values if v is not None)
    if not vals:
        return None
    return {"median": round(st.median(vals), 2), "p25": round(vals[len(vals) // 4], 2), "p75": round(vals[3 * len(vals) // 4], 2), "n": len(vals)}


def main() -> int:
    rows = v2.load("INDIA")
    train, hold = ov.splits_for(rows, "INDIA")["GEOGRAPHIC_NER_HOLDOUT"]
    assert not any(v2.load("INDIA") and (r["site_lon"] >= ov.NER_LON and ov.NER_LAT[0] <= r["site_lat"] <= ov.NER_LAT[1]) for r in train), "NER row in training"
    Xt, yt = ov.xy(train, FEATS); Xh, yh = ov.xy(hold, FEATS)
    clf = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, class_weight="balanced", max_iter=3000))
    oof = cross_val_predict(clf, Xt, yt, cv=StratifiedKFold(5, shuffle=True, random_state=0), method="predict_proba")[:, 1]
    thr = ov.threshold_recall_first(oof, yt)
    clf.fit(Xt, yt)
    ph = clf.predict_proba(Xh)[:, 1]

    table = []
    for t in [i / 20 for i in range(1, 20)]:
        m = ev.metrics(list(ph), list(yh), t)
        table.append({"threshold": t, "recall": m["recall"], "precision": m["precision"], "fpr": m["false_positive_rate"], "fnr": m["false_negative_rate"], "f1": m["f1"], "accuracy": m["accuracy"]})
    at_thr = ev.metrics(list(ph), list(yh), thr)

    tp = [r for r, p in zip(hold, ph) if r["label"] and p >= thr]
    fp = [r for r, p in zip(hold, ph) if not r["label"] and p >= thr]
    tn = [r for r, p in zip(hold, ph) if not r["label"] and p < thr]
    fn = [r for r, p in zip(hold, ph) if r["label"] and p < thr]
    feats = FEATS + ["susc"]
    compare = {f: {"TP": q(r.get(f) for r in tp), "FP": q(r.get(f) for r in fp), "TN": q(r.get(f) for r in tn)} for f in feats}
    month = lambda r: int(r["date"][5:7])  # noqa: E731
    clusters = {
        "fp_by_month": dict(sorted(Counter(month(r) for r in fp).items())),
        "tp_by_month": dict(sorted(Counter(month(r) for r in tp).items())),
        "tn_by_month": dict(sorted(Counter(month(r) for r in tn).items())),
        "fp_by_state": dict(Counter(r["state"] for r in fp).most_common(8)),
        "fp_by_susceptibility": dict(sorted(Counter(r.get("susc") for r in fp).items(), key=lambda kv: str(kv[0]))),
        "tp_by_susceptibility": dict(sorted(Counter(r.get("susc") for r in tp).items(), key=lambda kv: str(kv[0]))),
        "fp_wet_share_p3_ge_50mm": round(sum(1 for r in fp if r["p3"] >= 50) / max(1, len(fp)), 3),
        "tp_wet_share_p3_ge_50mm": round(sum(1 for r in tp if r["p3"] >= 50) / max(1, len(tp)), 3),
        "fp_dry_share_p3_lt_10mm": round(sum(1 for r in fp if r["p3"] < 10) / max(1, len(fp)), 3),
        "events_location_accuracy": dict(Counter(r["accuracy"] for r in hold if r["label"])),
        "events_trigger": dict(Counter(r["trigger"] for r in hold if r["label"]).most_common(6)),
        "fn_rows": [{"date": r["date"], "state": r["state"], "trigger": r["trigger"], "p3": r["p3"], "p7": r["p7"], "slope": r["slope"], "susc": r.get("susc")} for r in fn][:10],
    }
    # Same-site test: negatives are quiet days at EVENT sites, so a site-level
    # feature (slope, elevation, susceptibility) can never separate them; only
    # the rain features can. How much of the score is site vs rain?
    weights = {f: round(float(w), 3) for f, w in zip(FEATS, clf[-1].coef_[0])}
    out = {"holdout": {"n": len(hold), "events": int(yh.sum()), "sites": len({(r["site_lat"], r["site_lon"]) for r in hold})},
           "operating_threshold_train_oof": thr, "at_operating_threshold": at_thr, "threshold_table": table,
           "feature_compare": compare, "clusters": clusters, "weights": weights,
           "reading": [
               "Negatives are quiet days at the SAME sites as the events (build_landslide_dataset.py), so slope, elevation and susceptibility are identical between TP and FP by construction - they cannot lower FPR on this design; only rainfall features can.",
               "FPs concentrate in the monsoon months with high p3/p7: the model cannot tell a wet day WITH a slide from a wet day WITHOUT one at the same site from daily ERA5-Land totals alone.",
               "Missing signal (legitimate sources to test next): sub-daily rain intensity (peak 1h/3h/6h - IMERG half-hourly or ERA5 hourly via Open-Meteo), soil moisture (SMAP/ERA5-Land swvl), and cross-site negatives (quiet days at non-event sites) so site features carry information.",
           ]}
    OUT_JSON.write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")
    lines = ["# Landslide model error analysis (India-wide -> NER holdout, research)", "",
             f"Holdout n={len(hold)}, events={int(yh.sum())}, sites={out['holdout']['sites']}. Operating threshold {thr} chosen on TRAIN out-of-fold (recall >= 0.90); the table below only describes the trade-off on the holdout and is not used to choose anything.", "",
             "| threshold | recall | precision | FPR | FNR | F1 | accuracy |", "|---|---|---|---|---|---|---|"]
    lines += [f"| {t['threshold']:.2f} | {t['recall']:.2f} | {t['precision']:.2f} | {t['fpr']:.2f} | {t['fnr']:.2f} | {t['f1']:.2f} | {t['accuracy']:.2f} |" for t in table]
    lines += ["", "## True positives vs false positives (median [p25-p75])", "", "| feature | TP | FP | TN |", "|---|---|---|---|"]
    fmt = lambda d: "-" if not d else f"{d['median']} [{d['p25']}-{d['p75']}]"  # noqa: E731
    lines += [f"| {f} | {fmt(c['TP'])} | {fmt(c['FP'])} | {fmt(c['TN'])} |" for f, c in compare.items()]
    lines += ["", "## Clusters", "", "```", json.dumps({k: v for k, v in clusters.items() if k != 'fn_rows'}, indent=1, default=str), "```", "",
              "## Reading", ""] + [f"- {r}" for r in out["reading"]] + ["", f"Logistic weights (standardised): `{weights}`", ""]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"thr": thr, "at_thr": {k: at_thr[k] for k in ("recall", "precision", "false_positive_rate", "f1")}, "fp": len(fp), "tp": len(tp), "tn": len(tn), "fn": len(fn)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
