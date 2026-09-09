/**
 * Store-and-forward: does the queue survive the app dying, and what happens
 * when the disk does not cooperate.
 *
 * The tests worth reading are the failure ones. A queue that works when
 * everything works is not the feature; the feature is a truck on NH-715 whose
 * phone was killed by the OS at 14:00 still delivering its 13:00 positions when
 * signal comes back at 16:00 - and, when the disk is full instead, still being
 * tracked rather than crashing.
 *
 * NOT PROVEN HERE: actual Android or iOS process death. These exercise the
 * tracker's own persistence logic against an injected store. No claim is made
 * about physical device behaviour without hardware.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  MemoryQueueStore,
  PersistentQueueStore,
  QUEUE_STORAGE_KEY,
  type KeyValueStore,
  type QueueStore,
} from './queueStore'
import { LocationTracker, type GpsFix, type TrackerConfig } from './tracker'
import type { LocationAdapter, Sample } from './adapter'

const CONFIG: TrackerConfig = {
  movingIntervalSeconds: 0,
  stationaryIntervalSeconds: 0,
  stationaryDistanceM: 0,
  batchSize: 10,
  queueLimit: 5,
}

class FakeKv implements KeyValueStore {
  store = new Map<string, string>()
  failOn: 'none' | 'get' | 'set' | 'remove' = 'none'

  async getItem(key: string): Promise<string | null> {
    if (this.failOn === 'get') throw new Error('disk unreadable')
    return this.store.get(key) ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failOn === 'set') throw new Error('disk full')
    this.store.set(key, value)
  }

  async removeItem(key: string): Promise<void> {
    if (this.failOn === 'remove') throw new Error('disk unreadable')
    this.store.delete(key)
  }
}

const adapter: LocationAdapter = {
  hasServicesEnabled: async () => true,
  requestPermission: async () => 'granted',
  watch: async () => ({ remove: () => {} }),
}

function sample(at: number, lat = 26.14, lon = 91.73): Sample {
  return {
    lat,
    lon,
    timestamp: at,
    altitudeM: null,
    speedMs: null,
    headingDeg: null,
    accuracyM: 5,
    isMock: false,
  }
}

/**
 * A started tracker. `start()` matters: `onSample` is a no-op while the
 * tracker is stopped, which is the correct guard and would otherwise make
 * every test here silently exercise nothing.
 */
async function makeTracker(
  store: QueueStore | undefined,
  upload = vi.fn(async (_fixes: GpsFix[]) => {}),
) {
  let seq = 0
  const tracker = new LocationTracker(
    {
      adapter,
      upload,
      classify: () => ({ retryable: true, message: 'offline' }),
      now: () => 1_000,
      newId: () => `fix-${++seq}`,
      queueStore: store,
    },
    CONFIG,
  )
  await tracker.start()
  return { tracker, upload }
}

