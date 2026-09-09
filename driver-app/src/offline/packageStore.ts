/**
 * Keeping the downloaded journey on the phone, and knowing how old it is.
 *
 * Built on the same `KeyValueStore` seam as the GPS queue, deliberately: one
 * storage boundary for the app, one set of corruption rules, one place where a
 * failing disk is handled. Two stores with two ideas of what a truncated write
 * means is how a phone comes to hold a queue it can read and a package it
 * cannot, or the reverse.
 *
 * THE AGE IS THE PRODUCT
 *
 * A stored package is not "the current state of the route". It is what the
 * server said at `captured_at`, and by the time it matters the phone has been
 * offline for hours. So nothing here returns a bare package: `read()` returns
 * the package WITH its age, and `freshness()` is computed from the device
 * clock so it works with no network at all.
 *
 * That is the same rule the backend applies to weather and to road status, and
 * it is the rule that has to survive the trip to the device. A screen that
 * renders a nine-hour-old risk score without saying so has undone every
 * freshness guarantee upstream of it.
 *
 * WHAT IS NOT HERE
 *
 * No merge, no partial update, no patch. A package is replaced wholesale or
 * not at all. Merging two snapshots of a corridor would produce a route that
 * was never returned by anything, and `package_hash` would then describe
 * neither.
 */

import type { OfflinePackage } from '../api/client'
import type { KeyValueStore } from '../tracking/queueStore'

export const PACKAGE_STORAGE_KEY = 'ner.trip.package.v1'

/**
 * How long a downloaded corridor stays CURRENT.
 *
 * The route geometry itself does not spoil - a road is where it was this
 * morning. What ages is the risk snapshot travelling with it, and six hours is
 * long enough to cover a shift's driving while being short enough that a
 * package downloaded before dawn does not still read as current at dusk.
 * A project-defined operational window, not a standard.
 */
export const PACKAGE_FRESH_MS = 6 * 60 * 60 * 1000

export type PackageFreshness = 'CURRENT' | 'STALE'

export interface StoredPackage {
  packageData: OfflinePackage
  /** Milliseconds between `captured_at` and the moment it was read. */
  ageMs: number
  freshness: PackageFreshness
}

interface Envelope {
  v: 1
  packageData: OfflinePackage
}

export class OfflinePackageStore {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly key: string = PACKAGE_STORAGE_KEY,
  ) {}

  /**
   * The stored package with its age, or null.
   *
   * Null covers every unusable case - nothing stored, unreadable disk,
   * truncated JSON, a payload from a different version, a package with no trip
   * on it. All of them mean the same thing to a screen: there is nothing to
   * show, offer the download. Distinguishing them would give a driver a
   * choice they cannot act on.
   *
   * `now` is injected so a test can age a package without sleeping through it.
   */
  async read(now: number = Date.now()): Promise<StoredPackage | null> {
    let raw: string | null
    try {
      raw = await this.kv.getItem(this.key)
    } catch {
      return null
    }
    if (!raw) return null

    let packageData: OfflinePackage
    try {
      const parsed = JSON.parse(raw) as Envelope
      if (parsed?.v !== 1 || !isPackage(parsed.packageData)) return null
      packageData = parsed.packageData
    } catch {
      return null
    }

    const capturedAt = Date.parse(packageData.captured_at)
    if (!Number.isFinite(capturedAt)) return null

    // Clamped at zero. A phone whose clock is behind the server's would
    // otherwise produce a negative age, which renders as a package from the
    // future - and a negative number is never the honest answer to "how old is
    // this".
    const ageMs = Math.max(0, now - capturedAt)
    return {
      packageData,
      ageMs,
      freshness: ageMs <= PACKAGE_FRESH_MS ? 'CURRENT' : 'STALE',
    }
  }

  /**
   * Replace the stored package.
   *
   * Rejects on a storage failure rather than swallowing it: unlike the GPS
   * queue - which must keep collecting through a full disk because a truck is
   * moving - a download that did not save is a download that did not happen,
   * and a driver who was told it succeeded would go offline with nothing.
   */
  async write(packageData: OfflinePackage): Promise<void> {
    const envelope: Envelope = { v: 1, packageData }
    await this.kv.setItem(this.key, JSON.stringify(envelope))
  }

  async clear(): Promise<void> {
    await this.kv.removeItem(this.key)
  }

  /**
   * Whether a stored package is for `tripId`.
   *
   * The check a screen needs before showing one. A package for the PREVIOUS
   * trip is worse than none: it is a plausible-looking route to somewhere the
   * driver is not going, and every figure on it would read as current.
   */
  static isFor(stored: StoredPackage | null, tripId: string): boolean {
    return stored?.packageData.trip_id === tripId
  }
}

function isPackage(value: unknown): value is OfflinePackage {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<OfflinePackage>
  return (
    typeof p.trip_id === 'string' &&
    p.trip_id.length > 0 &&
    typeof p.captured_at === 'string' &&
    typeof p.package_hash === 'string' &&
    Array.isArray(p.stops)
  )
}
