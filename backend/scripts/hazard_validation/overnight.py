"""Overnight landslide-model experiments. Research only - nothing here is imported
by the API, and nothing it produces is deployed (docs/MODEL_REGISTRY.md).

    .runtime/ml-venv/Scripts/python.exe backend/scripts/hazard_validation/overnight.py [--hours 6] [--expand]

LOOP  data ready? -> baseline -> candidates x feature sets x seeds -> validate on
      the temporal AND geographic holdouts -> checkpoint every result ->
      calibrate the best -> error + hard-negative analysis -> (--expand) build
      the India-wide dataset from the full NASA GLC export (one download, ERA5
      rain per site with backoff - never hammering Open-Meteo) and repeat with
      the NER as the geographic holdout -> final leaderboard.

RULES  no random split of hazard data; thresholds chosen on TRAIN (out-of-fold);
       recall reported beside accuracy; 98% is a target, never a claim.
Bounded: n_jobs=2 for the forests, one archive request at a time.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate_landslide as ev  # noqa: E402
import build_landslide_dataset as build  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
HAZ = ROOT / ".runtime" / "data" / "hazard"
EXP = HAZ / "experiments"
LEADER = EXP / "leaderboard.json"
LOG = ROOT / ".runtime" / "hazard-overnight.log"
GLC_URL = "https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv"
GLC_FULL = HAZ / "glc_full.csv"
GLC_INDIA = HAZ / "glc_india.csv"
INDIA_DATA = HAZ / "landslide_dataset_india.csv"
INDIA_META = HAZ / "landslide_dataset_india.meta.json"
NER_LON, NER_LAT = 89.5, (21.5, 29.5)

FEATURE_SETS = {
    "FULL": ev.FEATURES_SAME_DAY,
    "RAIN_ONLY": ["p1", "p3", "p7", "p15", "p30", "max7", "sin_m", "cos_m"],
    "NO_MONTH": ["p1", "p3", "p7", "p15", "p30", "max7", "elevation", "slope"],
    "LEAD1": ev.FEATURES_LEAD1,
}


def log(msg: str) -> None:
    line = f"{datetime.utcnow().isoformat(timespec='seconds')}Z {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def make(model: str, seed: int):
    if model == "LOGREG":
        return make_pipeline(StandardScaler(), LogisticRegression(C=0.5, class_weight="balanced", max_iter=3000))
    if model == "RF":
        return RandomForestClassifier(n_estimators=400, min_samples_leaf=5, class_weight="balanced_subsample", n_jobs=2, random_state=seed)
    if model == "HGB":
        return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=10,
                                              l2_regularization=1.0, class_weight="balanced", random_state=seed)
    raise ValueError(model)


def xy(rows, feats):
    return np.array([[r[f] for f in feats] for r in rows], dtype=float), np.array([r["label"] for r in rows], dtype=int)


def threshold_recall_first(p_oof, y, target=0.90):
    """Lowest-FPR threshold with out-of-fold TRAIN recall >= target."""
    for cand in [i / 100 for i in range(50, 4, -1)]:
        if ev.metrics(list(p_oof), list(y), cand)["recall"] >= target:
            return cand
    return 0.05


def fn_taxonomy(valid, p, thr):
    from collections import Counter
    tax, rows = Counter(), []
    for r, pi in zip(valid, p):
        if not r["label"] or pi >= thr:
            continue
        if r["trigger"] in ("mining", "construction", "other", "unknown"):
            cause = "NON_RAIN_TRIGGER"
        elif r["p3"] < 20 and r["p7"] < 40:
            cause = "DRY_IN_ERA5"
        elif r["slope"] < 0.05:
            cause = "FLAT_SITE"
        else:
            cause = "MODEL_ERROR"
        tax[cause] += 1
        rows.append({"event_id": r["event_id"], "date": r["date"], "state": r["state"], "trigger": r["trigger"], "p1": r["p1"], "p3": r["p3"], "slope": r["slope"], "p": round(float(pi), 3), "cause": cause})
    return {"count": len(rows), "taxonomy": dict(tax), "rows": rows[:30]}


def hard_negatives(valid, p, n=10):
    neg = sorted(((float(pi), r) for r, pi in zip(valid, p) if not r["label"]), key=lambda t: -t[0])[:n]
    return [{"date": r["date"], "state": r["state"], "p1": r["p1"], "p3": r["p3"], "p7": r["p7"], "slope": r["slope"], "p": round(pi, 3)} for pi, r in neg]


def run_one(name, model, feats, seed, train, valid, calibrate=False) -> dict:
    Xt, yt = xy(train, feats); Xv, yv = xy(valid, feats)
    clf = make(model, seed)
    if calibrate:
        clf = CalibratedClassifierCV(clf, method="isotonic", cv=StratifiedKFold(5, shuffle=True, random_state=seed))
    oof = cross_val_predict(clf, Xt, yt, cv=StratifiedKFold(5, shuffle=True, random_state=seed), method="predict_proba")[:, 1]
    thr = threshold_recall_first(oof, yt)
    clf.fit(Xt, yt)
    pv = clf.predict_proba(Xv)[:, 1]
    out = {"name": name, "model": model, "features": feats, "seed": seed, "calibrated": calibrate, "threshold_train_oof": thr,
           "train": {"events": int(yt.sum()), "non_events": int(len(yt) - yt.sum())}, "valid": {"events": int(yv.sum()), "non_events": int(len(yv) - yv.sum())},
           "at_0.5": ev.metrics(list(pv), list(yv), 0.5), "recall_first": ev.metrics(list(pv), list(yv), thr),
           "train_oof_at_thr": ev.metrics(list(oof), list(yt), thr),
           "false_negatives": fn_taxonomy(valid, pv, thr), "hard_negatives": hard_negatives(valid, pv)}
    if model == "RF":
        out["importance"] = {f: round(float(i), 4) for f, i in zip(feats, clf.feature_importances_)}
    if model == "LOGREG" and not calibrate:
        out["weights"] = {f: round(float(w), 3) for f, w in zip(feats, clf[-1].coef_[0])}
    return out


def splits_for(rows, dataset: str):
    if dataset == "NER":
        return {
            "TEMPORAL": ([r for r in rows if r["year"] <= 2014], [r for r in rows if r["year"] >= 2015]),
            "GEOGRAPHIC": ([r for r in rows if r["site_lon"] < 93.5], [r for r in rows if r["site_lon"] >= 93.5]),
        }
    ner = lambda r: r["site_lon"] >= NER_LON and NER_LAT[0] <= r["site_lat"] <= NER_LAT[1]  # noqa: E731
    return {
        "TEMPORAL": ([r for r in rows if r["year"] <= 2014], [r for r in rows if r["year"] >= 2015]),
        "GEOGRAPHIC_NER_HOLDOUT": ([r for r in rows if not ner(r)], [r for r in rows if ner(r)]),
    }


def grid(rows, dataset: str, deadline: float, seeds=(0, 1, 2)) -> list[dict]:
    results = []
    sp = splits_for(rows, dataset)
    # baseline rule on every split
    for sname, (train, valid) in sp.items():
        yv = [r["label"] for r in valid]
        results.append({"dataset": dataset, "split": sname, "name": "RULE", "model": "RULE", "recall_first": ev.metrics([ev.rule(r) for r in valid], yv, 0.5), "at_0.5": ev.metrics([ev.rule(r) for r in valid], yv, 0.5)})
        checkpoint(results[-1])
    for model in ("LOGREG", "RF", "HGB"):
        for fs_name, feats in FEATURE_SETS.items():
            for seed in (seeds if model != "LOGREG" else (0,)):
                if time.time() > deadline:
                    log("time budget reached; stopping grid"); return results
                for sname, (train, valid) in sp.items():
                    r = run_one(f"{model}/{fs_name}/s{seed}", model, feats, seed, train, valid)
                    r.update(dataset=dataset, split=sname)
                    results.append(r); checkpoint(r)
                    log(f"{dataset} {sname} {r['name']}: PR-AUC {r['recall_first']['pr_auc']} ROC {r['recall_first']['roc_auc']} recall {r['recall_first']['recall']} FPR {r['recall_first']['false_positive_rate']} Brier {r['recall_first']['brier']}")
    return results


def checkpoint(r: dict) -> None:
    EXP.mkdir(parents=True, exist_ok=True)
    p = EXP / f"{r['dataset']}_{r['split']}_{r['name'].replace('/', '_')}.json"
    p.write_text(json.dumps(r, indent=1), encoding="utf-8")


def leaderboard(results: list[dict]) -> dict:
    """Best = highest mean PR-AUC across splits among runs with recall >= 0.70 at the train-chosen threshold."""
    by = {}
    for r in results:
        if r["model"] == "RULE":
            continue
        by.setdefault((r["dataset"], r["name"]), {})[r["split"]] = r
    board = []
    for (ds, name), per in by.items():
        pr = [v["recall_first"]["pr_auc"] or 0 for v in per.values()]
        rec = [v["recall_first"]["recall"] for v in per.values()]
        board.append({"dataset": ds, "name": name, "mean_pr_auc": round(sum(pr) / len(pr), 4), "min_recall": round(min(rec), 4),
                      "mean_roc_auc": round(sum((v["recall_first"]["roc_auc"] or 0) for v in per.values()) / len(per), 4),
                      "mean_brier": round(sum(v["recall_first"]["brier"] for v in per.values()) / len(per), 4),
                      "splits": {k: {"recall": v["recall_first"]["recall"], "fpr": v["recall_first"]["false_positive_rate"], "accuracy": v["recall_first"]["accuracy"], "f1": v["recall_first"]["f1"]} for k, v in per.items()}})
    board.sort(key=lambda b: (b["min_recall"] >= 0.70, b["mean_pr_auc"]), reverse=True)
    return {"updated_at": datetime.utcnow().isoformat() + "Z", "board": board}


def calibrate_best(rows, dataset, board, deadline) -> list[dict]:
    out = []
    best = next((b for b in board["board"] if b["dataset"] == dataset), None)
    if not best or time.time() > deadline:
        return out
    model, fs_name, seed = best["name"].split("/")
    feats = FEATURE_SETS[fs_name]
    for sname, (train, valid) in splits_for(rows, dataset).items():
        r = run_one(f"{model}/{fs_name}/{seed}/CALIBRATED", model, feats, int(seed[1:]), train, valid, calibrate=True)
        r.update(dataset=dataset, split=sname); out.append(r); checkpoint(r)
        log(f"{dataset} {sname} CALIBRATED {best['name']}: Brier {r['recall_first']['brier']} recall {r['recall_first']['recall']} bins {r['recall_first']['calibration']}")
    return out


def load_rows(path: Path) -> list[dict]:
    ev.DATA = path
    return ev.load()


def expand_dataset() -> Path | None:
    """India-wide GLC (<=5 km accuracy, 2007-2017) through the same builder."""
    import httpx
    if not GLC_FULL.exists():
        log("downloading the full NASA GLC export (one request)")
        with httpx.Client(timeout=120, headers={"User-Agent": build.UA}, follow_redirects=True) as c:
            r = c.get(GLC_URL)
            if r.status_code != 200:
                log(f"GLC download failed: HTTP {r.status_code}; expansion skipped"); return None
            GLC_FULL.write_bytes(r.content)
    with GLC_FULL.open(encoding="utf-8", newline="") as f, GLC_INDIA.open("w", encoding="utf-8", newline="") as g:
        rd = csv.DictReader(f)
        w = csv.DictWriter(g, fieldnames=rd.fieldnames); w.writeheader()
        n = 0
        for r in rd:
            if r.get("country_name") == "India" and r.get("location_accuracy") in build.GOOD_ACCURACY:
                w.writerow(r); n += 1
    log(f"India rows with usable accuracy: {n}")
    build.CSV, build.OUT, build.META = GLC_INDIA, INDIA_DATA, INDIA_META
    build.main()
    return INDIA_DATA


def write_md(board_all: dict, expanded: bool) -> None:
    lines = ["# Overnight landslide experiments (research, nothing deployed)", "",
             f"Updated {board_all['updated_at']}. Datasets: NER slice (241 events / 964 quiet days)" + (", India-wide (see meta)" if expanded else "") + ".",
             "Threshold chosen on TRAIN out-of-fold for recall >= 0.90; every number below is HELD-OUT. Best = mean PR-AUC across splits with min recall >= 0.70.", "",
             "| dataset | run | mean PR-AUC | mean ROC-AUC | min recall | mean Brier | per split (recall / FPR / acc / F1) |", "|---|---|---|---|---|---|---|"]
    for b in board_all["board"][:25]:
        per = "; ".join(f"{k}: {v['recall']:.2f} / {v['fpr']:.2f} / {v['accuracy']:.2f} / {v['f1']:.2f}" for k, v in b["splits"].items())
        lines.append(f"| {b['dataset']} | {b['name']} | {b['mean_pr_auc']:.3f} | {b['mean_roc_auc']:.3f} | {b['min_recall']:.2f} | {b['mean_brier']:.3f} | {per} |")
    lines += ["", "98% target: NOT reached on any held-out split (see accuracy column; recall-first thresholds trade accuracy for recall by design).",
              "Status: EXPERIMENTAL. See `docs/MODEL_REGISTRY.md`. Raw checkpoints: `.runtime/data/hazard/experiments/`."]
    (ROOT / "docs" / "HAZARD_EXPERIMENTS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--hours", type=float, default=6.0); ap.add_argument("--expand", action="store_true")
    a = ap.parse_args()
    deadline = time.time() + a.hours * 3600
    log(f"overnight start: budget {a.hours} h, expand={a.expand}")
    results: list[dict] = []
    rows = load_rows(HAZ / "landslide_dataset.csv")
    log(f"NER dataset rows {len(rows)}")
    results += grid(rows, "NER", deadline)
    board = leaderboard(results); LEADER.write_text(json.dumps(board, indent=1), encoding="utf-8")
    results += calibrate_best(rows, "NER", board, deadline)
    expanded = False
    if a.expand and time.time() < deadline:
        try:
            path = expand_dataset()
            if path:
                rows_in = load_rows(path)
                log(f"India dataset rows {len(rows_in)}")
                results += grid(rows_in, "INDIA", deadline)
                board = leaderboard(results); LEADER.write_text(json.dumps(board, indent=1), encoding="utf-8")
                results += calibrate_best(rows_in, "INDIA", board, deadline)
                expanded = True
        except Exception as exc:  # noqa: BLE001 - research must not die on one provider
            log(f"expansion failed: {type(exc).__name__}: {exc}")
    board = leaderboard(results); LEADER.write_text(json.dumps(board, indent=1), encoding="utf-8")
    write_md(board, expanded)
    log(f"overnight done: {len(results)} runs; best {board['board'][0] if board['board'] else None}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
