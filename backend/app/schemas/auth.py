"""Authentication contracts."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field

from app.models.enums import UserRole
from app.schemas.common import APIModel, ReadModel


class LoginRequest(APIModel):
    """Email for managers, phone for drivers - one field, resolved server-side.

    A single `identifier` rather than separate email/phone fields keeps the
    failure response identical regardless of which kind was supplied, so the
    endpoint cannot be used to learn which identifiers exist.
    """

    identifier: Annotated[str, Field(min_length=3, max_length=255)]
    password: Annotated[str, Field(min_length=8, max_length=200)]


class RefreshRequest(APIModel):
    """Optional in the body.

    The web client never sees its refresh token: it lives in an HttpOnly cookie
    the browser attaches automatically, so JavaScript - and therefore any XSS -
    cannot read it. The mobile client has no cookie jar we want to rely on and
    sends it explicitly from expo-secure-store. See docs/SECURITY.md section 1.
    """

    refresh_token: Annotated[str, Field(min_length=16, max_length=512)] | None = None


class LogoutRequest(APIModel):
    refresh_token: Annotated[str, Field(min_length=16, max_length=512)] | None = None


class AuthenticatedUser(ReadModel):
    id: uuid.UUID
    role: UserRole
    display_name: str
    email: str | None
    phone: str | None


class TokenResponse(ReadModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: AuthenticatedUser


class MeResponse(ReadModel):
    """Current principal plus the permissions the server grants them.

    The client uses `permissions` to decide what to *render*. It is never an
    authorization decision - the server re-checks every request regardless of
    what the UI chose to show.
    """

    user: AuthenticatedUser
    permissions: list[str]
