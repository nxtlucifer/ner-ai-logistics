import { describe, expect, it } from 'vitest'

import { headerStatus, judgeFix, locationChip } from './locationLabel'

const now = 1_000_000

describe('location chip', () => {
  it('names a GPS-grade live fix with its metres', () => {
    expect(locationChip({ permission: 'granted', fix: { accuracyM: 12, source: 'GPS', at: now }, kind: 'LIVE', now })).toEqual({ text: 'GPS · ±12 m', tone: 'live' })
  })
  it('never calls a network fix GPS', () => {
    expect(locationChip({ permission: 'granted', fix: { accuracyM: 180, source: 'NETWORK', at: now }, kind: 'LIVE', now })).toEqual({ text: 'Network · ±180 m', tone: 'coarse' })
  })
  it('ages a last-known fix instead of showing it live', () => {
    expect(locationChip({ permission: 'granted', fix: { accuracyM: 8, source: 'GPS', at: now - 3 * 60_000 }, kind: 'LAST_KNOWN', now }).text).toBe('Last known · 3 min')
  })
  it('says off and no-fix as themselves', () => {
    expect(locationChip({ permission: 'denied', fix: null, kind: null, now }).text).toBe('Location off')
    expect(locationChip({ permission: 'granted', fix: null, kind: null, now }).text).toBe('No fix')
  })
})

describe('header status', () => {
  const tracker = { permission: 'granted', watching: true, platformPermission: null, freshMs: 60_000, now }
  const fix = { accuracyM: 8, source: 'GPS' as const, at: now - 4_000 }
  it('describes GPS from the tracker and the connection on its own (browser lane D2)', () => {
    // Offline with a live receiver read "GPS stale": the trip poll's failure, labelled as GPS.
    expect(headerStatus({ ...tracker, fix, offline: true })).toEqual({ text: 'GPS · ±8 m · Offline', live: true })
    expect(headerStatus({ ...tracker, fix, offline: false })).toEqual({ text: 'GPS · ±8 m', live: true })
    expect(headerStatus({ ...tracker, fix: { ...fix, at: now - 3 * 60_000 }, offline: false })).toEqual({ text: 'Last known · 3 min', live: false })
    expect(headerStatus({ ...tracker, watching: false, fix: null, offline: true })).toEqual({ text: 'GPS off · Offline', live: false })
  })
  it('never says "GPS off" for an idle tracker: "Not tracking", or "Location off" when the phone refused (B3)', () => {
    const idle = { ...tracker, watching: false, fix: null, offline: false }
    expect(headerStatus(idle, undefined, 'Not tracking')).toEqual({ text: 'Not tracking', live: false })
    expect(headerStatus({ ...idle, offline: true }, undefined, 'Not tracking').text).toBe('Not tracking · Offline')
    expect(headerStatus({ ...idle, permission: 'denied' }, undefined, 'Not tracking').text).toBe('Location off')
    expect(headerStatus({ ...idle, permission: 'unavailable' }, undefined, 'No fix').text).toBe('Location off')
    // The words are localised like every other chip word.
    expect(headerStatus(idle, (en) => `<${en}>`, 'Not tracking').text).toBe('<Not tracking>')
  })
  it('trusts a fix newer than the clock tick, but not one from a clock far ahead', () => {
    expect(headerStatus({ ...tracker, fix: { ...fix, at: now + 4_000 }, offline: false }).live).toBe(true)
    expect(judgeFix({ ...tracker, fix: { ...fix, at: now + 4_000 } }).ageMs).toBe(0)
    expect(headerStatus({ ...tracker, fix: { ...fix, at: now + 10 * 60_000 }, offline: false }).live).toBe(false)
  })
})
