"""Reroute a trip that is already moving - only when a person says so.

Two operations, and the split between them is the whole design.

    assess()   read-only. Scores the road the truck is on and the roads beside
               it, and returns NO_ACTION / ALERT_ONLY / PROPOSE. Writes nothing.

    accept()   a person's decision, applied. Takes the route the manager saw
               and the route they chose, and moves the trip onto it inside one
               transaction, with a record on the trip's timeline.

NOTHING REROUTES ITSELF

There is no scheduler here, no background task that applies a proposal, and no
code path from `assess` to `accept`. The truck's route changes when a human
posts to the accept endpoint and not otherwise. A driver on a hill road at
night whose map silently changes has been given an instruction nobody issued
and nobody can be asked about.

NO MODEL WRITES TRIP STATE

`accept` takes two route ids and an actor. There is no free text, no generated
instruction, and nothing derived from a language model anywhere on the write
path. The only judgement encoded is a threshold and a comparison, both
published in `app/domain/`.

THE ACCEPT IS GUARDED AGAINST A STALE SCREEN

`from_route_id` is required and must match what the trip currently has
selected. A manager acting on a page rendered before someone else rerouted the
same trip would otherwise move it off a road they never saw. That is a 409
telling them to reload, not a silent overwrite - the two managers disagree, and
the database is not the place to resolve that.

WHAT IS PERSISTED, AND WHAT IS NOT

The DECISION is persisted: a `ROUTE_CHANGED` event carrying the route it came
from, the route it went to, who decided, and when. The PROPOSAL is not. A
proposal is a statement about this hour's weather, and a stored one would sit
in the timeline looking like advice that still stands. The same reason risk
scores are not stored.

A DECLINED proposal is currently not recorded at all, because there is no
honest way to say so with the existing `trip_event_kind` values - see
`docs/migrations/PENDING_reroute_decision_events.sql`. That migration is
prepared and deliberately NOT applied.
"""

import uuid
from datetime import UTC, datetime
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.domain.reroute import RerouteAssessment
from app.domain.reroute import assess as assess_routes
from app.domain.route_recommendation import RouteCandidate
from app.models.enums import TripEventKind
from app.models.identity import User
from app.models.operations import Trip, TripRoute
from app.services import routes as route_service
from app.services import trips as trip_service
from app.services.driver_trips import IN_PROGRESS_STATUSES
from app.services.route_recommendation import candidates_for_trip

#: Recorded on the event so a timeline row can be traced back to the rule that
#: produced it, without the rule having to be guessed from the numbers.
DECISION_SOURCE: Final[str] = "manager-accepted-reroute-v1"


async def assess(
    db: AsyncSession, trip_id: uuid.UUID
) -> tuple[RerouteAssessment, list[RouteCandidate]]:
    """Should anything be raised about this trip's route right now.

    Read-only and not persisted, for the same reason the risk and
    recommendation endpoints are not: an assessment is a statement about
    current conditions, and a stored one goes on looking current after it stops
    being true.

    Returns the candidates as well, so a proposal reaches a manager with the
    per-route figures behind it rather than as a bare instruction to turn off.

    The database connection is released before any provider call - see
    `route_recommendation.candidates_for_trip`, which owns that guarantee.
    """
    trip = await trip_service.get(db, trip_id)
    in_transit = trip.status in IN_PROGRESS_STATUSES
    selected_id = str(trip.selected_route_id) if trip.selected_route_id else None

    if not in_transit:
        # Skip the provider fan-out entirely. A trip that has not left cannot
        # be rerouted, so ten weather requests would buy an answer already
        # determined - and this endpoint is the one a fleet view is most
        # tempted to call for every row.
        await db.commit()
        return (
            assess_routes(in_transit=False, selected=None, alternatives=[]),
            [],
        )

    candidates = await candidates_for_trip(db, trip_id)

    selected = next((c for c in candidates if c.route_id == selected_id), None)
    alternatives = [c for c in candidates if c.route_id != selected_id]

    return (
        assess_routes(in_transit=True, selected=selected, alternatives=alternatives),
        candidates,
    )


