"""End-to-end certification of the fleet loop, over real HTTP against Supabase.

    MANAGER creates driver, truck, assignment
        |
        v
    DRIVER signs in and verifies the physical truck
        |
        v
    MANAGER creates a shipment, a trip, and dispatches it
        |
        v
    DRIVER sees the trip and starts it
        |
        v
    DRIVER's device sends position fixes
        |
        v
    MANAGER sees the truck LIVE with its position
        |
        v
    DRIVER works the stops and completes the trip
        |
        v
    MANAGER sees DELIVERED and closes it

P6 adds the checks the operations map depends on: that a plotted truck carries a
usable coordinate, that a truck which has never reported is listed WITHOUT one,
and that the observed track comes back in a defined order.

Every step goes through the real API - the same routes the apps call - rather
than the service layer, so authorization, validation and serialisation are all
exercised. Nothing is stubbed and no GPS is fabricated beyond the fixes a device
would send; the coordinates are real Guwahati-to-Jorhat points.

SAFETY. Everything created is marked and removed at the end, in foreign-key
order, and the accounts created are deactivated first so a failure part-way
through cannot leave a usable login behind. Credentials are generated per run
and never printed.

    python scripts/certify_fleet.py
"""

import asyncio
import secrets
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.event_loop import configure_event_loop_policy  # noqa: E402

configure_event_loop_policy()

from app.core.security import hash_password  # noqa: E402
from app.db import session as db_session  # noqa: E402

MARKER = "p5cert.invalid"
TRIP_PREFIX = "P5CERT-"
SHIPMENT_PREFIX = "P5SHP-"
TRUCK_PREFIX = "AS88CT"

GUWAHATI = {"lat": 26.1445, "lon": 91.7362}
MIDWAY = {"lat": 26.4000, "lon": 92.9000}
JORHAT = {"lat": 26.7509, "lon": 94.2037}

passed: list[str] = []
failed: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    (passed if condition else failed).append(name)
    mark = "PASS" if condition else "FAIL"
    print(f"  [{mark}] {name}{(' - ' + detail) if detail and not condition else ''}")


