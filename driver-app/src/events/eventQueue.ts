/**
 * The bounded durable queue for what the phone SAW, as opposed to where it was.
 *
 * `src/tracking/tracker.ts` already carries positions through an outage. This
 * carries the other half: the truck left the corridor, the driver acknowledged
 * a warning, the driver pressed for help, the connection went and came back.
 * Those were direct API calls, which on a hill road means they were lost - an
 * SOS pressed in a dead zone threw an exception into a catch block and was
 * never mentioned again.
 *
 * DELIBERATELY THE SAME SHAPE AS THE GPS QUEUE
 *
 * Same `KeyValueStore` seam, same versioned envelope, same tolerance for a
 * truncated write, same "the engine has no React, no Expo and no timers of its
 * own" rule. Two queues with two ideas of what a corrupt file means is how a
 * phone comes to hold positions it can read and events it cannot. What differs
 * is what the two carry and therefore what may be thrown away.
 *
 * PRIORITY EXISTS BECAUSE THE BOUND IS REAL
 *
 * The GPS queue drops its oldest fixes on overflow, which is right: the newest
 * position is the one a dispatcher needs and an old one is of little use. That
 * reasoning does not survive contact with an SOS. An hour of connectivity
 * notes must never push a driver's call for help off the end of the queue, so
 * overflow drops the OLDEST event of the LOWEST priority present:
 *
 *   CRITICAL   SOS_TRIGGERED                  a person asking for help
 *   WARNING    ROUTE_DEVIATION,               things the manager must be able
 *              ALERT_ACKNOWLEDGED             to audit afterwards
 *   ADVISORY   COMMS_LOST, COMMS_RESTORED     the outage narrative
 *
 * A queue that is entirely CRITICAL and full still drops its oldest critical
 * event, because the bound is not negotiable - an unbounded queue on a phone
 * that is offline for a day ends with the OS killing the app mid-trip. That
 * case is counted separately (`droppedCritical`) so a screen can say it
 * happened rather than let it pass silently.
 *
 * SETTLEMENT IS THE SERVER'S WORD, NOT AN ASSUMPTION
 *
 * A flush removes exactly the ids the server returned in `settled_event_ids`:
 * stored, already stored, or refused for good. An event whose fate is unknown
 * - the request died mid-flight - is in no list, stays queued and is sent
 * again. Re-sending is cheap because the server deduplicates on
 * `device_event_id`; losing an SOS to an ambiguous response is not.
 */

import type { KeyValueStore } from '../tracking/queueStore'

/** Kinds a device may originate. Mirrors DEVICE_ORIGINATED_EVENT_KINDS. */
export type DeviceEventKind =
  | 'ROUTE_DEVIATION'
  | 'ALERT_ACKNOWLEDGED'
  | 'SOS_TRIGGERED'
  | 'COMMS_LOST'
  | 'COMMS_RESTORED'

export type EventPriority = 'CRITICAL' | 'WARNING' | 'ADVISORY'

/**
 * Alert severity as the mission defines it, and the queue's retention order.
 *
 * CRITICAL means act now, WARNING means attention required, ADVISORY is
 * informational. The same three words the driver UI uses for a danger card, so
 * "which alerts must the driver acknowledge" and "which events must survive a
 * full queue" are answered from one table rather than two.
 */
export const PRIORITY_OF: Record<DeviceEventKind, EventPriority> = {
  SOS_TRIGGERED: 'CRITICAL',
  ROUTE_DEVIATION: 'WARNING',
  ALERT_ACKNOWLEDGED: 'WARNING',
  COMMS_LOST: 'ADVISORY',
  COMMS_RESTORED: 'ADVISORY',
}

const PRIORITY_RANK: Record<EventPriority, number> = {
  ADVISORY: 0,
  WARNING: 1,
  CRITICAL: 2,
}

/** The wire shape. Matches DeviceEventIn on the backend exactly. */
export interface DeviceEvent {
  device_event_id: string
  kind: DeviceEventKind
  /** Device clock, ISO 8601. Recorded server-side, never used for ordering. */
  recorded_at: string
  /** Monotonic per-trip counter. Breaks ties inside one second. */
  sequence?: number
  location?: { lat: number; lon: number } | null
  accuracy_m?: string | null
  payload?: Record<string, string | number | boolean | null> | null
}

export interface QueuedEvent {
  event: DeviceEvent
  /** Flush attempts this event has survived. Diagnostics, not a drop rule. */
  attempts: number
}

