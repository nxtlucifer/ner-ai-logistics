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

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type Trip } from '../api/client'

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

import TripsPage from './TripsPage'

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

function conflict(message: string) {
  return new ApiError(
    409,
    { error: { code: 'ILLEGAL_TRIP_TRANSITION', message } },
    'fallback',
  )
}

describe('TripsPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({ items: [], next_cursor: null })
    vi.stubGlobal('confirm', () => true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('surfaces a refused Cancel instead of failing silently', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listTrips').mockResolvedValue({
      items: [trip()],
      next_cursor: null,
    })
    vi.spyOn(api, 'cancelTrip').mockRejectedValue(
      conflict('Illegal trip transition ACTIVE -> CANCELLED.'),
    )

    render(<TripsPage />)
    await screen.findByText('TRP-ALPHA')

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    // The manager must be told. Before this was fixed the button simply
    // stopped spinning and the row was unchanged.
    await waitFor(() => {
      expect(
        screen.getByText(/illegal trip transition ACTIVE -> CANCELLED/i),
      ).toBeDefined()
    })
  })

  it('surfaces a refused Close instead of failing silently', async () => {
    const user = userEvent.setup()
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
  it('plans a trip in one atomic request, never shipment-then-trip', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
    vi.spyOn(api, 'listDrivers').mockResolvedValue({
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          user_id: 'u1', full_name: 'Bipul Das', phone: '9435012345',
          photo_url: null, licence_number: 'AS-1234', licence_expiry: '2030-01-01',
          status: 'AVAILABLE', created_at: new Date().toISOString(),
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

    await user.type(screen.getByLabelText(/^client/i), 'Brahmaputra Traders')
    await user.type(screen.getByLabelText(/pickup address/i), 'Depot, Guwahati')
    await user.type(screen.getByLabelText(/destination address/i), 'Yard, Jorhat')
    await user.selectOptions(
      screen.getByRole('combobox', { name: /driver/i }),
      '22222222-2222-4222-8222-222222222222',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: /truck/i }),
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
  })

  it('still surfaces a refused Dispatch', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listTrips').mockResolvedValue({
      items: [trip({ status: 'DRAFT' })],
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
