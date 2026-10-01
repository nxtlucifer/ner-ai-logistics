// @vitest-environment jsdom
/**
 * FULL SCREEN MAP (company showcase add-on, 1 Oct 2026): a layout switch on
 * the same map, GPS watch and polls. Harness copied from MapScreen.cta.test.
 *
 * Navigate after the driver_02 redesign: the one CTA is the real next step
 * and reuses the Trip tab's gates rather than copying them; the quick actions
 * are real place categories plus the real help sheet; the route summary and
 * tiles say UNKNOWN / NOT ASSESSED rather than invent; and while a trip runs
 * the guidance replaces the quick actions.
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    trip: null as Record<string, unknown> | null,
    search: vi.fn(async () => {}),
    openURL: vi.fn(async () => {}),
    map: {} as Record<string, unknown>,
    layout: {} as Record<string, (e: { nativeEvent: { layout: { y: number; height: number } } }) => void>,
    back: [] as (() => boolean)[],
    mapMounts: 0,
    geoSource: 'LIVE',
  }
})

type Props = {
  children?: ReactNode
  onPress?: () => void
  disabled?: boolean
  accessibilityLabel?: string
  accessibilityRole?: string
  testID?: string
  style?: unknown
  onLayout?: (e: { nativeEvent: { layout: { y: number; height: number } } }) => void
}
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  // The last `bottom` / `height` in a style array, as React Native resolves it.
  const last = (style: unknown, key: 'bottom' | 'height'): number | undefined => [style].flat(4).reduce<number | undefined>((v, s) => (s && typeof s === 'object' && key in s ? (s as Record<string, number>)[key] : v), undefined)
  const attrs = (p: Props) => {
    if (p.testID && p.onLayout) state.layout[p.testID] = p.onLayout
    return { 'aria-label': p.accessibilityLabel, 'data-role': p.accessibilityRole, 'data-testid': p.testID, 'data-bottom': last(p.style, 'bottom'), 'data-height': last(p.style, 'height') }
  }
  const box = (p: Props) => h('div', attrs(p), p.children)
  return {
    View: box, ScrollView: box, Modal: box, Image: () => null,
    Text: (p: Props) => h('span', attrs(p), p.children),
    Pressable: (p: Props) => h('button', { ...attrs(p), disabled: p.disabled, onClick: p.onPress }, p.children),
    Platform: { OS: 'web' },
    useWindowDimensions: () => ({ width: 412, height: 915 }),
    Linking: { openURL: state.openURL }, BackHandler: { addEventListener: (_: string, fn: () => boolean) => { state.back.push(fn); return { remove: () => { state.back = state.back.filter((f) => f !== fn) } } } },
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1, absoluteFill: {} },
    useColorScheme: () => 'light',
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }))
vi.mock('expo-constants', () => ({ default: { expoConfig: null, expoGoConfig: null } }))
vi.mock('../api/client', () => ({ api: { requestReroute: vi.fn() } }))
vi.mock('../hooks/useRouteRisk', () => ({ useRouteRisk: () => ({ risk: null, state: 'UNAVAILABLE', capturedAt: null, refresh: () => {} }) }))
vi.mock('../components/ui', () => ({ Banner: () => null, Button: () => null, Loading: () => null, errorMessage: () => ({ detail: 'Error' }) }))
vi.mock('../i18n/language', () => ({ resolveLanguage: () => 'en' }))
vi.mock('../map/DriverRouteMap', async () => {
  const { useEffect } = await import('react')
  return { default: (props: Record<string, unknown>) => {
    state.map = props
    useEffect(() => { state.mapMounts += 1 }, [])
    return null
  } }
})
vi.mock('../map/useRouteGeometry', () => ({ useRouteGeometry: () => ({
  points: [[26, 91], [27, 92]], backupPoints: [], routeId: 'route-a', distanceKm: 98.8, durationMin: 77,
  stops: [{ stop_id: 'a', sequence: 1, kind: 'PICKUP', name: 'Pickup', address: 'Guwahati Depot' }, { stop_id: 'b', sequence: 2, kind: 'DROPOFF', name: 'Delivery', address: 'Shillong Depot' }],
  isLoading: false, error: null, source: state.geoSource, reload: vi.fn(), capturedAt: null,
}) }))
vi.mock('../map/useNavigationPackage', () => ({ useNavigationPackage: () => ({ available: false, maneuvers: [], reasonCodes: [], reload: vi.fn() }) }))
vi.mock('../notify/local', () => ({ notifyInBackground: async () => false }))
vi.mock('../tracking/useBrowsePosition', () => ({ useBrowsePosition: () => ({ permission: 'granted', lastPosition: { lat: 26.14, lon: 91.73, accuracyM: 10, source: 'GPS', at: 100_000 }, requestPermission: vi.fn() }) }))
vi.mock('../map/useGuidanceClock', () => ({ useGuidanceClock: () => ({ now: 100_000, platformPermission: null }) }))
vi.mock('../map/useSpokenGuidance', () => ({ useSpokenGuidance: () => ({ available: false }) }))
vi.mock('../places/usePlaces', () => ({ usePlaces: () => ({ result: null, selected: null, error: null, isSearching: false, clear: vi.fn(), select: vi.fn(), search: state.search }) }))
vi.mock('../trip/TripProvider', () => ({ useTrip: () => ({
  trip: state.trip,
  tracking: { permission: 'granted', isTracking: true, lastPosition: { lat: 26.14, lon: 91.73, accuracyM: 10, source: 'GPS', at: 100_000 }, requestPermission: vi.fn() },
  loadedAt: 100_000, isStale: false, gpsHeld: false,
}) }))

import MapScreen from './MapScreen'
import { ThemeProvider } from '../theme-context'

let root: Root
let host: HTMLDivElement
const onBack = vi.fn()
const onFullscreenChange = vi.fn()
const ACTIVE = {
  id: 'trip-a', trip_code: 'TRP-A', status: 'ACTIVE', selected_route_id: 'route-a', tracking: { fresh_seconds: 60 }, tracking_expected: true,
  driver_accepted_at: '2026-10-01T05:00:00Z', can_start: false, start_blocked_code: null, start_blocked_reason: null, progress: null,
  stops: [{ id: 's1', kind: 'PICKUP', name: 'Pickup', address: 'Guwahati Depot', status: 'PENDING' }, { id: 's2', kind: 'DROPOFF', name: 'Delivery', address: 'Shillong Depot', status: 'PENDING' }],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  vi.clearAllMocks()
  Object.assign(state, { trip: null, back: [], mapMounts: 0, geoSource: 'LIVE' })
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
async function render() {
  await act(async () => root.render(createElement(ThemeProvider, null, createElement(MapScreen, { onBack, onFullscreenChange }))))
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null
const btn = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
const back = async () => {
  let handled = false
  await act(async () => { handled = state.back.at(-1)!() })
  return handled
}
const expand = async () => act(async () => btn('Expand map to full screen')!.click())

describe('Navigate full screen map', () => {
  it('Expand is a named control on the map; full screen hides the page around the map and keeps the map controls', async () => {
    await render()
    expect(btn('Expand map to full screen')).not.toBeNull()
    expect(host.querySelector('[data-role="header"]')).not.toBeNull()
    expect(q('search-field')).not.toBeNull()
    await expand()
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true)
    expect(host.querySelector('[data-role="header"]')).toBeNull()
    expect(q('search-field')).toBeNull()
    expect(q('quick-actions')).toBeNull()
    expect(btn('Expand map to full screen')).toBeNull()
    expect(btn('Exit full screen')).not.toBeNull()
    expect(btn('Emergency help')).not.toBeNull()
    expect(host.querySelector('button[aria-label^="Re-centre"]')).not.toBeNull()
    // Browsing still says what it is, and the GPS word rides in the summary.
    expect(q('route-summary')!.textContent).toContain('Browsing the map')
    expect(q('route-summary')!.textContent).toContain('GPS')
  })

  it('Exit restores the page; the same map stays mounted (no second map instance)', async () => {
    await render()
    expect(state.mapMounts).toBe(1)
    await expand()
    await act(async () => btn('Exit full screen')!.click())
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false)
    expect(host.querySelector('[data-role="header"]')).not.toBeNull()
    expect(btn('Back to trip')).not.toBeNull()
    expect(state.mapMounts).toBe(1)
  })

  it('Android Back leaves full screen first, then the screen', async () => {
    await render()
    await expand()
    expect(await back()).toBe(true)
    expect(onBack).not.toHaveBeenCalled()
    expect(btn('Exit full screen')).toBeNull()
    expect(host.querySelector('[data-role="header"]')).not.toBeNull()
    await back()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('active navigation: maneuver card, SOS, ETA/distance and route check stay; the route is not reset', async () => {
    state.trip = { ...ACTIVE }
    await render()
    const before = JSON.stringify(state.map.points ?? state.map.route ?? null)
    await expand()
    expect(q('maneuver-card')).not.toBeNull()
    expect(btn('Emergency help')).not.toBeNull()
    expect(q('nav-status')!.textContent).toContain('98.8')
    expect(q('route-summary')!.textContent).toContain('Route check')
    expect(q('guidance-panel')).toBeNull()
    expect(JSON.stringify(state.map.points ?? state.map.route ?? null)).toBe(before)
    expect(state.mapMounts).toBe(1)
  })

  it('offline with a saved route: full screen still says so', async () => {
    state.trip = { ...ACTIVE }
    state.geoSource = 'CACHED'
    await render()
    await expand()
    expect(q('route-summary')!.textContent).toContain('Saved route')
  })

  it('SOS opens the emergency sheet in full screen, and Back closes the sheet before leaving full screen', async () => {
    await render()
    await expand()
    await act(async () => btn('Emergency help')!.click())
    expect(q('emergency-sheet')).not.toBeNull()
    await back()
    expect(q('emergency-sheet')).toBeNull()
    expect(btn('Exit full screen')).not.toBeNull()
  })

  it('leaving the screen while full screen gives the tab bar back', async () => {
    await render()
    await expand()
    await act(async () => root.render(createElement(ThemeProvider, null, null)))
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false)
  })
})
