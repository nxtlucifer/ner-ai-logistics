"""Day 2 Task 1 - API evidence run against the LOCAL demo backend (127.0.0.1:8010,
local clone DB ner_logistics_demo). Never points at Supabase. Prints a table and
writes api-results.json beside it; secrets are never printed (tokens/passwords redacted)."""
import json, os, sys, time, uuid, urllib.request, urllib.error
from datetime import date, timedelta
from pathlib import Path

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8010")
ROOT = Path(r"D:\Projects\ner-ai-logistics")
CRED = json.load(open(ROOT / ".runtime" / "demo-credentials.private.json", encoding="utf-8"))
OUT = Path(__file__).with_name("api-results.json")
TAG = uuid.uuid4().hex[:6].upper()
RESULTS = []

def call(method, path, body=None, token=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, text = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode()
    ms = int((time.time() - t0) * 1000)
    try:
        js = json.loads(text) if text else None
    except ValueError:
        js = text[:200]
    return status, js, ms

def redact(o):
    if isinstance(o, dict):
        return {k: ("<redacted>" if k in ("access_token", "refresh_token", "password", "initial_password", "password_hash") else redact(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [redact(v) for v in o[:3]] + (["..."] if len(o) > 3 else [])
    return o

def step(name, method, path, expected, body=None, token=None, purpose="", auth="", raw=None, ctype="application/json", show=None):
    status, js, ms = call(method, path, body, token, raw, ctype)
    ok = status in (expected if isinstance(expected, (tuple, list)) else (expected,))
    code = js.get("error", {}).get("code") if isinstance(js, dict) and "error" in js else None
    RESULTS.append(dict(name=name, method=method, path=path, purpose=purpose, auth=auth,
                        request=redact(body) if body is not None else ("<raw bytes>" if raw else None),
                        expected=expected, actual=status, error_code=code, ms=ms,
                        response=redact(js) if show is None else show(js), result="PASS" if ok else "FAIL"))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {method:6} {path:55} -> {status} ({expected}) {code or ''} {ms}ms")
    return status, js

# ---------------------------------------------------------------- system
step("health", "GET", "/health", 200, purpose="Liveness", auth="none")
step("ready", "GET", "/ready", 200, purpose="Readiness: DB + PostGIS reachable", auth="none")

# ---------------------------------------------------------------- auth
m = CRED["manager"]
step("login wrong password", "POST", "/api/auth/login", 401,
     body={"identifier": m["email"], "password": "definitely-wrong-password"}, purpose="Bad credential rejected", auth="none")
step("login too-short password (validation)", "POST", "/api/auth/login", 422,
     body={"identifier": m["email"], "password": "short"}, purpose="Schema validation", auth="none")
s, js = step("manager login", "POST", "/api/auth/login", 200,
             body={"identifier": m["email"], "password": m["password"], "client": "mobile"}, purpose="Manager sign-in (JWT + refresh)", auth="none")
MTOK = js["access_token"]; MREF = js.get("refresh_token")
step("auth/me", "GET", "/api/auth/me", 200, token=MTOK, purpose="Current principal + role", auth="JWT")
step("drivers without token", "GET", "/api/drivers", 401, purpose="Unauthenticated -> 401", auth="none")
step("drivers with garbage token", "GET", "/api/drivers", 401, token="not.a.jwt", purpose="Invalid token -> 401", auth="bad JWT")

# ---------------------------------------------------------------- drivers CRUD
phone = "9" + str(int(time.time()))[-9:]
driver_body = {"full_name": f"Day2 Test Driver {TAG}", "initial_password": "Day2-Test-Pass-2026",
               "phone": phone, "licence_number": f"AS01D2{TAG}", "licence_expiry": str(date.today() + timedelta(days=700)),
               "licence_class": "HMV"}
step("driver create - invalid phone (422)", "POST", "/api/drivers", 422, token=MTOK,
     body={**driver_body, "phone": "12"}, purpose="Validation error shape", auth="manager driver:create")
s, drv = step("driver create", "POST", "/api/drivers", 201, token=MTOK, body=driver_body, purpose="CREATE users + drivers (one transaction)", auth="manager driver:create")
DID = drv["id"]
step("driver create - duplicate licence (409)", "POST", "/api/drivers", 409, token=MTOK,
     body={**driver_body, "phone": "9" + str(int(time.time()) + 7)[-9:]}, purpose="Unique constraint surfaces as 409", auth="manager")
step("driver read", "GET", f"/api/drivers/{DID}", 200, token=MTOK, purpose="READ one", auth="manager driver:read")
step("driver list (search)", "GET", f"/api/drivers?search={TAG}&page_size=5", 200, token=MTOK, purpose="READ list, filtered", auth="manager driver:read",
     show=lambda j: {"items": len(j.get("items", [])), "first": redact(j["items"][0]) if j.get("items") else None, "keys": sorted(j.keys())})
step("driver update", "PATCH", f"/api/drivers/{DID}", 200, token=MTOK, body={"licence_class": "HGMV", "emergency_contact_name": "Day2 Contact"}, purpose="UPDATE (partial)", auth="manager driver:update")
step("driver read 404", "GET", f"/api/drivers/{uuid.uuid4()}", 404, token=MTOK, purpose="Unknown id -> 404", auth="manager")

# ---------------------------------------------------------------- trucks CRUD
reg = f"AS01D{int(time.time()) % 9000 + 1000}"
truck_body = {"registration_number": reg, "max_capacity_kg": "9000", "truck_type": "Container", "make": "Tata", "model": "LPT 1109", "manufacture_year": 2021}
step("truck create - bad capacity (422)", "POST", "/api/trucks", 422, token=MTOK, body={**truck_body, "max_capacity_kg": "-5"}, purpose="Validation", auth="manager truck:create")
s, trk = step("truck create", "POST", "/api/trucks", 201, token=MTOK, body=truck_body, purpose="CREATE trucks", auth="manager truck:create")
TID = trk["id"]
step("truck create - duplicate registration (409)", "POST", "/api/trucks", 409, token=MTOK, body=truck_body, purpose="Unique registration -> 409", auth="manager")
step("truck read", "GET", f"/api/trucks/{TID}", 200, token=MTOK, purpose="READ one", auth="manager truck:read")
step("truck update", "PATCH", f"/api/trucks/{TID}", 200, token=MTOK, body={"model": "LPT 1109 EX", "odometer_km": "12000.5"}, purpose="UPDATE", auth="manager truck:update")
step("truck list", "GET", "/api/trucks?page_size=3", 200, token=MTOK, purpose="READ list (cursor paging)", auth="manager truck:read",
     show=lambda j: {"items": len(j.get("items", [])), "keys": sorted(j.keys())})

# ---------------------------------------------------------------- assignments
s, asg = step("assignment create", "POST", "/api/assignments", 201, token=MTOK, body={"driver_id": DID, "truck_id": TID}, purpose="CREATE driver<->truck pairing", auth="manager assignment:create")
AID = asg["id"]
step("assignment create - driver already paired (409)", "POST", "/api/assignments", 409, token=MTOK, body={"driver_id": DID, "truck_id": TID}, purpose="One open pairing per driver/truck", auth="manager")
step("assignment read", "GET", f"/api/assignments/{AID}", 200, token=MTOK, purpose="READ one", auth="manager assignment:read")
step("assignment verify-manual", "POST", f"/api/assignments/{AID}/verify-manual", 200, token=MTOK,
     body={"reported_registration": reg, "note": "Day 2 API evidence - manual verification"}, purpose="UPDATE: manager verifies truck by hand", auth="manager assignment:review")

# ---------------------------------------------------------------- shipments + trips
plan = {"shipment": {"reference_code": f"DAY2-{TAG}", "client_name": "Day 2 Evidence Client", "pickup_address": "Guwahati Depot, Assam",
                     "pickup": {"lat": 26.1445, "lon": 91.7362}, "destination_address": "Shillong Depot, Meghalaya",
                     "destination": {"lat": 25.5788, "lon": 91.8933}, "priority": "NORMAL",
                     "cargo_items": [{"cargo_type": "General", "cargo_name": "Rice bags", "weight_kg": "1200", "quantity": 1}]},
        "trip": {"trip_code": f"D2T-{TAG}", "truck_id": TID, "driver_id": DID,
                 "stops": [{"sequence": 0, "kind": "PICKUP", "location": {"lat": 26.1445, "lon": 91.7362}, "name": "Guwahati Depot"},
                           {"sequence": 1, "kind": "DROPOFF", "location": {"lat": 25.5788, "lon": 91.8933}, "name": "Shillong Depot"}]}}
bad = json.loads(json.dumps(plan)); bad["shipment"]["destination"] = {"lat": 23.0225, "lon": 72.5714}; bad["shipment"]["reference_code"] += "-X"; bad["trip"]["trip_code"] += "-X"
step("trip plan - destination outside NE region (422)", "POST", "/api/trips/plan", 422, token=MTOK, body=bad, purpose="Service-region gate", auth="manager trip:create")
over = json.loads(json.dumps(plan)); over["shipment"]["cargo_items"][0]["weight_kg"] = "20000"; over["shipment"]["reference_code"] += "-H"; over["trip"]["trip_code"] += "-H"
step("trip plan - cargo over truck capacity (422)", "POST", "/api/trips/plan", 422, token=MTOK, body=over, purpose="Capacity gate; shipment NOT left behind (atomic)", auth="manager trip:create")
s, trip = step("trip plan (shipment+trip atomic)", "POST", "/api/trips/plan", 201, token=MTOK, body=plan, purpose="CREATE shipments+cargo_items+trips+trip_stops in one transaction", auth="manager trip:create")
TRIP = trip["id"]
step("shipment list", "GET", f"/api/shipments?page_size=3", 200, token=MTOK, purpose="READ shipments", auth="manager shipment:read",
     show=lambda j: {"items": len(j.get("items", [])), "keys": sorted(j.keys())})
step("trip read", "GET", f"/api/trips/{TRIP}", 200, token=MTOK, purpose="READ one (with shipment summary + stops)", auth="manager trip:read")
step("trip list (server filters)", "GET", f"/api/trips?search=D2T-{TAG}&limit=5", 200, token=MTOK, purpose="READ list with search + total", auth="manager trip:read",
     show=lambda j: {"items": len(j.get("items", [])), "total": j.get("total"), "keys": sorted(j.keys())})
step("trip dispatch without route (422)", "POST", f"/api/trips/{TRIP}/dispatch", 422, token=MTOK, purpose="Route-selection gate: no dispatch without a selected route", auth="manager trip:dispatch")
step("routes list (none yet)", "GET", f"/api/trips/{TRIP}/routes", 200, token=MTOK, purpose="READ trip_routes", auth="manager route:read",
     show=lambda j: {"count": len(j) if isinstance(j, list) else j})
step("trip cancel (state transition)", "POST", f"/api/trips/{TRIP}/cancel", 200, token=MTOK, body={"reason": "Day 2 API evidence run - cancelling test trip"}, purpose="DRAFT -> CANCELLED, audited", auth="manager trip:cancel")
step("trip cancel again (409)", "POST", f"/api/trips/{TRIP}/cancel", 409, token=MTOK, body={"reason": "Day 2 API evidence run - second cancel"}, purpose="Invalid transition -> 409", auth="manager")
step("trip events (journey history)", "GET", f"/api/trips/{TRIP}/events?limit=20", 200, token=MTOK, purpose="READ trip_events", auth="manager trip:read",
     show=lambda j: {"items": len(j.get("items", j) if isinstance(j, dict) else j), "sample": redact((j.get("items", j) if isinstance(j, dict) else j)[:2])})

# ---------------------------------------------------------------- driver side
s, dj = step("driver login (phone)", "POST", "/api/auth/login", 200, body={"identifier": phone, "password": driver_body["initial_password"], "client": "mobile"}, purpose="Driver sign-in", auth="none")
DTOK = dj["access_token"]; DREF = dj.get("refresh_token")
step("driver /me", "GET", "/api/driver/me", 200, token=DTOK, purpose="READ own profile", auth="driver")
step("driver /me/assignment", "GET", "/api/driver/me/assignment", 200, token=DTOK, purpose="READ own assignment", auth="driver")
step("driver /me/trip (none active)", "GET", "/api/driver/me/trip", (200, 404), token=DTOK, purpose="READ own trip", auth="driver")
s, dl = step("driver lists drivers -> scoped to self only", "GET", "/api/drivers", 200, token=DTOK, purpose="driver:read is object-scoped: a driver sees one row (own)", auth="driver driver:read",
     show=lambda j: {"items": len(j.get("items", [])), "only_self": [d["id"] for d in j.get("items", [])] == [DID]})
assert [d["id"] for d in dl["items"]] == [DID], "driver list must contain only the caller"
step("driver forbidden: create driver (403)", "POST", "/api/drivers", 403, token=DTOK, body=driver_body, purpose="Wrong role -> 403", auth="driver")
step("driver forbidden: read another driver (404, no existence leak)", "GET", "/api/drivers/" + CRED["manager"]["user_id"], (403, 404), token=DTOK, purpose="Other driver hidden", auth="driver")
step("driver forbidden: fleet/active (403)", "GET", "/api/fleet/active", 403, token=DTOK, purpose="Location read needs fleet:location_read", auth="driver")
step("driver GPS - malformed fix (422)", "POST", "/api/driver/me/location", 422, token=DTOK,
     body={"fixes": [{"device_fix_id": uuid.uuid4().hex, "lat": 26.14, "lon": 91.73}]},
     purpose="Server decides trip/driver/truck; fix must carry location{lat,lon}+recorded_at", auth="driver location:submit_own")
step("driver GPS without active trip (404)", "POST", "/api/driver/me/location", (404, 409), token=DTOK,
     body={"fixes": [{"device_fix_id": str(uuid.uuid4()), "location": {"lat": 26.14, "lon": 91.73}, "recorded_at": "2026-09-19T06:00:00Z", "speed_kmph": 0}]},
     purpose="Telemetry refused when the driver has no trip to report for", auth="driver location:submit_own")
step("driver refresh (mobile)", "POST", "/api/auth/refresh", 200, body={"refresh_token": DREF, "client": "mobile"}, purpose="Rotate tokens", auth="refresh token")
step("driver refresh reuse (401)", "POST", "/api/auth/refresh", 401, body={"refresh_token": DREF, "client": "mobile"}, purpose="Reused refresh token revoked (family)", auth="stale refresh")

# ---------------------------------------------------------------- manager: fleet reads + system
step("fleet/active", "GET", "/api/fleet/active", 200, token=MTOK, purpose="Trips on the road (PostGIS last fix)", auth="manager fleet:location_read",
     show=lambda j: {"items": len(j.get("items", j) if isinstance(j, dict) else j)})
step("emergencies/active", "GET", "/api/emergencies/active", 200, token=MTOK, purpose="Open emergencies", auth="manager emergency:read",
     show=lambda j: {"items": len(j.get("items", j) if isinstance(j, dict) else j)})
step("system/providers", "GET", "/api/system/providers", 200, token=MTOK, purpose="Provider health + intelligence inventory", auth="JWT",
     show=lambda j: {"keys": sorted(j.keys()) if isinstance(j, dict) else j})

# ---------------------------------------------------------------- teardown (soft): end pairing, retire truck, deactivate driver
step("assignment end", "POST", f"/api/assignments/{AID}/end", 200, token=MTOK, body={"reason": "Day 2 evidence teardown"}, purpose="State transition: ACTIVE -> ENDED", auth="manager assignment:end")
step("truck retire (soft delete)", "POST", f"/api/trucks/{TID}/retire", 200, token=MTOK, body={"reason": "Day 2 evidence teardown"}, purpose="DELETE = retire (deleted_at set, history kept)", auth="manager truck:retire")
step("driver deactivate (soft delete)", "POST", f"/api/drivers/{DID}/deactivate", 200, token=MTOK, body={"reason": "Day 2 evidence teardown"}, purpose="DELETE = deactivate (login disabled, rows kept)", auth="manager driver:deactivate")
step("driver token after deactivation (401)", "GET", "/api/driver/me", (401, 403), token=DTOK, purpose="Deactivated login refused", auth="driver")
step("manager logout", "POST", "/api/auth/logout", 204, token=MTOK, body={"refresh_token": MREF}, purpose="Revoke session", auth="JWT")

passed = sum(r["result"] == "PASS" for r in RESULTS)
print(f"\n{passed}/{len(RESULTS)} PASS")
json.dump(dict(base=BASE, tag=TAG, ran_at=time.strftime("%Y-%m-%dT%H:%M:%S"), passed=passed, total=len(RESULTS), results=RESULTS), open(OUT, "w"), indent=1)
sys.exit(0 if passed == len(RESULTS) else 1)
