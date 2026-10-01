"""Database engine and session management.

One connection URL serves both the async application engine and the sync engine
Alembic uses, because psycopg3 supports both through the same SQLAlchemy dialect.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models.

    No domain models exist yet - see docs/DATA_MODEL.md. Phase P2 introduces them.
    """


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None
_coordination_engine: AsyncEngine | None = None
_coordination_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _build_engine(**pool: object) -> AsyncEngine:
    settings = get_settings()

    connect_args: dict[str, object] = {
        "connect_timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
    }
    if settings.requires_ssl:
        # Supabase terminates TLS. psycopg defaults to sslmode=prefer, which
        # silently downgrades to plaintext if the handshake fails; "require"
        # makes a failed handshake an error instead. Only set when the URL
        # does not already carry an sslmode, so an explicit choice wins.
        if "sslmode=" not in settings.effective_database_url:
            connect_args["sslmode"] = "require"

    return create_async_engine(
        settings.effective_database_url,
        echo=settings.DB_ECHO,
        # Essential against a managed database: Supabase's pooler closes idle
        # connections, and without pre-ping the first query after an idle gap
        # fails on a dead pooled connection.
        pool_pre_ping=True,
        # Recycle below typical pooler idle timeouts.
        pool_recycle=1800,
        connect_args=connect_args,
        **pool,
    )


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = _build_engine(
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
        )
    return _engine


def pool_status() -> dict[str, float] | None:
    """The main pool's counters, for the managers-only readiness detail
    (api/health.py). None until the engine exists. Never on /ready: how busy
    an instance is, is nobody's business outside the operators."""
    if _engine is None:
        return None
    pool = _engine.pool
    settings = get_settings()
    return {
        "size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "checked_out": pool.checkedout(),
        # QueuePool counts overflow from -size; only connections beyond the
        # pool proper are overflow in use.
        "overflow_in_use": max(0, pool.overflow()),
        "timeout_s": settings.DB_POOL_TIMEOUT_SECONDS,
    }


def get_coordination_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Sessions for the leases and Nominatim pacing in services/coordination.py,
    on a pool of their own.

    Pacing runs INSIDE geocoding requests that already hold a connection from
    the main pool (get_current_user has queried by then), under the process-wide
    Nominatim lock. On the shared pool, a burst of such requests each held one
    connection and waited for a second: the pool starved for pool_timeout
    (30 s) and every other request on the instance waited with it. Lease
    renewals must not queue behind requests either. The auth rate limits stay
    on the main pool: login and refresh hold no connection when they call
    them, and a login flood here would delay renewals. At most three callers
    (two leased loops, one pace under the lock), each one short statement:
    one connection is enough, and a 5 s timeout fails fast instead of hanging.
    """
    global _coordination_engine, _coordination_sessionmaker
    if _coordination_sessionmaker is None:
        _coordination_engine = _build_engine(pool_size=1, max_overflow=0, pool_timeout=5)
        _coordination_sessionmaker = async_sessionmaker(
            bind=_coordination_engine, expire_on_commit=False, autoflush=False
        )
    return _coordination_sessionmaker


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _sessionmaker


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a session that rolls back on error."""
    async with get_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """Close the pool on shutdown, and reset module state.

    Resetting the globals matters for tests, which rebuild the engine after
    changing settings.
    """
    global _engine, _sessionmaker, _coordination_engine, _coordination_sessionmaker
    for engine in (_engine, _coordination_engine):
        if engine is not None:
            await engine.dispose()
    _engine = _coordination_engine = None
    _sessionmaker = _coordination_sessionmaker = None
