/**
 * The event queue under the conditions it exists for.
 *
 * The tests that matter are the ones about loss. A queue that delivers when
 * the network is up is not the feature; the feature is a driver pressing SOS
 * in a dead zone on NH-715 and that press still reaching a dispatcher two
 * hours later - having survived a full queue, a killed process, a disk that
 * would not write, and an acknowledgement that never came back.
 *
 * NOT PROVEN HERE: actual Android process death. These exercise the queue's
 * own persistence against an injected store. No claim is made about physical
 * device behaviour without hardware.
 */

import { describe, expect, it, vi } from 'vitest'

import type { KeyValueStore } from '../tracking/queueStore'
import {
  EVENT_QUEUE_STORAGE_KEY,
  EventQueue,
  MemoryEventStore,
  PersistentEventStore,
  PRIORITY_OF,
  trimToLimit,
  type DeviceEvent,
  type EventBatchAccepted,
  type EventQueueDeps,
  type QueuedEvent,
} from './eventQueue'

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

function accepted(events: DeviceEvent[]): EventBatchAccepted {
  return {
    trip_id: 'trip-1',
    accepted: events.length,
    duplicates_ignored: 0,
    rejected: 0,
    settled_event_ids: events.map((e) => e.device_event_id),
    server_time: new Date(0).toISOString(),
  }
}

function build(overrides: Partial<EventQueueDeps> = {}, limit = 5, batch = 50) {
  let id = 0
  let clock = 1_000
  const sent: DeviceEvent[][] = []
  const deps: EventQueueDeps = {
    send: async (events) => {
      sent.push(events)
      return accepted(events)
    },
    classify: (error) => ({
      retryable: true,
      message: error instanceof Error ? error.message : 'unreachable',
    }),
    now: () => clock,
    newId: () => `e${++id}`,
    ...overrides,
  }
  const queue = new EventQueue(deps, limit, batch)
  return {
    queue,
    sent,
    advance: (ms: number) => {
      clock += ms
    },
    setClock: (value: number) => {
      clock = value
    },
    now: () => clock,
  }
}

function queued(kind: DeviceEvent['kind'], id: string): QueuedEvent {
  return {
    event: {
      device_event_id: id,
      kind,
      recorded_at: new Date(0).toISOString(),
    },
    attempts: 0,
  }
}

describe('priority table', () => {
  it('names an SOS critical and the outage narrative advisory', () => {
    expect(PRIORITY_OF.SOS_TRIGGERED).toBe('CRITICAL')
    expect(PRIORITY_OF.ROUTE_DEVIATION).toBe('WARNING')
    expect(PRIORITY_OF.ALERT_ACKNOWLEDGED).toBe('WARNING')
    expect(PRIORITY_OF.COMMS_LOST).toBe('ADVISORY')
    expect(PRIORITY_OF.COMMS_RESTORED).toBe('ADVISORY')
  })
})

describe('trimToLimit', () => {
  it('leaves a queue within its bound alone', () => {
    const events = [queued('COMMS_LOST', 'a'), queued('SOS_TRIGGERED', 'b')]
    expect(trimToLimit(events, 5).dropped).toEqual([])
  })

  it('drops the oldest event of the lowest priority present', () => {
    const events = [
      queued('COMMS_LOST', 'advisory-old'),
      queued('ROUTE_DEVIATION', 'warning'),
      queued('COMMS_RESTORED', 'advisory-new'),
    ]
    const { kept, dropped } = trimToLimit(events, 2)
    expect(dropped.map((q) => q.event.device_event_id)).toEqual(['advisory-old'])
    expect(kept.map((q) => q.event.device_event_id)).toEqual(['warning', 'advisory-new'])
  })

  it('never lets chatter push out a call for help', () => {
    const events = [
      queued('SOS_TRIGGERED', 'sos'),
      queued('COMMS_LOST', 'a'),
      queued('COMMS_RESTORED', 'b'),
      queued('ROUTE_DEVIATION', 'c'),
    ]
    const { kept } = trimToLimit(events, 1)
    expect(kept.map((q) => q.event.device_event_id)).toEqual(['sos'])
  })

  it('still honours the bound when everything is critical', () => {
    const events = [
      queued('SOS_TRIGGERED', 'first'),
      queued('SOS_TRIGGERED', 'second'),
    ]
    const { kept, dropped } = trimToLimit(events, 1)
    expect(kept.map((q) => q.event.device_event_id)).toEqual(['second'])
    expect(dropped.map((q) => q.event.device_event_id)).toEqual(['first'])
  })
})

