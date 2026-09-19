/**
 * The console's one SOS poll: 10 s while the tab is watched, 30 s while it is
 * hidden (the SOS must be waiting when they come back), at once on return, and
 * never a second request on top of a slow one.
 */

// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api, type Emergency } from '../api/client'
import { EmergencyProvider } from './EmergencyProvider'
import { SOS_HIDDEN_POLL_MS, SOS_POLL_MS, useEmergencies } from './useEmergencies'

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ can: () => true }) }))

const setVisibility = (v: string) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  setVisibility('visible')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('polls every 10 s when watched, every 30 s when hidden, and at once on return', async () => {
  const poll = vi.spyOn(api, 'activeEmergencies').mockResolvedValue([])
  const { result } = renderHook(() => useEmergencies(), { wrapper: EmergencyProvider })
  expect(result.current.loaded).toBe(false)
  await advance(0)
  expect(poll).toHaveBeenCalledTimes(1)
  expect(result.current.loaded).toBe(true)

  await advance(SOS_POLL_MS)
  expect(poll).toHaveBeenCalledTimes(2)

  // Hidden from here: the tick after next waits the slow interval.
  setVisibility('hidden')
  await advance(SOS_POLL_MS)
  expect(poll).toHaveBeenCalledTimes(3)
  await advance(SOS_HIDDEN_POLL_MS - 1)
  expect(poll).toHaveBeenCalledTimes(3)
  await advance(1)
  expect(poll).toHaveBeenCalledTimes(4)

  setVisibility('visible')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(poll).toHaveBeenCalledTimes(5)
  // Back on the fast cadence, as one loop: the hidden timer is gone, so the
  // next 30 s hold three polls, not a fourth from a leftover slow chain.
  await advance(SOS_HIDDEN_POLL_MS)
  expect(poll).toHaveBeenCalledTimes(8)
})

it('skips a tick while a request is still out, and resumes when it answers', async () => {
  let answer!: (list: Emergency[]) => void
  const poll = vi.spyOn(api, 'activeEmergencies')
    .mockReturnValueOnce(new Promise((yes) => { answer = yes }))
    .mockResolvedValue([])
  renderHook(() => useEmergencies(), { wrapper: EmergencyProvider })
  expect(poll).toHaveBeenCalledTimes(1)

  await advance(SOS_POLL_MS * 3)
  expect(poll).toHaveBeenCalledTimes(1)

  await act(async () => answer([]))
  await advance(SOS_POLL_MS)
  expect(poll).toHaveBeenCalledTimes(2)
})
