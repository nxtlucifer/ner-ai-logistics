"""Landslide model V2 experiments (research only; nothing deployed).

    .runtime/ml-venv/Scripts/python.exe backend/scripts/hazard_validation/experiments_v2.py [--datasets NER,NER_SM,INDIA]

What is new against the overnight grid:
  * datasets: NER (random quiet-day negatives), NER_SM (season-matched negatives,
    k=6 - the model cannot pass by learning "monsoon"), INDIA (605 GLC events,
    NER held out geographically) when its build has finished
  * features: FULL + NASA LHASA susceptibility class (1 km, official product) and,
    where fetched, SoilGrids texture (clay/sand/silt/bdod, 0-5 cm)
  * selection: mean PR-AUC across the two holdouts subject to min recall >= 0.80;
    thresholds chosen on TRAIN out-of-fold only (never on the holdout)
  * calibration (isotonic, in-fold) of the winner; Brier + reliability bins
Checkpoints: .runtime/data/hazard/experiments/V2_*.json; board: leaderboard_v2.json;
narrative appended to docs/HAZARD_EXPERIMENTS.md.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate_landslide as ev  # noqa: E402
import overnight as ov  # noqa: E402

HAZ = ov.HAZ
SUSC = json.loads((HAZ / "susceptibility.json").read_text(encoding="utf-8")) if (HAZ / "susceptibility.json").exists() else {}
SOIL = json.loads((HAZ / "soil.json").read_text(encoding="utf-8")) if (HAZ / "soil.json").exists() else {}
DATASETS = {"NER": "landslide_dataset.csv", "NER_SM": "landslide_dataset_sm.csv", "INDIA": "landslide_dataset_india.csv"}
BASE = ["p1", "p3", "p7", "p15", "p30", "max7", "elevation", "slope"]
SOIL_F = ["clay", "sand", "silt", "bdod"]


def load(name: str) -> list[dict]:
    rows = ov.load_rows(HAZ / DATASETS[name])
    for r in rows:
        key = f"{r['site_lat']:.4f},{r['site_lon']:.4f}"
        r["susc"] = SUSC.get(key)
        s = SOIL.get(key) or {}
        for f in SOIL_F:
            r[f] = s.get(f) if "error" not in s else None
    return rows


def with_features(rows: list[dict], feats: list[str]) -> list[dict]:
    return [r for r in rows if all(r.get(f) is not None and not (isinstance(r[f], float) and math.isnan(r[f])) for f in feats)]


def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--datasets", default="NER,NER_SM,INDIA")
    a = ap.parse_args()
    results: list[dict] = []
    for ds in a.datasets.split(","):
        if not (HAZ / DATASETS[ds]).exists():
            ov.log(f"V2 {ds}: dataset not built yet, skipped"); continue
        rows = load(ds)
        soil_ok = sum(1 for r in rows if r.get("clay") is not None)
        sets = {"BASE": BASE, "BASE+SUSC": BASE + ["susc"]}
        if soil_ok >= 0.9 * len(rows):
            sets["BASE+SUSC+SOIL"] = BASE + ["susc"] + SOIL_F
        ov.log(f"V2 {ds}: rows {len(rows)} susc {sum(1 for r in rows if r.get('susc') is not None)} soil {soil_ok}; sets {list(sets)}")
        split_of = "NER" if ds.startswith("NER") else "INDIA"
        for fs_name, feats in sets.items():
            usable = with_features(rows, feats)
            for model in ("LOGREG", "HGB"):
                for seed in ((0,) if model == "LOGREG" else (0, 1)):
                    for sname, (train, valid) in ov.splits_for(usable, split_of).items():
                        if not train or not valid or sum(r["label"] for r in valid) < 10:
                            continue
                        r = ov.run_one(f"V2/{model}/{fs_name}/s{seed}", model, feats, seed, train, valid)
                        r.update(dataset=ds, split=sname); results.append(r); ov.checkpoint(r)
                        m = r["recall_first"]
                        ov.log(f"V2 {ds} {sname} {model}/{fs_name}/s{seed}: PR {m['pr_auc']} ROC {m['roc_auc']} rec {m['recall']} FPR {m['false_positive_rate']} acc {m['accuracy']} Brier {m['brier']}")
    # board: min recall >= 0.80, then mean PR-AUC
    by: dict[tuple[str, str], dict[str, dict]] = {}
    for r in results:
        by.setdefault((r["dataset"], r["name"]), {})[r["split"]] = r
    board = []
    for (ds, name), per in by.items():
        pr = [v["recall_first"]["pr_auc"] or 0 for v in per.values()]; rec = [v["recall_first"]["recall"] for v in per.values()]
        fpr = [v["recall_first"]["false_positive_rate"] for v in per.values()]
        board.append({"dataset": ds, "name": name, "mean_pr_auc": round(sum(pr) / len(pr), 4), "min_recall": round(min(rec), 4), "max_fpr": round(max(fpr), 4),
                      "mean_brier": round(sum(v["recall_first"]["brier"] for v in per.values()) / len(per), 4),
                      "splits": {k: {"recall": v["recall_first"]["recall"], "fpr": v["recall_first"]["false_positive_rate"], "accuracy": v["recall_first"]["accuracy"], "precision": v["recall_first"]["precision"], "f1": v["recall_first"]["f1"], "pr_auc": v["recall_first"]["pr_auc"], "brier": v["recall_first"]["brier"]} for k, v in per.items()}})
    board.sort(key=lambda b: (b["min_recall"] >= 0.80, b["mean_pr_auc"]), reverse=True)
    out = {"updated_at": datetime.utcnow().isoformat() + "Z", "board": board}
    (ov.EXP / "leaderboard_v2.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    # calibrate the best per dataset
    for ds in dict.fromkeys(b["dataset"] for b in board):
        best = next(b for b in board if b["dataset"] == ds)
        _, model, fs_name, seed = best["name"].split("/")
        rows = load(ds); feats = {"BASE": BASE, "BASE+SUSC": BASE + ["susc"], "BASE+SUSC+SOIL": BASE + ["susc"] + SOIL_F}[fs_name]
        usable = with_features(rows, feats)
        for sname, (train, valid) in ov.splits_for(usable, "NER" if ds.startswith("NER") else "INDIA").items():
            r = ov.run_one(f"V2/{model}/{fs_name}/{seed}/CALIBRATED", model, feats, int(seed[1:]), train, valid, calibrate=True)
            r.update(dataset=ds, split=sname); ov.checkpoint(r)
            m = r["recall_first"]
            ov.log(f"V2 {ds} {sname} CALIBRATED {best['name']}: rec {m['recall']} FPR {m['false_positive_rate']} acc {m['accuracy']} Brier {m['brier']} bins {[(b['bin'], b['mean_pred'], b['observed']) for b in m['calibration']]}")
    lines = ["", f"## V2 experiments ({out['updated_at']})", "",
             "Season-matched negatives (NER_SM), NASA LHASA susceptibility (+SUSC), SoilGrids texture (+SOIL) where fetched. Threshold on TRAIN out-of-fold; board = min recall >= 0.80 then mean PR-AUC.", "",
             "| dataset | run | mean PR-AUC | min recall | max FPR | mean Brier | per split (recall / FPR / acc / precision) |", "|---|---|---|---|---|---|---|"]
    for b in board[:20]:
        per = "; ".join(f"{k}: {v['recall']:.2f} / {v['fpr']:.2f} / {v['accuracy']:.2f} / {v['precision']:.2f}" for k, v in b["splits"].items())
        lines.append(f"| {b['dataset']} | {b['name']} | {b['mean_pr_auc']:.3f} | {b['min_recall']:.2f} | {b['max_fpr']:.2f} | {b['mean_brier']:.3f} | {per} |")
    with (ov.ROOT / "docs" / "HAZARD_EXPERIMENTS.md").open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    ov.log(f"V2 done: {len(results)} runs; best {board[0] if board else None}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
