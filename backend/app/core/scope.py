"""Administrative scope: which rows a scoped manager may see at all.

WHY THIS IS SEPARATE FROM PERMISSIONS

`permissions.py` answers "may this role dispatch a trip?". It cannot answer
"may this person dispatch *that* trip?", because a permission string has no
row in it. A District Manager and a State Manager hold nearly the same
permissions and must still see different data, so the second question needs
its own module.

THE RULE, IN ONE PLACE

Every list query filters through `trip_scope_clause()`/`shipment_scope_clause()`,
and the single-row read (`trips._assert_in_scope`) evaluates the SAME clause
for its one row. That is the point: a list that hides a row while
`GET /trips/{id}` returns it is not access control, it is a tidy screen. The
IDOR tests exist precisely to catch that split. `may_see_shipment()` is the
same rule in Python, for callers that already hold the ids.

WHAT SCOPE IS BUILT FROM

Trip geography, not truck ownership. A truck dispatched from Kamrup to West
Garo Hills is the destination district's business the moment it is dispatched,
even though the destination manager owns neither the truck nor the driver.

    DISTRICT_MANAGER    origin_district == mine OR destination_district == mine
    STATE_MANAGER       origin_state == mine OR destination_state == mine
    NORTH_EAST_MANAGER  every trip whose `trip_scope_type` is not INDIA_EXTERNAL
    ADMIN / MANAGER     everything - the pre-existing fleet-wide roles
    DRIVER              their own trip only, enforced where it always was

UNSCOPED ROWS ARE NOT EVERYONE'S

A shipment with no district recorded is invisible to STATE_MANAGER and
DISTRICT_MANAGER. Guessing would be worse in both directions: shown to a
manager with no claim to it, or hidden from the one who needs it. Null means
nobody said, and the fix is to say, not to infer.
"""

from __future__ import annotations

import uuid
from typing import Final

from sqlalchemy import ColumnElement, Select, and_, case, false, null, or_, select, true

from app.core.errors import PermissionDeniedError
from app.models.enums import UserRole
from app.models.geography import SOURCE_POSTGIS, State
from app.models.identity import User
from app.models.operations import Shipment, Trip

#: Roles whose reach over PEOPLE and STATES is everything.
#:
#: ADMIN is the technical superuser. MANAGER predates the hierarchy and keeps
#: the fleet-wide reach it has always had, so every existing deployment, demo
#: and test account continues to work unchanged. NORTH_EAST_MANAGER is the
#: operational regional authority - all eight states by design, not by
#: omission. The regional reach over STATES is `is_ner`: the other Indian
#: states the boundary import adds exist only so a point can be classified
#: "India, not NER", and grant nobody anything - see `may_manage_user`, and
#: the state lists in api/org.py and api/dashboard.py.
#:
#: TRIPS are narrower for the North-East Manager: logistics is India-wide, so
#: a trip with neither end in the NER is not the region's business, whatever
#: ALLOW_INDIA_EXTERNAL_TRIPS says (`shipment_scope_clause`, P1R-12).
#:
#: Adding a role here grants it every district in the region, so this is a
#: deliberate list rather than a "not a scoped role" test.
UNSCOPED_ROLES: Final[frozenset[UserRole]] = frozenset(
    {UserRole.ADMIN, UserRole.MANAGER, UserRole.NORTH_EAST_MANAGER}
)

SCOPED_ROLES: Final[frozenset[UserRole]] = frozenset(
    {UserRole.STATE_MANAGER, UserRole.DISTRICT_MANAGER}
)


class ScopeError(PermissionDeniedError):
    """The caller's own scope is unusable - not that the row is out of it."""


def is_scoped(user: User) -> bool:
    return user.role in SCOPED_ROLES


def has_trip_scope(user: User) -> bool:
    """Whether this module narrows the trips and shipments `user` may read.

    The scoped roles, and the North-East Manager for trips (see
    UNSCOPED_ROLES). Every trip/shipment list and single read asks THIS, so a
    role cannot be narrowed on one screen and not on another.
    """
    return user.role in SCOPED_ROLES or user.role is UserRole.NORTH_EAST_MANAGER


