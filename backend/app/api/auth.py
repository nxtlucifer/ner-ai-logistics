"""Authentication endpoints."""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import CurrentUser, DbSession, get_client_ip
from app.core.config import get_settings
from app.core.errors import AuthenticationError, RateLimitedError
from app.core.permissions import permissions_for
from app.core.rate_limit import FixedWindowLimiter
from app.schemas.auth import (
    AuthenticatedUser,
    ClientKind,
    LoginRequest,
    LogoutRequest,
    MeResponse,
    RefreshRequest,
    TokenResponse,
)
from app.services import auth as auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])

ClientIp = Annotated[str | None, Depends(get_client_ip)]

REFRESH_COOKIE = "ner_refresh"

# --- Rate limiting --------------------------------------------------------
#
# Module-level so the windows survive between requests; one limiter per policy
# so a busy refresh endpoint cannot consume the login budget.
#
# Keyed on the TCP peer address, NOT on X-Forwarded-For. The forwarded header is
# what `get_client_ip` records for audit, and it is client-controlled - keying a
# limit on it would let one caller reset their own budget by editing a header,
# which is worse than no limit because it looks like one.
_login_ip_limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=1))
_login_id_limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=1))
_refresh_ip_limiter = FixedWindowLimiter(limit=1, window=timedelta(seconds=1))


def _configure_limiters() -> None:
    """Apply settings to the module-level limiters.

    Read at call time rather than import time because tests change the settings
    and clear the cache between cases; binding the numbers at import would pin
    whatever the first test happened to load.
    """
    settings = get_settings()
    window = timedelta(seconds=settings.RATE_LIMIT_WINDOW_SECONDS)
    _login_ip_limiter.limit = settings.LOGIN_RATE_LIMIT_PER_IP
    _login_ip_limiter.window = window
    _login_id_limiter.limit = settings.LOGIN_RATE_LIMIT_PER_IDENTIFIER
    _login_id_limiter.window = window
    _refresh_ip_limiter.limit = settings.REFRESH_RATE_LIMIT_PER_IP
    _refresh_ip_limiter.window = window


def reset_rate_limits() -> None:
    """Drop all limiter state. Test hook, mirroring reset_token_verifier()."""
    for limiter in (_login_ip_limiter, _login_id_limiter, _refresh_ip_limiter):
        limiter.clear()


def _peer(request: Request) -> str:
    """The address the limit is counted against.

    Falls back to a constant when the peer is unknown - an ASGI transport with
    no client, for instance - so an unattributable request shares one budget
    rather than escaping the limit entirely.
    """
    return request.client.host if request.client else "unknown-peer"


