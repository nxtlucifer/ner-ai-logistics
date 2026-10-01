"""Rate limiting: one algorithm (GCRA), one policy table, one address reading.

Deterministic application logic. No I/O, no model, and no clock of its own -
`now` is passed in, so a test steps through time instead of sleeping through
it (docs/TESTING_STRATEGY.md principle 5). The numbers and the reasoning per
endpoint class are in docs/RATE_LIMIT_POLICY.md; `POLICIES` below is that
document's table.

WHERE LIMITS ARE APPLIED

Per route, as a dependency (`app/api/deps.rate_limit(...)`), like
`require_permission(...)`, plus one per-user ceiling that every authenticated
request passes through in `get_current_user`. Never app-wide middleware: a
policy broad enough to cover "the API" would throttle the telemetry the fleet
map depends on - a truck flushing an offline backlog posts hundreds of fixes in
one burst. So GPS has its own budget counted in fixes, and SOS and GPS are
named, in one visible list (deps.UNMETERED_ROUTES), as outside the ceiling.

WHY NOT THE LEFT-MOST X-Forwarded-For

The left-most X-Forwarded-For entry is whatever the caller typed. A limiter
keyed on it would be bypassed by rotating one header, which is worse than no
limiter because it would look like protection. `client_address` below is the
one reading used by every limiter and by `get_client_ip` (the audit IP in
app/api/deps.py): the TCP peer, or, with TRUSTED_PROXY_HOPS set, the entry that
many trusted proxies appended, counted from the right (SEC-006). Behind Render's
one proxy that is the real client, not the proxy, so callers do not share one
per-IP budget.

SCOPE, HONESTLY

State is in-process memory. It does not survive a restart and is not shared
between workers. For a single uvicorn process - what this project runs - that
is exactly the stated limit. With MULTI_INSTANCE set, the `shared` policies are
counted in Postgres (app/services/coordination.allow, the same GCRA in one
upsert), which returns this module's Decision; this process's own count is
still checked first, so an attempt this process already refuses costs no query.
"""

import ipaddress
import logging
import math
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Final

from app.core.config import get_settings

logger = logging.getLogger(__name__)

#: Keys are pruned once the map exceeds this, so a long-running process
#: cannot accumulate an entry per attacker-chosen key forever. The limiter must
#: not become the memory-exhaustion vector it exists to prevent.
MAX_TRACKED_KEYS: Final[int] = 10_000


@dataclass(frozen=True)
class Decision:
    """The outcome of one attempt against one key."""

    allowed: bool
    #: Seconds until this attempt would be allowed. Only meaningful when
    #: `allowed` is False; never 0 then.
    retry_after: int
    #: Units in use in the rolling window, including this attempt (for a
    #: refusal: what it would have made).
    used: int
    limit: int


def units(ahead_s: float, interval_s: float) -> int:
    """Budget units a TAT `ahead_s` seconds in the future stands for.

    The epsilon absorbs microsecond rounding of the interval (60 s / 7 is not a
    whole number of microseconds, in Python or in Postgres), which would
    otherwise make 1.0000001 units read as 2. Shared with coordination.allow so
    both paths report the same `used`.
    """
    return max(1, math.ceil(ahead_s / interval_s - 1e-6))


