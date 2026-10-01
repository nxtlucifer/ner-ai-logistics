// @vitest-environment jsdom
/**
 * Driver breaks on the manager side (nav-break add-on, 1 Oct 2026): the inbox
 * says who, why, how long, from when and where; the timeline names the
 * events; the history shows resumed, overdue and the place.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, type Notification, type TripBreak, type TripEvent } from '../api/client'
import { detail, headline } from '../pages/notificationText'
import BreakHistory, { breakLine } from './BreakHistory'
import { historyLines } from './JourneyHistory'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const brk = (over: Partial<TripBreak> = {}): TripBreak => ({
  id: 'b1', trip_id: 't1', driver_id: 'd1', truck_id: 'k1', status: 'ACTIVE', reason: 'FOOD', note: null,
  planned_minutes: 30, started_at: '2026-10-01T05:00:00Z', expected_end_at: '2026-10-01T05:30:00Z',
  ended_at: null, actual_seconds: null, overdue: false, location: { lat: 26.14452, lon: 91.73621 },
  location_source: 'PHONE', location_at: '2026-10-01T05:00:00Z', ...over,
})
const note = (kind: Notification['kind'], payload: Record<string, string | null>): Notification => ({
  id: 'n1', trip_id: 't1', kind, severity: 'INFO', payload, is_read: false, created_at: '2026-10-01T05:00:00Z', read_at: null,
})

describe('break notifications', () => {
  it('a started break names the driver, length, trip, reason, times and place', () => {
    const n = note('DRIVER_BREAK_STARTED', {
      trip_code: 'TRP-A', driver_name: 'Bipul Das', planned_minutes: '15', reason: 'Tea / rest',
      started_at: '2026-10-01T05:00:00Z', expected_end_at: '2026-10-01T05:15:00Z', lat: '26.14452', lon: '91.73621',
    })
    expect(headline(n)).toBe('Bipul Das is on a 15 min break on TRP-A')
    expect(detail(n)).toMatch(/^Tea \/ rest · from .+, due back .+ · at 26\.1445, 91\.7362$/)
  })

  it('a break with no fix says the place is not known', () => {
    expect(detail(note('DRIVER_BREAK_STARTED', { reason: 'Fuel', planned_minutes: '30' }))).toContain('place not known')
  })

  it('resumed and overdue read as such', () => {
    const ended = note('DRIVER_BREAK_ENDED', { trip_code: 'TRP-A', driver_name: 'Bipul Das', reason: 'Food', planned_minutes: '30', actual_seconds: '2460', overdue: 'true' })
    expect(headline(ended)).toBe('Bipul Das is back on the road on TRP-A')
    expect(detail(ended)).toBe('Food · 41 min of 30 planned · overran')
    const over = note('DRIVER_BREAK_OVERDUE', { trip_code: 'TRP-A', driver_name: 'Bipul Das', planned_minutes: '30', reason: 'Food' })
    expect(headline(over)).toBe("Bipul Das's break on TRP-A has run past 30 min")
    expect(detail(over)).toContain('not resumed yet')
  })
})

describe('break timeline lines', () => {
  it('names the three break events in words', () => {
    const ev = (kind: string): TripEvent => ({ id: 1, kind, description: 'Break started: 15 min · Food', occurred_at: '2026-10-01T05:00:00Z', actor_name: null, instruction: null, reason: 'Food', acknowledged: false })
    expect(historyLines([ev('BREAK_STARTED'), ev('BREAK_ENDED'), ev('BREAK_OVERDUE')]).map((l) => l.title)).toEqual([
      'Driver took a break', 'Driver back on the road', 'Break overran',
    ])
  })
})

describe('BreakHistory', () => {
  it('shows each break: reason, planned length, status, times and the place', async () => {
    vi.spyOn(api, 'tripBreaks').mockResolvedValue([
      brk(),
      brk({ id: 'b0', status: 'ENDED', reason: 'FUEL', planned_minutes: 15, ended_at: '2026-10-01T04:40:00Z', actual_seconds: 25 * 60, overdue: true, location: null, location_source: null }),
    ])
    render(<BreakHistory tripId="t1" />)
    const list = await screen.findByTestId('break-history')
    expect(list.textContent).toContain('Food · 30 min planned')
    expect(list.textContent).toContain('ON BREAK')
    expect(list.textContent).toContain('Stopped at 26.1445, 91.7362')
    expect(list.textContent).toContain('RESUMED LATE')
    expect(list.textContent).toContain('(25 min)')
    expect(list.textContent).toContain('Place not known')
  })

  it('says so when there were none', async () => {
    vi.spyOn(api, 'tripBreaks').mockResolvedValue([])
    render(<BreakHistory tripId="t1" />)
    expect(await screen.findByText('No breaks on this trip.')).toBeTruthy()
  })

  it('one line for Fleet: on break vs overran', () => {
    expect(breakLine(brk())).toMatch(/^On break · Food · 30 min · due back /)
    expect(breakLine(brk({ status: 'OVERDUE', overdue: true }))).toMatch(/^Break overran · /)
  })
})
