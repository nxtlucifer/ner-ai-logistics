r"""Inspect and reset the demonstration scenarios.

    backend\.venv\Scripts\python.exe scripts\demo_scenario.py --status
    backend\.venv\Scripts\python.exe scripts\demo_scenario.py --reset-pending

WHY THIS EXISTS

Two scenarios carry the demo, and one of them is CONSUMED by demonstrating it:

    navigation  an ACTIVE trip with an approved detailed route and stored
                maneuvers. Re-runnable as often as you like.

    acceptance  an ASSIGNED trip the driver has NOT yet acknowledged, so
                "Accept trip" is on screen. Once a teammate taps it, it is gone
                until someone clears the acknowledgment.

Before this script the only way back was hand-written SQL, which is how demo
data gets damaged five minutes before a rehearsal.

WHAT IT WILL NOT DO

It resets ONE column pair on ONE trip. It does not reseed, does not touch the
navigation trip, does not delete anything and does not reset passwords. The
target is checked by `tests/db_target.py` - the same registered isolated cluster
and `do_connect` veto the test suite uses - so it cannot reach shared Supabase
even if the environment says otherwise.

This is deliberately NOT wired into the launcher. A launcher that resets
scenarios on every start is a launcher that erases the state you were about to
show someone.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.event_loop import configure_event_loop_policy  # noqa: E402

configure_event_loop_policy()

from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import dispose_engine, get_sessionmaker  # noqa: E402
from tests import db_target  # noqa: E402

STATUS_SQL = """
    SELECT t.trip_code,
           t.status::text                        AS status,
           t.driver_accepted_at IS NOT NULL      AS accepted,
           t.selected_route_id IS NOT NULL       AS has_route,
           COALESCE(u.phone, u.email)            AS driver_login,
           (SELECT jsonb_array_length(r.maneuvers)
              FROM trip_routes r WHERE r.id = t.selected_route_id) AS maneuvers
      FROM trips t
      JOIN drivers d ON d.id = t.driver_id
      JOIN users   u ON u.id = d.user_id
     WHERE t.trip_code NOT LIKE 'TTEST-%'
     ORDER BY t.created_at DESC