describe('enqueue', () => {
  it('records an event without touching the network', async () => {
    const { queue, sent } = build()
    const event = queue.enqueue('SOS_TRIGGERED', {
      location: { lat: 26.1445, lon: 91.7362 },
      accuracyM: 12.345,
    })
    expect(sent).toEqual([])
    expect(queue.getSummary().queued).toBe(1)
    expect(event.kind).toBe('SOS_TRIGGERED')
    expect(event.location).toEqual({ lat: 26.1445, lon: 91.7362 })
    expect(event.accuracy_m).toBe('12.35')
    expect(event.sequence).toBe(1)
  })

  it('reports no accuracy rather than a made-up one', () => {
    const { queue } = build()
    expect(queue.enqueue('COMMS_LOST').accuracy_m).toBeNull()
    expect(queue.enqueue('COMMS_LOST', { accuracyM: null }).accuracy_m).toBeNull()
  })

  it('issues rising sequence numbers so one second can be ordered', () => {
    const { queue } = build()
    const a = queue.enqueue('COMMS_LOST')
    const b = queue.enqueue('COMMS_RESTORED')
    expect(b.sequence).toBeGreaterThan(a.sequence!)
  })

  it('counts what overflow dropped, and says when a critical one went', () => {
    const { queue } = build({}, 2)
    queue.enqueue('COMMS_LOST')
    queue.enqueue('COMMS_RESTORED')
    queue.enqueue('SOS_TRIGGERED')
    expect(queue.getSummary().queued).toBe(2)
    expect(queue.getSummary().dropped).toBe(1)
    expect(queue.getSummary().droppedCritical).toBe(0)
    expect(queue.depthByPriority()).toEqual({ CRITICAL: 1, WARNING: 0, ADVISORY: 1 })
  })

  it('answers whether a kind is already waiting, so repeats can be suppressed', () => {
    const { queue } = build()
    expect(queue.hasPending('COMMS_LOST')).toBe(false)
    queue.enqueue('COMMS_LOST')
    expect(queue.hasPending('COMMS_LOST')).toBe(true)
    expect(queue.hasPending('COMMS_RESTORED')).toBe(false)
  })
})

describe('flush', () => {
  it('sends what is queued and removes exactly what the server settled', async () => {
    const { queue, sent } = build()
    queue.enqueue('ROUTE_DEVIATION')
    queue.enqueue('COMMS_LOST')
    await queue.flush()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(2)
    expect(queue.getSummary().queued).toBe(0)
    expect(queue.getSummary().accepted).toBe(2)
    expect(queue.getSummary().lastSyncAt).not.toBeNull()
  })

  it('keeps an event the server did not mention', async () => {
    const { queue } = build({
      send: async (events) => ({
        trip_id: 'trip-1',
        accepted: 1,
        duplicates_ignored: 0,
        rejected: 0,
        // The second event's fate is unknown.
        settled_event_ids: [events[0].device_event_id],
        server_time: new Date(0).toISOString(),
      }),
    })
    queue.enqueue('COMMS_LOST')
    queue.enqueue('COMMS_RESTORED')
    await queue.flush()
    expect(queue.getSummary().queued).toBe(1)
  })

  it('counts duplicates as the proof that replay is idempotent', async () => {
    const { queue } = build({
      send: async (events) => ({
        trip_id: 'trip-1',
        accepted: 0,
        duplicates_ignored: events.length,
        rejected: 0,
        settled_event_ids: events.map((e) => e.device_event_id),
        server_time: new Date(0).toISOString(),
      }),
    })
    queue.enqueue('SOS_TRIGGERED')
    await queue.flush()
    expect(queue.getSummary().duplicatesIgnored).toBe(1)
    expect(queue.getSummary().accepted).toBe(0)
    expect(queue.getSummary().queued).toBe(0)
  })

  it('sends the SOS first when a backlog is waiting behind it', async () => {
    const { queue, sent } = build({}, 50, 2)
    queue.enqueue('COMMS_LOST')
    queue.enqueue('COMMS_RESTORED')
    queue.enqueue('ROUTE_DEVIATION')
    queue.enqueue('SOS_TRIGGERED')
    await queue.flush()
    expect(sent[0][0].kind).toBe('SOS_TRIGGERED')
  })

  it('does nothing when there is nothing to send', async () => {
    const { queue, sent } = build()
    await queue.flush()
    expect(sent).toEqual([])
  })

  it('keeps events and backs off when the network is gone', async () => {
    const { queue, advance, now } = build({
      send: async () => {
        throw new Error('Network request failed')
      },
    })
    queue.enqueue('SOS_TRIGGERED')

    await queue.flush()
    expect(queue.getSummary().queued).toBe(1)
    expect(queue.getSummary().lastError).toBe('Network request failed')
    const firstRetry = queue.retryAt
    expect(firstRetry).toBeGreaterThan(now())

    // Still backing off: no second attempt.
    await queue.flush()
    expect(queue.retryAt).toBe(firstRetry)

    advance(60_000)
    await queue.flush()
    expect(queue.retryAt).toBeGreaterThan(firstRetry)
    // Still queued through every failure. Nothing is lost to a dead network.
    expect(queue.getSummary().queued).toBe(1)
  })

  it('drops a batch the server will never accept', async () => {
    const { queue } = build({
      send: async () => {
        throw new Error('TRIP_NOT_IN_PROGRESS')
      },
      classify: () => ({ retryable: false, message: 'trip is over' }),
    })
    queue.enqueue('COMMS_LOST')
    await queue.flush()
    expect(queue.getSummary().queued).toBe(0)
    expect(queue.getSummary().rejected).toBe(1)
  })

  it('resumes after the network returns', async () => {
    let fail = true
    const { queue, advance } = build({
      send: async (events) => {
        if (fail) throw new Error('offline')
        return accepted(events)
      },
    })
    queue.enqueue('SOS_TRIGGERED')
    await queue.flush()
    expect(queue.getSummary().queued).toBe(1)

    fail = false
    advance(60_000)
    await queue.flush()
    expect(queue.getSummary().queued).toBe(0)
    expect(queue.getSummary().accepted).toBe(1)
  })
})

