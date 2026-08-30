/**
 * Location tracking engine.
 *
 * These exist because the parts most likely to be wrong are the parts hardest
 * to reach by hand: a queue that must stay bounded on a phone that has been
 * offline for a shift, a backoff that must not hammer a backend that is down,
 * and a screen that must stop claiming tracking works the moment it does not.
 * None of those can be exercised by opening the app on a desk.
 *
 * Only the SENSOR is stood in for. The adapter is the boundary - three calls,
 * no Expo types - so everything under test here is the real engine, with real
 * cadence, queue and backoff logic. Time is injected rather than slept through,
 * which is what makes the backoff sequence checkable at all.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocationAdapter, Sample, Subscription } from './adapter'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  LocationTracker,
  type GpsFix,
  type TrackerConfig,
  type UploadOutcome,
} from './tracker'

const CONFIG: TrackerConfig = {
  movingIntervalSeconds: 10,
  stationaryIntervalSeconds: 60,
  stationaryDistanceM: 30,
  batchSize: 3,
  queueLimit: 5,
}

const GUWAHATI = { lat: 26.1445, lon: 91.7362 }

function sample(overrides: Partial<Sample> = {}): Sample {
  return {
    ...GUWAHATI,
    timestamp: 1_000_000,
    altitudeM: 55.2,
    speedMs: 12,
    headingDeg: 118,
    accuracyM: 8.4,
    isMock: false,
    ...overrides,
  }
}

/** A controllable stand-in for the device. */
function makeAdapter(
  options: {
    servicesEnabled?: boolean
    permission?: 'granted' | 'denied' | 'unavailable'
    failServices?: boolean
    failWatch?: boolean
  } = {},
) {
  const removed = vi.fn()
  let emit: ((s: Sample) => void) | null = null
  let raise: ((message: string) => void) | null = null

  const adapter: LocationAdapter = {
    hasServicesEnabled: vi.fn(async () => {
      if (options.failServices) throw new Error('no location module')
      return options.servicesEnabled ?? true
    }),
    requestPermission: vi.fn(async () => options.permission ?? 'granted'),
    watch: vi.fn(async (_options, onSample, onError): Promise<Subscription> => {
      if (options.failWatch) throw new Error('watch refused')
      emit = onSample
      raise = onError
      return { remove: removed }
    }),
  }

  return {
    adapter,
    removed,
    emit: (s: Sample) => emit?.(s),
    raise: (m: string) => raise?.(m),
  }
}

interface Harness {
  tracker: LocationTracker
  uploads: GpsFix[][]
  setClock: (ms: number) => void
  advance: (ms: number) => void
  failNext: (outcome: UploadOutcome, times?: number) => void
}

function makeTracker(
  device: ReturnType<typeof makeAdapter>,
  config: Partial<TrackerConfig> = {},
): Harness {
  const uploads: GpsFix[][] = []
  let clock = 0
  let failures: UploadOutcome[] = []
  let counter = 0

  const tracker = new LocationTracker(
    {
      adapter: device.adapter,
      upload: async (fixes) => {
        const failure = failures.shift()
        if (failure) throw failure
        uploads.push(fixes)
      },
      classify: (error) => error as UploadOutcome,
      now: () => clock,
      newId: () => `fix-${++counter}`,
    },
    { ...CONFIG, ...config },
  )

  return {
    tracker,
    uploads,
    setClock: (ms) => {
      clock = ms
    },
    advance: (ms) => {
      clock += ms
    },
    failNext: (outcome, times = 1) => {
      failures = [...failures, ...Array<UploadOutcome>(times).fill(outcome)]
    },
  }
}

const RETRYABLE: UploadOutcome = { retryable: true, message: 'offline' }
const PERMANENT: UploadOutcome = { retryable: false, message: 'trip ended' }

