/**
 * When to prepare the trip kit, and how far before the signal dies.
 *
 * NOT A FIXED THRESHOLD, AND THE REASON MATTERS
 *
 * The obvious design is "download when the next dead zone is 9 km away". It is
 * wrong in both directions at once. A truck crawling up a hill road at 15 km/h
 * has 36 minutes of warning at 9 km and does not need it; a truck at 70 km/h
 * on a highway has 7 minutes, and if the kit takes four of them on a
 * one-bar connection it starts the download with three minutes of margin and
 * finishes it after the signal has gone. The number that matters is TIME, and
 * distance is only how time looks from a moving vehicle.
 *
 * So the lead distance is computed from what actually decides whether the
 * download finishes:
 *
 *   how fast the truck is going       - metres per second of lost margin
 *   how big the kit is                - bytes to move
 *   what the connection is like now    - bytes per second available, taken
 *                                        from the CURRENT segment's measured
 *                                        state rather than a guess
 *   how long the outage will be        - a longer blackout is worth more
 *                                        margin, because a partial kit is
 *                                        useless for longer
 *
 * and then clamped. The bounds are the honest admission that all four inputs
 * are estimates: MIN_LEAD_M so a stationary truck still prepares before it
 * sets off, MAX_LEAD_M so a bad estimate cannot make the app download the kit
 * for a dead zone 200 km away and call it ready.
 *
 * IDEMPOTENCE IS A KEY, NOT A FLAG
 *
 * `prefetchDecision` is called on every position update - several times a
 * minute - and must trigger ONCE per (trip, route, package, segment). The key
 * includes the package hash so that a corridor which genuinely changed
 * re-prepares, and the segment start so that the second dead zone of a journey
 * is prepared on its own merits rather than being suppressed by the first.
 *
 * Pure. No React, no storage, no clock of its own.
 */

import type { OfflineDataset } from '../api/client'

export type SegmentState = 'GOOD' | 'UNSTABLE' | 'WEAK' | 'DEAD_ZONE' | 'UNKNOWN'

/**
 * Throughput to assume for each measured state, in kilobits per second.
 *
 * Calibration knobs, deliberately pessimistic, and deliberately not a claim
 * about anyone's network: they are the planning figures this app uses to
 * decide how early to start, not a measurement of what a carrier delivers.
 * UNKNOWN is planned for as if it were UNSTABLE - never as if it were GOOD,
 * because the whole point of this layer is that unmeasured is not covered.
 */
export const THROUGHPUT_KBPS: Record<SegmentState, number> = {
  GOOD: 2_000,
  UNSTABLE: 400,
  WEAK: 120,
  // Already in it: nothing will download, so plan on the floor rather than
  // dividing by zero.
  DEAD_ZONE: 60,
  UNKNOWN: 400,
}

/** Connection setup, DNS, TLS and the server thinking. Seconds. */
export const HANDSHAKE_SECONDS = 4

/** Room for one failed attempt and its retry. */
export const RETRY_FACTOR = 2

/**
 * Extra seconds of margin per kilometre of predicted outage, capped.
 *
 * A 40 km blackout deserves more certainty than a 2 km one, because arriving
 * with three quarters of a kit is useless for twenty times as long. Small, and
 * bounded, because this is a preference and not a measurement.
 */
export const OUTAGE_MARGIN_SECONDS_PER_KM = 0.5
export const MAX_OUTAGE_MARGIN_SECONDS = 60

/**
 * Bounds on the answer, and the floor is not a rounding-up.
 *
 * MIN_LEAD_M is 5 km because that is the SEGMENT SIZE the connectivity layer
 * measures in (`app/domain/connectivity.py`). "The dead zone starts at 42 km"
 * is really "it starts somewhere in the 40-45 km bucket", so a lead distance
 * finer than one bucket is false precision: preparing 600 m before a boundary
 * that is itself known to ±2.5 km prepares nothing.
 *
 * That floor binds in the ordinary case, and it should. A kit is a couple of
 * hundred kilobytes, so on any working connection the download is tens of
 * seconds and the arithmetic below asks for a few hundred metres. The
 * constraint on this decision is not bandwidth, it is not knowing exactly
 * where the signal goes - and the honest response to that is to prepare a
 * whole segment early rather than to trust a number computed to the metre.
 *
 * The computed term takes over where it genuinely matters: a large kit, a
 * one-bar connection, a fast truck, or all three.
 *
 * MAX_LEAD_M is 25 km. Beyond that the estimate does more harm than good -
 * conditions will have changed, and a kit prepared that early is stale by the
 * time the truck reaches the dead zone it was prepared for.
 */
export const MIN_LEAD_M = 5_000
export const MAX_LEAD_M = 25_000

/**
 * Planning size for the kit: route geometry, stops, maneuvers, risk, places.
 *
 * Deliberately conservative. A measured kit for a two-corridor trip is about
 * 30 KB (`test_the_kit_is_small_enough_to_arrive_before_the_dead_zone` prints
 * the number), and the server-side ceiling is 512 KB. Planning at 180 KB errs
 * toward starting the download EARLIER than needed, which costs a little data
 * and buys margin - the opposite error costs the kit.
 */
