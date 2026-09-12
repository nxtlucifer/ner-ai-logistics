"""API Integration tests for Fleet Sentinel emergency endpoints.

Tests driver check-in flow and manager active emergency review and resolution.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.sentinel import (
    DRIVER_RESPONSE_WINDOW_SECONDS,
    DriverCheckResponse,
    EmergencyState,
)
from app.models.emergency import Emergency
from app.models.enums import TripStatus, UserRole
from app.models.operations import Trip, TripStop
from app.services import sentinel as sentinel_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _setup_active_trip_with_emergency(session: AsyncSession):
    driver, driver_user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver=driver, truck=truck)
    shipment = await factories.make_shipment(session)

    trip = await factories.make_trip(
        session,
        shipment=shipment,
        driver=driver,
        truck=truck,
        status=TripStatus.ACTIVE,
    )

    now = datetime(2026, 9, 9, 12, 0, 0, tzinfo=UTC)
    deadline = now + timedelta(seconds=DRIVER_RESPONSE_WINDOW_SECONDS)
    emergency = Emergency(
        trip_id=trip.id,
        state=EmergencyState.DRIVER_CHECK_REQUIRED,
        triggered_at=now,
        stationary_since=now - timedelta(minutes=60),
        check_sent_at=now,
        response_deadline_at=deadline,
    )
    session.add(emergency)
    await session.commit()
    await session.refresh(emergency)
    return trip, driver, driver_user, truck, emergency


class TestDriverEmergencyApi:
    async def test_driver_sees_active_emergency_in_my_trip(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        trip, driver, driver_user, truck, emergency = (
            await _setup_active_trip_with_emergency(session)
        )
        headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)

        res = await api.get("/api/driver/me/trip", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["active_emergency"] is not None
        assert data["active_emergency"]["id"] == str(emergency.id)
        assert data["active_emergency"]["state"] == "DRIVER_CHECK_REQUIRED"

    async def test_driver_check_in_safe(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        trip, driver, driver_user, truck, emergency = (
            await _setup_active_trip_with_emergency(session)
        )
        headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)

        res = await api.post(
            "/api/driver/me/trip/check-in",
            headers=headers,
            json={"response": "I_AM_SAFE"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["state"] == "DRIVER_RESPONDED"
        assert data["driver_response"] == "I_AM_SAFE"

        # Check trip view updated
        refreshed = await api.get("/api/driver/me/trip", headers=headers)
        assert refreshed.json()["active_emergency"]["state"] == "DRIVER_RESPONDED"

    async def test_driver_check_in_need_help_escalates(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        trip, driver, driver_user, truck, emergency = (
            await _setup_active_trip_with_emergency(session)
        )
        headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)

        res = await api.post(
            "/api/driver/me/trip/check-in",
            headers=headers,
            json={"response": "NEED_HELP"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["state"] == "SOS_ESCALATED"
        assert data["driver_response"] == "NEED_HELP"
        assert data["briefing_snapshot"] is not None
        assert data["briefing_snapshot"]["driver"]["name"] == driver.full_name

        # Check trip transitioned to INCIDENT
        refreshed = await api.get("/api/driver/me/trip", headers=headers)
        assert refreshed.json()["status"] == "INCIDENT"

    async def test_driver_check_in_wrong_trip_id_refused(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        trip, driver, driver_user, truck, emergency = (
            await _setup_active_trip_with_emergency(session)
        )
        headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)

        fake_id = str(uuid.uuid4())
        res = await api.post(
            "/api/driver/me/trip/check-in",
            headers=headers,
            json={"response": "I_AM_SAFE", "trip_id": fake_id},
        )
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "TRIP_SUPERSEDED"


class TestManagerEmergencyApi:
    async def test_manager_lists_active_emergencies(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        trip, driver, driver_user, truck, emergency = (
            await _setup_active_trip_with_emergency(session)
        )
        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        res = await api.get("/api/emergencies/active", headers=headers)
        assert res.status_code == 200
        emergencies = res.json()
        assert any(e["id"] == str(emergency.id) for e in emergencies)

    async def test_manager_resolves_emergency(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        trip, driver, driver_user, truck, emergency = (
            await _setup_active_trip_with_emergency(session)
        )
        # Put in SOS_ESCALATED
        driver_headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)
        await api.post(
            "/api/driver/me/trip/check-in",
            headers=driver_headers,
            json={"response": "NEED_HELP"},
        )

        manager = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

        resolve_res = await api.post(
            f"/api/emergencies/{emergency.id}/resolve",
            headers=headers,
            json={"note": "Assistance dispatched, tyre replaced and verified.", "is_false_alarm": False},
        )
        assert resolve_res.status_code == 200
        res_data = resolve_res.json()
        assert res_data["state"] == "RESOLVED"
        assert res_data["resolution_note"] == "Assistance dispatched, tyre replaced and verified."

        # Active list no longer contains it
        active_res = await api.get("/api/emergencies/active", headers=headers)
        assert not any(e["id"] == str(emergency.id) for e in active_res.json())

    async def test_driver_forbidden_from_manager_emergency_endpoints(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        trip, driver, driver_user, truck, emergency = (
            await _setup_active_trip_with_emergency(session)
        )
        headers = await auth_headers(api, driver_user.phone, factories.TEST_PASSWORD)

        res = await api.get("/api/emergencies/active", headers=headers)
        assert res.status_code == 403

        res2 = await api.post(
            f"/api/emergencies/{emergency.id}/resolve",
            headers=headers,
            json={"note": "Unauthorized resolve attempt"},
        )
        assert res2.status_code == 403
