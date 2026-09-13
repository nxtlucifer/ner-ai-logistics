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
from typing import Final, Protocol

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

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
    #: Set on a manager support-view token: the manager's user id. Read-only.
    support_by: uuid.UUID | None = None


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

        support_by = None
        if payload.get("support_by"):
            try:
                support_by = uuid.UUID(str(payload["support_by"]))
            except ValueError as exc:
                raise InvalidToken("token is not valid") from exc
        return TokenClaims(user_id=user_id, role=role, support_by=support_by)


class VerifierUnavailable(Exception):
    """The verifier could not reach the key material to make a decision.

    Deliberately NOT a subclass of InvalidToken. A JWKS endpoint that is down is
    our failure, not the caller's, and telling a driver with a perfectly good
    token that their session expired would send them to re-authenticate against
    a service that cannot authenticate anyone. This surfaces as a 5xx instead.
    """


#: Supabase mints access tokens with this audience. Checked explicitly, because
#: the same project also issues tokens for other audiences and PyJWT does not
#: verify `aud` unless asked.
SUPABASE_AUDIENCE: Final[str] = "authenticated"

#: How long a fetched signing key stays usable before the client re-fetches.
#: Supabase rotates asymmetric keys, so this cannot be unbounded; a fetch per
#: request would put the auth path on the network for every call.
_JWKS_CACHE_SECONDS: Final[int] = 600


class SupabaseJWTVerifier:
    """Verifies Supabase-issued access tokens against the project JWKS.

    Used when Supabase Auth owns identity and this service is the hosted
    intelligence plane (routing, accessibility, navigation packages) that the
    manager web app and the driver APK call directly. Those clients hold a
    Supabase session, never one of ours, so `LocalJWTVerifier` would reject
    every request they make.

    WHY THE ROLE IS NOT TAKEN FROM THE TOKEN

    A Supabase access token's `role` claim is `authenticated` for every signed-in
    user - it describes the Postgres role PostgREST will assume, not what the
    person may do in this application. Our authorization model lives in our
    `users` table, and `deps.get_current_user` already reads it from there on
    every request precisely so a demotion takes effect immediately rather than
    at token expiry. `TokenClaims.role` is therefore populated with the token's
    own claim for completeness and is **not** an authorization input. Nothing in
    this application may branch on it.

    WHY `sub` MAPS STRAIGHT TO OUR USER ID

    Our `users.id` IS `auth.users.id` - both clients look their row up with
    `.eq('id', session.user.id)` after signing in. There is no separate mapping
    table to consult, so this stays a pure function with no database access.

    Hardening, each guarding a specific attack:

    - The algorithm is pinned to the ones we accept and is never read from the
      token header, so `alg: none` and HS256-signed-with-the-public-key
      confusion are rejected before the signature is considered.
    - `aud` and `iss` are both verified. Without the issuer check, a token from
      *any* Supabase project would verify here as soon as its key was fetched.
    - `require` forces exp/iat/sub, so a token with no expiry cannot be treated
      as one that never expires.
    """

    #: Pinned. Supabase's asymmetric signing keys are ES256 (P-256) or RS256
    #: depending on when the project enabled them; both are safe to accept
    #: because the list is ours, not the token's. HS256 is deliberately absent:
    #: a JWKS carries public keys, and accepting a symmetric algorithm against
    #: one is the classic confusion attack.
    ALGORITHMS: Final[tuple[str, ...]] = ("ES256", "RS256")

    def __init__(self, *, supabase_url: str) -> None:
        base = supabase_url.rstrip("/")
        self._issuer = f"{base}/auth/v1"
        self._jwks_client = PyJWKClient(
            f"{self._issuer}/.well-known/jwks.json",
            cache_keys=True,
            lifespan=_JWKS_CACHE_SECONDS,
        )

    def verify(self, token: str) -> TokenClaims:
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
        except PyJWKClientConnectionError as exc:
            # The JWKS endpoint was unreachable. That is our outage, not a bad
            # token, and it must not be reported as one - see VerifierUnavailable.
            # This subclass check must precede PyJWKClientError below, which is
            # its parent.
            raise VerifierUnavailable(str(exc)) from exc
        except PyJWKClientError as exc:
            # The set was fetched but carries no key for this token's `kid` -
            # a token from another project, or one signed by a key that has
            # since been rotated out. That is a bad token.
            raise InvalidToken("token is not valid") from exc
        except jwt.InvalidTokenError as exc:
            raise InvalidToken("token is not valid") from exc

        try:
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=list(self.ALGORITHMS),
                audience=SUPABASE_AUDIENCE,
                issuer=self._issuer,
                options={"require": ["exp", "iat", "sub"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise InvalidToken("token has expired") from exc
        except jwt.InvalidTokenError as exc:
            # Bad signature, wrong audience, wrong issuer, wrong algorithm or a
            # missing required claim. The message stays generic: telling a
            # caller which check failed helps forgery.
            raise InvalidToken("token is not valid") from exc

        try:
            user_id = uuid.UUID(str(payload["sub"]))
        except (KeyError, ValueError) as exc:
            raise InvalidToken("token subject is not a valid user id") from exc

        # See the class docstring: carried, never trusted for authorization.
        role = payload.get("role")
        return TokenClaims(
            user_id=user_id, role=role if isinstance(role, str) and role else "unknown"
        )


_verifier: TokenVerifier | None = None


def get_token_verifier() -> TokenVerifier:
    """The single place the identity provider is chosen.

    `AUTH_PROVIDER=supabase` is what a hosted deployment of the intelligence
    plane runs, because its callers authenticate against Supabase. The default
    stays `local` so nothing about the existing FastAPI-issued-token path
    changes without being asked for.
    """
    global _verifier
    if _verifier is None:
        settings = get_settings()
        if settings.AUTH_PROVIDER == "supabase":
            if not settings.SUPABASE_URL:
                # Refuse rather than silently falling back to the local
                # verifier, which would reject every real caller with a 401 and
                # look like a credentials problem instead of a config one.
                raise RuntimeError(
                    "AUTH_PROVIDER=supabase requires SUPABASE_URL to be set."
                )
            _verifier = SupabaseJWTVerifier(supabase_url=settings.SUPABASE_URL)
        else:
            _verifier = LocalJWTVerifier()
    return _verifier


def reset_token_verifier() -> None:
    """Test hook: drop the cached verifier."""
    global _verifier
    _verifier = None
