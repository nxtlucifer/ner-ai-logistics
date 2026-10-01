// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    assignment: vi.fn(),
    notices: vi.fn(),
    requestTripStop: vi.fn(),
    scrollTo: vi.fn(),
    field: null as null | { onChangeText: (v: string) => void; value?: string },
    trip: { trip: null as unknown, phase: 'ready', loadError: null, actionError: null, isBusy: false, isStale: false, loadedAt: 100_000, load: vi.fn(), act: vi.fn(), tracking: { permission: 'unknown', isTracking: false, lastPosition: null } as Record<string, unknown>, delivered: null as null | { tripId: string; at: number } },
  }
})
vi.mock('react-native', async () => {
  const { createElement: h, forwardRef, useEffect, useImperativeHandle } = await import('react')
  type BoxProps = { children?: import('react').ReactNode; onLayout?: (e: unknown) => void }
  // A laid-out box reports y 900: below the fold of any phone.
  // Capitalised: it is a component, and calls a hook (REG-9).
  const Box = ({ children, onLayout }: BoxProps) => {
    useEffect(() => { onLayout?.({ nativeEvent: { layout: { x: 0, y: 900, width: 400, height: 48 } } }) }, [])
    return h('div', null, children)
  }
  const ScrollView = forwardRef<unknown, BoxProps>(({ children }, ref) => {
    useImperativeHandle(ref, () => ({ scrollTo: state.scrollTo }))
    return h('div', null, children)
  })
  // Image and Platform: the photo hero (components/scenic) draws a photo and
  // a gradient veil.
  return { View: Box, ScrollView, Pressable: Box, Text: Box, RefreshControl: () => null, Image: () => null, Platform: { OS: 'web' },
    Linking: { openURL: vi.fn() }, StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } }
})
vi.mock('../api/client', () => ({ api: { myAssignment: () => state.assignment(), myNotices: () => state.notices(), requestTripStop: (i: unknown) => state.requestTripStop(i) } }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ driver: { full_name: 'Test Driver' } }) }))
vi.mock('../components/ui', async () => {
  const { createElement: h } = await import('react')
  return {
    Banner: ({ title, detail }: { title: string; detail?: string }) => h('div', null, `[${title}${detail ? `: ${detail}` : ''}]`), Loading: () => null, errorMessage: () => ({ title: 'x', detail: 'y' }),
    ConfirmSheet: ({ visible, confirmLabel, onConfirm, confirmDisabled, children }: { visible: boolean; confirmLabel: string; onConfirm: () => void; confirmDisabled?: boolean; children?: import('react').ReactNode }) =>
      visible ? h('div', null, children, h('button', { onClick: onConfirm, disabled: confirmDisabled }, confirmLabel)) : null,
    Field: (p: { onChangeText: (v: string) => void }) => { state.field = p; return null },
    Button: ({ label, onPress, disabled }: { label: string; onPress?: () => void; disabled?: boolean }) => h('button', { onClick: onPress, disabled }, label),
    Row: ({ label, value }: { label: string; value: unknown }) => h('div', null, `${label}: ${String(value)}`),
  }
})
vi.mock('../hooks/useRouteRisk', () => ({ useRouteRisk: () => ({ risk: null, state: 'UNAVAILABLE' }) }))
vi.mock('../i18n/language', () => ({ resolveLanguage: () => 'en' }))
vi.mock('../i18n/tx', () => ({ useT: () => (en: string) => en }))
vi.mock('../map/useGuidanceClock', () => ({ useGuidanceClock: () => ({ now: 160_000, platformPermission: null }) }))
vi.mock('../safety/guide', () => ({ emergencyNumbers: () => [{ number: '112', label: 'Emergency' }, { number: '108', label: 'Ambulance' }] }))
vi.mock('../trip/TripProvider', () => ({ useTrip: () => state.trip }))
import TripScreen from './TripScreen'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(160_000)
  host = document.createElement('div')
  root = createRoot(host)
  state.assignment.mockResolvedValue({ id: 'a', status: 'ACTIVE', assigned_at: '', verified_at: null, mismatch_flagged: false, truck: { registration_number: 'AS86QQ7606' } })
  state.notices.mockResolvedValue([])
  // Each test starts from no trip: an earlier test's ACTIVE trip or failing
  // tracker must not leak into the next (order-independent under shuffle).
  state.trip = { ...state.trip, trip: null, isStale: false, isBusy: false, actionError: null, delivered: null, tracking: { permission: 'unknown', isTracking: false, lastPosition: null } }
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })

