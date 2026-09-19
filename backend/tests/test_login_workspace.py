"""The workspace picker is a hint. The account is the authority.

WHAT THIS DEFENDS

Two opposite mistakes:

  * the picker granting something - a driver choosing "North-East" and
    getting a regional console. It cannot: the check only ever refuses.
  * the picker leaking something - "wrong state for this account" tells
    anyone holding a list of addresses which state each one manages, one
    guess at a time. Every mismatch answers exactly what a wrong password
    answers.

And the compatibility rule: a client that sends no workspace at all - the
driver app, every existing script - is unaffected.
"""

import pytest

from app.models.enums import UserRole
from tests import factories

pytestmark = pytest.mark.requires_db

WRONG = {"code": 401, "message": "Invalid credentials."}


async def _login(api, identifier, **extra):
    return await api.post(
        "/api/auth/login",
        json={"identifier": identifier, "password": factories.TEST_PASSWORD, **extra},
    )


class TestCompatibility:
    async def test_no_workspace_means_no_check(self, api, session):
        """Every existing client keeps working, the driver app included."""
        driver, user = await factories.make_driver(session)
        r = await _login(api, user.phone)
        assert r.status_code == 200

    async def test_a_manager_signing_in_without_a_workspace_still_works(
        self, api, session
    ):
        user = await factories.make_user(session, role=UserRole.MANAGER)
        assert (await _login(api, user.email)).status_code == 200


class TestTheHintIsChecked:
    async def test_a_district_manager_reaches_the_district_console(
        self, api, session
    ):
        d = await factories.make_district(session, slug="ws-ok")
        user = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=d.state_id,
            district_id=d.id,
        )
        r = await _login(
            api,
            user.email,
            workspace="DISTRICT",
            workspace_state_id=str(d.state_id),
            workspace_district_id=str(d.id),
        )
        assert r.status_code == 200, r.text

    async def test_the_wrong_district_is_refused_exactly_like_a_wrong_password(
        self, api, session
    ):
        mine = await factories.make_district(session, slug="ws-mine")
        theirs = await factories.make_district(session, slug="ws-theirs")
        user = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        mismatch = await _login(
            api,
            user.email,
            workspace="DISTRICT",
            workspace_state_id=str(theirs.state_id),
            workspace_district_id=str(theirs.id),
        )
        bad_password = await api.post(
            "/api/auth/login",
            json={"identifier": user.email, "password": "not-the-password"},
        )
        assert mismatch.status_code == bad_password.status_code == 401
        # Byte-identical, so the form cannot be used as an oracle.
        assert mismatch.json()["error"]["message"] == bad_password.json()["error"]["message"]
        assert mismatch.json()["error"]["code"] == bad_password.json()["error"]["code"]

    async def test_a_state_manager_cannot_open_another_states_console(
        self, api, session
    ):
        home = await factories.get_state(session, "assam")
        away = await factories.get_state(session, "nagaland")
        user = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=home.id
        )
        ok = await _login(
            api, user.email, workspace="STATE", workspace_state_id=str(home.id)
        )
        assert ok.status_code == 200
        bad = await _login(
            api, user.email, workspace="STATE", workspace_state_id=str(away.id)
        )
        assert bad.status_code == 401

    async def test_a_district_manager_cannot_reach_the_regional_console(
        self, api, session
    ):
        d = await factories.make_district(session, slug="ws-climb")
        user = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=d.state_id,
            district_id=d.id,
        )
        assert (
            await _login(api, user.email, workspace="NORTH_EAST")
        ).status_code == 401

    async def test_a_driver_cannot_pick_a_manager_console(self, api, session):
        driver, user = await factories.make_driver(session)
        for workspace in ("NORTH_EAST", "STATE", "DISTRICT"):
            r = await _login(api, user.phone, workspace=workspace)
            assert r.status_code == 401, workspace
        # And still signs in normally when it asks for nothing.
        assert (await _login(api, user.phone)).status_code == 200

    async def test_the_regional_manager_may_open_any_console(self, api, session):
        """Looking into a state's console is part of the job; the data it
        shows is still decided by the scope policy, not by this choice."""
        user = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        for workspace in ("NORTH_EAST", "STATE", "DISTRICT"):
            assert (
                await _login(api, user.email, workspace=workspace)
            ).status_code == 200, workspace

    async def test_an_unknown_workspace_is_refused_rather_than_ignored(
        self, api, session
    ):
        user = await factories.make_user(session, role=UserRole.MANAGER)
        r = await api.post(
            "/api/auth/login",
            json={
                "identifier": user.email,
                "password": factories.TEST_PASSWORD,
                "workspace": "ADMIN_GOD_MODE",
            },
        )
        # 422 from the schema is fine; what must not happen is a 200.
        assert r.status_code in (401, 422)


class TestTheHintCannotGrant:
    async def test_choosing_a_console_does_not_change_what_is_returned(
        self, api, session
    ):
        """The session a district manager gets is the same session whatever
        they picked - the picker is not in the token."""
        d = await factories.make_district(session, slug="ws-nogrant")
        user = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=d.state_id,
            district_id=d.id,
        )
        picked = await _login(
            api,
            user.email,
            workspace="DISTRICT",
            workspace_state_id=str(d.state_id),
            workspace_district_id=str(d.id),
        )
        plain = await _login(api, user.email)
        assert picked.status_code == plain.status_code == 200
        me_picked = await api.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {picked.json()['access_token']}"},
        )
        me_plain = await api.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {plain.json()['access_token']}"},
        )
        assert me_picked.json()["permissions"] == me_plain.json()["permissions"]
        assert me_picked.json()["user"]["role"] == me_plain.json()["user"]["role"]
