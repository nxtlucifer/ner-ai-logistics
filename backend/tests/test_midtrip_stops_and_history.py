"""Mid-trip manager control: adding a stop, the journey history, list filters.

WHAT THESE DEFEND

  * a stop the driver already served is never renumbered or rewritten
  * a stop cannot be added to a trip that is not under way, is out of region,
    is unconfirmed, or sits on top of a stop the trip already has
  * the change reaches the cab as an instruction that must be acknowledged,
    and "seen" is a record rather than an assumption
  * a double click adds ONE stop
  * the route is NOT silently changed by adding a stop
  * a trip older than the newest page is still reachable by search and filter
"""

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import TripStatus, TripStopStatus, UserRole
from app.models.operations import Trip, TripStop
from app.services import trips as trip_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

# Guwahati -> Shillong corridor; all inside the service region.
ON_THE_WAY = {"lat": 25.9, "lon": 91.87}
NEAR_PICKUP = {"lat": 26.1446, "lon": 91.7363}  # ~15 m from the pickup stop
OUT_OF_REGION = {"lat": 23.02, "lon": 72.57}  # Ahmedabad
REASON = "Consignee asked for a second drop on the way; confirmed by phone."


async def _headers(api: AsyncClient, session: AsyncSession, role: UserRole) -> dict:
    user = await factories.make_user(session, role=role)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    return await _headers(api, session, UserRole.MANAGER)


async def _trip(session: AsyncSession, status: TripStatus = TripStatus.ACTIVE):
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=2, status=status
    )
    await session.commit()
    return trip, driver, user


def _add(api: AsyncClient, trip_id, headers, **over):
    body = {"location": ON_THE_WAY, "address": "Nongpoh weighbridge", "reason": REASON, **over}
    return api.post(f"/api/trips/{trip_id}/stops", headers=headers, json=body)


async def _stops(trip_id):
    from app.db import session as db_session

    async with db_session.get_sessionmaker()() as fresh:
        return list(
            (
                await fresh.execute(
                    select(TripStop).where(TripStop.trip_id == trip_id).order_by(TripStop.sequence)
                )
            ).scalars()
        )


