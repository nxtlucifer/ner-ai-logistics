"""What the address provider does with Google's answers, and without a key.

WHAT THESE TESTS DO NOT PROVE

Nothing here touches Google. No key is configured on this machine, so the wire
format is taken from the published Places API (New) contract and the payloads
below are hand-built to that shape. These tests pin the MAPPING and the REFUSALS
- that a missing coordinate is an error rather than a zero, that an unconfigured
provider reports unavailable rather than empty. The first real call may still
find the request shape wrong, and that has to be said rather than implied by a
green suite.
"""

import pytest

from app.services import geocoding

# Shape from the Places API (New) autocomplete reference.
AUTOCOMPLETE_PAYLOAD = {
    "suggestions": [
        {
            "placePrediction": {
                "placeId": "ChIJ_place_one",
                "text": {"text": "Guwahati Railway Station, Assam"},
                "structuredFormat": {
                    "mainText": {"text": "Guwahati Railway Station"},
                    "secondaryText": {"text": "Paltan Bazaar, Guwahati, Assam"},
                },
            }
        },
        # A query prediction: a search string, not a place. It has no placeId
        # and therefore nothing to resolve.
        {"queryPrediction": {"text": {"text": "guwahati stations"}}},
        {
            "placePrediction": {
                "placeId": "ChIJ_place_two",
                "text": {"text": "Jorhat, Assam"},
                "structuredFormat": {"mainText": {"text": "Jorhat"}},
            }
        },
    ]
}

DETAILS_PAYLOAD = {
    "id": "ChIJ_place_one",
    "displayName": {"text": "Guwahati Railway Station"},
    "formattedAddress": "Paltan Bazaar, Guwahati, Assam 781008, India",
    "location": {"latitude": 26.1833, "longitude": 91.7539},
}


class TestParseSuggestions:
    def test_maps_place_predictions(self) -> None:
        found = geocoding.parse_suggestions(AUTOCOMPLETE_PAYLOAD)
        assert [s.place_id for s in found] == ["ChIJ_place_one", "ChIJ_place_two"]
        assert found[0].primary_text == "Guwahati Railway Station"
        assert found[0].secondary_text == "Paltan Bazaar, Guwahati, Assam"

    def test_drops_query_predictions(self) -> None:
        """A row that cannot produce a coordinate must not be offered."""
        found = geocoding.parse_suggestions(AUTOCOMPLETE_PAYLOAD)
        assert all("stations" not in s.primary_text for s in found)

    def test_falls_back_to_full_text_without_structured_format(self) -> None:
        payload = {
            "suggestions": [
                {
                    "placePrediction": {
                        "placeId": "x",
                        "text": {"text": "Somewhere, Assam"},
                    }
                }
            ]
        }
        found = geocoding.parse_suggestions(payload)
        assert found[0].primary_text == "Somewhere, Assam"
        assert found[0].secondary_text == ""

    def test_empty_payload_is_empty_list(self) -> None:
        assert geocoding.parse_suggestions({}) == []

    def test_skips_a_prediction_with_no_place_id(self) -> None:
        payload = {"suggestions": [{"placePrediction": {"text": {"text": "x"}}}]}
        assert geocoding.parse_suggestions(payload) == []


class TestParseDetail:
    def test_address_and_coordinate_arrive_together(self) -> None:
        detail = geocoding.parse_detail(DETAILS_PAYLOAD)
        assert detail.place_id == "ChIJ_place_one"
        assert detail.address.startswith("Paltan Bazaar")
        assert detail.lat == pytest.approx(26.1833)
        assert detail.lon == pytest.approx(91.7539)

    def test_missing_location_is_refused_not_zeroed(self) -> None:
        """A zero coordinate is the Gulf of Guinea, and it would plan."""
        payload = dict(DETAILS_PAYLOAD)
        payload.pop("location")
        with pytest.raises(geocoding.GeocodingUnavailable):
            geocoding.parse_detail(payload)

    def test_missing_address_is_refused(self) -> None:
        payload = {"id": "x", "location": {"latitude": 26.0, "longitude": 91.0}}
        with pytest.raises(geocoding.GeocodingUnavailable):
            geocoding.parse_detail(payload)

    def test_display_name_stands_in_for_a_missing_formatted_address(self) -> None:
        payload = dict(DETAILS_PAYLOAD)
        payload.pop("formattedAddress")
        assert geocoding.parse_detail(payload).address == "Guwahati Railway Station"


class TestUnconfigured:
    """The state this machine is actually in."""

    def test_available_is_false_without_a_key(self) -> None:
        assert geocoding.available() is False

    @pytest.mark.anyio
    async def test_autocomplete_refuses_rather_than_calling_google(self) -> None:
        with pytest.raises(geocoding.GeocodingUnavailable, match="not configured"):
            await geocoding.autocomplete("guwahati", "session-token-1234")

    @pytest.mark.anyio
    async def test_details_refuses_rather_than_calling_google(self) -> None:
        with pytest.raises(geocoding.GeocodingUnavailable, match="not configured"):
            await geocoding.details("ChIJ_x", "session-token-1234")


def test_only_the_fields_that_are_drawn_are_requested() -> None:
    """The field mask is the retention boundary, so it is pinned.

    Widening it is a policy decision about what may be stored, not a detail -
    so it has to fail a test and be argued for, rather than being widened by
    someone adding a field they wanted once.
    """
    assert geocoding.DETAILS_FIELD_MASK == "id,displayName,formattedAddress,location"


class TestApiRefusals:
    """The endpoint's own behaviour when the provider is not there.

    The first version of `/details` let `GeocodingUnavailable` escape the route
    and FastAPI turned it into a 500 "An unexpected error occurred" - observed
    against the running server, not theorised. A missing API key is a
    configuration state with a name, and the client renders a different thing
    for it than for a crash.
    """

    @pytest.mark.anyio
    async def test_details_is_503_with_a_code_not_500(self, client) -> None:
        from app.api.geocoding import resolve

        # Called directly: the route's refusal is the unit under test, and
        # standing up an authenticated client would test the auth stack again.
        with pytest.raises(Exception) as caught:
            await resolve(actor=None, place_id="x", session_token="abcdefgh")
        error = caught.value
        assert getattr(error, "status_code", None) == 503
        assert getattr(error, "code", None) == "GEOCODING_UNAVAILABLE"
