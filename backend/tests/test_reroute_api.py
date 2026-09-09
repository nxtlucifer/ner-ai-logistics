"""Reroute over real HTTP: who may change a moving trip's route, and how.

The tests that matter here are the ones about what does NOT happen. A route
change is an instruction to a person driving a loaded truck on a hill road, so
the guarantees worth proving are that nothing applies itself, that a stale
screen cannot move a trip off a road its manager never saw, and that a route
never moves without a record on the timeline saying who moved it.
"""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


from app.domain.routing import RouteCandidate
from app.models.enums import RouteKind, RouteState, TripEventKind, TripStatus, UserRole
from app.models.operations import Trip, TripEvent, TripRoute
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

# LS-7: these suites test recommendation/reroute/fleet behaviour, not the
# hazard policy. `clear_hazard_evidence` supplies sufficient evidence so
# they exercise what they mean to; absence-of-evidence behaviour lives in
# tests/test_route_eligibility.py.
pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("clear_hazard_evidence")]

PRIMARY_GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
BACKUP_GEOMETRY = [(26.1445, 91.7362), (27.1, 92.9), (26.7509, 94.2037)]


class _TwoCorridors:
    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=PRIMARY_GEOMETRY,
                    distance_m=305_000.0,
                    duration_s=221 * 60.0,
                ),
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=BACKUP_GEOMETRY,
                    distance_m=326_000.0,
                    duration_s=244 * 60.0,
                ),
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        options = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=options.candidates[0], attempts=options.attempts)


@pytest.fixture(autouse=True)
def _stub_routing(monkeypatch):
    monkeypatch.setattr(route_service, "build_chain", lambda: _TwoCorridors())


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
def weather(monkeypatch):
    """Rain per corridor, classified per call. See test_route_recommendation_api."""

    def install(*, north_rain: float, south_rain: float, gust: float = 5.0):
        async def fake(positions):
            from app.domain.weather import WeatherObservation

            northern = max((lat for lat, _ in positions), default=0.0) > 26.9
            rain = north_rain if northern else south_rain
            return [
                WeatherObservation(
                    lat=lat,
                    lon=lon,
                    provider="stub-weather",
                    observed_at=datetime.now(UTC),
                    precipitation_mm=rain,
                    wind_gust_kmh=gust,
                )
                for lat, lon in positions
            ]

        monkeypatch.setattr(risk_service, "observations_for", fake)

    return install


async def _moving_trip(
    api: AsyncClient, session: AsyncSession, headers: dict
) -> tuple[Trip, TripRoute, TripRoute]:
    """An ACTIVE trip with a selected PRIMARY and a live EMERGENCY_BACKUP."""
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck, verified=True)
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=2
    )

    planned = await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=headers)
    assert planned.status_code == 201, planned.text

    routes = (
        await session.execute(
            select(TripRoute).where(TripRoute.trip_id == trip.id)
        )
    ).scalars().all()
    primary = next(r for r in routes if r.kind is RouteKind.PRIMARY)
    backup = next(r for r in routes if r.kind is RouteKind.EMERGENCY_BACKUP)

    selected = await api.post(
        f"/api/trips/{trip.id}/routes/{primary.id}/select", headers=headers
    )
    assert selected.status_code == 200, selected.text

    driver_headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    started = await api.post(
        "/api/driver/me/trip/start", headers=driver_headers, json={}
    )
    assert started.status_code == 200, started.text

    await session.refresh(trip)
    return trip, primary, backup


