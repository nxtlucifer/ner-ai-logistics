import logging
"""Request dependencies: database session, current user, permission gates.

Every protected route goes through `require_permission(...)`. Routes never
inspect `user.role` themselves - that pattern spreads authorization logic across
every endpoint, where one missed check is invisible.
"""

import ipaddress
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.verifier import InvalidToken, TokenVerifier, get_token_verifier
from app.core.config import get_settings
from app.core import rate_limit as rate_limit_state
from app.core.errors import AuthenticationError, PermissionDeniedError, RateLimitedError
from app.core.permissions import has_permission
from app.core.rate_limit import POLICIES, GcraLimiter, client_address, limiter_for, rate_key
from app.db.session import get_session
from app.models.enums import DriverStatus, UserRole
from app.models.identity import Driver, User
from app.services import coordination

# auto_error=False so a missing header raises our own 401 envelope rather than
# FastAPI's default shape, keeping every error response identical.
logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

#: The only paths a must-reset account may reach. Reading your own principal
#: is on the list because the client has to learn WHY it is being refused;
#: signing out is, because being unable to leave would be absurd.
PASSWORD_RESET_ALLOWED = frozenset(
    {"/api/auth/password", "/api/auth/me", "/api/auth/logout", "/api/auth/refresh"}
)

DbSession = Annotated[AsyncSession, Depends(get_session)]

# --- Rate limits (docs/RATE_LIMIT_POLICY.md) --------------------------------

#: This process's budgets, one per policy, and one per policy with a per-IP
#: guard. Module-level so they survive between requests.
_USER_LIMITERS: dict[str, GcraLimiter] = {n: limiter_for(p) for n, p in POLICIES.items()}
_IP_LIMITERS: dict[str, GcraLimiter] = {
    n: limiter_for(p, per_ip=True) for n, p in POLICIES.items() if p.ip_multiple
}

#: Routes the per-user read/write ceiling never counts, by route template. An
#: SOS, and a manager resolving one, must never meet a 429 that other traffic
#: (or a misbehaving app) earned; GPS has its own budget, counted in fixes.
UNMETERED_ROUTES = frozenset(
    {
        "/api/driver/me/location",
        "/api/driver/me/trip/check-in",
        "/api/driver/me/trip/stop-request",
        "/api/emergencies/{emergency_id}/resolve",
    }
)

#: One message for every limit: it must not say which budget, or whose.
TOO_MANY = "Too many attempts. Try again shortly."


def reset_rate_limits() -> None:
    """Drop every in-process budget. Test hook (tests/conftest.py)."""
    for limiter in (*_USER_LIMITERS.values(), *_IP_LIMITERS.values()):
        limiter.clear()
    rate_limit_state.forwarded_header_ignored = False


def request_address(request: Request) -> str:
    """The caller's address for a limit or an audit row: the TCP peer, or the
    X-Forwarded-For entry TRUSTED_PROXY_HOPS proxies appended, from the right
    (core/rate_limit.client_address, SEC-006)."""
    return client_address(
        request.client.host if request.client else None,
        request.headers.get("x-forwarded-for"),
        get_settings().TRUSTED_PROXY_HOPS,
    )


def rate_address(request: Request) -> str:
    """What a per-address budget is keyed on: `request_address`, with IPv6
    folded to its /64 (core/rate_limit.rate_key, RB-01)."""
    return rate_key(request_address(request))


async def enforce(
    limiter: GcraLimiter,
    key: str,
    *,
    shared: bool,
    local_first: bool = True,
    cost: int = 1,
    message: str = TOO_MANY,
) -> None:
    """Spend `cost` of `key`'s budget or raise 429 with Retry-After.

    With MULTI_INSTANCE and a `shared` policy the same GCRA runs in Postgres
    (services/coordination.allow) so every instance spends one budget. This
    process's own count is checked first (`local_first`): its attempts are part
    of the shared count, so what it refuses alone is refused without a query,
    and a flood from one caller takes no connection from the pool everyone
    needs. A local refusal errs stricter than the shared count, never looser.
    A budget that is reset across instances (the login identifier) is counted
    in Postgres only (`local_first=False`).
    """
    settings = get_settings()
    if not settings.RATE_LIMIT_ENABLED:
        return
    multi = shared and settings.MULTI_INSTANCE
    decision = limiter.check(key, cost=cost) if local_first or not multi else None
    if multi and (decision is None or decision.allowed):
        decision = await coordination.allow(
            key, limiter.limit, limiter.window.total_seconds(), burst=limiter.burst, cost=cost
        )
    if not decision.allowed:
        raise RateLimitedError(message, retry_after=decision.retry_after)


