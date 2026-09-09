r"""Create the owner's demo accounts, with a working trip to show.

    backend\.venv\Scripts\python.exe scripts\demo_account.py --password "..."

WHAT IT MAKES

    driver   phone 7016551560   for the driver app (drivers sign in by phone)
    manager  demo@ner.invalid   for the manager/reviewer web

Both share the password you pass in. **They cannot share the phone number**:
`uq_users_phone` is a unique partial index, so one phone belongs to exactly one
account. Drivers must sign in by phone, so the phone goes to the driver and the
manager gets an email.

The driver is given a truck, a verified assignment and a dispatched trip on the
supported Guwahati-Jorhat corridor, with a detailed route taken through the
normal review and selection path. So the account opens on **Accept trip**, and a
teammate can walk the whole journey: Accept -> Map -> Start -> navigate.

HOW IT MAKES THEM

Through the product's own API wherever the product has one - `POST /api/drivers`
creates the account and the driver profile together, which is exactly why that
endpoint exists. Only the manager is inserted directly, because creating one is
an operator action with no HTTP endpoint.

Re-runnable. An account that already exists has its password reset and is
reactivated rather than failing, so this is also the way to recover a demo login
that has drifted.

The target is checked by `tests/db_target.py` before anything is written.
"""

import argparse
import asyncio
import json
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.event_loop import configure_event_loop_policy  # noqa: E402

configure_event_loop_policy()

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.session import dispose_engine, get_sessionmaker  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.models.identity import Driver, User  # noqa: E402
from tests import db_target  # noqa: E402

API = "http://127.0.0.1:8000"
RUNTIME = ROOT.parent / ".runtime"

DRIVER_PHONE = "7016551560"
DRIVER_NAME = "Demo Driver"
MANAGER_EMAIL = "demo@ner.invalid"
REVIEWER_EMAIL = "ls11.reviewer@ner.invalid"

TRUCK_REG = "AS01DM0001"
GUWAHATI = {"lat": 26.144276, "lon": 91.736153}
JORHAT = {"lat": 26.75091, "lon": 94.203682}


def call(method: str, path: str, token: str | None = None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:300]}
    except urllib.error.URLError as e:
        raise SystemExit(
            f"\n  Cannot reach the backend at {API}: {e.reason}\n"
            "  Start it first with scripts\\Start-Demo.cmd\n"
        ) from e


def listing(method_path: str, token: str) -> list:
    """A list endpoint's rows, whatever envelope it uses.

    Two shapes are in play - `/api/trucks` and `/api/trips` return
    `{items, next_cursor}` while `/api/assignments` returns a bare list - and a
    rejected request returns neither. Reading `.get("items", body)` on an error
    body silently iterated the dict's KEYS and produced
    `'str' object has no attribute 'get'` several lines later, which says
    nothing about the real fault: the limit was out of range.
    """
    status, body = call("GET", method_path, token)
    if status != 200:
        raise SystemExit(f"  {method_path} -> {status} {json.dumps(body)[:200]}")
    if isinstance(body, dict):
        return body.get("items") or []
    return body or []


def login(identifier: str, password: str) -> str | None:
    status, body = call(
        "POST", "/api/auth/login", body={"identifier": identifier, "password": password}
    )
    return body["access_token"] if status == 200 else None


async def upsert_manager(password: str) -> None:
    """Managers have no creation endpoint - this is the operator path."""
    async with get_sessionmaker()() as db:
        user = (
            await db.execute(select(User).where(User.email == MANAGER_EMAIL))
        ).scalar_one_or_none()
        if user is None:
            db.add(
                User(
                    email=MANAGER_EMAIL,
                    password_hash=hash_password(password),
                    role=UserRole.MANAGER,
                    display_name="Demo Manager",
                    is_active=True,
                )
            )
            print(f"  created  manager  {MANAGER_EMAIL}")
        else:
            user.password_hash = hash_password(password)
            user.is_active = True
            print(f"  reset    manager  {MANAGER_EMAIL}")
        await db.commit()


