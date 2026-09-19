// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    clock: { now: 100_000, platformPermission: null as string | null },
    tracking: { permission: 'granted', isTracking: true, lastPosition: { lat: 26, lon: 91, accuracyM: 20, at: 100_000 } },
    map: {} as Record<string, unknown>,
    clear: vi.fn(),
    reroute: vi.fn(),
    geometry: { error: null as unknown, reload: vi.fn(), source: 'LIVE', isLoading: false },
    isStale: false,
    gpsHeld: false,
    trip: { id: 'trip-a', trip_code: 'DEMO', selected_route_id: 'route-a', tracking: { fresh_seconds: 60 }, tracking_expected: true, status: 'ACTIVE', stops: [] } as Record<string, unknown> | null,
    browse: { permission: 'unknown', lastPosition: null as null | Record<string, unknown>, requestPermission: vi.fn() },
  }
})
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children }: { children?: import('react').ReactNode }) => h('div', null, children)
  return { View: box, SafeAreaView: box, ScrollView: box, Pressable: box, Text: box, Image: () => null, Modal: box, Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 390, height: 844 }),
    Linking: { openURL: vi.fn() }, BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  }
})
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
vi.mock('../api/client', () => ({
  api: {
    aiAsk: vi.fn().mockResolvedValue({ answer: 'Mocked AI answer' }),
    requestReroute: (...args: unknown[]) => state.reroute(...args),
  },
}))
// The Route Monitor reads the shared risk hook. Stubbed as UNAVAILABLE, which
// is the state these cases already exercised when the mocked client had no
// routeRisk on it - the monitor must still render, and must not imply clear.
vi.mock('../hooks/useRouteRisk', () => ({
  useRouteRisk: () => ({
    risk: null,
    state: 'UNAVAILABLE',
    fetchedAt: null,
    refresh: () => {},
  }),
}))
vi.mock('react-native-safe-area-context', async () => {
  const { createElement: h } = await import('react')
  return { SafeAreaView: ({ children }: { children?: import('react').ReactNode }) => h('div', null, children) }
})
vi.mock('../components/ui', () => ({ Banner: () => null, Button: () => null, Loading: () => null, errorMessage: () => ({ detail: 'Error' }) }))
vi.mock('../i18n/language', () => ({ resolveLanguage: () => 'en' }))
vi.mock('../i18n/tx', () => ({ useT: () => (en: string) => en }))
vi.mock('../map/DriverRouteMap', () => ({ default: (props: Record<string, unknown>) => { state.map = props; return null } }))
vi.mock('../map/useRouteGeometry', () => ({ useRouteGeometry: () => ({
  points: [[26, 91], [27, 92]], backupPoints: [], stops: [], routeId: 'route-a', distanceKm: 100,
  isLoading: state.geometry.isLoading, error: state.geometry.error, source: state.geometry.source, reload: state.geometry.reload,
}) }))
vi.mock('../map/useNavigationPackage', () => ({ useNavigationPackage: () => ({ available: false, maneuvers: [], reasonCodes: [] }) }))
vi.mock('../notify/local', () => ({ notifyInBackground: async () => false }))
vi.mock('../tracking/useBrowsePosition', () => ({ useBrowsePosition: () => state.browse }))
vi.mock('../map/useGuidanceClock', () => ({ useGuidanceClock: () => state.clock }))
vi.mock('../map/useSpokenGuidance', () => ({ useSpokenGuidance: () => ({ available: false }) }))
vi.mock('../map/NextTurnPanel', () => ({ default: () => null }))
vi.mock('../places/usePlaces', () => ({ usePlaces: () => ({
  result: null, selected: null, error: null, isSearching: false, clear: state.clear,
}) }))
vi.mock('../trip/TripProvider', () => ({ useTrip: () => ({
  trip: state.trip,
  tracking: state.tracking, loadedAt: new Date(100_000), isStale: state.isStale, gpsHeld: state.gpsHeld,
}) }))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ driver: { full_name: 'Test Driver' } }),
}))
import MapScreen from './MapScreen'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  state.clock = { now: 100_000, platformPermission: null }
  state.tracking = { permission: 'granted', isTracking: true, lastPosition: { lat: 26, lon: 91, accuracyM: 20, at: 100_000 } }
  state.geometry = { error: null, reload: vi.fn(), source: 'LIVE', isLoading: false }
  state.isStale = false
  state.trip = { id: 'trip-a', trip_code: 'DEMO', selected_route_id: 'route-a', tracking: { fresh_seconds: 60 }, tracking_expected: true, status: 'ACTIVE', stops: [] }
  state.browse = { permission: 'unknown', lastPosition: null, requestPermission: vi.fn() }
  state.gpsHeld = false
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
async function render() { await act(async () => root.render(createElement(MapScreen, { onBack: () => {} }))) }

