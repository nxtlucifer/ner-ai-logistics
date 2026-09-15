"""Fleet connectivity rule: evidence floor, states, confidence, windows, gaps.

Pure - the map-matching lives in SQL and is exercised through the risk API in
tests/test_route_risk_api.py. Every case here is one row of the acceptance
matrix the mission demands: no evidence, too little evidence, prompt uploads,
a few queued, mostly queued, all queued for a long time, stale evidence, a
wrong clock, one trip versus many, the window ahead, the next gap, and a
labelled simulation.
"""

from datetime import UTC, datetime

from app.domain import connectivity as c

# A straight ~20 km line running east along 26.2 N: four 5 km segments.
LINE = [(26.2, 91.70), (26.2, 91.75), (26.2, 91.80), (26.2, 91.85), (26.2, 91.90)]
NOW = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)
DAY = 86_400.0


def fix(fraction, delay, *, trip="trip-a", vehicle="truck-a", age=3600.0):
    return c.ConnectivitySample(
        fraction=fraction, upload_delay_s=delay, age_seconds=age, trip=trip, vehicle=vehicle
    )


def run(samples):
    return c.estimate(geometry=LINE, samples=samples, now=NOW)


def bucket(samples, fraction, delays, *, trips=("trip-a",)):
    for i, delay in enumerate(delays):
        samples.append(fix(fraction, delay, trip=trips[i % len(trips)]))


class TestEvidenceFloor:
    def test_no_fixes_is_unknown_not_good(self):
        profile = run([])
        assert profile.status == "UNKNOWN"
        assert profile.coverage == 0.0
        assert profile.is_known is False
        assert profile.exposure_km == 0.0
        assert profile.reason_codes == ("CONNECTIVITY_UNKNOWN",)
        assert len(profile.segments) == 4
        assert all(s.state == "UNKNOWN" and s.sample_count == 0 for s in profile.segments)
        assert all(s.queued_share is None and s.median_delay_s is None for s in profile.segments)

    def test_fewer_than_min_samples_stays_unknown(self):
        samples = []
        bucket(samples, 0.1, [10.0] * (c.MIN_SAMPLES - 1))
        profile = run(samples)
        assert profile.segments[0].state == "UNKNOWN"
        assert profile.segments[0].sample_count == c.MIN_SAMPLES - 1
        # The evidence that exists is still reported, just not graded.
        assert profile.segments[0].queued_share == 0.0
        assert profile.status == "UNKNOWN"

    def test_empty_geometry_is_unknown(self):
        profile = c.estimate(geometry=[], samples=[fix(0.5, 10.0)], now=NOW)
        assert profile.status == "UNKNOWN"
        assert profile.segments == ()

    def test_stale_fixes_are_ignored(self):
        samples = [fix(0.1, 10.0, age=(c.MAX_AGE_DAYS + 1) * DAY) for _ in range(6)]
        profile = run(samples)
        assert profile.status == "UNKNOWN"
        assert profile.sample_count == 0
        assert profile.newest_age_seconds is None

    def test_fixes_off_the_line_are_ignored(self):
        samples = [fix(1.2, 10.0) for _ in range(6)] + [fix(-0.1, 10.0) for _ in range(6)]
        assert run(samples).sample_count == 0