def _end_is_ner(state_id) -> ColumnElement[bool]:
    """One end's NER membership as planning decided it: True, False or NULL.

    PostGIS placed the point (`geography_source` = SOURCE_POSTGIS): the covering
    state says either way. The OSM fallback can only CONFIRM the NER - never
    that a point is outside it (services/trip_geography.py) - so from it, and
    from rows written before either, a non-NER state is unknown, not "no".
    """
    is_ner = select(State.is_ner).where(State.id == state_id).scalar_subquery()
    return case(
        (is_ner.is_(True), true()),
        (and_(is_ner.is_(False), Shipment.geography_source == SOURCE_POSTGIS), false()),
        else_=null(),
    )


def trip_scope_type_sql() -> ColumnElement[str]:
    """`trip_scope_type` of the Shipment in the enclosing query.

    geo_classify.trip_scope_type in SQL, plus UNKNOWN for an end nobody
    placed: NER_INTERNAL, NER_OUTBOUND, NER_INBOUND, INDIA_EXTERNAL or UNKNOWN.
    Computed at read time from what planning stored - no column, no
    migration - and the North-East Manager's trip clause is this same
    expression, so the label a manager reads and the reach they have cannot
    disagree.
    """
    origin = _end_is_ner(Shipment.origin_state_id)
    destination = _end_is_ner(Shipment.destination_state_id)
    return case(
        (or_(origin.is_(None), destination.is_(None)), "UNKNOWN"),
        (and_(origin, destination), "NER_INTERNAL"),
        (origin, "NER_OUTBOUND"),
        (destination, "NER_INBOUND"),
        else_="INDIA_EXTERNAL",
    )


def require_scope(user: User) -> None:
    """A scoped role with no scope must not fall through to 'see everything'.

    This is the failure that turns a hierarchy into decoration: a
    DISTRICT_MANAGER whose `district_id` is NULL would match no WHERE clause,
    or - depending on how the clause is written - every row. Refuse instead.
    The database constraint in migration 0013 makes this state unreachable;
    this is the second lock.
    """
    if user.role is UserRole.STATE_MANAGER and user.state_id is None:
        raise ScopeError("This state manager account has no state assigned.")
    if user.role is UserRole.DISTRICT_MANAGER and (
        user.district_id is None or user.state_id is None
    ):
        raise ScopeError("This district manager account has no district assigned.")


def shipment_scope_clause(user: User) -> ColumnElement[bool] | None:
    """The WHERE fragment restricting shipments to this caller's scope.

    Returns None for an unscoped role, so callers can skip the filter entirely
    rather than AND-ing a tautology into every query.
    """
    if user.role is UserRole.NORTH_EAST_MANAGER:
        # Every trip that touches the NER, and every trip whose ends nobody
        # placed: an emergency on one of those reaches ONLY this role
        # (services/driver_trips.py, "always the regional ones"), so it must
        # be able to open it. Only a PROVEN India-external trip is out of reach.
        return trip_scope_type_sql() != "INDIA_EXTERNAL"
    if user.role in UNSCOPED_ROLES:
        return None
    require_scope(user)
    if user.role is UserRole.DISTRICT_MANAGER:
        return or_(
            Shipment.origin_district_id == user.district_id,
            Shipment.destination_district_id == user.district_id,
        )
    if user.role is UserRole.STATE_MANAGER:
        # The state columns, not the districts: a state resolves where a
        # verified district often does not, and migration 0014's trigger
        # fills the state whenever a district is recorded.
        return or_(
            Shipment.origin_state_id == user.state_id,
            Shipment.destination_state_id == user.state_id,
        )
    # A role nobody taught this module about sees nothing. Failing closed is
    # the same choice `permissions_for` makes for an unknown role.
    return false()


