/**
 * The phone's own position for the map when NO trip is being tracked.
 *
 * The tracker runs only while the server says a trip is in progress, because
 * uploading position is a decision the server makes. Looking at a map is not:
 * a driver with no trip still needs to see where they are. This watches the
 * same adapter, through the same fallback chain (GPS-grade -> network-grade
 * -> the platform's last known fix -> nothing), and uploads NOTHING.
 *
 * Off while the tracker is on, so there is exactly one watch at a time.
 */

import { useEffect, useState } from 'react'

import { expoLocationAdapter, type LocationAdapter } from './adapter'
import { sourceOf } from './source'
import { SpeedFilter } from './speed'
import type { PermissionState, TrackerState } from './tracker'

export interface BrowsePosition {
  permission: PermissionState
  lastPosition: TrackerState['lastPosition']
  requestPermission: () => void
}

export function useBrowsePosition(enabled: boolean, adapter: LocationAdapter = expoLocationAdapter): BrowsePosition {
  const [permission, setPermission] = useState<PermissionState>('unknown')
  const [lastPosition, setLastPosition] = useState<TrackerState['lastPosition']>(null)
  const [asks, setAsks] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    let remove: (() => void) | null = null
    const run = async () => {
      setPermission('requesting')
      try {
        if (!(await adapter.hasServicesEnabled())) {
          if (alive) setPermission('unavailable')
          return
        }
        const outcome = await adapter.requestPermission()
        if (!alive) return
        setPermission(outcome)
        if (outcome !== 'granted') return
        const cached = await adapter.lastKnown?.().catch(() => null)
        if (!alive) return
        if (cached) {
          setLastPosition((prev) => prev ?? { lat: cached.lat, lon: cached.lon, accuracyM: cached.accuracyM ?? null, source: sourceOf(cached.accuracyM ?? null), at: cached.timestamp })
        }
        const speed = new SpeedFilter()
        const sub = await adapter.watch(
          { intervalSeconds: 5 },
          (s) => setLastPosition({
            lat: s.lat,
            lon: s.lon,
            accuracyM: s.accuracyM ?? null,
            speedKmh: speed.next({ lat: s.lat, lon: s.lon, accuracyM: s.accuracyM ?? null, speedMs: s.speedMs, at: s.timestamp }),
            headingDeg: speed.moving && s.speedMs !== null && s.speedMs > 1 ? s.headingDeg : null,
            source: sourceOf(s.accuracyM ?? null),
            at: s.timestamp,
          }),
          () => setPermission('unavailable'),
        )
        if (!alive) {
          sub.remove()
          return
        }
        remove = () => sub.remove()
      } catch {
        if (alive) setPermission('unavailable')
      }
    }
    void run()
    return () => {
      alive = false
      remove?.()
    }
  }, [enabled, asks, adapter])

  return {
    permission: enabled ? permission : 'unknown',
    lastPosition: enabled ? lastPosition : null,
    requestPermission: () => setAsks((n) => n + 1),
  }
}
