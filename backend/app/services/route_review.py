"""Issuing, revoking and spending a review authorisation.

THE ONE-SENTENCE RULE

A reviewer may accept a specific, incomplete evidence picture so that ONE
selection of ONE route may proceed. Nothing here changes what the evidence
says, and nothing here can reach REJECTED or NOT_ASSESSED.

WHAT MAKES IT SAFE, IN THE ORDER IT MATTERS

  1. Only assessed HAZARD_DATA_UNKNOWN is authorisable (approved policy). HIGH
     is refused here even though the schema can represent it, REJECTED and
     NOT_ASSESSED have no path at all.
  2. The evidence is DIGESTED at issue and re-digested at consumption. If the
     corridor's evidence changed in any way that matters, the digest differs
     and the authorisation is dead.
  3. The claim is a single conditional UPDATE inside the selection's own
     transaction, under the trip row lock. Check and spend are one statement,
     so there is no window between validating and consuming.

WHO MAY ACCEPT THE RISK (policy 2026-09-18)

The fleet MANAGER is the operational decision-maker. `approve_and_select`
lets one manager accept the incomplete evidence, say why, and act on it in ONE
transaction - the authorisation row is issued and spent together, so a
refusal anywhere leaves nothing behind. The separate AUTHORISED_REVIEWER path
(`issue`, then a manager spends it) still works and is kept for audit and a
future second-level workflow; it is no longer required for a dispatch.
Two-person control is therefore not enforced at consumption any more. It was
one WHERE clause (`reviewer_user_id != actor.id`) and can return as one.

WHY THE DIGEST IS WHAT IT IS

Over the normalised `LandslideAssessment` only, and only six of its fields.
NOT over `RouteRisk`, which carries `assessed_at` - a digest that moved on
every read would expire every authorisation within seconds of issue. NOT over
`considered_count` either: that counts incidents the provider returned before
route filtering, so a landslide somewhere else in the query box would change it
while nothing on this corridor changed, and an authorisation would die on
irrelevant news.

What IS in it: the risk band, the data status, the provider, how many incidents
are ON this route, how many could not be placed, and the sorted reason codes.
Those are exactly the things a reviewer looked at.
"""

import hashlib
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessRuleError, NotFoundError
from app.domain.landslide import VERSION as EVIDENCE_VERSION
from app.domain.landslide import LandslideAssessment, LandslideRisk
from app.domain.route_eligibility import Eligibility, EligibilityDecision
from app.models.enums import AuditAction, RouteReviewBasis
from app.models.identity import User
from app.models.review import RouteReviewAuthorization
from app.services import audit

logger = logging.getLogger(__name__)

#: How long an authorisation stays spendable. Approved 2026-09-05.
#:
#: A PROTOTYPE PARAMETER, not a derived safety property. It does not mean a
#: road stays passable for thirty minutes; it bounds how long a person's
#: reading of the evidence is allowed to stand before they must look again.
AUTHORIZATION_TTL: Final[timedelta] = timedelta(minutes=30)

#: The only band a reviewer may authorise under the approved policy.
#:
#: HIGH is deliberately excluded. UNKNOWN means nobody measured this corridor;
#: HIGH means an authority reported an incident ON it. Delegating "unmeasured"
#: is a different act from delegating "known dangerous", and only the first is
#: in scope.
AUTHORIZABLE_RISK: Final[LandslideRisk] = LandslideRisk.UNKNOWN

AUDITED_FIELDS = (
    "id", "trip_id", "route_id", "reviewer_user_id", "basis",
    "policy_version", "evidence_version", "expires_at",
)


