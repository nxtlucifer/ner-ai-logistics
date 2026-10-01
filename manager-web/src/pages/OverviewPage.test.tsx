/**
 * The overview must never turn an absence into a measurement.
 *
 * A state with no verified district directory is not a state with zero
 * districts. Printing "0" - or worse, the 141 rows a test suite happened to
 * leave in the table - is the kind of number that ends up in front of a
 * ministry. The server already refuses to count anything whose provenance it
 * cannot name; these tests are what stops the screen inventing one back.
 *
 * And the dashboard (manager_03) keeps every figure reachable: four cards,
 * each figure and caption a link to its own rows; a failed read says so.
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type Dashboard, type Emergency, type Notification, type Trip } from '../api/client'
import { EmergencyContext, type Emergencies } from '../hooks/useEmergencies'
import OverviewPage, { decisionFor } from './OverviewPage'

const ALL = ['trip:read', 'trip:create', 'notification:read', 'fleet:location_read']
const perms = vi.hoisted(() => ({ set: new Set<string>() }))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', role: 'NORTH_EAST_MANAGER', display_name: 'Test', email: null, phone: null },
    isInitialising: false,
    logout: vi.fn(),
    can: (p: string) => perms.set.has(p),
  }),
}))
// The real map needs WebGL; the card around it is what is under test.
vi.mock('../components/FleetMap', () => ({ default: () => <div data-testid="fleet-map">map</div> }))

const dash = (over: Partial<Dashboard> = {}): Dashboard => ({
  role: 'NORTH_EAST_MANAGER',
  scope_label: 'North-East · all states',
  state_id: null,
  district_id: null,
  trips_under_way: 0,
  trips_needing_attention: 0,
  trips_awaiting_route: 0,
  cross_state_trips: 0,
  drivers_in_scope: 0,
  drivers_online: 0,
  drivers_with_stale_gps: 0,
  trucks_in_transit: 0,
  unread_notifications: 0,
  urgent_notifications: 0,
  states: [],
  districts: [],
  ...over,
})

const state = (name: string, districts_configured: number) => ({
  state_id: `st-${name}`,
  name,
  districts_configured,
  trips_under_way: 0,
  trips_needing_attention: 0,
})

const trip = (over: Partial<Trip>): Trip => ({
  id: over.trip_code ?? 't',
  trip_code: 'TRP-1',
  shipment_id: 's',
  truck_id: 'k',
  driver_id: 'd',
  status: 'ACTIVE',
  selected_route_id: null,
  dispatched_at: null,
  started_at: null,
  delivered_at: null,
  planned_eta: null,
  current_eta: null,
  delay_minutes: null,
  created_at: '2026-09-27T00:00:00Z',
  origin: 'Guwahati',
  destination: 'Shillong',
  ...over,
})

beforeEach(() => {
  perms.set = new Set(ALL)
  localStorage.clear()
  vi.spyOn(api, 'presence').mockResolvedValue([])
  vi.spyOn(api, 'listNotifications').mockResolvedValue([])
  vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
  vi.spyOn(api, 'activeFleet').mockResolvedValue({ trips: [], fresh_seconds: 90, stale_seconds: 600, server_time: '', trucks_total: 5 })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const show = (d: Dashboard, sos?: Partial<Emergencies>) => {
  vi.spyOn(api, 'dashboard').mockResolvedValue(d)
  const page = (
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>
  )
  render(
    sos ? (
      <EmergencyContext.Provider value={{ emergencies: [], loaded: true, unavailable: false, reload: async () => {}, ...sos }}>
        {page}
      </EmergencyContext.Provider>
    ) : (
      page
    ),
  )
}

const href = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href')

describe('the regional state table', () => {
  it('says the list is pending rather than printing a zero', async () => {
    show(dash({ states: [state('Assam', 0)] }))

    // In the table cell, not the schematic's label of the same name.
    await waitFor(() => screen.getByText('Assam', { selector: 'td' }))
    const row = screen.getByText('Assam', { selector: 'td' }).closest('tr')!
    expect(row.textContent).toMatch(/official.*pending/i)
    // "0" would read as a state that has no districts, which is a claim
    // nobody has the source to make.
    expect(row.textContent).not.toMatch(/\b0\b/)
  })

  it('counts districts on file, verified or demo, and never calls them verified (TRUTH-1)', async () => {
    show(dash({ states: [state('Meghalaya', 12)] }))
    const table = (await screen.findByText('Meghalaya', { selector: 'td' })).closest('table')!
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toContain('Districts on file')
    expect(table.textContent).not.toMatch(/verified/i)
  })

  it('prints the count when districts have a provenance', async () => {
    show(dash({ states: [state('Meghalaya', 12)] }))

    // In the table cell, not the schematic's label of the same name.
    await waitFor(() => screen.getByText('Meghalaya', { selector: 'td' }))
    const row = screen.getByText('Meghalaya', { selector: 'td' }).closest('tr')!
    expect(row.textContent).toContain('12')
    expect(row.textContent).not.toMatch(/pending/i)
  })
})

describe('a state manager with nothing verified', () => {
  it('explains the gap instead of showing an empty table', async () => {
    show(
      dash({
        role: 'STATE_MANAGER',
        scope_label: 'Assam',
        state_id: 'st-assam',
        states: [],
        districts: [],
      }),
    )

    await waitFor(() =>
      expect(
        screen.getByText(/no verified district directory has been loaded/i),
      ).toBeTruthy(),
    )
  })

  it('shows the districts, and no empty state, once there are some', async () => {
    show(
      dash({
        role: 'STATE_MANAGER',
        scope_label: 'Assam',
        state_id: 'st-assam',
        states: [],
        districts: [
          { district_id: 'd1', name: 'Kamrup Metropolitan', incoming: 2, outgoing: 1 },
        ],
      }),
    )

    await waitFor(() => screen.getByText('Kamrup Metropolitan'))
    expect(screen.queryByText(/no verified district directory/i)).toBeNull()
  })
})

describe('the four KPI cards', () => {
  const figures = dash({
    trips_under_way: 7,
    cross_state_trips: 2,
    trips_needing_attention: 3,
    trips_awaiting_route: 4,
    drivers_online: 5,
    drivers_in_scope: 9,
    drivers_with_stale_gps: 1,
    urgent_notifications: 6,
    unread_notifications: 8,
    trucks_in_transit: 11,
  })

  it('opens every figure and every caption at its own rows', async () => {
    show(figures)
    await screen.findByText('Trips under way')
    expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
    expect(href(/Trips under way/)).toBe('/trips')
    expect(href(/2 crossing a state border/)).toBe('/trips')
    expect(href(/Needing attention/)).toBe('/trips')
    expect(href(/4 awaiting a route/)).toBe('/trips')
    expect(href(/Drivers online/)).toBe('/drivers')
    // Stale GPS is a map question, not a driver-list one.
    expect(href(/1 with stale GPS/)).toBe('/fleet')
    expect(href(/Urgent alerts/)).toBe('/notifications')
    expect(href(/8 unread/)).toBe('/notifications')
    // The tenth figure heads the map card.
    expect(screen.getByText('11 trucks in transit')).toBeTruthy()
    // Drivers in scope rides with drivers online.
    expect(screen.getByRole('link', { name: /Drivers online/ }).textContent).toContain('of 9')
  })

  it('keeps the definitions under the figures they define', async () => {
    show(figures)
    await screen.findByText('Trips under way')
    for (const hint of ['Delayed or incident', 'No route selected yet', 'Heartbeat in the last 90 seconds', 'Last position over 10 minutes old']) {
      expect(screen.getByText(hint)).toBeTruthy()
    }
  })

  it('never draws a trend or a percentage change', async () => {
    show(figures)
    await screen.findByText('Trips under way')
    expect(document.body.textContent).not.toMatch(/[+-]\d+%|from last month/)
  })

  it('hides only the border caption when a district manager has no border figure', async () => {
    show({ ...figures, role: 'DISTRICT_MANAGER', cross_state_trips: null })
    await screen.findByText('Trips under way')
    expect(screen.queryByText(/crossing a state border/)).toBeNull()
    expect(href(/Trips under way/)).toBe('/trips')
    expect(screen.getAllByTestId('kpi-card')).toHaveLength(4)
  })

  it('shows trucks in transit as the fourth card for a role with no inbox, and never calls the inbox', async () => {
    perms.set = new Set(['trip:read', 'trip:create', 'fleet:location_read'])
    show(figures)
    await screen.findByText('Trips under way')
    expect(href(/Trucks in transit/)).toBe('/fleet')
    expect(screen.queryByText('Urgent alerts')).toBeNull()
    expect(api.listNotifications).not.toHaveBeenCalled()
    expect(screen.getByText('No inbox for this account')).toBeTruthy()
  })

  it('colours a figure only when it is above zero', async () => {
    show(dash({ trips_needing_attention: 0 }), { emergencies: [{ id: 'e1' } as Emergency, { id: 'e2' } as Emergency] })
    await screen.findByText('Trips under way')
    const card = (label: string) => screen.getByText(label).closest('[data-testid=kpi-card]') as HTMLElement
    expect(within(card('Needing attention')).getAllByText('0')[0].className).toContain('text-ink')
    expect(within(card('Urgent alerts')).getByText('2').className).toContain('text-danger')
  })

  // AUD2-01: three RESOLVED SOS whose notices nobody marked read are not a
  // driver asking for help. The figure is open SOS; the notices are mail.
  it('counts open SOS, not unread urgent notices, when every SOS is resolved', async () => {
    show(dash({ urgent_notifications: 3, unread_notifications: 4 }), { emergencies: [] })
    await screen.findByText('Trips under way')
    const card = screen.getByText('Urgent alerts').closest('[data-testid=kpi-card]') as HTMLElement
    expect(within(card).getByText('0').className).toContain('text-ink')
    expect(card.textContent).toContain('No driver is asking for help')
    expect(card.textContent).not.toContain('A driver asking for help')
    expect(card.textContent).toContain('4 unread')
    expect(card.textContent).toContain('3 marked urgent')
  })

  it('sends an open SOS to Fleet, where its dossier is', async () => {
    show(dash({ urgent_notifications: 0 }), { emergencies: [{ id: 'e1' } as Emergency] })
    await screen.findByText('Trips under way')
    expect(href(/Urgent alerts/)).toBe('/fleet')
    expect(screen.getByText('A driver asking for help')).toBeTruthy()
  })

  it('says it is still checking rather than printing a zero before the SOS poll answers', async () => {
    show(dash({ urgent_notifications: 2 }))
    await screen.findByText('Trips under way')
    const card = screen.getByText('Urgent alerts').closest('[data-testid=kpi-card]') as HTMLElement
    expect(within(card).getByText('—')).toBeTruthy()
    expect(card.textContent).toContain('Checking for an open SOS')
  })
})

describe('the activity rail', () => {
  it('lists the newest notifications in the inbox wording, and asks for five', async () => {
    vi.mocked(api.listNotifications).mockResolvedValue([
      {
        id: 'n1', trip_id: 't1', kind: 'TRIP_DELAYED', severity: 'WARNING', payload: { trip_code: 'TRP-9' },
        is_read: false, created_at: new Date().toISOString(), read_at: null,
      } as Notification,
    ])
    show(dash())
    expect(await screen.findByText('TRP-9 is delayed')).toBeTruthy()
    expect(api.listNotifications).toHaveBeenCalledWith({ limit: 5 })
    expect(href(/View all/)).toBe('/notifications')
  })

  it('says a failed read failed', async () => {
    vi.mocked(api.listNotifications).mockRejectedValue(new Error('backend down'))
    show(dash())
    expect(await screen.findByText('Notifications could not be loaded')).toBeTruthy()
  })
})

describe('who is on', () => {
  it('shows a failed presence read as a failure, never as "nobody is reporting" (D4)', async () => {
    vi.mocked(api.presence).mockRejectedValue(new Error('backend down'))
    show(dash())
    expect(await screen.findByText('Presence could not be loaded')).toBeTruthy()
    expect(screen.queryByText(/No drivers in scope are reporting/)).toBeNull()
  })

  it('says no driver is in scope when the read succeeds empty', async () => {
    show(dash())
    expect(await screen.findByText('No drivers in scope')).toBeTruthy()
  })

  it('puts the state table one tab away, and arrows move between the two (B2R5)', async () => {
    show(dash({ states: [state('Assam', 0)] }))
    const people = await screen.findByRole('tab', { name: 'Who is on' })
    expect(people.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Who is on' })).toBeTruthy()
    fireEvent.keyDown(people, { key: 'ArrowRight' })
    const places = screen.getByRole('tab', { name: 'States' })
    expect(places.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(places)
    expect(within(screen.getByRole('tabpanel', { name: 'States' })).getByText('Assam')).toBeTruthy()
    expect(href(/States & districts/)).toBe('/states')
  })

  it('never asks for presence or positions without fleet:location_read (B2R11)', async () => {
    perms.set = new Set(['trip:read', 'notification:read'])
    show(dash({ states: [state('Assam', 0)] }))
    await screen.findByText('Trips under way')
    expect(api.presence).not.toHaveBeenCalled()
    expect(api.activeFleet).not.toHaveBeenCalled()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show live map' })).toBeNull()
    expect(screen.getByText('Assam', { selector: 'td' })).toBeTruthy()
  })
})

describe('awaiting a decision', () => {
  it('names the manager-owned next step, and nothing that is someone else\'s', () => {
    expect(decisionFor(trip({ status: 'DRAFT' }))?.text).toBe('Needs a route')
    expect(decisionFor(trip({ status: 'DRAFT', selected_route_id: 'r' }))?.text).toBe('Ready to dispatch')
    expect(decisionFor(trip({ status: 'DELIVERED' }))?.text).toBe('Close to release the truck')
    expect(decisionFor(trip({ status: 'MANAGER_REVIEW' }))).not.toBeNull()
    expect(decisionFor(trip({ status: 'ACTIVE', selected_route_id: 'r' }))).toBeNull()
    expect(decisionFor(trip({ status: 'ASSIGNED', selected_route_id: 'r' }))).toBeNull()
    expect(decisionFor(trip({ status: 'CLOSED' }))).toBeNull()
  })

  it('asks for a route on a trip already on the road without one, as the KPI counts it (B2R4)', () => {
    expect(decisionFor(trip({ status: 'ACTIVE', selected_route_id: null }))?.text).toBe('Needs a route')
    expect(decisionFor(trip({ status: 'DELAYED', selected_route_id: null }))?.text).toBe('Needs a route')
  })

  it('reads the Trips page\'s own first page and says so', async () => {
    vi.mocked(api.listTrips).mockResolvedValue({
      items: [trip({ trip_code: 'TRP-A', status: 'DRAFT' }), trip({ trip_code: 'TRP-B', status: 'ACTIVE', selected_route_id: 'r' })],
      next_cursor: 'x',
    })
    show(dash())
    expect(await screen.findByText('TRP-A')).toBeTruthy()
    expect(screen.queryByText('TRP-B')).toBeNull()
    expect(screen.getByText('1 of 2 open trips need a decision (first page)')).toBeTruthy()
    expect(api.listTrips).toHaveBeenCalledWith({ open_only: true, limit: 20 })
  })

  it('offers New trip only to a role that may plan one (D7)', async () => {
    show(dash())
    await screen.findByText('Trips under way')
    expect(href(/^New trip$/)).toBe('/trips')
    cleanup()
    perms.set = new Set(['trip:read', 'notification:read'])
    show(dash())
    await screen.findByText('Trips under way')
    expect(screen.queryByRole('link', { name: /^New trip$/ })).toBeNull()
  })
})

describe('the map card and the photograph', () => {
  it('starts no fleet poll until the map is asked for, and stops it when hidden (B2R2)', async () => {
    show(dash({ trucks_in_transit: 1 }))
    expect(await screen.findByText('1 truck in transit')).toBeTruthy()
    expect(href(/View full map/)).toBe('/fleet')
    expect(screen.queryByTestId('fleet-map')).toBeNull()
    expect(api.activeFleet).not.toHaveBeenCalled()

    const toggle = screen.getByRole('button', { name: 'Show live map' })
    fireEvent.click(toggle)
    expect(await screen.findByTestId('fleet-map')).toBeTruthy()
    await waitFor(() => expect(api.activeFleet).toHaveBeenCalledTimes(1))
    // The same element, relabelled: keyboard focus is never dropped when the map swaps in.
    expect(screen.getByRole('button', { name: 'Hide live map' })).toBe(toggle)

    fireEvent.click(screen.getByRole('button', { name: 'Hide live map' }))
    expect(screen.queryByTestId('fleet-map')).toBeNull()
  })

  it("shows a failed position read as the frame's content with a retry, not a card in a card (B2R10)", async () => {
    vi.mocked(api.activeFleet).mockRejectedValue(new Error('backend down'))
    show(dash())
    fireEvent.click(await screen.findByRole('button', { name: 'Show live map' }))
    expect(await screen.findByText('Fleet positions could not be loaded')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('shows the photograph with no credit control or credit text on it (company showcase)', async () => {
    show(dash())
    const card = await screen.findByTestId('scenic-card')
    expect(within(card).queryByRole('link')).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Photo credits' })).toBeNull()
    // The truck panorama, at the width the card draws it.
    expect(card.querySelector('img')!.getAttribute('srcset')).toBe(
      '/assets/redesign/ner-khasi-truck-800.webp 800w, /assets/redesign/ner-khasi-truck-1280.webp 1280w',
    )
  })
})

describe('first paint', () => {
  it('asks for the headline figures first; the side cards read once they land (PERF-2)', async () => {
    let answer!: (d: Dashboard) => void
    vi.spyOn(api, 'dashboard').mockReturnValue(new Promise<Dashboard>((resolve) => { answer = resolve }))
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(api.dashboard).toHaveBeenCalledTimes(1))
    // Nothing queued ahead of or beside it while it is out.
    expect(api.listTrips).not.toHaveBeenCalled()
    expect(api.listNotifications).not.toHaveBeenCalled()
    expect(api.presence).not.toHaveBeenCalled()

    answer(dash())
    await waitFor(() => expect(api.listTrips).toHaveBeenCalledTimes(1))
    expect(api.listNotifications).toHaveBeenCalledTimes(1)
    expect(api.presence).toHaveBeenCalledTimes(1)
  })
})
