"""FastAPI application entrypoint.

Routers are registered here and nowhere else, so the complete API surface is
readable in one place. Each one owns its own authorization; there is no
app-wide middleware granting or withholding access, because a gate you cannot
see from the route is a gate nobody checks when adding the next route.
"""

import asyncio
import logging
import re
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ai import router as ai_router
from app.api.files import router as files_router
from app.api.documents import router as documents_router
from app.api.auth import router as auth_router
from app.api.driver import places_router
from app.api.driver import router as driver_router
from app.api.emergencies import router as emergencies_router
from app.api.fleet import assignments_router, drivers_router, trucks_router
from app.api.geocoding import router as geocoding_router
from app.api.dashboard import router as dashboard_router
from app.api.health import router as health_router
from app.api.notifications import router as notifications_router
from app.api.presence import router as presence_router
from app.api.org import router as org_router
from app.api.trips import fleet_router, shipments_router, trips_router
from app.core.config import get_settings
from app.core.errors import hardening_headers, register_exception_handlers
from app.core.event_loop import running_loop_supports_psycopg
from app.db.session import dispose_engine
from app.services import coordination, http_clients

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
# httpx logs every request URL at INFO, and a provider URL can carry a key.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

#: An inbound X-Request-ID is kept only in this shape: bounded, and nothing a
#: log line or a header could be split on.
_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{1,64}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # safe_dump redacts SECRET_KEY and the database password. Never log settings
    # directly - see docs/SECURITY.md section 5.
    logger.info("Starting %s", settings.APP_NAME)
    for key, value in settings.safe_dump().items():
        logger.info("  %s = %s", key, value)

    # Fail loudly and actionably rather than letting every database call die with
    # an opaque psycopg InterfaceError. The policy cannot be fixed from here - the
    # loop is already running - so this reports rather than repairs.
    if not running_loop_supports_psycopg():
        logger.error(
            "Running on ProactorEventLoop. Async psycopg will not work and every "
            "database call will fail. Start the backend with `python run.py` "
            "instead of invoking uvicorn directly. See app/core/event_loop.py."
        )
    # The database is deliberately not probed here. Startup must not depend on a
    # dependency being up; /ready reports that instead.

    # FC-02: behind a proxy with no trusted hop, every public caller shares the
    # proxy's address, so the login per-IP limit becomes one global budget.
    # Loud here; /ready's `proxy` check says it again once a forwarded header
    # actually arrives (docs/RATE_LIMIT_POLICY.md s.3).
    if not settings.is_development and settings.TRUSTED_PROXY_HOPS == 0:
        logger.warning(
            "TRUSTED_PROXY_HOPS=0 with APP_ENV=%s: if a reverse proxy fronts this "
            "service, all callers share one per-IP rate limit. Render: set "
            "TRUSTED_PROXY_HOPS=1. Other platforms: count the hops that append "
            "X-Forwarded-For, never more.",
            settings.APP_ENV,
        )

    # MULTI_INSTANCE: each loop below still starts everywhere. Sentinel and
    # route watch write rows and send pushes, so a tick runs only on the
    # instance holding that loop's lease (coordination.my_turn; route watch
    # checks it inside run_tick). The warnings poll only warms this process's
    # own cache, so every instance keeps polling.
    if settings.MULTI_INSTANCE and settings.DEMO_SIMULATION_ENABLED:
        logger.warning(
            "DEMO_SIMULATION_ENABLED is ignored: MULTI_INSTANCE is on and the "
            "simulation registry is per process, so it is forced off."
        )

    sentinel_task = None
    if settings.SENTINEL_SCHEDULER_ENABLED:
        from app.db.session import get_sessionmaker
        from app.services.sentinel import run_sentinel_sweep

        async def _sentinel_loop():
            logger.info(
                "Fleet Sentinel recurring scheduler started (interval=%ds)",
                settings.SENTINEL_SWEEP_INTERVAL_SECONDS,
            )
            while True:
                try:
                    await asyncio.sleep(settings.SENTINEL_SWEEP_INTERVAL_SECONDS)
                    if not await coordination.my_turn("sentinel", settings.SENTINEL_SWEEP_INTERVAL_SECONDS):
                        continue
                    async with get_sessionmaker()() as db:
                        swept = await run_sentinel_sweep(db)
                        if swept:
                            logger.info(
                                "Fleet Sentinel recurring sweep: %d emergency state change(s)",
                                len(swept),
                            )
                except asyncio.CancelledError:
                    break
                except Exception as exc:
                    logger.error("Fleet Sentinel recurring sweep error: %s", exc)

        sentinel_task = asyncio.create_task(_sentinel_loop())

    # Official warnings are the one source whose value is in being CURRENT
    # before any route asks: the same bounded poll the route assessment uses
    # (one RSS request per WARNINGS_FEED_TTL_SECONDS, cached), started here so
    # the System page shows a real freshness the moment the process is up and
    # a dispatch does not pay the first fetch. Weather, flood and terrain stay
    # on demand per route: polling them for routes nobody is planning would
    # only spend the providers' free quotas.
    warnings_task = None
    if settings.WARNINGS_ENABLED and settings.WARNINGS_POLL_ENABLED:
        from app.services import warnings as warnings_service

        async def _warnings_loop():
            while True:
                try:
                    await warnings_service.feed(warnings_service.client_for_warnings())
                except asyncio.CancelledError:
                    break
                except Exception as exc:  # noqa: BLE001 - a feed outage is a health row, not a crash
                    logger.info("warnings poll failed: %s", type(exc).__name__)
                try:
                    await asyncio.sleep(settings.WARNINGS_FEED_TTL_SECONDS)
                except asyncio.CancelledError:
                    break

        warnings_task = asyncio.create_task(_warnings_loop())

    # Route-ahead worker: a cheap 60 s tick over moving trips; the window ahead
    # of each truck is re-scored at most every ROUTE_WATCH_REFRESH_SECONDS and
    # a material worsening becomes one push (services/route_watch.py).
    watch_task = None
    if settings.ROUTE_WATCH_ENABLED:
        from app.db.session import get_sessionmaker
        from app.services.route_watch import run_tick

        async def _watch_loop():
            while True:
                try:
                    await asyncio.sleep(settings.ROUTE_WATCH_TICK_SECONDS)
                    async with get_sessionmaker()() as db:
                        done = await run_tick(db)
                        if done:
                            logger.info("route watch: %s", done)
                except asyncio.CancelledError:
                    break
                except Exception as exc:  # noqa: BLE001 - the loop outlives any one pass
                    logger.error("route watch error: %s", type(exc).__name__)

        watch_task = asyncio.create_task(_watch_loop())

    break_task = None
    if settings.BREAK_WATCH_ENABLED:
        from app.db.session import get_sessionmaker
        from app.services.breaks import flag_overdue

        async def _break_loop():
            while True:
                try:
                    await asyncio.sleep(settings.BREAK_WATCH_TICK_SECONDS)
                    async with get_sessionmaker()() as db:
                        if n := await flag_overdue(db):
                            logger.info("break watch: %s overdue", n)
                except asyncio.CancelledError:
                    break
                except Exception as exc:  # noqa: BLE001 - the loop outlives any one pass
                    logger.error("break watch error: %s", type(exc).__name__)

        break_task = asyncio.create_task(_break_loop())

    yield

    for task in (sentinel_task, warnings_task, watch_task, break_task):
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    # Hand the leases over now: left to expire, a deploy would leave route
    # watch unled for a TTL (2.5 ticks) plus a tick.
    if settings.MULTI_INSTANCE:
        try:
            await coordination.release()
        except Exception as exc:  # noqa: BLE001 - shutdown goes on; the leases expire anyway
            logger.warning("lease release failed: %s", type(exc).__name__)

    # The shared provider clients (app/services/http_clients.py).
    await http_clients.aclose_all()

    logger.info("Shutting down, disposing database pool")
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        description=(
            "Backend for the NER Smart Logistics and Accessibility Intelligence "
            "Platform (SIH26002). Implemented: authentication (JWT + rotating "
            "refresh tokens, RBAC), driver/truck/assignment management, shipments "
            "and trips (atomic plan, dispatch gates, mid-trip stops, journey "
            "history), driver self-service, GPS telemetry ingestion, fleet "
            "location reads, route planning with review/approval governance, "
            "deterministic route risk, live reroute, Fleet Sentinel emergencies, "
            "private files and documents, push notices, geocoding and an "
            "advisory AI router. Not implemented: fuel estimation, payments, "
            "expenses and payroll. See docs/API_CONTRACTS.md section 15."
        ),
        lifespan=lifespan,
        # Both the human docs page and the machine-readable schema are
        # development-only. Gating `docs_url` alone would still serve the full
        # endpoint and schema inventory at /openapi.json in production, which is
        # a free reconnaissance map of the API for an unauthenticated caller.
        docs_url="/docs" if settings.is_development else None,
        openapi_url="/openapi.json" if settings.is_development else None,
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    # Response hardening headers on every reply. This is not an access gate
    # (see the module docstring) - it grants and withholds nothing - it only
    # tells the browser how it may treat what it was given: never sniff a
    # stored JPEG into HTML, never frame this origin, never cache a bearer-
    # authenticated /api body, and (outside development, where the server is
    # plain http) always come back over TLS. /api/files sets its own
    # Cache-Control for avatars, which setdefault leaves alone.
    # The set itself lives in app/core/errors.py, shared with the 500 handler.
    @app.middleware("http")
    async def security_headers(request, call_next):
        response = await call_next(request)
        for name, value in hardening_headers(request.scope["path"]).items():
            if name != "Cache-Control" or name not in response.headers:
                response.headers[name] = value
        return response

    # Registered last, so outermost: every layer below, the error envelopes
    # included (app/core/errors.py), sees the same id, and the reply carries
    # it back. A 500 is answered outside this middleware, so its handler sets
    # the header itself.
    @app.middleware("http")
    async def request_id(request, call_next):
        inbound = request.headers.get("x-request-id", "")
        rid = inbound if _REQUEST_ID.fullmatch(inbound) else str(uuid.uuid4())
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response

    # One error shape for every failure, and a containment boundary: psycopg
    # embeds the connection DSN in its exceptions, so a raw 500 would leak it.
    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(drivers_router)
    app.include_router(trucks_router)
    app.include_router(assignments_router)
    app.include_router(driver_router)
    # Roadside services for the manager map: same snapshot, map-area scope.
    app.include_router(places_router)
    app.include_router(shipments_router)
    app.include_router(trips_router)
    app.include_router(fleet_router)
    app.include_router(emergencies_router)
    app.include_router(geocoding_router)
    app.include_router(ai_router)
    app.include_router(files_router)
    app.include_router(documents_router)
    app.include_router(org_router)
    app.include_router(notifications_router)
    app.include_router(presence_router)
    app.include_router(dashboard_router)
    return app


app = create_app()
