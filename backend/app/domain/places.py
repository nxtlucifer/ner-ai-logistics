"""Roadside services: what one is, and what a lookup could and could not say.

WHAT THIS IS NOT

It is not a directory of businesses, and every type here is shaped to stop it
being read as one. OpenStreetMap records that somebody mapped a building and
tagged it; it does not record that the tyre shop is open, that the hospital has
a staffed emergency department, or that a lay-by is legal for a 12-tonne truck.
The corridor snapshot behind this module has 720 places, of which 43 carry a
phone number and 19 carry opening hours. The other 677 have no contact and no
hours, and the only honest thing to render for them is "not provided".

So `Place` has no `is_open`, no `rating`, no `has_truck_parking` and no
`phone: str` that defaults to empty. Absent facts are `None`, and the UI is
required to say so.

THE THREE-STATE RESULT

`PlaceQueryResult.state` mirrors the pattern `app/domain/landslide.py`
established for exactly the same reason, deliberately rather than by accident:
an empty list means nothing until you know whether anybody looked. A separate
enum is defined here rather than imported so that this bounded context does not
depend on the landslide subsystem; both are three fixed values that will not
drift.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Final


class PlaceCategory(str, Enum):
    """The four service kinds the driver map offers.

    Deliberately coarse. A finer taxonomy would imply the data supports
    distinctions it does not - `shop=car_repair` does not tell you whether they
    fix punctures, which is why TYRES is named for what the driver is looking
    for rather than for a tag.
    """

    #: Hospitals, police and fire stations as MAPPED. Presence of a hospital
    #: does not establish a staffed emergency department.
    EMERGENCY = "EMERGENCY"
    #: `shop=tyres` and `shop=car_repair`. A tyre retailer may not repair a
    #: puncture, and a car mechanic may not handle a truck tyre.
    TYRES = "TYRES"
    #: Hotels, motels and guest houses. Says nothing about rooms or price.
    HOTEL = "HOTEL"
    #: Rest areas, services and lay-bys. NOT a claim that stopping is legal or
    #: safe for a heavy vehicle.
    REST = "REST"


class PlacesSourceState(str, Enum):
    """Whether the places provider could answer at all."""

    #: No provider configured. Nothing was asked, so nothing is known.
    NOT_CONFIGURED = "NOT_CONFIGURED"
    #: A provider answered. The result is complete for the query - possibly
    #: empty, which is a real finding about what is MAPPED.
    AVAILABLE = "AVAILABLE"
    #: A provider exists but failed. Distinct from an empty answer, because a
    #: failure tells you nothing about the road.
    UNAVAILABLE = "UNAVAILABLE"
    #: The query was outside the snapshot's coverage. Nothing was searched, so
    #: "no results" would be a lie about the area rather than a fact about it.
    OUTSIDE_COVERAGE = "OUTSIDE_COVERAGE"


class SearchAnchor(str, Enum):
    """What the search was centred on, so the UI can say so out loud.

    With GPS denied there is no driver position, and the anchor must not be
    silently faked. `TRIP_ORIGIN` and `MAP_AREA` are honest substitutes; the UI
    labels which one produced the results on screen.
    """

    #: A real GPS fix from the device.
    DRIVER_POSITION = "DRIVER_POSITION"
    #: Along the authorised route corridor.
    ROUTE_CORRIDOR = "ROUTE_CORRIDOR"
    #: The trip's first stop, used when there is no fix.
    TRIP_ORIGIN = "TRIP_ORIGIN"
    #: An area the driver panned the map to and searched explicitly.
    MAP_AREA = "MAP_AREA"


#: Widest box a single query may cover, in degrees. A corridor is tens of
#: kilometres; anything larger is a caller that meant to page instead. Mirrors
#: the landslide subsystem's bound for the same reason.
MAX_BBOX_DEGREES: Final[float] = 5.0

#: Hard cap on returned records, whatever the caller asks for. A driver cannot
#: read 400 pins and a phone should not render them.
MAX_RESULTS: Final[int] = 60


class PlaceQueryError(ValueError):
    """A query this layer refuses to send, rather than a provider failure."""


@dataclass(frozen=True)
class BoundingBox:
    """A spatial bound, validated on construction.

    Validated here rather than at each provider so a new provider cannot
    forget. An unbounded or inverted box reaches a data source as a request for
    everything, and the first symptom is a timeout under load.
    """

    min_lat: float
    min_lon: float
    max_lat: float
    max_lon: float

    def __post_init__(self) -> None:
        if self.min_lat > self.max_lat or self.min_lon > self.max_lon:
            raise PlaceQueryError("Bounding box is inverted.")
        if not (-90 <= self.min_lat <= 90 and -90 <= self.max_lat <= 90):
            raise PlaceQueryError("Latitude out of range.")
        if not (-180 <= self.min_lon <= 180 and -180 <= self.max_lon <= 180):
            raise PlaceQueryError("Longitude out of range.")
        if (
            self.max_lat - self.min_lat > MAX_BBOX_DEGREES
            or self.max_lon - self.min_lon > MAX_BBOX_DEGREES
        ):
            raise PlaceQueryError(
                f"Bounding box exceeds {MAX_BBOX_DEGREES} degrees; page instead."
            )

    def contains(self, lat: float, lon: float) -> bool:
        return (
            self.min_lat <= lat <= self.max_lat
            and self.min_lon <= lon <= self.max_lon
        )


@dataclass(frozen=True)
class PlaceContact:
    """Contact facts, each independently absent.

    `phone` is None far more often than not in this dataset. A card that
    rendered an empty string would look like a place with no phone rather than
    a place whose phone nobody has recorded, and only the second is true.
    """

    phone: str | None = None
    opening_hours: str | None = None
    operator: str | None = None


@dataclass(frozen=True)
class PlaceAccess:
    """Access facts as MAPPED, never inferred.

    `hgv` is the OSM value where present - it is not a truck-suitability
    verdict, and nothing in this system computes one. A lay-by with no `hgv`
    tag is unknown, not permitted.
    """

    hgv: str | None = None
    max_height: str | None = None
    access: str | None = None
    fee: str | None = None
    toilets: str | None = None
    lit: str | None = None


@dataclass(frozen=True)
class Place:
    """One mapped location, with its provenance attached.

    `provider_id` is stable (`osm:node/123`) so a selection survives a refetch
    and a test can pin a specific record.

    `distance_m` is STRAIGHT-LINE and is named nowhere as a travel distance.
    Road distance requires a routing call this lookup does not make, and a
    business across a river can be 200 m away and 20 km to reach.
    """

    provider_id: str
    category: PlaceCategory
    lat: float
    lon: float
    #: None for the 32 unnamed records. Rendered as the category, never blank.
    name: str | None = None
    contact: PlaceContact = field(default_factory=PlaceContact)
    access: PlaceAccess = field(default_factory=PlaceAccess)
    #: The raw tags that earned the category, so a reviewer can check the
    #: mapping rather than trust it.
    osm_tags: dict[str, str] = field(default_factory=dict)
    #: Approximate straight-line metres from the search anchor. Never a
    #: driving distance and never rendered as one.
    straight_line_m: float | None = None
    #: EVERY source element this record was built from, `provider_id` first.
    #:
    #: A merge must not destroy provenance. When two OSM elements are judged
    #: to be one place, both ids stay here so the judgement can be checked
    #: against the source data rather than taken on trust.
    provider_ids: tuple[str, ...] = field(default_factory=tuple)
    #: Fields where the merged elements disagreed, as {field: (values...)}.
    #:
    #: Kept rather than resolved. Two different phone numbers on one building
    #: may be two departments, or may be evidence that these are not the same
    #: place at all - and silently picking one would hide both possibilities.
    #: The UI shows the chosen value and marks it as disputed.
    conflicts: dict[str, tuple[str, ...]] = field(default_factory=dict)

    @property
    def is_merged(self) -> bool:
        """True when this record stands for more than one mapped element.

        Read as "these are LIKELY the same place", never as certainty. The
        rule is a name-and-distance heuristic over volunteer-mapped data, and
        two neighbouring businesses can share a name.
        """
        return len(self.provider_ids) > 1


@dataclass(frozen=True)
class PlaceSource:
    """Where the data came from and how old it is.

    Travels with every response. `retrieved_at` is when WE fetched the
    snapshot, which is not a freshness guarantee about any business in it -
    a shop mapped in 2019 and fetched today is a 2019 fact fetched today.
    """

    name: str
    attribution: str
    licence: str
    retrieved_at: datetime
    coverage_description: str
    #: Stated limits, shown in the UI rather than buried here.
    limits: str
    #: True when a live provider is configured. False for the snapshot, and the
    #: UI must not describe a snapshot as a live availability feed.
    is_live: bool = False


@dataclass(frozen=True)
class PlaceQueryResult:
    """What a provider returned, and whether it could answer at all.

    `places` is meaningless without `state`. An empty tuple with AVAILABLE
    means nothing of that category is MAPPED in the searched area; an empty
    tuple with UNAVAILABLE means the lookup failed and the road is unknown. A
    caller reading only the tuple treats those identically, which is the
    failure this type exists to make impossible to write by accident.
    """

    state: PlacesSourceState
    places: tuple[Place, ...] = field(default_factory=tuple)
    source: PlaceSource | None = None
    anchor: SearchAnchor | None = None
    #: True when MAX_RESULTS clipped the answer, so the UI can say "showing
    #: the nearest 60" instead of implying it found exactly 60.
    truncated: bool = False
    #: Why, when state is UNAVAILABLE. Never rendered as a road condition.
    error: str | None = None

    @property
    def usable(self) -> bool:
        """True only when the answer describes the road rather than our setup."""
        return self.state is PlacesSourceState.AVAILABLE
