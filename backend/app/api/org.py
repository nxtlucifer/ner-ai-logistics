"""The administrative hierarchy: states, districts and the managers in them.

    GET  /api/org/regions                   PUBLIC: state and district names
    GET  /api/org/states                    the eight, with their districts
    GET  /api/org/districts?state_id=       one state's districts
    GET  /api/org/managers                  scoped manager accounts
    POST /api/org/managers                  create a District Manager
    POST /api/org/managers/{id}/deactivate  retire one

WHO MAY DO WHAT

`MANAGER_ACCOUNT_MANAGE` gets a caller through the door; `scope.may_manage_user`
decides whether *this* account is theirs to make. A State Manager may create
District Managers inside their own state and nothing else - not a peer, not an
admin, not a district across the border. That second check is the one that
matters, because the permission string cannot say "in my state".

THE TEMPORARY PASSWORD

Generated here, returned ONCE in the creation response, and never readable
again: it is stored only as an Argon2 hash like every other password, and the
new account carries `must_reset_password` so it cannot be used for anything
else until it is changed. The creator hands it over out of band. There is no
endpoint that reads it back, because an endpoint that could would make the
reset pointless.
"""

from __future__ import annotations

import secrets
import time
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import func, select

from app.api.deps import DbSession, rate_limit, require_permission
from app.core import permissions as perm
from app.core import scope
from app.core.errors import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
)
from app.core.security import hash_password_async
from app.models.audit import AuditAction
from app.models.enums import DistrictSource, UserRole
from app.models.geography import District, State, operational_sources
from app.models.identity import User
from app.schemas.common import APIModel, ReadModel
from app.services import audit

router = APIRouter(prefix="/api/org", tags=["organisation"])

#: Long enough that it is not worth guessing before it is changed, short
#: enough to be read down a phone line once.
TEMP_PASSWORD_BYTES = 9


class DistrictRead(ReadModel):
    id: uuid.UUID
    state_id: uuid.UUID
    name: str
    slug: str
    source_name: str
    source_status: DistrictSource
    #: True when sources disagree about this district's existence, name or
    #: boundary. Surfaced rather than hidden: a manager scoped to a contested
    #: district should know that is what they are looking at.
    disputed_or_recently_changed: bool


class StateRead(ReadModel):
    id: uuid.UUID
    name: str
    slug: str
    source_name: str
    #: Districts whose provenance is accepted for operations. Test and
    #: unverified rows are excluded, so this can read 0 while the table
    #: holds rows - which is the honest answer, not a bug.
    district_count: int


class ManagerRead(ReadModel):
    id: uuid.UUID
    email: str | None
    display_name: str
    role: UserRole
    state_id: uuid.UUID | None
    district_id: uuid.UUID | None
    is_active: bool
    must_reset_password: bool


class ManagerCreate(APIModel):
    #: 254 is the longest address SMTP will carry; 120 is a person's name
    #: with room for an honorific, not a paragraph.
    email: Annotated[str, Field(min_length=5, max_length=254)]
    display_name: Annotated[str, Field(min_length=2, max_length=120)]
    #: DISTRICT_MANAGER needs a district; STATE_MANAGER needs a state and no
    #: district. Which one is required is decided by `role`, not by which
    #: field the client happened to send.
    role: UserRole = UserRole.DISTRICT_MANAGER
    district_id: uuid.UUID | None = None
    state_id: uuid.UUID | None = None


class ManagerCreated(ReadModel):
    manager: ManagerRead
    #: Shown once. Not stored in readable form and not retrievable again.
    temporary_password: str


class RegionDistrict(ReadModel):
    id: uuid.UUID
    name: str
    #: Kept in the public shape on purpose. A contested or recently renamed
    #: district is a fact about the map, not about our data, and a picker
    #: that hides it makes somebody choose one without knowing.
    disputed_or_recently_changed: bool


class Region(ReadModel):
    id: uuid.UUID
    name: str
    slug: str
    districts: list[RegionDistrict]


#: `/regions` answers from here, refreshed at most this often. Not a
#: performance optimisation - it is what makes an UNAUTHENTICATED endpoint
#: cheap however hard it is hit: the database is touched twelve times an
#: hour. The per-address `public` limit on the route bounds the rest. The
#: data changes when somebody seeds a district, which is not an hourly event.
_REGIONS_TTL_SECONDS = 300.0
_regions_cache: tuple[float, list[Region]] | None = None


def reset_regions_cache() -> None:
    """For tests, and for a seed script that wants the next read to be fresh."""
    global _regions_cache
    _regions_cache = None