export const TYPICAL_KIT_BYTES = 180_000

export interface LeadInputs {
  /** Current ground speed. Null when the phone has no fix or is stopped. */
  speedKmph: number | null
  /** Size of the package to fetch. */
  packageBytes: number
  /** Measured state of the segment the truck is in NOW. */
  hereState: SegmentState
  /** Predicted length of the blackout ahead, kilometres. */
  outageKm: number
}

export interface LeadEstimate {
  /** How far before the gap to start, metres. Clamped. */
  leadM: number
  /** Seconds the download is expected to need, including retry and margin. */
  seconds: number
  /** True when the clamp changed the answer, so a screen can say so. */
  clamped: boolean
}

/** How long the kit should take to arrive, and how far that is at this speed. */
export function leadDistance(inputs: LeadInputs): LeadEstimate {
  const kbps = THROUGHPUT_KBPS[inputs.hereState] ?? THROUGHPUT_KBPS.UNKNOWN
  const bits = Math.max(0, inputs.packageBytes) * 8
  const transferSeconds = bits / (kbps * 1000)
  const outageMargin = Math.min(
    MAX_OUTAGE_MARGIN_SECONDS,
    Math.max(0, inputs.outageKm) * OUTAGE_MARGIN_SECONDS_PER_KM,
  )
  const seconds = (transferSeconds + HANDSHAKE_SECONDS) * RETRY_FACTOR + outageMargin

  // A truck with no fix, or one that is stopped, still prepares: the floor
  // below covers it. Negative and non-finite speeds are treated as no speed
  // rather than trusted.
  const speed =
    inputs.speedKmph !== null && Number.isFinite(inputs.speedKmph) && inputs.speedKmph > 0
      ? inputs.speedKmph
      : 0
  const raw = (speed / 3.6) * seconds
  const leadM = Math.min(MAX_LEAD_M, Math.max(MIN_LEAD_M, raw))
  return { leadM, seconds, clamped: leadM !== raw }
}

export type PrefetchReason =
  /** Nothing is cached for this trip and route. */
  | 'NO_PACKAGE'
  /** The cached kit is past its window, so refresh while there is signal. */
  | 'PACKAGE_STALE'
  /** A weak, dead or unmeasured stretch is within the lead distance. */
  | 'GAP_AHEAD'
  /** A gap exists but is still further away than the lead distance. */
  | 'GAP_TOO_FAR'
  /** Nothing ahead needs preparing for. */
  | 'NO_GAP_AHEAD'
  /** This exact kit was already prepared for this exact segment. */
  | 'ALREADY_PREPARED'
  /** No signal to fetch over. Preparing now is not possible. */
  | 'NO_LINK'

export interface Gap {
  /** Distance along the route where the stretch begins, metres. */
  startM: number
  endM: number
  state: SegmentState
}

export interface PrefetchInputs {
  tripId: string | null
  routeId: string | null
  /** Hash of the cached kit, or null when nothing is cached. */
  packageHash: string | null
  /** Age of the cached kit, ms. Null when nothing is cached. */
  packageAgeMs: number | null
  /** How long a kit stays current, ms. */
  packageValidForMs: number
  /** How far along the route the truck is, metres. Null when unknown. */
  travelledM: number | null
  /** The next stretch worth preparing for, from the connectivity segments. */
  nextGap: Gap | null
  /** How far before it to start. From `leadDistance`. */
  leadM: number
  /** Whether the app can reach the service at all right now. */
  online: boolean
  /** Keys already prepared this trip. */
  prepared: readonly string[]
}

export interface PrefetchDecision {
  prepare: boolean
  reason: PrefetchReason
  /** Record this once the fetch succeeds. Null when nothing is to be done. */
  key: string | null
  /** Metres to the gap, when there is one. For the readiness line. */
  distanceToGapM: number | null
}

/**
 * The key a successful preparation is remembered by.
 *
 * Package hash included so a corridor that genuinely changed re-prepares;
 * segment start included so the second dead zone of a journey is judged on its
 * own merits rather than suppressed by the first.
 */
export function prefetchKey(
  tripId: string,
  routeId: string,
  packageHash: string | null,
  gapStartM: number | null,
): string {
  return [tripId, routeId, packageHash ?? 'none', gapStartM === null ? 'kit' : Math.round(gapStartM)].join(
    ':',
  )
}

