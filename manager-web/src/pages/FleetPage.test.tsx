/**
 * The fleet operations screen.
 *
 * The property that matters most here is NEGATIVE: a truck that has never
 * reported must never appear on the map. There is no coordinate for it, and
 * plotting it anywhere - a depot, the region centre - would put a truck on a
 * dispatcher's screen in a place nobody has observed it. That is the sort of
 * thing which looks fine in a demo and is acted on in an incident.
 *
 * The map itself is stood in for. MapLibre needs WebGL, which jsdom does not
 * have; the substitute records exactly what it was asked to plot, which is the
 * thing under test. The map's own rendering is not what these tests are about.
 */

// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type FleetSnapshot, type FleetTrip, type Freshness } from '../api/client'

// Records what it was handed instead of drawing it.
const plotted = vi.fn()
vi.mock('../components/FleetMap', () => ({
  default: (props: {
    trips: FleetTrip[]
    selectedTripId: string | null
    onSelect: (id: string) => void
  }) => {
    plotted(props.trips.filter((t) => t.position).map((t) => t.trip_code))
    return (
      <div data-testid="map">
        {props.trips
          .filter((t) => t.position)
          .map((t) => (
            <button
              key={t.trip_id}
              data-testid={`marker-${t.trip_code}`}
              onClick={() => props.onSelect(t.trip_id)}
            >
              {t.registration_number}
            </button>
          ))}
      </div>
    )
  },
}))

import { FLEET_POLL_MS } from '../hooks/useFleetPoll'
import FleetPage from './FleetPage'

function position(ageSeconds: number, freshness: Freshness) {
  return {
    location: { lat: 26.1445, lon: 91.7362 },
    recorded_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    age_seconds: ageSeconds,
    freshness,
    speed_kmph: 42.5,
    heading_deg: 118,
    accuracy_m: 8.4,
    is_mock_location: false,
  }
}

function trip(overrides: Partial<FleetTrip> = {}): FleetTrip {
  return {
    trip_id: '11111111-1111-4111-8111-111111111111',
    trip_code: 'TRP-LIVE',
    trip_status: 'ACTIVE',
    driver_id: '22222222-2222-4222-8222-222222222222',
    driver_name: 'Bipul Das',
    truck_id: '33333333-3333-4333-8333-333333333333',
    registration_number: 'AS01AB1234',
    started_at: new Date().toISOString(),
    position: position(12, 'LIVE'),
    freshness: 'LIVE',
    next_stop_sequence: 1,
    next_stop_name: 'Delivery',
    stops_done: 1,
    stops_total: 2,
    ...overrides,
  }
}

function snapshot(trips: FleetTrip[]): FleetSnapshot {
  return {
    trips,
    fresh_seconds: 90,
    stale_seconds: 600,
    server_time: new Date().toISOString(),
  }
}

const LIVE = trip()
const STALE = trip({
  trip_id: '44444444-4444-4444-8444-444444444444',
  trip_code: 'TRP-STALE',
  registration_number: 'AS02CD5678',
  driver_name: 'Ratan Boro',
  position: position(300, 'STALE'),
  freshness: 'STALE',
})
const NO_CONTACT = trip({
  trip_id: '55555555-5555-4555-8555-555555555555',
  trip_code: 'TRP-SILENT',
  registration_number: 'AS03EF9012',
  driver_name: 'Hemanta Kalita',
  position: position(1200, 'NO_CONTACT'),
  freshness: 'NO_CONTACT',
})
const NEVER_REPORTED = trip({
  trip_id: '66666666-6666-4666-8666-666666666666',
  trip_code: 'TRP-NOFIX',
  registration_number: 'AS04GH3456',
  driver_name: 'Jyoti Nath',
  position: null,
  freshness: 'NO_LOCATION',
})

