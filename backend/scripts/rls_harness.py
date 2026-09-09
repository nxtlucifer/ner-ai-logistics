"""Prove the Supabase RLS model on a disposable local database.

WHY THIS EXISTS

`supabase start` needs Docker, which this machine does not have, so the hosted
stack cannot be run locally. What CAN be reproduced faithfully is the part that
actually decides security: PostgREST connects as the `authenticated` role and
sets `request.jwt.claim.sub` to the caller's id, and `auth.uid()` reads exactly
that GUC. Both are recreated here verbatim, so a policy that passes this harness
is being evaluated by the same predicate the hosted project will evaluate.

WHAT IT DOES NOT PROVE

GoTrue token issuance, PostgREST request routing, Realtime authorisation and
Edge Function auth are NOT exercised. This is a database-layer proof only, and
the report says so. A test that runs as `service_role`, or as the owner, proves
nothing about RLS at all - the owner bypasses it - so every assertion below runs
after SET ROLE authenticated.

Disposable by construction: it drops and recreates its own database and never
touches ner_logistics_test or the hosted project.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
PG = ROOT / ".runtime" / "pg" / "pgsql" / "bin"
DB = "ner_supabase_rls_test"
ADMIN_DSN = "postgresql://ner_test:{pw}@127.0.0.1:55432/postgres"
TEST_DSN = "postgresql://ner_test:{pw}@127.0.0.1:55432/" + DB

# Supabase's own auth.uid(), copied so the predicate under test is identical.
AUTH_STUB = """
create schema if not exists auth;
-- Minimal shape of the columns app.identity_status() reads.
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
-- PostGIS lives in `extensions` on the hosted project and in `public` here, so
-- this grant is conditional rather than assumed.
do $$ begin
  if exists (select 1 from pg_namespace where nspname='extensions') then
    execute 'grant usage on schema extensions to anon, authenticated';
  end if;
