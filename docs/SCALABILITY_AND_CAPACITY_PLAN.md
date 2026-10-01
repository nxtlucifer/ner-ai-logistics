# Scalability and Capacity Plan

RASTA AI / NER-AI Logistics, SIH26002 (MDoNER). Lane: scale-capacity (performance test lead and SRE).
Revised 2026-09-26 after review. Two measurement runs on an isolated local stack: run 1 (12:28-13:01 UTC,
one run per stage) and run 2 (13:34-14:16 UTC, three repetitions per stage). Nothing hosted was touched.

This plan does not claim that the system scales to multi-million users. Today the hosted API is one
process on one Render free instance [PROVEN_BY_SOURCE: `render.yaml:35`, `backend/Dockerfile:53`]. Running
more than one API process is a ROADMAP decision and is unsafe until the in-process state listed in section 10
moves out of the process [PROVEN_BY_SOURCE: files in section 10.1 row 3].

## 0. How to read this document

Every statement carries one evidence label:

| Label | Meaning |
|---|---|
| PROVEN_BY_RUNTIME | Measured in run 1 or run 2 against the local API on 127.0.0.1:8041; the result file is named in section 12 |
| PROVEN_BY_DATABASE | Read from the isolated PostgreSQL cluster (pg_stat_*, EXPLAIN ANALYZE, relation sizes); file in section 12 |
| PROVEN_BY_SOURCE | Read in the repository at the file and line given |
| PROVEN_BY_WEB | Read on the public page given, in this session |
| INFERRED | Arithmetic or reasoning from labelled facts. Not measured |
| NOT_VERIFIED | Not checked. Do not treat it as true or as false. Planning inputs and proposed targets carry this label |
| BLOCKED | Could not be measured in this environment |

ADOPT_NOW / ROADMAP / REJECT are decisions, not evidence. They appear only in "Decision" columns.
UNKNOWN is not SAFE: where a value is unknown, the document says so.

Evidence root. All result files, scripts and logs for this document live outside the repository, in the lane
scratch directory, written `LANE/` below:
`C:/Users/patel/AppData/Local/Temp/claude/D--Projects-ner-ai-logistics/2f919799-51fd-4107-9011-42ec4e7339f3/scratchpad/company2/scale-capacity/`.
It is a temporary directory; the main session decides whether to keep it. See section 13 for run 1's files
inside the repository tree.

## 1. Summary

1. The API runs as one Python process, and its CPU is the first limit.
   - Run 1, one endpoint at a time: six of the seven database-backed endpoints reached 95-98% of one CPU core
     while PostgreSQL had at most 3 active backends (trip list and notifications at c=100, the other four at
     c=10). Presence reached 82% with 9 active backends, most of them its own parallel workers.
     [PROVEN_BY_RUNTIME]
   - Run 2, c=10, three repetitions: fleet, GPS 1-fix, GPS 6-fix and driver trip ran at 94-98.5% with at most
     2 active backends outside one slow window (item 10); dashboard ran at 92-96.5% with 6-7 active backends;
     presence at 79-91% with 6-11. Trip list and notifications stayed at 63-76% because one load-generator
     process was itself at 85-91% of a core. [PROVEN_BY_RUNTIME]
   - Mixed traffic at c>=10 ran at 96.5-98.3% of one core with at most 5 active backends on a pool of 3+2, in
     both runs. [PROVEN_BY_RUNTIME]
   - That process CPU, not PostgreSQL or the pool, limits throughput follows from those numbers.
     [INFERRED]
2. Mixed-traffic saturation throughput is a spread, not a ceiling. Run 1 (one run per stage, machine-wide CPU
   33-48%): 93-132 requests/s. Run 2 (three repetitions, machine-wide CPU 21-39% in the saturated stages):
   105-164 requests/s; at c=10 it was 156-164 requests/s with p95 111-124 ms, against 96 requests/s and p95
   193 ms in run 1. [PROVEN_BY_RUNTIME] The lower values coincide with higher machine-wide CPU from other
   sessions. [INFERRED]