describe('FleetPage', () => {
  beforeEach(() => {
    plotted.mockClear()
    vi.spyOn(api, 'getTrip').mockResolvedValue({
      id: LIVE.trip_id,
      trip_code: LIVE.trip_code,
      shipment_id: 'x',
      truck_id: LIVE.truck_id,
      driver_id: LIVE.driver_id,
      status: 'ACTIVE',
      selected_route_id: null,
      dispatched_at: null,
      started_at: null,
      delivered_at: null,
      planned_eta: null,
      current_eta: null,
      delay_minutes: null,
      created_at: new Date().toISOString(),
      stops: [
        {
          id: 's1',
          sequence: 0,
          kind: 'PICKUP',
          status: 'COMPLETED',
          name: 'Pickup',
          address: 'Depot, Guwahati',
          planned_arrival_at: null,
          actual_arrival_at: null,
          actual_departure_at: null,
        },
        {
          id: 's2',
          sequence: 1,
          kind: 'DROPOFF',
          status: 'PENDING',
          name: 'Delivery',
          address: 'Yard, Jorhat',
          planned_arrival_at: null,
          actual_arrival_at: null,
          actual_departure_at: null,
        },
      ],
      shipment: {
        id: 'sh1',
        reference_code: 'SHP-42',
        client_name: 'Assam Tea Co-op',
        total_weight_kg: '9000.00',
        priority: 'NORMAL',
      },
    })
    vi.spyOn(api, 'getDriver').mockResolvedValue({
      id: LIVE.driver_id,
      user_id: 'u1',
      full_name: 'Bipul Das',
      phone: '9435012345',
      photo_url: null,
      licence_number: 'AS-1234',
      licence_expiry: '2030-01-01',
      status: 'ON_TRIP',
      created_at: new Date().toISOString(),
    })
    vi.spyOn(api, 'getTruck').mockResolvedValue({
      id: LIVE.truck_id,
      registration_number: 'AS01AB1234',
      truck_type: 'Open body',
      make: 'Tata',
      model: '1109',
      max_capacity_kg: '16000.00',
      current_load_kg: '9000.00',
      status: 'ON_TRIP',
      baseline_mileage_kmpl: null,
      created_at: new Date().toISOString(),
    })
    vi.spyOn(api, 'tripTrack').mockResolvedValue({
      trip_id: LIVE.trip_id,
      points: [position(12, 'LIVE'), position(30, 'LIVE')],
      truncated: false,
    })
  })

  afterEach(() => {
    // Explicit: Testing Library only registers its own auto-cleanup when
    // vitest globals are enabled, and they are not. Without this every render
    // stays in the document and the next test finds two of everything.
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a loading state before the first answer', async () => {
    vi.spyOn(api, 'activeFleet').mockImplementation(
      () => new Promise(() => undefined),
    )
    render(<FleetPage />)
    expect(screen.getByText(/loading the fleet/i)).toBeDefined()
  })

  it('shows a useful empty state when nothing is on the road', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([]))
    render(<FleetPage />)

    await screen.findByText(/no trips on the road/i)
    expect(screen.getByText(/dispatch a trip/i)).toBeDefined()
  })

  it('surfaces a backend failure when there is no data to show', async () => {
    vi.spyOn(api, 'activeFleet').mockRejectedValue(new Error('down'))
    render(<FleetPage />)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeDefined(),
    )
  })

  it('renders each freshness state from the server, not recomputed', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(
      snapshot([LIVE, STALE, NO_CONTACT, NEVER_REPORTED]),
    )
    render(<FleetPage />)

    await screen.findByText('TRP-LIVE')
    const table = screen.getByRole('table')
    expect(within(table).getByText('LIVE')).toBeDefined()
    expect(within(table).getByText('STALE')).toBeDefined()
    expect(within(table).getByText('NO CONTACT')).toBeDefined()
    expect(within(table).getByText('NO LOCATION')).toBeDefined()
  })

  it('never plots a truck that has not reported a position', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(
      snapshot([LIVE, NEVER_REPORTED]),
    )
    render(<FleetPage />)

    await screen.findByText('TRP-NOFIX')
    // Listed, so a dispatcher knows it exists...
    expect(screen.getByText('TRP-NOFIX')).toBeDefined()
    // ...but never given a coordinate on the map.
    const lastPlot = plotted.mock.calls.at(-1)?.[0] as string[]
    expect(lastPlot).toContain('TRP-LIVE')
    expect(lastPlot).not.toContain('TRP-NOFIX')
    expect(screen.queryByTestId('marker-TRP-NOFIX')).toBeNull()
  })

  it('counts every trip, including ones with no position', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(
      snapshot([LIVE, STALE, NO_CONTACT, NEVER_REPORTED]),
    )
    render(<FleetPage />)

    await screen.findByText('TRP-LIVE')
    const activeCount = screen.getByText('Active trips').previousSibling
    expect(activeCount?.textContent).toBe('4')
  })

  it('filters the list and the map together', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(
      snapshot([LIVE, STALE, NEVER_REPORTED]),
    )
    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')

    await user.click(screen.getByRole('button', { name: /filter by stale/i }))

    await waitFor(() => expect(screen.queryByText('TRP-LIVE')).toBeNull())
    expect(screen.getByText('TRP-STALE')).toBeDefined()
    // The map sees the same filtered set - one screen, one truth.
    const lastPlot = plotted.mock.calls.at(-1)?.[0] as string[]
    expect(lastPlot).toEqual(['TRP-STALE'])
  })

  it('searches by registration and by driver name', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE, STALE]))
    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')

    const box = screen.getByPlaceholderText(/search registration/i)
    await user.type(box, 'AS02')
    await waitFor(() => expect(screen.queryByText('TRP-LIVE')).toBeNull())
    expect(screen.getByText('TRP-STALE')).toBeDefined()

    await user.clear(box)
    await user.type(box, 'Ratan')
    await waitFor(() => expect(screen.getByText('TRP-STALE')).toBeDefined())
    expect(screen.queryByText('TRP-LIVE')).toBeNull()
  })

  it('says so when a filter matches nothing, and offers a way out', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')

    await user.type(screen.getByPlaceholderText(/search registration/i), 'zzzz')

    await screen.findByText(/nothing matches/i)
    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    await screen.findByText('TRP-LIVE')
  })

  it('opens a detail panel of real API data when a marker is selected', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')

    await user.click(screen.getByTestId('marker-TRP-LIVE'))

    // Every one of these is a value an endpoint returned.
    await screen.findByText('Assam Tea Co-op')
    expect(screen.getByText('9435012345')).toBeDefined()
    expect(screen.getByText('Tata 1109')).toBeDefined()
    expect(screen.getByText('Depot, Guwahati')).toBeDefined()
    expect(screen.getByText('Yard, Jorhat')).toBeDefined()
    expect(screen.getByText('9,000 kg')).toBeDefined()
  })

  it('calls the observed track a track, never a route', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')

    await user.click(screen.getByTestId('marker-TRP-LIVE'))

    // Routing does not exist until P7. Calling a GPS breadcrumb a "route"
    // would claim a feature that has not been built.
    await screen.findByText(/observed trip track/i)
    expect(screen.queryByText(/^route$/i)).toBeNull()
    expect(screen.queryByText(/\beta\b/i)).toBeNull()
  })

  it('keeps the selection across a refresh', async () => {
    const user = userEvent.setup()
    const moved = {
      ...LIVE,
      position: { ...position(3, 'LIVE'), location: { lat: 26.2, lon: 91.8 } },
    }
    vi.spyOn(api, 'activeFleet')
      .mockResolvedValueOnce(snapshot([LIVE]))
      .mockResolvedValue(snapshot([moved]))

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await screen.findByText('Assam Tea Co-op')

    // A poll must not close the panel the operator is reading.
    await waitFor(() => expect(screen.getByText('Assam Tea Co-op')).toBeDefined())
  })

  it('explains, rather than hides, a truck with no position when selected', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([NEVER_REPORTED]))
    render(<FleetPage />)
    await screen.findByText('TRP-NOFIX')

    await user.click(screen.getByText('TRP-NOFIX'))

    await screen.findByText(/has not reported a position yet/i)
  })

  /**
   * A background poll must not re-fetch the detail panel.
   *
   * The panel's four reads are keyed to the SELECTION. Keying them to the
   * fleet row object instead re-runs them on every poll, because each poll
   * parses fresh JSON and therefore hands back a new object for the same
   * trip. The visible cost is the panel dropping to "Loading trip details…"
   * and the map's breadcrumb blanking every ten seconds; the invisible cost
   * is four extra requests per tick per open dashboard.
   *
   * Fake timers throughout, and `act` rather than `waitFor`: Testing
   * Library's async helpers detect only jest's fake timers, so they would
   * hang here. `advanceTimersByTimeAsync` flushes microtasks, which is what
   * settles the mocked fetches.
   */
  it('does not re-fetch the detail panel on a background poll', async () => {
    // A NEW object per call, as the real client produces - the whole point.
    vi.spyOn(api, 'activeFleet').mockImplementation(async () =>
      snapshot([{ ...LIVE, position: position(12, 'LIVE') }]),
    )

    vi.useFakeTimers()
    try {
      render(<FleetPage />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })

      fireEvent.click(screen.getByText('TRP-LIVE'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(api.getTrip).toHaveBeenCalledTimes(1)

      const pollsBefore = vi.mocked(api.activeFleet).mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(FLEET_POLL_MS + 1) })

      // The poll really happened...
      expect(vi.mocked(api.activeFleet).mock.calls.length).toBeGreaterThan(
        pollsBefore,
      )
      // ...and the panel did not re-fetch behind it.
      expect(api.getTrip).toHaveBeenCalledTimes(1)
      expect(api.getDriver).toHaveBeenCalledTimes(1)
      expect(api.getTruck).toHaveBeenCalledTimes(1)
      expect(api.tripTrack).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
