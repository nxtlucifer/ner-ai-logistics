// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  offline: vi.fn(), navigation: vi.fn(), places: vi.fn(),
  read: vi.fn(), write: vi.fn(),
}))
vi.mock('../api/client', () => ({ api: {
  offlinePackage: mocks.offline, navigationPackage: mocks.navigation, places: mocks.places,
} }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('../offline/packageStore', () => ({ OfflinePackageStore: class {
  read = mocks.read
  write = mocks.write
} }))

import { useRouteGeometry } from './useRouteGeometry'
import { useNavigationPackage } from './useNavigationPackage'
import { usePlaces } from '../places/usePlaces'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  mocks.write.mockResolvedValue(undefined)
  mocks.read.mockResolvedValue(null)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const offline = (routeId: string) => ({
  trip_id: 'trip-a', selected_route: { route_id: routeId, geometry: [[26, 91], [27, 92]], distance_km: 100 },
  backup_route: null, stops: [], captured_at: '2026-09-07T00:00:00Z',
})
const navigation = (routeId: string) => ({
  trip_id: 'trip-a', route_id: routeId, available: true,
  route_revision: routeId, maneuvers: [{ type: 'turn', name: routeId }], reason_codes: [],
})

describe('route identity at the render boundary', () => {
  it('removes the previous corridor immediately while a new route is pending', async () => {
    const pending = deferred<ReturnType<typeof offline>>()
    mocks.offline.mockResolvedValueOnce(offline('route-a')).mockReturnValueOnce(pending.promise)
    let current!: ReturnType<typeof useRouteGeometry>
    const rendered: ReturnType<typeof useRouteGeometry>[] = []
    function Harness({ route }: { route: string }) {
      current = useRouteGeometry('trip-a', route)
      rendered.push(current)
      return null
    }
    await act(async () => root.render(createElement(Harness, { route: 'route-a' })))
    expect(current.points).toHaveLength(2)
    rendered.length = 0
    await act(async () => root.render(createElement(Harness, { route: 'route-b' })))
    expect(rendered.every((value) => value.points.length === 0)).toBe(true)
    expect(current.isLoading).toBe(true)
    await act(async () => pending.resolve(offline('route-b')))
    expect(current.routeId).toBe('route-b')
  })

  it('never exposes previous turns during a route change or late package response', async () => {
    const pending = deferred<ReturnType<typeof navigation>>()
    mocks.navigation.mockResolvedValueOnce(navigation('route-a')).mockReturnValueOnce(pending.promise)
    let current!: ReturnType<typeof useNavigationPackage>
    const rendered: ReturnType<typeof useNavigationPackage>[] = []
    function Harness({ route }: { route: string }) {
      current = useNavigationPackage('trip-a', route)
      rendered.push(current)
      return null
    }
    await act(async () => root.render(createElement(Harness, { route: 'route-a' })))
    expect(current.available).toBe(true)
    rendered.length = 0
    await act(async () => root.render(createElement(Harness, { route: 'route-b' })))
    expect(rendered.every((value) => !value.available && value.maneuvers.length === 0)).toBe(true)
    await act(async () => pending.resolve(navigation('route-a')))
    expect(current.available).toBe(false)
    expect(current.maneuvers).toEqual([])
  })
})

describe('stored route package, cache first (FE-02)', () => {
  it('draws the matching stored package at once as CACHED, then LIVE when the network answers', async () => {
    const pending = deferred<ReturnType<typeof offline>>()
    mocks.read.mockResolvedValue({ packageData: offline('route-a') })
    mocks.offline.mockReturnValueOnce(pending.promise)
    let current!: ReturnType<typeof useRouteGeometry>
    function Harness() { current = useRouteGeometry('trip-a', 'route-a'); return null }
    await act(async () => root.render(createElement(Harness)))
    expect(current.source).toBe('CACHED')
    expect(current.points).toHaveLength(2)
    // Still checking: the map must not say "no connection" yet.
    expect(current.isLoading).toBe(true)
    await act(async () => pending.resolve(offline('route-a')))
    expect(current.source).toBe('LIVE')
    expect(current.isLoading).toBe(false)
  })

  it('keeps the CACHED route with no error when the network fails, and never draws another route', async () => {
    mocks.read.mockResolvedValue({ packageData: offline('route-a') })
    mocks.offline.mockRejectedValue(new Error('no signal'))
    let current!: ReturnType<typeof useRouteGeometry>
    function Harness({ route }: { route: string }) { current = useRouteGeometry('trip-a', route); return null }
    await act(async () => root.render(createElement(Harness, { route: 'route-a' })))
    expect(current.source).toBe('CACHED')
    expect(current.error).toBeNull()
    expect(current.isLoading).toBe(false)
    await act(async () => root.render(createElement(Harness, { route: 'route-b' })))
    expect(current.source).toBe('NONE')
    expect(current.error).not.toBeNull()
  })
})

describe('risk snapshot survives a package whose assessment timed out', () => {
  const risk = { score: 40, band: 'MODERATE', assessed_at: '2026-09-07T00:00:00Z' }
  it('keeps the stored risk and its own timestamp when the fresh package for the same route has risk null', async () => {
    mocks.read.mockResolvedValue({ packageData: { ...offline('route-a'), risk, risk_captured_at: '2026-09-07T00:00:00Z' } })
    mocks.offline.mockResolvedValue({ ...offline('route-a'), captured_at: '2026-09-08T00:00:00Z', risk: null, risk_captured_at: null })
    function Harness() { useRouteGeometry('trip-a', 'route-a'); return null }
    await act(async () => root.render(createElement(Harness)))
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({
      captured_at: '2026-09-08T00:00:00Z', risk, risk_captured_at: '2026-09-07T00:00:00Z',
    }))
  })

  it('does not carry risk across to a different route', async () => {
    mocks.read.mockResolvedValue({ packageData: { ...offline('route-a'), risk, risk_captured_at: '2026-09-07T00:00:00Z' } })
    mocks.offline.mockResolvedValue({ ...offline('route-b'), risk: null, risk_captured_at: null })
    function Harness() { useRouteGeometry('trip-a', 'route-b'); return null }
    await act(async () => root.render(createElement(Harness)))
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ risk: null, risk_captured_at: null }))
  })
})

describe('place search ownership', () => {
  it('removes old pins as soon as a different category starts loading', async () => {
    const pending = deferred<object>()
    mocks.places.mockResolvedValueOnce({ places: [{ provider_id: 'hotel-a' }] }).mockReturnValueOnce(pending.promise)
    let current!: ReturnType<typeof usePlaces>
    function Harness() { current = usePlaces(); return null }
    await act(async () => root.render(createElement(Harness)))
    const query = { south: 26, west: 91, north: 27, east: 92, anchor: 'MAP_AREA' as const, category: 'HOTEL' as const }
    await act(async () => current.search(query))
    expect(current.result?.places).toHaveLength(1)
    await act(async () => { void current.search({ ...query, category: 'EMERGENCY' }) })
    expect(current.result).toBeNull()
    await act(async () => current.clear())
    await act(async () => pending.resolve({ places: [{ provider_id: 'stale-emergency' }] }))
    expect(current.result).toBeNull()
    expect(current.isSearching).toBe(false)
  })
})
