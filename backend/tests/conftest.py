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


#: Advisory-lock key serialising whole pytest runs. Arbitrary but fixed; the
#: only requirement is that nothing else in this database uses the same number.
SUITE_LOCK_KEY = 0x4E45525F54535431  # "NER_TST1"

#: How PostgreSQL splits a bigint advisory key across pg_locks. The single-bigint
#: form stores the high half in `classid`, the low half in `objid`, and marks
#: `objsubid = 1`; the two-int form uses 2. Checking only the low half would
#: accept a DIFFERENT lock that happens to collide in 32 bits, which is exactly
#: the kind of near-miss a safety check must not make.
LOCK_CLASSID = (SUITE_LOCK_KEY >> 32) & 0xFFFFFFFF
LOCK_OBJID = SUITE_LOCK_KEY & 0xFFFFFFFF
LOCK_OBJSUBID = 1

_LOCK_IDENTITY_SQL = """
    SELECT pg_backend_pid() = :pid
       AND EXISTS (
           SELECT 1 FROM pg_locks
            WHERE locktype  = 'advisory'
              AND pid       = :pid
              AND classid   = :classid
              AND objid     = :objid
              AND objsubid  = :objsubid
              AND granted
       )
"""


class SuiteLock:
    """The one connection that owns the suite lock, and the proof that it does.

    Module-level rather than fixture-local because `_cleanup_test_rows` has to
    consult it, and that fixture runs on the async application session while
    the lock lives on a dedicated synchronous connection.
    """

    conn: object | None = None
    backend_pid: int | None = None

    @classmethod
    def is_held(cls) -> bool:
        """Whether the dedicated connection still owns EXACTLY this lock.

        Verifies the complete 64-bit identity - both halves, the subid, and
        `granted` - on the recorded backend, and that we are still speaking to
        that same backend. Anything less would pass while the lock was gone.
        """
        from sqlalchemy import text as _text

        if cls.conn is None or cls.backend_pid is None:
            return False
        return bool(
            cls.conn.execute(  # type: ignore[attr-defined]
                _text(_LOCK_IDENTITY_SQL),
                {
                    "pid": cls.backend_pid,
                    "classid": LOCK_CLASSID,
                    "objid": LOCK_OBJID,
                    "objsubid": LOCK_OBJSUBID,
                },
            ).scalar_one()
        )

    @classmethod
    def assert_held(cls, when: str) -> None:
        """Raise unless the lock is still ours.

        Called before every global cleanup. If the connection holding the lock
        was dropped mid-run - a pooler timeout, a network blip - the suite is no
        longer isolated, and the very next thing it would do is
        `DELETE FROM shipments WHERE reference_code LIKE 'STEST-%'` against a
        database another run may now be using. Stopping here is strictly better
        than tidying up someone else's fixtures.
        """
        if not cls.is_held():
            raise RuntimeError(
                f"Suite advisory lock is NOT held ({when}). The dedicated "
                "connection lost it, so this run is no longer isolated and "
                "global prefix cleanup must not proceed - it would delete "
                "another run's fixtures. Re-run when the database is quiet."
            )