end $$;
"""

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  -> ' + detail) if detail and not ok else ''}")


def password() -> str:
    return (ROOT / ".runtime" / "pgpass.txt").read_text(encoding="utf-8").strip()


def as_user(conn: psycopg.Connection, user_id: str | None):
    """Start a fresh transaction acting exactly as PostgREST would for this caller.

    MUST be called for EVERY statement. `rollback()` reverts `SET ROLE` back to
    the session user, and the session user OWNS these tables - owners bypass RLS
    entirely. An earlier version of this harness set the role once per block and
    reported four false results because every statement after the first rollback
    silently ran as the owner.
    """
    conn.rollback()
    cur = conn.cursor()
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (user_id or "",))
    cur.execute("set local role authenticated" if user_id else "set local role anon")
    return cur


def denied(conn: psycopg.Connection, user_id: str | None, sql: str, label: str) -> None:
    """Assert a statement is refused for this caller."""
    try:
        as_user(conn, user_id).execute(sql)
        check(label, False, "statement succeeded")
    except psycopg.Error as e:
        check(label, True, str(e).splitlines()[0])
    finally:
        conn.rollback()


def main() -> int:
    pw = password()
    admin, test = ADMIN_DSN.format(pw=pw), TEST_DSN.format(pw=pw)

    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f'drop database if exists "{DB}" with (force)')
        c.execute(f'create database "{DB}"')
    print(f"created disposable database {DB}")

    env = {**os.environ, "DATABASE_PROVIDER": "local",
           "LOCAL_DATABASE_URL": f"postgresql+psycopg://ner_test:{pw}@127.0.0.1:55432/{DB}",
           "MIGRATION_DATABASE_URL": f"postgresql+psycopg://ner_test:{pw}@127.0.0.1:55432/{DB}"}
    r = subprocess.run([str(BACKEND / ".venv/Scripts/alembic.exe"), "upgrade", "head"],
                       cwd=BACKEND, env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print("alembic failed:\n", r.stdout[-3000:], r.stderr[-3000:])
        return 1
    print("alembic upgrade head: OK")

    with psycopg.connect(test, autocommit=True) as c:
        c.execute(AUTH_STUB)
        for f in sorted((ROOT / "supabase" / "migrations").glob("*.sql")):
            c.execute(f.read_text(encoding="utf-8"))
            print(f"applied {f.name}")

    # ---- seed: one manager, two drivers, a truck, a trip for driver A -------
    mgr, ua, ub = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    drv_a, drv_b, truck, trip, ship = (uuid.uuid4() for _ in range(5))
    with psycopg.connect(test, autocommit=True) as c:
        c.execute("""
          insert into users (id,email,password_hash,role,display_name,is_active,created_at,updated_at) values
            (%s,'mgr@rls.invalid','x','MANAGER','RLS Manager',true,now(),now()),
            (%s,'a@rls.invalid','x','DRIVER','RLS Driver A',true,now(),now()),
            (%s,'b@rls.invalid','x','DRIVER','RLS Driver B',true,now(),now())
        """, (mgr, ua, ub))
        c.execute("""
          insert into drivers (id,user_id,full_name,phone,licence_number,licence_expiry,status,created_at,updated_at) values
            (%s,%s,'RLS Driver A','9000000001','AS-RLS-A',date '2030-01-01','AVAILABLE',now(),now()),
            (%s,%s,'RLS Driver B','9000000002','AS-RLS-B',date '2030-01-01','AVAILABLE',now(),now())
        """, (drv_a, ua, drv_b, ub))
        c.execute("""insert into trucks (id,registration_number,max_capacity_kg,current_load_kg,status,created_at,updated_at)
                     values (%s,'AS99RLS0001',16000,0,'AVAILABLE',now(),now())""", (truck,))
        c.execute("""insert into shipments (id,reference_code,client_name,pickup_address,pickup_location,
                       destination_address,destination_location,created_at,updated_at)
                     values (%s,'STEST-RLS-01','RLS Client','Depot, Guwahati',
                       ST_SetSRID(ST_MakePoint(91.7362,26.1445),4326)::geography,'Yard, Jorhat',
                       ST_SetSRID(ST_MakePoint(94.2037,26.7509),4326)::geography,now(),now())""", (ship,))
        c.execute("""insert into trips (id,trip_code,shipment_id,truck_id,driver_id,status,created_at,updated_at)
                     values (%s,'TRP-RLS-0001',%s,%s,%s,'ASSIGNED',now(),now())""", (trip, ship, truck, drv_a))
    print("seeded 1 manager, 2 drivers, 1 truck, 1 trip (driver A)\n")

    with psycopg.connect(test) as c:
        # --- anonymous: tables are NON-empty, so 0 rows means the policy bit ---
        for tbl, seeded in (("trips", 1), ("drivers", 2), ("users", 3), ("shipments", 1)):
            try:
                cur = as_user(c, None)
                cur.execute(f"select count(*) from public.{tbl}")
                n = cur.fetchone()[0]
                check(f"anon reads 0 of {seeded} {tbl}", n == 0, f"read {n}")
            except psycopg.Error as e:
                check(f"anon reads 0 of {seeded} {tbl}", True, str(e).splitlines()[0])
            finally:
                c.rollback()

        # --- row scoping -----------------------------------------------------
        cur = as_user(c, str(ua)); cur.execute("select count(*) from public.trips")
        check("driver A sees exactly their 1 trip", cur.fetchone()[0] == 1)
        cur = as_user(c, str(ub)); cur.execute("select count(*) from public.trips")
        check("driver B sees 0 trips (not theirs)", cur.fetchone()[0] == 0)
        cur = as_user(c, str(mgr)); cur.execute("select count(*) from public.trips")
        check("manager sees the trip (trip:read)", cur.fetchone()[0] == 1)
        cur = as_user(c, str(ub)); cur.execute("select count(*) from public.drivers")
        check("driver B sees only their own driver row", cur.fetchone()[0] == 1)
        cur = as_user(c, str(ub)); cur.execute("select count(*) from public.users")
        check("driver B sees only their own user row", cur.fetchone()[0] == 1)
        cur = as_user(c, str(mgr)); cur.execute("select count(*) from public.drivers")
        check("manager still sees the whole roster", cur.fetchone()[0] == 2)
        c.rollback()

        # --- column-level: password_hash must never leave the row ------------
        denied(c, str(mgr), "select password_hash from public.users limit 1",
               "password_hash is not selectable even by a manager")
        denied(c, str(ua), "select base_salary_monthly from public.drivers limit 1",
               "driver salary is not selectable")

        # --- direct writes are refused; guarded functions are the only path --
        denied(c, str(ua), "update public.trips set status='ACTIVE'",
               "driver cannot UPDATE trip status directly")
        denied(c, str(ua), f"update public.trips set driver_id='{drv_b}'",
               "driver cannot reassign a trip directly")
        denied(c, str(ua), f"update public.users set role='ADMIN' where id='{ua}'",
               "driver cannot self-promote role")
        denied(c, str(ua), "delete from public.trips",
               "driver cannot DELETE a trip")
        denied(c, str(ua),
               "insert into public.gps_points (trip_id,driver_id,truck_id,location,device_fix_id,"
               f"recorded_at,received_at,is_mock_location) values ('{trip}','{drv_a}','{truck}',"
               "ST_SetSRID(ST_MakePoint(91.7,26.1),4326)::geography,gen_random_uuid(),now(),now(),false)",
               "driver cannot INSERT gps_points directly")
        denied(c, str(mgr), "update public.trips set status='CLOSED'",
               "manager cannot UPDATE trips directly either")

        # --- guarded accept --------------------------------------------------
        cur = as_user(c, str(ua))
        cur.execute("select (app.accept_trip()).driver_accepted_at")
        first = cur.fetchone()[0]
        check("driver A can accept via app.accept_trip()", first is not None)
        cur.execute("select (app.accept_trip()).driver_accepted_at")
        check("second accept is idempotent (same timestamp)", cur.fetchone()[0] == first)
        cur.execute("select count(*) from public.trip_events where kind='ACCEPTED'")
        check("idempotent accept writes exactly one ACCEPTED event", cur.fetchone()[0] == 1)
        c.commit()

        denied(c, str(ub), f"select app.accept_trip('{trip}')",
               "driver B cannot accept driver A's trip")
        denied(c, str(mgr), "select app.accept_trip()",
               "manager cannot use the driver accept path")
        denied(c, None, "select app.accept_trip()",
               "anon cannot accept a trip")

        # --- location submission --------------------------------------------
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set status='ACTIVE', started_at=now() where id=%s", (trip,))

        cur = as_user(c, str(ua))
        fix = uuid.uuid4()
        cur.execute("select app.submit_location(26.14, 91.73, %s::uuid)", (fix,))
        gid = cur.fetchone()[0]
        check("driver A can submit a location for their active trip", gid is not None)
        cur.execute("select app.submit_location(26.14, 91.73, %s::uuid)", (fix,))
        check("replaying the same device_fix_id is idempotent", cur.fetchone()[0] == gid)
        cur.execute("select count(*) from public.gps_points")
        check("the replay stored exactly one point", cur.fetchone()[0] == 1)
        c.commit()

        denied(c, str(ub), "select app.submit_location(26.14, 91.73, gen_random_uuid())",
               "driver B cannot submit a location (no active trip)")
        denied(c, str(ua), "select app.submit_location(26.14, 91.73, gen_random_uuid(), now() + interval '1 hour')",
               "a future-dated fix is rejected")
        denied(c, str(ua), "select app.submit_location(999, 91.73, gen_random_uuid())",
               "an out-of-range coordinate is rejected")

        cur = as_user(c, str(ub)); cur.execute("select count(*) from public.gps_points")
        check("driver B cannot read driver A's locations", cur.fetchone()[0] == 0)
        cur = as_user(c, str(mgr)); cur.execute("select count(*) from public.gps_points")
        check("manager can read locations (fleet:location_read)", cur.fetchone()[0] == 1)
        c.rollback()

        # --- batch location parity with GpsBatchAccepted ---------------------
        import json as _json
        def _fix(lat, lon, when="now"):
            return {"device_fix_id": str(uuid.uuid4()),
                    "location": {"lat": lat, "lon": lon},
                    "recorded_at": when}
        batch = [_fix(26.10, 91.70), _fix(26.11, 91.71), _fix(26.12, 91.72)]
        cur = as_user(c, str(ua))
        cur.execute("select app.submit_location_batch(%s::jsonb)", (_json.dumps(batch),))
        r = cur.fetchone()[0]
        check("batch of 3 new fixes -> accepted 3", (r["accepted"], r["duplicates_ignored"], r["rejected"]) == (3, 0, 0), str(r))
        c.commit()

        cur = as_user(c, str(ua))
        cur.execute("select app.submit_location_batch(%s::jsonb)", (_json.dumps(batch),))
        r = cur.fetchone()[0]
        check("replayed batch -> 3 duplicates, 0 accepted",
              (r["accepted"], r["duplicates_ignored"], r["rejected"]) == (0, 3, 0), str(r))
        c.commit()

        # One bad fix must not discard the good ones: a queue flushed after an
        # hour offline will always contain some now-unacceptable fixes.
        mixed = [_fix(26.20, 91.80), _fix(26.21, 91.81, "2999-01-01T00:00:00Z"), _fix(26.22, 91.82)]
        cur = as_user(c, str(ua))
        cur.execute("select app.submit_location_batch(%s::jsonb)", (_json.dumps(mixed),))
        r = cur.fetchone()[0]
        check("one bad fix does not abort the batch (2 accepted, 1 rejected)",
              (r["accepted"], r["rejected"]) == (2, 1), str(r))
        check("rejection reason is a structured code, not a raw message",
              isinstance(r["rejected_reasons"], dict) and len(r["rejected_reasons"]) == 1, str(r["rejected_reasons"]))
        c.commit()

        denied(c, str(ub), "select app.submit_location_batch('[]'::jsonb)",
               "driver B cannot submit a batch (no active trip)")
        # The hole the earlier version had: an EMPTY batch never entered the loop,
        # so a non-driver got a 200 back from a delegated authorization check.
        denied(c, str(mgr), "select app.submit_location_batch('[]'::jsonb)",
               "manager cannot call the batch entrypoint (empty array)")
        denied(c, None, "select app.submit_location_batch('[]'::jsonb)",
               "anon cannot call the batch entrypoint (empty array)")

        # --- the public RPC surface PostgREST can actually reach ------------
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set driver_accepted_at=null, driver_accepted_by=null where id=%s", (trip,))
        cur = as_user(c, str(ua))
        cur.execute("select (public.accept_trip()).driver_accepted_at")
        check("driver reaches the guarded accept through public.accept_trip()", cur.fetchone()[0] is not None)
        c.commit()
        denied(c, str(mgr), "select public.accept_trip()",
               "public wrapper does not weaken the guard (manager refused)")
        denied(c, None, "select public.accept_trip()",
               "public wrapper does not weaken the guard (anon refused)")
        cur = as_user(c, str(ua))
        cur.execute("select public.submit_location_batch('[]'::jsonb)")
        check("driver reaches submit_location_batch through the public wrapper",
              cur.fetchone()[0]["accepted"] == 0)
        c.rollback()
        # Policy internals must NOT be reachable as RPC.
        for fn in ("app.has_perm('trip:read')", "app.is_fleet_staff()", "app.identity_status()"):
            denied(c, str(ua), f"select public.{fn.split('.')[1]}",
                   f"policy internal not exposed in public: {fn.split('(')[0]}")

        # --- start gate: the whole blocker matrix, in order ------------------
        # Reset to a clean ASSIGNED trip with no assignment row.
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set status='ASSIGNED', started_at=null where id=%s", (trip,))
            owner.execute("delete from driver_truck_assignments where driver_id=%s", (drv_a,))
            owner.execute("update trucks set status='AVAILABLE' where id=%s", (truck,))
            owner.execute("update drivers set status='AVAILABLE' where id=%s", (drv_a,))

        def gate(user):
            cur = as_user(c, str(user))
            cur.execute("select blocked_code, blocked_reason from app.start_gate()")
            return cur.fetchone()

        code, _ = gate(ua)
        check("no assignment -> NO_ACTIVE_ASSIGNMENT", code == 'NO_ACTIVE_ASSIGNMENT', str(code))
        denied(c, str(ua), "select app.start_trip()", "start refused while unassigned")

        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("""insert into driver_truck_assignments (id,driver_id,truck_id,status,assigned_at)
                             values (gen_random_uuid(),%s,%s,'PENDING_VERIFICATION',now())""", (drv_a, truck))
        code, reason = gate(ua)
        check("unverified assignment -> ASSIGNMENT_NOT_VERIFIED", code == 'ASSIGNMENT_NOT_VERIFIED', str(code))
        check("blocker reason is the driver-facing sentence",
              reason == 'Check the truck before starting the trip.', str(reason))
        denied(c, str(ua), "select app.start_trip()", "start refused while the truck is unverified")

        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update driver_truck_assignments set status='ACTIVE', verified_at=now() where driver_id=%s", (drv_a,))
            owner.execute("update trucks set status='BREAKDOWN' where id=%s", (truck,))
        code, _ = gate(ua)
        check("broken-down truck -> TRUCK_NOT_OPERATIONAL", code == 'TRUCK_NOT_OPERATIONAL', str(code))
        denied(c, str(ua), "select app.start_trip()", "start refused on a broken-down truck")

        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trucks set status='AVAILABLE' where id=%s", (truck,))
        code, _ = gate(ua)
        check("all prerequisites met -> no blocker", code is None, str(code))

        # The gate is the read side of the same rule the write enforces.
        cur = as_user(c, str(ua))
        cur.execute("select (app.start_trip()).status")
        check("driver starts the trip -> ACTIVE", cur.fetchone()[0] == 'ACTIVE')
        c.commit()
        cur = as_user(c, str(ua))
        cur.execute("select (app.start_trip()).started_at")
        first_start = cur.fetchone()[0]
        cur.execute("select (app.start_trip()).started_at")
        check("second start is idempotent (same started_at)", cur.fetchone()[0] == first_start)
        cur.execute("select count(*) from public.trip_events where kind='STARTED'")
        check("idempotent start writes exactly one STARTED event", cur.fetchone()[0] == 1)
        c.commit()

        with psycopg.connect(test, autocommit=True) as owner:
            dstat = owner.execute("select status from drivers where id=%s", (drv_a,)).fetchone()[0]
            tstat = owner.execute("select status from trucks where id=%s", (truck,)).fetchone()[0]
        check("driver and truck moved to ON_TRIP", (dstat, tstat) == ('ON_TRIP', 'ON_TRIP'), f"{dstat}/{tstat}")

        # A manager who deliberately parked the driver OFF_DUTY must not be
        # silently overwritten by a start.
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set status='ASSIGNED', started_at=null where id=%s", (trip,))
            owner.execute("delete from trip_events where kind='STARTED'")
            owner.execute("update drivers set status='OFF_DUTY' where id=%s", (drv_a,))
            owner.execute("update trucks set status='AVAILABLE' where id=%s", (truck,))
        cur = as_user(c, str(ua))
        cur.execute("select (app.start_trip()).status")
        cur.execute("select status from public.drivers where id=%s", (drv_a,))
        check("a deliberate OFF_DUTY driver is not overwritten by start",
              cur.fetchone()[0] == 'OFF_DUTY')
        c.commit()

        denied(c, str(ub), "select app.start_trip()", "driver B cannot start driver A's trip")
        denied(c, str(mgr), "select app.start_gate()", "manager cannot read the driver start gate")
        denied(c, None, "select public.start_trip()", "anon cannot start a trip")
        cur = as_user(c, str(ua))
        cur.execute("select blocked_code from public.start_gate()")
        check("start gate is reachable through the public wrapper", cur.fetchone() is not None)
        c.rollback()

        # --- composed driver trip payload ------------------------------------
        import json as _pj
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set status='ASSIGNED', started_at=null, selected_route_id=null where id=%s", (trip,))
            # A known blocker, so the assertion below tests the payload rather
            # than whatever the previous block left behind.
            owner.execute("update driver_truck_assignments set verified_at=null where driver_id=%s", (drv_a,))
            owner.execute("delete from trip_stops where trip_id=%s", (trip,))
            owner.execute("""insert into trip_stops (id,trip_id,sequence,kind,status,name,address,location)
                             values (gen_random_uuid(),%s,1,'PICKUP','COMPLETED','Depot','Depot, Guwahati',
                                     ST_SetSRID(ST_MakePoint(91.7362,26.1445),4326)::geography),
                                    (gen_random_uuid(),%s,2,'DROPOFF','PENDING','Yard','Yard, Jorhat',
                                     ST_SetSRID(ST_MakePoint(94.2037,26.7509),4326)::geography)""", (trip, trip))

        cur = as_user(c, str(ua))
        cur.execute("select app.driver_trip_payload()")
        p = cur.fetchone()[0]
        check("payload returns the driver's own trip", p is not None and p["trip_code"] == "TRP-RLS-0001")
        check("stops come back in sequence order",
              [s["sequence"] for s in p["stops"]] == [1, 2], str([s["sequence"] for s in p["stops"]]))
        check("next actionable stop is the first unsettled one",
              p["next_stop_id"] == [s for s in p["stops"] if s["status"] == "PENDING"][0]["id"])
        check("stop location is [lat, lon], not GeoJSON [lon, lat]",
              abs(p["stops"][0]["location"][0] - 26.1445) < 1e-6
              and abs(p["stops"][0]["location"][1] - 91.7362) < 1e-6, str(p["stops"][0]["location"]))
        check("truck summary is embedded", p["truck"]["registration_number"] == "AS99RLS0001")
        check("tracking config matches telemetry_policy",
              p["tracking"] == {"moving_interval_seconds": 10, "stationary_interval_seconds": 60,
                                "stationary_distance_m": 30, "batch_size": 6,
                                "queue_limit": 500, "fresh_seconds": 90}, str(p["tracking"]))
        check("can_start is false while the gate blocks", p["can_start"] is False, str(p["can_start"]))
        check("the payload carries the gate's own blocker verbatim",
              p["start_blocked_code"] == "ASSIGNMENT_NOT_VERIFIED"
              and p["start_blocked_reason"] == "Check the truck before starting the trip.",
              str(p["start_blocked_code"]))
        c.rollback()

        # A route the driver is actually on, so geometry is emitted.
        with psycopg.connect(test, autocommit=True) as owner:
            route = owner.execute("""insert into trip_routes (id,trip_id,kind,state,geometry,distance_km,
                                       estimated_duration_min,routing_provider,created_at)
                                     values (gen_random_uuid(),%s,'PRIMARY','SELECTED',
                                       ST_SetSRID(ST_GeomFromText('LINESTRING(91.7362 26.1445, 92.0 26.18, 94.2037 26.7509)'),4326)::geography,
                                       305.4, 420, 'osrm', now()) returning id""", (trip,)).fetchone()[0]
            owner.execute("update trips set selected_route_id=%s where id=%s", (route, trip))
            # Earlier blocks stored fixes for this trip; clear them so the
            # "no position yet" path is actually the one under test.
            owner.execute("delete from gps_points where trip_id=%s", (trip,))

        cur = as_user(c, str(ua))
        cur.execute("select app.driver_trip_payload()")
        p = cur.fetchone()[0]
        geo = p["_progress_input"]["geometry"]
        check("route geometry is emitted as [lat, lon] vertices in order",
              len(geo) == 3 and abs(geo[0][0] - 26.1445) < 1e-6 and abs(geo[0][1] - 91.7362) < 1e-6
              and abs(geo[2][0] - 26.7509) < 1e-6, str(geo))
        check("provider distance and duration travel with the geometry",
              float(p["_progress_input"]["plannedDistanceKm"]) == 305.4
              and p["_progress_input"]["plannedDurationMin"] == 420, str(p["_progress_input"]))
        check("no position yet -> progress input position is null",
              p["_progress_input"]["position"] is None)
        check("last_fix is null before any fix", p["last_fix"] is None)
        c.rollback()

        # Start the trip and submit a fix, so freshness and position appear.
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set status='ACTIVE', started_at=now() where id=%s", (trip,))
            owner.execute("update driver_truck_assignments set verified_at=now() where driver_id=%s", (drv_a,))
        cur = as_user(c, str(ua))
        cur.execute("select app.submit_location(26.18, 92.0, gen_random_uuid())")
        c.commit()
        cur = as_user(c, str(ua))
        cur.execute("select app.driver_trip_payload()")
        p = cur.fetchone()[0]
        check("position reaches the progress input as [lat, lon]",
              abs(p["_progress_input"]["position"][0] - 26.18) < 1e-6
              and abs(p["_progress_input"]["position"][1] - 92.0) < 1e-6, str(p["_progress_input"]["position"]))
        check("a just-received fix is LIVE", p["last_fix"]["freshness"] == "LIVE", str(p["last_fix"]))
        check("tracking_expected is true once the trip is in progress", p["tracking_expected"] is True)
        check("an in-progress trip reports no start blocker",
              p["start_blocked_code"] is None and p["start_blocked_reason"] is None)
        c.rollback()

        # driver_accepted_at must not be inherited by a different driver.
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set driver_accepted_at=now(), driver_accepted_by=%s where id=%s", (drv_b, trip))
        cur = as_user(c, str(ua))
        cur.execute("select app.driver_trip_payload()")
        check("acceptance by another driver is NOT reported to this one",
              cur.fetchone()[0]["driver_accepted_at"] is None)
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set driver_accepted_by=%s where id=%s", (drv_a, trip))
        cur = as_user(c, str(ua))
        cur.execute("select app.driver_trip_payload()")
        check("this driver's own acceptance IS reported",
              cur.fetchone()[0]["driver_accepted_at"] is not None)
        c.rollback()

        cur = as_user(c, str(ub))
        cur.execute("select app.driver_trip_payload()")
        check("driver B gets null, not driver A's trip", cur.fetchone()[0] is None)
        denied(c, str(mgr), "select app.driver_trip_payload()",
               "manager cannot use the driver trip payload")
        denied(c, None, "select public.driver_trip_payload()",
               "anon cannot read the driver trip payload")
        cur = as_user(c, str(ua))
        cur.execute("select public.driver_trip_payload()")
        check("payload is reachable through the public wrapper", cur.fetchone()[0] is not None)
        c.rollback()

        # --- full driver journey: verify -> start -> stops -> complete --------
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("update trips set status='ASSIGNED', started_at=null, delivered_at=null where id=%s", (trip,))
            owner.execute("update driver_truck_assignments set verified_at=null, mismatch_flagged=false, status='PENDING_VERIFICATION' where driver_id=%s", (drv_a,))
            owner.execute("update trip_stops set status='PENDING', actual_arrival_at=null, actual_departure_at=null where trip_id=%s", (trip,))
            owner.execute("update drivers set status='AVAILABLE' where id=%s", (drv_a,))
            owner.execute("update trucks set status='AVAILABLE' where id=%s", (truck,))
            stop_ids = [r[0] for r in owner.execute(
                "select id from trip_stops where trip_id=%s order by sequence", (trip,)).fetchall()]

        # verification
        cur = as_user(c, str(ua))
        cur.execute("select app.verify_assignment('AS99RLS0001')")
        v = cur.fetchone()[0]
        check("driver verifies the truck", v["verified_at"] is not None and v["mismatch_flagged"] is False, str(v))
        cur.execute("select app.verify_assignment('AS99RLS0001')")
        check("re-verifying is idempotent", cur.fetchone()[0]["idempotent"] is True)
        c.commit()

        # start now that the gate is satisfied
        cur = as_user(c, str(ua))
        cur.execute("select (app.start_trip()).status")
        check("start succeeds once the truck is verified", cur.fetchone()[0] == 'ACTIVE')
        c.commit()

        # stops, in order
        denied(c, str(ua), f"select app.complete_stop('{stop_ids[1]}')",
               "cannot complete stop 2 before stop 1")
        cur = as_user(c, str(ua))
        cur.execute("select app.arrive_at_stop(%s)", (stop_ids[0],))
        check("arrive at stop 1", cur.fetchone()[0]["status"] == 'ARRIVED')
        cur.execute("select app.arrive_at_stop(%s)", (stop_ids[0],))
        check("re-arriving is idempotent, not STOP_OUT_OF_ORDER",
              cur.fetchone()[0]["idempotent"] is True)
        cur.execute("select app.complete_stop(%s)", (stop_ids[0],))
        check("complete stop 1", cur.fetchone()[0]["status"] == 'COMPLETED')
        c.commit()
        # The retry that the Python module says was got wrong once: completing an
        # already-completed stop must succeed, not report the NEXT stop is due.
        cur = as_user(c, str(ua))
        cur.execute("select app.complete_stop(%s)", (stop_ids[0],))
        check("completing an already-completed stop is a retry, not a conflict",
              cur.fetchone()[0]["idempotent"] is True)
        c.commit()

        # completion is refused while a stop is outstanding
        denied(c, str(ua), "select app.complete_trip()",
               "cannot complete the trip with a stop outstanding")

        cur = as_user(c, str(ua))
        cur.execute("select app.arrive_at_stop(%s)", (stop_ids[1],))
        cur.execute("select app.complete_stop(%s)", (stop_ids[1],))
        c.commit()
        cur = as_user(c, str(ua))
        cur.execute("select (app.complete_trip()).status")
        check("trip completes once every stop is settled", cur.fetchone()[0] == 'DELIVERED')
        c.commit()
        cur = as_user(c, str(ua))
        cur.execute("select (app.complete_trip()).delivered_at")
        first_delivered = cur.fetchone()[0]
        cur.execute("select (app.complete_trip()).delivered_at")
        check("completing twice is idempotent", cur.fetchone()[0] == first_delivered)
        cur.execute("select count(*) from public.trip_events where kind='DELIVERED'")
        check("exactly one DELIVERED event", cur.fetchone()[0] == 1)
        c.commit()

        with psycopg.connect(test, autocommit=True) as owner:
            dstat = owner.execute("select status from drivers where id=%s", (drv_a,)).fetchone()[0]
            tstat = owner.execute("select status from trucks where id=%s", (truck,)).fetchone()[0]
        check("driver and truck released to AVAILABLE", (dstat, tstat) == ('AVAILABLE','AVAILABLE'), f"{dstat}/{tstat}")

        # --- manager visibility of the same authoritative rows ----------------
        cur = as_user(c, str(mgr))
        cur.execute("select status, delivered_at is not null from public.trips where id=%s", (trip,))
        row = cur.fetchone()
        check("manager observes the completion on the same row", row == ('DELIVERED', True), str(row))
        cur = as_user(c, str(mgr))
        cur.execute("select count(*) from public.gps_points where trip_id=%s", (trip,))
        check("manager sees the driver's submitted locations", cur.fetchone()[0] > 0)
        cur = as_user(c, str(mgr))
        cur.execute("select count(*) from public.trip_events where trip_id=%s and kind in ('STARTED','DELIVERED','STOP_COMPLETED')", (trip,))
        check("manager sees the driver's timeline events", cur.fetchone()[0] >= 3)
        c.rollback()

        # a mismatch is flagged, never refused
        with psycopg.connect(test, autocommit=True) as owner:
            # Driver B needs their OWN truck: uq_current_assignment_truck allows
            # only one current assignment per vehicle, which is the invariant
            # working, not a test problem.
            truck_b = owner.execute(
                """insert into trucks (id,registration_number,max_capacity_kg,current_load_kg,status,created_at,updated_at)
                   values (gen_random_uuid(),'AS99RLS0002',16000,0,'AVAILABLE',now(),now()) returning id""").fetchone()[0]
            owner.execute("""insert into driver_truck_assignments (id,driver_id,truck_id,status,assigned_at)
                             values (gen_random_uuid(),%s,%s,'PENDING_VERIFICATION',now())""", (drv_b, truck_b))
        cur = as_user(c, str(ub))
        cur.execute("select app.verify_assignment('WRONG-PLATE')")
        v = cur.fetchone()[0]
        check("a registration mismatch is flagged, not refused",
              v["verified_at"] is not None and v["mismatch_flagged"] is True, str(v))
        c.commit()

        denied(c, str(mgr), "select app.complete_trip()", "manager cannot complete a driver's trip")
        denied(c, None, "select public.complete_trip()", "anon cannot complete a trip")

        # --- identity linkage reporting --------------------------------------
        cur = as_user(c, str(mgr))
        cur.execute("select active_users, linked_active, unlinked_active from app.identity_status()")
        act, linked, unlinked = cur.fetchone()
        check("identity_status reports all 3 active users unlinked before import",
              (act, linked, unlinked) == (3, 0, 3), f"got {(act, linked, unlinked)}")
        c.rollback()
        with psycopg.connect(test, autocommit=True) as owner:
            owner.execute("insert into auth.users (id,email) values (%s,'a@rls.invalid')", (ua,))
        cur = as_user(c, str(mgr))
        cur.execute("select linked_active, unlinked_active from app.identity_status()")
        check("linking one Auth identity moves it to linked", cur.fetchone() == (1, 2))
        c.rollback()

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
