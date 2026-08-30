"""Authentication endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import CurrentUser, DbSession, get_client_ip
from app.core.config import get_settings
from app.core.errors import AuthenticationError
from app.core.permissions import permissions_for
from app.schemas.auth import (
    AuthenticatedUser,
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


@router.post("/login", response_model=TokenResponse, summary="Sign in")
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    ip: ClientIp,
) -> TokenResponse:
    result = await auth_service.login(
        db,
        identifier=payload.identifier,
        password=payload.password,
        user_agent=request.headers.get("user-agent"),
        ip_address=ip,
    )
    _set_refresh_cookie(response, result.refresh_token)
    # Also returned in the body for the mobile client, which stores it in
    # expo-secure-store. The web client ignores it and uses the cookie.
    return TokenResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        expires_at=result.expires_at,
        user=AuthenticatedUser.model_validate(result.user),
    )


@router.post("/refresh", response_model=TokenResponse, summary="Rotate tokens")
async def refresh(
    payload: RefreshRequest,
    request: Request,
    response: Response,
    db: DbSession,
    ip: ClientIp,
) -> TokenResponse:
    result = await auth_service.refresh(
        db,
        raw_token=_resolve_refresh_token(request, payload.refresh_token),
        user_agent=request.headers.get("user-agent"),
        ip_address=ip,
    )
    _set_refresh_cookie(response, result.refresh_token)
    return TokenResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        expires_at=result.expires_at,
        user=AuthenticatedUser.model_validate(result.user),
    )


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
