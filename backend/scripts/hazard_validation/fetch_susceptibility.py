"""NASA LHASA global landslide susceptibility (Stanley & Kirschbaum 2017; public
GeoTIFF from gpm.nasa.gov) sampled at every dataset site -> susceptibility.json.
A verified official product, used as ONE feature in research experiments only.

    .runtime/ml-venv/Scripts/python.exe backend/scripts/hazard_validation/fetch_susceptibility.py
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import rasterio

ROOT = Path(__file__).resolve().parents[3]
HAZ = ROOT / ".runtime" / "data" / "hazard"
TIF = HAZ / "global-landslide-susceptibility-map-2-27-23.tif"
OUT = HAZ / "susceptibility.json"


def sites() -> list[tuple[float, float]]:
    out = set()
    for name in ("landslide_dataset.csv", "landslide_dataset_india.csv"):
        p = HAZ / name
        if p.exists():
            with p.open(encoding="utf-8", newline="") as f:
                for r in csv.DictReader(f):
                    out.add((round(float(r["site_lat"]), 4), round(float(r["site_lon"]), 4)))
    return sorted(out)


def main() -> int:
    pts = sites()
    with rasterio.open(TIF) as src:
        print("raster", src.crs, src.res, src.nodata, src.count, flush=True)
        vals = list(src.sample([(lon, lat) for lat, lon in pts]))
    out = {f"{lat:.4f},{lon:.4f}": (None if v[0] is None else float(v[0])) for (lat, lon), v in zip(pts, vals)}
    OUT.write_text(json.dumps(out), encoding="utf-8")
    good = [v for v in out.values() if v is not None and v >= 0]
    print(f"sampled {len(out)} sites; valid {len(good)}; min {min(good):.3f} max {max(good):.3f}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
