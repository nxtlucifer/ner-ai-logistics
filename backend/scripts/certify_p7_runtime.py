"""Runtime certification of P7 routing, route risk and auth rate limiting.

Unlike `certify_fleet.py`, which drives the app in-process through
`ASGITransport`, this talks to a REAL BOUND PORT over real TCP. That difference
is the whole point: an in-process client proves the application logic, but it
does not prove that this uvicorn process, on this machine, with this
configuration, actually serves the thing.

    python scripts/certify_p7_runtime.py http://127.0.0.1:8012

EXTERNAL PROVIDERS ARE REAL HERE. The routing call goes to the configured OSRM
endpoint and the weather calls go to Open-Meteo. That is deliberate for a
certification run and is exactly what the automated suite refuses to do. It
also means a provider outage fails this script - correctly, because "can this
demo actually plan a route right now" is the question being asked.

ORDER IS LOAD-BEARING. The rate-limit checks run LAST. The limiter is keyed on
the TCP peer, so tripping it throttles 127.0.0.1 for the whole window and every
later login would fail for the wrong reason.

SAFETY. Credentials are generated per run and never printed. Cleanup runs in a
`finally`, so a failure part-way through still tidies up, and accounts are
deactivated BEFORE anything is deleted so a crash cannot leave a usable login
behind.

Cleanup deletes by this script's OWN namespace - trip codes `P7CERT-`,
shipment references `P7SHP-`, registrations `AS77CT`, and e-mails under the
reserved `.invalid` TLD at `p7cert.invalid`. Nothing outside that namespace is
touched. Prefix rather than recorded-id deletion is deliberate: it also
recovers rows stranded by an EARLIER crashed run of this same script, which
id-based cleanup by definition cannot do.

User rows are deactivated and RETAINED, never deleted: `audit_logs.actor_user_id`
is RESTRICT by design, and weakening that to tidy up after a test would destroy
the audit trail's guarantee that every recorded actor still exists.
"""

import asyncio
import os
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

MARKER = "p7cert.invalid"
TRIP_PREFIX = "P7CERT-"
SHIPMENT_PREFIX = "P7SHP-"
TRUCK_PREFIX = "AS77CT"

GUWAHATI = {"lat": 26.1445, "lon": 91.7362}
JORHAT = {"lat": 26.7509, "lon": 94.2037}

passed: list[str] = []
failed: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    (passed if condition else failed).append(name)
    mark = "PASS" if condition else "FAIL"
    suffix = f" - {detail}" if detail and not condition else ""
    print(f"  [{mark}] {name}{suffix}")


def info(name: str, value: object) -> None:
    print(f"         {name}: {value}")


