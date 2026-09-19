"""A manager sees their own patch, and a trip that touches it.

WHAT THIS DEFENDS

The failure a role hierarchy invites is a tidy screen: the list is filtered,
the single-row read is not, and `GET /trips/{id}` hands another district's job
to anyone who can guess a UUID. So every rule here is asserted twice - once
against a list and once against a direct id - and the two must agree.

The second failure is subtler. A scoped role whose scope is NULL matches no
WHERE clause, or every row, depending on how the clause was written. The
database refuses that state outright (`ck_users_role_scope`) and the scope
module refuses it again; both are tested, because the constraint could be
dropped by a future migration and the second lock should still hold.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDeniedError
from app.core.permissions import (
    MANAGER_ACCOUNT_MANAGE,
    NOTIFICATION_READ,
    TRIP_READ,
    has_permission,
)
from app.core.scope import (
    may_manage_user,
    may_see_shipment,
    require_scope,
    shipment_scope_clause,
    trip_scope_clause,
)
from app.models.enums import UserRole
from app.models.geography import District, State
from app.models.identity import User
from app.models.operations import Shipment, Trip
from tests import factories

pytestmark = pytest.mark.requires_db


async def _pair(session: AsyncSession):
    driver, _ = await factories.make_driver(session)
    truck = await factories.make_truck(session)
    return driver, truck


async def _trip_between(session: AsyncSession, origin: District, dest: District) -> Trip:
    driver, truck = await _pair(session)
    shipment = await factories.make_shipment(
        session,
        origin_district_id=origin.id,
        destination_district_id=dest.id,
    )
    return await factories.make_trip(session, driver, truck, shipment=shipment)


async def _visible_trip_codes(session: AsyncSession, user: User) -> set[str]:
    """Exactly what a list endpoint would show this caller."""
    stmt = select(Trip.trip_code)
    clause = trip_scope_clause(user)
    if clause is not None:
        stmt = stmt.where(clause)
    return set((await session.execute(stmt)).scalars().all())


class TestSeed:
    async def test_the_eight_states_are_seeded_with_their_source(self, session):
        rows = (await session.execute(select(State))).scalars().all()
        names = {r.name for r in rows}
        assert names == {
            "Arunachal Pradesh", "Assam", "Manipur", "Meghalaya",
            "Mizoram", "Nagaland", "Sikkim", "Tripura",
        }
        # Provenance is not optional: an unsourced geography row is a guess,
        # and the district table exists to keep guesses out.
        assert all(r.source_name for r in rows)

    async def test_districts_are_not_seeded_and_that_is_deliberate(self, session):
        """No official district list was reachable, so none was invented.

        If someone later seeds districts from a verified notification this
        test should be replaced by one that asserts the count AND the source.
        It must not be deleted to make room for a plausible list.
        """
        seeded = (
            await session.execute(
                select(District).where(
                    District.source_name.not_like("test fixture%")
                )
            )
        ).scalars().all()
        assert seeded == [], (
            "districts appeared without a recorded government source - see "
            "docs/STATE_DISTRICT_RBAC_AND_NOTIFICATIONS.md"
        )


class TestScopeIsRequired:
    async def test_the_database_refuses_a_district_manager_with_no_district(
        self, session
    ):
        state = await factories.get_state(session, "assam")
        with pytest.raises(IntegrityError):
            await factories.make_user(
                session, role=UserRole.DISTRICT_MANAGER, state_id=state.id
            )
        await session.rollback()

    async def test_the_database_refuses_a_state_manager_holding_a_district(
        self, session
    ):
        district = await factories.make_district(session, slug="scope-a")
        with pytest.raises(IntegrityError):
            await factories.make_user(
                session,
                role=UserRole.STATE_MANAGER,
                state_id=district.state_id,
                district_id=district.id,
            )
        await session.rollback()

    def test_the_scope_module_refuses_an_unscoped_scoped_role(self):
        """The second lock, for the day the constraint is dropped."""
        orphan = User(role=UserRole.DISTRICT_MANAGER, state_id=None, district_id=None)
        with pytest.raises(PermissionDeniedError):
            require_scope(orphan)
        with pytest.raises(PermissionDeniedError):
            shipment_scope_clause(orphan)


class TestDistrictManager:
    async def test_sees_a_trip_leaving_their_district_and_one_arriving(self, session):
        mine = await factories.make_district(session, slug="dm-mine")
        theirs = await factories.make_district(session, slug="dm-theirs")
        elsewhere = await factories.make_district(session, slug="dm-elsewhere")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )

        outbound = await _trip_between(session, mine, theirs)
        inbound = await _trip_between(session, theirs, mine)
        unrelated = await _trip_between(session, theirs, elsewhere)

        visible = await _visible_trip_codes(session, me)
        assert outbound.trip_code in visible
        assert inbound.trip_code in visible, (
            "a truck arriving is the destination district's business"
        )
        assert unrelated.trip_code not in visible

    async def test_the_single_row_read_agrees_with_the_list(self, session):
        """The IDOR case: a filtered list plus an unfiltered detail is a leak."""
        mine = await factories.make_district(session, slug="idor-mine")
        theirs = await factories.make_district(session, slug="idor-theirs")
        elsewhere = await factories.make_district(session, slug="idor-far")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        unrelated = await _trip_between(session, theirs, elsewhere)
        shipment = (
            await session.execute(
                select(Shipment).where(Shipment.id == unrelated.shipment_id)
            )
        ).scalar_one()

        assert not may_see_shipment(
            me,
            origin_district_id=shipment.origin_district_id,
            destination_district_id=shipment.destination_district_id,
        )
        assert unrelated.trip_code not in await _visible_trip_codes(session, me)

    async def test_a_shipment_with_no_district_reaches_no_scoped_manager(
        self, session
    ):
        """Null is 'nobody said', not 'everybody may'."""
        mine = await factories.make_district(session, slug="null-mine")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        driver, truck = await _pair(session)
        orphan = await factories.make_trip(session, driver, truck)

        assert orphan.trip_code not in await _visible_trip_codes(session, me)
        assert not may_see_shipment(
            me, origin_district_id=None, destination_district_id=None
        )

    async def test_may_not_create_any_manager(self, session):
        mine = await factories.make_district(session, slug="dm-nocreate")
        me = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
        )
        assert not has_permission(me.role, MANAGER_ACCOUNT_MANAGE)
        assert not may_manage_user(
            me,
            role=UserRole.DISTRICT_MANAGER,
            state_id=mine.state_id,
            district_id=mine.id,
            state_is_ner=True,
        )
        # It keeps the operational permissions it needs to do the job.
        assert has_permission(me.role, TRIP_READ)
        assert has_permission(me.role, NOTIFICATION_READ)


class TestStateManager:
    async def test_sees_every_district_in_their_state_and_none_outside(
        self, session
    ):
        home_a = await factories.make_district(session, state_slug="assam", slug="sm-a")
        home_b = await factories.make_district(session, state_slug="assam", slug="sm-b")
        away = await factories.make_district(
            session, state_slug="meghalaya", slug="sm-away"
        )
        me = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=home_a.state_id
        )

        internal = await _trip_between(session, home_a, home_b)
        crossing = await _trip_between(session, home_a, away)
        foreign = await _trip_between(session, away, away)

        visible = await _visible_trip_codes(session, me)
        assert internal.trip_code in visible
        assert crossing.trip_code in visible, "a trip touching my state is mine to see"
        assert foreign.trip_code not in visible

    async def test_both_states_of_a_crossing_trip_can_see_it(self, session):
        here = await factories.make_district(session, state_slug="assam", slug="x-here")
        there = await factories.make_district(
            session, state_slug="nagaland", slug="x-there"
        )
        origin_sm = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=here.state_id
        )
        dest_sm = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=there.state_id
        )
        crossing = await _trip_between(session, here, there)

        assert crossing.trip_code in await _visible_trip_codes(session, origin_sm)
        assert crossing.trip_code in await _visible_trip_codes(session, dest_sm)

    async def test_creates_district_managers_only_inside_their_own_state(
        self, session
    ):
        home = await factories.make_district(session, state_slug="assam", slug="c-home")
        away = await factories.make_district(
            session, state_slug="tripura", slug="c-away"
        )
        me = await factories.make_user(
            session, role=UserRole.STATE_MANAGER, state_id=home.state_id
        )

        assert has_permission(me.role, MANAGER_ACCOUNT_MANAGE)
        assert may_manage_user(
            me,
            role=UserRole.DISTRICT_MANAGER,
            state_id=home.state_id,
            district_id=home.id,
            state_is_ner=True,
        )
        assert not may_manage_user(
            me,
            role=UserRole.DISTRICT_MANAGER,
            state_id=away.state_id,
            district_id=away.id,
            state_is_ner=True,
        ), "a state manager's authority stops at their own border"
        assert not may_manage_user(
            me, role=UserRole.STATE_MANAGER, state_id=home.state_id, district_id=None,
            state_is_ner=True,
        ), "no making peers"
        assert not may_manage_user(
            me, role=UserRole.ADMIN, state_id=None, district_id=None, state_is_ner=True
        )


class TestUnscopedRolesAreUnchanged:
    async def test_the_pre_existing_manager_still_sees_everything(self, session):
        """The hierarchy is additive. MANAGER predates it and keeps its reach."""
        a = await factories.make_district(session, slug="legacy-a")
        b = await factories.make_district(session, slug="legacy-b")
        trip = await _trip_between(session, a, b)
        legacy = await factories.make_user(session, role=UserRole.MANAGER)

        assert shipment_scope_clause(legacy) is None
        assert trip_scope_clause(legacy) is None
        assert trip.trip_code in await _visible_trip_codes(session, legacy)
        assert may_see_shipment(
            legacy, origin_district_id=None, destination_district_id=None
        )

    async def test_an_unknown_role_sees_nothing(self, session):
        """Failing closed, the same choice permissions_for makes."""
        reviewer = await factories.make_user(
            session, role=UserRole.AUTHORISED_REVIEWER
        )
        a = await factories.make_district(session, slug="closed-a")
        b = await factories.make_district(session, slug="closed-b")
        trip = await _trip_between(session, a, b)

        assert trip.trip_code not in await _visible_trip_codes(session, reviewer)
        assert not may_see_shipment(
            reviewer, origin_district_id=a.id, destination_district_id=b.id
        )


class TestOneActiveManagerPerPatch:
    async def test_a_second_active_district_manager_is_refused(self, session):
        district = await factories.make_district(session, slug="dup-district")
        await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=district.state_id,
            district_id=district.id,
        )
        with pytest.raises(IntegrityError):
            await factories.make_user(
                session,
                role=UserRole.DISTRICT_MANAGER,
                state_id=district.state_id,
                district_id=district.id,
            )
        await session.rollback()

    async def test_a_deactivated_predecessor_leaves_room_for_a_successor(
        self, session
    ):
        """Retirement is deactivation, not deletion - the record stays."""
        district = await factories.make_district(session, slug="succ-district")
        first = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=district.state_id,
            district_id=district.id,
        )
        first.is_active = False
        await session.commit()

        second = await factories.make_user(
            session,
            role=UserRole.DISTRICT_MANAGER,
            state_id=district.state_id,
            district_id=district.id,
        )
        assert second.id != first.id
        assert (await session.get(User, first.id)).is_active is False
