"""Offline corridor package: what a driver carries into a valley.

Two things are being proven. First that the package contains a whole journey -
route, stops, estimates - so a phone with no signal has something to follow.
Second, and harder, that it is honest about its own gaps: no invented backup
corridor, no basemap it is not licensed to bundle, and no risk score rendered
as though it were live ten hours after it was taken.
"""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.routing import RouteCandidate
from app.models.enums import RouteKind, UserRole
from app.models.operations import TripRoute
from app.services import route_risk as risk_service
from app.services import routes as route_service
from tests import factories
from tests.conftest import auth_headers

# LS-7: this suite tests packaging/selection/journey behaviour, not the
# hazard policy. `clear_hazard_evidence` supplies a source that really
# answered, so these exercise what they mean to. Absence-of-evidence
# behaviour lives in tests/test_route_eligibility.py and
# tests/test_route_selection_hazard_api.py.
pytestmark = [pytest.mark.requires_db, pytest.mark.usefixtures("clear_hazard_evidence")]

PRIMARY_GEOMETRY = [(26.1445, 91.7362), (26.4, 92.9), (26.7509, 94.2037)]
BACKUP_GEOMETRY = [(26.1445, 91.7362), (27.1, 92.9), (26.7509, 94.2037)]


class _OneCorridor:
    """A provider that only finds one road. The common case in this region."""

    geometries = (PRIMARY_GEOMETRY,)

    async def route_options(
        self, origin, destination, *, kind, limit=1, detailed=False
    ):  # noqa: ANN001
        from app.services.routing.base import ChainAttempt, ChainOptions

        return ChainOptions(
            candidates=tuple(
                RouteCandidate(
                    kind=kind,
                    provider="stub",
                    geometry=g,
                    distance_m=305_000.0 + 21_000.0 * i,
                    duration_s=(221 + 23 * i) * 60.0,
                )
                for i, g in enumerate(self.geometries)
            ),
            attempts=(ChainAttempt("stub", ok=True),),
        )

    async def route(self, origin, destination, *, kind):  # noqa: ANN001
        from app.services.routing.base import ChainResult

        options = await self.route_options(origin, destination, kind=kind, limit=1)
        return ChainResult(candidate=options.candidates[0], attempts=options.attempts)


class _TwoCorridors(_OneCorridor):
    geometries = (PRIMARY_GEOMETRY, BACKUP_GEOMETRY)


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


@pytest.fixture
def routing(monkeypatch):
    def install(chain) -> None:
        monkeypatch.setattr(route_service, "build_chain", lambda: chain)

    return install


@pytest.fixture
def weather(monkeypatch):
    def install(*, rain: float | None = 1.0, fail: bool = False):
        async def fake(positions):
            from app.domain.weather import WeatherObservation

            if fail:
                return []
            return [
                WeatherObservation(
                    lat=lat,
                    lon=lon,
                    provider="stub-weather",
                    observed_at=datetime.now(UTC),
                    precipitation_mm=rain,
                    wind_gust_kmh=5.0,
                )
                for lat, lon in positions
            ]

        monkeypatch.setattr(risk_service, "observations_for", fake)

    return install


async def _trip_ready_to_drive(
    api: AsyncClient, session: AsyncSession, manager_headers: dict, *, select_route=True
):
    """A driver with an ASSIGNED trip that has a planned, selected route."""
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

    routes = (
        await session.execute(select(TripRoute).where(TripRoute.trip_id == trip.id))
    ).scalars().all()
    primary = next(r for r in routes if r.kind is RouteKind.PRIMARY)

    if select_route:
        chosen = await api.post(
            f"/api/trips/{trip.id}/routes/{primary.id}/select",
            headers=manager_headers,
        )
        assert chosen.status_code == 200, chosen.text

    headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    return trip, primary, headers


