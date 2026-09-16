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

#: Which identity provider mints the tokens this service accepts. See the
#: AUTH_PROVIDER setting below for what each value means.
AuthProvider = Literal["local", "supabase"]


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

    # --- Rate limiting (authentication endpoints only) ---
    #
    # Applied per route as a dependency, never as global middleware, so GPS
    # ingestion cannot be caught by it - see app/core/rate_limit.py.
    #
    # Defaults are generous enough that a person fumbling a password on a hill
    # road at night is not locked out, and tight enough that Argon2's ~100 ms
    # cost is no longer the only thing standing between an exposed login
    # endpoint and unlimited guessing.
    RATE_LIMIT_ENABLED: bool = True
    #: Attempts per window, per client address, across all identifiers.
    LOGIN_RATE_LIMIT_PER_IP: int = 20
    #: Attempts per window for one identifier, from anywhere. Lower, because
    #: this is the limit a distributed attack on a single account meets.
    LOGIN_RATE_LIMIT_PER_IDENTIFIER: int = 10
    #: Refresh is a legitimate background operation - two tabs, an app resuming,
    #: a token expiring mid-task - so this bounds abuse without tripping on
    #: ordinary use.
    REFRESH_RATE_LIMIT_PER_IP: int = 60
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # --- Routing providers ---
    #
    # The chain is primary -> fallback. The fallback is a keyless OSRM endpoint
    # so routing works with no credential at all; the primary slot is for a
    # provider with an actual service level, because the public OSRM demo server
    # states plainly that it gives no quality guarantee and that access "shall be
    # withdrawn at any time and without giving a reason" - which is not something
    # to discover during a demo.
    #
    # There is deliberately NO ROUTING_PRIMARY_KEY setting. A keyed provider
    # needs a provider class that knows where that provider puts its
    # credential - a header, a query parameter, a bearer token - and those
    # differ per vendor. A setting that accepted a key and then sent it nowhere
    # would be worse than its absence: someone would configure it, see routing
    # work through the keyless fallback, and believe the key was in use.
    #
    # The abstraction is the point: adding a keyed provider means writing one
    # class against `RoutingProvider` and adding it to `build_chain`. When that
    # happens the credential is a BACKEND secret and must never take a VITE_ or
    # EXPO_PUBLIC_ prefix, since those are inlined into client bundles.
    #
    # ROUTING_PRIMARY_URL works today for any OSRM-compatible endpoint that
    # needs no credential - a self-hosted instance, for example.
    ROUTING_PRIMARY_URL: str | None = None
    ROUTING_FALLBACK_URL: str = "https://router.project-osrm.org"
    ROUTING_TIMEOUT_SECONDS: float = 8.0
    #: ON by default, and the comment here previously said "off by default"
    #: while the value said True - the kind of contradiction that makes a
    #: config file untrustworthy to read. The value is the correct one: route
    #: planning is a feature of the product, not an opt-in.
    #:
    #: A test run does not depend on anyone's uptime regardless, because the
    #: tests replace the provider chain rather than reaching the network (see
    #: tests/test_route_api.py). Setting this to False is for an offline demo,
    #: and it makes /routes/recalculate answer 422 ROUTING_DISABLED rather than
    #: hang against an unreachable provider.
    ROUTING_ENABLED: bool = True

    # --- Weather provider ---
    #
    # Open-Meteo needs NO API key for non-commercial use, so there is no
    # WEATHER_PROVIDER_KEY here for the same reason there is no
    # ROUTING_PRIMARY_KEY: a setting that accepted a credential and sent it
    # nowhere would be worse than its absence. Commercial use would need a
    # keyed provider class, and that key would be a BACKEND secret - never a
    # VITE_ or EXPO_PUBLIC_ prefix, which are inlined into client bundles.
    WEATHER_PROVIDER_URL: str = "https://api.open-meteo.com"
    #: Shorter than routing's 8 s. Route risk fans out to several requests, and
    #: a dispatcher waiting on a risk panel is a worse experience than one told
    #: promptly that conditions are unknown.
    WEATHER_TIMEOUT_SECONDS: float = 6.0
    #: MET Norway, tried when Open-Meteo answers 429 or is down. Empty = no fallback.
    WEATHER_FALLBACK_URL: str = "https://api.met.no"

    # --- Address search (Google Places API (New)) ---
    #
    # Unlike ROUTING_PRIMARY_KEY and WEATHER_PROVIDER_KEY, this key setting DOES
    # exist, because unlike those there is a provider written to receive it
    # (`app/services/geocoding.py`) and the credential goes somewhere. Absent is
    # the supported default: address search reports itself unavailable and the
    # manager plans with the map picker instead.
    #
    # It is deliberately NOT a VITE_ variable. Vite inlines those into the
    # browser bundle; this must stay server-side.
    GOOGLE_PLACES_API_KEY: str | None = None
    GEOCODING_TIMEOUT_SECONDS: float = 6.0

    # --- Local AI ---
    #
    # One model, three surfaces (`app/services/inference.py`). The default host
    # is loopback and non-loopback is refused unless deliberately allowed,
    # because pointing this at a hosted endpoint would silently send a driver's
    # trip context off the machine while everything still appeared to work.
    AI_ENABLED: bool = True
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    AI_MODEL: str = "llama3.2:3b"
    AI_ALLOW_NON_LOCAL_HOST: bool = False
    #: Short: this only decides whether to show the AI panel at all.
    AI_STATUS_TIMEOUT_SECONDS: float = 2.0
    #: Generous: a 3B model on a CPU laptop is slow, and a timeout that fires
    #: mid-answer looks like a bug rather than a slow machine.
    AI_TIMEOUT_SECONDS: float = 60.0
    #: Bounds on what may be sent and returned. An unbounded local decode on a
    #: shared laptop starves the GPS ingestion path.
    AI_MAX_PROMPT_CHARS: int = 4000
    AI_MAX_OUTPUT_TOKENS: int = 200

    # --- Gemini Developer API (Server Proxy) ---
    GEMINI_API_KEY: str | None = None
    #: The lite model answered in 1-3 s where flash-latest returned 503 "overloaded" from Render's egress (13 Sep).
    GEMINI_MODEL: str = "gemini-flash-lite-latest"
    GEMINI_TIMEOUT_SECONDS: float = 8.0
    GEMINI_MAX_OUTPUT_TOKENS: int = 512
    GEMINI_RPM_LIMIT: int = 10
    #: Second online provider, tried when Gemini is down, rate-limited or slow.
    #: Free-tier models by default (0 credits on the demo account); a comma
    #: list, first healthy one wins. Reasoning is disabled per request so a
    #: thinking model does not leak its scratchpad into the answer.
    OPENROUTER_API_KEY: str | None = None
    OPENROUTER_MODELS: str = "nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3.5-lightning:free,google/gemma-4-26b-a4b-it:free"
    OPENROUTER_TIMEOUT_SECONDS: float = 12.0

    #: Off makes route risk return with weather NOT_AVAILABLE rather than
    #: reaching the network - for an offline demo, and for tests that must not
    #: depend on anyone's uptime.
    WEATHER_ENABLED: bool = True

    # --- Terrain (DEM) ---
    #
    # Same host and same no-key terms as weather: Open-Meteo's elevation
    # endpoint serves Copernicus DEM GLO-90. It reuses WEATHER_PROVIDER_URL and
    # WEATHER_TIMEOUT_SECONDS on purpose - one provider, one budget. Off makes
    # the terrain factor report NOT_AVAILABLE rather than reach the network.
    TERRAIN_ENABLED: bool = True

    # SameSite for the HttpOnly refresh cookie: "strict" (default) when the
    # manager web and this API share a site, "none" when they are on
    # different sites (Render: ner-manager.onrender.com vs
    # ner-intelligence.onrender.com). "none" is only honoured with `secure`,
    # which every non-development environment sets; CSRF exposure is limited
    # to /api/auth/refresh, whose response a cross-origin page cannot read.
    REFRESH_COOKIE_SAMESITE: Literal["strict", "lax", "none"] = "strict"
    # Elevation fallback when an Open-Meteo batch fails (quota, outage):
    # OpenTopoData SRTM 30 m, no key, 1 req/s, 1,000/day. Empty = no fallback.
    TERRAIN_FALLBACK_URL: str = "https://api.opentopodata.org"

    # --- River discharge context (GloFAS via Open-Meteo, no key) ---
    #
    # Daily discharge for the corridor's river cells, compared with their own
    # 30-day mean. Context for the risk engine, never a flood warning - see
    # app/domain/flood.py. Off makes the factor NOT_AVAILABLE.
    FLOOD_ENABLED: bool = True
    FLOOD_PROVIDER_URL: str = "https://flood-api.open-meteo.com"

    # --- Official warnings (NDMA SACHET CAP, public RSS) ---
    #
    # Alerts are placed by the district names in their CAP `areaDesc`; the
    # districts a route crosses come from Nominatim reverse geocoding (one
    # request per second, cached per route). See app/domain/warnings.py.
    WARNINGS_ENABLED: bool = True
    WARNINGS_FEED_URL: str = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml"
    WARNINGS_FEED_TTL_SECONDS: int = 600
    #: Poll the NDMA feed in the background at the TTL above (bounded: one
    #: request per TTL). Off in tests and local dev; on for the hosted API.
    WARNINGS_POLL_ENABLED: bool = False
    NOMINATIM_URL: str = "https://nominatim.openstreetmap.org"

    # --- Demo simulation (services/simulation.py): synthetic, labelled evidence ---
    DEMO_SIMULATION_ENABLED: bool = False

    # --- Driver push (Expo Push API) ---
    #: The relay is free and needs no key; EXPO_ACCESS_TOKEN only when the
    #: Expo project has "enhanced push security" on. Off in tests.
    PUSH_ENABLED: bool = True
    EXPO_ACCESS_TOKEN: str | None = None
    PUSH_TIMEOUT_SECONDS: float = 8.0

    # --- Route-ahead intelligence worker (services/route_watch.py) ---
    #: Coordinator tick; providers are asked at most once per trip per REFRESH.
    ROUTE_WATCH_ENABLED: bool = False
    ROUTE_WATCH_TICK_SECONDS: int = 60
    ROUTE_WATCH_REFRESH_SECONDS: int = 600

    # --- Fleet Sentinel Scheduler ---
    SENTINEL_SCHEDULER_ENABLED: bool = False
    SENTINEL_SWEEP_INTERVAL_SECONDS: int = 300

    # --- Database provider ---
    DATABASE_PROVIDER: DatabaseProvider = "supabase"

    # Supabase runtime connection. Required when DATABASE_PROVIDER=supabase.
    # No default: a hardcoded connection string in source is a credential leak,
    # and a default would also mean a misconfigured deployment quietly starts
    # against the wrong database.
    DATABASE_URL: str | None = None
    #: SMS gateway for driver fallback messages. None = no gateway integrated:
    #: Diagnostics reads NOT_CONFIGURED and no code path pretends to send.
    SMS_PROVIDER: str | None = None

    # Optional separate connection for Alembic. Defaults to DATABASE_URL.
    # Kept configurable because Supabase offers several pooling modes and DDL has
    # different requirements from request-path traffic - see docs/ARCHITECTURE.md.
    MIGRATION_DATABASE_URL: str | None = None

    # Optional local WSL2 PostgreSQL. Used ONLY when DATABASE_PROVIDER=local.
    LOCAL_DATABASE_URL: str | None = None

    # --- Supabase project (non-secret identifiers) ---
    SUPABASE_URL: str | None = None
    # Publishable/anon key. Safe for clients by design. The manager web app and
    # the driver APK now hold their own Supabase session and talk to Supabase
    # directly for operational state, so this service does not need it.
    SUPABASE_ANON_KEY: str | None = None

    # --- Identity provider ---
    #
    # `local`    - this service issues and verifies its own JWTs. The original
    #              single-backend deployment.
    # `supabase` - callers authenticate against Supabase Auth and present a
    #              Supabase access token. This is what a hosted deployment of
    #              the intelligence plane (routing / accessibility / navigation)
    #              runs, because the clients hold a Supabase session and never
    #              one of ours.
    #
    # Authorization is unaffected either way: roles are always read from our
    # `users` table, never from the token. See app/auth/verifier.py.
    AUTH_PROVIDER: AuthProvider = "local"

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
