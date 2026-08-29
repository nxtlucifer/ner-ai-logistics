"""Application configuration.

Every value is loaded from the environment. Nothing sensitive has a default, and
the application refuses to start rather than guessing a database.

DATABASE PROVIDER MODEL
-----------------------
Supabase is the primary database. A local WSL2 PostgreSQL remains available as an
explicitly-selected offline fallback, never as an automatic one.

    DATABASE_PROVIDER=supabase  ->  uses DATABASE_URL       (must be a Supabase host)
    DATABASE_PROVIDER=local     ->  uses LOCAL_DATABASE_URL (must be a local host)

There is deliberately NO code path that lets Supabase mode fall back to a local
database. Silently connecting to a stale local copy when the real database is
unreachable would let the application appear healthy while serving the wrong
data - a far worse failure than an honest outage.

See docs/ARCHITECTURE.md section 10 and docs/SECURITY.md section 5.
"""

from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# The value shipped in .env.example. Refusing it explicitly means copying the
# example file and forgetting to change the key fails loudly rather than silently
# signing tokens with a value that is published in the repository.
PLACEHOLDER_SECRET = "change-me-generate-a-real-key"

REQUIRED_DRIVER = "postgresql+psycopg://"

# Hosts that indicate a database on this machine rather than a managed one.
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}

DatabaseProvider = Literal["supabase", "local"]


