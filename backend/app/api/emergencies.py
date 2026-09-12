"""Emergency management endpoints (Fleet Sentinel).

Endpoints for reviewing active safety emergencies, running monitoring sweeps,
and resolving incidents. Gated on EMERGENCY_READ and EMERGENCY_RESOLVE permissions.
"""

from datetime import UTC, datetime
from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_permission
from app.core import permissions as perm
from app.models.emergency import Emergency
from app.models.enums import EmergencyState
from app.schemas.domain import EmergencyRead, EmergencyResolve
from app.services import sentinel

router = APIRouter(prefix="/api/emergencies", tags=["emergencies"])


@router.get(
    "/active",
    response_model=list[EmergencyRead],
    summary="List all open emergencies requiring attention",
)
async def list_active_emergencies(
    db: DbSession,
    user: Annotated[object, Depends(require_permission(perm.EMERGENCY_READ))],
) -> list[EmergencyRead]:
    """Return all emergencies currently in check-in, responded, or escalated state."""
    q = (
        select(Emergency)
        .where(
            Emergency.state.in_(
                [
                    EmergencyState.DRIVER_CHECK_REQUIRED,
                    EmergencyState.DRIVER_RESPONDED,
                    EmergencyState.SOS_ESCALATED,
                ]
            )
        )
        .order_by(Emergency.triggered_at.desc())
    )
    rows = (await db.execute(q)).scalars().all()
    return [EmergencyRead.model_validate(r) for r in rows]


@router.post(
    "/sweep",
    response_model=list[EmergencyRead],
    summary="Trigger an on-demand Fleet Sentinel monitor sweep",
)
async def trigger_sentinel_sweep(
    db: DbSession,
    user: Annotated[object, Depends(require_permission(perm.EMERGENCY_RESOLVE))],
) -> list[EmergencyRead]:
    """Execute a Sentinel evaluation pass across all active trips."""
    affected = await sentinel.run_sentinel_sweep(db)
    return [EmergencyRead.model_validate(e) for e in affected]


@router.post(
    "/{emergency_id}/resolve",
    response_model=EmergencyRead,
    summary="Resolve an active emergency incident",
)
async def resolve_emergency(
    emergency_id: uuid.UUID,
    payload: EmergencyResolve,
    user: CurrentUser,
    db: DbSession,
    _auth: Annotated[object, Depends(require_permission(perm.EMERGENCY_RESOLVE))],
) -> EmergencyRead:
    """Resolve an open emergency with manager notes."""
    emergency = await sentinel.resolve_emergency(
        db,
        emergency_id=emergency_id,
        actor=user,
        note=payload.note,
        is_false_alarm=payload.is_false_alarm,
    )
    return EmergencyRead.model_validate(emergency)
