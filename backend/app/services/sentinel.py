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
    POSITION_FROM_DEVICE,
    POSITION_FROM_LAST_FIX,
    POSITION_UNKNOWN,
    STATIONARY_WINDOW_SECONDS,
    ApprovedStop,
    DriverCheckResponse,
    EmergencyState,
    SentinelDecisionKind,
    TelemetryPoint,
    build_briefing_snapshot,
    evaluate_trip_sentinel,
)
from app.domain.trip_state import IN_TRANSIT_STATES
from app.models.emergency import Emergency
from app.models.enums import TripEventKind, TripStatus
from app.models.fleet import Truck
from app.models.identity import Driver, User
from app.models.operations import CargoItem, GpsPoint, Shipment, Trip, TripEvent, TripStop
from app.services.trips import record_event, transition


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
    device_position: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Freeze operational state into a snapshot dict.

    `device_position` is what the phone said when the driver pressed SOS. It
    takes precedence over the last fix the server received, because it is
    newer by definition and because the fix may be an hour old from before the
    valley. When there is neither, the snapshot says so - see
    `build_briefing_snapshot`.
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

    origin_name = stops[0].name if stops else None
    destination_name = stops[-1].name if stops else None

    # Last known position. None until something actually supplies one: a
    # briefing that defaulted to 0.0 put the truck in the Gulf of Guinea and
    # rendered it as a plausible coordinate in the dispatcher's dossier.
    last_lat: float | None = None
    last_lon: float | None = None
    last_fix_at: datetime | None = None
    position_source = POSITION_UNKNOWN
    if emergency.last_gps_point_id:
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
            position_source = POSITION_FROM_LAST_FIX

    if device_position is not None:
        # Newer than any fix the server holds, and the only position that
        # exists at all when the driver has been out of coverage.
        last_lat, last_lon = device_position
        last_fix_at = now
        position_source = POSITION_FROM_DEVICE

    return build_briefing_snapshot(
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
        last_fix_at=last_fix_at,
        stationary_since=emergency.stationary_since,
        escalation_reason=escalation_reason,
        now=now,
        position_source=position_source,
    )


