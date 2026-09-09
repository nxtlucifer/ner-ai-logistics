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