describe('map position truthfulness without new GPS samples', () => {
  it('ages the same fix from LIVE to LAST_KNOWN on the guidance clock', async () => {
    await render()
    expect(state.map.positionKind).toBe('LIVE')
    vi.setSystemTime(165_000)
    state.clock = { ...state.clock, now: 165_000 }
    await render()
    expect(state.map.positionKind).toBe('LAST_KNOWN')
  })

  it('keeps a fix taken since the last clock tick LIVE: newer than the tick is fresh, not from the future', async () => {
    // Browser lane D1: the tick is up to 5 s old when a fix lands, and the
    // marker went grey (Last known, speed --, follow dropped) until the next one.
    state.tracking = { ...state.tracking, lastPosition: { lat: 26, lon: 91, accuracyM: 20, at: 103_000 } }
    await render()
    expect(state.map.positionKind).toBe('LIVE')
    expect(host.textContent).toContain('GPS · ±20 m')
    expect(host.textContent).not.toContain('Last known')
  })

  it('holds guidance when the phone fix has aged out, though the server still calls its copy LIVE', async () => {
    // B2D-10: the chip read "GPS stale" while the card, on the server's
    // freshness, kept a confident turn distance from the server's progress.
    state.trip = { ...state.trip!, last_fix: { freshness: 'LIVE' }, progress: { travelled_distance_km: 10, on_route: true } }
    state.tracking = { ...state.tracking, lastPosition: { lat: 26, lon: 91, accuracyM: 20, at: 60_000 } }
    vi.setSystemTime(130_000)
    state.clock = { ...state.clock, now: 130_000 }
    await render()
    expect(host.textContent).toContain('GPS stale')
    // No position for guidance: the driven stretch is not drawn from a guess.
    expect(state.map.progressFraction).toBeNull()
  })

  it('removes the marker immediately when browser permission is revoked', async () => {
    await render()
    state.clock = { ...state.clock, platformPermission: 'denied' }
    await render()
    expect(state.map.position).toBeNull()
    expect(state.map.positionKind).toBeNull()
  })

  it('removes the marker immediately when tracker permission is denied', async () => {
    await render()
    state.tracking = { ...state.tracking, permission: 'denied' }
    await render()
    expect(state.map.position).toBeNull()
  })

  it('names its state, believes off-route only after three fixes, and asks for a road once', async () => {
    state.reroute.mockResolvedValue({ route_id: 'route-b', kind: 'EMERGENCY_BACKUP', distance_km: 61, estimated_duration_min: 90, provider: 'osrm', has_guidance: true })
    await render()
    expect(host.textContent).toContain('Overview')
    // Two fixes 50 km east of the line: jitter, still on route.
    for (const at of [101_000, 102_000]) {
      state.tracking = { ...state.tracking, lastPosition: { lat: 26.5, lon: 92.5, accuracyM: 20, at } }
      state.clock = { ...state.clock, now: at }
      await render()
    }
    expect(host.textContent).not.toContain('Off route')
    expect(state.reroute).not.toHaveBeenCalled()
    // The third is believed: the request goes out once, and the state says so.
    state.tracking = { ...state.tracking, lastPosition: { lat: 26.5, lon: 92.5, accuracyM: 20, at: 103_000 } }
    state.clock = { ...state.clock, now: 103_000 }
    await render()
    expect(state.reroute).toHaveBeenCalledTimes(1)
    expect(state.reroute).toHaveBeenCalledWith(26.5, 92.5)
    expect(host.textContent).toContain('Rerouting')
    expect(host.textContent).toContain('awaits manager')
    state.clock = { ...state.clock, now: 104_000 }
    await render()
    expect(state.reroute).toHaveBeenCalledTimes(1)
    // Nothing new for a minute: the fix goes stale and guidance says so.
    state.clock = { ...state.clock, now: 170_000 }
    await render()
    expect(host.textContent).toContain('GPS stale')
  })

  it('retries a failed route fetch by itself while the trip poll is healthy', async () => {
    state.geometry = { ...state.geometry, error: new Error('dropped') }
    await render()
    expect(state.geometry.reload).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(state.geometry.reload).toHaveBeenCalledTimes(1)
  })

  it('over a saved route says checking, then could not update, and retries while the trip poll is healthy', async () => {
    state.geometry = { ...state.geometry, source: 'CACHED', isLoading: true }
    await render()
    expect(host.textContent).toContain('Saved route — checking for updates.')
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(state.geometry.reload).not.toHaveBeenCalled()
    // The fetch failed but the trip poll answers: a server hiccup, not an
    // outage. The cache keeps error null, so the retry keys on CACHED too.
    state.geometry.isLoading = false
    await render()
    expect(host.textContent).toContain('Saved route — could not update.')
    expect(host.textContent).not.toContain('no connection')
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(state.geometry.reload).toHaveBeenCalledTimes(1)
  })

  it('says no connection over a saved route only when the trip poll is failing too', async () => {
    state.isStale = true
    state.geometry = { ...state.geometry, source: 'CACHED', isLoading: false }
    await render()
    expect(host.textContent).toContain('Saved route — no connection.')
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(state.geometry.reload).not.toHaveBeenCalled()
  })

  it('renders honest telemetry without a fake name, payload, road or decision', async () => {
    await render()
    expect(host.textContent).not.toContain('Bipul Das')
    expect(host.textContent).not.toContain('12.5 T Payload')
    expect(host.textContent).not.toContain('NH27 Bypass')
    // The card names its source and never shows a decision it was not given.
    expect(host.textContent).toContain('PERSONAL ROUTE AI')
    expect(host.textContent).not.toContain('CONTINUE')
  })
})