async def main() -> int:
    from app.main import create_app

    password = secrets.token_urlsafe(24)  # never printed
    manager_email = f"cert-manager-{uuid.uuid4().hex[:8]}@{MARKER}"
    driver_email = f"cert-driver-{uuid.uuid4().hex[:8]}@{MARKER}"
    driver_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    registration = f"{TRUCK_PREFIX}{uuid.uuid4().int % 10000:04d}"
    stamp = uuid.uuid4().hex[:8].upper()

    sessionmaker = db_session.get_sessionmaker()

    # The manager is seeded directly: there is no self-signup endpoint, which is
    # correct - accounts are created by an administrator.
    async with sessionmaker() as s:
        await s.execute(
            text(
                "INSERT INTO users (email, password_hash, role, display_name) "
                "VALUES (:e, :p, 'MANAGER', 'Certification Manager')"
            ),
            {"e": manager_email, "p": hash_password(password)},
        )
        await s.commit()

    async with AsyncClient(
        transport=ASGITransport(app=create_app()), base_url="http://cert"
    ) as api:

        async def login(identifier: str) -> dict:
            r = await api.post(
                "/api/auth/login", json={"identifier": identifier, "password": password}
            )
            r.raise_for_status()
            return {"Authorization": f"Bearer {r.json()['access_token']}"}

        print("\n1. MANAGER sets up driver, truck and assignment")
        mgr = await login(manager_email)

        r = await api.post(
            "/api/drivers",
            headers=mgr,
            json={
                "full_name": "Certification Driver",
                "initial_password": password,
                "email": driver_email,
                "phone": driver_phone,
                "licence_number": f"CERT{stamp}",
                "licence_expiry": (datetime.now(UTC).date() + timedelta(days=400)).isoformat(),
            },
        )
        check("manager creates a driver", r.status_code == 201, r.text)
        driver_id = r.json()["id"]

        r = await api.post(
            "/api/trucks",
            headers=mgr,
            json={"registration_number": registration, "max_capacity_kg": "16000.00"},
        )
        check("manager creates a truck", r.status_code == 201, r.text)
        truck_id = r.json()["id"]

        r = await api.post(
            "/api/assignments",
            headers=mgr,
            json={"driver_id": driver_id, "truck_id": truck_id},
        )
        check("manager assigns the driver to the truck", r.status_code == 201, r.text)

        print("\n2. DRIVER signs in and verifies the physical truck")
        drv = await login(driver_phone)

        r = await api.get("/api/driver/me", headers=drv)
        check(
            "driver identity resolves server-side",
            r.status_code == 200 and r.json()["id"] == driver_id,
            r.text,
        )

        r = await api.post(
            "/api/driver/me/assignment/verify",
            headers=drv,
            json={"reported_registration": registration, "reported_odometer_km": "18420.0"},
        )
        check(
            "driver verifies the truck",
            r.status_code == 200 and r.json()["assignment"]["verified_at"],
            r.text,
        )

        print("\n3. Trip cannot start before one exists")
        r = await api.get("/api/driver/me/trip", headers=drv)
        check("no trip yet is null, not an error", r.status_code == 200 and r.json() is None)

        print("\n4. MANAGER plans and dispatches a trip")

        def plan_body(reference: str, code: str, weight: str) -> dict:
            return {
                "shipment": {
                    "reference_code": reference,
                    "client_name": "Certification Client",
                    "pickup_address": "Depot, Guwahati",
                    "pickup": GUWAHATI,
                    "destination_address": "Yard, Jorhat",
                    "destination": JORHAT,
                    "cargo_items": [
                        {
                            "cargo_type": "GENERAL",
                            "cargo_name": "Certification cargo",
                            "weight_kg": weight,
                        }
                    ],
                },
                "trip": {
                    "trip_code": code,
                    "truck_id": truck_id,
                    "driver_id": driver_id,
                },
            }

        # The overloaded attempt FIRST, because it is the one the demo script
        # performs on stage (DEMO_PLAN 0:20-0:40) and because it is the case
        # that used to strand a committed cargo record nothing referenced.
        overload_ref = f"{SHIPMENT_PREFIX}X{stamp}"
        r = await api.post(
            "/api/trips/plan",
            headers=mgr,
            json=plan_body(overload_ref, f"{TRIP_PREFIX}X{stamp}", "18000"),
        )
        check(
            "an overloaded truck is refused",
            r.status_code == 422 and r.json()["error"]["code"] == "CAPACITY_EXCEEDED",
            r.text,
        )
        r = await api.get("/api/shipments?limit=100", headers=mgr)
        check(
            "the refused plan left NO orphan shipment",
            all(s["reference_code"] != overload_ref for s in r.json()["items"]),
            "an orphan cargo record survived a refused trip",
        )

        r = await api.post(
            "/api/trips/plan",
            headers=mgr,
            json=plan_body(f"{SHIPMENT_PREFIX}{stamp}", f"{TRIP_PREFIX}{stamp}", "9000"),
        )
        check(
            "manager plans shipment and trip atomically, in DRAFT",
            r.status_code == 201 and r.json()["status"] == "DRAFT",
            r.text,
        )
        trip_id = r.json()["id"]

        r = await api.get(f"/api/trips/{trip_id}", headers=mgr)
        check(
            "cargo weight is derived by the database, not declared",
            r.json()["shipment"]["total_weight_kg"] in ("9000.00", "9000.0", "9000"),
            str(r.json()["shipment"]["total_weight_kg"]),
        )

        r = await api.post(f"/api/trips/{trip_id}/dispatch", headers=mgr)
        check("manager dispatches the trip", r.status_code == 200 and r.json()["status"] == "ASSIGNED", r.text)

        print("\n5. DRIVER sees and starts the trip")
        r = await api.get("/api/driver/me/trip", headers=drv)
        view = r.json()
        check("driver sees the dispatched trip", view and view["id"] == trip_id, r.text)
        check("driver sees the real stop sequence", [s["sequence"] for s in view["stops"]] == [0, 1])
        check("start gates all pass", view["can_start"] is True, str(view.get("start_blocked_reason")))
        check("tracking is not expected before start", view["tracking_expected"] is False)

        r = await api.post("/api/driver/me/trip/start", headers=drv, json={"trip_id": trip_id})
        check("driver starts the trip", r.status_code == 200 and r.json()["status"] == "ACTIVE", r.text)
        check("tracking becomes expected", r.json()["tracking_expected"] is True)
        cadence = r.json()["tracking"]["moving_interval_seconds"]

        print("\n6. DRIVER's device sends position")
        now = datetime.now(UTC)
        fixes = [
            {
                "device_fix_id": str(uuid.uuid4()),
                "location": point,
                "recorded_at": (now - timedelta(seconds=offset)).isoformat(),
                "speed_kmph": "48.0",
                "accuracy_m": "9.0",
            }
            for offset, point in ((2 * cadence, GUWAHATI), (cadence, MIDWAY), (0, JORHAT))
        ]
        r = await api.post("/api/driver/me/location", headers=drv, json={"trip_id": trip_id, "fixes": fixes})
        check("position fixes are accepted", r.status_code == 202 and r.json()["accepted"] == 3, r.text)

        r = await api.post("/api/driver/me/location", headers=drv, json={"trip_id": trip_id, "fixes": fixes})
        check(
            "a re-sent batch is idempotent",
            r.json()["accepted"] == 0 and r.json()["duplicates_ignored"] == 3,
            r.text,
        )

        r = await api.post(
            "/api/driver/me/location",
            headers=drv,
            json={"fixes": [{**fixes[0], "device_fix_id": str(uuid.uuid4()),
                             "location": {"lat": 91.7362, "lon": 26.1445}}]},
        )
        check("an inverted coordinate is refused", r.status_code == 422)

        print("\n7. MANAGER sees the truck live")
        r = await api.get("/api/fleet/active", headers=mgr)
        fleet = r.json()
        row = next((t for t in fleet["trips"] if t["trip_id"] == trip_id), None)
        check("trip appears on the fleet view", row is not None, r.text)
        check("freshness is LIVE", row and row["freshness"] == "LIVE", str(row and row["freshness"]))
        check(
            "position is the NEWEST fix, not the last inserted",
            row and abs(row["position"]["location"]["lat"] - JORHAT["lat"]) < 1e-6,
            str(row and row["position"]["location"]),
        )
        check("manager sees stop progress", row and row["stops_total"] == 2 and row["stops_done"] == 0)

        r = await api.get(f"/api/trips/{trip_id}/track?limit=10", headers=mgr)
        check("bounded track is readable", r.status_code == 200 and len(r.json()["points"]) == 3, r.text)

        r = await api.get("/api/fleet/active", headers=drv)
        check("a driver cannot read the fleet's locations", r.status_code == 403)

        print("\n8. DRIVER works the stops")
        view = (await api.get("/api/driver/me/trip", headers=drv)).json()
        for index in range(2):
            stop_id = view["next_stop_id"]
            r = await api.post(f"/api/driver/me/trip/stops/{stop_id}/arrive", headers=drv)
            check(f"arrives at stop {index}", r.status_code == 200, r.text)
            r = await api.post(f"/api/driver/me/trip/stops/{stop_id}/complete", headers=drv)
            check(f"completes stop {index}", r.status_code == 200, r.text)
            view = r.json()

        print("\n9. DRIVER completes the trip")
        r = await api.post("/api/driver/me/trip/complete", headers=drv, json={"trip_id": trip_id})
        check("trip completes", r.status_code == 200 and r.json()["status"] == "DELIVERED", r.text)
        check("tracking stops", r.json()["tracking_expected"] is False)

        r = await api.post("/api/driver/me/location", headers=drv, json={"fixes": [fixes[0]]})
        check("location is refused after completion", r.status_code == 404)

        print("\n10. MANAGER sees the result and closes the trip")
        r = await api.get(f"/api/trips/{trip_id}", headers=mgr)
        check("manager sees DELIVERED", r.json()["status"] == "DELIVERED", r.text)
        check(
            "every stop is recorded complete",
            all(s["status"] == "COMPLETED" for s in r.json()["stops"]),
            str([s["status"] for s in r.json()["stops"]]),
        )

        r = await api.get("/api/fleet/active", headers=mgr)
        check(
            "a delivered trip leaves the live fleet view",
            all(t["trip_id"] != trip_id for t in r.json()["trips"]),
        )

        r = await api.post(f"/api/trips/{trip_id}/close", headers=mgr)
        check("manager closes the trip", r.status_code == 200 and r.json()["status"] == "CLOSED", r.text)

        print("\n10b. MAP CONTRACT (P6)")
        # A second driver and truck, dispatched and started but never reporting
        # a position - the case a map must NOT invent a coordinate for.
        silent_phone = f"9{uuid.uuid4().int % 10**9:09d}"
        silent_reg = f"{TRUCK_PREFIX}{uuid.uuid4().int % 10000:04d}"
        r = await api.post(
            "/api/drivers",
            headers=mgr,
            json={
                "full_name": "Silent Driver",
                "initial_password": password,
                "email": f"cert-silent-{uuid.uuid4().hex[:8]}@{MARKER}",
                "phone": silent_phone,
                "licence_number": f"SILENT{stamp}",
                "licence_expiry": (datetime.now(UTC).date() + timedelta(days=400)).isoformat(),
            },
        )
        silent_driver_id = r.json()["id"]
        r = await api.post(
            "/api/trucks",
            headers=mgr,
            json={"registration_number": silent_reg, "max_capacity_kg": "12000.00"},
        )
        silent_truck_id = r.json()["id"]
        await api.post(
            "/api/assignments",
            headers=mgr,
            json={"driver_id": silent_driver_id, "truck_id": silent_truck_id},
        )
        silent = await login(silent_phone)
        await api.post(
            "/api/driver/me/assignment/verify",
            headers=silent,
            json={"reported_registration": silent_reg},
        )
        r = await api.post(
            "/api/shipments",
            headers=mgr,
            json={
                "reference_code": f"{SHIPMENT_PREFIX}S{stamp}",
                "client_name": "Certification Client",
                "pickup_address": "Depot, Guwahati",
                "pickup": GUWAHATI,
                "destination_address": "Yard, Jorhat",
                "destination": JORHAT,
                "cargo_items": [
                    {"cargo_type": "GENERAL", "cargo_name": "Silent cargo", "weight_kg": "1000"}
                ],
            },
        )
        r = await api.post(
            "/api/trips",
            headers=mgr,
            json={
                "trip_code": f"{TRIP_PREFIX}S{stamp}",
                "shipment_id": r.json()["id"],
                "truck_id": silent_truck_id,
                "driver_id": silent_driver_id,
            },
        )
        silent_trip_id = r.json()["id"]
        await api.post(f"/api/trips/{silent_trip_id}/dispatch", headers=mgr)
        await api.post("/api/driver/me/trip/start", headers=silent, json={})

        fleet = (await api.get("/api/fleet/active", headers=mgr)).json()
        silent_row = next(
            (t for t in fleet["trips"] if t["trip_id"] == silent_trip_id), None
        )
        check("a truck that never reported is still listed", silent_row is not None)
        check(
            "and carries NO coordinate for a map to plot",
            silent_row is not None
            and silent_row["position"] is None
            and silent_row["freshness"] == "NO_LOCATION",
            str(silent_row and silent_row["freshness"]),
        )
        check(
            "the freshness threshold travels with the data",
            isinstance(fleet.get("fresh_seconds"), int) and fleet["fresh_seconds"] > 0,
        )

        # And the reverse: a reporting truck carries a coordinate a map can use.
        await api.post(
            "/api/driver/me/location",
            headers=silent,
            json={"fixes": [
                {
                    "device_fix_id": str(uuid.uuid4()),
                    "location": MIDWAY,
                    "recorded_at": datetime.now(UTC).isoformat(),
                }
            ]},
        )
        fleet = (await api.get("/api/fleet/active", headers=mgr)).json()
        row = next(t for t in fleet["trips"] if t["trip_id"] == silent_trip_id)
        plottable = (
            row["position"] is not None
            and -90 <= row["position"]["location"]["lat"] <= 90
            and -180 <= row["position"]["location"]["lon"] <= 180
        )
        check("a reporting truck is map-plottable", plottable, str(row["position"]))

        # The breadcrumb the map draws must have a defined order.
        r = await api.get(f"/api/trips/{silent_trip_id}/track?limit=50", headers=mgr)
        stamps = [p["recorded_at"] for p in r.json()["points"]]
        check(
            "observed track is ordered newest first",
            stamps == sorted(stamps, reverse=True),
            str(stamps),
        )
        check("track reports truncation honestly", r.json()["truncated"] is False)

        await api.post(
            f"/api/trips/{silent_trip_id}/cancel", headers=mgr
        )

    print("\n11. Cleanup")
    async with sessionmaker() as s:
        # Accounts are disabled BEFORE anything is deleted, so an interrupted
        # cleanup cannot leave a working login behind.
        await s.execute(
            text("UPDATE users SET is_active = false WHERE email LIKE :m"),
            {"m": f"%@{MARKER}"},
        )
        await s.commit()
        # Deleting a trip cascades to its stops, events and gps_points.
        await s.execute(text("DELETE FROM trips WHERE trip_code LIKE :p"), {"p": f"{TRIP_PREFIX}%"})
        await s.execute(
            text("DELETE FROM shipments WHERE reference_code LIKE :p"), {"p": f"{SHIPMENT_PREFIX}%"}
        )
        await s.execute(
            text(
                "DELETE FROM driver_truck_assignments a USING drivers d, users u "
                "WHERE a.driver_id = d.id AND d.user_id = u.id AND u.email LIKE :m"
            ),
            {"m": f"%@{MARKER}"},
        )
        await s.execute(
            text("DELETE FROM drivers d USING users u WHERE d.user_id = u.id AND u.email LIKE :m"),
            {"m": f"%@{MARKER}"},
        )
        await s.execute(
            text("DELETE FROM refresh_tokens r USING users u WHERE r.user_id = u.id AND u.email LIKE :m"),
            {"m": f"%@{MARKER}"},
        )
        await s.execute(text("DELETE FROM trucks WHERE registration_number LIKE :p"), {"p": f"{TRUCK_PREFIX}%"})
        await s.commit()

        leftover = (
            await s.execute(
                text("SELECT count(*) FROM users WHERE email LIKE :m AND is_active"),
                {"m": f"%@{MARKER}"},
            )
        ).scalar_one()
    # Users are retained by design: audit_logs.actor_user_id is RESTRICT, so a
    # user who has done anything auditable cannot be deleted. They are left
    # DEACTIVATED, which is the safe state.
    check("no active certification account remains", leftover == 0, str(leftover))

    await db_session.dispose_engine()

    print(f"\n{'=' * 60}")
    print(f"FLEET CERTIFICATION (P5 + P6): {len(passed)} passed, {len(failed)} failed")
    if failed:
        for name in failed:
            print(f"  FAILED: {name}")
    print("=" * 60)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