class TestAssessment:
    async def test_a_trip_that_has_not_left_is_not_a_reroute_situation(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        weather(north_rain=0.0, south_rain=40.0)
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        trip = await factories.make_trip(
            session, driver, truck, assignment=assignment, stops=2
        )
        await api.post(f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers)

        body = (
            await api.get(f"/api/trips/{trip.id}/reroute", headers=manager_headers)
        ).json()

        assert body["outcome"] == "NO_ACTION"
        assert body["reason_codes"] == ["TRIP_NOT_IN_TRANSIT"]
        assert body["proposed_route_id"] is None

    async def test_a_calm_road_produces_no_action(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        weather(north_rain=0.0, south_rain=0.0)
        trip, primary, _ = await _moving_trip(api, session, manager_headers)

        body = (
            await api.get(f"/api/trips/{trip.id}/reroute", headers=manager_headers)
        ).json()

        assert body["outcome"] == "NO_ACTION"
        assert "SELECTED_ROUTE_WITHIN_TOLERANCE" in body["reason_codes"]
        assert body["selected_route_id"] == str(primary.id)

    async def test_a_bad_road_with_a_better_one_beside_it_proposes(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        # Severe on the southern (selected PRIMARY) corridor, calm on the north.
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)

        body = (
            await api.get(f"/api/trips/{trip.id}/reroute", headers=manager_headers)
        ).json()

        assert body["outcome"] == "PROPOSE", body
        assert body["selected_route_id"] == str(primary.id)
        assert body["proposed_route_id"] == str(backup.id)
        assert "SELECTED_ROUTE_DETERIORATED" in body["reason_codes"]
        assert "BETTER_ROUTE_AVAILABLE" in body["reason_codes"]

        # A proposal arrives with the cost of taking it, not as a bare order.
        assert body["comparison"] is not None
        assert body["comparison"]["tradeoff"]["risk_delta_points"] < 0
        assert len(body["comparison"]["candidates"]) == 2

        # The published thresholds travel with the answer.
        assert body["floor_points"] == 60
        assert body["margin_points"] == 10

    async def test_a_bad_road_with_nowhere_better_alerts_without_proposing(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        """The single-corridor case, which is the common one here."""
        weather(north_rain=30.0, south_rain=30.0, gust=90.0)
        trip, primary, _ = await _moving_trip(api, session, manager_headers)

        body = (
            await api.get(f"/api/trips/{trip.id}/reroute", headers=manager_headers)
        ).json()

        assert body["outcome"] == "ALERT_ONLY", body
        assert "NO_BETTER_ALTERNATIVE" in body["reason_codes"]
        assert body["proposed_route_id"] is None, (
            "an alert offered a road, which is a proposal wearing the wrong label"
        )

    async def test_the_assessment_writes_nothing(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        """A proposal must not move the trip by the act of being computed."""
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, _ = await _moving_trip(api, session, manager_headers)

        events_before = len(
            (
                await session.execute(
                    select(TripEvent).where(TripEvent.trip_id == trip.id)
                )
            ).scalars().all()
        )

        for _ in range(3):
            r = await api.get(
                f"/api/trips/{trip.id}/reroute", headers=manager_headers
            )
            assert r.json()["outcome"] == "PROPOSE"

        await session.refresh(trip)
        assert trip.selected_route_id == primary.id, (
            "assessing a reroute rerouted the trip"
        )
        events_after = (
            await session.execute(select(TripEvent).where(TripEvent.trip_id == trip.id))
        ).scalars().all()
        assert len(events_after) == events_before


class TestAcceptIsTheOnlyWayARouteMoves:
    async def test_an_accepted_reroute_moves_the_trip_and_records_it(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)

        r = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary.id), "to_route_id": str(backup.id)},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["selected_route_id"] == str(backup.id)
        assert body["previous_route_id"] == str(primary.id)

        await session.refresh(trip)
        await session.refresh(primary)
        await session.refresh(backup)
        assert trip.selected_route_id == backup.id
        assert backup.state is RouteState.SELECTED
        assert primary.state is RouteState.PROPOSED, (
            "the road left behind was marked dead; weather is not permanent "
            "and a reroute must not be a one-way door"
        )

        event = (
            await session.execute(
                select(TripEvent).where(
                    TripEvent.trip_id == trip.id,
                    TripEvent.kind == TripEventKind.ROUTE_CHANGED,
                )
            )
        ).scalar_one()
        assert event.payload["from_route_id"] == str(primary.id)
        assert event.payload["to_route_id"] == str(backup.id)
        assert event.payload["source"] == "manager-accepted-reroute-v1"
        assert event.actor_user_id is not None, (
            "a route changed with nobody recorded as having decided it"
        )

    async def test_a_stale_screen_cannot_move_the_trip(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        """Two managers, one trip. The second must be told to look again."""
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)

        first = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary.id), "to_route_id": str(backup.id)},
        )
        assert first.status_code == 200

        # The second manager's page still shows PRIMARY as selected.
        second = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary.id), "to_route_id": str(backup.id)},
        )
        assert second.status_code == 409
        assert second.json()["error"]["code"] == "ROUTE_SUPERSEDED"

        await session.refresh(trip)
        assert trip.selected_route_id == backup.id

    async def test_rerouting_onto_the_same_route_is_refused(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, _ = await _moving_trip(api, session, manager_headers)

        r = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary.id), "to_route_id": str(primary.id)},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "ROUTE_UNCHANGED"

    async def test_a_trip_that_has_not_started_cannot_be_rerouted(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        """Planning has its own endpoint, and it tells nobody a journey changed."""
        weather(north_rain=0.0, south_rain=0.0)
        driver, _ = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        trip = await factories.make_trip(
            session, driver, truck, assignment=assignment, stops=2
        )
        await api.post(
            f"/api/trips/{trip.id}/routes/recalculate", headers=manager_headers
        )
        routes = (
            await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
        ).scalars().all()
        primary = next(r for r in routes if r.kind is RouteKind.PRIMARY)
        backup = next(r for r in routes if r.kind is RouteKind.EMERGENCY_BACKUP)
        await api.post(
            f"/api/trips/{trip.id}/routes/{primary.id}/select", headers=manager_headers
        )

        r = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary.id), "to_route_id": str(backup.id)},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "TRIP_NOT_IN_TRANSIT"

    async def test_another_trips_route_cannot_be_selected(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip_a, primary_a, _ = await _moving_trip(api, session, manager_headers)
        _, _, backup_b = await _moving_trip(api, session, manager_headers)

        r = await api.post(
            f"/api/trips/{trip_a.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary_a.id), "to_route_id": str(backup_b.id)},
        )
        assert r.status_code == 404

        await session.refresh(trip_a)
        assert trip_a.selected_route_id == primary_a.id

    async def test_anonymous_cannot_reroute(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)

        r = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            json={"from_route_id": str(primary.id), "to_route_id": str(backup.id)},
        )
        assert r.status_code == 401

        await session.refresh(trip)
        assert trip.selected_route_id == primary.id

    async def test_an_unknown_field_is_rejected(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        """extra=forbid, so nothing can smuggle an override past the contract."""
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)

        r = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={
                "from_route_id": str(primary.id),
                "to_route_id": str(backup.id),
                "skip_checks": True,
            },
        )
        assert r.status_code == 422