describe('the map without a trip, and the words on the location chip', () => {
  it('still draws the map from the phone position, with no route decision and no ETA', async () => {
    state.trip = null
    state.browse = { permission: 'granted', lastPosition: { lat: 26.3, lon: 91.9, accuracyM: 180, source: 'NETWORK', at: 100_000 }, requestPermission: vi.fn() }
    await render()
    expect(state.map.position).toEqual([26.3, 91.9])
    expect(state.map.positionKind).toBe('LIVE')
    expect(host.textContent).not.toContain('PERSONAL ROUTE AI')
    expect(host.textContent).not.toContain('duration')
    expect(host.textContent).toContain('Browsing the map')
    // ONE context treatment: the card, not a second banner under it.
    expect(host.textContent).not.toContain('No trip right now')
    // A network fix is named as one, with its metres - never GPS - and the
    // marker is told the source so it draws the amber dot.
    expect(host.textContent).toContain('Network · ±180 m')
    expect(state.map.positionSource).toBe('NETWORK')
    expect(host.textContent).not.toContain('GPS LIVE')
  })

  it('shows the phone position from the upload-free watch while a day-old offline seed holds GPS', async () => {
    // Seeded trip still says tracking_expected, but the tracker is held off.
    state.gpsHeld = true
    state.tracking = { permission: 'unknown', isTracking: false, lastPosition: null as never }
    state.browse = { permission: 'granted', lastPosition: { lat: 26.3, lon: 91.9, accuracyM: 180, source: 'NETWORK', at: 100_000 }, requestPermission: vi.fn() }
    await render()
    expect(state.map.position).toEqual([26.3, 91.9])
  })

  it('names a GPS-grade fix with its metres while tracking', async () => {
    state.tracking = { ...state.tracking, lastPosition: { lat: 26, lon: 91, accuracyM: 12, source: 'GPS', at: 100_000 } as never }
    await render()
    expect(host.textContent).toContain('GPS · ±12 m')
    expect(host.textContent).toContain('PERSONAL ROUTE AI')
  })

  it('shows Location off when the browse permission is denied', async () => {
    state.trip = null
    state.browse = { permission: 'denied', lastPosition: null, requestPermission: vi.fn() }
    await render()
    expect(state.map.position).toBeNull()
    expect(host.textContent).toContain('Location off')
  })
})
