/**
 * The route review's one primary control obeys the server's eligibility.
 *
 * On the hosted deployment every corridor is REQUIRES_REVIEW (no landslide
 * inventory is configured, and UNKNOWN is not SAFE), so a manager who was
 * shown a greyed "Use this route" had a button that could never work and no
 * way forward from the panel. The control now names the way forward:
 * SELECTABLE offers the selection, REVIEW_REQUIRED opens the manager's own
 * decision panel (reason + acknowledgement, then one approve-and-select
 * call), BLOCKED says so, and a refusal from the server is shown and re-read.
 */

// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError, NetworkError, api, type ReviewAuthorization, type Trip, type TripRoute, type RouteEligibility } from '../api/client'
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
  vi.spyOn(api, 'approveRoute').mockResolvedValue({ route: { ...route, is_current: true }, authorization: spent })
})
const spent: ReviewAuthorization = { id: 'auth-m', trip_id: 'trip', route_id: 'road', basis: 'HAZARD_DATA_UNKNOWN', rationale: 'Depot confirms the road is open this morning', reviewer_user_id: 'u-m', reviewer_name: 'Demo Manager', reviewer_role: 'MANAGER', issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1_800_000).toISOString(), consumed_at: new Date().toISOString(), revoked_at: null, policy_version: 'v1', evidence_version: 'v1', evidence_snapshot: {} }
const RATIONALE = 'Depot confirms the road is open this morning'
async function decide(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Review & approve route' }))
  await screen.findByRole('dialog', { name: 'Manager Decision' })
  await user.type(screen.getByRole('textbox'), RATIONALE)
  await user.click(screen.getByRole('checkbox'))
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function assess(eligibility: RouteEligibility) {
  return vi.spyOn(api, 'routeRecommendation').mockResolvedValue({ recommended_route_id: null, baseline_route_id: 'road', comparable: false, reason_codes: [], tradeoff: null, unavailable_inputs: ['landslide'], margin_points: 0, version: 'test', candidates: [{ route_id: 'road', kind: 'PRIMARY', distance_km: 305.4, estimated_duration_min: 230, eligibility, risk: { score: 10, band: 'LOW', unavailable: ['landslide'], reason_codes: [] } }] })
}
async function check(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Check conditions & review' }))
  await waitFor(() => expect(api.routeRecommendation).toHaveBeenCalled())
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

it('before conditions are checked there is no Use this route at all - Check conditions is the only way forward', async () => {
  show()
  await screen.findByRole('button', { name: 'Check conditions & review' })
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull()
  expect(screen.getByText(/check current conditions before selecting/i)).toBeDefined()
})

it('REQUIRES_REVIEW without authority: no Use this route; Review & approve route is offered, and says why', async () => {
  assess('REQUIRES_REVIEW')
  const user = userEvent.setup()
  show()
  await check(user)
  await screen.findByText('REQUIRES REVIEW')
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Open review' })).toBeNull()
  expect(button('Review & approve route').disabled).toBe(false)
  expect(screen.getByText(/review required\. hazard evidence is incomplete/i)).toBeDefined()
  expect(api.selectRoute).not.toHaveBeenCalled()
})

it('the manager decision needs a reason AND the acknowledgement before it can approve', async () => {
  assess('REQUIRES_REVIEW')
  const user = userEvent.setup()
  show()
  await check(user)
  await user.click(await screen.findByRole('button', { name: 'Review & approve route' }))
  await screen.findByRole('dialog', { name: 'Manager Decision' })
  expect(screen.getByText(/landslide incidents \(required\)/i).nextElementSibling?.textContent).toBe('UNAVAILABLE')
  const approve = button('Approve & use route')
  expect(approve.disabled).toBe(true)
  await user.type(screen.getByRole('textbox'), RATIONALE)
  expect(approve.disabled).toBe(true) // reason alone is not enough
  await user.click(screen.getByRole('checkbox'))
  expect(approve.disabled).toBe(false)
  await user.click(button('Cancel'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.approveRoute).not.toHaveBeenCalled()
})

it('Approve & use route records once even on a double click, then shows the route assigned and who approved it', async () => {
  assess('REQUIRES_REVIEW')
  const changed = vi.fn()
  const user = userEvent.setup()
  show(changed)
  await check(user)
  await decide(user)
  vi.mocked(api.listRoutes).mockResolvedValue([{ ...route, is_current: true }])
  vi.mocked(api.reviewAuthorization).mockResolvedValue(spent)
  await user.dblClick(button('Approve & use route'))
  await screen.findByRole('button', { name: 'Route assigned' })
  expect(api.approveRoute).toHaveBeenCalledExactlyOnceWith('trip', 'road', RATIONALE)
  expect(api.selectRoute).not.toHaveBeenCalled()
  expect(changed).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('approved-by').textContent).toMatch(/Approved by Demo Manager \(manager\)/)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('an approval the server refuses (a closure appeared) is shown in the panel and the control becomes Route blocked', async () => {
  assess('REQUIRES_REVIEW')
  const user = userEvent.setup()
  show()
  await check(user)
  await decide(user)
  vi.mocked(api.approveRoute).mockRejectedValue(new ApiError(422, { error: { code: 'ROUTE_REJECTED_ACTIVE_HAZARD', message: 'That route is blocked by an active hazard. A closed road cannot be authorised by anyone.' } }, 'refused'))
  assess('REJECTED') // what the server now says when asked again
  await user.click(button('Approve & use route'))
  await screen.findByRole('button', { name: 'Route blocked' })
  expect(screen.getByText(/closed road cannot be authorised/i)).toBeDefined()
  expect(screen.queryByRole('dialog')).toBeNull()
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
  // The reason is also the visible verdict, reachable without a pointer.
  expect(document.getElementById(button('Route blocked').getAttribute('aria-describedby')!)?.textContent).toMatch(/active hazard blocks this road/i)
  expect(api.selectRoute).not.toHaveBeenCalled()
})

it('NOT_ASSESSED: no direct selection, the reason stays on the control', async () => {
  assess('NOT_ASSESSED')
  const user = userEvent.setup()
  show()
  await check(user)
  await screen.findByText('NOT ASSESSED')
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull()
  expect(screen.getByText(/could not run.*fault to fix/i)).toBeDefined()
  expect(button('Check conditions & review').disabled).toBe(false)
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
  await screen.findByRole('button', { name: 'Review & approve route' })
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

it('a conditions check that times out is shown beside the control, and Try again repeats the check', async () => {
  const cause = new Error('signal timed out'); cause.name = 'TimeoutError'
  const reco = assess('REQUIRES_REVIEW') // what the second attempt answers
  reco.mockRejectedValueOnce(new NetworkError(cause)) // the first attempt outlasts the client
  const user = userEvent.setup()
  show()
  await user.click(await screen.findByRole('button', { name: 'Check conditions & review' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(/took too long/i)
  expect(alert.closest('[data-testid=route-decision]')).not.toBeNull() // inside the decision block, next to the control
  expect(screen.queryByRole('button', { name: 'Use this route' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('button', { name: 'Review & approve route' })
  expect(reco).toHaveBeenCalledTimes(2)
  expect(api.getTrip).toHaveBeenCalledTimes(1) // retried as a check, not as a reload
})

it('words an empty map by status: a draft is planned, a trip already out has no route selected (COPY-1)', async () => {
  vi.mocked(api.listRoutes).mockResolvedValue([])
  const { unmount } = show()
  expect(await screen.findByText('Preview your road')).toBeDefined()
  unmount()
  const out = { ...trip, status: 'ACTIVE' as const }
  vi.mocked(api.getTrip).mockResolvedValue({ ...out, stops: [], shipment: { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } })
  render(<MemoryRouter><TripRouteReview trip={out} onChanged={() => {}} /></MemoryRouter>)
  expect(await screen.findByText('No route selected')).toBeDefined()
  expect(screen.queryByText(/for this draft/)).toBeNull()
})

it("a moving trip whose driver asked for a new road says so and sends the manager to Fleet's Route tab (E2E-R2)", async () => {
  const moving: Trip = { ...trip, status: 'ACTIVE', selected_route_id: 'road', proposed_reroute: { route_id: 'backup', proposed_at: '2026-09-28T10:00:00Z', distance_km: 75.05 } }
  vi.mocked(api.getTrip).mockResolvedValue({ ...moving, stops: [], shipment: { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } })
  function FleetProbe() { return <p data-testid="fleet-probe">{JSON.stringify(useLocation().state)}</p> }
  const user = userEvent.setup()
  render(<MemoryRouter><Routes><Route path="/" element={<TripRouteReview trip={moving} onChanged={() => {}} />} /><Route path="/fleet" element={<FleetProbe />} /></Routes></MemoryRouter>)
  const note = await screen.findByTestId('reroute-asked')
  expect(note.textContent).toMatch(/Driver asked for a new road/)
  expect(note.textContent).toMatch(/75\.05 km from where the truck was/)
  // No second way to accept it here: the button only opens Fleet.
  expect(screen.queryByRole('button', { name: /accept|reroute onto/i })).toBeNull()
  await user.click(button('Review new road'))
  expect(JSON.parse((await screen.findByTestId('fleet-probe')).textContent!)).toEqual({ tripId: 'trip', tab: 'route' })
})

it('says nothing about a new road once the trip read has none, whatever the list row said', async () => {
  const moving: Trip = { ...trip, status: 'ACTIVE', selected_route_id: 'road', proposed_reroute: { route_id: 'backup', proposed_at: '2026-09-28T10:00:00Z', distance_km: null } }
  vi.mocked(api.getTrip).mockResolvedValue({ ...moving, proposed_reroute: null, stops: [], shipment: { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } })
  render(<MemoryRouter><TripRouteReview trip={moving} onChanged={() => {}} /></MemoryRouter>)
  await waitFor(() => expect(api.getTrip).toHaveBeenCalled())
  await screen.findByText('Synthetic client · 1,000 kg')
  expect(screen.queryByTestId('reroute-asked')).toBeNull()
})

it('an open review re-reads its trip when the polled row changes: a driver request and a cancel show without reopening (FV-E2E-1)', async () => {
  const moving: Trip = { ...trip, status: 'ACTIVE', selected_route_id: 'road' }
  const shipment = { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' as const }
  vi.mocked(api.getTrip).mockResolvedValue({ ...moving, stops: [], shipment })
  const view = (row: Trip) => <MemoryRouter><TripRouteReview trip={row} onChanged={() => {}} /></MemoryRouter>
  const { rerender } = render(view(moving))
  await screen.findByText('Synthetic client · 1,000 kg')
  expect(screen.queryByTestId('reroute-asked')).toBeNull()
  // The same row polled again changes nothing and reads nothing.
  rerender(view({ ...moving }))
  expect(api.getTrip).toHaveBeenCalledTimes(1)
  const asked = { ...moving, proposed_reroute: { route_id: 'backup', proposed_at: '2026-09-28T10:00:00Z', distance_km: 12 } }
  vi.mocked(api.getTrip).mockResolvedValue({ ...asked, stops: [], shipment })
  rerender(view(asked))
  expect((await screen.findByTestId('reroute-asked')).textContent).toMatch(/Driver asked for a new road/)
  expect(api.getTrip).toHaveBeenCalledTimes(2)
})

it('a draft cancelled from its row stops offering Plan route in the open review, before and after the re-read (FV-E2E-1, A3-01)', async () => {
  vi.mocked(api.listRoutes).mockResolvedValue([])
  const view = (row: Trip) => <MemoryRouter><TripRouteReview trip={row} onChanged={() => {}} /></MemoryRouter>
  const { rerender } = render(view(trip))
  await screen.findByRole('button', { name: 'Plan route' })
  let release: () => void = () => {}
  vi.mocked(api.getTrip).mockImplementation(() => new Promise(resolve => { release = () => resolve({ ...trip, status: 'CANCELLED', stops: [], shipment: { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } }) }))
  rerender(view({ ...trip, status: 'CANCELLED' }))
  // The row already says CANCELLED: no plan, even while the read is out.
  expect(screen.queryByRole('button', { name: 'Plan route' })).toBeNull()
  release()
  await waitFor(() => expect(screen.getAllByText('CANCELLED').length).toBeGreaterThan(0))
  expect(screen.queryByRole('button', { name: 'Plan route' })).toBeNull()
})

it('re-reads once the trip leaves the list it was opened from: a draft cancelled from an open-only list (FV-E2E-1)', async () => {
  vi.mocked(api.listRoutes).mockResolvedValue([])
  const view = (listed: boolean) => <MemoryRouter><TripRouteReview trip={trip} listed={listed} onChanged={() => {}} /></MemoryRouter>
  const { rerender } = render(view(true))
  await screen.findByRole('button', { name: 'Plan route' })
  // The row is gone and the clicked row still says DRAFT; only a read can tell.
  vi.mocked(api.getTrip).mockResolvedValue({ ...trip, status: 'CANCELLED', stops: [], shipment: { id: 's', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } })
  rerender(view(false))
  await waitFor(() => expect(screen.getAllByText('CANCELLED').length).toBeGreaterThan(0))
  expect(screen.queryByRole('button', { name: 'Plan route' })).toBeNull()
  expect(api.getTrip).toHaveBeenCalledTimes(2)
})
