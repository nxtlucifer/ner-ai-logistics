# RASTA AI — India hosting decision

Prepared 26 September 2026 by the CTO/SRE lane. The measurements come from
`docs/INDIA_LATENCY_MATRIX.md` (network, all-India) and `docs/SCALABILITY_AND_CAPACITY_PLAN.md`
section 15 (capacity, local). Every provider fact cites the official page it was read on.

**Nothing here has been deployed, bought or signed up for.** Moving hosts, paid plans, account creation
and APK redistribution are decisions for the project owner (section 8).

## 1. Recommendation

| Decision | Recommendation | Why, in one line |
|---|---|---|
| Primary region | **Mumbai** (GCP `asia-south1` or AWS `ap-south-1`) | The database is already in Mumbai: about 1 ms from Mumbai against 55–66 ms from Singapore. Mumbai is also 7–53 ms from every measured city. |
| API host | **Google Cloud Run, `asia-south1`, instance-based billing, 1 vCPU / 1 GiB** | India region, minimum instances, autoscaling, WebSockets/SSE, HTTPS URL out of the box, and the same Docker image as today. |
| Instances | **Phase 1a: min 1, max 1. Phase 1b: min 2 with `MULTI_INSTANCE=true`** | Without the coordination switch, two replicas would send drivers duplicate hazard pushes and break Nominatim's 1 req/s policy. The switch is built and proven locally (section 5); it still needs checking on two real instances. |
| Database | **Stay on Supabase `ap-south-1`**, move to a plan with backups | Already co-located. Moving it would add a second failure domain for no latency gain. |
| Static sites | **Stay on Render static (Cloudflare edge)** and fix the cache headers | Every probe reached an Indian edge in 2–51 ms. The slow part is `max-age=0` on hashed files, which is a header fix. |
| Secondary region | Roadmap: Delhi (`asia-south2`) or Hyderabad (`ap-south-2`) as a cold standby for compute | Supabase has no second India region, so database DR means backups/PITR plus a tested restore, not a live replica. |
| Multi-region serving | **Rejected for now** | No measurement shows a need. Active-active writes would complicate trip state, GPS ordering, reservations and approvals. |

The ranking is by evidence. The owner may pick AWS instead of GCP (section 3); the region should not
change.

## 2. Current state (measured)

| Fact | Value | Evidence |
|---|---|---|
| API host | Render free plan, Singapore, Docker, 1 worker, 0.1 CPU | `render.yaml:30-36`, `backend/Dockerfile:53`; render.com/docs/free |
| Sleep | Spins down after 15 minutes idle. **First request 32.6 s** (26 Sep), 32.85 s (20 Sep) | PROVEN_BY_RUNTIME; render.com/docs/free |
| India region on Render | **None.** Regions are Oregon, Ohio, Virginia, Frankfurt, Singapore | render.com/docs/regions |
| Database | Supabase `ap-south-1` (Mumbai), session pooler, pool 3+2 | `docs/ARCHITECTURE.md:347-353`, `render.yaml:80-86` |
| API ↔ DB round trip | 55–66 ms (Singapore probes to the Mumbai pooler) | `docs/INDIA_LATENCY_MATRIX.md` §3 |
| Warm `/health` (no DB), first byte p50 | 60–250 ms by city | Matrix §2 |
| Warm `/ready` (DB), first byte p50 | 371–840 ms by city | Matrix §2 |
| Supabase free plan | No automatic backups; paused after 1 week inactive | supabase.com/docs/guides/platform/backups, supabase.com/pricing |
| Local capacity, 1 worker | 160 req/s at c=10, p95 115 ms. 6.1 ms API CPU per request | Scalability plan §15.2 |

## 3. Host comparison

