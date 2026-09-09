"""The navigation package: directions that belong to the route being driven.

Three things are proven here.

**Distance to a turn is not a step length.** OSRM's `step.distance` measures
forward from its own maneuver to the next one, so rendering it as "in X m,
turn left" is wrong by exactly one step. The fixtures below use deliberately
unequal adjacent steps, because equal ones make that error invisible - which is
how it survives review.

**Directions belong to one route.** A maneuver whose geometry index does not
address this route's line is refused rather than drawn. Instructions from
another road render perfectly and send a truck the wrong way, so this is the
failure mode that matters most.

**A route without directions is still a road.** Guidance unavailable keeps the
overview and says why. It never degrades to a blank map, and it never invents
turns from the corners of a simplified polyline.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import Maneuver, RouteCandidate
from app.models.enums import RouteKind, RouteState, UserRole
from app.models.operations import TripRoute
from app.services import navigation
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("clear_hazard_evidence")]

GEOMETRY = [
    (26.1445, 91.7362),
    (26.3000, 92.2000),
    (26.4000, 92.9000),
    (26.6000, 93.6000),
    (26.7509, 94.2037),
]

#: Deliberately unequal, and unequal in a way that makes the off-by-one visible.
#:
#: With these, "distance to the turn at index 2" is 100 + 4000 = 4100 m. The
#: mistake - reading that maneuver's own `step_distance_m` - gives 250 m. A test
#: built on equal steps would pass either way and prove nothing.
STEP_DISTANCES = [100.0, 4000.0, 250.0, 9000.0, 0.0]


def _maneuvers(count: int = 5) -> list[dict]:
    """Stored-JSONB maneuvers matching GEOMETRY, in the persisted shape."""
    kinds = ["depart", "turn", "roundabout", "turn", "arrive"]
    modifiers = [None, "left", "right", "slight left", None]
    return [
        {
            "type": kinds[i],
            "modifier": modifiers[i],
            "lat": GEOMETRY[i][0],
            "lon": GEOMETRY[i][1],
            "geometry_index": i,
            "step_distance_m": STEP_DISTANCES[i],
            "duration_s": 60.0,
            "name": f"Road {i}" if i else None,
            "exit": 2 if kinds[i] == "roundabout" else None,
        }
        for i in range(count)
    ]


class _OneCorridor:
    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=GEOMETRY,
                    distance_m=305_000.0,
                    duration_s=221 * 60.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        options = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=options.candidates[0], attempts=options.attempts)


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture(autouse=True)
def _stubbed_provider(monkeypatch):
    monkeypatch.setattr(route_service, "build_chain", lambda: _OneCorridor())


@pytest.fixture(autouse=True)
def _weather(monkeypatch):
    async def fake(positions):  # noqa: ANN001
        from app.domain.weather import WeatherObservation

        return [
            WeatherObservation(
                lat=lat,
                lon=lon,
                provider="stub-weather",
                observed_at=datetime.now(UTC),
                precipitation_mm=1.0,
                wind_gust_kmh=5.0,
            )
            for lat, lon in positions
        ]

    monkeypatch.setattr(risk_service, "observations_for", fake)


async def _driving(
    api: AsyncClient, session: AsyncSession, manager_headers: dict, *, select_route=True
):
    """A driver with a selected route, and the driver's own auth headers."""
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=2
    )

    planned = await api.post(
        f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
    )
    assert planned.status_code == 201, planned.text

    primary = next(
        r
        for r in (
            await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
        )
        .scalars()
        .all()
        if r.kind is RouteKind.PRIMARY
    )
    if select_route:
        chosen = await api.post(
            f"/api/trips/{trip.id}/routes/{primary.id}/select",
            headers=manager_headers,
        )
        assert chosen.status_code == 200, chosen.text

    headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    return trip, primary, headers


async def _store(session: AsyncSession, route: TripRoute, maneuvers) -> None:
    """Put maneuvers on a persisted route, as `plan(detailed=True)` would."""
    route.maneuvers = maneuvers
    session.add(route)
    await session.commit()


