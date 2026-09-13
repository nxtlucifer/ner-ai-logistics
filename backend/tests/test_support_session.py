"""Manager 'View as driver': a short-lived token that reads the driver's app
and can do nothing else. No password moves anywhere."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.enums import UserRole
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


async def test_support_token_reads_as_the_driver_and_refuses_every_write(api: AsyncClient, session: AsyncSession):
    driver, _ = await factories.make_driver(session)
    manager = await factories.make_user(session, role=UserRole.MANAGER)
    m = await auth_headers(api, manager.email, factories.TEST_PASSWORD)

    res = await api.post(f"/api/drivers/{driver.id}/support-session", headers=m)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["driver_id"] == str(driver.id) and "password" not in res.text.lower()
    support = {"Authorization": f"Bearer {body['token']}"}

    me = await api.get("/api/driver/me", headers=support)
    assert me.status_code == 200 and me.json()["id"] == str(driver.id)
    assert (await api.get("/api/driver/me/assignment", headers=support)).status_code == 200

    write = await api.post("/api/driver/me/push-token", json={"token": "ExponentPushToken[x]"}, headers=support)
    assert write.status_code == 403 and "read-only" in write.text
    assert (await api.post("/api/driver/me/trip/start", headers=support)).status_code == 403

    rows = (await session.execute(select(AuditLog).where(AuditLog.entity_id == driver.id, AuditLog.reason == "manager support view"))).scalars().all()
    assert len(rows) == 1 and rows[0].actor_user_id == manager.id

    # A driver cannot mint one for another driver.
    d = await auth_headers(api, driver.phone, factories.TEST_PASSWORD)
    assert (await api.post(f"/api/drivers/{driver.id}/support-session", headers=d)).status_code == 403
