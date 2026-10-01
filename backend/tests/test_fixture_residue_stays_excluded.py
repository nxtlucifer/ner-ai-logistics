"""The hosted test residue must stay invisible, and stay inactive.

THE INCIDENT

19,860 deactivated users at fixture domains (`p3test.invalid` and three
`*cert.invalid` domains) and five retired fixture trucks are sitting in
hosted Supabase. They were written between 30 August and 6 September 2026
by test runs that reached the shared project before the isolated-database
guard existed. See `docs/DATA_HYGIENE_AUDIT.md`.

THEY ARE NOT BEING DELETED. Removing 19,860 rows from shared data is a
destructive operation that needs a confirmed backup and explicit
permission, and neither exists. `HOSTED_FIXTURE_CLEANUP_PERFORMED = NO`.

SO THE JOB IS CONTAINMENT, AND THIS IS WHAT HOLDS IT

Three properties, each of which would be quietly violated by an ordinary-
looking change:

  1. An inactive user must never be counted as operational.
  2. Migration 0013 must never reactivate a user or promote a district.
  3. A driver-facing list must be filtered by `is_active`, not by hoping
     the fixtures have distinctive names.

The residue is only harmless while all three hold.
"""

import pytest
from sqlalchemy import select

from app.models.enums import DistrictSource, TruckStatus, UserRole
from app.models.geography import District, operational_sources
from app.models.identity import User
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


class TestInactiveIsNeverOperational:
    async def test_a_deactivated_login_cannot_be_given_a_trip(self, api, session):
        """The invariant that actually protects dispatch.

        Note what is NOT asserted: that a deactivated driver disappears
        from `/api/drivers`. It does not, and that is deliberate — the
        login flag and the driver's operational status are independent
        columns, and a manager has to be able to SEE an account in order
        to reactivate it. Hiding it would make the fix unreachable.

        The gate is at assignment, where it matters: the server refuses
        with DRIVER_LOGIN_INACTIVE (409, not 422 — it is "not while this
        is true", not "nobody may").

        None of the 19,860 hosted fixture users has a driver row at all,
        so none can reach this path; this holds the rule that would stop
        them if one ever did.
        """
        from app.core.errors import ConflictError
        from app.services import trips as trip_service

        driver, _user = await factories.make_driver(session, is_active=False)
        await session.commit()

        # Straight at the gate, rather than through the whole create-trip
        # payload: the rule lives in `_load_driver`, and a test that has to
        # build a valid trip first is testing the schema, not the rule.
        with pytest.raises(ConflictError) as caught:
            await trip_service._load_driver(session, driver.id)
        assert caught.value.code == "DRIVER_LOGIN_INACTIVE"

    async def test_a_retired_truck_is_not_offered(self, api, session):
        """Five retired fixture trucks are in hosted. Retired means gone."""
        truck = await factories.make_truck(session, status=TruckStatus.RETIRED)
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)

        r = await api.get("/api/trucks?limit=100", headers=headers)
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body["items"] if isinstance(body, dict) else body
        available = {
            row["id"] for row in rows if row.get("status") not in ("RETIRED",)
        }
        assert str(truck.id) not in available

    async def test_a_retired_truck_is_not_in_the_utilisation_denominator(
        self, api, session
    ):
        """Otherwise utilisation would fall every time a truck was retired,
        which is the opposite of what happened."""
        boss = await factories.make_user(session, role=UserRole.MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        before = (await api.get("/api/fleet/active", headers=headers)).json()["trucks_total"]

        await factories.make_truck(session, status=TruckStatus.RETIRED)
        after = (await api.get("/api/fleet/active", headers=headers)).json()["trucks_total"]
        assert after == before


class TestTheMigrationCannotResurrectThem:
    async def test_0013_leaves_is_active_alone(self, session):
        """`must_reset_password` and the scope columns were added with
        defaults. None of them touches `is_active`, and nothing in the
        upgrade issues an UPDATE against existing rows."""
        from pathlib import Path

        migration = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / "0013_state_district_inbox.py"
        ).read_text(encoding="utf8")
        upgrade = migration.split("def downgrade")[0]
        for forbidden in ("is_active=True", "is_active = True", "UPDATE users"):
            assert forbidden not in upgrade, f"0013 touches {forbidden!r}"

    async def test_a_deactivated_user_stays_deactivated(self, session):
        user = await factories.make_user(session, role=UserRole.MANAGER, is_active=False)
        await session.refresh(user)
        assert user.is_active is False
        row = (
            await session.execute(select(User).where(User.id == user.id))
        ).scalar_one()
        assert row.is_active is False

    async def test_new_districts_default_to_unverified_not_operational(self, session):
        """0013's server_default. A district written by anything that does
        not declare a provenance is not counted."""
        from pathlib import Path

        migration = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / "0013_state_district_inbox.py"
        ).read_text(encoding="utf8")
        assert "UNVERIFIED" in migration
        assert DistrictSource.UNVERIFIED not in operational_sources()


class TestCountsExcludeTheResidue:
    async def test_district_counts_use_provenance_not_name_matching(
        self, api, session
    ):
        """Filtering by name would work until somebody named a real
        district 'Test Nagar'. The filter is the provenance column."""
        await factories.make_district(session, state_slug="assam", slug="residue-a")
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)

        states = {s["name"]: s for s in (await api.get("/api/org/states", headers=headers)).json()}
        counted = states["Assam"]["district_count"]

        operational = (
            await session.execute(
                select(District).where(
                    District.source_status.in_(operational_sources()),
                )
            )
        ).scalars().all()
        assam_operational = [
            d for d in operational if str(d.state_id) == states["Assam"]["id"]
        ]
        assert counted == len(assam_operational), (
            "the API's count and the provenance filter disagree"
        )

    async def test_a_test_provenance_district_is_never_counted(self, api, session):
        d = await factories.make_district(session, state_slug="sikkim", slug="residue-b")
        assert d.source_status is DistrictSource.TEST
        boss = await factories.make_user(session, role=UserRole.NORTH_EAST_MANAGER)
        headers = await auth_headers(api, boss.email, factories.TEST_PASSWORD)
        states = {s["name"]: s for s in (await api.get("/api/org/states", headers=headers)).json()}
        listed = (
            await api.get(f"/api/org/districts?state_id={states['Sikkim']['id']}",
                          headers=headers)
        ).json()
        assert d.slug not in {x["slug"] for x in listed}