async def existing_driver_id() -> str | None:
    async with get_sessionmaker()() as db:
        row = (
            await db.execute(
                select(Driver.id).join(User, User.id == Driver.user_id).where(
                    User.phone == DRIVER_PHONE
                )
            )
        ).scalar_one_or_none()
        return str(row) if row else None


async def reset_driver_password(password: str) -> None:
    async with get_sessionmaker()() as db:
        user = (
            await db.execute(select(User).where(User.phone == DRIVER_PHONE))
        ).scalar_one_or_none()
        if user is not None:
            user.password_hash = hash_password(password)
            user.is_active = True
            await db.commit()


def ensure_truck(manager: str) -> str:
    for t in listing("/api/trucks?limit=100", manager):
        if t.get("registration_number") == TRUCK_REG:
            print(f"  reused   truck    {TRUCK_REG}")
            return t["id"]
    status, made = call(
        "POST",
        "/api/trucks",
        manager,
        {"registration_number": TRUCK_REG, "max_capacity_kg": "12000"},
    )
    if status != 201:
        raise SystemExit(f"  could not create the truck: {status} {made}")
    print(f"  created  truck    {TRUCK_REG}")
    return made["id"]


def ensure_trip(manager: str, driver_id: str, truck_id: str) -> str | None:
    """One dispatched trip on the supported corridor, or the existing one."""
    for t in listing("/api/trips?limit=100", manager):
        if t.get("driver_id") == driver_id and t.get("status") in ("ASSIGNED", "ACTIVE"):
            print(f"  reused   trip     {t['trip_code']} ({t['status']})")
            return t["id"]

    suffix = DRIVER_PHONE[-4:]
    status, planned = call(
        "POST",
        "/api/trips/plan",
        manager,
        {
            "shipment": {
                "reference_code": f"SDEMO-{suffix}",
                "client_name": "Demo Client",
                "pickup_address": "Depot, Guwahati",
                "pickup": GUWAHATI,
                "destination_address": "Yard, Jorhat",
                "destination": JORHAT,
                "priority": "NORMAL",
                "cargo_items": [
                    {
                        "cargo_type": "GENERAL",
                        "cargo_name": "Demo cargo",
                        "weight_kg": "4000",
                        "quantity": 1,
                    }
                ],
            },
            "trip": {
                "trip_code": f"TRP-DEMO{suffix}",
                "truck_id": truck_id,
                "driver_id": driver_id,
                "stops": [
                    {
                        "sequence": 0,
                        "kind": "PICKUP",
                        "name": "Depot, Guwahati",
                        "location": GUWAHATI,
                    },
                    {
                        "sequence": 1,
                        "kind": "DROPOFF",
                        "name": "Yard, Jorhat",
                        "location": JORHAT,
                    },
                ],
            },
        },
    )
    if status != 201:
        print(f"  could not plan the trip: {status} {json.dumps(planned)[:400]}")
        return None
    trip = planned.get("trip", planned)
    print(f"  created  trip     {trip.get('trip_code')}")
    return trip["id"]


