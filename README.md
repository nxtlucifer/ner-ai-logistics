# NER Fleet Intelligence

**AI-Based Smart Logistics and Accessibility Intelligence Platform for the North Eastern Region**

Smart India Hackathon · Problem Statement **SIH26002** · Software · Smart Automation

---

## Status: P0 – P4 complete

| Component | State |
| --- | --- |
| FastAPI backend, `/health` + `/ready` | Running, tested |
| **Supabase PostgreSQL 17 + PostGIS 3.3 (`ap-south-1`)** | **PRIMARY database** |
| Local WSL2 PostgreSQL 18 + PostGIS 3.6 | Optional offline fallback, opt-in only |
| Manager web (React 19 + TS + Vite 8 + Tailwind 4) | Running, reads real backend state |
| Driver app (Expo SDK 57 + React Native 0.86 + TS) | Running, reads real backend state |
| Auth: local JWT, Argon2id, rotating refresh with reuse detection | Implemented |
| Manager API: drivers, trucks, assignments + audit logging | Implemented |
| Manager UI: login, drivers, trucks, assignments | Implemented |
| Driver app: login, own assignment, truck verification | Implemented |
| Backend test suite | 296 passing |
| Manager frontend tests (Vitest) | 10 passing |

**Not implemented:** GPS, routing, fuel AI, weather, road incidents, rerouting,
Fleet Sentinel, SOS, payments, payroll, OCR, ML training, Supabase Auth, Supabase
Storage. All are specified in [`docs/`](docs/) and scheduled in
[docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md). Nothing in the UI
pretends otherwise.

---

## Architecture

```
Manager Web (React)  ─┐
                      ├─→  FastAPI  ─→  Supabase (PostgreSQL + PostGIS)
Driver App (Expo)    ─┘
```

**Clients never talk to Supabase directly.** Every read and write goes through
FastAPI, which is what keeps capacity rules, document enforcement and the Fleet
Sentinel safety path unbypassable. No client holds a Supabase credential.

---

## Prerequisites

| Tool | Version |
| --- | --- |
| Windows | 11 (build 26200) |
| Python | 3.11.9 — **not 3.14**, see note below |
| Node.js | 24.18.0 |
| npm | 11.16.0 |
| Git | 2.55.0 |
| Supabase project | PostgreSQL 17.6 + PostGIS 3.3, region `ap-south-1` |
| WSL2 *(optional)* | Ubuntu 26.04 LTS + PostgreSQL 18 + PostGIS 3.6 |

> **Python 3.11, not 3.14.** `py`/`python3` on this machine is 3.14.6, but the
> backend venv is built on 3.11.9 (`python`). Several dependencies in the ML phase
> (LightGBM, PaddleOCR) do not yet publish 3.14 wheels. `pyproject.toml` pins
> `>=3.11,<3.13`.

---

## Start everything (Windows)

Run each block in its **own terminal**.

> Supabase is the primary database, so **no local database step is required**.
> `scripts\db-start.ps1` is only for the optional offline mode.

### 1. Backend

```powershell
cd D:\Projects\ner-ai-logistics\backend
.venv\Scripts\python.exe run.py
```

Serves on <http://127.0.0.1:8000> · API docs at <http://127.0.0.1:8000/docs>

> Start it with `run.py`, **not** `uvicorn app.main:app`. On Windows the asyncio
> selector policy has to be set before uvicorn creates its event loop, otherwise
> every database call fails with a psycopg `InterfaceError`. `run.py` does that;
> invoking uvicorn directly does not.

### 2. Create a manager account (first time only)

```powershell
cd D:\Projects\ner-ai-logistics\backend
.venv\Scripts\python.exe scripts\create_user.py --email you@example.com --name "Your Name"
```

The password is prompted for, never passed as an argument. Driver accounts are
created from the Drivers page in the UI, not with this script.

### 3. Manager web

```powershell
cd D:\Projects\ner-ai-logistics\manager-web
npm run dev
```

Opens on <http://localhost:5173>

