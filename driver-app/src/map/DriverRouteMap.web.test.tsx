// @vitest-environment jsdom
/**
 * Keyboard focus on the web map (CERT-DRV-01).
 *
 * Leaflet listens for focus on every shape with a tooltip, and Chrome makes an
 * SVG shape with a focus listener a Tab stop. The live GPS dot is redrawn every
 * second, so Tab landed on it, the redraw removed it, and focus fell to <body>
 * for good: Back, SOS, the map controls and the tab bar were unreachable. The
 * map container is the one Tab stop, with a role and a name.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const shapes = vi.hoisted(() => [] as { tip: boolean; el: Element }[])
const attribution = vi.hoisted(() => ({ el: null as HTMLElement | null }))
vi.mock('leaflet', () => {
  const layer = () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const rec = { tip: false, el }
    shapes.push(rec)
    const self = {
      on: () => self, addTo: () => self, remove: () => {}, getElement: () => el,
      bindTooltip: () => { rec.tip = true; return self },
    }
    return self
  }
  const bounds = { getSouth: () => 0, getWest: () => 0, getNorth: () => 0, getEast: () => 0 }
  const map = () => ({
    on: () => {}, off: () => {}, remove: () => {}, invalidateSize: () => {}, fitBounds: () => {},
    setView: () => {}, panTo: () => {}, getZoom: () => 6, getBounds: () => bounds,
    getPane: () => null, createPane: () => ({ style: {} }),
    attributionControl: { getContainer: () => (attribution.el ??= document.createElement('div')) },
  })
  return { default: { map, tileLayer: layer, polyline: layer, circle: layer, circleMarker: layer, marker: layer, divIcon: () => ({}), latLngBounds: () => ({}) } }
})
vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('../theme-context', async () => {
  const { LIGHT } = await import('../theme')
  return { useTheme: () => ({ mode: 'light', colors: LIGHT }) }
})

const { default: DriverRouteMap } = await import('./DriverRouteMap.web')

it('keeps the tooltip shapes out of the Tab order and names the map', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(DriverRouteMap, {
    routeId: 'r', points: [[26.1, 91.7], [26.2, 91.8]], progressFraction: null, backupPoints: [], showBackup: false,
    stops: [], position: [26.15, 91.75], positionKind: 'LIVE', accuracyM: 10, positionAgeSeconds: 2,
  })))
  const tipped = shapes.filter((s) => s.tip)
  // The live GPS dot at least.
  expect(tipped.length).toBeGreaterThan(0)
  for (const s of tipped) expect(s.el.getAttribute('tabindex')).toBe('-1')
  const region = host.querySelector('[role="region"]')!
  expect(region.getAttribute('aria-label')).toBe('Map')
  await act(async () => root.unmount())
})

it('reports how far the attribution line reaches up from the map foot, and again when it grows (RC-DRV-09)', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const observers: { cb: () => void; els: Element[] }[] = []
  vi.stubGlobal('ResizeObserver', class {
    rec: { cb: () => void; els: Element[] }
    constructor(cb: () => void) { this.rec = { cb, els: [] }; observers.push(this.rec) }
    observe(el: Element) { this.rec.els.push(el) }
    disconnect() {}
  })
  const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect
  const heights: number[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(DriverRouteMap, {
    routeId: 'r', points: [], progressFraction: null, backupPoints: [], showBackup: false,
    stops: [], position: null, positionKind: null, accuracyM: null, onAttributionHeight: (px: number) => heights.push(px),
  })))
  const holder = host.querySelector('[role="region"]') as HTMLElement
  holder.getBoundingClientRect = () => rect(0, 400)
  const obs = observers.find((o) => o.els.includes(attribution.el!))!
  expect(obs.els).toContain(holder)
  // One 12 px line, then larger text wrapping it onto two.
  attribution.el!.getBoundingClientRect = () => rect(383.2, 400)
  obs.cb()
  attribution.el!.getBoundingClientRect = () => rect(350, 400)
  obs.cb()
  expect(heights).toEqual([17, 50])
  await act(async () => root.unmount())
})
