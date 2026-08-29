"""Backend entrypoint. Use this instead of invoking uvicorn directly.

    python run.py

Why not `uvicorn app.main:app --reload`?

Uvicorn creates its event loop before importing the application, so the Windows
selector-policy fix in app.core.event_loop has to run here - before uvicorn is
even imported - to take effect. Starting uvicorn directly on Windows leaves the
default ProactorEventLoop in place and every database call fails with a
psycopg InterfaceError.

On Linux this file is simply a thin wrapper; the policy call is a no-op there.
"""

from app.core.event_loop import configure_event_loop_policy

# Must happen before uvicorn is imported, not merely before it is called.
_policy_changed = configure_event_loop_policy()

import uvicorn  # noqa: E402  - deliberate: import order is load-bearing here

from app.core.config import get_settings  # noqa: E402


def main() -> None:
    settings = get_settings()
    if _policy_changed:
        print("[run.py] Windows detected: using WindowsSelectorEventLoopPolicy")

    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.is_development,
        log_level="info",
    )


if __name__ == "__main__":
    main()
