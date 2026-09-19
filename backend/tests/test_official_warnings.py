"""NDMA SACHET (CAP) alerts, matched to a corridor by the districts it crosses.

Fixtures are the public RSS feed and one linked CAP file as fetched on
2026-09-12. The polygon endpoint the CAP references is access-controlled, so
matching is by district name in `areaDesc` - stated in the reason codes and
the module docstring, never inferred further.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.domain.route_risk import AVAILABLE, FACTOR_OFFICIAL_WARNINGS, NOT_AVAILABLE, assess
from app.domain.warnings import (
    LEVEL_ACTIVE,
    LEVEL_CLEAR,
    REASON_NO_OFFICIAL_WARNING_ON_ROUTE,
    REASON_OFFICIAL_WARNING_ON_ROUTE,
    REASON_OFFICIAL_WARNINGS_UNAVAILABLE,
    OfficialWarning,
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


# The Guwahati->Shillong corridor as the recommendation reported it
# (manager lane D2, step4d-official-warning-evidence.json).
GUWAHATI_SHILLONG = {"East Khasi Hills", "Guwahati", "Kamrup Metropolitan", "Mylliem", "Ri-Bhoi", "Umling", "Umsning"}
UPPER_ASSAM = (
    "has issued forecast for Thunderstorm with Lightning along with light to moderate rain which is very likely "
    "to occur at a few places over Charaideo, Dhemaji, Dibrugarh, Karbi Anglong, Lakhimpur, Sivasagar and "
    "Tinsukia in next 1-3 hours. Issued in Public Interest by ASDMA."
)


def _alert(headline: str, area_desc: str = "7 districts of Assam") -> OfficialWarning:
    return OfficialWarning(
        identifier="IN-test", sender="Assam-SDMA", sent=None, expires=None, event="Thunderstorm with Lightning",
        severity="Moderate", urgency="Expected", headline=headline, area_desc=area_desc, language="en-IN",
    )


@pytest.mark.parametrize(
    "issuer",
    [
        "IMD Guwahati", "RMC Guwahati", "Regional Meteorological Centre, Guwahati", "Meteorological Centre Guwahati",
        "RMC, Guwahati", "IMD-Guwahati", "Regional Meteorological Centre (RMC) Guwahati",
        "India Meteorological Department, Guwahati",
    ],
)
def test_the_issuing_office_is_not_the_warned_area(issuer: str) -> None:
    """D2: 'IMD Guwahati has issued ... over Charaideo ... Tinsukia' put an
    Upper Assam nowcast on a Guwahati->Shillong corridor, because the issuer's
    city is a corridor district. It is who wrote it, not where it applies."""
    got = match_corridor([_alert(f"{issuer} {UPPER_ASSAM}")], districts=GUWAHATI_SHILLONG,
                         states={"Assam", "Meghalaya"}, now=NOW)
    assert got.level == LEVEL_CLEAR
    assert got.on_route == ()
    assert got.in_states == 1  # still reported: elsewhere in a corridor state


def test_the_real_feed_imd_guwahati_nowcast_matches_its_districts_not_the_issuer() -> None:
    item = next(i for i in parse_rss((FIX / "rss_india.xml").read_bytes()) if i.identifier == "1789187103272010")
    assert item.title.startswith("IMD Guwahati has issued")
    w = _alert(item.title, area_desc="2 districts of Assam")
    assert match_corridor([w], districts=GUWAHATI_SHILLONG, states={"Assam"}, now=NOW).level == LEVEL_CLEAR
    assert match_corridor([w], districts={"Darrang"}, states={"Assam"}, now=NOW).on_route == (w,)


@pytest.mark.parametrize(
    ("headline", "area_desc"),
    [
        # Guwahati named as the area, by IMD Guwahati itself.
        ("IMD Guwahati has issued forecast for heavy rain over Kamrup Metropolitan, Guwahati and Nalbari.", "3 districts of Assam"),
        ("IMD Guwahati has issued forecast for heavy rain in next 3 hours.", "Guwahati, Assam"),
        ("RMC Guwahati: heavy rain very likely over Guwahati city in next 2 hours.", "1 district of Assam"),
        ("Heavy rain very likely over Guwahati in next 2 hours.", "1 district of Assam"),
    ],
)
def test_guwahati_as_the_warned_area_still_matches(headline: str, area_desc: str) -> None:
    w = _alert(headline, area_desc)
    got = match_corridor([w], districts={"Guwahati"}, states={"Assam"}, now=NOW)
    assert got.level == LEVEL_ACTIVE and got.on_route == (w,)


def test_kamrup_metropolitan_in_the_area_matches_whoever_issued_it() -> None:
    w = _alert(f"IMD Guwahati {UPPER_ASSAM}", area_desc="Kamrup Metropolitan, Assam")
    assert match_corridor([w], districts=GUWAHATI_SHILLONG, states={"Assam"}, now=NOW).on_route == (w,)


@pytest.mark.parametrize(
    ("headline", "district"),
    [
        # Not an office city: 'IMD Kamrup Metropolitan nowcast' is a nowcast FOR it.
        ("IMD Kamrup Metropolitan nowcast: heavy rain in next 3 hours.", "Kamrup Metropolitan"),
        # The office city, but followed by a forecast, not by an issuing word.
        # Read as the area: an ambiguous headline keeps the hazard (P2-R1).
        ("As per IMD Guwahati will receive heavy rain in next 3 hours.", "Guwahati"),
        ("As per IMD, Guwahati will receive heavy rain in next 3 hours.", "Guwahati"),
        # A line break ends the issuer: the next line is the area.
        ("Warning issued by IMD\nGuwahati city: heavy rain in next 3 hours.", "Guwahati"),
        ("Heavy rain warning from IMD\nGuwahati issues advisory for low-lying areas.", "Guwahati"),
        # Not an office city, though an issuing word follows: only the office
        # list keeps it (P2-R1b).
        ("IMD Nalbari issued nowcast: heavy rain in next 3 hours.", "Nalbari"),
    ],
)
def test_a_district_right_after_the_issuer_token_is_not_lost(headline: str, district: str) -> None:
    """P2-R1. Only an office city directly followed by an issuing word, on
    the same line, is read as the issuer."""
    w = _alert(headline, area_desc="1 district of Assam")
    assert match_corridor([w], districts={district}, states={"Assam"}, now=NOW).on_route == (w,)
