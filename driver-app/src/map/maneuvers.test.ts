/**
 * Choosing the maneuver to announce, and how far away to say it is.
 *
 * The arithmetic here is one subtraction, which is exactly why it is worth
 * pinning: the wrong operand is invisible in review and unmistakable on a
 * windscreen.
 *
 * Step lengths below are deliberately unequal. With equal steps, using a
 * maneuver's own `step_distance_m` instead of the remaining path length gives
 * the same answer, so the mistake this file exists to catch would pass.
 */

import { describe, expect, it } from 'vitest'

import { guidanceHold, upcomingManeuver, maneuverIcon, instructionFor } from './maneuvers'
import type { NavigationManeuver } from '../api/client'

function maneuver(
  type: string,
  distanceFromStart: number,
  stepDistance: number,
): NavigationManeuver {
  return {
    type,
    modifier: type === 'depart' || type === 'arrive' ? null : 'left',
    lat: 26.1445,
    lon: 91.7362,
    geometry_index: 0,
    distance_from_start_m: distanceFromStart,
    step_distance_m: stepDistance,
    duration_s: 60,
    name: null,
    exit: null,
  }
}

/** depart, turn, roundabout, turn, arrive - the shape the backend publishes. */
const ROUTE: NavigationManeuver[] = [
  maneuver('depart', 0, 100),
  maneuver('turn', 100, 4000),
  maneuver('roundabout', 4100, 250),
  maneuver('turn', 4350, 9000),
  maneuver('arrive', 13350, 0),
]

describe('upcomingManeuver', () => {
  it('measures remaining path length, not the maneuver’s own step', () => {
    // 500 m in. The next turn is the roundabout at 4,100 m, so 3,600 m away.
    // Its own step_distance_m is 250 - the wrong answer, and the one a naive
    // implementation gives.
    const next = upcomingManeuver(ROUTE, 500)

    expect(next?.maneuver.type).toBe('roundabout')
    expect(next?.distanceM).toBe(3600)
    expect(next?.distanceM).not.toBe(next?.maneuver.step_distance_m)
  })

  it('advances to the following turn once one is passed', () => {
    const next = upcomingManeuver(ROUTE, 4200)
    expect(next?.maneuver.type).toBe('turn')
    expect(next?.distanceM).toBe(150)
  })

  it('skips depart, which is never announced', () => {
    // At the very start, the first thing ahead is the turn at 100 m - not the
    // depart the truck is standing on.
    const next = upcomingManeuver(ROUTE, 0)
    expect(next?.maneuver.type).toBe('turn')
    expect(next?.distanceM).toBe(100)
  })

  it('does not re-announce a maneuver the truck is exactly on', () => {
    // Standing on the roundabout. Announcing it again is how a panel sticks.
    const next = upcomingManeuver(ROUTE, 4100)
    expect(next?.maneuver.type).toBe('turn')
    expect(next?.distanceM).toBe(250)
  })

  it('reaches arrival last, and stops there', () => {
    expect(upcomingManeuver(ROUTE, 13000)?.maneuver.type).toBe('arrive')
    expect(upcomingManeuver(ROUTE, 13350)).toBeNull()
    expect(upcomingManeuver(ROUTE, 20000)).toBeNull()
  })

  it('shows nothing without a position rather than the first instruction', () => {
    // "Turn left in 400 m" is a claim about where the truck is. With no fix
    // there is no such claim to make.
    expect(upcomingManeuver(ROUTE, null)).toBeNull()
  })

  it('shows nothing when the route carries no directions', () => {
    expect(upcomingManeuver([], 500)).toBeNull()
  })
})

