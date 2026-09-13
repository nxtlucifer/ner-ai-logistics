"""Historical landslide inventory: the bundled GLC slice, read as evidence.

A SEPARATE seam from `base.build_provider()`. That one is for CURRENT
incidents and its answer gates route selection; this one is for what has
happened on a corridor before, and its answer is exposure evidence for the
score. Plugging an inventory that ends in 2017 into the current-incident seam
would make every corridor "clear" after the 90-day window - see
`app.domain.landslide.assess_history` for why that is a lie in both
directions.

The file and its provenance live in `backend/data/landslides/`. Read once per
process: 471 rows, and a hillside's history does not change between requests.
"""

import csv
import logging
from datetime import UTC, datetime
from functools import lru_cache

from app.services import provider_health
from pathlib import Path
from typing import Final, Protocol

from app.domain.landslide import (
    IncidentQueryResult,
    IncidentSource,
    LandslideIncident,
    SourceState,
    SourceType,
)
from app.services.landslide.base import BoundingBox

logger = logging.getLogger(__name__)

SNAPSHOT: Final[Path] = (
    Path(__file__).resolve().parents[3] / "data" / "landslides" / "glc_ner.csv"
)

#: The GLC's own accuracy vocabulary, in metres. Unknown stays None, which
#: `assess_history` treats as "cannot be placed on a road" - not as exact.
_ACCURACY_M: Final[dict[str, float]] = {
    "exact": 100.0,
    "1km": 1_000.0,
    "5km": 5_000.0,
    "10km": 10_000.0,
    "25km": 25_000.0,
    "50km": 50_000.0,
    "100km": 100_000.0,
    "250km": 250_000.0,
}


class HistoricalInventory(Protocol):
    name: str

    async def events_near(self, box: BoundingBox) -> IncidentQueryResult: ...


class NullInventory:
    name = "none"

    async def events_near(self, box: BoundingBox) -> IncidentQueryResult:
        return IncidentQueryResult(state=SourceState.NOT_CONFIGURED, provider=self.name)


def _parse_date(value: str) -> datetime | None:
    # "07/03/2017 12:00:00 AM" as the export writes it. Anything else is None,
    # never a guess.
    try:
        return datetime.strptime(value.strip(), "%m/%d/%Y %I:%M:%S %p").replace(tzinfo=UTC)
    except ValueError:
        return None


@lru_cache(maxsize=1)
def load_snapshot(path: Path = SNAPSHOT) -> tuple[LandslideIncident, ...]:
    """Every event in the bundled slice, normalised once."""
    out: list[LandslideIncident] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (KeyError, ValueError):
                continue
            title = (row.get("event_title") or "").strip() or None
            out.append(
                LandslideIncident(
                    incident_id=f"glc-{row.get('event_id', '').strip()}",
                    event_date=_parse_date(row.get("event_date", "")),
                    latitude=lat,
                    longitude=lon,
                    location_name=title,
                    state=(row.get("admin_division_name") or "").strip() or None,
                    fatalities=_int(row.get("fatality_count")),
                    sources=(
                        IncidentSource(
                            name=(row.get("source_name") or "NASA GLC").strip(),
                            source_type=SourceType.NEWS,
                            reference=(row.get("source_link") or "").strip() or None,
                        ),
                    ),
                    location_accuracy_m=_ACCURACY_M.get(
                        (row.get("location_accuracy") or "").strip().lower()
                    ),
                )
            )
    dates = [i.event_date for i in out if i.event_date]
    provider_health.static("NASA_GLC", vintage=f"{min(dates).year}-{max(dates).year}" if dates else "unknown", records=len(out))
    return tuple(out)


def _int(value: str | None) -> int | None:
    try:
        return int(float(value)) if value not in (None, "") else None
    except ValueError:
        return None


class GlcSnapshotInventory:
    """The bundled NASA GLC slice. See data/landslides/PROVENANCE.md."""

    name = "nasa-glc-2007-2017-snapshot"

    def __init__(self, path: Path = SNAPSHOT) -> None:
        self._path = path

    async def events_near(self, box: BoundingBox) -> IncidentQueryResult:
        try:
            events = load_snapshot(self._path)
        except OSError as error:
            logger.warning("landslide inventory unreadable: %r", error)
            return IncidentQueryResult(
                state=SourceState.UNAVAILABLE, provider=self.name, error="unreadable"
            )
        inside = tuple(
            e
            for e in events
            if e.latitude is not None
            and e.longitude is not None
            and box.min_lat <= e.latitude <= box.max_lat
            and box.min_lon <= e.longitude <= box.max_lon
        )
        return IncidentQueryResult(
            state=SourceState.AVAILABLE, incidents=inside, provider=self.name
        )


def build_inventory() -> HistoricalInventory:
    """The bundled snapshot when it is present, otherwise nothing - loudly."""
    if SNAPSHOT.exists():
        return GlcSnapshotInventory()
    return NullInventory()
