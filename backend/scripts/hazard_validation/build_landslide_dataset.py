"""Build the landslide validation dataset from REAL data only.

Positives  : NASA Global Landslide Catalog events in the NER slice
             (backend/data/landslides/glc_ner.csv) whose location accuracy is
             exact / 1 km / 5 km and whose date parses (2007-2017).
Negatives  : the SAME sites on random days with no catalogued event within
             EXCLUDE_KM and +/- EXCLUDE_DAYS (all 471 events, any accuracy, are
             used for the exclusion so a coarse event cannot leak in as a
             "quiet day"). K_NEG per positive.
Features   : ERA5-Land daily precipitation from the Open-Meteo historical
             archive (archive-api.open-meteo.com, free, no key): day-of, 3/7/15/30
             day antecedent sums, 7-day max; site elevation (from the same
             response); a slope proxy from four DEM samples ~250 m around the
             site (Open-Meteo elevation API); month; lat; lon.
Not used   : anything we do not have. No soil, no geology, no land cover, no
             susceptibility map - those are listed as gaps, not invented.

Everything fetched is cached under .runtime/data/hazard/ so the run is
repeatable and the providers are asked once.

  backend/.venv/Scripts/python.exe backend/scripts/hazard_validation/build_landslide_dataset.py
"""

from __future__ import annotations

import csv
import json
import math
import random
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
CSV = ROOT / "backend" / "data" / "landslides" / "glc_ner.csv"
CACHE = ROOT / ".runtime" / "data" / "hazard"
OUT = CACHE / "landslide_dataset.csv"
META = CACHE / "landslide_dataset.meta.json"
START, END = date(2007, 1, 1), date(2017, 12, 31)
GOOD_ACCURACY = {"exact", "1km", "5km"}
EXCLUDE_KM, EXCLUDE_DAYS, K_NEG = 25.0, 10, 4
UA = "RASTA-AI hazard validation (research; contact: team NER-AI LOGISTICS)"
random.seed(26002)


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def parse_date(s: str) -> date | None:
    try:
        return datetime.strptime(s.strip(), "%m/%d/%Y %I:%M:%S %p").date()
    except ValueError:
        return None


def load_events() -> list[dict]:
    rows = []
    with CSV.open(encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            d = parse_date(r["event_date"])
            if d is None or not (START <= d <= END):
                continue
            rows.append({"id": r["event_id"], "date": d, "lat": round(float(r["latitude"]), 4), "lon": round(float(r["longitude"]), 4),
                         "accuracy": r["location_accuracy"], "trigger": r["landslide_trigger"], "state": r["admin_division_name"], "title": r["event_title"]})
    return rows


def archive(client: httpx.Client, lat: float, lon: float) -> dict:
    p = CACHE / "archive" / f"{lat:.4f}_{lon:.4f}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    for attempt in range(40):
        r = client.get("https://archive-api.open-meteo.com/v1/archive", params={
            "latitude": lat, "longitude": lon, "start_date": START.isoformat(), "end_date": END.isoformat(),
            "daily": "precipitation_sum", "timezone": "Asia/Kolkata"})
        if r.status_code == 429:
            # An 11-year daily series is a weighted call; the hourly budget of a
            # free key runs out around 170 sites. Wait it out - never hammer.
            wait = min(300 * (attempt + 1), 1800)
            print(f"  429 at {lat},{lon}; waiting {wait // 60} min", flush=True)
            time.sleep(wait); continue
        r.raise_for_status()
        body = r.json()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(body), encoding="utf-8")
        time.sleep(0.6)  # polite pacing on a free service
        return body
    raise RuntimeError("archive rate-limited")


def elevations(client: httpx.Client, points: list[tuple[float, float]]) -> dict[str, float | None]:
    p = CACHE / "elevation.json"
    have = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    todo = [pt for pt in points if f"{pt[0]:.4f},{pt[1]:.4f}" not in have]
    for i in range(0, len(todo), 100):
        chunk = todo[i:i + 100]
        for attempt in range(4):
            r = client.get("https://api.open-meteo.com/v1/elevation", params={
                "latitude": ",".join(f"{a:.4f}" for a, _ in chunk), "longitude": ",".join(f"{b:.4f}" for _, b in chunk)})
            if r.status_code == 429:
                time.sleep(10 * (attempt + 1)); continue
            r.raise_for_status()
            for pt, h in zip(chunk, r.json()["elevation"]):
                have[f"{pt[0]:.4f},{pt[1]:.4f}"] = h
            break
        time.sleep(0.6)
        p.write_text(json.dumps(have), encoding="utf-8")
    return have


