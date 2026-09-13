import { describe, expect, it } from 'vitest'

import { locationChip } from './locationLabel'

const now = 1_000_000

describe('location chip', () => {
  it('names a GPS-grade live fix with its metres', () => {
    expect(locationChip({ permission: 'granted', fix: { accuracyM: 12, source: 'GPS', at: now }, kind: 'LIVE', now })).toEqual({ text: 'GPS ±12 m', tone: 'live' })
  })
  it('never calls a network fix GPS', () => {
    expect(locationChip({ permission: 'granted', fix: { accuracyM: 180, source: 'NETWORK', at: now }, kind: 'LIVE', now })).toEqual({ text: 'NETWORK ±180 m', tone: 'coarse' })
  })
  it('ages a last-known fix instead of showing it live', () => {
    expect(locationChip({ permission: 'granted', fix: { accuracyM: 8, source: 'GPS', at: now - 3 * 60_000 }, kind: 'LAST_KNOWN', now }).text).toBe('LAST KNOWN 3 min')
  })
  it('says off and no-fix as themselves', () => {
    expect(locationChip({ permission: 'denied', fix: null, kind: null, now }).text).toBe('LOCATION OFF')
    expect(locationChip({ permission: 'granted', fix: null, kind: null, now }).text).toBe('NO FIX')
  })
})
