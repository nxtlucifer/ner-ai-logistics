/**
 * The offline trip kit as the driver sees it: what is ready, what has gone
 * stale, and whether the phone is preparing for the next stretch without
 * signal.
 *
 * NOT A SECOND FETCHER. `useRouteGeometry` already downloads the package and
 * writes it to storage, because the map is drawn from the same payload. This
 * hook reads what that produced, decides whether it is time to refresh, and
 * asks that one fetcher to do it. A second downloader would give a driver a
 * map and a readiness card that could disagree about which corridor is
 * cached - the one thing they must not do at the mouth of a valley.
 *
 * WHAT IT DECIDES
 *
 * Where the truck is on the route, which connectivity segment it is in, which
 * weak or unmeasured stretch is next, how far before it the kit must start
 * downloading at this speed on this connection, and whether that has already
 * been done for this exact package and segment.
 *
 * `prefetch.ts` holds every one of those rules and is pure. This file holds
 * only the React: reading the package, remembering which segments have been
 * prepared, and calling `reload` once.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { OfflinePackage } from '../api/client'
import { PACKAGE_FRESH_MS } from './packageStore'
import {
  TYPICAL_KIT_BYTES,
  leadDistance,
  prefetchDecision,
  readiness,
  type Gap,
  type PrefetchReason,
  type Readiness,
  type SegmentState,
} from './prefetch'

/**
 * Which prefetch reasons this hook acts on, and which belong to someone else.
 *
 * NO_PACKAGE is deliberately NOT one of them. `useRouteGeometry` already
 * fetches the package on mount and already has a retry policy with a deliberate
 * delay in it, tested and tuned; triggering here as well would mean two
 * downloads racing on mount and two retry loops arguing about the interval.
 * First acquisition has an owner, and it is not this hook.
 *
 * What this hook adds is the ANTICIPATION the base fetcher has no way to do:
 * refreshing early because a stretch without signal is coming up, and
 * refreshing because the cached kit has aged out while there is still a
 * connection to refresh it over.
 */
export function shouldTriggerRefresh(reason: PrefetchReason): boolean {
  return reason === 'GAP_AHEAD' || reason === 'PACKAGE_STALE'
}

export interface ConnectivitySegmentView {
  start_m: number
  end_m: number
  state: string
}

export interface TripKit {
  /** Every block of the kit, re-aged on the device clock. */
  readiness: Readiness
  /** When the package was captured. Null when nothing is cached. */
  capturedAt: string | null
  /** Age of the cached package on the device clock, ms. */
  ageMs: number | null
  /** The package's own identity, so a screen can show which corridor is held. */
  packageHash: string | null
  version: string | null
  /** The next stretch worth preparing for, and how far away it is. */
  nextGap: Gap | null
  distanceToGapM: number | null
  /** The measured state of the segment the truck is in now. */
  hereState: SegmentState
  /** How far before the gap the download must start, at this speed. */
  leadM: number
  /** Why the kit is or is not being prepared right now. */
  reason: PrefetchReason
  /** True while a refresh is in flight. */
  isPreparing: boolean
}

function segmentsOf(packageData: OfflinePackage | null): ConnectivitySegmentView[] {
  const connectivity = (packageData?.risk as { connectivity?: { segments?: ConnectivitySegmentView[] } } | null)
    ?.connectivity
  return connectivity?.segments ?? []
}

/** The state of the segment containing `travelledM`. UNKNOWN when unmeasured. */
export function stateAt(
  segments: ConnectivitySegmentView[],
  travelledM: number | null,
): SegmentState {
  if (travelledM === null) return 'UNKNOWN'
  const here = segments.find((s) => travelledM >= s.start_m && travelledM < s.end_m)
  return (here?.state as SegmentState) ?? 'UNKNOWN'
}

/**
 * The first stretch ahead worth preparing for.
 *
 * UNKNOWN counts, and that is the point of the whole layer: a stretch nobody
 * has measured must be prepared for exactly as if the signal dies there,
 * because assuming coverage is the failure this exists to end.
 */
