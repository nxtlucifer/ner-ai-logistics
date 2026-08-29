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


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
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

        _engine = create_async_engine(
            settings.effective_database_url,
            echo=settings.DB_ECHO,
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            # Essential against a managed database: Supabase's pooler closes idle
            # connections, and without pre-ping the first query after an idle gap
            # fails on a dead pooled connection.
            pool_pre_ping=True,
            # Recycle below typical pooler idle timeouts.
            pool_recycle=1800,
            connect_args=connect_args,
        )
    return _engine


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
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
