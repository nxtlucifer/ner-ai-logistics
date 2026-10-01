# RASTA AI (NER-AI Logistics): company demo script

Industrial-project showcase, 1 October 2026, 3:00 PM IST.
Runtime setup, start/stop and recovery: `docs/COMPANY_DEMO_RUNTIME_PLAN.md`.

Rules for the presenter:

- Never put the credentials file on screen (`.runtime/company-demo-credentials.private.json`).
- Never show a phone number, password, key or token. The SOS dossier masks phones. Keep it that way.
- Say "measured" only for numbers in the capacity section. Everything else is ROADMAP.
- If something breaks, say what broke and switch to fallback. Do not debug live.

---

## 0. What is running today

| Item | Today |
|---|---|
| Backend | Current code, local, `127.0.0.1:8010`, local PostgreSQL/PostGIS |
| Manager web | Local production-mode build, `localhost:4173` |
| Driver app | APK 1.0.27 on a physical Android phone, over USB (`adb reverse`) |
| Geography | Survey of India OVSF/1M/7, imported locally this morning |
| Routing | Public OSRM demo server (not production) |
| Map tiles | OpenStreetMap standard tiles (demo terms only) |
| Hosted site | Runs an older build. It is **not** migrated. Show it only as "the deployed pilot" |
| Fallback | Driver web on the laptop, or the screenshots in `.runtime/evidence/company-demo/` |

Test counts from today's runs:

- Backend: 1810 passed, 27 skipped.
- Manager web: 580 passed, 59 files (`.runtime/evidence/company-demo/manager_vitest.txt`).
- Driver app: 959 passed, 79 files (`.runtime/evidence/company-demo/driver_vitest.txt`).
- 22 real-city geography tests pass: Guwahati, Shillong, Aizawl, Itanagar (NER); Kolkata, Delhi, Mumbai, Siliguri (India, not NER); Dhaka, Sylhet, Thimphu (outside India).

---

## 1. Opening (30 seconds)

> Trucks in the North-East do not fail on distance. They fail on hills, rain, landslides and lost signal.
>
> RASTA AI is a logistics control system for that reality. A manager plans a trip. The system checks the road: terrain, weather, the landslide record and official warnings. It shows how fresh each piece of evidence is. If something is unknown, it says UNKNOWN. It never calls unknown safe.
>
> The driver gets the trip on an Android phone, in their own language, with an offline trip kit. Both sides stay in sync until the truck is delivered and released.
>
> Let me show you one trip, end to end: Guwahati to Shillong.

---

## 2. Compact demo (5 minutes)

Keep moving. One sentence per screen.

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | Manager, Region | Pick the workspace, then log in | "Each manager works inside a region, a state or a district. I am the regional manager." |
| 0:20 | Overview | Point at the counts and the people online | "This is the control room. Active trips, drivers online, open alerts." |
| 0:40 | Fleet | Show the map and the truck list | "Every truck, its last known position, and how old that position is." |
| 1:00 | Trips, new trip | Guwahati to Shillong. Add the cargo. Driver Tenzing Bhutia. Truck AS01AB1003 | "A normal trip. Pickup, drop, cargo, one driver, one truck." |
| 1:30 | Plan route | Press Plan route | "Now the system finds the road and gathers evidence for it." |
| 1:50 | Route evidence | Show terrain, weather, landslide record, warnings, freshness | "Steep stretches, current weather, recorded landslides on this corridor, official warnings. Each one shows its source and its age. Where we have no data, it says UNKNOWN." |
| 2:30 | Review and approve | Approve the route with a reason | "Unknown hazard data means a human decides. The manager approves, and the reason is recorded." |
| 2:50 | Dispatch | Press Dispatch | "The trip goes to the driver." |
| 3:00 | Phone | The request arrives. Accept | "The driver gets it on the phone. One tap to accept." |
| 3:15 | Phone, Navigate and Safety | Show the route, then the Safety tab | "The road, the turns, and the safety tools, including SOS." |
| 3:35 | Phone | Change the language. Start the trip | "The app speaks the driver's language. Now the trip starts." |
| 3:50 | Manager, Fleet | Show the live dot | "The manager sees the phone's live position." |
| 4:10 | Phone | Mark arrival, then delivery | "We mark arrival by hand today. The truck is not really on the highway." |
| 4:30 | Manager | Trip shows DELIVERED. Press Close | "Delivered. The manager closes the trip." |
| 4:45 | Trips | Show the driver and truck free again | "The driver and the truck are released, ready for the next trip." |
| 4:50 | — | Closing line (section 4) | |