/** What the server said about a flush. Matches DeviceEventBatchAccepted. */
export interface EventBatchAccepted {
  trip_id: string
  accepted: number
  duplicates_ignored: number
  rejected: number
  rejected_reasons?: Record<string, number>
  settled_event_ids: string[]
  server_time: string
}

/**
 * Lifetime totals for the sync diagnostic, plus the live queue depth.
 *
 * The mission asks for this in as many words: prove how many events were
 * queued offline and later accepted. Counters are cumulative for the trip, so
 * "73 queued, 73 accepted, 0 duplicated" survives the moment it describes.
 */
export interface SyncSummary {
  queued: number
  /** Events this device has had accepted as new. */
  accepted: number
  /** Events the server already had - the proof that replay is idempotent. */
  duplicatesIgnored: number
  /** Events the server refused for good. They are not retried. */
  rejected: number
  /** Dropped to keep the queue bounded, by priority. */
  dropped: number
  droppedCritical: number
  /** Device clock at the last flush the server answered. */
  lastSyncAt: number | null
  lastError: string | null
  /** Whether the queue survives the app being killed. */
  persistence: 'memory' | 'durable' | 'degraded'
}

export const EVENT_QUEUE_STORAGE_KEY = 'ner.trip.events.v1'

/**
 * Most events the queue may hold.
 *
 * Smaller than the GPS queue's 500 because events are episodic rather than
 * periodic: a shift produces a handful, not one every ten seconds. A phone
 * that has somehow produced 200 of them is in a loop, and the bound is what
 * stops that loop filling the disk.
 */
export const EVENT_QUEUE_LIMIT = 200

/** Events per request. Matches the server's batch bound. */
export const EVENT_BATCH_SIZE = 50

export const BACKOFF_BASE_MS = 2_000
export const BACKOFF_MAX_MS = 60_000

interface Envelope {
  v: 1
  events: QueuedEvent[]
}

export interface EventQueueStore {
  load(): Promise<QueuedEvent[]>
  save(events: QueuedEvent[]): Promise<void>
  clear(): Promise<void>
}

/** In-process only. Honest default when no durable store is supplied. */
export class MemoryEventStore implements EventQueueStore {
  private events: QueuedEvent[] = []
  async load(): Promise<QueuedEvent[]> {
    return [...this.events]
  }
  async save(events: QueuedEvent[]): Promise<void> {
    this.events = [...events]
  }
  async clear(): Promise<void> {
    this.events = []
  }
}

/**
 * A durable queue over any key-value store.
 *
 * Corruption is expected, not exceptional: a write interrupted by the OS
 * leaves truncated JSON, and the next launch must not be a crash loop at the
 * start of a shift. Anything unparseable is discarded and treated as empty -
 * the same trade the GPS queue makes, and the same one that must be stated
 * plainly rather than discovered.
 */
export class PersistentEventStore implements EventQueueStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly key: string = EVENT_QUEUE_STORAGE_KEY,
  ) {}

  async load(): Promise<QueuedEvent[]> {
    const raw = await this.kv.getItem(this.key)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as Envelope
      if (parsed?.v !== 1 || !Array.isArray(parsed.events)) return []
      return parsed.events.filter(isQueued)
    } catch {
      return []
    }
  }

  async save(events: QueuedEvent[]): Promise<void> {
    const envelope: Envelope = { v: 1, events }
    await this.kv.setItem(this.key, JSON.stringify(envelope))
  }

  async clear(): Promise<void> {
    await this.kv.removeItem(this.key)
  }
}

function isQueued(value: unknown): value is QueuedEvent {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<QueuedEvent>
  const event = entry.event as Partial<DeviceEvent> | undefined
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof event.device_event_id === 'string' &&
    event.device_event_id.length > 0 &&
    typeof event.recorded_at === 'string' &&
    typeof event.kind === 'string' &&
    event.kind in PRIORITY_OF
  )
}

/**
 * Trim a queue to `limit`, dropping the oldest event of the lowest priority.
 *
 * Pure and exported because it is the rule worth testing on its own: given a
 * full queue and an arriving SOS, which event leaves. Order within a priority
 * is queue order, so "oldest of the lowest priority present" is deterministic
 * with no clock involved.
 */
