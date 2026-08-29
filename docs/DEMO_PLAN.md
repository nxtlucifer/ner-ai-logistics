# Demo Plan

**Status: plan for a future demo.** None of the flow below is implemented yet. This document exists
now because it defines what "done" means — every MUST HAVE in
[MVP_SCOPE.md](MVP_SCOPE.md) is justified by appearing here.

---

## 1. The Narrative

Three minutes, one continuous causal chain, one truck. Not a tour of screens.

> A tea consignment leaves Jorhat for Guwahati. Mid-route, a landslide closes NH-715. The system
> detects which trucks are affected, reroutes them, and tells both the manager and the driver.
> Later the truck stops moving. The driver does not answer. The system escalates — and hands the
> manager everything needed to act.

The judge should leave able to repeat that sentence. Every screen exists to advance it.

**The single most important framing:** the last thirty seconds are the differentiator. Any GPS
vendor can show a dot on a map. Almost none escalate on driver *silence*. Budget time accordingly.

---

## 2. Cast

| Element | Value |
| --- | --- |
| Driver | Bipul Das — photo, phone, emergency contact on file |
| Truck | AS-01-AB-1234, 16-tonne, capacity 16,000 kg |
| Cargo | CTC tea chests, 13,500 kg, priority HIGH, perishable |
| Route | Jorhat (26.7509, 94.2037) → Guwahati (26.1445, 91.7362), ~308 km |
| Incident | Landslide on NH-715 near Jakhalabandha |

Real NER geography throughout. A judge from the region will recognise the corridor, and that
recognition is worth more than any slide.

---

## 3. Timeline

| Time | Screen | Action | Point being made |
| --- | --- | --- | --- |
| 0:00–0:20 | Manager dashboard | Fleet overview: active / idle / delayed, live map | One picture of the whole fleet |
| 0:20–0:40 | Shipment + trip creation | Enter cargo, assign truck. **Briefly attempt 18,000 kg first — rejected with a clear message** — then correct to 13,500 kg | Deterministic safety rules, enforced not suggested |
| 0:40–1:00 | Route selection | Three routes with distance, ETA, fuel litres and cost, risk factors | Route choice on true cost, not distance |
| 1:00–1:20 | Driver phone | Trip received, truck verification photo, trip started; dot begins moving on the manager map | Two real applications, one backend |
| 1:20–1:50 | Manager → incident | Report landslide on NH-715. System identifies the affected trip, computes an alternative, updates ETA and fuel | **Accessibility intelligence** — the core claim |
| 1:50–2:05 | Both screens | Driver receives the new route and acknowledges; manager sees the acknowledgement | Closed loop, both directions |
| 2:05–2:30 | Manager map | Truck stops. Sixty minutes elapse (accelerated). System raises `DRIVER_CHECK_REQUIRED` | Detection without anyone watching |
| 2:30–2:45 | Driver phone | "Your truck has been stationary for more than 60 minutes. Are you safe?" — **no response** | Escalation on silence |
| 2:45–3:00 | Manager | `SOS_ESCALATED` — full briefing: driver photo, phone, emergency contact, truck, cargo, last GPS with age, stopped-since, route, weather, suggested actions | **The differentiator** |

**On accelerating time:** the 60- and 30-minute timers are read from configuration. For the demo the
config is set to seconds. The **logic is unchanged and the code path is identical** — only threshold
values differ. Say this out loud during the demo; a judge who suspects a hardcoded shortcut will
discount the whole thing, and the honest explanation is more impressive than the illusion.

---

## 4. What Is Simulated, and Said Aloud

| Element | Reality | How it is stated |
| --- | --- | --- |
| GPS movement | Replay harness posts a recorded track to the **real** ingestion API | "GPS is replayed from a recorded route — the backend cannot tell it from a live phone." |
| Sentinel timers | Config set to seconds | "Thresholds are configuration; the logic is the production path." |
| Fuel model | Trained on physics-informed **synthetic** data | "Synthetic training data, compared against a stated baseline. We are not claiming real-world accuracy." |
| Landslide | Manager-entered incident | "Entered manually here; the same handler consumes API feeds." |
| Payments | Status tracking only | "No money moves. Deliberately out of scope." |

Nothing on screen is fabricated UI. Every number rendered comes from an API response, and a `null`
estimate renders as "unavailable" — including during the demo.

---

## 5. Rehearsal and Failure Handling

**Preconditions** (scripted, verified before presenting): database seeded and reset to a known
state; backend, manager web and driver app running and verified via `/ready`; driver phone (or
emulator) on the same network with the LAN API URL set; GPS replay harness ready; browser zoom and
window size fixed; notifications silenced.

**Reset:** a single `scripts/demo_reset` returns the database to the exact starting state. Rehearse
the reset as much as the demo.

| Risk | Mitigation |
| --- | --- |
| Venue wifi fails | Phone hotspot as backup; everything runs locally, nothing needs the internet except map tiles — **pre-cache tiles for the corridor** |
| Physical phone misbehaves | Android emulator on the same laptop as fallback, pre-launched |
| WebSocket drops | Polling fallback selectable by config; decided before demo day, not during |
| Routing provider unavailable | Pre-computed routes cached in the seed data |
| Live demo fails entirely | Screen recording of a full successful run, ready to play |

The recorded fallback is made **after** the first clean end-to-end rehearsal, not the night before.

---

## 6. Question Bank

| Likely question | Answer |
| --- | --- |
| "Is the AI real?" | The fuel model is a real LightGBM model on synthetic physics-based data, compared against a baseline. We do not claim real-world accuracy. Safety logic contains no ML at all — deliberately. |
| "Why no LLM in the safety path?" | Explainability after an incident, no training data, asymmetric cost of error, and availability. A threshold comparison is defensible in a review; a model score is not. |
| "How is this different from a GPS tracker?" | A tracker shows position. This reroutes around a closed road automatically and escalates when a driver goes silent. |
| "What if there is no mobile signal?" | Expected in NER. The app buffers fixes offline and flushes on reconnect. Signal loss raises `COMMS_LOST`, which is deliberately **not** an SOS — conflating them would cause alert fatigue. |
| "Can a driver fake GPS?" | Yes, on a rooted device. We detect and surface it; we never auto-punish, and a spoofing flag never suppresses a safety check. |
| "Is it production ready?" | No. Known gaps are listed in [SECURITY.md](SECURITY.md) §12 — no penetration test, no MFA, single-tenant. |
| "What is hardest to scale?" | GPS ingestion volume and self-hosted routing. Both have a stated path. |

---

## 7. Success Criteria

The demo succeeds if a judge can state, unprompted: **the system reroutes around blocked roads and
escalates when a driver stops responding.** Everything else is supporting detail.