class TestAtomicity:
    async def test_a_failed_event_write_leaves_the_route_unchanged(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather,
        monkeypatch,
    ) -> None:
        """The reason apply_selection does not commit.

        If the route change committed on its own, a failure while writing the
        timeline event would leave a trip whose route moved with nothing saying
        why - the exact record an incident review needs, missing precisely when
        something went wrong.
        """
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)
        # Read every id BEFORE expiring the session: an expired attribute is a
        # lazy load, and one triggered while building a query synchronously is
        # a MissingGreenlet rather than a test result.
        trip_id, primary_id, backup_id = trip.id, primary.id, backup.id

        from app.services import reroute as reroute_service

        async def boom(*args, **kwargs):
            raise RuntimeError("timeline write failed")

        monkeypatch.setattr(reroute_service.trip_service, "record_event", boom)

        with pytest.raises(RuntimeError):
            await api.post(
                f"/api/trips/{trip_id}/reroute/accept",
                headers=manager_headers,
                json={"from_route_id": str(primary_id), "to_route_id": str(backup_id)},
            )

        session.expire_all()
        reloaded = (
            await session.execute(select(Trip).where(Trip.id == trip_id))
        ).scalar_one()
        assert reloaded.selected_route_id == primary_id, (
            "the route moved even though its record never landed"
        )
        assert reloaded.status is TripStatus.ACTIVE


class TestNoModelWritesTripState:
    async def test_the_accept_contract_takes_ids_and_nothing_else(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        """No free text, no generated instruction, nothing a model could fill in.

        The write path accepts IDS ONLY. Everything else on the record - who
        decided, when, which rule - is derived server-side from the
        authenticated actor and the clock.

        LS-11 added `authorization_id`, which is still an id: it names a review
        authorisation the server then revalidates and spends against the live
        evidence. Presenting one asserts nothing.

        The assertion is now on the SHAPE rather than a hand-listed set of
        names, because the property being defended is "every field is an
        identifier" - not "there are exactly two of them". A future field
        carrying prose would fail this; a future id would not, and should not.
        """
        import uuid as _uuid
        from typing import get_args

        from app.api.trips import RerouteAcceptRequest

        assert set(RerouteAcceptRequest.model_fields) == {
            "from_route_id",
            "to_route_id",
            "authorization_id",
        }
        for name, field in RerouteAcceptRequest.model_fields.items():
            # `uuid.UUID` outright, or `uuid.UUID | None` for the optional one.
            types = set(get_args(field.annotation)) or {field.annotation}
            assert types <= {_uuid.UUID, type(None)}, (
                f"{name} is not an identifier; the accept contract must never "
                f"carry free text or anything a model could fill in"
            )

        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)
        await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary.id), "to_route_id": str(backup.id)},
        )

        event = (
            await session.execute(
                select(TripEvent).where(
                    TripEvent.trip_id == trip.id,
                    TripEvent.kind == TripEventKind.ROUTE_CHANGED,
                )
            )
        ).scalar_one()
        assert set(event.payload) == {
            "from_route_id",
            "to_route_id",
            "to_route_kind",
            "decided_by_user_id",
            "decided_at",
            "source",
        }