"""


async def show(db) -> list:
    rows = (await db.execute(text(STATUS_SQL))).all()
    print("\n  Demonstration scenarios on the isolated cluster:\n")
    for r in rows:
        m = dict(r._mapping)
        # Terminal states first: a cancelled trip is not a scenario, and
        # labelling it "Accept trip is on screen" is worse than saying nothing.
        if m["status"] in ("CANCELLED", "CLOSED", "DELIVERED"):
            kind = "(finished - not a demo scenario)"
        elif m["has_route"] and m["maneuvers"]:
            kind = f"NAVIGATION  ({m['maneuvers']} maneuvers)"
            if m["accepted"] or m["status"] == "ACTIVE":
                kind += "  [in progress - --reset-pending to replay Accept]"
        elif not m["accepted"]:
            kind = "ACCEPTANCE  (Accept trip is on screen)"
        else:
            kind = "acceptance  (already accepted - use --reset-pending)"
        print(
            f"    {m['trip_code']:16} {m['status']:10} "
            f"driver {m['driver_login']:14} {kind}"
        )
    print()
    return rows


async def reset_pending(db, trip_code: str | None) -> list[str]:
    """Put the acceptance trip back to 'not yet acknowledged'.

    Rewinds a demo trip to the moment before the driver touched it: not accepted,
    not started, back to ASSIGNED. That is what makes the whole flow - Accept ->
    Map -> check the truck -> Start -> navigate - repeatable for the next person
    who wants to see it.

    Two earlier versions were too narrow. The first also required
    `selected_route_id IS NULL`, assuming an acceptance trip never has a route -
    wrong as soon as a demo account was given both. The second only matched
    ASSIGNED, so once someone pressed Start the trip was ACTIVE and there was no
    way back short of hand-written SQL.

    `TTEST-` trips are excluded, so this only ever touches demonstration data.

    Pass a trip code to rewind ONE. Without it every demo trip is rewound, and
    the codes are printed - the first version did that silently and quietly
    turned the long-standing mid-journey demo back into an un-started one, which
    is exactly the sort of surprise a rehearsal cannot afford.
    """
    result = await db.execute(
        text(
            """
            UPDATE trips
               SET driver_accepted_at = NULL,
                   driver_accepted_by = NULL,
                   started_at         = NULL,
                   status             = 'ASSIGNED'
             WHERE trip_code NOT LIKE 'TTEST-%'
               AND status IN ('ASSIGNED', 'ACTIVE')
               AND (driver_accepted_at IS NOT NULL OR started_at IS NOT NULL)
               -- Cast required: PostgreSQL cannot infer the type of a bare
               -- NULL parameter and raises AmbiguousParameter.
               AND (CAST(:code AS text) IS NULL OR trip_code = CAST(:code AS text))
         RETURNING trip_code
            """
        ),
        {"code": trip_code},
    )
    codes = [r[0] for r in result.all()]
    await db.commit()
    return codes


#: The test namespaces, and nothing else.
#:
#: Every one of these is generated ONLY by `tests/factories.py`:
#:   `%@p3test.invalid`  RFC 6761 reserved domain, produced by unique_email()
#:   `AS__ZZ%`           unique_registration()
#:   `TTEST-` / `STEST-` the trip and shipment prefixes
#:
#: The demonstration data lives in different namespaces entirely - `@ner.invalid`
#: accounts, `TRP-` trip codes, the `AS09LS9001` truck - so it cannot be reached
#: by any of these predicates. That separation is what makes this safe, not
#: care taken while typing.
TIDY_STEPS = [
    ("trips", "DELETE FROM trips WHERE trip_code LIKE 'TTEST-%'"),
    ("shipments", "DELETE FROM shipments WHERE reference_code LIKE 'STEST-%'"),
    (
        "assignments",
        "DELETE FROM driver_truck_assignments a USING drivers d, users u"
        " WHERE a.driver_id = d.id AND d.user_id = u.id"
        " AND u.email LIKE '%@p3test.invalid'",
    ),
    (
        "drivers",
        "DELETE FROM drivers d USING users u"
        " WHERE d.user_id = u.id AND u.email LIKE '%@p3test.invalid'",
    ),
    ("trucks", "DELETE FROM trucks WHERE registration_number LIKE 'AS__ZZ%'"),
    (
        "refresh tokens",
        "DELETE FROM refresh_tokens r USING users u"
        " WHERE r.user_id = u.id AND u.email LIKE '%@p3test.invalid'",
    ),
    (
        "accounts deactivated",
        "UPDATE users SET is_active = false"
        " WHERE email LIKE '%@p3test.invalid' AND is_active",
    ),
]


async def tidy_test_data(db) -> None:
    """Clear accumulated TEST rows so the demo screens are usable.

    Hundreds of identical "Bipul Das" drivers in the manager's dropdown is not a
    cosmetic problem - it makes the Trips page unusable to show anyone. They
    accumulate because cleanup is correctly scoped to ids a run recorded, and
    these rows predate that ledger, so nothing can identify them as any
    particular run's.

    Users are DEACTIVATED, never deleted: `audit_logs.actor_user_id` is RESTRICT,
    so an account that has done anything auditable is pinned by its own trail.
    That is the production behaviour and this does not weaken it.

    This is the ISOLATED cluster, checked above. It is not the shared-database
    cleanup that remains unproposed and unauthorised.
    """
    print("\n  Tidying accumulated TEST data (demo data is in other namespaces):\n")
    for label, sql in TIDY_STEPS:
        result = await db.execute(text(sql))
        print(f"    {label:24} {result.rowcount}")
    await db.commit()


async def main(reset: bool, tidy: bool, trip_code: str | None) -> int:
    settings = get_settings()
    try:
        db_target.enforce(settings.effective_database_url, context="demo scenario")
    except db_target.UnsafeTestTarget as refusal:
        print(f"\nREFUSED. Nothing was changed.\n\n{refusal}\n")
        return 2
    db_target.install()

    async with get_sessionmaker()() as db:
        if tidy:
            await tidy_test_data(db)
        if reset:
            codes = await reset_pending(db, trip_code)
            if codes:
                # Name them. Without --trip this rewinds EVERY demo trip, and a
                # bare count leaves you guessing which scenario just changed.
                print(
                    "\n  Rewound to ASSIGNED - 'Accept trip' is on screen again: "
                    + ", ".join(codes)
                )
            else:
                print("\n  Nothing to rewind - no accepted or started demo trip found.")
        await show(db)

    await dispose_engine()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reset-pending",
        action="store_true",
        help="clear the driver's acknowledgment so Accept trip can be shown again",
    )
    parser.add_argument(
        "--tidy-test-data",
        action="store_true",
        help="clear accumulated TEST rows that clutter the demo screens (never demo data)",
    )
    parser.add_argument(
        "--trip", default=None, help="rewind only this trip code (default: every demo trip)"
    )
    parser.add_argument("--status", action="store_true", help="show scenarios only")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.reset_pending, args.tidy_test_data, args.trip)))
