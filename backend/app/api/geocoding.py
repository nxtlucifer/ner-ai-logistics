"""Address lookup for the trip planner.

Gated on `trip:create`, because that is the only thing this is for. Address
search is a billed external call, and an endpoint that any signed-in account
could drive is a way to spend the owner's Google quota from a driver's phone.

`available` is part of the contract rather than something the client infers from
an error. A UI that decides "search is broken" from a failed request cannot tell
"no key configured" from "the network dropped", and those need different words
on screen: one is a setup step, the other is retry.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status as http_status

from app.core.errors import APIError

from app.api.deps import require_permission
from app.core import permissions as perm
from app.models.identity import User
from app.schemas.common import ReadModel
from app.services import geocoding

router = APIRouter(prefix="/api/geocoding", tags=["geocoding"])


class SuggestionRead(ReadModel):
    place_id: str
    primary_text: str
    secondary_text: str


class SuggestionsRead(ReadModel):
    #: False when no provider is configured. The list is then always empty, and
    #: the client says so rather than showing "no results", which would imply
    #: somebody looked.
    available: bool
    provider: str | None
    suggestions: list[SuggestionRead]
    #: Present when a configured provider refused. Null when simply absent.
    error: str | None = None


class PlaceDetailRead(ReadModel):
    place_id: str
    address: str
    lat: float
    lon: float
    #: Google requires its results be attributed where they are displayed.
    attribution: str


GOOGLE_ATTRIBUTION = "Powered by Google"


@router.get(
    "/suggest", response_model=SuggestionsRead, summary="Address suggestions"
)
async def suggest(
    actor: Annotated[User, Depends(require_permission(perm.TRIP_CREATE))],
    q: Annotated[str, Query(min_length=3, max_length=200)],
    session_token: Annotated[str, Query(min_length=8, max_length=64)],
) -> SuggestionsRead:
    """Suggestions for a partial address, or an honest empty.

    `min_length=3` is a cost bound as much as a usability one: one character
    matches most of India and bills for the privilege.
    """
    if not geocoding.available():
        return SuggestionsRead(available=False, provider=None, suggestions=[])

    try:
        found = await geocoding.autocomplete(q, session_token)
    except geocoding.GeocodingUnavailable as exc:
        # Configured but refusing - quota, a disabled API, a bad key. That is a
        # different state from unconfigured and the manager needs to know a
        # retry might work.
        return SuggestionsRead(
            available=True,
            provider="GOOGLE_PLACES",
            suggestions=[],
            error=str(exc),
        )

    return SuggestionsRead(
        available=True,
        provider="GOOGLE_PLACES",
        suggestions=[
            SuggestionRead(
                place_id=s.place_id,
                primary_text=s.primary_text,
                secondary_text=s.secondary_text,
            )
            for s in found
        ],
    )


@router.get(
    "/details", response_model=PlaceDetailRead, summary="Resolve one suggestion"
)
async def resolve(
    actor: Annotated[User, Depends(require_permission(perm.TRIP_CREATE))],
    place_id: Annotated[str, Query(min_length=1, max_length=512)],
    session_token: Annotated[str, Query(min_length=8, max_length=64)],
) -> PlaceDetailRead:
    """The address and the coordinate of one suggestion, together.

    A provider that is absent or refusing is a 503 with a code the client can
    act on, NOT a 500. The first version let `GeocodingUnavailable` escape and
    became "An unexpected error occurred" - which tells a manager nothing and
    reads like a crash, when the actual situation is a missing API key.
    """
    try:
        detail = await geocoding.details(place_id, session_token)
    except geocoding.GeocodingUnavailable as exc:
        raise APIError(
            "Address lookup is unavailable.",
            code="GEOCODING_UNAVAILABLE",
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
        ) from exc
    return PlaceDetailRead(
        place_id=detail.place_id,
        address=detail.address,
        lat=detail.lat,
        lon=detail.lon,
        attribution=GOOGLE_ATTRIBUTION,
    )
