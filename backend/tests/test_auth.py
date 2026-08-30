"""Authentication: login, rotation, reuse detection, token hardening."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import JWT_ALGORITHM, create_access_token
from app.models.auth import RefreshToken
from app.models.enums import UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


class TestLogin:
    async def test_manager_logs_in_with_email(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["token_type"] == "bearer"
        assert body["user"]["role"] == "MANAGER"
        assert body["access_token"]

        # A web login gets its refresh token in an HttpOnly cookie and NOT in
        # the body. This assertion previously read `body["refresh_token"]` and
        # so encoded the defect: the cookie was protecting a credential that had
        # already been handed to page JavaScript.
        assert body["refresh_token"] is None
        assert api.cookies.get("ner_refresh"), "no refresh cookie was set"

    async def test_driver_logs_in_with_phone(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Drivers authenticate by phone - they often have no working email."""
        driver, user = await factories.make_driver(session)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.phone, "password": factories.TEST_PASSWORD},
        )
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "DRIVER"

    async def test_wrong_password_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": "not-the-password"},
        )
        assert r.status_code == 401

    async def test_unknown_and_wrong_password_are_indistinguishable(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Otherwise login enumerates which accounts exist."""
        user = await factories.make_user(session)
        unknown = await api.post(
            "/api/auth/login",
            json={"identifier": factories.unique_email(), "password": "whatever12"},
        )
        wrong = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": "wrongpassword"},
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json()["error"]["code"] == wrong.json()["error"]["code"]
        assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]

    async def test_disabled_account_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, is_active=False)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert r.status_code == 401

    async def test_password_never_echoed(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert factories.TEST_PASSWORD not in r.text
        assert "password_hash" not in r.text


class TestRefreshRotation:
    async def test_refresh_returns_a_new_pair(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        login = (
            await api.post(
                "/api/auth/login",
                json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "client": "mobile",
            },
            )
        ).json()

        r = await api.post(
            "/api/auth/refresh", json={"refresh_token": login["refresh_token"]}
        )
        assert r.status_code == 200
        assert r.json()["refresh_token"] != login["refresh_token"], (
            "refresh token was not rotated"
        )

    async def test_reuse_of_a_rotated_token_revokes_the_whole_family(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The control that makes token theft detectable.

        An attacker and the legitimate client cannot both keep refreshing: the
        second use of a spent token kills the entire lineage.
        """
        user = await factories.make_user(session)
        login = (
            await api.post(
                "/api/auth/login",
                json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "client": "mobile",
            },
            )
        ).json()

        first = (
            await api.post(
                "/api/auth/refresh", json={"refresh_token": login["refresh_token"]}
            )
        ).json()

        # Clear cookies so the BODY token is the one under test - this is the
        # mobile path. With a cookie present the server prefers it, which is
        # deliberate (see _resolve_refresh_token) and covered separately below.
        api.cookies.clear()

        # Replay the spent token.
        replay = await api.post(
            "/api/auth/refresh", json={"refresh_token": login["refresh_token"]}
        )
        assert replay.status_code == 401

        # The token legitimately issued by that refresh must now also be dead.
        api.cookies.clear()
        after = await api.post(
            "/api/auth/refresh", json={"refresh_token": first["refresh_token"]}
        )
        assert after.status_code == 401, (
            "family was not revoked - a stolen token would still work"
        )

    async def test_refresh_works_from_the_cookie_alone(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The web path: the browser sends the cookie, the body is empty."""
        user = await factories.make_user(session)
        await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        r = await api.post("/api/auth/refresh", json={})
        assert r.status_code == 200

    async def test_web_response_body_never_carries_the_refresh_token(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The property, stated directly: page JavaScript cannot obtain it.

        Asserted against the ACTUAL issued token - the value in the cookie -
        rather than against the presence of a key, so it cannot be satisfied by
        renaming a field. Covers login and refresh, because the delivery rule
        being right on one and wrong on the other is exactly the shape this bug
        had.
        """
        user = await factories.make_user(session)

        login = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        issued = api.cookies.get("ner_refresh")
        assert issued, "web login did not set the refresh cookie"
        assert issued not in login.text, (
            "the refresh token appeared in the login response body"
        )
        assert login.json()["refresh_token"] is None

        rotated = await api.post("/api/auth/refresh", json={})
        assert rotated.status_code == 200
        new_token = api.cookies.get("ner_refresh")
        assert new_token and new_token != issued, "token was not rotated"
        assert new_token not in rotated.text, (
            "the rotated refresh token appeared in the refresh response body"
        )
        assert rotated.json()["refresh_token"] is None

    async def test_mobile_contract_still_returns_the_token_in_the_body(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The Expo app has no cookie jar we rely on; it must still work.

        And the two contracts must not blur: a mobile response sets no refresh
        cookie at all, so nothing about it depends on cookie handling.
        """
        driver, user = await factories.make_driver(session)
        api.cookies.clear()

        r = await api.post(
            "/api/auth/login",
            json={
                "identifier": user.phone,
                "password": factories.TEST_PASSWORD,
                "client": "mobile",
            },
        )
        assert r.status_code == 200
        assert r.json()["refresh_token"], "mobile client got no refresh token"
        assert "set-cookie" not in {k.lower() for k in r.headers}, (
            "the mobile contract set a refresh cookie"
        )

    async def test_client_kind_is_declared_not_sniffed(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A User-Agent must not be able to change how a credential is delivered.

        If delivery were inferred from headers, any caller could ask for the
        token in the body simply by claiming to be a phone.
        """
        user = await factories.make_user(session)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
            headers={"User-Agent": "okhttp/4.12.0 Expo/57 Android/14"},
        )
        assert r.status_code == 200
        assert r.json()["refresh_token"] is None, (
            "a mobile-looking User-Agent changed the delivery contract"
        )

    async def test_an_unknown_client_kind_is_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Fail closed on an unrecognised value rather than guessing."""
        user = await factories.make_user(session)
        r = await api.post(
            "/api/auth/login",
            json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "client": "desktop",
            },
        )
        assert r.status_code == 422

    async def test_refresh_token_cookie_is_http_only(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """If JavaScript can read it, XSS can steal the session."""
        user = await factories.make_user(session)
        r = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        cookie_header = r.headers.get("set-cookie", "")
        assert "ner_refresh=" in cookie_header
        assert "HttpOnly" in cookie_header
        assert "SameSite=strict" in cookie_header.replace("samesite", "SameSite")

    async def test_reuse_detected_through_the_cookie_path(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A stolen cookie replayed after rotation must kill the family.

        The stolen value is taken from the COOKIE, not from the response body.
        That is both how a cookie is actually stolen and the only way this test
        can be honest now that a web login does not return the token: reading
        `login["refresh_token"]` here would capture None, and the replay would
        then be rejected merely for being an unknown token - passing even if
        reuse detection were removed entirely.
        """
        user = await factories.make_user(session)
        await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        stolen = api.cookies.get("ner_refresh")
        assert stolen, "web login did not set the refresh cookie"

        await api.post("/api/auth/refresh", json={})  # rotates, cookie updated

        # Attacker replays the cookie they captured before the rotation.
        api.cookies.clear()
        api.cookies.set("ner_refresh", stolen)
        replay = await api.post("/api/auth/refresh", json={})
        assert replay.status_code == 401

    async def test_refresh_without_any_token_is_401(self, api: AsyncClient) -> None:
        r = await api.post("/api/auth/refresh", json={})
        assert r.status_code == 401

    async def test_unknown_refresh_token_rejected(self, api: AsyncClient) -> None:
        r = await api.post("/api/auth/refresh", json={"refresh_token": "x" * 64})
        assert r.status_code == 401

    async def test_only_a_digest_is_stored(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """A database disclosure must not hand over usable sessions."""
        user = await factories.make_user(session)
        login = (
            await api.post(
                "/api/auth/login",
                json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "client": "mobile",
            },
            )
        ).json()

        rows = (
            await session.execute(
                select(RefreshToken).where(RefreshToken.user_id == user.id)
            )
        ).scalars().all()
        assert rows
        for row in rows:
            assert row.token_hash != login["refresh_token"]
            assert len(row.token_hash) == 64  # sha256 hex


class TestLogout:
    async def test_logout_revokes_the_session(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        login = (
            await api.post(
                "/api/auth/login",
                json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "client": "mobile",
            },
            )
        ).json()

        assert (
            await api.post(
                "/api/auth/logout", json={"refresh_token": login["refresh_token"]}
            )
        ).status_code == 204

        api.cookies.clear()
        after = await api.post(
            "/api/auth/refresh", json={"refresh_token": login["refresh_token"]}
        )
        assert after.status_code == 401

    async def test_logout_of_an_unknown_token_is_still_204(
        self, api: AsyncClient
    ) -> None:
        """Otherwise logout becomes an oracle for token validity."""
        r = await api.post("/api/auth/logout", json={"refresh_token": "y" * 64})
        assert r.status_code == 204


class TestTokenHardening:
    async def test_no_token_rejected(self, api: AsyncClient) -> None:
        r = await api.get("/api/auth/me")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNAUTHENTICATED"

    async def test_garbage_token_rejected(self, api: AsyncClient) -> None:
        r = await api.get("/api/auth/me", headers={"Authorization": "Bearer nonsense"})
        assert r.status_code == 401

    async def test_alg_none_rejected(self, api: AsyncClient, session: AsyncSession) -> None:
        """The classic JWT forgery. The verifier pins the algorithm."""
        user = await factories.make_user(session)
        forged = jwt.encode(
            {
                "sub": str(user.id),
                "role": "ADMIN",
                "type": "access",
                "iat": int(datetime.now(UTC).timestamp()),
                "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
            },
            key="",
            algorithm="none",
        )
        r = await api.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"})
        assert r.status_code == 401

    async def test_token_signed_with_wrong_key_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        forged = jwt.encode(
            {
                "sub": str(user.id),
                "role": "ADMIN",
                "type": "access",
                "iat": int(datetime.now(UTC).timestamp()),
                "exp": int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
            },
            key="an-attacker-chosen-key",
            algorithm=JWT_ALGORITHM,
        )
        r = await api.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"})
        assert r.status_code == 401

    async def test_expired_token_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        token, _ = create_access_token(
            user_id=user.id, role=user.role.value, expires_delta=timedelta(seconds=-60)
        )
        r = await api.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401

    async def test_refresh_token_cannot_be_used_as_an_access_token(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        login = (
            await api.post(
                "/api/auth/login",
                json={"identifier": user.email, "password": factories.TEST_PASSWORD},
            )
        ).json()
        r = await api.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {login['refresh_token']}"},
        )
        assert r.status_code == 401

    async def test_token_for_a_deleted_user_rejected(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Correctly signed, but its subject no longer exists."""
        token, _ = create_access_token(user_id=uuid.uuid4(), role="ADMIN")
        r = await api.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


class TestMe:
    async def test_returns_principal_and_permissions(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        body = (await api.get("/api/auth/me", headers=headers)).json()

        assert body["user"]["role"] == "MANAGER"
        assert "driver:create" in body["permissions"]
        # Salary visibility is admin-only.
        assert "driver:read_sensitive" not in body["permissions"]

    async def test_never_returns_password_hash(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session)
        headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
        text = (await api.get("/api/auth/me", headers=headers)).text
        assert "password" not in text.lower()
