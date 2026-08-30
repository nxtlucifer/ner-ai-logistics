"""FastAPI application entrypoint.

Routers are registered here and nowhere else, so the complete API surface is
readable in one place. Each one owns its own authorization; there is no
app-wide middleware granting or withholding access, because a gate you cannot
see from the route is a gate nobody checks when adding the next route.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.driver import router as driver_router
from app.api.fleet import assignments_router, drivers_router, trucks_router
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
    yield
    logger.info("Shutting down, disposing database pool")
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        description=(
            "Backend for the NER Smart Logistics and Accessibility Intelligence "
            "Platform (SIH26002). Foundation phase: only /health and /ready are "
            "implemented."
        ),
        lifespan=lifespan,
        docs_url="/docs" if settings.is_development else None,
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
    return app


app = create_app()