export function trimToLimit(
  events: QueuedEvent[],
  limit: number,
): { kept: QueuedEvent[]; dropped: QueuedEvent[] } {
  if (events.length <= limit) return { kept: events, dropped: [] }

  const kept = [...events]
  const dropped: QueuedEvent[] = []
  while (kept.length > limit) {
    let victim = 0
    for (let i = 1; i < kept.length; i += 1) {
      const rank = PRIORITY_RANK[PRIORITY_OF[kept[i].event.kind]]
      const best = PRIORITY_RANK[PRIORITY_OF[kept[victim].event.kind]]
      // Strictly lower priority wins; ties keep the earlier index, which is
      // the older event.
      if (rank < best) victim = i
    }
    dropped.push(kept[victim])
    kept.splice(victim, 1)
  }
  return { kept, dropped }
}

export interface EventQueueDeps {
  /** Sends one batch. Rejects with an error the classifier understands. */
  send: (events: DeviceEvent[]) => Promise<EventBatchAccepted>
  /** True when retrying could plausibly succeed. */
  classify: (error: unknown) => { retryable: boolean; message: string }
  now: () => number
  newId: () => string
  store?: EventQueueStore
}

/**
 * The engine. No React, no Expo, no timers - the binding supplies the tick.
 */
export class EventQueue {
  private queue: QueuedEvent[] = []
  private flushing = false
  private failures = 0
  private nextAttemptAt = 0
  private sequence = 0
  private listeners = new Set<(summary: SyncSummary) => void>()
  private writing: Promise<void> = Promise.resolve()
  private readonly store: EventQueueStore
  private readonly durable: boolean

  private summary: SyncSummary = {
    queued: 0,
    accepted: 0,
    duplicatesIgnored: 0,
    rejected: 0,
    dropped: 0,
    droppedCritical: 0,
    lastSyncAt: null,
    lastError: null,
    persistence: 'memory',
  }

  constructor(
    private readonly deps: EventQueueDeps,
    private readonly limit: number = EVENT_QUEUE_LIMIT,
    private readonly batchSize: number = EVENT_BATCH_SIZE,
  ) {
    this.durable = deps.store !== undefined
    this.store = deps.store ?? new MemoryEventStore()
    this.summary = { ...this.summary, persistence: this.durable ? 'durable' : 'memory' }
  }

  getSummary(): SyncSummary {
    return this.summary
  }