async def charge(
    bucket: str,
    request: Request,
    subject: object,
    db: AsyncSession | None = None,
    *,
    cost: int = 1,
    message: str = TOO_MANY,
) -> None:
    """Spend `bucket` for `subject` (a user id, or the address for a public
    policy), then the bucket's coarser per-IP guard.

    User first: a caller refused on their own budget does not spend the IP
    guard, so one abuser behind a NAT cannot use up everybody else's.
    """
    policy = POLICIES[bucket]
    if policy.shared and db is not None and get_settings().MULTI_INSTANCE:
        # The shared count borrows a pooled connection of its own. Hand back
        # the one the auth lookup holds first, so a request never holds two
        # (DBPOOL-02). Commit, not rollback: the User stays readable.
        await db.commit()
    await enforce(
        _USER_LIMITERS[bucket], f"{bucket}:{subject}", shared=policy.shared, cost=cost, message=message
    )
    if policy.ip_multiple:
        await enforce(
            _IP_LIMITERS[bucket],
            f"{bucket}:ip:{rate_address(request)}",
            shared=policy.shared,
            cost=cost,
            message=message,
        )


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: DbSession,
) -> User:
    """Resolve and validate the caller.

    The token carries a role claim, but authorization reads the role from the
    **database** row, not from the token. A token is valid for 15 minutes; if a
    user is deactivated or demoted inside that window, a token-derived role
    would keep working until expiry. One indexed primary-key lookup per request
    is a cheap price for immediate revocation.
    """
    if credentials is None or not credentials.credentials:
        raise AuthenticationError("Authentication required.")

    verifier: TokenVerifier = get_token_verifier()
    try:
        claims = verifier.verify(credentials.credentials)
    except InvalidToken as exc:
        raise AuthenticationError("Invalid or expired token.") from exc

    user = (
        await db.execute(select(User).where(User.id == claims.user_id))
    ).scalar_one_or_none()

    if user is None:
        # The token is well-formed and correctly signed, but its subject no
        # longer exists. 401, not 404 - this is an authentication failure.
        raise AuthenticationError("Invalid or expired token.")
    if not user.is_active:
        raise AuthenticationError("Account is disabled.")

    request.state.actor_id = user.id

    # The per-user ceiling on every authenticated request (classes C, D, F):
    # here, where every route already passes, so a new route cannot be left
    # out. In-process only: a query per request would cost more than it
    # protects. Keyed by user, never by address - a fleet behind one carrier
    # NAT must not share one budget.
    if getattr(request.scope.get("route"), "path", None) not in UNMETERED_ROUTES:
        bucket = "read" if request.method in ("GET", "HEAD") else "write"
        await enforce(_USER_LIMITERS[bucket], f"{bucket}:{user.id}", shared=False)

    # An account still holding the temporary password it was created with may
    # do exactly one thing: change it. Enforced here rather than per-route,
    # because the failure mode is a route somebody forgets to decorate - and
    # a handed-over credential that keeps working is the whole risk.
    # scope["path"], not request.url.path: the latter is rebuilt from the
    # client-controlled Host header, so "Host: x/api/auth/me?" would pass.
    if user.must_reset_password and request.scope["path"] not in PASSWORD_RESET_ALLOWED:
        raise PermissionDeniedError(
            "This account is still using its temporary password. "
            "Change it before doing anything else.",
            code="PASSWORD_RESET_REQUIRED",
        )

    if claims.support_by is not None:
        # Manager support view: the driver's screens, none of the driver's
        # actions. One guard here covers every mutating endpoint at once.
        if request.method != "GET":
            raise PermissionDeniedError("Manager support view is read-only.")
        request.state.support_by = claims.support_by
        logger.info("support view: manager %s read %s as driver user %s", claims.support_by, request.url.path, user.id)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_permission(permission: str) -> Callable[..., object]:
    """Build a dependency asserting the caller holds `permission`.

        @router.post("/drivers")
        async def create_driver(actor = Depends(require_permission(DRIVER_CREATE))):

    Returns the User, so a route needing the actor does not depend twice.
    """

    async def _dependency(user: CurrentUser) -> User:
        if not has_permission(user.role, permission):
            # The permission name is safe to return: it tells a legitimate
            # caller what they lack without revealing anything about the
            # resource or whether it exists.
            raise PermissionDeniedError(
                "You do not have permission to perform this action.",
                details={"required_permission": permission},
            )
        return user

    return _dependency


