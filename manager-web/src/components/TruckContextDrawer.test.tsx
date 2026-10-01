// @vitest-environment jsdom
/**
 * DATA-1: speed and GPS accuracy are facts about a moment. Once contact is
 * lost they are not shown as the truck's speed now.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import type { FleetTrip, Freshness, TripDetail } from '../api/client'
import { TruckContextDrawer } from './TruckContextDrawer'

afterEach(cleanup)

const trip = (freshness: Freshness, age_seconds: number): FleetTrip => ({
  trip_id: 't', trip_code: 'TRP-DEMO-001', trip_status: 'ACTIVE', driver_id: 'd', driver_name: 'Bipul Das',
  truck_id: 'k', registration_number: 'AS01AB1001', started_at: null, freshness,
  next_stop_sequence: null, next_stop_name: null, stops_done: 1, stops_total: 2,
  position: {
    location: { lat: 26.1, lon: 91.7 }, recorded_at: '', received_at: '', age_seconds, freshness,
    speed_kmph: 46, heading_deg: null, accuracy_m: 8, is_mock_location: false,
  },
})

const draw = (t: FleetTrip) => render(<TruckContextDrawer trip={t} detail={null} driver={null} truck={null} />)

it('says Unavailable, not 46 km/h, for a truck out of contact for 208 hours', () => {
  draw(trip('NO_CONTACT', 208 * 3600))
  expect(screen.getByTestId('driver-location').textContent).toContain('NO CONTACT')
  expect(screen.queryByText(/46 km\/h/)).toBeNull()
  expect(screen.queryByText(/±8m/)).toBeNull()
  expect(screen.getAllByText('Unavailable')).toHaveLength(2)
})

it('marks a stale speed as last known, with its age', () => {
  draw(trip('STALE', 12 * 60))
  expect(screen.getByText(/46 km\/h/).textContent).toContain('Last known · 12 min ago')
})

it('shows a live speed plainly', () => {
  draw(trip('LIVE', 5))
  expect(screen.getByText('46 km/h')).toBeTruthy()
  expect(screen.queryByText(/Last known/)).toBeNull()
})

it("says a driver's reroute request from the live row, else from the trip read, and never on a finished trip (E2E-R2)", () => {
  const proposal = { route_id: 'backup', proposed_at: '2026-09-28T10:00:00Z', distance_km: 75.05 }
  const detail = { proposed_reroute: proposal } as TripDetail
  // The row carries it.
  const { unmount } = render(<TruckContextDrawer trip={{ ...trip('LIVE', 5), proposed_reroute: proposal }} detail={null} driver={null} truck={null} onSelectRouteTab={() => {}} />)
  const note = screen.getByTestId('reroute-asked')
  expect(note.textContent).toMatch(/^Driver asked for a new road/)
  expect(note.querySelector('p')!.className).toContain('text-warning')
  expect(screen.getByRole('button', { name: /route options/i }).getAttribute('aria-describedby')).toBe(note.querySelector('p')!.id)
  unmount()
  // A snapshot without the field falls back to the trip read.
  const fallback = render(<TruckContextDrawer trip={trip('LIVE', 5)} detail={detail} driver={null} truck={null} />)
  expect(screen.getByTestId('reroute-asked')).toBeTruthy()
  fallback.unmount()
  // The live row saying "none" wins over an older read.
  const answered = render(<TruckContextDrawer trip={{ ...trip('LIVE', 5), proposed_reroute: null }} detail={detail} driver={null} truck={null} />)
  expect(screen.queryByTestId('reroute-asked')).toBeNull()
  answered.unmount()
  render(<TruckContextDrawer trip={{ ...trip('LIVE', 5), trip_status: 'DELIVERED', proposed_reroute: proposal }} detail={null} driver={null} truck={null} />)
  expect(screen.queryByTestId('reroute-asked')).toBeNull()
})
