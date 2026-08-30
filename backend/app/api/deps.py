"""Request dependencies: database session, current user, permission gates.

Every protected route goes through `require_permission(...)`. Routes never
inspect `user.role` themselves - that pattern spreads authorization logic across
every endpoint, where one missed check is invisible.
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.verifier import InvalidToken, TokenVerifier, get_token_verifier
from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.permissions import has_permission
from app.db.session import get_session
from app.models.enums import DriverStatus, UserRole
from app.models.identity import Driver, User

# auto_error=False so a missing header raises our own 401 envelope rather than
# FastAPI's default shape, keeping every error response identical.
_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_session)]


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

    X-Forwarded-For is client-controlled unless a trusted proxy overwrites it,
    so this is recorded as a hint and never used for an authorization decision.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:45] or None
    return request.client.host if request.client else None
