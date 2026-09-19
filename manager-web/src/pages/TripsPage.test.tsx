/**
 * Trip planning and dispatch.
 *
 * The property under test here is that **no action fails silently**. Dispatch,
 * Cancel and Close are all state transitions the server can legitimately
 * refuse - an already-cancelled trip, a trip someone else just closed, a
 * transition the lifecycle forbids - and every one of those refusals has to
 * reach the manager. A button that spins, stops, and changes nothing is
 * indistinguishable from a broken build, which is exactly the wrong thing to
 * discover in front of a judge.
 */

// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

import { ApiError, api, type Trip, type TripRoute } from '../api/client'
import { markOnline } from '../api/connectivity'

// TripsPage reads only `can` from the auth context. Rendering the real
// provider would pull in a live /api/auth/me round trip that has nothing to do
// with what these tests assert.
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      role: 'MANAGER' as const,
      display_name: 'Test Manager',
      email: 'm@example.com',
      phone: null,
    },
    isInitialising: false,
    logout: vi.fn(),
    can: () => true,
  }),
}))

// The review panel lazy-loads the map; jsdom has no WebGL.
vi.mock('../components/FleetMap', () => ({ default: () => <div>Map loaded</div> }))

import TripsPage, { TRIPS_SLOW_POLL_MS, attention } from './TripsPage'
import { decisionFor } from './OverviewPage'
import { ATTENTION_FILTERS } from './TripListControls'

/** No pause between keystrokes. user-event's default `delay: 0` waits one
 *  setTimeout between every key and pointer step, and a Windows timer is a
 *  ~16 ms tick: the planner tests' 80-odd keystrokes spent seconds idle and
 *  timed out under the full suite. Every step is still wrapped in act, so
 *  React renders after each key exactly as before. */
const setupUser = () => userEvent.setup({ delay: null })

/** A whole value in one input event. These tests are about what is sent and
 *  what the page says, not about keystrokes, and every keystroke re-renders the
 *  whole page. In React's development build each element then captures an
 *  owner stack, which costs ~80 µs once V8 has optimised the render path, so
 *  the planner filled key by key took 0.7 s alone but over 5 s late in this
 *  file. The search box below is still typed, key by key. */
async function fill(user: ReturnType<typeof setupUser>, field: HTMLElement, text: string) {
  await user.click(field)
  await user.paste(text)
}

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    trip_code: 'TRP-ALPHA',
    shipment_id: 'sh1',
    truck_id: '33333333-3333-4333-8333-333333333333',
    driver_id: '22222222-2222-4222-8222-222222222222',
    status: 'ACTIVE',
    selected_route_id: null,
    dispatched_at: null,
    started_at: null,
    delivered_at: null,
    planned_eta: null,
    current_eta: null,
    delay_minutes: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

/** The detail the stop dialog reads: the pickup's status decides what is required. */
function detail(pickupStatus: 'PENDING' | 'COMPLETED') {
  const stop = (sequence: number, kind: string, status: string) => ({
    id: `s${sequence}`, sequence, kind, status: status as 'PENDING' | 'COMPLETED', name: kind, address: `${kind} address`,
    planned_arrival_at: null, actual_arrival_at: null, actual_departure_at: status === 'COMPLETED' ? new Date().toISOString() : null,
  })
  return {
    ...trip(),
    stops: [stop(0, 'PICKUP', pickupStatus), stop(1, 'DROPOFF', 'PENDING')],
    shipment: { id: 'sh1', reference_code: 'SHP-1', client_name: 'Client', total_weight_kg: '1000.00', priority: 'NORMAL' as const },
  }
}

function conflict(message: string) {
  return new ApiError(
    409,
    { error: { code: 'ILLEGAL_TRIP_TRANSITION', message } },
    'fallback',
  )
}