---

## 3. Technical demo (10 minutes)

Same story, with the reasons behind each screen. Times are targets.

### 3.1 Workspace and login (0:00 to 0:45)

1. Open the manager at `localhost:4173`. The Region page appears.
2. Pick the workspace: North-East region, a state, or a district.
3. Log in as the regional manager. Do not show the credentials file.

Say:

> The workspace decides what you can see. A district manager sees trips that start or end in their district. A state manager sees their state. The regional manager sees the eight North-East states. The server enforces this, not the screen.

### 3.2 Overview (0:45 to 1:30)

1. Show the counts, people online and alerts.

Say:

> These numbers come from the database, scoped to my role. Nothing on this page is a mock value.

### 3.3 Fleet (1:30 to 2:00)

1. Show the map and the truck list.
2. Point at a position age.
3. Select the truck, then press **Full screen**. The map fills the screen and keeps the filters and the selected truck's card. Press **Esc** (or **Exit full screen**) to come back to the same place.

Say:

> A position is LIVE for 90 seconds. Then it is STALE. After 10 minutes it is NO CONTACT. We never show an old position as current.

### 3.4 Create the trip (2:00 to 2:45)

1. Trips, new trip.
2. Pickup Guwahati. Destination Shillong.
3. Add the cargo.
4. Driver: Tenzing Bhutia. Truck: AS01AB1003.
5. Create.

Say:

> The server checks both ends against the Survey of India boundary. Both ends are inside India, and both are in the North-East, so this is an NER-internal trip. The driver and the truck are now reserved. They cannot be put on a second trip at the same time.

If the driver or truck shows as reserved, run `reset.py` (runtime plan). Do not explain it on stage.

### 3.5 Plan the route (2:45 to 3:15)

1. Press Plan route.

Say:

> The road comes from OSRM, an open-source router. Today it is the public demo server. That is fine for a demo, not for production. Every candidate road is checked against the India outline. A road that leaves India is dropped. If no road is left, the trip is held for review.

If planning returns 503 ROUTING_UNAVAILABLE: wait 30 seconds, retry once. Otherwise open an existing trip. Say: "The public router is busy. We do not invent a route when the router fails."

### 3.6 Route evidence (3:15 to 4:30)

Walk through each block. Read the status words aloud, including UNKNOWN and UNAVAILABLE.

| Evidence | Source | What to say |
|---|---|---|
| Terrain | Open-Meteo elevation, OpenTopoData as fallback | "Steep and hilly stretches are coloured on the route. No elevation data means UNKNOWN, never flat." |
| Weather | Open-Meteo, MET Norway as fallback | "Weather along the route, with the time it was captured." |
| Landslide record | NASA Global Landslide Catalog, NER slice, 471 events, 2007 to 2017 | "This is a historical record, not a live feed. It ends in 2017, and the app says it is aged. Each event has a location accuracy. An event placed to 50 km is never counted as on this road." |
| Current landslides | None connected | "We have no live landslide feed. So current landslide data is UNKNOWN. That is why this route needs review." |
| Official warnings | NDMA SACHET public feed | "Official warnings are matched to the districts the route crosses." |
| Freshness | Every block | "Each block shows its source and its age. If a provider is down, it says UNAVAILABLE. A missing source never makes the score look safer." |

Say:

> We do not hide gaps. A system that hides UNKNOWN will one day send a truck into a closed ghat road with a green tick.

### 3.7 Review and approve (4:30 to 5:15)

1. The route shows REQUIRES_REVIEW.
2. Approve it, and type a reason.

Say:

