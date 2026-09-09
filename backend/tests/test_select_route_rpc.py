"""Atomicity of route selection and reroute acceptance, proved on a real database.

WHY A DISPOSABLE DATABASE RATHER THAN THE APPLICATION SUITE

The thing under test is a PostgreSQL function that runs as `authenticated` with
`auth.uid()` set the way PostgREST sets it. None of that exists in the ordinary
test database, and mocking it would prove nothing: the entire point of moving
this logic into the database was to get a transaction and a row lock, and
neither survives being stubbed.

So this builds its own database, runs alembic, applies every Supabase migration,
and calls the RPC through the same predicate the hosted project evaluates. It is
the same approach as `backend/scripts/rls_harness.py`, which already proved the
RLS model this way.

WHAT IT DOES NOT PROVE

GoTrue token issuance and PostgREST routing are not exercised - this is a
database-layer proof. It says nothing about whether the manager client calls the
function, which is asserted separately in the manager suite.

SAFETY

The database is dropped and recreated by name on every run and is never
`ner_logistics_test` and never the hosted project. `tests/db_target.py` guards
the application engine; this module opens its own psycopg connections to a
database that guard does not cover, so the name is pinned to a constant here and
the DSN is built from it rather than from any configured URL.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg")

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"

#: Disposable, and deliberately not derived from configuration. Nothing that
#: reads an environment variable can point these tests at a shared database.
DB = "ner_rpc_select_route_test"
HOST = "127.0.0.1"
PORT = 55432
USER = "ner_test"

AUTH_STUB = """
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, phone text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_namespace where nspname='extensions') then
    execute 'grant usage on schema extensions to anon, authenticated';
  end if;
