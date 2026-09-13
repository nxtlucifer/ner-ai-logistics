"""FastAPI application entrypoint.

Routers are registered here and nowhere else, so the complete API surface is
readable in one place. Each one owns its own authorization; there is no
app-wide middleware granting or withholding access, because a gate you cannot
see from the route is a gate nobody checks when adding the next route.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ai import router as ai_router
from app.api.files import router as files_router
from app.api.documents import router as documents_router
from app.api.auth import router as auth_router
from app.api.driver import router as driver_router
from app.api.emergencies import router as emergencies_router
from app.api.fleet import assignments_router, drivers_router, trucks_router
from app.api.geocoding import router as geocoding_router
from app.api.health import router as health_router
from app.api.trips import fleet_router, shipments_router, trips_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.event_loop import running_loop_supports_psycopg
from app.db.session import dispose_engine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


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
        import httpx
        from app.services import warnings as warnings_service

        async def _warnings_loop():
            while True:
                try:
                    async with httpx.AsyncClient(timeout=settings.WEATHER_TIMEOUT_SECONDS) as client:
                        await warnings_service.feed(client)
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

    yield

    for task in (sentinel_task, warnings_task, watch_task):
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    logger.info("Shutting down, disposing database pool")
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        description=(
            "Backend for the NER Smart Logistics and Accessibility Intelligence "
            "Platform (SIH26002). Implemented: authentication, driver/truck/"
            "assignment management, shipments and trips, driver self-service, "
            "GPS telemetry ingestion, fleet location reads, route planning, and "
            "deterministic route risk from weather sampled along the route. "
            "Not implemented: ETA, incidents, fuel estimation, payments, alerts "
            "and emergencies. See docs/API_CONTRACTS.md section 15."
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
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    # One error shape for every failure, and a containment boundary: psycopg
    # embeds the connection DSN in its exceptions, so a raw 500 would leak it.
    register_exception_handlers(app)

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(drivers_router)
    app.include_router(trucks_router)
    app.include_router(assignments_router)
    app.include_router(driver_router)
    app.include_router(shipments_router)
    app.include_router(trips_router)
    app.include_router(fleet_router)
    app.include_router(emergencies_router)
    app.include_router(geocoding_router)
    app.include_router(ai_router)
    app.include_router(files_router)
    app.include_router(documents_router)
    return app


app = create_app()
