"""Liveness and readiness endpoints.

The distinction is deliberate and load-bearing:

  /health  - is the process alive? Touches nothing external. A liveness probe that
             fails because a dependency is down gets the process restarted for
             somebody else's outage, which turns a database blip into an outage of
             its own.

  /ready   - can this instance actually serve requests? Checks the database and the
             PostGIS extension, because a database without PostGIS cannot serve this
             application at all.

See docs/API_CONTRACTS.md section 15.
"""

import logging
from typing import Any

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_sessionmaker

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])


@router.get("/health", summary="Liveness probe")
async def health() -> dict[str, str]:
    """Return 200 whenever the process is running. Checks no dependency."""
    return {"status": "ok"}


async def _check_postgis(session: Any) -> dict[str, Any]:
    """Call a real PostGIS function, not just look for a catalogue row.

    The function is tried unqualified first, then qualified as
    `extensions.postgis_version()`.

    The fallback is not defensive padding. Supabase installs PostGIS into the
    `extensions` schema, so resolving it unqualified depends on the connecting
    role having that schema on its search_path. The `postgres` role does; a
    least-privilege application role - which docs/SECURITY.md calls for later -
    may not. Without the fallback, tightening database permissions would silently
    turn readiness red on a database whose PostGIS is perfectly healthy.
    """
    for statement in ("SELECT postgis_version()", "SELECT extensions.postgis_version()"):
        try:
            version = (await session.execute(text(statement))).scalar_one()
            return {"ok": True, "detail": str(version)}
        except Exception as exc:  # noqa: BLE001 - try the next resolution
            logger.debug("PostGIS probe %r failed: %s", statement, exc)
            await session.rollback()  # the failed statement poisons the transaction

    logger.warning("PostGIS is not callable on this connection")
    return {"ok": False, "detail": "PostGIS extension not available"}


async def _check_database() -> tuple[dict[str, Any], dict[str, Any]]:
    """Probe the database and PostGIS.

    Returns (database_check, postgis_check). Both are reported separately so a
    reachable database that is missing the spatial extension is distinguishable
    from one that is simply unreachable.
    """
    db_check: dict[str, Any] = {"ok": False, "detail": "not checked"}
    postgis_check: dict[str, Any] = {"ok": False, "detail": "not checked"}

    try:
        async with get_sessionmaker()() as session:
            version = (await session.execute(text("SELECT version()"))).scalar_one()
            db_check = {"ok": True, "detail": str(version).split(" on ")[0]}

            postgis_check = await _check_postgis(session)
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        # The exception text can contain the connection URL including credentials,
        # so only the exception class and a short reason are surfaced.
        logger.warning("Database readiness check failed: %s", exc)
        db_check = {"ok": False, "detail": f"unreachable ({type(exc).__name__})"}

    return db_check, postgis_check


@router.get("/ready", summary="Readiness probe")
async def ready(response: Response) -> dict[str, Any]:
    """Return 200 only when the primary database is reachable and has PostGIS.

    Reports which provider is configured so the dashboard can show it, but never
    the host, user, database name or connection URL. This endpoint is
    unauthenticated - see docs/SECURITY.md section 5.
    """
    settings = get_settings()
    db_check, postgis_check = await _check_database()
    all_ok = db_check["ok"] and postgis_check["ok"]

    if not all_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if all_ok else "not_ready",
        # Safe: an enum of "supabase" | "local", carrying no credential.
        "provider": settings.DATABASE_PROVIDER,
        "checks": {"database": db_check, "postgis": postgis_check},
    }
