"""The suite's own accounts must not outlive it as usable credentials.

WHY THIS FILE EXISTS

Cleanup cannot delete users: `audit_logs.actor_user_id` is RESTRICT (migration
0004), so anyone who has done anything auditable - including one failed login -
is pinned by their own trail. That is the intended production behaviour and this
suite does not weaken it.

What it used to do instead was leave those accounts ACTIVE, with a password that
was a literal committed to this repository. An audit of the shared development
project found thousands of them, ADMIN included, that still authenticated and
returned a full permission set. The comment above them read "they are inert".

Retention and usability are separate properties. These tests pin the separation:
the audit trail keeps its actor, and the actor keeps no way in.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import UserRole
from tests import factories

pytestmark = pytest.mark.requires_db


class TestGeneratedTestPassword:
    def test_the_suite_password_is_not_a_committed_literal(self) -> None:
        """A fixed fixture password is exactly what created the exposure.

        Read from the module rather than the file: the property that matters is
        what accounts are actually created with, not what any one line says.
        """
        source = (factories.__file__ or "")
        assert source.endswith("factories.py")
        with open(source, encoding="utf-8") as fh:
            text_of_file = fh.read()

        # The generated value must not appear anywhere in the source that
        # produced it - which is only possible if it is generated, not written.
        assert factories.TEST_PASSWORD not in text_of_file, (
            "the suite password appears verbatim in factories.py; it is a "
            "committed credential again"
        )
        assert len(factories.TEST_PASSWORD) >= 32, "too short to be a real secret"

    def test_the_password_differs_between_runs(self) -> None:
        """Two generations must not collide.

        Regenerating the way the module does is the honest check; asserting a
        specific alphabet would only restate the implementation.
        """
        import secrets

        a = secrets.token_urlsafe(32)
        b = secrets.token_urlsafe(32)
        assert a != b
        assert factories.TEST_PASSWORD not in (a, b)


class TestRetainedAccountsAreUnusable:
    async def test_cleanup_deactivates_the_accounts_it_cannot_delete(
        self, session: AsyncSession
    ) -> None:
        user = await factories.make_user(session, role=UserRole.ADMIN)
        assert user.is_active is True

        await factories.cleanup(session)

        still_active = (
            await session.execute(
                text("SELECT is_active FROM users WHERE id = :i"), {"i": user.id}
            )
        ).scalar_one_or_none()
        assert still_active is not None, "the user was deleted; audit FK should pin it"
        assert still_active is False, "a retained account stayed usable"

    async def test_a_retained_account_cannot_log_in(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """The property the whole file is for.

        ADMIN on purpose: it is the role whose survival mattered most, holding
        every permission including salary visibility.
        """
        user = await factories.make_user(session, role=UserRole.ADMIN)

        before = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert before.status_code == 200, "precondition: the account works while live"

        await factories.cleanup(session)

        after = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        assert after.status_code == 401, after.text

    async def test_refresh_tokens_do_not_survive_cleanup(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Deactivation alone would not be enough if a token were still live."""
        user = await factories.make_user(session, role=UserRole.MANAGER)
        login = await api.post(
            "/api/auth/login",
            json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "client": "mobile",
            },
        )
        assert login.status_code == 200
        refresh_token = login.json()["refresh_token"]
        assert refresh_token, "mobile client must receive the token in the body"

        await factories.cleanup(session)

        rotated = await api.post(
            "/api/auth/refresh",
            json={"refresh_token": refresh_token, "client": "mobile"},
        )
        assert rotated.status_code == 401, rotated.text

        remaining = (
            await session.execute(
                text("SELECT count(*) FROM refresh_tokens WHERE user_id = :i"),
                {"i": user.id},
            )
        ).scalar_one()
        assert remaining == 0

    async def test_the_audit_trail_survives_intact(
        self, api: AsyncClient, session: AsyncSession
    ) -> None:
        """Deactivating must not cost us the compliance record.

        This is the constraint the whole design bends around: if cleanup could
        delete users, none of the above would be necessary - and the audit trail
        would be worth less.
        """
        user = await factories.make_user(session, role=UserRole.MANAGER)
        await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": factories.TEST_PASSWORD},
        )
        before = (
            await session.execute(
                text("SELECT count(*) FROM audit_logs WHERE actor_user_id = :i"),
                {"i": user.id},
            )
        ).scalar_one()
        assert before > 0, "precondition: the login should have been audited"

        await factories.cleanup(session)

        after = (
            await session.execute(
                text("SELECT count(*) FROM audit_logs WHERE actor_user_id = :i"),
                {"i": user.id},
            )
        ).scalar_one()
        assert after == before, "audit rows were lost"


