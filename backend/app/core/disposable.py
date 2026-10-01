"""The one function every fixture loader has to get past.

WHY THIS EXISTS SEPARATELY FROM `tests/db_target.py`

That guard vetoes the CONNECTION the pytest suite opens, and it does its job
well. It cannot help anything outside the suite: a seed script, a demo
reset, a one-off `python scripts/....py` run from a shell that happens to
have `DATABASE_PROVIDER=supabase` in its environment. Those reach the
database through the ordinary application engine, which is exactly what they
are supposed to do - so the veto is not there.

This is the guard for them. It is a single call, placed at the top of
anything that writes fixture rows, and it refuses unless the target is a
database somebody is prepared to lose.

WHAT COUNTS AS DISPOSABLE

A local host, and nothing else. Not "the provider says local" - the label is
not the target, and `LOCAL_DATABASE_URL` can be pointed anywhere. The HOST is
read from the URL the application would actually dial.

There is deliberately NO override flag. An override is how a guard becomes a
comment: somebody sets it once to get through an afternoon and it stays set.
A genuinely authorised remote fixture target would be added to
`ALLOWED_REMOTE_HOSTS` below by a person editing this file, in a diff
somebody reviews.
"""

from __future__ import annotations

from typing import Final

from app.core.config import LOCAL_HOSTS, _host_of, get_settings

#: Remote hosts a fixture loader may write to. Empty, and it should stay
#: empty: every entry here is a database that automated writes can reach.
ALLOWED_REMOTE_HOSTS: Final[frozenset[str]] = frozenset()


class NotDisposable(RuntimeError):
    """The configured database is not one to write fixtures into."""


def is_disposable(url: str | None = None) -> bool:
    """Whether this target may be written to by a fixture loader.

    `None` means "the configured database". An empty string does NOT: it
    means somebody passed a URL and it came out blank, which is not a local
    database and must not quietly fall back to one.
    """
    target = get_settings().effective_database_url if url is None else url
    host = _host_of(target)
    return bool(host) and (host in LOCAL_HOSTS or host in ALLOWED_REMOTE_HOSTS)


def assert_disposable(what: str, url: str | None = None) -> None:
    """Refuse to run `what` unless the database is disposable.

    Call this FIRST - before opening a session, before reading an argument,
    before printing a banner. A guard that runs after the first insert has
    prevented nothing.
    """
    target = get_settings().effective_database_url if url is None else url
    host = _host_of(target) or "(unreadable)"
    if is_disposable(target):
        return
    raise NotDisposable(
        f"{what} refuses to run: the configured database is at '{host}', "
        "which is not a disposable target. Fixture and demo loaders may "
        "only write to a local isolated database.\n"
        "  Arm one with:  source .runtime/use-isolated-db.sh\n"
        "There is no override flag, by design - see app/core/disposable.py."
    )