describe('the Trip hero (Phase B3)', () => {
  it('carries what the shell header did: the title, the name, the GPS chip and the photo slot', async () => {
    const status = createElement('i', { 'data-testid': 'gps' }, 'Not tracking')
    const avatar = createElement('i', { 'data-testid': 'avatar' }, 'TD')
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {}, status, avatar })))
    await act(async () => { await Promise.resolve() })
    const text = host.textContent ?? ''
    expect(text).toContain('Trip')
    expect(text).toContain('Test Driver')
    expect(host.querySelector('[data-testid="gps"]')!.textContent).toBe('Not tracking')
    expect(host.querySelector('[data-testid="avatar"]')).not.toBeNull()
    expect(text).not.toContain('GPS off')
  })
})

describe('the Trip page with no trip', () => {
  it('makes no availability claim, shows only real facts, and invents no route, ETA or risk', async () => {
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {}, onCheckTruck: () => {} })))
    await act(async () => { await Promise.resolve() })
    const text = host.textContent ?? ''
    expect(text).toContain('No active trip')
    expect(text).toContain('appear here automatically')
    // After delivery the driver and truck stay ON_TRIP until the manager
    // closes the trip, so "available" would be false (E2E-D3).
    expect(text).not.toMatch(/available for assignment/i)
    expect(text).toContain('Open map')
    expect(text).toContain('Driver: Test Driver')
    expect(text).toContain('Truck: AS86QQ7606 · not verified')
    expect(text).toContain('Connection: Connected')
    expect(text).toContain('Last sync: 1 min ago')
    // Each number is its own 56 dp row: the number, then what it reaches.
    expect(text).toContain('112Emergency')
    expect(text).toContain('108Ambulance')
    expect(text).toContain('Check the truck')
    for (const fake of ['ETA', 'REMAINING', 'PERSONAL ROUTE AI', 'Destination', 'km']) expect(text).not.toContain(fake)
  })

  it('says no truck when there is no assignment, and reconnecting when the poll is failing', async () => {
    state.assignment.mockResolvedValue(null)
    state.trip = { ...state.trip, isStale: true }
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('Truck: No truck assigned')
    expect(host.textContent).toContain('Reconnecting')
    expect(host.textContent).not.toContain('Check the truck')
  })

  // The lifecycle lane's exact sequence (step-drv-stale-cancel-notice.json):
  // trip 626639eb cancelled on the 26th, TRP-C71274AB assigned, delivered and
  // closed on the 27th. /me/notices, newest first, as the server returned it.
  const LANE_NOTICES = [
    { event: 'EMERGENCY_STOP_ACK', sent_at: '2026-09-27T08:23:07.495735+05:30', trip_code: null, trip_id: '960730e1-afa3-46f3-827a-5ce0df4e1892', body: 'Your manager has been alerted and can see your reason. Stay safe; they will call.' },
    { event: 'TRIP_ASSIGNED', sent_at: '2026-09-27T08:20:08.855320+05:30', trip_code: null, trip_id: '960730e1-afa3-46f3-827a-5ce0df4e1892', body: 'Trip TRP-C71274AB-3398-441A: open the app to review and accept.' },
    { event: 'TRIP_ASSIGNED', sent_at: '2026-09-26T18:06:00.564179+05:30', trip_code: null, trip_id: '6c29dd69-1a94-441f-b63b-6b1abef29439', body: 'Trip TRP-541013D6-660F-4C97: open the app to review and accept.' },
    { event: 'TRIP_CANCELLED', sent_at: '2026-09-26T17:56:36.371646+05:30', trip_code: null, trip_id: '626639eb-6034-4cbd-a556-e12d4c8a0a6f', body: 'Browser certification: seeded trip with no route, releasing driver' },
  ]

  it("does not blame a delivered trip on an older trip's cancellation", async () => {
    vi.setSystemTime(Date.parse('2026-09-27T04:34:00Z')) // just after the manager closed it
    state.trip = { ...state.trip, isStale: false }
    state.notices.mockResolvedValue(LANE_NOTICES)
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('No active trip')
    expect(host.textContent).not.toContain('Trip cancelled by your manager')
  })

  it('still says Trip complete after the poll drops the trip the driver just delivered (RE2E-2)', async () => {
    state.trip = { ...state.trip, delivered: { tripId: 't9', at: 150_000 } }
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('[Trip complete: Your manager can see the delivery. Location sharing has stopped.]')
    expect(host.textContent).toContain('No active trip')
    // Half an hour on, it is no longer news.
    await act(async () => root.unmount())
    root = createRoot(host)
    vi.setSystemTime(150_000 + 30 * 60_000)
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).not.toContain('Trip complete')
  })

  it('still says why when the trip that left the screen was the one cancelled', async () => {
    vi.setSystemTime(Date.parse('2026-09-27T04:34:00Z'))
    state.notices.mockResolvedValue([
      // A later notice about the SAME trip does not hide why it was cancelled.
      { event: 'EMERGENCY_RESOLVED', sent_at: '2026-09-27T08:31:00+05:30', trip_code: null, trip_id: '960730e1-afa3-46f3-827a-5ce0df4e1892', body: 'Resolved' },
      { event: 'TRIP_CANCELLED', sent_at: '2026-09-27T08:30:00+05:30', trip_code: null, trip_id: '960730e1-afa3-46f3-827a-5ce0df4e1892', body: 'Road closed at Jorabat' },
      ...LANE_NOTICES,
    ])
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('[Trip cancelled by your manager: Road closed at Jorabat]')
  })
})

