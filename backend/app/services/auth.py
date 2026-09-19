"""Authentication service: login, refresh rotation, revocation.

Implements docs/SECURITY.md section 1.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthenticationError
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password_async,
)
from app.models.auth import RefreshToken
from app.models.enums import AuditAction, UserRole
from app.models.identity import User
from app.services import audit

logger = logging.getLogger(__name__)

# A precomputed Argon2id hash of a fixed dummy value. When no user matches, we
# still verify against this so the response time for "unknown identifier" and
# "wrong password" is comparable. Without it, login latency alone enumerates
# valid phone numbers - and driver identifiers are phone numbers.
_DUMMY_HASH = hash_password("timing-equalisation-placeholder")


def _indian_mobile_forms(identifier: str) -> set[str]:
    """The stored spellings of one Indian mobile number, or nothing."""
    if "@" in identifier:
        return set()
    digits = "".join(c for c in identifier if c.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10:
        return set()
    return {digits, "+91" + digits, "91" + digits, "0" + digits}


class AuthResult:
    __slots__ = ("user", "access_token", "expires_at", "refresh_token")

    def __init__(
        self, user: User, access_token: str, expires_at: datetime, refresh_token: str
    ) -> None:
        self.user = user
        self.access_token = access_token
        self.expires_at = expires_at
        self.refresh_token = refresh_token


async def _issue(
    db: AsyncSession,
    user: User,
    *,
    family_id: uuid.UUID | None = None,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> AuthResult:
    settings = get_settings()
    access_token, expires_at = create_access_token(
        user_id=user.id, role=user.role.value
    )
    raw_refresh = generate_refresh_token()

    now = datetime.now(UTC)
    record = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        family_id=family_id or uuid.uuid4(),
        issued_at=now,
        expires_at=now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        user_agent=(user_agent or None) and user_agent[:255],
        ip_address=ip_address,
    )
    db.add(record)
    await db.flush()
    return AuthResult(user, access_token, expires_at, raw_refresh)


#: Which roles may sign in to each workspace.
#:
#: ADMIN reaches all three: it is the technical superuser and locking it out
#: of a console during an incident helps nobody. MANAGER - the pre-existing
#: fleet-wide role - is treated as regional, which is what it has always
#: been in practice.
WORKSPACE_ROLES: Final[dict[str, frozenset[UserRole]]] = {
    "NORTH_EAST": frozenset(
        {UserRole.ADMIN, UserRole.MANAGER, UserRole.NORTH_EAST_MANAGER}
    ),
    "STATE": frozenset(
        {UserRole.ADMIN, UserRole.NORTH_EAST_MANAGER, UserRole.STATE_MANAGER}
    ),
    "DISTRICT": frozenset(
        {UserRole.ADMIN, UserRole.NORTH_EAST_MANAGER, UserRole.DISTRICT_MANAGER}
    ),
}


def _workspace_matches(
    user: User,
    workspace: str,
    state_id: uuid.UUID | None,
    district_id: uuid.UUID | None,
) -> bool:
    """Does the console the caller asked for match the account they hold?

    A hint, verified. The account is the authority throughout: this function
    can only ever REFUSE a sign-in, never widen one, so a client that lies
    about its workspace gets less access rather than more.

    A scoped manager must also have picked their own patch. Someone who
    reaches for another state's console with a valid password is either
    confused or probing, and both get the same generic refusal.
    """
    if workspace not in WORKSPACE_ROLES:
        return False
    if user.role not in WORKSPACE_ROLES[workspace]:
        return False
    if user.role is UserRole.STATE_MANAGER:
        return state_id is None or state_id == user.state_id
    if user.role is UserRole.DISTRICT_MANAGER:
        if district_id is not None and district_id != user.district_id:
            return False
        return state_id is None or state_id == user.state_id
    # Unscoped roles may open any console; there is nothing to mismatch.
    return True


async def login(
    db: AsyncSession,
    *,
    identifier: str,
    password: str,
    user_agent: str | None = None,
    ip_address: str | None = None,
    workspace: str | None = None,
    workspace_state_id: uuid.UUID | None = None,
    workspace_district_id: uuid.UUID | None = None,
) -> AuthResult:
    """Authenticate by email (managers) or phone (drivers).

    Every failure returns the same message and takes comparable time, so the
    endpoint cannot be used to discover which accounts exist.
    """
    normalised = identifier.strip()
    # Compared, never matched as a LIKE pattern: "%%%" used to hit every
    # account and turn a 401 into a 503. The phone variants cover the one
    # number written as 98..., +9198... or 098...; the app sends ten digits.
    phones = {normalised} | _indian_mobile_forms(normalised)
    rows = (
        await db.execute(
            select(User).where(
                or_(
                    func.lower(User.email) == normalised.lower(),
                    User.phone.in_(phones),
                )
            )
        )
    ).scalars().all()
    exact = [u for u in rows if u.phone == normalised or (u.email or "").lower() == normalised.lower()]
    # An exact match wins; otherwise exactly one variant, never a guess.
    candidates = exact or rows
    user = candidates[0] if len(candidates) == 1 else None

    # Always run a verification, even with no user, to equalise timing.
    stored_hash = user.password_hash if user is not None else _DUMMY_HASH
    # End the read transaction first, so the pooled connection goes back
    # before this login queues for an Argon2 slot. expire_on_commit=False
    # keeps `user` loaded; the writes below open a fresh transaction.
    await db.commit()
    password_ok = await verify_password_async(password, stored_hash)

    if user is None or not password_ok:
        await audit.record(
            db,
            action=AuditAction.LOGIN_FAILED,
            entity_type="users",
            entity_id=user.id if user else None,
            reason="invalid credentials",
            ip_address=ip_address,
        )
        await db.commit()
        raise AuthenticationError("Invalid credentials.")

    if not user.is_active:
        # Distinguished from bad credentials on purpose: the caller proved they
        # hold the password, so telling them the account is disabled reveals
        # nothing they did not already know, and saves a support round trip.
        await audit.record(
            db,
            action=AuditAction.LOGIN_FAILED,
            entity_type="users",
            entity_id=user.id,
            actor_user_id=user.id,
            reason="account disabled",
            ip_address=ip_address,
        )
        await db.commit()
        raise AuthenticationError("Account is disabled.")

    if workspace is not None and not _workspace_matches(
        user, workspace, workspace_state_id, workspace_district_id
    ):
        # The SAME error as a wrong password, deliberately. A distinct
        # message ("wrong state") would let anyone with a list of addresses
        # discover which state each one manages, one guess at a time.
        await audit.record(
            db,
            action=AuditAction.LOGIN_FAILED,
            entity_type="users",
            entity_id=user.id,
            actor_user_id=user.id,
            reason=f"workspace mismatch: asked for {workspace}",
            ip_address=ip_address,
        )
        await db.commit()
        raise AuthenticationError("Invalid credentials.")

    result = await _issue(db, user, user_agent=user_agent, ip_address=ip_address)
    user.last_login_at = datetime.now(UTC)
    await audit.record(
        db,
        action=AuditAction.LOGIN,
        entity_type="users",
        entity_id=user.id,
        actor_user_id=user.id,
        ip_address=ip_address,
    )
    await db.commit()
    return result


async def refresh(
    db: AsyncSession,
    *,
    raw_token: str,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> AuthResult:
    """Exchange a refresh token for a new pair, rotating it.

    Reuse detection: presenting a token that was already rotated away means
    either the token was stolen or the client is buggy. We cannot tell which, so
    the whole family is revoked and the user must log in again. This is what
    makes theft detectable at all - otherwise an attacker and the legitimate
    client simply refresh in parallel forever.
    """
    digest = hash_refresh_token(raw_token)
    token = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == digest))
    ).scalar_one_or_none()

    if token is None:
        raise AuthenticationError("Invalid refresh token.")

    now = datetime.now(UTC)

    if token.revoked_at is not None:
        # Replay of an already-rotated token.
        await _revoke_family(db, token.family_id, reason="reuse_detected")
        await audit.record(
            db,
            action=AuditAction.LOGIN_FAILED,
            entity_type="refresh_tokens",
            entity_id=token.id,
            actor_user_id=token.user_id,
            reason="refresh token reuse detected; family revoked",
            ip_address=ip_address,
        )
        await db.commit()
        logger.warning(
            "Refresh token reuse detected for user %s; family %s revoked",
            token.user_id, token.family_id,
        )
        raise AuthenticationError("Invalid refresh token.")

    if token.expires_at <= now:
        raise AuthenticationError("Refresh token has expired.")

    user = (
        await db.execute(select(User).where(User.id == token.user_id))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise AuthenticationError("Account is disabled.")

    result = await _issue(
        db, user, family_id=token.family_id, user_agent=user_agent, ip_address=ip_address
    )

    # Rotate: the presented token is spent.
    token.revoked_at = now
    token.revoked_reason = "rotated"
    replacement = (
        await db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == hash_refresh_token(result.refresh_token)
            )
        )
    ).scalar_one()
    token.replaced_by_id = replacement.id

    await db.commit()
    return result


async def _revoke_family(
    db: AsyncSession, family_id: uuid.UUID, *, reason: str
) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )


async def revoke_all_for_user(
    db: AsyncSession, user_id: uuid.UUID, *, reason: str = "password changed"
) -> None:
    """End every session this account has.

    A password change that leaves old refresh tokens alive has changed
    nothing for whoever already holds one - which is precisely the case the
    change is being made for.
    """
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )


async def logout(
    db: AsyncSession, *, raw_token: str, actor_user_id: uuid.UUID | None = None
) -> None:
    """Revoke the presented token and its whole family.

    Family-wide because a logout should end the session, not just the newest
    token in it. Silent on an unknown token: logout must not become an oracle
    for whether a token is valid.
    """
    digest = hash_refresh_token(raw_token)
    token = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == digest))
    ).scalar_one_or_none()
    if token is not None:
        await _revoke_family(db, token.family_id, reason="logout")
        await db.commit()
