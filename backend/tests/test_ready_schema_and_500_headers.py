"""/ready refuses a schema behind the code (P1R-14), and an unhandled 500
carries the hardening headers (SEC-P0C-2).

P1R-14: an API at 0016 code over a 0015 database answered /ready 200 while
/api/org/regions failed with UndefinedColumn (phase1 lane,
red_ready_schema_gap.py). /ready now compares alembic_version with the
migrations shipped with the code.

SEC-P0C-2: a 500 is answered by Starlette's ServerErrorMiddleware, outside the
security-header middleware, and carried only X-Request-ID (security lane).
"""

import httpx
import pytest
from httpx import AsyncClient

from app.api import health
from app.core.config import get_settings

HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
}


@pytest.mark.requires_db
class TestReadySchema:
    async def test_at_head_is_ready_and_says_so_without_revision_ids(self, client: AsyncClient) -> None:
        r = await client.get("/ready")
        assert r.status_code == 200, r.text
        assert r.json()["checks"]["schema"] == {"ok": True, "detail": "at_head"}
        heads, _ = health._code_revisions()
        assert not any(h in r.text for h in heads)

    async def test_a_database_behind_the_code_is_not_ready(self, client: AsyncClient, monkeypatch) -> None:
        heads, known = health._code_revisions()
        # The code gains a migration the database has not run.
        monkeypatch.setattr(health, "_code_revisions", lambda: (frozenset({"9999_next"}), known | {"9999_next"}))
        r = await client.get("/ready")
        assert r.status_code == 503, r.text
        body = r.json()
        assert body["status"] == "not_ready"
        assert body["checks"]["schema"] == {"ok": False, "detail": "schema_behind"}
        assert body["checks"]["database"]["ok"] is True

    async def test_a_revision_the_code_does_not_know_is_not_ready(self, client: AsyncClient, monkeypatch) -> None:
        monkeypatch.setattr(health, "_code_revisions", lambda: (frozenset({"0001_other"}), frozenset({"0001_other"})))
        r = await client.get("/ready")
        assert r.status_code == 503
        assert r.json()["checks"]["schema"] == {"ok": False, "detail": "schema_unknown"}

    def test_the_shipped_migrations_have_one_head(self) -> None:
        heads, known = health._code_revisions()
        assert len(heads) == 1 and heads <= known


class TestUnhandled500Headers:
    @pytest.mark.parametrize("env", ["production", "development"])
    async def test_every_reply_carries_the_hardening_headers(self, monkeypatch, env: str) -> None:
        monkeypatch.setenv("APP_ENV", env)
        monkeypatch.setenv("SECRET_KEY", "x" * 64)  # production refuses the placeholder
        get_settings.cache_clear()
        from app.main import create_app

        app = create_app()

        @app.get("/api/__boom")
        async def boom():  # noqa: ANN202 - test-only route
            raise RuntimeError("unhandled")

        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            for path, code in (("/health", 200), ("/api/does-not-exist", 404), ("/api/__boom", 500)):
                r = await c.get(path)
                assert r.status_code == code, (path, r.status_code)
                for name, value in HEADERS.items():
                    assert r.headers.get(name) == value, f"{path} ({code}) lacks {name}"
                assert ("strict-transport-security" in r.headers) is (env == "production"), path
                if path.startswith("/api/"):
                    assert r.headers.get("cache-control") == "no-store", path
                assert r.headers.get("x-request-id"), path
        get_settings.cache_clear()
