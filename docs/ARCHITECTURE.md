# Architecture

> **Read this document before modifying system structure.** Changes to service boundaries, the
> AI/deterministic split, or the safety path must be reflected here in the same change.

---

## 1. Guiding Principles

1. **Deterministic core, advisory intelligence.** ML produces *estimates and rankings*. Deterministic
   code makes *decisions* that affect money, safety, capacity or compliance. See §8.
2. **One backend, two clients.** The manager web app and driver mobile app share one API. No
   business logic is duplicated in a client.
3. **The phone is an unreliable sensor.** Assume intermittent connectivity, clock skew and
   background-execution limits. GPS ingestion must be idempotent and accept batched, late data.
4. **External providers are replaceable.** Routing, weather and elevation sit behind interfaces so a
   provider outage or a licensing surprise is a configuration change, not a rewrite.
5. **Everything consequential is auditable.** Assignment, dispatch, reroute, escalation and payment
   transitions all write to `audit_logs`.

---

## 2. Diagram A — Complete System Architecture

```mermaid
graph TB
    subgraph clients["Client Applications"]
        MW["Manager Web<br/>React + TS + Vite + Tailwind"]
        DA["Driver App<br/>React Native + Expo + TS"]
    end

    subgraph api["FastAPI Backend"]
        REST["REST API<br/>/api/*"]
        WS["WebSocket<br/>/ws/fleet"]
        AUTH["Auth + RBAC<br/>JWT"]
        DOM["Domain Services<br/>DETERMINISTIC<br/>capacity - assignment<br/>trip lifecycle - payments"]
        SENT["Fleet Sentinel<br/>DETERMINISTIC<br/>scheduled monitor"]
        INT["Provider Interfaces<br/>routing - weather - elevation"]
        MLC["ML Inference Client<br/>ADVISORY ONLY"]
    end

    subgraph data["Supabase - PRIMARY"]
        PG[("Supabase PostgreSQL 17<br/>+ PostGIS 3.3")]
        OBJ["Supabase Storage<br/>photos - documents - PoD<br/>FUTURE"]
        SAUTH["Supabase Auth<br/>FUTURE"]
    end

    subgraph localdb["Optional offline fallback"]
        LPG[("Local WSL2 PostgreSQL 18<br/>+ PostGIS 3.6<br/>explicit opt-in only")]
    end

    subgraph ext["External Providers - replaceable"]
        RT["Routing Engine<br/>Valhalla / OSRM"]
        WX["Weather API"]
        EL["Elevation / DEM"]
    end

    subgraph ml["ML Service - offline trained"]
        FUEL["Fuel Model<br/>LightGBM"]
        RISK["Route Risk Model"]
        ETA["ETA Correction"]
    end

    MW -->|HTTPS| REST
    MW <-->|live fleet state| WS
    DA -->|HTTPS + GPS batches| REST
    DA <-->|alerts| WS

    REST --> AUTH --> DOM
    DOM --> PG
    DOM --> OBJ
    DOM -.->|"only when<br/>DATABASE_PROVIDER=local"| LPG
    SENT --> PG
    SENT -.->|raises alert| WS
    DOM --> INT
    INT --> RT
    INT --> WX
    INT --> EL
    DOM -.->|requests estimate| MLC
    MLC -.-> FUEL
    MLC -.-> RISK
    MLC -.-> ETA

    classDef det fill:#1a4d2e,stroke:#4ade80,color:#fff
    classDef adv fill:#4a3800,stroke:#fbbf24,color:#fff
    class DOM,SENT det
    class MLC,FUEL,RISK,ETA adv
```

Green = deterministic decision-making. Amber = advisory only, never authoritative.

---

## 3. Diagram B — Manager to Backend Flow

