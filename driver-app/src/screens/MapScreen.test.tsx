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
  }
})
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children }: { children?: import('react').ReactNode }) => h('div', null, children)
  return { View: box, SafeAreaView: box, ScrollView: box, Pressable: box, Text: box,
    Linking: { openURL: vi.fn() }, BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  }
})
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
vi.mock('../api/client', () => ({
  api: {
    aiAsk: vi.fn().mockResolvedValue({ answer: 'Mocked AI answer' }),
  },
}))
vi.mock('react-native-safe-area-context', async () => {
  const { createElement: h } = await import('react')
  return { SafeAreaView: ({ children }: { children?: import('react').ReactNode }) => h('div', null, children) }
})
vi.mock('../components/ui', () => ({ Banner: () => null, Button: () => null, Loading: () => null, errorMessage: () => ({ detail: 'Error' }) }))
vi.mock('../i18n/language', () => ({ resolveLanguage: () => 'en' }))
vi.mock('../map/DriverRouteMap', () => ({ default: (props: Record<string, unknown>) => { state.map = props; return null } }))
vi.mock('../map/useRouteGeometry', () => ({ useRouteGeometry: () => ({
  points: [[26, 91], [27, 92]], backupPoints: [], stops: [], routeId: 'route-a', distanceKm: 100,
  isLoading: false, error: null, source: 'LIVE',
}) }))
vi.mock('../map/useNavigationPackage', () => ({ useNavigationPackage: () => ({ available: false, maneuvers: [], reasonCodes: [] }) }))
vi.mock('../map/useGuidanceClock', () => ({ useGuidanceClock: () => state.clock }))
vi.mock('../map/useSpokenGuidance', () => ({ useSpokenGuidance: () => ({ available: false }) }))
vi.mock('../map/NextTurnPanel', () => ({ default: () => null }))
vi.mock('../places/usePlaces', () => ({ usePlaces: () => ({
  result: null, selected: null, error: null, isSearching: false, clear: state.clear,
}) }))
vi.mock('../trip/TripProvider', () => ({ useTrip: () => ({
  trip: { id: 'trip-a', trip_code: 'DEMO', selected_route_id: 'route-a', tracking: { fresh_seconds: 60 }, status: 'ACTIVE', stops: [] },
  tracking: state.tracking, loadedAt: new Date(100_000),
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

  it('renders honest telemetry without fake driver name or circular 80 speed sign', async () => {
    await render()
    expect(host.textContent).not.toContain('Bipul Das')
    expect(host.textContent).toContain('Test Driver')
    expect(host.textContent).not.toContain('12.5 T Payload')
    expect(host.textContent).toContain('Payload Unspecified')
    expect(host.textContent).not.toContain('NH27 Bypass')
  })
})
