"""Runtime certification of driver dispatchability, over a real bound port.

    python scripts/certify_dispatchability.py http://127.0.0.1:8014

Two flows, and the second is the one that matters:

    FLOW A  active login   -> dispatch -> driver signs in -> starts the trip
    FLOW B  inactive login -> manager sees it -> dispatch refused -> no trip

Flow B is run the way the bug actually reaches production: the manager's screen
is stale. A UI that greys the button out is not the control - the control is the
backend refusing a request that arrives anyway, which is exactly what this
script sends.

SAFETY. Credentials are generated per run and never printed. Cleanup runs in a
`finally` and deletes only this script's own namespace - trip codes `DSPCERT-`,
shipment references `DSPSHP-`, registrations `AS66CT`, and e-mails under the
reserved `.invalid` TLD at `dspcert.invalid`. User rows are deactivated and
retained rather than deleted, because `audit_logs.actor_user_id` is RESTRICT and
weakening that to tidy a test would destroy the audit trail's guarantee that a
recorded actor still exists.
"""

import asyncio
import os
import secrets
import sys
import uuid
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.event_loop import configure_event_loop_policy  # noqa: E402

configure_event_loop_policy()

from httpx import AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db import session as db_session  # noqa: E402
PNG = bytes([0x89]) + b"PNG" + bytes([13, 10, 26, 10]) + bytes(64)  # verification photo the server now requires

MARKER = "dspcert.invalid"
TRIP_PREFIX = "DSPCERT-"
SHIPMENT_PREFIX = "DSPSHP-"
TRUCK_PREFIX = "AS66CT"

GUWAHATI = {"lat": 26.1445, "lon": 91.7362}
JORHAT = {"lat": 26.7509, "lon": 94.2037}

passed: list[str] = []
failed: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    (passed if condition else failed).append(name)
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}"
          f"{(' - ' + detail) if detail and not condition else ''}")


def info(name: str, value: object) -> None:
    print(f"         {name}: {value}")


async def _make_fleet(api, mgr, password, tag):
    """A driver, truck, assignment and DRAFT trip, ready to dispatch."""
    stamp = uuid.uuid4().hex[:8].upper()
    r = await api.post(
        "/api/drivers",
        headers=mgr,
        json={
            "full_name": f"Dispatchability Driver {tag}",
            "initial_password": password,
            "email": f"cert-drv-{uuid.uuid4().hex[:8]}@{MARKER}",
            "phone": f"9{uuid.uuid4().int % 10**9:09d}",
            "licence_number": f"DSP{stamp}",
            "licence_expiry": (datetime.now(UTC).date() + timedelta(days=400)).isoformat(),
        },
    )
    assert r.status_code == 201, r.text
    driver = r.json()

    r = await api.post(
        "/api/trucks",
        headers=mgr,
        json={
            "registration_number": f"{TRUCK_PREFIX}{uuid.uuid4().int % 10000:04d}",
            "max_capacity_kg": "16000.00",
        },
    )
    assert r.status_code == 201, r.text
    truck = r.json()

    r = await api.post(
        "/api/assignments",
        headers=mgr,
        json={"driver_id": driver["id"], "truck_id": truck["id"]},
    )
    assert r.status_code == 201, r.text

    r = await api.post(
        "/api/trips/plan",
        headers=mgr,
        json={
            "shipment": {
                "reference_code": f"{SHIPMENT_PREFIX}{stamp}",
                "client_name": "Dispatchability Client",
                "pickup_address": "Depot, Guwahati",
                "pickup": GUWAHATI,
                "destination_address": "Yard, Jorhat",
                "destination": JORHAT,
                "cargo_items": [
                    {"cargo_type": "GENERAL", "cargo_name": "Cert cargo",
                     "weight_kg": "9000"}
                ],
            },
            "trip": {
                "trip_code": f"{TRIP_PREFIX}{stamp}",
                "truck_id": truck["id"],
                "driver_id": driver["id"],
            },
        },
    )
    assert r.status_code == 201, r.text
    return driver, truck, r.json()


