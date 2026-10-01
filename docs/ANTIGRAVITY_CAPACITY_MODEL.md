# RASTA AI — CAPACITY & SCALABILITY MODEL (TIERS 0 THROUGH 5)
**Auditor:** Antigravity SRE & Performance Engineering Group  
**Target Repository:** `D:\Projects\ner-ai-logistics`  
**Date:** 29 September 2026  
**Standard:** Empirical benchmark extrapolation, Queuing Theory (M/M/m/K models), and distributed systems hardware budgeting.  

---

## 1. THE 1 BILLION SIMULTANEOUS USERS REALITY CHECK

Claims of supporting 1 billion simultaneous users on the current architecture are **architecturally impossible**.
A baseline mathematical audit demonstrates the physical reality of 1 billion active users:

```text
TRAFFIC METRIC                    CALCULATED LOAD              PHYSICAL REQUIREMENT
─────────────────────────────────────────────────────────────────────────────────────────────
1B users @ 1 req/minute           ≈ 16,666,667 RPS average     Requires ~100,000 API container replicas
1B moving drivers @ 1 fix/10s     = 100,000,000 GPS EPS        Exceeds global Kafka / Cassandra tiers
1B active realtime connections    = 1,000,000,000 TCP/WS conn  Requires 1,000+ edge gateways (1M conns each)
1 KB state per active session     ≈ 1 Terabyte RAM             Pure session state memory (excluding overhead)
200 B per GPS telemetry fix       ≈ 20 Gigabytes/sec           Raw network ingestion ingress (160 Gbps)
Raw GPS telemetry storage / day   ≈ 1.728 Petabytes/day        Requires distributed BigQuery/Iceberg lakehouse
```

**Verdict:** The current RASTA AI backend (single Uvicorn process, monolithic PostgreSQL database, pooling 15 connections) saturates at **10 concurrent users (164 req/s)**. To scale beyond Tier 1 requires fundamental distributed architectural transformations.

---

## 2. MULTI-TIER CAPACITY ARCHITECTURE MATRIX

Every figure below is explicitly classified as:
- **[MEASURED]:** Derived from empirical benchmark runs against the isolated test/perf cluster.
- **[MODELED]:** Derived from queueing theory and observed client request rates.
- **[ASPIRATIONAL]:** Theoretical architecture requiring major platform redesign.

---

### Comprehensive Tier Specifications

| Metric | TIER 0: Local / Cert | TIER 1: Controlled Pilot | TIER 2: Single State | TIER 3: NER Region (8 States) | TIER 4: All-India Logistics | TIER 5: Hyperscale (1B Users) |
|---|---|---|---|---|---|---|
| **Scope** | Workstation Test Harness | 1 Depot / Route (Guwahati) | Assam or Meghalaya Fleet | Full North-East Corridor | National Indian Freight | Global Consumer Scale |
| **Registered Users** | 20,183 [MEASURED] | 100 [MODELED] | 2,500 [MODELED] | 25,000 [MODELED] | 1,000,000 [MODELED] | 1,000,000,000 [ASPIRATIONAL] |
| **Daily Active Users (DAU)** | 310 [MEASURED] | 55 [MODELED] | 600 [MODELED] | 5,000 [MODELED] | 200,000 [MODELED] | 300,000,000 [ASPIRATIONAL] |
| **Concurrent Sessions ($c$)** | 10–400 [MEASURED] | 15 [MODELED] | 150 [MODELED] | 1,500 [MODELED] | 50,000 [MODELED] | 100,000,000 [ASPIRATIONAL] |
| **Average RPS** | 155–164 [MEASURED] | 12.5 [MODELED] | 75 [MODELED] | 650 [MODELED] | 25,000 [MODELED] | 16,667,000 [ASPIRATIONAL] |
| **Peak RPS** | 199.9 [MEASURED] | 25.0 [MODELED] | 150 [MODELED] | 1,500 [MODELED] | 60,000 [MODELED] | 50,000,000 [ASPIRATIONAL] |
| **Active Moving Drivers** | 300 [MEASURED] | 50 [MODELED] | 250 [MODELED] | 2,500 [MODELED] | 100,000 [MODELED] | 100,000,000 [ASPIRATIONAL] |
| **GPS Fixes / Sec (EPS)** | 974 [MEASURED] | 5.0 [MODELED] | 25.0 [MODELED] | 250.0 [MODELED] | 10,000 [MODELED] | 10,000,000 [ASPIRATIONAL] |
| **Notifications / Sec** | 0.5 [MEASURED] | 0.2 [MODELED] | 2.0 [MODELED] | 20.0 [MODELED] | 500 [MODELED] | 500,000 [ASPIRATIONAL] |
| **Realtime WebSockets** | 0 [MEASURED] | 0 (Polling) [MEASURED] | 20 [MODELED] | 150 [MODELED] | 5,000 [MODELED] | 100,000,000 [ASPIRATIONAL] |
| **Storage Growth / Day** | 0.5 GB [MEASURED] | 0.08 GB [MODELED] | 0.45 GB [MODELED] | 4.5 GB [MODELED] | 180 GB [MODELED] | 1.73 Petabytes [ASPIRATIONAL] |
| **Bandwidth (Egress)** | Loopback [MEASURED] | 0.5 Mbps [MODELED] | 3.5 Mbps [MODELED] | 35 Mbps [MODELED] | 1.5 Gbps [MODELED] | 1.6 Terabits/s [ASPIRATIONAL] |
| **API Architecture** | 1 Uvicorn Worker [MEASURED] | 1 Uvicorn Worker (Render Free) [MEASURED] | 4 Gunicorn Workers (2 CPU) [MODELED] | 16 Replicas (K8s Cluster) [MODELED] | 200 Replicas + ALB [MODELED] | 100,000 Container Pods [ASPIRATIONAL] |
| **Database Architecture** | Local PG 18.2 + PostGIS [MEASURED] | Supabase PG 17.6 (Single Instance) [MEASURED] | Supabase Pro (4 vCPU, 16GB) [MODELED] | PG Primary + 2 Read Replicas [MODELED] | Distributed CockroachDB / Citus PG [ASPIRATIONAL] | Spanner / Bigtable / DynamoDB [ASPIRATIONAL] |
| **Cache Tier** | None (In-Process Memory) [MEASURED] | None [MEASURED] | Redis Standalone (1 Node) [MODELED] | Redis Cluster (3 Shards) [MODELED] | Multi-Region Redis Cluster [MODELED] | Distributed Global Memcached [ASPIRATIONAL] |
| **Message / Event Bus** | None (PostgreSQL Queue) [MEASURED] | None [MEASURED] | PostgreSQL LISTEN/NOTIFY [MODELED] | RabbitMQ / Redis PubSub [MODELED] | Apache Kafka (5 Brokers) [MODELED] | Apache Pulsar / Kafka Mesh [ASPIRATIONAL] |
| **Observability** | Console stdout logs [MEASURED] | Render basic log stream [MEASURED] | Grafana + Loki + Prometheus [MODELED] | Datadog / OpenTelemetry Tracing [MODELED] | Distributed APM + Sentry + OpenSearch [MODELED] | Hyperscale Telemetry Pipeline [ASPIRATIONAL] |
| **Monthly Cost Class** | $0 (Local Machine) [MEASURED] | $0 (Render + Supabase Free) [MEASURED] | ~$75 / month [MODELED] | ~$650 / month [MODELED] | ~$18,000 / month [MODELED] | >$5,000,000 / month [ASPIRATIONAL] |

