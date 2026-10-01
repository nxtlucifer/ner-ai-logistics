"""State and District Managers cannot write fleet records they have no scope over.

Scope (app/core/scope.py) narrows what has geography - trips and shipments. A
driver, a truck and an assignment have none, so a scoped role that held the
MANAGER write permissions could change them fleet-wide: a district manager in
Assam deactivated a Meghalaya driver and opened a support session as them.

Scoped roles keep planning and running trips in their area and may create new
drivers and trucks. Changing existing fleet records stays with MANAGER,
NORTH_EAST_MANAGER and ADMIN.
"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import permissions as perm
from app.models.enums import UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db

FLEET_WRITES = {
    perm.DRIVER_UPDATE, perm.DRIVER_DEACTIVATE, perm.DRIVER_SUPPORT_VIEW,
    perm.TRUCK_UPDATE, perm.TRUCK_RETIRE,
    perm.ASSIGNMENT_CREATE, perm.ASSIGNMENT_END, perm.ASSIGNMENT_REVIEW,
    perm.EMERGENCY_RESOLVE,
}


@pytest.mark.parametrize("role", [UserRole.STATE_MANAGER, UserRole.DISTRICT_MANAGER])
def test_scoped_roles_hold_no_fleet_wide_writes(role):
    assert not (perm.permissions_for(role) & FLEET_WRITES)


def test_the_regional_role_keeps_every_manager_power():
    assert perm.permissions_for(UserRole.MANAGER) <= perm.permissions_for(UserRole.NORTH_EAST_MANAGER)


@pytest.mark.parametrize("role", [UserRole.STATE_MANAGER, UserRole.DISTRICT_MANAGER])
async def test_a_scoped_manager_cannot_touch_another_states_driver(
    api: AsyncClient, session: AsyncSession, role
):
    district = await factories.make_district(session, state_slug="assam")
    manager = await factories.make_user(
        session, role=role, state_id=district.state_id,
        district_id=district.id if role is UserRole.DISTRICT_MANAGER else None,
    )
    headers = await auth_headers(api, manager.email, factories.TEST_PASSWORD)
    driver, _ = await factories.make_driver(session)

    assert (await api.post(f"/api/drivers/{driver.id}/deactivate", headers=headers)).status_code == 403
    assert (await api.patch(f"/api/drivers/{driver.id}", headers=headers, json={"full_name": "Renamed"})).status_code == 403
    await session.refresh(driver)
    assert driver.full_name != "Renamed"
