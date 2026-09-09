"""Roadside places, served from a local OpenStreetMap corridor snapshot.

WHY A SNAPSHOT AND NOT A LIVE LOOKUP

The Overpass commons guidance asks that public instances not back a general
application, and a driver app querying on every map pan is exactly that. So a
bounded developer query built `data/corridor_snapshot.json` once, and the app
reads that file. Nothing here touches the network - which is also why the
acceptance check "category changes and trip polling issue no Overpass request"
is true by construction rather than by discipline.

`is_live=False` travels with every response. A snapshot is not a service
availability feed and no screen may describe it as one.

RAW RECORDS ARE NOT UNIQUE PLACES

The file holds 720 raw category records. OpenStreetMap frequently maps one real
place twice - a node for the point and a way for the building - and those carry
different element ids, so counting rows overstates what a driver can actually
drive to. `_dedupe` collapses them; see it for why "same name, same category,
within 150 m" is the rule and why distance is load-bearing (two Maruti Suzuki
dealers 42 km apart are two dealers, not one mapped twice).
"""

import json
import logging
import math
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from app.domain.places import (
    MAX_RESULTS,
    BoundingBox,
    Place,
    PlaceAccess,
    PlaceCategory,
    PlaceContact,
    PlaceQueryResult,
    PlaceSource,
    PlacesSourceState,
    SearchAnchor,
)

logger = logging.getLogger(__name__)

SNAPSHOT_PATH = Path(__file__).parent / "data" / "corridor_snapshot.json"

#: How close two same-named places of the same category must be before they are
#: treated as one place mapped twice.
#:
#: ponytail: a flat 150 m heuristic. It is well above the node/building offsets
#: actually present in this extract (the widest genuine duplicate is a hospital
#: node 109 m from its building) and well below the nearest same-brand pair
#: that is genuinely distinct (two Apollo Tyres 8.7 km apart). Replace with the
#: provider's own place identity if a provider that has one is ever configured.
DUPLICATE_RADIUS_M = 150.0


