"""Route-ahead worker: the window ahead, material-change detection, and one
coordinator pass over a moving trip that pushes once and then stays quiet."""

import pytest
from geoalchemy2 import WKTElement
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import RouteKind, RouteState, TripStatus
from app.models.operations import DriverNotification, TripRoute
from app.services import notify, route_watch
from app.services.route_watch import Ahead, ahead_slice, changes, horizon_km
from tests import factories

# Guwahati -> Shillong-ish, ~100 km of straight segments (lat, lon).
GEOMETRY = [(26.1445, 91.7362), (26.0, 91.8), (25.8, 91.85), (25.6, 91.88), (25.5744, 91.8826)]


def test_horizon_follows_speed_within_bounds():
    assert horizon_km(None) == 60.0
    assert horizon_km(10) == 30.0
    assert horizon_km(40) == 60.0
    assert horizon_km(200) == 100.0


def test_ahead_slice_starts_at_progress_and_keeps_a_segment_at_the_end():
    assert ahead_slice(GEOMETRY, None, 30) == GEOMETRY  # no fix -> whole route
    window = ahead_slice(GEOMETRY, 0.5, 30)
    assert window and window[0] != GEOMETRY[0] and len(window) >= 2
    assert ahead_slice(GEOMETRY, 0.999, 30) == GEOMETRY[-2:]


def _ahead(decision="CONTINUE", codes=(), exposure="LOW"):
    return Ahead(decision=decision, codes=frozenset(codes), exposure=exposure, horizon_km=60.0, fraction_complete=0.2, band="LOW")


def test_changes_push_only_material_worsening_once():
    first = _ahead("HOLD_AND_REVIEW", ("OFFICIAL_WARNING_ON_ROUTE", "HEAVY_RAIN_ON_ROUTE"), "HIGH")
    events = [e for e, *_ in changes(None, first)]
    assert events == ["HOLD_AND_REVIEW", "OFFICIAL_WARNING_NEW", "WEATHER_SEVERITY_CHANGED", "ROUTE_DANGER_AHEAD"]
    assert changes(first, first) == []
    calmer = _ahead("CAUTION", ("HEAVY_RAIN_ON_ROUTE",), "HIGH")
    assert changes(first, calmer) == []
    assert [e for e, *_ in changes(calmer, first)] == ["HOLD_AND_REVIEW", "OFFICIAL_WARNING_NEW"]
    titles = {e: t for e, t, *_ in changes(None, first)}
    assert "exposure" in titles["ROUTE_DANGER_AHEAD"].lower() and "happening" not in titles["ROUTE_DANGER_AHEAD"].lower()


@pytest.mark.requires_db
async def test_run_tick_scores_moving_trips_and_pushes_once(session: AsyncSession, monkeypatch):
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    assignment = await factories.make_assignment(session, driver, truck)
    trip = await factories.make_trip(session, driver, truck, assignment=assignment, status=TripStatus.ACTIVE)
    wkt = "LINESTRING({})".format(", ".join(f"{lon} {lat}" for lat, lon in GEOMETRY))
    route = TripRoute(trip_id=trip.id, kind=RouteKind.PRIMARY, state=RouteState.SELECTED, geometry=WKTElement(wkt, srid=4326),
                      distance_km=100, estimated_duration_min=180, routing_provider="stub")
    session.add(route)
    await session.flush()
    trip.selected_route_id = route.id
    driver.push_token = "ExponentPushToken[t]"
    await session.commit()

    sent = []

    async def relay(token, title, body, data):
        sent.append(title)
        return "SENT"

    looks = [_ahead("HOLD_AND_REVIEW", ("OFFICIAL_WARNING_ON_ROUTE",), "HIGH")]

    async def fake_look(db, trip_id, route_id):
        return looks[0], None

    monkeypatch.setattr(notify, "_deliver", relay)
    monkeypatch.setattr(route_watch, "look_ahead", fake_look)
    monkeypatch.setenv("PUSH_ENABLED", "true")
    route_watch._STATE.clear()

    done = await route_watch.run_tick(session, now=1_000_000.0)
    mine = [d for d in done if d["trip_id"] == str(trip.id)]
    assert mine and mine[0]["decision"] == "HOLD_AND_REVIEW"
    assert [e for e, _ in mine[0]["events"]] == ["HOLD_AND_REVIEW", "OFFICIAL_WARNING_NEW", "ROUTE_DANGER_AHEAD"]
    assert len(sent) == 3

    # Within the refresh window nothing is re-scored; after it, nothing new is pushed.
    assert [d for d in await route_watch.run_tick(session, now=1_000_030.0) if d["trip_id"] == str(trip.id)] == []
    later = [d for d in await route_watch.run_tick(session, now=1_001_000.0) if d["trip_id"] == str(trip.id)]
    assert later and later[0]["events"] == []
    rows = (await session.execute(select(DriverNotification).where(DriverNotification.trip_id == trip.id))).scalars().all()
    assert sorted(r.event for r in rows) == ["HOLD_AND_REVIEW", "OFFICIAL_WARNING_NEW", "ROUTE_DANGER_AHEAD"]
    route_watch._STATE.clear()