3. The hosted API runs on a Render free instance with 0.1 CPU [PROVEN_BY_WEB: https://render.com/docs/compute-plans].
   Across every saturated mixed stage of both runs the API used 5.96-10.5 ms of CPU per request
   [PROVEN_BY_RUNTIME]; run 2's pool comparison block, which ran newer code at 34-57% machine-wide CPU and is
   excluded, measured 8.2-11.7 ms [PROVEN_BY_RUNTIME]. On the 5.96-10.5 ms basis, 0.1 CPU gives about 9.5-17
   requests/s, which may be above or below the Tier-A peak estimate of about 11.5 requests/s; this is
   unresolved, and whether a Render CPU is as fast as this laptop core is not known. [INFERRED] Including the
   excluded block, the estimate would be 8.6-17 requests/s. [INFERRED]
4. A burst of 20 logins stalls other requests on the process for about 1.2 s: GPS ingest latency went from a
   97 ms maximum before the burst to a 963 ms maximum during it (run 1). [PROVEN_BY_RUNTIME] The Argon2 check is a
   synchronous call inside the async login (`backend/app/services/auth.py:179`). [PROVEN_BY_SOURCE]
5. Two endpoints read the whole GPS history on every call: presence (`backend/app/api/presence.py:134`) and
   the dashboard (`backend/app/api/dashboard.py:195-196`) run the same `max(gps_points.received_at)` aggregate.
   [PROVEN_BY_SOURCE] At 410,530 GPS rows that statement took 65-71 ms as a parallel sequential scan over the
   whole table (run 2) and 89 ms in run 1. [PROVEN_BY_DATABASE] The Overview page polls both every 15 s
   (`manager-web/src/pages/OverviewPage.tsx:46,132-144`). [PROVEN_BY_SOURCE]
6. The trip list sorts and counts every trip on every call; no index serves `ORDER BY created_at` alone. It is
   cheap at 2,374 trips (page query 1.3-1.7 ms) [PROVEN_BY_DATABASE] and grows with the table [INFERRED]. The
   Trips page polls two lists every 5 s (`manager-web/src/pages/TripsPage.tsx:52,118-135,173-178`).
   [PROVEN_BY_SOURCE]
7. The driver app uploads one queued GPS fix per request on a 1 s tick. [PROVEN_BY_SOURCE] Sending 6 fixes per
   request raised fixes per CPU-second 4.8-6.5x in the three pairs of stages that both ran at 96-98% CPU
   (run 2 reps 1 and 3: about 950-975 vs 199-200 fixes/s; run 1: 826 vs 127). [PROVEN_BY_RUNTIME]
8. At 1,000 concurrent connections the local server crashed with `ValueError: too many file descriptors in
   select()` (run 1); `select.select` on this host accepts 512 sockets and fails at 513; c=400 ran with zero
   errors in all four runs. [PROVEN_BY_RUNTIME] The project uses that selector loop only on Windows
   (`backend/app/core/event_loop.py:31,38`). [PROVEN_BY_SOURCE] The Linux host's limit was not checked.
   [NOT_VERIFIED] Run 3 (section 15) reproduced the crash and bracketed it: one worker survives c=500 and
   dies at c=512; four workers ran c=1,000 with zero errors. [PROVEN_BY_RUNTIME]
9. A 5-minute soak at 50 requests/s (run 1) had zero errors and a working set of 129.2-131.0 MB after the
   first sample. [PROVEN_BY_RUNTIME]
10. CPU cost per request is not stable even on one machine. In run 2, repetition 2, four consecutive endpoint
    stages (13:49-13:51 UTC) used 1.6-4.9x more API CPU per request than the same stages in repetitions 1 and
    3, while machine-wide CPU was 16-37%. [PROVEN_BY_RUNTIME] The cause was not identified. [NOT_VERIFIED]
11. Backup and point-in-time recovery for the hosted Supabase project are unconfirmed, so the hosted RPO and
    RTO are unknown. [PROVEN_BY_SOURCE: `docs/MIGRATION_0013_DEPLOYMENT_PACKET.md:181-193`]

## 2. Test environment

| Item | Value | Label |
|---|---|---|
| Machine | 13th Gen Intel Core i7-13700HX, 16 cores / 24 logical processors, 15.7 GiB RAM, Windows 11 | PROVEN_BY_RUNTIME |
| Contention | Other agent sessions, a browser-certification API on the same PostgreSQL cluster and an unrelated local web service ran during both runs. Run 2 measured machine-wide CPU with no test load for 10 s before each repetition: 7.8-11.4%. During run 2 stages it was 14.6-53.5% in the main block and 34.3-57.1% in the pool block (this includes the test's own generator, API and PostgreSQL). Run 1 stages: 18.5-75.3% | PROVEN_BY_RUNTIME |
| Code | Working tree of local `main` (5b5e474 plus about 280 uncommitted files, migration 0013), not the hosted build (e4043ce, migration 0012). Presence, notifications, dashboard and heartbeat do not exist on e4043ce | PROVEN_BY_SOURCE |
| Code version per run | Run 1 loaded the tree at 12:28 UTC. `backend/app/services/auth.py` (12:43 UTC) and `backend/app/services/trips.py` (12:54 UTC) changed on disk later; run 2's main server loaded the tree at 13:35 UTC. Another session added migration 0014 and `shipments.origin_state_id` to the models at 13:56 UTC; run 2's main server did not pick that up (every dashboard call in repetition 3 returned 200), but the pool comparison server started at 14:10 UTC did (file modification times and response statuses observed during the runs) | PROVEN_BY_RUNTIME |
| API process | `uvicorn app.main:app`, one worker, 127.0.0.1:8041, `APP_ENV=production`, access log on, Windows selector event loop (as `backend/run.py`), mirroring `backend/Dockerfile:53` `--workers 1` | PROVEN_BY_SOURCE |
| Pool | `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=2` as in `render.yaml:84,86`. Comparison runs used 5+10 | PROVEN_BY_SOURCE |
| Providers | Weather, terrain, flood, warnings, route watch, demo simulation, sentinel scheduler, routing, AI and push all disabled; AI keys unset; the server ran from a directory without a `.env` | PROVEN_BY_RUNTIME |
| Database | Isolated PostgreSQL 18.2 on 127.0.0.1:55432, loopback, no TLS, `shared_buffers` 128 MB, `max_connections` 50, `max_parallel_workers_per_gather` 2, no pg_stat_statements. Each run created `ner_logistics_perf` from `ner_logistics_demo`, upgraded it 0012 -> 0013 with Alembic, and dropped it at the end | PROVEN_BY_DATABASE |
| Data | Demo template plus 300 drivers, 300 trucks, 300 ACTIVE trips (one per driver), 2,000 DELIVERED/CLOSED trips, 410,530 seeded GPS points (one per 10 s), 1,400 notifications, 6 MANAGER and 1 NORTH_EAST_MANAGER accounts; about 20,000 users in total, mostly inactive template fixtures | PROVEN_BY_DATABASE |
| Run 2 GPS rows | Reset to the 410,530 seeded rows after each repetition (delete of load-generated rows, then `VACUUM ANALYZE`); within a repetition they grew to at most 456,766 at a stage start. Each stage file records its starting count | PROVEN_BY_DATABASE |
| Run 2 fixture | Drivers sign in by email and carry a non-numeric placeholder in `drivers.phone`; no phone number was generated. The JWT secret was generated per run in the shell's memory; each process minted its access tokens in memory with `app.core.security.create_access_token`. No password, secret or token was written to disk | PROVEN_BY_SOURCE: `LANE/harness/seed.py`, `env.py`, `run_all.sh` |
| Load generator | asyncio + httpx harness, closed loop (each virtual user sends its next request when the previous one returns, no think time) unless paced; 1-12 generator processes; generator CPU recorded per stage | PROVEN_BY_RUNTIME |
| Resource sampling | API process CPU time and working set via Win32 `GetProcessTimes` / `K32GetProcessMemoryInfo`; machine CPU via `GetSystemTimes`; connections from `pg_stat_activity`; DB rates from `pg_stat_database` deltas; statements active longer than 200 ms sampled once per second | PROVEN_BY_SOURCE: `LANE/harness/harness.py` |

"CPU ms per request" in this document is API process CPU time divided by completed requests in the stage
(CPU % of one core x 10 / requests per second). It includes everything the process does: access logging,
authentication, ORM, validation and JSON. [INFERRED]

Reading "concurrency": at c=10 the mix produced 96-164 requests/s. A moving driver produces about 0.22
requests/s (section 5), so c=10 here is roughly the polling of 440-750 moving drivers, not 10 people.
[INFERRED]

Throughput note: requests still in flight when a stage window closed were allowed to finish and are counted.
This can overstate requests/s by at most concurrency / duration (for example 3.3 requests/s at c=100 over
30 s). [PROVEN_BY_SOURCE: `LANE/harness/harness.py` summarize]

## 3. Measured Tier-A results

### 3.1 Per endpoint

Run 2: c=10, 30 s, pool 3+2, three repetitions; min-max across the repetitions. Latencies are client-side
milliseconds on loopback. "CPU" is the API process as a percentage of one core. "Sys" is machine-wide CPU.
Errors were 0 in every stage except one client `ReadError` in 2,742 requests (GPS 6-fix, repetition 2).
[PROVEN_BY_RUNTIME, files `LANE/evidence/run2/r{1,2,3}_ep_*.json`]

| Endpoint | req/s | p50 | p95 | CPU % | CPU ms/req | DB conn / active | Sys % |
|---|---|---|---|---|---|---|---|
| `GET /api/trips?limit=20` (manager) | 176.4-192.7 | 37.3-42.7 | 124.4-132.9 | 70.8-75.5 | 3.69-4.28 | 5-6 / 2-3 | 20.1-28.8 |
| `GET /api/fleet/active` (manager, 100 trips) | 88.7-93.0 | 95.3-100.7 | 149.4-163.0 | 97.9-98.2 | 10.56-11.07 | 5-6 / 0-2 | 15.7-18.2 |
| `GET /api/notifications?limit=50` (NE manager) | 176.0-179.9 | 33.3-36.2 | 121.9-134.6 | 63.2-66.4 | 3.51-3.75 | 5 / 1-3 | 16.8-22.4 |
| `POST /api/driver/me/location`, 1 fix | 185.2-199.9 | 48.2-48.3 | 64.1-78.5 | 94.0-96.9 | 4.82-5.08 | 5 / 1 | 18.1-18.3 |
| `POST /api/driver/me/location`, 6 fixes | 91.4-162.3 (548-974 fixes/s) | 59.0-63.6 | 88.6-325.4 | 86.6-97.4 | 6.00-9.47 | 5-6 / 1 | 18.3-21.6 |
| `GET /api/driver/me/trip` | 28.9-175.4 | 55.7-304.6 | 72.1-517.7 | 79.5-98.5 | 5.62-27.51 | 5 / 1 | 16.0-19.0 |
| `GET /api/presence` (manager, 313 people) | 10.8-27.2 | 364-949 | 459-1,091 | 79.3-90.9 | 29.2-84.2 | 7-11 / 6-11 | 33.7-50.7 |
| `GET /api/dashboard` (manager) | 12.2-22.0 | 455-528 | 568-1,495 | 92.2-96.5 | 43.4-75.6 | 7-10 / 6-7 | 37.2-53.0 |
| `GET /health` (no DB), c=100, 10 generator processes | 822.8-891.4 | 79.9-83.1 | 240.8-255.0 | 60.0-64.6 | 0.70-0.75 | 3 / 0 | 49.8-53.5 |

Notes on run 2 [PROVEN_BY_RUNTIME unless marked]:

- The low end of the GPS 6-fix, driver trip, presence and dashboard ranges is repetition 2 (13:49-13:51 UTC).
  Without that window: GPS 6-fix 158.7-162.3 req/s (6.00-6.09 ms, about 1.0 ms per fix), driver trip
  172.9-175.4 (5.62-5.66 ms), presence 22.3-27.2 (29.2-36.5 ms), dashboard 21.9-22.0 (43.4-43.9 ms). In that
  window the API used 79-91% of a core but completed fewer requests; machine-wide CPU was 16-37%.
- Trip list and notifications at c=10 were limited by the single generator process (85-91% of one core), not
  by the API (63-76%). Their saturation throughput was measured only in run 1, at c=100.
- Presence at c=10 shows up to 11 active backends although the pool allows 5: the extra backends are
  PostgreSQL parallel workers of the whole-history aggregate. [PROVEN_BY_DATABASE]

Run 1, one run per row, 30 s each, 12:30-12:42 UTC. Error rate 0 in every row.
[PROVEN_BY_RUNTIME, files `LANE/evidence/run1/ep_*.json`]

| Endpoint | c | req/s | p50 | p95 | p99 | max | CPU % | RSS MB | DB conn | Sys % |
|---|---|---|---|---|---|---|---|---|---|---|
| `GET /health` (no DB) | 1 | 313 | 3 | 4 | 5 | 15 | 18 | 126 | 1 | 19 |
| `GET /health` | 10 | 313 | 28 | 57 | 86 | 392 | 16 | 126 | 1 | 21 |
| `GET /health` (2 gen procs) | 100 | 216 | 333 | 1,319 | 1,932 | 4,567 | 17 | 128 | 1 | 26 |
| `GET /health` (10 gen procs) | 100 | 733 | 96 | 333 | 894 | 3,652 | 69 | 134 | 3 | 66 |
| `GET /api/trips?limit=20` (manager) | 1 | 101 | 10 | 12 | 13 | 20 | 43 | 128 | 1 | 22 |
| same | 10 | 175 | 44 | 131 | 222 | 444 | 79 | 128 | 5 | 31 |
| same | 100 | 238 | 415 | 499 | 810 | 1,246 | 97 | 131 | 5 | 24 |
| `GET /api/fleet/active` (manager, 100 trips) | 1 | 57 | 16 | 27 | 38 | 77 | 63 | 131 | 3 | 21 |
| same | 10 | 85 | 106 | 171 | 203 | 248 | 98 | 132 | 5 | 23 |
| same | 100 | 72 | 1,446 | 1,684 | 2,885 | 3,874 | 98 | 135 | 5 | 29 |
| `GET /api/notifications?limit=50` (NE manager) | 1 | 128 | 8 | 9 | 11 | 80 | 55 | 134 | 3 | 24 |
| same | 10 | 168 | 46 | 135 | 292 | 899 | 80 | 134 | 5 | 41 |
| same | 100 | 236 | 422 | 825 | 1,161 | 2,597 | 98 | 135 | 5 | 27 |
| `POST /api/driver/me/location`, 1 fix | 1 | 93 | 10 | 14 | 16 | 70 | 58 | 134 | 3 | 26 |
| same | 10 | 127 | 74 | 121 | 164 | 256 | 98 | 134 | 5 | 36 |
| same | 100 | 94 | 980 | 2,113 | 3,090 | 4,548 | 95 | 135 | 5 | 52 |
| `POST /api/driver/me/location`, 6 fixes | 10 | 138 (826 fixes/s) | 68 | 107 | 139 | 177 | 98 | 134 | 5 | 28 |
| `GET /api/driver/me/trip` | 10 | 114 | 78 | 139 | 272 | 402 | 97 | 134 | 5 | 45 |
| `GET /api/presence` (manager) | 1 | 8.9 | 108 | 157 | 198 | 212 | 22 | 134 | 5 | 46 |
| same | 10 | 19.9 | 499 | 650 | 715 | 770 | 82 | 134 | 10 | 75 |

Run 1 notes: `/health` at c=1 and c=10 was limited by one generator process (87-99% CPU), not the API
(16-18%). The GPS c=100 row ran at 52% machine-wide CPU; its throughput is lower than c=10 for that reason or
for queueing overhead, and the two were not separated. [PROVEN_BY_RUNTIME]

API CPU per request, both runs, computed from the rows above [INFERRED]:

| Endpoint | Run 1 | Run 2, reps 1 and 3 | Run 2, rep 2 |
|---|---|---|---|
| `/health` | 0.94 ms (c=100) | 0.70-0.75 ms (all reps) | same |
| Trip list | 4.1 ms (c=100) | 3.69-4.28 ms (all reps) | same |
| Notifications | 4.2 ms (c=100) | 3.51-3.75 ms (all reps) | same |
| GPS 1 fix | 7.7 ms | 4.82-5.08 ms (all reps) | same |
| GPS 6 fixes | 7.1 ms (1.2 per fix) | 6.00-6.09 ms (1.0 per fix) | 9.47 ms (1.6 per fix) |
| Driver trip | 8.5 ms | 5.62-5.66 ms | 27.5 ms |
| Fleet | 11.6 ms | 10.56-11.07 ms (all reps) | same |
| Presence | 41 ms | 29.2-36.5 ms | 84.2 ms |
| Dashboard | not measured | 43.4-43.9 ms | 75.6 ms |

The same endpoint cost up to 1.6x more CPU per request in run 1 than in run 2's normal repetitions (GPS
1-fix: 7.7 vs 4.8-5.1 ms). No per-request number here is a constant of the code alone. [INFERRED]

Database time is small next to that for most endpoints: EXPLAIN ANALYZE times were 0.005-1.7 ms per statement
for trips, fleet, driver trip, notifications, heartbeat and GPS (section 3.4). [PROVEN_BY_DATABASE] Most of
each request's cost is therefore Python work in the API process. [INFERRED]

### 3.2 Mixed traffic

Mix weights. The run 1 mix (`mix`, 84 units): location 30, driver trip 30, heartbeat 5, fleet 3, trip list 6,
open-trips list 6, notifications 2, presence 2. [PROVEN_BY_SOURCE: `LANE/harness/harness.py` MIX] It models
30 moving drivers (one location upload and one trip poll per 10 s, one heartbeat per 60 s) and 3 consoles per
10 s, each polling the Fleet page, the Trips page and the Overview presence at the same time. That over-counts
a real console, which shows one page at a time (section 5). [INFERRED] The notifications weight has no source:
nothing in manager-web polls `/api/notifications`; `NotificationsPage.tsx:85-89` fetches when the page opens
or the filter changes. [PROVEN_BY_SOURCE] The weight 2 is a guess at on-demand inbox reads. [NOT_VERIFIED]

Run 2 adds `mix2`: the same weights with notifications 2 replaced by dashboard 2, because the Overview page
polls `/api/dashboard` and `/api/presence` every 15 s (`manager-web/src/pages/OverviewPage.tsx:46,132-144`).
[PROVEN_BY_SOURCE] Both mixes leave out the emergencies list (Fleet page, 10 s), the Assignments page (5 s)
and the driver route-risk poll (5 min). [PROVEN_BY_SOURCE: section 5 files] Console share is 19 of 84 units
(23%), near the Tier-A model's 2.4 of 11.45 requests/s (21%). [INFERRED]

Statements per request, captured in-process with SQLAlchemy's `before_cursor_execute` hook on a fresh seed
with run 2's code (13:34 UTC). COMMIT and the pool pre-ping are not in these counts (whether they pass through
the hook was not checked). [PROVEN_BY_RUNTIME: `LANE/evidence/run2/smoke/explain_run2.json`]

