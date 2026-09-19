// @vitest-environment jsdom
/**
 * The navigation controls, pressed.
 *
 * `MapScreen.test.tsx` mocks `Pressable` down to a plain `<div>` that drops
 * `onPress`, which is right for what it tests - what is DRAWN - and useless for
 * what this file tests: what happens when a driver's thumb lands on a button.
 * So the primitives here are wired to real DOM handlers.
 *
 * WHAT THIS DOES NOT PROVE. Nothing about audio. `expo-speech` is a spy, so
 * these cases prove the scheduler was ASKED to speak the right sentence, never
 * that a phone made a sound. That distinction is the whole reason the audio-test
 * button exists in the UI.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    voices: [{ identifier: 'en-in-x-end-local', name: 'English India', language: 'en-IN', quality: 'Default' }],
    spoken: [] as string[],
    stops: 0,
    maneuvers: [
      { type: 'depart', modifier: null, lat: 26, lon: 91, geometry_index: 0, distance_from_start_m: 0, step_distance_m: 3000, duration_s: null, name: 'Kamrup Link Road', exit: null },
      { type: 'turn', modifier: 'left', lat: 26.01, lon: 91.02, geometry_index: 30, distance_from_start_m: 3000, step_distance_m: 3150, duration_s: null, name: 'Bypass Connector', exit: null },
      { type: 'arrive', modifier: null, lat: 26.02, lon: 91.0, geometry_index: 60, distance_from_start_m: 6650, step_distance_m: 0, duration_s: null, name: 'Jorhat Depot', exit: null },
    ],
  }
})

/** React Native primitives as real DOM, so a press is a press. */
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children, testID }: any) => h('div', { 'data-testid': testID }, children)
  const Pressable = ({ children, onPress, accessibilityLabel, testID }: any) =>
    h('button', { onClick: onPress, 'data-label': accessibilityLabel, 'data-testid': testID }, children)
  return {
    View: box, SafeAreaView: box, ScrollView: box, Text: box, Pressable,
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Linking: { openURL: vi.fn() },
    BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
    StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 },
  }
})
vi.mock('react-native-safe-area-context', async () => {
  const { createElement: h } = await import('react')
  return { SafeAreaView: ({ children }: any) => h('div', null, children) }
})
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
// The real scheduler and the real catalogue run; only the ENGINE is a spy.
vi.mock('expo-speech', () => ({
  getAvailableVoicesAsync: () => Promise.resolve(state.voices),
  speak: (text: string) => state.spoken.push(text),
  stop: () => { state.stops += 1; return Promise.resolve() },
}))
vi.mock('../api/client', () => ({ api: { aiAsk: vi.fn(), requestReroute: vi.fn() } }))
vi.mock('../hooks/useRouteRisk', () => ({
  useRouteRisk: () => ({ risk: null, state: 'UNAVAILABLE', fetchedAt: null, refresh: () => {} }),
}))
vi.mock('../components/ui', async () => {
  const { createElement: h } = await import('react')
  return {
    Banner: () => null, Loading: () => null,
    Button: ({ label, onPress }: any) => h('button', { onClick: onPress, 'data-label': label }, label),
    errorMessage: () => ({ detail: 'Error' }),
  }
})
vi.mock('../i18n/language', () => ({ resolveLanguage: () => 'en' }))
vi.mock('../map/DriverRouteMap', () => ({ default: () => null }))
vi.mock('../map/NextTurnPanel', () => ({ default: () => null }))
vi.mock('../notify/local', () => ({ notifyInBackground: async () => false }))
vi.mock('../places/usePlaces', () => ({
  usePlaces: () => ({ result: null, selected: null, error: null, isSearching: false, clear: vi.fn(), select: vi.fn() }),
}))
vi.mock('../map/useGuidanceClock', () => ({
  useGuidanceClock: () => ({ now: 100_000, platformPermission: 'granted' }),
}))
vi.mock('../map/useRouteGeometry', () => ({
  useRouteGeometry: () => ({
    // Two points 111 km apart; the fix below sits on the first one.
    points: [[26, 91], [27, 91]], backupPoints: [], stops: [], routeId: 'route-a',
    distanceKm: 111, isLoading: false, error: null, source: 'LIVE', reload: vi.fn(),
  }),
}))
vi.mock('../map/useNavigationPackage', () => ({
  useNavigationPackage: () => ({
    available: true, maneuvers: state.maneuvers, routeId: 'route-a', routeRevision: 'r1',
    reasonCodes: [], distanceM: 111_000, durationS: 7200, isLoading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('../trip/TripProvider', () => ({
  useTrip: () => ({
    trip: {
      id: 'trip-a', trip_code: 'DEMO', selected_route_id: 'route-a',
      tracking: { fresh_seconds: 60 }, tracking_expected: true, status: 'ACTIVE', stops: [],
      progress: { travelled_distance_km: 1, remaining_distance_km: 110, on_route: true, remaining_at_planned_pace_min: 120 },
      last_fix: { freshness: 'LIVE' },
    },
    tracking: {
      permission: 'granted', isTracking: true,
      // On the line ~1.34 km along, moving. The turn at 3,000 m is then ~1.66 km
      // away: comfortably inside the 2 km advance band rather than on its edge,
      // so this case tests the cue and not the rounding.
      lastPosition: { lat: 26.012, lon: 91, accuracyM: 10, at: 100_000, speedKmh: 55 },
      requestPermission: vi.fn(),
    },
    loadedAt: 100_000,
    isStale: false,
  }),
}))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ driver: { full_name: 'Test Driver' } }) }))
vi.mock('../tracking/useBrowsePosition', () => ({
  useBrowsePosition: () => ({ permission: 'unknown', lastPosition: null, requestPermission: vi.fn() }),
}))