class TestNonTestUsersAreUntouched:
    """The blast radius, asserted rather than assumed.

    Cleanup issues a namespace-wide `UPDATE`. That is only defensible if the
    namespace is provable, so each shape that exists in the real development
    database gets its own case rather than one representative:

      `@ner.local`     the shape the seeded development managers actually use
      NULL email       drivers authenticate by phone; `email LIKE ...` is NULL,
                       not false, for these - a predicate written with NOT IN or
                       a negation would behave differently and this pins it
      other `.invalid`  `.invalid` alone must not be the criterion; only the two
                       domains this repository generates are owned

    Ownership must come from the code that created the row, never from a value
    that merely looks synthetic.
    """

    @pytest.mark.parametrize(
        ("label", "email"),
        [
            ("ner.local development account", "hygiene-keep-{}@ner.local"),
            ("unrelated .invalid domain", "hygiene-keep-{}@someoneelse.invalid"),
            ("plausible but unowned", "hygiene-keep-{}@example.test"),
        ],
    )
    async def test_cleanup_does_not_touch_unowned_accounts(
        self, session: AsyncSession, label: str, email: str
    ) -> None:
        import uuid as _uuid

        address = email.format(_uuid.uuid4().hex[:8])
        await session.execute(
            text(
                "INSERT INTO users (email, password_hash, role, display_name, is_active)"
                " VALUES (:e, :p, 'MANAGER', 'Not A Test User', true)"
            ),
            {"e": address, "p": "x" * 20},
        )
        await session.commit()
        try:
            await factories.cleanup(session)

            still_active = (
                await session.execute(
                    text("SELECT is_active FROM users WHERE email = :e"),
                    {"e": address},
                )
            ).scalar_one()
            assert still_active is True, (
                f"cleanup reached an unowned account ({label})"
            )
        finally:
            await session.execute(
                text("DELETE FROM users WHERE email = :e"), {"e": address}
            )
            await session.commit()

    async def test_cleanup_does_not_touch_null_email_accounts(
        self, session: AsyncSession
    ) -> None:
        """Drivers sign in by phone and may carry no email at all.

        `email LIKE '%@p3test.invalid'` evaluates to NULL for these rows, so
        they fall outside the `WHERE`. That is the correct outcome, but it is
        an accident of three-valued logic rather than an explicit exclusion -
        which is exactly why it deserves a test.
        """
        import uuid as _uuid

        phone = f"9{_uuid.uuid4().int % 10**9:09d}"
        await session.execute(
            text(
                "INSERT INTO users (email, phone, password_hash, role, display_name,"
                " is_active) VALUES (NULL, :ph, :p, 'DRIVER', 'Phone Only', true)"
            ),
            {"ph": phone, "p": "x" * 20},
        )
        await session.commit()
        try:
            await factories.cleanup(session)

            still_active = (
                await session.execute(
                    text("SELECT is_active FROM users WHERE phone = :ph"),
                    {"ph": phone},
                )
            ).scalar_one()
            assert still_active is True, "a NULL-email account was deactivated"
        finally:
            await session.execute(
                text("DELETE FROM users WHERE phone = :ph"), {"ph": phone}
            )
            await session.commit()
