"""Authentication service: login, refresh rotation, revocation.

Implements docs/SECURITY.md section 1.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthenticationError
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.models.auth import RefreshToken
from app.models.enums import AuditAction
from app.models.identity import User
from app.services import audit

logger = logging.getLogger(__name__)

# A precomputed Argon2id hash of a fixed dummy value. When no user matches, we
# still verify against this so the response time for "unknown identifier" and
# "wrong password" is comparable. Without it, login latency alone enumerates
# valid phone numbers - and driver identifiers are phone numbers.
_DUMMY_HASH = hash_password("timing-equalisation-placeholder")


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


async def login(
    db: AsyncSession,
    *,
    identifier: str,
    password: str,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> AuthResult:
    """Authenticate by email (managers) or phone (drivers).

    Every failure returns the same message and takes comparable time, so the
    endpoint cannot be used to discover which accounts exist.
    """
    normalised = identifier.strip()
    user = (
        await db.execute(
            select(User).where(
                or_(
                    User.email.isnot(None) & (User.email.ilike(normalised)),
                    User.phone == normalised,
                )
            )
        )
    ).scalar_one_or_none()

    # Always run a verification, even with no user, to equalise timing.
    stored_hash = user.password_hash if user is not None else _DUMMY_HASH
    password_ok = verify_password(password, stored_hash)

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