def _enforce(limiter: FixedWindowLimiter, key: str) -> None:
    if not get_settings().RATE_LIMIT_ENABLED:
        return
    decision = limiter.check(key)
    if not decision.allowed:
        raise RateLimitedError(
            "Too many attempts. Try again shortly.",
            retry_after=decision.retry_after,
        )


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Store the refresh token where JavaScript cannot reach it.

    httponly    - XSS cannot read it, which is the whole point
    samesite    - strict, so it is not attached to cross-site requests (CSRF)
    secure      - only omitted in development, where the dev server is http
    path        - scoped to the refresh endpoint, so it is not sent on every
                  ordinary API call
    """
    settings = get_settings()
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=not settings.is_development,
        samesite="strict",
        path="/api/auth",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )


def _resolve_refresh_token(request: Request, supplied: str | None) -> str:
    """Cookie first, body second.

    The cookie is preferred so a web client cannot be tricked into sending a
    token an attacker chose (session fixation).
    """
    token = request.cookies.get(REFRESH_COOKIE) or supplied
    if not token:
        raise AuthenticationError("No refresh token supplied.")
    return token


def _token_response(
    response: Response, result: auth_service.AuthResult, client: ClientKind
) -> TokenResponse:
    """Issue credentials in the form the declared client can hold safely.

    ONE function decides this, so the rule cannot be right on login and wrong on
    refresh - which is the shape this bug had: both endpoints set the cookie
    correctly AND also returned the token in the body, so the HttpOnly cookie
    was protecting a secret that had already been handed to JavaScript.

    web    - cookie only. `refresh_token` is omitted from the body entirely, so
             an XSS payload has nothing to read. The cost is that a web client
             cannot recover its session without the cookie, which is the point.
    mobile - body only. There is no cookie jar we rely on; expo-secure-store
             (Keystore/Keychain) is where it goes. The cookie is not set at all,
             so nothing about this response depends on cookie handling.

    The client DECLARES which it is. Nothing here inspects the User-Agent: the
    confidentiality of a 30-day credential must not depend on a header any
    caller can set.
    """
    body = TokenResponse(
        access_token=result.access_token,
        expires_at=result.expires_at,
        user=AuthenticatedUser.model_validate(result.user),
    )
    if client == "mobile":
        body.refresh_token = result.refresh_token
    else:
        _set_refresh_cookie(response, result.refresh_token)
    return body


@router.post("/login", response_model=TokenResponse, summary="Sign in")
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    ip: ClientIp,
) -> TokenResponse:
    """Two limits, because they stop different attacks.

    Per-IP bounds one machine working through many accounts. Per-identifier
    bounds many machines working on one account, which the per-IP limit cannot
    see. Both are checked before the password is verified, so a limited caller
    does not get Argon2 run on their behalf either.

    The identifier is normalised and case-folded first, so `A@b.com` and
    `a@b.com` share one budget rather than being two.
    """
    _configure_limiters()
    _enforce(_login_ip_limiter, f"ip:{_peer(request)}")
    _enforce(_login_id_limiter, f"id:{payload.identifier.strip().casefold()}")

    result = await auth_service.login(
        db,
        identifier=payload.identifier,
        password=payload.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=ip,
    )
    # Success clears the IDENTIFIER budget. Failed attempts on an account are
    # what that limit counts, and a driver who mistyped twice before getting it
    # right should not spend the rest of the window one slip away from lockout.
    #
    # The per-IP budget is deliberately NOT cleared. It counts attempts across
    # every account reached from one address, and a success on one account says
    # nothing about the failures against the others. Clearing it let anyone
    # holding a single valid credential spray without bound - 19 guesses at 19
    # accounts, one login of their own to zero the counter, repeat - which is
    # the exact attack the per-IP limit exists to stop, and the per-identifier
    # limit cannot see it because no single account is guessed twice.
    #
    # The cost is stated rather than hidden: 20 successful logins a minute from
    # one shared address will start meeting 429. That is LOGIN_RATE_LIMIT_PER_IP
    # doing what it says, and it is raised by changing the setting, not by
    # making the limit resettable on demand by any caller who can authenticate.
    _login_id_limiter.reset(f"id:{payload.identifier.strip().casefold()}")
    return _token_response(response, result, payload.client)


@router.post("/refresh", response_model=TokenResponse, summary="Rotate tokens")
async def refresh(
    payload: RefreshRequest,
    request: Request,
    response: Response,
    db: DbSession,
    ip: ClientIp,
) -> TokenResponse:
    """Per-IP only, and deliberately looser than login.

    There is no identifier to key on - the caller presents an opaque token, and
    hashing it into a limiter key would build a map an attacker fills with one
    entry per guess. Refresh is also legitimately bursty: two tabs waking, an
    app resuming, a token expiring mid-task. The limit here bounds a token-
    guessing flood; reuse detection, not this, is what catches a stolen token.
    """
    _configure_limiters()
    _enforce(_refresh_ip_limiter, f"refresh:{_peer(request)}")

    result = await auth_service.refresh(
        db,
        raw_token=_resolve_refresh_token(request, payload.refresh_token),
        user_agent=request.headers.get("user-agent"),
        ip_address=ip,
    )
    return _token_response(response, result, payload.client)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke the session",
)
async def logout(
    payload: LogoutRequest, request: Request, response: Response, db: DbSession
) -> None:
    """Always 204, even for an unknown token.

    Reporting whether the token existed would turn logout into an oracle for
    token validity.
    """
    token = request.cookies.get(REFRESH_COOKIE) or payload.refresh_token
    if token:
        await auth_service.logout(db, raw_token=token)
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.get("/me", response_model=MeResponse, summary="Current principal")
async def me(user: CurrentUser) -> MeResponse:
    return MeResponse(
        user=AuthenticatedUser.model_validate(user),
        permissions=sorted(permissions_for(user.role)),
    )