class TestUnknownTrip:
    async def test_assessment_of_an_unknown_trip_is_404(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.get(
            f"/api/trips/{uuid.uuid4()}/reroute", headers=manager_headers
        )
        assert r.status_code == 404


class TestTheSelectedRouteIsNeverTruncatedAway:
    """The candidate cap must not be able to drop the road the truck is on.

    `_live_route_facts` bounds the provider fan-out with a LIMIT. If the
    ordering behind that LIMIT does not put the SELECTED route first, a trip
    with more live routes than the cap can lose it - and losing it is not a
    degraded answer, it is a confidently wrong one: `assess` finds no selected
    route among the candidates and reports NO_ACTION, meaning a truck on a road
    that has just gone bad is told nothing at all.

    Planning stores two routes today, so this needs a third planted directly.
    That is the point - the cap is what survives someone later persisting one.
    """

    async def test_a_third_route_cannot_hide_the_one_being_driven(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)

        # The manager reroutes onto the backup, so the SELECTED route is now
        # the newest of the three - the one an oldest-first cap discards.
        accepted = await api.post(
            f"/api/trips/{trip.id}/reroute/accept",
            headers=manager_headers,
            json={"from_route_id": str(primary.id), "to_route_id": str(backup.id)},
        )
        assert accepted.status_code == 200, accepted.text

        from geoalchemy2 import WKTElement

        from app.services.shipments import SRID

        # Built from WKT rather than by copying `primary.geometry`: a loaded
        # geometry is a WKBElement and re-inserting one needs Shapely, which is
        # an optional dependency this project does not install.
        wkt = "LINESTRING({})".format(
            ", ".join(f"{lon} {lat}" for lat, lon in PRIMARY_GEOMETRY)
        )
        third = TripRoute(
            trip_id=trip.id,
            kind=RouteKind.EMERGENCY_BACKUP,
            state=RouteState.PROPOSED,
            geometry=WKTElement(wkt, srid=SRID),
            distance_km=primary.distance_km,
            estimated_duration_min=primary.estimated_duration_min,
            routing_provider="stub",
        )
        session.add(third)
        await session.commit()

        body = (
            await api.get(f"/api/trips/{trip.id}/reroute", headers=manager_headers)
        ).json()

        assert body["selected_route_id"] == str(backup.id), (
            "the road the truck is on was capped out of its own assessment"
        )
        assert "NO_SELECTED_ROUTE" not in body["reason_codes"]


class TestConcurrentAccepts:
    async def test_two_managers_accepting_at_once_move_the_trip_once(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict, weather
    ) -> None:
        """The sequential stale-screen test, run as a race.

        `trips.load_for_update` issues `SELECT ... FOR UPDATE`, but SQLAlchemy
        returns the identity-map object when one is already present rather than
        overwriting it with the freshly-read row. Whether the second
        transaction sees the first one's committed `selected_route_id` therefore
        depends on the Trip NOT already being in that request's session - which
        is true today, and is an argument rather than a guarantee.

        So it is measured. Two independent app instances, two sessions, one
        trip: exactly one accept may win, and the loser must be refused rather
        than silently overwriting a decision it never saw.
        """
        weather(north_rain=0.0, south_rain=30.0, gust=90.0)
        trip, primary, backup = await _moving_trip(api, session, manager_headers)
        trip_id, primary_id, backup_id = trip.id, primary.id, backup.id

        from httpx import ASGITransport

        from app.main import create_app

        clients = [
            AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://t")
            for _ in range(2)
        ]
        try:
            responses = await asyncio.gather(
                *(
                    c.post(
                        f"/api/trips/{trip_id}/reroute/accept",
                        headers=manager_headers,
                        json={
                            "from_route_id": str(primary_id),
                            "to_route_id": str(backup_id),
                        },
                    )
                    for c in clients
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        assert not any(isinstance(r, BaseException) for r in responses), responses
        codes = sorted(r.status_code for r in responses)
        assert codes == [200, 409], f"expected one win and one refusal, got {codes}"

        loser = next(r for r in responses if r.status_code == 409)
        assert loser.json()["error"]["code"] in (
            "ROUTE_SUPERSEDED",
            "ROUTE_UNCHANGED",
        )

        session.expire_all()
        reloaded = (
            await session.execute(select(Trip).where(Trip.id == trip_id))
        ).scalar_one()
        assert reloaded.selected_route_id == backup_id

        # Exactly ONE timeline entry. Two would mean the trip recorded a change
        # it did not make, and an incident review would read a reroute that
        # never happened.
        events = (
            await session.execute(
                select(TripEvent).where(
                    TripEvent.trip_id == trip_id,
                    TripEvent.kind == TripEventKind.ROUTE_CHANGED,
                )
            )
        ).scalars().all()
        assert len(events) == 1, f"{len(events)} ROUTE_CHANGED events for one reroute"
