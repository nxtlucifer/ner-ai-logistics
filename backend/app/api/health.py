"""Liveness and readiness endpoints.

The distinction is deliberate and load-bearing:

  /health  - is the process alive? Touches nothing external. A liveness probe that
             fails because a dependency is down gets the process restarted for
             somebody else's outage, which turns a database blip into an outage of
             its own.

  /ready   - can this instance actually serve requests? Checks the database and the
             PostGIS extension, because a database without PostGIS cannot serve this
             application at all, and that the schema is at this code's alembic head:
             a database one migration behind answers `SELECT version()` happily
             and then fails the first query that names a new column (P1R-14).

See docs/API_CONTRACTS.md section 15.
"""

import logging
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text

from app.api.deps import CurrentUser, DbSession, rate_limit, require_permission
from app.core import permissions as perm
from app.core import rate_limit as rate_limit_state
from app.core.config import get_settings
from app.db.session import get_sessionmaker, pool_status
from app.models.identity import User

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


@lru_cache
def _code_revisions() -> tuple[frozenset[str], frozenset[str]]:
    """(heads, every revision) of the migrations shipped with this code."""
    from alembic.script import ScriptDirectory

    script = ScriptDirectory(str(Path(__file__).resolve().parents[2] / "alembic"))
    return frozenset(script.get_heads()), frozenset(r.revision for r in script.walk_revisions())


async def _database_revisions(session: Any) -> frozenset[str]:
    try:
        return frozenset((await session.execute(text("SELECT version_num FROM alembic_version"))).scalars())
    except Exception as exc:  # noqa: BLE001 - no table reads as "no revision"
        logger.warning("alembic_version unreadable: %s", type(exc).__name__)
        await session.rollback()
        return frozenset()


def _schema_check(found: frozenset[str]) -> dict[str, Any]:
    """at_head, schema_behind (an older revision of this code's own history)
    or schema_unknown (none, or one this code does not know: ahead of it, or
    another branch). Only at_head is ready; unknown is never assumed fine."""
    try:
        heads, known = _code_revisions()
    except Exception as exc:  # noqa: BLE001 - nothing to compare with
        logger.warning("alembic scripts unreadable: %s", type(exc).__name__)
        return {"ok": False, "detail": "schema_unknown"}
    if found == heads:
        return {"ok": True, "detail": "at_head"}
    if found and found <= known:
        return {"ok": False, "detail": "schema_behind"}
    return {"ok": False, "detail": "schema_unknown"}


async def _check_geography(session: Any) -> dict[str, Any]:
    """RB-09, advisory: is the India outline every location gate needs loaded,
    and whose is it? A FIXTURE_* row is a synthetic test rectangle, which
    classification ignores outside APP_ENV=test (geo_classify)."""
    from app.services import geo_classify

    try:
        row = (
            await session.execute(
                text(
                    "SELECT geometry_source, geometry_source_version FROM country_boundaries "
                    "WHERE code = :code"
                ),
                {"code": geo_classify.INDIA},
            )
        ).one_or_none()
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        logger.warning("country_boundaries unreadable: %s", type(exc).__name__)
        await session.rollback()
        return {"ok": False, "detail": "unreadable", "geometry_source": None}
    source, version = row if row is not None else (None, None)
    fixture = source is not None and source.startswith(geo_classify.FIXTURE_PREFIX)
    return {
        "ok": source is not None and (not fixture or geo_classify.fixture_geometry_allowed()),
        "detail": "not_loaded" if source is None else (source if fixture else "loaded"),
        "geometry_source": source,
        "geometry_source_version": version,
    }


async def _check_database() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], frozenset[str], dict[str, Any]]:
    """Probe the database, PostGIS, the schema revision and the India outline.

    Returns (database_check, postgis_check, schema_check, database revisions,
    geography_check),
    reported separately so a reachable database that lacks the spatial
    extension, or a migration, is distinguishable from an unreachable one.
    """
    db_check: dict[str, Any] = {"ok": False, "detail": "not checked"}
    postgis_check: dict[str, Any] = {"ok": False, "detail": "not checked"}
    schema_check: dict[str, Any] = {"ok": False, "detail": "not checked"}
    found: frozenset[str] = frozenset()
    geography: dict[str, Any] = {"ok": False, "detail": "not checked", "geometry_source": None}

    try:
        async with get_sessionmaker()() as session:
            version = (await session.execute(text("SELECT version()"))).scalar_one()
            db_check = {"ok": True, "detail": str(version).split(" on ")[0]}

            postgis_check = await _check_postgis(session)
            found = await _database_revisions(session)
            schema_check = _schema_check(found)
            geography = await _check_geography(session)
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        # The exception text can contain the connection URL including credentials,
        # so only the exception class and a short reason are surfaced.
        logger.warning("Database readiness check failed: %s", exc)
        db_check = {"ok": False, "detail": f"unreachable ({type(exc).__name__})"}

    return db_check, postgis_check, schema_check, found, geography


