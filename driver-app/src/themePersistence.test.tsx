// @vitest-environment jsdom
/**
 * The Light/Dark choice: stored, restored at launch without a wrong-theme
 * frame, and switched with zero network traffic.
 *
 * Zero traffic is checked at the transport, not assumed from the code: the
 * test renders the real More -> Theme row and the real web map, taps the row,
 * and counts every fetch, every XMLHttpRequest and every API client call. It
 * also counts Leaflet map and tile-layer constructions, because "switching
 * the theme rebuilt the map" is how a theme switch would start reloading
 * tiles and losing the driver's camera.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  const store = new Map<string, string>()
  const calls = { map: 0, tileLayer: 0 }
  const layer = () => {
    const self = { on: () => self, addTo: () => self, remove: () => {}, bindTooltip: () => self }
    return self
  }
  const leaflet = {
    map: () => {
      calls.map += 1
      const bounds = { getSouth: () => 0, getWest: () => 0, getNorth: () => 0, getEast: () => 0 }
      return {
        on: () => {}, off: () => {}, remove: () => {}, invalidateSize: () => {}, fitBounds: () => {},
        setView: () => {}, panTo: () => {}, getZoom: () => 6, getBounds: () => bounds,
        getPane: () => null, createPane: () => ({ style: {} }),
      }
    },
    tileLayer: () => {
      calls.tileLayer += 1
      return layer()
    },
    polyline: layer, circle: layer, circleMarker: layer, marker: layer,
    divIcon: () => ({}), latLngBounds: () => ({}),
  }
  return {
    system: 'light' as 'light' | 'dark' | null,
    store,
    calls,
    leaflet,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    api: new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get: (target, key: string) => (target[key] ??= vi.fn()),
    }),
  }
})

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  type P = { children?: ReactNode; onPress?: () => void; accessibilityLabel?: string }
  const box = ({ children }: P) => h('div', null, children)
  return {
    View: box,
    ScrollView: box,
    Image: () => null,
    Modal: ({ visible, children }: P & { visible?: boolean }) => (visible ? h('div', null, children) : null),
    Linking: { openURL: async () => {} },
    Platform: { OS: 'web' },
    Text: ({ children }: P) => h('span', null, children),
    Pressable: ({ children, onPress, accessibilityLabel }: P) =>
      h('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    useColorScheme: () => state.system,
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: state.getItem, setItem: state.setItem },
}))
vi.mock('leaflet', () => ({ default: state.leaflet }))
vi.mock('./api/client', () => ({ api: state.api }))
vi.mock('./components/icons', () => ({ Icon: () => null }))
vi.mock('./auth/AuthProvider', () => ({ useAuth: () => ({ logout: state.api.logout }) }))
vi.mock('./i18n/tx', () => ({ useT: () => (en: string) => en }))
vi.mock('./i18n/AppLanguageProvider', () => ({
  useAppLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (key: string) => key }),
}))
vi.mock('./i18n/LanguageSheet', () => ({ LanguageSheet: () => null }))

import DriverRouteMap from './map/DriverRouteMap.web'
import MoreScreen from './screens/MoreScreen'
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from './theme-context'
import { DARK, LIGHT } from './theme'

let root: Root
let host: HTMLDivElement
const fetchSpy = vi.fn()
const xhrOpen = vi.fn()

beforeEach(() => {
  state.store.clear()
  state.system = 'light'
  state.calls.map = 0
  state.calls.tileLayer = 0
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(xhrOpen)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Records every mode the tree was ever rendered in, in order. */
const seen: string[] = []
function Probe() {
  const { mode } = useTheme()
  seen.push(mode)
  return createElement('i', { 'data-mode': mode })
}

async function mount(children: ReactNode) {
  await act(async () => root.render(createElement(ThemeProvider, null, children)))
}