def features(series: dict[date, float], d: date) -> dict | None:
    def s(n: int) -> float | None:
        vals = [series.get(d - timedelta(days=k)) for k in range(n)]
        if any(v is None for v in vals):
            return None
        return round(sum(vals), 1)
    p1, p3, p7, p15, p30 = s(1), s(3), s(7), s(15), s(30)
    if None in (p1, p3, p7, p15, p30):
        return None
    m7 = max(series.get(d - timedelta(days=k), 0.0) for k in range(7))
    # lead-1: everything shifted one day back (the forecast a driver would have had the evening before)
    l3 = s(4) - p1 if s(4) is not None else None
    return {"p1": p1, "p3": p3, "p7": p7, "p15": p15, "p30": p30, "max7": round(m7, 1),
            "p3_lead1": round(l3, 1) if l3 is not None else None}


def main() -> None:
    events = load_events()
    good = [e for e in events if e["accuracy"] in GOOD_ACCURACY]
    print(f"events {len(events)} usable {len(good)}", flush=True)
    sites = sorted({(e["lat"], e["lon"]) for e in good})
    print(f"sites {len(sites)}", flush=True)
    with httpx.Client(timeout=60, headers={"User-Agent": UA}) as client:
        series: dict[tuple[float, float], dict[date, float]] = {}
        elev: dict[tuple[float, float], float | None] = {}
        for i, (lat, lon) in enumerate(sites):
            body = archive(client, lat, lon)
            daily = body["daily"]
            series[(lat, lon)] = {date.fromisoformat(t): (v if v is not None else None) for t, v in zip(daily["time"], daily["precipitation_sum"])}
            elev[(lat, lon)] = body.get("elevation")
            if i % 25 == 0:
                print(f"  archive {i + 1}/{len(sites)}", flush=True)
        # slope proxy: four neighbours ~250 m away
        d = 0.0025
        neigh = []
        for lat, lon in sites:
            neigh += [(lat + d, lon), (lat - d, lon), (lat, lon + d), (lat, lon - d)]
        heights = elevations(client, neigh + list(sites))
    slope: dict[tuple[float, float], float | None] = {}
    for lat, lon in sites:
        h0 = heights.get(f"{lat:.4f},{lon:.4f}")
        hs = [heights.get(f"{a:.4f},{b:.4f}") for a, b in ((lat + d, lon), (lat - d, lon), (lat, lon + d), (lat, lon - d))]
        if h0 is None or any(h is None for h in hs):
            slope[(lat, lon)] = None
        else:
            slope[(lat, lon)] = round(max(abs(h - h0) for h in hs) / 260.0, 4)  # rise/run, ~250-280 m

    rows = []
    all_pts = [(e["lat"], e["lon"], e["date"]) for e in events]
    for e in good:
        site = (e["lat"], e["lon"])
        f = features(series[site], e["date"])
        if f is None:
            continue
        rows.append({"label": 1, "site_lat": e["lat"], "site_lon": e["lon"], "date": e["date"].isoformat(), "event_id": e["id"],
                     "state": e["state"], "trigger": e["trigger"], "accuracy": e["accuracy"], "elevation": elev[site], "slope": slope[site], **f})
        # negatives: quiet days at the same site
        picked = 0
        tries = 0
        while picked < K_NEG and tries < 200:
            tries += 1
            q = START + timedelta(days=random.randint(30, (END - START).days))
            if any(abs((q - dd).days) <= EXCLUDE_DAYS and km(site, (la, lo)) <= EXCLUDE_KM for la, lo, dd in all_pts):
                continue
            fq = features(series[site], q)
            if fq is None:
                continue
            rows.append({"label": 0, "site_lat": e["lat"], "site_lon": e["lon"], "date": q.isoformat(), "event_id": "",
                         "state": e["state"], "trigger": "", "accuracy": e["accuracy"], "elevation": elev[site], "slope": slope[site], **fq})
            picked += 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    pos = sum(r["label"] for r in rows)
    meta = {"events_in_slice": len(events), "usable_events": len(good), "sites": len(sites), "positives": pos, "negatives": len(rows) - pos,
            "features": ["p1", "p3", "p7", "p15", "p30", "max7", "p3_lead1", "elevation", "slope", "month", "lat", "lon"],
            "rain_source": "ERA5-Land via Open-Meteo historical archive, daily precipitation_sum, Asia/Kolkata days",
            "dem_source": "Open-Meteo elevation (Copernicus DEM GLO-90)", "exclusion_km": EXCLUDE_KM, "exclusion_days": EXCLUDE_DAYS,
            "built_at": datetime.utcnow().isoformat() + "Z"}
    META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    sys.exit(main())