def _host_of(url: str) -> str:
    """Extract the hostname from a SQLAlchemy URL, without its credentials."""
    try:
        # urlsplit needs a scheme it recognises; the SQLAlchemy driver suffix
        # ("+psycopg") is fine here because only the netloc is being read.
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def redact_url(url: str | None) -> str | None:
    """Reduce a connection URL to scheme, host, port and database.

    Credentials are stripped entirely. Used for logging and for the /ready
    payload, so a password can never reach a log file or an HTTP response.
    """
    if not url:
        return None
    try:
        parts = urlsplit(url)
        host = parts.hostname or "?"
        port = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://***@{host}{port}{parts.path}"
    except ValueError:
        return "***unparseable-url-redacted***"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Application ---
    APP_NAME: str = "NER Fleet Intelligence API"
    APP_ENV: Literal["development", "test", "staging", "production"] = "development"
    DEBUG: bool = False
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000

    # --- Security ---
    SECRET_KEY: str = Field(
        default=PLACEHOLDER_SECRET,
        description="Token signing key. Must be overridden outside development.",
    )
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # --- Database provider ---
    DATABASE_PROVIDER: DatabaseProvider = "supabase"

    # Supabase runtime connection. Required when DATABASE_PROVIDER=supabase.
    # No default: a hardcoded connection string in source is a credential leak,
    # and a default would also mean a misconfigured deployment quietly starts
    # against the wrong database.
    DATABASE_URL: str | None = None

    # Optional separate connection for Alembic. Defaults to DATABASE_URL.
    # Kept configurable because Supabase offers several pooling modes and DDL has
    # different requirements from request-path traffic - see docs/ARCHITECTURE.md.
    MIGRATION_DATABASE_URL: str | None = None

    # Optional local WSL2 PostgreSQL. Used ONLY when DATABASE_PROVIDER=local.
    LOCAL_DATABASE_URL: str | None = None

    # --- Supabase project (non-secret identifiers) ---
    SUPABASE_URL: str | None = None
    # Publishable/anon key. Safe for clients by design, but not needed yet - the
    # clients talk to FastAPI, never to Supabase directly.
    SUPABASE_ANON_KEY: str | None = None

    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_ECHO: bool = False
    # Readiness must fail fast. Without a short timeout a down database leaves
    # /ready hanging on the default TCP timeout instead of answering 503.
    DB_CONNECT_TIMEOUT_SECONDS: int = 5
    # Supabase terminates TLS; require it rather than letting psycopg negotiate
    # down to plaintext.
    DB_REQUIRE_SSL: bool = True

    # --- CORS ---
    # Explicit origins only. Never "*" alongside credentials.
    #
    # NoDecode is required, not cosmetic: for any complex field type,
    # pydantic-settings JSON-decodes the raw environment value BEFORE field
    # validators run. A plain comma-separated CORS_ORIGINS in .env would fail
    # with a JSONDecodeError before _split_origins ever saw it. NoDecode hands
    # the raw string to the validator instead.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("DATABASE_URL", "MIGRATION_DATABASE_URL", "LOCAL_DATABASE_URL")
    @classmethod
    def _require_psycopg_driver(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if not v.startswith(REQUIRED_DRIVER):
            raise ValueError(
                f"Database URLs must use the {REQUIRED_DRIVER} driver (psycopg3). "
                f"Got: {v.split('://', 1)[0]}://"
            )
        return v

    @model_validator(mode="after")
    def _reject_placeholder_secret(self) -> "Settings":
        if self.APP_ENV != "development" and self.SECRET_KEY == PLACEHOLDER_SECRET:
            raise ValueError(
                f"SECRET_KEY is still the placeholder from .env.example while "
                f"APP_ENV={self.APP_ENV}. Generate one with: "
                "python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )
        return self

    @model_validator(mode="after")
    def _validate_provider_selection(self) -> "Settings":
        """Ensure the selected provider has a usable URL, and only its own URL.

        This is the guard that makes "no silent fallback" a structural property
        rather than a convention.
        """
        if self.DATABASE_PROVIDER == "supabase":
            if not self.DATABASE_URL:
                raise ValueError(
                    "DATABASE_PROVIDER=supabase requires DATABASE_URL. "
                    "Set it to the Supabase session-pooler connection string in "
                    "backend/.env. The application will not fall back to a local "
                    "database."
                )
            host = _host_of(self.DATABASE_URL)
            if host in LOCAL_HOSTS:
                raise ValueError(
                    f"DATABASE_PROVIDER=supabase but DATABASE_URL points at "
                    f"'{host}', which is a local address. Either set a Supabase "
                    "connection string, or switch to DATABASE_PROVIDER=local to "
                    "use LOCAL_DATABASE_URL deliberately."
                )
        else:  # local
            if not self.LOCAL_DATABASE_URL:
                raise ValueError(
                    "DATABASE_PROVIDER=local requires LOCAL_DATABASE_URL. "
                    "Start the local database with scripts\\db-start.ps1 first."
                )
        return self

    # --- Derived values ---

    @property
    def effective_database_url(self) -> str:
        """The one URL the application actually connects to.

        Selected purely by DATABASE_PROVIDER. There is no fallback branch here by
        design - see the module docstring.
        """
        if self.DATABASE_PROVIDER == "supabase":
            assert self.DATABASE_URL is not None  # guaranteed by the validator
            return self.DATABASE_URL
        assert self.LOCAL_DATABASE_URL is not None  # guaranteed by the validator
        return self.LOCAL_DATABASE_URL

    @property
    def effective_migration_url(self) -> str:
        """Connection Alembic uses. Defaults to the runtime connection."""
        return self.MIGRATION_DATABASE_URL or self.effective_database_url

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"

    @property
    def requires_ssl(self) -> bool:
        """Local development databases do not serve TLS; managed ones must."""
        return self.DB_REQUIRE_SSL and self.DATABASE_PROVIDER != "local"

    def safe_dump(self) -> dict[str, object]:
        """Config for logging, with every credential redacted.

        Startup logging must never print SECRET_KEY, and database URLs carry a
        password in their userinfo, so they are reduced to host/database only.
        """
        return {
            "APP_NAME": self.APP_NAME,
            "APP_ENV": self.APP_ENV,
            "DEBUG": self.DEBUG,
            "API_HOST": self.API_HOST,
            "API_PORT": self.API_PORT,
            "DATABASE_PROVIDER": self.DATABASE_PROVIDER,
            "DATABASE_URL": redact_url(self.effective_database_url),
            "MIGRATION_DATABASE_URL": redact_url(self.effective_migration_url),
            "SUPABASE_URL": self.SUPABASE_URL or "(not set)",
            "SUPABASE_ANON_KEY": "***redacted***"
            if self.SUPABASE_ANON_KEY
            else "(not set)",
            "REQUIRES_SSL": self.requires_ssl,
            "CORS_ORIGINS": self.CORS_ORIGINS,
            "SECRET_KEY": "***redacted***",
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