export function prefetchDecision(inputs: PrefetchInputs): PrefetchDecision {
  const none: PrefetchDecision = {
    prepare: false,
    reason: 'NO_GAP_AHEAD',
    key: null,
    distanceToGapM: null,
  }
  if (inputs.tripId === null || inputs.routeId === null) return none

  const distanceToGapM =
    inputs.nextGap !== null && inputs.travelledM !== null
      ? Math.max(0, inputs.nextGap.startM - inputs.travelledM)
      : null

  // Nothing cached at all. This is the first and most important trigger: a
  // driver who reaches a dead zone with no kit has nothing to fall back on,
  // whether or not a gap is currently in range.
  if (inputs.packageHash === null || inputs.packageAgeMs === null) {
    if (!inputs.online) {
      return { prepare: false, reason: 'NO_LINK', key: null, distanceToGapM }
    }
    return {
      prepare: true,
      reason: 'NO_PACKAGE',
      key: prefetchKey(inputs.tripId, inputs.routeId, null, null),
      distanceToGapM,
    }
  }

  // The kit is cached but has aged out. Refresh it while there is still a
  // connection to refresh it over, rather than carrying yesterday's weather
  // into today's valley.
  if (inputs.packageAgeMs > inputs.packageValidForMs) {
    if (!inputs.online) {
      return { prepare: false, reason: 'NO_LINK', key: null, distanceToGapM }
    }
    return {
      prepare: true,
      reason: 'PACKAGE_STALE',
      key: prefetchKey(inputs.tripId, inputs.routeId, inputs.packageHash, null),
      distanceToGapM,
    }
  }

  if (inputs.nextGap === null || distanceToGapM === null) return none
  if (distanceToGapM > inputs.leadM) {
    return { prepare: false, reason: 'GAP_TOO_FAR', key: null, distanceToGapM }
  }

  const key = prefetchKey(
    inputs.tripId,
    inputs.routeId,
    inputs.packageHash,
    inputs.nextGap.startM,
  )
  if (inputs.prepared.includes(key)) {
    return { prepare: false, reason: 'ALREADY_PREPARED', key, distanceToGapM }
  }
  if (!inputs.online) {
    return { prepare: false, reason: 'NO_LINK', key, distanceToGapM }
  }
  return { prepare: true, reason: 'GAP_AHEAD', key, distanceToGapM }
}

export type DatasetState = 'AVAILABLE' | 'STALE' | 'NOT_AVAILABLE' | 'BUNDLED_IN_APP'

export interface DatasetReading {
  name: string
  state: DatasetState
  /** Age on the DEVICE clock, ms. Null when the block does not age. */
  ageMs: number | null
  source: string | null
  detail: string | null
}

/**
 * Re-age one manifest row against the device clock.
 *
 * The server's `state` was true when the package was handed over. Hours later,
 * in a valley, the only clock available is this one - so the block is aged
 * again here. A block the server called AVAILABLE can become STALE on the
 * device; one it called NOT_AVAILABLE never becomes anything else, because
 * time does not produce evidence.
 */
export function readDataset(dataset: OfflineDataset, now: number): DatasetReading {
  const state = dataset.state as DatasetState
  if (state === 'NOT_AVAILABLE' || state === 'BUNDLED_IN_APP') {
    return {
      name: dataset.name,
      state,
      ageMs: null,
      source: dataset.source,
      detail: dataset.detail,
    }
  }

  const capturedAt = dataset.captured_at ? Date.parse(dataset.captured_at) : NaN
  if (!Number.isFinite(capturedAt)) {
    // A block that claims to be available with no timestamp cannot be aged,
    // and an un-ageable timestamp is not evidence of currency.
    return {
      name: dataset.name,
      state: 'NOT_AVAILABLE',
      ageMs: null,
      source: dataset.source,
      detail: dataset.detail ?? 'No capture time, so this cannot be aged.',
    }
  }

  // Clamped: a device clock behind the server's would otherwise produce a
  // negative age, which renders as data from the future.
  const ageMs = Math.max(0, now - capturedAt)
  const validMs = (dataset.valid_for_seconds ?? 0) * 1000
  return {
    name: dataset.name,
    state: dataset.valid_for_seconds !== null && ageMs > validMs ? 'STALE' : 'AVAILABLE',
    ageMs,
    source: dataset.source,
    detail: dataset.detail,
  }
}

export interface Readiness {
  /** Every block, re-aged on this device. */
  datasets: DatasetReading[]
  stale: string[]
  unavailable: string[]
  /** True when nothing is stale or missing. */
  complete: boolean
}

/**
 * What the driver's offline readiness card reads from.
 *
 * A v1 package cached by an older build carries no manifest. That is reported
 * as an empty reading rather than as readiness: an old kit is not a complete
 * one, and the absence of a manifest is exactly the case where nothing can be
 * said about what has gone stale.
 */
export function readiness(datasets: OfflineDataset[] | undefined, now: number): Readiness {
  const readings = (datasets ?? []).map((dataset) => readDataset(dataset, now))
  const stale = readings.filter((d) => d.state === 'STALE').map((d) => d.name)
  const unavailable = readings.filter((d) => d.state === 'NOT_AVAILABLE').map((d) => d.name)
  return {
    datasets: readings,
    stale,
    unavailable,
    complete: readings.length > 0 && stale.length === 0 && unavailable.length === 0,
  }
}