import MapScreen from './MapScreen'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  state.spoken = []
  state.stops = 0
  state.voices = [{ identifier: 'en-in-x-end-local', name: 'English India', language: 'en-IN', quality: 'Default' }]
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()) })

async function render() {
  await act(async () => root.render(createElement(MapScreen, { onBack: () => {} })))
  // `getAvailableVoicesAsync` is a promise and the announce effect only runs
  // once it has answered. One microtask is not enough - the hook's own `.then`
  // has to resolve, then React has to re-run the effect - so drain the queue.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

const byLabel = (needle: string) =>
  [...host.querySelectorAll('button')].find((b) => (b.getAttribute('data-label') ?? '').includes(needle))
const press = async (needle: string) => {
  const el = byLabel(needle)
  expect(el, `no control labelled like "${needle}"`).toBeTruthy()
  await act(async () => { el!.click() })
}

describe('voice mode control', () => {
  it('opens in full guidance for a trip with a selected route', async () => {
    await render()
    expect(byLabel('Voice: full guidance')).toBeTruthy()
  })

  it('cycles full guidance -> alerts only -> muted -> full guidance', async () => {
    await render()
    await press('Voice: full guidance')
    expect(byLabel('Voice: alerts only')).toBeTruthy()
    await press('Voice: alerts only')
    expect(byLabel('Voice: muted')).toBeTruthy()
    await press('Voice: muted')
    expect(byLabel('Voice: full guidance')).toBeTruthy()
  })

  it('speaks the upcoming turn in full guidance and stops the engine on mute', async () => {
    await render()
    expect(state.spoken.some((s) => s.includes('Bypass Connector'))).toBe(true)
    const before = state.stops
    await press('Voice: full guidance')  // -> ALERTS
    await press('Voice: alerts only')    // -> MUTED
    // Muting must interrupt whatever is in flight, not let it finish.
    expect(state.stops).toBeGreaterThan(before)
  })
})

describe('repeat control', () => {
  it('speaks the current instruction again on request', async () => {
    await render()
    state.spoken = []
    await press('Repeat the current instruction')
    expect(state.spoken).toHaveLength(1)
    expect(state.spoken[0]).toContain('Turn left onto Bypass Connector')
  })

  it('still works when the app is muted', async () => {
    await render()
    await press('Voice: full guidance')
    await press('Voice: alerts only')
    expect(byLabel('Voice: muted')).toBeTruthy()
    state.spoken = []
    await press('Repeat the current instruction')
    expect(state.spoken[0]).toContain('Turn left onto Bypass Connector')
  })
})

describe('step list', () => {
  it('opens on the control and lists every maneuver from the provider', async () => {
    await render()
    expect(host.querySelector('[data-testid="step-list"]')).toBeNull()
    await press('Show every step on this route')
    const list = host.querySelector('[data-testid="step-list"]')
    expect(list).toBeTruthy()
    const text = list!.textContent ?? ''
    expect(text).toContain('Start')
    expect(text).toContain('Turn left onto Bypass Connector')
    expect(text).toContain('Arrive')
  })

  it('closes again', async () => {
    await render()
    await press('Show every step on this route')
    await press('Close the step list')
    expect(host.querySelector('[data-testid="step-list"]')).toBeNull()
  })
})

describe('no voice on the device', () => {
  it('says so and offers an audible test instead of failing silently', async () => {
    state.voices = []
    await render()
    const panel = host.querySelector('[data-testid="voice-unavailable"]')
    expect(panel).toBeTruthy()
    expect(panel!.textContent).toContain('Turn instructions stay on screen')
    // The turn-by-turn controls are gone, because they cannot act.
    expect(byLabel('Voice: full guidance')).toBeFalsy()
    // Nothing was spoken into a device with no voice.
    expect(state.spoken).toHaveLength(0)
    // ...but the driver can still make it try, which is the only real check.
    const test = [...host.querySelectorAll('button')].find((b) => b.getAttribute('data-label') === 'Test')
    expect(test).toBeTruthy()
    await act(async () => { test!.click() })
    expect(state.spoken).toEqual(['Voice guidance is on.'])
  })
})