### 4. Driver app

```powershell
cd D:\Projects\ner-ai-logistics\driver-app
npm start
```

Then scan the QR code with **Expo Go**. The app derives the backend address from
the Expo dev server host, so no configuration is needed on a phone that is on the
same wifi as this laptop.

To preview in a browser instead, without a phone:

```powershell
cd D:\Projects\ner-ai-logistics\driver-app
npm run web
```

---

## Database configuration

`backend/.env` selects the database. There is **no automatic fallback**: if the
configured primary is unreachable, `/ready` returns 503 rather than quietly
serving a different database.

```
DATABASE_PROVIDER=supabase   ->  uses DATABASE_URL        (rejected if it names a local host)
DATABASE_PROVIDER=local      ->  uses LOCAL_DATABASE_URL  (requires scripts\db-start.ps1)
```

### Getting the Supabase connection string

Supabase dashboard → **Connect** → **Session pooler**, then in `backend/.env`:

- change the scheme to `postgresql+psycopg://`
- fill in your database password (URL-encode any special characters)

Use the **session pooler on port 5432**, not the transaction pooler (6543):
`db.<ref>.supabase.co` is IPv6-only, while the pooler is IPv4; and the transaction
pooler breaks the prepared statements psycopg uses and is unsafe for Alembic DDL.

### Optional: offline local database

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\ner-ai-logistics\scripts\db-start.ps1
```

Then set `DATABASE_PROVIDER=local` in `backend/.env`. This is **only** for working
without internet access. The script exists because the WSL2 localhost relay is torn
down about 20 seconds after the last Windows-side `wsl.exe` process exits; it holds
one open. Stop it with `scripts\db-stop.ps1`.

---

## First-time setup

<details>
<summary>Backend virtual environment</summary>

```powershell
cd D:\Projects\ner-ai-logistics\backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
```

Then edit `.env` and set a real `DATABASE_URL`.
</details>

<details>
<summary>Apply migrations to Supabase</summary>

```powershell
cd D:\Projects\ner-ai-logistics\backend
.venv\Scripts\python.exe -m alembic upgrade head
```

Alembic follows `DATABASE_PROVIDER`, so it always targets the same database the
application serves — it cannot migrate local while the app runs against Supabase.
</details>

<details>
<summary>Frontend dependencies</summary>

```powershell
cd D:\Projects\ner-ai-logistics\manager-web
npm install
```

```powershell
cd D:\Projects\ner-ai-logistics\driver-app
npm install
```
</details>

---

## Verify it works

```powershell
curl http://127.0.0.1:8000/ready
```

Returns 200 with the real PostgreSQL and PostGIS version strings and
`"provider": "supabase"` when healthy, and 503 when not. `/health` stays 200
either way — it is a liveness probe and deliberately checks no dependency.

---

## Tests

```powershell
cd D:\Projects\ner-ai-logistics\backend
.venv\Scripts\python.exe -m pytest -v
```

```powershell
cd D:\Projects\ner-ai-logistics\manager-web
npm run typecheck
```

```powershell
cd D:\Projects\ner-ai-logistics\manager-web
npm run build
```

```powershell
cd D:\Projects\ner-ai-logistics\driver-app
npm run typecheck
```

Backend tests run against whichever database `DATABASE_PROVIDER` selects.

> **Migration tests are destructive and skipped by default.** They downgrade to
> base, dropping every table and all data. Run them only against a database you
> are willing to empty:
>
> ```powershell
> $env:RUN_DESTRUCTIVE_MIGRATION_TESTS=1; .venv\Scripts\python.exe -m pytest tests	est_migrations.py
> ```

---

## Project layout

```
backend/        FastAPI + SQLAlchemy + Alembic. Domain logic lives here.
manager-web/    React + TypeScript + Vite + Tailwind. Manager dashboard.
driver-app/     React Native + Expo + TypeScript. Driver mobile client.
ml/             Offline model training. No trained model exists yet.
data/           Datasets. Contents are git-ignored.
docs/           Architecture and specifications. Read before changing structure.
scripts/        Optional local-database tooling (db-start / db-stop).
tests/          Cross-cutting end-to-end tests. Empty until phase P12.
```

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `DATABASE_PROVIDER=supabase requires DATABASE_URL` | `backend/.env` missing or unfilled. | Copy `.env.example` and set the Supabase connection string. |
| `DATABASE_URL points at 'localhost'` | Supabase mode with a local URL — refused on purpose. | Use the Supabase string, or set `DATABASE_PROVIDER=local` deliberately. |
| `/ready` 503, `Tenant or user not found` | Wrong pooler host, or username missing the `postgres.<project-ref>` prefix. | Re-copy the session pooler string from the dashboard. |
| `/ready` 503 after idle | Free-tier Supabase projects pause after inactivity. | Open the Supabase dashboard to resume the project. |
| `Psycopg cannot use the 'ProactorEventLoop'` | Backend started with `uvicorn` directly. | Start with `python run.py`. |
| Manager web shows **Backend: Offline** | Backend not running, or on a different port. | Check <http://127.0.0.1:8000/health>. |
| Driver app shows **Disconnected** on a phone | The phone cannot reach the laptop. `localhost` on a phone means the phone itself. | Same wifi; allow inbound TCP 8000 through Windows Firewall. Override with `EXPO_PUBLIC_API_BASE_URL=http://<laptop-lan-ip>:8000`. |
| Driver app **Disconnected** in a browser | Expo web origin not in the CORS allowlist. | Ensure `CORS_ORIGINS` includes `http://localhost:8081`, then restart the backend. |
| Android emulator cannot reach the backend | The emulator maps the host to `10.0.2.2`. | `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000` |
| `.env` changes have no effect | Settings are read once at startup; `--reload` only watches `.py` files. | Restart the backend. |
| `Socket is not connected (10057)` in **local** mode | WSL2 relay torn down while idle. | Run `scripts\db-start.ps1`. |

