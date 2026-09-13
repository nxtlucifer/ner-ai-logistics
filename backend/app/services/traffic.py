"""Map-matched fleet probes for one route, from the fixes drivers already send.

ONE statement. PostGIS does the matching: every `gps_points` row received in
the last `FRESH_SECONDS` that lies within `MATCH_DISTANCE_M` of the route line
is projected onto it with `ST_LineLocatePoint`, which is the same projection
`route_progress` uses to say where a truck is. The vehicle identity is the
truck, so two trips on one truck are one probe source.

Read BEFORE the connection is released for the provider fan-out: the caller
(`route_risk.assess_route`, `route_recommendation.candidates_for_trip`) runs
this while it still holds the session, then hands the samples to the pure
domain rule.

Failure is UNKNOWN. A traffic read that errors returns no samples, and no
samples is the honest answer the rule already gives.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.traffic import FRESH_SECONDS, MATCH_DISTANCE_M, TrafficSample

log = logging.getLogger(__name__)

#: Bounded: a route with more probes than this in fifteen minutes is a fleet
#: this project does not have yet.
MAX_SAMPLES = 5000

SAMPLES_SQL = sa_text(
    """
    SELECT ST_LineLocatePoint(CAST(r.geometry AS geometry), CAST(g.location AS geometry)) AS fraction,
           g.speed_kmph,
           g.accuracy_m,
           g.heading_deg,
           EXTRACT(EPOCH FROM (CAST(:now AS timestamptz) - g.received_at)) AS age_seconds,
           g.truck_id
    FROM trip_routes r
    JOIN gps_points g
      ON g.received_at >= CAST(:now AS timestamptz) - make_interval(secs => :fresh)
     AND ST_DWithin(g.location, r.geometry, :match_m)
    WHERE r.id = :route_id
      AND g.is_mock_location = FALSE
    LIMIT :limit
    """
)


async def samples_for(
    db: AsyncSession, route_id: uuid.UUID, *, now: datetime | None = None
) -> list[TrafficSample]:
    moment = now or datetime.now(UTC)
    try:
        rows = (
            await db.execute(
                SAMPLES_SQL,
                {
                    "route_id": str(route_id),
                    "now": moment,
                    "fresh": FRESH_SECONDS,
                    "match_m": MATCH_DISTANCE_M,
                    "limit": MAX_SAMPLES,
                },
            )
        ).all()
    except Exception as exc:  # noqa: BLE001 - UNKNOWN is the contract
        log.warning("traffic samples failed for route %s: %s", route_id, type(exc).__name__)
        return []
    return [
        TrafficSample(
            fraction=float(row[0]),
            speed_kmph=float(row[1]) if row[1] is not None else None,
            accuracy_m=float(row[2]) if row[2] is not None else None,
            heading_deg=float(row[3]) if row[3] is not None else None,
            age_seconds=float(row[4]),
            vehicle=str(row[5]),
        )
        for row in rows
    ]