def _proxy_check() -> dict[str, Any]:
    """Advisory, never part of the ready decision (docs/RATE_LIMIT_POLICY.md
    s.3). `forwarded_header_ignored`: an X-Forwarded-For arrived while
    TRUSTED_PROXY_HOPS is 0, so a proxy is probably in front and every public
    caller shares its per-IP rate limit. Out of rotation over that would be
    an outage of its own; a red line on the System page is the right size."""
    if get_settings().TRUSTED_PROXY_HOPS > 0:
        return {"ok": True, "detail": "trusted_hops_set"}
    if rate_limit_state.forwarded_header_ignored:
        return {"ok": False, "detail": "forwarded_header_ignored"}
    return {"ok": True, "detail": "direct"}


@router.get(
    "/ready",
    summary="Readiness probe",
    # Five database statements, unauthenticated: per client address. The
    # platform's probe is /health, which is never limited.
    dependencies=[rate_limit("public")],
)
async def ready(response: Response) -> dict[str, Any]:
    """Return 200 only when the primary database is reachable and has PostGIS.

    Reports which provider is configured so the dashboard can show it, but never
    the host, user, database name or connection URL. This endpoint is
    unauthenticated - see docs/SECURITY.md section 5.
    """
    settings = get_settings()
    db_check, postgis_check, schema_check, _found, geography = await _check_database()
    all_ok = db_check["ok"] and postgis_check["ok"] and schema_check["ok"]

    if not all_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if all_ok else "not_ready",
        # Safe: an enum of "supabase" | "local", carrying no credential.
        "provider": settings.DATABASE_PROVIDER,
        # at_head / schema_behind / schema_unknown, never a revision id: the
        # ids are in the managers-only detail below. `proxy` is advisory.
        "checks": {
            "database": db_check,
            "postgis": postgis_check,
            "schema": schema_check,
            "proxy": _proxy_check(),
            # Advisory, like proxy: never flips status. Public, so only
            # loaded / not_loaded / the FIXTURE_* label; the source is in the
            # managers' detail.
            "geography": {"ok": geography["ok"], "detail": geography["detail"]},
        },
    }


@router.get("/api/system/readiness", summary="Readiness with its internals (managers)")
async def readiness_detail(
    db: DbSession,
    user: Annotated[User, Depends(require_permission(perm.AUDIT_READ))],
) -> dict[str, Any]:
    """What /ready decides, plus what it must not say in public (DBPOOL-07):
    the pool counters and the schema revisions on each side.

    This request's own connection (the auth lookup) goes back first, so the
    counters are everyone else's, read before the checks borrow one. With the
    pool exhausted this endpoint queues like any other request, for
    DB_POOL_TIMEOUT_SECONDS, and that wait is itself the answer.
    """
    await db.commit()
    pool = pool_status()
    db_check, postgis_check, schema_check, found, geography = await _check_database()
    try:
        heads = sorted(_code_revisions()[0])
    except Exception:  # noqa: BLE001 - the schema check already says unknown
        heads = []
    ready = db_check["ok"] and postgis_check["ok"] and schema_check["ok"]
    return {
        "status": "ready" if ready else "not_ready",
        "checks": {
            "database": db_check, "postgis": postgis_check, "schema": schema_check,
            "geography": geography,  # advisory: not part of `ready`
        },
        "schema": {"database": sorted(found), "code_heads": heads},
        "pool": pool,
        "proxy": {**_proxy_check(), "trusted_hops": get_settings().TRUSTED_PROXY_HOPS},
    }


@router.get("/api/system/simulation", summary="Active DEMO SIMULATION scenarios")
async def system_simulation(user: CurrentUser) -> dict[str, object]:
    from app.services import simulation

    return {"enabled": simulation.enabled(), "active": simulation.snapshot()}


@router.get("/api/system/providers", summary="Data-source health and the intelligence inventory")
async def providers(user: CurrentUser) -> dict[str, Any]:
    """What every external source last did, and what "AI" this repository holds.

    Health rows carry a state, a freshness class judged against each product's
    own cadence, timestamps and an error CATEGORY - never a key, a URL with a
    key, or a response body. The inventory is the code-audited count from
    `app/domain/intelligence_inventory.py`, so the System page and the report
    cannot disagree.
    """
    from app.core.config import get_settings
    from app.domain import intelligence_inventory
    from app.services import provider_health

    if not get_settings().SMS_PROVIDER:
        provider_health.not_configured("SMS")
    return {
        "providers": provider_health.snapshot(),
        "intelligence": {"counts": intelligence_inventory.counts(), **intelligence_inventory.totals(),
                          "modules": [{"category": c, "module": m, "what": w} for c, m, w in intelligence_inventory.INVENTORY]},
    }
