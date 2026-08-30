"""Location telemetry: ingestion, validation, idempotence, freshness, privacy.

Location is the most sensitive data this system holds, and the most easily got
wrong in ways that look fine. Four failure modes this file pins down:

  1. A client naming its own subject - writing another driver's track.
  2. A coordinate PostGIS would accept by wrapping it over the pole, so an
     inverted lat/lon lands 7,000 km away looking perfectly plausible.
  3. A retry after a lost acknowledgement duplicating points, which corrupts
     every distance derived from the track.
  4. Stale telemetry presented as "live", which is worse than showing nothing
     because a dispatcher will act on it.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import telemetry_policy as policy
from app.models.audit import AuditLog
from app.models.enums import UserRole
from app.models.operations import GpsPoint
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

# Real NER coordinates. A latitude/longitude inversion here produces a point in
# the Arctic Ocean rather than merely a different number.
GUWAHATI = {"lat": 26.1445, "lon": 91.7362}
JORHAT = {"lat": 26.7509, "lon": 94.2037}


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


def fix(**overrides) -> dict:
    payload = {
        "device_fix_id": str(uuid.uuid4()),
        "location": dict(GUWAHATI),
        "recorded_at": datetime.now(UTC).isoformat(),
        "speed_kmph": "42.5",
        "heading_deg": "118.0",
        "accuracy_m": "8.4",
        "is_mock_location": False,
    }
    payload.update(overrides)
    return payload


async def _driving(session: AsyncSession, api: AsyncClient, *, stops: int = 2):
    """A driver on an ACTIVE trip, ready to send position."""
    driver, user = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(
        session, driver, truck, assignment=assignment, stops=stops
    )
    headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)
    started = await api.post("/api/driver/me/trip/start", headers=headers, json={})
    assert started.status_code == 200, started.text
    return driver, user, truck, trip, headers


# --- Authorization --------------------------------------------------------


class TestLocationAuthorization:
    async def test_anonymous_submission_is_401(self, api: AsyncClient) -> None:
        response = await api.post("/api/driver/me/location", json={"fixes": [fix()]})
        assert response.status_code == 401

    async def test_manager_cannot_submit_as_a_driver(
        self, api: AsyncClient, manager_headers: dict
    ) -> None:
        response = await api.post(
            "/api/driver/me/location", headers=manager_headers, json={"fixes": [fix()]}
        )
        assert response.status_code == 403

    async def test_driver_without_a_trip_has_nowhere_to_send(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, user = await factories.make_driver(session)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)

        response = await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )
        assert response.status_code == 404

    async def test_collection_is_refused_before_the_trip_starts(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """docs/SECURITY.md section 3: collected only during an ACTIVE trip.

        Enforced server-side so an app bug or a tampered client cannot produce
        off-duty tracking.
        """
        driver, user = await factories.make_driver(session)
        truck = await factories.make_truck(session)
        assignment = await factories.make_assignment(session, driver, truck)
        await factories.make_trip(session, driver, truck, assignment=assignment)
        headers = await auth_headers(api, user.phone, factories.TEST_PASSWORD)

        response = await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "TRIP_NOT_IN_PROGRESS"

    async def test_collection_stops_when_the_trip_completes(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, _, headers = await _driving(session, api, stops=1)
        view = (await api.get("/api/driver/me/trip", headers=headers)).json()
        stop_id = view["next_stop_id"]
        await api.post(f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=headers)
        await api.post(f"/api/driver/me/trip/stops/{stop_id}/complete", headers=headers)
        await api.post("/api/driver/me/trip/complete", headers=headers, json={})

        response = await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )
        assert response.status_code == 404, "tracking outlived the trip"

    async def test_driver_cannot_submit_to_another_drivers_trip(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, trip_b, _ = await _driving(session, api)
        _, _, _, _, headers_a = await _driving(session, api)

        response = await api.post(
            "/api/driver/me/location",
            headers=headers_a,
            json={"trip_id": str(trip_b.id), "fixes": [fix()]},
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "TRIP_SUPERSEDED"

        count = (
            await session.execute(
                select(func.count(GpsPoint.id)).where(GpsPoint.trip_id == trip_b.id)
            )
        ).scalar_one()
        assert count == 0, "driver A wrote to driver B's track"

    async def test_client_supplied_subject_fields_are_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """extra=forbid means impersonation is a 422, not silently ignored."""
        driver_b, _ = await factories.make_driver(session)
        _, _, _, _, headers = await _driving(session, api)

        for extra in ("driver_id", "truck_id", "user_id", "role"):
            response = await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={"fixes": [fix(**{extra: str(driver_b.id)})]},
            )
            assert response.status_code == 422, f"{extra} was not rejected"


# --- Coordinate safety ----------------------------------------------------


class TestCoordinateSafety:
    async def test_valid_fix_is_accepted(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, trip, headers = await _driving(session, api)

        response = await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )
        assert response.status_code == 202, response.text
        body = response.json()
        assert body["accepted"] == 1
        assert body["duplicates_ignored"] == 0
        assert body["rejected"] == 0
        assert body["trip_id"] == str(trip.id)

    async def test_inverted_coordinates_are_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """PostGIS would WRAP lat=91.7362 over the pole into a plausible point.

        The application bounds are therefore the only defence, which makes them
        a safety control rather than input hygiene. See test_geospatial.py.
        """
        _, _, _, _, headers = await _driving(session, api)

        response = await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix(location={"lat": 91.7362, "lon": 26.1445})]},
        )
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "bad",
        [
            {"lat": 200.0, "lon": 91.0},
            {"lat": 26.0, "lon": 300.0},
            {"lat": -91.0, "lon": 91.0},
        ],
    )
    async def test_out_of_range_coordinates_are_rejected(
        self, api: AsyncClient, session: AsyncSession, bad: dict
    ) -> None:
        _, _, _, _, headers = await _driving(session, api)
        response = await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix(location=bad)]},
        )
        assert response.status_code == 422

    @pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
    async def test_nan_and_infinity_are_rejected(
        self, api: AsyncClient, session: AsyncSession, literal: str
    ) -> None:
        """Python's json parser accepts these even though JSON does not define
        them, so a client genuinely can send them."""
        _, _, _, _, headers = await _driving(session, api)

        body = (
            '{"fixes": [{"device_fix_id": "%s", '
            '"location": {"lat": %s, "lon": 91.7362}, '
            '"recorded_at": "%s"}]}'
        ) % (uuid.uuid4(), literal, datetime.now(UTC).isoformat())

        response = await api.post(
            "/api/driver/me/location",
            headers={**headers, "Content-Type": "application/json"},
            content=body,
        )
        assert response.status_code == 422, response.text

    async def test_coordinates_round_trip_without_inversion(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """ST_X is longitude and ST_Y is latitude. Getting that backwards puts
        Guwahati in the Arctic, and every later distance is wrong."""
        _, _, _, trip, headers = await _driving(session, api)
        await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix(location=dict(GUWAHATI))]},
        )

        body = (
            await api.get(f"/api/trips/{trip.id}/track", headers=manager_headers)
        ).json()
        point = body["points"][0]["location"]
        assert point["lat"] == pytest.approx(GUWAHATI["lat"], abs=1e-6)
        assert point["lon"] == pytest.approx(GUWAHATI["lon"], abs=1e-6)


# --- Timestamps and idempotence ------------------------------------------


class TestTimeAndIdempotence:
    async def test_resending_a_batch_does_not_duplicate(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A dropped acknowledgement on a hill road must be safe to retry."""
        _, _, _, trip, headers = await _driving(session, api)
        batch = {"fixes": [fix(), fix()]}

        first = await api.post(
            "/api/driver/me/location", headers=headers, json=batch
        )
        second = await api.post(
            "/api/driver/me/location", headers=headers, json=batch
        )

        assert first.json()["accepted"] == 2
        assert second.json()["accepted"] == 0
        assert second.json()["duplicates_ignored"] == 2

        count = (
            await session.execute(
                select(func.count(GpsPoint.id)).where(GpsPoint.trip_id == trip.id)
            )
        ).scalar_one()
        assert count == 2

    async def test_concurrent_duplicate_uploads_insert_once(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The unique index decides, not a SELECT-then-INSERT pre-check.

        Two concurrent uploads would both pass a pre-check and both insert.
        """
        from app.main import create_app

        _, _, _, trip, headers = await _driving(session, api)
        batch = {"fixes": [fix(), fix(), fix()]}
        clients = [
            AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://t")
            for _ in range(3)
        ]
        try:
            responses = await asyncio.gather(
                *(
                    c.post("/api/driver/me/location", headers=headers, json=batch)
                    for c in clients
                ),
                return_exceptions=True,
            )
        finally:
            for c in clients:
                await c.aclose()

        assert all(getattr(r, "status_code", 500) == 202 for r in responses), [
            getattr(r, "status_code", r) for r in responses
        ]
        total_accepted = sum(r.json()["accepted"] for r in responses)
        assert total_accepted == 3, f"accepted {total_accepted}, expected 3"

        count = (
            await session.execute(
                select(func.count(GpsPoint.id)).where(GpsPoint.trip_id == trip.id)
            )
        ).scalar_one()
        assert count == 3

    async def test_duplicate_ids_within_one_batch_are_a_422(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, _, headers = await _driving(session, api)
        shared = str(uuid.uuid4())
        response = await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix(device_fix_id=shared), fix(device_fix_id=shared)]},
        )
        assert response.status_code == 422

    async def test_stale_fixes_are_rejected_without_failing_the_batch(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """One bad fix must not throw away a reconnecting truck's backlog."""
        _, _, _, _, headers = await _driving(session, api)
        ancient = (datetime.now(UTC) - timedelta(hours=30)).isoformat()

        response = await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix(recorded_at=ancient), fix()]},
        )
        assert response.status_code == 202
        body = response.json()
        assert body["accepted"] == 1
        assert body["rejected"] == 1
        assert body["rejected_reasons"] == {policy.REJECT_STALE: 1}

    async def test_backdated_fixes_inside_the_window_are_kept(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A truck out of coverage for a shift must be able to flush its queue."""
        _, _, _, _, headers = await _driving(session, api)
        recent = (datetime.now(UTC) - timedelta(hours=6)).isoformat()

        response = await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix(recorded_at=recent)]},
        )
        assert response.json()["accepted"] == 1

    async def test_future_timestamps_are_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, _, headers = await _driving(session, api)
        ahead = (datetime.now(UTC) + timedelta(hours=1)).isoformat()

        body = (
            await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={"fixes": [fix(recorded_at=ahead)]},
            )
        ).json()
        assert body["rejected"] == 1
        assert body["rejected_reasons"] == {policy.REJECT_FUTURE: 1}

    async def test_small_clock_skew_is_tolerated(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Phone clocks drift; a 30-second lead is not evidence of anything."""
        _, _, _, _, headers = await _driving(session, api)
        slightly_ahead = (datetime.now(UTC) + timedelta(seconds=30)).isoformat()

        body = (
            await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={"fixes": [fix(recorded_at=slightly_ahead)]},
            )
        ).json()
        assert body["accepted"] == 1

    async def test_out_of_order_arrival_does_not_move_the_position_backwards(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """The newest row inserted is routinely the OLDEST position in a backlog."""
        _, _, _, trip, headers = await _driving(session, api)
        now = datetime.now(UTC)

        await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={
                "fixes": [
                    fix(recorded_at=now.isoformat(), location=dict(JORHAT))
                ]
            },
        )
        # An older fix arrives afterwards, as a flushed offline queue does.
        await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={
                "fixes": [
                    fix(
                        recorded_at=(now - timedelta(minutes=20)).isoformat(),
                        location=dict(GUWAHATI),
                    )
                ]
            },
        )

        fleet = (
            await api.get("/api/fleet/active", headers=manager_headers)
        ).json()
        row = next(t for t in fleet["trips"] if t["trip_id"] == str(trip.id))
        assert row["position"]["location"]["lat"] == pytest.approx(
            JORHAT["lat"], abs=1e-6
        ), "an older fix overwrote a newer known position"