| | Render free (today) | Render paid (Starter / Standard) | **GCP Cloud Run `asia-south1`** | AWS ECS Fargate `ap-south-1` |
|---|---|---|---|---|
| India region | No (Singapore) | No (Singapore) | **Yes, Mumbai (Tier 1)**; Delhi Tier 2 | Yes, Mumbai; Hyderabad opt-in |
| Always on | No, sleeps after 15 min | Yes (INFERRED: the docs describe spin-down for Free only) | Yes, with min instances ≥ 1 | Yes (tasks run until stopped) |
| Autoscaling | None, 1 instance | Manual on all plans; autoscaling needs the Pro workspace ($25/month + compute) | Built in, max 100 per revision by default | Service auto scaling (not priced here) |
| Load balancer | Render proxy (Cloudflare) | Same | Built in (`*.run.app`). Custom domain mapping is **not** offered in `asia-south1`; a load balancer or proxy is needed for one | ALB needed (price NOT_VERIFIED) |
| WebSocket / SSE | Yes | Yes | Yes; each stream is a request with a ≤60 min timeout | Yes, via ALB (NOT_VERIFIED here) |
| DB proximity to Supabase Mumbai | 55–66 ms | 55–66 ms | **~1 ms (same region)** | **~1 ms (same region)** |
| Compute price for 1 always-on instance | $0 | Starter 0.5 CPU $7/month; Standard 1 CPU $25/month | 1 vCPU + 1 GiB instance-based ≈ **$47/month** after the free tier (INFERRED from the published Tier 1 rates) | NOT_VERIFIED (Fargate Mumbai rates not fetched) |
| Ops complexity | Lowest | Lowest | Low: one container, one service; needs a GCP project and billing account | Medium: cluster, task definition, ALB, IAM |
| Rollback | — | Switch the plan back | Keep Render running until verified; clients switch by API URL (section 6) | Same as Cloud Run |
| Observability | Render logs | Render logs + metrics | Cloud Logging / Monitoring (request latency, instance count) | CloudWatch |
| Notes | 750 free hours; 5 GB bandwidth on Hobby | Fixes sleep, keeps the Singapore↔Mumbai hop | **Instance-based billing is required**: request-based billing gives CPU only during requests, and the API runs background loops (route watch, warnings poll) | App Runner no longer takes new customers (docs.aws.amazon.com/apprunner, availability change) |

Sources:

- Render: render.com/docs/regions, /free, /scaling, /pricing, /web-service-caching, /websocket.
- Cloud Run:
  - docs.cloud.google.com/run/docs/locations, /configuring/min-instances, /configuring/billing-settings
  - cloud.google.com/run/pricing
  - docs.cloud.google.com/run/docs/about-concurrency, /triggering/websockets, /mapping-custom-domains
- AWS:
  - docs.aws.amazon.com/global-infrastructure (regions)
  - AWS_Fargate-Regions
  - general/latest/gr/apprunner
  - apprunner-availability-change

**Price arithmetic for Cloud Run** [INFERRED from PROVEN_BY_WEB rates; Tier 1 table; the `asia-south1`
rate was not checked in the region selector]:

- 30 days is 2,592,000 s.
- CPU: 2,592,000 × $0.000018/vCPU-s = $46.66.
- Memory: 2,592,000 × $0.000002/GiB-s = $5.18.
- Instance-based free tier: 240,000 vCPU-s ($4.32) and 450,000 GiB-s ($0.90).
- Total ≈ **$46.6 per instance-month**. Two instances ≈ $98 minus one free tier. Requests and egress are
  extra.

**Why not stay on Render and just pay?** A paid Render instance fixes the 32.6 s sleep, which is the
single largest user-visible delay. It cannot fix the Singapore↔Mumbai hop, because Render has no India
region. Each database round trip keeps costing 55–66 ms: about 250–450 ms per GPS upload or list read
(matrix §3). Render Standard in Singapore is a valid **interim** step if the owner wants the smallest
change first. It is not the target.

## 4. Latency targets and where each stands

Targets are the owner's engineering SLOs. None is claimed as met on hosted.