| Endpoint | SELECT | INSERT |
|---|---|---|
| Trip list, open-trips list | 3 each | 0 |
| Presence | 4 | 0 |
| Fleet | 5 | 0 |
| Driver trip | 8 | 0 |
| Notifications | 2 | 0 |
| Dashboard | 29 | 0 |
| Heartbeat (within the 45 s coalescing window) | 1 | 0 |
| GPS, 1 fix | 4 | 1 |

Weighted SELECTs per request: `mix` (30x4 + 30x8 + 5x1 + 3x5 + 6x3 + 6x3 + 2x2 + 2x4) / 84 = 428 / 84 = 5.1;
`mix2` (notifications replaced by 2x29) = 482 / 84 = 5.7. INSERTs: 30 / 84 = 0.36 per request. [INFERRED]

Run 2, three repetitions per stage (spike once); min-max. Pool 3+2. [PROVEN_BY_RUNTIME, files
`LANE/evidence/run2/r{1,2,3}_mix*.json`, `spike_mix_0_to_300*.json`]

| Stage | c | Duration | req/s | p50 | p95 | p99 | max | Errors | CPU % | CPU ms/req | DB conn / active | Sys % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `mix` | 1 | 30 s | 78.9-82.1 | 10.6-10.9 | 14.5-15.6 | 83-87 | 145-160 | 0 | 47.8-48.3 | 5.82-6.10 | 3-5 / 1-3 | 14.6-18.6 |
| `mix` | 10 | 60 s | 155.8-164.2 | 55.1-57.3 | 110.9-123.8 | 161-179 | 221-295 | 0 | 97.5-97.9 | 5.96-6.28 | 7-9 / 2-4 | 21.6-24.5 |
| `mix2` | 10 | 60 s | 114.9-134.4 | 62.5-73.6 | 161.4-180.8 | 262-309 | 423-685 | 0 | 97.5-97.8 | 7.28-8.49 | 7-9 / 4 | 27.9-36.5 |
| `mix` (10 gen procs) | 100 | 60 s | 119.3-149.3 | 661-831 | 1,059-1,296 | 1,383-1,914 | 2,500-2,987 | 0 | 97.5-98.2 | 6.54-8.23 | 7-8 / 4 | 24.5-36.5 |
| `mix` (12 gen procs) | 200 | 30 s | 106.6-145.6 | 1,411-1,958 | 1,966-2,503 | 2,982-4,245 | 5,597-6,480 | 0 | 96.8-97.9 | 6.72-9.08 | 5-7 / 2-5 | 24.2-36.5 |
| `mix` (12 gen procs) | 400 | 30 s | 105.3-148.5 | 2,861-4,173 | 3,333-5,507 | 5,935-9,336 | 9,058-14,186 | 0 | 96.5-97.8 | 6.59-9.29 | 5-7 / 2-4 | 21.3-38.7 |
| Spike 0 -> 300 | 300 | 30 s | 102.2 | 3,073 | 3,978 | 6,941 | 12,144 | 0 | 97.0 | 9.49 | 7 / 3 | 35.3 |

Run 1, one run per stage. [PROVEN_BY_RUNTIME, files `LANE/evidence/run1/mix_*.json`, `stress_*.json`,
`spike_*.json`, `soak_*.json`, `pool15_*.json`]

| Stage | c | Duration | req/s | p50 | p95 | p99 | max | Errors | CPU % | CPU ms/req | DB conn / active | Sys % |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Smoke | 1 | 30 s | 55 | 14 | 26 | 134 | 274 | 0 | 54 | 9.7 | 5 / 3 | 38 |
| Load | 10 | 60 s | 96 | 94 | 193 | 278 | 438 | 0 | 98 | 10.2 | 7 / 4 | 46 |
| Load | 100 | 60 s | 93 | 1,081 | 1,707 | 2,437 | 3,666 | 0 | 98 | 10.5 | 7 / 3 | 48 |
| Stress | 200 | 30 s | 132 | 1,528 | 2,074 | 3,365 | 5,360 | 0 | 98 | 7.4 | 7 / 4 | 33 |
| Stress | 400 | 30 s | 121 | 3,341 | 5,024 | 7,903 | 14,261 | 0 | 98 | 8.1 | 8 / 4 | 34 |
| Spike 0 -> 300 | 300 | 30 s | 119 | 2,623 | 3,612 | 5,888 | 11,080 | 0 | 97 | 8.1 | 7 / 2 | 36 |
| Stress | 1,000 | 30 s | process crashed | - | - | - | - | 99.97% (5 OK) | - | - | - | 33 |
| Soak, paced 50 req/s | 50 | 300 s | 49.7 | 83 | 220 | 358 | 797 | 0 | 48 | 9.6 | 7 / 3 | 36 |
| Load, pool 5+10 | 10 | 30 s | 122 | 70 | 175 | 256 | 436 | 0 | 89 | 7.4 | 13 / 6 | 33 |
| Load, pool 5+10 | 100 | 60 s | 108 | 910 | 1,756 | 2,438 | 4,788 | 0 | 98 | 9.1 | 17 / 5 | 43 |

What the stages show:

- Saturation. Across both runs, one process saturated at 93-164 requests/s of `mix`. [PROVEN_BY_RUNTIME]
  Within run 2 the three repetitions of one stage differ by up to 41% (c=400: 105-149), and the low values
  are repetition 3, where machine-wide CPU was 36-39% instead of 21-29%. [PROVEN_BY_RUNTIME] The spread
  tracks machine contention. [INFERRED] Past saturation, extra concurrency adds queueing delay (latency is
  roughly concurrency / throughput). [INFERRED]
- `mix2` saturated at 115-134 requests/s, 18-26% below `mix` in the same repetition. [PROVEN_BY_RUNTIME] The
  difference is the dashboard, which costs about 43 ms of CPU per call against 3.5-3.8 ms for notifications.
  [INFERRED]
- SLO breach. With a read SLO of p95 <= 500 ms (section 6.3), the first breach lies between c=10 (p95
  111-193 ms) and c=100 (p95 1,059-1,707 ms) in both runs. [PROVEN_BY_RUNTIME]
- First hard failure. c=400 ran with zero errors in all four runs. At c=1,000 (run 1 only) the process died
  within the first 5 s with `ValueError: too many file descriptors in select()`
  (`LANE/evidence/run1/server-run1.select-crash.excerpt.txt`). A stand-alone check on this machine showed
  CPython's `select.select` accepting 512 sockets and raising at 513. [PROVEN_BY_RUNTIME] The project forces the
  selector event loop on Windows only (`backend/app/core/event_loop.py:31,38`). [PROVEN_BY_SOURCE] So this limit
  belongs to the local test host; the Linux host's file-descriptor limit on Render was not checked.
  [NOT_VERIFIED]
- The 1,000 stage is BLOCKED on this machine for that reason and was not repeated in run 2. [BLOCKED]
- Spike. Run 1: 119.2 requests/s over the stage; the six 5-s windows aligned to the stage start ran
  99.0-115.8 requests/s (85-129 for other alignments); zero errors; p50 in the first 5 s 2.1 s, max 4.5 s.
  Run 2: 102.2 requests/s; aligned windows 76.2-103.4 (76-106 for other alignments); zero errors; first 5 s p50
  2.2 s, max 3.9 s. [PROVEN_BY_RUNTIME: `spike_mix_0_to_300.raw.json` in each run] The client timeout was 30 s
  and `backend/app/db/session.py` sets no `pool_timeout` (SQLAlchemy default 30 s) [PROVEN_BY_SOURCE]; that no
  request reached either limit is why nothing failed. [INFERRED]
- Pool size. Run 1: pool 5+10 gave 122 and 108 requests/s at c=10 and c=100 against 96 and 93 for pool 3+2,
  but at different machine-wide CPU. [PROVEN_BY_RUNTIME] Run 2's pool 5+10 block (76.5-108.5 requests/s at
  c=10, 97.6-106.2 at c=100) ran newer code (section 2) at 34-57% machine-wide CPU and is not comparable; its
  files are kept but not used for comparisons; its CPU per request was 8.2-11.7 ms. [PROVEN_BY_RUNTIME]
  Contention moves throughput more than the pool differences
  seen, so these runs do not resolve a small pool effect. [INFERRED] With 96.5-98.3% CPU and at most 5 active
  backends on pool 3+2, the pool was not the limit at this CPU. [INFERRED]
- Soak (run 1 only), minutes aligned to the stage start: p50 45 / 82 / 82 / 89 / 125 ms, p95 137 / 194 / 166 /
  204 / 331 ms; machine-wide CPU 27 / 33 / 34 / 37 / 49%; API CPU rose from 39% to 63% at a constant 50
  requests/s. Working set: 113.6 MB at the first sample, then 129.2-131.0 MB. [PROVEN_BY_RUNTIME] No leak signal
  in 5 minutes. The latency drift matches the rise in machine-wide CPU; the soak neither proves nor rules out a
  data-growth effect (presence cost grows with GPS rows). [INFERRED]

### 3.3 Login (run 1 only)

Login is deliberately expensive (Argon2id, `time_cost=3`, `memory_cost=64 MiB`, `parallelism=4`,
`backend/app/core/security.py:27-29`) and rate-limited per client address (20 per 60 s) and per identifier
(10 per 60 s) (`backend/app/core/config.py:146-156`). It was measured as it is and not tuned.
[PROVEN_BY_SOURCE]

| Test | Result | Label |
|---|---|---|
| 10 sequential logins | all 200; min 77 ms, p50 90 ms, max 141 ms | PROVEN_BY_RUNTIME |
| 25 concurrent logins, one address, 25 identifiers | 20 x 200 and 5 x 429. The 429s returned within 80 ms. The 200s took 348-1,211 ms (p50 886 ms); all 20 finished 1.23 s after the burst started, about 60 ms each, one after another | PROVEN_BY_RUNTIME |
| 20 concurrent logins during GPS ingest paced at 20 req/s | GPS before the burst: p50 18 ms, p95 37 ms, max 97 ms (n=363). During the 1.23 s burst: p50 90 ms, p95 960 ms, max 963 ms (n=20). After: p50 54 ms, p95 104 ms, max 168 ms. The after-burst rise was not explained | PROVEN_BY_RUNTIME |
| API peak working set | 151.4 MB in every stage before the login tests; 199.0 MB from the login interference stage until the server was restarted for the pool comparison | PROVEN_BY_RUNTIME |

