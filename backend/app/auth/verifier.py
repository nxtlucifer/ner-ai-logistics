"""Token verification, behind a swappable interface.

The application authenticates with its own JWTs today (docs/SECURITY.md section
1). Supabase Auth remains a live option for the driver app, mainly for phone OTP
- see docs/ARCHITECTURE.md section 11.

Everything that needs to know *who is calling* depends on the TokenVerifier
protocol rather than on PyJWT directly, so adopting Supabase Auth later means
adding one class here and changing one line in the factory. No route, service or
test changes.

What must NOT change when the verifier changes: authorization. Roles and
permissions are the application's own concern (app/core/permissions.py), decided
from our `users` table. An identity provider tells us *who* the caller is; it
never tells us *what they may do*.
"""

import uuid
from dataclasses import dataclass
from typing import Protocol

import jwt

from app.core.config import get_settings
from app.core.security import ACCESS_TOKEN_TYPE, JWT_ALGORITHM


class InvalidToken(Exception):
    """Token absent, malformed, expired, wrongly signed, or of the wrong type."""


@dataclass(frozen=True, slots=True)
class TokenClaims:
    """The verified identity of a caller.

    Deliberately minimal: a subject and the role the server itself signed.
    Anything else a caller sends is data, not identity.
    """

    user_id: uuid.UUID
    role: str


class TokenVerifier(Protocol):
    """Turns a bearer token into verified claims, or raises InvalidToken."""

    def verify(self, token: str) -> TokenClaims: ...


class LocalJWTVerifier:
    """Verifies tokens this application issued.

    Hardening notes, each guarding a specific known attack:

    - `algorithms=[JWT_ALGORITHM]` is pinned, so `alg: none` and HS256/RS256
      confusion are rejected before the signature is even considered.
    - `require` forces the presence of exp/iat/sub, so a token missing an expiry
      cannot be treated as one that never expires.
    - the `type` claim is checked, so a refresh token cannot be presented as an
      access token.
    """

    def verify(self, token: str) -> TokenClaims:
        settings = get_settings()
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[JWT_ALGORITHM],
                options={"require": ["exp", "iat", "sub"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise InvalidToken("token has expired") from exc
        except jwt.InvalidTokenError as exc:
            # Covers bad signature, malformed token, wrong algorithm and
            # missing required claims. The message is deliberately generic:
            # telling a caller *why* a token failed helps forgery.
            raise InvalidToken("token is not valid") from exc

        if payload.get("type") != ACCESS_TOKEN_TYPE:
            raise InvalidToken("token is not an access token")

        try:
            user_id = uuid.UUID(str(payload["sub"]))
        except (KeyError, ValueError) as exc:
            raise InvalidToken("token subject is not a valid user id") from exc

        role = payload.get("role")
        if not isinstance(role, str) or not role:
            raise InvalidToken("token has no role claim")

        return TokenClaims(user_id=user_id, role=role)


# Placeholder for the Supabase path, documented so the shape is agreed before
# anyone needs it:
#
# class SupabaseJWTVerifier:
#     """Verifies Supabase-issued tokens against the project JWKS (RS256).
#
#     Would map `sub` (auth.users.id) to our users row, and would still read the
#     role from OUR database rather than from the token, because Supabase does
#     not own our authorization model.
#     """
#
# Adding it means implementing verify() and extending get_token_verifier().


_verifier: TokenVerifier | None = None


def get_token_verifier() -> TokenVerifier:
    """The single place the identity provider is chosen."""
    global _verifier
    if _verifier is None:
        _verifier = LocalJWTVerifier()
    return _verifier


def reset_token_verifier() -> None:
    """Test hook: drop the cached verifier."""
    global _verifier
    _verifier = None