```mermaid
sequenceDiagram
    actor M as Manager
    participant W as Manager Web
    participant A as FastAPI
    participant D as Domain Service
    participant R as Routing Provider
    participant ML as Fuel Model
    participant DB as PostgreSQL/PostGIS

    M->>W: Create shipment (cargo, weight, origin, destination)
    W->>A: POST /api/shipments
    A->>D: validate payload
    D->>DB: INSERT shipment
    A-->>W: 201 shipment

    M->>W: Assign truck
    W->>A: POST /api/trips
    A->>D: validate_capacity(truck, cargo)
    Note over D: DETERMINISTIC GATE<br/>cargo_weight > truck.max_capacity<br/>=> 422, no ML involved
    D->>R: routes(origin, destination, profile)
    R-->>D: candidate routes A/B/C
    D->>ML: estimate_fuel(route, truck, load, gradient)
    ML-->>D: litres + cost (advisory, may be null)
    D->>DB: INSERT trip, trip_routes
    A-->>W: 201 trip with routes + estimates

    M->>W: Dispatch
    W->>A: POST /api/trips/{id}/dispatch
    D->>DB: status ASSIGNED -> ACTIVE, audit_log
    A-->>W: 200
    A-->>W: WS trip.dispatched
```

**Note the ordering.** Capacity is validated *before* routing and ML are consulted. A failed
capacity check costs nothing and cannot be overridden by a model.

---

## 4. Diagram C — Driver App to Backend Flow

```mermaid
sequenceDiagram
    actor Dr as Driver
    participant P as Driver App
    participant Q as Local Queue (SQLite)
    participant A as FastAPI
    participant DB as PostgreSQL/PostGIS
    participant WS as WebSocket

    Dr->>P: Start trip
    P->>A: POST /api/trips/{id}/start
    A->>DB: trip ACTIVE, started_at

    loop every ~30s while active
        P->>Q: buffer GPS fix locally first
        alt online
            Q->>A: POST /api/gps/batch (n fixes)
            A->>DB: INSERT gps_points (idempotent on device_fix_id)
            A-->>WS: fleet.position_update -> manager
            A-->>Q: ack -> clear buffer
        else offline
            Note over Q: retain, retry with backoff<br/>UI shows "N fixes pending"
        end
    end

    Note over A,DB: Server records both device_time and server_time.<br/>Staleness is judged on server_time.

    A-->>P: WS route.changed (road blocked ahead)
    P-->>Dr: Banner + new route
    Dr->>P: Acknowledge
    P->>A: POST /api/alerts/{id}/ack
```

---

## 5. Diagram D — Trip Lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT: shipment created
    DRAFT --> ASSIGNED: truck + driver assigned<br/>(capacity validated)
    ASSIGNED --> VERIFICATION_PENDING: truck is new to driver
    VERIFICATION_PENDING --> ASSIGNED: driver verification accepted
    VERIFICATION_PENDING --> MANAGER_REVIEW: mismatch reported
    MANAGER_REVIEW --> ASSIGNED: manager overrides / corrects
    ASSIGNED --> ACTIVE: dispatched + driver starts
    ACTIVE --> ACTIVE: GPS ingested, route revised
    ACTIVE --> DELAYED: ETA breach beyond threshold
    DELAYED --> ACTIVE: recovered
    ACTIVE --> INCIDENT: Sentinel escalation / breakdown
    DELAYED --> INCIDENT
    INCIDENT --> ACTIVE: resolved, trip resumes
    INCIDENT --> CANCELLED: manager aborts
    ACTIVE --> DELIVERED: proof of delivery captured
    DELAYED --> DELIVERED
    DELIVERED --> CLOSED: payment settled
    CANCELLED --> [*]
    CLOSED --> [*]