> Unknown landslide evidence forces REQUIRES_REVIEW. Nothing is auto-approved. The manager accepts this specific evidence picture, gives a reason, and approves in one step. The evidence is fingerprinted. If it changes before the route is used, the approval is void. A HIGH-risk route cannot be approved this way at all.

### 3.8 Dispatch (5:15 to 5:30)

1. Press Dispatch.

### 3.9 Driver on the phone (5:30 to 7:00)

1. The trip request appears on the phone. Accept.
2. **Navigate**: the route line and the turn list. Tap the expand button on the map for **full screen**; Back or the green minimise button returns.
3. **Safety**: SOS, check-in, emergency places along the corridor.
4. **More**: change the language. Open the **Assistant** and ask one short question.
5. Start the trip.

Say:

> Directions are fetched once per route. If the route changes, old turns are thrown away, never shown for the new road.
>
> The trip kit is saved on the phone: the route, the stops and the risk snapshot, each with the time it was captured.
>
> The assistant explains. It does not decide. The facts come from our rules engine. If the AI provider is down or busy, the phone answers from its own local library.

Do **not** tap reroute on the phone. The phone's real GPS is in this room, not on NH-6.

### 3.10 Manager sees live location (7:00 to 7:40)

1. Switch to Fleet. Show the truck's live dot and position age.

Say:

> This dot is the phone's real GPS. It is where this phone is, not on the highway. Fixes are queued on the phone if signal drops, and sent later. Nothing is stored twice.

### 3.11 Optional: journey change (7:40 to 8:30)

Only if time allows.

1. On the trip, add a stop or change the destination.
2. On the phone, the driver sees the instruction and confirms it.

Say:

> The new destination goes through the same India and North-East checks as a new trip. The driver must confirm. The old route is kept as history, never overwritten.

### 3.12 Arrival and delivery (8:30 to 9:15)

1. On the phone, mark arrival at the stop, then complete the delivery.

Say:

> Today we mark arrival by hand, because the truck is not really driving. In the field the driver does the same at the gate.

### 3.13 Close and reuse (9:15 to 9:50)

1. The manager sees DELIVERED.
2. Press Close.
3. Show that Tenzing Bhutia and AS01AB1003 are free for a new trip.

Say:

> Delivered, closed, and released. The same driver and truck can take the next trip right now.

### 3.14 Close (9:50 to 10:00)

Closing line, section 4.

---

## 4. Closing line

> "RASTA AI does not ask only which road is shortest. It asks whether this truck can reliably use this corridor now, records the evidence behind the decision, and keeps the manager and driver synchronized throughout the trip."

---

## 5. Architecture (2 minutes, if asked)

Say it in this order.

1. **Three parts.** A Python FastAPI backend. A React manager web app. A React Native driver app for Android.
2. **One database.** PostgreSQL with PostGIS. It holds trips, routes, GPS, users and the Survey of India boundaries.
3. **The backend owns every decision.** Geography checks, route checks, risk scoring and access rules all run on the server. The apps only display and request.
4. **Outside providers, each replaceable.**
   - Routing: OSRM (public demo today).
   - Weather and elevation: Open-Meteo, with fallbacks.
   - Official warnings: NDMA SACHET public feed.
   - Address search: Nominatim, paced at 1 request per second for the whole service.
   - AI text: Gemini, then OpenRouter, then a built-in deterministic library.
5. **Failure is explicit.** A provider that fails shows UNAVAILABLE. The score never improves because a source went quiet.
6. **Routes are append-only.** A reroute inserts a new route and marks the old one SUPERSEDED. History survives for incident review.
7. **Ready for more than one server.** Rate limits, leader election for background jobs, and address-search pacing can be shared through PostgreSQL. This is behind a switch (`MULTI_INSTANCE`), off today, proven locally with two processes.
8. **Hosting.** The hosted pilot is on Render free in Singapore with Supabase in Mumbai. The recommended move is Google Cloud Run in Mumbai (`docs/INDIA_HOSTING_DECISION.md`). That move is ROADMAP.

---

## 6. Security (2 minutes, if asked)

**Role-based access, by geography.**

