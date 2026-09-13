// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { CurrentTrip } from '../api/client'

const mocked = vi.hoisted(() => ({ myTrip: vi.fn(), tracking: vi.fn(), notify: vi.fn<(key: string, title: string, body: string) => Promise<boolean>>(async () => false) }))
vi.mock('../api/client', () => ({ api: { myTrip: mocked.myTrip } }))
vi.mock('../components/ui', () => ({ errorMessage: () => ({ title: 'Failed', detail: 'Retry' }) }))
vi.mock('../tracking/useLocationTracking', () => ({ useLocationTracking: mocked.tracking }))
vi.mock('../notify/local', () => ({ notifyInBackground: mocked.notify }))
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) } }))
import { TripProvider, useTrip, type TripContextValue, TRIP_POLL_MS } from './TripProvider'

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