def _metres(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Great-circle metres. Straight line, never a driving distance."""
    radius = 6_371_000
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat))
        * math.cos(math.radians(b_lat))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


def _place_from_record(record: dict) -> Place:
    """One snapshot row -> a `Place`, with absent facts left absent.

    Every `.get` here can return None and that is the point: 677 of the 720
    records have no phone and 701 have no opening hours. A default would turn
    "nobody recorded this" into "this place has none", and only the first is
    true.
    """
    tags = record.get("osm_tags") or {}
    return Place(
        provider_id=record["provider_id"],
        category=PlaceCategory(record["category"]),
        lat=record["lat"],
        lon=record["lon"],
        name=record.get("name"),
        contact=PlaceContact(
            phone=tags.get("phone") or tags.get("contact:phone"),
            opening_hours=tags.get("opening_hours"),
            operator=tags.get("operator"),
        ),
        access=PlaceAccess(
            hgv=tags.get("hgv"),
            max_height=tags.get("maxheight"),
            access=tags.get("access"),
            fee=tags.get("fee"),
            toilets=tags.get("toilets"),
            lit=tags.get("lit"),
        ),
        osm_tags=tags,
        # Always populated, even for a record that never merges - so callers
        # have one shape to read and `provider_ids` is never an empty tuple
        # meaning "unknown".
        provider_ids=(record["provider_id"],),
    )


#: Fields merged across duplicate elements, and where each one lives.
_MERGED_FIELDS: tuple[tuple[str, str], ...] = (
    ("contact", "phone"),
    ("contact", "opening_hours"),
    ("contact", "operator"),
    ("access", "hgv"),
    ("access", "max_height"),
    ("access", "access"),
    ("access", "fee"),
    ("access", "toilets"),
    ("access", "lit"),
)


def _merge_group(group: list[Place]) -> Place:
    """Fold several mapped elements of one place into a single record.

    FIELD BY FIELD, NOT RECORD BY RECORD.

    An earlier version kept whichever element carried the most tags and threw
    the rest away, with a comment claiming a merge could never lose a phone
    number. That was false and a bounded check found it: a richly tagged
    building with hours, operator and access but NO phone would swallow the
    sparse node that carried the only phone number, and the number vanished.
    The count of tags says nothing about which element holds the one fact a
    driver at a roadside actually needs.

    So each field is taken from the first element that HAS it, independently.
    The base record is still the richest element - it decides id, name and
    coordinates - but it no longer decides what every other field may be.

    DISAGREEMENTS ARE KEPT, NOT RESOLVED. Where two elements carry different
    values for the same field, the first is used and both are recorded in
    `conflicts`. Two phone numbers on one name might be two departments or
    might be evidence these are two businesses; resolving it silently would
    hide the second possibility, which is the more important one.
    """
    base = group[0]
    contact = dict(phone=None, opening_hours=None, operator=None)
    access = dict(
        hgv=None, max_height=None, access=None, fee=None, toilets=None, lit=None
    )
    chosen: dict[str, dict] = {"contact": contact, "access": access}
    conflicts: dict[str, tuple[str, ...]] = {}

    for holder, field_name in _MERGED_FIELDS:
        seen: list[str] = []
        for place in group:
            value = getattr(getattr(place, holder), field_name)
            if value is not None and value not in seen:
                seen.append(value)
        if seen:
            chosen[holder][field_name] = seen[0]
            if len(seen) > 1:
                conflicts[field_name] = tuple(seen)

    merged_tags: dict[str, str] = {}
    for place in reversed(group):  # richest last, so it wins a genuine clash
        merged_tags.update(place.osm_tags)

    return Place(
        provider_id=base.provider_id,
        category=base.category,
        lat=base.lat,
        lon=base.lon,
        name=base.name,
        contact=PlaceContact(**contact),
        access=PlaceAccess(**access),
        osm_tags=merged_tags,
        provider_ids=tuple(p.provider_id for p in group),
        conflicts=conflicts,
    )


def _dedupe(places: list[Place]) -> list[Place]:
    """Collapse one real place mapped as several OSM elements.

    THE RULE: same category, same name (case-folded), within
    `DUPLICATE_RADIUS_M`. All three are required.

    Name alone is wrong - "Maruti Suzuki" appears four times along this
    corridor up to 48 km apart, and those are four dealerships. Distance alone
    is wrong too - a hospital and the police station across the road are 40 m
    apart and are not the same place. Together they are right for every pair
    this extract actually contains.

    IT IS STILL A HEURISTIC. "Likely the same place", never "certainly". Two
    neighbouring units of one chain can sit inside 150 m of each other and
    share a name, and this rule would merge them. That is why every merged
    record keeps all its `provider_ids` and any `conflicts`: the judgement
    stays checkable against the source instead of being baked in.

    UNNAMED RECORDS ARE NEVER MERGED. 32 records have no name, most of them
    lay-bys, and two unnamed lay-bys 100 m apart are two places to stop. There
    is nothing to compare, so nothing is collapsed.
    """
    # Richest first, so a group's base record is the best-described element.
    ordered = sorted(places, key=lambda p: -len(p.osm_tags))
    groups: list[list[Place]] = []

    for place in ordered:
        if place.name is None:
            groups.append([place])
            continue
        key = place.name.strip().casefold()
        for group in groups:
            head = group[0]
            if (
                head.name is not None
                and head.category is place.category
                and head.name.strip().casefold() == key
                and _metres(place.lat, place.lon, head.lat, head.lon)
                <= DUPLICATE_RADIUS_M
            ):
                group.append(place)
                break
        else:
            groups.append([place])

    return [
        group[0] if len(group) == 1 else _merge_group(group) for group in groups
    ]


@lru_cache(maxsize=1)
def _load() -> tuple[list[Place], PlaceSource, BoundingBox, dict]:
    """Read, normalise and dedupe the snapshot once per process.

    Raises on a missing or unreadable file. The caller turns that into
    `UNAVAILABLE` rather than an empty list, because a file we cannot read
    tells us nothing about the corridor.
    """
    raw = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    records = raw["places"]
    places = _dedupe([_place_from_record(r) for r in records])

    meta = raw["source"]
    coverage = raw["coverage"]
    box = coverage["bbox"]
    source = PlaceSource(
        name=meta["name"],
        attribution=meta["attribution"],
        licence=meta["licence"],
        retrieved_at=datetime.fromisoformat(meta["retrieved_at"]),
        coverage_description=coverage["description"],
        limits=coverage["limits"],
        # A snapshot. Never a live availability feed.
        is_live=False,
    )
    counts = {
        "raw_records": len(records),
        "unique_places": len(places),
        "merged_duplicates": len(records) - len(places),
    }
    return (
        places,
        source,
        BoundingBox(
            min_lat=box["south"],
            min_lon=box["west"],
            max_lat=box["north"],
            max_lon=box["east"],
        ),
        counts,
    )


def snapshot_counts() -> dict:
    """Raw vs unique, for the coverage panel. Never just one number."""
    return _load()[3]


def _overlaps(a: BoundingBox, b: BoundingBox) -> bool:
    return not (
        a.max_lat < b.min_lat
        or a.min_lat > b.max_lat
        or a.max_lon < b.min_lon
        or a.min_lon > b.max_lon
    )


def find(
    *,
    box: BoundingBox,
    category: PlaceCategory,
    anchor: SearchAnchor,
    anchor_lat: float | None = None,
    anchor_lon: float | None = None,
    route: list[tuple[float, float]] | None = None,
    corridor_m: float = 3000.0,
    limit: int = 40,
) -> PlaceQueryResult:
    """Mapped places of `category` within `box`, optionally along `route`.

    Four outcomes, kept distinct because a caller that cannot tell them apart
    will show the wrong thing:

        OUTSIDE_COVERAGE  the box misses the snapshot entirely - nothing was
                          searched, so "no results" would describe the area
                          rather than our data
        UNAVAILABLE       the snapshot is missing or unreadable
        AVAILABLE, empty  searched, and nothing of this category is MAPPED here
        AVAILABLE, full   results

    `route`, when given, applies corridor filtering on SEGMENTS rather than
    vertices. The demo corridor has 52 points over 305 km, so consecutive
    vertices are kilometres apart and a per-vertex radius would miss every
    service on the road between them - which is most of them.
    """
    try:
        places, source, coverage, _ = _load()
    except (OSError, ValueError, KeyError) as exc:
        logger.warning("places snapshot unreadable: %s", exc)
        return PlaceQueryResult(
            state=PlacesSourceState.UNAVAILABLE,
            anchor=anchor,
            error="Place data could not be read on the server.",
        )

    if not _overlaps(box, coverage):
        return PlaceQueryResult(
            state=PlacesSourceState.OUTSIDE_COVERAGE,
            source=source,
            anchor=anchor,
        )

    found = [
        place
        for place in places
        if place.category is category and box.contains(place.lat, place.lon)
    ]

    if route:
        found = [
            place
            for place in found
            if _distance_to_route(place.lat, place.lon, route) <= corridor_m
        ]

    if anchor_lat is not None and anchor_lon is not None:
        found = [
            Place(
                provider_id=p.provider_id,
                category=p.category,
                lat=p.lat,
                lon=p.lon,
                name=p.name,
                contact=p.contact,
                access=p.access,
                osm_tags=p.osm_tags,
                straight_line_m=_metres(anchor_lat, anchor_lon, p.lat, p.lon),
                provider_ids=p.provider_ids,
                conflicts=p.conflicts,
            )
            for p in found
        ]
        found.sort(key=lambda p: p.straight_line_m or 0.0)

    capped = min(limit, MAX_RESULTS)
    truncated = len(found) > capped
    return PlaceQueryResult(
        state=PlacesSourceState.AVAILABLE,
        places=tuple(found[:capped]),
        source=source,
        anchor=anchor,
        truncated=truncated,
    )


def _distance_to_route(
    lat: float, lon: float, route: list[tuple[float, float]]
) -> float:
    """Straight-line metres to the nearest point on the route POLYLINE.

    Per SEGMENT, not per vertex. With 52 vertices over 305 km the gaps are
    ~6 km, so a vertex-only check would reject a tyre shop sitting directly on
    the highway simply because it fell between two recorded points.

    ponytail: equirectangular projection around the segment, which is accurate
    to well under a percent at these latitudes over a few kilometres and avoids
    a full geodesic solve per place per segment. Swap for a projected CRS if
    this is ever used for anything finer than a corridor filter.
    """
    if not route:
        return float("inf")
    if len(route) == 1:
        return _metres(lat, lon, route[0][0], route[0][1])

    best = float("inf")
    lat_scale = 111_320.0
    lon_scale = 111_320.0 * math.cos(math.radians(lat))
    px, py = lon * lon_scale, lat * lat_scale

    for (a_lat, a_lon), (b_lat, b_lon) in zip(route, route[1:]):
        ax, ay = a_lon * lon_scale, a_lat * lat_scale
        bx, by = b_lon * lon_scale, b_lat * lat_scale
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        if length_sq == 0:
            distance = math.hypot(px - ax, py - ay)
        else:
            # How far along the segment the nearest point lies, clamped to the
            # segment itself so the answer never sits on its infinite extension.
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
            distance = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if distance < best:
            best = distance
    return best
