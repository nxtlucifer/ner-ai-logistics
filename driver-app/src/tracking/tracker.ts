/**
 * The location tracking engine. No React, no Expo, no timers of its own.
 *
 * Everything that decides what happens lives here: when a fix is worth keeping,
 * how deep the queue may get, what to do when an upload fails, and what the
 * screen is allowed to claim. React binds to it in useLocationTracking.ts, and
 * the device reaches it only through the `LocationAdapter` boundary.
 *
 * It is written this way so the behaviour can be tested. A hook that owns its
 * own timers, subscriptions and network calls can only be exercised in a
 * renderer with a simulator attached, which in practice means it is not
 * exercised at all - and the bounded queue and backoff are exactly the parts
 * that must not be wrong on a truck that has lost signal.
 *
 * TIME IS INJECTED. `now()` and `schedule()` come from the caller, so a test can
 * step through a backoff sequence deterministically instead of sleeping through
 * it.
 *
 *      idle ──start()──▶ requesting ──▶ denied      (driver said no)
 *                             │        unavailable  (services off / no sensor)
 *                             ▼
 *                          granted ──▶ tracking ──stop()──▶ idle
 */

import type { LocationAdapter, Sample, Subscription } from './adapter'

export type PermissionState =
  | 'unknown'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'

export type UploadState = 'idle' | 'sending' | 'ok' | 'failing'

/** One position fix, in the shape the API accepts. */
export interface GpsFix {
  device_fix_id: string
  location: { lat: number; lon: number }
  recorded_at: string
  altitude_m?: string
  speed_kmph?: string
  heading_deg?: string
  accuracy_m?: string
  is_mock_location?: boolean
}

export interface TrackerConfig {
  movingIntervalSeconds: number
  stationaryIntervalSeconds: number
  stationaryDistanceM: number
  batchSize: number
  queueLimit: number
}

export interface TrackerState {
  permission: PermissionState
  isTracking: boolean
  uploadState: UploadState
  queueDepth: number
  lastAcceptedAt: Date | null
  droppedCount: number
  lastError: string | null
}

export interface UploadOutcome {
  /** True when retrying could plausibly succeed. */
  retryable: boolean
  message: string
}

export interface TrackerDeps {
  adapter: LocationAdapter
  /** Resolves on success; rejects with an UploadOutcome-shaped error. */
  upload: (fixes: GpsFix[]) => Promise<void>
  /** Classify a rejection from `upload`. */
  classify: (error: unknown) => UploadOutcome
  now: () => number
  newId: () => string
}

export const BACKOFF_BASE_MS = 2_000
export const BACKOFF_MAX_MS = 60_000

/** Great-circle distance in metres. */
export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = ((b.lat - a.lat) * Math.PI) / 180
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Mirrors the bounds in backend app/schemas/domain.py GpsFixIn.
//
// Every one of these is optional decoration around the coordinate, and every
// one is range-checked server-side. Sending a glitched reading makes the whole
// request a 422, the batch is then a permanent failure and gets dropped, and
// real positions are lost to one bad speed sample. Omitting the questionable
// field keeps the position, which is the part that matters.
const ALTITUDE = { min: -500, max: 10_000 }
const SPEED_KMPH = { min: 0, max: 200 }
const HEADING = { min: 0, max: 359.99 }
const ACCURACY = { min: 0, max: 20_000 }

