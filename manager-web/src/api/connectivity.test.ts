/**
 * The offline /health probe: bounded, and never more than one on the wire.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getConnectivity, markOffline, markOnline } from './connectivity'

afterEach(() => {
  markOnline()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('offline probe', () => {
  it('carries a timeout and skips ticks while one is still in flight', async () => {
    vi.useFakeTimers()
    let answer: (r: { ok: boolean }) => void = () => {}
    const fetchMock = vi.fn(() => new Promise<{ ok: boolean }>((r) => (answer = r)))
    vi.stubGlobal('fetch', fetchMock)

    markOffline('http://api/health')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)

    // Still hanging: the next two ticks do not add requests.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    answer({ ok: false })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    answer({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(getConnectivity().online).toBe(true)
  })
})
