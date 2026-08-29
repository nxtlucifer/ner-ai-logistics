"""Configuration, provider selection and secret-handling tests.

Two controls are load-bearing here:

  1. The placeholder-secret guard, which stops the value published in
     .env.example from signing real tokens.
  2. The provider guard, which makes "Supabase mode never falls back to a local
     database" a structural property rather than a convention.

See docs/SECURITY.md section 5 and docs/ARCHITECTURE.md section 10.
"""

import pytest
from pydantic import ValidationError

from app.core.config import PLACEHOLDER_SECRET, Settings, redact_url

SUPABASE_URL_EXAMPLE = (
    "postgresql+psycopg://postgres.abcdefghijk:pw@"
    "aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
)
LOCAL_URL_EXAMPLE = "postgresql+psycopg://ner:pw@localhost:5432/ner_logistics"


def _settings(**overrides: object) -> Settings:
    """Build Settings from explicit values, ignoring any .env on disk."""
    base: dict[str, object] = {
        "APP_ENV": "development",
        "SECRET_KEY": "a-real-development-key",
        "DATABASE_PROVIDER": "supabase",
        "DATABASE_URL": SUPABASE_URL_EXAMPLE,
        "_env_file": None,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


class TestSecretKeyGuard:
    @pytest.mark.parametrize("env", ["production", "staging", "test"])
    def test_placeholder_secret_rejected_outside_development(self, env: str) -> None:
        with pytest.raises(ValidationError) as exc:
            _settings(APP_ENV=env, SECRET_KEY=PLACEHOLDER_SECRET)
        assert "SECRET_KEY is still the placeholder" in str(exc.value)

    def test_placeholder_secret_allowed_in_development(self) -> None:
        """Local development must stay frictionless; only deployment is gated."""
        settings = _settings(APP_ENV="development", SECRET_KEY=PLACEHOLDER_SECRET)
        assert settings.SECRET_KEY == PLACEHOLDER_SECRET


class TestDatabaseUrlValidation:
    def test_rejects_non_psycopg_driver(self) -> None:
        """psycopg2 and the bare driver do not support the async engine."""
        with pytest.raises(ValidationError) as exc:
            _settings(DATABASE_URL="postgresql://u:p@host.supabase.com:5432/postgres")
        assert "postgresql+psycopg://" in str(exc.value)

    def test_accepts_psycopg_driver(self) -> None:
        assert _settings().DATABASE_URL == SUPABASE_URL_EXAMPLE


class TestSupabaseProvider:
    """GATE 1 and GATE 6."""

    def test_supabase_is_the_default_provider(self) -> None:
        assert Settings.model_fields["DATABASE_PROVIDER"].default == "supabase"

    def test_missing_database_url_fails_loudly(self) -> None:
        """A missing primary URL must stop startup, not pick something else."""
        with pytest.raises(ValidationError) as exc:
            _settings(DATABASE_URL=None)
        message = str(exc.value)
        assert "DATABASE_PROVIDER=supabase requires DATABASE_URL" in message
        assert "will not fall back" in message

    def test_supabase_mode_rejects_a_local_database_url(self) -> None:
        """The core no-silent-fallback guard.

        Pointing "supabase" mode at localhost must be refused outright, so a
        misconfiguration cannot quietly serve stale local data while appearing
        healthy.
        """
        with pytest.raises(ValidationError) as exc:
            _settings(DATABASE_URL=LOCAL_URL_EXAMPLE)
        assert "which is a local address" in str(exc.value)

    @pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "0.0.0.0"])
    def test_all_local_hostnames_rejected_in_supabase_mode(self, host: str) -> None:
        with pytest.raises(ValidationError):
            _settings(
                DATABASE_URL=f"postgresql+psycopg://u:p@{host}:5432/ner_logistics"
            )

    def test_local_url_is_ignored_in_supabase_mode(self) -> None:
        """Even when a local URL is configured, Supabase mode must not use it."""
        settings = _settings(LOCAL_DATABASE_URL=LOCAL_URL_EXAMPLE)
        assert settings.effective_database_url == SUPABASE_URL_EXAMPLE
        assert "localhost" not in settings.effective_database_url

    def test_supabase_mode_requires_ssl(self) -> None:
        assert _settings().requires_ssl is True


