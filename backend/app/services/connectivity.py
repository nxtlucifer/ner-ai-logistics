"""Map-matched upload delays for one route, from the fixes drivers already send.

ONE statement, the same shape as `app/services/traffic.py`. PostGIS projects
every `gps_points` row received in the last `MAX_AGE_DAYS` that lies within
`MATCH_DISTANCE_M` of the route line onto it with `ST_LineLocatePoint`, and
returns how long each fix waited between the device clock and the server
clock. The pure rule in `app/domain/connectivity.py` does the rest.

Read BEFORE the connection is released for the provider fan-out: the callers
(`route_risk.assess_route`, `route_recommendation`, `route_watch`) run this
while they still hold the session.

Failure is UNKNOWN. A read that errors returns no samples, and no samples is
the honest answer the rule already gives.

Bounded, newest first: a route the fleet drives daily accumulates far more
fixes in a month than a segment state needs, and the newest are the ones that
describe the road as it is now.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.connectivity import MATCH_DISTANCE_M, MAX_AGE_DAYS, ConnectivitySample

log = logging.getLogger(__name__)

MAX_SAMPLES = 10_000

SAMPLES_SQL = sa_text(
    """
    SELECT ST_LineLocatePoint(CAST(r.geometry AS geometry), CAST(g.location AS geometry)) AS fraction,
           EXTRACT(EPOCH FROM (g.received_at - g.recorded_at)) AS upload_delay_s,
           EXTRACT(EPOCH FROM (CAST(:now AS timestamptz) - g.received_at)) AS age_seconds,
           g.trip_id,
           g.truck_id
    FROM trip_routes r
    JOIN gps_points g
      ON g.received_at >= CAST(:now AS timestamptz) - make_interval(days => :max_age_days)
     AND ST_DWithin(g.location, r.geometry, :match_m)
    WHERE r.id = :route_id
      AND g.is_mock_location = FALSE
    ORDER BY g.received_at DESC
    LIMIT :limit
    """
)


async def samples_for(
    db: AsyncSession, route_id: uuid.UUID, *, now: datetime | None = None
) -> list[ConnectivitySample]:
    moment = now or datetime.now(UTC)
    try:
        rows = (
            await db.execute(
                SAMPLES_SQL,
                {
                    "route_id": str(route_id),
                    "now": moment,
                    "max_age_days": MAX_AGE_DAYS,
                    "match_m": MATCH_DISTANCE_M,
                    "limit": MAX_SAMPLES,
                },
            )
        ).all()
    except Exception as exc:  # noqa: BLE001 - UNKNOWN is the contract
        log.warning(
            "connectivity samples failed for route %s: %s", route_id, type(exc).__name__
        )
        return []
    return [
        ConnectivitySample(
            fraction=float(row[0]),
            upload_delay_s=float(row[1]) if row[1] is not None else 0.0,
            age_seconds=float(row[2]),
            trip=str(row[3]),
            vehicle=str(row[4]),
        )
        for row in rows
    ]
