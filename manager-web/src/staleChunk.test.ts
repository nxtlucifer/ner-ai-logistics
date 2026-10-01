/**
 * A stale tab reloads ONCE for a chunk that no longer exists - never in a loop.
 */

import { describe, expect, it, vi } from 'vitest'

import { markOffline, markOnline } from './api/connectivity'
import { asked, quietly, reloadOnStaleChunk } from './staleChunk'

function fakeWindow(onLine = true) {
  const store = new Map<string, string>()
  const target = new EventTarget()
  const reload = vi.fn()
  const win = Object.assign(target, {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    location: { reload },
    navigator: { onLine },
  })
  return { win, reload }
}

describe('reloadOnStaleChunk', () => {
  it('reloads on the first chunk failure and not on a second one right after', () => {
    const { win, reload } = fakeWindow()
    reloadOnStaleChunk(win as unknown as Window)
    win.dispatchEvent(new Event('vite:preloadError'))
    expect(reload).toHaveBeenCalledTimes(1)
    // The reloaded page failing again is a broken build, not a stale tab.
    win.dispatchEvent(new Event('vite:preloadError'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload while offline: that is a failed fetch, not a stale deploy', () => {
    // The browser says so.
    const offline = fakeWindow(false)
    reloadOnStaleChunk(offline.win as unknown as Window)
    offline.win.dispatchEvent(new Event('vite:preloadError'))
    expect(offline.reload).not.toHaveBeenCalled()

    // Or the console does: the browser thinks it is online, the backend is gone.
    const flaky = fakeWindow(true)
    reloadOnStaleChunk(flaky.win as unknown as Window)
    markOffline('/health')
    try {
      flaky.win.dispatchEvent(new Event('vite:preloadError'))
      expect(flaky.reload).not.toHaveBeenCalled()
    } finally {
      markOnline()
    }
  })

  it('never reloads for a prefetch nobody asked for, only for a load somebody did', async () => {
    const { win, reload } = fakeWindow()
    reloadOnStaleChunk(win as unknown as Window)
    // As Vite's preload helper does: the event first, then the rejection.
    const prefetch = quietly(async () => {
      await Promise.resolve()
      win.dispatchEvent(new Event('vite:preloadError'))
      throw new Error('Failed to fetch dynamically imported module')
    })
    await prefetch.catch(() => {})
    expect(reload).not.toHaveBeenCalled()

    // Quiet ends with the prefetch: the click after it still rescues a stale tab.
    win.dispatchEvent(new Event('vite:preloadError'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads for a click that fails while the hover prefetch is still out', async () => {
    const { win, reload } = fakeWindow()
    reloadOnStaleChunk(win as unknown as Window)
    // The hover's prefetch is in flight; the click shares its fetch, and both
    // fail in one task. The click's own event still counts.
    let fail!: () => void
    const prefetch = quietly(() => new Promise<never>((_, no) => { fail = () => no(new Error('stale')) }))
    const click = asked(async () => {
      await Promise.resolve()
      win.dispatchEvent(new Event('vite:preloadError'))
      throw new Error('Failed to fetch dynamically imported module')
    })
    await click.catch(() => {})
    expect(reload).toHaveBeenCalledTimes(1)
    fail()
    await prefetch.catch(() => {})

    // The click's override ends with the click: a later prefetch is quiet again.
    const later = fakeWindow()
    reloadOnStaleChunk(later.win as unknown as Window)
    await quietly(async () => {
      later.win.dispatchEvent(new Event('vite:preloadError'))
      throw new Error('Failed to fetch dynamically imported module')
    }).catch(() => {})
    expect(later.reload).not.toHaveBeenCalled()
  })
})
