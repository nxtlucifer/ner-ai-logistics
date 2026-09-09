"""Landslide provider and incident-model invariants.

The assertions that matter here are all about REFUSING to collapse distinct
facts: no-source vs looked-and-found-nothing, missing coordinate vs 0.0,
reporting volume vs event count, and hazard vs road quality. Each of those
collapses is easy to write, produces working code, and ends with a dispatcher
being told a road is fine.

No network, no database, no fixtures pretending to be production data.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.domain.landslide import (
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
    VerificationStatus,
    promote,
)
from app.services.landslide.base import (
    BoundingBox,
    LandslideQueryError,
    NullLandslideProvider,
    build_provider,
)

NOW = datetime(2026, 9, 5, tzinfo=timezone.utc)
GUWAHATI_BOX = BoundingBox(min_lat=25.9, min_lon=91.5, max_lat=26.4, max_lon=92.0)


def source(name: str, kind: SourceType = SourceType.NEWS) -> IncidentSource:
    return IncidentSource(name=name, source_type=kind)


class TestNoSourceIsNotNoIncidents:
    """The distinction the whole design turns on."""

    @pytest.mark.asyncio
    async def test_null_provider_reports_not_configured_not_empty_success(self):
        result = await NullLandslideProvider().incidents_near(
            GUWAHATI_BOX, since=NOW - timedelta(days=365), until=NOW
        )
        assert result.state is SourceState.NOT_CONFIGURED
        assert result.incidents == ()
        # The load-bearing assertion. An empty tuple ALONE would be read as
        # "this corridor has no recorded landslides", which is a claim about a
        # road we have never looked at.
        assert result.usable is False

    def test_an_empty_answer_from_a_real_source_is_usable(self):
        looked = IncidentQueryResult(state=SourceState.AVAILABLE, provider="x")
        assert looked.incidents == ()
        assert looked.usable is True

    def test_a_provider_outage_is_not_an_empty_answer(self):
        down = IncidentQueryResult(
            state=SourceState.UNAVAILABLE, provider="x", error="timeout"
        )
        assert down.usable is False

    def test_the_configured_provider_is_the_null_one_today(self):
        # No landslide source is connected. If this ever fails, a real
        # provider was wired in and the docs must stop saying NEEDS_LIVE_DATA.
        assert build_provider().name == "none"


class TestQueriesAreBounded:
    def test_rejects_an_unbounded_box(self):
        with pytest.raises(LandslideQueryError, match="exceeds"):
            BoundingBox(min_lat=-90, min_lon=-180, max_lat=90, max_lon=180)

    def test_rejects_an_inverted_box(self):
        with pytest.raises(LandslideQueryError, match="inverted"):
            BoundingBox(min_lat=27.0, min_lon=92.0, max_lat=26.0, max_lon=91.0)

    def test_rejects_coordinates_off_the_planet(self):
        with pytest.raises(LandslideQueryError):
            BoundingBox(min_lat=0, min_lon=0, max_lat=200, max_lon=1)

    @pytest.mark.asyncio
    async def test_rejects_a_backwards_time_window_even_with_no_source(self):
        # A broken query must be found now, not on the day a real provider is
        # connected and the same call quietly returns everything.
        with pytest.raises(LandslideQueryError, match="ends before"):
            await NullLandslideProvider().incidents_near(
                GUWAHATI_BOX, since=NOW, until=NOW - timedelta(days=1)
            )


class TestNothingIsManufactured:
    def test_a_missing_coordinate_is_none_and_never_zero(self):
        incident = LandslideIncident(incident_id="i1", location_name="NH-6 near Sonapur")
        assert incident.latitude is None
        assert incident.is_locatable is False
        # 0.0 is a real place in the Gulf of Guinea. An incident defaulting
        # there would be mapped onto a road nobody named.
        assert incident.latitude != 0.0

    def test_an_unlocatable_incident_is_still_kept(self):
        # It is real evidence about a corridor even though it cannot be
        # plotted. Dropping it would understate recurrence, which is the one
        # direction this system must not fail in.
        incident = LandslideIncident(incident_id="i1", highway_code="NH-6")
        assert incident.incident_id == "i1"
        assert incident.is_locatable is False

    def test_unreported_facts_are_none_not_false_or_zero(self):
        incident = LandslideIncident(incident_id="i1")
        assert incident.road_blocked is None
        assert incident.fatalities is None
        assert incident.restoration_reported is None


class TestRoadQualityIsNeverInferred:
    def test_repeated_landslides_alone_prove_nothing_about_construction(self):
        # The user wants to know whether a corridor is badly built. A landslide
        # is evidence about a SLOPE. Concluding "bad construction" needs
        # engineering data no source here publishes.
        incident = LandslideIncident(incident_id="i1", road_blocked=True)
        assert incident.quality_evidence == "INSUFFICIENT"

    def test_quality_evidence_appears_only_when_work_was_reported(self):
        repaired = LandslideIncident(incident_id="i1", restoration_reported=True)
        stabilised = LandslideIncident(
            incident_id="i2", slope_stabilization_reported=True
        )
        assert repaired.quality_evidence == "REPORTED"
        assert stabilised.quality_evidence == "REPORTED"


class TestVerificationCannotBeBoughtWithVolume:
    def test_an_official_agency_alone_is_official(self):
        assert (
            promote((source("ASDMA", SourceType.OFFICIAL_AGENCY),))
            is VerificationStatus.OFFICIAL
        )

    def test_two_independent_sources_corroborate(self):
        assert (
            promote((source("The Assam Tribune"), source("EastMojo")))
            is VerificationStatus.CORROBORATED
        )

    def test_one_source_stays_unverified(self):
        assert promote((source("EastMojo"),)) is VerificationStatus.UNVERIFIED

    def test_syndicated_copies_of_one_story_do_not_corroborate(self):
        # THE assertion of this class. Three articles from one outlet is
        # reporting volume, which tracks how interesting an event was, not how
        # real it was. Letting it reach CORROBORATED turns a press cycle into
        # confidence.
        assert (
            promote((source("EastMojo"), source("eastmojo"), source(" EastMojo ")))
            is VerificationStatus.UNVERIFIED
        )

    def test_blank_source_names_do_not_count_as_independent(self):
        assert promote((source(""), source("   "))) is VerificationStatus.UNVERIFIED

    def test_reporting_volume_is_not_an_event_count(self):
        # One landslide reported by four outlets is ONE incident. If sources
        # ever became the event count, a well-covered slide would look like a
        # repeatedly failing corridor.
        incident = LandslideIncident(
            incident_id="i1",
            sources=tuple(source(f"outlet-{i}") for i in range(4)),
        )
        assert len(incident.sources) == 4
        # The incident is still exactly one event.
        assert incident.incident_id == "i1"
