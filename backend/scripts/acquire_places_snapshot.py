"""Acquire the roadside-services snapshot from Overpass. One-off, bounded.

    python backend/scripts/acquire_places_snapshot.py --dry-run
    python backend/scripts/acquire_places_snapshot.py

WHY A SCRIPT AND NOT A RUNTIME CALL

The Overpass commons guidance asks that public instances not back a general
application. So this runs once, by a developer, and writes a file the app
reads. `app/services/places/snapshot.py` reads that file and never calls
Overpass, which is what makes "changing category issues no external
request" true by construction rather than by caching.

WHAT THIS RUN ADDS

The previous snapshot covered the Guwahati–Jorhat corridor in four
categories and, critically, **no fuel**: there were no `amenity=fuel`
records at all, so a fuel layer would have rendered empty and read as
"no petrol stations on this corridor" rather than "we did not collect
them". For a truck that is the most useful category of the lot.

This adds FUEL and widens coverage to the eight North-Eastern states,
still as a bounded set of per-state queries rather than one region-sized
one — a smaller query that fails is better than a large one that times
out halfway and leaves a partial file looking complete.

LICENCE

OpenStreetMap, ODbL 1.0. Attribution is written into the snapshot and
rendered by every surface that shows a place. Nothing is scraped, and no
Google endpoint is touched.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ENDPOINT = "https://overpass-api.de/api/interpreter"
OUT = (
    Path(__file__).resolve().parents[1]
    / "app" / "services" / "places" / "data" / "corridor_snapshot.json"
)

#: A polite, identifying agent. Overpass asks for one.
USER_AGENT = "RASTA-AI/1.0 (SIH26002 NER logistics; one-off snapshot acquisition)"

#: Per-state boxes. Bounded deliberately: eight small queries rather than
#: one region-sized one, so a failure is partial and visible instead of a
#: timeout that silently truncates.
STATES: dict[str, tuple[float, float, float, float]] = {
    # name: (south, west, north, east)
    "Assam": (24.1, 89.6, 28.0, 96.1),
    "Arunachal Pradesh": (26.6, 91.5, 29.5, 97.5),
    "Meghalaya": (25.0, 89.8, 26.2, 92.9),
    "Manipur": (23.8, 92.9, 25.7, 94.8),
    "Mizoram": (21.9, 92.2, 24.6, 93.5),
    "Nagaland": (25.1, 93.3, 27.1, 95.3),
    "Tripura": (22.9, 91.0, 24.6, 92.4),
    "Sikkim": (27.0, 87.9, 28.2, 88.95),
}

#: category -> the OSM tag filters that produce it.
#:
#: Coarse on purpose. `shop=car_repair` does not tell you whether they fix
#: punctures, so TYRES is named for what a driver is looking for rather
#: than for a tag.
CATEGORY_TAGS: dict[str, list[str]] = {
    "FUEL": ['["amenity"="fuel"]'],
    "EMERGENCY": [
        '["amenity"="hospital"]',
        '["amenity"="clinic"]',
        '["amenity"="police"]',
        '["amenity"="fire_station"]',
    ],
    "TYRES": [
        '["shop"="tyres"]',
        '["shop"="car_repair"]',
        '["shop"="vehicle_repair"]',
    ],
    "HOTEL": ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="motel"]'],
    "REST": ['["highway"="rest_area"]', '["highway"="services"]'],
}

#: Per category per state. Enough for a corridor, small enough to stay a
#: reasonable ask of a free public endpoint.
CAP_PER_CATEGORY_PER_STATE = 400


def query_for(tags: list[str], box: tuple[float, float, float, float]) -> str:
    bbox = f"{box[0]},{box[1]},{box[2]},{box[3]}"
    parts = "".join(
        f"  node{tag}({bbox});\n  way{tag}({bbox});\n" for tag in tags
    )
    # `out center` gives a way a single representative coordinate, which is
    # what a map pin needs; `qt` is the cheap ordering.
    return f"[out:json][timeout:180];\n(\n{parts});\nout center qt {CAP_PER_CATEGORY_PER_STATE};\n"


def fetch(query: str, attempt: int = 1) -> dict:
    data = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(ENDPOINT, data=data, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            return json.loads(response.read().decode("utf8"))
    except urllib.error.HTTPError as exc:
        # 429/504 are the endpoint asking for patience, not a failure.
        if exc.code in (429, 502, 503, 504) and attempt <= 3:
            wait = 30 * attempt
            print(f"      {exc.code} — waiting {wait}s (attempt {attempt})", flush=True)
            time.sleep(wait)
            return fetch(query, attempt + 1)
        raise


def element_record(element: dict, category: str) -> dict | None:
    lat = element.get("lat") or (element.get("center") or {}).get("lat")
    lon = element.get("lon") or (element.get("center") or {}).get("lon")
    if lat is None or lon is None:
        return None
    # Coordinates must be inside the region we asked about; a nonsense
    # coordinate placed on a dispatcher's map is worse than a missing pin.
    if not (20.0 <= lat <= 30.5 and 86.0 <= lon <= 98.5):
        return None
    tags = element.get("tags") or {}
    return {
        "provider_id": f"osm:{element['type']}/{element['id']}",
        "category": category,
        "name": (tags.get("name") or "").strip() or None,
        "lat": round(float(lat), 7),
        "lon": round(float(lon), 7),
        "osm_tags": {
            k: v
            for k, v in tags.items()
            if k in ("amenity", "shop", "tourism", "highway", "healthcare", "operator", "brand")
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="print the plan and one query, fetch nothing")
    parser.add_argument("--only", help="a single category, for a quick check")
    args = parser.parse_args()

    categories = [args.only.upper()] if args.only else list(CATEGORY_TAGS)
    for category in categories:
        if category not in CATEGORY_TAGS:
            sys.exit(f"unknown category {category!r}")

    print(f"endpoint   {ENDPOINT}")
    print(f"categories {', '.join(categories)}")
    print(f"states     {len(STATES)}")
    print(f"queries    {len(categories) * len(STATES)} (cap {CAP_PER_CATEGORY_PER_STATE} each)")

    if args.dry_run:
        first = categories[0]
        print("\n--- example query ---")
        print(query_for(CATEGORY_TAGS[first], STATES["Assam"]))
        return 0

    by_id: dict[str, dict] = {}
    counts: dict[str, int] = {}
    failures: list[str] = []

    for category in categories:
        for state, box in STATES.items():
            print(f"  {category:<10} {state:<18}", end="", flush=True)
            try:
                payload = fetch(query_for(CATEGORY_TAGS[category], box))
            except Exception as exc:  # noqa: BLE001
                print(f" FAILED {type(exc).__name__}")
                failures.append(f"{category}/{state}: {exc}")
                continue
            added = 0
            for element in payload.get("elements", []):
                record = element_record(element, category)
                if record is None:
                    continue
                # Deduplicate on the OSM id: a hospital mapped as both a node
                # and a way is one hospital.
                if record["provider_id"] in by_id:
                    continue
                by_id[record["provider_id"]] = record
                added += 1
            counts[category] = counts.get(category, 0) + added
            print(f" {added:>5} new")
            # Courtesy pause between queries on a free public endpoint.
            time.sleep(4)

    places = sorted(by_id.values(), key=lambda r: (r["category"], r["lat"], r["lon"]))
    if not places:
        print("\nNothing acquired. The existing snapshot is left untouched.")
        return 1

    snapshot = {
        "schema": "ner-places-snapshot-v1",
        "source": {
            "name": "OpenStreetMap contributors, via Overpass API",
            "attribution": "(c) OpenStreetMap contributors, ODbL",
            "endpoint": ENDPOINT,
            "licence": "ODbL 1.0",
            "retrieved_at": datetime.now(UTC).isoformat(),
            "method": (
                "One-off bounded developer query, one per category per state. The "
                "application does NOT call Overpass at runtime; it reads this file."
            ),
        },
        "coverage": {
            "description": "The eight North-Eastern states, per-state bounding boxes",
            # The UNION of the state boxes. `snapshot.py` uses this one box to
            # answer "is the caller's area inside coverage at all", so it must
            # exist even though acquisition was done per state - without it a
            # query inside a covered state is reported UNAVAILABLE.
            "bbox": {
                "south": min(v[0] for v in STATES.values()),
                "west": min(v[1] for v in STATES.values()),
                "north": max(v[2] for v in STATES.values()),
                "east": max(v[3] for v in STATES.values()),
            },
            "states": {k: {"south": v[0], "west": v[1], "north": v[2], "east": v[3]}
                       for k, v in STATES.items()},
            "categories": sorted({p["category"] for p in places}),
            "result_cap_per_category_per_state": CAP_PER_CATEGORY_PER_STATE,
            "limits": (
                "Only the tags listed in this script. Absence means NOT MAPPED in "
                "OpenStreetMap at retrieval time, not absence in reality. Nothing here "
                "is verified against the business: a mapped hospital is a hospital on a "
                "map, not a guarantee that it is open, staffed or reachable."
            ),
        },
        "counts": counts,
        "places": places,
    }

    if failures:
        snapshot["coverage"]["incomplete"] = failures
        print(f"\n{len(failures)} queries failed — recorded in the snapshot:")
        for f in failures:
            print("   ", f)

    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf8")
    print(f"\nwrote {OUT}")
    print(f"  {len(places)} unique places")
    for category, n in sorted(counts.items()):
        print(f"  {category:<10} {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
