"""Address search for trip planning, behind the server.

WHY THE KEY IS NOT IN THE BROWSER

Google's Places API (New) accepts a browser request, and the usual answer is an
HTTP-referrer-restricted key shipped in the bundle. This project already refuses
that shape for Supabase (`AGENTS.md`: clients never hold a credential), and a
referrer restriction is a request header - it bounds casual copying, not
extraction. So the key lives in `backend/.env`, the browser calls this service,
and the browser never sees a Google credential.

STATUS: WRITTEN, NEVER EXECUTED AGAINST GOOGLE.

No `GOOGLE_PLACES_API_KEY` has been configured on this machine, so the request
shape below is built from the published contract and the transport has never
made a real call. `available()` is false and every caller renders the
unavailable state. The parsing is tested against recorded-shape payloads, which
proves the mapping and nothing about the wire.

Contract used (Places API (New), `places.googleapis.com`):
  POST /v1/places:autocomplete   body {input, sessionToken, locationBias}
  GET  /v1/places/{place_id}     header X-Goog-FieldMask

Field masks are REQUIRED on the new API and are also what bounds the bill, so
they are the minimum this feature uses: a display name, a formatted address and
a location. Nothing else is requested, which is also the answer to "what may be
retained" - the fields never fetched cannot be stored by accident.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)

#: Places API (New). The legacy `maps.googleapis.com/maps/api/place` endpoints
#: are a different product with different policies; this is the current one.
BASE_URL = "https://places.googleapis.com/v1"

#: Only what is drawn. Every extra field is money and a retention question.
DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location"

#: A bias, not a filter: the demo corridor is the NER, but a manager planning a
#: run to Kolkata must still be able to find it.
NER_BIAS = {
    "rectangle": {
        "low": {"latitude": 22.0, "longitude": 87.0},
        "high": {"latitude": 29.5, "longitude": 97.5},
    }
}


@dataclass(frozen=True, slots=True)
class Suggestion:
    """One autocomplete row. `place_id` is the only thing that resolves."""

    place_id: str
    primary_text: str
    secondary_text: str


@dataclass(frozen=True, slots=True)
class PlaceDetail:
    """A resolved endpoint: the address and the coordinate, together.

    Together on purpose. The defect this whole feature replaces was an address
    typed in one box and a coordinate typed in another, with nothing keeping
    them describing the same place.
    """

    place_id: str
    address: str
    lat: float
    lon: float


class GeocodingUnavailable(RuntimeError):
    """No provider configured, or the provider refused. Never a fake result."""


def available() -> bool:
    return bool(get_settings().GOOGLE_PLACES_API_KEY)


async def autocomplete(query: str, session_token: str) -> list[Suggestion]:
    """Suggestions for a partial address.

    `session_token` is passed straight through. Google bills an autocomplete
    session as one unit when the token ties the keystrokes to the details call
    that ends them, and as separate requests when it does not - so the token is
    a cost decision, not decoration, and the client owns its lifetime because
    only the client knows when the user stopped typing.
    """
    settings = get_settings()
    key = settings.GOOGLE_PLACES_API_KEY
    if not key:
        raise GeocodingUnavailable("GOOGLE_PLACES_API_KEY is not configured")

    body = {
        "input": query,
        "sessionToken": session_token,
        "locationBias": NER_BIAS,
        "includeQueryPredictions": False,
    }
    try:
        async with httpx.AsyncClient(timeout=settings.GEOCODING_TIMEOUT_SECONDS) as c:
            response = await c.post(
                f"{BASE_URL}/places:autocomplete",
                json=body,
                headers={"X-Goog-Api-Key": key, "Content-Type": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise GeocodingUnavailable(
            f"places autocomplete transport failed: {exc}"
        ) from exc

    if response.status_code != 200:
        # The body carries Google's own reason - a disabled API, a referrer
        # restriction, an exhausted quota. Logged, never shown: it can name the
        # project. The caller gets "unavailable".
        log.warning(
            "places autocomplete refused: %s %s",
            response.status_code,
            response.text[:400],
        )
        raise GeocodingUnavailable(
            f"places autocomplete returned {response.status_code}"
        )

    return parse_suggestions(response.json())


def parse_suggestions(payload: dict) -> list[Suggestion]:
    """Map Google's response, skipping anything that cannot be resolved.

    Query predictions (a search string rather than a place) carry no
    `placePrediction` and are dropped: selecting one could not produce a
    coordinate, and a row that does nothing when clicked is worse than no row.
    """
    out: list[Suggestion] = []
    for item in payload.get("suggestions", []):
        prediction = item.get("placePrediction")
        if not prediction:
            continue
        place_id = prediction.get("placeId")
        if not place_id:
            continue
        fmt = prediction.get("structuredFormat") or {}
        primary = (fmt.get("mainText") or {}).get("text") or (
            prediction.get("text") or {}
        ).get("text", "")
        secondary = (fmt.get("secondaryText") or {}).get("text", "")
        if not primary:
            continue
        out.append(
            Suggestion(
                place_id=place_id, primary_text=primary, secondary_text=secondary
            )
        )
    return out


async def details(place_id: str, session_token: str) -> PlaceDetail:
    """Resolve one suggestion to an address AND a coordinate."""
    settings = get_settings()
    key = settings.GOOGLE_PLACES_API_KEY
    if not key:
        raise GeocodingUnavailable("GOOGLE_PLACES_API_KEY is not configured")

    try:
        async with httpx.AsyncClient(timeout=settings.GEOCODING_TIMEOUT_SECONDS) as c:
            response = await c.get(
                f"{BASE_URL}/places/{place_id}",
                params={"sessionToken": session_token},
                headers={
                    "X-Goog-Api-Key": key,
                    "X-Goog-FieldMask": DETAILS_FIELD_MASK,
                },
            )
    except httpx.HTTPError as exc:
        raise GeocodingUnavailable(f"place details transport failed: {exc}") from exc

    if response.status_code != 200:
        log.warning(
            "place details refused: %s %s", response.status_code, response.text[:400]
        )
        raise GeocodingUnavailable(f"place details returned {response.status_code}")

    return parse_detail(response.json())


def parse_detail(payload: dict) -> PlaceDetail:
    """Map one place, refusing a result that has no usable coordinate.

    A place with an address and no location cannot be planned against, and
    filling in a zero or the region centre would be inventing an endpoint.
    """
    location = payload.get("location") or {}
    lat = location.get("latitude")
    lon = location.get("longitude")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        raise GeocodingUnavailable("place details carried no location")

    address = payload.get("formattedAddress") or (payload.get("displayName") or {}).get(
        "text"
    )
    if not address:
        raise GeocodingUnavailable("place details carried no address")

    return PlaceDetail(
        place_id=payload.get("id", ""),
        address=address,
        lat=float(lat),
        lon=float(lon),
    )