class TestStates:
    def test_prompt_uploads_grade_good(self):
        samples = []
        bucket(samples, 0.1, [5.0, 20.0, 60.0, 90.0])
        profile = run(samples)
        seg = profile.segments[0]
        assert seg.state == "GOOD"
        assert seg.queued_share == 0.0
        assert seg.median_delay_s == 40.0
        assert profile.status == "GOOD"
        assert "CONNECTIVITY_GOOD_ON_ROUTE" in profile.reason_codes
        # Three of four segments have no evidence, and the profile says so.
        assert "CONNECTIVITY_COVERAGE_PARTIAL" in profile.reason_codes
        assert 0.24 < profile.coverage < 0.26
        assert profile.unknown_km == 15.0

    def test_a_few_queued_fixes_grade_unstable(self):
        samples = []
        bucket(samples, 0.1, [5.0, 10.0, 15.0, 300.0])
        profile = run(samples)
        assert profile.segments[0].state == "UNSTABLE"
        assert profile.segments[0].queued_share == 0.25
        assert profile.status == "UNSTABLE"
        assert "CONNECTIVITY_UNSTABLE_ON_ROUTE" in profile.reason_codes
        assert profile.exposure_km == 0.0

    def test_mostly_queued_fixes_grade_weak(self):
        samples = []
        bucket(samples, 0.1, [10.0, 300.0, 400.0, 500.0])
        profile = run(samples)
        assert profile.segments[0].state == "WEAK"
        assert profile.weak_km == 5.0
        assert profile.dead_km == 0.0
        assert profile.exposure_km == 5.0
        assert "CONNECTIVITY_WEAK_ZONES_ON_ROUTE" in profile.reason_codes

    def test_long_waits_everywhere_grade_dead_zone(self):
        samples = []
        bucket(samples, 0.1, [900.0, 1200.0, 3600.0, 700.0, 800.0])
        profile = run(samples)
        seg = profile.segments[0]
        assert seg.state == "DEAD_ZONE"
        assert seg.queued_share == 1.0
        assert seg.median_delay_s == 900.0
        assert profile.dead_km == 5.0
        assert profile.status == "DEAD_ZONE"
        assert profile.reason_codes[0] == "CONNECTIVITY_DEAD_ZONE_ON_ROUTE"

    def test_all_queued_but_short_waits_is_weak_not_dead(self):
        samples = []
        bucket(samples, 0.1, [200.0, 250.0, 300.0, 350.0])
        assert run(samples).segments[0].state == "WEAK"

    def test_worst_segment_names_the_route(self):
        samples = []
        bucket(samples, 0.1, [5.0, 10.0, 15.0, 20.0])
        bucket(samples, 0.6, [10.0, 300.0, 400.0, 500.0])
        profile = run(samples)
        assert profile.status == "WEAK"
        assert profile.segments[0].state == "GOOD"
        assert profile.segments[2].state == "WEAK"
        assert set(profile.reason_codes) == {
            "CONNECTIVITY_WEAK_ZONES_ON_ROUTE", "CONNECTIVITY_COVERAGE_PARTIAL"
        }


class TestClocks:
    def test_negative_and_huge_waits_are_clamped(self):
        samples = []
        bucket(samples, 0.1, [-500.0, -5.0, 10.0, 10.0])
        seg = run(samples).segments[0]
        assert seg.state == "GOOD"
        # [-500, -5, 10, 10] clamps to [0, 0, 10, 10]: median 5, nothing negative.
        assert seg.median_delay_s == 5.0
        samples = []
        bucket(samples, 0.1, [10 * DAY, 10 * DAY, 10 * DAY, 10 * DAY])
        seg = run(samples).segments[0]
        assert seg.state == "DEAD_ZONE"
        assert seg.median_delay_s == c.MAX_DELAY_S

    def test_one_wrong_clock_cannot_make_a_dead_zone(self):
        # One fix from a phone whose clock is a week out, among five prompt
        # ones: it is a SHARE that grades a segment, so a single outlier can
        # at most nudge it to UNSTABLE, never to WEAK or DEAD_ZONE.
        samples = []
        bucket(samples, 0.1, [10.0, 12.0, 15.0, 9.0, 10 * DAY])
        assert run(samples).segments[0].state == "UNSTABLE"
        samples = []
        bucket(samples, 0.1, [10.0, 12.0, 15.0, 9.0, 11.0, 10 * DAY])
        assert run(samples).segments[0].state == "GOOD"