Why the burst serialises: `verify_password(password, stored_hash)` is called directly inside the async
login function (`backend/app/services/auth.py:179`), so each Argon2 check blocks the only event loop.
[PROVEN_BY_SOURCE] The 60 ms per login and the stall of unrelated GPS requests match that. [INFERRED]

The rate limiter keeps its counters in process memory (`backend/app/core/rate_limit.py:85`).
[PROVEN_BY_SOURCE] With N API processes each has its own counters, so the budget per address becomes N x 20
per minute. [INFERRED]

### 3.4 Database observations

EXPLAIN (ANALYZE, BUFFERS) of the SQL each endpoint issued. Run 2 figures come from the fresh seed at 410,530
GPS rows (`LANE/evidence/run2/smoke/explain_run2.json`); run 1 figures from `LANE/evidence/run1/explain.json`.
[PROVEN_BY_DATABASE]

| Endpoint | Slowest statement | Plan |
|---|---|---|
| `GET /api/trips?limit=20` | page query 1.3-1.7 ms (run 2), 1.57 ms (run 1) | Seq Scan on trips (2,374 rows) and shipments, top-N heapsort for LIMIT 21; then `SELECT count(trips.id) FROM trips` (0.17-0.24 ms) |
| `GET /api/presence` | 65.1 ms (run 2), 89.2 ms (run 1) | `max(gps_points.received_at)` joined to trips for all drivers: Gather Merge over a Parallel Seq Scan of gps_points, 3 x 136,843 rows, i.e. the whole table. Run 1: about 444,000 tuples returned per call (3.95 M tuples/s at 8.9 calls/s) |
| `GET /api/dashboard` | 70.7 ms (run 2) | The same whole-table GPS aggregate; another statement (3.1 ms) seq-scans all 20,183 users; 29 SELECTs per call |
| `GET /api/fleet/active` | 0.43 ms (run 2), 0.77 ms (run 1) | Latest position per trip by a LATERAL index lookup (100 loops, 1 row each); top-N sort of the active trips for LIMIT 100 |
| `GET /api/driver/me/trip` | < 0.04 ms each | Index scans |
| `POST /api/driver/me/location` | < 0.06 ms each (4 SELECTs) | Plus one INSERT ... ON CONFLICT DO NOTHING; `pool_pre_ping=True` adds a ping on each checkout (`backend/app/db/session.py:55`, PROVEN_BY_SOURCE) |

Source of the statements [PROVEN_BY_SOURCE]: presence `backend/app/api/presence.py:102` (`select(User).where(User.is_active)`,
every active user, no limit) and `:134` (the aggregate); dashboard `backend/app/api/dashboard.py:195-196`; trip
list `backend/app/services/trips.py:417` (ORDER BY) and `:431-432` (count) in the current working tree, lines
415 and 430 in tag `snapshot/post-demo-2026-09-26`, with `with_total=True` at `backend/app/api/trips.py:198`.
No trips index serves `ORDER BY created_at` alone: besides the primary key the model defines
`uq_trips_trip_code`, `ix_trips_active` (status, partial), `ix_trips_truck_time` (truck_id, created_at),
`ix_trips_driver_time` (driver_id, created_at) and `ix_trips_shipment` (`backend/app/models/operations.py:320-330`).

- Storage per GPS row, heap plus 5 indexes (4 btree, 1 GiST): 473.7 bytes at 410,530 freshly seeded rows.
  [PROVEN_BY_DATABASE: `LANE/evidence/run2/payload_storage_start.json`] After repetition 3 it read 479.6 bytes
  at 457,049 rows; that figure includes free space left by the earlier reset deletes, so it is an upper bound.
  [PROVEN_BY_DATABASE: `payload_storage_after_rep3.json`] Seeded rows have no altitude or heading, so real rows
  may be slightly larger. [INFERRED]
- At mixed-traffic saturation in run 1 (96 requests/s) PostgreSQL showed 140 commits/s, 34 inserted rows/s and
  1.24 M tuples returned/s. [PROVEN_BY_DATABASE: `LANE/evidence/run1/mix_load_c10.json`]
- Statements seen active for more than 200 ms (sampled once per second, so shorter ones are missed): run 1, the
  presence aggregate once (236 ms, soak) and `autovacuum: ANALYZE public.gps_points` once (234 ms, stress
  c=200); run 2, only autovacuum work on gps_points (ANALYZE up to 914 ms, four times; one `VACUUM ANALYZE`
  of 1,626 ms right after seeding). No application statement other than the presence aggregate was seen above
  200 ms. [PROVEN_BY_DATABASE]

### 3.5 Payload sizes (uncompressed JSON bodies, local, run 2)

[PROVEN_BY_RUNTIME: `LANE/evidence/run2/payload_storage_start.json`; sizes only, no bodies stored]

| Response | Bytes | Items |
|---|---|---|
| `GET /api/fleet/active` | 70,440 | 100 trips |
| `GET /api/trips?open_only=true&limit=100` | 61,631 | 100 |
| `GET /api/trips?limit=20` | 12,417 | 20 |
| `GET /api/presence` | 85,116 | 313 people |
| `GET /api/notifications?limit=50` | 11,791 | 50 |
| `GET /api/assignments?active_only=true` | 9,751 | 25 |
| `GET /api/dashboard` | 1,493 | 8 states |
| `GET /api/driver/me/trip` | 1,336 | 2 stops |
| `POST /api/presence/heartbeat` response | 63 | - |

The GPS upload response size (180 bytes in run 1) was not stored in any evidence file. [NOT_VERIFIED] Run 2's
driver placeholders are longer than run 1's numeric phone values, so bodies that carry `drivers.phone` differ by
a few bytes between runs. [INFERRED]

With `Accept-Encoding: gzip` the API sent no `Content-Encoding` and no `ETag` on any of these responses.
[PROVEN_BY_RUNTIME] There is no compression middleware in `backend/app` (a search for GZip and ETag finds
nothing). [PROVEN_BY_SOURCE] Whether Render's proxy compresses responses was not checked. [NOT_VERIFIED]

`GET /api/fleet/active` returns at most 100 trips: the route is `fleet_router` in `backend/app/api/trips.py`
(router at `:1752`), its `limit` uses `Limit` from `backend/app/api/trips.py:64` (`le=100`) and
`backend/app/api/trips.py:1770` defaults it to 100. [PROVEN_BY_SOURCE] With 301 ACTIVE trips it returned 100,
and `?limit=101` returned 422. [PROVEN_BY_RUNTIME: `payload_storage_start.json` `fleet_cap_check`] The manager
map cannot show more than 100 moving trucks today. [INFERRED]

### 3.6 Not measured

| Item | Why | Label |
|---|---|---|
| Hosted API and hosted Supabase | Out of scope by rule: no load against hosted URLs | NOT_VERIFIED |
| Route planning, route risk, reroute, geocoding, AI | They call external providers, which were disabled | NOT_VERIFIED |
| Push delivery (Expo) | Third-party; `PUSH_ENABLED=false` | NOT_VERIFIED |
| Network round trip between Render (singapore, `render.yaml:36`) and the Supabase region | The Supabase region is not in the repository; each request makes 1-29 database statements (section 3.2), so the RTT multiplies | NOT_VERIFIED |
| More than one API process | Not run; see section 9 | NOT_VERIFIED |
| Login, soak and c=1,000 in run 2 | Not repeated; run 1 results stand as single measurements | NOT_VERIFIED |
| Trip list and notifications saturation in run 2 | c=10 was generator-limited; c=100 was not repeated | NOT_VERIFIED |
| Concurrency 1,000 | Local host limit (section 3.2) | BLOCKED |

## 4. CURRENT_BOTTLENECK

Ranked by how soon it limits a real deployment.