def evidence_digest(assessment: LandslideAssessment) -> str:
    """A stable fingerprint of the evidence a reviewer was shown.

    Equivalent evidence MUST produce an identical digest, or every
    authorisation dies on the next poll. A substantive on-route change MUST
    produce a different one, or a stale review authorises today's mutation.
    Both properties are tested.
    """
    canonical = json.dumps(
        {
            "risk": assessment.risk.value,
            "data_status": assessment.data_status.value,
            "provider": assessment.provider,
            "on_route_count": assessment.on_route_count,
            "unlocatable_count": assessment.unlocatable_count,
            # Sorted: provider ordering is not evidence.
            "reason_codes": sorted(assessment.reason_codes),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def snapshot_of(assessment: LandslideAssessment) -> dict:
    """The assessment as shown, for the incident review that will ask later."""
    return {
        "risk": assessment.risk.value,
        "data_status": assessment.data_status.value,
        "provider": assessment.provider,
        "considered_count": assessment.considered_count,
        "on_route_count": assessment.on_route_count,
        "unlocatable_count": assessment.unlocatable_count,
        "reason_codes": list(assessment.reason_codes),
    }


def basis_for(assessment: LandslideAssessment) -> RouteReviewBasis:
    if assessment.risk is LandslideRisk.UNKNOWN:
        return RouteReviewBasis.HAZARD_DATA_UNKNOWN
    return RouteReviewBasis.HIGH_HAZARD_REPORTED


def refuse_unless_authorizable(
    decision: EligibilityDecision, assessment: LandslideAssessment | None
) -> None:
    """Whether a reviewer is even allowed to be asked about this route.

    Ordered so the two absolute refusals are unreachable by any argument:
    REJECTED and NOT_ASSESSED raise before the policy question is considered.
    """
    if decision.eligibility is Eligibility.REJECTED:
        raise BusinessRuleError(
            "That route is blocked by an active hazard. A closed road cannot "
            "be authorised by anyone.",
            code="ROUTE_REJECTED_ACTIVE_HAZARD",
        )
    if decision.eligibility is Eligibility.NOT_ASSESSED:
        raise BusinessRuleError(
            "Route eligibility could not be assessed, so there is nothing to "
            "review. This is an integration failure, not uncertainty about a "
            "road; it must be fixed rather than approved.",
            code="ROUTE_ELIGIBILITY_NOT_ASSESSED",
        )
    if decision.eligibility is Eligibility.ELIGIBLE:
        raise BusinessRuleError(
            "That route is already eligible; it needs no authorisation.",
            code="ROUTE_REVIEW_NOT_REQUIRED",
        )
    if assessment is None or assessment.risk is not AUTHORIZABLE_RISK:
        # HIGH lands here under the approved policy.
        raise BusinessRuleError(
            "Only routes whose required hazard evidence is UNKNOWN may be "
            "authorised. A reported hazard on this corridor is not delegable "
            "under the current policy.",
            code="ROUTE_REVIEW_BASIS_NOT_AUTHORIZABLE",
        )


async def _issue(
    db: AsyncSession,
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    *,
    reviewer: User,
    rationale: str,
    decision: EligibilityDecision,
    assessment: LandslideAssessment | None,
    route_state: str,
    ip: str | None = None,
) -> RouteReviewAuthorization:
    """Write the authorisation and its audit row WITHOUT committing.

    Every bound value is computed HERE from the route's own assessment. There
    is no argument by which a caller could assert what it is authorising - the
    same rule `eligibility_for_route` follows and the reason it computes its own
    decision rather than accepting one.
    """
    refuse_unless_authorizable(decision, assessment)
    assert assessment is not None  # guaranteed by the guard above

    if len(rationale.strip()) < 20:
        raise BusinessRuleError(
            "A rationale of at least 20 characters is required. This is the "
            "only record of why the risk was accepted.",
            code="ROUTE_REVIEW_RATIONALE_REQUIRED",
        )

    now = datetime.now(UTC)
    authorization = RouteReviewAuthorization(
        trip_id=trip_id,
        route_id=route_id,
        evidence_digest=evidence_digest(assessment),
        evidence_snapshot=snapshot_of(assessment),
        policy_version=decision.policy_version,
        evidence_version=EVIDENCE_VERSION,
        basis=basis_for(assessment),
        route_state_at_issue=route_state,
        reviewer_user_id=reviewer.id,
        rationale=rationale.strip(),
        issued_at=now,
        expires_at=now + AUTHORIZATION_TTL,
    )
    db.add(authorization)
    try:
        await db.flush()
    except Exception as exc:  # noqa: BLE001 - translate the index into a rule
        await db.rollback()
        raise BusinessRuleError(
            "This route already has a live authorisation. Revoke it before "
            "issuing another.",
            code="ROUTE_REVIEW_ALREADY_AUTHORIZED",
        ) from exc

    await audit.record(
        db,
        action=AuditAction.CREATE,
        entity_type="route_review_authorizations",
        entity_id=authorization.id,
        actor_user_id=reviewer.id,
        after=audit.snapshot(authorization, AUDITED_FIELDS),
        reason=f"review authorised by {reviewer.role.value}: {authorization.rationale}",
        ip_address=ip,
    )
    return authorization


async def issue(db: AsyncSession, *args, **kwargs) -> RouteReviewAuthorization:
    """A reviewer's acceptance of this evidence, for one later selection."""
    authorization = await _issue(db, *args, **kwargs)
    await db.commit()
    await db.refresh(authorization)
    return authorization


async def approve_and_select(
    db: AsyncSession,
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    *,
    actor: User,
    rationale: str,
    decision: EligibilityDecision,
    assessment: LandslideAssessment | None,
    route_state: str,
    ip: str | None = None,
    from_route_id: uuid.UUID | None = None,
):
    """One person accepts the incomplete evidence AND acts on it, atomically.

    Issue, claim and select are one transaction: the authorisation is spent by
    `apply_selection` under the trip lock against the live evidence, and the
    caller's session rolls everything back if any step refuses - so a closed
    road, a superseded route or evidence that moved leaves no row behind.
    Returns the spent authorisation and the now-selected route.

    `from_route_id` makes it a REROUTE of a moving trip: the same acceptance,
    applied through `reroute.accept` so the timeline event, the 409 on a
    stale screen and the driver's notification all still happen.
    """
    from app.services import reroute as reroute_service
    from app.services import routes as route_service

    authorization = await _issue(
        db, trip_id, route_id,
        reviewer=actor, rationale=rationale, decision=decision,
        assessment=assessment, route_state=route_state, ip=ip,
    )
    if from_route_id is not None:
        _, route = await reroute_service.accept(
            db, trip_id,
            from_route_id=from_route_id, to_route_id=route_id,
            actor=actor, ip=ip,
            authorization_id=authorization.id,
            evidence=(decision, assessment),
        )
    else:
        route, _ = await route_service.apply_selection(
            db, trip_id, route_id,
            actor=actor, ip=ip,
            reason=(
                f"route approved with incomplete evidence by {actor.role.value}: "
                f"{authorization.rationale}"
            ),
            eligibility=decision,
            authorization_id=authorization.id,
            assessment=assessment,
        )
        await db.commit()
    await db.refresh(authorization)
    await db.refresh(route)
    return authorization, route


async def revoke(
    db: AsyncSession,
    authorization_id: uuid.UUID,
    *,
    actor: User,
    reason: str | None = None,
    ip: str | None = None,
) -> RouteReviewAuthorization:
    """Withdraw an unspent authorisation."""
    row = (
        await db.execute(
            select(RouteReviewAuthorization).where(
                RouteReviewAuthorization.id == authorization_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("Authorisation not found.")
    if row.consumed_at is not None:
        raise BusinessRuleError(
            "That authorisation has already been used and cannot be revoked.",
            code="ROUTE_REVIEW_ALREADY_CONSUMED",
        )
    if row.revoked_at is not None:
        return row  # idempotent

    before = audit.snapshot(row, AUDITED_FIELDS)
    row.revoked_at = datetime.now(UTC)
    row.revoked_by_user_id = actor.id
    row.revoked_reason = reason
    await db.flush()
    await audit.record(
        db,
        action=AuditAction.STATUS_CHANGE,
        entity_type="route_review_authorizations",
        entity_id=row.id,
        actor_user_id=actor.id,
        before=before,
        after=audit.snapshot(row, AUDITED_FIELDS),
        reason=reason or "review authorisation revoked",
        ip_address=ip,
    )
    await db.commit()
    await db.refresh(row)
    return row


async def live_for_route(
    db: AsyncSession, trip_id: uuid.UUID, route_id: uuid.UUID
) -> RouteReviewAuthorization | None:
    """The unspent, unrevoked authorisation for this route, if any.

    Expired rows are still returned: the UI must be able to say "this expired"
    rather than silently showing nothing, which looks identical to never having
    been reviewed.
    """
    return (
        await db.execute(
            select(RouteReviewAuthorization)
            .where(
                RouteReviewAuthorization.trip_id == trip_id,
                RouteReviewAuthorization.route_id == route_id,
                RouteReviewAuthorization.consumed_at.is_(None),
                RouteReviewAuthorization.revoked_at.is_(None),
            )
            .order_by(RouteReviewAuthorization.issued_at.desc())
        )
    ).scalars().first()


async def consumed_for_route(
    db: AsyncSession, trip_id: uuid.UUID, route_id: uuid.UUID
) -> RouteReviewAuthorization | None:
    """The most recently SPENT authorisation for this route, if any.

    So a screen can say who accepted the evidence for the selection that
    stands, after a reload - the fact an incident review asks first.
    """
    return (
        await db.execute(
            select(RouteReviewAuthorization)
            .where(
                RouteReviewAuthorization.trip_id == trip_id,
                RouteReviewAuthorization.route_id == route_id,
                RouteReviewAuthorization.consumed_at.is_not(None),
            )
            .order_by(RouteReviewAuthorization.consumed_at.desc())
        )
    ).scalars().first()


async def claim(
    db: AsyncSession,
    authorization_id: uuid.UUID,
    *,
    trip_id: uuid.UUID,
    route_id: uuid.UUID,
    route_state: str,
    actor: User,
    decision: EligibilityDecision,
    assessment: LandslideAssessment | None,
) -> RouteReviewAuthorization:
    """Spend an authorisation, or refuse the mutation.

    MUST be called inside the selection's own transaction, after the trip row
    lock and after the route has been re-read under it. The caller owns the
    commit, so the claim and the route change land together or not at all - an
    authorisation is never spent on a mutation that did not happen.

    Every condition is in the WHERE clause of ONE statement. Zero rows updated
    means refuse; there is no separate check that a concurrent request could
    slip between.
    """
    # Re-established from the CURRENT assessment, not from anything stored at
    # issue time. An authorisation issued before a closure appeared must not
    # permit the selection, so the live decision is checked first.
    if decision.eligibility is Eligibility.REJECTED:
        raise BusinessRuleError(
            "That route is blocked by an active hazard and cannot be selected.",
            code="ROUTE_REJECTED_ACTIVE_HAZARD",
        )
    if decision.eligibility is Eligibility.NOT_ASSESSED:
        raise BusinessRuleError(
            "Route eligibility could not be assessed; the change was refused.",
            code="ROUTE_ELIGIBILITY_NOT_ASSESSED",
        )
    if assessment is None or assessment.risk is not AUTHORIZABLE_RISK:
        raise BusinessRuleError(
            "The hazard evidence for this route changed and is no longer of a "
            "kind that may be authorised.",
            code="ROUTE_REVIEW_BASIS_NOT_AUTHORIZABLE",
        )

    digest = evidence_digest(assessment)
    now = datetime.now(UTC)

    claimed = (
        await db.execute(
            update(RouteReviewAuthorization)
            .where(
                RouteReviewAuthorization.id == authorization_id,
                RouteReviewAuthorization.trip_id == trip_id,
                RouteReviewAuthorization.route_id == route_id,
                RouteReviewAuthorization.consumed_at.is_(None),
                RouteReviewAuthorization.revoked_at.is_(None),
                RouteReviewAuthorization.expires_at > now,
                RouteReviewAuthorization.evidence_digest == digest,
                RouteReviewAuthorization.policy_version == decision.policy_version,
                RouteReviewAuthorization.evidence_version == EVIDENCE_VERSION,
                RouteReviewAuthorization.route_state_at_issue == route_state,
                # No `reviewer_user_id != actor.id` here since 2026-09-18: the
                # manager who accepts the evidence is allowed to act on it
                # (`approve_and_select`). Two-person control returns by
                # restoring that one condition.
            )
            .values(consumed_at=now, consumed_by_user_id=actor.id)
            .returning(RouteReviewAuthorization.id)
        )
    ).scalar_one_or_none()

    if claimed is None:
        raise BusinessRuleError(
            "That review authorisation cannot be used: it is expired, already "
            "used, revoked, or the route or its evidence has changed since it "
            "was given. Review the route again.",
            code="ROUTE_REVIEW_AUTHORIZATION_INVALID",
        )

    row = (
        await db.execute(
            select(RouteReviewAuthorization).where(
                RouteReviewAuthorization.id == claimed
            )
        )
    ).scalar_one()
    logger.info(
        "review authorisation %s consumed by %s for route %s",
        claimed, actor.id, route_id,
    )
    return row
