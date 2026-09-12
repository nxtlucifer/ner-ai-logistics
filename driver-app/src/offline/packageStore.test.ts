/**
 * The downloaded journey, and how old it is allowed to look.
 *
 * The freshness tests are the point. Every layer upstream of this one - the
 * weather provider, the risk scorer, the road-status model - refuses to
 * present old data as current. All of that is undone by a phone screen that
 * renders a nine-hour-old snapshot without saying so, and this is the last
 * place that rule can be enforced.
 */

import { describe, expect, it } from 'vitest'

import type { OfflinePackage } from '../api/client'
import type { KeyValueStore } from '../tracking/queueStore'
import {
  OfflinePackageStore,
  PACKAGE_FRESH_MS,
  PACKAGE_STORAGE_KEY,
} from './packageStore'

const NOON = Date.parse('2026-09-01T12:00:00Z')

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

function pkg(overrides: Partial<OfflinePackage> = {}): OfflinePackage {
  return {
    trip_id: 'trip-1',
    trip_code: 'TRP-0001',
    captured_at: new Date(NOON).toISOString(),
    selected_route: null,
    backup_route: null,
    stops: [],
    risk: null,
    risk_captured_at: null,
    basemap: 'BUNDLED_NONE',
    reason_codes: ['BASEMAP_NOT_BUNDLED_LICENCE'],
    package_hash: 'abc123',
    version: 'offline-corridor-package-v1',
    ...overrides,
  }
}

describe('storing a journey', () => {
  it('round-trips a package', async () => {
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg())

    const stored = await store.read(NOON)
    expect(stored?.packageData.trip_code).toBe('TRP-0001')
    expect(stored?.ageMs).toBe(0)
    expect(stored?.freshness).toBe('CURRENT')
  })

  it('replaces wholesale rather than merging', async () => {
    // Merging two snapshots of a corridor would produce a route that was never
    // returned by anything, and package_hash would then describe neither.
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg({ package_hash: 'first', trip_code: 'TRP-0001' }))
    await store.write(pkg({ package_hash: 'second', trip_code: 'TRP-0002' }))

    const stored = await store.read(NOON)
    expect(stored?.packageData.package_hash).toBe('second')
    expect(stored?.packageData.trip_code).toBe('TRP-0002')
  })

  it('forgets on clear', async () => {
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg())
    await store.clear()

    expect(await store.read(NOON)).toBeNull()
  })
})

describe('age is reported, never hidden', () => {
  it('is current inside the window', async () => {
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg())

    const stored = await store.read(NOON + PACKAGE_FRESH_MS - 1)
    expect(stored?.freshness).toBe('CURRENT')
  })

  it('goes stale outside it, and still returns the package', async () => {
    // Stale is not gone. A driver in a valley with a nine-hour-old corridor is
    // far better off than one with nothing - as long as the screen says which
    // it is.
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg())

    const stored = await store.read(NOON + PACKAGE_FRESH_MS + 1)
    expect(stored).not.toBeNull()
    expect(stored?.freshness).toBe('STALE')
    expect(stored?.packageData.trip_code).toBe('TRP-0001')
  })

  it('reports the real age in milliseconds', async () => {
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg())

    const nineHours = 9 * 60 * 60 * 1000
    expect((await store.read(NOON + nineHours))?.ageMs).toBe(nineHours)
  })

  it('never reports a negative age when the device clock is behind', async () => {
    // A phone whose clock lags the server's would otherwise render a package
    // from the future, and a negative number is never the honest answer to
    // "how old is this".
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg())

    const stored = await store.read(NOON - 60_000)
    expect(stored?.ageMs).toBe(0)
    expect(stored?.freshness).toBe('CURRENT')
  })

  it('refuses a package whose timestamp cannot be read', async () => {
    const kv = new FakeKv()
    kv.store.set(
      PACKAGE_STORAGE_KEY,
      JSON.stringify({ v: 1, packageData: pkg({ captured_at: 'not a date' }) }),
    )

    // Age is the whole product here. A package that cannot be aged cannot be
    // shown honestly, so it is not shown.
    expect(await new OfflinePackageStore(kv).read(NOON)).toBeNull()
  })
})

