// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { CurrentTrip } from '../api/client'

const mocked = vi.hoisted(() => ({ myTrip: vi.fn(), tracking: vi.fn(), notify: vi.fn<(key: string, title: string, body: string) => Promise<boolean>>(async () => false),
  heartbeat: vi.fn(async () => ({ server_time: '', coalesced: false })),
  auth: { supportView: false, offline: false }, readCachedTrip: vi.fn(), cacheTrip: vi.fn(),
}))
// The provider also beats presence on its own timer. Resolved, not
// stubbed away: a missing method here would hide a real wiring bug.
vi.mock('../api/client', () => ({
  api: { myTrip: mocked.myTrip, heartbeat: mocked.heartbeat },
}))
vi.mock('../components/ui', () => ({ errorMessage: () => ({ title: 'Failed', detail: 'Retry' }) }))
vi.mock('../tracking/useLocationTracking', () => ({ useLocationTracking: mocked.tracking }))
vi.mock('../notify/local', () => ({ notifyInBackground: mocked.notify }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => mocked.auth }))
vi.mock('../auth/sessionCache', () => ({ readCachedTrip: mocked.readCachedTrip, cacheTrip: mocked.cacheTrip }))
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) } }))
import { TripProvider, useTrip, type TripContextValue, TRIP_POLL_MS } from './TripProvider'
import { DELIVERED_SHOWN_MS, REROUTE_APPROVED_SHOWN_MS, justDelivered, rerouteJustApproved } from './tripNotices'

const trip = (status: string) => ({ id: 'trip-a', status, tracking_expected: status === 'ACTIVE', tracking: {} }) as CurrentTrip
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
let root: Root
let value: TripContextValue
function Probe() { value = useTrip(); return null }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers(); vi.resetAllMocks()
  mocked.myTrip.mockResolvedValue(trip('ASSIGNED')); mocked.tracking.mockReturnValue({})
  root = createRoot(document.createElement('div'))
  await act(async () => root.render(createElement(TripProvider, { children: createElement(Probe) })))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })

it('a late manual refresh cannot overwrite a completed mutation', async () => {
  const pending = deferred<CurrentTrip>()
  mocked.myTrip.mockReturnValueOnce(pending.promise)
  let read!: ReturnType<TripContextValue['load']>
  await act(async () => { read = value.load() })
  await act(async () => value.act(async () => trip('ACTIVE')))
  await act(async () => { pending.resolve(trip('ASSIGNED')); await read })
  expect(value.trip?.status).toBe('ACTIVE')
})

it('two taps in the same render issue one mutation', async () => {
  const pending = deferred<CurrentTrip>()
  const action = vi.fn(() => pending.promise)
  let first!: Promise<void>
  await act(async () => { first = value.act(action); void value.act(action) })
  expect(action).toHaveBeenCalledTimes(1)
  await act(async () => { pending.resolve(trip('ACTIVE')); await first })
  expect(value.isBusy).toBe(false)
})

it('a failed refresh retains the last trip with a stale warning', async () => {
  mocked.myTrip.mockRejectedValueOnce(new Error('Disconnected'))
  let result: unknown
  await act(async () => { result = await value.load() })
  expect(result).toBeUndefined()
  expect(value.phase).toBe('ready')
  expect(value.trip?.status).toBe('ASSIGNED')
  expect(value.isStale).toBe(true)
})

it('an older failed poll cannot label a newer successful action stale', async () => {
  const pending = deferred<CurrentTrip>()
  mocked.myTrip.mockReturnValueOnce(pending.promise)
  await act(async () => vi.advanceTimersByTime(TRIP_POLL_MS))
  await act(async () => value.act(async () => trip('ACTIVE')))
  await act(async () => pending.reject(new Error('Old timeout')))
  expect(value.isStale).toBe(false)
  expect(value.trip?.status).toBe('ACTIVE')
})

it('asks for a background notification once when a trip is assigned, and once when its road changes', async () => {
  mocked.notify.mockClear()
  const assigned = { id: 'trip-n', trip_code: 'JUDGE-1', status: 'ASSIGNED', selected_route_id: 'r1', tracking_expected: false } as unknown as CurrentTrip
  mocked.myTrip.mockResolvedValueOnce(null).mockResolvedValueOnce(assigned).mockResolvedValueOnce(assigned).mockResolvedValueOnce({ ...assigned, selected_route_id: 'r2' })
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(createElement(TripProvider, null, createElement(() => null))))
  for (let i = 0; i < 3; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  // Keys, not counts: the notifier itself dedupes a repeated key (notify/local.test.ts).
  const keys = [...new Set(mocked.notify.mock.calls.map((c) => c[0]))].filter((k) => k.includes('trip-n') || k.includes('r2'))
  expect(keys).toEqual(['trip-assigned:trip-n', 'reroute:r2'])
  await act(async () => root.unmount())
})

