/**
 * Stale-while-revalidate for list pages.
 *
 * A page that has seen its list before opens on that list - not on
 * "Loading…" - and keeps it when the refresh fails. A page that has never
 * seen it still gets `error`, because an empty list would look like an answer.
 */

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { markOffline, markOnline, readCache, writeCache } from '../api/connectivity'
import { useResource } from './useResource'

describe('useResource with a cacheKey', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no probe')))
    markOnline()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    markOnline()
  })

  it('hydrates from the cache before the first fetch answers, then replaces it', async () => {
    writeCache('trips:test', ['cached'])
    let resolve: (v: string[]) => void = () => {}
    const fetcher = vi.fn(() => new Promise<string[]>((r) => (resolve = r)))

    const { result } = renderHook(() => useResource(fetcher, [], 'trips:test'))
    expect(result.current.status).toBe('success')
    expect(result.current.data).toEqual(['cached'])
    expect(result.current.lastSyncAt).not.toBeNull()

    await act(async () => resolve(['live']))
    await waitFor(() => expect(result.current.data).toEqual(['live']))
    expect(readCache<string[]>('trips:test')?.data).toEqual(['live'])
  })

  it('keeps last-known data through a failed refresh, but errors with nothing cached', async () => {
    writeCache('trips:test', ['cached'])
    const failing = vi.fn().mockRejectedValue(new Error('backend down'))

    const cached = renderHook(() => useResource(failing, [], 'trips:test'))
    await waitFor(() => expect(cached.result.current.error).not.toBeNull())
    expect(cached.result.current.status).toBe('success')
    expect(cached.result.current.data).toEqual(['cached'])

    const cold = renderHook(() => useResource(failing, [], 'other:test'))
    await waitFor(() => expect(cold.result.current.status).toBe('error'))
    expect(cold.result.current.data).toBeNull()
  })

  it('refetches by itself when the console comes back online', async () => {
    const fetcher = vi.fn().mockResolvedValue(['x'])
    renderHook(() => useResource(fetcher, [], 'trips:test'))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    act(() => markOffline('http://x/health'))
    act(() => markOnline())
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })
})
