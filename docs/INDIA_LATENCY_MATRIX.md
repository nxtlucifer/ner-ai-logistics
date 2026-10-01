# RASTA AI — India latency matrix

Measured 26 September 2026, 15:48–16:05 UTC. This is the evidence the hosting decision
(`docs/INDIA_HOSTING_DECISION.md`) is taken from. Every number below was measured unless it is
labelled otherwise.

## 1. What was measured, from where

| Source | What it is | Honest limits |
|---|---|---|
| Globalping synthetic probes (api.globalping.io, anonymous, 174 of 250 hourly tests) | One probe per city, chosen on an access-ISP network: Guwahati (National Internet Backbone), Kolkata (Alliance Broadband), New Delhi (Excitel), Mumbai (Airtel), Hyderabad (STPI), Bengaluru (Jio), Chennai (ACT) | Fixed broadband or hosted agents, **not phones on 4G/5G**. City is Globalping's geolocation. n = 3 per city and target, so **no p95 can be computed**; p50 and max are given. |
| Ahmedabad | No Globalping probe anywhere in Gujarat on the day | **NOT MEASURED**. No substitute city was used. |
| Developer workstation | curl timings | Location deliberately not recorded (privacy rule). One network, one machine. |

Raw responses: `.runtime/infra/globalping/*.json` (gitignored); recomputed independently from those files
(`.runtime/infra/latency_summary.json`) and by an adversarial reviewer.

Every probe request opened a fresh connection. The columns are Globalping's phase timings:

- **TCP** is the connect time to whatever terminated the connection.
- **First byte** is request-sent to first-response-byte. That is what a request on an already-open
  keep-alive connection pays.
- **New connection** is the total: DNS + TCP + TLS + first byte + download.

Hosted request volume: 64 GETs to the hosted services over about 8 minutes (21 each to `/health`,
`/ready` and the manager home page, plus one from the workstation). There were no authenticated calls
and no load. That is more than the "handful" the brief asked for; the three-repetition design caused it.

## 2. The current origin — Render Singapore (free plan) + Supabase Mumbai

Both the API and the static sites sit behind Cloudflare, so **TCP** is to a nearby edge in every city.
The first-byte time carries the trip to the origin.

| Client | `/health` first byte p50 (max) | `/health` new connection p50 | `/ready` first byte p50 (max) | `/ready` new connection p50 | Manager `/` first byte p50 | Errors |
|---|---|---|---|---|---|---|
| Guwahati | 167 (176) | 355 | 737 (859) | 852 | 186 | 0/9 |
| Kolkata | 250 (265) | 411 | 604 (961) | 719 | 129 | 0/9 |
| New Delhi | 206 (217) | 303 | 840 (898) | 940 | 276 | 0/9 |
| Mumbai | 207 (224) | 285 | 835 (949) | 868 | 322 | 0/9 |
| Hyderabad | 210 (220) | 438 | 672 (688) | 780 | 277 | 0/9 |
| Bengaluru | 75 (140) | 143 | 454 (947) | 518 | 330 | 0/9 |
| Chennai | 60 (132) | 160 | 371 (428) | 395 | 321 | 0/9 |
| Ahmedabad | NOT MEASURED | | | | | |
| Developer workstation (n = 5–6, warm) | 342–562 total | | 619–1,056 total | | 542–760 total | 0 |

Milliseconds. `/health` does no database work. `/ready` opens a pooled session and runs `SELECT version()`
and `SELECT postgis_version()`: about 4–6 serial round trips counting pre-ping, BEGIN and ROLLBACK
(`backend/app/api/health.py:53,75`, `backend/app/db/session.py:55`).

**Cold start.** When the API is asleep, the first request waits for the free instance to boot:

| Date | First `/health` | Next four |
|---|---|---|
| 20 Sep | 32.85 s | 0.17–0.42 s |
| 26 Sep | 32.64 s | 0.34–0.56 s |

Render documents that free web services spin down after 15 minutes without traffic and take about a
minute to come back (PROVEN_BY_WEB, render.com/docs/free).

## 3. The database leg — why Singapore costs every request

TCP ping (3 handshakes each) to the **shared** Supabase ap-south-1 pooler host
(`aws-0-ap-south-1.pooler.supabase.com:6543`; no project-specific host was probed):

| From | Network | RTT min / avg / max (ms) |
|---|---|---|
| Singapore | Amazon | 61.4 / 62.9 / 65.8 |
| Singapore | DigitalOcean | 54.7 / 56.7 / 58.7 |
| Mumbai | Amazon | 0.99 / 1.06 / 1.11 |
| Mumbai | Airtel | 8.3 / 8.4 / 8.5 |

So each database round trip from a Singapore API costs **about 55–66 ms**. From an API in the same
Mumbai region it costs **about 1 ms**. The gap between `/ready` and `/health` (about 160–630 ms at p50
across cities) is consistent with 4–6 such round trips plus the free instance's 0.1 CPU. [INFERRED:
the Render instance itself was not the probe]

A GPS upload makes about 7 serial round trips (pre-ping, user, driver, current trip, latest position,
insert, commit — `backend/app/api/driver.py` ingest path, per the client-latency audit). An authenticated
list read makes about 4–6. **From Singapore that is roughly 250–450 ms of every request spent crossing the
Bay of Bengal. From Mumbai it would be under 10 ms.** [INFERRED from the RTTs above; not measured
end-to-end on a Mumbai deployment]

