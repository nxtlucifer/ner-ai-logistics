# Degraded-mode demonstration: online → weak zone → offline → reconnect

**What this proves.** Not that the app works. That it keeps being *honest* when
the network does not: that it says exactly what it knows, what it does not know,
what is cached, what has gone stale, and what happened while connectivity was
absent.

Everything below runs against the real system. There are **no hidden database
edits** in this procedure, and the one synthetic element — the dead zone itself
— is labelled `DEMO_SIMULATION` on screen in both apps.

---

## 0. Before the slot

| When | Do |
| --- | --- |
| T-10 min | Open `/health` on the backend. The free tier sleeps; the first call takes up to a minute |
| T-5 min | `bash .runtime/judge.sh check` → `RESULT READY` |
| T-2 min | Sign in to the Manager console. Sign in on the phone. Keep both in front of you |

The phone must have a real trip DISPATCHED to it, with a route selected. The
canonical judge trip (Guwahati → Shillong) is the one to use.

---

## 1. ONLINE — the manager sees the road, including whether the driver will be reachable

**Manager → Trips → the judge trip → Review route → Check conditions.**

The evidence panel now carries a **Mobile signal** block beside Fleet traffic.
On a corridor this fleet has not driven it reads:

> **UNKNOWN** — No RASTA phone has reported from this road in the last 30 days.
> Signal is UNKNOWN, which is not coverage — the driver's trip kit is prepared
> as if there were none.

**Say this out loud, because it is the point:** every other product in this space
would paint that road green. A carrier coverage map is a marketing artefact this
project cannot verify, so the console reports what it actually measured — which
here is nothing — and the system then behaves as though the signal is gone.

The **Evidence coverage** line above it counts `Signal UNKNOWN` alongside
weather, terrain, warnings and traffic.

If the corridor *has* been driven before, the same block reads in kilometres:
how much of the road was measured, how many kilometres have no data path, the
longest continuous gap, and how many kilometres nobody has measured.

**Dispatch.**

---

## 2. THE KIT — prepared before the signal dies, not after

**Phone → accept → check the truck → Start → Navigate → DETAILS.**

The **Offline kit** card states four things, all from the package's own
manifest:

- when it was saved, and which package version (`offline-corridor-package-v2`)
- whether every safety dataset is present and current, or **which ones are
  stale and which have no data at all**, by name
- what is coming: *no signal / weak signal / signal unmeasured* for N km, in N km
- whether it is preparing right now

The lead distance is computed, not fixed. It comes from the truck's speed, the
size of the kit, the measured state of the segment the phone is in right now,
and how long the blackout ahead is expected to last — then clamped to at least
one 5 km connectivity segment, because that is the resolution at which the gap's
start is known at all. A truck at 15 km/h and a truck at 70 km/h do not get the
same answer, and the brief's warning about a hard-coded 9 km threshold is the
reason.

**To force the weak zone on a corridor with no measured gaps** (manager,
requires `trip:dispatch`, and `DEMO_SIMULATION_ENABLED` on the host):

```
POST /api/trips/{trip_id}/simulation?scenario=NO_SIGNAL_ZONE_AHEAD&minutes=30
```

The middle stretch of the selected road is relabelled `DEAD_ZONE` with
`source: DEMO_SIMULATION` and `evidence: SIMULATED` on every segment it touches.
Real segments outside that stretch keep their real evidence. The manager's
console prints **DEMO SIMULATION — some segments carry synthetic evidence, not
a measurement** above the block, and every affected risk score carries
`DEMO_SIMULATION_ACTIVE`.

---

## 3. OFFLINE — turn the radio off

**Put the phone in aeroplane mode.** Do not close the app.

What must keep working, and what must visibly stop:

| Keeps working | Because |
| --- | --- |
| The corridor on the map | Drawn from the cached package, labelled **Saved route — no connection** |
| The next-turn panel | The turns travelled with the kit |
| Distance travelled and the countdown to the next turn | The phone projects its own fix onto its own copy of the line |
| Emergency numbers | Bundled in the app, in every language, and they work with the radio off |
| The offline assistant, the phrasebook, the safety guide | Bundled |
| GPS capture | The receiver does not need the network |
| SOS | Recorded to durable storage in the same tick as the button |

| Visibly degrades | How it says so |
| --- | --- |
| The trip poll | The screen keeps the last trip and marks it not current, with its age |
| The risk snapshot | `PERSONAL ROUTE AI · OFFLINE`, and the card shows when it was captured |
| Each safety dataset | Ages independently on the **device** clock and turns STALE by itself |
| Position upload | "Location not reaching the server — N fixes waiting" |

**Nothing invents a position, a route or a forecast.** That is the thing to
point at.

### Things to do while offline, in this order

1. **Drive off the corridor** (or move the simulated position). After three
   consecutive fixes more than 200 m off the line — with the reported accuracy
   subtracted first, so a hillside is not a deviation — the screen says
   **Off route**, and a `ROUTE_DEVIATION` event is recorded with the cross-track
   distance. It does **not** invent a replacement road: a reroute needs a safety
   evaluation, and that needs the network.
2. **Acknowledge a danger card** ("OK, SEEN"). An `ALERT_ACKNOWLEDGED` event is
   recorded with the alert's key and level.
