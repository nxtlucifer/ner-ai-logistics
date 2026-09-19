"""Who is actually there, and how we know.

WHAT "ONLINE" IS ALLOWED TO MEAN

An authenticated heartbeat the server received. Nothing else. Not
`navigator.onLine`, which says the browser has *an* interface up; not the
signal bars, which say the radio sees a tower; not "the tab is open", which
says a laptop lid is not shut. Each of those has been used somewhere to
draw a green dot, and each of them draws it for a person who is not there -
which is the worst possible thing for a dispatcher deciding whether anyone
is watching a truck on a hill road.

WHY GPS AGE IS A SEPARATE FACT

A driver in a gorge with no sky view is ONLINE and has no position. Calling
them offline because the GPS is stale loses the one thing that matters -
the app is running, the person can be reached - and calling their last
known position current is worse. So presence and location freshness are two
fields, computed separately, and the UI shows both.

THRESHOLDS

    ONLINE   heartbeat within 90 s
    IDLE     within 15 min - the app is open, nobody is driving it
    OFFLINE  older than that, or never

STALE is not a presence value. It is what the location says, and it is
returned alongside.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import Final

#: A heartbeat is sent every 60 s, so 90 s tolerates one lost beat without
#: declaring a person gone. Two lost beats is a real gap worth showing.
ONLINE_WITHIN: Final = timedelta(seconds=90)

#: Beyond this the session may still hold a token, but nobody is watching.
IDLE_WITHIN: Final = timedelta(minutes=15)

#: A position older than this is history, not a location. Matches the
#: freshness language the fleet map already uses.
GPS_FRESH_WITHIN: Final = timedelta(minutes=2)
GPS_STALE_AFTER: Final = timedelta(minutes=10)


class Presence(str, Enum):
    ONLINE = "ONLINE"
    IDLE = "IDLE"
    OFFLINE = "OFFLINE"


class LocationFreshness(str, Enum):
    FRESH = "FRESH"
    AGEING = "AGEING"
    STALE = "STALE"
    #: No position at all. Distinct from STALE: one is old news, the other
    #: is no news, and a dispatcher treats them differently.
    UNAVAILABLE = "UNAVAILABLE"


@dataclass(frozen=True)
class Status:
    presence: Presence
    location: LocationFreshness
    #: Seconds since the heartbeat, for a UI that wants to say "4 min ago"
    #: rather than a word. None when there has never been one.
    seen_seconds_ago: int | None
    gps_seconds_ago: int | None


def _age(then: datetime | None, now: datetime) -> timedelta | None:
    if then is None:
        return None
    if then.tzinfo is None:
        then = then.replace(tzinfo=UTC)
    return now - then


def assess(
    *,
    last_seen_at: datetime | None,
    last_gps_at: datetime | None = None,
    now: datetime | None = None,
) -> Status:
    """Derived on read, never stored.

    A stored status is a lie the moment the clock moves: a row written
    "ONLINE" at 14:02 still says ONLINE at 18:00 unless something goes round
    rewriting it, and the thing that goes round rewriting it is the job
    nobody remembers to run.
    """
    now = now or datetime.now(UTC)

    seen = _age(last_seen_at, now)
    if seen is None or seen > IDLE_WITHIN:
        presence = Presence.OFFLINE
    elif seen <= ONLINE_WITHIN:
        presence = Presence.ONLINE
    else:
        presence = Presence.IDLE

    gps = _age(last_gps_at, now)
    if gps is None:
        location = LocationFreshness.UNAVAILABLE
    elif gps <= GPS_FRESH_WITHIN:
        location = LocationFreshness.FRESH
    elif gps <= GPS_STALE_AFTER:
        location = LocationFreshness.AGEING
    else:
        location = LocationFreshness.STALE

    return Status(
        presence=presence,
        location=location,
        seen_seconds_ago=int(seen.total_seconds()) if seen is not None else None,
        gps_seconds_ago=int(gps.total_seconds()) if gps is not None else None,
    )