@dataclass
class GcraLimiter:
    """GCRA (virtual-scheduling token bucket): `limit` units per `window`
    sustained, `burst` of them at once.

    One timestamp per key, the theoretical arrival time (TAT):

        interval = window / limit
        new_tat  = max(tat, now) + interval * cost
        allowed  = new_tat - now <= interval * burst   (then tat = new_tat)

    Replaces a fixed window whose edge let 2 x limit through in about a second
    (audit case C). Here any interval of length t admits at most
    burst + t / interval units, wherever it falls: there is no edge. A refused
    attempt does not advance the TAT, so a caller who keeps retrying gets the
    sustained rate and no more - never a reset. docs/RATE_LIMIT_POLICY.md s.1
    compares the alternatives.
    """

    limit: int
    window: timedelta
    #: Units allowed at once. None = `limit` (a full window's worth).
    burst: int | None = None
    #: key -> TAT. Named as before so callers counting keys still can.
    _windows: dict[str, datetime] = field(default_factory=dict, repr=False)

    @property
    def capacity(self) -> int:
        return self.burst or self.limit

    def check(self, key: str, *, now: datetime | None = None, cost: int = 1) -> Decision:
        """Spend `cost` units of `key`'s budget if they fit, and say whether they did.

        A cost above the burst is charged as the burst: a single request larger
        than the whole bucket would otherwise be refused forever.
        """
        moment = now or datetime.now(UTC)
        interval = self.window / self.limit
        cost = max(1, min(cost, self.capacity))
        stored = self._windows.get(key)
        new_tat = max(stored or moment, moment) + interval * cost
        ahead = new_tat - moment
        used = units(ahead / timedelta(seconds=1), interval / timedelta(seconds=1))

        excess = ahead - interval * self.capacity
        if excess <= timedelta(0):
            self._windows[key] = new_tat
            if stored is None:
                self._prune(moment)
            return Decision(allowed=True, retry_after=0, used=used, limit=self.limit)
        return Decision(
            allowed=False,
            # Always at least one second: a Retry-After of 0 invites an
            # immediate retry, which is the behaviour being limited.
            retry_after=max(1, math.ceil(excess.total_seconds())),
            used=used,
            limit=self.limit,
        )

    def reset(self, key: str) -> None:
        """Forget a key.

        Called after a SUCCESSFUL login so that a legitimate user who mistyped
        their password twice is not left near the threshold for the rest of the
        window. Failure is what the limit is counting; success clears it.
        """
        self._windows.pop(key, None)

    def clear(self) -> None:
        """Drop all state. For tests, and for nothing else."""
        self._windows.clear()

    def _prune(self, now: datetime) -> None:
        """Drop keys whose TAT has passed (a full bucket is the same as no
        entry) once the map grows large.

        Only when a key is added, and only past a threshold, so the common
        path stays a dict lookup. It does not by itself bound a map of keys
        that are all still active: filling it needs one request per key, which
        the per-address budgets cap, and an attacker with enough addresses to
        outrun that holds that many real sockets first. Stated rather than
        defended with an eviction policy, which would be the harder thing to
        get right.
        """
        if len(self._windows) <= MAX_TRACKED_KEYS:
            return
        for key in [k for k, tat in self._windows.items() if tat <= now]:
            del self._windows[key]


@dataclass(frozen=True)
class Policy:
    """One row of docs/RATE_LIMIT_POLICY.md section 5."""

    #: Sustained: `limit` units per `window_s`.
    limit: int
    window_s: float
    burst: int
    #: The coarse per-IP guard, in users' worth of this budget. 0 = none (the
    #: ceilings, GPS and SOS: a fleet behind one carrier address must not
    #: share one budget).
    ip_multiple: int = 0
    #: Counted in Postgres across instances when MULTI_INSTANCE is on.
    shared: bool = False
    #: Keyed by client address instead of user (public endpoints).
    per_address: bool = False


#: Authentication's own limits (login, refresh) stay in Settings, where they
#: always were; everything else is here. docs/RATE_LIMIT_POLICY.md explains
#: every number.
POLICIES: Final[dict[str, Policy]] = {
    # A
    "password": Policy(5, 900, 5, ip_multiple=20, shared=True),
    # B - an external provider behind each call
    "route_plan": Policy(10, 60, 5, ip_multiple=20, shared=True),
    "route_assess": Policy(20, 60, 10, ip_multiple=20, shared=True),
    "geocoding": Policy(20, 60, 10, ip_multiple=20, shared=True),
    "driver_route": Policy(30, 60, 15, ip_multiple=20, shared=True),
    "driver_reroute": Policy(6, 600, 3, ip_multiple=20, shared=True),
    "ai_ask": Policy(30, 60, 10, ip_multiple=20, shared=True),
    "places": Policy(120, 60, 60),
    # C
    "upload": Policy(10, 60, 10, ip_multiple=20, shared=True),
    # D - cost is fixes, not requests
    "gps": Policy(60, 60, 1000),
    # E
    "sos": Policy(5, 600, 5),
    "emergency_sweep": Policy(6, 60, 3, shared=True),
    # The per-user ceilings every authenticated request passes (deps.py).
    "read": Policy(600, 60, 300),
    "write": Policy(120, 60, 60),
    # G, and logout
    "public": Policy(60, 60, 30, per_address=True),
}


