// @vitest-environment jsdom
/**
 * Safety after the driver_03 redesign keeps every function it had (audit
 * s11.2): the 112 / 108 / 1033 dialler links, the break card, the offline
 * guidance with its medical disclaimer, topic detail and its way back. The
 * tools grid is audit s7's mapping of the reference's four onto real
 * functions, plus the stop request and breaks while a trip runs - never a
 * dead tile, and none of the reference's fake ones.
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    openURL: vi.fn(async () => {}),
    trip: null as Record<string, unknown> | null,
    gps: { text: 'GPS · ±10 m', live: true },
    gpsBrowse: [] as boolean[],
  }
})

type Props = {
  children?: ReactNode
  onPress?: () => void
  disabled?: boolean
  accessibilityLabel?: string
  accessibilityRole?: string
  testID?: string
  visible?: boolean
}

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const attrs = (p: Props) => ({ 'aria-label': p.accessibilityLabel, 'data-role': p.accessibilityRole, 'data-testid': p.testID })
  return {
    View: (p: Props) => h('div', attrs(p), p.children),
    ScrollView: (p: Props) => h('div', attrs(p), p.children),
    Text: (p: Props) => h('span', attrs(p), p.children),
    Image: () => null,
    Pressable: (p: Props) => h('button', { ...attrs(p), disabled: p.disabled, onClick: p.onPress }, p.children),
    Modal: (p: Props) => (p.visible ? h('div', { 'data-role': 'modal' }, p.children) : null),
    Linking: { openURL: state.openURL },
    Platform: { OS: 'android' },
    StyleSheet: { create: (v: unknown) => v },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 412, height: 915 }),
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}))
vi.mock('../trip/TripProvider', () => ({ useTrip: () => ({ trip: state.trip }) }))
vi.mock('../map/useGpsStatus', () => ({ useGpsStatus: (browse: boolean) => { state.gpsBrowse.push(browse); return state.gps } }))
vi.mock('../ai/AiPanel', () => ({ default: () => null }))
vi.mock('../ai/useLocalAi', () => ({ useLocalAi: () => ({}) }))

import SafetyScreen from './SafetyScreen'
import { ThemeProvider } from '../theme-context'

let root: Root
let host: HTMLDivElement
const handlers = { onOpenTrip: vi.fn(), onOpenNavigate: vi.fn(), onOpenDetails: vi.fn(), onOpenAssistant: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  state.trip = null
  state.gps = { text: 'GPS · ±10 m', live: true }
  state.gpsBrowse = []
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
})

async function render() {
  await act(async () =>
    root.render(
      createElement(ThemeProvider, null,
        createElement(SafetyScreen, handlers),
      ),
    ),
  )
}
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement
const click = (el: HTMLElement) => act(async () => el.click())

describe('Safety (driver_03)', () => {
  it('has a hero with the title, the GPS chip, a theme chip and the photo credit', async () => {
    await render()
    expect(host.querySelector('[data-role="header"]')!.textContent).toBe('Safety')
    // The phone's GPS by Navigate's rule (browse watch when no trip owns it).
    expect(q('status-chip')!.textContent).toBe('GPS · ±10 m')
    expect(state.gpsBrowse.every(Boolean)).toBe(true)
    expect(host.querySelector('button[aria-label^="Switch to"]')).not.toBeNull()
    // The hero and the banner each carry a Photo credits control, and no
    // credit text sits on either photo (owner decision 5).
    expect(host.querySelectorAll('button[aria-label="Photo credits"]')).toHaveLength(2)
    expect(host.textContent).not.toContain('Ashwin Kumar')
    expect(host.textContent).not.toContain('Rajesh Dutta')
  })

  it('opens the dialler for 112, 108 and 1033, and Call 112, and says it does not place the call', async () => {
    await render()
    for (const n of ['112', '108', '1033']) {
      expect(q(`call-${n}`).getAttribute('aria-label')).toMatch(new RegExp(`^Call ${n}, `))
      await click(q(`call-${n}`))
      expect(state.openURL).toHaveBeenLastCalledWith(`tel:${n}`)
    }
    await click(q('call-112-cta'))
    expect(state.openURL).toHaveBeenLastCalledWith('tel:112')
    expect(q('safety-numbers').textContent).toContain('You still press call.')
  })

  it('maps the reference tools onto real functions (audit s7), and draws none of the fake ones', async () => {
    await render()
    const tools = q('safety-tools').textContent ?? ''
    expect(tools).not.toMatch(/Live Location|Emergency Contacts|live location|share|manage/i)
    const ids = [...q('safety-tools').querySelectorAll('button[data-testid^="tool-"]')].map((b) => b.getAttribute('data-testid'))
    expect(ids).toEqual(['tool-location', 'tool-guidance', 'tool-contact', 'tool-assistant'])
    // Every tool acts: no dead tile with no trip.
    for (const id of ids) expect(q(id!).disabled).toBe(false)
  })

  it('Your location shows the GPS state and opens Navigate; Emergency contact opens My details, read-only', async () => {
    state.gps = { text: 'Last known · 2 min', live: false }
    await render()
    expect(q('tool-location').getAttribute('aria-label')).toBe('Your location. Last known · 2 min')
    await click(q('tool-location'))
    expect(handlers.onOpenNavigate).toHaveBeenCalledTimes(1)
    expect(q('tool-contact').getAttribute('aria-label')).toBe('Emergency contact. View in My Details')
    await click(q('tool-contact'))
    expect(handlers.onOpenDetails).toHaveBeenCalledTimes(1)
    await click(q('tool-assistant'))
    expect(handlers.onOpenAssistant).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenTrip).not.toHaveBeenCalled()
  })

  it('with no trip running, the stop request and break tools are not drawn', async () => {
    await render()
    expect(q('tool-stop-request')).toBeNull()
    expect(q('tool-breaks')).toBeNull()
  })

  it('with a started trip, the stop request opens the Trip tab and the break card is on screen', async () => {
    state.trip = { tracking_expected: true, started_at: new Date(Date.now() - 30 * 60_000).toISOString() }
    await render()
    expect(q('tool-stop-request').disabled).toBe(false)
    await click(q('tool-stop-request'))
    expect(handlers.onOpenTrip).toHaveBeenCalledTimes(1)
    expect(q('tool-breaks').disabled).toBe(false)
    expect(host.querySelector('button[aria-label="Record that you stopped for a break"]')).not.toBeNull()
  })

  it('keeps the guidance with its medical disclaimer, and topic detail keeps its back and the GPS chip', async () => {
    await render()
    const guidance = q('safety-guidance').textContent ?? ''
    expect(guidance).toContain('Not a diagnosis')
    expect(guidance).toContain('EMERGENCY')
    await click(host.querySelector('button[aria-label$="Emergency topic."]') as HTMLButtonElement)
    expect(host.querySelector('button[aria-label="Back to safety topics"]')).not.toBeNull()
    expect(q('status-chip')).not.toBeNull()
    expect(host.textContent).toContain('Not a diagnosis')
    await click(host.querySelector('button[aria-label="Back to safety topics"]') as HTMLButtonElement)
    expect(q('safety-tools')).not.toBeNull()
  })

  it('never calls the road safe', async () => {
    state.trip = { tracking_expected: true, started_at: new Date().toISOString() }
    await render()
    expect(host.textContent).not.toMatch(/\bsafe route\b|route status: safe|\bis safe\b/i)
  })
})
