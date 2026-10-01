"""Place a shipment endpoint in India, in a state and, where known, a district.

Scope (app/core/scope.py) is built from shipment geography. This writes it,
once, when the shipment is created.

THE AUTHORITY IS POSTGIS (app/services/geo_classify.py, migration 0016)

  1. The point must be inside India - ST_Covers on the India boundary - or the
     shipment is refused, 422 OUTSIDE_SUPPORTED_COUNTRY. With no India
     boundary loaded it is 503 GEOGRAPHY_UNAVAILABLE: the country check never
     falls back to anything.
  2. When state geometry is loaded, the state and district are the polygons
     that cover the point (SOURCE_POSTGIS).
  3. Only when NO state geometry is loaded: the labelled fallback below.

THE FALLBACK: OpenStreetMap's own administrative answer for the stored
coordinate (geocoding.reverse_admin). It is third-party, not authoritative, so
it is used as narrowly as possible:

  * a state only when the answer EQUALS one of the states rows;
  * a district only when the answer EQUALS a district of that state whose
    source the product counts as operational (VERIFIED_OFFICIAL or DEMO,
    `operational_sources()`) - never a TEST or UNVERIFIED row;
  * equality after case and whitespace folding, nothing looser: "Kamrup" is
    not "Kamrup Metropolitan";
  * it can confirm that a point is in an NER state, never that it is not - so
    on its own it can never make a trip INDIA_EXTERNAL.

Everything else is None - unknown, which a scoped manager does not see - and
a geocoder failure is unknown too. A trip is never refused for an unknown
state; only for a point outside India, or a PROVEN India-external trip.

NO CONNECTION IS HELD DURING THE LOOKUP (DBPOOL-03)

Nominatim answers one request a second, process-wide. Asked inside the
write transaction, every planner waiting its turn held a pooled connection
idle in transaction (3+2 pool, 10 plans: pool 5/5 for 9.7 s). So a caller
that owns its transaction runs `prefetch` first: a short read (phase A),
commit, then the OSM lookups with no connection held (phase B). Phase C is
the caller's one write transaction; `locate` re-classifies with PostGIS
there and takes the prefetched answer instead of the network.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ServiceUnavailableError
from app.models.geography import SOURCE_POSTGIS, District, State, operational_sources
from app.services import geo_classify, geocoding

#: Recorded on the shipment, so every scope decision can be traced to its
#: source. SOURCE_POSTGIS lives with the model: scope reads it back.
SOURCE_OSM = "OSM_NOMINATIM_REVERSE"
SOURCE_UNAVAILABLE = "GEOCODER_UNAVAILABLE"


#: What OSM said for a point - (state, district candidates) - or None when
#: the geocoder failed. Keyed by the exact (lat, lon) the caller will locate.
OsmAnswers = dict[tuple[float, float], tuple[str | None, list[str]] | None]


@dataclass(frozen=True, slots=True)
class Place:
    state_id: uuid.UUID | None
    district_id: uuid.UUID | None
    resolved: bool  # the source answered; says nothing about a match
    #: True / False from PostGIS; from the fallback only True or None.
    is_ner: bool | None = None


def _fold(name: str) -> str:
    return " ".join(name.casefold().split())


async def _ask_osm(lat: float, lon: float) -> tuple[str | None, list[str]] | None:
    try:
        return await geocoding.reverse_admin(lat, lon)
    except geocoding.GeocodingUnavailable:
        return None


async def prefetch(db: AsyncSession, points: list[tuple[float, float]]) -> OsmAnswers:
    """Phases A and B: which points will need the OSM fallback (one short
    read each), COMMIT, then ask OSM for them with no connection held.

    Only for a caller that owns the transaction: the commit ends it. Nothing
    is decided here - a point outside India, or a missing India boundary, is
    left for `locate` to refuse in phase C, in its usual order.
    """
    try:
        geos = [await geo_classify.classify_point(db, lat, lon) for lat, lon in points]
    except ServiceUnavailableError:
        geos = []  # no India boundary: phase C answers GEOGRAPHY_UNAVAILABLE
    await db.commit()
    if not geos or not all(g.in_india for g in geos):
        return {}
    wanted = [p for p, g in zip(points, geos) if not g.admin_geometry_loaded]
    return {p: await _ask_osm(*p) for p in wanted}


async def locate(
    db: AsyncSession, lat: float, lon: float, *, field: str, osm: OsmAnswers | None = None
) -> tuple[Place, str]:
    """The endpoint's Place and the source it came from. Raises when outside India.

    `osm` carries answers `prefetch` already fetched; a point it lacks is
    looked up here, inside the caller's transaction, as before.
    """
    geo = await geo_classify.require_point_in_india(db, lat, lon, field)
    if geo.admin_geometry_loaded:
        return Place(geo.state_id, geo.district_id, resolved=True, is_ner=geo.is_ner), SOURCE_POSTGIS
    place = await resolve(db, lat, lon, osm=osm)
    return place, (SOURCE_OSM if place.resolved else SOURCE_UNAVAILABLE)


async def resolve(db: AsyncSession, lat: float, lon: float, *, osm: OsmAnswers | None = None) -> Place:
    """The labelled OSM fallback. Only for when no state geometry is loaded."""
    answer = osm[(lat, lon)] if osm is not None and (lat, lon) in osm else await _ask_osm(lat, lon)
    if answer is None:
        return Place(None, None, resolved=False)
    state_name, district_names = answer
    if not state_name:
        return Place(None, None, resolved=True)
    states = (await db.execute(select(State))).scalars().all()
    state = next((s for s in states if _fold(s.name) == _fold(state_name)), None)
    if state is None:
        return Place(None, None, resolved=True)
    wanted = {_fold(n) for n in district_names}
    operational = (
        await db.execute(
            select(District).where(
                District.state_id == state.id,
                District.source_status.in_(operational_sources()),
            )
        )
    ).scalars().all()
    matches = [d for d in operational if _fold(d.name) in wanted]
    # Two operational districts answering to one name would be a data error, not
    # a choice to make here.
    district = matches[0] if len(matches) == 1 else None
    return Place(
        state.id, district.id if district else None, resolved=True,
        is_ner=True if state.is_ner else None,
    )