async def main(base_url: str) -> int:
    password = __import__("secrets").token_urlsafe(24)  # never printed
    manager_email = f"cert-mgr-{uuid.uuid4().hex[:8]}@{MARKER}"
    driver_email = f"cert-drv-{uuid.uuid4().hex[:8]}@{MARKER}"
    driver_phone = f"9{uuid.uuid4().int % 10**9:09d}"
    registration = f"{TRUCK_PREFIX}{uuid.uuid4().int % 10000:04d}"
    stamp = uuid.uuid4().hex[:8].upper()

    sessionmaker = db_session.get_sessionmaker()

    # No self-signup endpoint exists, which is correct - accounts are made by an
    # administrator. Seed the one manager this run needs.
    async with sessionmaker() as s:
        await s.execute(
            text(
                "INSERT INTO users (email, password_hash, role, display_name) "
                "VALUES (:e, :p, 'MANAGER', 'P7 Runtime Certification')"
            ),
            {"e": manager_email, "p": hash_password(password)},
        )
        await s.commit()

    try:
        async with AsyncClient(base_url=base_url, timeout=60.0) as api:
            print(f"\n0. Runtime target {base_url}")
            r = await api.get("/health")
            check("/health answers 200", r.status_code == 200, r.text)
            r = await api.get("/ready")
            check("/ready answers 200", r.status_code == 200, r.text)
            ready = r.json()
            info("provider", ready.get("provider"))
            info("database", ready["checks"]["database"]["detail"])
            info("postgis", ready["checks"]["postgis"]["detail"])

            print("\n1. Authentication over the bound port")
            r = await api.post(
                "/api/auth/login",
                json={"identifier": manager_email, "password": password},
            )
            check("manager login returns 200", r.status_code == 200, r.text)
            if r.status_code != 200:
                return 1
            mgr = {"Authorization": f"Bearer {r.json()['access_token']}"}

            print("\n2. Fleet setup")
            r = await api.post(
                "/api/drivers",
                headers=mgr,
                json={
                    "full_name": "P7 Certification Driver",
                    "initial_password": password,
                    "email": driver_email,
                    "phone": driver_phone,
                    "licence_number": f"P7CERT{stamp}",
                    "licence_expiry": (
                        datetime.now(UTC).date() + timedelta(days=400)
                    ).isoformat(),
                },
            )
            check("driver created", r.status_code == 201, r.text)
            driver_id = r.json()["id"]

            r = await api.post(
                "/api/trucks",
                headers=mgr,
                json={"registration_number": registration, "max_capacity_kg": "16000.00"},
            )
            check("truck created", r.status_code == 201, r.text)
            truck_id = r.json()["id"]

            r = await api.post(
                "/api/assignments",
                headers=mgr,
                json={"driver_id": driver_id, "truck_id": truck_id},
            )
            check("assignment created", r.status_code == 201, r.text)

            r = await api.post(
                "/api/trips/plan",
                headers=mgr,
                json={
                    "shipment": {
                        "reference_code": f"{SHIPMENT_PREFIX}{stamp}",
                        "client_name": "P7 Certification Client",
                        "pickup_address": "Depot, Guwahati",
                        "pickup": GUWAHATI,
                        "destination_address": "Yard, Jorhat",
                        "destination": JORHAT,
                        "cargo_items": [
                            {
                                "cargo_type": "GENERAL",
                                "cargo_name": "Certification cargo",
                                "weight_kg": "9000",
                            }
                        ],
                    },
                    "trip": {
                        "trip_code": f"{TRIP_PREFIX}{stamp}",
                        "truck_id": truck_id,
                        "driver_id": driver_id,
                    },
                },
            )
            check("shipment + trip planned atomically", r.status_code == 201, r.text)
            if r.status_code != 201:
                return 1
            # The plan endpoint returns TripRead - the trip itself, not a
            # wrapper. The shipment is removed below by its reference prefix.
            trip_id = r.json()["id"]

            print("\n3. P7 routing against the REAL provider")
            r = await api.post(
                f"/api/trips/{trip_id}/routes/recalculate", headers=mgr
            )
            check("route recalculation returns 201", r.status_code == 201, r.text)
            if r.status_code != 201:
                return 1
            plan = r.json()
            route = plan["route"]

            info("provider", plan["provider"])
            info("providers attempted", plan["providers_attempted"])
            info("used fallback", plan["used_fallback"])
            info("backup planned", plan["backup_planned"])
            info("distance_km", route["distance_km"])
            info("duration_min", route["estimated_duration_min"])
            info("geometry points", len(route["geometry"]))

            check("PRIMARY route returned", route["kind"] == "PRIMARY", route["kind"])
            check("provider identified", bool(plan["provider"]))
            check("geometry is non-empty", len(route["geometry"]) >= 2)
            check("distance > 0", float(route["distance_km"]) > 0)
            check("duration > 0", int(route["estimated_duration_min"]) > 0)

            # Coordinate order: the API speaks lat-lon.
            #
            # The swap is caught by the LATITUDE bound alone: this corridor
            # sits near lat 26 / lon 92, so a lat-lon inversion puts 92 into
            # the latitude slot, which is not a valid latitude at all.
            #
            # The longitude band is a loose regional envelope, not this
            # route: wide enough that any legitimate corridor the provider
            # picks between Guwahati and Jorhat passes, narrow enough to
            # catch an answer for the wrong part of the world. Deliberately
            # NOT asserting the observed 305.39 km / 221 min / 52 points -
            # a provider may legitimately re-survey a road, and a exact-value
            # assertion would fail for a correct answer.
            lats = [p[0] for p in route["geometry"]]
            lons = [p[1] for p in route["geometry"]]
            check(
                "coordinate order is lat-lon, not swapped",
                all(20.0 <= v <= 30.0 for v in lats)
                and all(88.0 <= v <= 98.0 for v in lons),
                f"lat range {min(lats):.3f}..{max(lats):.3f}, "
                f"lon range {min(lons):.3f}..{max(lons):.3f}",
            )
            # BACKUP is optional and its absence is a legitimate answer on a
            # single-corridor road. Reported, never required.
            info(
                "BACKUP",
                "stored (genuinely distinct corridor)"
                if plan["backup_planned"]
                else "not offered by the provider - legitimate on one road",
            )

            r = await api.get(f"/api/trips/{trip_id}/routes", headers=mgr)
            check("route list endpoint serves", r.status_code == 200, r.text)
            check("planned route is listed", any(x["id"] == route["id"] for x in r.json()))

            r = await api.post(
                f"/api/trips/{trip_id}/routes/{route['id']}/select", headers=mgr
            )
            check("route selection returns 200", r.status_code == 200, r.text)
            check("selected route is marked SELECTED", r.json()["state"] == "SELECTED",
                  r.json().get("state", ""))

            print("\n4. Route risk against the REAL weather provider")
            r = await api.get(
                f"/api/trips/{trip_id}/routes/{route['id']}/risk", headers=mgr
            )
            check("risk endpoint returns 200", r.status_code == 200, r.text)
            if r.status_code == 200:
                risk = r.json()
                info("score", f"{risk['score']} ({risk['band']})")
                info("observations used/stale",
                     f"{risk['observations_used']}/{risk['observations_stale']}")
                info("reason codes", risk["reason_codes"])
                info("weather input", risk["inputs"]["weather"])
                for c in risk["components"]:
                    info(f"  +{c['points']:>3} {c['code']}", c["detail"])

                check("score within 0..100", 0 <= risk["score"] <= 100)
                check(
                    "components sum to the score",
                    sum(c["points"] for c in risk["components"]) == risk["score"],
                )
                check("absent datasets are declared, not fabricated",
                      risk["inputs"]["landslide"] == "NOT_AVAILABLE"
                      and "landslide" in risk["unavailable"])
                check("no fabricated model fields",
                      not any(k in risk for k in
                              ("confidence", "model_version", "predicted_delay_min")))
                check(
                    "weather provider actually executed through the app",
                    risk["inputs"]["weather"] == "AVAILABLE"
                    and risk["observations_used"] > 0,
                    f"weather={risk['inputs']['weather']} "
                    f"used={risk['observations_used']} "
                    "(NOT_AVAILABLE would mean the provider was unreachable)",
                )

            print("\n5. Rate limiting (LAST - it throttles this peer address)")
            r = await api.post(
                "/api/driver/me/location",
                headers=mgr,
                json={"trip_id": trip_id, "fixes": []},
            )
            check(
                "GPS endpoint is not globally rate limited",
                r.status_code != 429,
                f"got {r.status_code}",
            )

            limit_hit = None
            retry_after = None
            for attempt in range(1, 40):
                r = await api.post(
                    "/api/auth/login",
                    json={
                        "identifier": f"nobody-{attempt}@{MARKER}",
                        "password": "wrong-password",
                    },
                )
                if r.status_code == 429:
                    limit_hit = attempt
                    retry_after = r.headers.get("retry-after")
                    break
            check("repeated failed logins reach 429", limit_hit is not None,
                  "threshold never reached in 40 attempts")
            info("429 after N attempts", limit_hit)
            check("429 carries Retry-After", retry_after is not None, "header absent")
            info("Retry-After", retry_after)

        print(f"\n{'=' * 60}")
        print(f"PASSED {len(passed)}   FAILED {len(failed)}")
        if failed:
            print("\nFAILED CHECKS:")
            for name in failed:
                print(f"  - {name}")
        return 1 if failed else 0

    finally:
        print("\n6. Cleanup")
        async with sessionmaker() as s:
            # Accounts are disabled BEFORE anything is deleted, so an
            # interrupted cleanup cannot leave a working login behind.
            await s.execute(
                text("UPDATE users SET is_active = false WHERE email LIKE :m"),
                {"m": f"%@{MARKER}"},
            )
            await s.commit()

            # The order certify_fleet.py already proved. Deleting a trip
            # cascades to its stops, events, gps_points AND trip_routes (all
            # ondelete CASCADE); trips.selected_route_id is SET NULL, so the
            # circular reference resolves itself and needs no manual nulling.
            #
            # Users are RETAINED and merely deactivated: audit_logs.actor_user_id
            # is RESTRICT by design, and weakening that to tidy up after a test
            # would remove the audit trail's guarantee that an actor still exists.
            await s.execute(
                text("DELETE FROM trips WHERE trip_code LIKE :p"),
                {"p": f"{TRIP_PREFIX}%"},
            )
            await s.execute(
                text("DELETE FROM shipments WHERE reference_code LIKE :p"),
                {"p": f"{SHIPMENT_PREFIX}%"},
            )
            await s.execute(
                text(
                    "DELETE FROM driver_truck_assignments a USING drivers d, users u "
                    "WHERE a.driver_id = d.id AND d.user_id = u.id AND u.email LIKE :m"
                ),
                {"m": f"%@{MARKER}"},
            )
            await s.execute(
                text(
                    "DELETE FROM drivers d USING users u "
                    "WHERE d.user_id = u.id AND u.email LIKE :m"
                ),
                {"m": f"%@{MARKER}"},
            )
            await s.execute(
                text(
                    "DELETE FROM refresh_tokens r USING users u "
                    "WHERE r.user_id = u.id AND u.email LIKE :m"
                ),
                {"m": f"%@{MARKER}"},
            )
            await s.execute(
                text("DELETE FROM trucks WHERE registration_number LIKE :p"),
                {"p": f"{TRUCK_PREFIX}%"},
            )
            await s.commit()

            trips_left = (await s.execute(
                text("SELECT count(*) FROM trips WHERE trip_code LIKE :p"),
                {"p": f"{TRIP_PREFIX}%"})).scalar_one()
            routes_left = (await s.execute(
                text("SELECT count(*) FROM trip_routes r JOIN trips t "
                     "ON t.id = r.trip_id WHERE t.trip_code LIKE :p"),
                {"p": f"{TRIP_PREFIX}%"})).scalar_one()
            ships_left = (await s.execute(
                text("SELECT count(*) FROM shipments WHERE reference_code LIKE :p"),
                {"p": f"{SHIPMENT_PREFIX}%"})).scalar_one()
            active = (await s.execute(
                text("SELECT count(*) FROM users WHERE email LIKE :m AND is_active"),
                {"m": f"%@{MARKER}"})).scalar_one()
            print(f"  trips remaining     : {trips_left}")
            print(f"  routes remaining    : {routes_left}")
            print(f"  shipments remaining : {ships_left}")
            print(f"  active cert logins  : {active}")
        await db_session.dispose_engine()


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8012"
    raise SystemExit(asyncio.run(main(target)))
