import { describe, expect, it } from 'vitest'

import { BREAK_KEY, readLastBreak, recordBreak, type KeyValue } from './breakStore'

function memoryStore(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
  }
}

const throwingStore: KeyValue = {
  getItem: () => Promise.reject(new Error('disk full')),
  setItem: () => Promise.reject(new Error('disk full')),
}

describe('break store', () => {
  it('round-trips a break as an ISO timestamp', async () => {
    const kv = memoryStore()
    const when = new Date('2026-09-05T10:30:00.000Z')
    expect(await recordBreak(when, kv)).toBe(true)
    expect(kv.data.get(BREAK_KEY)).toBe('2026-09-05T10:30:00.000Z')
    expect(await readLastBreak(kv)).toBe('2026-09-05T10:30:00.000Z')
  })

  it('reports no break when nothing was ever stored', async () => {
    expect(await readLastBreak(memoryStore())).toBeNull()
  })

  it('degrades to null rather than throwing when storage fails', async () => {
    // Null means "measure from the trip start", which reports MORE elapsed
    // time, never less. A throw here would take down the safety screen.
    expect(await readLastBreak(throwingStore)).toBeNull()
  })

  it('reports a failed write instead of claiming success', async () => {
    // The screen uses this to avoid telling a driver their break was logged
    // when it was not.
    expect(await recordBreak(new Date(), throwingStore)).toBe(false)
  })
})
