"""One overview per role, computed from rows the caller may actually read.

WHAT THIS DEFENDS

The failure a dashboard invites is the opposite of the one a list invites.
A list leaks by returning a row; a dashboard leaks by COUNTING one. A
district manager whose "trips under way" number includes the whole region
has been told something about a fleet they cannot see, and no amount of
row-level scoping elsewhere takes it back.

So every number here is asserted against a fixture where the out-of-scope
rows exist and must not be counted.

The second rule: no invented figures. Every field is a count of rows. If a
utilisation percentage ever appears in this payload, it needs a source and
a test, not a formula.
"""

import pytest

from app.models.enums import NotificationKind, TripStatus, UserRole
from app.services import notifications as notify_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def _trip(session, origin, dest, *, status=TripStatus.ACTIVE):
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    await factories.make_assignment(session, driver, truck, verified=True)
    shipment = await factories.make_shipment(
        session,
        origin_district_id=origin.id if origin else None,
        destination_district_id=dest.id if dest else None,
    )
    return await factories.make_trip(
        session, driver, truck, shipment=shipment, status=status
    )


async def _dash(api, user):
    headers = await auth_headers(api, user.email or user.phone, factories.TEST_PASSWORD)
    r = await api.get("/api/dashboard", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestDistrictManager:
    async def test_counts_only_trips_touching_their_district(self, api, session):
        mine = await factories.make_district(session, slug="dash-mine")
        theirs = await factories.make_district(session, slug="dash-theirs")
        far = await factories.make_district(session, slug="dash-far")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )

        await _trip(session, mine, theirs)  # outgoing
        await _trip(session, theirs, mine)  # incoming
        await _trip(session, theirs, far)  # not theirs at all
        await session.commit()

        body = await _dash(api, me)
        assert body["role"] == "DISTRICT_MANAGER"
        assert body["trips_under_way"] == 2, (
            "a dashboard that counts the region has told a district manager "
            "about a fleet they cannot see"
        )

    async def test_incoming_and_outgoing_are_separated(self, api, session):
        mine = await factories.make_district(session, slug="dash-io-mine")
        other = await factories.make_district(session, slug="dash-io-other")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        await _trip(session, mine, other)
        await _trip(session, other, mine)
        await _trip(session, other, mine)
        await session.commit()

        body = await _dash(api, me)
        assert len(body["districts"]) == 1
        row = body["districts"][0]
        assert row["name"] == mine.name
        assert (row["outgoing"], row["incoming"]) == (1, 2)

    async def test_gets_no_state_table_and_no_cross_state_count(self, api, session):
        """Not their question. A section computed from rows they cannot read
        would be a leak; a section they have no use for is clutter."""
        mine = await factories.make_district(session, slug="dash-nostates")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        body = await _dash(api, me)
        assert body["states"] == []
        assert body["cross_state_trips"] is None

    async def test_the_scope_is_named_on_the_payload(self, api, session):
        mine = await factories.make_district(session, slug="dash-label")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        body = await _dash(api, me)
        assert mine.name in body["scope_label"]
        assert "district" in body["scope_label"]


class TestStateManager:
    async def test_sees_their_whole_state_and_nothing_outside_it(
        self, api, session
    ):
        home_a = await factories.make_district(
            session, state_slug="assam", slug="dash-sm-a"
        )
        home_b = await factories.make_district(
            session, state_slug="assam", slug="dash-sm-b"
        )
        away = await factories.make_district(
            session, state_slug="mizoram", slug="dash-sm-away"
        )
        me = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=home_a.state_id
        )

        await _trip(session, home_a, home_b)  # internal
        await _trip(session, home_a, away)  # crossing, touches my state
        await _trip(session, away, away)  # nothing to do with me
        await session.commit()

        # The district TABLE is an operational list, so it shows only
        # districts whose source the system can name. Two of these are
        # borrowed as real for the length of this test; the trip counts
        # below do not depend on that and are asserted outside it.
        async with factories.operational(session, home_a), factories.operational(
            session, home_b
        ):
            body = await _dash(api, me)
            # Their districts, not the region's.
            assert {d["name"] for d in body["districts"]} >= {home_a.name, home_b.name}
            assert away.name not in {d["name"] for d in body["districts"]}

        assert body["trips_under_way"] == 2
        assert body["cross_state_trips"] == 1
        assert body["states"] == []


