"""Authentication contracts."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field

from app.models.enums import UserRole

#: One floor for every sign-in a person gets. Matches scripts/create_user.py.
MIN_PASSWORD_LENGTH = 8
from app.schemas.common import APIModel, ReadModel

#: How the caller will hold its refresh token. Declared by the client, never
#: inferred.
#:
#: `web`    - the token goes into an HttpOnly cookie and is NEVER placed in the
#:            response body, so no script on the page can read it.
#: `mobile` - there is no cookie jar worth relying on, so the token is returned
#:            in the body for expo-secure-store (Keystore/Keychain).
#:
#: Defaulting to `web` is the fail-safe direction: a client that forgets to
#: declare itself gets the MORE restrictive treatment and simply cannot read the
#: token, rather than silently being handed one.
#:
#: Declared rather than sniffed on purpose. User-Agent detection would make the
#: confidentiality of a long-lived credential depend on a header any caller can
#: set - and would leave the behaviour ambiguous for anything that looks like
#: neither. See docs/SECURITY.md section 1.
ClientKind = Literal["web", "mobile"]

#: Which console the person is asking for. Checked against the account, not
#: trusted from it.
Workspace = Literal["NORTH_EAST", "STATE", "DISTRICT"]


class LoginRequest(APIModel):
    """Email for managers, phone for drivers - one field, resolved server-side.

    A single `identifier` rather than separate email/phone fields keeps the
    failure response identical regardless of which kind was supplied, so the
    endpoint cannot be used to learn which identifiers exist.
    """

    identifier: Annotated[str, Field(min_length=3, max_length=255)]
    password: Annotated[str, Field(min_length=8, max_length=200)]
    client: ClientKind = "web"

    # --- Workspace, which is a HINT and never a grant --------------------
    #
    # The picker on the login page tells the server which console the person
    # believes they are signing in to. The server checks it against the
    # account's real scope and refuses a mismatch with the same generic
    # error as a wrong password - because a distinct message would turn the
    # form into an oracle for "which state is this address a manager of".
    #
    # Sending nothing skips the check entirely, so every existing client,
    # the driver app included, keeps working unchanged.
    workspace: Workspace | None = None
    workspace_state_id: uuid.UUID | None = None
    workspace_district_id: uuid.UUID | None = None


class RefreshRequest(APIModel):
    """Optional in the body.

    The web client never sees its refresh token: it lives in an HttpOnly cookie
    the browser attaches automatically, so JavaScript - and therefore any XSS -
    cannot read it. The mobile client has no cookie jar we want to rely on and
    sends it explicitly from expo-secure-store. See docs/SECURITY.md section 1.
    """

    refresh_token: Annotated[str, Field(min_length=16, max_length=512)] | None = None
    client: ClientKind = "web"


class LogoutRequest(APIModel):
    refresh_token: Annotated[str, Field(min_length=16, max_length=512)] | None = None


class AuthenticatedUser(ReadModel):
    id: uuid.UUID
    role: UserRole
    display_name: str
    email: str | None
    phone: str | None
    #: Administrative scope, for a manager the hierarchy applies to. Null for
    #: ADMIN, DRIVER and the pre-existing fleet-wide MANAGER.
    state_id: uuid.UUID | None = None
    district_id: uuid.UUID | None = None
    #: True while the account still holds the temporary password it was
    #: created with. Every route except the password change refuses, so the
    #: client must send the user straight to that screen.
    must_reset_password: bool = False


class TokenResponse(ReadModel):
    """Issued credentials.

    `refresh_token` is **absent for web callers**. It is a long-lived credential:
    putting it in a response body hands it to any script running on the page, so
    an XSS payload could exfiltrate a token good for 30 days rather than the 15
    minutes an access token is worth. The HttpOnly cookie set alongside is what
    the browser uses, and script cannot read it.

    Present only when the caller declared `client: "mobile"`, which has no cookie
    jar we rely on and stores it in the device keystore instead.
    """

    access_token: str
    refresh_token: str | None = None
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


class PasswordChange(APIModel):
    """Change your own password.

    `current_password` is required even when the account is in the forced
    reset: a phone left unlocked on a seat must not be enough to take over an
    account, and the temporary password is exactly the credential most likely
    to have been read over someone's shoulder.
    """

    current_password: Annotated[str, Field(min_length=1, max_length=200)]
    new_password: Annotated[str, Field(min_length=MIN_PASSWORD_LENGTH, max_length=200)]