- District manager: trips that start or end in their district.
- State manager: trips that start or end in their state.
- Regional manager: the eight North-East states.
- Driver: their own trip only.
- The list and the single-record read use the **same** rule. If a trip is not in your list, opening it by ID also fails.
- Out of scope returns **404, not 403**. You cannot learn whether a trip exists by guessing IDs.

**Rate limits (GCRA).**

- Every route is covered: 101 operations listed in `docs/RATE_LIMIT_POLICY.md`. Only `/health` and resolving an emergency are never limited, on purpose.
- The algorithm is GCRA, a token-bucket style limiter. It has no window edge, so there is no double burst.
- Authenticated users are limited per user, not per IP. Many phones behind one mobile carrier address do not block each other.
- Login: 10 attempts per minute per account, 20 per minute per address. The limit is checked before the password hash, so an attacker gets no answer.
- Multi-instance: expensive buckets can be shared in PostgreSQL with one atomic upsert. Two real processes shared exactly one budget in the test. No Redis needed.
- GPS is never dropped by the limiter. Excess is delayed with Retry-After, and the phone re-sends.

**SOS abuse policy.**

- The **first SOS of a trip is never counted** against any limit.
- The answer to an open safety check is never counted.
- Only repeat SOS requests while one is already open spend a small budget: 5 at once, then one per 2 minutes.
- Past that, the driver sees: "An SOS is already open on this trip. Call your manager, or 112 if you are in danger."
- The SOS bucket is in-process on purpose. A database problem can never be the reason an SOS fails.
- A manager resolving an emergency is never rate limited.

**Security headers.** Every API reply carries `nosniff`, `X-Frame-Options: DENY`, a `frame-ancestors 'none'` policy, a referrer policy and no-store. Production adds HSTS. Error replies carry them too.

**CSV export.** A cell that starts with `=`, `+`, `-`, `@`, tab or carriage return is neutralised before export. A trip note cannot become a spreadsheet formula.

**Other points.** Passwords use Argon2id. Refresh tokens rotate. AI keys stay on the server. Uploads are capped at 5 MB.

---

## 7. Offline (1 minute)

What works with no signal:

- **The trip kit.** The route geometry, the stops and the risk snapshot are saved on the phone. Each part shows when it was captured. The age is computed on the phone, with no server call.
- **Turn directions.** Fetched once per route and kept on screen while signal drops. They are not yet written to disk, so a cold restart with no network shows no turns.
- **Phrasebook.** 12 Indian languages, with 8 verified emergency and work phrases, and speech.
- **Assistant.** Known questions are answered on the phone. Anything the server cannot answer falls back to the local answer.
- **GPS queue.** Up to 500 fixes are held and sent when signal returns.

What does **not** work offline:

- **No offline map tiles.** The OpenStreetMap tile policy forbids bulk download. The package says so (`BASEMAP_NOT_BUNDLED_LICENCE`). The map library also loads from the internet, so a cold start with no network shows no map.
- **No offline routing.** A new route needs the network. That also means no cross-border route can be made offline.

Say:

> Offline, the driver keeps the road they are on, the stops, and the last risk picture with its age. They do not get a map picture or a new route.

---

## 8. NER-first, India-wide

- **India-wide, NER-connected.** A trip may start or end anywhere in India, as long as at least one end is in the North-East.
  - NER to NER: allowed (NER internal).
  - NER to rest of India: allowed (outbound).
  - Rest of India to NER: allowed (inbound).
  - Both ends outside the NER: refused, `NOT_NER_CONNECTED`.
- **Outside India: refused.** Dhaka, Sylhet or Thimphu as an endpoint gets `OUTSIDE_SUPPORTED_COUNTRY`. There is no border tolerance.
- **Boundary authority.** The official Survey of India OVSF/1M/7 dataset, imported locally this morning. No country is hard-coded as hostile or safe.
- **A domestic route never leaves India.** This matters because a world router can find a shorter path through Bangladesh, for example Agartala to Kolkata.
- **Siliguri is in West Bengal, not the NER.** It is the gateway. Every road from the North-East to the rest of India passes through West Bengal. A Siliguri-to-Guwahati trip is inbound and allowed.
- **NER-first intelligence.** Inside the eight NER states the route gets the deep evidence. Outside the NER it gets baseline evidence, shown as LIMITED or UNKNOWN, never as NER-grade.

