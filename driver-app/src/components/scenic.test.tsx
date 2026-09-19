// @vitest-environment jsdom
/**
 * The Phase B1 driver chrome: accessible names and roles, the touch-target
 * floor, and that each control does what its name says.
 *
 * The react-native mock keeps each element's flattened style on
 * `data-style`, so "at least 48 dp" is read from the style the component
 * actually asks for, not assumed.
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return { openURL: vi.fn(async () => {}) }
})

type Props = {
  children?: ReactNode
  style?: unknown
  onPress?: () => void
  accessibilityLabel?: string
  accessibilityRole?: string
  accessibilityState?: { selected?: boolean }
  testID?: string
  visible?: boolean
  onResponderRelease?: () => void
}

function flatten(style: unknown): Record<string, unknown> {
  if (typeof style === 'function') return flatten(style({ pressed: false }))
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten))
  return style && typeof style === 'object' ? { ...(style as Record<string, unknown>) } : {}
}

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const attrs = (p: Props) => ({
    'aria-label': p.accessibilityLabel,
    'data-role': p.accessibilityRole,
    'data-testid': p.testID,
    'data-selected': p.accessibilityState?.selected === undefined ? undefined : String(p.accessibilityState.selected),
    'data-style': JSON.stringify(flatten(p.style)),
  })
  return {
    // A touch that ends on a View (a backdrop's tap-to-close) is a click here.
    View: (p: Props) => h('div', { ...attrs(p), onClick: p.onResponderRelease }, p.children),
    ScrollView: (p: Props) => h('div', attrs(p), p.children),
    Text: (p: Props) => h('span', attrs(p), p.children),
    Image: (p: Props) => h('img', attrs(p)),
    Pressable: (p: Props) => h('button', { ...attrs(p), onClick: p.onPress }, p.children),
    Modal: (p: Props) => (p.visible ? h('div', { 'data-role': 'modal' }, p.children) : null),
    Linking: { openURL: state.openURL },
    Platform: { OS: 'web' },
    StyleSheet: { create: (v: unknown) => v },
    useColorScheme: () => 'light',
  }
})

import { PHOTOS } from './photoCredits'
import { CoverPhoto, FloatingTabBar, HeroBack, ImageCreditsSheet, PhotoCredit, RowCard, ScreenHero, StatusChip, StatusPill, TopInset } from './scenic'
import { TABS, type Tab } from '../navigation'
import { THEME_STORAGE_KEY, ThemeProvider } from '../theme-context'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  state.openURL.mockClear()
  host = document.createElement('div')
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
})

async function render(node: ReactNode) {
  await act(async () => root.render(createElement(ThemeProvider, null, node)))
}
const style = (el: Element) => JSON.parse(el.getAttribute('data-style') ?? '{}') as Record<string, number | string>

describe('FloatingTabBar', () => {
  const labels: Record<Tab, string> = { trip: 'Trip', navigate: 'Navigate', safety: 'Safety', more: 'More' }

  it('is a tab list of the four tabs, in order, each named and at least 48 dp tall', async () => {
    await render(createElement(FloatingTabBar, { tabs: TABS, active: 'more', onSelect: vi.fn(), label: (t: Tab) => labels[t] }))
    expect(host.querySelector('[data-role="tablist"]')).not.toBeNull()
    const tabs = [...host.querySelectorAll('button[data-role="tab"]')]
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['Trip', 'Navigate', 'Safety', 'More'])
    for (const tab of tabs) expect(Number(style(tab).minHeight)).toBeGreaterThanOrEqual(48)
    expect(tabs.map((t) => t.getAttribute('data-selected'))).toEqual(['false', 'false', 'false', 'true'])
  })

  it('selects the tab that was pressed', async () => {
    const onSelect = vi.fn()
    await render(createElement(FloatingTabBar, { tabs: TABS, active: 'trip', onSelect, label: (t: Tab) => labels[t] }))
    await act(async () => (host.querySelector('[data-testid="tab-safety"]') as HTMLButtonElement).click())
    expect(onSelect).toHaveBeenCalledWith('safety')
  })

  it('paints the active tab as a pill in the shell tokens, not a bordered box', async () => {
    await render(createElement(FloatingTabBar, { tabs: TABS, active: 'navigate', onSelect: vi.fn(), label: (t: Tab) => labels[t] }))
    const bar = host.querySelector('[data-role="tablist"]')!
    const active = host.querySelector('[data-testid="tab-navigate"]')!
    expect(style(bar).borderRadius).toBeGreaterThanOrEqual(20)
    expect(style(active).backgroundColor).toBeTruthy()
    expect(style(active).borderWidth ?? 0).toBe(0)
    // The selected state also has a shape, not only a hue: one indicator,
    // inside the active tab.
    const marks = host.querySelectorAll('[data-testid="tab-indicator"]')
    expect(marks).toHaveLength(1)
    expect(active.contains(marks[0])).toBe(true)
  })
})

describe('RowCard', () => {
  it('is a named button with its title, subtitle, value and a full touch target', async () => {
    const onPress = vi.fn()
    await render(createElement(RowCard, {
      icon: 'sun', title: 'Theme', subtitle: 'Light — light surfaces', value: 'Light', onPress,
      accessibilityLabel: 'Theme: Light. Switch to dark theme', testID: 'row',
    }))
    const row = host.querySelector('[data-testid="row"]') as HTMLButtonElement
    expect(row.getAttribute('data-role')).toBe('button')
    expect(row.getAttribute('aria-label')).toBe('Theme: Light. Switch to dark theme')
    expect(row.textContent).toContain('Light — light surfaces')
    expect(row.querySelector('[data-icon="chevron-right"]')).not.toBeNull()
    expect(Number(style(row).minHeight)).toBeGreaterThanOrEqual(48)
    await act(async () => row.click())
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

describe('PhotoCredit', () => {
  it('is a Photo credits button with no credit text on the photo, from a full touch target', async () => {
    await render(createElement(PhotoCredit, { photo: PHOTOS.more }))
    const control = host.querySelector('[data-testid="photo-credits"]') as HTMLButtonElement
    expect(control.getAttribute('data-role')).toBe('button')
    expect(control.getAttribute('aria-label')).toBe('Photo credits')
    // Owner decision 5: an info disc, no author or licence text over the photo.
    expect(control.textContent).toBe('')
    expect(control.querySelector('[data-icon="info"]')).not.toBeNull()
    expect(Number(style(control).minHeight)).toBeGreaterThanOrEqual(48)
    expect(Number(style(control).minWidth)).toBeGreaterThanOrEqual(48)
    expect(host.querySelector('[data-role="modal"]')).toBeNull()
    expect(state.openURL).not.toHaveBeenCalled()
  })

  it('opens the credits sheet with this photo first: photo, author, licence and both links', async () => {
    await render(createElement(PhotoCredit, { photo: PHOTOS.safety }))
    await act(async () => (host.querySelector('[data-testid="photo-credits"]') as HTMLButtonElement).click())
    const sheet = host.querySelector('[data-role="modal"]')!
    expect(sheet).not.toBeNull()
    const rows = [...sheet.querySelectorAll('[data-testid^="credit-"]')]
    expect(rows).toHaveLength(Object.keys(PHOTOS).length)
    expect(rows[0].getAttribute('data-testid')).toBe(`credit-${PHOTOS.safety.file}`)
    expect(rows[0].querySelector('img')).not.toBeNull()
    expect(rows[0].textContent).toContain(`${PHOTOS.safety.author} · ${PHOTOS.safety.licence}`)
    await act(async () => (rows[0].querySelector(`[aria-label="${PHOTOS.safety.subject}: open the source page"]`) as HTMLButtonElement).click())
    expect(state.openURL).toHaveBeenCalledWith(PHOTOS.safety.page)
    await act(async () => (sheet.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-role="modal"]')).toBeNull()
  })
})

describe('ScreenHero', () => {
  it('shows the title as a header, the status slot and the photo credit', async () => {
    await render(createElement(ScreenHero, {
      photo: PHOTOS.more, title: 'More', subtitle: 'Your details, help and settings',
      status: createElement('i', { 'data-testid': 'gps' }, 'GPS off'),
    }))
    expect(host.querySelector('[data-role="header"]')!.textContent).toBe('More')
    expect(host.textContent).toContain('Your details, help and settings')
    expect(host.querySelector('[data-testid="gps"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="photo-credits"]')!.getAttribute('aria-label')).toBe('Photo credits')
    // No credit text in the hero: the author is only in the sheet.
    expect(host.textContent).not.toContain('Rajesh Dutta')
    // No theme chip unless asked for.
    expect(host.querySelector('button[aria-label^="Switch to"]')).toBeNull()
  })

  it('the optional theme chip switches the theme and says which way', async () => {
    const setItem = vi.fn(async () => {})
    const storage = await import('@react-native-async-storage/async-storage')
    vi.spyOn(storage.default, 'setItem').mockImplementation(setItem)
    await render(createElement(ScreenHero, { photo: PHOTOS.safety, title: 'Safety', themeChip: true }))
    const chip = () => host.querySelector('button[aria-label^="Switch to"]') as HTMLButtonElement
    const before = chip().getAttribute('aria-label')
    await act(async () => chip().click())
    expect(chip().getAttribute('aria-label')).not.toBe(before)
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, expect.stringMatching(/^(light|dark)$/))
    expect(Number(style(chip()).minHeight)).toBeGreaterThanOrEqual(48)
  })
})

describe('ImageCreditsSheet', () => {
  it('lists every shipped photo with author, licence, a source link and a licence link', async () => {
    await render(createElement(ImageCreditsSheet, { open: true, onClose: vi.fn() }))
    for (const photo of Object.values(PHOTOS)) {
      const row = host.querySelector(`[data-testid="credit-${photo.file}"]`)!
      expect(row.textContent).toContain(photo.subject)
      expect(row.textContent).toContain(`${photo.author} · ${photo.licence}`)
      const links = [...row.querySelectorAll('button[data-role="link"]')]
      expect(links).toHaveLength(2)
      for (const link of links) expect(Number(style(link).minHeight)).toBeGreaterThanOrEqual(48)
    }
    const source = host.querySelector(`[aria-label="${PHOTOS.login.subject}: open the source page"]`) as HTMLButtonElement
    await act(async () => source.click())
    expect(state.openURL).toHaveBeenCalledWith(PHOTOS.login.page)
    const licence = host.querySelector('[aria-label="CC BY-SA 4.0: open the licence"]') as HTMLButtonElement
    await act(async () => licence.click())
    expect(state.openURL).toHaveBeenCalledWith('https://creativecommons.org/licenses/by-sa/4.0/')
  })

  it('closes from its close button and from the backdrop, and is absent when closed', async () => {
    const onClose = vi.fn()
    await render(createElement(ImageCreditsSheet, { open: true, onClose }))
    await act(async () => (host.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click())
    // The backdrop closes on a tap but is not a control: nothing to focus,
    // so the sheet's first focus lands on Close (RC-DRV-03).
    const backdrop = host.querySelector('[data-testid="credits-backdrop"]') as HTMLElement
    expect(backdrop.tagName).toBe('DIV')
    expect(host.querySelector('button[aria-label="Close image credits"]')).toBeNull()
    expect([...host.querySelectorAll('button')][0].getAttribute('aria-label')).toBe('Close')
    await act(async () => backdrop.click())
    expect(onClose).toHaveBeenCalledTimes(2)
    await render(createElement(ImageCreditsSheet, { open: false, onClose }))
    expect(host.querySelector('[data-role="modal"]')).toBeNull()
  })
})

describe('CoverPhoto', () => {
  it('fills its box at 100%, not at the asset size (the B1 hero showed a 1080 px corner)', async () => {
    await render(createElement(CoverPhoto, { photo: PHOTOS.safety }))
    const img = host.querySelector('img')!
    expect(style(img)).toMatchObject({ position: 'absolute', width: '100%', height: '100%' })
  })
})

describe('StatusChip', () => {
  it('names the state in words, read from its text: no aria-label on a role-less div', async () => {
    await render(createElement(StatusChip, { text: 'Last known · 3 min', tone: 'off' }))
    const chip = host.querySelector('[data-testid="status-chip"]')!
    expect(chip.getAttribute('aria-label')).toBeNull()
    expect(chip.textContent).toBe('Last known · 3 min')
  })
})

describe('HeroBack and the hero leading slot (Phase B3)', () => {
  it('puts the way back first in the chip row, names where it goes, and is a 48 dp target', async () => {
    const onPress = vi.fn()
    await render(createElement(ScreenHero, {
      photo: PHOTOS.more, title: 'My Details', compact: true,
      status: createElement('i', { 'data-testid': 'gps' }, 'GPS · ±10 m'),
      leading: createElement(HeroBack, { label: 'Back to More', text: 'More', onPress }),
    }))
    const back = host.querySelector('button[aria-label="Back to More"]') as HTMLButtonElement
    expect(back.textContent).toContain('More')
    expect(Number(style(back).minHeight)).toBeGreaterThanOrEqual(48)
    // DOM order is visual order: the back pill comes before the GPS chip.
    const order = [...host.querySelectorAll('button[aria-label="Back to More"], [data-testid="gps"]')].map((e) => e.getAttribute('aria-label') ?? 'gps')
    expect(order).toEqual(['Back to More', 'gps'])
    await act(async () => back.click())
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})

describe('ScreenHero with the credit at its foot (B3D-R02)', () => {
  it('lays the text out above the credit and grows instead of running under it', async () => {
    await render(createElement(ScreenHero, {
      photo: PHOTOS.more, title: 'My Details', subtitle: 'Profile, documents and insurance', compact: true, height: 176, overlap: 14, creditAt: 'bottom',
    }))
    const title = host.querySelector('[data-role="header"]')!
    const block = style(title.parentElement!)
    const hero = style(title.parentElement!.parentElement!)
    expect(block.position).toBe('relative')
    expect(Number(block.marginBottom)).toBeGreaterThanOrEqual(14 + 34)
    expect(hero).toMatchObject({ height: 'auto', minHeight: 176 })
    // The subtitle may wrap: no one-line clamp to cut it.
    expect(host.textContent).toContain('Profile, documents and insurance')
  })
})

describe('ScreenHero with the credit on the title line (CERT-DRV-03, Navigate)', () => {
  it('puts the credit in flow beside the title, so it wraps under it rather than covering it', async () => {
    await render(createElement(ScreenHero, { photo: PHOTOS.navigate, title: 'Navigate', subtitle: 'Guwahati to Shillong', compact: true }))
    const title = host.querySelector('[data-role="header"]')!
    const row = title.parentElement!.parentElement!
    expect(style(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
    // The credit sits in the title's row, not as an absolutely placed plate.
    const credit = row.querySelector('[data-testid="photo-credits"]')!
    expect(credit).toBeTruthy()
    expect(style(credit).position).not.toBe('absolute')
    const hero = style(row.parentElement!.parentElement!)
    expect(hero).toMatchObject({ height: 'auto', minHeight: 158 })
    // One credit only.
    expect(host.querySelectorAll('[data-testid="photo-credits"]')).toHaveLength(1)
  })
})

describe('ScreenHero under the status bar (CERT-DRV-08)', () => {
  it('runs the photo to the top edge and moves the chips and the text down by the inset', async () => {
    await render(createElement(TopInset.Provider, { value: 24 }, createElement(ScreenHero, {
      photo: PHOTOS.more, title: 'More', subtitle: 'Settings', status: createElement('i', { 'data-testid': 'gps' }),
    })))
    const block = host.querySelector('[data-role="header"]')!.parentElement!
    expect(style(block.parentElement!).height).toBe(272 + 24)
    expect(style(block).top).toBe(82 + 24)
    expect(style(host.querySelector('[data-testid="gps"]')!.parentElement!).top).toBe(14 + 24)
  })

  it('adds the inset to a hero that grows with its text', async () => {
    await render(createElement(TopInset.Provider, { value: 24 }, createElement(ScreenHero, {
      photo: PHOTOS.more, title: 'My Details', compact: true, height: 176, overlap: 14, creditAt: 'bottom',
    })))
    const block = host.querySelector('[data-role="header"]')!.parentElement!
    expect(style(block.parentElement!)).toMatchObject({ height: 'auto', minHeight: 176 + 24 })
    expect(style(block).marginTop).toBe(64 + 24)
  })
})

describe('StatusPill', () => {
  it('says the state in words; neutral unless the tone is given', async () => {
    await render(createElement(StatusPill, { text: 'UNKNOWN' }))
    expect(host.querySelector('[data-testid="status-pill"]')!.textContent).toBe('UNKNOWN')
  })
})
