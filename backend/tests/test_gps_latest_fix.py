"""The newest fix per driver: same answer, without reading every fix (SEC-P1B).

Presence and the Overview asked `max(received_at)` over a join of every fix of
every trip of the drivers in scope. At fleet scope that is a sequential scan
of gps_points (security lane: 414 ms p50 at 500 drivers and 1M fixes). The
rewrite probes ix_gps_trip_received once per trip. These tests pin that the
ANSWER did not change: the old statement is kept here as the reference.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from geoalchemy2 import WKTElement
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus
from app.models.operations import GpsPoint, Trip
from app.services import telemetry
from tests import factories

pytestmark = pytest.mark.requires_db


def _reference(driver_ids):
    """The statement presence.py and dashboard.py ran before SEC-P1B."""
    return (
        select(Trip.driver_id, func.max(GpsPoint.received_at))
        .join(Trip, Trip.id == GpsPoint.trip_id)
        .where(Trip.driver_id.in_(driver_ids))
        .group_by(Trip.driver_id)
    )


def _fix(trip: Trip, received_at: datetime, recorded_at: datetime | None = None) -> GpsPoint:
    return GpsPoint(
        trip_id=trip.id, driver_id=trip.driver_id, truck_id=trip.truck_id, device_fix_id=uuid.uuid4(),
        location=WKTElement("SRID=4326;POINT(91.7362 26.1445)"),
        recorded_at=recorded_at or received_at, received_at=received_at,
    )


async def test_the_rewrite_returns_the_same_newest_fix_per_driver(session: AsyncSession) -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    busy, _ = await factories.make_driver(session)   # two trips; the newer fix is on the OLDER trip
    single, _ = await factories.make_driver(session)  # one trip
    silent, _ = await factories.make_driver(session)  # a trip, no fix at all
    idle, _ = await factories.make_driver(session)    # no trip
    truck = await factories.make_truck(session)
    old = await factories.make_trip(session, busy, truck, status=TripStatus.CLOSED)
    new = await factories.make_trip(session, busy, truck, status=TripStatus.ACTIVE)
    one = await factories.make_trip(session, single, truck, status=TripStatus.ACTIVE)
    await factories.make_trip(session, silent, truck, status=TripStatus.ASSIGNED)
    session.add_all([
        _fix(old, now - timedelta(minutes=1)),
        _fix(old, now - timedelta(hours=2)),
        _fix(new, now - timedelta(minutes=5)),
        # A phone clock in the future: received_at, not recorded_at, decides.
        _fix(new, now - timedelta(minutes=9), recorded_at=now + timedelta(days=1)),
        _fix(one, now - timedelta(minutes=30)),
        _fix(one, now - timedelta(minutes=3)),
    ])
    await session.commit()

    ids = [busy.id, single.id, silent.id, idle.id]
    expected = dict((await session.execute(_reference(ids))).all())
    got = await telemetry.last_fix_by_driver(session, ids)

    assert got == expected
    assert got == {busy.id: now - timedelta(minutes=1), single.id: now - timedelta(minutes=3)}
    assert await telemetry.last_fix_by_driver(session, []) == {}


async def test_the_rewrite_reads_the_trip_index_not_the_table(session: AsyncSession) -> None:
    """The plan shape, with sequential scans switched off for this statement
    only: if the LATERAL could not use ix_gps_trip_received this would still
    show a Seq Scan. The 1M-row timing lives in the fix-round evidence."""
    driver, _ = await factories.make_driver(session)
    sql = telemetry.last_fix_by_driver_query([driver.id]).compile(
        dialect=session.bind.dialect, compile_kwargs={"literal_binds": True}
    )
    await session.execute(select(func.set_config("enable_seqscan", "off", True)))
    plan = "\n".join(r[0] for r in (await session.execute(text(f"EXPLAIN {sql}"))).all())
    await session.rollback()
    assert "ix_gps_trip_received" in plan, plan
    assert "Seq Scan on gps_points" not in plan, plan
    # One row per trip: the LIMIT 1 under the index probe. The old shape
    # also probes the index here (seqscan is off), but reads every fix.
    assert "Limit" in plan, plan