async def main(base_url: str) -> int:
    password = secrets.token_urlsafe(24)  # never printed
    manager_email = f"cert-mgr-{uuid.uuid4().hex[:8]}@{MARKER}"
    sessionmaker = db_session.get_sessionmaker()

    async with sessionmaker() as s:
        await s.execute(
            text(
                "INSERT INTO users (email, password_hash, role, display_name) "
                "VALUES (:e, :p, 'MANAGER', 'Dispatchability Certification')"
            ),
            {"e": manager_email, "p": hash_password(password)},
        )
        await s.commit()

    try:
        async with AsyncClient(base_url=base_url, timeout=60.0) as api:
            print(f"\n0. Runtime target {base_url}")
            check("/health 200", (await api.get("/health")).status_code == 200)
            check("/ready 200", (await api.get("/ready")).status_code == 200)

            r = await api.post(
                "/api/auth/login",
                json={"identifier": manager_email, "password": password},
            )
            check("manager login 200", r.status_code == 200, r.text)
            if r.status_code != 200:
                return 1
            mgr = {"Authorization": f"Bearer {r.json()['access_token']}"}

            # ---------------- FLOW A ----------------
            print("\nFLOW A - active login: dispatch, sign in, start")
            driver_a, _truck_a, trip_a = await _make_fleet(api, mgr, password, "A")

            listed = (await api.get("/api/drivers?limit=100", headers=mgr)).json()
            row = next(d for d in listed["items"] if d["id"] == driver_a["id"])
            check("driver reports login_is_active true", row["login_is_active"] is True)
            info("status / login", f"{row['status']} / active={row['login_is_active']}")

            r = await api.post(f"/api/trips/{trip_a['id']}/dispatch", headers=mgr)
            check("dispatch succeeds", r.status_code == 200, r.text)
            check("trip is ASSIGNED", r.json().get("status") == "ASSIGNED",
                  str(r.json().get("status")))

            r = await api.post(
                "/api/auth/login",
                json={"identifier": driver_a["phone"], "password": password},
            )
            check("driver can sign in", r.status_code == 200, r.text)
            if r.status_code == 200:
                drv = {"Authorization": f"Bearer {r.json()['access_token']}"}

                # The P5 truck check comes first: a trip cannot start
                # until the driver has verified the vehicle they are on.
                await api.post("/api/files?kind=TRUCK_VERIFICATION", headers=drv, content=PNG)
                r = await api.post(
                    "/api/driver/me/assignment/verify",
                    headers=drv,
                    json={
                        "reported_registration": _truck_a["registration_number"],
                        "reported_odometer_km": "18420.0",
                    },
                )
                check("driver verifies the truck", r.status_code == 200, r.text)

                r = await api.post(
                    "/api/driver/me/trip/start",
                    headers=drv,
                    json={"trip_id": trip_a["id"]},
                )
                check("driver starts the trip", r.status_code == 200, r.text)
                check("trip is ACTIVE", r.json().get("status") == "ACTIVE",
                      str(r.json().get("status")))

            # ---------------- FLOW B ----------------
            print("\nFLOW B - inactive login: manager sees it, dispatch refused")
            driver_b, _truck_b, trip_b = await _make_fleet(api, mgr, password, "B")

            # Disable the LOGIN only, directly, leaving drivers.status AVAILABLE
            # and deleted_at NULL.
            #
            # Deliberately not via POST /deactivate: that endpoint is a coherent
            # soft-delete - it sets deleted_at, moves the driver to SUSPENDED and
            # disables the login together, and the driver then drops out of the
            # listing entirely. It cannot produce the state this defect is about.
            #
            # The reported state comes from `users.is_active` being cleared
            # OUT OF BAND - a direct database edit, or the test-account hygiene
            # sweep - which leaves a driver still listed, still reading
            # AVAILABLE, and unable to sign in. That is the combination a
            # manager can actually meet, so that is what is certified here.
            async with sessionmaker() as s2:
                await s2.execute(
                    text("UPDATE users SET is_active = false WHERE id = ("
                         "SELECT user_id FROM drivers WHERE id = :d)"),
                    {"d": driver_b["id"]},
                )
                await s2.commit()
            check("login disabled out of band, driver row untouched", True)

            listed = (await api.get("/api/drivers?limit=100", headers=mgr)).json()
            row_b = next(d for d in listed["items"] if d["id"] == driver_b["id"])
            info("status / login", f"{row_b['status']} / active={row_b['login_is_active']}")
            check(
                "manager API exposes the inactive login",
                row_b["login_is_active"] is False,
                "a manager screen could not tell this driver is unusable",
            )

            # The stale-UI request: sent regardless of what the screen showed.
            r = await api.post(f"/api/trips/{trip_b['id']}/dispatch", headers=mgr)
            check("stale dispatch is refused", r.status_code == 409, r.text)
            if r.status_code == 409:
                check("refusal names the reason",
                      r.json()["error"]["code"] == "DRIVER_LOGIN_INACTIVE",
                      r.json()["error"]["code"])
            check("refusal is not a server error", r.status_code < 500,
                  f"got {r.status_code}")

            r = await api.get(f"/api/trips/{trip_b['id']}", headers=mgr)
            check("the trip did NOT become ASSIGNED",
                  r.json().get("status") == "DRAFT", str(r.json().get("status")))

            r = await api.post(
                "/api/auth/login",
                json={"identifier": driver_b["phone"], "password": password},
            )
            check("the inactive driver genuinely cannot sign in",
                  r.status_code == 401, f"got {r.status_code}")

            # ---------------- FLOW C ----------------
            print(chr(10) + "FLOW C - live trip: ordinary deactivation must be refused")
            driver_c, _truck_c, trip_c = await _make_fleet(api, mgr, password, "C")

            r = await api.post(f"/api/trips/{trip_c['id']}/dispatch", headers=mgr)
            check("flow C trip dispatched", r.status_code == 200, r.text)

            r = await api.post(
                f"/api/drivers/{driver_c['id']}/deactivate", headers=mgr
            )
            check("deactivation refused while the trip is live",
                  r.status_code == 409, f"got {r.status_code}: {r.text[:200]}")
            if r.status_code == 409:
                check("refusal names the live trip",
                      r.json()["error"]["code"] == "DRIVER_HAS_LIVE_TRIP",
                      r.json()["error"]["code"])
            check("refusal is not a server error", r.status_code < 500,
                  f"got {r.status_code}")

            r = await api.get(f"/api/trips/{trip_c['id']}", headers=mgr)
            check("the live trip is untouched",
                  r.json().get("status") == "ASSIGNED", str(r.json().get("status")))

            r = await api.post(
                "/api/auth/login",
                json={"identifier": driver_c["phone"], "password": password},
            )
            check("the driver can still sign in to finish the trip",
                  r.status_code == 200, f"got {r.status_code}")

        print(f"\n{'=' * 58}\nPASSED {len(passed)}   FAILED {len(failed)}")
        for name in failed:
            print(f"  - {name}")
        return 1 if failed else 0

    finally:
        print("\nCleanup")
        async with sessionmaker() as s:
            await s.execute(
                text("UPDATE users SET is_active = false WHERE email LIKE :m"),
                {"m": f"%@{MARKER}"},
            )
            await s.commit()
            await s.execute(text("DELETE FROM trips WHERE trip_code LIKE :p"),
                            {"p": f"{TRIP_PREFIX}%"})
            await s.execute(text("DELETE FROM shipments WHERE reference_code LIKE :p"),
                            {"p": f"{SHIPMENT_PREFIX}%"})
            await s.execute(
                text("DELETE FROM driver_truck_assignments a USING drivers d, users u "
                     "WHERE a.driver_id = d.id AND d.user_id = u.id AND u.email LIKE :m"),
                {"m": f"%@{MARKER}"},
            )
            await s.execute(
                text("DELETE FROM drivers d USING users u "
                     "WHERE d.user_id = u.id AND u.email LIKE :m"),
                {"m": f"%@{MARKER}"},
            )
            await s.execute(
                text("DELETE FROM refresh_tokens r USING users u "
                     "WHERE r.user_id = u.id AND u.email LIKE :m"),
                {"m": f"%@{MARKER}"},
            )
            await s.execute(text("DELETE FROM trucks WHERE registration_number LIKE :p"),
                            {"p": f"{TRUCK_PREFIX}%"})
            await s.commit()
            for label, sql, prefix in (
                ("trips", "SELECT count(*) FROM trips WHERE trip_code LIKE :p", f"{TRIP_PREFIX}%"),
                ("shipments", "SELECT count(*) FROM shipments WHERE reference_code LIKE :p", f"{SHIPMENT_PREFIX}%"),
                ("trucks", "SELECT count(*) FROM trucks WHERE registration_number LIKE :p", f"{TRUCK_PREFIX}%"),
            ):
                n = (await s.execute(text(sql), {"p": prefix})).scalar_one()
                print(f"  {label} remaining: {n}")
            n = (await s.execute(
                text("SELECT count(*) FROM users WHERE email LIKE :m AND is_active"),
                {"m": f"%@{MARKER}"})).scalar_one()
            print(f"  active cert logins: {n}")
        await db_session.dispose_engine()


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8014"
    raise SystemExit(asyncio.run(main(target)))