| # | CURRENT_BOTTLENECK | Evidence | Label |
|---|---|---|---|
| 1 | Hosted compute: one uvicorn worker on a Render free instance | `render.yaml:35` `plan: free`; `backend/Dockerfile:53` `--workers 1` | PROVEN_BY_SOURCE |
| 1a | Render free limits | 0.1 CPU / 512 MB (https://render.com/docs/compute-plans); spins down after 15 minutes without inbound traffic, about one minute to spin up, "might restart a Free web service at any time" (https://render.com/docs/free) | PROVEN_BY_WEB |
| 1b | Hosted capacity | 5.96-10.5 ms CPU per mixed request gives about 9.5-17 requests/s at 0.1 CPU, against a Tier-A peak estimate of about 11.5 requests/s: may be above or below, unresolved; CPU parity with the test core unknown | INFERRED |
| 2 | Single-process CPU on any host | Run 1: six of seven DB-backed endpoints at 95-98% of one core with at most 3 active backends; presence at 82% with 9 including parallel workers. Both runs: mixed traffic at 96.5-98.3% with at most 5 active backends | PROVEN_BY_RUNTIME |
| 3 | Login blocks the event loop | 20 logins serialised over 1.23 s; GPS max 97 ms before, 963 ms during (`LANE/evidence/run1/login.json`); cause at `backend/app/services/auth.py:179` (section 3.3) | PROVEN_BY_RUNTIME |
| 4 | Presence and dashboard read the whole GPS history per call | 65-89 ms aggregate over the whole table; about 444,000 tuples per call in run 1; 29-44 ms of API CPU per call in run 2's normal repetitions; statements at `backend/app/api/presence.py:102,134` and `backend/app/api/dashboard.py:195-196`; the Overview page polls both every 15 s | PROVEN_BY_DATABASE |
| 5 | Trip list sorts and counts every trip | Seq Scan + top-N sort + `count` per call (`backend/app/services/trips.py:417,431-432`; `backend/app/api/trips.py:198` `with_total=True`); polled twice every 5 s per Trips page | PROVEN_BY_DATABASE |
| 6 | One GPS fix per request | The client flushes on every 1 s tick (`driver-app/src/tracking/useLocationTracking.ts:55,136`) and sends `queue.slice(0, batchSize)` (`driver-app/src/tracking/tracker.ts:460`), so a fix every 10 s becomes a request every 10 s. Six-fix batches: 4.8-6.5x fixes per CPU-second | PROVEN_BY_RUNTIME |
| 7 | Fleet map cap of 100 trips | `backend/app/api/trips.py:64` (`le=100`) and `:1770`; returned 100 of 301 | PROVEN_BY_RUNTIME |
| 8 | Push delivery holds a pooled database connection | `notify.send` "Flushes, never commits" (`backend/app/services/notify.py:109`) and awaits the Expo POST with `PUSH_TIMEOUT_SECONDS` 8.0 (`backend/app/services/notify.py:80`, `backend/app/core/config.py:313`) inside the caller's transaction. With 5 pooled connections, 5 slow pushes could hold the whole pool; not measured | INFERRED |
| 9 | Hosted database size, if the project is on the Free plan | Free plan: read-only above 500 MB (https://supabase.com/docs/guides/platform/database-size). Tier-A GPS alone is about 68 MB/day (section 6.2); the project's plan is not known | INFERRED |

What is NOT the bottleneck in these measurements: PostgreSQL CPU and connections for every endpoint except
the two that run the whole-history GPS aggregate, and the pool size at this CPU. [INFERRED from section 3]
This was a local database on loopback; the hosted Supabase compute size is not known. [NOT_VERIFIED]

## 5. What the clients poll today

Working tree, from source. The hosted build e4043ce has the same trip poll, fleet poll, GPS flush and Trips
page cadence; the heartbeat and the Overview page polls exist only in the working tree.
[PROVEN_BY_SOURCE: `git show origin/main:<file>` for the files below]

| Client | What | Cadence | Source |
|---|---|---|---|
| Driver app | `GET /api/driver/me/trip` | 10 s in foreground, 30 s in background | `driver-app/src/trip/TripProvider.tsx:97,262-265` |
| Driver app | `POST /api/driver/me/location` | each fix: 10 s moving, 60 s stationary; flushed on a 1 s tick, up to 6 per request | `backend/app/domain/telemetry_policy.py:62,75`; `driver-app/src/tracking/useLocationTracking.ts:55,136`; `driver-app/src/tracking/tracker.ts:452-460` |
| Driver app | `POST /api/presence/heartbeat` | 60 s (server coalesces inside 45 s) | `driver-app/src/trip/TripProvider.tsx:104,257`; `backend/app/api/presence.py:44,81` |
| Driver app | `GET /api/driver/me/trip/route-risk` | 5 min | `driver-app/src/hooks/useRouteRisk.ts:53`, `driver-app/src/api/client.ts:1231` |
| Manager web | `GET /api/fleet/active` | 10 s, backing off to 60 s on failure; Fleet page only | `manager-web/src/hooks/useFleetPoll.ts:32-33`; `manager-web/src/pages/FleetPage.tsx:289` |
| Manager web | emergencies list (Fleet page) | 10 s | `manager-web/src/pages/FleetPage.tsx:401-405` |
| Manager web | Trips page: current page and open trips (limit 100) | 5 s each; page size "ALL" walks every page each time | `manager-web/src/pages/TripsPage.tsx:52,118-135,173-178` |
| Manager web | Assignments page | 5 s | `manager-web/src/pages/AssignmentsPage.tsx:21` |
| Manager web | Overview: dashboard and presence | 15 s each | `manager-web/src/pages/OverviewPage.tsx:46,132-144` |
| Manager web | Notifications page | no poll; fetched on open and on filter change | `manager-web/src/pages/NotificationsPage.tsx:85-89` |
| Manager web | `/health` probe | 5 s, only while offline | `manager-web/src/api/connectivity.ts:22,44-54` |
| Manager web | all `useResource` polls | skipped while the tab is hidden or offline | `manager-web/src/hooks/useResource.ts:95-101` |

Per-user request rates used in section 6 [INFERRED from the table]:

- Moving driver, app in foreground: 0.1 (trip) + 0.1 (location) + 0.0167 (heartbeat) + 0.0033 (route risk)
  = about 0.22 requests/s.
- Signed-in driver without a moving trip, app in background: 0.033 + 0.0167 = about 0.05 requests/s.
- Open, visible manager console: 0.2 (Fleet page, plus the emergencies list) to 0.4 (Trips page)
  requests/s. The average of 0.3 requests/s is a planning input. [NOT_VERIFIED]

## 6. Tier model

### 6.1 Inputs (planning inputs, all NOT_VERIFIED)

| Input | A: pilot / demo | B: statewide | C: all-NER (8 states) | D: national, multi-million accounts | Derivation |
|---|---|---|---|---|---|
| Trucks | 50 | 2,000 | 10,000 | 200,000 | A: one operator's fleet for a pilot. B: a large state's government-linked freight. C: roughly 5x B for eight states. D: national scale for planning only |
| Registered users | 80 | 2,800 | 14,000 | 2,000,000 | Drivers at 1.2-1.25 per truck plus staff; D adds fleet owners, shippers and officials |
| Daily active users | 55 | 2,000 | 10,000 | 300,000 | About 70% of registered for A-C; 15% for D |
| Active trips at peak | 40 | 1,500 | 7,500 | 150,000 | About 75-80% of trucks on the road at peak for A-C; lower for D |
| Idle signed-in drivers at peak | 5 | 300 | 1,500 | 50,000 | Drivers between trips with the app open |
| Open consoles at peak | 8 | 150 | 750 | 20,000 | One per 5-10 active trips; D includes public-sector viewers |
| Peak sessions | 53 | 1,950 | 9,750 | 220,000 | Sum of the three rows above |

### 6.2 Derived load (INFERRED from 6.1, section 5 and the measured costs; nothing here is measured)

| Output | A | B | C | D | Formula |
|---|---|---|---|---|---|
| GPS events/s | 4 | 150 | 750 | 15,000 | active trips x 0.1 (one fix per 10 s while moving) |
| GPS requests/s today | 4 | 150 | 750 | 15,000 | one fix per request (section 4, row 6) |
| API requests/s at peak | 11.5 | 390 | 1,950 | 41,500 | active x 0.22 + idle x 0.05 + consoles x 0.3 |
| Notification events/s, peak | 0.03 | 1.25 | 6.3 | 125 | 8 events per trip life (planning input), trips/day = 1.5 x peak active trips, spread over 12 h, peak factor 3 |
| Notification rows written/s, peak | 0.1 | 3.8 | 19 | 375 | events x 3 recipients (planning input: district, state and regional inboxes) |
| DB SELECTs/s | 58-66 | 1,990-2,240 | 9,940-11,190 | 211,000-238,000 | API requests/s x 5.10-5.74 (weighted SELECTs per request, section 3.2) |
| DB writes/s (rows) | 5 | 184 | 920 | 18,700 | GPS rows + heartbeat updates (drivers / 60) + notification rows |
| GPS storage/day | 68 MB | 2.56 GB | 12.8 GB | 256 GB | active trips x 3,600 rows (10 moving hours, `backend/app/domain/telemetry_policy.py:58`) x 474 bytes (section 3.4) |
| API egress/day | 2.5 GB | 50 GB | 251 GB | 6.4 TB | driver about 5.5 MB/day (10 h of trip polls at 1,336 B and GPS replies at an unverified 180 B) + console 280 MB/day (35 MB/h for 8 h, a planning input between the Fleet page's 25 MB/h and the Trips page's 53 MB/h at the section 3.5 sizes), uncompressed |
| API CPU needed (cores like the test core) | 0.07-0.12 | 2.3-4.1 | 11.6-20.5 | 247-436 | API requests/s x 5.96-10.5 ms (saturated mixed stages of both runs, run 2's pool block excluded) |
| API processes at 60% target utilisation | 1 | 4-7 | 20-35 | 412-727 | CPU needed / 0.6, rounded up |

The CPU rows do not include the slower window seen in run 2 (section 1, item 10), where per-request cost
rose 1.6-4.9x for minutes, nor run 2's excluded pool block (up to 11.7 ms, 11% above the band). A host with
that behaviour needs more headroom than the table shows. [INFERRED]

Tier D with today's polling needs hundreds of processes and 6.4 TB/day of mostly repeated JSON. That is the
reason for section 7: the request rate must fall, not only the capacity rise. [INFERRED] With GPS batched once
a minute, the driver trip poll replaced by push plus a 60 s fallback, and the heartbeat and route-risk polls
kept, a moving driver drops from 0.22 to about 0.053 requests/s (0.0167 + 0.0167 + 0.0167 + 0.0033). Tier D
then becomes 150,000 x 0.053 = 8,000 for moving drivers, 1,700-2,500 for idle drivers (0.033-0.05 each,
depending on whether their background trip poll also moves to 60 s) and 6,000 for consoles unchanged: about
15,700-16,500 requests/s. [INFERRED] Consoles are then more than a third of the load; reducing them needs the
console stream in section 7 stage 3, whose effect is not quantified here. [INFERRED]

### 6.3 SLO per tier (proposed targets, NOT_VERIFIED; nothing is measured against the hosted service)

| | A | B | C | D |
|---|---|---|---|---|
| Monthly availability | 99.0% | 99.5% | 99.9% | 99.95% |
| REAL_TIME_CRITICAL writes (dispatch, trip state, acknowledgement, emergency), server p95 | <= 1 s | <= 500 ms | <= 500 ms | <= 300 ms |
| Emergency end to end (driver action to manager screen) | <= 15 s | <= 10 s | <= 10 s | <= 5 s |
| NEAR_REAL_TIME reads (fleet, presence, counts), server p95 | <= 1 s | <= 500 ms | <= 500 ms | <= 500 ms |
| Position freshness shown as LIVE | 90 s (`LOCATION_FRESH_SECONDS`, `backend/app/domain/telemetry_policy.py:26`) | 90 s | 60 s | 60 s |
| GPS ingest p95 | <= 1 s | <= 1 s | <= 500 ms | <= 500 ms |

Against the local measurement, one process met the Tier-A read and write targets at c=10: 96 requests/s with
p95 193 ms in run 1, and 156-164 requests/s with p95 111-124 ms in run 2 (`mix`); 115-134 requests/s with p95
161-181 ms (`mix2`). [PROVEN_BY_RUNTIME] The hosted service was not measured, and the Render free plan's
spin-down (about one minute after 15 idle minutes) alone breaks any of these targets. [INFERRED]

### 6.4 Measured Tier-A position

| Question | Answer | Label |
|---|---|---|
| Does one process on the test core carry Tier-A peak (about 11.5 requests/s)? | Yes, with about 8-14x headroom (93-164 requests/s of `mix` at saturation across both runs; 115-134 for `mix2`) | PROVEN_BY_RUNTIME for the throughput; the demand side is a planning input |
| Does it hold 4x Tier-A peak for 5 minutes? | Yes in run 1: 50 requests/s, 0 errors, p95 220 ms, flat memory after the first sample | PROVEN_BY_RUNTIME |
| Does the hosted free instance carry Tier-A peak? | Unresolved: about 9.5-17 requests/s at 0.1 CPU if its CPU matches this core, against about 11.5 requests/s | INFERRED |
| Memory on the hosted instance | Locally 126.7-156.4 MB working set under load in run 2, 126-147 MB in run 1, 199 MB peak during the login tests, against 512 MB; the hosted figure was not measured | PROVEN_BY_RUNTIME |
| Does the hosted database hold a Tier-A month of GPS? | Depends on the plan, which is not known. Free: read-only above 500 MB, about 7 days of Tier-A GPS ignoring existing data. Pro: an 8 GB disk that grows automatically, about 117 days before the first growth (limits from https://supabase.com/docs/guides/platform/database-size) | INFERRED |

### 6.5 Cost envelope

Only prices read on the vendor pages in this session are given. Everything else is NOT_VERIFIED.

| Tier | Compute and database | Known monthly prices | Label |
|---|---|---|---|
| Current hosted | Render free web service (0.1 CPU, 512 MB, 750 free instance hours per workspace per month) + Supabase project (plan unknown; Free runs on Nano compute, 500 MB, no automatic backups) | Nano compute $0 | PROVEN_BY_WEB (https://render.com/docs/free, https://render.com/docs/compute-plans, https://supabase.com/docs/guides/platform/compute-and-disk, https://supabase.com/docs/guides/platform/backups) |
| A (pilot with an SLO) | One always-on API instance of at least 1 CPU / 2 GB (Render `1c-2g`, listed as `standard`); Supabase Pro with Small compute; PITR 7 days (PITR needs at least Small compute) | Small ~$15; PITR 7 days ~$100. Render prices and the Supabase Pro base fee were not read | PROVEN_BY_WEB for the listed prices |
| B | 4-7 API processes (sizing INFERRED, section 6.2); Supabase Large (8 GB, 2 dedicated vCPU) or XL (16 GB, 4 vCPU); PITR 14 days; GPS partitioning and retention | Large ~$110, XL ~$210, PITR 14 days ~$200 | PROVEN_BY_WEB for the listed prices |
| C | 20-35 API processes (sizing INFERRED, section 6.2); Supabase 2XL-4XL (32-64 GB, 8-16 vCPU); PITR 28 days | 2XL ~$410, 4XL ~$960, PITR 28 days ~$400 | PROVEN_BY_WEB for the listed prices |
| D | Not costed. Needs the section 7 changes first; sizing today's polling design for D is not meaningful | - | INFERRED |

Egress: Supabase Free includes 5 GB, Pro/Team 250 GB (https://supabase.com/docs/guides/platform/billing-on-supabase).
[PROVEN_BY_WEB] Render's included bandwidth was not read. [NOT_VERIFIED] Tier-B API egress (about 50 GB/day
uncompressed) needs compression and delta sync before any of these allowances matter. [INFERRED]

## 7. Real-time classification and the path from polling to push

| Class | Items | Today (source, section 5) | Target |
|---|---|---|---|
| REAL_TIME_CRITICAL | Emergency, dispatch, trip state, route change, acknowledgement, urgent alert | Driver learns by the 10 s trip poll plus an Expo push sent inside the request (`backend/app/services/notify.py:98-133`). Manager learns by 5 s (Trips) or 10 s (Fleet, emergencies) polls | Push as the trigger, then one fetch; poll only as a fallback. Never depend on push alone |
| NEAR_REAL_TIME | Fleet position, presence, dashboard counts, route-risk card | 10 s fleet poll (90 s LIVE threshold); 60 s heartbeat; 15 s presence and dashboard polls; 5 min route risk | Efficient polling (compressed, conditional, delta); later a server-sent stream for consoles |
| EVENTUALLY_CONSISTENT | Reports and exports, analytics, POI snapshots | On demand. POI data is a bundled snapshot read through `lru_cache` (`backend/app/services/places/snapshot.py:236`) | Leave as on-demand reads; move heavy aggregates off the request path when they grow |

[PROVEN_BY_SOURCE for the "Today" column; the targets are proposals]

### Stage 1: polling (today)

About 0.22 requests/s per moving driver and 0.2-0.4 requests/s per open console, full lists every time, no
compression, no conditional requests. [PROVEN_BY_SOURCE]

### Stage 2: efficient polling (no new infrastructure)

1. Batch GPS on the phone: flush when 6 fixes are queued or the oldest is 60 s old, not on every 1 s tick. The
   server already advertises `batch_size` 6. Measured effect on the server: 4.8-6.5x fixes per CPU-second.
   [PROVEN_BY_RUNTIME]
2. Compress responses with Starlette's built-in `GZipMiddleware` (FastAPI already depends on Starlette; no new
   package). Payloads are 12-85 KB of JSON today. The size saving was not measured. [NOT_VERIFIED]
3. Conditional and delta reads: `ETag` / `If-None-Match` on fleet and trip lists, or a `since` cursor so
   unchanged data costs a 304 or an empty list. (proposal)
4. Slow down polls that do not need 5 s: the Trips page polls two lists every 5 s; 15 s plus the existing
   refresh on tab focus is enough for NEAR_REAL_TIME data. Drivers without an ACTIVE trip do not need a 10 s
   trip poll. (proposal; cadences PROVEN_BY_SOURCE in section 5)
5. Fix the queries that grow with history (section 8, items 2-3) before adding any capacity.

### Stage 3: push-triggered sync

1. Drivers: the Expo push path exists. Use it to say "something changed, fetch now" and keep a 60 s poll as the
   fallback. Move the push call out of the request transaction (section 4, row 8).
2. Consoles: a server-sent event stream (plain HTTP, supported by browsers without a library, served by a
   Starlette streaming response) carrying trip-state, emergency and notification-count changes.
3. With more than one API process, the stream needs a shared signal. PostgreSQL `LISTEN/NOTIFY` is already
   in the stack and is the first choice. A broker is ROADMAP (section 9).

## 8. Changes in order, cheapest first

| # | Change | Evidence it is needed | Decision |
|---|---|---|---|
| 1 | Run Argon2 off the event loop (`asyncio.to_thread`) behind a small semaphore (for example 2) so concurrent logins cannot each take 64 MiB | 963 ms GPS stall during 20 logins; working-set peak rose from 151 to 199 MB during the login tests; 512 MB hosted RAM | ADOPT_NOW |
| 2 | Presence and dashboard: find each driver's newest fix with the same LATERAL one-row lookup `latest_positions` already uses, restrict to drivers on open trips, and bound the list | 65-89 ms whole-table aggregate in both endpoints; 29-44 ms of API CPU per call; both polled every 15 s per Overview console | ADOPT_NOW |
| 3 | Trip list: index `trips (created_at DESC, id DESC)`; return the exact total only when asked, not on every 5 s poll | Seq Scan + sort + count per call | ADOPT_NOW |
| 4 | Driver app: batch GPS uploads (Stage 2, item 1) | 4.8-6.5x fixes per CPU-second | ADOPT_NOW |
| 5 | Compression and conditional requests (Stage 2, items 2-3) | 12-85 KB bodies, no gzip, no ETag | ADOPT_NOW |
| 6 | Take Expo push out of the request transaction (record the row, commit, send after) | Pool of 5 vs an 8 s push timeout (not measured) | ADOPT_NOW |
| 7 | Before a pilot with an SLO: leave the free plans (paid always-on instance, Supabase Pro, PITR) and confirm a restore | Section 4 rows 1 and 9; section 10 | ADOPT_NOW, owner decision |
| 8 | Multi-process API: move limiter counters to PostgreSQL, run the route-watch and sentinel loops in one leader (PostgreSQL advisory lock), keep simulation state in the database | In-process state listed in section 10 | ROADMAP (Tier B) |
| 9 | Fleet map beyond 100 trucks: viewport or paged query | Cap of 100 | ROADMAP (Tier B) |
| 10 | GPS partitioned by day with a stated retention for raw fixes | About 2.56 GB/day at Tier B | ROADMAP (Tier B) |
| 11 | Push-triggered sync (Stage 3) | Tier C-D request rates | ROADMAP (Tier C) |

## 9. New infrastructure register

Nothing below is justified by a measured bottleneck today except the move off the free plans. Each item gives
the seven required fields or is marked ROADMAP.

### 9.1 Paid always-on API instance and Supabase Pro with PITR (upgrade of existing services)

| Field | Content |
|---|---|
| CURRENT_BOTTLENECK | 0.1 CPU free instance with idle spin-down (PROVEN_BY_WEB); database plan, size cap and backups unknown (NOT_VERIFIED) |
| LOAD_TEST | Local: 5.96-10.5 ms CPU per mixed request; one core served 93-164 requests/s of `mix` at saturation; soak at 50 requests/s clean (sections 3.1-3.2, PROVEN_BY_RUNTIME) |
| WHY_CURRENT_STACK_FAILS | 0.1 CPU gives about 9.5-17 requests/s against about 11.5 requests/s Tier-A peak, which leaves no known margin either way (INFERRED); spin-down after 15 idle minutes costs about one minute (PROVEN_BY_WEB); Free Supabase has no automatic backups and goes read-only at 500 MB (PROVEN_BY_WEB) |
| EXPECTED_BENEFIT | At 1 CPU (Render `1c-2g`), ten times today's CPU: about 95-168 requests/s if its core matches the test core (INFERRED); a known backup and a worst-case PITR RPO of two minutes (PROVEN_BY_WEB) |
| OPERATIONAL_COST | Supabase Small ~$15/month + PITR 7 days ~$100/month (PROVEN_BY_WEB); Render paid instance and Supabase Pro base fee NOT_VERIFIED |
| FAILURE_MODE | Still one API instance and one database: a crash or deploy is still an outage until section 8 item 8 is done (INFERRED) |
| ROLLBACK | Switch the Render plan back; disable the PITR add-on. No code change (INFERRED) |

### 9.2 Additional API processes or instances (same image, no new component)

| Field | Content |
|---|---|
| CURRENT_BOTTLENECK | Single-process CPU (section 4, row 2; PROVEN_BY_RUNTIME) |
| LOAD_TEST | 96.5-98.3% CPU at mixed-traffic saturation with at most 5 active backends; the pool comparison is unresolved (section 3.2; PROVEN_BY_RUNTIME) |
| WHY_CURRENT_STACK_FAILS | One process uses one core. Tier B needs about 2.3-4.1 cores of API CPU like the test core (INFERRED) |
| EXPECTED_BENEFIT | Close to linear for CPU-bound endpoints until the database saturates (INFERRED; not measured with more than one process) |
| OPERATIONAL_COST | Pool per process x N must fit the Supabase pooler: `render.yaml:80-82` says 15 clients per project for the session pooler (PROVEN_BY_SOURCE); the compute page lists pooler client limits by size, 200 on Nano (PROVEN_BY_WEB); the project's pooler mode and setting NOT_VERIFIED; section 8 item 8 first |
| FAILURE_MODE | Without section 8 item 8: login limits multiply by N; route-watch and sentinel loops run N times; a demo simulation injected in one process is invisible to the others (INFERRED from `backend/app/core/rate_limit.py:85`, `backend/app/services/route_watch.py:84`, `backend/app/services/simulation.py:57`, `backend/app/main.py:89,117,140`). Duplicate driver pushes are limited: `notify.send` skips an event whose fingerprint was sent in the last 30 minutes (`backend/app/services/notify.py:52,113-124`, PROVEN_BY_SOURCE), so duplicates need two processes racing before either commits, or one of the zero-cooldown events `TRIP_ASSIGNED`, `REROUTE_APPROVED`, `CRITICAL_ROUTE_CHANGE` (`backend/app/services/notify.py:47-51`, PROVEN_BY_SOURCE) (INFERRED) |
| ROLLBACK | Set the instance count or `--workers` back to 1 (INFERRED) |

### 9.3 Redis (shared rate limits, cache, pub/sub)

ROADMAP. No measured bottleneck needs it: limiter state and leader election fit in PostgreSQL at Tier B
request rates, and caching is not the limit (API CPU is). Revisit only if a PostgreSQL-backed limiter or
LISTEN/NOTIFY is measured to be insufficient. [INFERRED]

### 9.4 Message broker (Kafka, RabbitMQ, NATS or similar)

ROADMAP. Push delivery and GPS ingest are not queue-bound in any measurement here. Revisit at Tier C if GPS
ingest needs to be decoupled from the request path. [INFERRED]

### 9.5 Read replicas

ROADMAP. The database was not the bottleneck: at most 5 active backends while the API was saturated by mixed
traffic [PROVEN_BY_RUNTIME]; presence and dashboard have a query problem, not a capacity problem [INFERRED]. A
replica would also add replication lag to data classified NEAR_REAL_TIME. [INFERRED]

## 10. Single points of failure and RPO/RTO

### 10.1 Single points of failure of the current hosted deployment

| # | Component | Why it is single | Label |
|---|---|---|---|
| 1 | API service `ner-intelligence` | One Render free instance, one worker (`render.yaml:30-36`, `backend/Dockerfile:53`); Render may restart free services at any time and spins them down when idle (https://render.com/docs/free) | PROVEN_BY_SOURCE |
| 2 | Supabase project | One database, no replica known; plan, backups and PITR unconfirmed | NOT_VERIFIED |
| 3 | In-process state | Rate-limit counters, route-watch state, simulation scenarios, provider health and provider caches live in process memory and vanish on restart (`backend/app/core/rate_limit.py:85`, `backend/app/services/route_watch.py:84`, `backend/app/services/simulation.py:57`, `backend/app/services/provider_health.py:83`, `backend/app/services/terrain.py:67`, `backend/app/services/warnings.py:42-44`) | PROVEN_BY_SOURCE |
| 4 | API base URL baked into the driver build | Changing the API host needs a new APK build (`render.yaml:14-18` comment) | PROVEN_BY_SOURCE |
| 5 | One region | API in Render singapore only (`render.yaml:36`) | PROVEN_BY_SOURCE |
| 6 | External providers | Public OSRM for routing (`backend/app/core/config.py:182`, described in the code as having no quality guarantee), Open-Meteo, NDMA SACHET, Nominatim, Expo push. The code reports these as NOT_AVAILABLE rather than failing, except that a slow push holds a database connection (section 4, row 8) | PROVEN_BY_SOURCE |
| 7 | Static manager and driver-web sites | Separate Render static services; their failover was not checked | NOT_VERIFIED |

### 10.2 RPO and RTO

| | Status | Label |
|---|---|---|
| Backups | Unconfirmed. The migration packet records "Backup and recovery — NOT CONFIRMED" and that nobody has seen the project's backup page or PITR setting | PROVEN_BY_SOURCE (`docs/MIGRATION_0013_DEPLOYMENT_PACKET.md:181-193`) |
| RPO if the project is on Free (plan not known) | No automatic backups; Supabase recommends regular `db dump` exports, so RPO is the age of the last export, which is unknown (https://supabase.com/docs/guides/platform/backups) | PROVEN_BY_WEB |
| RPO if on Pro without PITR (plan not known) | Daily backups, 7-day retention: up to about 24 h of data | PROVEN_BY_WEB |
| RPO with PITR | Worst case two minutes per Supabase; not enabled as far as anyone has confirmed | PROVEN_BY_WEB |
| RTO | Unknown. No restore drill has been run and timed. API redeploy time from the Dockerfile was not measured | NOT_VERIFIED |
| Target (proposal) | Tier A: RPO <= 24 h, RTO <= 4 h with one timed restore drill. Tier B and above: PITR, RPO <= 5 min, RTO <= 1 h | NOT_VERIFIED |

UNKNOWN is not SAFE: until a backup is seen and a restore is timed, the hosted RPO and RTO must be treated
as unbounded.

## 11. Reproducing the measurement (run 2)

Scripts in `LANE/harness/` (outside the repository). `run_all.sh` does, in order:

1. Generates a JWT secret into the shell's memory only; records machine-wide CPU for 10 s with no load.
2. `recreate_db.py`: `CREATE DATABASE ner_logistics_perf TEMPLATE ner_logistics_demo` on the isolated cluster
   and `ALTER DATABASE ... SET search_path = "$user", public, extensions` (PostGIS lives in `extensions`; a
   template copy does not carry per-database settings). `migrate.py`: `alembic upgrade head` with
   `DATABASE_PROVIDER=local` and both database URLs pointing at the perf database only (`env.py` asserts it).
3. `seed.py`, `seed_inbox.py` (ORM models from `backend/app/models`; one random password, hashed once and not
   stored; drivers sign in by email; no phone numbers), `reset_gps.py mark`.
4. `serve.py` (one worker, port 8041, providers off), `evidence.py start` (payload sizes, headers, fleet cap,
   GPS bytes per row).
5. Three repetitions of: eight endpoint stages at c=10, `/health` at c=100, `mix` at c=1/10/100/200/400,
   `mix2` at c=10, then `reset_gps.py reset`. Then the spike, `explain.py`, the pool 5+10 block, and
   `drop_db.py`. `summarize_run2.py` writes the min-max summary.

Run 2 ended at 14:16 UTC with `ner_logistics_perf` dropped; the cluster then listed only cert, demo, test,
rls_test, postgres and the templates. [PROVEN_BY_DATABASE: `LANE/evidence/run2/run_all.out`] `explain.py`
failed at the dashboard call because the model code changed under it (section 2); the statement counts in
section 3.2 come from the same script's smoke run at 13:34 UTC. [PROVEN_BY_RUNTIME]

## 12. Evidence index

| Claim | Where | Label |
|---|---|---|
| Run 2 stage numbers | `LANE/evidence/run2/r{1,2,3}_*.json`, `spike_mix_0_to_300.json` (+ `.raw.json`, `.samples.json`), `run2_summary.json` | PROVEN_BY_RUNTIME |
| Run 2 excluded pool block | `LANE/evidence/run2/pool15_r*_mix_c*.json` | PROVEN_BY_RUNTIME |
| Run 2 log and baselines | `LANE/evidence/run2/run_all.out`; server logs in `LANE/harness/results/server-*.log` | PROVEN_BY_RUNTIME |
| Payload sizes, gzip/ETag, fleet 100-of-301 and limit=101 check, GPS bytes per row | `LANE/evidence/run2/payload_storage_start.json`, `payload_storage_after_rep3.json` | PROVEN_BY_RUNTIME |
| Statement counts per endpoint | `LANE/evidence/run2/smoke/explain_run2.json` (`statements_by_verb`) | PROVEN_BY_RUNTIME |
| Run 2 query plans | `LANE/evidence/run2/smoke/explain_run2.json` (`plans`) | PROVEN_BY_DATABASE |
| Run 1 stage, login and plan numbers | `LANE/evidence/run1/*.json` (copied unchanged from run 1's results) | PROVEN_BY_RUNTIME |
| Select limit | `LANE/evidence/run1/server-run1.select-crash.excerpt.txt`; stand-alone `select.select` check: 512 ok, 513 ValueError | PROVEN_BY_RUNTIME |
| Harnesses | Run 2: `LANE/harness/*.py`, `run_all.sh`. Run 1: `LANE/evidence/run1/harness.run1.py`, `run2.sh`, `run3.sh`, `run_endpoints.sh` | PROVEN_BY_SOURCE |
| Render limits | https://render.com/docs/free, https://render.com/docs/compute-plans | PROVEN_BY_WEB |
| Supabase limits and prices | https://supabase.com/docs/guides/platform/compute-and-disk, https://supabase.com/docs/guides/platform/backups, https://supabase.com/docs/guides/platform/database-size, https://supabase.com/docs/guides/platform/billing-on-supabase | PROVEN_BY_WEB |
| Client cadences | files and lines in section 5 | PROVEN_BY_SOURCE |

## 13. Rule compliance note

Run 1 wrote its harness, result files, about 11 MB of server logs and three private files into
`.runtime/perf/` inside the repository working tree (gitignored, so `git status` does not show them):
`perf-secret.private.txt` (the JWT secret of the dropped perf database), `tokens.private.json` (access tokens
signed with it) and `perf-credentials.private.json` (a generated password and 300 synthetic full phone
numbers). [PROVEN_BY_SOURCE: directory listing and run 1's `seed.py`] This lane may not delete or move existing
files, so they are still there. They are reported to the main session for deletion. Run 2 wrote nothing inside
the repository except this document; its fixture generates no phone numbers and writes no secret.
[PROVEN_BY_SOURCE: `LANE/harness/`]

## 14. Changes from the reviewed version

- Section 1 item 1 and section 4 row 2 no longer say "every" endpoint: presence and dashboard differ, and the
  figures are per run.
- The "93-132 req/s" band, the "7.4-10.2 ms" band and the per-endpoint "ceilings" were replaced with measured
  spreads from both runs; every derived figure (hosted estimate, headroom, cores, processes) was recomputed.
- Tier D after the section 7 changes is about 15,700-16,500 requests/s, not 10,000 (consoles were missing).
- Fleet cap cited at `backend/app/api/trips.py:64` and `:1770`; trip-list lines updated to 417 and 431-432.
- Spike windows and the "> 200 ms" statement corrected; mix weights explained and `mix2` added; statement counts
  per endpoint shown.
- Section 9.2 now states the 30-minute push cooldown.
- The unlabelled multi-million-user sentence was removed.
- Evidence is indexed under `LANE/` (run 1 results copied there; the originals and run 1's private files remain
  in `.runtime/perf/`, section 13); payload sizes, bytes per row and the fleet check now have an evidence file;
  the unstored 468 B/row figure and the unstored GPS reply size were dropped or marked NOT_VERIFIED.
- New findings: the dashboard runs the same whole-history GPS aggregate as presence, and per-request CPU cost
  rose 1.6-4.9x for about three minutes in run 2.

## 15. Run 3 (26 September, 16:16-17:00 UTC): the c=1,000 crash, and 1, 2 and 4 workers

This run used the same harness, with the perf database rebuilt at the working tree's Alembic head (0014)
and re-seeded: 300 active trips, 2,000 historical trips and 410,530 GPS rows at the start.

- Code: HEAD 5b5e474 plus the dirty tree, snapshotted as `git stash create` eabc641 without touching the tree.
- Pool: 3+2 per worker, as hosted. Providers off.
- Evidence: `.runtime/perf/results-infra/` (gitignored). An adversarial reviewer re-read every row below
  from those files.

**Throughput metric.** Two figures are reported where they differ materially:

- The harness's `rps` counts requests completed up to the end of the window, including the c requests
  still in flight, and divides by the duration.
- `rps_in_window` excludes those in-flight requests, so it is exactly c/d lower.

For the same reason, CPU ms per request is understated at high c.

### 15.1 Root cause of the c=1,000 crash [PROVEN_BY_RUNTIME]

**The error.** `ValueError: too many file descriptors in select()`, raised by
`selectors.SelectSelector._select` from `asyncio.BaseSelectorEventLoop._run_once`. It unwinds
`uvicorn/server.py` `asyncio.run(self.serve())`, and the process exits with code 1. The crash excerpts are
`w1_mix_c800.server-log-excerpt.txt`, `w1_mix_c1000.server-log-excerpt.txt`,
`w1bisect_mix_c512.server-log-excerpt.txt` and `w1bisect_mix_c525.server-log-excerpt.txt`.

**The threshold, one worker.**

- c=400 and c=500 survived 30 s with 0 errors. At c=500, netstat showed 500 server-side ESTABLISHED
  connections plus 5 database sockets.
- c=512, 525, 800 and 1,000 died within 1-1.5 s of load start.
- A stand-alone check confirmed that `select.select` accepts 512 sockets and raises at 513.

**Why.** On Windows the project forces the selector event loop, because psycopg async cannot run on the
proactor loop (`backend/app/core/event_loop.py`). On win32 that loop uses `select()`, which is capped at
512 sockets per process: listener, self-pipe, client sockets and database sockets together.
[PROVEN_BY_SOURCE]

**The cap is per process.**

- 2 workers ran c=800 cleanly but crash-looped at c=1,000: 9 worker deaths, the supervisor respawning,
  94.5% errors.
- 4 workers ran c=1,000 with 0 errors.

**Production is Linux.** There, `selectors.DefaultSelector` is epoll, and the image's `uvicorn[standard]`
picks uvloop (libuv/epoll); neither calls `select()`. At the Linux file-descriptor limit, asyncio pauses
`accept()` for 1 s instead of dying. [PROVEN_BY_SOURCE: `Lib/selectors.py`,
`Lib/asyncio/selector_events.py`, `backend/Dockerfile:19`, `backend/requirements.txt:5`]

**So the crash is a property of the Windows test host, not of the hosted service.** [INFERRED]

- Linux behaviour at c=1,000 is **BLOCKED** here: WSL has no distribution installed and Docker is absent.
- Render's `nofile` limit, and whether the hosted image really loaded uvloop, are NOT_VERIFIED.

**What c=1,000 does prove on any OS.** One worker at c=1,000 would not crash on Linux, but it would queue:
at c=500 on one worker, p50 is already 3.9 s (15.2). The fix for 1,000 concurrent clients is more CPU
(workers or instances), not a different socket API. [INFERRED from 15.2]

### 15.2 Stage ladder, `mix`, 1 worker [PROVEN_BY_RUNTIME]

| c | Duration | req/s (in-window) | p50 | p95 | p99 | Errors | API CPU (% of one core) | DB conns max |
|---|---|---|---|---|---|---|---|---|
| 1 | 30 s | 79.9 | 10.8 | 15.2 | 84.1 | 0 | 48.6 | 2 |
| 10 | 60 s | 160.5 | 56.3 | 115.1 | 168.5 | 0 | 97.9 | 7 |
| 100 | 30 s | 159.9 | 634 | 813 | 1,297 | 0 | 97.3 | 7 |
| 200 | 30 s | 151.1 | 1,345 | 2,292 | 2,778 | 0 | 97.6 | 5 |
| 400 | 30 s | 146.1 (132.8) | 2,902 | 5,530 | 6,101 | 0 | 97.6 | 7 |
| 500 | 30 s | 142.0 (125.4) | 3,872 | 4,300 | 7,945 | 0 | 96.9 | 7 |
| 512 / 525 / 800 / 1,000 | - | crashed (15.1) | - | - | - | 94-100% | - | - |

Latencies are in ms.

- Saturation begins at c=10, at 6.1 ms of API CPU per request.
- Past saturation, throughput also falls: from c=10 to c=500 it drops 11% by the reported metric and 22%
  in-window.
- Latency grows roughly as c / throughput.

### 15.3 One host, 1 / 2 / 4 workers [PROVEN_BY_RUNTIME]

All workers ran on the same 24-thread machine as the load generator and PostgreSQL. So this measures what
extra processes buy on one host, not what separate instances would buy.

| Workers | Stage | req/s (in-window) | p50 | p95 | p99 | Errors | API CPU (sum, % of one core) | DB conns max |
|---|---|---|---|---|---|---|---|---|
| 1 | mix c=400 | 146.1 (132.8) | 2,902 | 5,530 | 6,101 | 0 | 97.6 | 7 |
| 2 | mix c=400 | 235.4 (222.0) | 1,750 | 2,649 | 3,784 | 0 | 195.4 | 12 |
| 4 | mix c=400 | 327.9 (314.5) | 1,197 | 1,932 | 2,978 | 0 | 391.2 | 23 |
| 2 | mix c=800 | 226.3 (199.6) | 3,817 | 4,623 | 8,572 | 0 | 194.6 | 14 |
| 4 | mix c=800 | 328.0 | 2,165 | 3,842 | 6,601 | 0 | 390.4 | 26 |
| 2 | mix c=1,000 | worker crash loop (15.1) | - | - | - | 94.5% | - | - |
| 4 | mix c=1,000 | 325.7 (292.4) | 3,020 | 5,278 | 9,174 | **0** | 388.2 | 26 |
| 1 | gps6 c=100 | 153.9 req/s = 924 fixes/s | 645 | 1,239 | 1,393 | 0 | 97.6 | 5 |
| 2 | gps6 c=100 | 269.5 req/s = 1,617 fixes/s | 363 | 684 | 789 | 0 | 196.0 | 10 |
| 4 | gps6 c=100 | 398.5 req/s = 2,391 fixes/s | 248 | 423 | 529 | 0 | 395.3 | 20 |

**Scaling at c=400, in-window, against 1 worker: 1.67x at 2 workers and 2.37x at 4.**

- CPU per request rose from 7.4 ms to 8.8 ms, then to 12.4 ms.
- Machine-wide CPU was 24%, 37% and 61%, and the load generator used up to 2.7 cores on the same host.
- No pool or lock limit showed: at most 6-9 active backends at 1 Hz, below each pool's 5. This is INFERRED,
  because pool and lock waits were not instrumented.
- The shortfall from linear is therefore INFERRED to be host contention. Scaling on separate instances is
  NOT_VERIFIED.
- The multi-worker c=10 and c=100 rows (in the evidence files) were limited by the load generator and are
  not used.

**Database connections scale with workers.**

- 1 worker used 5-7 connections, 2 used 9-14 and 4 used 15-26. The rows above 20 include PostgreSQL
  parallel workers (INFERRED).
- The repo documents a 15-client session-pooler budget (`render.yaml:80-82`). Against it, 3 instances at
  3+2 already use the whole budget.

### 15.4 Where one worker's CPU goes (cProfile, `mix` c=10, 30 s) [PROVEN_BY_RUNTIME, `profile_report.json`]

Figures are shares of busy time. Profiling roughly doubled CPU per request (11.1 against 6.1 ms), and the
overhead lands most on call-heavy pure-Python code, so treat the shares as approximate.

| Area | Share |
|---|---|
| SQLAlchemy ORM + core (SQL compilation, cache keys, coercions 17.9; ORM 11.4; engine/pool 5.3) | 39.6% |
| psycopg (execute, prepare, fetch) | 16.1% |
| asyncio loop + socket I/O | 13.7% |
| Starlette/FastAPI routing, middleware, dependency injection, anyio | 12.6% |
| `uuid.UUID` construction (281,234 calls for 2,661 requests: large result sets) | 3.1% |
| Application code's own time | 2.9% |
| pydantic 2.4, httptools 1.2, json 1.1, access log 0.8, JWT 0.7, other 5.9 | 12.1% |

The client-side database stack is more than half the cost, and the application's own logic is under 3%.
The cheapest levers are therefore fewer statements per request and smaller result sets (the presence and
fleet reads), not rewriting business code. [INFERRED]

### 15.5 Login [PROVEN_BY_RUNTIME, `login_seq20.json`, `argon2_verify_inprocess.json`]

- 20 sequential logins on one worker: p50 56.4 ms, p95 64.9 ms, max 252.9 ms.
- One Argon2id verify (t=3, 64 MiB, p=4) takes p50 45.1 ms, which is 80% of a login.
- The verify runs on the event loop (`backend/app/services/auth.py:179`) [PROVEN_BY_SOURCE]. Each login
  therefore stalls every other request on that worker for about 45 ms.
- Moving the verify to a bounded thread is in the cycle-4 fix list (`docs/INDIA_HOSTING_DECISION.md`).

### 15.6 What run 3 changes in this plan

- **The Windows select() crash** is now PROVEN and bracketed at 500-512 connections per process. It no
  longer blocks reasoning about hosted capacity, because hosted runs Linux. (INFERRED)
- **More workers raise throughput on one host** (1.67x at 2, 2.37x at 4), but only after the in-process
  state in section 9.2's failure mode is moved out. `docs/INDIA_HOSTING_DECISION.md` Phase 1b lists that
  state.
- **The 1,000-concurrency target is met locally** by 4 workers with 0 errors, but at p50 3.0 s, far outside
  the p95 250 ms read target. Meeting the latency target at c=1,000 needs about 1,000 / 160 ≈ 6-7 cores of
  API CPU at today's per-request cost, or less work per request. [INFERRED]
- **Deviations and confounders:**
  - The multi-worker c=10 stages ran 30 s instead of 60 s.
  - Auto-vacuum on `gps_points` ran during three stages.
  - Raw per-request records were not kept, so percentiles cannot be recomputed from raw data.
  - `hx.py` changed after the 1-worker ladder: its first sample moved from 1.5 s to 0.5 s.

### 15.7 Linux validation of c=1,000 — BLOCKED, and how to close it

`LINUX_C1000 = NOT_VERIFIED`. This machine has no Linux:

- `wsl -l -v` reports no installed distribution;
- `docker` is not on PATH;
- no Linux VM or remote runner may be used without the owner's approval.

Installing a WSL distribution is a system change and a download, so it is left to the owner.

To close it:

1. **Environment.** One of:
   - `wsl --install -d Ubuntu-24.04` (owner action; needs a reboot on first install);
   - a Linux VM;
   - a CI runner. This requires pushing, which is not authorised.
2. **Database.** Inside Linux, run PostgreSQL 16 + PostGIS locally, or reach the Windows cluster at the
   host address, not `127.0.0.1`. Create `ner_logistics_perf` Supabase-shaped (the `extensions` schema
   and search_path recipe in `.runtime/rehearsal/cert_build_db.py`), and `alembic upgrade head`.
3. **API.** Run the image's command exactly: `uvicorn app.main:app --workers N`, with
   `uvicorn[standard]` (uvloop, httptools) as `backend/requirements.txt` pins. Use `ulimit -n` at the
   container default, then raised, and record both.
4. **Load and sampling.** The load generator is `.runtime/perf/harness.py`. Its CPU and RSS sampler
   (`winproc.py`) is Windows-only, so swap it for `psutil` or `/proc/<pid>/stat` before running.
5. **Ladder.** Stages 1, 10, 100, 200, 400, 800 and 1,000 for 1, 2 and 4 workers. Record:
   - req/s, p50, p95, p99 and error rate;
   - API CPU and RSS summed over the workers;
   - database connections (`pg_stat_activity`);
   - open sockets (`ss -tan state established '( sport = :8041 )' | wc -l`).
6. **Pass rule.** 1,000 PASSES on Linux if the process survives with an error rate of 0 or near 0. At
   the fd limit, record whether asyncio's accept back-off logs "socket.accept() out of system resource".
   Latency at c=1,000 is expected to be queue-bound on one worker (run 3's p50 at c=500 was already
   3.9 s), so the latency target is a separate question: more instances or less work per request.

### 15.8 Replica coordination (27 Sep): section 9.2's failure mode addressed, switched off

The in-process state that made a second API process unsafe now has Postgres-backed replacements. They sit
behind `MULTI_INSTANCE` (default false; migration `0015_instance_coordination`):

- leader leases for route watch and the sentinel;
- one global Nominatim pacing slot;
- shared login and refresh windows;
- the demo simulation forced off.

With the switch off, nothing changes and no coordination query runs. Proof and status:
`docs/INDIA_HOSTING_DECISION.md` §5. Two OS processes against one database showed:

- no overlapping leaders;
- pacing slots 1.000 s apart;
- takeover about 0.24 s after a killed leader's lease expired. [PROVEN_BY_RUNTIME]

The 1/2/4-worker numbers in 15.3 were measured with the switch off, so they include no coordination cost.
Measure them again with it on before using them for Phase 1b.