class TestLocalProvider:
    """GATE 13 - local remains available, but only by explicit choice."""

    def test_local_mode_uses_local_url(self) -> None:
        settings = _settings(
            DATABASE_PROVIDER="local",
            DATABASE_URL=None,
            LOCAL_DATABASE_URL=LOCAL_URL_EXAMPLE,
        )
        assert settings.effective_database_url == LOCAL_URL_EXAMPLE

    def test_local_mode_requires_local_url(self) -> None:
        with pytest.raises(ValidationError) as exc:
            _settings(DATABASE_PROVIDER="local", DATABASE_URL=None)
        assert "requires LOCAL_DATABASE_URL" in str(exc.value)

    def test_local_mode_does_not_require_ssl(self) -> None:
        """A local WSL PostgreSQL does not serve TLS."""
        settings = _settings(
            DATABASE_PROVIDER="local",
            DATABASE_URL=None,
            LOCAL_DATABASE_URL=LOCAL_URL_EXAMPLE,
        )
        assert settings.requires_ssl is False

    def test_switching_provider_is_explicit_not_automatic(self) -> None:
        """Both URLs set: the provider alone decides, with no probing."""
        supa = _settings(LOCAL_DATABASE_URL=LOCAL_URL_EXAMPLE)
        local = _settings(
            DATABASE_PROVIDER="local", LOCAL_DATABASE_URL=LOCAL_URL_EXAMPLE
        )
        assert supa.effective_database_url != local.effective_database_url


class TestMigrationUrl:
    """GATE 4."""

    def test_defaults_to_the_runtime_connection(self) -> None:
        assert _settings().effective_migration_url == SUPABASE_URL_EXAMPLE

    def test_can_be_overridden_independently(self) -> None:
        migration = SUPABASE_URL_EXAMPLE.replace(":5432", ":5432") + "?options=x"
        settings = _settings(MIGRATION_DATABASE_URL=migration)
        assert settings.effective_migration_url == migration
        assert settings.effective_database_url == SUPABASE_URL_EXAMPLE

    def test_migration_url_follows_provider_not_a_stale_local_db(self) -> None:
        """Alembic must never migrate local while the app serves Supabase."""
        settings = _settings(LOCAL_DATABASE_URL=LOCAL_URL_EXAMPLE)
        assert "localhost" not in settings.effective_migration_url


class TestRedaction:
    """GATE 12 - credentials must not reach logs or responses."""

    def test_redact_url_strips_credentials(self) -> None:
        red = redact_url(
            "postgresql+psycopg://postgres.abc:s3cr3t-p@ss@host.supabase.com:5432/postgres"
        )
        assert red is not None
        assert "s3cr3t" not in red
        assert "***@" in red

    def test_redact_url_keeps_host_for_diagnostics(self) -> None:
        red = redact_url(SUPABASE_URL_EXAMPLE)
        assert red is not None
        assert "aws-0-ap-south-1.pooler.supabase.com:5432/postgres" in red

    def test_redact_url_handles_none(self) -> None:
        assert redact_url(None) is None

    def test_safe_dump_redacts_secret_key(self) -> None:
        dumped = _settings(SECRET_KEY="super-secret-value").safe_dump()
        assert dumped["SECRET_KEY"] == "***redacted***"
        assert "super-secret-value" not in str(dumped)

    def test_safe_dump_redacts_database_password(self) -> None:
        dumped = _settings(
            DATABASE_URL=(
                "postgresql+psycopg://postgres.abc:hunter2@"
                "aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
            )
        ).safe_dump()
        assert "hunter2" not in str(dumped)

    def test_safe_dump_redacts_anon_key(self) -> None:
        dumped = _settings(SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9").safe_dump()
        assert "eyJhbGci" not in str(dumped)

    def test_safe_dump_reports_provider(self) -> None:
        assert _settings().safe_dump()["DATABASE_PROVIDER"] == "supabase"


class TestCorsParsing:
    def test_comma_separated_string_becomes_list(self) -> None:
        settings = _settings(CORS_ORIGINS="http://a.test, http://b.test")
        assert settings.CORS_ORIGINS == ["http://a.test", "http://b.test"]

    def test_wildcard_is_not_a_default(self) -> None:
        """Credentialed CORS with "*" is invalid; it must never be the default."""
        assert "*" not in _settings().CORS_ORIGINS