  subscribe(listener: (summary: SyncSummary) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(patch: Partial<SyncSummary>): void {
    this.summary = { ...this.summary, ...patch }
    for (const listener of this.listeners) listener(this.summary)
  }

  private persist(): void {
    if (!this.durable) return
    const snapshot = [...this.queue]
    this.writing = this.writing
      .then(() => this.store.save(snapshot))
      .then(() => {
        if (this.summary.persistence === 'degraded') this.emit({ persistence: 'durable' })
      })
      .catch(() => {
        if (this.summary.persistence !== 'degraded') this.emit({ persistence: 'degraded' })
      })
  }

  /** Reload anything a previous run left unsent. Safe: replay is idempotent. */
  async hydrate(): Promise<void> {
    if (!this.durable) return
    let restored: QueuedEvent[] = []
    try {
      restored = await this.store.load()
    } catch {
      this.emit({ persistence: 'degraded' })
      return
    }
    if (restored.length === 0) return
    const known = new Set(this.queue.map((q) => q.event.device_event_id))
    const merged = [
      ...restored.filter((q) => !known.has(q.event.device_event_id)),
      ...this.queue,
    ]
    // The bound applies to a restored queue exactly as to a live one: a store
    // written by an older build with a larger limit must not reintroduce an
    // unbounded queue.
    const { kept, dropped } = trimToLimit(merged, this.limit)
    this.queue = kept
    this.countDropped(dropped)
    // Keep issuing sequence numbers above anything restored, so ordering
    // within a second survives a restart.
    this.sequence = merged.reduce(
      (highest, q) => Math.max(highest, q.event.sequence ?? 0),
      this.sequence,
    )
    this.emit({ queued: this.queue.length })
  }

  private countDropped(dropped: QueuedEvent[]): void {
    if (dropped.length === 0) return
    const critical = dropped.filter(
      (q) => PRIORITY_OF[q.event.kind] === 'CRITICAL',
    ).length
    this.emit({
      dropped: this.summary.dropped + dropped.length,
      droppedCritical: this.summary.droppedCritical + critical,
    })
  }

  /**
   * Record something that happened. Returns the event as queued.
   *
   * Never throws and never awaits the network: a driver pressing SOS in a dead
   * zone must reach the queue in the same tick as the button press.
   */
  enqueue(
    kind: DeviceEventKind,
    options: {
      at?: number
      location?: { lat: number; lon: number } | null
      accuracyM?: number | null
      payload?: Record<string, string | number | boolean | null> | null
    } = {},
  ): DeviceEvent {
    this.sequence += 1
    const event: DeviceEvent = {
      device_event_id: this.deps.newId(),
      kind,
      recorded_at: new Date(options.at ?? this.deps.now()).toISOString(),
      sequence: this.sequence,
      location: options.location ?? null,
      accuracy_m:
        options.accuracyM === null || options.accuracyM === undefined
          ? null
          : String(Number(options.accuracyM.toFixed(2))),
      payload: options.payload ?? null,
    }
    this.queue.push({ event, attempts: 0 })
    const { kept, dropped } = trimToLimit(this.queue, this.limit)
    this.queue = kept
    this.countDropped(dropped)
    this.emit({ queued: this.queue.length })
    this.persist()
    return event
  }

  /** Whether an event of this kind is already waiting. Suppresses repeats. */
  hasPending(kind: DeviceEventKind): boolean {
    return this.queue.some((q) => q.event.kind === kind)
  }

  /**
   * Send one batch, if there is anything to send and the backoff has elapsed.
   *
   * Safe to call on every tick: a no-op when there is nothing to do.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return
    if (this.deps.now() < this.nextAttemptAt) return

    this.flushing = true
    // CRITICAL first, then queue order. A full backlog must not delay an SOS
    // behind fifty connectivity notes; the server applies device order from
    // `recorded_at` regardless, so sending order changes nothing on the
    // timeline.
    const ordered = [...this.queue].sort(
      (a, b) =>
        PRIORITY_RANK[PRIORITY_OF[b.event.kind]] -
        PRIORITY_RANK[PRIORITY_OF[a.event.kind]],
    )
    const batch = ordered.slice(0, this.batchSize)

    try {
      const result = await this.deps.send(batch.map((q) => q.event))
      const settled = new Set(result.settled_event_ids ?? [])
      // Exactly what the server settled, nothing more. An event it did not
      // mention stays queued and is sent again.
      this.queue = this.queue.filter((q) => !settled.has(q.event.device_event_id))
      this.failures = 0
      this.nextAttemptAt = 0
      this.emit({
        queued: this.queue.length,
        accepted: this.summary.accepted + result.accepted,
        duplicatesIgnored: this.summary.duplicatesIgnored + result.duplicates_ignored,
        rejected: this.summary.rejected + result.rejected,
        lastSyncAt: this.deps.now(),
        lastError: null,
      })
      this.persist()
    } catch (error) {
      const outcome = this.deps.classify(error)
      const sent = new Set(batch.map((q) => q.event.device_event_id))
      if (outcome.retryable) {
        // Count the attempt for diagnostics; the events stay.
        this.queue = this.queue.map((q) =>
          sent.has(q.event.device_event_id) ? { ...q, attempts: q.attempts + 1 } : q,
        )
      } else {
        // The server will never accept these - the trip ended, or this build
        // sends something it does not understand. Holding them would block
        // every later event behind a request that cannot succeed.
        this.queue = this.queue.filter((q) => !sent.has(q.event.device_event_id))
        this.emit({ rejected: this.summary.rejected + batch.length })
      }
      this.failures += 1
      this.nextAttemptAt =
        this.deps.now() +
        Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS)
      this.emit({ queued: this.queue.length, lastError: outcome.message })
      this.persist()
    } finally {
      this.flushing = false
    }
  }

  /** When the next flush attempt becomes allowed. Exposed for tests. */
  get retryAt(): number {
    return this.nextAttemptAt
  }

  /** How many events are waiting, by priority. For the diagnostics panel. */
  depthByPriority(): Record<EventPriority, number> {
    const out: Record<EventPriority, number> = { CRITICAL: 0, WARNING: 0, ADVISORY: 0 }
    for (const queued of this.queue) out[PRIORITY_OF[queued.event.kind]] += 1
    return out
  }

  /**
   * Forget everything. Called when the trip ends.
   *
   * The server refuses events for a trip that is over, so a queue carried into
   * the next trip would retry forever against an endpoint that will never
   * accept it - the same reasoning the GPS queue applies.
   */
  reset(): void {
    this.queue = []
    this.failures = 0
    this.nextAttemptAt = 0
    this.sequence = 0
    this.emit({ queued: 0, lastError: null })
    if (this.durable) {
      this.writing = this.writing
        .then(() => this.store.clear())
        .catch(() => this.emit({ persistence: 'degraded' }))
    }
  }
}
