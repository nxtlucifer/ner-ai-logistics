"""Soil texture per site from ISRIC SoilGrids v2.0 (open, documented REST API):
clay / sand / silt / bulk density, 0-5 cm, mean. One request per site, cached,
politely paced - a legitimate geology-adjacent feature for the landslide model
(docs/MODEL_REGISTRY.md), research only.

    .runtime/ml-venv/Scripts/python.exe backend/scripts/hazard_validation/fetch_soil.py
"""

from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
HAZ = ROOT / ".runtime" / "data" / "hazard"
OUT = HAZ / "soil.json"
URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
PROPS = ("clay", "sand", "silt", "bdod")
UA = "RASTA-AI hazard validation (research; contact: team NER-AI LOGISTICS)"


def sites() -> set[tuple[float, float]]:
    out = set()
    for name in ("landslide_dataset.csv", "landslide_dataset_india.csv"):
        p = HAZ / name
        if p.exists():
            with p.open(encoding="utf-8", newline="") as f:
                for r in csv.DictReader(f):
                    out.add((round(float(r["site_lat"]), 4), round(float(r["site_lon"]), 4)))
    return out


def main() -> int:
    soil = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    todo = [s for s in sorted(sites()) if f"{s[0]:.4f},{s[1]:.4f}" not in soil]
    print(f"sites {len(sites())} cached {len(soil)} todo {len(todo)}", flush=True)
    with httpx.Client(timeout=60, headers={"User-Agent": UA}) as c:
        for i, (lat, lon) in enumerate(todo):
            key = f"{lat:.4f},{lon:.4f}"
            for attempt in range(6):
                try:
                    r = c.get(URL, params=[("lon", lon), ("lat", lat), *[("property", p) for p in PROPS], ("depth", "0-5cm"), ("value", "mean")])
                    if r.status_code == 429:
                        time.sleep(60 * (attempt + 1)); continue
                    r.raise_for_status()
                    layers = r.json()["properties"]["layers"]
                    row = {}
                    for layer in layers:
                        v = layer["depths"][0]["values"].get("mean")
                        d = layer["unit_measure"]["d_factor"]
                        row[layer["name"]] = None if v is None else v / d
                    soil[key] = row
                    break
                except (httpx.HTTPError, KeyError, ValueError) as exc:
                    if attempt == 5:
                        soil[key] = {"error": type(exc).__name__}
                    time.sleep(5)
            time.sleep(0.5)
            if i % 25 == 0:
                OUT.write_text(json.dumps(soil), encoding="utf-8")
                print(f"  soil {i + 1}/{len(todo)}", flush=True)
    OUT.write_text(json.dumps(soil), encoding="utf-8")
    ok = sum(1 for v in soil.values() if "error" not in v and v.get("clay") is not None)
    print(f"done: {ok}/{len(soil)} sites with soil texture", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