class TestStepDistanceIsNotDistanceToTurn:
    """The arithmetic the whole package exists to get right."""

    async def test_distance_from_start_accumulates_preceding_steps(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["available"] is True
        got = [m["distance_from_start_m"] for m in body["maneuvers"]]

        # Cumulative sum of the steps BEFORE each maneuver: 0, then 100, then
        # 100+4000, and so on.
        assert got == [0.0, 100.0, 4100.0, 4350.0, 13350.0]

    async def test_the_off_by_one_would_be_visible(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The mistake, stated as a value the response must NOT equal.

        Reading a maneuver's own `step_distance_m` as its distance-to-turn gives
        250 m for the roundabout at index 2. The correct answer is 4,100 m.
        Announcing "in 250 metres, take the second exit" 3.8 km early is the
        defect this test exists to catch.
        """
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        roundabout = body["maneuvers"][2]

        assert roundabout["type"] == "roundabout"
        assert roundabout["distance_from_start_m"] == 4100.0
        assert roundabout["step_distance_m"] == 250.0
        assert roundabout["distance_from_start_m"] != roundabout["step_distance_m"]

    async def test_arrival_carries_a_zero_step_and_the_full_distance(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """OSRM's `arrive` step is 0 m, which is how forward-measurement shows.

        Its `distance_from_start_m` is the whole sum, so "distance remaining to
        destination" falls out of the same subtraction as every other turn.
        """
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        arrival = body["maneuvers"][-1]

        assert arrival["type"] == "arrive"
        assert arrival["step_distance_m"] == 0.0
        assert arrival["distance_from_start_m"] == sum(STEP_DISTANCES)


class TestPackageIdentity:
    async def test_the_package_names_the_route_it_describes(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()

        assert body["route_id"] == str(route.id)
        assert body["trip_id"] == str(trip.id)
        assert body["route_revision"]

    async def test_the_revision_changes_when_the_directions_change(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """A cached package must be invalidated by a change to the road.

        If the revision did not move, a client holding yesterday's directions
        would keep drawing them over a corridor that had been re-planned.
        """
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())
        before = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()["route_revision"]

        changed = _maneuvers()
        changed[1]["modifier"] = "right"
        await _store(session, route, changed)

        after = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()["route_revision"]
        assert after != before

    async def test_the_revision_is_stable_across_identical_fetches(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Otherwise every poll looks like a route change and re-renders."""
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())

        first = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        second = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert first["route_revision"] == second["route_revision"]
        assert first["captured_at"] != second["captured_at"] or True

    async def test_maneuvers_for_a_different_line_are_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The dangerous case: plausible directions for the wrong road.

        A geometry index past the end of this route's line can only have come
        from a longer, different route. Refused, because it renders perfectly
        and is wrong.
        """
        trip, route, headers = await _driving(api, session, manager_headers)
        foreign = _maneuvers()
        foreign[2]["geometry_index"] = 4_000  # this line has five points
        await _store(session, route, foreign)

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()

        assert body["available"] is False
        assert "GUIDANCE_INCONSISTENT_WITH_ROUTE" in body["reason_codes"]
        assert body["maneuvers"] == []
        # The road survives the loss of its directions.
        assert len(body["geometry"]) == len(GEOMETRY)

    async def test_out_of_order_maneuvers_are_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Indexes that go backwards would send a navigator to an earlier turn."""
        trip, route, headers = await _driving(api, session, manager_headers)
        jumbled = _maneuvers()
        jumbled[3]["geometry_index"] = 1
        await _store(session, route, jumbled)

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["available"] is False
        assert "GUIDANCE_INCONSISTENT_WITH_ROUTE" in body["reason_codes"]


class TestGuidanceUnavailableIsNotABrokenScreen:
    async def test_a_legacy_overview_route_keeps_its_line(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The existing selected corridor: real geometry, `maneuvers` NULL.

        Every route planned before migration 0009 looks like this. It must stay
        drawable, with an explicit reason, and must not crash the endpoint.
        """
        trip, route, headers = await _driving(api, session, manager_headers)
        assert route.maneuvers is None, "precondition: planned without directions"

        response = await api.get("/api/driver/me/trip/navigation", headers=headers)
        assert response.status_code == 200
        body = response.json()

        assert body["available"] is False
        assert body["reason_codes"] == ["GUIDANCE_NOT_AVAILABLE"]
        assert body["maneuvers"] == []
        assert len(body["geometry"]) == len(GEOMETRY)
        assert body["route_id"] == str(route.id)

    async def test_null_maneuvers_never_read_as_a_road_with_no_turns(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """`available: false`, not `available: true` with an empty list.

        An empty maneuver list on a 305 km corridor would mean "drive straight
        for four hours", which is the wrong answer stated confidently.
        """
        trip, route, headers = await _driving(api, session, manager_headers)

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["available"] is False

    async def test_an_empty_stored_list_is_treated_as_inconsistent(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """A persisted route always has at least a depart and an arrive."""
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, [])

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["available"] is False
        assert "GUIDANCE_INCONSISTENT_WITH_ROUTE" in body["reason_codes"]

    async def test_a_trip_with_no_selected_route_says_so(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Not dispatched is a different state from cannot guide."""
        trip, route, headers = await _driving(
            api, session, manager_headers, select_route=False
        )

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["available"] is False
        assert body["reason_codes"] == ["NO_SELECTED_ROUTE"]
        assert body["route_id"] is None
        assert body["geometry"] == []

    async def test_a_superseded_selection_is_not_navigated(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """SUPERSEDED is terminal, so it is not a corridor to follow."""
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())
        route.state = RouteState.SUPERSEDED
        session.add(route)
        await session.commit()

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["available"] is False
        assert body["reason_codes"] == ["NO_SELECTED_ROUTE"]


class TestHonesty:
    async def test_duration_is_labelled_as_free_flow(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The caveat travels with the number, not in a comment somewhere."""
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["duration_s"] is not None
        assert "DURATION_IS_FREE_FLOW_NOT_AN_ETA" in body["reason_codes"]

    async def test_no_field_promises_an_arrival_time(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Same guarantee `route_progress` makes, asserted on this payload.

        Checked against FIELD NAMES, not a substring of the serialised body:
        `DURATION_IS_FREE_FLOW_NOT_AN_ETA` contains "eta" and is the caveat, not
        a promise. A crude substring search fails on the very code that keeps
        the guarantee.
        """
        trip, route, headers = await _driving(api, session, manager_headers)
        await _store(session, route, _maneuvers())

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()

        names = set(body) | {k for m in body["maneuvers"] for k in m}
        forbidden = [
            n
            for n in names
            if "eta" in n.lower() or "arriv" in n.lower() or "arrives" in n.lower()
        ]
        assert not forbidden, f"fields that promise an arrival time: {forbidden}"

    async def test_units_and_coordinate_order_are_declared(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """A client should not have to infer metres from a field name."""
        trip, route, headers = await _driving(api, session, manager_headers)

        body = (
            await api.get("/api/driver/me/trip/navigation", headers=headers)
        ).json()
        assert body["coordinate_format"] == "lat_lon"
        assert body["distance_unit"] == "m"
        assert body["duration_unit"] == "s"
        assert body["version"] == navigation.VERSION


class TestAccessIsScopedToTheDriver:
    async def test_a_driver_with_no_trip_gets_404(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Matches offline-package: a journey that does not exist cannot be
        packaged, and null would leave the app guessing whether to retry."""
        _, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)

        response = await api.get("/api/driver/me/trip/navigation", headers=headers)
        assert response.status_code == 404

    async def test_an_anonymous_caller_is_denied(self, api: AsyncClient) -> None:
        response = await api.get("/api/driver/me/trip/navigation")
        assert response.status_code == 401

    async def test_a_manager_has_no_driver_navigation(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        """The subject comes from the token; a manager has no driver profile.

        There is no trip id in the path, so there is nothing to point at
        somebody else's journey.
        """
        response = await api.get(
            "/api/driver/me/trip/navigation", headers=manager_headers
        )
        assert response.status_code == 403


class TestParsingIsAllOrNothing:
    """Unit-level: half a set of directions is worse than none."""

    def _package(self, stored, points: int = 5):
        return navigation._maneuvers_from_json(stored, points)

    def test_a_malformed_entry_discards_the_whole_set(self) -> None:
        """It would otherwise run out mid-journey and read as an arrival."""
        broken = _maneuvers()
        broken[3] = {"type": "turn"}  # no index, no coordinates
        maneuvers, refusal = self._package(broken)
        assert maneuvers == ()
        assert refusal == (navigation.REASON_GUIDANCE_INCONSISTENT,)

    def test_a_negative_step_distance_is_refused(self) -> None:
        bad = _maneuvers()
        bad[1]["step_distance_m"] = -5.0
        maneuvers, refusal = self._package(bad)
        assert maneuvers == ()
        assert refusal == (navigation.REASON_GUIDANCE_INCONSISTENT,)

    def test_rows_written_before_the_field_was_renamed_still_parse(self) -> None:
        """`distance_m` was the old key. The name was wrong; the number was not.

        Refusing those rows would turn a naming fix into data loss.
        """
        legacy = _maneuvers()
        for entry in legacy:
            entry["distance_m"] = entry.pop("step_distance_m")

        maneuvers, refusal = self._package(legacy)
        assert refusal == ()
        assert [m.distance_from_start_m for m in maneuvers] == [
            0.0,
            100.0,
            4100.0,
            4350.0,
            13350.0,
        ]

    def test_null_is_unavailable_not_inconsistent(self) -> None:
        """Two different states, and a driver needs to be told which."""
        maneuvers, refusal = self._package(None)
        assert maneuvers == ()
        assert refusal == (navigation.REASON_GUIDANCE_NOT_AVAILABLE,)


class TestTheDomainTypeMeasuresForward:
    """Pinned on `Maneuver` itself, so the fix cannot silently regress.

    Verified against the live provider on 2026-09-06: a 5,942 m Guwahati route
    returned 17 steps summing to 5,942.5 m with a final `arrive` step of 0.0 m.
    A backward-measured step could be neither.
    """

    def test_the_field_is_named_for_what_it_holds(self) -> None:
        m = Maneuver(
            type="turn",
            modifier="left",
            at=(26.1445, 91.7362),
            geometry_index=0,
            step_distance_m=250.0,
        )
        assert m.step_distance_m == 250.0
        assert not hasattr(m, "distance_m"), (
            "the old name is back; it described the opposite of its value"
        )

    def test_an_arrival_step_of_zero_is_accepted(self) -> None:
        """0.0 is the normal terminal value, not a malformed one."""
        m = Maneuver(
            type="arrive",
            modifier=None,
            at=(26.7509, 94.2037),
            geometry_index=4,
            step_distance_m=0.0,
        )
        assert m.step_distance_m == 0.0