describe('permission', () => {
  it('reports denial without crashing or retrying', async () => {
    const device = makeAdapter({ permission: 'denied' })
    const { tracker } = makeTracker(device)

    await tracker.start()

    expect(tracker.getState().permission).toBe('denied')
    expect(tracker.getState().isTracking).toBe(false)
    // A denial must not be met with a watch attempt, and must not loop.
    expect(device.adapter.watch).not.toHaveBeenCalled()
    expect(device.adapter.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable when location services are switched off', async () => {
    const device = makeAdapter({ servicesEnabled: false })
    const { tracker } = makeTracker(device)

    await tracker.start()

    expect(tracker.getState().permission).toBe('unavailable')
    expect(tracker.getState().isTracking).toBe(false)
    // Never even asks: there is nothing to grant.
    expect(device.adapter.requestPermission).not.toHaveBeenCalled()
  })

  it('reports unavailable when the platform has no location module', async () => {
    const device = makeAdapter({ failServices: true })
    const { tracker } = makeTracker(device)

    await tracker.start()

    expect(tracker.getState().permission).toBe('unavailable')
    expect(tracker.getState().isTracking).toBe(false)
  })

  it('tracks only once permission is actually granted', async () => {
    const device = makeAdapter({ permission: 'granted' })
    const { tracker } = makeTracker(device)

    expect(tracker.getState().isTracking).toBe(false)
    await tracker.start()

    expect(tracker.getState().permission).toBe('granted')
    expect(tracker.getState().isTracking).toBe(true)
    expect(device.adapter.watch).toHaveBeenCalledTimes(1)
  })

  it('does not claim to be tracking when the watch itself fails', async () => {
    const device = makeAdapter({ failWatch: true })
    const { tracker } = makeTracker(device)

    await tracker.start()

    expect(tracker.getState().isTracking).toBe(false)
    expect(tracker.getState().permission).toBe('unavailable')
    expect(tracker.getState().lastError).toContain('watch refused')
  })
})

describe('cadence', () => {
  it('keeps the first fix and then applies the moving interval', async () => {
    const device = makeAdapter()
    const { tracker } = makeTracker(device)
    await tracker.start()

    device.emit(sample({ timestamp: 0 }))
    expect(tracker.getState().queueDepth).toBe(1)

    // 5 s later and 200 m on: moving, but inside the 10 s cadence.
    device.emit(sample({ timestamp: 5_000, lat: GUWAHATI.lat + 0.002 }))
    expect(tracker.getState().queueDepth).toBe(1)

    device.emit(sample({ timestamp: 10_000, lat: GUWAHATI.lat + 0.004 }))
    expect(tracker.getState().queueDepth).toBe(2)
  })

  it('slows to the stationary interval when the truck has not moved', async () => {
    const device = makeAdapter()
    const { tracker } = makeTracker(device)
    await tracker.start()

    device.emit(sample({ timestamp: 0 }))
    // 30 s later, a few metres of GPS jitter: stationary, so 10 s is not enough.
    device.emit(sample({ timestamp: 30_000, lat: GUWAHATI.lat + 0.00005 }))
    expect(tracker.getState().queueDepth).toBe(1)

    // Past the stationary interval it reports anyway, so silence stays
    // distinguishable from a dead app.
    device.emit(sample({ timestamp: 61_000, lat: GUWAHATI.lat + 0.00005 }))
    expect(tracker.getState().queueDepth).toBe(2)
  })
})

describe('the queue is bounded', () => {
  it('never grows past the limit and drops the OLDEST', async () => {
    const device = makeAdapter()
    const { tracker } = makeTracker(device)
    await tracker.start()

    // Twenty fixes, well past the limit of five.
    for (let n = 0; n < 20; n += 1) {
      device.emit(
        sample({ timestamp: n * 20_000, lat: GUWAHATI.lat + n * 0.01 }),
      )
    }

    expect(tracker.getState().queueDepth).toBe(CONFIG.queueLimit)
    expect(tracker.getState().droppedCount).toBe(20 - CONFIG.queueLimit)
  })

  it('keeps the newest positions, which are the ones a dispatcher needs', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device, { queueLimit: 2, batchSize: 2 })
    await harness.tracker.start()

    for (let n = 0; n < 4; n += 1) {
      device.emit(
        sample({ timestamp: n * 20_000, lat: GUWAHATI.lat + n * 0.01 }),
      )
    }
    await harness.tracker.flush()

    const sent = harness.uploads[0]
    expect(sent).toHaveLength(2)
    // Fixes 3 and 4 survived; 1 and 2 were dropped.
    expect(sent.map((f) => f.device_fix_id)).toEqual(['fix-3', 'fix-4'])
  })
})

