"""Where a point is - country, state, district, North-East - answered by PostGIS.

THE AUTHORITY (owner decisions, 29 Sep 2026)

  country   ST_Covers(country_boundaries['IN'], point). A closed set: a point
            exactly on the boundary is inside. No outward tolerance ever
            widens India.
  state     the states.geometry that covers the point
  district  the operational (VERIFIED_OFFICIAL/DEMO) district of that state
            whose geometry covers it

Logistics is India-wide and NER-centred: an endpoint must be in India, and a
trip must touch the North-East (INDIA_EXTERNAL is refused unless
ALLOW_INDIA_EXTERNAL_TRIPS). Deep intelligence is NER-first, which is what
`intelligence_coverage` says per point.

FAILS CLOSED

No India boundary loaded -> 503 GEOGRAPHY_UNAVAILABLE. A missing boundary never
reads as "inside", and never as "outside" either.

UNCERTAINTY, NOT TOLERANCE

`accuracy_m` is a GPS fix's radius. When that circle reaches the India
boundary the answer is BORDER_AMBIGUOUS (`in_india` None): not accepted as
India, not declared foreign, and no restriction invented. Planner points have
no accuracy, so ST_Covers alone decides for them.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import BusinessRuleError, ServiceUnavailableError

INDIA = "IN"
OUTSIDE_MESSAGE = "This location is outside the currently supported country."


class TripScope(StrEnum):
    NER_INTERNAL = "NER_INTERNAL"
    NER_OUTBOUND = "NER_OUTBOUND"
    NER_INBOUND = "NER_INBOUND"
    INDIA_EXTERNAL = "INDIA_EXTERNAL"


@dataclass(frozen=True, slots=True)
class GeoClassification:
    country_code: str | None
    #: None only when border_ambiguous: neither inside nor outside is claimed.
    in_india: bool | None
    state_id: uuid.UUID | None
    district_id: uuid.UUID | None
    #: None = unknown (no state shape covers the point, or none is loaded).
    is_ner: bool | None
    border_ambiguous: bool
    #: NER_DEEP | INDIA_BASELINE | NONE | UNKNOWN. UNKNOWN is never SAFE.
    intelligence_coverage: str
    #: Whether any state geometry is loaded. False -> state/district are not
    #: PostGIS answers and the caller may use its labelled fallback.
    admin_geometry_loaded: bool


# One round trip. The state is the covering one, NER first then slug, so a
# point exactly on a shared edge is attributed deterministically.
# ponytail: ST_Boundary(...)::geography is computed per call when accuracy_m is
# given; store the boundary line if GPS classification becomes hot.
_SQL = text(
    """
    WITH p AS (SELECT ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) AS g),
    c AS (SELECT geometry FROM country_boundaries WHERE code = :code),
    s AS (
      SELECT st.id, st.is_ner FROM states st, p
      WHERE st.geometry IS NOT NULL AND ST_Covers(st.geometry, p.g)
      ORDER BY st.is_ner DESC, st.slug LIMIT 1
    )
    SELECT
      EXISTS (SELECT 1 FROM c) AS india_loaded,
      (SELECT ST_Covers(c.geometry, p.g) FROM c, p) AS in_india,
      (SELECT ST_DWithin(ST_Boundary(c.geometry)::geography, p.g::geography, CAST(:acc AS float8))
         FROM c, p WHERE CAST(:acc AS float8) IS NOT NULL) AS near_boundary,
      EXISTS (SELECT 1 FROM states WHERE geometry IS NOT NULL) AS admin_loaded,
      (SELECT id FROM s) AS state_id,
      (SELECT is_ner FROM s) AS is_ner,
      (SELECT d.id FROM districts d, s, p
        WHERE d.state_id = s.id AND d.geometry IS NOT NULL
          AND d.source_status IN ('VERIFIED_OFFICIAL', 'DEMO')
          AND ST_Covers(d.geometry, p.g)
        ORDER BY d.slug LIMIT 1) AS district_id
    """
)


async def classify_point(
    db: AsyncSession, lat: float, lon: float, accuracy_m: float | None = None
) -> GeoClassification:
    row = (
        await db.execute(_SQL, {"lat": lat, "lon": lon, "acc": accuracy_m, "code": INDIA})
    ).one()
    if not row.india_loaded:
        raise ServiceUnavailableError(
            "Country boundary data is not loaded, so no location can be accepted yet.",
            code="GEOGRAPHY_UNAVAILABLE",
            details={"retryable": True},
        )
    ambiguous = bool(row.near_boundary)
    in_india: bool | None = None if ambiguous else bool(row.in_india)
    # The country is the authority: nothing outside India has an Indian state.
    state_id, district_id, is_ner = (
        (None, None, None) if in_india is False else (row.state_id, row.district_id, row.is_ner)
    )
    if in_india is False:
        coverage = "NONE"
    elif ambiguous or is_ner is None:
        coverage = "UNKNOWN"
    else:
        coverage = "NER_DEEP" if is_ner else "INDIA_BASELINE"
    return GeoClassification(
        country_code=INDIA if in_india else None,
        in_india=in_india,
        state_id=state_id,
        district_id=district_id,
        is_ner=is_ner,
        border_ambiguous=ambiguous,
        intelligence_coverage=coverage,
        admin_geometry_loaded=bool(row.admin_loaded),
    )


def require_in_india(geo: GeoClassification, field: str) -> None:
    """The endpoint gate: 422 unless the point is, unambiguously, in India."""
    if geo.border_ambiguous:
        raise BusinessRuleError(
            "This location is too close to the international boundary to confirm "
            "it is inside the supported country.",
            code="BORDER_AMBIGUOUS",
            details={"field": field},
        )
    if not geo.in_india:
        raise BusinessRuleError(
            OUTSIDE_MESSAGE, code="OUTSIDE_SUPPORTED_COUNTRY", details={"field": field}
        )


async def require_point_in_india(
    db: AsyncSession, lat: float, lon: float, field: str
) -> GeoClassification:
    geo = await classify_point(db, lat, lon)
    require_in_india(geo, field)
    return geo


def trip_scope_type(origin_is_ner: bool | None, destination_is_ner: bool | None) -> TripScope | None:
    """None when either end's NER membership is unknown - never a guess."""
    if origin_is_ner is None or destination_is_ner is None:
        return None
    if origin_is_ner:
        return TripScope.NER_INTERNAL if destination_is_ner else TripScope.NER_OUTBOUND
    return TripScope.NER_INBOUND if destination_is_ner else TripScope.INDIA_EXTERNAL


def require_ner_connected(
    origin_is_ner: bool | None, destination_is_ner: bool | None
) -> TripScope | None:
    """Refuse only a PROVEN India-external trip. Unknown is not refused: it is
    not evidence that the trip leaves the NER's business."""
    scope = trip_scope_type(origin_is_ner, destination_is_ner)
    if scope is TripScope.INDIA_EXTERNAL and not get_settings().ALLOW_INDIA_EXTERNAL_TRIPS:
        raise BusinessRuleError(
            "Neither end of this trip is in the North-East Region. Trips must start "
            "or end in the NER.",
            code="NOT_NER_CONNECTED",
            details={"scope_type": scope.value},
        )
    return scope
