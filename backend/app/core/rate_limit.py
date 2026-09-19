"""Fixed-window rate limiting for authentication endpoints.

Deterministic application logic. No I/O, no model, and no clock of its own -
`now` is passed in, so a test steps through a window instead of sleeping
through it (docs/TESTING_STRATEGY.md principle 5).

WHY A DEPENDENCY AND NOT MIDDLEWARE

app/main.py states the rule: "there is no app-wide middleware granting or
withholding access, because a gate you cannot see from the route is a gate
nobody checks when adding the next route." Rate limiting is that same kind of
gate, so it is declared per route exactly like `require_permission(...)`.

That is not only consistency. A global limiter is the specific way this feature
breaks the product: a truck flushing an offline backlog posts hundreds of fixes
in one burst, and a policy broad enough to cover "the API" would throttle the
telemetry the fleet map depends on. Being unable to apply a limit without naming
the route makes that mistake hard to make by accident.

WHY NOT THE LEFT-MOST X-Forwarded-For

The left-most X-Forwarded-For entry is whatever the caller typed. A limiter
keyed on it would be bypassed by rotating one header, which is worse than no
limiter because it would look like protection. `client_address` below is the
one reading used by both the login limiter and `get_client_ip` (the audit IP in
app/api/deps.py): the TCP peer, or, with TRUSTED_PROXY_HOPS set, the entry that
many trusted proxies appended, counted from the right (SEC-006). Behind Render's
one proxy that is the real client, not the proxy, so callers do not share one
per-IP budget.

SCOPE, HONESTLY

State is in-process memory. It does not survive a restart and is not shared
between workers, so a multi-process deployment enforces the limit per worker.
For a single uvicorn process - what this project runs - that is exactly the
stated limit. With MULTI_INSTANCE set, app/api/auth.py counts the same keys in
Postgres (app/services/coordination.allow), which returns this module's
Decision. The per-address keys are still checked here first, so an attempt
this process already refuses costs no query.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Final

#: Windows are pruned once the map exceeds this, so a long-running process
#: cannot accumulate an entry per attacker-chosen key forever. The limiter must
#: not become the memory-exhaustion vector it exists to prevent.
MAX_TRACKED_KEYS: Final[int] = 10_000


@dataclass(frozen=True)
class Decision:
    """The outcome of one attempt against one key."""

    allowed: bool
    #: Seconds until the window resets. Only meaningful when `allowed` is False.
    retry_after: int
    #: Attempts already counted in the current window, including this one.
    used: int
    limit: int


@dataclass
class _Window:
    started_at: datetime
    count: int


@dataclass
class FixedWindowLimiter:
    """Count attempts per key inside a fixed window.

    Fixed window rather than sliding: it is one timestamp and one integer per
    key, it is trivial to reason about when reading a 429, and its known
    weakness - up to 2x the limit across a window boundary - does not matter
    for a control whose job is to turn unlimited password guessing into a few
    attempts per minute. A sliding log would cost per-attempt storage to
    tighten a bound that is already arbitrary.
    """

    limit: int
    window: timedelta
    _windows: dict[str, _Window] = field(default_factory=dict, repr=False)

    def check(self, key: str, *, now: datetime | None = None) -> Decision:
        """Record an attempt against `key` and say whether it is allowed.

        Counts the attempt whether or not it is allowed: a caller that keeps
        hammering a limited key keeps the window occupied rather than being
        rewarded with a reset.
        """
        moment = now or datetime.now(UTC)
        current = self._windows.get(key)

        if current is None or moment - current.started_at >= self.window:
            self._windows[key] = _Window(started_at=moment, count=1)
            self._prune(moment)
            return Decision(allowed=True, retry_after=0, used=1, limit=self.limit)

        current.count += 1
        if current.count <= self.limit:
            return Decision(
                allowed=True, retry_after=0, used=current.count, limit=self.limit
            )

        elapsed = moment - current.started_at
        remaining = self.window - elapsed
        return Decision(
            allowed=False,
            # Always at least one second: a Retry-After of 0 invites an
            # immediate retry, which is the behaviour being limited.
            retry_after=max(1, int(remaining.total_seconds()) + 1),
            used=current.count,
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
        """Drop expired windows once the map grows large.

        Only on insert, and only past a threshold, so the common path stays a
        dict lookup.

        This prunes EXPIRED windows only, so it does not by itself bound a map
        of entries that are all still fresh. That case is bounded elsewhere and
        deliberately: filling the identifier map needs one request per
        identifier, and the per-IP limit caps those at 20 a minute from one
        address. An attacker with enough distinct addresses to outrun that has
        to hold that many real sockets, and the per-address map then grows
        instead - at which point the ceiling is the connection count the server
        would already be struggling with.

        Stated rather than defended against with an eviction policy, because
        the eviction policy would be the more complicated thing to get right
        and the limit it protects is already the cheaper bound.
        """
        if len(self._windows) <= MAX_TRACKED_KEYS:
            return
        cutoff = now - self.window
        for key in [k for k, w in self._windows.items() if w.started_at < cutoff]:
            del self._windows[key]


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

    With `trusted_hops == 0` the header is not consulted at all.
    """
    if trusted_hops > 0 and forwarded_for:
        hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
        if hops:
            # Never index past the start: a request with fewer hops than
            # configured has not been through the expected chain, so fall
            # back to the leftmost real entry rather than to nothing.
            index = max(0, len(hops) - trusted_hops)
            return hops[index][:45]
    return peer or "unknown-peer"