describe('upload', () => {
  it('removes acknowledged fixes from the queue', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()

    device.emit(sample({ timestamp: 0 }))
    device.emit(sample({ timestamp: 20_000, lat: GUWAHATI.lat + 0.01 }))
    expect(harness.tracker.getState().queueDepth).toBe(2)

    await harness.tracker.flush()

    expect(harness.uploads).toHaveLength(1)
    expect(harness.tracker.getState().queueDepth).toBe(0)
    expect(harness.tracker.getState().uploadState).toBe('ok')
    expect(harness.tracker.getState().lastAcceptedAt).not.toBeNull()
  })

  it('sends at most one batch at a time', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device, { batchSize: 2 })
    await harness.tracker.start()

    for (let n = 0; n < 4; n += 1) {
      device.emit(
        sample({ timestamp: n * 20_000, lat: GUWAHATI.lat + n * 0.01 }),
      )
    }
    await harness.tracker.flush()

    expect(harness.uploads).toHaveLength(1)
    expect(harness.uploads[0]).toHaveLength(2)
  })

  it('keeps a failed batch queued so no position is lost', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()

    device.emit(sample({ timestamp: 0 }))
    device.emit(sample({ timestamp: 20_000, lat: GUWAHATI.lat + 0.01 }))

    harness.failNext(RETRYABLE)
    await harness.tracker.flush()

    expect(harness.uploads).toHaveLength(0)
    expect(harness.tracker.getState().queueDepth).toBe(2)
    expect(harness.tracker.getState().uploadState).toBe('failing')

    harness.advance(BACKOFF_MAX_MS)
    await harness.tracker.flush()

    expect(harness.uploads).toHaveLength(1)
    expect(harness.uploads[0]).toHaveLength(2)
    expect(harness.tracker.getState().queueDepth).toBe(0)
  })

  it('drops a batch that can never succeed rather than blocking the queue', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()

    device.emit(sample({ timestamp: 0 }))
    harness.failNext(PERMANENT)
    await harness.tracker.flush()

    // A 4xx means the trip ended or the request was malformed; requeuing would
    // block every later fix behind a batch that will never be accepted.
    expect(harness.tracker.getState().queueDepth).toBe(0)
    expect(harness.tracker.getState().uploadState).toBe('failing')
  })

  it('does nothing when there is nothing to send', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()

    await harness.tracker.flush()
    expect(harness.uploads).toHaveLength(0)
    expect(harness.tracker.getState().uploadState).toBe('idle')
  })
})

describe('backoff', () => {
  it('grows exponentially and is capped', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()
    device.emit(sample({ timestamp: 0 }))

    const delays: number[] = []
    for (let attempt = 0; attempt < 8; attempt += 1) {
      harness.failNext(RETRYABLE)
      const before = attempt === 0 ? 0 : harness.tracker.retryAt
      harness.setClock(before)
      await harness.tracker.flush()
      delays.push(harness.tracker.retryAt - before)
    }

    expect(delays.slice(0, 4)).toEqual([
      BACKOFF_BASE_MS,
      BACKOFF_BASE_MS * 2,
      BACKOFF_BASE_MS * 4,
      BACKOFF_BASE_MS * 8,
    ])
    // Bounded: a backend that is down must not be met with an ever-growing
    // wait, nor with a request every tick.
    expect(Math.max(...delays)).toBe(BACKOFF_MAX_MS)
  })

  it('refuses to send again before the backoff has elapsed', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()
    device.emit(sample({ timestamp: 0 }))

    harness.failNext(RETRYABLE)
    await harness.tracker.flush()

    harness.advance(BACKOFF_BASE_MS - 1)
    await harness.tracker.flush()
    expect(harness.uploads).toHaveLength(0)

    harness.advance(2)
    await harness.tracker.flush()
    expect(harness.uploads).toHaveLength(1)
  })

  it('resets the backoff after a success', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()
    device.emit(sample({ timestamp: 0 }))

    harness.failNext(RETRYABLE, 3)
    for (let n = 0; n < 3; n += 1) {
      harness.setClock(harness.tracker.retryAt)
      await harness.tracker.flush()
    }
    harness.setClock(harness.tracker.retryAt)
    await harness.tracker.flush()
    expect(harness.uploads).toHaveLength(1)
    expect(harness.tracker.retryAt).toBe(0)

    device.emit(sample({ timestamp: 60_000, lat: GUWAHATI.lat + 0.05 }))
    harness.failNext(RETRYABLE)
    // Measured from the CLOCK, not from the previous `retryAt`: the next
    // attempt is an absolute instant, so `retryAt` after a reset is
    // `now + delay`, not `delay`.
    const clock = 500_000
    harness.setClock(clock)
    await harness.tracker.flush()
    expect(harness.tracker.retryAt - clock).toBe(BACKOFF_BASE_MS)
  })
})