describe('a damaged store degrades to nothing, not to a crash', () => {
  it('returns null on truncated JSON', async () => {
    const kv = new FakeKv()
    kv.store.set(PACKAGE_STORAGE_KEY, '{"v":1,"packageData":{"trip_id":')

    expect(await new OfflinePackageStore(kv).read(NOON)).toBeNull()
  })

  it('returns null for a payload from another version', async () => {
    const kv = new FakeKv()
    kv.store.set(
      PACKAGE_STORAGE_KEY,
      JSON.stringify({ v: 99, packageData: pkg() }),
    )

    expect(await new OfflinePackageStore(kv).read(NOON)).toBeNull()
  })

  it('returns null for something that parses but is not a package', async () => {
    const kv = new FakeKv()
    kv.store.set(
      PACKAGE_STORAGE_KEY,
      JSON.stringify({ v: 1, packageData: { trip_id: '', stops: 'no' } }),
    )

    expect(await new OfflinePackageStore(kv).read(NOON)).toBeNull()
  })

  it('returns null rather than throwing when the disk is unreadable', async () => {
    const kv = new FakeKv()
    kv.failOn = 'get'

    await expect(new OfflinePackageStore(kv).read(NOON)).resolves.toBeNull()
  })

  it('REJECTS a failed write instead of swallowing it', async () => {
    // The opposite of the GPS queue, deliberately. That must keep collecting
    // through a full disk because a truck is moving. This must not: a download
    // that did not save is a download that did not happen, and a driver told
    // it succeeded would go offline with nothing.
    const kv = new FakeKv()
    kv.failOn = 'set'

    await expect(new OfflinePackageStore(kv).write(pkg())).rejects.toThrow()
  })
})

describe('a package for the wrong trip is worse than none', () => {
  it('matches the trip it belongs to', async () => {
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg({ trip_id: 'trip-1' }))
    const stored = await store.read(NOON)

    expect(OfflinePackageStore.isFor(stored, 'trip-1')).toBe(true)
  })

  it('rejects a package left over from the previous trip', async () => {
    // A plausible-looking route to somewhere the driver is not going, with
    // every figure on it reading as current.
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg({ trip_id: 'yesterday' }))
    const stored = await store.read(NOON)

    expect(OfflinePackageStore.isFor(stored, 'trip-1')).toBe(false)
  })

  it('handles having nothing stored', () => {
    expect(OfflinePackageStore.isFor(null, 'trip-1')).toBe(false)
  })
})

describe('what the package declares about itself', () => {
  it('preserves the basemap declaration through storage', async () => {
    // The licence answer has to survive the trip to the device, or a driver
    // discovers the missing map in a valley instead of being told now.
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    await store.write(pkg())

    const stored = await store.read(NOON)
    expect(stored?.packageData.basemap).toBe('BUNDLED_NONE')
    expect(stored?.packageData.reason_codes).toContain(
      'BASEMAP_NOT_BUNDLED_LICENCE',
    )
  })

  it('preserves the risk snapshot timestamp', async () => {
    const kv = new FakeKv()
    const store = new OfflinePackageStore(kv)
    const capturedAt = new Date(NOON).toISOString()
    await store.write(
      pkg({
        risk: {
          score: 61,
          band: 'HIGH',
          components: [],
          inputs: { landslide: 'NOT_AVAILABLE' },
          unavailable: ['landslide'],
          reason_codes: [],
          observations_used: 0,
          observations_stale: 0,
          assessed_at: capturedAt,
        },
        risk_captured_at: capturedAt,
      }),
    )

    const stored = await store.read(NOON)
    expect(stored?.packageData.risk_captured_at).toBe(capturedAt)
    expect(stored?.packageData.risk?.unavailable).toContain('landslide')
  })
})