| Target | Goal | Today (hosted) | After Phase 1a (projected, INFERRED) | Evidence |
|---|---|---|---|---|
| Production cold-start wait | ≈ eliminated | **32.6 s** first request after 15 idle min | 0 (min instances 1) | Matrix §2 |
| Warm simple read p50 | < 100 ms | not measurable unauthenticated; `/health` 60–250 ms first byte | network floor 7–74 ms + ~6 ms CPU + ~1 ms per DB round trip | Matrix §4; plan §15.2 |
| Warm simple read p95 | < 250 ms | NOT MEASURED (n=3) | NOT MEASURED | — |
| DB-path probe (`/ready`) | — | 371–840 ms first byte p50 | ~20–80 ms | Matrix §2–3 |
| Login p95 | < 700 ms | NOT MEASURED hosted (no hosted sign-in by rule) | local warm p95 64.9 ms + network | Plan §15.5 |
| Edge TTFB, static | < 100 ms | TCP to edge 2–51 ms; manager first byte 129–330 ms (edge revalidation) | Unchanged by the move; improved by immutable caching of hashed assets | Matrix §2, §5 |
| Dispatch / route-change / SOS event | < 1 s | Polling: driver trip every 10 s (30 s in background); manager SOS every 10 s, **Fleet page only** | Unchanged by hosting; section 7 | Client audit FE-08, FE-23 |
| Map first useful | < 1.5 s | NOT MEASURED | — | — |

## 5. What must be true before more than one instance

The replica-readiness audit found in-process state that is safe with one process and wrong with two. The
27 Sep work fixes it with Postgres only, behind a switch: `MULTI_INSTANCE` (default **false**, set false in
`render.yaml`). With the switch off, behaviour is byte-for-byte today's, and no coordination engine, table
or query is touched. That is proven by a cursor spy and by the reviewer's probe. With the switch on:

| ID | Problem at 2+ instances | Status (working tree, 27 Sep) | Proof |
|---|---|---|---|
| SCALE-01 (P1) | Route-watch loop on every instance → duplicate hazard pushes | FIXED. One leader per loop, via a lease row (`instance_leases`, one upsert). The lease is renewed before every due trip. A lost lease stops the tick and clears the in-process state. There is a commit after each trip's pushes, so a later error cannot roll back a delivered push's record. Leases are released on shutdown. | `tests/test_coordination.py` (two simulated instances → exactly one push); multi-process proof below |
| SCALE-02 | Nominatim throttle per process → N req/s | FIXED. One global slot row (`provider_pacing`, 1.05 s spacing), reserved atomically. If the shared reservation cannot be made within 1 s, the instance falls back to its local 1 s. That means at most N req/s, and only while coordination is failing, with a warning logged. | pacing test; multi-process proof |
| SCALE-03 | Login/refresh limiters in memory → budgets ×N | FIXED. Fixed windows in `rate_limit_windows`, with keys stored as sha256 and never the raw identifier, on the request pool. Per-address floods are refused locally first, so they never reach the database. A failed reset after a committed login is logged, not raised. | shared-budget and flood tests |
| SCALE-04 | Pool budget | DOCUMENTED. Each instance holds (3+2 request) + 1 coordination connection = 6. The session pooler allows 15 clients, counting deploy overlap, so two instances fit (12) but their overlap (24) does not. Lower `DB_MAX_OVERFLOW`/`DB_POOL_SIZE` before scaling out (`render.yaml` comment). | arithmetic, INFERRED |
| SCALE-05 | Demo simulation state in memory | FIXED by rule: `MULTI_INSTANCE` forces the simulation off, with a warning at startup. | no-traffic test |
| SCALE-06 | Terrain/flood/weather caches per process | ACCEPTED. They are cache-only, so there is no correctness risk. The cost is N× provider quota. | — |
| SCALE-11 | Refresh rotation has no grace window | OPEN (P3) | — |

**Multi-process proof** [PROVEN_BY_RUNTIME; evidence in `scratchpad/replica/proof-report.json`, not in the
repo]. Two separate OS processes ran against the test database. Pace slots were strictly alternating with a
minimum gap of 1.000 s. Leases never overlapped. When the leader process was killed, the survivor took over
about 0.24 s after the lease expired. A deliberately broken lease and deliberately removed pacing both fail
the checker.

