# Hosted intelligence plane: routing, accessibility scoring, evidence
# aggregation and navigation packages.
#
# This image serves the SAME FastAPI application as local development. It is not
# a cut-down build, because the value of hosting it is precisely that the code
# with 976 passing tests behind it is the code that answers a judge's questions.
# What changes is configuration, not content:
#
#   AUTH_PROVIDER=supabase   callers arrive with a Supabase session, not one of
#                            ours, so tokens are verified against the project
#                            JWKS (app/auth/verifier.py). Roles are still read
#                            from our users table - Supabase says who, never what.
#   DATABASE_PROVIDER=supabase
#   CORS_ORIGINS             the manager web origin. The APK is native and is
#                            not subject to CORS.
#
# 3.11 specifically: pyproject pins >=3.11,<3.13 and the project documents why.

FROM python:3.11-slim

# Bytecode writing and output buffering both cost more than they give in a
# container - unbuffered logs matter when the only debugging surface is a log
# stream you cannot attach to.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependencies first so a source change does not reinstall them. psycopg is
# installed from the [binary] wheel, so no libpq build chain is needed here.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root. Nothing in the request path writes to the filesystem.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# The platform supplies $PORT. Defaulted so the image also runs with a bare
# `docker run -p 8000:8000`.
ENV API_HOST=0.0.0.0 \
    PORT=8000

# uvicorn directly rather than run.py: that wrapper exists to install a Windows
# event-loop policy before uvicorn is imported, which is a no-op on Linux, and
# it reads the port from settings rather than from $PORT.
#
# Shell form so $PORT expands. One worker: the application holds a small
# database pool sized for Supabase's session pooler, and multiplying workers
# multiplies pools.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1