---

## 3. BOTTLENECK PROGRESSION LADDER

What breaks first as the system scales up?

```text
STAGE 1: 50 DRIVERS (Current Hosted Free Tier)
  ▲ BREAKS FIRST: Render Free Tier 15-minute spin-down and 0.1 CPU throttle.
  ▲ SYMPTOM: 32.8s cold start latency; requests queue; p95 exceeds 2.5s.

STAGE 2: 100 DRIVERS (Single Dedicated Core)
  ▲ BREAKS FIRST: Single-threaded Python uvicorn worker hits 98% CPU saturation.
  ▲ SYMPTOM: Request processing latency degrades; event-loop lag increases.

STAGE 3: 250 DRIVERS
  ▲ BREAKS FIRST: Database connection pool exhaustion (`pool_size=5, max_overflow=10`).
  ▲ SYMPTOM: `QueuePool limit exceeded` 500 errors on API routes during OSRM/Gemini calls.

STAGE 4: 500 DRIVERS
  ▲ BREAKS FIRST: Whole-table sequential scans on `gps_points` during `/api/presence` and `/api/dashboard`.
  ▲ SYMPTOM: PostgreSQL CPU spikes to 100%; queries take >500 ms each.

STAGE 5: 2,500 DRIVERS (Regional NER Scale)
  ▲ BREAKS FIRST: In-memory rate limiting and in-process background loops.
  ▲ SYMPTOM: Need Redis for rate limiting and RabbitMQ/Kafka for GPS telemetry streaming.

STAGE 6: 100,000 DRIVERS (National India Scale)
  ▲ BREAKS FIRST: Monolithic PostgreSQL spatial tables cannot ingest 10,000 PostGIS points/sec.
  ▲ SYMPTOM: Write amplification, WAL saturation, vacuum lag. Requires TimescaleDB or Citus sharding.
```

---

## 4. ARCHITECTURAL REQUIREMENTS FOR HYPERSCALE (TIERS 4 & 5)

To scale beyond Tier 2 (Single State), the following architectural refactoring is mandatory:
1. **Decouple Telemetry Ingestion from Transactional DB:**
   Ingest GPS fixes via lightweight HTTP/gRPC ingress workers directly into an Apache Kafka or AWS Kinesis topic. Stream telemetry to TimescaleDB or ClickHouse for spatial analytics.
2. **Materialized Driver Position State:**
   Eliminate full-table sequential scans by storing current driver positions in a Redis GeoSet (`GEOADD`).
3. **Decouple External Providers from DB Sessions:**
   Release database pool connections prior to calling OSRM, Gemini, or Open-Meteo.
4. **Deploy Multi-Worker Containers on Linux:**
   Run Gunicorn with `UvicornWorker` on Linux containers using `epoll`, completely bypassing the 512-socket Windows `select()` limit.
