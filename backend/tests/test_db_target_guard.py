"""The refusal matrix: proof that an unsafe target is never dialled.

WHAT THIS TESTS, AND WHY IT IS NOT `assert check_url(...) is not None`

Asserting that a pure helper returns a reason proves the helper. It does not
prove the suite consults it, that the consultation happens before a socket is
opened, or that the sync engines bypass it. The incident this file exists for
was not a wrong helper - it was a correct intention with no wiring.

So every case here builds a REAL SQLAlchemy engine and asks it for a real
connection, with `psycopg.connect` and `psycopg.AsyncConnection.connect`
replaced by tripwires that raise if they are ever reached. A refusal that lets
the driver run would fail these tests even though the exception type looks
right.

The remote URLs are synthetic: `.invalid` never resolves (RFC 6761) and the
shared Supabase host appears nowhere in this file. Proving the guard refuses a
shared database does not require contacting one.
"""

import asyncio

import psycopg
import pytest
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine

from tests import db_target

SYNTHETIC_REMOTE = (
    "postgresql+psycopg://u:p@db.synthetic-shared.invalid:5432/postgres"
)
ISOLATED = (
    "postgresql+psycopg://ner_test:p@127.0.0.1:55432/ner_logistics_test"
)


@pytest.fixture(autouse=True)
def dial_tripwire(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Explode if anything reaches the driver, and record that it happened.

    This is the measurement. `UnsafeTestTarget` being raised somewhere is only
    interesting if it was raised INSTEAD of connecting, and the sole way to
    know that is to make connecting itself observable.
    """
    dialled: list[str] = []

    def _boom(*args: object, **kwargs: object) -> None:
        dialled.append("dialled")
        raise AssertionError(
            "A connection reached psycopg. The guard let an unsafe target "
            "through, or ran too late to matter."
        )

    monkeypatch.setattr(psycopg, "connect", _boom)
    monkeypatch.setattr(psycopg.AsyncConnection, "connect", _boom)
    return dialled


def _connect_sync(url: str, **kw: object) -> None:
    engine = create_engine(url, **kw)
    try:
        engine.connect()
    finally:
        engine.dispose()


def _connect_async(url: str, **kw: object) -> None:
    async def go() -> None:
        engine = create_async_engine(url, **kw)
        try:
            await engine.connect()
        finally:
            await engine.dispose()

    asyncio.run(go())


class TestRefusesUnsafeTargets:
    """Each case: refused, and zero connection attempts."""

    def test_unarmed_run_with_remote_fallback(self, dial_tripwire: list) -> None:
        """The incident itself: `.env` resolves to a shared remote database."""
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(SYNTHETIC_REMOTE)
        assert dial_tripwire == []

    def test_provider_local_with_remote_resolved_url(
        self, dial_tripwire: list
    ) -> None:
        """`DATABASE_PROVIDER=local` is a label, and the label is not checked.

        The guard never reads the provider setting, so a run calling itself
        local while resolving to a remote URL is refused on the URL.
        """
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(SYNTHETIC_REMOTE)
        assert dial_tripwire == []

    def test_a_different_local_database_is_still_refused(
        self, dial_tripwire: list
    ) -> None:
        """`backend/.env`'s own LOCAL_DATABASE_URL, which is not this database.

        localhost:5432/ner_logistics is as local as an address gets and is the
        wrong cluster, the wrong port and the wrong database. "It said local"
        is why this check is exact rather than a heuristic.
        """
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync("postgresql+psycopg://ner:p@localhost:5432/ner_logistics")
        assert dial_tripwire == []

    def test_right_host_wrong_port(self, dial_tripwire: list) -> None:
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(
                "postgresql+psycopg://ner_test:p@127.0.0.1:5432/ner_logistics_test"
            )
        assert dial_tripwire == []

    def test_right_port_wrong_database(self, dial_tripwire: list) -> None:
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(
                "postgresql+psycopg://ner_test:p@127.0.0.1:55432/ner_logistics"
            )
        assert dial_tripwire == []

    def test_tunnel_forwarding_a_remote_port_to_loopback(
        self, dial_tripwire: list
    ) -> None:
        """An SSH tunnel presents the remote database on 127.0.0.1.

        Only the exact registered port distinguishes it, which is the argument
        against ever relaxing this to "any loopback address".
        """
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(
                "postgresql+psycopg://u:p@127.0.0.1:15432/ner_logistics_test"
            )
        assert dial_tripwire == []

    def test_hostname_containing_the_word_local(
        self, dial_tripwire: list
    ) -> None:
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(
                "postgresql+psycopg://u:p@db-local.synthetic.invalid:55432/"
                "ner_logistics_test"
            )
        assert dial_tripwire == []

    def test_connect_args_host_override_beats_a_safe_looking_url(
        self, dial_tripwire: list
    ) -> None:
        """The case a URL-only check cannot see.

        The URL reads exactly like the permitted target. `connect_args` then
        replaces the host on the way to the driver. Because the veto runs on
        the final merged parameters rather than on the configured string, the
        override is what gets judged.
        """
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(
                ISOLATED,
                connect_args={"host": "db.synthetic-shared.invalid"},
            )
        assert dial_tripwire == []

    def test_url_query_argument_host_override(self, dial_tripwire: list) -> None:
        """Same hole, reached through the URL's own query string instead."""
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(f"{ISOLATED}?host=db.synthetic-shared.invalid")
        assert dial_tripwire == []

    def test_the_async_engine_obeys_the_same_policy(
        self, dial_tripwire: list
    ) -> None:
        """The application's own engine type, not just the sync one."""
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_async(SYNTHETIC_REMOTE)
        assert dial_tripwire == []

    def test_no_override_environment_variable_exists(
        self, monkeypatch: pytest.MonkeyPatch, dial_tripwire: list
    ) -> None:
        """The removed escape hatch, asserted gone rather than assumed gone.

        `ALLOW_SHARED_DB_TESTS=1` used to turn the protection off. Setting it
        now changes nothing, and this test is what keeps somebody from
        reintroducing a variable that would look helpful in a hurry.
        """
        monkeypatch.setenv("ALLOW_SHARED_DB_TESTS", "1")
        with pytest.raises(db_target.UnsafeTestTarget):
            _connect_sync(SYNTHETIC_REMOTE)
        assert dial_tripwire == []


class TestRefusalMessages:
    """A refusal ends up in logs and handoffs. It must not carry a credential."""

    def test_message_names_the_target_without_the_credential(self) -> None:
        reason = db_target.check_url(
            "postgresql+psycopg://secretuser:secretpassword@"
            "db.synthetic-shared.invalid:5432/postgres"
        )
        assert reason is not None
        assert "db.synthetic-shared.invalid" in reason
        assert "secretpassword" not in reason
        assert "secretuser" not in reason

    def test_missing_url_is_refused_rather_than_defaulted(self) -> None:
        """The absence of configuration must not resolve to backend/.env."""
        assert db_target.check_url(None) is not None
        assert db_target.check_url("") is not None

    def test_unparseable_url_is_refused(self) -> None:
        assert db_target.check_url("not a database url") is not None


class TestAllowsTheIsolatedTarget:
    """The guard has to permit the one target, or it is merely an outage."""

    def test_the_registered_target_passes_the_url_check(self) -> None:
        assert db_target.check_url(ISOLATED) is None

    def test_the_registered_target_reaches_the_driver(
        self, dial_tripwire: list
    ) -> None:
        """Permitted means the connection proceeds to psycopg.

        The tripwire raises `AssertionError`, which is the success signal here:
        it says the veto returned control and the driver was reached. Any
        `UnsafeTestTarget` instead would mean the guard blocks its own database.
        """
        with pytest.raises(AssertionError, match="reached psycopg"):
            _connect_sync(ISOLATED)
        assert dial_tripwire == ["dialled"]