# --- Manager view ---------------------------------------------------------


class TestManagerLocationView:
    async def test_fleet_shows_position_and_a_live_label(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        _, _, truck, trip, headers = await _driving(session, api)
        await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )

        body = (
            await api.get("/api/fleet/active", headers=manager_headers)
        ).json()
        row = next(t for t in body["trips"] if t["trip_id"] == str(trip.id))

        assert row["registration_number"] == truck.registration_number
        assert row["trip_status"] == "ACTIVE"
        assert row["freshness"] == policy.FRESHNESS_LIVE
        assert row["position"]["age_seconds"] < policy.LOCATION_FRESH_SECONDS
        assert row["stops_total"] == 2
        assert row["next_stop_sequence"] == 0
        # The threshold travels with the data so the UI never invents one.
        assert body["fresh_seconds"] == policy.LOCATION_FRESH_SECONDS

    async def test_a_trip_with_no_fixes_is_not_called_stale(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """No contact yet and lost contact are different facts."""
        _, _, _, trip, _ = await _driving(session, api)

        body = (
            await api.get("/api/fleet/active", headers=manager_headers)
        ).json()
        row = next(t for t in body["trips"] if t["trip_id"] == str(trip.id))
        assert row["position"] is None
        assert row["freshness"] == policy.FRESHNESS_NONE

    async def test_an_old_fix_is_not_labelled_live(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """Freshness is measured from received_at, the SERVER clock.

        The row is aged directly because the alternative is a test that sleeps
        for 90 seconds; what is under test is the labelling, not the wait.
        """
        from sqlalchemy import update

        _, _, _, trip, headers = await _driving(session, api)
        await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )
        old = datetime.now(UTC) - timedelta(seconds=policy.LOCATION_FRESH_SECONDS + 60)
        await session.execute(
            update(GpsPoint)
            .where(GpsPoint.trip_id == trip.id)
            .values(received_at=old, recorded_at=old)
        )
        await session.commit()

        body = (
            await api.get("/api/fleet/active", headers=manager_headers)
        ).json()
        row = next(t for t in body["trips"] if t["trip_id"] == str(trip.id))
        assert row["freshness"] == policy.FRESHNESS_STALE
        assert row["position"] is not None, "a stale position is still shown"

    async def test_a_device_clock_cannot_make_an_old_fix_look_current(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """recorded_at is the device's claim; received_at is what we observed."""
        from sqlalchemy import update

        _, _, _, trip, headers = await _driving(session, api)
        await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )
        # Device claims "now"; the server actually received it long ago.
        await session.execute(
            update(GpsPoint)
            .where(GpsPoint.trip_id == trip.id)
            .values(
                received_at=datetime.now(UTC)
                - timedelta(seconds=policy.LOCATION_STALE_SECONDS + 60)
            )
        )
        await session.commit()

        body = (
            await api.get("/api/fleet/active", headers=manager_headers)
        ).json()
        row = next(t for t in body["trips"] if t["trip_id"] == str(trip.id))
        assert row["freshness"] == policy.FRESHNESS_NO_CONTACT

    async def test_driver_cannot_read_the_fleet(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Location history is for managers and admins only."""
        _, _, _, trip, headers = await _driving(session, api)

        assert (
            await api.get("/api/fleet/active", headers=headers)
        ).status_code == 403
        assert (
            await api.get(f"/api/trips/{trip.id}/track", headers=headers)
        ).status_code == 403

    async def test_fleet_is_not_public(self, api: AsyncClient) -> None:
        assert (await api.get("/api/fleet/active")).status_code == 401

    async def test_track_is_bounded(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """There is no all-history mode - see docs/SECURITY.md section 3."""
        _, _, _, trip, headers = await _driving(session, api)
        await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix() for _ in range(5)]},
        )

        capped = await api.get(
            f"/api/trips/{trip.id}/track?limit=2", headers=manager_headers
        )
        assert capped.status_code == 200
        assert len(capped.json()["points"]) == 2
        assert capped.json()["truncated"] is True

        # An oversized request is refused rather than quietly serving everything.
        assert (
            await api.get(
                f"/api/trips/{trip.id}/track?limit=100000", headers=manager_headers
            )
        ).status_code == 422


# --- Sanity signals and privacy ------------------------------------------


class TestSanitySignalsAndPrivacy:
    async def test_mock_location_is_flagged_not_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Detect, record, surface - never auto-punish. SECURITY.md section 8."""
        _, _, _, _, headers = await _driving(session, api)

        body = (
            await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={"fixes": [fix(is_mock_location=True)]},
            )
        ).json()
        assert body["accepted"] == 1, "a flagged fix must still be stored"
        assert policy.ANOMALY_MOCK_LOCATION in body["anomalies"]

    async def test_teleportation_is_flagged_not_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Discarding an impossible fix loses the position of a truck in trouble."""
        _, _, _, _, headers = await _driving(session, api)
        now = datetime.now(UTC)

        await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={
                "fixes": [
                    fix(
                        recorded_at=(now - timedelta(seconds=10)).isoformat(),
                        location=dict(GUWAHATI),
                    )
                ]
            },
        )
        body = (
            await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={
                    "fixes": [
                        fix(recorded_at=now.isoformat(), location=dict(JORHAT))
                    ]
                },
            )
        ).json()

        assert body["accepted"] == 1
        assert policy.ANOMALY_IMPLAUSIBLE_SPEED in body["anomalies"]

    async def test_teleportation_within_a_single_batch_is_flagged(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The plausibility baseline must advance THROUGH the batch.

        Regression: every fix was compared against one stored position - the
        state before the batch - so a jump between two consecutive fixes inside
        the same upload went unnoticed. A reconnecting truck sends its whole
        backlog in one request, which is exactly when this matters, and on the
        first batch of a trip there is no stored position at all so nothing was
        ever compared.
        """
        _, _, _, _, headers = await _driving(session, api)
        now = datetime.now(UTC)

        body = (
            await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={
                    "fixes": [
                        fix(
                            recorded_at=(now - timedelta(seconds=10)).isoformat(),
                            location=dict(GUWAHATI),
                        ),
                        fix(recorded_at=now.isoformat(), location=dict(JORHAT)),
                    ]
                },
            )
        ).json()

        assert body["accepted"] == 2, "a flagged fix must still be stored"
        assert policy.ANOMALY_IMPLAUSIBLE_SPEED in body["anomalies"]

    async def test_ordinary_movement_across_a_batch_is_not_flagged(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The other half of the same bug: no false positives.

        Comparing every fix against one old baseline also measures an ever-
        widening window, which made normal driving look impossible. Six fixes at
        the real cadence, a few hundred metres apart, must stay clean.
        """
        _, _, _, _, headers = await _driving(session, api)
        now = datetime.now(UTC)

        body = (
            await api.post(
                "/api/driver/me/location",
                headers=headers,
                json={
                    "fixes": [
                        fix(
                            recorded_at=(
                                now - timedelta(seconds=10 * (5 - n))
                            ).isoformat(),
                            # ~0.001 degree per step is roughly 110 m: about
                            # 40 km/h at a 10-second cadence.
                            location={
                                "lat": GUWAHATI["lat"] + n * 0.001,
                                "lon": GUWAHATI["lon"] + n * 0.001,
                            },
                        )
                        for n in range(6)
                    ]
                },
            )
        ).json()

        assert body["accepted"] == 6
        assert policy.ANOMALY_IMPLAUSIBLE_SPEED not in body["anomalies"], (
            "normal driving was flagged as a teleport"
        )

    async def test_a_full_page_is_not_reported_as_truncated(
        self, api: AsyncClient, session: AsyncSession, manager_headers: dict
    ) -> None:
        """`truncated` must mean "there is more", not "the page is full".

        Regression: reported `len(points) == limit`, so a trip whose track was
        exactly the page size told a manager history was being withheld when all
        of it was on screen.
        """
        _, _, _, trip, headers = await _driving(session, api)
        await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix() for _ in range(3)]},
        )

        exact = await api.get(
            f"/api/trips/{trip.id}/track?limit=3", headers=manager_headers
        )
        assert len(exact.json()["points"]) == 3
        assert exact.json()["truncated"] is False

        partial = await api.get(
            f"/api/trips/{trip.id}/track?limit=2", headers=manager_headers
        )
        assert len(partial.json()["points"]) == 2
        assert partial.json()["truncated"] is True

    async def test_gps_does_not_flood_the_audit_log(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Telemetry and the compliance trail are different records.

        One audit row per fix would bury the trail it exists to be.
        """
        _, _, _, trip, headers = await _driving(session, api)
        before = (
            await session.execute(select(func.count(AuditLog.id)))
        ).scalar_one()

        await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix() for _ in range(20)]},
        )

        after = (await session.execute(select(func.count(AuditLog.id)))).scalar_one()
        assert after == before, f"{after - before} audit rows written for GPS"

    async def test_driver_sees_their_own_last_fix_on_the_trip_screen(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """So the app can report what actually landed, not what it queued."""
        _, _, _, _, headers = await _driving(session, api)
        assert (
            await api.get("/api/driver/me/trip", headers=headers)
        ).json()["last_fix"] is None

        await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": [fix()]}
        )

        view = (await api.get("/api/driver/me/trip", headers=headers)).json()
        assert view["last_fix"] is not None
        assert view["last_fix"]["freshness"] == policy.FRESHNESS_LIVE
        assert view["tracking"]["moving_interval_seconds"] == (
            policy.TRACKING_MOVING_INTERVAL_SECONDS
        )

    async def test_batch_size_is_capped(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, _, headers = await _driving(session, api)
        response = await api.post(
            "/api/driver/me/location",
            headers=headers,
            json={"fixes": [fix() for _ in range(501)]},
        )
        assert response.status_code == 422

    async def test_empty_batch_is_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        _, _, _, _, headers = await _driving(session, api)
        response = await api.post(
            "/api/driver/me/location", headers=headers, json={"fixes": []}
        )
        assert response.status_code == 422
