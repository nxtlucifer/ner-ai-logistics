"""The hierarchy through the API a client actually calls.

The service-level rules are proved in test_state_district_scope.py. What is
asserted here is that the HTTP layer applies them - a rule enforced in a
function nothing calls is not enforced at all.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import UserRole
from app.models.identity import User
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture
async def manager_headers(api: AsyncClient, session: AsyncSession) -> dict:
    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


def _email(prefix: str) -> str:
    """Unique per run. Cleanup DEACTIVATES users rather than deleting them
    (an audit row pins its actor), so a fixed address would be taken the
    second time the suite ran."""
    return f"{prefix}.{uuid.uuid4().hex[:8]}@example.invalid"


async def _sm(api: AsyncClient, session: AsyncSession, state_slug="assam"):
    state = await factories.get_state(session, state_slug)
    user = await factories.make_user(
        session, role=UserRole.STATE_MANAGER, state_id=state.id
    )
    return user, state, await auth_headers(api, user.email, factories.TEST_PASSWORD)


class TestStatesAndDistricts:
    async def test_the_eight_states_are_served_with_their_counts(
        self, api, session, manager_headers
    ):
        r = await api.get("/api/org/states", headers=manager_headers)
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 8
        assert {s["name"] for s in body} >= {"Assam", "Sikkim", "Tripura"}
        assert all("source_name" in s and s["source_name"] for s in body)

    async def test_districts_of_a_state_are_listed(self, api, session, manager_headers):
        """Listed - and only while the district has a provenance.

        The endpoint feeds pickers and counts, so it answers with the
        operational directory, not with every row in the table. A fixture
        borrows a provenance for the length of the call.
        """
        district = await factories.make_district(session, slug="api-list")
        async with factories.operational(session, district):
            r = await api.get(
                f"/api/org/districts?state_id={district.state_id}",
                headers=manager_headers,
            )
            assert r.status_code == 200
            assert district.slug in {d["slug"] for d in r.json()}

        after = await api.get(
            f"/api/org/districts?state_id={district.state_id}", headers=manager_headers
        )
        assert district.slug not in {d["slug"] for d in after.json()}


class TestCreatingADistrictManager:
    async def test_a_state_manager_creates_one_inside_their_own_state(
        self, api, session
    ):
        actor, state, headers = await _sm(api, session)
        district = await factories.make_district(session, slug="create-ok")
        r = await api.post(
            "/api/org/managers",
            headers=headers,
            json={
                "email": _email("kamrup.test"),
                "display_name": "Kamrup District Manager",
                "district_id": str(district.id),
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["manager"]["role"] == "DISTRICT_MANAGER"
        assert body["manager"]["district_id"] == str(district.id)
        assert body["manager"]["must_reset_password"] is True
        # Shown once, and long enough to be worth nothing to a guesser.
        assert len(body["temporary_password"]) >= 10

    async def test_creating_across_the_border_is_refused(self, api, session):
        actor, state, headers = await _sm(api, session, "assam")
        away = await factories.make_district(
            session, state_slug="nagaland", slug="create-away"
        )
        email = _email("across")
        r = await api.post(
            "/api/org/managers",
            headers=headers,
            json={
                "email": email,
                "display_name": "Wrong State",
                "district_id": str(away.id),
            },
        )
        assert r.status_code == 403
        # And nothing was written.
        assert (
            await session.execute(
                select(User).where(User.email == email)
            )
        ).scalar_one_or_none() is None

    async def test_a_district_manager_cannot_create_anyone(self, api, session):
        district = await factories.make_district(session, slug="dm-cannot")
        dm = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=district.state_id,
            district_id=district.id,
        )
        headers = await auth_headers(api, dm.email, factories.TEST_PASSWORD)
        r = await api.post(
            "/api/org/managers",
            headers=headers,
            json={
                "email": _email("nope"),
                "display_name": "Nope",
                "district_id": str(district.id),
            },
        )
        assert r.status_code == 403

    async def test_a_second_active_manager_for_one_district_is_a_clear_409(
        self, api, session
    ):
        actor, state, headers = await _sm(api, session)
        district = await factories.make_district(session, slug="create-dup")
        payload = {
            "email": _email("first"),
            "display_name": "First",
            "district_id": str(district.id),
        }
        assert (
            await api.post("/api/org/managers", headers=headers, json=payload)
        ).status_code == 201
        r = await api.post(
            "/api/org/managers",
            headers=headers,
            json={**payload, "email": _email("second")},
        )
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "DISTRICT_MANAGER_EXISTS"

    async def test_listing_shows_only_this_state_managers_own_people(
        self, api, session
    ):
        actor, state, headers = await _sm(api, session, "assam")
        mine = await factories.make_district(session, state_slug="assam", slug="l-mine")
        theirs = await factories.make_district(
            session, state_slug="mizoram", slug="l-theirs"
        )
        ours = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        outsider = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=theirs.state_id,
            district_id=theirs.id,
        )
        r = await api.get("/api/org/managers", headers=headers)
        assert r.status_code == 200
        ids = {m["id"] for m in r.json()}
        assert str(ours.id) in ids
        assert str(outsider.id) not in ids


class TestDeactivation:
    async def test_retires_one_and_frees_the_district(self, api, session):
        actor, state, headers = await _sm(api, session)
        district = await factories.make_district(session, slug="retire")
        created = (
            await api.post(
                "/api/org/managers",
                headers=headers,
                json={
                    "email": _email("retiring"),
                    "display_name": "Outgoing",
                    "district_id": str(district.id),
                },
            )
        ).json()["manager"]

        r = await api.post(
            f"/api/org/managers/{created['id']}/deactivate", headers=headers
        )
        assert r.status_code == 200 and r.json()["is_active"] is False

        # The slot is free, so a successor can be appointed.
        assert (
            await api.post(
                "/api/org/managers",
                headers=headers,
                json={
                    "email": _email("incoming"),
                    "display_name": "Incoming",
                    "district_id": str(district.id),
                },
            )
        ).status_code == 201

    async def test_cannot_deactivate_across_the_border(self, api, session):
        actor, state, headers = await _sm(api, session, "assam")
        away = await factories.make_district(
            session, state_slug="tripura", slug="retire-away"
        )
        outsider = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=away.state_id,
            district_id=away.id,
        )
        r = await api.post(
            f"/api/org/managers/{outsider.id}/deactivate", headers=headers
        )
        assert r.status_code == 403
        assert (await session.get(User, outsider.id)).is_active is True


class TestTemporaryPasswordGate:
    async def test_a_new_manager_may_do_nothing_but_change_their_password(
        self, api, session
    ):
        actor, state, headers = await _sm(api, session)
        district = await factories.make_district(session, slug="gate")
        email = _email("gated")
        created = (
            await api.post(
                "/api/org/managers",
                headers=headers,
                json={
                    "email": email,
                    "display_name": "Gated",
                    "district_id": str(district.id),
                },
            )
        ).json()
        temp = created["temporary_password"]
        new_headers = await auth_headers(api, email, temp)

        # Every ordinary route is shut, with a code the client can route on.
        blocked = await api.get("/api/trips", headers=new_headers)
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "PASSWORD_RESET_REQUIRED"

        # A forged Host header rewrites request.url.path (starlette builds the
        # URL from it) but not the path that was actually routed. The gate must
        # judge the routed path, or this Host walks straight past it.
        forged = await api.get(
            "/api/trips", headers={**new_headers, "Host": "testserver/api/auth/me?"}
        )
        assert forged.status_code == 403
        assert forged.json()["error"]["code"] == "PASSWORD_RESET_REQUIRED"

        # /me still answers, or the client could not learn why it was refused.
        assert (await api.get("/api/auth/me", headers=new_headers)).status_code == 200

        # The wrong current password does not open it either.
        assert (
            await api.post(
                "/api/auth/password",
                headers=new_headers,
                json={"current_password": "not-the-one", "new_password": "a-real-one-9"},
            )
        ).status_code == 401

        changed = await api.post(
            "/api/auth/password",
            headers=new_headers,
            json={"current_password": temp, "new_password": "a-real-one-9"},
        )
        assert changed.status_code == 200
        assert changed.json()["user"]["must_reset_password"] is False

        # And now the account works normally.
        after = await auth_headers(api, email, "a-real-one-9")
        assert (await api.get("/api/trips", headers=after)).status_code == 200

    async def test_the_new_password_must_differ(self, api, session):
        actor, state, headers = await _sm(api, session)
        district = await factories.make_district(session, slug="gate-same")
        email = _email("same")
        temp = (
            await api.post(
                "/api/org/managers",
                headers=headers,
                json={
                    "email": email,
                    "display_name": "Same",
                    "district_id": str(district.id),
                },
            )
        ).json()["temporary_password"]
        h = await auth_headers(api, email, temp)
        r = await api.post(
            "/api/auth/password",
            headers=h,
            json={"current_password": temp, "new_password": temp},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "PASSWORD_UNCHANGED"
