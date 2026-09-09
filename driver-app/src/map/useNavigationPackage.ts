/**
 * The turn instructions for the route on screen, and whether they can be shown.
 *
 * NOT A SECOND POLLER, for the same reason `useRouteGeometry` is not: the trip
 * poll already runs every ten seconds and carries `selected_route_id`. This
 * hook watches that one id and fetches when it changes, so a trip that runs for
 * four hours on one corridor fetches its directions once.
 *
 * IDENTITY IS CHECKED BEFORE ANYTHING IS SHOWN
 *
 * A package is used only when its `route_id` equals the id the poll just named.
 * The failure this prevents is quiet and looks correct: directions for the
 * previous corridor drawn over the new one after a reroute, rendering
 * perfectly, sending a truck somewhere it is no longer going. A mismatch is
 * discarded, not aged.
 *
 * `route_revision` is carried through so the panel can tell "the same
 * directions, fetched again" from "the road changed" without comparing arrays.
 *
 * NOT CACHED OFFLINE HERE
 *
 * `useRouteGeometry` falls back to the stored offline package because a
 * corridor drawn from this morning's data is still the right road. Directions
 * are held to a stricter standard: G6's offline trip kit is where cached
 * guidance belongs, with its own explicit cached-at labelling. Quietly serving
 * stale turns from a hook that does not say so is how a driver ends up
 * following instructions for a route that was replaced while they had no
 * signal.
 */

import { useCallback, useEffect, useState } from 'react'

import { api, type NavigationManeuver, type NavigationPackage } from '../api/client'

export interface Navigation {
  /** True only when the server said so AND the identity matched. */
  available: boolean
  maneuvers: NavigationManeuver[]
  routeId: string | null
  routeRevision: string | null
  /** Why guidance is unavailable. Rendered through the reason-code catalogue. */
  reasonCodes: string[]
  /** Provider route length in metres. Null when not supplied. */
  distanceM: number | null
  /** Free-flow provider seconds. NOT an arrival estimate. */
  durationS: number | null
  isLoading: boolean
  /** Set when the fetch failed. Distinct from "the route has no directions". */
  error: unknown
  reload: () => void
}

const EMPTY: Omit<Navigation, 'reload'> = {
  available: false,
  maneuvers: [],
  routeId: null,
  routeRevision: null,
  reasonCodes: [],
  distanceM: null,
  durationS: null,
  isLoading: false,
  error: null,
}

export function useNavigationPackage(
  tripId: string | null,
  selectedRouteId: string | null,
): Navigation {
  const scope = JSON.stringify([tripId, selectedRouteId])
  const [state, setState] = useState<Omit<Navigation, 'reload'> & { scope: string | null }>({ ...EMPTY, scope: null })
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    if (tripId === null || selectedRouteId === null) {
      setState({ ...EMPTY, scope })
      return
    }

    let cancelled = false

    function matches(packageData: NavigationPackage): boolean {
      return (
        packageData.trip_id === tripId && packageData.route_id === selectedRouteId
      )
    }

    async function load() {
      setState((prev) => ({ ...(prev.scope === scope ? prev : EMPTY), scope, isLoading: true, error: null }))
      try {
        const fresh = await api.navigationPackage()
        if (cancelled) return

        if (!matches(fresh)) {
          // A reroute landed between the poll that named the route and this
          // request. The next poll carries the new id and re-runs this effect;
          // showing the old turns in the meantime is the one thing not to do.
          setState({ ...EMPTY, scope })
          return
        }

        setState({
          scope,
          available: fresh.available,
          maneuvers: fresh.available ? fresh.maneuvers : [],
          routeId: fresh.route_id,
          routeRevision: fresh.route_revision,
          reasonCodes: fresh.reason_codes,
          distanceM: fresh.distance_m,
          durationS: fresh.duration_s,
          isLoading: false,
          error: null,
        })
      } catch (error) {
        if (cancelled) return
        // No stale fallback. See the header.
        setState({ ...EMPTY, scope, error })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tripId, selectedRouteId, attempt])

  // Do not feed old turns to the panel or speech even for the first render
  // after a route change, before the loading effect runs.
  return { ...(state.scope === scope ? state : { ...EMPTY, isLoading: tripId !== null && selectedRouteId !== null }), reload }
}
