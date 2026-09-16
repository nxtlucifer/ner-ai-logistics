"""Cancel and redirect, before and after the cargo is on the truck.

Before pickup a job simply ends and the driver is told. After pickup nothing
changes silently: a reason and a cargo disposition are required, every outcome
is a timeline event the driver must acknowledge, and the current route stays
the driver's road until the manager selects a candidate for the new
destination. Pickup-first navigation is checked first because everything
here hangs off "has the pickup been completed".
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import RouteCandidate
from app.models.enums import (
    DriverStatus,
    RouteKind,
    TripEventKind,
    TripStatus,
    TripStopKind,
    TripStopStatus,
    UserRole,
)
from app.models.operations import DriverNotification, TripEvent, TripRoute, TripStop
from app.services import driver_trips
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

GUWAHATI = (26.1445, 91.7362)
SHILLONG = (25.5788, 91.8933)
AHMEDABAD = (23.0687, 72.6735)


class _Chain:
    """Provider stand-in: one road from Guwahati to Shillong, whatever is asked."""

    def __init__(self) -> None:
        self.calls = 0

    async def route_options(self, origin, destination, *, kind, limit=1, detailed=False):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        self.calls += 1
        candidate = RouteCandidate(
            kind=kind, provider="stub", geometry=[GUWAHATI, (25.9, 91.8), SHILLONG],
            distance_m=98_800.0, duration_s=4_620.0,
        )
        return ChainOptions(candidates=(candidate,), attempts=(ChainAttempt("stub", ok=True),))


@pytest.fixture
def chain(monkeypatch):
    c = _Chain()
    monkeypatch.setattr(route_service, "build_chain", lambda: c)
    return c


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


async def _crew(session: AsyncSession, status: TripStatus = TripStatus.ASSIGNED):
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    trip = await factories.make_trip(session, driver, truck, assignment=assignment, status=status)
    return driver, user, truck, trip


async def _loaded(api: AsyncClient, session: AsyncSession):
    """Driver started and completed the pickup: cargo is on the truck."""
    driver, user, truck, trip = await _crew(session)
    headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    started = await api.post("/api/driver/me/trip/start", headers=headers, json={})
    assert started.status_code == 200, started.text
    pickup_id = started.json()["next_stop_id"]
    assert (await api.post(f"/api/driver/me/trip/stops/{pickup_id}/arrive", headers=headers)).status_code == 200
    done = await api.post(f"/api/driver/me/trip/stops/{pickup_id}/complete", headers=headers)
    assert done.status_code == 200, done.text
    assert done.json()["stops"][0]["status"] == "COMPLETED"
    return driver, user, truck, trip, headers


async def _stops(session: AsyncSession, trip_id: uuid.UUID) -> list[TripStop]:
    return list((await session.execute(select(TripStop).where(TripStop.trip_id == trip_id).order_by(TripStop.sequence))).scalars().all())


class TestPickupFirst:
    def test_pickup_is_the_first_target_and_delivery_follows_only_after_completion(self) -> None:
        pickup = TripStop(sequence=0, kind=TripStopKind.PICKUP, status=TripStopStatus.PENDING)
        drop = TripStop(sequence=1, kind=TripStopKind.DROPOFF, status=TripStopStatus.PENDING)
        assert driver_trips.next_actionable_stop([pickup, drop]) is pickup
        pickup.status = TripStopStatus.ARRIVED  # arrival alone does not switch the target
        assert driver_trips.next_actionable_stop([pickup, drop]) is pickup
        pickup.status = TripStopStatus.COMPLETED
        assert driver_trips.next_actionable_stop([pickup, drop]) is drop
        drop.status = TripStopStatus.SKIPPED
        assert driver_trips.next_actionable_stop([pickup, drop]) is None


class TestBeforePickup:
    async def test_cancel_ends_the_job_and_tells_the_driver(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        driver, user, _, trip = await _crew(session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "CANCELLED"
        notes = (await session.execute(select(DriverNotification).where(DriverNotification.trip_id == trip.id))).scalars().all()
        assert [n.event for n in notes] == ["TRIP_CANCELLED"]
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        assert (await api.get("/api/driver/me/trip", headers=headers)).json() is None
        notices = (await api.get("/api/driver/me/notices", headers=headers)).json()
        assert notices[0]["event"] == "TRIP_CANCELLED" and "manager" in notices[0]["title"].lower()


class TestAfterPickup:
    async def test_no_reason_is_refused(self, api: AsyncClient, session: AsyncSession, manager_headers: dict) -> None:
        _, _, _, trip, _ = await _loaded(api, session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers)
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "CANCEL_REASON_REQUIRED"
        await session.refresh(trip)
        assert trip.status is TripStatus.ACTIVE

    async def test_no_disposition_is_refused(self, api: AsyncClient, session: AsyncSession, manager_headers: dict) -> None:
        _, _, _, trip, _ = await _loaded(api, session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers, json={"reason": "Party cancelled the order"})
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "POST_PICKUP_RESOLUTION_REQUIRED"

    async def test_hold_is_an_instruction_the_driver_acknowledges_once(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        _, _, _, trip, headers = await _loaded(api, session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers,
                           json={"reason": "Customer asked us to wait at the junction", "disposition": "HOLD_FOR_INSTRUCTION"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "DELAYED"

        mine = (await api.get("/api/driver/me/trip", headers=headers)).json()
        pending = mine["pending_instruction"]
        assert pending["instruction"] == "HOLD_FOR_INSTRUCTION" and "wait" in pending["reason"]
        detail = (await api.get(f"/api/trips/{trip.id}", headers=manager_headers)).json()
        assert detail["pending_instruction"]["event_id"] == pending["event_id"]  # manager sees "sent, not seen"

        ack = await api.post("/api/driver/me/trip/instruction/ack", headers=headers, json={"event_id": pending["event_id"]})
        assert ack.status_code == 200, ack.text
        assert ack.json()["pending_instruction"] is None
        again = await api.post("/api/driver/me/trip/instruction/ack", headers=headers, json={"event_id": pending["event_id"]})
        assert again.status_code == 200
        acks = (await session.execute(select(TripEvent).where(TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.ACCEPTED))).scalars().all()
        assert sum(1 for e in acks if (e.payload or {}).get("acknowledges") == pending["event_id"]) == 1
        assert (await api.get(f"/api/trips/{trip.id}", headers=manager_headers)).json()["pending_instruction"] is None

    async def test_return_to_depot_versions_the_stops_and_keeps_the_current_route(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, chain
    ) -> None:
        _, _, _, trip, headers = await _loaded(api, session)
        route = await factories.make_selected_route(session, trip.id)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers,
                           json={"reason": "Consignee refused delivery at the gate", "disposition": "RETURN_TO_DEPOT"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ACTIVE"
        assert r.json()["selected_route_id"] == str(route.id)  # the driver's road did not change underneath them

        stops = await _stops(session, trip.id)
        assert [(s.kind.value, s.status.value) for s in stops] == [
            ("PICKUP", "COMPLETED"), ("DROPOFF", "SKIPPED"), ("DROPOFF", "PENDING"),
        ]
        assert stops[2].address == (stops[0].address or stops[0].name)  # back to where it was loaded
        events = (await session.execute(select(TripEvent).where(TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.ROUTE_CHANGED))).scalars().all()
        assert events[-1].payload["instruction"] == "RETURN_TO_DEPOT" and events[-1].payload["previous_route_id"] == str(route.id)
        # The stub road ends at Shillong, not the depot: planning was refused by
        # the endpoint check and the redirect is intact regardless.
        assert chain.calls == 1
        assert (await api.get("/api/driver/me/trip", headers=headers)).json()["pending_instruction"]["new_destination"] == (stops[0].address or stops[0].name)

    async def test_new_destination_plans_candidates_for_the_new_drop_off(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, chain
    ) -> None:
        _, _, _, trip, _ = await _loaded(api, session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers, json={
            "reason": "Customer moved the delivery to Shillong", "disposition": "NEW_DESTINATION",
            "destination": {"lat": SHILLONG[0], "lon": SHILLONG[1]}, "destination_address": "Shillong Depot",
        })
        assert r.status_code == 200, r.text
        stops = await _stops(session, trip.id)
        assert stops[-1].address == "Shillong Depot" and stops[-1].status is TripStopStatus.PENDING
        routes = (await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))).scalars().all()
        assert [x.kind for x in routes] == [RouteKind.PRIMARY] and routes[0].state.value == "PROPOSED"
        assert chain.calls == 1

    async def test_new_destination_outside_the_region_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        _, _, _, trip, _ = await _loaded(api, session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers, json={
            "reason": "Customer moved the delivery far away", "disposition": "NEW_DESTINATION",
            "destination": {"lat": AHMEDABAD[0], "lon": AHMEDABAD[1]}, "destination_address": "Ahmedabad",
        })
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == "OUTSIDE_SERVICE_REGION"
        assert [s.status.value for s in await _stops(session, trip.id)] == ["COMPLETED", "PENDING"]

    async def test_cargo_unloaded_closes_the_job_with_the_disposition_on_record(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        driver, _, _, trip, _ = await _loaded(api, session)
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers,
                           json={"reason": "Cargo unloaded back at the pickup shed", "disposition": "CARGO_UNLOADED"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "CANCELLED"
        await session.refresh(driver)
        assert driver.status is DriverStatus.AVAILABLE
        ev = (await session.execute(select(TripEvent).where(TripEvent.trip_id == trip.id, TripEvent.kind == TripEventKind.CANCELLED))).scalar_one()
        assert ev.payload["disposition"] == "CARGO_UNLOADED"

    async def test_complete_current_leg_changes_nothing_but_is_audited(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        _, _, _, trip, _ = await _loaded(api, session)
        before = len((await session.execute(select(TripEvent).where(TripEvent.trip_id == trip.id))).scalars().all())
        r = await api.post(f"/api/trips/{trip.id}/cancel", headers=manager_headers,
                           json={"reason": "Decided to finish the delivery after all", "disposition": "COMPLETE_CURRENT_LEG"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ACTIVE"
        after = len((await session.execute(select(TripEvent).where(TripEvent.trip_id == trip.id))).scalars().all())
        assert after == before
        reason = (await session.execute(text("SELECT reason FROM audit_logs WHERE entity_id = :id ORDER BY created_at DESC LIMIT 1"), {"id": trip.id})).scalar_one()
        assert "complete current leg" in reason
