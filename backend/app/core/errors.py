"""Uniform API error contract.

One response shape for every failure, per docs/API_CONTRACTS.md section 1:

    {"error": {"code", "message", "details", "request_id"}}

The handlers here are also a containment boundary. An unhandled exception must
never reach a client carrying a SQL fragment, a stack trace or a connection URL
- psycopg embeds the full DSN, password included, in connection errors, so a
naive `str(exc)` in a 500 response is a credential leak.
"""

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class APIError(Exception):
    """A failure with a deliberate, client-safe representation."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status_code:
            self.status_code = status_code
        self.details = details or {}


class NotFoundError(APIError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"


class ConflictError(APIError):
    """State conflict: the request is well-formed but cannot apply now."""

    status_code = status.HTTP_409_CONFLICT
    code = "CONFLICT"


class BusinessRuleError(APIError):
    """A rule no role may override - capacity, expired documents, invariants.

    422 rather than 403 on purpose. 403 means "you may not"; 422 means "nobody
    may". A manager cannot authorise an overloaded truck.
    """

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "BUSINESS_RULE_VIOLATION"


class AuthenticationError(APIError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "UNAUTHENTICATED"


class PermissionDeniedError(APIError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "FORBIDDEN"


class ServiceUnavailableError(APIError):
    """An external dependency this request needed is down.

    Distinct from BusinessRuleError on purpose. 422 says "nobody may do this"
    and a retry will not help; 503 says "the thing we depend on is unreachable"
    and a retry very well might. Collapsing the two would tell a manager a trip
    is unroutable when the routing provider is merely having a bad minute.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "SERVICE_UNAVAILABLE"


class RateLimitedError(APIError):
    """Too many attempts against a limited endpoint.

    Carries `retry_after` so the handler can set the header. The message is
    deliberately identical whether or not the identifier exists - the login
    endpoint spends real effort not being an enumeration oracle, and a limiter
    that said "too many attempts for this account" would hand back exactly the
    signal that effort removes.
    """

    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "RATE_LIMITED"

    def __init__(self, message: str, *, retry_after: int, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


def _envelope(
    code: str, message: str, request: Request, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": getattr(request.state, "request_id", None) or str(uuid.uuid4()),
        }
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api_error(request: Request, exc: APIError) -> JSONResponse:
        response = JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, request, exc.details),
        )
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            response.headers["WWW-Authenticate"] = "Bearer"
        if isinstance(exc, RateLimitedError):
            # Without this a client has no way to know how long to wait, and
            # the reasonable ones back off blindly while the unreasonable ones
            # keep the window permanently occupied.
            response.headers["Retry-After"] = str(exc.retry_after)
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Pydantic's errors name the offending field and constraint, which is
        # genuinely useful to a client and leaks nothing about the server. The
        # input value is stripped, since it may contain a password.
        details = [
            {"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(
                "VALIDATION_ERROR",
                "Request failed validation.",
                request,
                {"errors": jsonable_encoder(details)},
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        codes = {
            400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN",
            404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 409: "CONFLICT",
            429: "RATE_LIMITED",
        }
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(
                codes.get(exc.status_code, "HTTP_ERROR"), str(exc.detail), request
            ),
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        """A database constraint fired.

        Reaching here means a service-layer check was missed or lost a race. The
        constraint did its job; the client gets a 409 and the details go to the
        log, never to the response - the driver text names tables, columns and
        constraint definitions.
        """
        logger.warning("Database integrity error on %s", request.url.path, exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=_envelope(
                "CONSTRAINT_VIOLATION",
                "The request conflicts with existing data.",
                request,
            ),
        )

    @app.exception_handler(SQLAlchemyError)
    async def _database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        # psycopg embeds the connection DSN - password included - in connection
        # errors. Never serialise this exception to a client.
        logger.error("Database error on %s", request.url.path, exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=_envelope(
                "DATABASE_UNAVAILABLE", "A database error occurred.", request
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s", request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope(
                "INTERNAL_ERROR", "An unexpected error occurred.", request
            ),
        )