def limiter_for(policy: Policy, *, per_ip: bool = False) -> GcraLimiter:
    scale = policy.ip_multiple if per_ip else 1
    return GcraLimiter(
        limit=policy.limit * scale,
        window=timedelta(seconds=policy.window_s),
        burst=policy.burst * scale,
    )


#: True once an X-Forwarded-For arrived while TRUSTED_PROXY_HOPS was 0: then
#: something in front of this service appends it, and every public caller may
#: be sharing the proxy's per-IP budget. Read by /ready (FC-02).
forwarded_header_ignored = False


def client_address(
    peer: str | None, forwarded_for: str | None, trusted_hops: int
) -> str:
    """The address a rate limit should be counted against.

    `peer` is the TCP peer. `forwarded_for` is the raw `X-Forwarded-For`
    header. `trusted_hops` is how many proxies genuinely sit in front of
    this service.

    WHY FROM THE RIGHT

    A conforming proxy APPENDS the address it received from. So for a
    request that really passed through one proxy:

        X-Forwarded-For: <client>
                          ^ appended by the proxy, trustworthy

    and for a client that forged the header before reaching that proxy:

        X-Forwarded-For: 1.2.3.4 (forged), <client>
                                            ^ still the rightmost

    Taking the rightmost entry per trusted hop therefore reads only what
    the infrastructure wrote. Taking the LEFTMOST — the usual reading of
    "the original client" — reads precisely the part an attacker controls,
    and would let anyone reset their own rate limit on every request.

    With `trusted_hops == 0` the header is not consulted at all - but its
    arrival is remembered (`forwarded_header_ignored`), because it means a
    proxy may be in front of a service configured as if none were.
    """
    if trusted_hops > 0 and forwarded_for:
        hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
        if hops:
            # Never index past the start: a request with fewer hops than
            # configured has not been through the expected chain, so fall
            # back to the leftmost real entry rather than to nothing.
            index = max(0, len(hops) - trusted_hops)
            return hops[index][:45]
    elif forwarded_for and forwarded_for.strip():
        _note_ignored_forwarding()
    return peer or "unknown-peer"


def rate_key(address: str) -> str:
    """The budget an address spends (RB-01). An IPv6 host is usually handed a
    whole /64 and can rotate through it at will, so IPv6 is counted per /64;
    an IPv4-mapped address is its IPv4. Audit rows keep the full address
    (deps.get_client_ip). A non-address is its own key, as before."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return address
    if ip.version == 6 and ip.ipv4_mapped is not None:
        return str(ip.ipv4_mapped)
    if ip.version == 6:
        return str(ipaddress.IPv6Network((int(ip) >> 64 << 64, 64)))
    return str(ip)


def _note_ignored_forwarding() -> None:
    global forwarded_header_ignored
    if forwarded_header_ignored:
        return
    forwarded_header_ignored = True
    if not get_settings().is_development:  # the Vite dev proxy adds one
        logger.warning(
            "X-Forwarded-For arrived but TRUSTED_PROXY_HOPS=0: if a proxy fronts "
            "this service, every public caller shares its per-IP rate limit. "
            "Render: TRUSTED_PROXY_HOPS=1. See docs/RATE_LIMIT_POLICY.md s.3."
        )
