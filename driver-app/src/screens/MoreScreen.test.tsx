// @vitest-environment jsdom
/**
 * Every function the More tab had before the redesign still works from the
 * redesigned screen (audit s11.2: My details, How RASTA works, Driver
 * Assistant, Language, Theme, Sign Out), plus the new Image credits link, and
 * the hero carries the GPS status the shell header no longer shows here.
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return { logout: vi.fn(async () => {}), openURL: vi.fn(async () => {}) }
})

type Props = {
  children?: ReactNode
  onPress?: () => void
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
    TextInput: () => h('input'),
    Image: () => null,
    Pressable: (p: Props) => h('button', { ...attrs(p), onClick: p.onPress }, p.children),
    Modal: (p: Props) => (p.visible ? h('div', { 'data-role': 'modal' }, p.children) : null),
    Linking: { openURL: state.openURL },
    Platform: { OS: 'android' },
    StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
    useColorScheme: () => 'light',
  }
})
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ logout: state.logout }) }))

import MoreScreen from './MoreScreen'
import { ThemeProvider } from '../theme-context'

let root: Root
let host: HTMLDivElement
const handlers = { onOpenAssistant: vi.fn(), onOpenDetails: vi.fn(), onOpenTutorial: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
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
        createElement(MoreScreen, { ...handlers, status: createElement('i', { 'data-testid': 'gps-chip' }, 'GPS off') }),
      ),
    ),
  )
}
const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement
const tap = async (id: string) => act(async () => byId(id).click())

describe('More', () => {
  it('shows the reference rows in order, then Sign Out, the tagline, the credits link and no Day/Night', async () => {
    await render()
    const rows = [...host.querySelectorAll('button[data-testid^="more-"]')].map((b) => b.getAttribute('data-testid'))
    // Five rows, so Sign Out stays on the first screen at 450 x 800; Image
    // credits is a link under the tagline, not a sixth row.
    expect(rows).toEqual([
      'more-my-details', 'more-assistant', 'more-language', 'more-theme', 'more-tutorial', 'more-sign-out', 'more-image-credits',
    ])
    expect(byId('more-image-credits').getAttribute('aria-label')).toBe('Image credits')
    expect(host.textContent).toContain('PEOPLE · PLACES · PROGRESS')
    expect(host.textContent).not.toMatch(/\b(Day|Night)\b/)
  })

  it('carries the title, the GPS status and the photo credit in its hero', async () => {
    await render()
    expect(host.querySelector('[data-role="header"]')!.textContent).toBe('More')
    expect(byId('gps-chip')).not.toBeNull()
    expect(byId('photo-credits').getAttribute('aria-label')).toBe('Photo credits')
    expect(host.textContent).not.toContain('Rajesh Dutta')
  })

  it('opens My details, the Driver Assistant and the tutorial', async () => {
    await render()
    await tap('more-my-details')
    await tap('more-assistant')
    await tap('more-tutorial')
    expect(handlers.onOpenDetails).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenAssistant).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenTutorial).toHaveBeenCalledTimes(1)
  })

  it('Language names the current language and opens the language sheet', async () => {
    await render()
    expect(byId('more-language').getAttribute('aria-label')).toBe('Language: English. Opens language chooser')
    expect(byId('more-language').textContent).toContain("changes the app's own labels")
    expect(host.textContent).not.toContain('All languages')
    await tap('more-language')
    expect(host.textContent).toContain('All languages')
  })

  it('Theme switches Light and Dark in place, with Light/Dark wording only', async () => {
    await render()
    const theme = () => byId('more-theme')
    expect(theme().textContent).toContain('Light — light surfaces')
    expect(theme().getAttribute('aria-label')).toBe('Theme: Light. Switch to dark theme')
    await tap('more-theme')
    expect(theme().textContent).toContain('Dark — dark cab surfaces')
    expect(theme().textContent).toContain('Dark')
    expect(theme().getAttribute('aria-label')).toBe('Theme: Dark. Switch to light theme')
    await tap('more-theme')
    expect(theme().textContent).toContain('Light — light surfaces')
  })

  it('Image credits lists every photo and links to its source', async () => {
    await render()
    expect(host.querySelector('[data-role="modal"]')).toBeNull()
    await tap('more-image-credits')
    const sheet = host.querySelector('[data-role="modal"]')!
    expect(sheet.textContent).toContain('Image credits')
    expect(sheet.querySelectorAll('[data-testid^="credit-"]')).toHaveLength(5)
    await act(async () => (sheet.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-role="modal"]')).toBeNull()
  })

  it('Sign Out calls the real logout', async () => {
    await render()
    await tap('more-sign-out')
    expect(state.logout).toHaveBeenCalledTimes(1)
  })
})
