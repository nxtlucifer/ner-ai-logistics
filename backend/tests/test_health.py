"""Tests for the liveness and readiness endpoints.

Three behaviours matter most:
  - /health stays 200 when the database is down; /ready does not
  - /ready reports the configured provider honestly
  - neither endpoint leaks a credential, since both are unauthenticated

See docs/API_CONTRACTS.md section 15.
"""

import pytest
from httpx import AsyncClient

from app.core.config import get_settings


class TestHealth:
    async def test_returns_200_ok(self, client: AsyncClient) -> None:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    async def test_stays_200_when_database_unreachable(
        self, unreachable_db: None, client: AsyncClient
    ) -> None:
        """Liveness must not depend on any external dependency.

        A liveness probe that fails during a database outage gets the process
        killed and restarted for somebody else's problem.
        """
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


@pytest.mark.requires_db
class TestReadyWithDatabase:
    """GATE 5."""

    async def test_returns_200_when_database_and_postgis_available(
        self, client: AsyncClient
    ) -> None:
        response = await client.get("/ready")
        assert response.status_code == 200

        body = response.json()
        assert body["status"] == "ready"
        assert body["checks"]["database"]["ok"] is True
        assert body["checks"]["postgis"]["ok"] is True

    async def test_reports_the_configured_provider(self, client: AsyncClient) -> None:
        """The dashboard renders this, so it must be real, not assumed."""
        body = (await client.get("/ready")).json()
        assert body["provider"] == get_settings().DATABASE_PROVIDER

    async def test_reports_real_versions_not_placeholders(
        self, client: AsyncClient
    ) -> None:
        """The detail fields must carry real server output, not canned strings."""
        body = (await client.get("/ready")).json()
        assert "PostgreSQL" in body["checks"]["database"]["detail"]
        # PostGIS_Version() returns e.g. "3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"
        assert "USE_GEOS" in body["checks"]["postgis"]["detail"]


class TestReadyWithoutDatabase:
    """GATE 5 and GATE 6."""

    async def test_returns_503_when_database_unreachable(
        self, unreachable_db: None, client: AsyncClient
    ) -> None:
        response = await client.get("/ready")
        assert response.status_code == 503

        body = response.json()
        assert body["status"] == "not_ready"
        assert body["checks"]["database"]["ok"] is False
        assert body["checks"]["postgis"]["ok"] is False

    async def test_does_not_fall_back_to_a_local_database(
        self, unreachable_db: None, client: AsyncClient
    ) -> None:
        """The heart of GATE 6.

        A local PostgreSQL is running on this machine during development. With
        Supabase configured but unreachable, /ready must report failure rather
        than quietly succeeding against that local database.
        """
        response = await client.get("/ready")
        assert response.status_code == 503, (
            "Readiness succeeded while the configured primary database was "
            "unreachable - this indicates a silent fallback to another database."
        )
        assert response.json()["provider"] == "supabase"

    async def test_does_not_leak_credentials_in_error_detail(
        self, unreachable_db: None, client: AsyncClient
    ) -> None:
        """Connection errors often embed the full URL including the password.

        Both endpoints are unauthenticated, so their response bodies must never
        carry credentials. See docs/SECURITY.md section 5.
        """
        serialised = str((await client.get("/ready")).json())
        assert "somepassword" not in serialised
        assert "someuser" not in serialised
        assert "postgresql+psycopg://" not in serialised
        assert "unreachable.invalid" not in serialised


@pytest.mark.requires_db
class TestReadyDoesNotLeakWhenHealthy:
    """GATE 12 - the success path must be clean too, not just the failure path."""

    async def test_no_connection_details_in_successful_response(
        self, client: AsyncClient
    ) -> None:
        settings = get_settings()
        serialised = str((await client.get("/ready")).json())

        assert "postgresql+psycopg://" not in serialised
        assert "@" not in serialised.replace("USE_GEOS", "")

        # No fragment of the real connection URL may appear.
        url = settings.effective_database_url
        password = url.split("://", 1)[1].split("@", 1)[0]
        if ":" in password:
            secret = password.split(":", 1)[1]
            if secret:
                assert secret not in serialised
