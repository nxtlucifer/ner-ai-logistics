// @vitest-environment jsdom
/**
 * NAV + BREAK add-on (1 Oct 2026): essentials always visible, show/hide controls, the break flow: a layout switch on
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
    startBreak: vi.fn(),
    resumeBreak: vi.fn(),
    acted: [] as unknown[],
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
vi.mock('../api/client', () => ({ api: { requestReroute: vi.fn(), startBreak: (...a: unknown[]) => state.startBreak(...a), resumeBreak: (...a: unknown[]) => state.resumeBreak(...a) } }))
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
  // The provider's act: run the call, keep what the server returned.
  act: async (fn: () => Promise<unknown>) => { state.trip = (await fn()) as Record<string, unknown>; state.acted.push(state.trip) },
  isBusy: false, actionError: null,
}) }))

import MapScreen from './MapScreen'
import { ThemeProvider } from '../theme-context'

let root: Root
let host: HTMLDivElement
const ACTIVE = {
  id: 'trip-a', trip_code: 'TRP-A', status: 'ACTIVE', selected_route_id: 'route-a', tracking: { fresh_seconds: 60 }, tracking_expected: true,
  driver_accepted_at: '2026-10-01T05:00:00Z', can_start: false, start_blocked_code: null, start_blocked_reason: null, progress: null,
  stops: [{ id: 's1', kind: 'PICKUP', name: 'Pickup', address: 'Guwahati Depot', status: 'PENDING' }, { id: 's2', kind: 'DROPOFF', name: 'Delivery', address: 'Shillong Depot', status: 'PENDING' }],
  active_break: null,
}
const BREAK = (over: Record<string, unknown> = {}) => ({
  id: 'brk-1', trip_id: 'trip-a', status: 'ACTIVE', reason: 'FOOD', note: null, planned_minutes: 30,
  started_at: new Date(100_000).toISOString(), expected_end_at: new Date(100_000 + 30 * 60_000).toISOString(),
  ended_at: null, actual_seconds: null, overdue: false, location: { lat: 26.14, lon: 91.73 }, location_source: 'PHONE', location_at: null, ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  vi.clearAllMocks()
  Object.assign(state, { trip: null, back: [], mapMounts: 0, geoSource: 'LIVE', acted: [] })
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
async function render() {
  await act(async () => root.render(createElement(ThemeProvider, null, createElement(MapScreen, { onBack: vi.fn() }))))
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null
const btn = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
const tap = async (el: HTMLElement | null) => act(async () => el!.click())

describe('essential navigation information', () => {
  it('active navigation shows the next turn, speed and the time/arrival/remaining line, in both sizes', async () => {
    state.trip = { ...ACTIVE }
    await render()
    for (const full of [false, true]) {
      if (full) await tap(btn('Expand map to full screen'))
      expect(q('maneuver-card')).not.toBeNull()
      expect(host.querySelector('[aria-label$="km/h"]')).not.toBeNull()
      const status = q('nav-status')!.textContent!
      expect(status).toMatch(/\d{1,2}:\d{2}/) // the time now
      expect(status).toContain('98.8 km') // remaining distance
      expect(status).toMatch(/1 h 17 min/) // remaining time at planned pace
      expect(btn('Emergency help')).not.toBeNull()
    }
    expect(btn('Exit full screen')).not.toBeNull()
  })

  it('hiding the controls takes away the secondary tools only; the essentials stay', async () => {
    state.trip = { ...ACTIVE }
    await render()
    await tap(btn('Expand map to full screen'))
    expect(btn('Take a break')).not.toBeNull()
    expect(host.querySelector('button[aria-label^="Route overview"]')).not.toBeNull()
    await tap(btn('Hide map controls'))
    expect(btn('Take a break')).toBeNull()
    expect(btn('Map layers')).toBeNull()
    expect(host.querySelector('button[aria-label^="Re-centre"]')).toBeNull()
    expect(host.querySelector('button[aria-label^="Route overview"]')).toBeNull()
    // Essentials
    expect(q('maneuver-card')).not.toBeNull()
    expect(q('nav-status')).not.toBeNull()
    expect(btn('Emergency help')).not.toBeNull()
    expect(btn('Exit full screen')).not.toBeNull()
    await tap(btn('Show map controls'))
    expect(btn('Take a break')).not.toBeNull()
    expect(state.mapMounts).toBe(1)
  })

  it('no trip: browsing keeps search, the quick services, full screen and the toggle; no break', async () => {
    await render()
    expect(q('search-field')).not.toBeNull()
    expect(q('quick-actions')).not.toBeNull()
    expect(btn('Take a break')).toBeNull()
    expect(btn('Hide map controls')).not.toBeNull()
    await tap(btn('Expand map to full screen'))
    expect(q('route-summary')!.textContent).toMatch(/\d{1,2}:\d{2}/) // the time in full screen
  })

  it('browsing, the map grows to hold its whole control rail (Expand was cut off on a phone)', async () => {
    await render()
    await act(async () => state.layout['map-overlay']({ nativeEvent: { layout: { y: 0, height: 420 } } }))
    expect(Number(q('map-card')!.getAttribute('data-height'))).toBeGreaterThanOrEqual(8 + 420 + 22 + 4)
  })

  it('a trip not yet started offers no break', async () => {
    state.trip = { ...ACTIVE, status: 'ASSIGNED', tracking_expected: false }
    await render()
    expect(btn('Take a break')).toBeNull()
  })
})

describe('the break flow', () => {
  for (const minutes of [15, 30] as const) {
    it(`a ${minutes} minute break sends the length, the reason, the phone's fix and one request id`, async () => {
      state.trip = { ...ACTIVE }
      state.startBreak.mockImplementation(async () => ({ ...ACTIVE, active_break: BREAK({ planned_minutes: minutes, reason: 'TEA_REST', expected_end_at: new Date(100_000 + minutes * 60_000).toISOString() }) }))
      await render()
      await tap(btn('Take a break'))
      expect(q('break-sheet')).not.toBeNull()
      // No reason, no start.
      expect(q('break-start')!.disabled).toBe(true)
      await tap(q(`break-${minutes}`))
      await tap(q('break-reason-TEA_REST'))
      expect(q('break-start')!.disabled).toBe(false)
      await tap(q('break-start'))
      expect(state.startBreak).toHaveBeenCalledTimes(1)
      const [arg] = state.startBreak.mock.calls[0] as [Record<string, unknown>]
      expect(arg).toMatchObject({ minutes, reason: 'TEA_REST', lat: 26.14, lon: 91.73 })
      expect(String(arg.requestId)).toMatch(/^[0-9a-f-]{36}$/)
      await render() // the provider re-renders with the server's answer
      expect(q('break-sheet')).toBeNull()
      const banner = q('break-banner')!
      expect(banner.textContent).toContain('On break')
      expect(banner.textContent).toContain('Tea / rest')
      expect(banner.textContent).toContain(`${minutes} min left`)
      // The route and the map are untouched.
      expect(q('maneuver-card')).not.toBeNull()
      expect(state.mapMounts).toBe(1)
    })
  }

  it('Back closes the break sheet before anything else', async () => {
    state.trip = { ...ACTIVE }
    await render()
    await tap(btn('Take a break'))
    await act(async () => { state.back.at(-1)!() })
    expect(q('break-sheet')).toBeNull()
  })

  it('resume ends the break with its id and the banner goes', async () => {
    state.trip = { ...ACTIVE, active_break: BREAK() }
    state.resumeBreak.mockImplementation(async () => ({ ...ACTIVE, active_break: null }))
    await render()
    expect(btn('Take a break')).toBeNull() // one break at a time
    await tap(q('break-resume'))
    expect(state.resumeBreak).toHaveBeenCalledWith('brk-1')
    await render()
    expect(q('break-banner')).toBeNull()
    expect(btn('Take a break')).not.toBeNull()
  })

  it('an overrun break says so, and the trip stays on screen', async () => {
    state.trip = { ...ACTIVE, active_break: BREAK({ status: 'OVERDUE', overdue: true, expected_end_at: new Date(100_000 - 4 * 60_000).toISOString() }) }
    await render()
    expect(q('break-banner')!.textContent).toMatch(/Overran by 4 min/)
    expect(q('maneuver-card')).not.toBeNull()
  })
})
