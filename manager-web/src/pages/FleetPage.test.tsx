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
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  api,
  type Emergency,
  type FleetSnapshot,
  type FleetTrip,
  type Freshness,
  type RouteRecommendation,
  type TripRoute,
} from '../api/client'

// The page asks who is looking so it can say whose fleet this is. These
// tests are about the map, not the session, so the role is a fixture.
const role = { current: 'MANAGER' }
// Permissions a test takes away; everything else is held.
const denied = new Set<string>()
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: role.current, display_name: 'Test Manager', email: null, phone: null },
    isInitialising: false,
    logout: vi.fn(),
    can: (p: string) => !denied.has(p),
  }),
}))

// Records what it was handed instead of drawing it.
const plotted = vi.fn()
const plannedRouteSpy = vi.fn()
const mapProps = vi.fn()
const mapMounts = { n: 0 }
vi.mock('../components/FleetMap', () => ({
  default: (props: {
    trips: FleetTrip[]
    selectedTripId: string | null
    onSelect: (id: string) => void
    plannedRoute?: [number, number][]
  }) => {
    plotted(props.trips.filter((t) => t.position).map((t) => t.trip_code))
    plannedRouteSpy(props.plannedRoute)
    mapProps(props)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      mapMounts.n += 1
    }, [])
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
import { markOnline } from '../api/connectivity'
import { EmergencyProvider } from '../hooks/EmergencyProvider'
import { MemoryRouter } from 'react-router-dom'

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
  trucks_total: 4,
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
    role.current = 'MANAGER'
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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    expect(screen.getByText(/loading the fleet/i)).toBeDefined()
  })

  describe('full screen map (company showcase add-on)', () => {
    it('Expand fleet map fills the window on the same map, keeps the filters, and Escape leaves it', async () => {
      const poll = vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE, STALE]))
      const user = userEvent.setup()
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
      await screen.findByTestId('marker-TRP-LIVE')
      // A filter set before expanding survives full screen and back.
      await user.click(screen.getByRole('button', { name: /Filter by STALE/ }))
      const mounts = mapMounts.n
      const calls = poll.mock.calls.length
      const card = screen.getByTestId('map-card')
      expect(card.getAttribute('data-fullscreen')).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Expand fleet map' }))
      expect(card.getAttribute('data-fullscreen')).toBe('true')
      expect(card.className).toContain('fixed')
      // The filters ride in the full-screen header, still set.
      expect(within(card).getByRole('button', { name: /Filter by STALE/ }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getAllByRole('group', { name: 'Filter trips by position freshness' })).toHaveLength(1)
      expect(within(card).queryByTestId('marker-TRP-LIVE')).toBeNull()
      expect(within(card).getByTestId('marker-TRP-STALE')).toBeTruthy()
      const exit = within(card).getByRole('button', { name: 'Exit full screen' })
      expect(exit.getAttribute('type')).toBe('button')
      await user.keyboard('{Escape}')
      expect(card.getAttribute('data-fullscreen')).toBeNull()
      expect(screen.getByRole('button', { name: /Filter by STALE/ }).getAttribute('aria-pressed')).toBe('true')
      // A layout change: no second map and no extra fleet poll.
      expect(mapMounts.n).toBe(mounts)
      expect(poll.mock.calls.length).toBe(calls)
    })

    it('keeps the selected truck and shows it compactly, GPS freshness from the server label', async () => {
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE, STALE]))
      const user = userEvent.setup()
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
      await user.click(await screen.findByTestId('marker-TRP-STALE'))
      await user.click(screen.getByRole('button', { name: 'Expand fleet map' }))
      expect(mapProps.mock.lastCall![0].selectedTripId).toBe(STALE.trip_id)
      const box = screen.getByTestId('fullscreen-selected')
      expect(box.textContent).toContain('AS02CD5678')
      expect(box.textContent).toContain('STALE')
      expect(box.textContent).toContain('5 min ago')
      // A stale fix is never shown as live.
      expect(box.textContent).not.toContain('LIVE')
      await user.click(screen.getByRole('button', { name: 'Exit full screen' }))
      expect(screen.queryByTestId('fullscreen-selected')).toBeNull()
      expect(mapProps.mock.lastCall![0].selectedTripId).toBe(STALE.trip_id)
      expect(screen.getByRole('button', { name: 'Expand fleet map' })).toBeTruthy()
    })

    it('shows only trucks the server returned for this manager (scope unchanged)', async () => {
      role.current = 'DISTRICT_MANAGER'
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
      const user = userEvent.setup()
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
      await screen.findByTestId('marker-TRP-LIVE')
      await user.click(screen.getByRole('button', { name: 'Expand fleet map' }))
      expect(mapProps.mock.lastCall![0].trips.map((t: FleetTrip) => t.trip_code)).toEqual(['TRP-LIVE'])
    })
  })

  describe('a driver on a break (nav-break add-on)', () => {
    const onBreak = (status: 'ACTIVE' | 'OVERDUE') => ({
      id: 'b1', trip_id: STALE.trip_id, driver_id: STALE.driver_id, truck_id: STALE.truck_id, status, reason: 'FOOD' as const, note: null,
      planned_minutes: 30, started_at: new Date().toISOString(), expected_end_at: new Date(Date.now() + 20 * 60_000).toISOString(),
      ended_at: null, actual_seconds: null, overdue: status === 'OVERDUE', location: { lat: 26.1445, lon: 91.7362 }, location_source: 'PHONE', location_at: null,
    })

    it('is shown as a break beside the GPS freshness, never instead of it', async () => {
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE, { ...STALE, on_break: onBreak('ACTIVE') }]))
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
      await screen.findByTestId('marker-TRP-STALE')
      const row = screen.getByText('TRP-STALE').closest('tr')!
      expect(within(row).getByText('ON BREAK')).toBeTruthy()
      expect(within(row).getByText('STALE')).toBeTruthy() // stale GPS still says stale
      const live = screen.getByText('TRP-LIVE').closest('tr')!
      expect(within(live).queryByText('ON BREAK')).toBeNull()
      // The map is handed the break, to label and dash the marker.
      expect(mapProps.mock.lastCall![0].trips.find((t: FleetTrip) => t.trip_code === 'TRP-STALE').on_break.status).toBe('ACTIVE')
    })

    it('an overrun break says so, in the list and in the full-screen card', async () => {
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([{ ...STALE, on_break: onBreak('OVERDUE') }]))
      const user = userEvent.setup()
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
      await user.click(await screen.findByTestId('marker-TRP-STALE'))
      expect(screen.getByText('BREAK OVERRAN')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Expand fleet map' }))
      expect(screen.getByTestId('fullscreen-break').textContent).toMatch(/^Break overran · Food · 30 min · due back /)
    })

    it("the trip's Activity tab lists its breaks with the place", async () => {
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([{ ...STALE, on_break: onBreak('ACTIVE') }]))
      const breaks = vi.spyOn(api, 'tripBreaks').mockResolvedValue([onBreak('ACTIVE')])
      const user = userEvent.setup()
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
      await user.click(await screen.findByTestId('marker-TRP-STALE'))
      await openTab(user, /activity/i)
      const list = await screen.findByTestId('break-history')
      expect(breaks).toHaveBeenCalledWith(STALE.trip_id)
      expect(list.textContent).toContain('Food · 30 min planned')
      expect(list.textContent).toContain('Stopped at 26.1445, 91.7362')
    })
  })

  it('says whose fleet this is, so an empty map is not read as a quiet region', async () => {
    // A district manager seeing "no trips on the road" is being told
    // something true about their district and false about the North-East.
    role.current = 'DISTRICT_MANAGER'
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([]))
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

    await screen.findByText(/no trips on the road/i)
    expect(screen.getByText(/trips your district is an origin or a destination for/i)).toBeDefined()
  })

  it('claims no scope for a fleet-wide manager', async () => {
    role.current = 'MANAGER'
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([]))
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

    await screen.findByText(/no trips on the road/i)
    expect(screen.queryByText(/origin or a destination for/i)).toBeNull()
  })

  it("says a driver asked for a new road on the row and opens that trip's Route tab (E2E-R2)", async () => {
    const asked = trip({ proposed_reroute: { route_id: 'backup', proposed_at: new Date().toISOString(), distance_km: 75.05 } })
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([asked, STALE]))
    const user = userEvent.setup()
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

    const note = await screen.findByText('Driver asked for a new road')
    expect(note.className).toContain('text-warning')
    // Only the trip that asked.
    expect(screen.getAllByText('Driver asked for a new road')).toHaveLength(1)
    const go = screen.getByRole('button', { name: 'Review new road' })
    expect(go.getAttribute('aria-describedby')).toBe(note.id)
    await user.click(go)
    expect((await screen.findByRole('tab', { name: 'Route' })).getAttribute('aria-selected')).toBe('true')
    // The details panel says it too, beside the existing Route options action.
    const detail = await screen.findByTestId('reroute-asked')
    expect(detail.textContent).toMatch(/Driver asked for a new road.*75\.05 km from where the truck was/)
    expect(screen.getByRole('button', { name: /route options/i }).getAttribute('aria-describedby')).toBe(detail.querySelector('p')!.id)
  })

  it('arrives from the Trips page on the Route tab of the trip it was sent (E2E-R2)', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    render(
      <MemoryRouter initialEntries={[{ pathname: '/fleet', state: { tripId: LIVE.trip_id, tab: 'route' } }]}>
        <FleetPage />
      </MemoryRouter>,
    )
    expect((await screen.findByRole('tab', { name: 'Route' })).getAttribute('aria-selected')).toBe('true')
  })

  it('shows a useful empty state when nothing is on the road', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([]))
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

    await screen.findByText(/no trips on the road/i)
    expect(screen.getByText(/dispatch a trip/i)).toBeDefined()
  })

  it('surfaces a backend failure when there is no data to show', async () => {
    vi.spyOn(api, 'activeFleet').mockRejectedValue(new Error('down'))
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeDefined(),
    )
  })

  it('shows the Sentinel banner from the one SOS list the shell polls', async () => {
    // The page no longer asks for emergencies itself: it reads the list the
    // shell polls for the topbar badge, so the two cannot disagree.
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    const poll = vi.spyOn(api, 'activeEmergencies').mockResolvedValue([
      { id: 'e1', trip_id: LIVE.trip_id, state: 'SOS_ESCALATED', triggered_at: '', stationary_since: '' },
    ] as Emergency[])
    render(<MemoryRouter><EmergencyProvider><FleetPage /></EmergencyProvider></MemoryRouter>)

    expect(await screen.findByText(/Fleet Sentinel Alert: 1 Active Incident/)).toBeDefined()
    expect(poll).toHaveBeenCalledTimes(1)
  })

  // The dossier reads the keys sentinel.build_briefing_snapshot writes; these
  // shapes are its output for the backend's own fixtures (test_sentinel's
  // completeness case and test_driver_sos_emergency's no-position stop).
  async function openDossier(briefing: Record<string, unknown>) {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([
      { id: 'e1', trip_id: LIVE.trip_id, state: 'SOS_ESCALATED', triggered_at: '', stationary_since: '', briefing_snapshot: briefing },
    ] as Emergency[])
    render(<MemoryRouter><EmergencyProvider><FleetPage /></EmergencyProvider></MemoryRouter>)
    const banner = (await screen.findByRole('button', { name: /view incident dossier/i })).closest('[role="alert"]') as HTMLElement
    fireEvent.click(within(banner).getByRole('button', { name: /view incident dossier/i }))
    return { banner, dossier: screen.getByRole('dialog') }
  }

  const SENTINEL_BRIEFING = {
    trip_code: 'TRIP-TEST-001',
    escalated_at: '2026-09-09T12:00:00+00:00',
    escalation_reason: 'Driver uncontactable: 30-minute check-in deadline expired without response',
    driver: { name: 'Ramesh Sharma', phone: '+919435012345', emergency_contact_name: 'Sunita Sharma', emergency_contact_phone: '+919435098765' },
    truck: { registration: 'AS-01-AB-1234', model: 'Tata Signa 2823.K' },
    cargo: { priority: 'CRITICAL', weight_kg: 15000.0 },
    route: { origin: 'Guwahati Central Hub', destination: 'Jorhat Distribution Depot' },
    location: {
      lat: 26.1445, lon: 91.7362,
      fix_recorded_at: '2026-09-09T11:55:00+00:00', fix_age_seconds: 300.0,
      stopped_since: '2026-09-09T10:55:00+00:00', stopped_duration_minutes: 65.0,
    },
    suggested_actions: ['1. Attempt voice contact with driver at +919435012345'],
  }

  it('fills the Sentinel dossier from the route and location the server writes', async () => {
    const { banner, dossier } = await openDossier(SENTINEL_BRIEFING)

    expect(within(banner).getByText(/Fleet Sentinel Alert: 1 Active Incident/)).toBeDefined()
    expect(within(dossier).getByText('Guwahati Central Hub → Jorhat Distribution Depot')).toBeDefined()
    expect(within(dossier).getByText('LAT: 26.144500, LON: 91.736200')).toBeDefined()
    expect(within(dossier).getByText('Stationary for: ~65 minutes')).toBeDefined()
    expect(within(dossier).getByText(`Last fix received: ${new Date('2026-09-09T11:55:00+00:00').toLocaleString()}`)).toBeDefined()
    expect(within(dossier).queryByText(/Coordinates recorded in telemetry/)).toBeNull()
  })

  it('masks both numbers in the dossier and its SOP, and dials them from their own buttons (E2E-R1)', async () => {
    const { dossier } = await openDossier(SENTINEL_BRIEFING)
    const masked = (last2: string) => `+${'•'.repeat(10)}${last2}`
    expect(dossier.textContent).not.toContain('9435012345')
    expect(dossier.textContent).not.toContain('9435098765')
    expect(within(dossier).getByText(`Phone: ${masked('45')}`)).toBeDefined()
    expect(within(dossier).getByText(`Phone: ${masked('65')}`)).toBeDefined()
    expect(within(dossier).getByText(`1. Attempt voice contact with driver at ${masked('45')}`)).toBeDefined()
    expect(within(dossier).getByRole('link', { name: 'Call driver' }).getAttribute('href')).toBe('tel:+919435012345')
    expect(within(dossier).getByRole('link', { name: 'Call contact' }).getAttribute('href')).toBe('tel:+919435098765')
  })

  it('gives focus back to the button that opened the dossier, on Escape and on Close (DOSSIER-1)', async () => {
    const { banner } = await openDossier(SENTINEL_BRIEFING)
    const opener = within(banner).getByRole('button', { name: /view incident dossier/i })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close incident dossier' }))
    expect(document.activeElement).toBe(opener)
  })

  it('titles a driver-raised SOS as one, with its category and reason, and no invented position', async () => {
    const reason = 'Brake smell and smoke from the rear axle, pulled over'
    const { banner, dossier } = await openDossier({
      ...SENTINEL_BRIEFING,
      escalation_reason: `Driver requested an emergency stop (VEHICLE): ${reason}`,
      location: {
        lat: null, lon: null, fix_recorded_at: null, fix_age_seconds: null,
        // sentinel.escalate_driver_sos: nothing measured a stop, so both are null.
        stopped_since: null, stopped_duration_minutes: null,
      },
      driver_request: { request_id: '0b7f3c52-1d7e-4f55-9d7c-6a2f1d9e8a11', reason, category: 'VEHICLE' },
    })

    expect(within(banner).getByText(/Driver SOS: 1 Active Incident/)).toBeDefined()
    expect(within(banner).queryByText(/Fleet Sentinel Alert/)).toBeNull()
    expect(within(dossier).getByRole('heading', { name: /Driver SOS: TRIP-TEST-001/ })).toBeDefined()
    expect(within(dossier).getByText('VEHICLE')).toBeDefined()
    expect(within(dossier).getByText(reason)).toBeDefined()
    expect(within(dossier).getByText('Position unknown')).toBeDefined()
    expect(within(dossier).getByText('Stationary for: unknown')).toBeDefined()
    expect(within(dossier).getByText('Last fix received: N/A')).toBeDefined()
  })

  it('writes SOS text in the AA danger ink, not the -strong fill, on the danger tint', async () => {
    // index.css: danger #A9271D on danger-soft #F9DDDC is 5.5:1; danger-strong is 3.8:1.
    const { banner, dossier } = await openDossier({
      ...SENTINEL_BRIEFING,
      driver_request: { request_id: 'r', reason: 'Chest pain', category: 'MEDICAL' },
    })
    for (const el of [within(banner).getByRole('heading', { name: /Driver SOS/ }), within(dossier).getByText('MEDICAL')]) {
      expect(el.classList.contains('text-danger')).toBe(true)
      expect(el.classList.contains('text-danger-strong')).toBe(false)
    }
  })

  it('features a driver SOS, then an escalation, over a newer Sentinel check, and reaches every open incident', async () => {
    // The server lists newest first (api/emergencies.py), so the SOS comes last.
    const check = { id: 'e-check', trip_id: STALE.trip_id, state: 'DRIVER_CHECK_REQUIRED', triggered_at: '2026-09-09T12:05:00Z', stationary_since: '2026-09-09T11:05:00Z', briefing_snapshot: null }
    const escalated = { id: 'e-esc', trip_id: NO_CONTACT.trip_id, state: 'SOS_ESCALATED', triggered_at: '2026-09-09T12:02:00Z', stationary_since: '2026-09-09T11:00:00Z', briefing_snapshot: { ...SENTINEL_BRIEFING, trip_code: 'TRP-SILENT' } }
    const sos = { id: 'e-sos', trip_id: LIVE.trip_id, state: 'SOS_ESCALATED', triggered_at: '2026-09-09T12:00:00Z', stationary_since: '2026-09-09T12:00:00Z', briefing_snapshot: { ...SENTINEL_BRIEFING, driver_request: { request_id: 'r', reason: 'Chest pain', category: 'MEDICAL' } } }
    async function bannerFor(list: unknown[]) {
      vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE, STALE, NO_CONTACT]))
      vi.spyOn(api, 'activeEmergencies').mockResolvedValue(list as Emergency[])
      render(<MemoryRouter><EmergencyProvider><FleetPage /></EmergencyProvider></MemoryRouter>)
      return (await screen.findByRole('button', { name: /view incident dossier/i })).closest('[role="alert"]') as HTMLElement
    }

    let banner = await bannerFor([check, escalated, sos])
    expect(within(banner).getByRole('heading', { name: 'Driver SOS: 3 Active Incidents' })).toBeDefined()
    fireEvent.click(within(banner).getByRole('button', { name: /view incident dossier/i }))
    expect(screen.getByRole('dialog', { name: 'Driver SOS: TRIP-TEST-001' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(within(banner).getByRole('button', { name: /TRP-STALE/ }))
    expect(screen.getByRole('dialog', { name: 'Incident Dossier: TRP-STALE' })).toBeDefined()

    cleanup()
    banner = await bannerFor([check, escalated])
    fireEvent.click(within(banner).getByRole('button', { name: /view incident dossier/i }))
    expect(screen.getByRole('dialog', { name: 'Incident Dossier: TRP-SILENT' })).toBeDefined()
  })

  it('shows an unescalated check the stop its row records, and names its close button', async () => {
    // The sweep writes no briefing until it escalates; the row still knows when the stop began.
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([
      { id: 'e-check', trip_id: LIVE.trip_id, state: 'DRIVER_CHECK_REQUIRED', triggered_at: '2026-09-09T12:05:00Z', stationary_since: '2026-09-09T11:05:00Z', briefing_snapshot: null },
    ] as Emergency[])
    render(<MemoryRouter><EmergencyProvider><FleetPage /></EmergencyProvider></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /view incident dossier/i }))
    const dossier = screen.getByRole('dialog')

    expect(within(dossier).getByText(`Stationary since: ${new Date('2026-09-09T11:05:00Z').toLocaleString()}`)).toBeDefined()
    expect(within(dossier).getByText('Position unknown')).toBeDefined()
    fireEvent.click(within(dossier).getByRole('button', { name: 'Close incident dossier' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not restate a stop the driver already answered', async () => {
    // An answered check has no briefing and Sentinel no longer tracks its stop:
    // the truck may have driven on, so the detection time is not a current stop.
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([
      { id: 'e-answered', trip_id: LIVE.trip_id, state: 'DRIVER_RESPONDED', triggered_at: '2026-09-09T12:05:00Z', stationary_since: '2026-09-09T11:05:00Z', briefing_snapshot: null },
    ] as Emergency[])
    render(<MemoryRouter><EmergencyProvider><FleetPage /></EmergencyProvider></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /view incident dossier/i }))
    const dossier = screen.getByRole('dialog')

    expect(within(dossier).getByText('Stationary for: unknown')).toBeDefined()
    expect(within(dossier).queryByText(/Stationary since/)).toBeNull()
  })

  it('says unknown, not 60 minutes or STANDARD, when the briefing does not know', async () => {
    // test_sentinel's frozen placeholder: a snapshot with none of the keys.
    const { dossier } = await openDossier({ briefing: 'frozen' })

    expect(within(dossier).getByText('Stationary for: unknown')).toBeDefined()
    expect(within(dossier).getByText('Position unknown')).toBeDefined()
    expect(within(dossier).getByText(/Priority: unknown/)).toBeDefined()
  })

  it('renders each freshness state from the server, not recomputed', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(
      snapshot([LIVE, STALE, NO_CONTACT, NEVER_REPORTED]),
    )
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)

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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    await screen.findByText('TRP-LIVE')

    await user.type(screen.getByPlaceholderText(/search registration/i), 'zzzz')

    await screen.findByText(/nothing matches/i)
    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    await screen.findByText('TRP-LIVE')
  })

  it('opens a detail panel of real API data when a marker is selected', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    await screen.findByText('TRP-LIVE')

    await user.click(screen.getByTestId('marker-TRP-LIVE'))

    // Every one of these is a value an endpoint returned. Driver and truck are
    // the Overview group, which is what the panel opens on; the consignment is
    // one tab away.
    // Masked on screen, dialled in full (E2E-R1).
    await screen.findByText('••••••••45')
    expect(document.body.textContent).not.toContain('9435012345')
    expect(screen.getByRole('link', { name: /Call Driver/i }).getAttribute('href')).toBe('tel:9435012345')
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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)
    await screen.findByText(/no route planned/i)

    await user.click(screen.getByRole('button', { name: /^plan route$/i }))

    await screen.findByText(/no routing provider is reachable/i)
  })

  it.each([
    ['ROUTE_CROSSES_COUNTRY_BOUNDARY', 'Route leaves India', /crosses an international boundary/],
    ['HOLD_AND_REVIEW', 'Held for review', /No road that stays inside India/],
  ])('says in words when no route may stay inside India (%s, P1R-19)', async (code, title, detail) => {
    const user = userEvent.setup()
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([LIVE]))
    vi.spyOn(api, 'planRoute').mockRejectedValue(new ApiError(422, { error: { code, message: code } }, 'fallback'))

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    await screen.findByText('TRP-LIVE')
    await user.click(screen.getByTestId('marker-TRP-LIVE'))
    await openTab(user, /route/i)
    await screen.findByText(/no route planned/i)
    await user.click(screen.getByRole('button', { name: /^plan route$/i }))

    const box = (await screen.findByText(title)).closest('[role="alert"]') as HTMLElement
    expect(box.textContent).toMatch(detail)
    // Never the raw code, never "Something went wrong".
    expect(box.textContent).not.toContain(code)
    expect(box.textContent).not.toContain('Something went wrong')
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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

    render(<MemoryRouter><FleetPage /></MemoryRouter>)
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
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
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
      render(<MemoryRouter><FleetPage /></MemoryRouter>)
      await screen.findByText('TRP-LIVE')
      await user.click(screen.getByTestId('marker-TRP-LIVE'))
      await openTab(user, /route/i)
      await screen.findByText(/free-flow travel time/i)
      return user
    }

    // The server's answer to "may this road be used": scored, ELIGIBLE, one
    // road only. Selection is gated on it - a control that would be refused
    // by the server is disabled with the reason, never "use it, then error".
    const ELIGIBLE: RouteRecommendation = {
      recommended_route_id: 'r1',
      baseline_route_id: 'r1',
      comparable: false,
      reason_codes: ['ONLY_ONE_ROUTE_AVAILABLE'],
      tradeoff: null,
      candidates: [
        {
          route_id: 'r1',
          kind: 'PRIMARY' as const,
          distance_km: 308,
          estimated_duration_min: 360,
          eligibility: 'ELIGIBLE' as const,
          risk: { score: 12, band: 'LOW' as const, unavailable: [], reason_codes: [] },
        },
      ],
      unavailable_inputs: [],
      margin_points: 10,
      version: 'explainable-route-recommendation-v1',
    }
    const QUIET = {
      outcome: 'NO_ACTION' as const,
      selected_route_id: null,
      selected_risk_score: null,
      selected_risk_band: null,
      proposed_route_id: null,
      reason_codes: ['NO_SELECTED_ROUTE'],
      comparison: null,
      unavailable_inputs: [],
      floor_points: 60,
      severe_conditions_points: 35,
      margin_points: 10,
      version: 'reroute-assessment-v1',
    }
    async function checkConditions(
      user: ReturnType<typeof userEvent.setup>,
      recommendation: RouteRecommendation = ELIGIBLE,
    ) {
      vi.spyOn(api, 'rerouteAssessment').mockResolvedValue(QUIET)
      vi.spyOn(api, 'routeRecommendation').mockResolvedValue(recommendation)
      await user.click(screen.getByRole('button', { name: /check route conditions/i }))
    }

    it('offers no Use this route until conditions are checked - the card says why and Check route conditions is the way forward', async () => {
      const user = await openWith([PROPOSED])
      expect(screen.queryByRole('button', { name: /use this route/i })).toBeNull()
      expect(screen.getByText(/route evidence is incomplete/i)).toBeDefined()
      expect(screen.getByText('NOT CHECKED')).toBeDefined()
      expect(screen.getByText(/1 distinct road route available/i)).toBeDefined()

      await checkConditions(user)

      await screen.findByText('SELECTABLE')
      expect(screen.getByRole('button', { name: /use this route/i }).hasAttribute('disabled')).toBe(false)
      expect(screen.getByText(/eligible under the checks that ran/i)).toBeDefined()
    })

    it('sets the trip route through the server', async () => {
      // Online from the start: a reconnect would read the snapshot again anyway.
      markOnline()
      const select = vi.spyOn(api, 'selectRoute').mockResolvedValue(SELECTED)
      const user = await openWith([PROPOSED])
      await checkConditions(user)
      await screen.findByText('SELECTABLE')

      const polls = vi.mocked(api.activeFleet).mock.calls.length
      await user.click(screen.getByRole('button', { name: /use this route/i }))

      await waitFor(() => {
        expect(select).toHaveBeenCalledWith(LIVE.trip_id, 'r1', undefined)
      })
      // The fleet snapshot is read again at once, so the row's reroute
      // attention does not outlive the decision by a poll (FV-E2E-3).
      await waitFor(() => expect(vi.mocked(api.activeFleet).mock.calls.length).toBeGreaterThan(polls))
    })

    it('names a review requirement in words and keeps the button shut, without any fabricated pipeline', async () => {
      const user = await openWith([PROPOSED])
      vi.spyOn(api, 'reviewAuthorization').mockRejectedValue(new Error('none held'))
      await checkConditions(user, {
        ...ELIGIBLE,
        candidates: [{ ...ELIGIBLE.candidates[0], eligibility: 'REQUIRES_REVIEW' as const, risk: { score: null, band: 'UNASSESSED' as const, unavailable: ['landslide'], reason_codes: ['LANDSLIDE_DATA_UNAVAILABLE'] } }],
      })

      await screen.findByText('REVIEW REQUIRED')
      expect(screen.getByText(/review required — hazard evidence is incomplete/i)).toBeDefined()
      // A control that can never work is not offered; the manager's own
      // decision is: reason, acknowledgement, one approve-and-select call.
      expect(screen.queryByRole('button', { name: /use this route/i })).toBeNull()
      expect(screen.queryByRole('link', { name: /open review/i })).toBeNull()
      const approve = vi.spyOn(api, 'approveRoute').mockResolvedValue({ route: SELECTED, authorization: { id: 'a', consumed_at: new Date().toISOString() } as never })
      await user.click(screen.getByRole('button', { name: /review & approve route/i }))
      await screen.findByRole('dialog', { name: /manager decision/i })
      expect((screen.getByRole('button', { name: /approve & use route/i }) as HTMLButtonElement).disabled).toBe(true)
      await user.type(screen.getByRole('textbox', { name: /reason for approval/i }), 'Depot confirms the road is open this morning')
      await user.click(screen.getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: /approve & use route/i }))
      await waitFor(() => expect(approve).toHaveBeenCalledExactlyOnceWith(LIVE.trip_id, 'r1', 'Depot confirms the road is open this morning', undefined))
      // Nothing measured, nothing said: no fuel model, no verified pipeline,
      // no paragraph about a road this trip is not on.
      expect(screen.queryByText(/physics|CMEM|stages verified|kaziranga|dual-ai/i)).toBeNull()
    })

    it('separates trip status, driver location and route evidence instead of one STALE badge', async () => {
      await openWith([SELECTED])
      const facts = screen.getByTestId('route-facts')
      expect(within(facts).getByText(/driver location/i)).toBeDefined()
      expect(within(facts).getByText(/LIVE · reported 12s ago/)).toBeDefined()
      expect(within(facts).getByText(/route evidence/i)).toBeDefined()
      expect(within(facts).getByText(/not checked yet/i)).toBeDefined()
      expect(screen.queryByText(/STALE \(10m\)/)).toBeNull()
      expect(screen.getByText('CURRENT')).toBeDefined()
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
      await checkConditions(user)
      await screen.findByText('SELECTABLE')
      await user.click(screen.getByRole('button', { name: /use this route/i }))

      expect(await screen.findByText(/superseded/i)).toBeDefined()
    })
  })
})