## 4. Candidate India regions — network floor per city

These endpoints do almost no work, so they measure the network floor an API in that region could
approach. They are not an application.

AWS in-region endpoints terminate TCP in the region itself, so **TCP ≈ one round trip to the region**:

| Client | AWS ap-south-1 Mumbai TCP / first byte | AWS ap-south-2 Hyderabad TCP / first byte | AWS ap-southeast-1 Singapore TCP / first byte |
|---|---|---|---|
| Guwahati | 50 / 53 | 41 / 42 | 84 / 85 |
| Kolkata | 38 / 38 | 39 / 41 | 72 / 73 |
| New Delhi | 17 / 17 | 30 / 32 | 57 / 57 |
| Mumbai | 8 / 7 | 20 / 20 | 77 / 76 |
| Hyderabad | 22 / 22 | 18 / 19 | 47 / 47 |
| Bengaluru | 22 / 24 | 17 / 19 | 43 / 44 |
| Chennai | 18 / 19 | 13 / 15 | 35 / 36 |
| Workstation (n = 5) | 40 / 37 | 56 / 57 | 97 / 98 |

Google Cloud Run (gcping.com's public per-region services) sits behind Google's front end, so TCP ends at
a nearby Google edge. **First byte** carries the trip to the region:

| Client | asia-south1 Mumbai first byte p50 (max) | asia-south2 Delhi first byte p50 (max) | Errors |
|---|---|---|---|
| Guwahati | 74 (86) | 119 (128) | 0 |
| Kolkata | 66 (80) | 94 (121) | 0 |
| New Delhi | 69 (70) | 78 (249) | 0 |
| Mumbai | 15 (15) | 60 (61) | 0 |
| Hyderabad | 30 (31) | 74 (78) | 1 each (DNS timeout on the probe) |
| Bengaluru | 47 (72) | 64 (79) | 0 |
| Chennai | 40 (41) | 80 (84) | 0 |
| Workstation (n = 5) | 50 (74) | 91 (104) | 0 |

Two of 168 probe requests failed, both on the Hyderabad probe's own DNS resolver.

## 5. What the matrix says

1. **The biggest latency sources are the hosting plan and the region pairing, not the code.**
   - A sleeping origin costs about 32.6 s on the first request.
   - An API in Singapore talking to a database in Mumbai pays 55–66 ms per query round trip.
   - At the same time, the warm local API serves the mixed workload at p50 55–57 ms and p95 111–124 ms
     at c = 10 (`docs/SCALABILITY_AND_CAPACITY_PLAN.md`).
2. **Mumbai is the evidence-based primary region.**
   - The database is already there: 1 ms from Mumbai against 55–66 ms from Singapore, and Supabase
     offers no other India region.
   - Mumbai is within 17–53 ms of every measured city.
   - Hyderabad is 1–9 ms closer for Guwahati, Bengaluru and Chennai. But an API there would pay a
     Hyderabad↔Mumbai database round trip about 7 times per request (20 ms by the Mumbai probe's
     ap-south-2 TCP time). That more than cancels the gain.
   - GCP's Delhi region measured slower than its Mumbai region from every probe, the Delhi probe
     included.
3. **The North-East pays the most distance.** Guwahati and Kolkata are 38–53 ms from Mumbai and 72–84 ms
   from Singapore. Moving the origin from Singapore to Mumbai saves the North-East about 30–35 ms per
   round trip on top of the database saving.
4. **Static files already come from an Indian edge.** Cloudflare lists 22 Indian cities
   (PROVEN_BY_WEB, cloudflare.com/network), and every probe connected to an edge in 2–51 ms.
   - The manager page's first byte is still 129–330 ms. The HTML and hashed assets are both served
     `max-age=0, s-maxage=300`, so the edge revalidates with the origin every 5 minutes and browsers
     revalidate every asset on every visit (client audit FE-17).
   - That is a header fix, not a hosting move.

## 6. Not measured, and why

| Item | Status | Why / what would close it |
|---|---|---|
| Ahmedabad | NOT MEASURED | No probe in Gujarat. Needs a registered Globalping probe, a cloud VM in ap-south-1 as a proxy, or a person in Ahmedabad. |
| p95 per city | NOT COMPUTABLE | n = 3. A proper p95 needs 20+ samples per city. A scheduled synthetic check (for example every 5 minutes for a day) would provide them. |
| Real mobile networks (4G/5G, handoff, loss) | NOT MEASURED HERE | Probes are fixed broadband. The driver network-condition lab runs locally (`docs/SCALABILITY_AND_CAPACITY_PLAN.md`). |
| Authenticated hosted API paths (login, trip list) | NOT MEASURED | Signing in to a hosted service is outside what this work may do. `/ready` is the database-path proxy. |
| An actual RASTA deployment in Mumbai | NOT MEASURED | Nothing was deployed. The Mumbai figures are the network floor plus INFERRED server time. |
| Render instance → Supabase RTT | INFERRED | Measured from Singapore probes on Amazon and DigitalOcean, not from inside Render. |