3. **Press SOS** (Safety → Tell your manager). The card says *"Recorded on this
   phone. It will reach your manager when there is signal."* — it does not claim
   to have transmitted, because it has not. It carries the last known position
   **and its accuracy**, or null if there is none.
4. Watch the **Trip events** line on the Trip screen count up.

---

## 4. RECONNECT — the proof

**Turn the radio back on.** Within one flush tick (5 s) the queue drains,
critical events first.

**On the phone**, the Trip events line reads something like:

> Trip events: 73 synced · 2 already had

- **synced** — accepted as new.
- **already had** — the server had them from a batch whose acknowledgement never
  came back. This is the line that proves replay is idempotent, and it is the
  number to read aloud.

**On the manager**, the trip timeline now carries, in device order:

```
COMMS_LOST          Driver's phone lost its connection to the service.
ROUTE_DEVIATION     Driver's phone reported leaving the planned corridor by 412 m.
ALERT_ACKNOWLEDGED  Driver acknowledged a CRITICAL alert on the phone.
SOS_TRIGGERED       Driver pressed SOS on the phone.
COMMS_RESTORED      Driver's phone regained its connection with 73 event(s) waiting to be sent.
```

Every row carries **two timestamps**: `device_reported_at` (when it happened,
by the phone's clock) and `occurred_at` (when the server heard it). The gap
between them is the outage, measured.

The SOS has opened an incident. Open it: the dossier's position says
`source: DEVICE_AT_SOS` — what the phone reported at the moment the button was
pressed, which is newer than any fix the server holds and is the only position
that exists at all after an hour in a valley. If the phone had no fix, it says
`UNKNOWN` with a null coordinate rather than putting the truck at 0°, 0°.

### Prove the idempotence directly

Press SOS **three times** offline, or replay the same batch three times with
curl. The result is **one** emergency and **one** timeline entry, with
`duplicates_ignored` counting the rest. The authority is a partial unique index
on `(trip_id, device_event_id)`, not application logic that could be raced.

---

## 5. Measurable proof

| Measurement | Where to read it |
| --- | --- |
| Trip kit size | **30 KB measured** for a two-corridor trip on 15 Sep 2026 (`test_the_kit_is_small_enough_to_arrive_before_the_dead_zone` prints it and holds it under a 512 KB ceiling). At the app's WEAK planning rate of 120 kbps that is about two seconds of download |
| Events queued while offline | Trip screen, "Trip events: N waiting" |
| Events accepted on reconnect | `accepted` in the batch response; "N synced" on screen |
| Duplicates absorbed | `duplicates_ignored`; "N already had" on screen |
| GPS fixes queued and accepted | The location banner, and `accepted` / `duplicates_ignored` on the GPS batch |
| Outage duration | `occurred_at − device_reported_at` on the replayed events |
| Measured signal gaps | The Mobile signal block: weak km, dead km, longest gap, unmeasured km |

---

## 6. NOT CERTIFIED

Stated plainly, because the brief requires it and because a demo that overclaims
is worse than one that does not.

| Item | Status | How to certify it |
| --- | --- | --- |
| **Android process death with a queued SOS** | **NOT CERTIFIED** | On a physical handset: press SOS in aeroplane mode, then force-stop the app from Settings → Apps (or `adb shell am force-stop <package>`), reopen it, restore the network, and confirm the event arrives and the manager timeline shows one SOS. The queue's own persistence is tested against an injected store; **actual OS process death has never been exercised on hardware** |
| **Background GPS while the screen is off** | **NOT CERTIFIED, and not implemented** | The app is foreground-only by design — no background location permission is requested (docs/SECURITY.md §3). A phone in a pocket with the screen off does not collect. This is a product decision, not a gap to be fixed quietly |
| **Background push during an outage** | **NOT CERTIFIED** | Needs a Firebase `google-services.json` in the build. In-app alerts and the backend relay work today |
| **SMS emergency fallback** | **NOT IMPLEMENTED, and not claimed anywhere** | Would need SMS permissions and a carrier path this build has neither. The SOS card says "recorded on this phone" precisely so no one infers a transmission that did not happen |
| **Battery-adaptive cadence** | **PARTIAL** | Cadence is server-published and adapts to movement (10 s moving, 60 s stationary, 30 m threshold). It does **not** yet escalate in an emergency or read the battery level — `expo-battery` is not a dependency, and a fabricated battery reading would be worse than none |
| **Real carrier coverage** | **NOT AVAILABLE, by design** | Connectivity is measured from this fleet's own upload delays. A corridor no RASTA truck has driven is UNKNOWN and stays UNKNOWN |

---

## 7. What can still go wrong in the room

| Symptom | Cause | What to say |
| --- | --- | --- |
| Manager shows `UNASSESSED` | The intelligence plane is asleep or unreachable | That is the honest state. It is not LOW risk |
| Mobile signal reads UNKNOWN | Nobody has driven this corridor yet | Correct, and intended. The kit is prepared as if there were no signal |
| No offline kit card content | Nothing cached yet for this trip and route | Wait for the first fetch, or pull to refresh on Navigate while online |
| Events do not drain | The trip ended while they were queued | The server refuses events for a trip that is over, and the queue drops them with a reason. Documented limitation |

Recovery for anything: `bash .runtime/judge.sh reset` then
`bash .runtime/judge.sh check`. Never edit the database by hand.