**Still to prove before `MULTI_INSTANCE=true` in production:**

- the same checks on two real Cloud Run instances;
- `TRUSTED_PROXY_HOPS` behind Google's load balancer;
- the pooler budget with deploy overlap on the real plan.

**Phase 1a** runs one always-on instance (min = max = 1) with `MULTI_INSTANCE=false`. That removes the two
largest delays at once. `max 1` caps throughput at one instance: about 160 mixed req/s at 1 vCPU if the
cloud core matches the test core (INFERRED). By the scalability plan's client cadences (about 13 req/min per
moving driver), that is about 700 moving drivers. [INFERRED]

## 6. The move, step by step (not to be combined with the database migration)

The owner's rule is one failure domain at a time:

1. **A.** Stabilise the integration branch.
2. **B.** Confirm backup/PITR.
3. **C.** Database migration 0013/0014.
4. **D.** Verify.
5. **E.** Infrastructure move (this section).
6. **F.** Verify.
7. **G.** Real-time evolution.

Infrastructure move, Phase 1a:

1. **Owner actions.** Create the GCP project and billing account, choose the Supabase plan with backups,
   and approve the spend. Claude cannot and must not do these.
2. **Deploy.** Deploy the unchanged `backend/Dockerfile` image to Cloud Run `asia-south1` with:
   - instance-based billing, 1 vCPU / 1 GiB, min 1, max 1;
   - concurrency 80 (default);
   - request timeout 300 s;
   - the same environment variables as `render.yaml`, with secrets in Secret Manager, never in the
     service YAML.
3. **Proxy hops.** Verify `TRUSTED_PROXY_HOPS` for Cloud Run's front end before trusting the rate limiter.
   Render's hop count does not carry over. [NOT_VERIFIED]
4. **Database URL.** Point `DATABASE_URL` at the same Supabase session pooler. Nothing about the database
   changes.
5. **CORS.** `CORS_ORIGINS` lists the *client* origins (the manager and driver web sites). Those do not
   move, so copy the list unchanged.
6. **Clients.** The API URL is compiled into the clients:
   - Manager: `VITE_API_BASE_URL` at build time (`render.yaml:136`). Redeploying the static site switches
     it.
   - Driver APK: `EXPO_PUBLIC_API_BASE_URL` is baked in at build time (`driver-app/eas.json:51`).
     **Every installed APK keeps calling the Render URL until it is reinstalled.** So:
     - keep the Render service running (it can stay free) until every field device has the new APK;
     - better, first put the API behind a hostname the project controls (a custom domain, which needs a
       domain and, on Cloud Run in `asia-south1`, a load balancer or a proxy in front). Future moves then
       become DNS changes, not APK rebuilds. This is an owner decision with a cost.
7. **Verify, then cut over.** Verify from the India probe set (matrix §1) and with the judge flow. Then
   cut the manager over. Roll back by redeploying the manager with the old URL.

Phase 1b (two or more instances): the coordination code and migration 0015 ship with the database
migration (step C) while `MULTI_INSTANCE` stays false. Then set `MULTI_INSTANCE=true` and min 2, re-run the
section 5 checks on the real instances, and measure again. Phase 2: cold-standby compute in a second India region, and a tested Supabase restore.

## 7. Real-time and data-path decisions

These follow the classification in `docs/SCALABILITY_AND_CAPACITY_PLAN.md` §7 and the client audit.