describe('guidanceHold', () => {
  const LIVE = {
    permission: 'granted',
    isTracking: true,
    freshness: 'LIVE',
    loadedAt: 1_000_000,
    freshSeconds: 60,
    onRoute: true,
    now: 1_000_000 + 5_000,
  }

  it('lets guidance run when everything is current', () => {
    expect(guidanceHold(LIVE)).toBeNull()
  })

  it('pauses the instant permission is revoked, not when the server notices', () => {
    // The exact case: a LIVE fix arrived seconds ago, so the server will keep
    // saying LIVE for its whole 90s window. The truck is moving and the app has
    // no subscription. Ninety seconds of confident countdown from a position
    // the driver is no longer at is the failure.
    expect(guidanceHold({ ...LIVE, permission: 'denied' })).toBe('PERMISSION')
  })

  it('does not blame permission when permission is granted', () => {
    // Granted but not subscribed happens on a trip that has not started.
    // "Turn location on" would send that driver to settings to find nothing
    // wrong, so it reports waiting instead.
    expect(guidanceHold({ ...LIVE, isTracking: false })).toBe('NO_FIX')
  })

  it('ages out a LIVE label when polling stops', () => {
    // Network gone: the trip payload freezes with freshness LIVE in it and
    // nothing ever contradicts it. Without this the countdown stays confident
    // for as long as the app is left open.
    expect(guidanceHold({ ...LIVE, now: LIVE.loadedAt + 59_000 })).toBeNull()
    expect(guidanceHold({ ...LIVE, now: LIVE.loadedAt + 61_000 })).toBe('CONTACT_LOST')
    expect(guidanceHold({ ...LIVE, now: LIVE.loadedAt + 3_600_000 })).toBe(
      'CONTACT_LOST',
    )
  })

  it('takes the ageing window from the server, not a local constant', () => {
    // Same elapsed time, different server window: the app must follow the
    // server, or its pause and the manager's LIVE badge disagree.
    const at40s = { ...LIVE, now: LIVE.loadedAt + 40_000 }
    expect(guidanceHold({ ...at40s, freshSeconds: 60 })).toBeNull()
    expect(guidanceHold({ ...at40s, freshSeconds: 30 })).toBe('CONTACT_LOST')
  })

  it('separates never having a fix from having a stale one', () => {
    expect(guidanceHold({ ...LIVE, freshness: 'NO_LOCATION' })).toBe('NO_FIX')
    expect(guidanceHold({ ...LIVE, freshness: null })).toBe('NO_FIX')
    expect(guidanceHold({ ...LIVE, freshness: 'STALE' })).toBe('FIX_STALE')
    expect(guidanceHold({ ...LIVE, freshness: 'NO_CONTACT' })).toBe('FIX_STALE')
  })

  it('reports permission before anything the driver cannot act on', () => {
    // Everything is wrong at once. The one the driver can fix is the one to
    // show.
    expect(
      guidanceHold({
        ...LIVE,
        permission: 'denied',
        freshness: 'STALE',
        loadedAt: null,
      }),
    ).toBe('PERMISSION')
  })

  it('treats a payload that never loaded as lost contact', () => {
    expect(guidanceHold({ ...LIVE, loadedAt: null })).toBeTruthy()
  })

  it('pauses when the fix is not on the planned line', () => {
    // Measured on the demo corridor: a fix 2.4 km off the road projected onto
    // a point 51 km further along, so the panel skipped every maneuver between
    // and announced the wrong turn confidently. The projection is real
    // arithmetic on a position that is not where the truck is.
    expect(guidanceHold({ ...LIVE, onRoute: false })).toBe('OFF_ROUTE')
  })

  it('does not pause merely because the server has no verdict', () => {
    // `on_route` is null when there is nothing to project. That case is
    // already covered by the fix checks above; treating null as off-route
    // would pause guidance on a route that is being followed correctly.
    expect(guidanceHold({ ...LIVE, onRoute: null })).toBeNull()
    expect(guidanceHold({ ...LIVE, onRoute: undefined })).toBeNull()
  })

  it('reports a problem the driver can fix before one they cannot', () => {
    expect(guidanceHold({ ...LIVE, onRoute: false, permission: 'denied' })).toBe(
      'PERMISSION',
    )
  })
})

describe('guidanceHold platform permission', () => {
  const LIVE = {
    permission: 'granted',
    isTracking: true,
    freshness: 'LIVE',
    loadedAt: 1_000_000,
    freshSeconds: 60,
    onRoute: true,
    now: 1_000_000 + 5_000,
  }

  it('believes the platform over the tracker cached flag', () => {
    // Observed in the browser capture: revoking location in browser settings
    // does not error an already-running watch, so the tracker's flag stayed
    // 'granted' while the app could no longer get a fix. The unit tests could
    // not see this because they set that flag themselves.
    expect(guidanceHold({ ...LIVE, platformPermission: 'denied' })).toBe('PERMISSION')
    expect(guidanceHold({ ...LIVE, platformPermission: 'prompt' })).toBe('PERMISSION')
  })

  it('ignores the platform answer where there is none', () => {
    // Native has no `navigator.permissions`; there the tracker's flag is the
    // only answer and must not be second-guessed by a null.
    expect(guidanceHold({ ...LIVE, platformPermission: null })).toBeNull()
    expect(guidanceHold({ ...LIVE, platformPermission: undefined })).toBeNull()
  })

  it('still runs when the platform agrees', () => {
    expect(guidanceHold({ ...LIVE, platformPermission: 'granted' })).toBeNull()
  })
})

describe('maneuverIcon', () => {
  it('returns one Feather icon name per maneuver, never a text glyph', () => {
    expect(maneuverIcon({ type: 'depart', modifier: null } as any)).toBe('navigation')
    expect(maneuverIcon({ type: 'arrive', modifier: null } as any)).toBe('map-pin')
    expect(maneuverIcon({ type: 'roundabout', modifier: null } as any)).toBe('rotate-cw')
    expect(maneuverIcon({ type: 'turn', modifier: 'left' } as any)).toBe('corner-up-left')
    expect(maneuverIcon({ type: 'turn', modifier: 'slight_left' } as any)).toBe('arrow-up-left')
    expect(maneuverIcon({ type: 'turn', modifier: 'right' } as any)).toBe('corner-up-right')
    expect(maneuverIcon({ type: 'turn', modifier: 'slight_right' } as any)).toBe('arrow-up-right')
    expect(maneuverIcon({ type: 'turn', modifier: 'uturn' } as any)).toBe('corner-left-down')
  })
  it('localises the instruction words and leaves the road name alone', () => {
    const hi = (en: string) => ({ Turn: 'मुड़ें', left: 'बाएँ', onto: 'पर' }[en] ?? en)
    expect(instructionFor({ type: 'turn', modifier: 'left', name: 'NH 27' } as any, hi)).toBe('मुड़ें बाएँ पर NH 27')
    expect(instructionFor({ type: 'turn', modifier: 'sharp_right', name: null } as any)).toBe('Turn sharp right')
  })
})

