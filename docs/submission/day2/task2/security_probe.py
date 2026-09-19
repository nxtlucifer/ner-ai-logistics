"""Day 2 Task 2 - runtime security probe for RASTA AI.

    cd backend && ./.venv/Scripts/python.exe ../docs/submission/day2/task2/security_probe.py

Runs every runtime case in docs/DAY2_TASK2_SECURITY_TEST_PLAN.md against a LOCAL backend
bound to the isolated clone database (see .runtime/start-sec-backend.sh, port 8020).
Nothing here touches a third party; the only hosted calls are HEAD/GET of our own public
pages plus one login/logout on our own API to read cookie flags.

Output: evidence/results.json and DAY2_TASK2_SECURITY_RESULTS.md next to this file.
Tokens, cookies and passwords are redacted before anything is written.
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import uuid
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import jwt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BASE = os.environ.get("SEC_BASE", "http://127.0.0.1:8020")
HOSTED_API = "https://ner-intelligence.onrender.com"
HOSTED_MANAGER = "https://ner-manager.onrender.com"
HOSTED_DRIVER = "https://ner-driver-web.onrender.com"
CREDS = json.loads((ROOT / ".runtime/demo-credentials.private.json").read_text())
HOSTED_CREDS = ROOT / ".runtime/team-credentials.private.json"

RESULTS: list[dict] = []
_TOKEN = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def redact(s: str) -> str:
    s = _TOKEN.sub("<JWT-REDACTED>", s)
    s = re.sub(r'("(?:refresh_token|access_token|password|token)"\s*:\s*")[^"]+"', r"\1<REDACTED>\"", s)
    s = re.sub(r"(ner_refresh=)[^;]+", r"\1<REDACTED>", s)
    for c in [CREDS["manager"]["password"]] + [d["password"] for d in CREDS["drivers"]]:
        s = s.replace(c, "<REDACTED>")
    return s


def record(tid: str, area: str, target: str, verdict: str, observed: str, expected: str, note: str = "") -> None:
    RESULTS.append({"id": tid, "area": area, "target": target, "verdict": verdict,
                    "observed": redact(observed)[:600], "expected": expected, "note": redact(note)[:600]})
    print(f"{verdict:5} {tid:14} {target[:60]:60} {redact(observed)[:80]}")


def body(r: httpx.Response) -> str:
    try:
        return json.dumps(r.json(), separators=(",", ":"))
    except Exception:
        return r.text


def envelope(r: httpx.Response) -> str:
    return f"{r.status_code} {body(r)[:220]}"


def login(c: httpx.Client, ident: str, pw: str, client: str = "web") -> httpx.Response:
    return c.post("/api/auth/login", json={"identifier": ident, "password": pw, "client": client})


def bearer(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def main() -> None:
    (HERE / "evidence").mkdir(exist_ok=True)
    c = httpx.Client(base_url=BASE, timeout=30)
    m = CREDS["manager"]
    dA, dB = CREDS["drivers"][0], CREDS["drivers"][1]

    # ---------------------------------------------------------------- sessions
    r = login(c, m["email"], m["password"], "web")
    assert r.status_code == 200, envelope(r)
    mtok = r.json()["access_token"]
    set_cookie = r.headers.get("set-cookie", "")
    flags = {k: (k.lower() in set_cookie.lower()) for k in ("HttpOnly", "Path=/api/auth", "SameSite", "Secure")}
    record("SEC-SESS-001", "Session", "POST /api/auth/login client=web -> Set-Cookie flags",
           "PASS" if flags["HttpOnly"] and flags["Path=/api/auth"] and flags["SameSite"] and r.json().get("refresh_token") is None else "FAIL",
           f"Set-Cookie: {redact(set_cookie)}; body keys={sorted(r.json().keys())}",
           "HttpOnly, Path=/api/auth, SameSite; Secure outside development; no refresh_token in body",
           "Local backend runs APP_ENV=development, where Secure is deliberately omitted (http dev server); the hosted check below confirms Secure in production.")
    exp = datetime.fromisoformat(r.json()["expires_at"].replace("Z", "+00:00"))
    life = (exp - datetime.now(UTC)).total_seconds() / 60
    record("SEC-SESS-007", "Session", "access token lifetime", "PASS" if 13 <= life <= 15.5 else "FAIL",
           f"expires_at - now = {life:.1f} min", "15 minutes")

    r = login(c, dA["phone"], dA["password"], "mobile")
    assert r.status_code == 200, envelope(r)
    atok = r.json()["access_token"]; arefresh = r.json()["refresh_token"]
    record("SEC-SESS-002", "Session", "POST /api/auth/login client=mobile", "PASS" if "set-cookie" not in r.headers and arefresh else "FAIL",
           f"refresh_token in body={bool(arefresh)}; Set-Cookie present={'set-cookie' in r.headers}", "refresh token in body, no cookie")
    c.cookies.clear()

    # rotation + replay (uses a fresh mobile session so the manager cookie is not involved)
    r = login(c, dB["phone"], dB["password"], "mobile"); btok = r.json()["access_token"]; b_r1 = r.json()["refresh_token"]
    r2 = c.post("/api/auth/refresh", json={"refresh_token": b_r1, "client": "mobile"})
    b_r2 = r2.json().get("refresh_token") if r2.status_code == 200 else None
    replay = c.post("/api/auth/refresh", json={"refresh_token": b_r1, "client": "mobile"})
    after = c.post("/api/auth/refresh", json={"refresh_token": b_r2 or "x" * 40, "client": "mobile"})
    record("SEC-SESS-003", "Session", "POST /api/auth/refresh rotate, replay old token, then use the new one",
           "PASS" if r2.status_code == 200 and b_r2 != b_r1 and replay.status_code == 401 and after.status_code == 401 else "FAIL",
           f"rotate={r2.status_code}; replay old={replay.status_code} {body(replay)[:80]}; new token after replay={after.status_code}",
           "rotate 200 with a different token; replay 401; the whole family revoked so the new token is 401 too")

    r = login(c, dB["phone"], dB["password"], "mobile"); b_r3 = r.json()["refresh_token"]; btok = r.json()["access_token"]
    lo = c.post("/api/auth/logout", json={"refresh_token": b_r3})
    again = c.post("/api/auth/refresh", json={"refresh_token": b_r3, "client": "mobile"})
    record("SEC-SESS-004", "Session", "POST /api/auth/logout then refresh with the same token",
           "PASS" if lo.status_code == 204 and again.status_code == 401 else "FAIL",
           f"logout={lo.status_code}; refresh after logout={again.status_code} {body(again)[:80]}", "204 then 401")
    r = login(c, dB["phone"], dB["password"], "mobile"); btok = r.json()["access_token"]

    # forged / broken tokens
    hdr, payload, sig = atok.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    tampered_claims = dict(claims, role="ADMIN")
    tampered = hdr + "." + base64.urlsafe_b64encode(json.dumps(tampered_claims).encode()).decode().rstrip("=") + "." + sig
    none_tok = jwt.encode(claims, key=None, algorithm="none") if hasattr(jwt, "encode") else "x"
    wrong_sig = jwt.encode(claims, "not-the-server-key", algorithm="HS256")
    expired = jwt.encode(dict(claims, exp=int(time.time()) - 60), "not-the-server-key", algorithm="HS256")
    cases = {"malformed": "abc.def", "wrong-signature": wrong_sig, "alg=none": none_tok, "expired": expired,
             "tampered-role": tampered, "refresh-token-as-bearer": arefresh, "not-a-jwt": "x" * 40}
    obs = {}
    for name, tok in cases.items():
        rr = c.get("/api/driver/me", headers=bearer(tok))
        obs[name] = rr.status_code
    record("SEC-SESS-005", "Session", "GET /api/driver/me with malformed / forged / expired / wrong-type tokens",
           "PASS" if all(v == 401 for v in obs.values()) else "FAIL", json.dumps(obs), "401 for every case")

    # support-view token is read-only
    drivers = c.get("/api/drivers?limit=5", headers=bearer(mtok)).json()["items"]
    dA_id = next(d["id"] for d in drivers if d["phone"].endswith(dA["phone"][-10:])) if any(d["phone"].endswith(dA["phone"][-10:]) for d in drivers) else None
    if dA_id is None:
        dA_id = c.get("/api/driver/me", headers=bearer(atok)).json()["id"]
    ss = c.post(f"/api/drivers/{dA_id}/support-session", headers=bearer(mtok))
    stok = ss.json().get("token", "") if ss.status_code == 200 else ""
    ro_get = c.get("/api/driver/me", headers=bearer(stok))
    ro_post = c.post("/api/driver/me/push-token", headers=bearer(stok), json={"token": "ExponentPushToken[x]"})
    record("SEC-SESS-008", "Session", "manager support-view token: GET allowed, POST refused",
           "PASS" if ss.status_code == 200 and ro_get.status_code == 200 and ro_post.status_code == 403 else "FAIL",
           f"issue={ss.status_code}; GET /api/driver/me={ro_get.status_code}; POST push-token={ro_post.status_code} {body(ro_post)[:90]}",
           "GET 200, POST 403 (read-only)")

    # ---------------------------------------------------------------- stored XSS via API
    xss = "<img src=x onerror=alert(1)>"
    xss2 = "\"><svg onload=alert(1)>"
    stamp = uuid.uuid4().hex[:6]
    drv = c.post("/api/drivers", headers=bearer(mtok), json={
        "full_name": f"{xss} SEC{stamp}", "initial_password": "Probe-Pass-12345", "phone": "+91" + str(7000000000 + int(stamp, 16) % 999999999).zfill(10),
        "licence_number": f"XSS{stamp}", "licence_expiry": "2030-01-01", "emergency_contact_name": xss2})
    trk = c.post("/api/trucks", headers=bearer(mtok), json={"registration_number": f"AS01XS{int(stamp, 16) % 9000 + 1000}", "max_capacity_kg": 9000, "make": xss})
    plan = c.post("/api/trips/plan", headers=bearer(mtok), json={
        "shipment": {"reference_code": f"XSS-{stamp}", "client_name": xss, "pickup_address": xss2 + " Guwahati", "pickup": {"lat": 26.14, "lon": 91.73},
                     "destination_address": "Shillong " + xss, "destination": {"lat": 25.57, "lon": 91.88},
                     "cargo_items": [{"cargo_type": "general", "cargo_name": xss, "weight_kg": 100}]},
        "trip": {"trip_code": f"XSS-{stamp}", "truck_id": trk.json().get("id") if trk.status_code == 201 else str(uuid.uuid4()),
                 "driver_id": drv.json().get("id") if drv.status_code == 201 else str(uuid.uuid4())}})
    stored_ok = drv.status_code == 201 and drv.json()["full_name"].startswith(xss) and trk.status_code == 201 and plan.status_code in (201, 200)
    record("SEC-XSS-001", "XSS", "store payloads through POST /api/drivers, /api/trucks, /api/trips/plan",
           "PASS" if stored_ok else "FAIL",
           f"driver={drv.status_code} name={drv.json().get('full_name', envelope(drv))[:60]!r}; truck={trk.status_code}; plan={plan.status_code} {'' if plan.status_code in (200, 201) else body(plan)[:120]}",
           "accepted as plain text and echoed back as a JSON string; the browser check (SEC-XSS-002) shows it is rendered inert",
           "Stored in the isolated clone only. The same rows are used by the browser screenshot.")
    (HERE / "evidence" / "xss_fixture.json").write_text(json.dumps({"driver_id": drv.json().get("id"), "truck_id": trk.json().get("id"), "trip_code": f"XSS-{stamp}", "stamp": stamp}))
    rr = c.get("/api/trips/<script>alert(1)</script>", headers=bearer(mtok))
    rr2 = c.get("/api/drivers", params={"search": "<script>alert(1)</script>"}, headers=bearer(mtok))
    record("SEC-XSS-005", "XSS", "reflected: payload in path and query", "PASS" if rr.headers.get("content-type", "").startswith("application/json") and "<script>" not in rr.text and rr2.headers.get("content-type", "").startswith("application/json") else "FAIL",
           f"path: {rr.status_code} {rr.headers.get('content-type')} reflected={'<script>' in rr.text}; query: {rr2.status_code} reflected={'<script>' in rr2.text}",
           "JSON error envelope, application/json, input value never echoed")

    # ---------------------------------------------------------------- misconfiguration
    with httpx.Client(timeout=30, follow_redirects=False) as h:
        docs = {p: h.get(HOSTED_API + p).status_code for p in ("/docs", "/openapi.json", "/redoc")}
        record("SEC-CFG-001", "Misconfiguration", f"hosted {HOSTED_API} /docs /openapi.json /redoc", "PASS" if all(v == 404 for v in docs.values()) else "FAIL",
               json.dumps(docs) + f"; local development: /docs={c.get('/docs').status_code}", "404 in production; open only when APP_ENV=development")
        pre = c.options("/api/auth/login", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        okp = c.options("/api/auth/login", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        record("SEC-CFG-003", "Misconfiguration", "CORS preflight from unknown vs allowed origin",
               "PASS" if "access-control-allow-origin" not in pre.headers and okp.headers.get("access-control-allow-origin") == "http://localhost:5173" and okp.headers.get("access-control-allow-origin") != "*" else "FAIL",
               f"evil.example -> {pre.status_code} ACAO={pre.headers.get('access-control-allow-origin')}; localhost:5173 -> {okp.status_code} ACAO={okp.headers.get('access-control-allow-origin')} credentials={okp.headers.get('access-control-allow-credentials')}",
               "no ACAO for unknown origins; exact origin (never *) for the allow-list")
        rr = c.get("/ready")
        leak = any(k in rr.text for k in ("@", "postgresql://", "password", "55432", "supabase.co"))
        record("SEC-CFG-006", "Misconfiguration", "GET /ready", "PASS" if rr.status_code == 200 and not leak else "FAIL", envelope(rr), "provider enum only; no host, DSN or credential")
        bad = c.post("/api/auth/login", content=b'{"identifier": "x@y.z", "password": ', headers={"Content-Type": "application/json"})
        record("SEC-CFG-005", "Misconfiguration", "malformed JSON body (error containment)", "PASS" if bad.status_code == 422 and "Traceback" not in bad.text and "File \"" not in bad.text else "FAIL", envelope(bad),
               "422 VALIDATION_ERROR envelope, no stack trace; DB errors are 503 DATABASE_UNAVAILABLE (observed earlier in this session when the clone lacked migration 0013)")
        srv = c.get("/health").headers.get("server", "")
        record("SEC-CFG-009", "Misconfiguration", "Server response header", "INFO", f"local: server={srv!r}; hosted: Server=cloudflare, x-render-origin-server=uvicorn", "no version string (uvicorn sends its bare name)")

    # ---------------------------------------------------------------- headers
    def hdrs(resp: httpx.Response) -> dict:
        want = ("x-content-type-options", "referrer-policy", "cache-control", "content-security-policy", "x-frame-options", "permissions-policy", "strict-transport-security")
        return {k: resp.headers.get(k) for k in want}
    local_api = hdrs(c.get("/api/auth/me", headers=bearer(mtok)))
    with httpx.Client(timeout=30) as h:
        hosted_api = hdrs(h.get(HOSTED_API + "/api/auth/me"))
        hosted_mgr = hdrs(h.head(HOSTED_MANAGER + "/"))
        hosted_drv = hdrs(h.head(HOSTED_DRIVER + "/"))
    need_api = ("x-content-type-options", "referrer-policy", "cache-control", "content-security-policy")
    record("SEC-HDR-001", "Headers", "API security headers (local backend, GET /api/auth/me)",
           "PASS" if all(local_api[k] for k in need_api) and "no-store" in (local_api["cache-control"] or "") else "FAIL", json.dumps(local_api),
           "nosniff; Referrer-Policy; Cache-Control no-store on /api; CSP frame-ancestors 'none'")
    record("SEC-HDR-001h", "Headers", f"API security headers (hosted {HOSTED_API})", "PASS" if all(hosted_api[k] for k in need_api) and hosted_api["strict-transport-security"] else "FINDING", json.dumps(hosted_api),
           "same as local plus HSTS", "The hosted service redeploys from main; until the fix is pushed it serves the pre-fix headers.")
    need_web = ("x-content-type-options", "referrer-policy", "strict-transport-security")
    record("SEC-HDR-002", "Headers", f"static web headers (hosted manager + driver web)", "PASS" if all(hosted_mgr[k] for k in need_web) and (hosted_mgr["x-frame-options"] or "frame-ancestors" in (hosted_mgr["content-security-policy"] or "")) else "FINDING",
           f"manager={json.dumps(hosted_mgr)}; driver={json.dumps(hosted_drv)}", "nosniff, Referrer-Policy, HSTS, X-Frame-Options/frame-ancestors, Permissions-Policy")

    # ---------------------------------------------------------------- file upload
    up = lambda tok, kind, data, **q: c.post("/api/files", params={"kind": kind, **q}, headers={**bearer(tok), "Content-Type": "application/octet-stream"}, content=data)
    r_png = up(atok, "PROFILE_PHOTO", PNG); r_jpg = up(atok, "TRUCK_VERIFICATION", JPEG); r_pdf = up(atok, "DRIVER_DOCUMENT", PDF)
    record("SEC-UP-001", "File upload", "POST /api/files valid PNG / JPEG / PDF as driver", "PASS" if r_png.status_code == 201 and r_pdf.status_code == 201 and r_png.json()["content_type"] == "image/png" else "FAIL",
           f"png={r_png.status_code} {r_png.json().get('content_type')}; jpeg(no assignment)={r_jpg.status_code}; pdf={r_pdf.status_code} {r_pdf.json().get('content_type')}", "201, type from magic bytes")
    bad = {"text": b"hello world, this is not an image", "html": b"<html><script>alert(1)</script></html>", "svg": b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>",
           "gif": b"GIF89a" + b"\x00" * 20, "empty": b"", "exe-magic": b"MZ" + b"\x00" * 60, "renamed-.jpg-text": b"JPEG but really text"}
    obs = {k: up(atok, "PROFILE_PHOTO", v).status_code for k, v in bad.items()}
    record("SEC-UP-002", "File upload", "POST /api/files text / HTML / SVG / GIF / empty / EXE bytes", "PASS" if all(v == 415 for v in obs.values()) else "FAIL", json.dumps(obs), "415 UNSUPPORTED_FILE_TYPE for everything that is not JPEG/PNG/PDF by magic bytes")
    rr = up(atok, "PROFILE_PHOTO", PDF)
    record("SEC-UP-003", "File upload", "PDF uploaded as PROFILE_PHOTO", "PASS" if rr.status_code == 415 else "FAIL", envelope(rr), "415")
    big = up(atok, "DRIVER_DOCUMENT", PDF + b"\x00" * (5 * 1024 * 1024)); photo = up(atok, "PROFILE_PHOTO", PNG + b"\x00" * (600 * 1024))
    record("SEC-UP-004", "File upload", "5 MB + 1 document; 600 KB profile photo", "PASS" if big.status_code == 413 and photo.status_code == 413 else "FAIL",
           f"5MB+1 -> {big.status_code} {body(big)[:60]}; 600KB photo -> {photo.status_code} {body(photo)[:60]}", "413 for both")
    poly = up(atok, "PROFILE_PHOTO", JPEG + b"<html><script>alert(1)</script></html>")
    served = c.get(poly.json()["url"], headers=bearer(atok)) if poly.status_code == 201 else None
    record("SEC-UP-005", "File upload", "JPEG polyglot containing <script>, then GET it", "PASS" if served is not None and served.headers.get("content-type") == "image/jpeg" and served.headers.get("x-content-type-options") == "nosniff" else "FINDING",
           f"upload={poly.status_code}; GET content-type={served.headers.get('content-type') if served else None} nosniff={served.headers.get('x-content-type-options') if served else None} cache={served.headers.get('cache-control') if served else None}",
           "served as image/jpeg with X-Content-Type-Options: nosniff, so a browser cannot sniff it into HTML")
    dB_id = c.get("/api/driver/me", headers=bearer(btok)).json()["id"]
    before = c.get("/api/driver/me/profile", headers=bearer(btok)).json().get("photo_url")
    cross = up(atok, "PROFILE_PHOTO", PNG, driver_id=dB_id)
    after_b = c.get("/api/driver/me/profile", headers=bearer(btok)).json().get("photo_url")
    mine = c.get("/api/driver/me/profile", headers=bearer(atok)).json().get("photo_url")
    record("SEC-UP-006", "File upload", "driver A uploads PROFILE_PHOTO with ?driver_id=<driver B>", "PASS" if cross.status_code == 201 and after_b == before and mine == cross.json()["url"] else "FAIL",
           f"status={cross.status_code}; B.photo_url unchanged={after_b == before}; A.photo_url == new file={mine == cross.json().get('url')}", "driver_id ignored for a non-manager; the file stays owned by A")
    anon = c.post("/api/files", params={"kind": "PROFILE_PHOTO"}, content=PNG)
    record("SEC-UP-007", "File upload", "POST /api/files without a token", "PASS" if anon.status_code == 401 else "FAIL", envelope(anon), "401")
    a_file = r_png.json()["url"]
    as_b = c.get(a_file, headers=bearer(btok)); as_m = c.get(a_file, headers=bearer(mtok)); as_a = c.get(a_file, headers=bearer(atok)); as_none = c.get(a_file)
    record("SEC-API-004", "API security", "GET /api/files/{A's photo} as driver B / manager / owner / anonymous", "PASS" if as_b.status_code == 404 and as_m.status_code == 200 and as_a.status_code == 200 and as_none.status_code == 401 else "FAIL",
           f"B={as_b.status_code}; manager={as_m.status_code}; owner={as_a.status_code}; anonymous={as_none.status_code}", "B 404 (not 403: the id space is not an oracle), manager 200, owner 200, anonymous 401")

    # ---------------------------------------------------------------- API security
    spec = c.get("/openapi.json").json()["paths"]
    obs = {}
    for path, methods in spec.items():
        for meth in methods:
            if path in ("/health", "/ready", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout"):
                continue  # public by design: login/refresh take credentials; logout is always 204
            p = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
            rr = c.request(meth.upper(), p, json={} if meth in ("post", "patch") else None)
            if rr.status_code != 401:
                obs[f"{meth.upper()} {path}"] = rr.status_code
    n = sum(len(v) for k, v in spec.items() if k not in ("/health", "/ready", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout"))
    record("SEC-API-001", "API security", f"every mounted route ({n} operations) without a token", "PASS" if not obs else "FAIL",
           f"401 on {n - len(obs)}/{n}; exceptions={json.dumps(obs)}", "401 UNAUTHENTICATED on every operation except /health, /ready and the three public auth routes")
    # Manager-only surfaces must be 403. DRIVER_READ / TRUCK_READ / ASSIGNMENT_READ are granted to a
    # driver for their OWN rows, so those lists must come back scoped to the caller, never fleet-wide.
    forbidden = ["/api/trips", "/api/shipments", "/api/fleet/active", "/api/emergencies/active"]
    obs = {p: c.get(p, headers=bearer(atok)).status_code for p in forbidden}
    obs["POST /api/drivers"] = c.post("/api/drivers", headers=bearer(atok), json={"full_name": "x y", "initial_password": "Probe-Pass-12345", "phone": "9000000001", "licence_number": "ABCD1", "licence_expiry": "2030-01-01"}).status_code
    obs["POST /api/emergencies/sweep"] = c.post("/api/emergencies/sweep", headers=bearer(atok)).status_code
    obs["POST /api/trucks"] = c.post("/api/trucks", headers=bearer(atok), json={"registration_number": "AS01AB1234", "max_capacity_kg": 1}).status_code
    obs[f"GET /api/drivers/{{B}}"] = c.get(f"/api/drivers/{dB_id}", headers=bearer(atok)).status_code
    record("SEC-API-002", "API security", "driver token on manager-only endpoints", "PASS" if all(v in (403, 404) for v in obs.values()) else "FAIL", json.dumps(obs), "403 FORBIDDEN (404 for another driver's row: the id space is not an oracle)")
    dl = c.get("/api/drivers?limit=100", headers=bearer(atok)).json()["items"]
    tl = c.get("/api/trucks?limit=100", headers=bearer(atok)).json()["items"]
    my_asg = c.get("/api/driver/me/assignment", headers=bearer(atok))
    my_truck = ((my_asg.json() or {}).get("truck") or {}).get("id") if my_asg.status_code == 200 else None
    fleet_n = len(c.get("/api/trucks?limit=100", headers=bearer(mtok)).json()["items"])
    record("SEC-XS-004", "Excessive access", "driver lists GET /api/drivers and GET /api/trucks (scoping)",
           "PASS" if [d["id"] for d in dl] == [dA_id] and all(t["id"] == my_truck for t in tl) else "FINDING",
           f"/api/drivers -> {len(dl)} row(s), ids={[d['id'][:8] for d in dl]} (self={dA_id[:8]}); /api/trucks -> {len(tl)} row(s) for the driver vs {fleet_n} for the manager; driver's assigned truck={str(my_truck)[:8]}",
           "drivers: own row only; trucks: only the truck(s) assigned to the caller, never the fleet register")
    docs_b = c.get(f"/api/drivers/{dB_id}/documents", headers=bearer(atok))
    record("SEC-API-005", "API security", "driver A reads GET /api/drivers/{B}/documents", "PASS" if docs_b.status_code == 404 else "FINDING",
           f"{docs_b.status_code} {body(docs_b)[:160]}", "404 (scoped like GET /api/drivers/{id}); a driver reads their own documents at /api/driver/me/documents")
    record("SEC-XS-005", "Excessive access", "driver creates a driver account", "PASS" if obs["POST /api/drivers"] == 403 else "FAIL", str(obs["POST /api/drivers"]), "403")
    drv_paths = ["/api/driver/me", "/api/driver/me/trip", "/api/driver/me/documents", "/api/ai/status"]
    obs = {p: c.get(p, headers=bearer(mtok)).status_code for p in drv_paths}
    obs["POST /api/driver/me/location"] = c.post("/api/driver/me/location", headers=bearer(mtok), json={"fixes": []}).status_code
    record("SEC-API-003", "API security", "manager token on driver-only endpoints", "PASS" if all(v == 403 for v in obs.values()) else "FAIL", json.dumps(obs), "403 (a manager has no driver profile)")
    r404 = c.get(f"/api/trips/{uuid.uuid4()}", headers=bearer(mtok)); r422 = c.get("/api/trips/not-a-uuid", headers=bearer(mtok))
    record("SEC-API-006", "API security", "GET /api/trips/{unknown uuid} and /{not-a-uuid}", "PASS" if r404.status_code == 404 and r422.status_code == 422 else "FAIL", f"{r404.status_code} / {r422.status_code}", "404 / 422")
    ma1 = c.patch(f"/api/drivers/{dB_id}", headers=bearer(mtok), json={"full_name": "Mass Assign", "role": "ADMIN", "user_id": str(uuid.uuid4()), "id": str(uuid.uuid4())})
    ma2 = c.post("/api/trips/plan", headers=bearer(mtok), json={"shipment": {"reference_code": "MA-1", "client_name": "x", "pickup_address": "a", "pickup": {"lat": 26.1, "lon": 91.7}, "destination_address": "b", "destination": {"lat": 25.5, "lon": 91.8}, "cargo_items": [{"cargo_type": "g", "cargo_name": "n", "weight_kg": 1}]},
                                                                "trip": {"trip_code": "MA-1", "truck_id": str(uuid.uuid4()), "driver_id": str(uuid.uuid4()), "status": "DELIVERED", "id": str(uuid.uuid4())}})
    record("SEC-API-007", "API security", "mass assignment: role/id/user_id on PATCH driver, status/id on trip plan", "PASS" if ma1.status_code == 422 and ma2.status_code == 422 else "FAIL",
           f"PATCH driver -> {ma1.status_code} {body(ma1)[:100]}; plan -> {ma2.status_code}", "422 (extra='forbid' on every request model)")
    m1 = c.delete(f"/api/drivers/{dB_id}", headers=bearer(mtok)); m2 = c.put("/api/trips", headers=bearer(mtok), json={})
    record("SEC-API-008", "API security", "DELETE /api/drivers/{id}; PUT /api/trips", "PASS" if m1.status_code == 405 and m2.status_code == 405 else "FAIL", f"{m1.status_code} / {m2.status_code}", "405 METHOD_NOT_ALLOWED")
    ssrf = ["http://127.0.0.1:8020/health", "http://169.254.169.254/latest/meta-data/", "http://localhost/", "http://maps.google.com.evil.example/maps", "http://maps.google.com@evil.example/", "file:///etc/passwd", "http://[::1]/", "http://10.0.0.1/"]
    obs = {}
    for u in ssrf:
        rr = c.post("/api/geocoding/resolve-link", headers=bearer(mtok), json={"url": u})
        obs[u] = (rr.status_code, rr.json().get("error", {}).get("code") if rr.status_code >= 400 else "RESOLVED")
    record("SEC-API-009", "API security", "SSRF: POST /api/geocoding/resolve-link with internal / look-alike hosts", "PASS" if all(v == (400, "NOT_A_MAPS_LINK") for v in obs.values()) else "FAIL", json.dumps(obs), "400 NOT_A_MAPS_LINK before any request is made")
    trips = c.get("/api/trips?limit=50", headers=bearer(mtok)).json()["items"]
    other = next((t for t in trips if t.get("driver_id") not in (dA_id, None)), None)
    stop_id = None
    if other:
        full = c.get(f"/api/trips/{other['id']}", headers=bearer(mtok)).json()
        stop_id = (full.get("stops") or [{}])[0].get("id")
    rr = c.post(f"/api/driver/me/trip/stops/{stop_id or uuid.uuid4()}/arrive", headers=bearer(atok), json={})
    record("SEC-API-010", "API security", "driver A marks arrival at a stop of another driver's trip", "PASS" if rr.status_code in (404, 409, 422) else "FAIL", envelope(rr), "404/409: the subject trip comes from the token, never from the path")

    # ---------------------------------------------------------------- excessive access
    obs = {}
    for lim in ("0", "-1", "999999", "abc", "100", "101"):
        rr = c.get("/api/trips", params={"limit": lim}, headers=bearer(mtok))
        obs[lim] = (rr.status_code, len(rr.json().get("items", [])) if rr.status_code == 200 else rr.json().get("error", {}).get("code"))
    record("SEC-XS-001", "Excessive access", "GET /api/trips?limit=0/-1/999999/abc/100/101", "PASS" if all(obs[k][0] == 422 for k in ("0", "-1", "999999", "abc", "101")) and obs["100"][0] == 200 else "FAIL", json.dumps(obs), "422 outside 1..100; 100 accepted")
    tid_ = trips[0]["id"] if trips else str(uuid.uuid4())
    rr = c.get(f"/api/trips/{tid_}/track", params={"limit": 100000}, headers=bearer(mtok))
    record("SEC-XS-002", "Excessive access", "GET /api/trips/{id}/track?limit=100000", "PASS" if rr.status_code == 422 else "FAIL", envelope(rr), "422 (max 1000)")
    me = c.get("/api/auth/me", headers=bearer(mtok)).text; dl = c.get("/api/drivers?limit=5", headers=bearer(mtok)).text
    # Give driver A one document with a real number so the masking check is not vacuous.
    c.post("/api/driver/me/documents", headers=bearer(atok), json={"doc_type": "DRIVING_LICENCE", "doc_number": f"AS01-2026-{stamp.upper()}", "expires_on": "2030-01-01"})
    docs = c.get(f"/api/drivers/{dA_id}/documents", headers=bearer(mtok)).json()
    docs = docs if isinstance(docs, list) else docs.get("items", [])
    masked_ok = bool(docs) and all(("number_masked" in d and (d["number_masked"] is None or d["number_masked"].startswith("••••"))) and "doc_number" not in d and stamp.upper() not in json.dumps(d) for d in docs)
    record("SEC-XS-003", "Excessive access", "data minimisation: /api/auth/me, /api/drivers, /api/drivers/{id}/documents", "PASS" if "password_hash" not in me and "password_hash" not in dl and "base_salary" not in dl and masked_ok else "FAIL",
           f"password_hash in me={'password_hash' in me}; in drivers list={'password_hash' in dl}; salary in list={'base_salary' in dl}; documents masked={masked_ok} ({len(docs)} rows)",
           "no hash anywhere; salary only via driver:read_sensitive; document numbers as •••• 1234")

    # ---------------------------------------------------------------- disabled account
    # A throwaway driver: the demo drivers hold open trips, and a driver on a trip
    # cannot be deactivated (409 - a business rule, not a security control).
    tmp = c.post("/api/drivers", headers=bearer(mtok), json={"full_name": f"Probe Disabled {stamp}", "initial_password": "Probe-Pass-12345",
                 "phone": "+91" + str(8000000000 + int(stamp, 16) % 999999999).zfill(10), "licence_number": f"DIS{stamp}", "licence_expiry": "2030-01-01"})
    tmp_id, tmp_phone = tmp.json()["id"], tmp.json()["phone"]
    ttok = login(c, tmp_phone, "Probe-Pass-12345", "mobile").json()["access_token"]
    de = c.post(f"/api/drivers/{tmp_id}/deactivate", headers=bearer(mtok), params={"reason": "security probe"})
    rr = c.get("/api/driver/me", headers=bearer(ttok)); rl = login(c, tmp_phone, "Probe-Pass-12345", "mobile")
    record("SEC-SESS-006", "Session", "deactivate a driver, then use their still-valid access token and log in again", "PASS" if de.status_code in (200, 204) and rr.status_code == 401 and rl.status_code == 401 else "FAIL",
           f"deactivate={de.status_code}; token after={rr.status_code} {body(rr)[:60]}; login after={rl.status_code}", "401 immediately (role and status are read from the users row on every request)",
           "Done on the isolated clone only; the clone is dropped after the assessment.")

    # ---------------------------------------------------------------- SQL injection
    payloads = ["'", "''", "' OR '1'='1", "\" OR \"1\"=\"1", "'; SELECT 1 --", "') OR ('1'='1", "admin'--", "%' OR 1=1 --"]
    obs = {}
    ok = True
    for p in payloads:
        rr = login(c, p if len(p) >= 3 else p + "xx", "anything-long-enough", "web")
        rr2 = login(c, m["email"], p + "xxxxxxxx", "web") if payloads.index(p) < 3 else rr
        obs[p] = (rr.status_code, rr2.status_code)
        ok &= rr.status_code == 401 and rr2.status_code == 401
        ok &= "psycopg" not in rr.text and "SELECT" not in rr.text.upper().replace("SELECT 1", "")
    record("SEC-SQLI-001", "SQL Injection", "POST /api/auth/login identifier + password payloads",
           "PASS" if ok else "FAIL", json.dumps(obs), "401 (or 422 for schema) for every payload; no DB error text",
           "Login uses a parameterised ILIKE/= on the users table and verifies against a dummy Argon2 hash when no user matches.")
    for tid, path in (("SEC-SQLI-002", "/api/drivers"), ("SEC-SQLI-003", "/api/trucks"), ("SEC-SQLI-004", "/api/trips")):
        obs = {}
        ok = True
        for p in payloads:
            rr = c.get(path, params={"search": p}, headers=bearer(mtok))
            n = len(rr.json().get("items", [])) if rr.status_code == 200 else None
            obs[p] = (rr.status_code, n)
            ok &= rr.status_code == 200 and "psycopg" not in rr.text
        # a literal search that should match: prove the search works so "0 rows" is not a broken endpoint
        rr = c.get(path, headers=bearer(mtok)); total = len(rr.json()["items"])
        record(tid, "SQL Injection", f"GET {path}?search=<payload>", "PASS" if ok else "FAIL",
               f"{json.dumps(obs)}; unfiltered page={total} rows", "200 with literal match (0 rows), never 5xx",
               "ilike() binds the pattern as a parameter; % and _ are LIKE wildcards only (informational).")
    obs = {}
    raw = ["' OR 1=1--", base64.urlsafe_b64encode(b'{"t":"\' OR 1=1--","i":"x"}').decode().rstrip("="),
           base64.urlsafe_b64encode(b'{"t":"2026-01-01T00:00:00+00:00","i":"1 OR 1=1"}').decode().rstrip("="), "AAAA", ""]
    for cur in raw:
        rr = c.get("/api/trips", params={"cursor": cur}, headers=bearer(mtok))
        obs[cur[:24]] = (rr.status_code, (rr.json().get("error", {}).get("code") if rr.status_code != 200 else "ok"))
    record("SEC-SQLI-005", "SQL Injection", "GET /api/trips?cursor=<tampered>",
           "PASS" if all(v[0] in (200, 400) for v in obs.values()) and any(v[1] == "INVALID_CURSOR" for v in obs.values()) else "FAIL",
           json.dumps(obs), "400 INVALID_CURSOR for malformed cursors; empty cursor = first page")
    rr = c.get("/api/trips/' OR 1=1--", headers=bearer(mtok)); rr2 = c.get("/api/trips", params={"trip_status": "' OR 1=1--"}, headers=bearer(mtok))
    record("SEC-SQLI-006", "SQL Injection", "GET /api/trips/<sql> (UUID path)", "PASS" if rr.status_code == 422 else "FAIL", envelope(rr), "422 VALIDATION_ERROR")
    record("SEC-SQLI-007", "SQL Injection", "GET /api/trips?trip_status=<sql> (enum filter)", "PASS" if rr2.status_code == 422 else "FAIL", envelope(rr2), "422 VALIDATION_ERROR")

    # ---------------------------------------------------------------- rate limiting (11 attempts on one fake identifier)
    # Every login above shares this address's 20/min budget, so wait for the fixed window to
    # reset first - which is itself the recovery check: the first attempt after the wait is 401 again.
    print("waiting 61 s for the per-IP login window to reset ...")
    time.sleep(61)
    ident = f"probe-{stamp}@example.invalid"
    codes = []
    retry = None
    for i in range(11):
        rr = login(c, ident, "wrong-password-xx", "web")
        codes.append(rr.status_code)
        if rr.status_code == 429:
            retry = rr.headers.get("retry-after"); break
    record("SEC-RL-001", "Rate limiting", "POST /api/auth/login: repeated wrong passwords on one identifier", "PASS" if codes[-1] == 429 and codes.count(401) == 10 and retry else "FAIL",
           f"codes={codes}; Retry-After={retry}", "10 x 401 then 429 with Retry-After (LOGIN_RATE_LIMIT_PER_IDENTIFIER=10)", "Per-IP limit is 20/min; window reset is proven by tests/test_rate_limit.py with an injected clock.")

    # ---------------------------------------------------------------- hosted cookie flags (one login + logout on our own API)
    if HOSTED_CREDS.exists():
        try:
            hc = json.loads(HOSTED_CREDS.read_text())
            acct = hc["people"][0]  # the team's own manager sign-in on our own deployment
            ident_h, pw_h = acct["email"], acct["password"]
            with httpx.Client(base_url=HOSTED_API, timeout=40) as h:
                r = login(h, ident_h, pw_h, "web")
                sc = r.headers.get("set-cookie", "")
                ok = r.status_code == 200 and "secure" in sc.lower() and "httponly" in sc.lower() and r.json().get("refresh_token") is None
                record("SEC-SESS-001h", "Session", f"hosted {HOSTED_API} login client=web -> Set-Cookie flags", "PASS" if ok else ("SKIP" if r.status_code != 200 else "FAIL"),
                       f"status={r.status_code}; Set-Cookie: {redact(sc)}", "Secure; HttpOnly; SameSite=None (cross-site static host); Path=/api/auth")
                h.post("/api/auth/logout", json={})
        except Exception as exc:  # noqa: BLE001
            record("SEC-SESS-001h", "Session", "hosted login cookie flags", "SKIP", f"{type(exc).__name__}", "n/a")

    # ---------------------------------------------------------------- write out
    (HERE / "evidence").mkdir(exist_ok=True)
    (HERE / "evidence" / "results.json").write_text(json.dumps({"base": BASE, "ran_at": datetime.now(UTC).isoformat(), "results": RESULTS}, indent=1))
    counts = {}
    for x in RESULTS:
        counts[x["verdict"]] = counts.get(x["verdict"], 0) + 1
    lines = ["# Day 2 Task 2 — Security Test Results (runtime probe)", "",
             f"Run: {datetime.now(UTC).strftime('%d %B %Y %H:%M UTC')} · target `{BASE}` (isolated clone `ner_logistics_sec`) · hosted reads against our own Render services only.", "",
             "Verdicts: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())), "",
             "| ID | Area | Target | Verdict | Observed | Expected |", "| --- | --- | --- | --- | --- | --- |"]
    def esc(v: str) -> str:
        return v.replace("|", "\\|")
    for x in RESULTS:
        lines.append(f"| {x['id']} | {x['area']} | {esc(x['target'])} | {x['verdict']} | {esc(x['observed'])} | {esc(x['expected'])} |")
    lines += ["", "Notes:", ""] + [f"- **{x['id']}** — {x['note']}" for x in RESULTS if x["note"]]
    (HERE / "DAY2_TASK2_SECURITY_RESULTS.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print("\n" + json.dumps(counts))


if __name__ == "__main__":
    main()
