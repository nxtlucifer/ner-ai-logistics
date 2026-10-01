"""Fleet Sentinel service: monitor loop, check-in processing, and SOS escalation.

docs/ARCHITECTURE.md Diagram F, docs/DATA_MODEL.md section 11.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any
import uuid

from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

from app.core.errors import ConflictError, NotFoundError
from app.domain.sentinel import (
    APPROVED_STOP_RADIUS_M,
    DRIVER_RESPONSE_WINDOW_SECONDS,
    STATIONARY_WINDOW_SECONDS,
    ApprovedStop,
    DriverCheckResponse,
    EmergencyState,
    SentinelDecisionKind,
    TelemetryPoint,
    build_briefing_snapshot,
    evaluate_trip_sentinel,
)
from app.domain.telemetry_policy import MAX_CLOCK_SKEW
from app.domain.trip_state import IN_TRANSIT_STATES
from app.models.emergency import Emergency
from app.models.enums import AuditAction, TripEventKind, TripStatus
from app.models.fleet import Truck
from app.models.identity import Driver, User
from app.models.operations import CargoItem, GpsPoint, Shipment, Trip, TripEvent, TripStop
from app.services import audit
from app.services.trips import load_for_update, record_event, transition

_AUDITED_EMERGENCY_FIELDS = ("state", "resolved_at", "resolved_by_user_id", "resolution_note")


async def _load_telemetry_points(
    db: AsyncSession, trip_id: uuid.UUID, since: datetime
) -> list[TelemetryPoint]:
    """Fetch GPS fixes for this trip since `since` (evaluated on received_at)."""
    # Fetch coordinates using PostGIS ST_Y, ST_X
    q = (
        select(
            GpsPoint.id,
            func.ST_Y(func.geometry(GpsPoint.location)).label("lat"),
            func.ST_X(func.geometry(GpsPoint.location)).label("lon"),
            GpsPoint.recorded_at,
            GpsPoint.received_at,
            GpsPoint.accuracy_m,
        )
        .where(GpsPoint.trip_id == trip_id, GpsPoint.received_at >= since)
        .order_by(GpsPoint.received_at.asc())
    )
    rows = (await db.execute(q)).all()
    return [
        TelemetryPoint(
            id=r.id,
            lat=float(r.lat),
            lon=float(r.lon),
            recorded_at=r.recorded_at,
            received_at=r.received_at,
            accuracy_m=float(r.accuracy_m) if r.accuracy_m is not None else None,
        )
        for r in rows
    ]


async def _load_approved_stops(
    db: AsyncSession, trip_id: uuid.UUID
) -> list[ApprovedStop]:
    """Load planned and operational stops for geofence exemption."""
    q = (
        select(
            TripStop.id,
            TripStop.kind,
            func.ST_Y(func.geometry(TripStop.location)).label("lat"),
            func.ST_X(func.geometry(TripStop.location)).label("lon"),
            TripStop.name,
        )
        .where(TripStop.trip_id == trip_id)
        .order_by(TripStop.sequence.asc())
    )
    rows = (await db.execute(q)).all()
    stops = []
    for r in rows:
        if r.lat is not None and r.lon is not None:
            stops.append(
                ApprovedStop(
                    id=r.id,
                    kind=str(r.kind),
                    lat=float(r.lat),
                    lon=float(r.lon),
                    name=r.name,
                )
            )
    return stops


async def _assemble_briefing(
    db: AsyncSession,
    trip: Trip,
    emergency: Emergency,
    escalation_reason: str,
    now: datetime,
    position: tuple[float, float] | None = None,
    position_at: datetime | None = None,
) -> dict[str, Any]:
    """Freeze operational state into a snapshot dict.

    `position` is one the driver's phone reported with the request; it is
    newer than any stored fix, so it wins. `position_at` is when the phone
    took it; without it that time is unknown (null), not the request time.
    """
    driver = (
        await db.execute(select(Driver).where(Driver.id == trip.driver_id))
    ).scalar_one_or_none() if trip.driver_id else None

    driver_user = (
        await db.execute(select(User).where(User.id == driver.user_id))
    ).scalar_one_or_none() if driver and driver.user_id else None

    truck = (
        await db.execute(select(Truck).where(Truck.id == trip.truck_id))
    ).scalar_one_or_none() if trip.truck_id else None

    shipment = (
        await db.execute(select(Shipment).where(Shipment.id == trip.shipment_id))
    ).scalar_one_or_none() if trip.shipment_id else None

    stops = (
        await db.execute(
            select(TripStop)
            .where(TripStop.trip_id == trip.id)
            .order_by(TripStop.sequence.asc())
        )
    ).scalars().all()

    cargo_weight = shipment.total_weight_kg if shipment else None
    cargo_priority = (
        shipment.priority.value if shipment and shipment.priority else None
    )

    # The address says where; the name is only the stop's role ('Pickup',
    # 'Delivery'), which tells a manager on the phone nothing.
    origin_name = (stops[0].address or stops[0].name) if stops else None
    destination_name = (stops[-1].address or stops[-1].name) if stops else None

    # Last known GPS fix. None when there is none: unknown, not 0,0.
    last_lat: float | None = None
    last_lon: float | None = None
    last_fix_at: datetime | None = None
    if position is not None:
        (last_lat, last_lon), last_fix_at = position, position_at
    elif emergency.last_gps_point_id:
        pt = (
            await db.execute(
                select(
                    func.ST_Y(func.geometry(GpsPoint.location)).label("lat"),
                    func.ST_X(func.geometry(GpsPoint.location)).label("lon"),
                    GpsPoint.received_at,
                ).where(GpsPoint.id == emergency.last_gps_point_id)
            )
        ).one_or_none()
        if pt and pt.lat is not None and pt.lon is not None:
            last_lat = float(pt.lat)
            last_lon = float(pt.lon)
            last_fix_at = pt.received_at

    snapshot = build_briefing_snapshot(
        trip_code=trip.trip_code,
        driver_name=driver.full_name if driver else "Unknown",
        driver_phone=driver_user.phone if driver_user else None,
        emergency_contact_name=driver.emergency_contact_name if driver else None,
        emergency_contact_phone=driver.emergency_contact_phone if driver else None,
        truck_registration=truck.registration_number if truck else "Unknown",
        truck_model=truck.model if truck else None,
        cargo_priority=cargo_priority,
        cargo_weight_kg=cargo_weight,
        origin_name=origin_name,
        destination_name=destination_name,
        last_lat=last_lat,
        last_lon=last_lon,
        last_fix_at=last_fix_at or now,
        stationary_since=emergency.stationary_since,
        escalation_reason=escalation_reason,
        now=now,
    )
    if last_fix_at is None:
        snapshot["location"].update(fix_recorded_at=None, fix_age_seconds=None)
    return snapshot


async def get_active_emergency(
    db: AsyncSession, trip_id: uuid.UUID, *, for_update: bool = False
) -> Emergency | None:
    """Return the currently open emergency for this trip, if any."""
    q = select(Emergency).where(
        Emergency.trip_id == trip_id,
        Emergency.state.in_(
            [
                EmergencyState.DRIVER_CHECK_REQUIRED,
                EmergencyState.DRIVER_RESPONDED,
                EmergencyState.SOS_ESCALATED,
            ]
        ),
    )
    if for_update:
        # Re-read under the lock, as trips.load_for_update does (LS-9).
        q = q.with_for_update().execution_options(populate_existing=True)
    return (await db.execute(q)).scalar_one_or_none()


async def run_sentinel_sweep(
    db: AsyncSession, now: datetime | None = None
) -> list[Emergency]:
    """Execute the Fleet Sentinel monitor pass across all in-transit trips.

    Runs periodically (e.g. every 5 minutes). Deterministic, zero LLM.
    """
    if now is None:
        now = datetime.now(UTC)

    # 1. Load active in-transit trips (ACTIVE or DELAYED)
    trips_q = (
        select(Trip)
        .where(Trip.status.in_(IN_TRANSIT_STATES))
        .order_by(Trip.created_at.asc())
    )
    trips = (await db.execute(trips_q)).scalars().all()

    affected_emergencies: list[Emergency] = []

    for trip in trips:
        # Locked: record_driver_check_in locks this row too, and without it a
        # sweep that read DRIVER_CHECK_REQUIRED just before a check-in
        # committed would overwrite the driver's answer with an SOS. Emergency
        # before trip, the one lock order in this module.
        open_emergency = await get_active_emergency(db, trip.id, for_update=True)

        if open_emergency is not None:
            # Check deadline expiry for DRIVER_CHECK_REQUIRED
            if open_emergency.state == EmergencyState.DRIVER_CHECK_REQUIRED:
                if now >= open_emergency.response_deadline_at:
                    # Re-verify under the trip lock (emergency, then trip): the
                    # list above is unlocked, so a trip cancelled or delivered
                    # since must not be overwritten with INCIDENT.
                    trip = await load_for_update(db, trip.id)
                    if trip.status not in IN_TRANSIT_STATES:
                        continue
                    # 30-minute silence escalation!
                    open_emergency.state = EmergencyState.SOS_ESCALATED
                    open_emergency.escalated_at = now
                    open_emergency.briefing_snapshot = await _assemble_briefing(
                        db,
                        trip,
                        open_emergency,
                        "Driver uncontactable: 30-minute check-in deadline expired without response",
                        now,
                    )
                    # Transition trip to INCIDENT
                    if trip.status != TripStatus.INCIDENT:
                        transition(trip, TripStatus.INCIDENT)
                        await record_event(
                            db,
                            trip,
                            kind=TripEventKind.INCIDENT_OPENED,
                            description=(
                                f"Fleet Sentinel escalated SOS: stationary for >60min, "
                                f"driver did not respond within 30min window."
                            ),
                        )
                    affected_emergencies.append(open_emergency)
            continue

        # No open emergency: evaluate telemetry
        since = now - timedelta(seconds=STATIONARY_WINDOW_SECONDS + 300)
        fixes = await _load_telemetry_points(db, trip.id, since)
        stops = await _load_approved_stops(db, trip.id)

        decision = evaluate_trip_sentinel(
            fixes=fixes,
            approved_stops=stops,
            has_open_emergency=False,
            now=now,
        )

        if decision.kind == SentinelDecisionKind.COMMS_LOST:
            # Emit COMMS_LOST trip event if not recently emitted
            await record_event(
                db,
                trip,
                kind=TripEventKind.COMMS_LOST,
                description=decision.reason,
            )

        elif decision.kind == SentinelDecisionKind.DRIVER_CHECK_REQUIRED:
            # Re-verify under the trip lock: the list above is unlocked, and a
            # trip cancelled or delivered since would get an emergency and a
            # DELAY_DETECTED that nothing ever closes. No emergency is held
            # here, so taking the trip first cannot invert the lock order.
            trip = await load_for_update(db, trip.id)
            if trip.status not in IN_TRANSIT_STATES:
                continue

            deadline = now + timedelta(seconds=DRIVER_RESPONSE_WINDOW_SECONDS)
            new_emergency = Emergency(
                trip_id=trip.id,
                state=EmergencyState.DRIVER_CHECK_REQUIRED,
                triggered_at=now,
                stationary_since=decision.stationary_since or now,
                last_gps_point_id=decision.last_fix.id if decision.last_fix else None,
                check_sent_at=now,
                response_deadline_at=deadline,
            )
            try:
                async with db.begin_nested():
                    db.add(new_emergency)
                    await db.flush()
                await record_event(
                    db,
                    trip,
                    kind=TripEventKind.DELAY_DETECTED,
                    description=f"Fleet Sentinel check-in issued: {decision.reason}",
                )
                affected_emergencies.append(new_emergency)
            except IntegrityError as exc:
                # Concurrent race: another worker or scheduler already inserted an open emergency
                logger.info(
                    "Sentinel emergency for trip %s skipped (already open in concurrent pass): %s",
                    trip.id,
                    exc,
                )

    await db.commit()
    return affected_emergencies


async def record_driver_check_in(
    db: AsyncSession,
    driver: Driver,
    trip_id: uuid.UUID,
    response: DriverCheckResponse,
    now: datetime | None = None,
) -> Emergency:
    """Process a check-in response submitted by the authenticated driver."""
    if now is None:
        now = datetime.now(UTC)

    # Emergency, then trip: the order run_sentinel_sweep and resolve_emergency
    # lock in. Trip first deadlocked a check-in landing as the sweep escalated.
    emergency = await get_active_emergency(db, trip_id, for_update=True)
    trip = await load_for_update(db, trip_id)

    if trip.driver_id != driver.id:
        raise ConflictError("You are not the driver assigned to this trip.")

    if emergency is None:
        raise NotFoundError("No active check-in is required for this trip.")

    emergency.driver_response = response
    emergency.responded_at = now

    if response == DriverCheckResponse.NEED_HELP:
        # Immediate SOS escalation
        emergency.state = EmergencyState.SOS_ESCALATED
        emergency.escalated_at = now
        emergency.briefing_snapshot = await _assemble_briefing(
            db,
            trip,
            emergency,
            "Driver explicitly pressed NEED HELP during check-in",
            now,
        )
        if trip.status != TripStatus.INCIDENT:
            transition(trip, TripStatus.INCIDENT)
            await record_event(
                db,
                trip,
                kind=TripEventKind.INCIDENT_OPENED,
                description="Driver reported NEED_HELP - incident escalated to manager",
            )
    else:
        # Informational response (e.g. TRAFFIC, REST_STOP, I_AM_SAFE)
        if emergency.state == EmergencyState.DRIVER_CHECK_REQUIRED:
            emergency.state = EmergencyState.DRIVER_RESPONDED
            await record_event(
                db,
                trip,
                kind=TripEventKind.DELAY_DETECTED,
                description=f"Driver check-in response: {response.value}",
            )
        # If already SOS_ESCALATED, late response is kept and recorded without downgrading

    await db.commit()
    await db.refresh(emergency)
    return emergency


async def escalate_driver_sos(
    db: AsyncSession,
    trip: Trip,
    emergency: Emergency | None,
    *,
    request_id: str,
    reason: str,
    category: str,
    lat: float | None,
    lon: float | None,
    now: datetime,
    fix_at: datetime | None = None,
) -> Emergency:
    """A driver's stop request, as the trip's open emergency in SOS_ESCALATED.

    The caller holds `emergency` (the trip's open one, or None) and then the
    trip, in that order. An open Sentinel check is escalated in place so its
    history stays; otherwise a new row is raised. The trip status is left to
    the manager (driver_trips.request_stop says why).

    A driver-raised SOS has no stationary detection and no check, so
    `triggered_at`, `stationary_since`, `check_sent_at` and
    `response_deadline_at` are all the moment the driver asked: no window is
    open, and the sweep, which only acts on DRIVER_CHECK_REQUIRED, has nothing
    to escalate or downgrade. `driver_response` stays empty - the driver
    answered no check; what they said is in the briefing's `driver_request`.
    Nothing measured a stop either, so the briefing's stopped_since and
    stopped_duration_minutes are null (unknown), not "just now, 0 min". So
    are they for a check the driver already answered: Sentinel no longer
    tracks that stop, and the truck may have driven on since.

    The position is the phone's, timed by its `fix_at`, else the trip's
    newest fix - also for an escalated check, whose stored fix can be hours
    old (a DRIVER_RESPONDED check never closes by itself).
    """
    # Newest by when the truck was there, as telemetry.latest_position (the
    # fleet map): an offline backlog lands in one batch sharing received_at.
    last_fix = (
        await db.execute(
            select(GpsPoint.id)
            .where(GpsPoint.trip_id == trip.id)
            .order_by(
                GpsPoint.recorded_at.desc(),
                GpsPoint.received_at.desc(),
                GpsPoint.id.desc(),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    # Device time, taken as telemetry takes it: naive is UTC, and a clock
    # further ahead than MAX_CLOCK_SKEW is no evidence (unknown).
    if fix_at is not None:
        fix_at = fix_at if fix_at.tzinfo else fix_at.replace(tzinfo=UTC)
        if fix_at > now + MAX_CLOCK_SKEW:
            fix_at = None
    if emergency is None:
        raised = Emergency(
            trip_id=trip.id,
            state=EmergencyState.SOS_ESCALATED,
            triggered_at=now,
            stationary_since=now,
            check_sent_at=now,
            response_deadline_at=now,
        )
        try:
            async with db.begin_nested():
                db.add(raised)
                await db.flush()
            emergency = raised
        except IntegrityError:
            # The sweep inserts its check under the trip lock, so it committed
            # between the caller's emergency read and its trip lock. Escalate
            # that one. ponytail: this lock comes after the trip's, the one
            # inversion; a check-in or resolve would have to take this
            # brand-new row in the same instant, and Postgres's deadlock
            # detector breaks that tie (the phone retries on the same id).
            emergency = await get_active_emergency(db, trip.id, for_update=True)

    if last_fix is not None:
        emergency.last_gps_point_id = last_fix
    emergency.state = EmergencyState.SOS_ESCALATED
    emergency.escalated_at = emergency.escalated_at or now
    briefing = await _assemble_briefing(
        db,
        trip,
        emergency,
        f"Driver requested an emergency stop ({category}): {reason}",
        now,
        position=(lat, lon) if lat is not None and lon is not None else None,
        position_at=fix_at,
    )
    briefing["escalated_at"] = emergency.escalated_at.isoformat()
    # A driver-raised row opened no check window (deadline == sent), so no
    # stop was measured - also when a later request re-escalates it. An
    # answered check's stop is no longer tracked; the row keeps its
    # stationary_since as history.
    if (
        emergency.response_deadline_at == emergency.check_sent_at
        or emergency.driver_response is not None
    ):
        briefing["location"].update(stopped_since=None, stopped_duration_minutes=None)
    briefing["driver_request"] = {
        "request_id": request_id,
        "reason": reason,
        "category": category,
    }
    emergency.briefing_snapshot = briefing
    return emergency


async def resolve_emergency(
    db: AsyncSession,
    emergency_id: uuid.UUID,
    actor: User,
    *,
    note: str | None = None,
    is_false_alarm: bool = False,
    now: datetime | None = None,
    ip: str | None = None,
) -> Emergency:
    """Resolve an open emergency (manager action)."""
    if now is None:
        now = datetime.now(UTC)

    emergency = (
        await db.execute(
            select(Emergency)
            .where(Emergency.id == emergency_id)
            .with_for_update()
        )
    ).scalar_one_or_none()

    if emergency is None:
        raise NotFoundError("Emergency not found.")

    if emergency.state in (EmergencyState.RESOLVED, EmergencyState.FALSE_ALARM):
        raise ConflictError("Emergency is already resolved.")

    trip = (
        await db.execute(select(Trip).where(Trip.id == emergency.trip_id).with_for_update())
    ).scalar_one()

    before = audit.snapshot(emergency, _AUDITED_EMERGENCY_FIELDS)
    emergency.state = EmergencyState.FALSE_ALARM if is_false_alarm else EmergencyState.RESOLVED
    emergency.resolved_at = now
    emergency.resolved_by_user_id = actor.id
    emergency.resolution_note = note

    # If the trip was placed in INCIDENT due to this emergency, return to ACTIVE
    if trip.status == TripStatus.INCIDENT:
        transition(trip, TripStatus.ACTIVE)
    # Always, whatever the trip status: a driver's stop request opens an
    # incident on an ACTIVE trip, and the timeline must show it closing.
    await record_event(
        db,
        trip,
        kind=TripEventKind.INCIDENT_RESOLVED,
        description=(
            f"Incident {'closed as a false alarm' if is_false_alarm else 'resolved'}"
            f" by manager: {note or 'no note given'}"
        ),
        payload={
            "emergency_id": str(emergency.id),
            "note": note,
            "is_false_alarm": is_false_alarm,
        },
        actor_user_id=actor.id,
    )
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="emergencies",
        entity_id=emergency.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(emergency, _AUDITED_EMERGENCY_FIELDS),
        reason=note,
        ip_address=ip,
    )

    await db.commit()
    await db.refresh(emergency)
    return emergency
