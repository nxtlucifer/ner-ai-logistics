"""No fixture loader may write to a database somebody would miss.

WHAT THIS DEFENDS

`tests/db_target.py` vetoes the connection the pytest suite opens. It cannot
help anything outside the suite - a seed script, a demo reset, a one-off run
from a shell that happens to have `DATABASE_PROVIDER=supabase` exported.
Those reach the database through the ordinary application engine, which is
what they are supposed to do, so there is no veto in their path.

`assert_disposable` is the guard for them, and these are its tests. The
important one is the last: there is no flag that turns it off, because an
override is how a guard becomes a comment.
"""

import pytest

from app.core import disposable
from app.core.disposable import NotDisposable, assert_disposable, is_disposable

LOCAL = "postgresql+psycopg://u:p@127.0.0.1:55432/ner_logistics_test"
LOCALHOST = "postgresql+psycopg://u:p@localhost:5432/anything"
HOSTED = (
    "postgresql+psycopg://postgres.znaveeefzgfxsblsobdb:pw"
    "@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
)


class TestWhatIsDisposable:
    def test_the_isolated_test_cluster_is(self):
        assert is_disposable(LOCAL)

    def test_any_local_host_is(self):
        assert is_disposable(LOCALHOST)

    def test_supabase_is_not(self):
        assert not is_disposable(HOSTED)

    def test_an_unreadable_url_is_not(self):
        """Fails closed. A URL this cannot parse is not evidence of a local
        database; it is evidence that nobody knows where the writes go."""
        assert not is_disposable("not a url at all")
        assert not is_disposable("")

    def test_a_password_full_of_punctuation_does_not_confuse_it(self):
        """The bug that made this worth testing: `urlsplit` returned the
        USERNAME as the host for a password containing a slash, so a guard
        reading it could not tell local from remote."""
        awkward = "postgresql+psycopg://ner_test:p/a?s#s@127.0.0.1:55432/db"
        assert is_disposable(awkward)


class TestTheRefusal:
    def test_a_hosted_target_is_refused_by_name(self):
        with pytest.raises(NotDisposable) as caught:
            assert_disposable("the demo seeder", HOSTED)
        message = str(caught.value)
        assert "the demo seeder" in message
        assert "supabase.com" in message
        # And it says what to do instead, or the next person disables it.
        assert "use-isolated-db" in message

    def test_a_local_target_passes_silently(self):
        assert assert_disposable("the demo seeder", LOCAL) is None


class TestThereIsNoWayRound:
    def test_no_remote_host_is_allowed_by_default(self):
        """Every entry in this set is a database automated writes can
        reach. It should stay empty."""
        assert disposable.ALLOWED_REMOTE_HOSTS == frozenset()

    def test_the_guard_takes_no_override(self):
        """An override flag is how a guard becomes a comment: somebody sets
        it once to get through an afternoon and it stays set. Adding one
        should fail this test and make somebody argue for it in review."""
        import inspect

        # Scan the CODE, not the prose: the module explains at length why
        # it has no override, and a naive text search flags its own
        # explanation.
        lines = inspect.getsource(disposable).splitlines()
        code = "\n".join(
            line for line in lines if not line.lstrip().startswith(("#", '"', "'"))
        )
        for escape in ("os.getenv", "os.environ", "getenv(", "FORCE_"):
            assert escape not in code, (
                f"{escape!r} appeared in the disposable guard - if this is a "
                "deliberate, reviewed exception, update this test with the reason"
            )
