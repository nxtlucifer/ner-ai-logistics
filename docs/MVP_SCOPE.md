# MVP Scope

Deadline for the hackathon prototype: **19 September**.

Scope discipline rule: a feature is only "in" if it appears in the demo chain in
[DEMO_PLAN.md](DEMO_PLAN.md) or is required to make that chain work. Everything else waits.

---

## MUST HAVE — the demo does not work without these

Priority order matches the required build order in [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

| # | Capability | Why it is load-bearing |
| --- | --- | --- |
| 1 | Manager dashboard shell + auth | Entry point for everything |
| 2 | Driver & truck management (CRUD, documents, photos) | Identity of the fleet |
| 3 | Cargo / shipment / trip creation with **deterministic capacity validation** | Core domain object |
| 4 | Driver mobile app + auth | The other half of the system |
| 5 | Phone GPS streaming (background, offline buffering) | Every live feature depends on this |
| 6 | Live manager map | Makes GPS visible; the demo's centrepiece |
| 7 | Primary + backup route | Precondition for rerouting |
| 8 | Basic Fuel AI with a **published baseline comparison** | The headline ML claim |
| 9 | Weather ingestion | Input to risk |
| 10 | Road incident model + manager-triggered closure | The demo's trigger event |
| 11 | Automatic rerouting of affected active trips | The system's "intelligence" moment |
| 12 | Fleet Sentinel monitor loop | The safety differentiator |
| 13 | 60-minute stationary rule (deterministic) | Sentinel's detection |
| 14 | 30-minute driver response window | Sentinel's confirmation |
| 15 | SOS escalation with full manager briefing | Sentinel's payoff |
| 16 | Basic payment status tracking | Completes the trip lifecycle |
| 17 | Proof of delivery (photo + signature) | Closes the loop |

**Definition of done for a MUST HAVE:** implemented, covered by automated tests, and exercised
end-to-end through the real UI — not through a script or an API client alone.

---

## SHOULD HAVE — build only if MUST HAVE is complete and stable

- Document expiry warnings (licence, insurance, fitness, PUC, permits).
- Driver ↔ truck verification with photo capture and manager review of mismatches.
- Trip expense capture (fuel, toll, parking, loading, repair).
- Driver salary / advance / allowance status display.
- Manager-side incident timeline per trip.
- Route C (emergency/backup) surfaced explicitly rather than computed on demand.
- Fleet Sentinel geofence exclusions for approved stops (depots, known rest points).
- WebSocket push to the manager dashboard (fallback: polling — see risk note below).
- Offline-first driver app queue with visible sync state.

---

## FUTURE — designed for, deliberately not built before 19 September

- Dedicated vehicle GPS trackers and OBD/telematics ingestion.
- PaddleOCR verification of truck registration plates against assignment records.
- Self-hosted Valhalla/OSRM routing over OpenStreetMap NER extracts.
- Trained ETA model (MVP uses routing-engine ETA plus a correction factor).
- Anomaly detection on driving behaviour.
- Multi-tenant operation for several transport companies.
- Native push notifications via FCM/APNs.
- Historical analytics, cost dashboards, route profitability.
- Driver mobile app in Assamese, Bengali, Hindi, Manipuri, Nepali.

---

## OUT OF SCOPE — will not be built, and we say so in the pitch

| Excluded | Reason |
| --- | --- |
| Real money movement, payment gateway integration | Explicit project constraint; regulatory surface far exceeds a hackathon |
| Statutory payroll (PF, ESI, TDS) | Compliance domain, not a logistics problem |
| Direct integration with police / NDRF / 108 emergency services | Requires authorisation we do not have; SOS escalates to the *manager*, who decides |
| Autonomous dispatch (AI assigning trucks with no human approval) | Violates the AI/deterministic separation principle |
| An LLM anywhere in the safety decision path | Non-negotiable architecture principle |
| Public tracking link for consignees | Adds an auth surface with no demo value |
| iOS build | Expo Go on Android is sufficient to demo; no Apple developer account |

---

## Scope Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Routing engine is the biggest single unknown.** Self-hosting Valhalla with an NER OSM extract can consume days. | Blocks items 7, 11 | Build behind a `RoutingProvider` interface from day one. Ship with a hosted provider or a precomputed corridor graph; swap in Valhalla only if time allows. |
| Fuel AI has **no real training data** for NER trucks. | Item 8's credibility | Be explicit: physics-informed synthetic generator, model compared against a stated baseline, **no accuracy number claimed on real-world data**. Documented in [AI_MODELS.md](AI_MODELS.md). |
| Demoing GPS movement requires a moving phone. | Demo reliability | Build a GPS replay harness that posts a recorded track to the real ingestion endpoint. It is a *test client*, not fake data in the UI — the backend cannot tell the difference. |
| WebSocket instability on venue wifi. | Live map dies on stage | Polling fallback with the same data contract, selectable by config. Decide by the integration phase, not on the day. |
| Weather/road APIs rate-limit or fail during the demo. | Items 9–11 | Cache last-known-good server-side; the incident that drives the demo is manager-triggered and does not depend on a live third-party call. |