it('says in the app, not only in the background, that the manager moved the trip onto a new road (FV-E2E-2)', async () => {
  const moving = { id: 'trip-a', trip_code: 'JUDGE-2', status: 'ACTIVE', selected_route_id: 'r1', tracking_expected: true, tracking: {} } as unknown as CurrentTrip
  mocked.myTrip.mockResolvedValue(moving)
  await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  expect(value.rerouteApproved).toBeNull()
  mocked.myTrip.mockResolvedValue({ ...moving, selected_route_id: 'r2' })
  await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  expect(value.rerouteApproved).toMatchObject({ tripId: 'trip-a', routeId: 'r2' })
  const at = value.rerouteApproved!.at
  expect(rerouteJustApproved(value.rerouteApproved, { id: 'trip-a', selected_route_id: 'r2' }, at)).toBe(true)
  // Not once it is old news, not for another road, not for another trip.
  expect(rerouteJustApproved(value.rerouteApproved, { id: 'trip-a', selected_route_id: 'r2' }, at + REROUTE_APPROVED_SHOWN_MS)).toBe(false)
  expect(rerouteJustApproved(value.rerouteApproved, { id: 'trip-a', selected_route_id: 'r3' }, at)).toBe(false)
  expect(rerouteJustApproved(value.rerouteApproved, { id: 'trip-b', selected_route_id: 'r2' }, at)).toBe(false)
  expect(rerouteJustApproved(null, { id: 'trip-a', selected_route_id: 'r2' }, at)).toBe(false)
})

it('an offline launch shows the cached trip as stale, then goes live and caches the fresh one (FE-01)', async () => {
  mocked.auth.offline = true
  try {
    const at = Date.now() - 60_000
    mocked.readCachedTrip.mockResolvedValue({ trip: trip('ACTIVE'), at })
    mocked.myTrip.mockRejectedValue(new Error('no signal'))
    mocked.cacheTrip.mockClear()
    // A new key remounts the provider, as a cold launch would.
    await act(async () => root.render(createElement(TripProvider, { key: 'cold', children: createElement(Probe) })))
    expect(value.phase).toBe('ready')
    expect(value.trip?.status).toBe('ACTIVE')
    expect(value.trip?.tracking_expected).toBe(true)
    expect(value.isStale).toBe(true)
    expect(value.loadedAt).toBe(at)
    expect(mocked.cacheTrip).not.toHaveBeenCalled()
    // Inside 24 h the tracker runs offline; nothing holds the GPS.
    expect(mocked.tracking).toHaveBeenLastCalledWith('trip-a', true, {})
    expect(value.gpsHeld).toBe(false)

    mocked.myTrip.mockResolvedValue(trip('ACTIVE'))
    await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
    expect(value.isStale).toBe(false)
    expect(mocked.cacheTrip).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }), value.loadedAt)
  } finally {
    mocked.auth.offline = false
  }
})

it('an offline launch never restarts GPS for a cached trip last seen over 24 h ago (MAX_BACKDATE)', async () => {
  mocked.auth.offline = true
  try {
    mocked.readCachedTrip.mockResolvedValue({ trip: trip('ACTIVE'), at: Date.now() - 25 * 60 * 60 * 1000 })
    mocked.myTrip.mockRejectedValue(new Error('no signal'))
    await act(async () => root.render(createElement(TripProvider, { key: 'cold-old', children: createElement(Probe) })))
    expect(value.trip?.status).toBe('ACTIVE')
    expect(value.isStale).toBe(true)
    // The server's field is shown as sent (TripScreen reads it as "in progress");
    // only GPS is held back.
    expect(value.trip?.tracking_expected).toBe(true)
    expect(mocked.tracking).toHaveBeenLastCalledWith('trip-a', false, {})

    mocked.myTrip.mockResolvedValue(trip('ACTIVE'))
    await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
    expect(value.isStale).toBe(false)
    expect(mocked.tracking).toHaveBeenLastCalledWith('trip-a', true, {})
  } finally {
    mocked.auth.offline = false
  }
})

it('keeps the delivery said after the poll stops returning the delivered trip (RE2E-2)', async () => {
  const moving = { id: 'trip-a', trip_code: 'JUDGE-3', status: 'ACTIVE', selected_route_id: 'r1', tracking_expected: true, tracking: {} } as unknown as CurrentTrip
  mocked.myTrip.mockResolvedValue(moving)
  await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  await act(async () => value.act(async () => ({ ...moving, status: 'DELIVERED' }) as CurrentTrip))
  expect(value.delivered).toBeNull()
  // The server's current trip is an open one: the next poll has none.
  mocked.myTrip.mockResolvedValue(null)
  await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  expect(value.trip).toBeNull()
  expect(value.delivered).toMatchObject({ tripId: 'trip-a' })
  const at = value.delivered!.at
  expect(justDelivered(value.delivered, at + 60_000)).toBe(true)
  expect(justDelivered(value.delivered, at + DELIVERED_SHOWN_MS)).toBe(false)
  expect(justDelivered(null, at)).toBe(false)
})

it('says nothing was delivered when a trip leaves the poll for any other reason', async () => {
  const moving = { id: 'trip-a', trip_code: 'JUDGE-4', status: 'ACTIVE', selected_route_id: 'r1', tracking_expected: true, tracking: {} } as unknown as CurrentTrip
  mocked.myTrip.mockResolvedValue(moving)
  await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  mocked.myTrip.mockResolvedValue(null) // cancelled by the manager, say
  await act(async () => { await vi.advanceTimersByTimeAsync(TRIP_POLL_MS) })
  expect(value.delivered).toBeNull()
})
