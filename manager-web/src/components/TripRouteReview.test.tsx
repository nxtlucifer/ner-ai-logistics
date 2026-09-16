/**
 * The route review's one primary control obeys the server's eligibility.
 *
 * On the hosted deployment every corridor is REQUIRES_REVIEW (no landslide
 * inventory is configured, and UNKNOWN is not SAFE), so a manager who was
 * shown a greyed "Use this route" had a button that could never work and no
 * way forward from the panel. The control now names the way forward:
 * SELECTABLE offers the selection, REVIEW_REQUIRED opens the review for this
 * trip, BLOCKED says so, and a refusal from the server is shown and re-read.
 */

// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError, api, type ReviewAuthorization, type Trip, type TripRoute, type RouteEligibility } from '../api/client'
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ can: () => true }) }))
vi.mock('./FleetMap', () => ({ default: () => <div>Map loaded</div> }))
import TripRouteReview from './TripRouteReview'

const trip: Trip = { id: 'trip', trip_code: 'DEMO REVIEW', shipment_id: 's', truck_id: 't', driver_id: 'd', status: 'DRAFT', selected_route_id: null, dispatched_at: null, started_at: null, delivered_at: null, planned_eta: null, current_eta: null, delay_minutes: null, created_at: new Date().toISOString() }
const route: TripRoute = { id: 'road', kind: 'PRIMARY', state: 'PROPOSED', distance_km: '305.4', estimated_duration_min: 230, routing_provider: 'test provider', created_at: new Date().toISOString(), geometry: [[26,91],[27,94]], is_current: false }
const show = (onChanged = () => {}) => render(<MemoryRouter><TripRouteReview trip={trip} onChanged={onChanged} /></MemoryRouter>)
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
async function check(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Check conditions & review' }))
  await waitFor(() => expect(api.routeRecommendation).toHaveBeenCalled())
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

it('before conditions are checked, selection is offered shut, with the reason on the control', async () => {
  show()
  const use = (await screen.findByRole('button', { name: 'Use this route' })) as HTMLButtonElement
  expect(use.disabled).toBe(true)
  expect(use.title).toMatch(/check current conditions/i)
})

it('REQUIRES_REVIEW without authority: no Use this route; Open review leads to this trip, and says why', async () => {
  assess('REQUIRES_REVIEW')
  const user = userEvent.setup()
  show()
  await check(user)
  await screen.findByText('REQUIRES REVIEW')
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Open review' }).getAttribute('href')).toBe('/review?trip=trip')
  expect(screen.getByText(/safety review required before this route can be selected/i)).toBeDefined()
  expect(api.selectRoute).not.toHaveBeenCalled()
})

it('REJECTED: the control reads Route blocked, disabled, with the specific reason', async () => {
  assess('REJECTED')
  const user = userEvent.setup()
  show()
  await check(user)
  await screen.findByText('REJECTED')
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull()
  expect(button('Route blocked').disabled).toBe(true)
  expect(button('Route blocked').title).toMatch(/active hazard/i)
  expect(api.selectRoute).not.toHaveBeenCalled()
})

it('NOT_ASSESSED: no direct selection, the reason stays on the control', async () => {
  assess('NOT_ASSESSED')
  const user = userEvent.setup()
  show()
  await check(user)
  await screen.findByText('NOT ASSESSED')
  expect(button('Use this route').disabled).toBe(true)
  expect(button('Use this route').title).toMatch(/check current conditions/i)
})

it('REQUIRES_REVIEW with a live authorisation is selectable and spends that authorisation', async () => {
  assess('REQUIRES_REVIEW')
  vi.mocked(api.reviewAuthorization).mockResolvedValue({ id: 'auth-1', consumed_at: null, revoked_at: null, expires_at: new Date(Date.now() + 3_600_000).toISOString() } as unknown as ReviewAuthorization)
  const user = userEvent.setup()
  show()
  await check(user)
  await waitFor(() => expect(button('Use this route').disabled).toBe(false))
  expect(screen.queryByRole('link', { name: 'Open review' })).toBeNull()
  vi.mocked(api.listRoutes).mockResolvedValue([{ ...route, is_current: true }])
  await user.click(button('Use this route'))
  await screen.findByRole('button', { name: 'Route assigned' })
  expect(api.selectRoute).toHaveBeenCalledExactlyOnceWith('trip', 'road', 'auth-1')
})

it('persists an eligible selection once even on a double click, and rereads actual assignment before showing success', async () => {
  assess('ELIGIBLE')
  const changed = vi.fn()
  const user = userEvent.setup()
  show(changed)
  await check(user)
  await waitFor(() => expect(button('Use this route').disabled).toBe(false))
  vi.mocked(api.listRoutes).mockResolvedValue([{ ...route, is_current: true }])
  await user.dblClick(button('Use this route'))
  await screen.findByRole('button', { name: 'Route assigned' })
  expect(api.selectRoute).toHaveBeenCalledExactlyOnceWith('trip', 'road', undefined)
  expect(changed).toHaveBeenCalledTimes(1)
})

it('a refusal at selection time is shown, and the panel re-reads eligibility so the right control follows', async () => {
  assess('ELIGIBLE')
  const user = userEvent.setup()
  show()
  await check(user)
  await waitFor(() => expect(button('Use this route').disabled).toBe(false))
  vi.mocked(api.selectRoute).mockRejectedValue(new ApiError(409, { error: { code: 'ROUTE_SELECTION_REQUIRES_REVIEW', message: 'This route needs review before it can be selected: required safety evidence is missing or elevated.' } }, 'refused'))
  assess('REQUIRES_REVIEW') // what the server now says when asked again
  await user.click(button('Use this route'))
  await screen.findByRole('link', { name: 'Open review' })
  expect(screen.getByText(/needs review before it can be selected/i)).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull()
})

it('fetch failure offers retry instead of showing an empty map as success', async () => {
  vi.mocked(api.listRoutes).mockRejectedValue(new Error('Disconnected'))
  show()
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  expect(screen.queryByText('Map loaded')).toBeNull()
})