class TestTheJourneyIsCarried:
    async def test_the_package_contains_the_route_and_the_stops(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_TwoCorridors())
        weather(rain=1.0)
        trip, primary, headers = await _trip_ready_to_drive(
            api, session, manager_headers
        )

        r = await api.get("/api/driver/me/trip/offline-package", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()

        assert body["trip_id"] == str(trip.id)
        assert body["selected_route"]["route_id"] == str(primary.id)
        assert body["selected_route"]["kind"] == "PRIMARY"
        assert len(body["selected_route"]["geometry"]) >= 2

        # Coordinates must be lat-lon, not the WKT lon-lat they were stored as.
        # Getting this backwards puts Guwahati in the Arctic Ocean and fails
        # silently on a map.
        first_lat, first_lon = body["selected_route"]["geometry"][0]
        assert 21.5 <= first_lat <= 29.6, f"latitude out of the region: {first_lat}"
        assert 87.9 <= first_lon <= 97.5, f"longitude out of the region: {first_lon}"

        assert [s["sequence"] for s in body["stops"]] == [0, 1]
        assert all(s["lat"] is not None and s["lon"] is not None for s in body["stops"])

    async def test_a_real_backup_corridor_is_carried_too(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_TwoCorridors())
        weather(rain=1.0)
        await _trip_ready_to_drive(api, session, manager_headers)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        body = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()
        assert body["backup_route"] is not None
        assert body["backup_route"]["kind"] == "EMERGENCY_BACKUP"
        assert "NO_DISTINCT_BACKUP_CORRIDOR" not in body["reason_codes"]


class TestItIsHonestAboutItsGaps:
    async def test_no_backup_is_invented_on_a_single_corridor(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        """Handing a driver an escape road that does not exist is worse than
        telling them there is not one."""
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        body = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()
        assert body["backup_route"] is None
        assert "NO_DISTINCT_BACKUP_CORRIDOR" in body["reason_codes"]

    async def test_the_missing_basemap_is_declared_not_hidden(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        """The OSM tile policy prohibits prefetching for offline use.

        The gap is reported rather than filled by a policy violation, and it is
        reported HERE rather than discovered by a driver in a valley.
        """
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        body = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()
        assert body["basemap"] == "BUNDLED_NONE"
        assert "BASEMAP_NOT_BUNDLED_LICENCE" in body["reason_codes"]

    async def test_the_risk_snapshot_is_timestamped_not_presented_as_live(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_OneCorridor())
        weather(rain=12.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        body = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()
        assert body["risk"] is not None
        assert body["risk_captured_at"] is not None, (
            "a risk score travelled offline with no way to age it on screen"
        )
        assert body["captured_at"] is not None
        # The gaps in the score travel with it, exactly as on the live endpoint.
        # `landslide` is no longer here because clear_hazard_evidence supplies
        # a source that actually answered. The roadmap factors remain genuinely
        # unavailable and must still travel with the snapshot, or a driver
        # offline would read a partial score as a complete one.
        assert "landslide" not in body["risk"]["unavailable"]
        assert "road_quality" in body["risk"]["unavailable"]

    async def test_a_weather_outage_does_not_block_the_download(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        """The route is the part that cannot be recomputed on the roadside."""
        routing(_OneCorridor())
        weather(fail=True)
        _, primary, headers = await _trip_ready_to_drive(
            api, session, manager_headers
        )

        r = await api.get("/api/driver/me/trip/offline-package", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["selected_route"]["route_id"] == str(primary.id)
        # The score still returns; it simply reports weather as unavailable.
        assert body["risk"] is not None
        assert "weather" in body["risk"]["unavailable"]

    async def test_no_route_selected_is_stated_rather_than_guessed(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(
            api, session, manager_headers, select_route=False
        )

        body = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()
        assert body["selected_route"] is None
        assert "NO_ROUTE_SELECTED" in body["reason_codes"]
        assert body["risk"] is None


class TestThePackageHash:
    async def test_it_is_stable_across_repeated_downloads(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        first = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()
        second = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()
        assert first["package_hash"] == second["package_hash"]

    async def test_weather_changing_does_not_change_it(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        """Otherwise a driver on a thin connection re-downloads a route that
        has not moved, every time the sky changes."""
        routing(_OneCorridor())
        weather(rain=0.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        dry = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()

        weather(rain=40.0)
        wet = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers)
        ).json()

        assert wet["risk"]["score"] > dry["risk"]["score"], (
            "the fixture is not exercising the case it claims to"
        )
        assert wet["package_hash"] == dry["package_hash"]

    async def test_two_trips_do_not_share_a_hash(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers_a = await _trip_ready_to_drive(api, session, manager_headers)
        _, _, headers_b = await _trip_ready_to_drive(api, session, manager_headers)

        a = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers_a)
        ).json()
        b = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers_b)
        ).json()
        assert a["package_hash"] != b["package_hash"]


class TestScopingAndAuth:
    async def test_the_subject_comes_from_the_token(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        """No trip id in the path, so there is nothing to bend."""
        routing(_OneCorridor())
        weather(rain=1.0)
        trip_a, _, _ = await _trip_ready_to_drive(api, session, manager_headers)
        _, _, headers_b = await _trip_ready_to_drive(api, session, manager_headers)

        body = (
            await api.get("/api/driver/me/trip/offline-package", headers=headers_b)
        ).json()
        assert body["trip_id"] != str(trip_a.id)

    async def test_a_driver_with_no_trip_gets_404_not_an_empty_package(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """`GET /me/trip` returns null because between-trips is a normal
        screen. Asking to DOWNLOAD a journey that does not exist is a request
        that cannot be satisfied, and null would leave the app guessing whether
        to retry."""
        _, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)

        r = await api.get("/api/driver/me/trip/offline-package", headers=headers)
        assert r.status_code == 404

    async def test_anonymous_is_rejected(self, api: AsyncClient) -> None:
        r = await api.get("/api/driver/me/trip/offline-package")
        assert r.status_code == 401

    async def test_a_manager_cannot_use_the_driver_route(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        r = await api.get(
            "/api/driver/me/trip/offline-package", headers=manager_headers
        )
        assert r.status_code in (403, 404)


class TestConnectionLifetime:
    async def test_no_pooled_connection_is_held_across_the_weather_call(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        monkeypatch,
    ) -> None:
        routing(_OneCorridor())
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        from app.db import session as db_session

        pool = db_session.get_engine().pool
        baseline = pool.checkedout()
        during: list[int] = []

        async def watching(positions):
            during.append(pool.checkedout())
            return []

        monkeypatch.setattr(risk_service, "observations_for", watching)

        r = await api.get("/api/driver/me/trip/offline-package", headers=headers)
        assert r.status_code == 200, r.text
        assert during, "the weather fan-out never ran"
        assert max(during) <= baseline, (
            "a pooled database connection was held across the weather calls "
            f"(baseline {baseline}, during {during})"
        )


class TestProgressOnTheTripScreen:
    """route_progress, wired. The domain rule is tested in
    tests/test_route_progress.py; these prove it reaches the driver's screen
    with real geometry and a real fix behind it."""

    async def test_progress_is_null_when_no_route_is_selected(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        """Progress along a corridor nobody chose is not a degraded answer -
        there is no corridor."""
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(
            api, session, manager_headers, select_route=False
        )

        body = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert body["progress"] is None

    async def test_a_selected_route_with_no_fix_reports_unknown_not_zero(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        """A truck that has sent no position has not arrived."""
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        progress = (
            await api.get("/api/driver/me/trip", headers=headers)
        ).json()["progress"]

        assert progress is not None
        assert progress["remaining_distance_km"] is None
        assert progress["fraction_complete"] is None
        assert "NO_POSITION_AVAILABLE" in progress["reason_codes"]

    async def test_a_real_fix_produces_progress_along_the_planned_line(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        started = await api.post(
            "/api/driver/me/trip/start", headers=headers, json={}
        )
        assert started.status_code == 200, started.text

        # A fix on the middle vertex of PRIMARY_GEOMETRY.
        mid = PRIMARY_GEOMETRY[1]
        sent = await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={
                "fixes": [
                    {
                        "device_fix_id": str(uuid.uuid4()),
                        "location": {"lat": mid[0], "lon": mid[1]},
                        "recorded_at": datetime.now(UTC).isoformat(),
                    }
                ]
            },
        )
        assert sent.status_code in (200, 202), sent.text

        progress = (
            await api.get("/api/driver/me/trip", headers=headers)
        ).json()["progress"]

        assert progress["on_route"] is True
        assert progress["off_route_m"] < 200
        assert 0.0 < progress["fraction_complete"] < 1.0
        assert progress["remaining_distance_km"] > 0

        # The provider gave a duration, so a pace exists - and it names what it
        # assumes rather than calling itself an arrival time.
        assert progress["remaining_at_planned_pace_min"] is not None
        assert "REMAINING_TIME_ASSUMES_PLANNED_PACE" in progress["reason_codes"]

    async def test_the_wire_carries_no_field_that_promises_an_arrival_time(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_OneCorridor())
        weather(rain=1.0)
        _, _, headers = await _trip_ready_to_drive(api, session, manager_headers)

        progress = (
            await api.get("/api/driver/me/trip", headers=headers)
        ).json()["progress"]

        # Scoped to the progress block. A stop's `planned_arrival_at` is a
        # SCHEDULE somebody set, which is a different thing entirely from a
        # time this system derived and would then be believed for.
        for field in progress:
            for forbidden in ("eta", "arrival", "arrives", "due_at", "arrive"):
                assert forbidden not in field.lower(), (
                    f"{field!r} promises a time nothing here stands behind"
                )


class TestThePackageIsSmallEnoughToActuallyDownload:
    """A package a driver cannot fetch in the field is not an offline feature.

    It is downloaded at the depot in the normal case, but the retry happens
    wherever the driver is when they notice it failed - which on a NER corridor
    can be a 2G cell in a valley. Measured: at 40 kbit/s a 25 KB package takes
    about five seconds and a 240 KB one takes fifty.

    Two things could break that. Switching the routing provider to
    `overview=full` returns 5,213 points for one Guwahati-Jorhat route instead
    of hundreds (`osrm.py:129` explains why it does not), and adding a large
    field to the response multiplies across both routes. This is the guard for
    both.
    """

    #: Generous - the realistic figure is 10-25 KB - because this exists to
    #: catch an order-of-magnitude regression, not to police a few hundred
    #: bytes. A ceiling tight enough to fail on ordinary drift is a ceiling
    #: somebody raises without thinking.
    MAX_KB = 120

    async def test_a_route_with_a_realistic_vertex_count_stays_small(
        self,
        api: AsyncClient,
        session: AsyncSession,
        manager_headers: dict,
        routing,
        weather,
    ) -> None:
        routing(_OneCorridor())
        weather(rain=1.0)
        _, primary, headers = await _trip_ready_to_drive(
            api, session, manager_headers
        )

        # Replace the 3-vertex stub geometry with one the size a real
        # `overview=simplified` response actually has.
        from geoalchemy2 import WKTElement

        from app.services.shipments import SRID

        points = [
            (
                26.1445 + (26.7509 - 26.1445) * i / 499,
                91.7362 + (94.2037 - 91.7362) * i / 499,
            )
            for i in range(500)
        ]
        primary.geometry = WKTElement(
            "LINESTRING({})".format(
                ", ".join(f"{lon} {lat}" for lat, lon in points)
            ),
            srid=SRID,
        )
        await session.commit()

        response = await api.get(
            "/api/driver/me/trip/offline-package", headers=headers
        )
        assert response.status_code == 200, response.text

        size_kb = len(response.content) / 1024
        assert len(response.json()["selected_route"]["geometry"]) == 500, (
            "the planted geometry did not reach the response"
        )
        assert size_kb < self.MAX_KB, (
            f"offline package is {size_kb:.0f} KB; at 40 kbit/s that is "
            f"{size_kb * 8 / 40:.0f} s on a rural 2G link"
        )
