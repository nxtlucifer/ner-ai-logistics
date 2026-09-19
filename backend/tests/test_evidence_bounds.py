"""Slow or broken evidence sources degrade one factor, never the whole answer.

No database and no network: the sources are stubbed at the module seams the
services already call through.
"""

import asyncio
import gc
import json
import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.core.config import get_settings
from app.domain.landslide import IncidentQueryResult, SourceState, assess_corridor
from app.domain.route_eligibility import Eligibility
from app.domain.route_risk import NOT_AVAILABLE, REASON_HEAVY_RAIN, assess
from app.domain.weather import WeatherObservation
from app.models.enums import RouteKind
from app.services import geocoding, offline_package
from app.services import route_risk as risk_service
from app.services import terrain as terrain_service
from app.services import traffic as traffic_service
from app.services import warnings as warnings_service

POSITIONS = [(26.1445, 91.7362), (26.3, 91.9)]


async def _hang(*args, **kwargs):
    await asyncio.sleep(3600)


@pytest.fixture(autouse=True)
async def _stop_background():
    """A shielded source outlives its caller by design, but not the test's loop."""
    yield
    for task in list(risk_service._background):
        task.cancel()


async def _no_landslide(positions):
    return assess_corridor(IncidentQueryResult(state=SourceState.NOT_CONFIGURED), route=positions)


async def test_a_hung_or_broken_source_reads_not_available_and_the_rest_arrive(monkeypatch, caplog) -> None:
    monkeypatch.setenv("EVIDENCE_TIMEOUT_SECONDS", "0.05")
    observation = WeatherObservation(lat=26.1, lon=91.7, provider="p", observed_at=datetime.now(UTC))

    async def weather(positions):
        return [observation]

    async def broken(route_id, positions):
        raise RuntimeError("provider said no")

    monkeypatch.setattr(risk_service, "observations_for", weather)
    monkeypatch.setattr(risk_service, "flood_for", _hang)
    monkeypatch.setattr(risk_service, "warnings_for", broken)
    monkeypatch.setattr(risk_service, "landslide_for", _hang)

    with caplog.at_level(logging.WARNING, logger=risk_service.__name__):
        observations, landslide, terrain, history, flood, warnings = await asyncio.wait_for(
            risk_service.evidence_for(uuid.uuid4(), POSITIONS, POSITIONS), 2
        )

    assert observations == [observation]
    assert flood is None and warnings is None
    # An internal source that TIMES OUT still maps to its fallback: the same
    # UNKNOWN read landslide_for gives for its own provider failure.
    assert landslide.risk.value == "UNKNOWN" and not landslide.is_known
    assert history is not None

    risk = assess(
        distance_km=100, duration_min=120, observations=observations,
        landslide=landslide, terrain=terrain, history=history, flood=flood, warnings=warnings,
    )
    assert risk.inputs["weather"] != NOT_AVAILABLE
    assert risk.inputs["flood"] == NOT_AVAILABLE
    assert risk.inputs["landslide"] == NOT_AVAILABLE
    assert "evidence source flood unavailable: TimeoutError" in caplog.text
    assert "evidence source landslide unavailable: TimeoutError" in caplog.text
    # An external provider that RAISED is logged with its traceback.
    [raised] = [r for r in caplog.records if "evidence source warnings" in r.getMessage()]
    assert raised.exc_info is not None and raised.exc_info[0] is RuntimeError


@pytest.mark.parametrize("source", ["landslide_for", "history_for"])
async def test_a_bug_in_our_own_source_refuses_selection_instead_of_reading_unknown(monkeypatch, source) -> None:
    async def bug(positions):
        raise RuntimeError("our bug")

    async def weather(positions):
        return []

    async def facts(db, route_id):
        return "LINESTRING(91.7362 26.1445, 91.9 26.3)", Decimal("30"), 40

    async def no_probes(db, route_id):
        return []

    class Db:
        async def commit(self):
            pass

    monkeypatch.setattr(risk_service, "observations_for", weather)
    monkeypatch.setattr(risk_service, "landslide_for", _no_landslide)
    monkeypatch.setattr(risk_service, source, bug)
    monkeypatch.setattr(risk_service, "_route_facts", facts)
    monkeypatch.setattr(traffic_service, "samples_for", no_probes)

    with pytest.raises(RuntimeError, match="our bug"):
        await risk_service.evidence_for(uuid.uuid4(), POSITIONS, POSITIONS)

    # NOT_ASSESSED refuses the selection; UNKNOWN would allow a one-step approval.
    decision, evidence = await risk_service.eligibility_and_evidence_for_route(Db(), uuid.uuid4())
    assert decision.eligibility is Eligibility.NOT_ASSESSED and evidence is None


