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

import {
  ApiError,
  api,
  type FleetSnapshot,
  type FleetTrip,
  type Freshness,
  type TripRoute,
} from '../api/client'

// Records what it was handed instead of drawing it.
const plotted = vi.fn()
const plannedRouteSpy = vi.fn()
vi.mock('../components/FleetMap', () => ({
  default: (props: {
    trips: FleetTrip[]
    selectedTripId: string | null
    onSelect: (id: string) => void
    plannedRoute?: [number, number][]
  }) => {
    plotted(props.trips.filter((t) => t.position).map((t) => t.trip_code))
    plannedRouteSpy(props.plannedRoute)
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

/**
 * Open one of the trip-detail tabs.
 *
 * The detail panel groups its sections behind Overview / Route / Cargo /
 * Activity tabs. Before that it rendered every section at once, and the panel
 * was several thousand pixels tall - the defect these tabs exist to fix. So a
 * test that asserts route or activity content now has to open that group, the
 * same as a dispatcher does.
 */
async function openTab(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
): Promise<void> {
  await user.click(await screen.findByRole('tab', { name }))
}


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
    // The fleet snapshot is cached across reloads; a test that expects the
    // empty-and-failed state must not inherit a previous test's snapshot.
    localStorage.clear()
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
      login_is_active: true,
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
    // Selecting a trip reads its planned routes alongside the other detail
    // calls. Empty by default: most of these tests are about the observed
    // track and the map's honesty, and a trip with no planned route is the
    // ordinary case anyway.
    vi.spyOn(api, 'listRoutes').mockResolvedValue([])
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
    // Asserted through the filter's accessible name rather than by walking DOM
    // siblings. The intent - every trip is counted, including the one that has
    // never reported a position - is unchanged; the previous version depended
    // on the count being the immediately preceding node of a label, which is a
    // fact about markup rather than about counting.
    expect(
      screen.getByRole('button', { name: /filter by all trips, 4 trips/i }),
    ).toBeDefined()
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

    // Every one of these is a value an endpoint returned. Driver and truck are
    // the Overview group, which is what the panel opens on; the consignment is
    // one tab away.
    await screen.findByText('9435012345')
    expect(screen.getByText('Tata 1109')).toBeDefined()

    await openTab(user, /cargo/i)
    await screen.findByText('Assam Tea Co-op')
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
    await openTab(user, /activity/i)

    // Route planning now exists, which makes this assertion matter MORE, not
    // less: the observed GPS breadcrumb and a planned route are two different
    // things on the same map, and labelling the breadcrumb a "route" would
    // claim the truck went where it was told rather than where it was seen.
    // Still no ETA anywhere - a provider duration is not an arrival estimate.
    await screen.findByText(/observed trip track/i)
    // The tab bar has a group called "Route" - that names the planned-route
    // group, which IS a route. What must never happen is the observed
    // breadcrumb being called one, so the tab is excluded rather than the
    // assertion being dropped.
    expect(
      screen
        .queryAllByText(/^route$/i)
        .filter((el) => el.getAttribute('role') !== 'tab'),
    ).toEqual([])
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
    await openTab(user, /cargo/i)
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
    await openTab(user, /activity/i)

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

  /**
   * Routing UI (P7).
   *
   * The property under test is the distinction: a PLANNED route and an OBSERVED
   * track must never be presented as the same kind of thing. One is a provider's
   * opinion about where a truck should go; the other is evidence of where it has
   * been. A dispatcher who confuses them acts on a plan believing it is a fact.
   */
  const ROUTE = {
    id: 'r1',
    kind: 'PRIMARY' as const,
    state: 'PROPOSED' as const,
    distance_km: '308.00',
    estimated_duration_min: 360,
    routing_provider: 'osrm',
    created_at: new Date().toISOString(),
    geometry: [
      [26.1445, 91.7362],
      [26.4, 92.9],
      [26.7509, 94.2037],
    ] as [number, number][],
    // Which route the trip is FOLLOWING is the server's answer, not something
    // inferred here from `state` (LS-10). A planned candidate is not current.
    is_current: false,
  }

  it('shows no planned route until one is planned', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    const planRoute = vi.spyOn(api, 'planRoute')

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)

    await screen.findByText(/no route planned for this trip yet/i)
    // Planning calls a third party and writes a row. It must not happen just
    // because someone clicked a truck to look at it.
    expect(planRoute).not.toHaveBeenCalled()
  })

  it('plans a route on request and renders it as PLANNED, not observed', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    const planRoute = vi.spyOn(api, 'planRoute').mockResolvedValue({
      route: ROUTE,
      provider: 'osrm',
      used_fallback: false,
      providers_attempted: ['osrm'],
    })

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)
    await screen.findByText(/no route planned/i)

    await user.click(screen.getByRole('button', { name: /^plan route$/i }))

    await waitFor(() => expect(planRoute).toHaveBeenCalledTimes(1))
    await screen.findByText('308 km')

    // Both sections exist and are labelled distinctly. They are now in
    // different tab groups, which is a stronger separation than being two
    // headings in one column - but each still has to be there.
    expect(screen.getByText(/planned route/i)).toBeDefined()
    await openTab(user, /activity/i)
    expect(screen.getByText(/observed trip track/i)).toBeDefined()
  })

  it('never calls the travel time an ETA', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'listRoutes').mockResolvedValue([ROUTE])

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)

    await screen.findByText(/free-flow travel time/i)
    // The denial has to be present, because a duration beside a live map reads
    // as an arrival time unless something says otherwise.
    expect(screen.getByText(/not an ETA/i)).toBeDefined()
    expect(screen.queryByText(/^ETA$/)).toBeNull()
    expect(screen.queryByText(/arriv(es|al)/i)).toBeNull()
  })

  it('shows no fuel figure, because no fuel model exists', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'listRoutes').mockResolvedValue([ROUTE])

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)
    await screen.findByText(/free-flow travel time/i)

    // Not "0 litres", not "unavailable litres" - no fuel number at all.
    expect(screen.queryByText(/litres/i)).toBeNull()
    expect(screen.queryByText(/\bfuel\b(?!\s*model)/i)).toBeDefined()
  })

  it('surfaces a provider outage instead of drawing nothing silently', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'planRoute').mockRejectedValue(
      new ApiError(
        503,
        {
          error: {
            code: 'ROUTING_UNAVAILABLE',
            message: 'No routing provider is reachable right now.',
          },
        },
        'fallback',
      ),
    )

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)
    await screen.findByText(/no route planned/i)

    await user.click(screen.getByRole('button', { name: /^plan route$/i }))

    await screen.findByText(/no routing provider is reachable/i)
  })

  it('distinguishes an unroutable trip from a provider outage', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'planRoute').mockRejectedValue(
      new ApiError(
        422,
        {
          error: {
            code: 'NO_VIABLE_ROUTE',
            message: "No route could be found between this trip's stops.",
          },
        },
        'fallback',
      ),
    )

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)
    await screen.findByText(/no route planned/i)

    await user.click(screen.getByRole('button', { name: /^plan route$/i }))

    // A different sentence from the outage case. "Cannot be routed" and "the
    // provider is down" are different facts and a manager acts on them
    // differently.
    await screen.findByText(/no route could be found/i)
  })

  it('passes the planned geometry to the map as lat-lon pairs', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'listRoutes').mockResolvedValue([ROUTE])

    render(<FleetPage />)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    // The tab gates the DETAILS panel, not the map: the corridor is handed to
    // the map whichever group is open. Opening Route here is only how the test
    // waits for the route to have loaded.
    await openTab(user, /route/i)
    await screen.findByText(/free-flow travel time/i)

    await waitFor(() => {
      const last = plannedRouteSpy.mock.calls.at(-1)?.[0]
      expect(last).toBeDefined()
      // Guwahati first: latitude ~26, longitude ~91. An inversion here draws
      // the corridor in the wrong hemisphere.
      expect(last[0]).toEqual([26.1445, 91.7362])
    })
  })

  describe('route advisory', () => {
    /**
     * The advisory is a statement ABOUT the planned route: has the road this
     * truck is on got worse, and is there anywhere better to send it.
     *
     * The properties worth testing are the ones about restraint. Nothing is
     * assessed until a dispatcher asks - each check costs several requests to
     * a free weather service - and the trip's route never changes without an
     * explicit second action.
     */
    const ADVISORY_BASE = {
      selected_route_id: 'r1',
      selected_risk_band: 'HIGH',
      reason_codes: [] as string[],
      comparison: null,
      unavailable_inputs: ['landslide'],
      floor_points: 60,
      severe_conditions_points: 35,
      margin_points: 10,
      version: 'reroute-assessment-v1',
    }

    const PROPOSAL = {
      ...ADVISORY_BASE,
      outcome: 'PROPOSE' as const,
      selected_risk_score: 85,
      proposed_route_id: 'r2',
      reason_codes: ['SELECTED_ROUTE_DETERIORATED', 'BETTER_ROUTE_AVAILABLE'],
      comparison: {
        recommended_route_id: 'r2',
        baseline_route_id: 'r1',
        comparable: true,
        reason_codes: ['LOWER_RISK_ALTERNATIVE', 'ALTERNATIVE_IS_SLOWER'],
        tradeoff: {
          duration_delta_min: 23,
          distance_delta_km: 21,
          risk_delta_points: -33,
        },
        candidates: [],
        unavailable_inputs: ['landslide'],
        margin_points: 10,
        version: 'explainable-route-recommendation-v1',
      },
    }

    async function openTrip() {
      const user = userEvent.setup()
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
      vi.spyOn(api, 'listRoutes').mockResolvedValue([ROUTE])
      render(<FleetPage />)
      await screen.findByText('TRP-LIVE')
      await user.click(screen.getByTestId('marker-TRP-LIVE'))
      await openTab(user, /route/i)
      await screen.findByText(/free-flow travel time/i)
      return user
    }

    it('assesses nothing until a dispatcher asks', async () => {
      // One assessment costs up to ten requests to a free weather service.
      // Firing it because someone clicked a truck would spend that budget on
      // idle curiosity, and polling it would multiply it by every open tab.
      const spy = vi.spyOn(api, 'rerouteAssessment')
      await openTrip()

      expect(screen.getByText(/not assessed/i)).toBeDefined()
      expect(spy).not.toHaveBeenCalled()
    })

    it('reports no change when the road is fine', async () => {
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue({
        ...ADVISORY_BASE,
        outcome: 'NO_ACTION',
        selected_risk_score: 22,
        selected_risk_band: 'LOW',
        proposed_route_id: null,
        reason_codes: ['SELECTED_ROUTE_WITHIN_TOLERANCE'],
      })
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))

      expect(await screen.findByText(/no change advised/i)).toBeDefined()
      expect(screen.queryByRole('button', { name: /accept and reroute/i })).toBeNull()
    })

    it('says so when the road is bad and there is nowhere better', async () => {
      // The case a propose-or-stay-silent design has no words for, and the
      // common one on a single corridor.
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue({
        ...ADVISORY_BASE,
        outcome: 'ALERT_ONLY',
        selected_risk_score: 88,
        proposed_route_id: null,
        reason_codes: ['SELECTED_ROUTE_DETERIORATED', 'NO_BETTER_ALTERNATIVE'],
      })
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))

      expect(await screen.findByText(/no better route exists/i)).toBeDefined()
      expect(screen.getByText(/contact the driver/i)).toBeDefined()
      // No button, because there is nothing to accept.
      expect(screen.queryByRole('button', { name: /accept and reroute/i })).toBeNull()
    })

    it('shows the tradeoff in minutes, kilometres and points, never a percentage', async () => {
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue(PROPOSAL)
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))

      expect(await screen.findByText(/lower-risk route is available/i)).toBeDefined()
      expect(screen.getByText(/-33 points/i)).toBeDefined()
      expect(screen.getByText(/\+23 min/i)).toBeDefined()
      expect(screen.getByText(/\+21 km/i)).toBeDefined()
      // "54% safer" is a claim about probability of harm that nothing in this
      // system measures.
      //
      // SCOPED TO THE ADVISORY, deliberately. This used to be a page-wide ban
      // on the "%" character, which passed only because no other percentage
      // happened to exist on the screen - it broke the moment the KPI strip
      // gained a fleet-utilisation figure, which is a real measured ratio and
      // has nothing to do with risk. The claim being guarded is about THIS
      // panel, so this is where it is now checked.
      const advisory = screen.getByTestId('reroute-advisory')
      expect(advisory.textContent).not.toMatch(/%/)
    })

    it('does not reroute until the dispatcher accepts', async () => {
      const accept = vi.spyOn(api, 'acceptReroute')
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue(PROPOSAL)
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))
      await screen.findByText(/lower-risk route is available/i)

      // Rendering a proposal must not be the same thing as applying it.
      expect(accept).not.toHaveBeenCalled()
      expect(screen.getByText(/nothing changes until you accept/i)).toBeDefined()
    })

    it('sends the route that was on screen as the one being left', async () => {
      // The stale-screen guard. If the trip has since been rerouted by someone
      // else, the server answers 409 rather than moving it off a road this
      // manager never saw - which only works if the id sent is the one they
      // were shown.
      const accept = vi.spyOn(api, 'acceptReroute').mockResolvedValue({
        trip_id: LIVE.trip_id,
        previous_route_id: 'r1',
        selected_route_id: 'r2',
        selected_route_kind: 'EMERGENCY_BACKUP',
      })
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue(PROPOSAL)
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))
      await screen.findByText(/lower-risk route is available/i)
      await user.click(screen.getByRole('button', { name: /accept and reroute/i }))

      await waitFor(() => {
        expect(accept).toHaveBeenCalledWith(LIVE.trip_id, 'r1', 'r2')
      })
    })

    it('re-assesses after accepting rather than leaving the old proposal up', async () => {
      // The trip is now on a different road, so every figure in the advisory
      // describes the wrong one. Leaving it on screen would invite a second
      // click the server would refuse.
      vi.spyOn(api, 'acceptReroute').mockResolvedValue({
        trip_id: LIVE.trip_id,
        previous_route_id: 'r1',
        selected_route_id: 'r2',
        selected_route_kind: 'EMERGENCY_BACKUP',
      })
      const assess = vi
        .spyOn(api, 'rerouteAssessment')
        .mockResolvedValueOnce(PROPOSAL)
        .mockResolvedValueOnce({
          ...ADVISORY_BASE,
          outcome: 'NO_ACTION',
          selected_route_id: 'r2',
          selected_risk_score: 28,
          selected_risk_band: 'LOW',
          proposed_route_id: null,
          reason_codes: ['SELECTED_ROUTE_WITHIN_TOLERANCE'],
        })

      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))
      await screen.findByText(/lower-risk route is available/i)
      await user.click(screen.getByRole('button', { name: /accept and reroute/i }))

      expect(await screen.findByText(/no change advised/i)).toBeDefined()
      expect(assess).toHaveBeenCalledTimes(2)
      expect(screen.queryByText(/lower-risk route is available/i)).toBeNull()
    })

    it('surfaces a refused reroute instead of pretending it worked', async () => {
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue(PROPOSAL)
      vi.spyOn(api, 'acceptReroute').mockRejectedValue(
        new ApiError(
          409,
          {
            error: {
              code: 'ROUTE_SUPERSEDED',
              message: 'This trip route changed while you were deciding.',
              details: {},
              request_id: 'x',
            },
          },
          'x',
        ),
      )
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))
      await screen.findByText(/lower-risk route is available/i)
      await user.click(screen.getByRole('button', { name: /accept and reroute/i }))

      expect(await screen.findByText(/changed while you were deciding/i)).toBeDefined()
    })

    it('names the datasets the advisory was made without', async () => {
      // A dispatcher reading a recommendation needs to know it was made with
      // no landslide data.
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue(PROPOSAL)
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))

      expect(await screen.findByText(/assessed without/i)).toBeDefined()
    })

    it('warns when the scores were not comparable', async () => {
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue({
        ...PROPOSAL,
        outcome: 'ALERT_ONLY' as const,
        proposed_route_id: null,
        comparison: {
          ...PROPOSAL.comparison,
          comparable: false,
          reason_codes: ['RISK_INPUTS_NOT_COMPARABLE'],
        },
      })
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))

      expect(
        await screen.findByText(/assessed on different information/i),
      ).toBeDefined()
    })

    it('calls itself a rule, not a prediction', async () => {
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue(PROPOSAL)
      const user = await openTrip()
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))

      // The only mention of prediction is the DENIAL of one. Asserting the
      // word never appears would have been the wrong test - and did fail on
      // the disclaimer itself, which is the sentence doing the work here.
      expect(await screen.findByText(/deterministic rule/i)).toBeDefined()
      expect(screen.getByText(/not a prediction/i)).toBeDefined()
      expect(screen.queryByText(/confidence/i)).toBeNull()
      // Not asserted: /accuracy/. The panel legitimately shows GPS accuracy,
      // which is a measured metres figure from the device and has nothing to
      // do with a model metric. A test that banned the word would be banning
      // a real measurement to catch a claim nobody is making.
      expect(screen.queryByText(/model.version/i)).toBeNull()
    })
  })

  describe('choosing which route the trip follows', () => {
    /**
     * Selecting a route is the hinge between planning and execution, and it
     * had no UI at all: `api.selectRoute` existed and nothing called it.
     *
     * That is not a cosmetic gap. `trips.selected_route_id` is what the
     * driver's progress is measured against, what the reroute advisory
     * compares alternatives to, and what the offline package downloads. With
     * nothing able to set it, all three quietly report their empty states and
     * look like features that do not work.
     */
    const PROPOSED = {
      ...ROUTE,
      id: 'r1',
      state: 'PROPOSED' as const,
    }
    const SELECTED = {
      ...ROUTE,
      id: 'r1',
      state: 'SELECTED' as const,
      // The server marks the trip's own selection. Set here because the real
      // response does, not to satisfy the assertion below.
      is_current: true,
    }

    // Typed as TripRoute, not `typeof ROUTE`: the fixture's literal `state`
    // narrows to 'PROPOSED', and this helper is handed SELECTED routes too.
    async function openWith(routes: TripRoute[]) {
      const user = userEvent.setup()
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
      vi.spyOn(api, 'listRoutes').mockResolvedValue(routes)
      render(<FleetPage />)
      await screen.findByText('TRP-LIVE')
      await user.click(screen.getByTestId('marker-TRP-LIVE'))
      await openTab(user, /route/i)
      await screen.findByText(/free-flow travel time/i)
      return user
    }

    it('offers a way to select a planned route', async () => {
      await openWith([PROPOSED])
      expect(
        screen.getByRole('button', { name: /use this route/i }),
      ).toBeDefined()
    })

    it('sets the trip route through the server', async () => {
      const select = vi.spyOn(api, 'selectRoute').mockResolvedValue(SELECTED)
      const user = await openWith([PROPOSED])

      await user.click(screen.getByRole('button', { name: /use this route/i }))

      await waitFor(() => {
        expect(select).toHaveBeenCalledWith(LIVE.trip_id, 'r1')
      })
    })

    it('says which route the trip is following once one is chosen', async () => {
      // Without this a manager cannot tell a planned route from the one the
      // driver is actually being measured against, which is the distinction
      // the whole reroute feature turns on.
      await openWith([SELECTED])
      expect(screen.getByText(/following this route/i)).toBeDefined()
      expect(
        screen.queryByRole('button', { name: /use this route/i }),
      ).toBeNull()
    })

    it('surfaces a refusal instead of pretending the route was set', async () => {
      vi.spyOn(api, 'selectRoute').mockRejectedValue(
        new ApiError(
          409,
          {
            error: {
              code: 'ROUTE_SUPERSEDED',
              message: 'That route has been superseded.',
              details: {},
              request_id: 'x',
            },
          },
          'x',
        ),
      )
      const user = await openWith([PROPOSED])
      await user.click(screen.getByRole('button', { name: /use this route/i }))

      expect(await screen.findByText(/superseded/i)).toBeDefined()
    })
  })
})