class TestConfidence:
    def test_one_trip_is_low(self):
        samples = []
        bucket(samples, 0.1, [10.0] * 20, trips=("trip-a",))
        assert run(samples).segments[0].evidence == "LOW"

    def test_two_trips_are_medium(self):
        samples = []
        bucket(samples, 0.1, [10.0] * 20, trips=("trip-a", "trip-b"))
        assert run(samples).segments[0].evidence == "MEDIUM"

    def test_three_trips_with_enough_fixes_are_high(self):
        samples = []
        bucket(samples, 0.1, [10.0] * 12, trips=("trip-a", "trip-b", "trip-c"))
        assert run(samples).segments[0].evidence == "HIGH"
        samples = []
        bucket(samples, 0.1, [10.0] * 6, trips=("trip-a", "trip-b", "trip-c"))
        assert run(samples).segments[0].evidence == "MEDIUM"

    def test_unknown_segments_never_claim_evidence(self):
        assert all(s.evidence == "LOW" for s in run([]).segments)

    def test_there_is_no_confidence_or_probability_anywhere(self):
        """The project refuses a confidence number: one implies a trained,
        validated model, and this is a counting rule with published
        constants."""
        profile = run([])
        for forbidden in ("confidence", "probability", "model_version", "predicted_state"):
            assert not hasattr(profile, forbidden)
            assert all(not hasattr(seg, forbidden) for seg in profile.segments)


class TestGaps:
    def _weak_middle(self):
        samples = []
        bucket(samples, 0.1, [5.0] * 4)
        bucket(samples, 0.35, [300.0] * 4)
        bucket(samples, 0.6, [900.0] * 4)
        bucket(samples, 0.85, [5.0] * 4)
        return run(samples)

    def test_longest_gap_counts_contiguous_weak_and_dead(self):
        profile = self._weak_middle()
        assert [s.state for s in profile.segments] == ["GOOD", "WEAK", "DEAD_ZONE", "GOOD"]
        assert profile.longest_gap_km == 10.0
        assert profile.exposure_km == 10.0

    def test_separated_gaps_are_not_joined(self):
        samples = []
        bucket(samples, 0.1, [300.0] * 4)
        bucket(samples, 0.35, [5.0] * 4)
        bucket(samples, 0.6, [300.0] * 4)
        assert run(samples).longest_gap_km == 5.0

    def test_next_gap_from_finds_the_first_stretch_ahead(self):
        profile = self._weak_middle()
        seg, distance = c.next_gap_from(profile, 1_000.0, states=c.EXPOSURE_STATES)
        assert seg.state == "WEAK"
        assert 3_900.0 < distance < 4_100.0
        inside, distance = c.next_gap_from(profile, 7_000.0, states=c.EXPOSURE_STATES)
        assert inside.state == "WEAK"
        assert distance == 0.0
        assert c.next_gap_from(profile, 16_000.0, states=c.EXPOSURE_STATES) is None

    def test_next_gap_treats_unknown_as_worth_preparing_for(self):
        profile = run([])
        seg, distance = c.next_gap_from(profile, 0.0)
        assert seg.state == "UNKNOWN"
        assert distance == 0.0

    def test_window_clips_segments_and_recomputes(self):
        profile = self._weak_middle()
        ahead = c.window(profile, 7_500.0, 12_500.0)
        assert [s.state for s in ahead.segments] == ["WEAK", "DEAD_ZONE"]
        assert ahead.weak_km == 2.5
        assert ahead.dead_km == 2.5
        assert ahead.coverage == 1.0
        assert ahead.status == "DEAD_ZONE"
        empty = c.window(profile, 30_000.0, 40_000.0)
        assert empty.segments == ()
        assert empty.status == "UNKNOWN"


class TestSimulation:
    def test_dead_zone_is_labelled_and_bounded(self):
        profile = c.simulate_dead_zone(run([]))
        touched = [s for s in profile.segments if s.state == "DEAD_ZONE"]
        assert touched, "the middle stretch must be marked"
        assert all(s.source == "DEMO_SIMULATION" and s.evidence == "SIMULATED" for s in touched)
        untouched = [s for s in profile.segments if s.state != "DEAD_ZONE"]
        assert all(s.source == c.PROVIDER for s in untouched)
        assert profile.dead_km > 0.0
        assert "CONNECTIVITY_DEAD_ZONE_ON_ROUTE" in profile.reason_codes

    def test_real_evidence_outside_the_stretch_is_kept(self):
        samples = []
        bucket(samples, 0.05, [5.0] * 4)
        profile = c.simulate_dead_zone(run(samples))
        assert profile.segments[0].state == "GOOD"
        assert profile.segments[0].source == c.PROVIDER
