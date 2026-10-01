"""A district counts only if somebody vouched for where it came from.

WHAT THIS DEFENDS

The regional dashboard reported "Assam · 141 districts configured". Assam
has no such number in this system: those were 141 pytest fixtures called
things like "Dash Att Other", counted because the query asked how many rows
existed rather than how many were districts.

A count on a screen a ministry might read cannot be the number of rows in a
table. It has to be the number of rows whose provenance was accepted.

THE DEFAULT IS THE POINT

`source_status` defaults to UNVERIFIED, so a row inserted by anything that
has not thought about provenance is EXCLUDED. Getting counted requires a
deliberate act.
"""

import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import select

from app.models.enums import DistrictSource, UserRole
from app.models.geography import District, operational_sources
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@asynccontextmanager
async def promoted(session, district, status: DistrictSource):
    """Mark a district operational for the duration of one test.

    Districts are reference data shared by the whole suite. A test that
    promoted one and walked away would leave every later count off by one -
    which is the same class of bug this file exists to prevent.
    """
    before = district.source_status
    district.source_status = status
    await session.commit()
    try:
        yield district
    finally:
        district.source_status = before
        await session.commit()


async def _states(api, user):
    headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
    r = await api.get("/api/dashboard", headers=headers)
    assert r.status_code == 200, r.text
    return {s["name"]: s for s in r.json()["states"]}


class TestTheDefault:
    async def test_a_row_nobody_classified_is_unverified(self, session):
        """Inserted WITHOUT the factory, which now marks its own rows TEST.

        This is the case that matters: whatever writes a district next -
        a seed script, a migration, somebody in psql - lands on UNVERIFIED
        unless it says otherwise, and is therefore not counted."""
        state = await factories.get_state(session, "assam")
        row = District(
            state_id=state.id,
            name="Unclassified",
            slug=f"prov-default-{uuid.uuid4().hex[:6]}",
            source_name="test fixture - written without declaring a provenance",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        assert row.source_status is DistrictSource.UNVERIFIED

    async def test_unverified_is_not_operational(self):
        assert DistrictSource.UNVERIFIED not in operational_sources()
        assert DistrictSource.TEST not in operational_sources()
        assert DistrictSource.VERIFIED_OFFICIAL in operational_sources()
        assert DistrictSource.DEMO in operational_sources()

    async def test_the_whole_test_suite_creates_only_excluded_rows(self, session):
        """The factory is the biggest writer of districts in this repo. If it
        ever started producing countable rows, every suite run would inflate
        a dashboard."""
        rows = (
            await session.execute(
                select(District).where(
                    District.source_status.in_(operational_sources()),
                    District.source_name.like("test fixture%"),
                )
            )
        ).scalars().all()
        assert rows == [], (
            "a test fixture is being counted as an operational district: "
            + ", ".join(f"{r.name} ({r.source_name[:40]})" for r in rows[:5])
        )


class TestTheRegionalCount:
    async def test_fixtures_are_not_counted(self, api, session):
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        before = (await _states(api, boss))["Assam"]["districts_configured"]
        await factories.make_district(session, state_slug="assam", slug="prov-a")
        await factories.make_district(session, state_slug="assam", slug="prov-b")

        assert (await _states(api, boss))["Assam"]["districts_configured"] == before

    async def test_a_demo_district_is_counted(self, api, session):
        d = await factories.make_district(session, state_slug="assam", slug="prov-demo")
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        before = (await _states(api, boss))["Assam"]["districts_configured"]

        async with promoted(session, d, DistrictSource.DEMO):
            after = (await _states(api, boss))["Assam"]["districts_configured"]
        assert after == before + 1

    async def test_a_verified_district_is_counted(self, api, session):
        d = await factories.make_district(
            session, state_slug="nagaland", slug="prov-official"
        )
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        before = (await _states(api, boss))["Nagaland"]["districts_configured"]

        async with promoted(session, d, DistrictSource.VERIFIED_OFFICIAL):
            after = (await _states(api, boss))["Nagaland"]["districts_configured"]
        assert after == before + 1


class TestTheStateManagerList:
    async def test_a_state_manager_is_not_offered_test_districts(
        self, api, session
    ):
        """The screenshot that started this: "Api List", "Closed A",
        "Create Dup" listed as Assam districts."""
        await factories.make_district(session, state_slug="assam", slug="prov-fixture-1")
        await factories.make_district(session, state_slug="assam", slug="prov-fixture-2")
        real = await factories.make_district(
            session, state_slug="assam", slug="prov-real"
        )
        state = await factories.get_state(session, "assam")
        sm = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=state.id
        )
        headers = await auth_headers(api, sm.email, factories.TEST_PASSWORD)
        async with promoted(session, real, DistrictSource.DEMO):
            body = (await api.get("/api/dashboard", headers=headers)).json()

        # Districts are reference data shared across the suite, so assert
        # the PROPERTY rather than an exact set: no fixture appears, and
        # the operational one does.
        names = {d["name"] for d in body["districts"]}
        assert real.name in names
        assert not {n for n in names if n.startswith("Prov Fixture")}, names


class TestTheDistrictPicker:
    async def test_only_operational_districts_are_offered(self, api, session):
        """The picker feeds account creation. Offering a fixture would let
        somebody appoint a manager of "Dash Att Other"."""
        await factories.make_district(session, state_slug="tripura", slug="prov-pick-x")
        real = await factories.make_district(
            session, state_slug="tripura", slug="prov-pick-ok"
        )
        state = await factories.get_state(session, "tripura")
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)

        async with promoted(session, real, DistrictSource.DEMO):
            r = await api.get(
                f"/api/org/districts?state_id={state.id}", headers=headers
            )
        assert r.status_code == 200
        assert {d["slug"] for d in r.json()} == {real.slug}

    async def test_the_picker_reports_the_provenance_it_accepted(
        self, api, session
    ):
        real = await factories.make_district(
            session, state_slug="sikkim", slug="prov-status"
        )
        state = await factories.get_state(session, "sikkim")
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)

        async with promoted(session, real, DistrictSource.DEMO):
            rows = (
                await api.get(
                    f"/api/org/districts?state_id={state.id}", headers=headers
                )
            ).json()
        assert [r["source_status"] for r in rows] == ["DEMO"]
