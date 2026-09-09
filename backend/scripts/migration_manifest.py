"""Read-only migration manifest for the hosted project.

Classifies every account by EVIDENCE - related records, not email pattern - into
included / excluded / unresolved, and writes a manifest that names no personal
data. Opens a read-only transaction and issues no DDL or DML of any kind.

WHY NOT CLASSIFY BY EMAIL PATTERN

The first pass called everything matching `%.invalid` a fixture. That is a guess
dressed as a fact: `inactive` is not `disposable`, and a deactivated real
account looks exactly like a fixture from its address alone. What separates them
is whether anything in the system depends on the row - a drivers record, an
authored trip, a session history.

ANYTHING THE RULES CANNOT SETTLE IS `unresolved`, NOT `excluded`. Nothing here
deletes, and the excluded set is a proposal for a human, not an action.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".runtime" / "supabase-migration" / "manifest.json"

# Evidence a row is load-bearing. Any one of these includes the account.
CLASSIFY = """
with ev as (
  select
    u.id, u.role, u.is_active, u.email is null as no_email,
    coalesce(u.email like '%@p3test.invalid', false) as p3test_pattern,
    coalesce(u.email like '%.invalid', u.email is null) as invalid_pattern,
    exists (select 1 from public.drivers d  where d.user_id = u.id)        as has_driver_row,
    exists (select 1 from public.trips t    where t.created_by = u.id)     as authored_trip,
    exists (select 1 from public.trip_events e where e.actor_user_id = u.id) as authored_event,
    exists (select 1 from public.refresh_tokens r where r.user_id = u.id)  as has_session,
    u.last_login_at is not null                                            as ever_logged_in
  from public.users u
)
select
  case
    when is_active or has_driver_row or authored_trip or authored_event or has_session
      then 'include'
    when p3test_pattern and not has_driver_row and not authored_trip
         and not authored_event and not has_session
      then 'exclude_fixture'
    else 'unresolved'
  end as bucket,
  role, is_active, p3test_pattern, invalid_pattern, no_email,
  has_driver_row, authored_trip, authored_event, has_session, ever_logged_in,
  count(*) as n
from ev
group by 1,2,3,4,5,6,7,8,9,10,11
order by 1, n desc
"""

TABLES = [
    "users", "drivers", "trucks", "driver_truck_assignments", "shipments",
    "cargo_items", "trips", "trip_stops", "trip_routes", "trip_events",
    "gps_points", "audit_logs", "refresh_tokens", "driver_documents",
    "truck_documents", "truck_maintenance", "system_info",
]

INTEGRITY = """
select
  (select count(*) from trips t left join drivers d on d.id=t.driver_id
     where t.driver_id is not null and d.id is null)                        as trip_without_driver,
  (select count(*) from trips t left join shipments s on s.id=t.shipment_id
     where s.id is null)                                                    as trip_without_shipment,
  (select count(*) from trip_stops s left join trips t on t.id=s.trip_id
     where t.id is null)                                                    as stop_without_trip,
  (select count(*) from trip_routes r left join trips t on t.id=r.trip_id
     where t.id is null)                                                    as route_without_trip,
  (select count(*) from gps_points g left join trips t on t.id=g.trip_id
     where t.id is null)                                                    as gps_without_trip,
  (select count(*) from drivers d left join users u on u.id=d.user_id
     where u.id is null)                                                    as driver_without_user
"""


def dsn() -> str:
    env = {}
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v.strip().strip('"').strip("'")
    return re.sub(r"^\w+(?:\+\w+)?://", "postgresql://", env["DATABASE_URL"])


def main() -> int:
    manifest: dict = {
        "generated_utc": datetime.now(UTC).isoformat(),
        "mode": "READ ONLY - no DDL, no DML, nothing deleted",
        "source_project_ref": "znaveeefzgfxsblsobdb",
    }
    with psycopg.connect(dsn(), connect_timeout=20) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute("select version(), current_database()")
            v, db = cur.fetchone()
            manifest["server"] = v.split(",")[0]
            manifest["database"] = db

            cur.execute("select version_num from public.alembic_version")
            manifest["alembic_version"] = cur.fetchone()[0]

            counts = {}
            for t in TABLES:
                cur.execute(f'select count(*) from public."{t}"')
                counts[t] = cur.fetchone()[0]
            manifest["row_counts"] = counts

            cur.execute(
                "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                "where n.nspname='public' and c.relkind='r' order by 1"
            )
            manifest["tables_present"] = [r[0] for r in cur.fetchall()]

            cur.execute(INTEGRITY)
            cols = [d.name for d in cur.description]
            manifest["referential_integrity"] = dict(zip(cols, cur.fetchone()))

            cur.execute(CLASSIFY)
            cols = [d.name for d in cur.description]
            groups = [dict(zip(cols, r)) for r in cur.fetchall()]
            manifest["account_groups"] = groups

            totals: dict[str, int] = {}
            for g in groups:
                totals[g["bucket"]] = totals.get(g["bucket"], 0) + g["n"]
            manifest["account_totals"] = totals
            manifest["accounts_total"] = sum(totals.values())

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")

    print(f"alembic_version : {manifest['alembic_version']}")
    print(f"tables present  : {len(manifest['tables_present'])}")
    print(f"accounts total  : {manifest['accounts_total']}")
    for b, n in sorted(manifest["account_totals"].items()):
        print(f"  {b:16} {n:>6}")
    print("integrity       :", manifest["referential_integrity"])
    bad = [k for k, v in manifest["referential_integrity"].items() if v]
    print("orphans         :", "NONE" if not bad else bad)
    print(f"\nmanifest -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