async def accept(
    db: AsyncSession,
    trip_id: uuid.UUID,
    *,
    from_route_id: uuid.UUID,
    to_route_id: uuid.UUID,
    actor: User,
    ip: str | None = None,
    authorization_id: uuid.UUID | None = None,
) -> tuple[Trip, TripRoute]:
    """Move a moving trip onto a different route, because a person said to.

    One transaction: the route change, the demotion of the route it left, the
    trip's `selected_route_id`, the timeline event and the audit row all land
    together. A version that committed the selection first would be able to
    leave a trip whose route moved with nothing on the timeline explaining it,
    which is precisely the record an incident review needs.

    No risk SCORE is recomputed here. Re-scoring at the moment of the click
    would let a weather blip between the manager reading the proposal and
    acting on it override their decision - and the decision is theirs. What
    the rule thought is ephemeral; what the manager did is the fact worth
    keeping.

    ELIGIBILITY is different and IS checked here (LS-5/LS-6). A manager may
    overrule a score; nobody may move a truck onto a road an authority has
    closed. That is a refusal rather than an opinion, so it is re-established
    at the moment of the mutation rather than trusted from the proposal.
    """
    if from_route_id == to_route_id:
        raise ConflictError(
            "That trip is already on this route.",
            code="ROUTE_UNCHANGED",
            details={"route_id": str(to_route_id)},
        )

    # Eligibility is established BEFORE the trip row is locked, because
    # assessing it is network I/O (hazard providers) and holding a lock across
    # somebody else's server is the cost `route_risk` already avoids. The
    # decision is computed server-side from the route's own geometry - the
    # manager's client cannot assert that a route is clear.
    from app.services import route_risk as route_risk_service

    eligibility, assessment = (
        await route_risk_service.eligibility_and_evidence_for_route(db, to_route_id)
    )
    # Refused HERE, not later inside apply_selection. `accept` locks the trip
    # and reads its routes before it reaches that call, so leaving the refusal
    # downstream meant a closed target still took a row lock and did read work
    # that could never be used. Found by a test that fails if the database is
    # touched before the refusal.
    #
    # A REQUIRES_REVIEW target with an authorisation offered is allowed past
    # this point ONLY so it can reach the claim under the lock; the
    # authorisation is validated and spent there, never here.
    route_service.refuse_if_ineligible(
        eligibility, offered_authorization=authorization_id is not None
    )

    trip = await trip_service.load_for_update(db, trip_id)

    if trip.status not in IN_PROGRESS_STATUSES:
        # Rerouting a trip that has not started is ordinary planning, and the
        # route-select endpoint already does it without telling anybody a
        # journey changed mid-way.
        raise ConflictError(
            "This trip is not under way, so there is nothing to reroute. "
            "Change its route from planning instead.",
            code="TRIP_NOT_IN_TRANSIT",
            details={"current": trip.status.value},
        )

    if trip.selected_route_id != from_route_id:
        # A stale screen, or two managers acting at once. Either way the route
        # they were looking at is not the one the trip is on, so applying their
        # choice would move it off a road they never saw.
        raise ConflictError(
            "This trip's route changed while you were deciding. Reload and "
            "look again before rerouting.",
            code="ROUTE_SUPERSEDED",
            details={
                "current_route_id": (
                    str(trip.selected_route_id) if trip.selected_route_id else None
                )
            },
        )

    route, previous_selected_id = await route_service.apply_selection(
        db,
        trip_id,
        to_route_id,
        actor=actor,
        ip=ip,
        reason="rerouted mid-trip by manager",
        eligibility=eligibility,
        authorization_id=authorization_id,
        assessment=assessment,
    )

    await trip_service.record_event(
        db,
        trip,
        kind=TripEventKind.ROUTE_CHANGED,
        description=(
            f"route changed to {route.kind.value} "
            f"({route.distance_km} km) by {actor.display_name}"
        ),
        payload={
            # Ids, not prose. The timeline renders this in the manager's
            # language from local files; a sentence built here arrives
            # untranslatable, the same rule the reason codes follow.
            "from_route_id": str(previous_selected_id or from_route_id),
            "to_route_id": str(route.id),
            "to_route_kind": route.kind.value,
            "decided_by_user_id": str(actor.id),
            "decided_at": datetime.now(UTC).isoformat(),
            "source": DECISION_SOURCE,
        },
        actor_user_id=actor.id,
    )

    await db.commit()
    await db.refresh(trip)
    await db.refresh(route)
    return trip, route