| Path | Class | Today | Decision |
|---|---|---|---|
| Driver SOS to manager | REAL_TIME_CRITICAL | 10 s poll, **Fleet page only** | ADOPT_NOW: app-wide poll with a topbar badge (cycle-4 fix). ROADMAP: server push (SSE) after measurement |
| Dispatch / route change to driver | REAL_TIME_CRITICAL | Driver trip poll 10 s (30 s background) + Expo push for the key events | Keep. ROADMAP: SSE when an always-on host exists (Render free cannot hold streams through sleep) |
| Fleet positions | NEAR_REAL_TIME | 10 s poll, did not pause in hidden tabs | ADOPT_NOW: pause while hidden (cycle-4 fix) |
| Trips planner list (100 rows) | EVENTUAL | 5 s poll beside the 20-row page | ADOPT_NOW: 30 s (cycle-4 fix); still reloaded after every lifecycle change |
| GPS ingest | NEAR_REAL_TIME | 1 fix per POST every ~10 s moving; backlog drained 6 per POST | ADOPT_NOW: drain a backlog up to 100 per POST, and never drop the newest fix (cycle-4 fix). Measured: 6-fix batches give 924 fixes/s per worker (plan §15.3) |
| Route evidence fan-out | EVENTUAL | Parallel, no overall deadline, weather uncached | ADOPT_NOW: per-provider deadline, 10-min weather cache, partial answers labelled NOT_AVAILABLE (cycle-4 fix) |
| Queues / Redis / Kafka | — | none | REJECTED until a measured bottleneck needs them (plan §9.3-9.4) |

## 8. Decisions for the project owner

1. **Approve moving the API to an always-on host.** Recommended: Cloud Run `asia-south1`, about
   $47/month for one instance. Minimum alternative: Render Standard in Singapore at $25/month, which
   removes the sleep but keeps the database hop.
2. **Choose a Supabase plan with backups.** Free has none and pauses after a week idle. This is also the
   gate for migration 0013.
3. **Choose whether to buy a domain for a stable API hostname** before the next APK build.
4. **Approve the order in section 6:** the database migration first, the host move second, never
   together.
5. **Approve Phase 1b** before any second instance. The replica-safety code and migration 0015 are in the working tree behind `MULTI_INSTANCE`; they ship with the database migration and are switched on only after the two-instance check.

## 9. Final performance report

| Field | Value |
|---|---|
| CURRENT_HOST | Render free, Singapore, 1 instance, 1 worker, 0.1 CPU |
| TARGET_HOST | Google Cloud Run `asia-south1` (recommended; owner approval pending) |
| PRIMARY_REGION | Mumbai |
| SECONDARY_REGION_ROADMAP | Delhi `asia-south2` or Hyderabad `ap-south-2`, compute cold standby; database DR by backup/PITR |
| SLEEP_TO_ZERO | Today YES (free plan). Target NO |
| MIN_INSTANCES | Target 1 (Phase 1a), 2 (Phase 1b, `MULTI_INSTANCE=true`) |
| API_REPLICAS | Today 1. Target 1 → 2+ |
| DB_REGION | ap-south-1 Mumbai (unchanged) |
| DB_POOLER | Supabase session pooler (Supavisor, 5432), 3+2 per instance |
| CDN | Cloudflare via Render static sites (in place) |
| WAF | Cloudflare DDoS protection via Render (render.com/docs/ddos-protection); no WAF rules of our own |
| INDIA_TEST_LOCATIONS | Guwahati, Kolkata, New Delhi, Mumbai, Hyderabad, Bengaluru, Chennai (synthetic, fixed broadband); Ahmedabad NOT MEASURED |
| STATIC_TTFB_P50 | Manager HTML first byte 129–330 ms by city; TCP to edge 2–51 ms |
| STATIC_TTFB_P95 | NOT COMPUTABLE (n = 3) |
| API_P50 | Hosted `/health` first byte 60–250 ms; `/ready` 371–840 ms. Local warm mix 56 ms at c=10 |
| API_P95 | Hosted NOT COMPUTABLE (n = 3). Local warm mix 115 ms at c=10 |
| API_P99 | Local warm mix 168 ms at c=10 |
| LOGIN_P95 | Local 64.9 ms (20 sequential). Hosted NOT MEASURED |
| MAP_FIRST_USEFUL | NOT MEASURED |
| REALTIME_EVENT_P95 | Polling-bound: up to 10 s (driver trip poll), 10 s for SOS on the Fleet page; not measured as an event latency |
| TESTED_CONCURRENCY | 1, 10, 100, 200, 400, 500, 512, 525, 800, 1,000 (local) |
| TESTED_RPS | 1 worker 160 (c=10); 2 workers 222; 4 workers 315 (c=400, in-window) |
| GPS_EVENTS_PER_SECOND | 924 fixes/s (1 worker), 1,617 (2), 2,391 (4), 6-fix batches, local |
| NOTIFICATION_EVENTS_PER_SECOND | NOT MEASURED |
| 1000_CONCURRENCY | 1 worker: crashes on the Windows test host (select() 512 cap, Windows-only, INFERRED). 4 workers: 0 errors, p50 3.0 s, p95 5.3 s (saturated) |
| HORIZONTAL_SCALE_2X | 1.67× on one host (c=400, in-window) |
| HORIZONTAL_SCALE_4X | 2.37× on one host (c=400, in-window) |
| CPU_PEAK | 1 worker 97.9% of one core; 4 workers 391% |
| RAM_PEAK | 1 worker 161 MB; 4 workers 618 MB (sum) |
| DB_POOL_PEAK | 7 connections (1 worker), 26 (4 workers, incl. parallel workers) |
| ERROR_RATE | 0 up to c=500 (1 worker) and c=1,000 (4 workers) |
| COLD_START_USER_WAIT | 32.6 s today |
| ALL_INDIA_LOW_LATENCY_READY | **NO**: sleeping origin and cross-region DB hop remain on hosted. Code-side fixes (global SOS, cache-first driver, lazy map, evidence deadlines, replica coordination) are in the working tree, not deployed; hosting needs owner decisions |
| MILLION_USER_READY | **NO**. No evidence supports it. |