---

## 9. Do NOT claim

> **Do NOT claim any of these. If asked, give the honest line.**
>
> | Do not claim | Honest line |
> |---|---|
> | Live satellite imagery | Not implemented. The map is OpenStreetMap standard tiles. |
> | 3D buildings | Not implemented. "3D" is the terrain tilted with the ground raised. |
> | AI landslide prediction | No machine-learning model is deployed. We use a historical inventory (2007 to 2017) and deterministic rules. |
> | Google-scale live traffic | No. "Fleet traffic" comes from our own trucks' GPS only. |
> | National hazard coverage | No. Deep hazard evidence is NER-first. Outside the NER it is baseline, LIMITED or UNKNOWN. |
> | Production ready | No. This is a pilot-grade system. See section 10. |
> | A user capacity number | We measured requests per second on one laptop, not users. Quote only section 12's measured numbers. |
> | Physical Android fully certified | No. The demo lifecycle matrix passed on the phone with 1.0.23 this morning, and 1.0.24 (full-screen map, credits moved) was re-checked on the phone for its changes. That is a demo matrix, not a full device certification. |
> | The hosted site is today's build | No. The hosted site is older and not migrated. |

---

## 10. Real limitations (say them before they are asked)

1. **Routing** uses the public OSRM demo server: non-commercial terms, 1 request per second, no SLA. It uses a car profile, not a truck profile. There is no second router, so an outage means no new routes (stored routes still work).
2. **Map tiles** are OpenStreetMap standard tiles. Not allowed for production use at scale. No offline basemap.
3. **No live landslide or road-closure feed.** Current landslide status is UNKNOWN on every route, so every route needs review.
4. **Roadside places** (fuel, hospitals, hotels) come from an OSM snapshot of the eight NER states only, dated 20 September 2026.
5. **The latest build runs locally.** The hosted pilot is older. Hosted migration needs owner sign-off, a backup and point-in-time recovery first.
6. **Physical Android.** APK 1.0.27 is on the phone for today. The demo lifecycle matrix passed on 1.0.23 on 1 October; 1.0.24 adds only the full-screen map and the credits move, and those were re-checked on the phone (no trip, assigned, accepted, active, at pickup, offline, reconnect, journey change). This is one phone, not a device certification. Background tracking is off: location runs while the app is in the foreground.
7. **Hosted backups are unconfirmed**, so the hosted recovery point and recovery time are unknown.
8. **Capacity is measured on a laptop, not on the hosted server.** The hosted free instance has 0.1 CPU and sleeps after 15 idle minutes; the first request after sleep took 32.6 seconds when measured.
9. **AI answers need a provider key.** Without one, the deterministic library answers, and the screen says which source answered.

---

## 11. Production roadmap (all ROADMAP)

| Step | What | Why |
|---|---|---|
| 1 | Self-hosted OSRM on an India extract, truck profile, clipped to the SoI outline, weekly rebuild, data version stored on every route (`docs/ROUTING_GRAPH_FRESHNESS.md` §6) | Removes the demo-server terms, gives truck rules and a known data date |
| 2 | Own vector tiles (PMTiles) from the same OSM snapshot, SoI boundaries only, per-corridor offline packs (`docs/MAP_PRODUCTION_ARCHITECTURE.md` §4) | Production-legal map, offline basemap, no third party sees viewports |
| 3 | API on Cloud Run in Mumbai next to the database; one instance first, then two with `MULTI_INSTANCE=true` (`docs/INDIA_HOSTING_DECISION.md`) | No cold start, about 1 ms to the database instead of 55 to 66 ms |
| 4 | Database plan with backups and point-in-time recovery, plus a timed restore drill | A known recovery point and recovery time |
| 5 | Authorised hosted migration to the current schema, after rehearsals | Hosted runs today's code |
| 6 | Full physical-Android certification of the latest build: 66-item matrix, a dispatched trip, a real moving leg, mobile data, background behaviour | A certified driver build |
| 7 | Live landslide, road-closure and advisory feeds from official sources, with provenance | Fewer UNKNOWNs, fewer manual reviews |
| 8 | Load test on Linux in the target region | A capacity number for the real host |
| 9 | Replace polling with push where it matters | Lower cost per truck at state scale |

