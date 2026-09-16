/**
 * The route the map draws, and where it came from.
 *
 * NOT A SECOND POLLER. The handoff is explicit that the map must not add a
 * competing refresh loop, and it does not: `TripProvider` polls the trip every
 * ten seconds and that poll now carries `selected_route_id`. This hook watches
 * that ONE id and fetches geometry only when it changes - so a stationary trip
 * fetches the corridor once and then never again, however long it runs.
 *
 * WHY THE OFFLINE PACKAGE IS THE SOURCE
 *
 * `/me/trip/offline-package` already returns exactly what a map needs, for the
 * authenticated driver's own trip, with the server's authorisation applied:
 * the selected route's geometry, the backup route, and the stops. Adding
 * geometry to `/me/trip` instead would put a polyline on the wire every ten
 * seconds to detect the rare occasion it changed. Reusing the package endpoint
 * costs one request per route change and gives the offline trip kit for free -
 * it is the same payload, and it is written to the same store the assistant
 * already reads.
 *
 * IDENTITY IS CHECKED, NOT ASSUMED
 *
 * A cached package is used only when it is for THIS trip AND its selected
 * route id equals the one the server just named. A package from before a
 * reroute is not a stale version of the current route - it is a different
 * road, drawn confidently, to somewhere the driver is no longer going. So it
 * is discarded rather than shown, and the map says it is loading instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { api, type OfflinePackage, type OfflineRoute, type OfflineStop } from '../api/client'
import { OfflinePackageStore } from '../offline/packageStore'
import { validGeometry, type LatLon } from './geo'

/**
 * Where the geometry on screen came from.
 *
 * `CACHED` is a different fact from `LIVE`, not a lesser one, and the map
 * labels it: a driver in a valley is looking at what the server said earlier,
 * and the difference matters when they are deciding whether to trust it.
 */
export type GeometrySource = 'LIVE' | 'CACHED' | 'NONE'

export interface RouteGeometry {
  /** The authorised corridor, already validated. Empty when unusable. */
  points: LatLon[]
  /** The distinct backup corridor, when the trip has one. */
  backupPoints: LatLon[]
  stops: OfflineStop[]
  routeId: string | null
  distanceKm: number | null
  source: GeometrySource
  /** When the server built this package. Null when nothing has loaded. */
  capturedAt: string | null
  /**
   * The whole package behind the geometry, live or cached.
   *
   * Exposed so the offline trip kit - the per-dataset freshness manifest, the
   * connectivity segments, the turn instructions and the roadside places -
   * reads the SAME package the map is drawn from. A second fetcher would mean
   * a map and a readiness card that could disagree about which corridor is
   * cached, which is the one thing a driver about to lose signal must be able
   * to trust.
   */
  packageData: OfflinePackage | null
  isLoading: boolean
  /** Set when the fetch failed AND no usable cache stood in for it. */
  error: unknown
  reload: () => void
}

function pointsOf(route: OfflineRoute | null): LatLon[] {
  return route ? validGeometry(route.geometry) : []
}

const EMPTY: Omit<RouteGeometry, 'reload'> = {
  points: [],
  backupPoints: [],
  stops: [],
  routeId: null,
  distanceKm: null,
  source: 'NONE',
  capturedAt: null,
  packageData: null,
  isLoading: false,
  error: null,
}

export function useRouteGeometry(
  tripId: string | null,
  selectedRouteId: string | null,
): RouteGeometry {
  const scope = JSON.stringify([tripId, selectedRouteId])
  const [state, setState] = useState<Omit<RouteGeometry, 'reload'> & { scope: string | null }>({ ...EMPTY, scope: null })
  // Bumped to force a refetch on demand (the retry button) without making the
  // effect depend on a value that changes identity every render.
  const [attempt, setAttempt] = useState(0)
  const storeRef = useRef<OfflinePackageStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = new OfflinePackageStore(AsyncStorage)
  }

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    // No trip, or a trip with no route chosen yet. Both are ordinary states
    // with their own screens, not failures.
    if (tripId === null || selectedRouteId === null) {
      setState({ ...EMPTY, scope })
      return
    }

    let cancelled = false
    const store = storeRef.current!

    /** Accept a package only if it describes the route the server just named. */
    function matches(packageData: OfflinePackage): boolean {
      return (
        packageData.trip_id === tripId &&
        packageData.selected_route?.route_id === selectedRouteId
      )
    }

    function apply(packageData: OfflinePackage, source: GeometrySource) {
      setState({
        scope,
        points: pointsOf(packageData.selected_route),
        backupPoints: pointsOf(packageData.backup_route),
        stops: packageData.stops,
        routeId: packageData.selected_route?.route_id ?? null,
        distanceKm: packageData.selected_route?.distance_km ?? null,
        source,
        capturedAt: packageData.captured_at,
        packageData,
        isLoading: false,
        error: null,
      })
    }

    async function load() {
      setState((prev) => ({ ...(prev.scope === scope ? prev : EMPTY), scope, isLoading: true, error: null }))
      try {
        const fresh = await api.offlinePackage()
        if (cancelled) return
        if (!matches(fresh)) {
          // The trip moved underneath this request - a reroute landed between
          // the poll that named the route and this fetch. Do not draw it. The
          // next poll carries the new id and re-runs this effect.
          setState({ ...EMPTY, scope })
          return
        }
        apply(fresh, 'LIVE')
        // Best effort. A phone with no space still gets a working map now;
        // it just will not have one after losing the network.
        void store.write(fresh).catch(() => {})
      } catch (error) {
        if (cancelled) return
        // Network gone. Fall back to the stored package ONLY if it is for this
        // trip and this route - see the header.
        const stored = await store.read()
        if (cancelled) return
        if (stored && matches(stored.packageData)) {
          apply(stored.packageData, 'CACHED')
          return
        }
        setState({ ...EMPTY, scope, error })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [tripId, selectedRouteId, attempt])

  // Effects run after render. Mask the old corridor during that first render
  // as well, before a new trip/route request has had a chance to reset state.
  return { ...(state.scope === scope ? state : { ...EMPTY, isLoading: tripId !== null && selectedRouteId !== null }), reload }
}
