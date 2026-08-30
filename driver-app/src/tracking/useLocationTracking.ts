/**
 * React binding for the location tracking engine.
 *
 * Deliberately thin. Every decision - the cadence rule, the bounded queue, the
 * backoff, what the screen may claim - lives in tracker.ts, which has no React
 * and no Expo in it and is therefore testable. This file owns only what React
 * owns: creating the engine when tracking becomes appropriate, subscribing to
 * its state, ticking the flush, and tearing everything down on unmount.
 *
 * Scope: FOREGROUND only. No background task, no "always" permission, no
 * geofencing. docs/SECURITY.md §3 commits to collecting only during an active
 * trip, and foreground-only is the smallest implementation that honours it -
 * asking for a permission the product has no use for is both a worse consent
 * conversation and a larger thing to get wrong.
 *
 * Cadence comes from the server (`trip.tracking`), never from a constant here,
 * so what a phone uploads and what a manager calls "live" cannot drift apart.
 * See backend app/domain/telemetry_policy.py.
 */

import { useEffect, useRef, useState } from 'react'

import { ApiError, api, type TrackingConfig } from '../api/client'
import { expoLocationAdapter } from './adapter'
import {
  LocationTracker,
  type TrackerState,
  type UploadOutcome,
} from './tracker'

export type { PermissionState, UploadState } from './tracker'

export interface TrackingView extends TrackerState {
  /** Ask again after a denial - the driver may have changed their mind. */
  requestPermission: () => void
}

const IDLE: TrackerState = {
  permission: 'unknown',
  isTracking: false,
  uploadState: 'idle',
  queueDepth: 0,
  lastAcceptedAt: null,
  droppedCount: 0,
  lastError: null,
}

/** How often to consider sending. The engine decides whether there is anything. */
const FLUSH_TICK_MS = 1_000

/**
 * Classify an upload failure.
 *
 * A 4xx other than 429 will never succeed on retry: the trip ended, or the
 * request was malformed. Anything else - a timeout, a 5xx, no signal - is worth
 * keeping and retrying.
 */
function classifyUploadError(error: unknown): UploadOutcome {
  if (error instanceof ApiError) {
    const retryable = error.status >= 500 || error.status === 429
    return { retryable, message: error.message }
  }
  return { retryable: true, message: 'Cannot reach the server. Retrying.' }
}

export function useLocationTracking(
  tripId: string | null,
  enabled: boolean,
  config: TrackingConfig | null,
): TrackingView {
  const [state, setState] = useState<TrackerState>(IDLE)
  const [nonce, setNonce] = useState(0)
  const trackerRef = useRef<LocationTracker | null>(null)

  // Depended on by PRIMITIVE VALUE, not object identity. `config` arrives
  // inside the trip payload, so a fresh object appears on every reload - after
  // each arrive, complete and pull-to-refresh. An effect keyed on the object
  // would tear down and re-subscribe the native GPS watch every time, dropping
  // the in-flight fix and waking the radio for nothing.
  const moving = config?.moving_interval_seconds ?? null
  const stationary = config?.stationary_interval_seconds ?? null
  const stationaryDistance = config?.stationary_distance_m ?? null
  const batchSize = config?.batch_size ?? null
  const queueLimit = config?.queue_limit ?? null

  useEffect(() => {
    if (
      !enabled ||
      !tripId ||
      moving === null ||
      stationary === null ||
      stationaryDistance === null ||
      batchSize === null ||
      queueLimit === null
    ) {
      setState(IDLE)
      return
    }

    const tracker = new LocationTracker(
      {
        adapter: expoLocationAdapter,
        upload: async (fixes) => {
          await api.sendLocation(tripId, fixes)
        },
        classify: classifyUploadError,
        now: () => Date.now(),
        newId: randomId,
      },
      {
        movingIntervalSeconds: moving,
        stationaryIntervalSeconds: stationary,
        stationaryDistanceM: stationaryDistance,
        batchSize,
        queueLimit,
      },
    )
    trackerRef.current = tracker

    const unsubscribe = tracker.subscribe(setState)
    void tracker.start()

    // Separate from the watch, so an upload failure cannot stop collection and
    // a gap in collection cannot stop a pending retry.
    const timer = setInterval(() => void tracker.flush(), FLUSH_TICK_MS)

    return () => {
      clearInterval(timer)
      unsubscribe()
      tracker.stop()
      trackerRef.current = null
    }
  }, [
    enabled,
    tripId,
    moving,
    stationary,
    stationaryDistance,
    batchSize,
    queueLimit,
    nonce,
  ])

  return {
    ...state,
    requestPermission: () => setNonce((n) => n + 1),
  }
}

/** RFC 4122 v4, without a dependency for one call site. */
function randomId(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
