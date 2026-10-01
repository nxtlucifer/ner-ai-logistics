// @vitest-environment jsdom
/**
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
    Linking: { openURL: state.openURL }, BackHandler: { addEventListener: () => ({ remove: vi.fn() }) },
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
vi.mock('../map/DriverRouteMap', () => ({ default: (props: Record<string, unknown>) => { state.map = props; return null } }))
vi.mock('../map/useRouteGeometry', () => ({ useRouteGeometry: () => ({
  points: [[26, 91], [27, 92]], backupPoints: [], routeId: 'route-a', distanceKm: 98.8, durationMin: 77,
  stops: [{ stop_id: 'a', sequence: 1, kind: 'PICKUP', name: 'Pickup', address: 'Guwahati Depot' }, { stop_id: 'b', sequence: 2, kind: 'DROPOFF', name: 'Delivery', address: 'Shillong Depot' }],
  isLoading: false, error: null, source: 'LIVE', reload: vi.fn(), capturedAt: null,
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
const onCheckTruck = vi.fn()
const TRIP = {
  id: 'trip-a', trip_code: 'TRP-A', status: 'ASSIGNED', selected_route_id: 'route-a', tracking: { fresh_seconds: 60 }, tracking_expected: false,
  driver_accepted_at: null, can_start: true, start_blocked_code: null, start_blocked_reason: null, progress: null,
  stops: [{ id: 's1', kind: 'PICKUP', name: 'Pickup', address: 'Guwahati Depot' }, { id: 's2', kind: 'DROPOFF', name: 'Delivery', address: 'Shillong Depot' }],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  vi.clearAllMocks()
  state.trip = null
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })
async function render() {
  await act(async () => root.render(createElement(ThemeProvider, null, createElement(MapScreen, { onBack, onCheckTruck }))))
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null
const ctas = () => [...host.querySelectorAll('[data-testid^="cta-"]')].map((e) => e.getAttribute('data-testid'))

describe('the Navigate CTA is the real next step', () => {
  it('no trip: no CTA, the quick actions and the hero say so', async () => {
    await render()
    expect(ctas()).toEqual([])
    expect(host.querySelector('[data-role="header"]')!.textContent).toBe('Navigate')
    expect(q('quick-actions')).not.toBeNull()
    expect(host.textContent).toContain('Browsing the map')
    expect(q('route-info')).toBeNull()
  })

  it('not accepted: routes to the Trip tab, where Accept and its guard live', async () => {
    state.trip = { ...TRIP }
    await render()
    expect(ctas()).toEqual(['cta-accept'])
    await act(async () => q('cta-accept')!.click())
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('accepted and startable: routes to the Trip tab to start', async () => {
    state.trip = { ...TRIP, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    expect(ctas()).toEqual(['cta-start'])
    expect(q('cta-start')!.textContent).toContain('Start the trip on the Trip tab')
  })

  it('an unverified truck: the Trip tab gate path, with the server reason', async () => {
    state.trip = { ...TRIP, driver_accepted_at: '2026-09-27T10:00:00Z', can_start: false, start_blocked_code: 'ASSIGNMENT_NOT_VERIFIED', start_blocked_reason: 'Check the truck before starting.' }
    await render()
    expect(ctas()).toEqual(['cta-check-truck'])
    expect(host.textContent).toContain('Check the truck before starting.')
    await act(async () => q('cta-check-truck')!.click())
    expect(onCheckTruck).toHaveBeenCalledTimes(1)
  })

  it('any other gate: open Trip, with the server reason, never a start of its own', async () => {
    state.trip = { ...TRIP, driver_accepted_at: '2026-09-27T10:00:00Z', can_start: false, start_blocked_code: 'OTHER', start_blocked_reason: 'Waiting for the manager.' }
    await render()
    expect(ctas()).toEqual(['cta-open-trip'])
    expect(host.textContent).toContain('Waiting for the manager.')
  })

  it('a running trip: guidance replaces the quick actions and the maneuver card sits in the map', async () => {
    state.trip = { ...TRIP, status: 'ACTIVE', tracking_expected: true, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    expect(q('quick-actions')).toBeNull()
    expect(q('guidance-panel')).not.toBeNull()
    expect(q('map-card')!.querySelector('[data-testid="maneuver-card"]')).not.toBeNull()
    expect(ctas()).toHaveLength(1)
    expect(ctas()[0]).toMatch(/^cta-(guidance|details)$/)
  })
})

describe('the camera and the summary follow the trip state', () => {
  it('before the start: the whole route framed clear of the summary, no auto-follow, no nav chip', async () => {
    state.trip = { ...TRIP, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    expect(state.map.autoFollow).toBe(false)
    expect(state.map.frame).toMatchObject({ right: 64, obstacle: { width: expect.any(Number), height: expect.any(Number) } })
    // "Following" on a trip not yet running read as guidance (B2D-09).
    expect(q('nav-state')).toBeNull()
  })

  it('while guiding: follows the truck; the summary is the nav chip, the route check and the status line', async () => {
    state.trip = { ...TRIP, status: 'ACTIVE', tracking_expected: true, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    expect(state.map.autoFollow).toBe(true)
    const summary = q('route-summary')!
    expect(summary.querySelector('[data-testid="nav-state"]')).not.toBeNull()
    expect(summary.textContent).toContain('Route check: NOT ASSESSED')
    // Nav break add-on (1 Oct 2026): the time, arrival, remaining time and
    // distance stay on the map in both sizes, from the planned pace only.
    const status = summary.querySelector('[data-testid="nav-status"]')!.textContent!
    expect(status).toContain('98.8 km')
    expect(status).toMatch(/\d{1,2}:\d{2}/)
  })

  it('keeps the route summary above the attribution line the map measures (RC-DRV-09)', async () => {
    state.trip = { ...TRIP, status: 'ACTIVE', tracking_expected: true, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    const summaryBottom = () => q('route-summary')!.getAttribute('data-bottom')
    // Nothing measured yet: the font-scale room, 22 px at scale 1.
    expect(summaryBottom()).toBe('22')
    // One 12 px line (17 px) keeps it; larger text wrapping it to 50 px lifts it.
    await act(async () => (state.map.onAttributionHeight as (px: number) => void)(17))
    expect(summaryBottom()).toBe('22')
    await act(async () => (state.map.onAttributionHeight as (px: number) => void)(50))
    expect(summaryBottom()).toBe('55')
  })

  it('browsing: the map grows only when large text lifts the summary into the top row (RC-DRV-09)', async () => {
    await render()
    const height = () => q('map-card')!.getAttribute('data-height')
    const lay = async (summaryH: number, attributionH: number) => act(async () => {
      state.layout['route-summary']({ nativeEvent: { layout: { y: 0, height: summaryH } } })
      ;(state.map.onAttributionHeight as (px: number) => void)(attributionH)
    })
    // 412 x 915: the adopted 275 px map. Normal text: a 66 px summary on a 17 px line.
    expect(height()).toBe('275')
    await lay(66, 17)
    expect(height()).toBe('275')
    // x1.5 on the web: the summary 131 px and the line wrapped to 95 px. Top
    // row 8 + 48, 12 clear, the summary, then the line and its 5 px.
    await lay(131, 95)
    expect(height()).toBe(String(8 + 48 + 12 + 131 + 100))
  })

  it('while guiding: arrival is labelled at planned pace, and the tiles do not repeat the ETA row', async () => {
    state.trip = {
      ...TRIP, status: 'ACTIVE', tracking_expected: true, driver_accepted_at: '2026-09-27T10:00:00Z',
      progress: { remaining_distance_km: 80, remaining_at_planned_pace_min: 70, travelled_distance_km: 18.8, on_route: true },
      stops: [{ id: 's1', kind: 'PICKUP', status: 'COMPLETED', name: 'Pickup', address: 'Guwahati Depot' }, { id: 's2', kind: 'DROPOFF', status: 'PENDING', name: 'Delivery', address: 'Shillong Depot' }],
    }
    await render()
    expect(q('eta-bar')!.textContent).toContain('arrival · at planned pace')
    expect(q('eta-bar')!.textContent).toContain('remaining')
    expect(q('tile-distance')).toBeNull()
    expect(q('tile-time')).toBeNull()
    expect(q('tile-next-stop')!.textContent).toContain('Shillong Depot')
    // No risk payload: the next terrain is not assessed, never "none".
    expect(q('tile-next-terrain')!.textContent).toContain('NOT ASSESSED')
  })

  it('remembers that guidance was followed on this trip across a remount of the screen', async () => {
    state.trip = { ...TRIP, id: 'trip-follow', status: 'ACTIVE', tracking_expected: true, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    expect(q('cta-guidance')!.textContent).toContain('Start guidance')
    await act(async () => (state.map.onFollowChange as (on: boolean) => void)(true))
    expect(ctas()).toEqual(['cta-details'])
    // A tab switch unmounts Navigate; coming back must not say "Start" again.
    await act(async () => root.unmount())
    root = createRoot(host)
    await render()
    expect(q('cta-guidance')!.textContent).toContain('Resume guidance')
  })
})

describe('the summary and the tiles never invent', () => {
  it('names the real places, distance and planned pace, and NOT ASSESSED without a route check', async () => {
    state.trip = { ...TRIP, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    const summary = q('route-summary')!.textContent ?? ''
    expect(summary).toContain('Guwahati Depot → Shillong Depot')
    expect(summary).toContain('98.8 km')
    expect(summary).toContain('1 h 17 min at planned pace')
    expect(summary).toContain('Route check: NOT ASSESSED')
    expect(q('tile-terrain')!.textContent).toContain('NOT ASSESSED')
    expect(q('tile-weather')!.textContent).toContain('NOT ASSESSED')
    // "not a statement that the road is clear" is the card's own disclaimer;
    // a verdict would be a capitalised "Clear".
    expect((host.textContent ?? '').match(/.{0,40}(\b[Ss]afe\b|Clear|Moderate|Suggested).{0,40}/g)).toBeNull()
  })
})

describe('quick actions', () => {
  it('Fuel, lay-bys and tyres search real categories; Request help opens the real sheet', async () => {
    state.trip = { ...TRIP, driver_accepted_at: '2026-09-27T10:00:00Z' }
    await render()
    await act(async () => q('quick-fuel')!.click())
    expect(state.search).toHaveBeenCalledWith(expect.objectContaining({ category: 'FUEL', anchor: 'ROUTE_CORRIDOR' }))
    expect(q('details-panel')).not.toBeNull()
    await act(async () => q('quick-rest')!.click())
    expect(state.search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'REST' }))
    await act(async () => q('quick-tyres')!.click())
    expect(state.search).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'TYRES' }))
    expect(host.textContent).not.toContain('Food')
    await act(async () => q('quick-help')!.click())
    const sheet = q('emergency-sheet')!
    expect(sheet.textContent).toContain('You still press call.')
    await act(async () => (sheet.querySelector('button[aria-label^="Call 112"]') as HTMLButtonElement).click())
    expect(state.openURL).toHaveBeenCalledWith('tel:112')
  })

  it('the search field is the roadside-services search, with no mic', async () => {
    await render()
    const field = q('search-field')!
    expect(field.getAttribute('aria-label')).toBe('Search roadside services')
    expect(host.querySelector('[aria-label*="voice search" i], [aria-label*="microphone" i]')).toBeNull()
    await act(async () => field.click())
    expect(q('details-panel')!.textContent).toContain('Roadside services')
  })
})

describe('no prominent credits UI (company showcase, 1 Oct 2026)', () => {
  it('Navigate carries no Photo credits control and no credit text', async () => {
    await render()
    expect(host.querySelectorAll('[data-testid="photo-credits"]')).toHaveLength(0)
    expect(host.querySelector('button[aria-label="Photo credits"]')).toBeNull()
    expect(host.textContent).not.toMatch(/Image credits|Jyoti Chiring|Rajesh Dutta|CC BY/)
  })
})