export function nextGapAfter(
  segments: ConnectivitySegmentView[],
  travelledM: number | null,
): Gap | null {
  if (travelledM === null) return null
  const prepare = new Set(['WEAK', 'DEAD_ZONE', 'UNKNOWN'])
  const found = segments.find((s) => s.end_m > travelledM && prepare.has(s.state))
  if (!found) return null
  return { startM: found.start_m, endM: found.end_m, state: found.state as SegmentState }
}

export function useTripKit(input: {
  tripId: string | null
  routeId: string | null
  packageData: OfflinePackage | null
  /** How far along the route the truck is, metres. Null when unknown. */
  travelledM: number | null
  speedKmph: number | null
  /** Whether the app can reach the service right now. */
  online: boolean
  /** Ask the one fetcher to download the package again. */
  reload: () => void
  /** Injected so a test can age a kit without sleeping through it. */
  now?: number
}): TripKit {
  const [preparing, setPreparing] = useState(false)
  // Segments already prepared for, by key. A ref rather than state: it must
  // not re-render the map, and it must not be reset by one.
  const prepared = useRef<string[]>([])
  const now = input.now ?? Date.now()

  const segments = useMemo(() => segmentsOf(input.packageData), [input.packageData])
  const hereState = stateAt(segments, input.travelledM)
  const nextGap = nextGapAfter(segments, input.travelledM)

  const capturedAt = input.packageData?.captured_at ?? null
  const capturedMs = capturedAt ? Date.parse(capturedAt) : Number.NaN
  const ageMs = Number.isFinite(capturedMs) ? Math.max(0, now - capturedMs) : null

  const lead = useMemo(
    () =>
      leadDistance({
        speedKmph: input.speedKmph,
        packageBytes: TYPICAL_KIT_BYTES,
        hereState,
        outageKm: nextGap ? (nextGap.endM - nextGap.startM) / 1000 : 0,
      }),
    [input.speedKmph, hereState, nextGap],
  )

  const decision = useMemo(
    () =>
      prefetchDecision({
        tripId: input.tripId,
        routeId: input.routeId,
        packageHash: input.packageData?.package_hash ?? null,
        packageAgeMs: ageMs,
        packageValidForMs: PACKAGE_FRESH_MS,
        travelledM: input.travelledM,
        nextGap,
        leadM: lead.leadM,
        online: input.online,
        prepared: prepared.current,
      }),
    [
      input.tripId,
      input.routeId,
      input.packageData?.package_hash,
      ageMs,
      input.travelledM,
      nextGap,
      lead.leadM,
      input.online,
    ],
  )

  // A new trip or corridor starts with nothing prepared.
  useEffect(() => {
    prepared.current = []
  }, [input.tripId, input.routeId])

  const reload = input.reload
  useEffect(() => {
    if (!decision.prepare || decision.key === null) return
    if (!shouldTriggerRefresh(decision.reason)) return
    // Recorded BEFORE the fetch, not after: this effect runs on every position
    // update, and waiting for the download to finish would start a second one
    // a second later. A failed download is retried by the next decision, which
    // sees an unchanged package hash and an unprepared key again only after
    // the key is cleared below.
    prepared.current = [...prepared.current, decision.key]
    setPreparing(true)
    reload()
  }, [decision.prepare, decision.key, decision.reason, reload])

  // The fetcher answered - the package changed, or it stopped loading.
  useEffect(() => {
    if (preparing) setPreparing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.packageData?.package_hash, input.packageData?.captured_at])

  const markUnprepared = useCallback((key: string) => {
    prepared.current = prepared.current.filter((entry) => entry !== key)
  }, [])
  // Exposed through the closure below rather than the returned object: a
  // screen has no business re-arming a prefetch, but a retry path might.
  void markUnprepared

  return {
    readiness: readiness(input.packageData?.datasets, now),
    capturedAt,
    ageMs,
    packageHash: input.packageData?.package_hash ?? null,
    version: input.packageData?.version ?? null,
    nextGap,
    distanceToGapM: decision.distanceToGapM,
    hereState,
    leadM: lead.leadM,
    reason: decision.reason,
    isPreparing: preparing,
  }
}