## 10. Deploy-ready architecture packet (prepared, not deployed)

```text
CURRENT                                   TARGET (Phase 1a)
Driver APK / Manager web                  Driver APK / Manager web
        │                                         │
Cloudflare edge (Render)                  api.<domain>  (DNS the project owns, section 11)
        │                                         │
Render web service, SINGAPORE             Google external Application Load Balancer
free, sleeps after 15 min                 (Cloud Run has no domain mapping in asia-south1)
1 instance, 1 worker, 0.1 CPU                     │
        │  55–66 ms per DB round trip     Cloud Run, asia-south1 MUMBAI
        ▼                                 min 1 / max 1 instance, 1 vCPU / 1 GiB,
Supabase Postgres, MUMBAI                 instance-based billing, 1 uvicorn worker
(session pooler 5432, pool 3+2)                   │  ~1 ms per DB round trip
                                                  ▼
                                          Supabase Postgres, MUMBAI (unchanged)
Static sites: Render static + Cloudflare edge (unchanged; immutable cache for hashed assets)
```

| Item | Setting | Why / evidence |
|---|---|---|
| API region | `asia-south1` (Mumbai) | Matrix §3–5 |
| DB region | Supabase `ap-south-1` (Mumbai), unchanged | `docs/ARCHITECTURE.md:347-353` |
| API ↔ DB latency | Expected ~1 ms per round trip. **Verify on first deploy**: time `/ready` from inside the service's logs | Mumbai probe 0.99–1.11 ms (matrix §3); INFERRED for Cloud Run |
| Instances | min 1, max 1 in Phase 1a; min 2 only with `MULTI_INSTANCE=true` after the two-instance check | Section 5 |
| Autoscaling | Off in Phase 1a (max 1). Phase 1b: CPU-based, max bounded by the pooler budget ((3+2)+1 connections per instance, deploy overlap included) | `render.yaml:80-86`; plan §15.3 |
| Worker model | 1 uvicorn worker per instance (unchanged `backend/Dockerfile` CMD); scale by instances | Dockerfile comment lists the in-process state |
| Billing | Instance-based (CPU always allocated) | The lifespan loops (route watch, warnings poll) run outside requests; request-based billing gives CPU only during requests (docs.cloud.google.com/run/docs/configuring/billing-settings) |
| Concurrency | 80 per instance (default) | The Windows 512-socket crash does not apply on Linux (plan §15.1, INFERRED) |
| Startup probe | HTTP `GET /health`. Cloud Run's default is a TCP probe with a 240 s timeout (docs.cloud.google.com/run/docs/configuring/healthchecks) | `/health` answers once the app is up and touches no dependency |
| Liveness probe | HTTP `GET /health`, generous period. A failing liveness probe gets the container SIGKILLed and in-flight requests get 503 (same page) | Liveness must not depend on Supabase: a database blip must not restart a healthy process (`render.yaml:37-42` comment) |
| Readiness | `/ready` stays a diagnostic, not a probe; it takes a pool slot and would drain the only instance on a DB blip | `backend/app/api/health.py:88-110` |
| CORS | `CORS_ORIGINS` = the manager and driver web origins, copied unchanged | They are client origins, not the API's |
| Secrets | Secret Manager, mounted as environment variables pinned to a version (resolved at instance start; docs.cloud.google.com/run/docs/configuring/services/secrets). Includes `DATABASE_URL`, `GEMINI_API_KEY` (rotate first, NEW-01), `OPENROUTER_API_KEY`, `SECRET_KEY` | Never in the service YAML or the repo |
| `SECRET_KEY` | **Copy Render's value** into Secret Manager | Access tokens are signed with it. A new value signs every user out at cutover, and during a Render/Cloud Run overlap both must share it |
| `TRUSTED_PROXY_HOPS` | Verify on first deploy with the audit IP of a known request; do not assume Render's value of 1 | NOT_VERIFIED for Google's load balancer |
| Background loops during overlap | Exactly one origin runs `ROUTE_WATCH_ENABLED`, `WARNINGS_POLL_ENABLED` and the sentinel. Turn them off on the other while both serve | Two origins = two replicas (section 5) |
| Rollback | DNS back to the previous origin (TTL 60 s); Render stays running until the rollback window closes | Section 11 |
| Observability | Cloud Logging for request latency and 5xx; every response carries `X-Request-ID`, and 5xx logs include it | Cycle-4 fix A4/D4 |