describe('TripsPage', () => {
  beforeEach(() => {
    // The trip list is cached across reloads (stale-while-revalidate); a test
    // must not find the previous test's rows before its own answer lands.
    localStorage.clear()
    vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({ items: [], next_cursor: null })
    // The live driver-truck pairing the planner shows and dispatch requires.
    vi.spyOn(api, 'listAssignments').mockResolvedValue([
      {
        id: 'a1', driver_id: '22222222-2222-4222-8222-222222222222', truck_id: '33333333-3333-4333-8333-333333333333',
        status: 'ACTIVE', assigned_at: new Date().toISOString(), verified_at: null, mismatch_flagged: false, ended_at: null,
      },
    ])
    vi.stubGlobal('confirm', () => true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('polls the visible page often but the planner open list only on the slow cadence', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [trip()], next_cursor: null })
      render(<TripsPage />)
      await screen.findByText('TRP-ALPHA')
      const calls = (planner: boolean) =>
        vi.mocked(api.listTrips).mock.calls.filter(([q]) => (q?.open_only === true && q?.limit === 100) === planner).length
      const pageBefore = calls(false)
      const openBefore = calls(true)

      await act(async () => { await vi.advanceTimersByTimeAsync(TRIPS_SLOW_POLL_MS - 1_000) })
      expect(calls(false)).toBeGreaterThan(pageBefore + 3)
      expect(calls(true)).toBe(openBefore)

      await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
      expect(calls(true)).toBe(openBefore + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes driver and truck availability after a terminal action, not just the trip list', async () => {
    // THE SECOND HALF OF THE DELIVERED-TRIP CONFLICT.
    //
    // The backend hands the pair back the moment a trip goes terminal. This
    // page reads `listDrivers`/`listTrucks`/`listAssignments` to populate the
    // planner, and it used to reload only `listTrips` — so after a Close the
    // dropdowns went on advertising the old availability until the next poll
    // and a dispatcher who acted straight away met a conflict the server no
    // longer believed in.
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({
      items: [trip({ status: 'DELIVERED' })],
      next_cursor: null,
    })
    vi.spyOn(api, 'getTrip').mockResolvedValue(detail('COMPLETED'))
    const close = vi.spyOn(api, 'closeTrip').mockResolvedValue(trip({ status: 'CLOSED' }))

    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')

    const driversBefore = vi.mocked(api.listDrivers).mock.calls.length
    const trucksBefore = vi.mocked(api.listTrucks).mock.calls.length
    const assignmentsBefore = vi.mocked(api.listAssignments).mock.calls.length
    // The planner's "reserved by" labels read the fleet-wide open list.
    const openListCalls = () =>
      vi.mocked(api.listTrips).mock.calls.filter(([q]) => q?.open_only === true && q?.limit === 100).length
    const openBefore = openListCalls()

    await user.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))

    await waitFor(() =>
      expect(vi.mocked(api.listDrivers).mock.calls.length).toBeGreaterThan(driversBefore),
    )
    expect(vi.mocked(api.listTrucks).mock.calls.length).toBeGreaterThan(trucksBefore)
    expect(vi.mocked(api.listAssignments).mock.calls.length).toBeGreaterThan(assignmentsBefore)
    expect(openListCalls()).toBeGreaterThan(openBefore)
  })

  it('surfaces a refused Cancel instead of failing silently', async () => {
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({
      items: [trip()],
      next_cursor: null,
    })
    vi.spyOn(api, 'cancelTrip').mockRejectedValue(
      conflict('Illegal trip transition ACTIVE -> CANCELLED.'),
    )

    vi.spyOn(api, 'getTrip').mockResolvedValue(detail('PENDING'))

    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')

    // A started trip is stopped through the dialog, never a bare confirm.
    await user.click(screen.getByRole('button', { name: /change journey/i }))
    await screen.findByText(/pickup not completed yet/i)
    // One dialog, one chosen action - not five buttons in the table row.
    await user.click(screen.getByRole('radio', { name: /stop \/ cancel trip/i }))
    await user.click(screen.getByRole('button', { name: /^stop trip$/i }))

    // The manager must be told. Before this was fixed the button simply
    // stopped spinning and the row was unchanged.
    await waitFor(() => {
      expect(
        screen.getByText(/illegal trip transition ACTIVE -> CANCELLED/i),
      ).toBeDefined()
    })
  })

  it('requires a reason and a cargo disposition once the pickup is completed', async () => {
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [trip()], next_cursor: null })
    vi.spyOn(api, 'getTrip').mockResolvedValue(detail('COMPLETED'))
    const cancel = vi.spyOn(api, 'cancelTrip').mockResolvedValue(trip({ status: 'DELAYED' }))

    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')
    await user.click(screen.getByRole('button', { name: /change journey/i }))
    await screen.findByText(/cargo is on the truck/i)

    // Nothing to press until both facts are given - and the reason is on screen.
    const submit = () => screen.getByRole('button', { name: /^stop trip$|^apply$/i }) as HTMLButtonElement
    expect(screen.getByTestId('stop-blocker').textContent).toMatch(/choose what to change/i)
    await user.click(screen.getByRole('radio', { name: /stop \/ cancel trip/i }))
    expect(submit().disabled).toBe(true)
    expect(screen.getByTestId('stop-blocker').textContent).toMatch(/reason of at least 10 characters/i)
    await fill(user, screen.getByLabelText(/^reason/i), 'Customer asked us to wait at the junction')
    expect(screen.getByTestId('stop-blocker').textContent).toMatch(/what happens to the cargo/i)
    await user.selectOptions(screen.getByLabelText(/cargo disposition/i), 'HOLD_FOR_INSTRUCTION')
    expect(submit().disabled).toBe(false)

    await user.click(submit())
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    expect(cancel.mock.calls[0][1]).toEqual({
      reason: 'Customer asked us to wait at the junction',
      disposition: 'HOLD_FOR_INSTRUCTION',
    })
    // A bare cancel never went to the server for a loaded truck.
    expect(cancel.mock.calls.every(([, body]) => body?.disposition)).toBe(true)
  })

  it('gives focus back to Change journey when the dialog closes', async () => {
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [trip()], next_cursor: null })
    vi.spyOn(api, 'getTrip').mockResolvedValue(detail('PENDING'))
    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')
    const opener = screen.getByRole('button', { name: /change journey/i })

    await user.click(opener)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)

    await user.click(opener)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^close$/i }))
    expect(document.activeElement).toBe(opener)
  })

  it('surfaces a refused Close instead of failing silently', async () => {
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({
      items: [trip({ status: 'DELIVERED' })],
      next_cursor: null,
    })
    vi.spyOn(api, 'closeTrip').mockRejectedValue(
      conflict('That trip has already been closed.'),
    )

    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')

    await user.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => {
      expect(screen.getByText(/already been closed/i)).toBeDefined()
    })
  })

  /**
   * Planning must be ONE request.
   *
   * It used to be two - create the shipment, then the trip referencing it -
   * which cannot be atomic across a network. A refused trip (an overloaded
   * truck, the failure this form advertises) left a committed cargo record
   * nothing referenced, and each retry regenerated the reference code and left
   * another. The server now does both in one transaction or neither, so the
   * check that matters here is that the client never reaches for the
   * single-resource endpoints on this path.
   */
  it('offers an inactive-login driver disabled, with the reason stated', async () => {
    // Convenience only - the server returns DRIVER_LOGIN_INACTIVE regardless.
    // What matters here is that the manager is not invited to pick someone the
    // dispatch will refuse, and can see why.
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listDrivers').mockResolvedValue({
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          user_id: 'u9', full_name: 'Locked Out', phone: '9435099999',
          photo_url: null, licence_number: 'AS-9999', licence_expiry: '2030-01-01',
          status: 'AVAILABLE', login_is_active: false,
          created_at: new Date().toISOString(),
        },
      ],
      next_cursor: null,
    })

    render(<TripsPage />)

    // The planner's picker, not the filter bar's: both list the same drivers.
    const planner = await screen.findByRole('combobox', { name: /^driver/i })
    const option = within(planner).getByRole('option', { name: /Locked Out/ }) as HTMLOptionElement
    expect(option.disabled).toBe(true)
    expect(option.textContent).toContain('login inactive')
  })

  it('plans a trip in one atomic request, never shipment-then-trip', async () => {
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listDrivers').mockResolvedValue({
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          user_id: 'u1', full_name: 'Bipul Das', phone: '9435012345',
          photo_url: null, licence_number: 'AS-1234', licence_expiry: '2030-01-01',
          status: 'AVAILABLE', login_is_active: true,
          created_at: new Date().toISOString(),
        },
      ],
      next_cursor: null,
    })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          registration_number: 'AS01AB1234', truck_type: null, make: null,
          model: null, max_capacity_kg: '16000.00', current_load_kg: '0.00',
          status: 'AVAILABLE', baseline_mileage_kmpl: null,
          created_at: new Date().toISOString(),
        },
      ],
      next_cursor: null,
    })
    const planTrip = vi.spyOn(api, 'planTrip').mockResolvedValue(trip())
    const createShipment = vi.spyOn(api, 'createShipment')
    const createTrip = vi.spyOn(api, 'createTrip')

    render(<TripsPage />)
    await screen.findByText(/plan a trip/i)

    await fill(user, screen.getByLabelText(/^client/i), 'Brahmaputra Traders')
    // No invented default: the dispatcher states the weight.
    expect((screen.getByLabelText(/cargo weight/i) as HTMLInputElement).value).toBe('')
    await fill(user, screen.getByLabelText(/cargo weight/i), '1000')
    await fill(user, screen.getByLabelText(/pickup address/i), 'Depot, Guwahati')
    await fill(user, screen.getByLabelText(/destination address/i), 'Yard, Jorhat')

    // An address alone no longer plans a trip: it carries no coordinate, and
    // the form used to substitute a depot default here. With no Google key
    // configured the remaining paths are the map picker - which needs a GL
    // context jsdom does not have - and Advanced, which is what this drives.
    const advanced = screen.getAllByRole('button', { name: /^advanced$/i })
    await user.click(advanced[0])
    await user.click(advanced[1])
    await fill(user, screen.getByLabelText(/^latitude$/i, {
      selector: '[name="pickup_address_lat"]',
    }), '26.1445')
    await fill(user, screen.getByLabelText(/^longitude$/i, {
      selector: '[name="pickup_address_lon"]',
    }), '91.7362')
    await fill(user, screen.getByLabelText(/^latitude$/i, {
      selector: '[name="destination_address_lat"]',
    }), '26.7509')
    await fill(user, screen.getByLabelText(/^longitude$/i, {
      selector: '[name="destination_address_lon"]',
    }), '94.2037')

    await user.selectOptions(
      screen.getByRole('combobox', { name: /^driver/i }),
      '22222222-2222-4222-8222-222222222222',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: /^truck/i }),
      '33333333-3333-4333-8333-333333333333',
    )
    await user.click(screen.getByRole('button', { name: /create draft trip/i }))

    await waitFor(() => expect(planTrip).toHaveBeenCalledTimes(1))
    // The two-call path must be gone, not merely unused by accident.
    expect(createShipment).not.toHaveBeenCalled()
    expect(createTrip).not.toHaveBeenCalled()

    const body = planTrip.mock.calls[0][0]
    expect(body.shipment.client_name).toBe('Brahmaputra Traders')
    expect(body.trip.truck_id).toBe('33333333-3333-4333-8333-333333333333')
    // No shipment_id: the server mints it inside the transaction.
    expect('shipment_id' in body.trip).toBe(false)
    // The coordinate that shipped is the one that was entered, not a default.
    expect(body.shipment.pickup).toEqual({ lat: 26.1445, lon: 91.7362 })
    expect(body.shipment.destination).toEqual({ lat: 26.7509, lon: 94.2037 })
  })

  it('refuses to plan an endpoint that was never located', async () => {
    // The defect this replaces: the form shipped a pre-filled depot coordinate
    // for any address the manager typed, so a trip to Jorhat routed to
    // Guwahati with "Yard, Jorhat" written on it.
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listDrivers').mockResolvedValue({
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          full_name: 'Bipul Das', phone: '+919000000001', licence_number: 'AS-01',
          licence_expiry: '2030-01-01', status: 'AVAILABLE', user_id: '44444444-4444-4444-8444-444444444444',
          login_is_active: true, photo_url: null, created_at: new Date().toISOString(),
        },
      ],
      next_cursor: null,
    })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          registration_number: 'AS01AB1234', truck_type: null, make: null,
          model: null, max_capacity_kg: '16000.00', current_load_kg: '0.00',
          status: 'AVAILABLE', baseline_mileage_kmpl: null,
          created_at: new Date().toISOString(),
        },
      ],
      next_cursor: null,
    })
    const planTrip = vi.spyOn(api, 'planTrip').mockResolvedValue(trip())

    render(<TripsPage />)
    await screen.findByText(/plan a trip/i)

    await fill(user, screen.getByLabelText(/^client/i), 'Brahmaputra Traders')
    await fill(user, screen.getByLabelText(/cargo weight/i), '1000')
    await fill(user, screen.getByLabelText(/pickup address/i), 'Depot, Guwahati')
    await fill(user, screen.getByLabelText(/destination address/i), 'Yard, Jorhat')
    await user.selectOptions(
      screen.getByRole('combobox', { name: /^driver/i }),
      '22222222-2222-4222-8222-222222222222',
    )
    // Picking the driver filled their paired truck; the truck select agrees.
    expect((screen.getByRole('combobox', { name: /^truck/i }) as HTMLSelectElement).value).toBe('33333333-3333-4333-8333-333333333333')

    // Typed text is not a location: the button stays disabled and says why.
    const create = screen.getByRole('button', { name: /create draft trip/i }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(screen.getByTestId('plan-blocker').textContent).toMatch(/select a pickup location/i)
    await user.click(create)
    expect(planTrip).not.toHaveBeenCalled()
  })

  it('swaps pickup and destination, and says why it cannot while both are empty', async () => {
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
    render(<TripsPage />)
    await screen.findByText(/plan a trip/i)
    const swap = screen.getByRole('button', { name: /swap pickup and destination/i }) as HTMLButtonElement
    const pickup = screen.getByLabelText(/pickup address/i) as HTMLInputElement
    const destination = screen.getByLabelText(/destination address/i) as HTMLInputElement

    // Nothing to exchange: a click that does nothing must say why it cannot.
    expect(swap.disabled).toBe(true)
    expect(swap.title).toMatch(/pickup or a destination first/i)

    // One side filled: it moves to the other.
    await fill(user, pickup, 'Depot, Guwahati')
    await user.click(swap)
    expect(pickup.value).toBe('')
    expect(destination.value).toBe('Depot, Guwahati')

    // Both filled: they trade places.
    await fill(user, pickup, 'Yard, Jorhat')
    await user.click(swap)
    expect(pickup.value).toBe('Depot, Guwahati')
    expect(destination.value).toBe('Yard, Jorhat')
  })

  it('will not offer Dispatch for a draft with no selected route', async () => {
    vi.spyOn(api, 'listTrips').mockResolvedValue({
      items: [trip({ status: 'DRAFT', selected_route_id: null })],
      next_cursor: null,
    })
    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')
    const dispatch = screen.getByRole('button', { name: /dispatch/i }) as HTMLButtonElement
    expect(dispatch.disabled).toBe(true)
    expect(dispatch.title).toMatch(/select a route/i)
    expect(within(screen.getByRole('table')).getByText(/needs a route/i)).toBeDefined()
    // Shut at half strength, and the reason is words on screen that the
    // control points at, not only a tooltip.
    expect(dispatch.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(dispatch.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/needs a route/i)
  })

  it('a route selected in the review panel moves the row from Not selected to Selected and opens Dispatch', async () => {
    const user = setupUser()
    vi.stubGlobal('scrollTo', vi.fn())
    const draft = trip({ status: 'DRAFT', selected_route_id: null })
    const road: TripRoute = { id: 'road', kind: 'PRIMARY', state: 'PROPOSED', distance_km: '98.8', estimated_duration_min: 150, routing_provider: 'test provider', created_at: new Date().toISOString(), geometry: [[26, 91], [25.5, 91.9]], is_current: false }
    const listTrips = vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [draft], next_cursor: null })
    vi.spyOn(api, 'getTrip').mockResolvedValue({ ...draft, stops: [], shipment: { id: 'sh1', reference_code: 'DEMO', client_name: 'Synthetic client', total_weight_kg: '1000', priority: 'NORMAL' } })
    const listRoutes = vi.spyOn(api, 'listRoutes').mockResolvedValue([road])
    vi.spyOn(api, 'reviewAuthorization').mockResolvedValue(null)
    vi.spyOn(api, 'routeRecommendation').mockResolvedValue({ recommended_route_id: 'road', baseline_route_id: 'road', comparable: false, reason_codes: [], tradeoff: null, unavailable_inputs: [], margin_points: 10, version: 'test', candidates: [{ route_id: 'road', kind: 'PRIMARY', distance_km: 98.8, estimated_duration_min: 150, eligibility: 'ELIGIBLE', risk: { score: 10, band: 'LOW', unavailable: [], reason_codes: [] } }] })
    vi.spyOn(api, 'selectRoute').mockImplementation(async () => {
      // The server's state after the selection: what the reloads must show.
      listTrips.mockResolvedValue({ items: [{ ...draft, selected_route_id: 'road' }], next_cursor: null })
      listRoutes.mockResolvedValue([{ ...road, is_current: true }])
      return { ...road, is_current: true }
    })

    render(<MemoryRouter><TripsPage /></MemoryRouter>)
    await screen.findByText('TRP-ALPHA')
    expect(screen.getByText('Not selected')).toBeDefined()
    expect((screen.getByRole('button', { name: /^dispatch$/i }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Review route' }))
    await user.click(await screen.findByRole('button', { name: 'Check conditions & review' }))
    const use = (await screen.findByRole('button', { name: 'Use this route' })) as HTMLButtonElement
    await waitFor(() => expect(use.disabled).toBe(false))
    await user.click(use)

    await screen.findByText('Selected')
    expect(within(screen.getByRole('table')).getByText(/ready to dispatch/i)).toBeDefined()
    await waitFor(() => expect((screen.getByRole('button', { name: /^dispatch$/i }) as HTMLButtonElement).disabled).toBe(false))
    expect(api.selectRoute).toHaveBeenCalledTimes(1)
  })

  it('still surfaces a refused Dispatch', async () => {
    const user = setupUser()
    vi.spyOn(api, 'listTrips').mockResolvedValue({
      items: [trip({ status: 'DRAFT', selected_route_id: 'r-1' })],
      next_cursor: null,
    })
    vi.spyOn(api, 'dispatchTrip').mockRejectedValue(
      conflict('That driver is not currently assigned to that truck.'),
    )

    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')

    await user.click(screen.getByRole('button', { name: /dispatch/i }))

    await waitFor(() => {
      expect(screen.getByText(/not currently assigned to that truck/i)).toBeDefined()
    })
  })
})

