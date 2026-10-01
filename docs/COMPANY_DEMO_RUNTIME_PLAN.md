# Company demo runtime plan (1 Oct 2026, 3:00 PM IST)

Local-first. Nothing here deploys, pushes or touches hosted Supabase/Render.

```text
PRIMARY_MODE   = LOCAL: backend (current code) + manager presentation build + PostgreSQL/PostGIS on this laptop;
                 driver APK 1.0.27 on the phone over USB (adb reverse). No Wi-Fi or internet needed for the core flow,
                 except map tiles, routing (OSRM) and live weather/warnings, which degrade to UNKNOWN/UNAVAILABLE.
FALLBACK_MODE  = Same local stack, driver shown on the laptop instead of the phone (driver web, see below),
                 or the pre-recorded evidence screenshots in .runtime/evidence/company-demo/.
                 The hosted site (ner-manager.onrender.com) runs the OLD build e4043ce: show it only as
                 "the deployed pilot", never as today's code.
BACKEND_URL    = http://127.0.0.1:8010   (ready check: http://127.0.0.1:8010/ready)
MANAGER_URL    = http://localhost:4173   (production-mode bundle: no DEV badge; built with --mode company-demo)
PHONE_API_MODE = USB: `adb reverse tcp:8010 tcp:8010`; APK built for http://127.0.0.1:8010 (lan-demo profile,
                 cleartext allowed for 127.0.0.1 only; separate package ...preview.landemo, label "RASTA AI LAN DEMO")
PREWARM        = run start.sh at 14:30; then open the manager once (login page) and the driver app once.
                 No keep-alive loops.
```

## Start / stop / reset

```bash
bash .runtime/demo/start.sh            # DB, backend :8010, manager :4173, phone tunnel - prints only observed state
bash .runtime/demo/start.sh --rebuild  # also rebuilds the manager bundle
.runtime/production/repro/phase1/venv_shim/Scripts/python.exe .runtime/demo/reset.py   # release demo trips (idempotent)
bash .runtime/demo/stop.sh             # stops only what start.sh started
```

Expected `start.sh` output: `DB READY`, `BACKEND READY (:8010)`, `GEOGRAPHY LOADED (Survey of India OVSF/1M/7)`,
`MANAGER READY`, `PHONE READY (USB, adb reverse tcp:8010)`.

## Data

- Database: `ner_logistics_cert` (local, 127.0.0.1:55432), migrated 0015 -> 0016 -> 0017 (driver breaks) on 1 Oct.
  Backup taken first: `.runtime/demo/backup/ner_logistics_cert_pre0016_*.dump` / `*pre0017*.dump` (`pg_restore -c -d ner_logistics_cert <file>` to roll back).
- Geography: Survey of India Administrative Boundary Database OVSF/1M/7, downloaded by the owner 1 Oct 07:26 IST.
  Raw zip + SHA-256 in `.runtime/geo/survey-of-india/raw/`; preprocessing recorded in `.runtime/geo/survey-of-india/PREPROCESS.md`
  (reprojection LCC_WGS84 -> EPSG:4326, Z dropped, districts filtered to the 8 NER states). Imported: India outline,
  40 state features (8 NER), 131 NER districts, 0 invalid geometries, 0 repairs.
  Post-import data step `.runtime/demo/post_soi_import.sql`: decodes the SoI font glyph `>` = long a (e.g. "East Khāsi Hills"),
  and points the demo district managers at the official districts.
- Demo accounts: see `.runtime/company-demo-credentials.private.json` (gitignored; never project it on screen).

## Recovery steps

| Symptom | Do |
|---|---|
| `BACKEND NOT READY` | `bash .runtime/demo/stop.sh` then `start.sh`; read `.runtime/demo/logs/api.log` |
| `PHONE NOT READY` | unlock phone, tap "Allow USB debugging", re-run `start.sh` |
| Driver app shows "cannot reach server" | re-run `start.sh` (re-creates `adb reverse`); check the USB cable |
| Route planning returns 503 ROUTING_UNAVAILABLE | public OSRM is down or rate-limited (1 req/s policy): wait 30 s, retry once; otherwise show an existing trip |
| A driver or truck shows as reserved | run `reset.py` |
| Manager page blank | hard-refresh; `start.sh --rebuild` |
| Anything else during the talk | switch to FALLBACK_MODE screenshots; do not debug live |

## Known limits to say out loud (not hide)

- Routing uses the public OSRM demo server (non-commercial, 1 request/second, no SLA): production needs a self-hosted graph.
- Map tiles are OpenStreetMap standard tiles: fine for a demo, not a production tile service.
- Hazard intelligence (terrain, landslide inventory, warnings) is NER-first; outside the NER the route evidence says LIMITED/UNKNOWN.
- The latest build runs locally; the hosted pilot is older and is not migrated (hosted migration needs owner authorisation + backup/PITR).