def trip_scope_clause(user: User) -> ColumnElement[bool] | None:
    """The same rule expressed against Trip, via its shipment.

    A correlated EXISTS rather than a join, so callers can add it to a query
    that already joins Shipment (the export path) or one that does not (the
    plain list) without either duplicating rows or having to know.
    """
    inner = shipment_scope_clause(user)
    if inner is None:
        return None
    # correlate(Trip) explicitly: the trip list already joins Shipment, and
    # auto-correlation would then strip the subquery's own FROM clause.
    return (
        select(Shipment.id)
        .where(Shipment.id == Trip.shipment_id, inner)
        .correlate(Trip)
        .exists()
    )


def scoped_driver_ids(user: User) -> Select:
    """The drivers this caller may see: the drivers of trips this caller may see.

    A driver has no geography of their own - they are wherever the truck is -
    so they are scoped through trips. The dashboard's "of N drivers" and the
    presence board both use this, so the two can never disagree.
    """
    stmt = select(Trip.driver_id).where(Trip.driver_id.is_not(None)).distinct()
    clause = trip_scope_clause(user)
    return stmt if clause is None else stmt.where(clause)


def may_see_shipment(
    user: User,
    *,
    origin_district_id: uuid.UUID | None,
    destination_district_id: uuid.UUID | None,
    origin_state_id: uuid.UUID | None = None,
    destination_state_id: uuid.UUID | None = None,
    trip_scope_type: str | None = None,
) -> bool:
    """The single-row form of `shipment_scope_clause`, in Python.

    Takes ids rather than a row so it can be called from anywhere without
    another query, and so the caller cannot accidentally pass a lazily-loaded
    relationship that is not there. `trip_scope_type` is the value
    `trip_scope_type_sql` reads; None is unknown, which the region still sees.
    """
    if user.role is UserRole.NORTH_EAST_MANAGER:
        return trip_scope_type != "INDIA_EXTERNAL"
    if user.role in UNSCOPED_ROLES:
        return True
    require_scope(user)
    if user.role is UserRole.DISTRICT_MANAGER:
        return user.district_id in (origin_district_id, destination_district_id)
    if user.role is UserRole.STATE_MANAGER:
        return user.state_id in (origin_state_id, destination_state_id)
    return False


#: Which roles each administering role may create, edit and retire.
#:
#: Nobody may make a peer or anything above themselves. That is the rule the
#: whole hierarchy rests on: a State Manager who could mint another State
#: Manager could give themselves a second state, and a North-East Manager
#: who could mint an ADMIN could read every salary in the region. Both are
#: privilege escalation with extra steps.
MANAGEABLE_ROLES: Final[dict[UserRole, frozenset[UserRole]]] = {
    UserRole.ADMIN: frozenset(
        {UserRole.NORTH_EAST_MANAGER, UserRole.STATE_MANAGER, UserRole.DISTRICT_MANAGER}
    ),
    UserRole.NORTH_EAST_MANAGER: frozenset(
        {UserRole.STATE_MANAGER, UserRole.DISTRICT_MANAGER}
    ),
    UserRole.STATE_MANAGER: frozenset({UserRole.DISTRICT_MANAGER}),
}


def may_manage_user(
    actor: User, *, role: UserRole, state_id, district_id, state_is_ner: bool
) -> bool:
    """May `actor` create or change a manager account with this scope?

    Two questions, both of which must pass: is this a role the actor is
    allowed to make at all, and is it inside the actor's own patch.

    A State Manager's authority stops at their own border. A North-East
    Manager's covers the region, which is the eight NER states - so for them
    the geographic half is `state_is_ner` and nothing else. No actor, ADMIN
    included, appoints a manager for a state outside the North-East: such a
    row exists for classification only, and scope built on it would widen
    the product past its management region.
    """
    allowed = MANAGEABLE_ROLES.get(actor.role, frozenset())
    if role not in allowed or not state_is_ner:
        return False
    if actor.role in (UserRole.ADMIN, UserRole.NORTH_EAST_MANAGER):
        return True
    # A scoped administering role: the target must sit inside its own scope.
    require_scope(actor)
    return state_id == actor.state_id