describe('teardown', () => {
  it('removes the watch and discards unsent fixes', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()
    device.emit(sample({ timestamp: 0 }))
    expect(harness.tracker.getState().queueDepth).toBe(1)

    harness.tracker.stop()

    expect(device.removed).toHaveBeenCalledTimes(1)
    expect(harness.tracker.getState().isTracking).toBe(false)
    expect(harness.tracker.getState().queueDepth).toBe(0)
    expect(harness.tracker.getState().uploadState).toBe('idle')
  })

  it('ignores fixes that arrive after stopping', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()
    harness.tracker.stop()

    device.emit(sample({ timestamp: 0 }))

    // Collection must not outlive the trip: the server refuses location for a
    // trip that is no longer in progress.
    expect(harness.tracker.getState().queueDepth).toBe(0)
  })

  it('removes a watch that resolves after stop was already called', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)

    const started = harness.tracker.start()
    harness.tracker.stop()
    await started

    expect(harness.tracker.getState().isTracking).toBe(false)
  })
})

describe('honesty about failure', () => {
  it('stops claiming to track when the platform raises mid-trip', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()
    expect(harness.tracker.getState().isTracking).toBe(true)

    // Location switched off, or permission revoked from settings.
    device.raise('Location services were disabled.')

    expect(harness.tracker.getState().isTracking).toBe(false)
    expect(harness.tracker.getState().lastError).toBe(
      'Location services were disabled.',
    )
  })
})

describe('the fix payload', () => {
  it('converts speed to km/h and carries the mock-location flag', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()

    device.emit(sample({ timestamp: 0, speedMs: 10, isMock: true }))
    await harness.tracker.flush()

    const fix = harness.uploads[0][0]
    expect(fix.speed_kmph).toBe('36')
    expect(fix.is_mock_location).toBe(true)
    expect(fix.location).toEqual(GUWAHATI)
    expect(fix.recorded_at).toBe(new Date(0).toISOString())
  })

  it('omits a reading the server would reject rather than losing the fix', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()

    // A GPS blip: 300 km/h, an altitude below the accepted floor, and an
    // unknown heading reported as -1.
    device.emit(
      sample({
        timestamp: 0,
        speedMs: 83.4,
        altitudeM: -2_000,
        headingDeg: -1,
        accuracyM: null,
      }),
    )
    await harness.tracker.flush()

    const fix = harness.uploads[0][0]
    // The position survived, which is the part that matters. One out-of-range
    // decoration must not turn the whole batch into a 422 and cost six real
    // positions.
    expect(fix.location).toEqual(GUWAHATI)
    expect(fix.speed_kmph).toBeUndefined()
    expect(fix.altitude_m).toBeUndefined()
    expect(fix.heading_deg).toBeUndefined()
    expect(fix.accuracy_m).toBeUndefined()
  })

  it('gives every fix a distinct id so a resend is idempotent', async () => {
    const device = makeAdapter()
    const harness = makeTracker(device)
    await harness.tracker.start()

    device.emit(sample({ timestamp: 0 }))
    device.emit(sample({ timestamp: 20_000, lat: GUWAHATI.lat + 0.01 }))
    await harness.tracker.flush()

    const ids = harness.uploads[0].map((f) => f.device_fix_id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('state subscription', () => {
  let device: ReturnType<typeof makeAdapter>

  beforeEach(() => {
    device = makeAdapter()
  })

  it('stops notifying after unsubscribe', async () => {
    const harness = makeTracker(device)
    const seen: number[] = []
    const unsubscribe = harness.tracker.subscribe((s) =>
      seen.push(s.queueDepth),
    )

    await harness.tracker.start()
    device.emit(sample({ timestamp: 0 }))
    const countBefore = seen.length
    expect(countBefore).toBeGreaterThan(0)

    unsubscribe()
    device.emit(sample({ timestamp: 20_000, lat: GUWAHATI.lat + 0.01 }))

    expect(seen).toHaveLength(countBefore)
  })
})
