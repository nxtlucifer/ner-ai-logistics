"""Shared API contract primitives.

Two rules hold across every schema in this package:

1. Clients never supply server-managed fields. `id`, `created_at`, `updated_at`
   and any computed value appear on Read schemas only. Create/Update schemas
   forbid unknown fields outright, so a client that sends `id` gets a 422 rather
   than having it silently ignored - silent ignoring is how a caller comes to
   believe it controls an identifier.
2. Coordinates cross the wire as {"lat": ..., "lon": ...}. GeoJSON's [lon, lat]
   ordering is used only for route geometry, where it is the format standard.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# Approximate bounding box of the North Eastern Region, used for a non-blocking
# plausibility check rather than a hard constraint - trips may legitimately
# begin outside it.
NER_LAT_RANGE = (21.5, 29.6)
NER_LON_RANGE = (87.9, 97.5)


class APIModel(BaseModel):
    """Base for request bodies. Unknown fields are an error, not noise."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReadModel(BaseModel):
    """Base for responses, populated from ORM objects."""

    model_config = ConfigDict(from_attributes=True)


class Coordinate(APIModel):
    """A WGS84 point.

    The strict ranges are the primary defence against latitude/longitude
    inversion, which is the single most common spatial bug. Guwahati is
    (26.1445 N, 91.7362 E); swapping them yields lat=91.7362, which fails the
    -90..90 bound and is rejected here rather than being stored as a point in
    the Arctic Ocean.
    """

    lat: Annotated[float, Field(ge=-90.0, le=90.0, description="Latitude, WGS84")]
    lon: Annotated[float, Field(ge=-180.0, le=180.0, description="Longitude, WGS84")]

    def to_wkt(self) -> str:
        """WKT for PostGIS. Note the POINT(lon lat) ordering."""
        return f"POINT({self.lon} {self.lat})"

    @property
    def is_plausibly_ner(self) -> bool:
        """Whether the point falls inside the NER bounding box.

        Advisory only. Used to warn an operator who has entered coordinates for
        the wrong region, never to reject a request.
        """
        return (
            NER_LAT_RANGE[0] <= self.lat <= NER_LAT_RANGE[1]
            and NER_LON_RANGE[0] <= self.lon <= NER_LON_RANGE[1]
        )


class TimestampedRead(ReadModel):
    id: object
    created_at: datetime


class Page(BaseModel):
    """Cursor pagination envelope.

    Cursor rather than offset because GPS and audit rows are appended
    constantly, and offset paging would skip records between requests.
    """

    model_config = ConfigDict(from_attributes=True)

    items: list
    next_cursor: str | None = None
