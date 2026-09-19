/**
 * Utilisation has to be able to report something other than 100%.
 *
 * THE DEFECT THIS CATCHES
 *
 * The card was fed `activeTrips / trips.length`, where `trips` was the
 * fleet snapshot — and `/api/fleet/active` returns only ACTIVE and DELAYED
 * trips. Numerator and denominator were the same set, so the figure was
 * 100% whenever anything moved and 0% otherwise. Three trucks: 100%. One
 * truck out of a hundred: 100%.
 *
 * Nothing caught it. It is a plausible number rendered in the right place,
 * computed from real rows, and wrong. So the test that matters is not
 * "does it render a percentage" but "can it render a DIFFERENT percentage".
 */

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FleetKpiBar } from './FleetKpiBar'

afterEach(cleanup)

const bar = (over: Partial<Parameters<typeof FleetKpiBar>[0]> = {}) =>
  render(
    <FleetKpiBar
      totalTrips={3}
      activeDrivers={2}
      fleetUtilizationPercent={33}
      fleetSize={9}
      needsAttention={0}
      {...over}
    />,
  )

describe('utilisation', () => {
  it('reports a partial fleet as a partial figure', () => {
    bar({ totalTrips: 3, fleetUtilizationPercent: 33, fleetSize: 9 })
    expect(screen.getByText('33')).toBeTruthy()
    expect(screen.getByText(/3 of 9 trucks/)).toBeTruthy()
  })

  it('is not stuck at 100 — the bug it replaced could report nothing else', () => {
    bar({ totalTrips: 1, fleetUtilizationPercent: 11, fleetSize: 9 })
    expect(screen.getByText('11')).toBeTruthy()
    expect(screen.queryByText('100')).toBeNull()
  })

  it('shows an em dash, not 0%, when there is no denominator', () => {
    // A district manager has no fleet-wide count: a truck belongs to the
    // fleet, only a trip carries districts. "0%" would be a measurement of
    // something nobody measured.
    bar({ fleetUtilizationPercent: null, fleetSize: null })
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText(/needs a fleet-wide view/i)).toBeTruthy()
  })

  it('still renders a real 100% when the whole fleet is out', () => {
    bar({ totalTrips: 9, fleetUtilizationPercent: 100, fleetSize: 9 })
    expect(screen.getByText('100')).toBeTruthy()
    expect(screen.getByText(/9 of 9 trucks/)).toBeTruthy()
  })
})

describe('the other three figures', () => {
  it('says so plainly when no driver is transmitting', () => {
    bar({ activeDrivers: 0 })
    expect(screen.getByText(/none transmitting/i)).toBeTruthy()
  })

  it('distinguishes trucks needing attention from all being fine', () => {
    bar({ needsAttention: 2 })
    expect(screen.getByText(/stale or no contact/i)).toBeTruthy()
    cleanup()
    bar({ needsAttention: 0 })
    expect(screen.getByText(/all trucks reporting/i)).toBeTruthy()
  })
})
