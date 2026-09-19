// @vitest-environment jsdom
/**
 * The phone's map page can reload under us: an Android renderer restart or
 * an iOS content-process kill brings the WebView back from the mount-time
 * html, which then posts 'ready' again. Everything injected since - the theme
 * class, the scene, the hillshade, the route framing - must be sent again, or
 * a driver who switched to Dark after the map mounted gets the old theme back.
 */
import { act, createElement, useImperativeHandle, type Ref } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    mode: 'light' as 'light' | 'dark',
    injected: [] as string[],
    onMessage: null as null | ((e: { nativeEvent: { data: string } }) => void),
  }
})

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children }: { children?: unknown }) => h('div', null, children as never)
  return {
    View: box,
    Pressable: box,
    Text: box,
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  }
})
vi.mock('react-native-webview', () => ({
  WebView: ({ ref, onMessage }: { ref: Ref<unknown>; onMessage: typeof state.onMessage }) => {
    useImperativeHandle(ref, () => ({ injectJavaScript: (js: string) => state.injected.push(js) }))
    state.onMessage = onMessage
    return null
  },
}))
vi.mock('../i18n/tx', () => ({ useT: () => (en: string) => en }))
vi.mock('../theme-context', () => ({ useTheme: () => ({ mode: state.mode }) }))

import DriverRouteMap from './DriverRouteMap.native'

const props = {
  routeId: 'r1',
  points: [[26.1, 91.7], [26.2, 91.8]] as [number, number][],
  backupPoints: [],
  showBackup: false,
  stops: [],
  position: null,
  positionKind: null,
  accuracyM: null,
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  state.injected.length = 0
  state.mode = 'light'
})

const render = () => act(() => root!.render(createElement(DriverRouteMap, props)))
const pageSays = (t: string) => act(() => state.onMessage!({ nativeEvent: { data: JSON.stringify({ t }) } }))

it('re-sends the current theme, scene, hillshade and framing when the page reloads', () => {
  root = createRoot(document.createElement('div'))
  render()
  pageSays('ready')
  expect(state.injected.some((js) => js.includes("toggle('dark', false)"))).toBe(true)

  // The driver switches to Dark after the map mounted.
  state.mode = 'dark'
  render()
  expect(state.injected.at(-1)).toContain("toggle('dark', true)")

  // The page reloads from the mount-time (Light) html and says 'ready' again.
  state.injected.length = 0
  pageSays('ready')
  const sent = state.injected.join('\n')
  expect(sent).toContain("toggle('dark', true)")
  expect(sent).toContain('window.scene(')
  expect(sent).toContain('window.hill(')
  expect(sent).toContain('window.cam({fit:')
})
