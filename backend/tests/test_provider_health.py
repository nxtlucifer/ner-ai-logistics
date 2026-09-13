"""Provider health: freshness classes, error categories, the System endpoint, and
the code-audited intelligence inventory (no local ML, no local LLM)."""

import time

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain import intelligence_inventory
from app.models.enums import UserRole
from app.services import provider_health as ph
from tests import factories
from tests.conftest import auth_headers

pytestmark = pytest.mark.requires_db


def test_freshness_is_judged_against_each_products_cadence():
    now = time.time()
    h = ph.Health(provider="NDMA_SACHET", state="HEALTHY", last_success_at=now - 60)
    assert ph.freshness(h, now) == "FRESH"
    h.last_success_at = now - 40 * 60
    assert ph.freshness(h, now) == "AGING"
    h.last_success_at = now - 3 * 3600
    assert ph.freshness(h, now) == "STALE"
    h.valid_to = now - 1
    assert ph.freshness(h, now) == "EXPIRED"
    assert ph.freshness(ph.Health(provider="GLOFAS"), now) == "UNKNOWN"
    assert ph.freshness(ph.Health(provider="NASA_GLC", state="STATIC"), now) == "STATIC"


def test_failure_is_a_category_never_a_message():
    import httpx

    assert ph.category(httpx.ReadTimeout("x")) == "timeout"
    assert ph.category(Exception(), 429) == "http_429"
    assert ph.category(Exception(), 503) == "http_5xx"
    assert ph.category(ValueError("bad json")) == "unparseable"
    ph.fail("OSRM", "http_429")
    row = next(r for r in ph.snapshot() if r["provider"] == "OSRM")
    assert row["state"] == "RATE_LIMITED" and row["last_error"] == "http_429"
    ph.ok("OSRM")
    row = next(r for r in ph.snapshot() if r["provider"] == "OSRM")
    assert row["state"] == "HEALTHY" and row["freshness"] == "FRESH"
    # Every configured product appears even before it has ever been called.
    assert {r["provider"] for r in ph.snapshot()} >= {"NDMA_SACHET", "OPEN_METEO", "GLOFAS", "NASA_GLC"}


def test_inventory_counts_no_local_ml_and_no_local_llm():
    c = intelligence_inventory.counts()
    assert c["TRUE_LOCAL_ML"] == 0 and c["LOCAL_LLM"] == 0 and c["STATISTICAL_MODEL"] == 0
    assert c["DETERMINISTIC_INTELLIGENCE"] >= 15 and c["GEOMETRIC_ALGORITHM"] >= 4
    t = intelligence_inventory.totals()
    assert t["TOTAL_TRUE_LOCAL_AI"] == 0
    assert t["TOTAL_LOCAL_INTELLIGENCE"] == c["DETERMINISTIC_INTELLIGENCE"] + c["GEOMETRIC_ALGORITHM"] + c["OFFLINE_KNOWLEDGE_SYSTEM"]


@pytest.mark.asyncio
async def test_system_providers_endpoint_needs_a_user_and_never_leaks_a_secret(api: AsyncClient, session: AsyncSession):
    user = await factories.make_user(session, role=UserRole.MANAGER)
    headers = await auth_headers(api, user.email, factories.TEST_PASSWORD)
    anon = await api.get("/api/system/providers")
    assert anon.status_code == 401
    res = await api.get("/api/system/providers", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["intelligence"]["TOTAL_TRUE_LOCAL_AI"] == 0
    text = res.text.lower()
    assert "key=" not in text and "sk-or-" not in text and "aiza" not in text
    assert all("freshness" in row and "state" in row for row in body["providers"])
