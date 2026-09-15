// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, type Trip, type TripRoute, type RouteEligibility } from '../api/client'
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('./FleetMap', () => ({ default: () => <div>Map loaded</div> }))
import TripRouteReview from './TripRouteReview'

const trip: Trip = { id: 'trip', trip_code: 'DEMO REVIEW', shipment_id: 's', truck_id: 't', driver_id: 'd', status: 'DRAFT', selected_route_id: null, dispatched_at: null, started_at: null, delivered_at: null, planned_eta: null, current_eta: null, delay_minutes: null, created_at: new Date().toISOString() }
const route: TripRoute = { id: 'road', kind: 'PRIMARY', state: 'PROPOSED', distance_km: '305.4', estimated_duration_min: 230, routing_provider: 'test provider', created_at: new Date().toISOString(), geometry: [[26,91],[27,94]], is_current: false }
beforeEach(() => {
  vi.spyOn(api, 'getTrip').mockResolvedValue({ ...trip, stops: [], shipment: { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } })
  vi.spyOn(api, 'listRoutes').mockResolvedValue([route])
  vi.spyOn(api, 'reviewAuthorization').mockResolvedValue(null)
  vi.spyOn(api, 'selectRoute').mockResolvedValue({ ...route, is_current: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function assess(eligibility: RouteEligibility) {
  vi.spyOn(api, 'routeRecommendation').mockResolvedValue({ recommended_route_id: null, baseline_route_id: 'road', comparable: false, reason_codes: [], tradeoff: null, unavailable_inputs: ['landslide'], margin_points: 0, version: 'test', candidates: [{ route_id: 'road', kind: 'PRIMARY', distance_km: 305.4, estimated_duration_min: 230, eligibility, risk: { score: 10, band: 'LOW', unavailable: ['landslide'], reason_codes: [] } }] })
}

it.each(['REJECTED', 'NOT_ASSESSED', 'REQUIRES_REVIEW'] as const)('does not offer selection for %s without valid authority', async eligibility => {
  assess(eligibility)
  const user = userEvent.setup()
  render(<TripRouteReview trip={trip} onChanged={() => {}} />)
  const button = await screen.findByRole('button', { name: 'Check conditions & review' })
  await user.click(button)
  await waitFor(() => expect(api.routeRecommendation).toHaveBeenCalled())
  expect((screen.getByRole('button', { name: 'Use this route' }) as HTMLButtonElement).disabled).toBe(true)
  expect(api.selectRoute).not.toHaveBeenCalled()
})

it('persists an eligible selection and rereads actual assignment before showing success', async () => {
  assess('ELIGIBLE')
  const changed = vi.fn()
  const user = userEvent.setup()
  render(<TripRouteReview trip={trip} onChanged={changed} />)
  await user.click(await screen.findByRole('button', { name: 'Check conditions & review' }))
  vi.mocked(api.listRoutes).mockResolvedValue([{ ...route, is_current: true }])
  await user.click(screen.getByRole('button', { name: 'Use this route' }))
  await screen.findByRole('button', { name: 'Route assigned' })
  expect(api.selectRoute).toHaveBeenCalledExactlyOnceWith('trip', 'road', undefined)
  expect(changed).toHaveBeenCalledTimes(1)
})

it('fetch failure offers retry instead of showing an empty map as success', async () => {
  vi.mocked(api.listRoutes).mockRejectedValue(new Error('Disconnected'))
  render(<TripRouteReview trip={trip} onChanged={() => {}} />)
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  expect(screen.queryByText('Map loaded')).toBeNull()
})

it('reports an unmeasured corridor as unknown signal, never as coverage', async () => {
  // The most common honest answer for a road this fleet has not driven, and
  // the one a coverage map would have painted green. Another evidence block is
  // present so the panel renders at all: with nothing known anywhere it
  // collapses by design, and the coverage header carries the answer instead.
  vi.spyOn(api, 'routeRecommendation').mockResolvedValue({
    recommended_route_id: 'road', baseline_route_id: 'road', comparable: true, reason_codes: [],
    tradeoff: null, unavailable_inputs: ['connectivity'], margin_points: 0, version: 'test',
    candidates: [{
      route_id: 'road', kind: 'PRIMARY', distance_km: 305.4, estimated_duration_min: 230,
      eligibility: 'ELIGIBLE',
      risk: {
        score: 10, band: 'LOW', unavailable: ['connectivity'], reason_codes: [],
        traffic: {
          status: 'UNKNOWN', coverage: 0, delay_min: 0, sample_count: 0, vehicle_count: 0,
          newest_age_seconds: null, updated_at: new Date().toISOString(),
          provider: 'RASTA fleet telemetry', reason_codes: ['TRAFFIC_UNKNOWN'], segments: [],
        },
      },
    }],
  })
  const user = userEvent.setup()
  render(<TripRouteReview trip={trip} onChanged={() => {}} />)
  await user.click(await screen.findByRole('button', { name: 'Check conditions & review' }))
  await waitFor(() => expect(api.routeRecommendation).toHaveBeenCalled())

  const block = await screen.findByTestId('connectivity-summary')
  expect(block.textContent).toContain('UNKNOWN')
  expect(block.textContent).toContain('not coverage')
  // And the evidence header counts it among the things nothing answered for.
  expect(screen.getByTestId('evidence-coverage').textContent).toContain('Signal UNKNOWN')
})

it('states measured signal gaps with their provenance and never as a carrier map', async () => {
  vi.spyOn(api, 'routeRecommendation').mockResolvedValue({
    recommended_route_id: 'road', baseline_route_id: 'road', comparable: true, reason_codes: [],
    tradeoff: null, unavailable_inputs: [], margin_points: 0, version: 'test',
    candidates: [{
      route_id: 'road', kind: 'PRIMARY', distance_km: 305.4, estimated_duration_min: 230,
      eligibility: 'ELIGIBLE',
      risk: {
        score: 20, band: 'LOW', unavailable: [], reason_codes: [],
        connectivity: {
          status: 'DEAD_ZONE', coverage: 0.8, unknown_share: 0.2, weak_km: 5, dead_km: 10,
          unknown_km: 15, longest_gap_km: 15, sample_count: 120, trip_count: 4,
          newest_age_seconds: 600, updated_at: new Date().toISOString(),
          provider: 'RASTA fleet telemetry (upload delay)', version: 'fleet-connectivity-v1',
          reason_codes: ['CONNECTIVITY_DEAD_ZONE_ON_ROUTE'], segments: [],
        },
      },
    }],
  })
  const user = userEvent.setup()
  render(<TripRouteReview trip={trip} onChanged={() => {}} />)
  await user.click(await screen.findByRole('button', { name: 'Check conditions & review' }))
  await waitFor(() => expect(api.routeRecommendation).toHaveBeenCalled())

  const block = await screen.findByTestId('connectivity-summary')
  expect(block.textContent).toContain('DEAD ZONE')
  expect(block.textContent).toContain('10 km with no data path')
  expect(block.textContent).toContain('longest gap 15 km')
  // The 15 km nobody has measured is stated, not folded into the good part.
  expect(block.textContent).toContain('15 km never measured')
  expect(block.textContent).toContain('not a carrier coverage map')
})