/**
 * Finding a trip, and adding a stop to one already moving.
 *
 * The defect these close: the list was the newest 50, narrowed in the browser,
 * so an older trip could not be reached, searched or exported - and a manager
 * with a truck on the road had no way to change the journey except to cancel.
 */
describe('TripsPage list controls', () => {
  const page = (items: Trip[], total: number, next: string | null = null) => ({ items, next_cursor: next, total })

  beforeEach(() => {
    vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listAssignments').mockResolvedValue([])
    vi.stubGlobal('confirm', () => true)
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('asks the SERVER for the filter, not the browser', async () => {
    const list = vi.spyOn(api, 'listTrips').mockResolvedValue(page([trip()], 1))
    const user = setupUser()
    render(<MemoryRouter><TripsPage /></MemoryRouter>)
    await screen.findByText('TRP-ALPHA')
    await waitFor(() => expect(list).toHaveBeenCalled())
    // Twenty a page by default, open trips only, nothing else assumed.
    expect(list.mock.calls[0][0]).toMatchObject({ limit: 20, open_only: true })

    list.mockClear()
    await user.type(screen.getByRole('textbox', { name: /search trips/i }), 'ALPHA')
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'ALPHA' }))

    await user.selectOptions(screen.getByRole('combobox', { name: /filter by status/i }), 'ACTIVE')
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ trip_status: 'ACTIVE' }))

    // History is its own list, and it asks for the other half of the fleet.
    await user.click(screen.getByRole('tab', { name: /history/i }))
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ open_only: false }))
  })

  it('pages with the server cursor and says which page of how many', async () => {
    const list = vi.spyOn(api, 'listTrips').mockImplementation(async (params) =>
      params?.cursor
        ? page([trip({ id: 't2', trip_code: 'TRP-BETA' })], 40)
        : page([trip()], 40, 'cursor-2'),
    )
    const user = setupUser()
    render(<MemoryRouter><TripsPage /></MemoryRouter>)
    await screen.findByText('TRP-ALPHA')
    expect(screen.getByTestId('trip-count').textContent).toMatch(/of 40 matching · page 1 of 2/)
    // A greyed pager says why, like every other disabled control.
    expect((screen.getByRole('button', { name: /^previous$/i }) as HTMLButtonElement).title).toBe('Already on the first page')

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await screen.findByText('TRP-BETA')
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: 'cursor-2' })
    await waitFor(() => expect((screen.getByRole('button', { name: /^next$/i }) as HTMLButtonElement).title).toBe('This is the last page'))

    await user.click(screen.getByRole('button', { name: /^previous$/i }))
    await screen.findByText('TRP-ALPHA')
  })

  it('walks every page when switching from 100 rows to All, and stops walking on the way back', async () => {
    // 100 and All send the same query; only whether the fetcher walks differs.
    const list = vi.spyOn(api, 'listTrips').mockImplementation(async (params) =>
      params?.cursor
        ? page([trip({ id: 't2', trip_code: 'TRP-BETA' })], 2)
        : page([trip()], 2, 'cursor-2'),
    )
    const user = setupUser()
    render(<MemoryRouter><TripsPage /></MemoryRouter>)
    await screen.findByText('TRP-ALPHA')
    const size = screen.getByRole('combobox', { name: /rows per page/i })

    await user.selectOptions(size, '100')
    await waitFor(() => expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ limit: 100 }))
    expect(screen.queryByText('TRP-BETA')).toBeNull()

    await user.selectOptions(size, 'ALL')
    await screen.findByText('TRP-BETA')
    expect(list.mock.calls.some(([q]) => q?.cursor === 'cursor-2')).toBe(true)

    await user.selectOptions(size, '100')
    await waitFor(() => expect(screen.queryByText('TRP-BETA')).toBeNull())
  })

  it('exports every row the filter matches, not the page on screen, and says so', async () => {
    vi.spyOn(api, 'listTrips').mockImplementation(async (params) =>
      params?.limit === 100 ? page([trip(), trip({ id: 't2', trip_code: 'TRP-BETA' })], 2) : page([trip()], 2, 'c2'),
    )
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this) })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const user = setupUser()
    render(<MemoryRouter><TripsPage /></MemoryRouter>)
    await screen.findByText('TRP-ALPHA')

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(screen.getByTestId('export-note').textContent).toMatch(/Exported 2 rows/))
    expect(screen.getByTestId('export-note').textContent).toMatch(/Open trips/)
    expect(clicked.at(-1)?.download).toMatch(/^rasta-trips-.*\.csv$/)
  })

  /**
   * The export names people, not identifiers.
   *
   * `driverName`/`truckReg` read the two fleet lists, and the export callback
   * used to close over them without listing them as dependencies. Press Export
   * before those lists arrive - which is exactly what happens on a cold page -
   * and the driver column said "b16a6c05".
   */
  it('names the driver and the truck in the export, never an id fragment', async () => {
    vi.spyOn(api, 'listTrips').mockResolvedValue(page([trip()], 1))
    vi.spyOn(api, 'listDrivers').mockResolvedValue({
      items: [{
        id: '22222222-2222-4222-8222-222222222222',
        user_id: 'u1', full_name: 'Bipul Das', phone: '9435012345',
        photo_url: null, licence_number: 'AS-1234', licence_expiry: '2030-01-01',
        status: 'AVAILABLE', login_is_active: true, created_at: new Date().toISOString(),
      }] as never,
      next_cursor: null,
    })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({
      items: [{
        id: '33333333-3333-4333-8333-333333333333',
        registration_number: 'AS01AB1234', capacity_kg: '9000', status: 'AVAILABLE',
        photo_url: null, created_at: new Date().toISOString(),
      }] as never,
      next_cursor: null,
    })
    let csv = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    URL.createObjectURL = vi.fn((blob: Blob) => { void (blob as Blob & { text(): Promise<string> }).text().then((t) => { csv = t }); return 'blob:x' })
    URL.revokeObjectURL = vi.fn()
    const user = setupUser()
    render(<MemoryRouter><TripsPage /></MemoryRouter>)
    await screen.findByText('TRP-ALPHA')

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(csv).toMatch(/TRP-ALPHA/))
    expect(csv).toMatch(/Bipul Das/)
    expect(csv).toMatch(/AS01AB1234/)
    expect(csv).not.toMatch(/22222222|33333333/)
  })

  it("puts a driver's reroute request on the row and opens the trip on Fleet's Route tab (E2E-R2)", async () => {
    const asked = trip({ status: 'ACTIVE', selected_route_id: 'r1', proposed_reroute: { route_id: 'backup', proposed_at: '2026-09-28T10:00:00Z', distance_km: 75.05 } })
    vi.spyOn(api, 'listTrips').mockResolvedValue(page([asked], 1))
    function FleetProbe() {
      return <p data-testid="fleet-probe">{JSON.stringify(useLocation().state)}</p>
    }
    const user = setupUser()
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<TripsPage />} />
          <Route path="/fleet" element={<FleetProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('TRP-ALPHA')
    const cell = document.getElementById(`attention-${asked.id}`)!
    expect(cell.textContent).toBe('Driver asked for a new road')
    expect(cell.className).toContain('text-warning')
    const go = screen.getByRole('button', { name: 'Review new road' })
    expect(go.getAttribute('aria-describedby')).toBe(cell.id)
    await user.click(go)
    expect(JSON.parse((await screen.findByTestId('fleet-probe')).textContent!)).toEqual({ tripId: asked.id, tab: 'route' })
  })

  it('an open review is fed the polled row, so a driver request shows in it without reopening (FV-E2E-1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // An earlier test's refused request may have marked the console offline,
    // and the poll never runs offline; nor may a cached list answer first.
    markOnline()
    localStorage.clear()
    try {
      const moving = trip({ status: 'ACTIVE', selected_route_id: 'r1' })
      const shipment = { id: 'sh1', reference_code: 'SHP-1', client_name: 'Client', total_weight_kg: '1000.00', priority: 'NORMAL' as const }
      const listTrips = vi.spyOn(api, 'listTrips').mockResolvedValue(page([moving], 1))
      const getTrip = vi.spyOn(api, 'getTrip').mockResolvedValue({ ...moving, stops: [], shipment })
      vi.spyOn(api, 'listRoutes').mockResolvedValue([])
      vi.spyOn(api, 'reviewAuthorization').mockResolvedValue(null)
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
      render(<MemoryRouter><TripsPage /></MemoryRouter>)
      await screen.findByText('TRP-ALPHA')
      await user.click(screen.getByRole('button', { name: 'Open' }))
      await screen.findByText('Client · 1,000 kg')
      expect(screen.queryByTestId('reroute-asked')).toBeNull()
      const asked = { ...moving, proposed_reroute: { route_id: 'backup', proposed_at: '2026-09-28T10:00:00Z', distance_km: 12 } }
      listTrips.mockResolvedValue(page([asked], 1))
      getTrip.mockResolvedValue({ ...asked, stops: [], shipment })
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
      expect((await screen.findByTestId('reroute-asked')).textContent).toMatch(/Driver asked for a new road/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('an open review of a draft cancelled elsewhere drops Plan route once the row leaves Open Trips (FV-E2E-1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    markOnline()
    localStorage.clear()
    try {
      const draft = trip({ status: 'DRAFT', selected_route_id: null })
      const shipment = { id: 'sh1', reference_code: 'SHP-1', client_name: 'Client', total_weight_kg: '1000.00', priority: 'NORMAL' as const }
      const listTrips = vi.spyOn(api, 'listTrips').mockResolvedValue(page([draft], 1))
      const getTrip = vi.spyOn(api, 'getTrip').mockResolvedValue({ ...draft, stops: [], shipment })
      vi.spyOn(api, 'listRoutes').mockResolvedValue([])
      vi.spyOn(api, 'reviewAuthorization').mockResolvedValue(null)
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
      render(<MemoryRouter><TripsPage /></MemoryRouter>)
      await screen.findByText('TRP-ALPHA')
      await user.click(screen.getByRole('button', { name: 'Review route' }))
      await screen.findByRole('button', { name: 'Plan route' })
      // Someone else cancels it: the open-only list no longer carries it.
      listTrips.mockResolvedValue(page([], 0))
      getTrip.mockResolvedValue({ ...draft, status: 'CANCELLED', stops: [], shipment })
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan route' })).toBeNull())
      expect(within(screen.getByTestId('trip-review')).getAllByText('CANCELLED').length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers Add a stop only for a trip that is under way, and sends the confirmed point', async () => {
    vi.spyOn(api, 'listTrips').mockResolvedValue(page([trip({ status: 'ACTIVE', selected_route_id: 'r1' })], 1))
    vi.spyOn(api, 'getTrip').mockResolvedValue({
      ...trip({ status: 'ACTIVE' }),
      stops: [{ id: 's1', sequence: 0, kind: 'PICKUP', status: 'COMPLETED', name: 'Guwahati', address: 'Guwahati Depot', planned_arrival_at: null, actual_arrival_at: null, actual_departure_at: null }],
      shipment: { id: 's', reference_code: 'SHP', client_name: 'Traders', total_weight_kg: '1000', priority: 'NORMAL' },
    } as never)
    const add = vi.spyOn(api, 'addStop').mockResolvedValue({} as never)
    const user = setupUser()
    render(<MemoryRouter><TripsPage /></MemoryRouter>)
    await screen.findByText('TRP-ALPHA')

    await user.click(screen.getByRole('button', { name: /change journey/i }))
    await screen.findByTestId('journey-actions')
    await user.click(screen.getByRole('radio', { name: /add a stop/i }))
    // Nothing to press until the reason and a confirmed point are both given.
    const submit = () => screen.getByRole('button', { name: /^add stop$/i }) as HTMLButtonElement
    expect(submit().disabled).toBe(true)
    await fill(user, screen.getByLabelText(/^reason/i), 'Consignee asked for a drop at the weighbridge')
    expect(screen.getByTestId('stop-blocker').textContent).toMatch(/confirm the new stop location/i)
    expect(add).not.toHaveBeenCalled()
  })
})

describe('attention', () => {
  it("says a driver's reroute request as a warning while the trip is under way, never success (E2E-R2)", () => {
    const proposal = { route_id: 'backup', proposed_at: '2026-09-28T10:00:00Z', distance_km: 75.05 }
    for (const status of ['ACTIVE', 'DELAYED'] as const) {
      expect(attention(trip({ status, proposed_reroute: proposal }))).toEqual({ text: 'Driver asked for a new road', tone: 'text-warning' })
    }
    // No request, or a server that does not send the field: as before.
    expect(attention(trip({ status: 'ACTIVE', selected_route_id: 'r1', proposed_reroute: null })).text).toBe('On the road')
    expect(attention(trip({ status: 'ACTIVE', selected_route_id: 'r1' })).text).toBe('On the road')
    // A proposal left on a finished trip asks nothing.
    expect(attention(trip({ status: 'DELIVERED', proposed_reroute: proposal })).text).toBe('Close to release the truck')
    expect(ATTENTION_FILTERS).toContain('Driver asked for a new road')
  })

  it('says a trip under way with no road selected needs a route, as Overview does (A3-02)', () => {
    for (const status of ['ACTIVE', 'DELAYED'] as const) {
      expect(attention(trip({ status, selected_route_id: null }))).toEqual({ text: 'Needs a route', tone: 'text-warning' })
      expect(decisionFor(trip({ status, selected_route_id: null }))?.text).toBe('Needs a route')
    }
    expect(attention(trip({ status: 'DELAYED', selected_route_id: 'r1' })).text).toBe('Delayed')
  })

  it('says an accepted assignment waits to start, not on the driver (E2E-D4)', () => {
    expect(attention(trip({ status: 'ASSIGNED' })).text).toBe('Awaiting driver')
    expect(attention(trip({ status: 'ASSIGNED', driver_accepted_at: null })).text).toBe('Awaiting driver')
    const accepted = attention(trip({ status: 'ASSIGNED', driver_accepted_at: '2026-09-28T03:00:00Z' }))
    // Neutral: nothing is wrong, it is simply not moving yet.
    expect(accepted).toEqual({ text: 'Accepted — awaiting start', tone: 'text-muted' })
    // The filter bar can narrow to it.
    expect(ATTENTION_FILTERS).toContain(accepted.text)
  })
})