```

Every transition is written to `audit_logs` with actor, timestamp and reason. `INCIDENT` is a
suspension, not a terminus — a stuck truck that resumes returns to `ACTIVE`.

---

## 6. Diagram E — Future Route Intelligence

```mermaid
flowchart TB
    REQ["Route request<br/>origin - destination - truck - load - priority"] --> CAND

    subgraph CAND["Candidate Generation - deterministic"]
        RE["Routing engine<br/>k alternative paths"]
    end

    CAND --> ENRICH

    subgraph ENRICH["Enrichment - per candidate"]
        GEO["Segment geometry<br/>PostGIS"]
        ELEV["Elevation profile<br/>gradient per segment"]
        WXQ["Weather along corridor"]
        INC["Open road_incidents<br/>ST_DWithin on segments"]
    end

    ENRICH --> HARD

    HARD{"Hard constraints<br/>DETERMINISTIC"}
    HARD -->|"segment CLOSED"| REJECT["Reject candidate<br/>not selectable"]
    HARD -->|"exceeds axle/height limit"| REJECT
    HARD -->|passable| SCORE

    subgraph SCORE["Scoring - ADVISORY"]
        FUELM["Fuel model<br/>litres + cost"]
        RISKM["Risk model<br/>flood - landslide - closure"]
        ETAM["ETA model"]
    end

    SCORE --> RANK["Rank by objective<br/>A: balanced<br/>B: min fuel cost<br/>C: min risk (backup)"]
    RANK --> OUT["Present A / B / C<br/>with reasons"]
    OUT --> MAN["Manager selects<br/>HUMAN DECISION"]

    classDef det fill:#1a4d2e,stroke:#4ade80,color:#fff
    classDef adv fill:#4a3800,stroke:#fbbf24,color:#fff
    class HARD,REJECT,CAND det
    class SCORE,FUELM,RISKM,ETAM adv
```

**A closed road is never a low score — it is a rejection.** Models rank only survivors of the
deterministic filter, so no model output can route a truck onto a closed road.

---

## 7. Diagram F — Future Fleet Sentinel

```mermaid
flowchart TD
    START["Scheduled monitor<br/>every 5 min"] --> LOAD["Load all trips WHERE status = ACTIVE"]
    LOAD --> LOOP{"For each trip"}

    LOOP --> GPS["Fetch GPS points in last 60 min"]
    GPS --> STALE{"Any GPS in window?"}
    STALE -->|"No - signal lost"| COMMS["Raise COMMS_LOST<br/>manager-visible<br/>NOT an SOS"]
    STALE -->|Yes| RADIUS

    RADIUS{"All fixes within<br/>STATIONARY_RADIUS_M<br/>for >= 60 min?"}
    RADIUS -->|No| OK["Healthy - no action"]
    RADIUS -->|Yes| GEO

    GEO{"Inside approved<br/>stop / geofence?"}
    GEO -->|Yes| OK
    GEO -->|No| OPEN

    OPEN{"Open check already<br/>exists for this trip?"}
    OPEN -->|Yes| SKIP["Skip - do not duplicate"]
    OPEN -->|No| CHECK

    CHECK["Create DRIVER_CHECK_REQUIRED<br/>start 30-min timer<br/>push to driver"]
    CHECK --> WAIT{"Driver responds<br/>within 30 min?"}

    WAIT -->|"NEED HELP"| ESC
    WAIT -->|"Other reason"| REC["Record reason<br/>update incident<br/>manager can view"]
    WAIT -->|"No response"| ESC

    ESC["SOS_ESCALATED"] --> BRIEF["Assemble manager briefing:<br/>driver name - photo - phone - emergency contact<br/>truck - photo - registration<br/>cargo - priority - load<br/>origin - destination<br/>last GPS + age of fix<br/>stopped-since - current route<br/>weather - nearby road risk<br/>suggested next actions"]
    BRIEF --> NOTIFY["Alert manager<br/>WS + persisted alert"]

    classDef det fill:#1a4d2e,stroke:#4ade80,color:#fff
    class START,LOAD,GPS,STALE,RADIUS,GEO,OPEN,CHECK,WAIT,ESC,BRIEF det