@router.get(
    "/regions",
    response_model=list[Region],
    summary="PUBLIC. State and district names, for the sign-in region picker",
    # Per client address, like every public endpoint.
    dependencies=[rate_limit("public")],
)
async def list_regions(db: DbSession) -> list[Region]:
    """The one endpoint here with no authentication, and deliberately so.

    The sign-in screen asks which region to open BEFORE anyone has a token.
    Without this the picker can never be populated, which is what it was:
    "A state" opened a dropdown that was always empty, because
    `/api/org/states` requires TRIP_READ. A control that cannot work is
    worse than no control.

    WHAT LEAVES HERE, EXACTLY

    The names and ids of the eight North-Eastern states (`is_ner` - the
    other Indian states exist for classification only), and of the
    districts already configured with an operational provenance. That is
    public geography - the same names printed on a road sign - and it is
    the minimum the picker needs to send a state id the server can check.

    WHAT DOES NOT

    No counts, no provenance, no manager, driver, truck or trip data, and
    nothing about whether any given account exists. Choosing a region here
    still grants nothing: `services.auth._workspace_matches` compares the
    choice against the account and refuses a mismatch with the same message
    as a wrong password.
    """
    global _regions_cache
    now = time.monotonic()
    if _regions_cache is not None and now - _regions_cache[0] < _REGIONS_TTL_SECONDS:
        return _regions_cache[1]

    states = (
        await db.execute(select(State).where(State.is_ner).order_by(State.name))
    ).scalars().all()
    districts = (
        (
            await db.execute(
                select(District)
                .where(District.source_status.in_(operational_sources()))
                .order_by(District.name)
            )
        )
        .scalars()
        .all()
    )
    by_state: dict[uuid.UUID, list[RegionDistrict]] = {}
    for d in districts:
        by_state.setdefault(d.state_id, []).append(
            RegionDistrict(
                id=d.id,
                name=d.name,
                disputed_or_recently_changed=d.disputed_or_recently_changed,
            )
        )
    regions = [
        Region(id=s.id, name=s.name, slug=s.slug, districts=by_state.get(s.id, []))
        for s in states
    ]
    _regions_cache = (now, regions)
    return regions


@router.get("/states", response_model=list[StateRead], summary="The eight NER states")
async def list_states(
    db: DbSession,
    _: Annotated[User, Depends(require_permission(perm.TRIP_READ))],
) -> list[StateRead]:
    rows = (
        await db.execute(select(State).where(State.is_ner).order_by(State.name))
    ).scalars().all()
    counts = dict(
        (
            await db.execute(
                select(District.state_id, func.count())
                .where(District.source_status.in_(operational_sources()))
                .group_by(District.state_id)
            )
        ).all()
    )
    return [
        StateRead(
            id=s.id,
            name=s.name,
            slug=s.slug,
            source_name=s.source_name,
            district_count=counts.get(s.id, 0),
        )
        for s in rows
    ]


@router.get(
    "/districts", response_model=list[DistrictRead], summary="Districts of one state"
)
async def list_districts(
    db: DbSession,
    _: Annotated[User, Depends(require_permission(perm.TRIP_READ))],
    state_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[DistrictRead]:
    """Empty until an authoritative district list is seeded.

    That emptiness is the honest state, not a failure: see
    docs/STATE_DISTRICT_RBAC_AND_NOTIFICATIONS.md section 3. Clients must render
    "Official district list pending" rather than an empty picker that looks
    broken.
    """
    stmt = (
        select(District)
        .where(District.source_status.in_(operational_sources()))
        .order_by(District.name)
    )
    if state_id is not None:
        stmt = stmt.where(District.state_id == state_id)
    return [
        DistrictRead.model_validate(d)
        for d in (await db.execute(stmt)).scalars().all()
    ]


async def _state_is_ner(db, state_id: uuid.UUID | None) -> bool:
    """Management scope is the North-East; a missing state is not in it."""
    if state_id is None:
        return False
    return bool(
        (await db.execute(select(State.is_ner).where(State.id == state_id))).scalar_one_or_none()
    )


@router.get(
    "/managers", response_model=list[ManagerRead], summary="Scoped manager accounts"
)
async def list_managers(
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.MANAGER_ACCOUNT_MANAGE))],
) -> list[ManagerRead]:
    """Managers this caller is responsible for.

    A State Manager sees the District Managers of their own state, and no
    others. ADMIN and the North-East Manager see every scoped manager in the
    region. Deactivated accounts stay in the list - retirement is a record,
    not a deletion.
    """
    stmt = select(User).where(User.role.in_(list(scope.SCOPED_ROLES)))
    if actor.role not in (UserRole.ADMIN, UserRole.NORTH_EAST_MANAGER):
        # A State Manager sees the district managers of their own state and
        # nobody else - not their own row, and not a peer in another state.
        scope.require_scope(actor)
        stmt = stmt.where(
            User.state_id == actor.state_id,
            User.role == UserRole.DISTRICT_MANAGER,
        )
    stmt = stmt.order_by(User.display_name)
    return [
        ManagerRead.model_validate(u) for u in (await db.execute(stmt)).scalars().all()
    ]


