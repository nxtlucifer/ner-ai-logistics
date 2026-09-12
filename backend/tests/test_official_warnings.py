"""NDMA SACHET (CAP) alerts, matched to a corridor by the districts it crosses.

Fixtures are the public RSS feed and one linked CAP file as fetched on
2026-09-12. The polygon endpoint the CAP references is access-controlled, so
matching is by district name in `areaDesc` - stated in the reason codes and
the module docstring, never inferred further.
"""

from datetime import UTC, datetime
from pathlib import Path

from app.domain.route_risk import AVAILABLE, FACTOR_OFFICIAL_WARNINGS, NOT_AVAILABLE, assess
from app.domain.warnings import (
    LEVEL_ACTIVE,
    LEVEL_CLEAR,
    REASON_NO_OFFICIAL_WARNING_ON_ROUTE,
    REASON_OFFICIAL_WARNING_ON_ROUTE,
    REASON_OFFICIAL_WARNINGS_UNAVAILABLE,
    match_corridor,
    normalise,
    parse_cap,
    parse_rss,
)

FIX = Path(__file__).parent / "fixtures" / "sachet"
NOW = datetime(2026, 9, 12, 10, 0, tzinfo=UTC)


def test_rss_items_carry_identifier_author_and_message() -> None:
    items = parse_rss((FIX / "rss_india.xml").read_bytes())
    assert len(items) == 99
    river = next(i for i in items if i.identifier == "1789198330227010")
    assert "Hailakandi" in river.title
    assert river.author.endswith("(CWC)")
    assert river.link.endswith("FetchXMLFile?identifier=1789198330227010")


def test_cap_parses_the_english_info_block() -> None:
    w = parse_cap((FIX / "cap_1789198330227010.xml").read_bytes())
    assert w is not None
    assert (w.sender, w.event, w.severity, w.urgency) == ("Assam-SDMA", "Flood", "Moderate", "Future")
    assert w.area_desc == "Katakhal, Matizuri, Hailakandi, Assam"
    assert w.expires == datetime.fromisoformat("2026-09-13T00:00:00+05:30")
    assert w.headline.startswith("Due to continuous increase of water level")


def test_district_names_match_regardless_of_punctuation() -> None:
    assert normalise("Ri-Bhoi") == normalise("Ri Bhoi") == "ribhoi"
    assert normalise("East Khasi Hills") in normalise("Shillong, East Khasi Hills, Meghalaya")


def test_matching_is_by_district_and_expiry_and_says_when_nothing_matches() -> None:
    w = parse_cap((FIX / "cap_1789198330227010.xml").read_bytes())
    assert w is not None
    hit = match_corridor([w], districts={"Hailakandi"}, states={"Assam"}, now=NOW)
    assert hit.level == LEVEL_ACTIVE
    assert hit.on_route == (w,)
    assert hit.reason_codes == (REASON_OFFICIAL_WARNING_ON_ROUTE,)

    miss = match_corridor([w], districts={"Ri-Bhoi", "East Khasi Hills"}, states={"Meghalaya", "Assam"}, now=NOW)
    assert miss.level == LEVEL_CLEAR
    assert miss.on_route == ()
    assert miss.in_states == 1  # elsewhere in a corridor state, reported as context
    assert miss.reason_codes == (REASON_NO_OFFICIAL_WARNING_ON_ROUTE,)

    expired = match_corridor([w], districts={"Hailakandi"}, states={"Assam"}, now=datetime(2026, 9, 14, tzinfo=UTC))
    assert expired.level == LEVEL_CLEAR


def test_the_engine_scores_an_active_warning_and_reports_absence_honestly() -> None:
    w = parse_cap((FIX / "cap_1789198330227010.xml").read_bytes())
    assert w is not None
    active = match_corridor([w], districts={"Hailakandi"}, states={"Assam"}, now=NOW)
    risk = assess(distance_km=50.0, duration_min=60.0, warnings=active)
    assert risk.inputs[FACTOR_OFFICIAL_WARNINGS] == AVAILABLE
    assert any(c.code == "OFFICIAL_WARNING" and c.points == 10 for c in risk.components)
    assert REASON_OFFICIAL_WARNING_ON_ROUTE in risk.reason_codes

    none = assess(distance_km=50.0, duration_min=60.0)
    assert none.inputs[FACTOR_OFFICIAL_WARNINGS] == NOT_AVAILABLE
    assert REASON_OFFICIAL_WARNINGS_UNAVAILABLE in none.reason_codes
