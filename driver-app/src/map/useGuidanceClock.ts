/**
 * A clock and a permission answer for the guidance holds.
 *
 * WHY A CLOCK
 *
 * The holds in `guidanceHold` are time-based: a `LIVE` freshness label is only
 * trusted for as long as the window it describes. That comparison happens
 * during render, and the screen used to re-render because TripProvider polled
 * every ten seconds.
 *
 * Which fails in exactly the case the ageing exists for. When polling stops -
 * network gone, backend down - nothing changes, nothing re-renders, and the
 * comparison is never made again. The panel keeps showing the last distance it
 * computed, indefinitely and confidently. That was observed in the browser
 * capture: polling blocked for nearly two minutes, panel unchanged.
 *
 * So the screen gets a tick. It is NOT a second poller and does not fetch
 * anything - it only re-evaluates state the app already has.
 *
 * WHY ASK THE PLATFORM ABOUT PERMISSION
 *
 * The tracker's `permission` is a cached flag set when access was requested.
 * Revoking location in browser settings does not error an already-running
 * `watchPosition` in Chrome, so that flag stays 'granted' while the app can no
 * longer get a fix. Also observed in the capture. `navigator.permissions`
 * answers for the current state and fires `change` on revocation.
 *
 * Native returns null: `navigator.permissions` is a web API, and the OS
 * revoking location there does terminate the subscription, which the tracker
 * already reports.
 */

import { useEffect, useState } from 'react'

/** How often the time-based holds are re-evaluated. */
const TICK_MS = 5000

export interface GuidanceClock {
  /** Changes on every tick, so callers re-render and re-compare timestamps. */
  now: number
  /** Platform permission state, or null where the platform cannot be asked. */
  platformPermission: string | null
}

export function useGuidanceClock(): GuidanceClock {
  const [now, setNow] = useState(() => Date.now())
  const [platformPermission, setPlatformPermission] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    // Web only, and only where the Permissions API exists. Safari has shipped
    // `navigator.permissions` without geolocation support, so a rejected query
    // is an ordinary outcome and leaves the value null rather than guessing.
    const perms =
      typeof navigator !== 'undefined' ? (navigator as Navigator).permissions : undefined
    if (!perms || typeof perms.query !== 'function') return

    let cancelled = false
    let status: PermissionStatus | null = null
    const onChange = () => {
      if (!cancelled && status) setPlatformPermission(status.state)
    }

    perms
      .query({ name: 'geolocation' as PermissionName })
      .then((s) => {
        if (cancelled) return
        status = s
        setPlatformPermission(s.state)
        s.addEventListener('change', onChange)
      })
      .catch(() => {
        // No geolocation permission descriptor here. Leave it null so the
        // tracker's own flag remains the only answer.
      })

    return () => {
      cancelled = true
      if (status) status.removeEventListener('change', onChange)
    }
  }, [])

  return { now, platformPermission }
}
