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
    `OPERATIONAL_SOURCES`) - never a TEST or UNVERIFIED row;
  * equality after case and whitespace folding, nothing looser: "Kamrup" is
    not "Kamrup Metropolitan";
  * it can confirm that a point is in an NER state, never that it is not - so
    on its own it can never make a trip INDIA_EXTERNAL.

Everything else is None - unknown, which a scoped manager does not see - and
a geocoder failure is unknown too. A trip is never refused for an unknown
state; only for a point outside India, or a PROVEN India-external trip.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.geography import OPERATIONAL_SOURCES, District, State
from app.services import geo_classify, geocoding

#: Recorded on the shipment, so every scope decision can be traced to its source.
SOURCE_POSTGIS = "POSTGIS_ADMIN_BOUNDARY"
SOURCE_OSM = "OSM_NOMINATIM_REVERSE"
SOURCE_UNAVAILABLE = "GEOCODER_UNAVAILABLE"


@dataclass(frozen=True, slots=True)
class Place:
    state_id: uuid.UUID | None
    district_id: uuid.UUID | None
    resolved: bool  # the source answered; says nothing about a match
    #: True / False from PostGIS; from the fallback only True or None.
    is_ner: bool | None = None


def _fold(name: str) -> str:
    return " ".join(name.casefold().split())


async def locate(db: AsyncSession, lat: float, lon: float, *, field: str) -> tuple[Place, str]:
    """The endpoint's Place and the source it came from. Raises when outside India."""
    geo = await geo_classify.require_point_in_india(db, lat, lon, field)
    if geo.admin_geometry_loaded:
        return Place(geo.state_id, geo.district_id, resolved=True, is_ner=geo.is_ner), SOURCE_POSTGIS
    place = await resolve(db, lat, lon)
    return place, (SOURCE_OSM if place.resolved else SOURCE_UNAVAILABLE)


async def resolve(db: AsyncSession, lat: float, lon: float) -> Place:
    """The labelled OSM fallback. Only for when no state geometry is loaded."""
    try:
        state_name, district_names = await geocoding.reverse_admin(lat, lon)
    except geocoding.GeocodingUnavailable:
        return Place(None, None, resolved=False)
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
                District.source_status.in_(OPERATIONAL_SOURCES),
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