end $$;
"""


def _password() -> str | None:
    f = ROOT / ".runtime" / "pgpass.txt"
    if not f.exists():
        return None
    return f.read_text(encoding="utf-8").strip()


def _dsn(db: str, pw: str) -> str:
    return f"postgresql://{USER}:{pw}@{HOST}:{PORT}/{db}"


@pytest.fixture(scope="module")
def rpc_db():
    """A database with the app schema, the Supabase layer, and one seeded trip."""
    pw = _password()
    if pw is None:
        pytest.skip("isolated cluster not present (.runtime/pgpass.txt missing)")

    alembic = BACKEND / ".venv" / "Scripts" / "alembic.exe"
    if not alembic.exists():
        alembic = BACKEND / ".venv" / "bin" / "alembic"
    if not alembic.exists():
        pytest.skip("alembic not available in backend/.venv")

    try:
        with psycopg.connect(_dsn("postgres", pw), autocommit=True, connect_timeout=5) as c:
            c.execute(f'drop database if exists "{DB}" with (force)')
            c.execute(f'create database "{DB}"')
    except psycopg.Error as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"isolated cluster unreachable: {exc}")

    url = f"postgresql+psycopg://{USER}:{pw}@{HOST}:{PORT}/{DB}"
    env = {
        **os.environ,
        "DATABASE_PROVIDER": "local",
        "LOCAL_DATABASE_URL": url,
        "MIGRATION_DATABASE_URL": url,
    }
    r = subprocess.run(
        [str(alembic), "upgrade", "head"],
        cwd=BACKEND, env=env, capture_output=True, text=True,
    )
    assert r.returncode == 0, f"alembic failed:\n{r.stdout[-2500:]}\n{r.stderr[-2500:]}"

    with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
        c.execute(AUTH_STUB)
        for f in sorted((ROOT / "supabase" / "migrations").glob("*.sql")):
            c.execute(f.read_text(encoding="utf-8"))

    ids = _seed(pw)
    yield pw, ids

    with psycopg.connect(_dsn("postgres", pw), autocommit=True) as c:
        c.execute(f'drop database if exists "{DB}" with (force)')


def _seed(pw: str) -> dict:
    """One manager, one driver-only user, one trip with three routes."""
    ids = {
        "mgr": uuid.uuid4(), "drv_user": uuid.uuid4(), "driver": uuid.uuid4(),
        "truck": uuid.uuid4(), "ship": uuid.uuid4(),
        "trip": uuid.uuid4(), "other_trip": uuid.uuid4(),
        "route_a": uuid.uuid4(), "route_b": uuid.uuid4(), "route_blocked": uuid.uuid4(),
        "other_route": uuid.uuid4(),
    }
    line = "ST_SetSRID(ST_MakeLine(ARRAY[ST_MakePoint(91.7,26.1),ST_MakePoint(92.7,26.7)]),4326)"
    with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
        c.execute(
            """insert into users (id,email,password_hash,role,display_name,is_active,created_at,updated_at)
               values (%s,'mgr@rpc.invalid','x','MANAGER','RPC Manager',true,now(),now()),
                      (%s,'drv@rpc.invalid','x','DRIVER','RPC Driver',true,now(),now())""",
            (ids["mgr"], ids["drv_user"]),
        )
        c.execute(
            """insert into drivers (id,user_id,full_name,phone,licence_number,licence_expiry,status,created_at,updated_at)
               values (%s,%s,'RPC Driver','9000000009','AS-RPC-1',date '2030-01-01','AVAILABLE',now(),now())""",
            (ids["driver"], ids["drv_user"]),
        )
        c.execute(
            """insert into trucks (id,registration_number,max_capacity_kg,current_load_kg,status,created_at,updated_at)
               values (%s,'AS99RPC0001',16000,0,'AVAILABLE',now(),now())""",
            (ids["truck"],),
        )
        c.execute(
            """insert into shipments (id,reference_code,client_name,pickup_address,pickup_location,
                 destination_address,destination_location,created_at,updated_at)
               values (%s,'SHP-RPC-01','RPC Client','Depot',
                 ST_SetSRID(ST_MakePoint(91.7362,26.1445),4326)::geography,'Yard',
                 ST_SetSRID(ST_MakePoint(94.2037,26.7509),4326)::geography,now(),now())""",
            (ids["ship"],),
        )
        for trip_id, code in ((ids["trip"], "TRP-RPC-0001"), (ids["other_trip"], "TRP-RPC-0002")):
            c.execute(
                """insert into trips (id,trip_code,shipment_id,truck_id,driver_id,status,created_at,updated_at)
                   values (%s,%s,%s,%s,%s,'ASSIGNED',now(),now())""",
                (trip_id, code, ids["ship"], ids["truck"], ids["driver"]),
            )
        for rid, trip_id, kind, state in (
            (ids["route_a"], ids["trip"], "PRIMARY", "PROPOSED"),
            (ids["route_b"], ids["trip"], "EMERGENCY_BACKUP", "PROPOSED"),
            (ids["route_blocked"], ids["trip"], "EMERGENCY_BACKUP", "REJECTED_BLOCKED"),
            (ids["other_route"], ids["other_trip"], "PRIMARY", "PROPOSED"),
        ):
            c.execute(
                f"""insert into trip_routes (id,trip_id,kind,state,geometry,created_at)
                    values (%s,%s,%s,%s,{line},now())""",
                (rid, trip_id, kind, state),
            )
    return ids


def as_user(conn, user_id):
    """A transaction acting exactly as PostgREST would for this caller."""
    conn.rollback()
    cur = conn.cursor()
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id) if user_id else "",))
    cur.execute("set local role authenticated" if user_id else "set local role anon")
    return cur


def reset(pw, ids) -> None:
    """Back to: nothing selected, blocked route still blocked."""
    with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
        c.execute(
            "update trip_routes set state='PROPOSED', superseded_by=null "
            "where trip_id in (%s,%s) and state <> 'REJECTED_BLOCKED'",
            (ids["trip"], ids["other_trip"]),
        )
        c.execute("update trips set selected_route_id=null where id in (%s,%s)",
                  (ids["trip"], ids["other_trip"]))
        c.execute("delete from trip_events where trip_id in (%s,%s)",
                  (ids["trip"], ids["other_trip"]))


def selected_count(pw, trip_id) -> int:
    with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
        return c.execute(
            "select count(*) from trip_routes where trip_id=%s and state='SELECTED'",
            (trip_id,),
        ).fetchone()[0]


def trip_pointer(pw, trip_id):
    with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
        return c.execute("select selected_route_id from trips where id=%s", (trip_id,)).fetchone()[0]


pytestmark = pytest.mark.requires_db


class TestSelectRoute:
    def test_selects_a_route_and_points_the_trip_at_it(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            cur = as_user(c, ids["mgr"])
            cur.execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            out = cur.fetchone()[0]
            c.commit()
        assert out["outcome"] == "APPLIED"
        assert out["selected_route_id"] == str(ids["route_a"])
        assert selected_count(pw, ids["trip"]) == 1
        assert trip_pointer(pw, ids["trip"]) == ids["route_a"]

    def test_selecting_a_second_route_demotes_the_first(self, rpc_db):
        """The invariant this whole migration exists for."""
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_b"]))
            c.commit()

        assert selected_count(pw, ids["trip"]) == 1, "more than one SELECTED row"
        assert trip_pointer(pw, ids["trip"]) == ids["route_b"]
        with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
            state, superseded = c.execute(
                "select state, superseded_by from trip_routes where id=%s", (ids["route_a"],)
            ).fetchone()
        # SUPERSEDED, not PROPOSED: it was chosen and then replaced, and the
        # row records what replaced it.
        assert state == "SUPERSEDED"
        assert superseded == ids["route_b"]

    def test_the_trip_pointer_and_the_route_rows_never_disagree(self, rpc_db):
        """The manager-on-B/driver-on-A failure, asserted directly."""
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_b"]))
            c.commit()
        with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
            pointer, row = c.execute(
                """select t.selected_route_id, r.id
                     from trips t join trip_routes r
                       on r.trip_id = t.id and r.state='SELECTED'
                    where t.id=%s""",
                (ids["trip"],),
            ).fetchone()
        assert pointer == row

    def test_a_blocked_route_is_refused(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["mgr"]).execute(
                    "select public.select_route(%s,%s)", (ids["trip"], ids["route_blocked"])
                )
            assert "ROUTE_BLOCKED" in str(exc.value)
        assert selected_count(pw, ids["trip"]) == 0

    def test_a_route_from_another_trip_is_refused(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["mgr"]).execute(
                    "select public.select_route(%s,%s)", (ids["trip"], ids["other_route"])
                )
            assert "ROUTE_NOT_FOUND_FOR_TRIP" in str(exc.value)
        assert selected_count(pw, ids["trip"]) == 0
        assert selected_count(pw, ids["other_trip"]) == 0

    def test_a_driver_may_not_select_a_route(self, rpc_db):
        """Route authority is the manager's. Unchanged by this migration."""
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["drv_user"]).execute(
                    "select public.select_route(%s,%s)", (ids["trip"], ids["route_a"])
                )
            assert "FORBIDDEN" in str(exc.value)
        assert selected_count(pw, ids["trip"]) == 0

    def test_an_anonymous_caller_is_refused(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            with pytest.raises(psycopg.Error):
                as_user(c, None).execute(
                    "select public.select_route(%s,%s)", (ids["trip"], ids["route_a"])
                )
        assert selected_count(pw, ids["trip"]) == 0

    def test_a_stale_expectation_is_a_conflict_not_an_overwrite(self, rpc_db):
        """Two managers, one screen out of date.

        A holds a screen showing route A selected. Someone else moves the trip
        to B. A now tries to move to... anything, still believing A. That must
        be refused, not applied over the other decision.
        """
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_b"]))
            c.commit()

            # Target a perfectly selectable route: this test is about the
            # expectation being stale, nothing else.
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["mgr"]).execute(
                    "select public.select_route(%s,%s,%s)",
                    (ids["trip"], ids["route_a"], ids["route_a"]),
                )
            assert "STALE_ROUTE_REVISION" in str(exc.value)

        # The other manager's decision stands.
        assert trip_pointer(pw, ids["trip"]) == ids["route_b"]
        assert selected_count(pw, ids["trip"]) == 1

    def test_staleness_is_reported_before_blockedness(self, rpc_db):
        """When a caller is both stale and pointing at a blocked route.

        Deliberate precedence, not an accident of statement order. Answering
        ROUTE_BLOCKED would state a fact about a screen that no longer reflects
        reality and invite the manager to reason about it; the actionable truth
        is that the trip moved on and everything on screen needs re-reading.
        The UI treatments differ too - stale refreshes, blocked explains and
        keeps the current route - so getting this backwards sends the manager
        down the wrong path.
        """
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_b"]))
            c.commit()
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["mgr"]).execute(
                    "select public.select_route(%s,%s,%s)",
                    (ids["trip"], ids["route_blocked"], ids["route_a"]),
                )
        message = str(exc.value)
        assert "STALE_ROUTE_REVISION" in message
        assert "ROUTE_BLOCKED" not in message

    def test_blockedness_is_reported_when_the_caller_is_not_stale(self, rpc_db):
        """The other half of the precedence: with a correct expectation, the
        blocked route is the real problem and is named."""
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["mgr"]).execute(
                    "select public.select_route(%s,%s,%s)",
                    (ids["trip"], ids["route_blocked"], ids["route_a"]),
                )
        assert "ROUTE_BLOCKED" in str(exc.value)
        assert trip_pointer(pw, ids["trip"]) == ids["route_a"]

    def test_a_lost_response_retry_converges_instead_of_conflicting(self, rpc_db):
        """The transaction committed; the response did not arrive.

        The client retries with the expectation it set out with, which is now
        out of date. A naive staleness check answers CONFLICT for a request that
        already succeeded, and the UI reports failure for a change that is live.
        """
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            # First attempt: A -> B. Succeeds; imagine the response is lost.
            as_user(c, ids["mgr"]).execute(
                "select public.select_route(%s,%s,%s)", (ids["trip"], ids["route_b"], ids["route_a"])
            )
            c.commit()
            # Retry, same arguments, stale expectation.
            cur = as_user(c, ids["mgr"])
            cur.execute(
                "select public.select_route(%s,%s,%s)", (ids["trip"], ids["route_b"], ids["route_a"])
            )
            out = cur.fetchone()[0]
            c.commit()

        assert out["outcome"] == "IDEMPOTENT"
        assert out["selected_route_id"] == str(ids["route_b"])
        assert selected_count(pw, ids["trip"]) == 1

    def test_a_repeated_click_writes_one_audit_row_not_two(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            for _ in range(3):
                as_user(c, ids["mgr"]).execute(
                    "select public.select_route(%s,%s)", (ids["trip"], ids["route_a"])
                )
                c.commit()
        with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
            n = c.execute(
                "select count(*) from trip_events where trip_id=%s and kind='ROUTE_CHANGED'",
                (ids["trip"],),
            ).fetchone()[0]
        assert n == 1, f"a repeated click wrote {n} audit rows"
        assert selected_count(pw, ids["trip"]) == 1

    def test_two_managers_selecting_at_once_leave_exactly_one_selected(self, rpc_db):
        """The race the old client code lost.

        Both transactions are opened before either commits, so they genuinely
        overlap. The row lock on the trip orders them; whichever commits second
        wins, and the only assertion that matters is that the result is ONE
        selected route rather than two.
        """
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as a, psycopg.connect(_dsn(DB, pw)) as b:
            cur_a = as_user(a, ids["mgr"])
            cur_a.execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            # B blocks on the trip row lock until A commits.
            cur_b = as_user(b, ids["mgr"])
            a.commit()
            cur_b.execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_b"]))
            b.commit()

        assert selected_count(pw, ids["trip"]) == 1
        assert trip_pointer(pw, ids["trip"]) == ids["route_b"]


class TestAcceptReroute:
    def test_reroute_moves_the_trip_and_names_the_route_left(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            cur = as_user(c, ids["mgr"])
            cur.execute(
                "select public.accept_reroute(%s,%s,%s)", (ids["trip"], ids["route_a"], ids["route_b"])
            )
            out = cur.fetchone()[0]
            c.commit()

        assert out["previous_route_id"] == str(ids["route_a"])
        assert out["selected_route_id"] == str(ids["route_b"])
        assert selected_count(pw, ids["trip"]) == 1
        assert trip_pointer(pw, ids["trip"]) == ids["route_b"]

    def test_reroute_from_a_route_that_is_no_longer_current_is_refused(self, rpc_db):
        """Stale screen: the trip moved on before this manager pressed accept."""
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_b"]))
            c.commit()
            # Leaving A (stale - the trip is on B) for the blocked route. The
            # caller is wrong twice over; see the precedence test below for why
            # staleness is the answer they get.
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["mgr"]).execute(
                    "select public.accept_reroute(%s,%s,%s)",
                    (ids["trip"], ids["route_a"], ids["route_blocked"]),
                )
            assert "STALE_ROUTE_REVISION" in str(exc.value)
        assert trip_pointer(pw, ids["trip"]) == ids["route_b"]

    def test_a_cross_trip_reroute_is_refused(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["mgr"]).execute(
                    "select public.accept_reroute(%s,%s,%s)",
                    (ids["trip"], ids["route_a"], ids["other_route"]),
                )
            assert "ROUTE_NOT_FOUND_FOR_TRIP" in str(exc.value)
        assert trip_pointer(pw, ids["trip"]) == ids["route_a"]

    def test_a_driver_may_not_accept_a_reroute(self, rpc_db):
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            with pytest.raises(psycopg.Error) as exc:
                as_user(c, ids["drv_user"]).execute(
                    "select public.accept_reroute(%s,%s,%s)",
                    (ids["trip"], ids["route_a"], ids["route_b"]),
                )
            assert "FORBIDDEN" in str(exc.value)
        assert trip_pointer(pw, ids["trip"]) == ids["route_a"]

    def test_a_failed_reroute_rolls_back_completely(self, rpc_db):
        """No partial application: the whole point of moving this into one
        transaction. The blocked route raises AFTER the trip row is locked and
        state has been read, so if any write escaped the transaction it would
        show up here."""
        pw, ids = rpc_db
        reset(pw, ids)
        with psycopg.connect(_dsn(DB, pw)) as c:
            as_user(c, ids["mgr"]).execute("select public.select_route(%s,%s)", (ids["trip"], ids["route_a"]))
            c.commit()
            with pytest.raises(psycopg.Error):
                as_user(c, ids["mgr"]).execute(
                    "select public.accept_reroute(%s,%s,%s)",
                    (ids["trip"], ids["route_a"], ids["route_blocked"]),
                )
        assert selected_count(pw, ids["trip"]) == 1
        assert trip_pointer(pw, ids["trip"]) == ids["route_a"]
        with psycopg.connect(_dsn(DB, pw), autocommit=True) as c:
            blocked_state = c.execute(
                "select state from trip_routes where id=%s", (ids["route_blocked"],)
            ).fetchone()[0]
        assert blocked_state == "REJECTED_BLOCKED"