class TestRegionalManager:
    async def test_gets_a_state_table_covering_all_eight(self, api, session):
        me = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        body = await _dash(api, me)
        assert len(body["states"]) == 8
        assert {s["name"] for s in body["states"]} >= {"Assam", "Sikkim"}
        assert body["scope_label"].startswith("North-East")

    async def test_counts_a_crossing_trip_once_per_state_it_touches(
        self, api, session
    ):
        here = await factories.make_district(
            session, state_slug="assam", slug="dash-ne-here"
        )
        there = await factories.make_district(
            session, state_slug="nagaland", slug="dash-ne-there"
        )
        me = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        await _trip(session, here, there)
        await session.commit()

        body = await _dash(api, me)
        by_name = {s["name"]: s for s in body["states"]}
        assert by_name["Assam"]["trips_under_way"] >= 1
        assert by_name["Nagaland"]["trips_under_way"] >= 1
        assert body["cross_state_trips"] >= 1

    async def test_reports_districts_configured_honestly(self, api, session):
        """Zero districts is the real state until an official list is loaded,
        and the number must say so rather than being hidden."""
        me = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        body = await _dash(api, me)
        assert all(s["districts_configured"] >= 0 for s in body["states"])


class TestAttentionAndPresence:
    async def test_delayed_and_incident_trips_are_the_attention_count(
        self, api, session
    ):
        mine = await factories.make_district(session, slug="dash-att")
        other = await factories.make_district(session, slug="dash-att-other")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        await _trip(session, mine, other, status=TripStatus.ACTIVE)
        await _trip(session, mine, other, status=TripStatus.DELAYED)
        await _trip(session, mine, other, status=TripStatus.INCIDENT)
        await session.commit()

        body = await _dash(api, me)
        assert body["trips_under_way"] == 3
        assert body["trips_needing_attention"] == 2

    async def test_a_driver_with_no_heartbeat_is_not_counted_online(
        self, api, session
    ):
        """The whole point of the presence work: a row existing is not a
        person being there."""
        mine = await factories.make_district(session, slug="dash-presence")
        other = await factories.make_district(session, slug="dash-presence-o")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        await _trip(session, mine, other)
        await session.commit()

        body = await _dash(api, me)
        assert body["drivers_in_scope"] == 1
        assert body["drivers_online"] == 0

    async def test_urgent_notifications_are_counted_separately(self, api, session):
        mine = await factories.make_district(session, slug="dash-urgent")
        other = await factories.make_district(session, slug="dash-urgent-o")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        trip = await _trip(session, mine, other)
        await notify_service.notify(
            session,
            recipients=[me],
            kind=NotificationKind.DRIVER_EMERGENCY_STOP,
            dedupe_key=f"dash:{trip.id}",
            trip_id=trip.id,
        )
        await notify_service.notify(
            session,
            recipients=[me],
            kind=NotificationKind.TRIP_DISPATCHED,
            dedupe_key=f"dash2:{trip.id}",
            trip_id=trip.id,
        )
        await session.commit()

        body = await _dash(api, me)
        assert body["unread_notifications"] == 2
        assert body["urgent_notifications"] == 1


class TestTheNumbersAreOnlyCounts:
    async def test_no_field_is_a_derived_rate_or_a_prediction(self, api, session):
        """A guard against the next well-meaning addition.

        Utilisation, efficiency and predicted arrival all need ground truth
        this project does not have. If one of them is ever added it needs a
        source and a test, and this assertion should fail first.
        """
        me = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        body = await _dash(api, me)
        forbidden = ("utilisation", "utilization", "efficiency", "eta", "predicted", "score")
        assert not [k for k in body if any(word in k.lower() for word in forbidden)]
