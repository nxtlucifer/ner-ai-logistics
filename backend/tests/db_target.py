"""The only database this suite may ever touch, and the check that proves it.

WHY THIS EXISTS

`backend/.env` sets `DATABASE_PROVIDER=supabase`. A plain `pytest` with no
environment arming therefore resolved to the SHARED database and began creating
fixtures there. Nothing announced it; the first visible symptom was an
unrelated `UndefinedColumn` for a migration applied only locally. Test data was
written to a shared database.

The isolation had been real but procedural: it lived in
`.runtime/use-isolated-db.ps1` and depended on every caller remembering to
dot-source it. One forgotten step defeated it, and the step was forgotten from
Bash, which had no armed path at all. This module makes the target a checked
property of the suite instead of a habit.

WHAT IT REFUSES, AND WHEN

Before any socket is opened - not after a failure, not on a timeout. A guard
that runs after `connect()` has already reached a remote host has prevented
nothing.

`DATABASE_PROVIDER=local` is NOT sufficient and is not consulted here. The
label is not the target: `backend/.env` sets `LOCAL_DATABASE_URL` to
`localhost:5432/ner_logistics`, which is local, is not this database, and would
have been written to just as readily.

Nor is the configured URL sufficient by itself. SQLAlchemy merges URL query
arguments and `connect_args` into the parameters actually handed to the driver,
so a URL reading `127.0.0.1:55432` can still dial elsewhere. The veto therefore
runs on `do_connect`, the dialect event that receives the final parameter set
and stands in for the DBAPI's own connect call. Registered against `Engine`, it
covers the async application engine, the synchronous engines the suite builds
for the advisory lock and for migrations, and any engine added later by
somebody who never read this file. That is the property worth having: not that
every call site remembers, but that there is one place they cannot get past.

THERE IS NO OVERRIDE

An earlier fix offered `ALLOW_SHARED_DB_TESTS=1`. That was a mistake: a single
environment variable that turns the protection off is a bypass, and the failure
being guarded against was somebody not setting an environment variable
correctly in the first place. A future authorised remote test environment would
need its own reviewed, exact target added to `ALLOWED_TARGETS` by a human
reading this file - not a boolean.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import event
from sqlalchemy.engine import Engine, make_url


@dataclass(frozen=True)
class Target:
    """One exact database this suite is permitted to use."""

    scheme: str
    host: str
    port: int
    database: str

    def describe(self) -> str:
        """Never includes credentials - only the address."""
        return f"{self.scheme}://{self.host}:{self.port}/{self.database}"


#: The isolated PostgreSQL/PostGIS cluster this project runs its tests against,
#: as registered by `.runtime/use-isolated-db.ps1` and `.runtime/use-isolated-db.sh`.
#:
#: Exact by design. "Any localhost database" is not good enough: a developer
#: with the production schema restored locally, an SSH tunnel forwarding a
#: remote port to 127.0.0.1, or a DNS name containing the word "local" all
#: present as local and are not this database.
ISOLATED_TEST_TARGET = Target(
    scheme="postgresql+psycopg",
    host="127.0.0.1",
    port=55432,
    database="ner_logistics_test",
)

ALLOWED_TARGETS: tuple[Target, ...] = (ISOLATED_TEST_TARGET,)

ARM_HINT = (
    "Arm the isolated cluster before running the suite:\n"
    "    PowerShell:  . .\\.runtime\\use-isolated-db.ps1\n"
    "    Bash:        source .runtime/use-isolated-db.sh\n\n"
    "There is no environment-variable override. If a different target is ever "
    "authorised, add it to ALLOWED_TARGETS in tests/db_target.py."
)


class UnsafeTestTarget(RuntimeError):
    """Raised instead of connecting. Carries no credentials."""


#: Every connection the veto allowed through, as `host:port/database`. Written
#: by the `do_connect` listener, read by the refusal matrix: a configuration
#: that must be refused has to leave this list untouched, which is a stronger
#: statement than "the helper returned a reason".
ALLOWED_CONNECTS: list[str] = []


def _verdict(
    scheme: str, host: str, port: int | None, database: str
) -> str | None:
    """Return a refusal reason, or None when this is an allowed target.

    Reports only scheme/host/port/database. Never the username, password or
    query string - refusal messages end up in logs and handoff documents.
    """
    for allowed in ALLOWED_TARGETS:
        if (
            scheme == allowed.scheme
            and host == allowed.host
            and port == allowed.port
            and database == allowed.database
        ):
            return None

    return (
        f"refusing to use {scheme}://{host or '?'}:{port or '?'}/"
        f"{database or '?'}. The only permitted target is "
        f"{ISOLATED_TEST_TARGET.describe()}."
    )


def check_url(url: str | None) -> str | None:
    """Refusal reason for a configured URL, or None when it is allowed.

    Pure and side-effect free. This is the early, legible layer: it lets the
    run stop with one clear message during collection instead of the same
    refusal repeated per test. `install()` is the layer that actually
    guarantees nothing is dialled.
    """
    if not url:
        return (
            "no database URL is configured for the test run. Refusing rather "
            "than falling back to backend/.env, which points at a shared "
            "database."
        )

    try:
        parsed = make_url(url)
    except Exception:  # noqa: BLE001 - any parse failure is a refusal
        return "the configured database URL could not be parsed."

    return _verdict(
        parsed.drivername or "", parsed.host or "", parsed.port, parsed.database or ""
    )


def enforce(url: str | None, *, context: str) -> None:
    """Raise `UnsafeTestTarget` unless `url` is an allowed target.

    `context` names the call site so a refusal says which path was about to
    connect - the suite start, a factory, or teardown.
    """
    reason = check_url(url)
    if reason is None:
        return
    raise UnsafeTestTarget(f"BLOCKED ({context}): {reason}\n\n{ARM_HINT}")


_installed = False


def install() -> None:
    """Veto every connection this process attempts, whatever built the engine.

    Idempotent, so importing conftest more than once (pytest-xdist, a nested
    session) does not stack listeners.

    `do_connect` is the dialect event SQLAlchemy consults *instead of* calling
    the DBAPI's `connect`. Raising here means the driver is never invoked and
    no socket is opened - which is what makes "zero connection attempts"
    provable rather than hopeful. `cparams` is the final merged parameter set,
    so URL query arguments and `connect_args` host overrides are covered; it
    also holds the password, so it is inspected field by field and never
    logged.
    """
    global _installed
    if _installed:
        return
    _installed = True

    @event.listens_for(Engine, "do_connect")
    def _veto(dialect, conn_rec, cargs, cparams):  # noqa: ANN001, ARG001
        scheme = f"{dialect.name}+{dialect.driver}"
        host = str(cparams.get("host") or "")
        raw_port = cparams.get("port")
        port = int(raw_port) if raw_port is not None else None
        # psycopg names it `dbname`; other drivers use `database`.
        database = str(cparams.get("dbname") or cparams.get("database") or "")

        reason = _verdict(scheme, host, port, database)
        if reason is not None:
            raise UnsafeTestTarget(f"BLOCKED (connection attempt): {reason}\n\n{ARM_HINT}")

        ALLOWED_CONNECTS.append(f"{host}:{port}/{database}")
        return None  # let SQLAlchemy connect normally