async def test_one_slow_weather_point_does_not_discard_the_points_that_answered(monkeypatch) -> None:
    monkeypatch.setenv("EVIDENCE_TIMEOUT_SECONDS", "0.05")
    three = [*POSITIONS, (26.5, 92.1)]

    class Provider:
        async def current(self, lat, lon):
            if (lat, lon) == three[1]:
                await asyncio.sleep(3600)
            return WeatherObservation(
                lat=lat, lon=lon, provider="p", observed_at=datetime.now(UTC), precipitation_mm=20.0
            )

    monkeypatch.setattr(risk_service, "build_provider", Provider)
    monkeypatch.setattr(risk_service, "landslide_for", _no_landslide)

    observations, landslide, terrain, history, flood, warnings = await asyncio.wait_for(
        risk_service.evidence_for(uuid.uuid4(), three, three), 2
    )

    assert [(o.lat, o.lon) for o in observations] == [three[0], three[2]]
    risk = assess(
        distance_km=100, duration_min=120, observations=observations,
        landslide=landslide, terrain=terrain, history=history, flood=flood, warnings=warnings,
    )
    assert risk.inputs["weather"] != NOT_AVAILABLE
    assert REASON_HEAVY_RAIN in risk.reason_codes


async def test_a_deadline_on_one_caller_does_not_cancel_the_terrain_fetch_another_awaits(monkeypatch) -> None:
    fetches: list[int] = []

    class SlowDem:
        async def elevations(self, points):
            fetches.append(len(points))
            await asyncio.sleep(0.3)
            return [100.0] * len(points)

    async def weather(positions):
        return []

    monkeypatch.setenv("TERRAIN_ENABLED", "true")
    monkeypatch.setattr(terrain_service, "build_provider", SlowDem)
    monkeypatch.setattr(risk_service, "observations_for", weather)
    monkeypatch.setattr(risk_service, "landslide_for", _no_landslide)
    route_id = uuid.uuid4()

    def evidence():
        return risk_service.evidence_for(route_id, POSITIONS, POSITIONS)

    monkeypatch.setenv("EVIDENCE_TIMEOUT_SECONDS", "0.05")
    tight = asyncio.ensure_future(evidence())
    await asyncio.sleep(0)  # it reads its 0.05 s per-source deadline
    monkeypatch.setenv("EVIDENCE_TIMEOUT_SECONDS", "5")
    get_settings.cache_clear()
    # The offline package's shape: an outer wait_for cancelling the whole read.
    offline = asyncio.ensure_future(asyncio.wait_for(evidence(), 0.05))

    normal = await asyncio.wait_for(evidence(), 2)

    assert (await tight)[2] is None
    with pytest.raises(TimeoutError):
        await offline
    assert normal[2] is not None and normal[2].usable
    assert len(fetches) == 1
    assert terrain_service._cache[route_id] is normal[2]


async def test_a_source_that_fails_after_its_deadline_is_logged_by_name(monkeypatch, caplog) -> None:
    monkeypatch.setenv("EVIDENCE_TIMEOUT_SECONDS", "0.05")

    async def late(route_id, positions):
        await asyncio.sleep(0.1)
        raise RuntimeError("late failure")

    async def weather(positions):
        return []

    monkeypatch.setattr(risk_service, "observations_for", weather)
    monkeypatch.setattr(risk_service, "landslide_for", _no_landslide)
    monkeypatch.setattr(risk_service, "flood_for", late)

    with caplog.at_level(logging.WARNING):
        evidence = await asyncio.wait_for(risk_service.evidence_for(uuid.uuid4(), POSITIONS, POSITIONS), 2)
        assert evidence[4] is None  # the caller got its fallback at the deadline
        for _ in range(100):  # the shielded read runs on and fails 0.05 s later
            if not risk_service._background:
                break
            await asyncio.sleep(0.01)
        gc.collect()  # an unretrieved exception is reported when its task is freed

    [late_record] = [r for r in caplog.records if "failed after its deadline" in r.getMessage()]
    assert late_record.getMessage() == "evidence source flood failed after its deadline"
    assert late_record.exc_info[0] is RuntimeError
    assert "never retrieved" not in caplog.text


