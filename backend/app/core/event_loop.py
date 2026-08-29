"""Windows asyncio event loop configuration.

Python on Windows defaults asyncio to ProactorEventLoop. psycopg3's async driver
cannot run on it and raises:

    psycopg.InterfaceError: Psycopg cannot use the 'ProactorEventLoop' to run in
    async mode.

So every async database call fails on Windows unless the selector policy is set
BEFORE the event loop is created. This is a development-environment concern only -
the policy does not exist on Linux, where deployment happens - but it breaks the
entire backend locally, which is where the project is being built.

Timing is the whole point: setting the policy has no effect on a loop that is
already running. It must be called before uvicorn (or pytest-asyncio) creates one,
which is why run.py exists as the documented entrypoint rather than invoking
`uvicorn app.main:app` directly. Uvicorn creates its loop before importing the
application, so a call placed inside app.main would be too late.
"""

import asyncio
import sys


def configure_event_loop_policy() -> bool:
    """Install the selector event loop policy on Windows.

    Returns True if the policy was changed, False if no change was needed.
    Safe to call more than once.
    """
    if sys.platform != "win32":
        return False

    policy = asyncio.get_event_loop_policy()
    if isinstance(policy, asyncio.WindowsSelectorEventLoopPolicy):
        return False

    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    return True


def running_loop_supports_psycopg() -> bool:
    """Whether the currently running loop can serve async psycopg.

    Used at startup to fail loudly with an actionable message instead of letting
    every database call die with a confusing InterfaceError.
    """
    if sys.platform != "win32":
        return True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return True
    return type(loop).__name__ != "ProactorEventLoop"
