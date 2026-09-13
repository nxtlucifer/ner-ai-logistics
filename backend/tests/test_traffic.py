"""Fleet traffic rule: the evidence floor, freshness, plausibility, direction.

Pure - the map-matching lives in SQL and is exercised by the API test in
tests/test_route_risk_api.py. Every case here is one row of the acceptance
matrix: no probes, one probe, many fresh probes, stale probes, bad accuracy,
teleport, opposite direction, segment boundary.
"""

from datetime import UTC, datetime

from app.domain import traffic as t

# A straight ~20 km line running east along 26.2 N: four 5 km segments.
LINE = [(26.2, 91.70), (26.2, 91.75), (26.2, 91.80), (26.2, 91.85), (26.2, 91.90)]
DISTANCE_KM = 19.9
DURATION_MIN = 24.0  # OSRM-style expectation: ~50 km/h
NOW = datetime(2026, 9, 13, 10, 0, tzinfo=UTC)


def probe(fraction, speed, *, vehicle="truck-a", age=60.0, accuracy=15.0, heading=90.0):
    return t.TrafficSample(
        fraction=fraction, speed_kmph=speed, accuracy_m=accuracy,
        heading_deg=heading, age_seconds=age, vehicle=vehicle,
    )


def run(samples, **kw):
    return t.estimate(geometry=LINE, samples=samples, distance_km=DISTANCE_KM, duration_min=DURATION_MIN, now=NOW, **kw)


def bucket(samples, fraction, speed, count=4, vehicles=("truck-a", "truck-b")):
    for i in range(count):
        samples.append(probe(fraction, speed, vehicle=vehicles[i % len(vehicles)]))


def test_no_probes_is_unknown_not_normal():
    est = run([])
    assert est.status == "UNKNOWN"
    assert est.coverage == 0.0
    assert est.delay_min == 0.0
    assert all(s.state == "UNKNOWN" for s in est.segments)
    assert est.reason_codes == ("TRAFFIC_UNKNOWN",)


def test_one_vehicle_is_not_traffic():
    samples = []
    bucket(samples, 0.1, 12.0, count=10, vehicles=("truck-a",))
    est = run(samples)
    assert est.status == "UNKNOWN"
    assert est.segments[0].sample_count == 10
    assert est.segments[0].vehicle_count == 1


def test_fresh_probes_from_two_trucks_grade_the_segment():
    normal, slow, jam = [], [], []
    bucket(normal, 0.1, 48.0)
    bucket(slow, 0.1, 30.0)
    bucket(jam, 0.1, 12.0)
    assert run(normal).segments[0].state == "NORMAL"
    assert run(slow).segments[0].state == "SLOW"
    est = run(jam)
    assert est.status == "CONGESTED"
    assert est.segments[0].state == "CONGESTED"
    assert est.segments[0].observed_kmph == 12.0
    assert est.segments[0].baseline_kmph == round(DISTANCE_KM / (DURATION_MIN / 60), 1)
    assert 0.24 < est.coverage < 0.26
    # 5 km at 12 km/h instead of ~49.75 km/h: about 19 extra minutes.
    assert 18.0 < est.delay_min < 20.0
    assert est.reason_codes == ("TRAFFIC_CONGESTED_AHEAD",)


def test_stale_probes_cannot_appear_live():
    samples = []
    for i in range(6):
        samples.append(probe(0.1, 10.0, vehicle=f"truck-{i}", age=t.FRESH_SECONDS + 1))
    est = run(samples)
    assert est.status == "UNKNOWN"
    assert est.sample_count == 0
    assert est.newest_age_seconds is None


def test_bad_accuracy_and_teleports_are_dropped():
    samples = []
    bucket(samples, 0.1, 10.0, count=3)  # three good ones, below the floor
    samples.append(probe(0.1, 10.0, vehicle="truck-b", accuracy=t.MAX_ACCURACY_M + 1))
    samples.append(probe(0.1, 400.0, vehicle="truck-b"))  # a teleport
    est = run(samples)
    assert est.segments[0].sample_count == 3
    assert est.status == "UNKNOWN"


def test_parked_trucks_are_not_congestion():
    samples = []
    bucket(samples, 0.1, 0.0, count=8)
    assert run(samples).status == "UNKNOWN"


def test_opposite_carriageway_does_not_count():
    samples = []
    bucket(samples, 0.1, 10.0, count=4)
    for s in list(samples):
        samples.append(probe(0.1, 10.0, vehicle=s.vehicle, heading=270.0))
    est = run(samples)
    assert est.segments[0].sample_count == 4
    assert est.segments[0].state == "CONGESTED"


def test_a_sample_on_the_boundary_enters_the_next_segment():
    samples = []
    boundary = 5000.0 / (DISTANCE_KM * 1000.0) * (t.cumulative_metres(LINE)[-1] / (DISTANCE_KM * 1000.0)) ** 0
    exact = 5000.0 / t.cumulative_metres(LINE)[-1]
    bucket(samples, exact, 40.0)
    est = run(samples)
    assert est.segments[0].sample_count == 0
    assert est.segments[1].sample_count == 4
    assert boundary > 0


def test_no_baseline_means_unknown():
    samples = []
    bucket(samples, 0.1, 40.0)
    est = t.estimate(geometry=LINE, samples=samples, distance_km=None, duration_min=None, now=NOW)
    assert est.status == "UNKNOWN"
    assert est.segments == ()


def test_traffic_ranks_by_time_not_by_alarm():
    from app.domain import route_recommendation as rr
    from app.domain.landslide import DataStatus, LandslideAssessment, LandslideRisk
    from app.domain.route_risk import RouteRisk

    def risk(delay):
        est = run([]) if delay == 0 else t.TrafficEstimate(
            status="CONGESTED", segments=(), coverage=0.25, delay_min=delay,
            sample_count=8, vehicle_count=2, newest_age_seconds=30.0,
            reason_codes=("TRAFFIC_CONGESTED_AHEAD",),
        )
        return RouteRisk(
            landslide=LandslideAssessment(risk=LandslideRisk.LOW, data_status=DataStatus.AVAILABLE),
            score=10, band="LOW", components=(), inputs={}, unavailable=(), reason_codes=(),
            observations_used=0, observations_stale=0, traffic=est,
        )

    jammed = rr.RouteCandidate(route_id="a", kind="PRIMARY", distance_km=100, duration_min=120, risk=risk(45.0))
    clear = rr.RouteCandidate(route_id="b", kind="ALTERNATIVE", distance_km=110, duration_min=140, risk=risk(0))
    assert rr._sort_key(clear) < rr._sort_key(jammed)
    assert clear.risk.score == jammed.risk.score  # traffic never touched the score
