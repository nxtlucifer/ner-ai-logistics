// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    assignment: vi.fn(),
    trip: { trip: null as unknown, phase: 'ready', loadError: null, actionError: null, isBusy: false, isStale: false, loadedAt: 100_000, load: vi.fn(), act: vi.fn(), tracking: { permission: 'unknown', isTracking: false, lastPosition: null } },
  }
})
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children }: { children?: import('react').ReactNode }) => h('div', null, children)
  return { View: box, ScrollView: box, Pressable: box, Text: box, RefreshControl: () => null,
    Linking: { openURL: vi.fn() }, StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } }
})
vi.mock('../api/client', () => ({ api: { myAssignment: () => state.assignment() } }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ driver: { full_name: 'Test Driver' } }) }))
vi.mock('../components/ui', async () => {
  const { createElement: h } = await import('react')
  return {
    Banner: () => null, Loading: () => null, errorMessage: () => ({ title: 'x', detail: 'y' }),
    Button: ({ label }: { label: string }) => h('button', null, label),
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
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })

describe('the Trip page with no trip', () => {
  it('says available, shows only real facts, and invents no route, ETA or risk', async () => {
    await act(async () => root.render(createElement(TripScreen, { onOpenMap: () => {}, onCheckTruck: () => {} })))
    await act(async () => { await Promise.resolve() })
    const text = host.textContent ?? ''
    expect(text).toContain('No active trip')
    expect(text).toContain('appear here automatically')
    expect(text).toContain('Open map')
    expect(text).toContain('Driver: Test Driver')
    expect(text).toContain('Truck: AS86QQ7606 · not verified')
    expect(text).toContain('Connection: Connected')
    expect(text).toContain('Last sync: 1 min ago')
    expect(text).toContain('Emergency: 112')
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
})
