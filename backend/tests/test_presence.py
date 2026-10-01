"""A green dot has to mean something.

WHAT THIS DEFENDS

Three ways presence gets faked, all of which draw a dot for somebody who is
not there:

  * `navigator.onLine` - the browser has an interface up;
  * signal bars - the radio can see a tower;
  * an open tab - a laptop lid is not shut.

Presence here is a heartbeat this server received, and nothing else.

And the fourth mistake, which is the opposite one: calling a driver OFFLINE
because their GPS is stale. A driver in a gorge is present, reachable, and
has no position. Those are two facts and they stay two fields.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.domain import presence
from app.domain.presence import LocationFreshness, Presence
from app.models.enums import TripStatus, UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

NOW = datetime(2026, 9, 19, 12, 0, tzinfo=UTC)


class TestTheRule:
    def test_a_recent_heartbeat_is_online(self):
        s = presence.assess(last_seen_at=NOW - timedelta(seconds=30), now=NOW)
        assert s.presence is Presence.ONLINE
        assert s.seen_seconds_ago == 30

    def test_one_lost_beat_does_not_declare_someone_gone(self):
        """Beats are every 60 s and the window is 90 s, on purpose: a single
        dropped request on a hill road is not an absence."""
        assert (
            presence.assess(last_seen_at=NOW - timedelta(seconds=75), now=NOW).presence
            is Presence.ONLINE
        )

    def test_two_lost_beats_is_idle_not_offline(self):
        s = presence.assess(last_seen_at=NOW - timedelta(minutes=5), now=NOW)
        assert s.presence is Presence.IDLE

    def test_a_long_gap_is_offline(self):
        s = presence.assess(last_seen_at=NOW - timedelta(hours=2), now=NOW)
        assert s.presence is Presence.OFFLINE

    def test_never_seen_is_offline_not_a_crash(self):
        s = presence.assess(last_seen_at=None, now=NOW)
        assert s.presence is Presence.OFFLINE
        assert s.seen_seconds_ago is None

    def test_a_naive_timestamp_is_read_as_utc(self):
        """Some drivers of this column write naive datetimes. Treating one
        as local time would shift presence by hours."""
        s = presence.assess(
            last_seen_at=datetime(2026, 9, 19, 11, 59, 30), now=NOW
        )
        assert s.presence is Presence.ONLINE


class TestLocationIsASeparateFact:
    def test_online_with_no_position_is_a_real_state(self):
        """A driver in a gorge. Present, reachable, no sky view."""
        s = presence.assess(
            last_seen_at=NOW - timedelta(seconds=20), last_gps_at=None, now=NOW
        )
        assert s.presence is Presence.ONLINE
        assert s.location is LocationFreshness.UNAVAILABLE

    def test_a_stale_position_does_not_make_the_person_offline(self):
        s = presence.assess(
            last_seen_at=NOW - timedelta(seconds=20),
            last_gps_at=NOW - timedelta(hours=1),
            now=NOW,
        )
        assert s.presence is Presence.ONLINE
        assert s.location is LocationFreshness.STALE

    def test_no_news_and_old_news_are_different_words(self):
        no_news = presence.assess(last_seen_at=NOW, last_gps_at=None, now=NOW)
        old_news = presence.assess(
            last_seen_at=NOW, last_gps_at=NOW - timedelta(hours=3), now=NOW
        )
        assert no_news.location is LocationFreshness.UNAVAILABLE
        assert old_news.location is LocationFreshness.STALE

    def test_the_freshness_ladder(self):
        for age, expected in [
            (timedelta(seconds=30), LocationFreshness.FRESH),
            (timedelta(minutes=5), LocationFreshness.AGEING),
            (timedelta(minutes=30), LocationFreshness.STALE),
        ]:
            s = presence.assess(last_seen_at=NOW, last_gps_at=NOW - age, now=NOW)
            assert s.location is expected, age


class TestHeartbeat:
    async def test_a_beat_records_presence_and_the_next_one_is_coalesced(
        self, api, session
    ):
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)

        first = await api.post("/api/presence/heartbeat", headers=headers)
        assert first.status_code == 200
        assert first.json()["coalesced"] is False

        # The second beat inside the window writes nothing: the answer would
        # not change, and 200 clients beating every minute is a write storm
        # for a fact with 90-second resolution.
        second = await api.post("/api/presence/heartbeat", headers=headers)
        assert second.status_code == 200
        assert second.json()["coalesced"] is True

        await session.refresh(user)
        assert user.last_seen_at is not None

    async def test_a_driver_may_say_they_are_there(self, api, session):
        """Being present is not a privilege. A role that could not report it
        would be invisible on every dashboard entitled to see it."""
        driver, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        assert (
            await api.post("/api/presence/heartbeat", headers=headers)
        ).status_code == 200


class TestWhoIsThere:
    async def _district_pair(self, session):
        mine = await factories.make_district(session, slug="pres-mine")
        theirs = await factories.make_district(session, slug="pres-theirs")
        return mine, theirs

    async def test_a_district_manager_sees_their_own_district_only(
        self, api, session
    ):
        mine, theirs = await self._district_pair(session)
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        outsider = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=theirs.state_id,
            district_id=theirs.id,
        )
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        await api.post("/api/presence/heartbeat", headers=headers)

        r = await api.get("/api/presence", headers=headers)
        assert r.status_code == 200
        ids = {row["user_id"] for row in r.json()}
        assert str(me.id) in ids
        assert str(outsider.id) not in ids

    async def test_the_regional_manager_sees_across_states(self, api, session):
        here = await factories.make_district(
            session, state_slug="assam", slug="pres-assam"
        )
        there = await factories.make_district(
            session, state_slug="mizoram", slug="pres-mizoram"
        )
        a = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=here.state_id,
            district_id=here.id,
        )
        b = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=there.state_id,
            district_id=there.id,
        )
        regional = await factories.make_user(
            session, role=UserRole.NORTH_EAST_MANAGER
        )
        headers = await auth_headers(api, regional.email, factories.TEST_PASSWORD)

        r = await api.get("/api/presence", headers=headers)
        ids = {row["user_id"] for row in r.json()}
        assert {str(a.id), str(b.id)} <= ids

    async def test_a_scoped_managers_drivers_are_the_dashboards_drivers(
        self, api, session
    ):
        """The Overview puts "Drivers online 1 of 3" beside this list. Both
        count the same people - the drivers of trips in scope - or the page
        contradicts itself."""
        mine = await factories.make_district(session, slug="pres-trip-mine")
        other = await factories.make_district(session, slug="pres-trip-other")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        inside, _ = await factories.make_driver(session)
        outside, _ = await factories.make_driver(session)
        for driver, origin in ((inside, mine), (outside, other)):
            truck = await factories.make_truck(session)
            await factories.make_assignment(session, driver, truck, verified=True)
            shipment = await factories.make_shipment(
                session, origin_district_id=origin.id, destination_district_id=other.id
            )
            await factories.make_trip(
                session, driver, truck, shipment=shipment, status=TripStatus.ACTIVE
            )
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)

        board = (await api.get("/api/presence", headers=headers)).json()
        dash = (await api.get("/api/dashboard", headers=headers)).json()
        drivers = {row["driver_id"] for row in board if row["driver_id"]}
        assert drivers == {str(inside.id)}
        assert len(drivers) == dash["drivers_in_scope"]

    async def test_a_driver_cannot_read_the_presence_board(self, api, session):
        """`fleet:location_read` is not in the driver permission set, and
        that is where this decision has always lived."""
        driver, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
        assert (await api.get("/api/presence", headers=headers)).status_code == 403

    async def test_the_board_reports_presence_and_location_separately(
        self, api, session
    ):
        mine = await factories.make_district(session, slug="pres-fields")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        headers = await auth_headers(api, me.email, factories.TEST_PASSWORD)
        await api.post("/api/presence/heartbeat", headers=headers)

        row = next(
            r for r in (await api.get("/api/presence", headers=headers)).json()
            if r["user_id"] == str(me.id)
        )
        assert row["presence"] == "ONLINE"
        # A manager has no GPS, and that is UNAVAILABLE rather than STALE or
        # a silently absent field.
        assert row["location"] == "UNAVAILABLE"
        assert row["gps_seconds_ago"] is None
        assert row["seen_seconds_ago"] is not None

    async def test_a_driver_is_named_as_every_other_screen_names_them(
        self, api, session
    ):
        """E2E-D6. The login's display name and the driver record's name can
        differ; the board must not show the same person under a second name."""
        driver, user = await factories.make_driver(session)
        assert user.display_name != driver.full_name
        regional = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, regional.email, factories.TEST_PASSWORD)

        [row] = [
            r for r in (await api.get("/api/presence", headers=headers)).json()
            if r["user_id"] == str(user.id)
        ]
        assert row["display_name"] == driver.full_name
        assert row["driver_id"] == str(driver.id)
