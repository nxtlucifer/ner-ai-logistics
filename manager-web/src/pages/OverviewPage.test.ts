/**
 * Presence and GPS are two sentences, not one dot.
 *
 * The failure this guards: collapsing them. A driver in a gorge is ONLINE
 * with no position, and a UI that shows one grey dot for that has told the
 * dispatcher the driver is gone. The opposite is just as bad - a fresh
 * green dot beside a position from an hour ago.
 */

import { describe, expect, it } from 'vitest'

import type { PersonPresence } from '../api/client'
import { presenceLine } from './OverviewPage'

const person = (over: Partial<PersonPresence> = {}): PersonPresence => ({
  user_id: 'u1',
  display_name: 'Bipul Das',
  role: 'DRIVER',
  state_id: null,
  district_id: null,
  presence: 'ONLINE',
  location: 'FRESH',
  seen_seconds_ago: 20,
  gps_seconds_ago: 22,
  driver_id: 'd1',
  ...over,
})

describe('presenceLine', () => {
  it('reports the person and the position separately', () => {
    const line = presenceLine(person())
    expect(line).toContain('ONLINE')
    expect(line).toContain('GPS 22 sec ago')
  })

  it('says the location is unavailable without calling the driver offline', () => {
    const line = presenceLine(
      person({ location: 'UNAVAILABLE', gps_seconds_ago: null }),
    )
    expect(line).toContain('ONLINE')
    expect(line).toContain('Location unavailable')
    expect(line).not.toMatch(/OFFLINE/)
  })

  it('marks a stale position as stale rather than as current', () => {
    const line = presenceLine(person({ location: 'STALE', gps_seconds_ago: 3600 }))
    expect(line).toContain('stale')
    expect(line).toContain('GPS 1 h ago')
  })

  it('reads a week-old position in days, as Fleet and Notifications do (AUD2-08)', () => {
    const line = presenceLine(person({ location: 'STALE', gps_seconds_ago: 12605 * 60, seen_seconds_ago: 11891 * 60 }))
    expect(line).toContain('GPS 9 d ago')
    expect(line).toContain('seen 8 d ago')
    expect(line).not.toMatch(/\d{3,} min/)
  })

  it('says "never seen" rather than printing null', () => {
    const line = presenceLine(
      person({ presence: 'OFFLINE', seen_seconds_ago: null, location: 'UNAVAILABLE', gps_seconds_ago: null }),
    )
    expect(line).toContain('OFFLINE')
    expect(line).not.toMatch(/null|undefined|NaN/)
  })

  it('switches to minutes once seconds stop being readable', () => {
    expect(presenceLine(person({ seen_seconds_ago: 600, location: 'UNAVAILABLE', gps_seconds_ago: null }))).toContain(
      'Location unavailable',
    )
    expect(presenceLine(person({ seen_seconds_ago: 600 }))).toContain('seen 10 min ago')
  })
})
