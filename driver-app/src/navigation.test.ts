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

  it('leads with the navigate tab for map-first driving guidance', () => {
    expect(TABS[0]).toBe('navigate')
  })

  it('has no duplicate tabs', () => {
    expect(new Set(TABS).size).toBe(TABS.length)
  })
})
