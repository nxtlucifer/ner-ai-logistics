/**
 * One logical read in flight at a time.
 *
 * MEASURED, NOT GUESSED. Opening Trips fired `/api/trips` seven times in
 * 2.6 seconds against a five-second poll; drivers, trucks and assignments
 * three or four times each; every list page loads the same four resources
 * and each component asked on its own. The fix is one guard in the shared
 * `request`, because the alternative is the same guard on six pages and a
 * seventh page that is born broken.
 *
 * What must NOT be shared is the point of most of these: a mutation is a
 * decision, and two that look alike are still two.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearInFlight, request } from './client'

afterEach(() => {
  clearInFlight()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubFetch(delayMs = 10) {
  const calls: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
    return new Promise((resolve) =>
      setTimeout(
        () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
        delayMs,
      ),
    )
  })
  return calls
}

describe('in-flight GET coalescing', () => {
  it('turns three simultaneous identical reads into one round trip', async () => {
    const calls = stubFetch()
    const [a, b, c] = await Promise.all([
      request('/api/trips'),
      request('/api/trips'),
      request('/api/trips'),
    ])
    expect(calls.filter((c) => c.includes('/api/trips'))).toHaveLength(1)
    // and every caller still gets the answer
    expect(a).toEqual({ ok: true })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('does not coalesce different paths', async () => {
    const calls = stubFetch()
    await Promise.all([request('/api/trips'), request('/api/drivers')])
    expect(calls).toHaveLength(2)
  })

  it('treats a different query string as a different read', async () => {
    const calls = stubFetch()
    await Promise.all([request('/api/trips?limit=20'), request('/api/trips?limit=100')])
    expect(calls).toHaveLength(2)
  })

  it('is not a cache: a later read still hits the network', async () => {
    const calls = stubFetch(1)
    await request('/api/trips')
    await request('/api/trips')
    expect(calls).toHaveLength(2)
  })

  it('NEVER coalesces a mutation', async () => {
    const calls = stubFetch()
    await Promise.all([
      request('/api/trips/1/dispatch', { method: 'POST' }),
      request('/api/trips/1/dispatch', { method: 'POST' }),
    ])
    expect(calls).toHaveLength(2)
  })

  it('NEVER coalesces a GET that carries a body', async () => {
    const calls = stubFetch()
    await Promise.all([
      request('/api/search', { body: { q: 'a' } }),
      request('/api/search', { body: { q: 'b' } }),
    ])
    expect(calls).toHaveLength(2)
  })

  it("leaves a caller with its own abort signal alone", async () => {
    // Sharing here would let one component's unmount cancel another's read.
    const calls = stubFetch()
    const one = new AbortController()
    const two = new AbortController()
    await Promise.all([
      request('/api/trips', { signal: one.signal }),
      request('/api/trips', { signal: two.signal }),
    ])
    expect(calls).toHaveLength(2)
  })

  it('releases the slot after a failure, so the next read retries', async () => {
    let n = 0
    vi.stubGlobal('fetch', () => {
      n += 1
      return n === 1
        ? Promise.reject(new TypeError('network down'))
        : Promise.resolve(new Response('{}', { status: 200 }))
    })
    await expect(request('/api/trips')).rejects.toBeTruthy()
    await expect(request('/api/trips')).resolves.toBeTruthy()
    expect(n).toBe(2)
  })
})
