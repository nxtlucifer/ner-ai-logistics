"""Shared test fixtures.

Tests run against a real PostgreSQL + PostGIS instance, never SQLite. Half of what
this project does is spatial and enum-constrained, and a substituted database would
test a different system. See docs/TESTING_STRATEGY.md section 0.
"""

from collections.abc import AsyncGenerator, Iterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.event_loop import configure_event_loop_policy
from app.db import session as db_session

# Must run at import time, before pytest-asyncio creates any event loop. On
# Windows the default ProactorEventLoop cannot run async psycopg, so without this
# every database-backed test fails with an InterfaceError.
configure_event_loop_policy()


def _reset_engine_state() -> None:
    """Drop cached settings and the engine built from them.

    Only for tests that deliberately change DATABASE_URL. Note this abandons the
    engine WITHOUT disposing it, so it must not be called routinely - see
    reset_settings_cache below.
    """
    get_settings.cache_clear()
    db_session._engine = None
    db_session._sessionmaker = None


@pytest.fixture(autouse=True)
def reset_settings_cache() -> Iterator[None]:
    """Clear the settings cache between tests, but KEEP the engine.

    An earlier version reset the engine here too. That leaked a connection pool
    per test: dropping the reference does not close the sockets, and Supabase's
    session pooler allows only 15 clients per project - shared with any running
    dev server. The suite exhausted the pooler part-way through.

    The engine is a singleton over an unchanging URL, so there is nothing to
    reset; only the tests that repoint DATABASE_URL need _reset_engine_state,
    and they dispose it properly.
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


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
def db() -> Iterator["Connection"]:
    """Synchronous connection inside a transaction that is always rolled back.

    Integrity tests deliberately provoke constraint violations against the real
    Supabase database. Wrapping each test in a rolled-back transaction means
    they leave nothing behind, so the suite is safe to run repeatedly against a
    shared development project.
    """
    from sqlalchemy import create_engine

    settings = get_settings()
    connect_args: dict[str, object] = {}
    if settings.requires_ssl and "sslmode=" not in settings.effective_database_url:
        connect_args["sslmode"] = "require"

    engine = create_engine(settings.effective_database_url, connect_args=connect_args)
    conn = engine.connect()
    trans = conn.begin()
    try:
        yield conn
    finally:
        trans.rollback()
        conn.close()
        engine.dispose()


@pytest_asyncio.fixture
async def unreachable_db(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[None, None]:
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
    # Dispose the real engine before repointing, so the swap does not strand an
    # open pool against Supabase's 15-client limit. An async fixture, because
    # asyncio.run() inside a sync one fights the loop pytest-asyncio manages.
    await db_session.dispose_engine()
    _reset_engine_state()
    yield
    await db_session.dispose_engine()
    _reset_engine_state()


# --- P3: API test fixtures ------------------------------------------------


@pytest_asyncio.fixture
async def session() -> AsyncGenerator["AsyncSession", None]:
    """Async session using the application's own engine.

    API tests need committed data, so this is not the rolled-back `db` fixture.
    """
    async with db_session.get_sessionmaker()() as s:
        yield s


@pytest_asyncio.fixture
async def api() -> AsyncGenerator[AsyncClient, None]:
    """HTTP client against a fresh app instance."""
    from app.main import create_app

    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_test_rows() -> AsyncGenerator[None, None]:
    """Remove suite-created rows after every test.

    Autouse so a failing test cannot leave data that breaks the next one.
    """
    yield
    from tests import factories

    async with db_session.get_sessionmaker()() as s:
        try:
            await factories.cleanup(s)
        except Exception as exc:  # noqa: BLE001
            await s.rollback()
            # Loud, not silent. A swallowed cleanup failure lets rows accumulate
            # until an unrelated test fails on a duplicate key, which is a
            # miserable thing to debug.
            import warnings

            warnings.warn(f"test cleanup failed: {exc!r}", stacklevel=2)


async def auth_headers(api: AsyncClient, identifier: str, password: str) -> dict:
    """Log in over HTTP and return an Authorization header.

    Deliberately goes through the real login endpoint rather than minting a
    token directly, so every authenticated test also exercises the login path.
    """
    response = await api.post(
        "/api/auth/login", json={"identifier": identifier, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