def approve_route(manager: str, reviewer: str | None, trip_id: str) -> None:
    """Plan a detailed candidate and take it through the normal review path.

    No shortcut: if the hazard evidence is UNKNOWN the selection is refused, a
    reviewer authorises it, and a different account spends that authorisation.
    Exactly what a teammate will be shown.
    """
    status, planned = call(
        "POST", f"/api/trips/{trip_id}/routes/recalculate?detailed=true", manager
    )
    if status != 201:
        print(f"  route planning failed: {status} {json.dumps(planned)[:200]}")
        return
    route_id = planned["route"]["id"]
    points = len(planned["route"].get("geometry") or [])
    print(f"  planned  route    {points} points")

    status, _ = call("POST", f"/api/trips/{trip_id}/routes/{route_id}/select", manager)
    if status == 200:
        print("  selected route    (evidence was sufficient)")
        return

    if reviewer is None:
        print("  route needs review and no reviewer login is available - left unselected")
        return

    status, auth = call(
        "POST",
        f"/api/trips/{trip_id}/routes/{route_id}/review-authorization",
        reviewer,
        {
            "rationale": (
                "Demo account setup: accepting the documented absence of a configured "
                "landslide source for this corridor so the demonstration trip has an "
                "approved detailed route with turn instructions."
            )
        },
    )
    if status != 201:
        print(f"  reviewer refused: {status} {json.dumps(auth)[:200]}")
        return
    status, _ = call(
        "POST",
        f"/api/trips/{trip_id}/routes/{route_id}/select?authorization_id={auth['id']}",
        manager,
    )
    print(
        "  selected route    (reviewer authorised, manager selected)"
        if status == 200
        else f"  selection failed: {status}"
    )


async def main(password: str) -> int:
    settings = get_settings()
    try:
        db_target.enforce(settings.effective_database_url, context="demo account")
    except db_target.UnsafeTestTarget as refusal:
        print(f"\nREFUSED. Nothing was written.\n\n{refusal}\n")
        return 2
    db_target.install()

    print("\n  Demo accounts on the isolated cluster\n")

    await upsert_manager(password)
    manager = login(MANAGER_EMAIL, password)
    if manager is None:
        print("  manager cannot sign in - stopping")
        await dispose_engine()
        return 1

    driver_id = await existing_driver_id()
    if driver_id:
        await reset_driver_password(password)
        print(f"  reset    driver   {DRIVER_PHONE}")
    else:
        status, made = call(
            "POST",
            "/api/drivers",
            manager,
            {
                "full_name": DRIVER_NAME,
                "phone": DRIVER_PHONE,
                "initial_password": password,
                "licence_number": f"AS{DRIVER_PHONE}",
                "licence_expiry": str(date.today() + timedelta(days=365)),
            },
        )
        if status != 201:
            print(f"  could not create the driver: {status} {json.dumps(made)[:300]}")
            await dispose_engine()
            return 1
        driver_id = made["id"]
        print(f"  created  driver   {DRIVER_PHONE}")

    truck_id = ensure_truck(manager)

    active = next(
        (
            a
            for a in listing("/api/assignments?limit=100", manager)
            if a.get("driver_id") == driver_id and a.get("status") == "ACTIVE"
        ),
        None,
    )
    if active is None:
        status, active = call(
            "POST", "/api/assignments", manager, {"driver_id": driver_id, "truck_id": truck_id}
        )
        if status != 201:
            print(f"  could not assign the truck: {status} {json.dumps(active)[:200]}")
            await dispose_engine()
            return 1
        print("  created  assignment")
    if not active.get("verified_at"):
        call("POST", f"/api/assignments/{active['id']}/verify", manager)
        print("  verified assignment")

    trip_id = ensure_trip(manager, driver_id, truck_id)
    if trip_id:
        status, _ = call("POST", f"/api/trips/{trip_id}/dispatch", manager)
        if status == 200:
            print("  dispatched trip   (now the driver's to accept)")
        approve_route(manager, login(REVIEWER_EMAIL, _reviewer_password()), trip_id)

    (RUNTIME / "demo-account-login.txt").write_text(
        f"{DRIVER_PHONE}\n{password}\n", encoding="ascii"
    )
    print(
        f"\n  Driver app  : {DRIVER_PHONE}\n"
        f"  Manager web : {MANAGER_EMAIL}\n"
        "  Password    : the one you passed (also in .runtime/demo-account-login.txt)\n"
    )
    await dispose_engine()
    return 0


def _reviewer_password() -> str:
    """The existing reviewer's own credential, so the review step can run."""
    f = RUNTIME / "reviewer-login.txt"
    if not f.exists():
        return ""
    lines = [x.strip() for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
    return lines[1] if len(lines) > 1 else ""


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--password", required=True, help="password for both accounts")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.password)))
