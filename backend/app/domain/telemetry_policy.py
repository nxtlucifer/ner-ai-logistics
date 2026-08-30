"""Location telemetry policy: one place for every threshold.

These numbers appear in three places - ingestion validation, the manager's
freshness label, and the driver app's upload cadence - and they must agree. When
"LIVE" on a manager's screen means 60 seconds and the phone uploads every 90,
every healthy truck reads as stale. So the server owns the values and hands the
cadence to the app at runtime (`GET /api/driver/me/trip` carries a `tracking`
block); the app has no copies of its own.

Deterministic application logic. No model, no I/O.
"""

from datetime import timedelta
from typing import Final

# --- Freshness ------------------------------------------------------------

#: A position younger than this is presented as current.
#:
#: Derived, not picked: the app uploads every 10s while moving (below), and a
#: single lost batch plus one retry is ~30s. 90s therefore survives one failed
#: upload and its retry without flapping, while still being short enough that a
#: manager acting on a "LIVE" marker is looking at roughly where the truck is -
#: at 60 km/h a 90-second-old fix is 1.5 km out of date, which is the resolution
#: a dispatcher actually works at.
LOCATION_FRESH_SECONDS: Final[int] = 90

#: Older than this and the trip is reported as out of contact rather than
#: merely stale. Two upload intervals plus a cell-coverage gap through a valley.
LOCATION_STALE_SECONDS: Final[int] = 600

FRESHNESS_LIVE: Final[str] = "LIVE"
FRESHNESS_STALE: Final[str] = "STALE"
FRESHNESS_NO_CONTACT: Final[str] = "NO_CONTACT"
FRESHNESS_NONE: Final[str] = "NO_LOCATION"


def freshness_label(age_seconds: float | None) -> str:
    """Classify a position's age.

    None means no position has ever been received for this trip, which is a
    different thing from an old one and must not be rendered as "stale".
    """
    if age_seconds is None:
        return FRESHNESS_NONE
    if age_seconds <= LOCATION_FRESH_SECONDS:
        return FRESHNESS_LIVE
    if age_seconds <= LOCATION_STALE_SECONDS:
        return FRESHNESS_STALE
    return FRESHNESS_NO_CONTACT


# --- Upload cadence -------------------------------------------------------

#: Interval while the truck is moving.
#:
#: The trade is battery and Supabase write volume against manager freshness. At
#: 10s a 10-hour shift is 3,600 rows per truck per day - a number the unpartitioned
#: gps_points table handles comfortably at demo scale, and one the newest-location
#: index answers without a scan. Faster buys a dispatcher nothing: they are not
#: watching a truck turn individual corners.
TRACKING_MOVING_INTERVAL_SECONDS: Final[int] = 10

#: Interval while the truck has not moved. A parked truck at 10s would produce
#: thousands of identical rows overnight and drain the phone for no information.
TRACKING_STATIONARY_INTERVAL_SECONDS: Final[int] = 60

#: Below this displacement the truck counts as stationary. Comfortably above
#: consumer GPS jitter (typically 5-15 m), so a parked truck does not appear to
#: creep and trigger the moving cadence.
TRACKING_STATIONARY_DISTANCE_M: Final[int] = 30

#: Fixes per upload. The app batches so a 10-second cadence is not 10-second
#: radio wake-ups.
TRACKING_BATCH_SIZE: Final[int] = 6

#: Hard cap on one request, matching GpsBatchIn.
TRACKING_MAX_BATCH: Final[int] = 500

#: Most fixes the app may hold while offline. Bounded on purpose: an unbounded
#: queue on a phone that is offline for a day is a memory leak that ends in the
#: app being killed mid-trip. Oldest are dropped first - the newest positions
#: are the ones that matter to a dispatcher.
TRACKING_QUEUE_LIMIT: Final[int] = 500


# --- Acceptance windows ---------------------------------------------------

#: Backdated fixes accepted this far back, per docs/API_CONTRACTS.md section 8.
#: A truck out of coverage for a shift must be able to flush its queue.
MAX_BACKDATE = timedelta(hours=24)

#: Tolerance for a device clock running fast. Phone clocks drift and NTP
#: correction is not instant, so a small skew is normal; beyond it the timestamp
#: is not evidence of anything.
MAX_CLOCK_SKEW = timedelta(minutes=2)


# --- Sanity signals -------------------------------------------------------

#: Speed between consecutive fixes above which the movement is implausible for a
#: loaded truck on NER roads. Flagged, never rejected: the failure mode of
#: discarding a "impossible" fix is losing the position of a truck that is
#: genuinely in trouble. See docs/SECURITY.md section 8.
IMPLAUSIBLE_SPEED_KMPH: Final[float] = 200.0

#: Accuracy worse than this is recorded but flagged - a 500 m radius is a cell
#: tower fix, not a GPS one.
POOR_ACCURACY_M: Final[float] = 500.0

ANOMALY_MOCK_LOCATION: Final[str] = "MOCK_LOCATION"
ANOMALY_IMPLAUSIBLE_SPEED: Final[str] = "IMPLAUSIBLE_SPEED"
ANOMALY_POOR_ACCURACY: Final[str] = "POOR_ACCURACY"

REJECT_STALE: Final[str] = "STALE"
REJECT_FUTURE: Final[str] = "FUTURE_TIMESTAMP"


def tracking_config() -> dict[str, int]:
    """The cadence the driver app should use, as sent to it at runtime."""
    return {
        "moving_interval_seconds": TRACKING_MOVING_INTERVAL_SECONDS,
        "stationary_interval_seconds": TRACKING_STATIONARY_INTERVAL_SECONDS,
        "stationary_distance_m": TRACKING_STATIONARY_DISTANCE_M,
        "batch_size": TRACKING_BATCH_SIZE,
        "queue_limit": TRACKING_QUEUE_LIMIT,
        "fresh_seconds": LOCATION_FRESH_SECONDS,
    }