class TestAddStop:
    async def test_a_stop_is_inserted_next_and_the_driver_must_acknowledge_it(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        from app.db import session as db_session

        trip, _, user = await _trip(session)
        # The realistic mid-trip state: the cargo is already collected, so
        # "next" means the next stop still to serve, after the pickup.
        async with db_session.get_sessionmaker()() as writer:
            pickup = (
                await writer.execute(
                    select(TripStop).where(TripStop.trip_id == trip.id).order_by(TripStop.sequence)
                )
            ).scalars().first()
            pickup.status = TripStopStatus.COMPLETED
            await writer.commit()
            pickup_id, pickup_seq = pickup.id, pickup.sequence
        before = await _stops(trip.id)
        assert len(before) == 2

        ok = await _add(api, trip.id, manager_headers)
        assert ok.status_code == 201, ok.text
        body = ok.json()
        assert [s["address"] for s in body["stops"]].count("Nongpoh weighbridge") == 1
        assert body["pending_instruction"]["instruction"] == "ADD_STOP"
        assert body["pending_instruction"]["reason"] == REASON

        after = await _stops(trip.id)
        assert len(after) == 3
        seqs = [s.sequence for s in after]
        assert seqs == list(range(min(seqs), min(seqs) + 3)), f"sequences are not contiguous: {seqs}"
        assert len(set(seqs)) == 3
        served = next(s for s in after if s.id == pickup_id)
        assert served.sequence == pickup_seq, "the completed pickup was renumbered"
        assert after[1].address == "Nongpoh weighbridge", "NEXT did not put the stop next"
        assert after[-1].id != after[1].id, "the new stop replaced the final delivery"

        # The driver sees it and acknowledges; the instruction then clears.
        driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        mine = await api.get("/api/driver/me/trip", headers=driver_headers)
        assert mine.json()["pending_instruction"]["instruction"] == "ADD_STOP"
        acked = await api.post(
            "/api/driver/me/trip/instruction/ack",
            headers=driver_headers,
            json={"event_id": mine.json()["pending_instruction"]["event_id"]},
        )
        assert acked.status_code == 200, acked.text
        assert acked.json()["pending_instruction"] is None

    async def test_a_served_stop_is_never_renumbered(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """BEFORE_FINAL puts the stop ahead of the last pending drop-off and
        leaves everything already served exactly where it was."""
        from app.db import session as db_session

        trip, _, _ = await _trip(session)
        async with db_session.get_sessionmaker()() as writer:
            first = (
                await writer.execute(
                    select(TripStop).where(TripStop.trip_id == trip.id).order_by(TripStop.sequence)
                )
            ).scalars().first()
            first.status = TripStopStatus.COMPLETED
            await writer.commit()
            served_id, served_seq = first.id, first.sequence

        ok = await _add(api, trip.id, manager_headers, placement="BEFORE_FINAL")
        assert ok.status_code == 201, ok.text
        after = await _stops(trip.id)
        served = next(s for s in after if s.id == served_id)
        assert served.sequence == served_seq and served.status is TripStopStatus.COMPLETED
        assert [s.address for s in after][-1] != "Nongpoh weighbridge", (
            "BEFORE_FINAL put the new stop after the final delivery"
        )

    async def test_the_route_is_not_changed_by_adding_a_stop(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, _, _ = await _trip(session)
        from app.db import session as db_session

        async with db_session.get_sessionmaker()() as fresh:
            before = (await fresh.execute(select(Trip).where(Trip.id == trip.id))).scalar_one().selected_route_id
        assert (await _add(api, trip.id, manager_headers)).status_code == 201
        async with db_session.get_sessionmaker()() as fresh:
            after = (await fresh.execute(select(Trip).where(Trip.id == trip.id))).scalar_one().selected_route_id
        assert after == before, "adding a stop silently moved the truck onto another road"

    @pytest.mark.parametrize(
        "over,code",
        [
            ({"reason": "too short"}, "CHANGE_REASON_REQUIRED"),
            ({"location": OUT_OF_REGION}, "OUTSIDE_SERVICE_REGION"),
            ({"location": NEAR_PICKUP}, "STOP_TOO_CLOSE"),
        ],
    )
    async def test_refusals_store_nothing(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, over, code
    ):
        trip, _, _ = await _trip(session)
        refused = await _add(api, trip.id, manager_headers, **over)
        assert refused.status_code == 422, refused.text
        assert refused.json()["error"]["code"] == code
        assert len(await _stops(trip.id)) == 2

    async def test_a_blank_address_is_refused_by_the_contract(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, _, _ = await _trip(session)
        refused = await _add(api, trip.id, manager_headers, address="")
        assert refused.status_code == 422, refused.text
        assert len(await _stops(trip.id)) == 2

    async def test_a_trip_that_is_not_under_way_refuses(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        for state in (TripStatus.DRAFT, TripStatus.DELIVERED, TripStatus.CANCELLED):
            trip, _, _ = await _trip(session, status=state)
            refused = await _add(api, trip.id, manager_headers)
            assert refused.status_code == 422, f"{state}: {refused.text}"
            assert refused.json()["error"]["code"] == "TRIP_NOT_IN_TRANSIT"
            assert len(await _stops(trip.id)) == 2

    async def test_a_driver_cannot_add_a_stop(
        self, api: AsyncClient, session: AsyncSession
    ):
        trip, _, user = await _trip(session)
        driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        refused = await _add(api, trip.id, driver_headers)
        assert refused.status_code == 403, refused.text
        assert len(await _stops(trip.id)) == 2

    async def test_a_double_click_adds_one_stop(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The second request finds the first one's stop already there and is
        refused by the separation rule - one stop, not two."""
        trip, _, _ = await _trip(session)
        first, second = await asyncio.gather(
            _add(api, trip.id, manager_headers),
            _add(api, trip.id, manager_headers),
        )
        codes = sorted([first.status_code, second.status_code])
        assert codes == [201, 422], f"{first.status_code} {second.status_code}"
        stops = await _stops(trip.id)
        assert [s.address for s in stops].count("Nongpoh weighbridge") == 1
        seqs = sorted(s.sequence for s in stops)
        assert seqs == list(range(seqs[0], seqs[0] + 3)), f"sequences are not contiguous: {seqs}"


class TestJourneyHistory:
    async def test_the_timeline_reads_as_a_story_and_carries_no_coordinates(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        trip, _, user = await _trip(session)
        assert (await _add(api, trip.id, manager_headers)).status_code == 201

        events = await api.get(f"/api/trips/{trip.id}/events", headers=manager_headers)
        assert events.status_code == 200, events.text
        rows = events.json()
        assert rows, "no timeline for a trip that has been changed"
        times = [r["occurred_at"] for r in rows]
        assert times == sorted(times), "the timeline is not in order"
        added = next(r for r in rows if r["instruction"] == "ADD_STOP")
        assert added["kind"] == "ROUTE_CHANGED"
        assert added["reason"] == REASON
        assert added["actor_name"], "the timeline does not say who did it"
        assert added["acknowledged"] is False
        for r in rows:
            assert "lat" not in str(r) and "location" not in r

        driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        mine = await api.get("/api/driver/me/trip", headers=driver_headers)
        await api.post(
            "/api/driver/me/trip/instruction/ack",
            headers=driver_headers,
            json={"event_id": mine.json()["pending_instruction"]["event_id"]},
        )
        again = await api.get(f"/api/trips/{trip.id}/events", headers=manager_headers)
        assert next(r for r in again.json() if r["instruction"] == "ADD_STOP")["acknowledged"] is True

    async def test_a_driver_cannot_read_another_trips_history(
        self, api: AsyncClient, session: AsyncSession
    ):
        trip, _, user = await _trip(session)
        driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        refused = await api.get(f"/api/trips/{trip.id}/events", headers=driver_headers)
        assert refused.status_code == 403, refused.text


class TestTripFilters:
    async def test_search_status_and_history_reach_a_trip_beyond_the_first_page(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """The defect this closes: the console read the newest 50 and filtered
        in the browser, so an older trip could not be reached at all."""
        old, _, _ = await _trip(session, status=TripStatus.DELIVERED)
        for _ in range(3):
            await _trip(session)

        page = await api.get("/api/trips?limit=2", headers=manager_headers)
        assert page.status_code == 200, page.text
        body = page.json()
        assert len(body["items"]) == 2 and body["next_cursor"]
        assert body["total"] >= 4, body["total"]

        found = await api.get(f"/api/trips?search={old.trip_code}", headers=manager_headers)
        assert [t["trip_code"] for t in found.json()["items"]] == [old.trip_code]
        assert found.json()["total"] == 1

        history = await api.get("/api/trips?open_only=false&limit=100", headers=manager_headers)
        codes = [t["trip_code"] for t in history.json()["items"]]
        assert old.trip_code in codes
        assert all(t["status"] in ("DELIVERED", "CLOSED", "CANCELLED") for t in history.json()["items"])

        open_page = await api.get("/api/trips?open_only=true&limit=100", headers=manager_headers)
        assert old.trip_code not in [t["trip_code"] for t in open_page.json()["items"]]

    async def test_filter_by_driver_and_truck(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        mine, driver, _ = await _trip(session)
        await _trip(session)
        by_driver = await api.get(
            f"/api/trips?driver_id={driver.id}&limit=100", headers=manager_headers
        )
        assert [t["trip_code"] for t in by_driver.json()["items"]] == [mine.trip_code]
        by_truck = await api.get(
            f"/api/trips?truck_id={mine.truck_id}&limit=100", headers=manager_headers
        )
        assert [t["trip_code"] for t in by_truck.json()["items"]] == [mine.trip_code]

    async def test_paging_with_a_cursor_walks_the_whole_filtered_set_once(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        for _ in range(5):
            await _trip(session)
        seen: list[str] = []
        cursor = None
        for _ in range(10):
            url = "/api/trips?open_only=true&limit=2" + (f"&cursor={cursor}" if cursor else "")
            page = (await api.get(url, headers=manager_headers)).json()
            seen += [t["trip_code"] for t in page["items"]]
            cursor = page["next_cursor"]
            if not cursor:
                break
        assert len(seen) == len(set(seen)), "a trip appeared on two pages"
        assert len(seen) >= 5


class TestPhotoIsolation:
    async def test_a_photo_uploaded_for_one_driver_changes_only_that_driver(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ):
        """Isolation, not appearance: two drivers may legitimately hold the
        same picture, but one upload must never move another driver's photo."""
        a, _ = await factories.make_driver(session)
        b, _ = await factories.make_driver(session)
        await session.commit()

        png = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000a49444154789c6360000002000100ffff03000006000557bfabd4000000"
            "0049454e44ae426082"
        )
        up = await api.post(
            f"/api/files?kind=PROFILE_PHOTO&driver_id={a.id}",
            headers={**manager_headers, "Content-Type": "image/png"},
            content=png,
        )
        assert up.status_code in (200, 201), up.text
        a_url = up.json()["url"]

        drivers = (await api.get("/api/drivers?page_size=100", headers=manager_headers)).json()["items"]
        by_id = {d["id"]: d for d in drivers}
        assert by_id[str(a.id)]["photo_url"] == a_url
        assert by_id[str(b.id)]["photo_url"] is None, "B's photo followed A's upload"

        up_b = await api.post(
            f"/api/files?kind=PROFILE_PHOTO&driver_id={b.id}",
            headers={**manager_headers, "Content-Type": "image/png"},
            content=png,
        )
        assert up_b.status_code in (200, 201), up_b.text
        drivers = (await api.get("/api/drivers?page_size=100", headers=manager_headers)).json()["items"]
        by_id = {d["id"]: d for d in drivers}
        assert by_id[str(b.id)]["photo_url"] == up_b.json()["url"]
        assert by_id[str(a.id)]["photo_url"] == a_url, "A's photo moved when B uploaded"
        assert by_id[str(a.id)]["photo_url"] != by_id[str(b.id)]["photo_url"], (
            "two drivers share one file reference - a photo is not per-driver"
        )
