/**
 * Where the unsent GPS queue lives between app launches.
 *
 * A boundary, deliberately, in the same shape and for the same reason as
 * `LocationAdapter`: the tracker must be testable without a device, and the
 * behaviour that matters here - a queue surviving the OS killing the app
 * mid-trip - is exactly the behaviour that cannot be exercised in a simulator
 * on demand.
 *
 * WHY THE INTERFACE IS THIS SMALL
 *
 * Three methods, all async, all allowed to fail. That is the whole contract a
 * key-value store, a file, or SQLite can each satisfy, so the tracker does not
 * have to know which one it got. Anything richer - transactions, queries,
 * partial writes - would be a promise some backing store could not keep.
 *
 * EVERY METHOD MAY REJECT, AND THE TRACKER MUST SURVIVE IT
 *
 * Storage on a phone fails for ordinary reasons: the disk is full, the app is
 * being backgrounded mid-write, the OS revoked the directory. None of those
 * may stop a truck being tracked. The tracker treats a storage failure as a
 * degraded mode - it keeps collecting into memory and keeps uploading - and
 * says so through `persistence`, rather than crashing or silently pretending
 * the queue is durable when it is not.
 */

import type { GpsFix } from './tracker'

export interface QueueStore {
  /** The persisted queue, or [] when there is nothing or it is unreadable. */
  load(): Promise<GpsFix[]>
  /** Replace the persisted queue wholesale. */
  save(fixes: GpsFix[]): Promise<void>
  /** Forget everything. Called when a trip ends. */
  clear(): Promise<void>
}

/**
 * The default. Holds the queue for the lifetime of the process and no longer.
 *
 * Not a placeholder to be replaced later so much as the honest behaviour when
 * no durable store has been provided: the queue still works, it is still
 * bounded, it still retries - it simply does not survive a restart, and
 * `TrackerState.persistence` reports `'memory'` so no screen can claim
 * otherwise.
 */
export class MemoryQueueStore implements QueueStore {
  private fixes: GpsFix[] = []

  async load(): Promise<GpsFix[]> {
    return [...this.fixes]
  }

  async save(fixes: GpsFix[]): Promise<void> {
    this.fixes = [...fixes]
  }

  async clear(): Promise<void> {
    this.fixes = []
  }
}

/** Serialised form, versioned so a future shape change is detectable. */
interface Envelope {
  v: 1
  fixes: GpsFix[]
}

/**
 * The minimum a platform must provide to make the queue durable.
 *
 * Matches `AsyncStorage` and `expo-secure-store` alike, and a file wrapper is
 * four lines. Kept separate from `QueueStore` so the JSON handling, the
 * corruption tolerance and the bound live in ONE place rather than being
 * re-implemented per platform - which is how two stores come to disagree about
 * what a truncated write means.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export const QUEUE_STORAGE_KEY = 'ner.gps.queue.v1'

/**
 * A durable queue over any key-value store.
 *
 * CORRUPTION IS EXPECTED, NOT EXCEPTIONAL. A write interrupted by the OS
 * leaves truncated JSON, and the next launch must not be a crash loop on a
 * driver's phone at the start of a shift. Anything unparseable, anything not
 * shaped like the envelope, and anything whose entries are not fixes is
 * discarded and treated as an empty queue - losing unsent positions, which is
 * the lesser of the two failures by a wide margin.
 */
export class PersistentQueueStore implements QueueStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly key: string = QUEUE_STORAGE_KEY,
  ) {}

  async load(): Promise<GpsFix[]> {
    const raw = await this.kv.getItem(this.key)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as Envelope
      if (parsed?.v !== 1 || !Array.isArray(parsed.fixes)) return []
      // Validated per entry rather than trusted wholesale: a half-written file
      // can parse as JSON and still contain an object with no device_fix_id,
      // which would then be uploaded and rejected forever.
      return parsed.fixes.filter(isFix)
    } catch {
      return []
    }
  }

  async save(fixes: GpsFix[]): Promise<void> {
    const envelope: Envelope = { v: 1, fixes }
    await this.kv.setItem(this.key, JSON.stringify(envelope))
  }

  async clear(): Promise<void> {
    await this.kv.removeItem(this.key)
  }
}

function isFix(value: unknown): value is GpsFix {
  if (typeof value !== 'object' || value === null) return false
  const fix = value as Partial<GpsFix>
  return (
    typeof fix.device_fix_id === 'string' &&
    fix.device_fix_id.length > 0 &&
    typeof fix.recorded_at === 'string' &&
    typeof fix.location === 'object' &&
    fix.location !== null &&
    Number.isFinite((fix.location as { lat?: unknown }).lat) &&
    Number.isFinite((fix.location as { lon?: unknown }).lon)
  )
}