---

## 12. Q&A

**Why not just Google Maps?**
Google Maps answers "which road is fastest for a car". We answer "can this truck use this corridor now, and what is the evidence". We add terrain, the landslide record, official warnings and weather, with the age of each. We force a human review when hazard data is unknown, and record the reason. We keep the manager and driver in sync, with SOS and an offline trip kit. The driver can still hand off to Google Maps for turn-by-turn if they want.

**What intelligence does RASTA add?**
Per route: steep and hilly stretches, weather along the road, recorded landslides on the corridor with location accuracy, official NDMA warnings for the districts crossed, and how fresh each one is. A deterministic policy turns that into an eligibility: for example REQUIRES_REVIEW when landslide data is unknown. During the trip, the route is watched and the driver is warned when the picture changes.

**What happens offline?**
The driver keeps the saved trip kit: route, stops and risk snapshot, each with its age. Turn directions stay on screen while the app is open. The phrasebook and local assistant work. GPS is queued and sent later. There is no offline map picture and no offline routing.

**Where does landslide data come from?**
The NASA Global Landslide Catalog. We bundle a slice for the North-East and its margins: 471 events, 2007 to 2017. It is compiled largely from news reports. Each event carries a location accuracy, and we honour it. There is no live landslide feed connected yet.

**Is it prediction or historical evidence?**
Historical evidence plus rules. There is no machine-learning prediction model deployed. The inventory tells you landslides were recorded on this corridor. It does not tell you one will happen today. We say that on screen.

**How do route approvals work?**
If any hazard evidence is unknown, the route is REQUIRES_REVIEW. Nothing is auto-dispatched. The manager reviews the evidence, gives a reason, and approves in one step. The approval is tied to a fingerprint of that evidence. If the evidence changes before use, the approval is void. HIGH-risk routes cannot be approved through this path. A separate reviewer role exists for a future two-person workflow.

**How do state and district roles work?**
Scope follows the trip's geography, not who owns the truck. A district manager sees trips that start or end in their district. A state manager sees their state. The regional manager sees the eight NER states. The list and the direct read by ID use the same rule. Out of scope returns 404, so IDs do not reveal what exists.

**Can the driver leave the route?**
Yes, the app detects going off route. The driver can ask for a new road, at most once per 2 minutes and 500 metres. The manager sees "Driver asked for a new road" and approves it. The driver then sees "Reroute approved" and new guidance. Every new road is checked to stay inside India. The old route is kept as history.

**How is live location protected?**
A driver's position is visible only to managers whose scope covers that trip, and to the driver. Location runs while the app is in the foreground; background tracking is off. Android mock locations are flagged. Route lines and GPS fixes are drawn from our own API, never sent to the tile server. Honest gap: the public tile server sees which map tiles the phone asks for. Self-hosted tiles remove that.

**How is SOS protected from abuse?**
The first SOS of a trip is never limited. The answer to a safety check is never limited. Only repeated SOS requests while one is already open spend a small budget, and the refusal tells the driver to call the manager or 112. The SOS limiter does not depend on the database. A retried SOS with the same request ID never creates a second emergency.

**What is the current capacity?**
Only what we measured, on one laptop (Intel i7-13700HX, Windows 11), one API process, database pool 3+2, external providers switched off, 300 active seeded trips, 26 September code:

- MEASURED: mixed traffic at saturation, 93 to 164 requests per second.
- MEASURED: at 10 concurrent connections, 156 to 164 requests per second, p95 111 to 124 ms.
- MEASURED: 400 concurrent connections, zero errors (latency rises to seconds).
- MEASURED: a 5-minute soak at 50 requests per second, zero errors, p95 220 ms.
- MEASURED: GPS sent 6 fixes per request, 548 to 974 fixes per second.
- MEASURED: one process fails at 512 connections on Windows (a Windows `select()` limit). Four processes ran 1,000 connections with zero errors, p50 about 3 seconds.
- NOT MEASURED: the hosted server, Linux, and any number of users. A user count is ROADMAP.

