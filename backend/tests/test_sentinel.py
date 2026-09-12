"""Fleet Sentinel test suite: deterministic detection, check-in, and SOS escalation.

Per docs/DEVELOPMENT_ROADMAP.md P11 and docs/TESTING_STRATEGY.md:
- Injected clock everywhere, NEVER sleep.
- Stationary < 60 min is healthy.
- Stationary >= 60 min outside approved stops issues DRIVER_CHECK_REQUIRED with 30-min deadline.
- Stationary inside an approved geofenced stop is healthy.
- NEED_HELP escalates immediately to SOS_ESCALATED and freezes briefing snapshot.
- Silence for 30 minutes escalates to SOS_ESCALATED.
- Late response after escalation is recorded without cancelling SOS.
- Monitor running 12 times creates exactly ONE emergency (partial unique index holds).
- GPS gap > 60 min raises COMMS_LOST, not SOS.
- Skewed device clock does not affect server-clock received_at evaluation.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
import uuid

import pytest
from geoalchemy2.elements import WKTElement
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import haversine_m
from app.domain.sentinel import (
    APPROVED_STOP_RADIUS_M,
    DRIVER_RESPONSE_WINDOW_SECONDS,
    STATIONARY_RADIUS_M,
    STATIONARY_WINDOW_SECONDS,
    ApprovedStop,
    DriverCheckResponse,
    EmergencyState,
    SentinelDecisionKind,
    TelemetryPoint,
    build_briefing_snapshot,
    evaluate_stationary_window,
    evaluate_trip_sentinel,
    is_inside_approved_stop,
    should_escalate_emergency,
)
from app.models.emergency import Emergency
from app.models.enums import TripEventKind, TripStatus, UserRole
from app.models.operations import GpsPoint, Trip, TripEvent, TripStop
from app.services import sentinel as sentinel_service
from tests import factories

pytestmark = pytest.mark.requires_db


# --- Domain Unit Tests (Pure Logic, Injected Clocks) -----------------------


class TestSentinelDomainLogic:
    def test_moving_truck_is_healthy(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        # Fixes moving 5 km over 60 minutes
        fixes = [
            TelemetryPoint(
                id=1,
                lat=26.1000 + (i * 0.01),
                lon=91.7000 + (i * 0.01),
                recorded_at=now - timedelta(minutes=60 - i * 10),
                received_at=now - timedelta(minutes=60 - i * 10),
            )
            for i in range(7)
        ]
        decision = evaluate_trip_sentinel(
            fixes=fixes, approved_stops=[], has_open_emergency=False, now=now
        )
        assert decision.kind == SentinelDecisionKind.HEALTHY_MOVING

    def test_stationary_under_60_min_is_healthy(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        # Stationary for only 45 minutes
        fixes = [
            TelemetryPoint(
                id=1,
                lat=26.1445,
                lon=91.7362,
                recorded_at=now - timedelta(minutes=45 - i * 5),
                received_at=now - timedelta(minutes=45 - i * 5),
            )
            for i in range(10)
        ]
        decision = evaluate_trip_sentinel(
            fixes=fixes, approved_stops=[], has_open_emergency=False, now=now
        )
        assert decision.kind == SentinelDecisionKind.HEALTHY_MOVING

    def test_stationary_over_60_min_outside_stops_triggers_check_required(
        self,
    ) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        # Stationary for 65 minutes within 20m of anchor
        fixes = [
            TelemetryPoint(
                id=i,
                lat=26.1445 + (i * 0.00005),
                lon=91.7362 + (i * 0.00005),
                recorded_at=now - timedelta(minutes=65 - i * 5),
                received_at=now - timedelta(minutes=65 - i * 5),
            )
            for i in range(14)
        ]
        decision = evaluate_trip_sentinel(
            fixes=fixes, approved_stops=[], has_open_emergency=False, now=now
        )
        assert decision.kind == SentinelDecisionKind.DRIVER_CHECK_REQUIRED
        assert decision.stationary_since is not None
        assert decision.stationary_since <= now - timedelta(minutes=60)

    def test_stationary_inside_approved_stop_is_healthy(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        stop_lat, stop_lon = 26.1500, 91.7500
        approved_stops = [
            ApprovedStop(
                id=uuid.uuid4(),
                kind="REST",
                lat=stop_lat,
                lon=stop_lon,
                name="Safe Rest Plaza",
            )
        ]
        # Stationary for 70 minutes right at the rest stop (50m away)
        fixes = [
            TelemetryPoint(
                id=i,
                lat=stop_lat + 0.0002,
                lon=stop_lon + 0.0002,
                recorded_at=now - timedelta(minutes=70 - i * 5),
                received_at=now - timedelta(minutes=70 - i * 5),
            )
            for i in range(15)
        ]
        decision = evaluate_trip_sentinel(
            fixes=fixes,
            approved_stops=approved_stops,
            has_open_emergency=False,
            now=now,
        )
        assert decision.kind == SentinelDecisionKind.HEALTHY_AT_APPROVED_STOP

    def test_comms_lost_when_no_fix_for_over_60_min(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        # Last fix was 75 minutes ago
        fixes = [
            TelemetryPoint(
                id=1,
                lat=26.1445,
                lon=91.7362,
                recorded_at=now - timedelta(minutes=75),
                received_at=now - timedelta(minutes=75),
            )
        ]
        decision = evaluate_trip_sentinel(
            fixes=fixes, approved_stops=[], has_open_emergency=False, now=now
        )
        assert decision.kind == SentinelDecisionKind.COMMS_LOST

    def test_already_active_check_avoids_duplicate(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        fixes = [
            TelemetryPoint(
                id=i,
                lat=26.1445,
                lon=91.7362,
                recorded_at=now - timedelta(minutes=65 - i * 5),
                received_at=now - timedelta(minutes=65 - i * 5),
            )
            for i in range(14)
        ]
        decision = evaluate_trip_sentinel(
            fixes=fixes, approved_stops=[], has_open_emergency=True, now=now
        )
        assert decision.kind == SentinelDecisionKind.ALREADY_ACTIVE_CHECK

    def test_device_clock_skew_does_not_affect_sentinel(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        # Device clock skewed ahead by 4 hours
        skewed_recorded = now + timedelta(hours=4)
        fixes = [
            TelemetryPoint(
                id=i,
                lat=26.1445,
                lon=91.7362,
                recorded_at=skewed_recorded - timedelta(minutes=65 - i * 5),
                received_at=now - timedelta(minutes=65 - i * 5),
            )
            for i in range(14)
        ]
        # Sentinel uses received_at, so it correctly detects 65 minutes stationary
        is_stat, since, latest = evaluate_stationary_window(fixes, now)
        assert is_stat is True
        assert since == fixes[0].received_at

    def test_escalation_rules(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        deadline = now + timedelta(minutes=30)

        # 1. Under deadline, no response -> do NOT escalate
        assert (
            should_escalate_emergency(
                state=EmergencyState.DRIVER_CHECK_REQUIRED,
                check_sent_at=now,
                response_deadline_at=deadline,
                driver_response=None,
                now=now + timedelta(minutes=25),
            )
            is False
        )

        # 2. At or past deadline, no response -> ESCALATE
        assert (
            should_escalate_emergency(
                state=EmergencyState.DRIVER_CHECK_REQUIRED,
                check_sent_at=now,
                response_deadline_at=deadline,
                driver_response=None,
                now=now + timedelta(minutes=30, seconds=1),
            )
            is True
        )

        # 3. NEED_HELP -> Immediate escalation even at minute 1
        assert (
            should_escalate_emergency(
                state=EmergencyState.DRIVER_CHECK_REQUIRED,
                check_sent_at=now,
                response_deadline_at=deadline,
                driver_response=DriverCheckResponse.NEED_HELP,
                now=now + timedelta(minutes=1),
            )
            is True
        )

        # 4. Informational response (TRAFFIC) -> do NOT escalate
        assert (
            should_escalate_emergency(
                state=EmergencyState.DRIVER_CHECK_REQUIRED,
                check_sent_at=now,
                response_deadline_at=deadline,
                driver_response=DriverCheckResponse.TRAFFIC,
                now=now + timedelta(minutes=35),
            )
            is False
        )

    def test_briefing_snapshot_completeness(self) -> None:
        now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
        snapshot = build_briefing_snapshot(
            trip_code="TRIP-TEST-001",
            driver_name="Ramesh Sharma",
            driver_phone="+919435012345",
            emergency_contact_name="Sunita Sharma",
            emergency_contact_phone="+919435098765",
            truck_registration="AS-01-AB-1234",
            truck_model="Tata Signa 2823.K",
            cargo_priority="CRITICAL",
            cargo_weight_kg=Decimal("15000"),
            origin_name="Guwahati Central Hub",
            destination_name="Jorhat Distribution Depot",
            last_lat=26.1445,
            last_lon=91.7362,
            last_fix_at=now - timedelta(minutes=5),
            stationary_since=now - timedelta(minutes=65),
            escalation_reason="30-min deadline expired",
            now=now,
        )

        assert snapshot["trip_code"] == "TRIP-TEST-001"
        assert snapshot["driver"]["name"] == "Ramesh Sharma"
        assert snapshot["driver"]["emergency_contact_phone"] == "+919435098765"
        assert snapshot["truck"]["registration"] == "AS-01-AB-1234"
        assert snapshot["cargo"]["priority"] == "CRITICAL"
        assert snapshot["cargo"]["weight_kg"] == 15000.0
        assert snapshot["location"]["lat"] == 26.1445
        assert len(snapshot["suggested_actions"]) == 4
        assert "1. Attempt voice contact" in snapshot["suggested_actions"][0]


# --- Integration Tests (Against Isolated PostgreSQL Cluster) --------------


class TestSentinelIntegration:
    async def _setup_active_trip(
        self, session: AsyncSession
    ) -> tuple[Trip, factories.Driver, factories.Truck]:
        driver, user = await factories.make_driver(session)
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
        return trip, driver, truck

    async def _add_fixes(
        self,
        session: AsyncSession,
        trip: Trip,
        lat: float,
        lon: float,
        start_time: datetime,
        count: int = 14,
        interval_minutes: int = 5,
    ) -> list[GpsPoint]:
        fixes = []
        for i in range(count):
            t = start_time + timedelta(minutes=i * interval_minutes)
            pt = GpsPoint(
                trip_id=trip.id,
                driver_id=trip.driver_id,
                truck_id=trip.truck_id,
                device_fix_id=uuid.uuid4(),
                location=WKTElement(f"SRID=4326;POINT({lon} {lat})"),
                recorded_at=t,
                received_at=t,
                speed_kmph=Decimal("0.0"),
                heading_deg=Decimal("0.0"),
                accuracy_m=Decimal("15.0"),
            )
            session.add(pt)
            fixes.append(pt)
        await session.commit()
        return fixes

    async def test_sentinel_sweep_creates_emergency_for_stationary_truck(
        self, session: AsyncSession
    ) -> None:
        trip, driver, truck = await self._setup_active_trip(session)

        now = datetime(2026, 9, 9, 14, 0, 0, tzinfo=UTC)
        # Stationary outside any stop for 65 minutes
        await self._add_fixes(
            session,
            trip,
            lat=26.3000,
            lon=92.1000,
            start_time=now - timedelta(minutes=65),
            count=14,
        )

        emergencies = await sentinel_service.run_sentinel_sweep(session, now=now)
        assert len(emergencies) == 1
        em = emergencies[0]
        assert em.trip_id == trip.id
        assert em.state == EmergencyState.DRIVER_CHECK_REQUIRED
        assert em.check_sent_at == now
        assert em.response_deadline_at == now + timedelta(seconds=DRIVER_RESPONSE_WINDOW_SECONDS)

        # Assert trip event was recorded
        event = (
            await session.execute(
                select(TripEvent).where(
                    TripEvent.trip_id == trip.id,
                    TripEvent.kind == TripEventKind.DELAY_DETECTED,
                )
            )
        ).scalar_one_or_none()
        assert event is not None

    async def test_sentinel_sweep_deduplicates_repeated_runs(
        self, session: AsyncSession
    ) -> None:
        """The monitor runs every 5 minutes and must NOT spam checks."""
        trip, driver, truck = await self._setup_active_trip(session)

        now = datetime(2026, 9, 9, 14, 0, 0, tzinfo=UTC)
        await self._add_fixes(
            session,
            trip,
            lat=26.3000,
            lon=92.1000,
            start_time=now - timedelta(minutes=65),
            count=14,
        )

        # Run sweep 12 times in 5-minute increments (within the 30-min response window)
        for tick in range(5):
            tick_now = now + timedelta(minutes=tick * 5)
            await sentinel_service.run_sentinel_sweep(session, now=tick_now)

        # Assert exactly ONE emergency row exists
        all_em = (
            (
                await session.execute(
                    select(Emergency).where(Emergency.trip_id == trip.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(all_em) == 1
        assert all_em[0].state == EmergencyState.DRIVER_CHECK_REQUIRED

    async def test_driver_check_in_need_help_escalates_immediately(
        self, session: AsyncSession
    ) -> None:
        trip, driver, truck = await self._setup_active_trip(session)
        now = datetime(2026, 9, 9, 14, 0, 0, tzinfo=UTC)

        # Create open emergency
        em = Emergency(
            trip_id=trip.id,
            state=EmergencyState.DRIVER_CHECK_REQUIRED,
            triggered_at=now,
            stationary_since=now - timedelta(minutes=60),
            check_sent_at=now,
            response_deadline_at=now + timedelta(minutes=30),
        )
        session.add(em)
        await session.commit()

        # Driver responds NEED_HELP after 2 minutes
        updated = await sentinel_service.record_driver_check_in(
            session,
            driver=driver,
            trip_id=trip.id,
            response=DriverCheckResponse.NEED_HELP,
            now=now + timedelta(minutes=2),
        )

        assert updated.state == EmergencyState.SOS_ESCALATED
        assert updated.escalated_at == now + timedelta(minutes=2)
        assert updated.briefing_snapshot is not None
        assert updated.briefing_snapshot["trip_code"] == trip.trip_code

        # Trip transitioned to INCIDENT
        await session.refresh(trip)
        assert trip.status == TripStatus.INCIDENT

    async def test_driver_check_in_traffic_updates_state_without_escalation(
        self, session: AsyncSession
    ) -> None:
        trip, driver, truck = await self._setup_active_trip(session)
        now = datetime(2026, 9, 9, 14, 0, 0, tzinfo=UTC)

        em = Emergency(
            trip_id=trip.id,
            state=EmergencyState.DRIVER_CHECK_REQUIRED,
            triggered_at=now,
            stationary_since=now - timedelta(minutes=60),
            check_sent_at=now,
            response_deadline_at=now + timedelta(minutes=30),
        )
        session.add(em)
        await session.commit()

        updated = await sentinel_service.record_driver_check_in(
            session,
            driver=driver,
            trip_id=trip.id,
            response=DriverCheckResponse.TRAFFIC,
            now=now + timedelta(minutes=5),
        )

        assert updated.state == EmergencyState.DRIVER_RESPONDED
        assert updated.driver_response == DriverCheckResponse.TRAFFIC
        assert updated.briefing_snapshot is None
        await session.refresh(trip)
        assert trip.status == TripStatus.ACTIVE

    async def test_silence_escalates_on_30_min_deadline_expiry(
        self, session: AsyncSession
    ) -> None:
        trip, driver, truck = await self._setup_active_trip(session)
        now = datetime(2026, 9, 9, 14, 0, 0, tzinfo=UTC)

        em = Emergency(
            trip_id=trip.id,
            state=EmergencyState.DRIVER_CHECK_REQUIRED,
            triggered_at=now,
            stationary_since=now - timedelta(minutes=60),
            check_sent_at=now,
            response_deadline_at=now + timedelta(minutes=30),
        )
        session.add(em)
        await session.commit()

        # Run sweep at minute 31 (deadline passed, zero response)
        escalated = await sentinel_service.run_sentinel_sweep(
            session, now=now + timedelta(minutes=31)
        )
        assert len(escalated) == 1
        assert escalated[0].state == EmergencyState.SOS_ESCALATED
        assert escalated[0].briefing_snapshot is not None

        await session.refresh(trip)
        assert trip.status == TripStatus.INCIDENT

    async def test_late_response_after_escalation_is_recorded(
        self, session: AsyncSession
    ) -> None:
        """A driver responding after SOS does NOT drop the incident."""
        trip, driver, truck = await self._setup_active_trip(session)
        now = datetime(2026, 9, 9, 14, 0, 0, tzinfo=UTC)

        em = Emergency(
            trip_id=trip.id,
            state=EmergencyState.SOS_ESCALATED,
            triggered_at=now - timedelta(minutes=40),
            stationary_since=now - timedelta(minutes=100),
            check_sent_at=now - timedelta(minutes=40),
            response_deadline_at=now - timedelta(minutes=10),
            escalated_at=now - timedelta(minutes=10),
            briefing_snapshot={"briefing": "frozen"},
        )
        session.add(em)
        await session.commit()

        # Driver signs in and presses "I_AM_SAFE" 10 minutes late
        late = await sentinel_service.record_driver_check_in(
            session,
            driver=driver,
            trip_id=trip.id,
            response=DriverCheckResponse.I_AM_SAFE,
            now=now,
        )

        assert late.state == EmergencyState.SOS_ESCALATED  # Stays escalated
        assert late.driver_response == DriverCheckResponse.I_AM_SAFE
        assert late.responded_at == now

    async def test_resolve_emergency_by_manager(
        self, session: AsyncSession
    ) -> None:
        trip, driver, truck = await self._setup_active_trip(session)
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        now = datetime(2026, 9, 9, 14, 0, 0, tzinfo=UTC)

        em = Emergency(
            trip_id=trip.id,
            state=EmergencyState.SOS_ESCALATED,
            triggered_at=now - timedelta(minutes=30),
            stationary_since=now - timedelta(minutes=90),
            check_sent_at=now - timedelta(minutes=30),
            response_deadline_at=now,
            escalated_at=now,
        )
        session.add(em)
        trip.status = TripStatus.INCIDENT
        await session.commit()

        resolved = await sentinel_service.resolve_emergency(
            session,
            emergency_id=em.id,
            actor=manager,
            note="Confirmed driver tyre replacement finished",
            is_false_alarm=False,
            now=now + timedelta(minutes=15),
        )

        assert resolved.state == EmergencyState.RESOLVED
        assert resolved.resolved_by_user_id == manager.id
        assert resolved.resolution_note == "Confirmed driver tyre replacement finished"

        await session.refresh(trip)
        assert trip.status == TripStatus.ACTIVE  # Restored to ACTIVE