export function optionalReading(
  value: number | null | undefined,
  range: { min: number; max: number },
): string | undefined {
  if (value === null || value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  if (value < range.min || value > range.max) return undefined
  return String(Number(value.toFixed(2)))
}

export function toFix(sample: Sample, id: string): GpsFix {
  return {
    // Generated on the device and kept across retries: this is what makes a
    // re-sent batch idempotent at the server's unique index.
    device_fix_id: id,
    location: { lat: sample.lat, lon: sample.lon },
    recorded_at: new Date(sample.timestamp).toISOString(),
    altitude_m: optionalReading(sample.altitudeM, ALTITUDE),
    // The platform reports metres per second; the column is km/h.
    speed_kmph: optionalReading(
      sample.speedMs === null || sample.speedMs < 0 ? null : sample.speedMs * 3.6,
      SPEED_KMPH,
    ),
    heading_deg: optionalReading(sample.headingDeg, HEADING),
    accuracy_m: optionalReading(sample.accuracyM, ACCURACY),
    // Reported honestly and left to the server to surface. Never used here to
    // suppress a fix - see docs/SECURITY.md section 8.
    is_mock_location: sample.isMock,
  }
}

export class LocationTracker {
  private state: TrackerState = {
    permission: 'unknown',
    isTracking: false,
    uploadState: 'idle',
    queueDepth: 0,
    lastAcceptedAt: null,
    droppedCount: 0,
    lastError: null,
  }

  private queue: GpsFix[] = []
  private lastKept: { lat: number; lon: number; at: number } | null = null
  private subscription: Subscription | null = null
  private flushing = false
  private failures = 0
  private nextAttemptAt = 0
  private stopped = true
  private listeners = new Set<(state: TrackerState) => void>()

  constructor(
    private readonly deps: TrackerDeps,
    private readonly config: TrackerConfig,
  ) {}

  getState(): TrackerState {
    return this.state
  }

  subscribe(listener: (state: TrackerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(patch: Partial<TrackerState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  /**
   * Ask for permission and, if granted, begin watching.
   *
   * Denial and unavailability are terminal, non-crashing states: no retry loop,
   * no fabricated position, and every other part of the trip screen keeps
   * working. The driver can ask again explicitly.
   */
  async start(): Promise<void> {
    this.stopped = false
    this.emit({ permission: 'requesting', lastError: null })

    let outcome
    try {
      const servicesOn = await this.deps.adapter.hasServicesEnabled()
      if (this.stopped) return
      if (!servicesOn) {
        this.emit({ permission: 'unavailable', isTracking: false })
        return
      }
      outcome = await this.deps.adapter.requestPermission()
    } catch {
      // No location hardware, or a browser refusing outright. A state the
      // screen can explain, not a crash.
      if (!this.stopped) this.emit({ permission: 'unavailable', isTracking: false })
      return
    }

    if (this.stopped) return
    if (outcome !== 'granted') {
      this.emit({ permission: outcome, isTracking: false })
      return
    }

    this.emit({ permission: 'granted' })
    await this.beginWatch()
  }

  private async beginWatch(): Promise<void> {
    try {
      const subscription = await this.deps.adapter.watch(
        { intervalSeconds: this.config.movingIntervalSeconds },
        (sample) => this.onSample(sample),
        (message) => {
          // The screen must stop claiming tracking is active the moment the
          // platform says it is not.
          this.emit({ isTracking: false, lastError: message })
        },
      )
      if (this.stopped) {
        subscription.remove()
        return
      }
      this.subscription = subscription
      this.emit({ isTracking: true })
    } catch (error) {
      this.emit({
        isTracking: false,
        permission: 'unavailable',
        lastError:
          error instanceof Error ? error.message : 'Location is unavailable.',
      })
    }
  }

  /**
   * Decide whether a sample is worth keeping, and queue it if so.
   *
   * The cadence is enforced here rather than left to the platform, because
   * `timeInterval` is Android-only: on iOS and web the callback fires as fast
   * as fixes arrive.
   */
  onSample(sample: Sample): void {
    if (this.stopped) return

    const here = { lat: sample.lat, lon: sample.lon }
    const previous = this.lastKept

    if (previous) {
      const elapsed = sample.timestamp - previous.at
      const moved = metresBetween(previous, here)
      const stationary = moved < this.config.stationaryDistanceM
      const interval = stationary
        ? this.config.stationaryIntervalSeconds
        : this.config.movingIntervalSeconds
      // A parked truck at the moving cadence produces thousands of identical
      // rows overnight and drains the battery for no information - but it still
      // reports periodically, so silence stays distinguishable from a dead app.
      if (elapsed < interval * 1000) return
    }

    this.lastKept = { ...here, at: sample.timestamp }
    this.queue.push(toFix(sample, this.deps.newId()))

    let dropped = this.state.droppedCount
    if (this.queue.length > this.config.queueLimit) {
      const overflow = this.queue.length - this.config.queueLimit
      // Oldest first. A phone offline for a shift would otherwise grow this
      // until the OS kills the app mid-trip, and the newest positions are the
      // ones a dispatcher needs.
      this.queue = this.queue.slice(overflow)
      dropped += overflow
    }
    this.emit({ queueDepth: this.queue.length, droppedCount: dropped })
  }

  /**
   * Send one batch, if there is anything to send and the backoff has elapsed.
   *
   * Called on a tick by the React binding. Safe to call at any time: it is a
   * no-op when there is nothing to do.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return
    if (this.deps.now() < this.nextAttemptAt) return // still backing off

    this.flushing = true
    // Taken off before sending and put BACK on a retryable failure. Leaving
    // them on would let the next tick send the same fixes again; dropping them
    // would lose positions the server never acknowledged.
    const batch = this.queue.slice(0, this.config.batchSize)
    this.queue = this.queue.slice(batch.length)
    this.emit({ queueDepth: this.queue.length, uploadState: 'sending' })

    try {
      await this.deps.upload(batch)
      this.failures = 0
      this.nextAttemptAt = 0
      this.emit({
        uploadState: 'ok',
        lastAcceptedAt: new Date(this.deps.now()),
        lastError: null,
        queueDepth: this.queue.length,
      })
    } catch (error) {
      const outcome = this.deps.classify(error)
      if (outcome.retryable) {
        this.queue = [...batch, ...this.queue].slice(0, this.config.queueLimit)
      }
      // A non-retryable failure means this batch will never be accepted - the
      // trip ended, or the client sent something malformed. Holding it forever
      // would block every later fix behind it.
      this.failures += 1
      this.nextAttemptAt =
        this.deps.now() +
        Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS)
      this.emit({
        uploadState: 'failing',
        lastError: outcome.message,
        queueDepth: this.queue.length,
      })
    } finally {
      this.flushing = false
    }
  }

  /** When the next flush attempt becomes allowed. Exposed for tests. */
  get retryAt(): number {
    return this.nextAttemptAt
  }

  /**
   * Stop watching and discard anything unsent.
   *
   * Unsent fixes are dropped on purpose: the server refuses location for a trip
   * that is no longer in progress, so holding them would mean an ended trip's
   * positions sitting in memory with nowhere to go.
   */
  stop(): void {
    this.stopped = true
    this.subscription?.remove()
    this.subscription = null
    this.queue = []
    this.lastKept = null
    this.failures = 0
    this.nextAttemptAt = 0
    this.emit({
      isTracking: false,
      uploadState: 'idle',
      queueDepth: 0,
    })
  }
}
