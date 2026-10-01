"""Authentication endpoints."""

import logging
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import (
    CurrentUser,
    DbSession,
    enforce,
    get_client_ip,
    rate_address,
    rate_limit,
)
from app.api.deps import reset_rate_limits as reset_route_rate_limits
from app.core.config import get_settings
from app.core.errors import AuthenticationError, BusinessRuleError
from app.core.permissions import permissions_for
from app.core.security import hash_password_async, verify_password_async
from app.models.enums import AuditAction
from app.core.rate_limit import GcraLimiter
from app.schemas.auth import (
    AuthenticatedUser,
    ClientKind,
    LoginRequest,
    LogoutRequest,
    MeResponse,
    PasswordChange,
    RefreshRequest,
    TokenResponse,
)
from app.services import audit, coordination
from app.services import auth as auth_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

ClientIp = Annotated[str | None, Depends(get_client_ip)]

REFRESH_COOKIE = "ner_refresh"

# --- Rate limiting --------------------------------------------------------
#
# Module-level so the windows survive between requests; one limiter per policy
# so a busy refresh endpoint cannot consume the login budget.
#
# Keyed, like the audit IP `get_client_ip` records, on
# `app/core/rate_limit.client_address`: the TCP peer, or with TRUSTED_PROXY_HOPS
# set, the X-Forwarded-For entry that many trusted proxies appended, read from
# the right. Never the left-most entry - that is whatever the caller typed, and a
# limit keyed on it could be reset by editing one header.
#
# GCRA with burst = limit (docs/RATE_LIMIT_POLICY.md): the numbers mean what
# they always meant for an instant burst, and a window edge no longer doubles
# them.
_login_ip_limiter = GcraLimiter(limit=1, window=timedelta(seconds=1))
_login_id_limiter = GcraLimiter(limit=1, window=timedelta(seconds=1))
_refresh_ip_limiter = GcraLimiter(limit=1, window=timedelta(seconds=1))


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
    """Drop all limiter state, the route budgets in deps.py included. Test
    hook, mirroring reset_token_verifier()."""
    for limiter in (_login_ip_limiter, _login_id_limiter, _refresh_ip_limiter):
        limiter.clear()
    reset_route_rate_limits()


def _peer(request: Request) -> str:
    """The address the limit is counted against.

    SEC-006. This used to be `request.client.host` unconditionally, which
    behind Render's proxy is the proxy - so one budget was shared by every
    client on the internet. It now honours `X-Forwarded-For`, but ONLY as
    many hops as `TRUSTED_PROXY_HOPS` says are really there, and counted
    from the right so a forged header is never read. See
    `app/core/rate_limit.client_address`.

    Falls back to a constant when the peer is unknown - an ASGI transport
    with no client, for instance - so an unattributable request shares one
    budget rather than escaping the limit entirely.
    """
    return rate_address(request)


async def _enforce(limiter: GcraLimiter, key: str, *, per_address: bool = False) -> None:
    """deps.enforce, shared across instances. A per-address budget is never
    reset, so this process's own count is checked first and a flood from one
    address is turned away without taking a connection from the pool every
    other request needs. The identifier budget is reset across instances, so
    with MULTI_INSTANCE it is counted in Postgres only."""
    await enforce(limiter, key, shared=True, local_first=per_address)


async def _reset(limiter: GcraLimiter, key: str) -> None:
    if not get_settings().MULTI_INSTANCE:
        limiter.reset(key)
        return
    # Runs after the login committed its session: failing here would 503 a
    # login whose tokens exist. A budget left uncleared is only stricter.
    try:
        await coordination.reset(key)
    except SQLAlchemyError as exc:
        logger.warning("login budget reset failed, left to expire: %s", type(exc).__name__)


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
        # "strict" when the web client is served from the same site as this
        # API; "none" (with secure) when it is not - on Render every
        # *.onrender.com host is its own site (public-suffix list), so a
        # strict cookie is simply never sent back and every reload logs the
        # manager out. See REFRESH_COOKIE_SAMESITE.
        samesite=settings.REFRESH_COOKIE_SAMESITE,
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
    await _enforce(_login_ip_limiter, f"ip:{_peer(request)}", per_address=True)
    await _enforce(_login_id_limiter, f"id:{payload.identifier.strip().casefold()}")

    result = await auth_service.login(
        db,
        identifier=payload.identifier,
        password=payload.password,
        workspace=payload.workspace,
        workspace_state_id=payload.workspace_state_id,
        workspace_district_id=payload.workspace_district_id,
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
    await _reset(_login_id_limiter, f"id:{payload.identifier.strip().casefold()}")
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
    await _enforce(_refresh_ip_limiter, f"refresh:{_peer(request)}", per_address=True)

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
    dependencies=[rate_limit("public")],
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

@router.post(
    "/password",
    response_model=MeResponse,
    summary="Change your own password",
    # Argon2 verify + hash per call, and a wrong current password is an
    # answer: 5 per 15 min per account, before either runs.
    dependencies=[rate_limit("password")],
)
async def change_password(
    payload: PasswordChange,
    db: DbSession,
    user: CurrentUser,
    request: Request,
) -> MeResponse:
    """The one door a temporary password opens.

    The current password is required even during a forced reset: the
    temporary credential is the one most likely to have been overheard, and
    an unlocked phone on a seat must not be enough to take an account over.

    Every refresh token is revoked on success. A password change that leaves
    old sessions alive has not changed anything for whoever already has one -
    which is the case this exists for.
    """
    # Release the connection get_current_user took before queueing for an
    # Argon2 slot (app/core/security.py); nothing is pending in the session.
    await db.commit()
    if not await verify_password_async(payload.current_password, user.password_hash):
        # Audited, like a failed login: a run of these on one account is the
        # signal that someone is working through a handed-over credential.
        await audit.record(
            db,
            action=AuditAction.LOGIN_FAILED,
            entity_type="users",
            entity_id=user.id,
            actor_user_id=user.id,
            before=None,
            after=None,
            reason="password change refused: wrong current password",
            ip_address=await get_client_ip(request),
        )
        await db.commit()
        raise AuthenticationError("Current password is incorrect.")

    if payload.new_password == payload.current_password:
        raise BusinessRuleError(
            "The new password must be different from the current one.",
            code="PASSWORD_UNCHANGED",
        )

    user.password_hash = await hash_password_async(payload.new_password)
    user.must_reset_password = False
    await auth_service.revoke_all_for_user(db, user.id)
    await audit.record(
        db,
        action=AuditAction.UPDATE,
        entity_type="users",
        entity_id=user.id,
        actor_user_id=user.id,
        before={"must_reset_password": True},
        after={"must_reset_password": False},
        reason="password changed by the account holder",
        ip_address=await get_client_ip(request),
    )
    await db.commit()
    await db.refresh(user)
    return MeResponse(
        user=AuthenticatedUser.model_validate(user),
        permissions=sorted(permissions_for(user.role)),
    )