@router.post(
    "/managers",
    response_model=ManagerCreated,
    status_code=201,
    summary="Create a District Manager",
)
async def create_manager(
    body: ManagerCreate,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.MANAGER_ACCOUNT_MANAGE))],
) -> ManagerCreated:
    # Resolve the scope the new account will hold, from the role asked for.
    district: District | None = None
    if body.role is UserRole.DISTRICT_MANAGER:
        if body.district_id is None:
            raise BusinessRuleError(
                "A district manager needs a district.", code="DISTRICT_REQUIRED"
            )
        district = (
            await db.execute(select(District).where(District.id == body.district_id))
        ).scalar_one_or_none()
        if district is None:
            raise NotFoundError("District not found.")
        target_state_id = district.state_id
    elif body.role is UserRole.STATE_MANAGER:
        if body.state_id is None:
            raise BusinessRuleError(
                "A state manager needs a state.", code="STATE_REQUIRED"
            )
        state = (
            await db.execute(select(State).where(State.id == body.state_id))
        ).scalar_one_or_none()
        if state is None:
            raise NotFoundError("State not found.")
        target_state_id = state.id
    else:
        # A role nobody may create through this endpoint - ADMIN, DRIVER, or
        # the regional role itself. Refused before anything is looked up, so
        # the request cannot probe for ids either.
        raise PermissionDeniedError(
            "Only state and district manager accounts are created here."
        )

    if not scope.may_manage_user(
        actor,
        role=body.role,
        state_id=target_state_id,
        district_id=district.id if district else None,
        state_is_ner=await _state_is_ner(db, target_state_id),
    ):
        # 403, not 404: the district itself is not secret, and pretending it
        # does not exist would make a legitimate "wrong state" mistake
        # impossible to diagnose.
        raise PermissionDeniedError(
            "That account is outside what your role may create: a state "
            "manager creates district managers inside their own state, and "
            "nobody creates a peer or anything above themselves."
        )

    email = body.email.strip().lower()
    taken = (
        await db.execute(select(User.id).where(User.email.ilike(email)))
    ).scalar_one_or_none()
    if taken is not None:
        raise ConflictError("That email already has an account.", code="EMAIL_TAKEN")

    # The active-manager-per-district rule is a partial unique index, so a race
    # is refused by the database. Checking first turns the common case into a
    # readable error instead of an integrity violation.
    # One active manager per patch. The partial unique indexes refuse a race;
    # this turns the common case into a readable error instead of an
    # integrity violation.
    if district is not None:
        where = (User.role == UserRole.DISTRICT_MANAGER, User.district_id == district.id)
        where_name, code = district.name, "DISTRICT_MANAGER_EXISTS"
    else:
        where = (User.role == UserRole.STATE_MANAGER, User.state_id == target_state_id)
        where_name, code = "That state", "STATE_MANAGER_EXISTS"
    incumbent = (
        await db.execute(
            select(User.display_name).where(*where, User.is_active)
        )
    ).scalar_one_or_none()
    if incumbent is not None:
        raise ConflictError(
            f"{where_name} already has an active manager ({incumbent}). "
            "Deactivate that account first.",
            code=code,
        )

    temporary = secrets.token_urlsafe(TEMP_PASSWORD_BYTES)
    user = User(
        email=email,
        password_hash=await hash_password_async(temporary),
        role=body.role,
        display_name=body.display_name.strip(),
        state_id=target_state_id,
        district_id=district.id if district else None,
        must_reset_password=True,
        created_by_user_id=actor.id,
    )
    db.add(user)
    await db.flush()
    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="users",
        entity_id=user.id,
        actor_user_id=actor.id,
        before=None,
        after={
            "role": user.role.value,
            "state_id": str(target_state_id),
            "district_id": str(district.id) if district else None,
        },
        reason=(
            f"district manager created for {district.name}"
            if district
            else "state manager created"
        ),
    )
    await db.commit()
    await db.refresh(user)
    return ManagerCreated(
        manager=ManagerRead.model_validate(user), temporary_password=temporary
    )


@router.post(
    "/managers/{manager_id}/deactivate",
    response_model=ManagerRead,
    summary="Retire a manager account",
)
async def deactivate_manager(
    manager_id: uuid.UUID,
    db: DbSession,
    actor: Annotated[User, Depends(require_permission(perm.MANAGER_ACCOUNT_MANAGE))],
) -> ManagerRead:
    """Deactivation, never deletion.

    `audit_logs.actor_user_id` is RESTRICT: an account that has done anything
    auditable cannot be removed, and should not be - the trail needs its
    actor. Deactivating frees the district's slot in the partial unique index
    so a successor can be appointed.
    """
    target = (
        await db.execute(select(User).where(User.id == manager_id))
    ).scalar_one_or_none()
    if target is None or target.role not in scope.SCOPED_ROLES:
        raise NotFoundError("Manager not found.")
    if not scope.may_manage_user(
        actor,
        role=target.role,
        state_id=target.state_id,
        district_id=target.district_id,
        state_is_ner=await _state_is_ner(db, target.state_id),
    ):
        raise PermissionDeniedError(
            "A state manager may only manage district managers inside their own state."
        )
    if target.id == actor.id:
        raise ConflictError(
            "You cannot deactivate your own account.", code="SELF_DEACTIVATION"
        )
    if target.is_active:
        target.is_active = False
        await audit.record(
            db,
            action=AuditAction.STATUS_CHANGE,
            entity_type="users",
            entity_id=target.id,
            actor_user_id=actor.id,
            before={"is_active": True},
            after={"is_active": False},
            reason="manager deactivated",
        )
        await db.commit()
        await db.refresh(target)
    return ManagerRead.model_validate(target)
