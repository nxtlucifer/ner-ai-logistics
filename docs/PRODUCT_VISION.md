# Product Vision

**Problem Statement:** SIH26002
**Title:** AI-Based Smart Logistics and Accessibility Intelligence Platform for North Eastern Region (NER)
**Category:** Software · **Theme:** Smart Automation

---

## 1. The Problem

Freight movement in India's North Eastern Region is structurally harder than in the rest of the
country, and the difficulty is not primarily a vehicle problem — it is an **information** problem.

**Physical constraints**

- The region is reached through the Siliguri Corridor ("Chicken's Neck"), a ~22 km wide land bridge.
  A single blockage there affects eight states at once.
- Terrain is mountainous. Most inter-state freight moves on two-lane national highways cut into
  hillsides, where there is frequently **no parallel alternative road** within 100+ km.
- The monsoon (roughly May–September) produces landslides, washouts and flooding that close
  highways with little warning and for unpredictable durations.
- Mobile network coverage along these corridors is intermittent. A truck can be genuinely
  unreachable for hours in normal operation.

**Operational consequences**

- A fleet manager typically learns a truck is stuck when the **driver phones in** — which requires
  signal, and requires the driver to be able to make the call.
- Route decisions are made from memory and word-of-mouth road reports, not from data.
- Fuel is budgeted per-trip by rule of thumb. Gradient and load — the two variables that dominate
  hill-route consumption — are not modelled at all.
- When a driver stops responding, there is no systematic escalation. Detection depends on somebody
  noticing an absence.

The gap this product closes: **the manager's picture of the fleet is delayed, partial, and
verbal.** Everything downstream — rerouting, fuel planning, driver safety — inherits that delay.

---

## 2. Target Users

| User | Context | What they need |
| --- | --- | --- |
| **Fleet Manager** | Desk, office, browser, multiple screens | One live picture of every truck; to be told about problems rather than having to ask |
| **Driver** | Cab of a truck, phone only, one hand, poor signal, sometimes at night | Very few, very large controls; to be found if something goes wrong |
| **Operations/Finance staff** | Back office | Trip cost accuracy, payment and document status |

The two applications have genuinely different design constraints, which is why they are separate
applications over one backend rather than one responsive web app.

---

## 3. The Product

A **Predictive Fleet & Accessibility Command Platform** that connects driver, truck, cargo, live
GPS, routes, fuel, weather, road conditions, payments and emergency response into one system.

Two applications, one backend:

1. **Manager Web Dashboard** — the command picture.
2. **Driver Mobile App** — the field client and the safety endpoint.

---

## 4. Manager Workflow (target state)

1. Opens the dashboard and sees the fleet: active / idle / delayed / stuck, plus any open SOS.
2. Creates a shipment — cargo, weight, pickup, destination, priority.
3. Assigns a truck. **Capacity is validated deterministically** and over-capacity is refused.
4. Assigns a driver. If it is a truck the driver has not driven, a verification step is required.
5. Reviews proposed routes: primary, fuel-efficient, and emergency backup, each with distance,
   ETA, estimated fuel and identified risk.
6. Dispatches. From here the manager is a monitor, not an operator.
7. Receives alerts, not questions: road blocked → affected trips identified → reroute proposed.
8. If a truck goes stationary and the driver does not respond, receives a fully-populated SOS
   briefing with everything needed to act.

## 5. Driver Workflow (target state)

1. Logs in; sees the assigned trip.
2. On a new truck: photographs it and confirms registration, odometer, fuel and visible damage.
3. Starts the trip. The phone streams GPS in the background, buffering when offline.
4. Receives route changes and hazard warnings as they are issued.
5. If stationary too long, answers one question with one large button: **Are you safe?**
6. Logs expenses and captures proof of delivery at the destination.

---

## 6. Final Product Vision

> The manager should never have to ask "where is that truck and is the driver okay?" — the system
> should have already answered both, and if it cannot, it should have already escalated.

Three capabilities distinguish this from a conventional GPS tracker:

1. **Accessibility intelligence** — the network is modelled as *changeably* passable. Weather,
   landslide and closure data continuously revise which roads are usable, and active trips are
   re-planned against that revision.
2. **Predictive fuel** — consumption is estimated from gradient, load, truck and conditions, so
   route choice can be made on true cost rather than distance.
3. **Fleet Sentinel** — a deterministic safety net that escalates on driver *silence*, which is
   exactly the failure mode that terrain and poor coverage produce.

---

## 7. SIH Value

- **Regional specificity.** Gradient-aware fuel and landslide-aware routing are not generic
  logistics features; they address the NER's actual constraints.
- **Safety as a first-class deterministic feature.** Fleet Sentinel escalates on absence of
  response. It contains no LLM in its decision path, so it cannot be argued away as a demo trick.
- **Honest AI.** ML is applied where there is a real prediction problem (fuel, ETA, risk) and every
  model is required to beat a stated baseline. Business-critical logic — capacity, payments,
  documents, emergencies — is deterministic and auditable.
- **Demonstrable end-to-end.** The demo is one continuous causal chain: road blocked → reroute →
  both parties alerted → truck stops → driver silent → SOS. Not a tour of disconnected screens.

## 8. Platform

The system runs on **Supabase** (PostgreSQL + PostGIS, `ap-south-1` Mumbai) as its
primary data platform, with FastAPI as the only component that talks to it. Both
applications reach data exclusively through that backend, which is what keeps the
deterministic safety rules unbypassable. See [ARCHITECTURE.md](ARCHITECTURE.md).

## 9. Explicit Non-Goals

- Not a marketplace, load board, or freight broker.
- Not a replacement for emergency services — it escalates to a human manager, who decides.
- Not a real payments system. Financial state is *tracked*; no money moves.
