/**
 * The fleet polling loop.
 *
 * The discipline here is what keeps a dashboard usable rather than a source of
 * load: one request at a time, backoff when the backend is down, cancellation
 * on unmount, and last-good data retained through a failure. None of that is
 * visible by looking at the screen, and all of it is wrong in obvious ways if
 * unwritten.
 */

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type FleetSnapshot } from '../api/client'
import { FLEET_POLL_MS, useFleetPoll } from './useFleetPoll'

function snapshot(overrides: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return {
    trips: [],
    fresh_seconds: 90,
    stale_seconds: 600,
    server_time: new Date().toISOString(),
    ...overrides,
  }
}

describe('useFleetPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads once and then polls on the healthy cadence', async () => {
    const fetchFleet = vi
      .spyOn(api, 'activeFleet')
      .mockResolvedValue(snapshot())

    const { result } = renderHook(() => useFleetPoll())
    await waitFor(() => expect(result.current.isInitialising).toBe(false))
    expect(fetchFleet).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLEET_POLL_MS + 50)
    })
    expect(fetchFleet).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good snapshot when a poll fails', async () => {
    const good = snapshot({ fresh_seconds: 90 })
    vi.spyOn(api, 'activeFleet')
      .mockResolvedValueOnce(good)
      .mockRejectedValue(new Error('backend down'))

    const { result } = renderHook(() => useFleetPoll())
    await waitFor(() => expect(result.current.snapshot).toEqual(good))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLEET_POLL_MS + 50)
    })

    await waitFor(() => expect(result.current.isStale).toBe(true))
    // The fleet stays on screen. Replacing it with an error banner because one
    // poll blipped would hide every truck.
    expect(result.current.snapshot).toEqual(good)
    expect(result.current.error).toBeTruthy()
  })

  it('reports an error with no data when the very first poll fails', async () => {
    vi.spyOn(api, 'activeFleet').mockRejectedValue(new Error('backend down'))

    const { result } = renderHook(() => useFleetPoll())

    await waitFor(() => expect(result.current.isInitialising).toBe(false))
    expect(result.current.snapshot).toBeNull()
    expect(result.current.error).toBeTruthy()
    expect(result.current.isStale).toBe(false)
  })

  it('backs off rather than hammering a backend that is down', async () => {
    const fetchFleet = vi
      .spyOn(api, 'activeFleet')
      .mockRejectedValue(new Error('backend down'))

    renderHook(() => useFleetPoll())
    await waitFor(() => expect(fetchFleet).toHaveBeenCalledTimes(1))

    // One healthy interval later there must be no second attempt yet: after a
    // failure the wait is longer than the healthy cadence.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLEET_POLL_MS + 50)
    })
    expect(fetchFleet).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLEET_POLL_MS + 50)
    })
    expect(fetchFleet).toHaveBeenCalledTimes(2)
  })

  it('stops polling after unmount', async () => {
    const fetchFleet = vi
      .spyOn(api, 'activeFleet')
      .mockResolvedValue(snapshot())

    const { result, unmount } = renderHook(() => useFleetPoll())
    await waitFor(() => expect(result.current.isInitialising).toBe(false))
    const callsAtUnmount = fetchFleet.mock.calls.length

    unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLEET_POLL_MS * 4)
    })
    expect(fetchFleet).toHaveBeenCalledTimes(callsAtUnmount)
  })

  it('aborts a request that is still in flight when the page is left', async () => {
    // The request must still be OUTSTANDING at unmount for there to be
    // anything to abort - a completed one has already cleared itself.
    let capturedSignal: AbortSignal | undefined
    vi.spyOn(api, 'activeFleet').mockImplementation(async (signal) => {
      capturedSignal = signal
      return new Promise<FleetSnapshot>(() => {
        // Never settles: a slow backend, or a navigation mid-request.
      })
    })

    const { unmount } = renderHook(() => useFleetPoll())
    await waitFor(() => expect(capturedSignal).toBeDefined())
    expect(capturedSignal?.aborted).toBe(false)

    unmount()

    // Without this the response would resolve into a component that is gone.
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('never runs two requests at once', async () => {
    let inFlight = 0
    let peak = 0
    vi.spyOn(api, 'activeFleet').mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      // Slower than the poll interval: without the guard, ticks would stack.
      await new Promise((resolve) => setTimeout(resolve, FLEET_POLL_MS * 3))
      inFlight -= 1
      return snapshot()
    })

    const { result } = renderHook(() => useFleetPoll())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLEET_POLL_MS * 10)
    })

    expect(peak).toBe(1)
    expect(result.current.snapshot).not.toBeNull()
  })

  it('refresh() asks immediately instead of waiting for the next tick', async () => {
    const fetchFleet = vi
      .spyOn(api, 'activeFleet')
      .mockResolvedValue(snapshot())

    const { result } = renderHook(() => useFleetPoll())
    await waitFor(() => expect(fetchFleet).toHaveBeenCalledTimes(1))

    await act(async () => {
      result.current.refresh()
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(fetchFleet).toHaveBeenCalledTimes(2)
  })
})