## 11. Stable API endpoint (Driver APK URL strategy)

Today the driver APK has `https://ner-intelligence.onrender.com` compiled in (`driver-app/eas.json:51`), and
the manager build has `VITE_API_BASE_URL` (`render.yaml:136`). Moving the API therefore means rebuilding and
reinstalling every driver APK. The fix is a hostname the project owns.

**DOMAIN_API_ENDPOINT_PLAN**

1. The owner registers a domain. No purchase has been made.
2. `api.<domain>` initially points at the **current** Render service, using Render's custom-domain support
   (NOT_VERIFIED for the free plan). Nothing moves yet.
3. The next driver APK and manager build use `https://api.<domain>`. Update the release-config pin in
   `driver-app/src/api/releaseConfig.test.ts`, which currently accepts `*.onrender.com`.
4. Once enough field devices carry that APK (watch the traffic on the old hostname), a host move becomes a
   DNS change only.

**DNS_CUTOVER_PLAN**

1. 48 h ahead, lower the TTL of `api.<domain>` to 60 s.
2. Deploy Cloud Run (section 10) with the background loops **off**. Point its load balancer's
   Google-managed certificate at `api.<domain>`. Verify it through the load balancer's own address:
   - `/health`;
   - `/ready`, measuring the DB round trip;
   - the judge flow against a test account.
3. Switch the DNS record to the Cloud Run load balancer. At the same moment, turn the loops **on** in Cloud
   Run and **off** on Render.
4. Watch 5xx, latency and SOS/dispatch delivery for one working day. Keep Render running unchanged
   underneath.

**ROLLBACK_PLAN**

1. Point the DNS record back to Render (60 s TTL).
2. Swap the loop flags back.
3. Nothing about the database changes in either direction: both origins use the same Supabase project,
   and access tokens stay valid because `SECRET_KEY` is shared.
4. The rollback window closes only after a clean week. Then Render can go back to the free plan as a
   fallback for old APKs, or be retired once none call it.