def require_permission_then_release(permission: str) -> Callable[..., object]:
    """`require_permission`, then end the request's transaction (DBPOOL-02).

    For routes whose only database work is authenticating the caller and
    which then wait on an external provider: the pooled connection goes back
    before the wait instead of sitting idle in transaction through it.
    Commit, not rollback, so the returned User stays readable
    (expire_on_commit=False).
    """
    gate = require_permission(permission)

    async def _dependency(user: Annotated[User, Depends(gate)], db: DbSession) -> User:
        await db.commit()
        return user

    return _dependency


def rate_limit(bucket: str) -> Any:
    """`dependencies=[rate_limit("geocoding")]`: charge the caller's `bucket`
    (core/rate_limit.POLICIES) before the handler runs - before any provider
    call, and before an upload body is read. Declared on the route, like a
    permission, so the limit is visible where the route is.

    A per-address policy (public endpoints) keys on the client address and
    needs no authentication; the rest key on the authenticated user, so an
    anonymous caller is refused 401 before spending anyone's budget.
    """
    if POLICIES[bucket].per_address:

        async def _by_address(request: Request) -> None:
            await charge(bucket, request, rate_address(request))

        _by_address.bucket = bucket  # type: ignore[attr-defined]  # read by the route-coverage test
        return Depends(_by_address)

    async def _by_user(request: Request, user: CurrentUser, db: DbSession) -> None:
        await charge(bucket, request, user.id, db)

    _by_user.bucket = bucket  # type: ignore[attr-defined]
    return Depends(_by_user)


def require_role(*roles: UserRole) -> Callable[..., object]:
    """Role gate, for the rare case where no permission expresses the rule.

    Prefer require_permission. Reach for this only when the check is genuinely
    about identity class rather than capability.
    """

    async def _dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise PermissionDeniedError(
                "You do not have permission to perform this action."
            )
        return user

    return _dependency


async def require_current_driver(user: CurrentUser, db: DbSession) -> Driver:
    """Resolve the caller to their own driver record.

        access token -> users.id -> drivers.user_id -> Driver

    The client never supplies a driver id. Every driver-scoped endpoint takes
    its subject from here, so there is no parameter an attacker could change to
    act as somebody else - which is the whole shape of an IDOR.

    Fails closed in every ambiguous case:

      - caller is not a DRIVER            -> 403
      - no driver profile for this user   -> 403, not 404: the account exists,
                                             it is simply not a driver
      - profile soft-deleted              -> 403
      - driver suspended                  -> 403

    `drivers.user_id` is UNIQUE, so the mapping cannot be ambiguous; a duplicate
    is rejected by the database rather than silently picking a row.
    """
    if user.role is not UserRole.DRIVER:
        raise PermissionDeniedError("This endpoint is for drivers only.")

    driver = (
        await db.execute(
            select(Driver).where(
                Driver.user_id == user.id, Driver.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()

    if driver is None:
        raise PermissionDeniedError(
            "No active driver profile is linked to this account."
        )

    if driver.status is DriverStatus.SUSPENDED:
        raise PermissionDeniedError("This driver profile is suspended.")

    return driver


CurrentDriver = Annotated[Driver, Depends(require_current_driver)]


async def get_client_ip(request: Request) -> str | None:
    """Best-effort client address for audit records.

    Read the way the login limiter reads it (`client_address`): only the
    X-Forwarded-For entries TRUSTED_PROXY_HOPS proxies really appended, from
    the right. The left-most entry is whatever the caller typed, and it was
    landing in every audit row, LOGIN_FAILED included. Still a hint, and
    never used for an authorization decision. A non-address is dropped
    rather than failing the INET column.
    """
    address = request_address(request)
    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return None