/** Let the tracker's chained write settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('PersistentQueueStore', () => {
  const fix = (id: string): GpsFix => ({
    device_fix_id: id,
    location: { lat: 26.14, lon: 91.73 },
    recorded_at: '2026-09-01T10:00:00Z',
  })

  it('round-trips a queue', async () => {
    const kv = new FakeKv()
    const store = new PersistentQueueStore(kv)
    await store.save([fix('a'), fix('b')])

    expect((await store.load()).map((f) => f.device_fix_id)).toEqual(['a', 'b'])
  })

  it('returns an empty queue rather than throwing on truncated JSON', async () => {
    // A write interrupted by the OS. The next launch must not be a crash loop
    // on a driver's phone at the start of a shift.
    const kv = new FakeKv()
    kv.store.set(QUEUE_STORAGE_KEY, '{"v":1,"fixes":[{"device_fix_id":"a"')

    expect(await new PersistentQueueStore(kv).load()).toEqual([])
  })

  it('discards entries that parse but are not fixes', async () => {
    // Half-written content can be valid JSON and still be unusable. An entry
    // with no device_fix_id would be uploaded and rejected forever.
    const kv = new FakeKv()
    kv.store.set(
      QUEUE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        fixes: [fix('good'), { device_fix_id: '' }, { nonsense: true }, null],
      }),
    )

    expect((await new PersistentQueueStore(kv).load()).map((f) => f.device_fix_id))
      .toEqual(['good'])
  })

  it('ignores a payload written by a different version', async () => {
    const kv = new FakeKv()
    kv.store.set(QUEUE_STORAGE_KEY, JSON.stringify({ v: 99, fixes: [fix('a')] }))

    expect(await new PersistentQueueStore(kv).load()).toEqual([])
  })
})

describe('the queue survives a restart', () => {
  it('replays what a previous run never sent', async () => {
    const store = new MemoryQueueStore()

    const first = await makeTracker(store)
    first.tracker.onSample(sample(1))
    first.tracker.onSample(sample(2, 27.0, 92.0))
    await settle()

    // The OS kills the app. A brand-new tracker over the same store.
    const second = await makeTracker(store)
    await second.tracker.hydrate()

    expect(second.tracker.getState().queueDepth).toBe(2)

    await second.tracker.flush()
    expect(second.upload).toHaveBeenCalledTimes(1)
    expect(
      second.upload.mock.calls[0][0].map((f: GpsFix) => f.device_fix_id),
    ).toEqual(['fix-1', 'fix-2'])
  })

  it('replays oldest first', async () => {
    const store = new MemoryQueueStore()
    const first = await makeTracker(store)
    first.tracker.onSample(sample(1))
    first.tracker.onSample(sample(2, 27.0, 92.0))
    first.tracker.onSample(sample(3, 28.0, 93.0))
    await settle()

    const second = await makeTracker(store)
    await second.tracker.hydrate()
    await second.tracker.flush()

    const sent = second.upload.mock.calls[0][0].map((f: GpsFix) => f.device_fix_id)
    expect(sent).toEqual([...sent].sort())
  })

  it('puts restored fixes in front of ones collected since', async () => {
    const store = new MemoryQueueStore()
    await store.save([
      {
        device_fix_id: 'old',
        location: { lat: 26.1, lon: 91.7 },
        recorded_at: '2026-09-01T09:00:00Z',
      },
    ])

    const { tracker, upload } = await makeTracker(store)
    tracker.onSample(sample(1))
    await tracker.hydrate()
    await tracker.flush()

    expect(upload.mock.calls[0][0].map((f: GpsFix) => f.device_fix_id)).toEqual([
      'old',
      'fix-1',
    ])
  })

  it('does not reintroduce a fix already in memory', async () => {
    const store = new MemoryQueueStore()
    const { tracker } = await makeTracker(store)
    tracker.onSample(sample(1))
    await settle()

    // Hydrating twice, or hydrating after collection, must not double up.
    await tracker.hydrate()
    await tracker.hydrate()

    expect(tracker.getState().queueDepth).toBe(1)
  })

  it('applies the bound to a restored queue too', async () => {
    // A store written by a build with a larger limit must not be able to
    // reintroduce an unbounded queue.
    const store = new MemoryQueueStore()
    await store.save(
      Array.from({ length: 12 }, (_, i) => ({
        device_fix_id: `old-${i}`,
        location: { lat: 26.1, lon: 91.7 },
        recorded_at: '2026-09-01T09:00:00Z',
      })),
    )

    const { tracker } = await makeTracker(store)
    await tracker.hydrate()

    expect(tracker.getState().queueDepth).toBe(CONFIG.queueLimit)
  })

  it('does not resend what the server already accepted', async () => {
    const store = new MemoryQueueStore()
    const { tracker } = await makeTracker(store)
    tracker.onSample(sample(1))
    await tracker.flush()
    await settle()

    const next = await makeTracker(store)
    await next.tracker.hydrate()

    expect(next.tracker.getState().queueDepth).toBe(0)
  })

  it('keeps a batch the server never acknowledged', async () => {
    const store = new MemoryQueueStore()
    const failing = vi.fn(async () => {
      throw new Error('no signal')
    })
    const { tracker } = await makeTracker(store, failing)
    tracker.onSample(sample(1))
    await tracker.flush()
    await settle()

    const next = await makeTracker(store)
    await next.tracker.hydrate()

    expect(next.tracker.getState().queueDepth).toBe(1)
  })

  it('forgets the queue when the trip ends', async () => {
    // The server refuses location for a trip that is not in progress, so a
    // persisted queue would come back and retry forever against an endpoint
    // that will never accept it.
    const store = new MemoryQueueStore()
    const { tracker } = await makeTracker(store)
    tracker.onSample(sample(1))
    await settle()
    tracker.stop()
    await settle()

    expect(await store.load()).toEqual([])
  })
})

describe('a failing disk degrades, it does not stop tracking', () => {
  it('keeps collecting and uploading when writes fail', async () => {
    const kv = new FakeKv()
    kv.failOn = 'set'
    const { tracker, upload } = await makeTracker(new PersistentQueueStore(kv))

    tracker.onSample(sample(1))
    await settle()

    expect(tracker.getState().queueDepth).toBe(1)
    expect(tracker.getState().persistence).toBe('degraded')

    await tracker.flush()
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('says degraded rather than claiming the queue is durable', async () => {
    const kv = new FakeKv()
    kv.failOn = 'set'
    const { tracker } = await makeTracker(new PersistentQueueStore(kv))

    expect(tracker.getState().persistence).toBe('durable')
    tracker.onSample(sample(1))
    await settle()
    expect(tracker.getState().persistence).toBe('degraded')
  })

  it('recovers to durable once writes succeed again', async () => {
    const kv = new FakeKv()
    kv.failOn = 'set'
    const { tracker } = await makeTracker(new PersistentQueueStore(kv))

    tracker.onSample(sample(1))
    await settle()
    expect(tracker.getState().persistence).toBe('degraded')

    kv.failOn = 'none'
    tracker.onSample(sample(2, 27.0, 92.0))
    await settle()
    expect(tracker.getState().persistence).toBe('durable')
  })

  it('survives an unreadable store on hydrate', async () => {
    const kv = new FakeKv()
    kv.failOn = 'get'
    const { tracker } = await makeTracker(new PersistentQueueStore(kv))

    await expect(tracker.hydrate()).resolves.toBeUndefined()
    expect(tracker.getState().persistence).toBe('degraded')
    expect(tracker.getState().queueDepth).toBe(0)
  })
})

describe('without a store', () => {
  it('reports memory and still works', async () => {
    const { tracker, upload } = await makeTracker(undefined)

    expect(tracker.getState().persistence).toBe('memory')
    tracker.onSample(sample(1))
    await tracker.hydrate() // a no-op, and must not throw
    await tracker.flush()

    expect(upload).toHaveBeenCalledTimes(1)
  })
})
