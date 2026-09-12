/**
 * One route-risk read, shared by the Route Monitor and the Safety screen.
 *
 * Both screens ask the SAME endpoint, which serves the same deterministic
 * engine the manager console reads. Two copies of this effect would be two
 * chances for one screen to claim an assessment the other knows is gone - the
 * argument `useLocalAi` already makes for the model.
 *
 * 404 AND 409 ARE STATES, NOT ERRORS
 *
 * A driver with no trip, or with a trip whose road the manager has not picked
 * yet, is not a failure to retry. Each maps to something the screen renders in
 * words. Anything else is UNAVAILABLE - and UNAVAILABLE is never rendered as
 * "the road is clear".
 *
 * `fetchedAt` is the DEVICE clock at the moment this phone received the
 * payload. `assessed_at` inside the payload is when the server scored it. They
 * are different questions and the Safety screen shows the second one, so this
 * carries both rather than conflating them.
 */

import { useCallback, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { ApiError, api, type RouteRisk } from '../api/client'
import { OfflinePackageStore } from '../offline/packageStore'

export type RouteRiskState =
  | 'LOADING'
  | 'READY'
  /**
   * The live read failed and the phone is showing the assessment stored in
   * its offline package instead. `capturedAt` says when the SERVER scored
   * it; every consumer labels it LAST KNOWN and shows that age. Never rendered
   * as current, and never a substitute when the trip has no package.
   */
  | 'STALE'
  | 'NO_TRIP'
  | 'NO_ROUTE'
  | 'UNAVAILABLE'

export interface RouteRiskRead {
  risk: RouteRisk | null
  state: RouteRiskState
  fetchedAt: number | null
  /** Server capture time of a STALE assessment, else null. */
  capturedAt: string | null
  refresh: () => void
}

/** The assessment is weather-driven off a shared provider. A tighter loop
 *  would be provider abuse for data that does not move that fast. */
export const RISK_REFRESH_MS = 5 * 60_000

export function useRouteRisk(
  refetchKey?: unknown,
  /** The current trip id, so a stored package is only used for ITS trip. */
  tripId: string | null = null,
): RouteRiskRead {
  const [risk, setRisk] = useState<RouteRisk | null>(null)
  const [state, setState] = useState<RouteRiskState>('LOADING')
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const next = await api.routeRisk()
        if (!alive) return
        setRisk(next)
        setFetchedAt(Date.now())
        setCapturedAt(null)
        setState('READY')
      } catch (error) {
        if (!alive) return
        // The previous LIVE assessment is dropped on purpose. Holding it while
        // the trip has moved on is how a panel ends up describing a road the
        // truck is no longer on.
        setRisk(null)
        setFetchedAt(null)
        setCapturedAt(null)
        if (error instanceof ApiError && error.status === 404) {
          setState('NO_TRIP')
          return
        }
        if (error instanceof ApiError && error.status === 409) {
          setState('NO_ROUTE')
          return
        }
        // Could not reach the server. The offline package carries the full
        // assessment the server scored when it was built - the same
        // `risk_read` shape - so a phone in a valley shows THAT, labelled
        // with its capture time, rather than nothing. Only if a package for
        // THIS trip exists: another trip's road is not this road.
        const stored = await new OfflinePackageStore(AsyncStorage).read().catch(() => null)
        if (!alive) return
        const cached = stored?.packageData
        if (cached?.risk && cached.trip_id === tripId && cached.risk_captured_at) {
          setRisk(cached.risk)
          setCapturedAt(cached.risk_captured_at)
          setState('STALE')
          return
        }
        setState('UNAVAILABLE')
      }
    }
    void load()
    const timer = setInterval(() => void load(), RISK_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refetchKey, nonce, tripId])

  // A manual recheck does NOT go back through LOADING: blanking a screen a
  // driver is reading, to replace it with the same content, reads as a fault.
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { risk, state, fetchedAt, capturedAt, refresh }
}