describe('theme persistence', () => {
  beforeEach(() => { seen.length = 0 })

  it('restores a stored Dark at launch, and never paints the system Light first', async () => {
    state.store.set(THEME_STORAGE_KEY, 'dark')
    state.system = 'light'
    await mount(createElement(Probe))
    expect(state.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY)
    expect(seen).toEqual(['dark'])
  })

  it('restores a stored Light over a Dark system', async () => {
    state.store.set(THEME_STORAGE_KEY, 'light')
    state.system = 'dark'
    await mount(createElement(Probe))
    expect(seen).toEqual(['light'])
  })

  it('renders nothing until the stored choice has been read', async () => {
    let release!: (value: string | null) => void
    state.getItem.mockImplementationOnce(() => new Promise((done) => { release = done }))
    await mount(createElement(Probe))
    expect(host.innerHTML).toBe('')
    expect(seen).toEqual([])
    await act(async () => release('dark'))
    expect(seen).toEqual(['dark'])
  })

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    [null, 'dark'],
  ] as const)('with nothing stored, a %s system opens in %s (first use unchanged)', async (system, expected) => {
    state.system = system
    await mount(createElement(Probe))
    expect(seen).toEqual([expected])
    expect(state.setItem).not.toHaveBeenCalled()
  })

  it('falls back to the first-use rule when storage cannot be read', async () => {
    state.getItem.mockRejectedValueOnce(new Error('storage blocked'))
    await mount(createElement(Probe))
    expect(seen).toEqual(['light'])
  })

  it('persists an explicit choice, and the next launch opens in it', async () => {
    await mount(createElement(MoreScreen, { onOpenAssistant: vi.fn(), onOpenDetails: vi.fn(), onOpenTutorial: vi.fn() }))
    const row = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Theme'))!
    expect(row().textContent).toContain('Light — light surfaces')
    await act(async () => row().click())
    expect(row().textContent).toContain('Dark — dark cab surfaces')
    expect(state.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark')

    await act(async () => root.unmount())
    root = createRoot(host)
    seen.length = 0
    await mount(createElement(Probe))
    expect(seen).toEqual(['dark'])
  })
})

describe('the web page before the bundle loads', () => {
  // public/index.html paints the ground of the theme the app will open in, so
  // a stored Dark does not start on a white page for the ~200 ms the bundle
  // takes. Run the real inline script, not a copy of it.
  const html = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8')
  const boot = /<script>([\s\S]*?)<\/script>/.exec(html)![1]
  const ground = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

  function runBoot(stored: string | null | Error, systemDark: boolean) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: systemDark && q.includes('dark') }))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (stored instanceof Error) throw stored
      return key === THEME_STORAGE_KEY ? stored : null
    })
    document.documentElement.removeAttribute('style')
    new Function(boot)()
    return document.documentElement.style
  }

  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
    [new Error('storage blocked'), true, 'dark'],
  ] as const)('stored %s over a dark=%s system paints the %s ground', (stored, systemDark, expected) => {
    const style = runBoot(stored, systemDark)
    expect(style.background).toBe(ground(expected === 'dark' ? DARK.bg : LIGHT.bg))
    expect(style.colorScheme).toBe(expected)
  })
})

describe('a theme switch', () => {
  it('makes zero transport calls and keeps the map it already built', async () => {
    const mapProps = {
      routeId: 'route-a', points: [[26.1, 91.7], [26.2, 91.8]] as [number, number][], progressFraction: 0.5,
      backupPoints: [], showBackup: false, stops: [], position: [26.15, 91.75] as [number, number],
      positionKind: 'LIVE' as const, accuracyM: 12, positionAgeSeconds: 2, cameraTrigger: 0,
    }
    await mount([
      createElement(MoreScreen, { key: 'more', onOpenAssistant: vi.fn(), onOpenDetails: vi.fn(), onOpenTutorial: vi.fn() }),
      createElement(DriverRouteMap, { key: 'map', ...mapProps, testID: 'map' }),
    ])
    const wrapper = () => host.querySelector('[data-testid="map"]')!
    expect(wrapper().className).toBe('')
    expect(state.calls).toEqual({ map: 1, tileLayer: 1 })
    fetchSpy.mockClear()
    xhrOpen.mockClear()

    const row = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Theme'))!
    await act(async () => row.click())
    await act(async () => row.click())
    await act(async () => row.click())

    // Light -> Dark -> Light -> Dark: the wrapper class is the whole map change.
    expect(wrapper().className).toBe('rasta-map-dark')
    expect(document.getElementById('rasta-map-dark')?.textContent).toContain('.rasta-map-dark .leaflet-tile-pane{filter:')
    expect(state.calls).toEqual({ map: 1, tileLayer: 1 })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrOpen).not.toHaveBeenCalled()
    const apiCalls = Object.entries(state.api).filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name)
    expect(apiCalls).toEqual([])
    // The only I/O a switch does is the local write of the choice.
    expect(state.setItem.mock.calls).toEqual([
      [THEME_STORAGE_KEY, 'dark'], [THEME_STORAGE_KEY, 'light'], [THEME_STORAGE_KEY, 'dark'],
    ])
  })
})
