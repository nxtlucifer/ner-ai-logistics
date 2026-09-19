"""Licence first, and a stated window for the rest.

TWO DIFFERENT RULES, DELIBERATELY

A licence is required to CREATE a driver: it is the document that says this
person may drive, and a fleet that can add someone without one has no answer
when asked why an unlicensed person was dispatched. It was previously
checked only at assignment and at dispatch, so a driver with a licence that
expired last year could sit in the fleet looking normal.

Emergency contact and insurance get a window instead. Refusing to create the
driver would mean the fleet keeps them off the books and drives them anyway,
which is worse than a recorded deadline.

And the window blocks the NEXT dispatch, never a trip already under way.
"""

import random
from datetime import date, timedelta

import pytest

from app.domain import driver_compliance as compliance
from app.domain.driver_compliance import ComplianceState
from app.models.enums import TripStatus
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


@pytest.fixture
async def manager_headers(api, session) -> dict:
    from app.models.enums import UserRole

    user = await factories.make_user(session, role=UserRole.MANAGER)
    return await auth_headers(api, user.email, factories.TEST_PASSWORD)


def _phone() -> str:
    """Unique per run. Cleanup DEACTIVATES users rather than deleting them -
    an audit row pins its actor - so a fixed number is taken the second time
    the suite runs."""
    return f"9{random.randint(100000000, 999999999)}"


YESTERDAY = date.today() - timedelta(days=1)
NEXT_YEAR = date.today() + timedelta(days=365)


class TestTheRuleItself:
    """Pure, so every branch is reachable without building a fleet."""

    def _assess(self, **over):
        return compliance.assess(
            **{
                "licence_expiry": NEXT_YEAR,
                "emergency_contact_name": "Bina Das",
                "emergency_contact_phone": "9435000000",
                "has_insurance": True,
                "joined_on": date.today(),
                "grace_days": 7,
                **over,
            }
        )

    def test_complete_paperwork_is_compliant(self):
        v = self._assess()
        assert v.state is ComplianceState.COMPLIANT
        assert v.missing == () and v.due_on is None and v.dispatchable

    def test_an_expired_licence_is_its_own_word(self):
        """Not "overdue paperwork". This person may not drive at all, and a
        screen that says the same thing for both teaches the reader to treat
        them the same."""
        v = self._assess(licence_expiry=YESTERDAY)
        assert v.state is ComplianceState.LICENCE_EXPIRED
        assert not v.dispatchable

    def test_a_missing_contact_inside_the_window_still_drives(self):
        v = self._assess(emergency_contact_phone=None)
        assert v.state is ComplianceState.GRACE_PERIOD
        assert v.missing == ("emergency_contact",)
        assert v.dispatchable, "a new driver is not grounded on day one"

    def test_half_a_contact_is_not_a_contact(self):
        """A name with no number is nobody you can reach at two in the
        morning."""
        assert self._assess(emergency_contact_phone=None).missing == (
            "emergency_contact",
        )
        assert self._assess(emergency_contact_name=None).missing == (
            "emergency_contact",
        )

    def test_the_window_closes_and_then_it_bites(self):
        joined = date.today() - timedelta(days=30)
        v = self._assess(has_insurance=False, joined_on=joined, grace_days=7)
        assert v.state is ComplianceState.OVERDUE
        assert v.due_on == joined + timedelta(days=7)
        assert not v.dispatchable

    def test_the_window_runs_from_joining_not_from_data_entry(self):
        """A driver hired in March does not get a fresh window because
        somebody typed their record in September."""
        joined = date.today() - timedelta(days=100)
        v = self._assess(has_insurance=False, joined_on=joined, grace_days=7)
        assert v.due_on == joined + timedelta(days=7)
        assert v.state is ComplianceState.OVERDUE

    def test_the_last_day_of_the_window_is_still_inside_it(self):
        joined = date.today() - timedelta(days=7)
        v = self._assess(has_insurance=False, joined_on=joined, grace_days=7)
        assert v.state is ComplianceState.GRACE_PERIOD

    def test_both_gaps_are_reported_together(self):
        v = self._assess(has_insurance=False, emergency_contact_name=None)
        assert set(v.missing) == {"emergency_contact", "insurance"}


class TestCreatingADriver:
    async def test_an_expired_licence_is_refused_at_the_door(
        self, api, session, manager_headers
    ):
        r = await api.post(
            "/api/drivers",
            headers=manager_headers,
            json={
                "full_name": "Lapsed Licence",
                "initial_password": "a-strong-one-9",
                "phone": _phone(),
                "licence_number": f"AS-EXP-{random.randint(1000, 9999)}",
                "licence_expiry": YESTERDAY.isoformat(),
            },
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "LICENCE_EXPIRED"

    async def test_a_valid_licence_is_enough_to_be_added(
        self, api, session, manager_headers
    ):
        """Emergency contact and insurance are NOT required to exist: the
        window exists so the fleet records the driver instead of hiding
        them."""
        r = await api.post(
            "/api/drivers",
            headers=manager_headers,
            json={
                "full_name": "New Starter",
                "initial_password": "a-strong-one-9",
                "phone": _phone(),
                "licence_number": f"AS-NEW-{random.randint(1000, 9999)}",
                "licence_expiry": NEXT_YEAR.isoformat(),
            },
        )
        assert r.status_code == 201, r.text


class TestDispatch:
    async def _ready_trip(self, session, *, joined_on, contact=True):
        driver, _ = await factories.make_driver(session)
        driver.date_of_joining = joined_on
        if not contact:
            driver.emergency_contact_name = None
            driver.emergency_contact_phone = None
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck, verified=True)
        trip = await factories.make_trip(
            session, driver, truck, status=TripStatus.DRAFT
        )
        await factories.make_selected_route(session, trip.id)
        await session.commit()
        return driver, trip

    async def test_an_overdue_driver_cannot_be_given_a_new_job(
        self, api, session, manager_headers
    ):
        driver, trip = await self._ready_trip(
            session, joined_on=date.today() - timedelta(days=60), contact=False
        )
        r = await api.post(f"/api/trips/{trip.id}/dispatch", headers=manager_headers)
        assert r.status_code == 422
        body = r.json()["error"]
        assert body["code"] == "DRIVER_COMPLIANCE_OVERDUE"
        # The message has to say what to chase, not just that something is wrong.
        assert "emergency contact" in body["message"]
        assert body["details"]["due_on"]

    async def test_a_driver_inside_the_window_is_dispatched_normally(
        self, api, session, manager_headers
    ):
        driver, trip = await self._ready_trip(
            session, joined_on=date.today(), contact=False
        )
        r = await api.post(f"/api/trips/{trip.id}/dispatch", headers=manager_headers)
        assert r.status_code == 200, r.text

    async def test_a_running_trip_is_never_cancelled_by_the_deadline(
        self, api, session, manager_headers
    ):
        """The rule blocks the NEXT dispatch. A truck already on the road
        does not become safer by having its job pulled at the roadside."""
        driver, _ = await factories.make_driver(session)
        driver.date_of_joining = date.today() - timedelta(days=90)
        driver.emergency_contact_name = None
        driver.emergency_contact_phone = None
        truck = await factories.make_truck(session)
        await factories.make_assignment(session, driver, truck, verified=True)
        running = await factories.make_trip(
            session, driver, truck, status=TripStatus.ACTIVE
        )
        await session.commit()

        r = await api.get(f"/api/trips/{running.id}", headers=manager_headers)
        assert r.status_code == 200
        assert r.json()["status"] == "ACTIVE"