---

## Security notes

- `.env` is git-ignored. `.env.example` contains placeholders only.
- **`SUPABASE_SERVICE_ROLE_KEY` bypasses all row-level security.** It is not
  needed for this phase, is absent from `.env.example`, and must never appear in
  a client, a bundle, a log, or git.
- The database password lives only in `backend/.env`, inside `DATABASE_URL`. It is
  never logged and never returned by an endpoint — `/ready` exposes only the
  provider name.
- Every table has Row Level Security enabled with no policies. Supabase publishes
  `public` through its Data API, so a table without RLS is readable by anyone
  holding the anon key.
- `VITE_*` and `EXPO_PUBLIC_*` variables are inlined into client bundles and are
  therefore public. No secret may use those prefixes.
- The backend **refuses to start** with the placeholder `SECRET_KEY` when
  `APP_ENV` is not `development`.

Full posture, including known gaps, in [docs/SECURITY.md](docs/SECURITY.md).

---

## Documentation

| Document | Contents |
| --- | --- |
| [PRODUCT_VISION.md](docs/PRODUCT_VISION.md) | Problem, users, workflows, SIH value |
| [MVP_SCOPE.md](docs/MVP_SCOPE.md) | Must / should / future / out of scope |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, diagrams, AI boundary, database providers |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Entities, keys, indexes, enums, PostGIS, RLS |
| [API_CONTRACTS.md](docs/API_CONTRACTS.md) | Endpoints, payloads, errors, permissions |
| [AI_MODELS.md](docs/AI_MODELS.md) | Models, baselines, evaluation, fallbacks |
| [SECURITY.md](docs/SECURITY.md) | Auth, Supabase keys, privacy, retention, gaps |
| [TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Test layers and what exists today |
| [DEMO_PLAN.md](docs/DEMO_PLAN.md) | Three-minute demo narrative |
| [DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) | Phases P0–P13 with exit gates |

Working on this with an AI agent? Read [AGENTS.md](AGENTS.md) first.
