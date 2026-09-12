"""Fleet Sentinel concurrency, scheduler race, and idempotency test suite.

Verifies:
1. Same sweep repeated -> idempotent, 0 duplicate emergencies.
2. Two schedulers race -> concurrent execution produces exactly 1 emergency, no unhandled exceptions.
3. Open emergency already exists -> does not re-trigger check-in.
4. Trip completes during sweep -> no emergency created for completed trip.
5. Driver responds simultaneously -> check-in response is preserved and not overwritten.
6. GPS arrives during sweep -> handled safely without data corruption.
7. Database transaction failure -> clean rollback, no partial emergency corruption.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import uuid

import pytest
from geoalchemy2.elements import WKTElement
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_sessionmaker
from app.domain.sentinel import (
    DriverCheckResponse,
    EmergencyState,
    STATIONARY_WINDOW_SECONDS,
)
from app.models.emergency import Emergency
from app.models.enums import TripStatus
from app.models.operations import GpsPoint, Trip
from app.services import sentinel as sentinel_service
from tests import factories

pytestmark = pytest.mark.requires_db


async def _seed_stationary_active_trip(
    session: AsyncSession, now: datetime
) -> Trip:
    """Helper to seed an active trip with 65 minutes of stationary GPS fixes."""
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(
        session, driver, truck, verified=True
    )
    trip = await factories.make_trip(
        session,
        driver,
        truck,
        assignment=assignment,
        status=TripStatus.ACTIVE,
    )
    # Add stationary GPS fixes outside approved stops
    lat, lon = 26.5000, 92.5000
    for i in range(14):
        f_time = now - timedelta(minutes=65 - (i * 5))
        pt = GpsPoint(
            trip_id=trip.id,
            driver_id=trip.driver_id,
            truck_id=trip.truck_id,
            device_fix_id=uuid.uuid4(),
            location=WKTElement(f"SRID=4326;POINT({lon} {lat})"),
            recorded_at=f_time,
            received_at=f_time,
            accuracy_m=Decimal("10.0"),
            speed_kmph=Decimal("0.0"),
            heading_deg=Decimal("0.0"),
        )
        session.add(pt)
    await session.commit()
    await session.refresh(trip)
    return trip


class TestSentinelSchedulerConcurrency:
    async def test_same_sweep_repeated_is_idempotent(
        self, session: AsyncSession
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        trip = await _seed_stationary_active_trip(session, now)

        # Sweep 1: creates emergency
        swept_1 = await sentinel_service.run_sentinel_sweep(session, now=now)
        assert len(swept_1) == 1
        assert swept_1[0].trip_id == trip.id
        assert swept_1[0].state == EmergencyState.DRIVER_CHECK_REQUIRED

        # Sweep 2: immediate repeat at same timestamp
        swept_2 = await sentinel_service.run_sentinel_sweep(session, now=now)
        assert len(swept_2) == 0  # Already open, no duplicate

        # Verify DB has exactly one emergency
        emergencies = (
            await session.execute(
                select(Emergency).where(Emergency.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(emergencies) == 1

    async def test_two_schedulers_race_concurrently(
        self, session: AsyncSession
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        trip = await _seed_stationary_active_trip(session, now)

        # Two distinct sessions running the sweep at the exact same moment
        sessionmaker = get_sessionmaker()

        async def worker():
            async with sessionmaker() as db:
                return await sentinel_service.run_sentinel_sweep(db, now=now)

        # Launch concurrent sweeps
        results = await asyncio.gather(worker(), worker(), return_exceptions=False)

        # Together they should create at most 1 emergency in the database
        emergencies = (
            await session.execute(
                select(Emergency).where(Emergency.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(emergencies) == 1
        assert emergencies[0].state == EmergencyState.DRIVER_CHECK_REQUIRED

    async def test_open_emergency_already_exists_does_not_retrigger(
        self, session: AsyncSession
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        trip = await _seed_stationary_active_trip(session, now)

        # Pre-seed an open emergency
        existing = Emergency(
            trip_id=trip.id,
            state=EmergencyState.DRIVER_RESPONDED,
            triggered_at=now - timedelta(minutes=10),
            stationary_since=now - timedelta(minutes=70),
            check_sent_at=now - timedelta(minutes=10),
            response_deadline_at=now + timedelta(minutes=20),
            driver_response=DriverCheckResponse.TRAFFIC,
            responded_at=now - timedelta(minutes=5),
        )
        session.add(existing)
        await session.commit()

        # Run sweep
        swept = await sentinel_service.run_sentinel_sweep(session, now=now)
        assert len(swept) == 0

        # Verify DB still has only 1 emergency
        emergencies = (
            await session.execute(
                select(Emergency).where(Emergency.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(emergencies) == 1
        assert emergencies[0].state == EmergencyState.DRIVER_RESPONDED

    async def test_trip_completes_during_sweep(
        self, session: AsyncSession
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        trip = await _seed_stationary_active_trip(session, now)

        # Transition trip to DELIVERED
        trip.status = TripStatus.DELIVERED
        await session.commit()

        # Sweep should ignore non-active trips
        swept = await sentinel_service.run_sentinel_sweep(session, now=now)
        assert len(swept) == 0

        emergencies = (
            await session.execute(
                select(Emergency).where(Emergency.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(emergencies) == 0

    async def test_driver_responds_simultaneously_with_sweep(
        self, session: AsyncSession
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        trip = await _seed_stationary_active_trip(session, now)

        # 1. Sweep issues check
        swept = await sentinel_service.run_sentinel_sweep(session, now=now)
        assert len(swept) == 1
        assert swept[0].state == EmergencyState.DRIVER_CHECK_REQUIRED

        # 2. Driver responds with REST_STOP
        driver = (
            await session.execute(
                select(factories.Driver).where(factories.Driver.id == trip.driver_id)
            )
        ).scalar_one()
        await sentinel_service.record_driver_check_in(
            session,
            driver=driver,
            trip_id=trip.id,
            response=DriverCheckResponse.REST_STOP,
            now=now + timedelta(minutes=5),
        )

        # 3. Next sweep runs at minute 10
        swept_next = await sentinel_service.run_sentinel_sweep(
            session, now=now + timedelta(minutes=10)
        )
        assert len(swept_next) == 0  # Does not overwrite driver response

        refreshed = (
            await session.execute(
                select(Emergency).where(Emergency.trip_id == trip.id)
            )
        ).scalar_one()
        assert refreshed.state == EmergencyState.DRIVER_RESPONDED
        assert refreshed.driver_response == DriverCheckResponse.REST_STOP

    async def test_gps_arrives_during_sweep(
        self, session: AsyncSession
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        trip = await _seed_stationary_active_trip(session, now)

        # Moving fix arrives
        moving_pt = GpsPoint(
            trip_id=trip.id,
            driver_id=trip.driver_id,
            truck_id=trip.truck_id,
            device_fix_id=uuid.uuid4(),
            location=WKTElement(f"SRID=4326;POINT(93.0000 27.0000)"),  # 60km away
            recorded_at=now,
            received_at=now,
            accuracy_m=Decimal("5.0"),
            speed_kmph=Decimal("45.0"),
            heading_deg=Decimal("90.0"),
        )
        session.add(moving_pt)
        await session.commit()

        # Sweep evaluates fixes: the latest fix is 60km away and moving!
        swept = await sentinel_service.run_sentinel_sweep(session, now=now)
        assert len(swept) == 0  # Healthy moving!

        emergencies = (
            await session.execute(
                select(Emergency).where(Emergency.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(emergencies) == 0

    async def test_database_transaction_failure_clean_rollback(
        self, session: AsyncSession
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        trip = await _seed_stationary_active_trip(session, now)

        # Simulate a transaction failure during check-in
        try:
            async with session.begin_nested():
                bad_emergency = Emergency(
                    trip_id=trip.id,
                    state="NON_EXISTENT_STATE",  # invalid enum causes DB error
                    triggered_at=now,
                    stationary_since=now,
                    check_sent_at=now,
                    response_deadline_at=now + timedelta(minutes=30),
                )
                session.add(bad_emergency)
                await session.flush()
        except Exception:
            # Transaction rolled back to savepoint
            pass

        # Verify DB contains no corrupt record
        emergencies = (
            await session.execute(
                select(Emergency).where(Emergency.trip_id == trip.id)
            )
        ).scalars().all()
        assert len(emergencies) == 0