```

**No LLM appears anywhere in this diagram, and none may be added.** Every branch is a comparison
against a configured threshold. This is a hard architectural constraint, not a preference.

Two distinctions that matter:

- **`COMMS_LOST` is not `SOS_ESCALATED`.** In NER, signal loss is routine. Conflating the two would
  produce constant false alarms and train managers to ignore the alert.
- **Idempotency.** The monitor runs every 5 minutes over a 60-minute window, so the same stationary
  condition is observed repeatedly. One open check per trip at a time.

---

## 8. Deterministic / AI Boundary

| Concern | Owner | Rationale |
| --- | --- | --- |
| Truck capacity validation | **Deterministic** | Safety and legal limit |
| Driver/truck assignment rules | **Deterministic** | Document validity is a compliance fact |
| Trip status transitions | **Deterministic** | Auditability |
| Sentinel stationary detection | **Deterministic** | Safety-critical; must be explainable |
| SOS escalation | **Deterministic** | Never gated on model availability |
| Salary, payments, expenses | **Deterministic** | Money |
| Document expiry enforcement | **Deterministic** | Compliance |
| Road closure hard filter | **Deterministic** | Physical impossibility |
| Fuel litres / cost estimate | *Advisory ML* | Estimate, shown with uncertainty |
| Route risk score | *Advisory ML* | Ranks survivors of the hard filter |
| ETA prediction | *Advisory ML* | Informational |
| Anomaly flagging | *Advisory ML* | Surfaces for human review |
| Incident narrative summarisation | *Advisory LLM* | Post-hoc reading aid only |

**Rule:** if the ML service is entirely unavailable, the platform must still dispatch trips,
track GPS, reroute around closures, and escalate SOS. Only estimates degrade. This is a testable
property — see [TESTING_STRATEGY.md](TESTING_STRATEGY.md) §9 failure injection.

---

## 9. Current Implementation State

As of Mission 1 (foundation), what actually exists:

| Component | State |
| --- | --- |
| FastAPI backend, config loading, `/health`, `/ready` | **Implemented** |
| PostgreSQL 18 + PostGIS 3.6, Alembic bootstrap migration | **Implemented** |
| Manager web shell reading real backend health | **Implemented** |
| Driver app shell reading real backend health | **Implemented** |
| Everything else in this document | **Specified only — not implemented** |

Do not read the diagrams above as a description of running code. They are the target.

---

## 10. Database Provider and Topology

### Primary: Supabase

**Supabase PostgreSQL is the primary database and the single source of truth.**

| Property | Value |
| --- | --- |
| Project region | `ap-south-1` (Mumbai) — lowest latency to the North East |
| PostgreSQL | 17.6 |
| PostGIS | 3.3, installed in the `extensions` schema |
| Connection | Session pooler, port 5432 |

**Why the session pooler rather than a direct connection.** `db.<ref>.supabase.co`
resolves to IPv6 only. The pooler (`*.pooler.supabase.com`) is reachable over IPv4,
which removes a dependency on the developer's network and on venue wifi during the
demo. Between the two pooler modes:

- **Session pooler (5432)** — a real PostgreSQL session per connection. Supports
  prepared statements, which psycopg uses, and supports DDL, which Alembic needs.
  **This is what both runtime and migrations use.**
- **Transaction pooler (6543)** — multiplexes statements across connections.
  Breaks prepared statements and is unsafe for Alembic. Deliberately not used.

`MIGRATION_DATABASE_URL` exists so migrations can be pointed at a different
connection later without touching the runtime one; it defaults to `DATABASE_URL`.

### Provider selection — no silent fallback

```
DATABASE_PROVIDER=supabase  ->  DATABASE_URL        (rejected if it names a local host)
DATABASE_PROVIDER=local     ->  LOCAL_DATABASE_URL  (requires scripts\db-start.ps1)
```

There is **no code path** that lets Supabase mode fall back to the local database.
If Supabase is unreachable, `/ready` returns 503. Quietly serving a stale local
copy would let the application look healthy while returning the wrong data — a far
worse outcome than an honest outage, and impossible to notice during a demo.

This is enforced in `Settings._validate_provider_selection` and covered by tests
that run **while the local database is reachable**, so a fallback would be caught.

### Optional local fallback

The Mission 1 WSL2 PostgreSQL 18 + PostGIS 3.6 install is intact and remains
useful for offline work. It is opt-in only: set `DATABASE_PROVIDER=local` and run
`scripts\db-start.ps1`. Normal Supabase development does **not** require that
script.

Note the two are not identical — Supabase runs PostgreSQL 17 / PostGIS 3.3 against
local PostgreSQL 18 / PostGIS 3.6. Nothing this project uses differs between them,
but migrations are authored against Supabase, which is the lower version.

```mermaid
graph LR
    subgraph win["Windows Host"]
        BE["FastAPI :8000"]
        MW["Vite dev server :5173"]
        DA["Expo :8081"]
    end
    subgraph cloud["Supabase - ap-south-1"]
        SB[("PostgreSQL 17 + PostGIS 3.3<br/>session pooler :5432<br/>TLS required")]
    end
    subgraph wsl["WSL2 Ubuntu - optional"]
        PG[("PostgreSQL 18 + PostGIS 3.6<br/>:5432")]
    end
    MW -->|"VITE_API_BASE_URL"| BE
    DA -->|"EXPO_PUBLIC_API_BASE_URL<br/>LAN IP on a real device"| BE
    BE ==>|"PRIMARY"| SB
    BE -.->|"DATABASE_PROVIDER=local"| PG