describe('a trip under way', () => {
  const stop = (id: string, kind: string, name: string, status: string, actual_arrival_at: string | null) =>
    ({ id, sequence: id === 's1' ? 0 : 1, kind, name, address: name, status, planned_arrival_at: null, actual_arrival_at })
  const active = (tracking: Record<string, unknown> = {}) => {
    state.trip = {
      ...state.trip,
      tracking: { permission: 'granted', isTracking: true, lastPosition: null, uploadState: 'ok', queueDepth: 0, lastError: null, lastAcceptedAt: null, ...tracking },
      trip: {
        id: 't2', trip_code: 'TRP-LIVE', status: 'ACTIVE', dispatched_at: null, started_at: '1970-01-01T00:01:00Z',
        // The API's kinds (TripStopKind): PICKUP and DROPOFF.
        stops: [stop('s1', 'PICKUP', 'Depot', 'ARRIVED', '1970-01-01T00:02:00Z'), stop('s2', 'DROPOFF', 'Guwahati Yard', 'PENDING', null)],
        next_stop_id: 's1', driver_accepted_at: '1970-01-01T00:01:00Z', tracking_expected: true, progress: null,
        truck: { registration_number: 'AS86QQ7606' }, can_start: false, start_blocked_reason: null,
        start_blocked_code: null, selected_route_id: null, active_emergency: null, pending_instruction: null,
      },
    }
  }

  // B2D-02: Safety's stop-request tool used to land at the top of Trip with
  // the control below the fold.
  it("lands on the stop-request control when Safety's tool sends the driver here, once", async () => {
    active()
    state.scrollTo.mockReset()
    const onFocused = vi.fn()
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {}, focus: 'stop-request', onFocused })))
    expect(state.scrollTo).toHaveBeenCalledWith({ y: 780, animated: false })
    expect(onFocused).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Emergency: request trip stop')
  })

  it('does not move the page when opened any other way', async () => {
    active()
    state.scrollTo.mockReset()
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(state.scrollTo).not.toHaveBeenCalled()
  })

  it('shows an ARRIVED stop as current, not done: the driver has not finished it', async () => {
    active()
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('PickupCurrent')
    expect(host.textContent).not.toContain('PickupDone')
  })

  it('labels the DROPOFF stop Deliver', async () => {
    active()
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('DeliverUpcoming')
  })

  it('shows a border advisory only as the server sends it (owner decision 2)', async () => {
    active()
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).not.toContain('Border')
    state.trip = { ...state.trip, trip: { ...(state.trip.trip as object), border_advisory: { status: 'UNKNOWN', message: 'All clear' } } }
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('[Border status not confirmed: There is no current official border status for this road. This does not mean it is clear.]')
    expect(host.textContent).not.toContain('All clear')
    // ADVISORY: the server's own words and source, once; NORMAL: nothing.
    state.trip = { ...state.trip, trip: { ...(state.trip.trip as object), border_advisory: { status: 'ADVISORY', message: 'Checkpost queue at km 12', source: 'District order 4/2026' } } }
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('[Border advisory: Checkpost queue at km 12 · Source: District order 4/2026]')
    expect(host.textContent!.match(/Border advisory/g)).toHaveLength(1)
    state.trip = { ...state.trip, trip: { ...(state.trip.trip as object), border_advisory: { status: 'NORMAL', message: 'Open' } } }
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).not.toContain('Border')
  })

  // The stop request carries the phone's position only while judgeFix calls
  // it live; a cached or old fix would send the manager to where the truck was.
  // The fix goes with its own time (DRV-SOS-5), so the manager's dossier ages
  // it from when the phone took it, not from when the request arrived.
  it('sends a live fix with the stop request, and no position when the fix is stale or the tracker is not live', async () => {
    const press = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click()
    const cases = [
      [150_000, {}, { lat: 26.1445, lon: 91.7362, fixAt: new Date(150_000).toISOString() }],
      [160_000 - 5 * 60_000, {}, {}],
      // A 5 s old fix, but the watch has stopped or permission is gone (DRV-SOS-3).
      [155_000, { isTracking: false }, {}],
      [155_000, { permission: 'denied' }, {}],
      [155_000, { permission: 'unavailable' }, {}],
    ] as const
    for (const [at, tracker, sent] of cases) {
      active({ ...tracker, lastPosition: { lat: 26.1445, lon: 91.7362, accuracyM: 8, source: 'GPS', at } })
      state.trip.act = vi.fn(async (fn: () => Promise<unknown>) => fn())
      state.requestTripStop.mockReset().mockResolvedValue(null)
      await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
      await act(async () => press('Emergency: request trip stop'))
      await act(async () => state.field!.onChangeText('Rock fall across the road past the bridge'))
      await act(async () => press('Send request'))
      expect(state.requestTripStop).toHaveBeenCalledTimes(1)
      const body = state.requestTripStop.mock.calls[0][0] as Record<string, unknown>
      expect(body).toMatchObject({ reason: 'Rock fall across the road past the bridge', ...sent })
      if (!('lat' in sent)) expect('lat' in body || 'lon' in body || 'fixAt' in body).toBe(false)
      expect('category' in body).toBe(false) // the sheet has no picker: the server's OTHER, not a guess
      await act(async () => root.unmount())
      root = createRoot(host)
    }
  })

  // A driver-raised SOS is not Sentinel's, and claims a GPS fix only when the
  // server's briefing holds a position.
  it('words a driver SOS honestly: manager alerted, GPS claimed only with a position', async () => {
    for (const [lat, gps] of [[null, false], [26.1, true]] as const) {
      active()
      Object.assign(state.trip.trip as object, { active_emergency: { id: 'e1', trip_id: 't2', state: 'SOS_ESCALATED', triggered_at: '', stationary_since: '',
        briefing_snapshot: { driver_request: { request_id: 'r', reason: 'Rock fall', category: 'OTHER' }, location: { lat, lon: lat } } } })
      await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
      const text = host.textContent ?? ''
      expect(text).toContain('your manager has been alerted')
      expect(text).not.toContain('Fleet Sentinel')
      // The SOS banner's own words (the tracking banner may name GPS too).
      const sos = text.match(/\[SOS sent[^\]]*\]/)?.[0] ?? ''
      expect(sos.includes('GPS')).toBe(gps)
    }
  })

  const driverSos = (requestId: string) => ({ id: 'e1', trip_id: 't2', state: 'SOS_ESCALATED', triggered_at: '', stationary_since: '',
    briefing_snapshot: { driver_request: { request_id: requestId, reason: 'Rock fall', category: 'OTHER' }, location: { lat: null, lon: null } } })
  // A NEW trip object, as every provider load, poll or mutation response is.
  const serverSays = (patch: Record<string, unknown>) => { state.trip = { ...state.trip, trip: { ...(state.trip.trip as object), ...patch } } }
  const render = () => act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
  const control = () => [...host.querySelectorAll('button')].find((b) => /request trip stop|Stop requested/.test(b.textContent ?? ''))!
  const sendStop = async (reason?: string) => {
    await act(async () => control().click())
    if (reason !== undefined) await act(async () => state.field!.onChangeText(reason))
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send request')!.click())
  }
  const sentIds = () => state.requestTripStop.mock.calls.map((c) => (c[0] as { requestId: string }).requestId)

  // DRV-SOS-1. The control shows the server's state, not this mount's memory:
  // once the manager resolves the SOS, or the next trip arrives, a second real
  // emergency must be raisable without leaving the tab.
  it('re-arms the emergency control once the manager resolves the SOS, and on the next trip', async () => {
    active()
    state.trip.act = vi.fn(async (fn: () => Promise<unknown>) => fn())
    state.requestTripStop.mockReset().mockResolvedValue(null)
    await render()
    await sendStop('Rock fall across the road past the bridge')
    serverSays({ active_emergency: driverSos(sentIds()[0]) })
    await render()
    expect(control().textContent).toBe('Stop requested — manager alerted')
    expect(control().disabled).toBe(true)
    serverSays({ active_emergency: null }) // the manager resolved it
    await render()
    expect(control().textContent).toBe('Emergency: request trip stop')
    expect(control().disabled).toBe(false)
    await sendStop('Engine overheating, pulling over now')
    serverSays({ active_emergency: driverSos(sentIds()[1]) })
    await render()
    expect(control().disabled).toBe(true)
    serverSays({ id: 't3', trip_code: 'TRP-NEXT', active_emergency: null }) // the next trip
    await render()
    expect(control().textContent).toBe('Emergency: request trip stop')
    expect(control().disabled).toBe(false)
  })

  // DRV-SOS-2. One emergency, one id, however many presses it takes to get it
  // through - but only until the next read of the trip. An id kept past that
  // could be one the server holds for a closed emergency, and it would drop
  // the next real one as a repeat.
  it('retries a failed send with the same id and reason, and gives the next emergency a new id', async () => {
    active()
    // Every send is lost and the provider's reload fails too (no signal), so
    // the trip on screen changes only when a test says the server was read.
    state.trip.act = vi.fn(async (fn: () => Promise<unknown>) => { try { await fn() } catch { /* actionError */ } })
    state.requestTripStop.mockReset().mockRejectedValue(new Error('offline'))
    await render()
    await sendStop('Rock fall across the road past the bridge')
    await sendStop() // the retry: nothing retyped
    expect(state.requestTripStop).toHaveBeenCalledTimes(2)
    expect(sentIds()[1]).toBe(sentIds()[0])
    expect(state.requestTripStop.mock.calls[1][0]).toMatchObject({ reason: 'Rock fall across the road past the bridge' })
    // The sheet is open for a third try when a read shows the server had it
    // all along: Send closes the sheet and sends nothing.
    await act(async () => control().click())
    serverSays({ active_emergency: driverSos(sentIds()[0]) })
    await render()
    await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send request')!.click())
    expect(state.requestTripStop).toHaveBeenCalledTimes(2)
    expect(control().disabled).toBe(true)
    // Resolved. What follows is each read a lost send can meet: no emergency
    // (never arrived, or a manager already closed it) or a Sentinel check.
    const sentinelCheck = { ...driverSos('x'), state: 'DRIVER_CHECK_REQUIRED', briefing_snapshot: null }
    for (const read of [null, null, sentinelCheck]) {
      serverSays({ active_emergency: read })
      await render()
      const before = sentIds().at(-1)
      await sendStop('Engine overheating, pulling over now')
      expect(sentIds().at(-1)).not.toBe(before)
    }
    expect(state.requestTripStop).toHaveBeenCalledTimes(5)
  })

  // The server's request_id is a UUID. Hermes has no crypto.randomUUID, and a
  // non-UUID id is a 422 on every press: an SOS that can never be sent.
  it('mints an RFC 4122 request id where crypto.randomUUID is missing', async () => {
    vi.stubGlobal('crypto', {})
    try {
      active()
      state.trip.act = vi.fn(async (fn: () => Promise<unknown>) => fn())
      state.requestTripStop.mockReset().mockResolvedValue(null)
      await render()
      await sendStop('Rock fall across the road past the bridge')
      expect(sentIds()[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // B3D-R05: an enabled Send that silently did nothing was a tap lost in an
  // emergency. It is disabled until the reason is long enough.
  it('keeps Send request disabled until the reason is long enough', async () => {
    active()
    state.trip.act = vi.fn(async (fn: () => Promise<unknown>) => fn())
    state.requestTripStop.mockReset().mockResolvedValue(null)
    await render()
    await act(async () => control().click())
    const send = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Send request')!
    expect(send().disabled).toBe(true)
    await act(async () => state.field!.onChangeText('Rock fall'))
    expect(send().disabled).toBe(true)
    await act(async () => state.field!.onChangeText('Rock fall across the road'))
    expect(send().disabled).toBe(false)
  })

  // B3D-R14: "Location active" needs a fresh fix, by the rule the hero's GPS
  // chip uses - never green under a chip reading "Last known".
  it('says Location active only with a fresh fix', async () => {
    const at = (t: number) => ({ lastPosition: { lat: 26.1, lon: 91.7, accuracyM: 8, source: 'GPS', at: t } })
    active(at(155_000))
    await render()
    expect(host.textContent).toContain('[Location active')
    active(at(160_000 - 5 * 60_000))
    await render()
    expect(host.textContent).toContain('[No fresh GPS fix: Last known · 5 min')
    expect(host.textContent).not.toContain('[Location active')
  })

  // B3D-R04: what the server asks of the driver sits above the trip card, so
  // it is on the first screen of a 640 dp phone.
  it('puts the Sentinel check, the manager instruction and the start gate above the trip card', async () => {
    active()
    Object.assign(state.trip.trip as object, {
      status: 'ASSIGNED', tracking_expected: false, can_start: false,
      start_blocked_reason: 'Check the truck before starting the trip.', start_blocked_code: 'ASSIGNMENT_NOT_VERIFIED',
      active_emergency: { id: 'e1', trip_id: 't2', state: 'DRIVER_CHECK_REQUIRED', triggered_at: '', stationary_since: '', briefing_snapshot: null },
      pending_instruction: { event_id: 'ev', instruction: 'HOLD', new_destination: null, reason: null },
    })
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {}, onCheckTruck: () => {} })))
    const text = host.textContent ?? ''
    const card = text.indexOf('CURRENT TRIP')
    for (const first of ['Fleet Sentinel Safety Check', 'Journey updated by your manager', '[Cannot start yet', 'Check the truck']) {
      expect(text.indexOf(first)).toBeGreaterThan(-1)
      expect(text.indexOf(first)).toBeLessThan(card)
    }
    // Accepted: the one action sits with the gate, above the card, and the
    // banner just above the disabled Start is its reason.
    expect(text.indexOf('Start trip')).toBeGreaterThan(text.indexOf('[Cannot start yet'))
    expect(text.indexOf('Start trip')).toBeLessThan(card)
    // Not accepted: Accept is at the top, so Start waits under the card and
    // says why next to it.
    state.trip = { ...state.trip, trip: { ...(state.trip.trip as object), driver_accepted_at: null } }
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {}, onCheckTruck: () => {} })))
    const after = host.textContent ?? ''
    expect(after.indexOf('Accept trip')).toBeLessThan(after.indexOf('CURRENT TRIP'))
    expect(after.indexOf('Start trip')).toBeGreaterThan(after.indexOf('CURRENT TRIP'))
    expect(after.lastIndexOf('Check the truck before starting the trip.')).toBeGreaterThan(after.indexOf('Start trip'))
  })

  it('a break is said on the Trip tab too, above the trip card, with Resume', async () => {
    active()
    Object.assign(state.trip.trip as object, {
      active_break: { id: 'brk-1', status: 'ACTIVE', planned_minutes: 15, expected_end_at: '2026-10-01T06:15:00Z', reason: 'TEA_REST' },
    })
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    const text = host.textContent ?? ''
    expect(text).toMatch(/\[On break: 15 min · back by /)
    expect(text.indexOf('[On break')).toBeLessThan(text.indexOf('CURRENT TRIP'))
    const resume = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Resume driving')!
    await act(async () => resume.click())
    expect(state.trip.act).toHaveBeenCalledTimes(1)
    // Overrun says so.
    Object.assign(state.trip.trip as object, { active_break: { id: 'brk-1', status: 'OVERDUE', planned_minutes: 15, expected_end_at: '2026-10-01T06:15:00Z', reason: 'TEA_REST' } })
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('[Break overran')
  })

  it('puts Arrived at the next stop above the trip card once the trip runs', async () => {
    active()
    Object.assign(state.trip.trip as object, { next_stop_id: 's2' })
    await render()
    const text = host.textContent ?? ''
    expect(text.indexOf('Arrived at Guwahati Yard')).toBeGreaterThan(-1)
    expect(text.indexOf('Arrived at Guwahati Yard')).toBeLessThan(text.indexOf('CURRENT TRIP'))
  })

  it('says off route in the folded Route Progress summary', async () => {
    active()
    Object.assign(state.trip.trip as object, {
      progress: { on_route: false, off_route_m: 800, remaining_distance_km: 98.8, travelled_distance_km: 1.2, remaining_at_planned_pace_min: 90, reason_codes: [] },
    })
    await render()
    expect(host.textContent).toContain('Off the planned route · ')
  })

  it('says "1 fix waiting", not "1 fixes waiting"', async () => {
    active({ uploadState: 'failing', queueDepth: 1 })
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('1 fix waiting. Retrying automatically')
    active({ uploadState: 'failing', queueDepth: 3 })
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('3 fixes waiting. Retrying automatically')
  })

  // RC-DRV-07: the foot of the page must not say "shared" under a banner
  // that says the location is not reaching the server.
  it('does not claim the location is shared while it is not reaching the server', async () => {
    active({ uploadState: 'failing', queueDepth: 2 })
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('Location not reaching the server')
    expect(host.textContent).not.toContain('Your location is shared with your fleet manager')
    expect(host.textContent).toContain('Your location has not reached your fleet manager yet')
    active({ permission: 'denied' })
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('Your location is not being shared.')
    active()
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('Your location is shared with your fleet manager')
  })

  // AUD2-02: the title is the place names; the full addresses stay whole below.
  it('titles the trip by place and keeps the full addresses under it', async () => {
    active()
    const trip = state.trip.trip as { stops: { address: string }[] }
    trip.stops[0].address = 'Guwahati, Kamrup Metropolitan, Assam, 781001, India'
    trip.stops[1].address = 'Shillong, Mylliem, East Khasi Hills, Meghalaya, 793001, India'
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    expect(host.textContent).toContain('Guwahati → Shillong')
    expect(host.textContent).toContain('Shillong, Mylliem, East Khasi Hills, Meghalaya, 793001, India')
  })
})

describe('a delivered trip', () => {
  it('offers nothing to resume: the journey is over', async () => {
    const stop = (id: string, kind: string, name: string) => ({ id, sequence: id === 's1' ? 0 : 1, kind, name, address: name, status: 'COMPLETED', arrived_at: null, completed_at: null })
    state.trip = {
      ...state.trip,
      trip: {
        id: 't1', trip_code: 'TRP-DONE', status: 'DELIVERED', dispatched_at: null, started_at: null,
        stops: [stop('s1', 'PICKUP', 'Depot'), stop('s2', 'DELIVERY', 'Yard')], next_stop_id: null,
        driver_accepted_at: '1970-01-01T00:01:00Z', tracking_expected: false, progress: null,
        truck: { registration_number: 'AS86QQ7606' }, can_start: false, start_blocked_reason: null,
        start_blocked_code: null, selected_route_id: 'r1', active_emergency: null, pending_instruction: null,
      },
    }
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {} })))
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain('2 / 2')
    expect(host.textContent).not.toContain('Resume navigation')
    expect(host.textContent).not.toContain('You accepted this trip')
  })
})
