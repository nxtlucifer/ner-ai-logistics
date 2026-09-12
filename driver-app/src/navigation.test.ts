/**
 * Tab wiring.
 *
 * This used to also pin DRV-002's mitigation (that `trip` could never be
 * unmounted, because the GPS tracker lived inside `TripScreen`). Those two
 * assertions are gone because the thing they guarded is gone: the tracker
 * moved to `src/trip/TripProvider.tsx`, above the navigation, so unmounting
 * any screen is now free.
 */

import { describe, expect, it } from 'vitest'

import { TABS, TAB_LABELS } from './navigation'

describe('driver navigation', () => {
  it('labels every tab it renders', () => {
    for (const tab of TABS) {
      expect(TAB_LABELS[tab], tab).toBeTruthy()
    }
    expect(Object.keys(TAB_LABELS).sort()).toEqual([...TABS].sort())
  })

  /**
   * Reversed deliberately. This previously asserted `navigate` first, "for
   * map-first driving guidance" - but that made the first screen after sign-in
   * a full-screen map, which is blank with floating controls over nothing
   * whenever the driver has no assigned trip. The map earns the whole screen
   * once there is a route; before that the trip is the subject. Still asserted
   * as an ordering contract, not softened to "contains".
   */
  it('leads with the trip tab, so sign-in never lands on a blank map', () => {
    expect(TABS[0]).toBe('trip')
    expect(TABS[1]).toBe('navigate')
  })

  it('has no duplicate tabs', () => {
    expect(new Set(TABS).size).toBe(TABS.length)
  })
})