```

Clients never talk to Supabase directly. Every read and write goes through
FastAPI, so authorisation, capacity rules and the safety path cannot be bypassed
by a client holding a key.

One caveat worth recording: a physical phone running Expo Go cannot reach the
Windows host on `localhost`. It must use the host LAN IP, and Windows Firewall
must permit inbound 8000. The Android emulator uses `10.0.2.2` instead. See
[README.md](../README.md).

---

## 11. Future Supabase Services

Documented so the boundary is decided before anything is built. None of this is
implemented.

### Supabase Auth — *candidate, not yet adopted*

Roles will be `MANAGER` and `DRIVER` with the permission split in
[SECURITY.md](SECURITY.md) §2. Open question: Supabase Auth issues its own JWTs,
and FastAPI already needs to authorise every request. Adopting it means FastAPI
**verifies** Supabase-issued tokens rather than issuing its own. That is a real
simplification for password reset and phone OTP, and it is the likely choice — but
it must not become a second, parallel authorisation system. One authority only.

### Supabase Storage — *planned*

Buckets, all **private**, no public read:

`driver-photos` · `truck-photos` · `driver-documents` · `truck-documents` ·
`incident-photos` · `proof-of-delivery`

Access via short-lived signed URLs issued by FastAPI after an authorisation check,
matching [SECURITY.md](SECURITY.md) §4. EXIF stripping still happens server-side
before upload — Storage does not do it.

### Supabase Realtime — *deliberately NOT adopted for now*

We already have a FastAPI WebSocket design. Running both would create two
competing channels delivering overlapping events, and a demo failure in either
would be confusing to diagnose.

| Responsibility | Owner |
| --- | --- |
| GPS position updates to the manager map | **FastAPI WebSocket** |
| Trip status changes | **FastAPI WebSocket** |
| Route changes and hazard alerts | **FastAPI WebSocket** |
| Fleet Sentinel checks and SOS escalation | **FastAPI WebSocket** — safety path stays in one place |

Supabase Realtime would only be reconsidered if FastAPI WebSocket fan-out becomes
a real bottleneck, which at hackathon scale it will not. The decision is recorded
here so it is not revisited by accident.
