"""Whether a driver's paperwork is complete enough to be given new work.

THE RULE, AND WHY IT IS A GRACE AND NOT A GATE

A licence is required before a driver exists at all: it is the one document
that says this person may drive, and a fleet that can add a driver without
one has no answer when asked why an unlicensed person was dispatched.

Emergency contact and insurance are different. They are real requirements
and they are also the two things a new driver most often cannot produce on
the morning they are hired - the insurer is slow, the family member is at
work. Refusing to create the driver would mean the fleet keeps them off the
books and drives them anyway, which is worse than a recorded deadline. So
they get a stated window, and when it runs out the driver stops being
dispatchable.

WHAT OVERDUE DOES NOT DO

It does not touch a trip already under way. A truck on a hill road does not
become safer by having its job cancelled at the roadside, and an expiry that
strands people is an expiry that gets switched off. OVERDUE blocks the NEXT
dispatch.

THIS IS PRODUCT POLICY, NOT LAW

`DRIVER_COMPLIANCE_GRACE_DAYS` is a configurable business rule. Nothing here
claims a statutory deadline, and no screen should say one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum


class ComplianceState(str, Enum):
    #: Licence valid, emergency contact and insurance both recorded.
    COMPLIANT = "COMPLIANT"
    #: Something is missing, and the window has not closed.
    GRACE_PERIOD = "GRACE_PERIOD"
    #: The window closed with something still missing. No new dispatch.
    OVERDUE = "OVERDUE"
    #: The licence itself has lapsed. Not a paperwork gap - this driver may
    #: not drive at all, and it is deliberately a different word.
    LICENCE_EXPIRED = "LICENCE_EXPIRED"


@dataclass(frozen=True)
class Compliance:
    state: ComplianceState
    #: The day the window closes. None when there is nothing outstanding.
    due_on: date | None
    #: Field names still missing, for a UI that has to say what to chase.
    missing: tuple[str, ...]

    @property
    def dispatchable(self) -> bool:
        return self.state in (ComplianceState.COMPLIANT, ComplianceState.GRACE_PERIOD)


def assess(
    *,
    licence_expiry: date,
    emergency_contact_name: str | None,
    emergency_contact_phone: str | None,
    has_insurance: bool,
    joined_on: date | None,
    grace_days: int,
    today: date | None = None,
) -> Compliance:
    """Derived, never stored.

    A stored status is a status that goes stale the day after it is written,
    and the first symptom is a driver who became compliant last week still
    being refused. Everything here is computed from fields that are already
    facts.
    """
    today = today or date.today()

    if licence_expiry < today:
        return Compliance(ComplianceState.LICENCE_EXPIRED, None, ("licence_expiry",))

    missing: list[str] = []
    # Both halves, because a name with no number is not a contact anyone can
    # reach at two in the morning.
    if not (emergency_contact_name and emergency_contact_phone):
        missing.append("emergency_contact")
    if not has_insurance:
        missing.append("insurance")

    if not missing:
        return Compliance(ComplianceState.COMPLIANT, None, ())

    # Counted from the joining date when there is one: a driver hired in
    # March should not get a fresh window because their record was entered
    # in September.
    start = joined_on or today
    due = start + timedelta(days=grace_days)
    state = ComplianceState.GRACE_PERIOD if today <= due else ComplianceState.OVERDUE
    return Compliance(state, due, tuple(missing))