describe('durability', () => {
  it('survives the process being killed mid-trip', async () => {
    const kv = new FakeKv()
    const first = build({ store: new PersistentEventStore(kv) })
    first.queue.enqueue('SOS_TRIGGERED', { payload: { reason: 'BREAKDOWN' } })
    first.queue.enqueue('COMMS_LOST')
    // Let the chained write settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The OS kills the app. A new process starts with the same storage.
    const second = build({ store: new PersistentEventStore(kv) })
    await second.queue.hydrate()
    expect(second.queue.getSummary().queued).toBe(2)
    expect(second.queue.getSummary().persistence).toBe('durable')

    await second.queue.flush()
    expect(second.sent[0].map((e) => e.kind)).toContain('SOS_TRIGGERED')
  })

  it('keeps collecting when the disk will not write, and says so', async () => {
    const kv = new FakeKv()
    kv.failOn = 'set'
    const { queue } = build({ store: new PersistentEventStore(kv) })
    queue.enqueue('SOS_TRIGGERED')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(queue.getSummary().queued).toBe(1)
    expect(queue.getSummary().persistence).toBe('degraded')
  })

  it('treats a truncated file as an empty queue rather than crashing', async () => {
    const kv = new FakeKv()
    kv.store.set(EVENT_QUEUE_STORAGE_KEY, '{"v":1,"events":[{"event":{"devi')
    const store = new PersistentEventStore(kv)
    await expect(store.load()).resolves.toEqual([])
  })

  it('discards entries that are not events', async () => {
    const kv = new FakeKv()
    kv.store.set(
      EVENT_QUEUE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        events: [
          { event: { device_event_id: 'ok', kind: 'SOS_TRIGGERED', recorded_at: 'x' }, attempts: 0 },
          { event: { kind: 'SOS_TRIGGERED' }, attempts: 0 },
          { event: { device_event_id: 'bad-kind', kind: 'DISPATCHED', recorded_at: 'x' }, attempts: 0 },
          null,
        ],
      }),
    )
    const store = new PersistentEventStore(kv)
    const loaded = await store.load()
    expect(loaded.map((q) => q.event.device_event_id)).toEqual(['ok'])
  })

  it('ignores a payload from a different version', async () => {
    const kv = new FakeKv()
    kv.store.set(EVENT_QUEUE_STORAGE_KEY, JSON.stringify({ v: 2, events: [] }))
    await expect(new PersistentEventStore(kv).load()).resolves.toEqual([])
  })

  it('applies the bound to a queue restored from an older, larger build', async () => {
    const kv = new FakeKv()
    await new PersistentEventStore(kv).save([
      queued('COMMS_LOST', 'a'),
      queued('COMMS_RESTORED', 'b'),
      queued('SOS_TRIGGERED', 'c'),
    ])
    const { queue } = build({ store: new PersistentEventStore(kv) }, 2)
    await queue.hydrate()
    expect(queue.getSummary().queued).toBe(2)
    expect(queue.getSummary().dropped).toBe(1)
  })

  it('reports memory persistence honestly when no store is supplied', () => {
    const { queue } = build()
    expect(queue.getSummary().persistence).toBe('memory')
  })

  it('clears the queue when the trip ends', async () => {
    const kv = new FakeKv()
    const { queue } = build({ store: new PersistentEventStore(kv) })
    queue.enqueue('COMMS_LOST')
    queue.reset()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queue.getSummary().queued).toBe(0)
    expect(await new PersistentEventStore(kv).load()).toEqual([])
  })

  it('keeps working with the in-memory store', async () => {
    const store = new MemoryEventStore()
    await store.save([queued('COMMS_LOST', 'a')])
    expect(await store.load()).toHaveLength(1)
    await store.clear()
    expect(await store.load()).toEqual([])
  })
})

describe('diagnostics', () => {
  it('publishes a summary the demo can read aloud', async () => {
    const seen: number[] = []
    const { queue } = build()
    const stop = queue.subscribe((summary) => seen.push(summary.queued))
    queue.enqueue('COMMS_LOST')
    queue.enqueue('ROUTE_DEVIATION')
    await queue.flush()
    stop()

    const summary = queue.getSummary()
    expect(summary.queued).toBe(0)
    expect(summary.accepted).toBe(2)
    expect(summary.duplicatesIgnored).toBe(0)
    expect(summary.rejected).toBe(0)
    expect(seen).toContain(2)
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    const { queue } = build()
    queue.subscribe(listener)()
    queue.enqueue('COMMS_LOST')
    expect(listener).not.toHaveBeenCalled()
  })
})
