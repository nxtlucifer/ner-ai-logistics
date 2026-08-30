/**
 * The single fleet polling loop.
 *
 * ONE loop, shared by the map, the list, the summary counts and the filters.
 * Each of those wanting its own would multiply requests by four for identical
 * data, and - worse - let them disagree: a marker in one position while the row
 * beside it says something else, because two loops landed at different moments.
 *
 * Discipline this loop keeps:
 *
 *   one request in flight   a slow response on a congested link must not let
 *                           ticks stack up until each is answering the previous
 *                           tick's backlog
 *   abort on unmount        a navigation away must not resolve into a component
 *                           that is gone
 *   backoff on failure      a backend that is down must not be met with a
 *                           request every ten seconds from every open tab
 *   last good data retained a failed poll shows a warning ALONGSIDE the last
 *                           successful reading, never instead of it - replacing
 *                           a working fleet view with an error banner because
 *                           one poll blipped hides the fleet
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type FleetSnapshot } from '../api/client'

/** Healthy cadence. Matches the driver upload interval; see telemetry_policy.py. */
export const FLEET_POLL_MS = 10_000
const BACKOFF_MAX_MS = 60_000

export interface FleetPoll {
  snapshot: FleetSnapshot | null
  error: unknown
  /** True only before the first answer of any kind. */
  isInitialising: boolean
  /** True when the most recent poll failed but earlier data is on screen. */
  isStale: boolean
  refresh: () => void
}

export function useFleetPoll(): FleetPoll {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [isInitialising, setIsInitialising] = useState(true)

  // Refs, not state: writing these must not re-run the effect that owns the
  // timer, or the loop would restart on every tick.
  const inFlight = useRef<AbortController | null>(null)
  const failures = useRef(0)
  const wake = useRef<(() => void) | null>(null)

  const poll = useCallback(async () => {
    if (inFlight.current) return

    const controller = new AbortController()
    inFlight.current = controller
    try {
      const data = await api.activeFleet(controller.signal)
      setSnapshot(data)
      setError(null)
      failures.current = 0
    } catch (err) {
      // An abort is this component unmounting, not a failure to report.
      if (controller.signal.aborted) return
      failures.current += 1
      setError(err)
    } finally {
      if (inFlight.current === controller) inFlight.current = null
      setIsInitialising(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (cancelled) return
      await poll()
      if (cancelled) return
      const delay =
        failures.current === 0
          ? FLEET_POLL_MS
          : Math.min(FLEET_POLL_MS * 2 ** failures.current, BACKOFF_MAX_MS)
      timer = setTimeout(() => void tick(), delay)
    }

    wake.current = () => {
      if (timer) clearTimeout(timer)
      void tick()
    }
    void tick()

    return () => {
      cancelled = true
      wake.current = null
      if (timer) clearTimeout(timer)
      inFlight.current?.abort()
      inFlight.current = null
    }
  }, [poll])

  return {
    snapshot,
    error,
    isInitialising,
    isStale: Boolean(error) && snapshot !== null,
    refresh: () => wake.current?.(),
  }
}