async def test_a_source_cancelled_after_its_deadline_settles_quietly(monkeypatch, caplog) -> None:
    """Shutdown cancels what is still in _background. Asking a cancelled task
    for its exception raises inside the callback, which asyncio logs as an error."""
    monkeypatch.setenv("EVIDENCE_TIMEOUT_SECONDS", "0.05")

    async def weather(positions):
        return []

    monkeypatch.setattr(risk_service, "observations_for", weather)
    monkeypatch.setattr(risk_service, "landslide_for", _no_landslide)
    monkeypatch.setattr(risk_service, "flood_for", _hang)

    with caplog.at_level(logging.WARNING):
        evidence = await asyncio.wait_for(risk_service.evidence_for(uuid.uuid4(), POSITIONS, POSITIONS), 2)
        assert evidence[4] is None
        hung = list(risk_service._background)
        assert hung  # the flood read outlived its caller
        for task in hung:
            task.cancel()
        for _ in range(100):
            if not risk_service._background:
                break
            await asyncio.sleep(0.01)

    assert not risk_service._background and all(t.cancelled() for t in hung)
    assert "Exception in callback" not in caplog.text


async def test_the_offline_package_ships_the_route_when_risk_is_slow(monkeypatch) -> None:
    monkeypatch.setenv("OFFLINE_RISK_TIMEOUT_SECONDS", "0.05")
    route = offline_package.OfflineRoute(
        route_id=uuid.uuid4(), kind=RouteKind.PRIMARY, distance_km=10.0,
        estimated_duration_min=20, geometry=[list(p) for p in POSITIONS],
    )

    async def routes_for(db, trip):
        return route, None

    async def stops_for(db, trip_id):
        return ()

    monkeypatch.setattr(offline_package, "_routes_for", routes_for)
    monkeypatch.setattr(offline_package, "_stops_for", stops_for)
    monkeypatch.setattr(offline_package.route_risk_service, "assess_route", _hang)
    trip = SimpleNamespace(id=uuid.uuid4(), trip_code="T-1", selected_route_id=route.route_id)

    package = await asyncio.wait_for(offline_package.build_for_trip(None, trip), 2)

    assert package.selected_route is route
    assert package.risk is None and package.risk_captured_at is None
    assert offline_package.REASON_RISK_UNAVAILABLE in package.reason_codes


ADDRESS = json.dumps({"address": {"state_district": "Kamrup", "state": "Assam"}}).encode()


async def test_locate_takes_the_shared_lock_and_throttle_per_request(monkeypatch) -> None:
    assert warnings_service._throttle is geocoding._throttle  # one throttle for all Nominatim calls
    order: list[str] = []
    throttled_under_lock: list[bool] = []

    async def search():
        async with geocoding._nominatim_lock:
            order.append("search")

    async def fake_get(client, url, **params):
        order.append("reverse")
        if len(order) == 1:
            asyncio.ensure_future(search())  # an address search arrives mid-route
            await asyncio.sleep(0)
        return ADDRESS

    async def throttle():
        throttled_under_lock.append(geocoding._nominatim_lock.locked())

    monkeypatch.setattr(warnings_service, "_get", fake_get)
    monkeypatch.setattr(warnings_service, "_throttle", throttle)

    located = await warnings_service.locate(uuid.uuid4(), POSITIONS)

    assert located == ({"Kamrup"}, {"Assam"})
    assert order == ["reverse", "search", "reverse"]  # the search waited one request, not the route
    assert throttled_under_lock == [True, True]


async def test_a_route_that_resolves_nothing_is_not_asked_again_for_ten_minutes(monkeypatch) -> None:
    calls: list[str] = []

    async def fake_get(client, url, **params):
        calls.append(url)
        return None

    async def throttle():
        pass

    monkeypatch.setattr(warnings_service, "_get", fake_get)
    monkeypatch.setattr(warnings_service, "_throttle", throttle)
    route_id = uuid.uuid4()

    assert await warnings_service.locate(route_id, POSITIONS[:1]) is None
    assert len(calls) == 2  # one request and one retry
    assert await warnings_service.locate(route_id, POSITIONS[:1]) is None
    assert len(calls) == 2  # remembered: no request during the outage

    warnings_service._unlocated[str(route_id)] -= warnings_service.LOCATE_RETRY_SECONDS
    assert await warnings_service.locate(route_id, POSITIONS[:1]) is None
    assert len(calls) == 4  # ten minutes later it is asked again