/**
 * The redesign's map card (manager_03) and the permission gates the audit
 * found missing (11.3 D1, D2): a control the role cannot use is not drawn.
 */
describe('map card and permission gates', () => {
  const ONE = trip({ trip_code: 'TRP-GATE' })

  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    denied.clear()
  })

  it('puts the roadside-services toggles in the map card header and drives the map with them', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([ONE]))
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    const card = await screen.findByTestId('map-card')
    const chips = within(card).getByRole('group', { name: 'Roadside services' })
    expect(within(card).getByRole('heading', { name: 'Live map' })).toBeDefined()
    await screen.findByTestId('map')
    expect(mapProps.mock.lastCall?.[0].placeCategory).toBeNull()
    fireEvent.click(within(chips).getByRole('button', { name: 'Fuel' }))
    await waitFor(() => expect(mapProps.mock.lastCall?.[0].placeCategory).toBe('FUEL'))
    expect(within(chips).getByRole('button', { name: 'Fuel' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens with the trip a marker on the Overview map pointed at', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([ONE]))
    render(
      <MemoryRouter initialEntries={[{ pathname: '/fleet', state: { tripId: ONE.trip_id } }]}>
        <FleetPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(mapProps.mock.lastCall?.[0].selectedTripId).toBe(ONE.trip_id))
  })

  it('offers Assign truck and New trip only to a role that may use them (D1, D7)', async () => {
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([ONE]))
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    const actions = await screen.findByTestId('quick-actions')
    expect(within(actions).getByRole('button', { name: 'Assign truck' })).toBeDefined()
    expect(within(actions).getByRole('link', { name: '+ New trip' })).toBeDefined()
    cleanup()
    denied.add('assignment:create').add('trip:create')
    render(<MemoryRouter><FleetPage /></MemoryRouter>)
    const scoped = await screen.findByTestId('quick-actions')
    expect(within(scoped).queryByRole('button', { name: 'Assign truck' })).toBeNull()
    expect(within(scoped).queryByRole('link', { name: '+ New trip' })).toBeNull()
    expect(within(scoped).getByRole('link', { name: 'Review required' })).toBeDefined()
  })

  it('lets a role without emergency:resolve read the dossier but not resolve it (D2)', async () => {
    denied.add('emergency:resolve')
    vi.spyOn(api, 'activeFleet').mockResolvedValue(snapshot([ONE]))
    vi.spyOn(api, 'activeEmergencies').mockResolvedValue([
      { id: 'e1', trip_id: ONE.trip_id, state: 'SOS_ESCALATED', triggered_at: '', stationary_since: '', briefing_snapshot: { trip_code: 'TRP-GATE' } },
    ] as Emergency[])
    const resolve = vi.spyOn(api, 'resolveEmergency')
    render(<MemoryRouter><EmergencyProvider><FleetPage /></EmergencyProvider></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /view incident dossier/i }))
    const dossier = screen.getByRole('dialog')
    expect(within(dossier).queryByRole('button', { name: /confirm & resolve/i })).toBeNull()
    expect(within(dossier).getByText(/can read this incident but not resolve it/)).toBeDefined()
    fireEvent.click(within(dossier).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })
})
