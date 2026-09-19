// @vitest-environment jsdom
/**
 * A map that cannot appear takes down the map, not the console. Offline, the
 * Fleet page's map chunk may never have been fetched; before the boundary that
 * rejection unmounted everything, and the last-known list the offline view is
 * for went blank with it. The words say which failure it was: a chunk that did
 * not arrive is the connection; no WebGL is this browser, and retrying will
 * not help.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type FleetTrip, type Trip, type TripRoute } from '../api/client'
import FleetPage from '../pages/FleetPage'
import TripRouteReview from './TripRouteReview'
import { MapLoadBoundary } from './ui'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'MANAGER', display_name: 'Test Manager', email: null, phone: null }, can: () => true }),
}))
// Every import of the map chunk fails, as it does offline.
vi.mock('./FleetMap', () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// A page's map has no retry of its own: the words say what brings it back.
const CHUNK = 'Map could not load — check the connection, then reload the page.'

// findBy waits 5 s, not the 1 s default: under the full parallel run the
// rejected chunk surfaced later than 1 s after FleetPage's first render,
// and this test failed 4 full runs in 7 while passing alone.
it('keeps the fleet list and KPIs when the map chunk never arrives', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const live: FleetTrip = {
    trip_id: 't1', trip_code: 'TRP-LIVE', trip_status: 'ACTIVE', driver_id: 'd1', driver_name: 'Bipul Das',
    truck_id: 'k1', registration_number: 'AS01AB1234', started_at: new Date().toISOString(), position: null,
    freshness: 'NO_LOCATION', next_stop_sequence: 1, next_stop_name: 'Delivery', stops_done: 1, stops_total: 2,
  }
  vi.spyOn(api, 'activeFleet').mockResolvedValue({ trips: [live], fresh_seconds: 90, stale_seconds: 600, server_time: new Date().toISOString(), trucks_total: 1 })
  render(<MemoryRouter><FleetPage /></MemoryRouter>)

  expect((await screen.findByRole('alert', {}, { timeout: 5000 })).textContent).toBe(CHUNK)
  expect(screen.getByText('TRP-LIVE')).toBeDefined()
  expect(screen.getByText('Active trips')).toBeDefined()
})

it('keeps the trip review around a route map that cannot load', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const trip: Trip = { id: 'trip', trip_code: 'DEMO REVIEW', shipment_id: 's', truck_id: 't', driver_id: 'd', status: 'DRAFT', selected_route_id: null, dispatched_at: null, started_at: null, delivered_at: null, planned_eta: null, current_eta: null, delay_minutes: null, created_at: new Date().toISOString() }
  const route: TripRoute = { id: 'road', kind: 'PRIMARY', state: 'PROPOSED', distance_km: '305.4', estimated_duration_min: 230, routing_provider: 'test provider', created_at: new Date().toISOString(), geometry: [[26, 91], [27, 94]], is_current: false }
  vi.spyOn(api, 'getTrip').mockResolvedValue({ ...trip, stops: [], shipment: { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } })
  vi.spyOn(api, 'listRoutes').mockResolvedValue([route])
  vi.spyOn(api, 'reviewAuthorization').mockResolvedValue(null)
  render(<MemoryRouter><TripRouteReview trip={trip} onChanged={() => {}} /></MemoryRouter>)

  expect((await screen.findByRole('alert', {}, { timeout: 5000 })).textContent).toBe(CHUNK)
  expect(screen.getByText('305.4 km')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Check conditions & review' })).toBeDefined()
})

function Broken({ error }: { error: Error }): never {
  throw error
}

it('blames the connection only for a chunk that did not arrive', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // MapLibre's own words on a machine without WebGL: retrying cannot help.
  const noGpu = new Error('WebGL2 is required to display this map.')
  render(<MapLoadBoundary instead="enter coordinates under Advanced instead"><Broken error={noGpu} /></MapLoadBoundary>)
  expect(screen.getByRole('alert').textContent).toBe('Map could not start in this browser — enter coordinates under Advanced instead.')
  cleanup()

  const reported = vi.fn()
  render(<MapLoadBoundary onError={reported}><Broken error={new TypeError('Importing a module script failed.')} /></MapLoadBoundary>)
  // The caller that takes the message shows it itself (the picker's dialog
  // closes), and retries on the next click, so no reload is asked for.
  expect(reported).toHaveBeenCalledWith('Map could not load — check the connection.')
  expect(screen.queryByRole('alert')).toBeNull()
  cleanup()

  // Vite's words when the map's stylesheet is what did not arrive: the usual
  // first failure offline, before the script is even asked for.
  render(<MapLoadBoundary><Broken error={new Error('Unable to preload CSS for /assets/mapSetup-x.css')} /></MapLoadBoundary>)
  expect(screen.getByRole('alert').textContent).toBe(CHUNK)
})