async def get_active_emergency(
    db: AsyncSession, trip_id: uuid.UUID
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
        # Check for open emergency
        open_emergency = await get_active_emergency(db, trip.id)

        if open_emergency is not None:
            # Check deadline expiry for DRIVER_CHECK_REQUIRED
            if open_emergency.state == EmergencyState.DRIVER_CHECK_REQUIRED:
                if now >= open_emergency.response_deadline_at:
                    # Re-verify trip is still in-transit
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
            # Re-verify trip is still in-transit
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

    # Lock trip
    trip = (
        await db.execute(select(Trip).where(Trip.id == trip_id).with_for_update())
    ).scalar_one_or_none()
    if trip is None:
        raise NotFoundError("Trip not found.")

    if trip.driver_id != driver.id:
        raise ConflictError("You are not the driver assigned to this trip.")

    emergency = (
        await db.execute(
            select(Emergency)
            .where(
                Emergency.trip_id == trip_id,
                Emergency.state.in_(
                    [
                        EmergencyState.DRIVER_CHECK_REQUIRED,
                        EmergencyState.DRIVER_RESPONDED,
                        EmergencyState.SOS_ESCALATED,
                    ]
                ),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()

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


async def record_driver_sos(
    db: AsyncSession,
    *,
    driver: Driver,
    trip: Trip,
    now: datetime | None = None,
    location: tuple[float, float] | None = None,
) -> Emergency:
    """The driver pressed for help. Open or escalate the emergency, once.

    WHY THIS IS SEPARATE FROM `record_driver_check_in`

    Check-in answers a question Fleet Sentinel asked. This one is asked by
    nobody: a driver presses SOS because something is wrong, and there may be
    no open emergency to answer. `record_driver_check_in` refuses with "no
    active check-in is required for this trip", which is the correct answer to
    a check-in and the wrong answer to a person in trouble.

    IDEMPOTENT THROUGH ITS CALLER, AND AGAIN HERE

    The replay path (`app/services/device_events.py`) only reaches this after
    the event row was genuinely inserted, so a re-sent batch never arrives.
    This function is idempotent regardless: an emergency already in
    SOS_ESCALATED is returned unchanged rather than escalated a second time,
    and the unique partial index on open emergencies catches the concurrent
    case, which is how `run_sentinel_sweep` handles the same race.

    NO SENTINEL MEASUREMENTS ARE INVENTED

    `stationary_since`, `check_sent_at` and `response_deadline_at` stay NULL.
    The truck may be moving, no check was sent, and there is no window to wait
    out. See migration 0013.
    """
    now = now or datetime.now(UTC)

    # Lock the trip first, exactly as the check-in path does: it serialises two
    # presses of the same button and it is the row the status transition below
    # will write.
    locked = (
        await db.execute(select(Trip).where(Trip.id == trip.id).with_for_update())
    ).scalar_one_or_none()
    if locked is None:
        raise NotFoundError("Trip not found.")
    if locked.driver_id != driver.id:
        raise ConflictError("You are not the driver assigned to this trip.")

    emergency = (
        await db.execute(
            select(Emergency)
            .where(
                Emergency.trip_id == locked.id,
                Emergency.state.in_(
                    [
                        EmergencyState.DRIVER_CHECK_REQUIRED,
                        EmergencyState.DRIVER_RESPONDED,
                        EmergencyState.SOS_ESCALATED,
                    ]
                ),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()

    if emergency is not None and emergency.state is EmergencyState.SOS_ESCALATED:
        # Already escalated - by a previous press, by the silence rule, or by a
        # NEED_HELP check-in. The trip event recording this press is still
        # written by the caller, so the audit trail keeps both.
        return emergency

    if emergency is None:
        emergency = Emergency(
            trip_id=locked.id,
            state=EmergencyState.SOS_ESCALATED,
            triggered_at=now,
            stationary_since=None,
            check_sent_at=None,
            response_deadline_at=None,
            driver_response=DriverCheckResponse.NEED_HELP,
            responded_at=now,
            escalated_at=now,
        )
        try:
            async with db.begin_nested():
                db.add(emergency)
                await db.flush()
        except IntegrityError:
            # A concurrent writer opened one between the select and the insert.
            # Adopt theirs rather than failing the driver's SOS.
            logger.info(
                "driver SOS for trip %s met a concurrently opened emergency", locked.id
            )
            emergency = (
                await db.execute(
                    select(Emergency)
                    .where(
                        Emergency.trip_id == locked.id,
                        Emergency.state.in_(
                            [
                                EmergencyState.DRIVER_CHECK_REQUIRED,
                                EmergencyState.DRIVER_RESPONDED,
                                EmergencyState.SOS_ESCALATED,
                            ]
                        ),
                    )
                    .with_for_update()
                )
            ).scalar_one()
            emergency.state = EmergencyState.SOS_ESCALATED
            emergency.escalated_at = now
            emergency.driver_response = DriverCheckResponse.NEED_HELP
            emergency.responded_at = now
    else:
        # An open check-in the driver answered by pressing SOS instead.
        emergency.state = EmergencyState.SOS_ESCALATED
        emergency.escalated_at = now
        emergency.driver_response = DriverCheckResponse.NEED_HELP
        emergency.responded_at = now

    emergency.briefing_snapshot = await _assemble_briefing(
        db,
        locked,
        emergency,
        "Driver pressed SOS on the phone",
        now,
        device_position=location,
    )

    if locked.status != TripStatus.INCIDENT:
        transition(locked, TripStatus.INCIDENT)
        await record_event(
            db,
            locked,
            kind=TripEventKind.INCIDENT_OPENED,
            description="Driver pressed SOS - incident escalated to manager",
        )

    # No commit: the caller owns the transaction, so the SOS event row and the
    # emergency it opened land together or not at all.
    await db.flush()
    return emergency


async def resolve_emergency(
    db: AsyncSession,
    emergency_id: uuid.UUID,
    actor: User,
    *,
    note: str | None = None,
    is_false_alarm: bool = False,
    now: datetime | None = None,
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

    emergency.state = EmergencyState.FALSE_ALARM if is_false_alarm else EmergencyState.RESOLVED
    emergency.resolved_at = now
    emergency.resolved_by_user_id = actor.id
    emergency.resolution_note = note

    # If the trip was placed in INCIDENT due to this emergency, return to ACTIVE
    if trip.status == TripStatus.INCIDENT:
        transition(trip, TripStatus.ACTIVE)
        await record_event(
            db,
            trip,
            kind=TripEventKind.INCIDENT_RESOLVED,
            description=f"Incident resolved by manager: {note or 'all clear'}",
            actor_user_id=actor.id,
        )

    await db.commit()
    await db.refresh(emergency)
    return emergency
