"""Trip lifecycle state machine.

The enum stops a trip status being an arbitrary string. This module stops it
being an arbitrary *sequence* of valid strings, which is the more damaging
failure: a trip that jumps from DRAFT straight to DELIVERED passes every column
constraint while destroying the audit trail and the safety guarantees that
depend on ACTIVE meaning "a truck is moving right now".

Deterministic application logic. No model participates in a transition.
See docs/ARCHITECTURE.md Diagram D.
"""

from app.models.enums import TripStatus

S = TripStatus

#: Legal transitions. Anything absent here is prohibited.
ALLOWED_TRANSITIONS: dict[TripStatus, frozenset[TripStatus]] = {
    # Planning
    S.DRAFT: frozenset({S.ASSIGNED, S.CANCELLED}),
    # Truck and driver chosen, capacity validated.
    S.ASSIGNED: frozenset({S.VERIFICATION_PENDING, S.ACTIVE, S.CANCELLED}),
    # Driver must photograph a truck they have not driven before.
    S.VERIFICATION_PENDING: frozenset({S.ASSIGNED, S.MANAGER_REVIEW, S.CANCELLED}),
    # A reported mismatch waits on a human.
    S.MANAGER_REVIEW: frozenset({S.ASSIGNED, S.CANCELLED}),
    # On the road.
    S.ACTIVE: frozenset({S.DELAYED, S.INCIDENT, S.DELIVERED, S.CANCELLED}),
    S.DELAYED: frozenset({S.ACTIVE, S.INCIDENT, S.DELIVERED, S.CANCELLED}),
    # INCIDENT is a suspension, not a terminus - a stuck truck that resumes
    # returns to ACTIVE.
    S.INCIDENT: frozenset({S.ACTIVE, S.DELAYED, S.CANCELLED}),
    # Delivered, awaiting settlement.
    S.DELIVERED: frozenset({S.CLOSED}),
    # Terminal.
    S.CLOSED: frozenset(),
    S.CANCELLED: frozenset(),
}

#: States from which no transition is possible.
TERMINAL_STATES: frozenset[TripStatus] = frozenset({S.CLOSED, S.CANCELLED})

#: States in which a truck is considered to be on the road. Fleet Sentinel
#: monitors exactly these, and the partial index ix_trips_active matches.
IN_TRANSIT_STATES: frozenset[TripStatus] = frozenset({S.ACTIVE, S.DELAYED})

#: States in which the phone may still report - position, and what it saw.
#:
#: IN_TRANSIT_STATES plus INCIDENT, and that one addition is the whole point.
#: An incident is a SUSPENSION of a journey, not the end of one: the truck is
#: still on the road, the driver is still beside it, and a dispatcher trying to
#: reach them needs the position more urgently than at any other moment of the
#: trip.
#:
#: Collection used to stop dead at that moment. `submit_location` gated on
#: "is the driver executing", which is the right question for starting a trip
#: or completing a stop and the wrong one for telemetry, so the instant Fleet
#: Sentinel escalated a truck to INCIDENT - or a driver answered a check-in
#: with NEED_HELP - the server began refusing that truck's fixes with a 409.
#: The phone classifies a 4xx as permanent and discards the batch, so the
#: positions were not merely unrecorded, they were thrown away, and the fleet
#: map showed a truck going quiet at exactly the moment it was in trouble.
#:
#: Still bounded, and the bound is the privacy commitment in
#: docs/SECURITY.md section 3: collection happens during a trip and not
#: outside one. DELIVERED and CLOSED are excluded - the journey is over and a
#: phone still uploading would be tracking a person off duty.
COLLECTS_TELEMETRY: frozenset[TripStatus] = frozenset(
    {S.ACTIVE, S.DELAYED, S.INCIDENT}
)

#: States in which the trip still ties this driver to this truck, so the
#: assignment behind it must not be ended.
#:
#: Distinct from both neighbours above, deliberately:
#:
#:   IN_TRANSIT_STATES  is narrower - it answers "is the truck moving", which
#:                      is the wrong question here. A truck stopped at an
#:                      INCIDENT, or one that has DELIVERED and is waiting to
#:                      be closed, is still the truck that driver is with.
#:
#:   not-TERMINAL       is wider - it would also catch DRAFT, ASSIGNED,
#:                      VERIFICATION_PENDING and MANAGER_REVIEW, where the
#:                      driver has not started. Moving a driver at the planning
#:                      stage is ordinary dispatch work, and blocking it would
#:                      mean a trip planned onto the wrong truck pins the
#:                      driver until someone cancels it - a worse failure than
#:                      the one this set exists to prevent.
#:
#: The line therefore sits at ACTIVE: before it the pairing is a plan, from it
#: onward the pairing is a fact about where a person physically is.
COMMITS_DRIVER_TO_TRUCK: frozenset[TripStatus] = frozenset(
    {S.ACTIVE, S.DELAYED, S.INCIDENT, S.DELIVERED}
)

#: States in which the trip is the driver's to act on, so the account behind
#: them must remain able to sign in.
#:
#: Wider than COMMITS_DRIVER_TO_TRUCK on purpose, and for a different question.
#: That set asks "is this pairing a physical fact"; this one asks "would
#: disabling this login strand a trip". A dispatched trip the driver has not
#: started yet is still theirs to start, and a driver who cannot authenticate
#: can never start it - the trip sits ASSIGNED forever holding a truck, which
#: is the same stranding the dispatch gate exists to prevent, arrived at from
#: the other side.
#:
#: DRAFT is excluded: it has not been dispatched, so it is not the driver's
#: yet and a manager can simply re-plan it. Terminal states are excluded
#: because nothing is left to act on.
REQUIRES_DRIVER_LOGIN: frozenset[TripStatus] = frozenset(
    set(TripStatus) - TERMINAL_STATES - {S.DRAFT}
)


class IllegalTripTransition(ValueError):
    """Raised when a caller attempts a transition the lifecycle forbids."""

    def __init__(self, current: TripStatus, target: TripStatus) -> None:
        allowed = sorted(s.value for s in ALLOWED_TRANSITIONS.get(current, frozenset()))
        super().__init__(
            f"Illegal trip transition {current.value} -> {target.value}. "
            f"Allowed from {current.value}: {allowed or 'none (terminal state)'}"
        )
        self.current = current
        self.target = target


def can_transition(current: TripStatus, target: TripStatus) -> bool:
    """Whether `current -> target` is permitted."""
    return target in ALLOWED_TRANSITIONS.get(current, frozenset())


def assert_transition(current: TripStatus, target: TripStatus) -> None:
    """Raise IllegalTripTransition unless the move is permitted.

    Call this before writing a new status, never after.
    """
    if not can_transition(current, target):
        raise IllegalTripTransition(current, target)


def is_terminal(status: TripStatus) -> bool:
    return status in TERMINAL_STATES


def is_in_transit(status: TripStatus) -> bool:
    return status in IN_TRANSIT_STATES
