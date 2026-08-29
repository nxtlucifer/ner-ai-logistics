"""Trip lifecycle state machine.

Pure logic, no database. The enum stops invalid *values*; this stops invalid
*sequences*, which is the more damaging failure - a trip that jumps DRAFT ->
DELIVERED satisfies every column constraint while destroying the audit trail.
"""

import pytest

from app.domain.trip_state import (
    ALLOWED_TRANSITIONS,
    IN_TRANSIT_STATES,
    TERMINAL_STATES,
    IllegalTripTransition,
    assert_transition,
    can_transition,
    is_in_transit,
    is_terminal,
)
from app.models.enums import TripStatus as S


class TestTableCompleteness:
    def test_every_status_has_an_entry(self) -> None:
        """A missing key would silently mean "no transitions allowed"."""
        assert set(ALLOWED_TRANSITIONS) == set(S)

    def test_every_target_is_a_real_status(self) -> None:
        for source, targets in ALLOWED_TRANSITIONS.items():
            for target in targets:
                assert isinstance(target, S), f"{source} -> {target!r}"

    def test_no_self_transitions(self) -> None:
        """A status change to the same status is a no-op, not a transition."""
        for source, targets in ALLOWED_TRANSITIONS.items():
            assert source not in targets, f"{source} allows itself"

    def test_every_status_is_reachable_from_draft(self) -> None:
        """An unreachable state is dead schema."""
        seen = {S.DRAFT}
        frontier = [S.DRAFT]
        while frontier:
            for nxt in ALLOWED_TRANSITIONS[frontier.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    frontier.append(nxt)
        assert seen == set(S), f"unreachable: {sorted(s.value for s in set(S) - seen)}"


class TestLegalPaths:
    @pytest.mark.parametrize(
        ("current", "target"),
        [
            (S.DRAFT, S.ASSIGNED),
            (S.ASSIGNED, S.VERIFICATION_PENDING),
            (S.ASSIGNED, S.ACTIVE),
            (S.VERIFICATION_PENDING, S.MANAGER_REVIEW),
            (S.MANAGER_REVIEW, S.ASSIGNED),
            (S.ACTIVE, S.DELAYED),
            (S.DELAYED, S.ACTIVE),
            (S.ACTIVE, S.INCIDENT),
            (S.INCIDENT, S.ACTIVE),
            (S.ACTIVE, S.DELIVERED),
            (S.DELIVERED, S.CLOSED),
        ],
    )
    def test_permitted(self, current: S, target: S) -> None:
        assert can_transition(current, target)
        assert_transition(current, target)

    def test_incident_is_a_suspension_not_a_terminus(self) -> None:
        """A stuck truck that resumes returns to the road."""
        assert can_transition(S.INCIDENT, S.ACTIVE)
        assert not is_terminal(S.INCIDENT)


class TestProhibitedPaths:
    @pytest.mark.parametrize(
        ("current", "target"),
        [
            # Skipping the capacity and verification gates entirely.
            (S.DRAFT, S.ACTIVE),
            (S.DRAFT, S.DELIVERED),
            (S.DRAFT, S.CLOSED),
            # Delivering without ever starting.
            (S.ASSIGNED, S.DELIVERED),
            # Reopening settled work.
            (S.CLOSED, S.ACTIVE),
            (S.CLOSED, S.DELIVERED),
            (S.CANCELLED, S.ACTIVE),
            (S.CANCELLED, S.DRAFT),
            # Cancelling after settlement.
            (S.CLOSED, S.CANCELLED),
            # Going backwards from delivery.
            (S.DELIVERED, S.ACTIVE),
            (S.DELIVERED, S.CANCELLED),
        ],
    )
    def test_rejected(self, current: S, target: S) -> None:
        assert not can_transition(current, target)
        with pytest.raises(IllegalTripTransition):
            assert_transition(current, target)

    def test_terminal_states_allow_nothing(self) -> None:
        for state in TERMINAL_STATES:
            assert ALLOWED_TRANSITIONS[state] == frozenset()
            for target in S:
                assert not can_transition(state, target)

    def test_error_message_names_both_states_and_the_alternatives(self) -> None:
        with pytest.raises(IllegalTripTransition) as exc:
            assert_transition(S.DRAFT, S.DELIVERED)
        message = str(exc.value)
        assert "DRAFT" in message and "DELIVERED" in message
        assert "ASSIGNED" in message  # what was actually allowed


class TestCancellation:
    def test_cancellable_from_every_non_terminal_state_except_delivered(self) -> None:
        """Delivered work is settled through CLOSED, never cancelled.

        Cancelling a delivered trip would strand the payment and proof of
        delivery records that already exist against it.
        """
        for state in S:
            if state in TERMINAL_STATES or state is S.DELIVERED:
                assert not can_transition(state, S.CANCELLED)
            else:
                assert can_transition(state, S.CANCELLED), f"{state} cannot cancel"


class TestInTransitClassification:
    def test_matches_the_partial_index(self) -> None:
        """ix_trips_active covers exactly ACTIVE and DELAYED.

        Fleet Sentinel sweeps these states every five minutes; if this set and
        the index diverge, the monitor either misses trucks or table-scans.
        """
        assert IN_TRANSIT_STATES == frozenset({S.ACTIVE, S.DELAYED})
        assert is_in_transit(S.ACTIVE)
        assert is_in_transit(S.DELAYED)
        assert not is_in_transit(S.ASSIGNED)
        assert not is_in_transit(S.DELIVERED)
