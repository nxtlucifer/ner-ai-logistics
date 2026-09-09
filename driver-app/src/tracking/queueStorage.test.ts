/**
 * The app's queue storage must actually be durable.
 *
 * DRV-001: `LocationTracker` treats `queueStore` as optional and silently falls
 * back to `MemoryQueueStore`, so a caller that forgets one still runs - and
 * loses every unsent fix when Android kills the app mid-trip. The durable
 * `PersistentQueueStore` existed, was tested, and was wired to nothing.
 *
 * These tests pin the wiring itself rather than the store internals (already
 * covered in queueStore.test.ts): the thing that regressed was nobody calling
 * it, so what is asserted here is that the object the app hands the tracker
 * makes the tracker report `durable`, and that it survives being recreated.
 */

import { describe, expect, it } from 'vitest'

import { createQueueStore } from './queueStorage'
import { PersistentQueueStore, type KeyValueStore } from './queueStore'

/** Stands in for AsyncStorage: one backing map, many store instances. */
function fakeKv(): KeyValueStore & { size(): number } {
  const data = new Map<string, string>()
  return {
    async getItem(k) {
      return data.get(k) ?? null
    },
    async setItem(k, v) {
      data.set(k, v)
    },
    async removeItem(k) {
      data.delete(k)
    },
    size: () => data.size,
  }
}

const FIX = {
  device_fix_id: 'a1b2c3d4-0000-4000-8000-000000000001',
  recorded_at: '2026-09-02T10:00:00.000Z',
  location: { lat: 26.1445, lon: 91.7362 },
}

describe('createQueueStore', () => {
  it('produces a durable store, not the in-memory fallback', () => {
    expect(createQueueStore()).toBeInstanceOf(PersistentQueueStore)
  })

  it('survives the store object being recreated, which is what a restart is', async () => {
    const kv = fakeKv()

    await new PersistentQueueStore(kv).save([FIX])
    // A fresh instance over the same backing store == a fresh app launch.
    const afterRestart = await new PersistentQueueStore(kv).load()

    expect(afterRestart).toEqual([FIX])
    expect(kv.size()).toBe(1)
  })
})
