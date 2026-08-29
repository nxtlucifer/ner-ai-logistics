"""FastAPI application entrypoint.

Mission 1 scope: configuration, database wiring, and the two system endpoints.
No domain routes exist yet - see docs/DEVELOPMENT_ROADMAP.md.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import get_settings
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

    app.include_router(health_router)
    return app


app = create_app()