@pytest.fixture(scope="session", autouse=True)
def exclusive_suite_lock() -> Iterator[None]:
    """Refuse to start while another pytest run holds this database.

    `_cleanup_test_rows` below deletes by GLOBAL prefix - every `STEST-%`
    shipment, every `TTEST-%` trip, every `AS__ZZ%` truck - not merely the rows
    the finishing test made. Within one serial run that is correct and cheap.
    Across two runs it is mutual destruction: run A creates a shipment, run B's
    teardown deletes it, and run A's next insert dies with

        ForeignKeyViolation: Key (shipment_id)=... is not present in "shipments"

    That is not hypothetical. Two agents sharing this working tree produced a
    full page of exactly those failures during the P6 audit, and they read as
    product defects rather than as a collision - which cost real time to
    diagnose. This fixture converts that silent corruption into a refusal to
    start, with a message naming the actual cause.

    `pg_try_advisory_lock` is session-scoped in PostgreSQL and held for as long
    as the connection lives, so this takes ONE dedicated connection outside the
    application pool and keeps it for the run. That works because the project
    connects through Supabase's SESSION pooler (port 5432); on the transaction
    pooler (6543) a session-level lock would not survive between statements,
    which is one more reason README.md insists on the session pooler.

    Preferred long-term fix is a per-run namespace so cleanup can only ever
    remove its own rows. That is a wider change than this checkpoint should
    carry: shipment and trip prefixes take a run id easily, but truck
    registrations must satisfy REGISTRATION_PATTERN, which leaves almost no
    room to encode one. A partial namespace would protect trips and shipments
    while leaving trucks colliding - protection that looks complete and is not.
    """
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    settings = get_settings()
    connect_args: dict[str, object] = {}
    if settings.requires_ssl and "sslmode=" not in settings.effective_database_url:
        connect_args["sslmode"] = "require"

    # NullPool, and one connection held in a local for the whole run. The lock
    # belongs to a physical backend, not to the application: if this connection
    # were ever returned to a pool and a later statement transparently opened a
    # NEW one, the lock would be gone and nothing would say so. NullPool removes
    # the pool that could do that, and `conn` is never closed until teardown.
    engine = create_engine(
        settings.effective_database_url,
        connect_args=connect_args,
        poolclass=NullPool,
    )
    # AUTOCOMMIT because this connection is consulted once per test, before every
    # global cleanup. Under the default behaviour each of those reads would
    # autobegin a transaction that nothing closes, leaving the lock holder
    # sitting "idle in transaction" for the whole run and adding a round trip to
    # end it. Session-level advisory locks are indifferent to transactions, so
    # autocommit costs the lock nothing.
    conn = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    acquired = conn.execute(
        text("SELECT pg_try_advisory_lock(:k)"), {"k": SUITE_LOCK_KEY}
    ).scalar_one()

    if not acquired:
        conn.close()
        engine.dispose()
        pytest.exit(
            "Another pytest run is already using this database. Test cleanup "
            "deletes by global prefix, so two runs delete each other's fixtures "
            "and fail with unrelated-looking ForeignKeyViolations. Wait for the "
            "other run to finish. See docs/TESTING_STRATEGY.md.",
            returncode=2,
        )

    # Which backend owns the lock. Recorded so every later check can prove the
    # SAME physical connection still holds it - a silent reconnect would have
    # released the lock somewhere in the middle while another run's
    # `pg_try_advisory_lock` quietly succeeded.
    backend_pid = conn.execute(text("SELECT pg_backend_pid()")).scalar_one()

    SuiteLock.conn = conn
    SuiteLock.backend_pid = backend_pid
    SuiteLock.assert_held("at acquisition")

    try:
        yield
    finally:
        still_ours = SuiteLock.is_held()
        SuiteLock.conn = None
        SuiteLock.backend_pid = None
        conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SUITE_LOCK_KEY})
        conn.close()
        engine.dispose()
        if not still_ours:
            # Loud, not silent: this run was unprotected for some unknown part
            # of its length, so its result cannot be trusted as isolated.
            raise RuntimeError(
                "The suite advisory lock was lost during the run - the "
                "connection holding it was replaced. This run was not isolated."
            )


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

    GUARDED. `factories.cleanup` deletes by GLOBAL prefix, so it is only safe
    while this run provably owns the database. The check runs BEFORE the delete,
    not after: if the connection holding the suite lock has been dropped - a
    pooler timeout, a network blip on a link to Mumbai - then another run may
    already have started, and the next statement would delete its fixtures.
    Verifying afterwards would report the damage instead of preventing it.

    The cost is one round trip per test. That is the correct price for a
    statement whose blast radius is every `STEST-%` row in a shared database.
    """
    yield
    from tests import factories

    SuiteLock.assert_held("before global test cleanup")

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
