"""Pasted Google Maps links: what is parsed, what is refused, what is fetched."""

import httpx
import pytest

from app.services import geocoding, maplink

FULL = "https://www.google.com/maps/place/Kaziranga+National+Park/@26.5775,93.1711,12z/data=!3m1!4b1"
Q = "https://maps.google.com/?q=26.1445,91.7362+(Guwahati+Depot)"
BANG = "https://www.google.com/maps/place/Tezpur/data=!4m5!3m4!1s0x0:0x0!8m2!3d26.6528!4d92.7926"


class TestParse:
    def test_place_url_with_at_coordinates(self) -> None:
        coord, label = maplink.parse_url(FULL)
        assert coord == (26.5775, 93.1711)
        assert label == "Kaziranga National Park"

    def test_query_coordinates_with_a_label(self) -> None:
        coord, label = maplink.parse_url(Q)
        assert coord == (26.1445, 91.7362)
        assert label == "Guwahati Depot"

    def test_bang_encoded_coordinates(self) -> None:
        coord, label = maplink.parse_url(BANG)
        assert coord == (26.6528, 92.7926)
        assert label == "Tezpur"

    def test_text_only_place_has_no_coordinate(self) -> None:
        coord, label = maplink.parse_url("https://www.google.com/maps/place/Dimapur+Railway+Station")
        assert coord is None
        assert label == "Dimapur Railway Station"

    def test_out_of_range_numbers_are_not_a_coordinate(self) -> None:
        coord, _ = maplink.parse_url("https://maps.google.com/?q=126.1,91.7")
        assert coord is None


class TestRefusals:
    @pytest.mark.anyio
    async def test_non_google_url_is_refused_without_a_request(self) -> None:
        with pytest.raises(maplink.NotAMapsLink):
            await maplink.resolve("https://example.com/maps/@26.1,91.7,12z")

    @pytest.mark.anyio
    async def test_invalid_url_is_refused(self) -> None:
        with pytest.raises(maplink.NotAMapsLink):
            await maplink.resolve("not a link at all")

    @pytest.mark.anyio
    async def test_private_target_is_refused(self) -> None:
        with pytest.raises(maplink.NotAMapsLink):
            await maplink.resolve("http://169.254.169.254/latest/meta-data")


class TestResolve:
    @pytest.mark.anyio
    async def test_direct_coordinates_need_no_request(self) -> None:
        found = await maplink.resolve(FULL)
        assert (found.lat, found.lon, found.via) == (26.5775, 93.1711, "DIRECT_PARSE")

    @pytest.mark.anyio
    async def test_short_link_follows_google_redirects_by_header_only(self, monkeypatch) -> None:
        hops = []

        def handler(request: httpx.Request) -> httpx.Response:
            hops.append(str(request.url))
            if request.url.host == "maps.app.goo.gl":
                return httpx.Response(302, headers={"location": "https://www.google.com/maps/place/Shillong/@25.5788,91.8933,13z"})
            return httpx.Response(200, text="<html>never read</html>")

        real = httpx.AsyncClient
        monkeypatch.setattr(maplink.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
        found = await maplink.resolve("https://maps.app.goo.gl/AbCdEf123")
        assert hops == ["https://maps.app.goo.gl/AbCdEf123"]
        assert (round(found.lat, 4), round(found.lon, 4), found.via, found.label) == (25.5788, 91.8933, "REDIRECT_PARSE", "Shillong")

    @pytest.mark.anyio
    async def test_redirect_off_google_is_not_followed(self, monkeypatch) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "https://evil.example/steal"})

        real = httpx.AsyncClient
        monkeypatch.setattr(maplink.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
        with pytest.raises(maplink.NotAMapsLink):
            await maplink.resolve("https://maps.app.goo.gl/xyz")

    @pytest.mark.anyio
    async def test_text_only_place_goes_to_our_geocoder(self, monkeypatch) -> None:
        async def fake(query, *, limit=6):
            assert query == "Dimapur Railway Station"
            return [geocoding.PlaceDetail(place_id="osm:25.9,93.7", address="Dimapur Railway Station, Nagaland, India", lat=25.9, lon=93.7)]

        monkeypatch.setattr(geocoding, "nominatim_search", fake)
        found = await maplink.resolve("https://www.google.com/maps/place/Dimapur+Railway+Station")
        assert (found.lat, found.lon, found.via) == (25.9, 93.7, "GEOCODED")

    @pytest.mark.anyio
    async def test_nothing_to_place_is_said_so(self) -> None:
        with pytest.raises(maplink.NoLocationInLink):
            await maplink.resolve("https://www.google.com/maps")
