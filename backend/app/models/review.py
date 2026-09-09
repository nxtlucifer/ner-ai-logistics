"""Audited authorisation for a route whose hazard evidence is incomplete.

WHAT THIS IS, AND WHAT IT IS NOT

It is a single-use permission to make ONE route selection whose eligibility is
`REQUIRES_REVIEW`. It is not a statement about a road. After it is consumed the
route still assesses UNKNOWN and every screen still says so - what is recorded
is "a named person accepted this risk at this time", never "this road was
checked and is clear". Those are different facts and this table must not be
able to tell the second one.

WHY NOT `audit_logs`

`audit_logs` RECORDS; it does not AUTHORISE. It is append-only, enforced by a
trigger (migration 0002), so a row in it can never be marked spent - one
authorisation would then permit an unlimited number of selections, which is the
exact failure this feature exists to prevent. It also carries no uniqueness to
race against and no typed binding to a route or an evidence version. It is
still written alongside this, as every other mutation writes it. It is not the
gate. The full argument is in
docs/migrations/PENDING_route_review_authorizations.sql section 1.

WHAT CAN NEVER BE AUTHORISED

REJECTED (a verified active closure) and NOT_ASSESSED (no assessment ran at
all) are refused in the service with no parameter that can affect them. Under
the approved policy HIGH is refused too; only assessed HAZARD_DATA_UNKNOWN is
authorisable.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import pg_enum
from app.models.enums import RouteReviewBasis


class RouteReviewAuthorization(Base):
    """One reviewer's single-use acceptance of incomplete hazard evidence."""

    __tablename__ = "route_review_authorizations"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.Uuid(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
    )

    # Scoped by BOTH, matching every other route path here
    # (`ensure_belongs_to_trip`). A route id from one trip used against another
    # is the shape of every IDOR in this system.
    trip_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    route_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("trip_routes.id", ondelete="CASCADE"), nullable=False
    )

    #: Digest of the normalised LandslideAssessment the reviewer was shown.
    #:
    #: Deliberately NOT over the raw provider payload and NOT over `RouteRisk`,
    #: which carries `assessed_at` - a digest that moved on every read would
    #: expire every authorisation within seconds. `considered_count` is
    #: excluded too, so an incident somewhere else in the query box cannot
    #: invalidate an authorisation about this corridor. See
    #: `app/services/route_review.evidence_digest`.
    evidence_digest: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: The assessment as shown, kept readable for the incident review that will
    #: one day ask what this person was actually looking at.
    evidence_snapshot: Mapped[dict] = mapped_column(postgresql.JSONB, nullable=False)
    #: `route_eligibility.VERSION` at issue. A policy change must invalidate
    #: decisions taken under the old policy.
    policy_version: Mapped[str] = mapped_column(sa.Text, nullable=False)
    #: `landslide.VERSION`, so a change in how evidence is normalised is equally
    #: visible.
    evidence_version: Mapped[str] = mapped_column(sa.Text, nullable=False)
    basis: Mapped[RouteReviewBasis] = mapped_column(
        pg_enum(RouteReviewBasis), nullable=False
    )

    #: The lifecycle state the reviewer saw. Geometry is already pinned by
    #: `route_id` - rerouting INSERTs a new row rather than updating one - so
    #: this pins the thing that CAN move underneath an authorisation.
    route_state_at_issue: Mapped[str] = mapped_column(sa.Text, nullable=False)

    # RESTRICT for the reason `audit_logs.actor_user_id` is RESTRICT
    # (migration 0004): this row pins its reviewer. A safety authorisation whose
    # author can be deleted is not an authorisation.
    reviewer_user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    #: Required free text, not a boolean. "Someone clicked yes" is not a review
    #: and produces no evidence anybody can weigh afterwards.
    rationale: Mapped[str] = mapped_column(sa.Text, nullable=False)

    # Both server-set. A client-supplied expiry is a client-chosen one.
    issued_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False
    )

    #: Set in the SAME transaction as the selection it permits. Single use.
    consumed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    #: Who spent it. Enforced different from `reviewer_user_id`.
    consumed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    revoked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    revoked_reason: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    __table_args__ = (
        sa.CheckConstraint("expires_at > issued_at", name="ck_rra_expiry_after_issue"),
        # A rationale that is a shrug is not a rationale. Not a quality bar - a
        # floor that stops "ok" and "asap".
        sa.CheckConstraint(
            "length(btrim(rationale)) >= 20", name="ck_rra_rationale_substantive"
        ),
        sa.CheckConstraint(
            "num_nonnulls(revoked_at, revoked_by_user_id) IN (0, 2)",
            name="ck_rra_revocation_complete",
        ),
        sa.CheckConstraint(
            "num_nonnulls(consumed_at, consumed_by_user_id) IN (0, 2)",
            name="ck_rra_consumption_complete",
        ),
        # Consumed and revoked are mutually exclusive outcomes.
        sa.CheckConstraint(
            "consumed_at IS NULL OR revoked_at IS NULL",
            name="ck_rra_not_both_consumed_and_revoked",
        ),
        # At most ONE live authorisation per route.
        #
        # This is one of THREE mechanisms and is not sufficient alone: it stops
        # two live rows existing, the trips row lock serialises concurrent
        # selections, and the conditional UPDATE makes the claim atomic with the
        # selection. Reading this index as "consumption is safe" would be
        # over-reading it.
        sa.Index(
            "uq_rra_one_live_per_route",
            "route_id",
            unique=True,
            postgresql_where=sa.text("consumed_at IS NULL AND revoked_at IS NULL"),
        ),
        sa.Index("ix_rra_trip", "trip_id", sa.text("issued_at DESC")),
        sa.Index("ix_rra_reviewer", "reviewer_user_id", sa.text("issued_at DESC")),
        {
            "comment": (
                "Single-use authorisation to select ONE route whose hazard "
                "evidence is incomplete. Never a statement that a road is "
                "clear; the route still reports UNKNOWN afterwards."
            )
        },
    )