**Can it work all India?**
Trips can start or end anywhere in India, as long as one end is in the North-East. Outside India is refused. Trips with neither end in the NER are refused today by policy. Deep hazard intelligence is NER-first. Elsewhere you get baseline evidence, marked LIMITED or UNKNOWN.

**What is not production-ready?**
The public router, the public map tiles, the hosted pilot (older build, not migrated, free tier), unconfirmed hosted backups, the latest Android build's full certification, and the lack of live landslide and closure feeds. See section 10.

**What does AI actually do?**
It explains. It does not decide. The rules engine produces the facts and the decision. The AI turns them into plain language for the driver and answers short questions. It refuses medical diagnosis and does not overrule navigation. Order of providers: Gemini, then OpenRouter, then our deterministic library. Keys stay on the server. The answer says which source produced it. There is no AI in route scoring or landslide assessment.

**What happens if OSRM or the AI provider fails?**
OSRM down: planning returns ROUTING_UNAVAILABLE and nothing is stored. We never invent a route. Routes already stored keep working, and so does the driver's trip kit. AI down: the server falls to the next provider, then to the deterministic library. The phone also has its own local answers. The driver always gets an answer.

**How is backup handled?**
Locally, the demo database was backed up with `pg_dump` before this morning's migration, and can be restored with `pg_restore`. For the hosted pilot, backups and point-in-time recovery are unconfirmed, so we treat its recovery point as unknown. The plan is a database tier with point-in-time recovery and a timed restore drill. That is ROADMAP.

**What would the industrial-project next milestone be?** (ROADMAP)
A controlled pilot with one operator on one or two NER corridors. To get there: self-hosted truck-profile routing with a dated graph, own map tiles with offline packs, Mumbai hosting with backups and a restore drill, a fully certified Android build, and at least one live official hazard feed. Success measures: on-time delivery, the share of routes that needed manual review, and SOS response time.

---

## 13. Recovery cheat-sheet

| Symptom | Do | Say |
|---|---|---|
| Plan route 503 ROUTING_UNAVAILABLE | Wait 30 s, retry once, else open an existing trip | "The public router is busy. We do not invent routes." |
| Phone says it cannot reach the server | Re-run `start.sh` (re-creates `adb reverse`), check the cable | "USB tunnel. One moment." |
| Driver or truck shows reserved | Run `reset.py` | (nothing) |
| Map tiles blank | Carry on. The route still draws | "Tiles are a public service. The route data is ours and still here." |
| Weather or warnings UNAVAILABLE | Carry on | "This is the honest state. Unavailable is shown, never hidden." |
| Anything else | Switch to fallback screenshots | "Let me show you the recorded run." |

---

## 14. Sources

`docs/COMPANY_DEMO_RUNTIME_PLAN.md`, `docs/LOGISTICS_COVERAGE_POLICY.md`, `docs/INTERNATIONAL_BORDER_LOGISTICS_SECURITY.md`, `docs/RATE_LIMIT_POLICY.md`, `docs/MAP_PRODUCTION_ARCHITECTURE.md`, `docs/ROUTING_GRAPH_FRESHNESS.md`, `docs/SCALABILITY_AND_CAPACITY_PLAN.md` (§1, §3, §6.4, §10, §15), `docs/INDIA_HOSTING_DECISION.md`, `docs/ANTIGRAVITY_FINDINGS_REPRODUCTION.md`, `docs/REDESIGN_VISUAL_CERTIFICATION.md`, `docs/PHYSICAL_ANDROID_EVIDENCE_RECONCILIATION.md`, `backend/data/landslides/PROVENANCE.md`. Code read for current behaviour: `backend/app/services/routes.py` (route border guard), `backend/app/services/trips.py` (`_assert_in_scope`, 404), `backend/app/core/scope.py`, `backend/app/core/errors.py` (headers), `manager-web/src/pages/tripExport.ts` (CSV), `backend/app/services/route_review.py`, `backend/app/services/gemini.py`, `backend/app/services/offline_package.py`, `driver-app/src/map/useNavigationPackage.ts`.
