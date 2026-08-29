"""Shared test fixtures.

Tests run against a real PostgreSQL + PostGIS instance, never SQLite. Half of what
this project does is spatial and enum-constrained, and a substituted database would
test a different system. See docs/TESTING_STRATEGY.md section 0.
"""

from collections.abc import AsyncGenerator, Iterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.core.event_loop import configure_event_loop_policy
from app.db import session as db_session

# Must run at import time, before pytest-asyncio creates any event loop. On
# Windows the default ProactorEventLoop cannot run async psycopg, so without this
# every database-backed test fails with an InterfaceError.
configure_event_loop_policy()


def _reset_engine_state() -> None:
    """Drop cached settings and the engine built from them.

    Both are module-level singletons. A test that changes DATABASE_URL must clear
    both or it silently keeps talking to the previous database.
    """
    get_settings.cache_clear()
    db_session._engine = None
    db_session._sessionmaker = None


@pytest.fixture(autouse=True)
def reset_state() -> Iterator[None]:
    _reset_engine_state()
    yield
    _reset_engine_state()


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """HTTP client bound to a freshly built app instance."""
    from app.main import create_app

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest.fixture
def unreachable_db(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Point the application at a database that cannot be reached.

    Uses the reserved `.invalid` TLD, which by RFC 6761 never resolves, so the
    failure is an immediate DNS error rather than a connection timeout - keeping
    the readiness tests fast.

    Note it is deliberately NOT a localhost address: in supabase mode the config
    validator rejects local hosts outright, so a local URL here would fail at
    construction time and never exercise the readiness path.
    """
    monkeypatch.setenv("DATABASE_PROVIDER", "supabase")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://someuser:somepassword@db.unreachable.invalid:5432/postgres",
    )
    _reset_engine_state()
    yield
    _reset_engine_state()
