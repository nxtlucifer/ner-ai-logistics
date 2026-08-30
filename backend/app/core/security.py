"""Password hashing and token primitives.

Implements docs/SECURITY.md section 1. Two separate concerns live here:

  - password hashing (Argon2id)
  - token minting / opaque-secret generation

Token *verification* deliberately does not live here. It sits behind the
TokenVerifier interface in app/auth/verifier.py so a Supabase Auth JWKS verifier
can replace the local one without touching call sites.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import get_settings

# Parameters from docs/SECURITY.md section 1: t=3, m=64 MiB, p=4.
# Memory-hard by design - bcrypt's 72-byte truncation is a footgun we avoid.
_hasher: Final[PasswordHasher] = PasswordHasher(
    time_cost=3, memory_cost=64 * 1024, parallelism=4
)

# Pinned. Never read the algorithm from the token itself: doing so is what makes
# `alg: none` and RS256/HS256 confusion attacks possible.
JWT_ALGORITHM: Final[str] = "HS256"

ACCESS_TOKEN_TYPE: Final[str] = "access"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time-ish verification that never raises on a bad hash.

    Returns False rather than propagating, so a corrupt stored hash fails the
    login instead of returning a 500 that tells an attacker the account exists.
    """
    try:
        _hasher.verify(password_hash, password)
        return True
    except (VerifyMismatchError, InvalidHashError, Exception):
        return False


def needs_rehash(password_hash: str) -> bool:
    """Whether a stored hash uses outdated parameters."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except Exception:
        return False


def create_access_token(
    *, user_id: uuid.UUID, role: str, expires_delta: timedelta | None = None
) -> tuple[str, datetime]:
    """Mint a short-lived access token.

    Returns (token, expires_at). The role is embedded so every request does not
    need a database round trip - but note the token is only trusted because the
    *server* signed it. A role supplied by a client is never read; see
    app/api/deps.py.
    """
    settings = get_settings()
    now = datetime.now(UTC)
    expires_at = now + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "type": ACCESS_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": secrets.token_urlsafe(16),
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token, expires_at


def generate_refresh_token() -> str:
    """A high-entropy opaque secret.

    Opaque rather than a JWT because refresh tokens must be *revocable*. A
    self-contained JWT cannot be revoked without a denylist, which is the same
    storage cost with worse ergonomics.
    """
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """Store only a digest, never the token itself.

    SHA-256 rather than Argon2: the token is already 384 bits of entropy, so it
    is not brute-forceable and does not need a slow KDF. Using Argon2 here would
    add ~100 ms to every refresh for no security gain.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
