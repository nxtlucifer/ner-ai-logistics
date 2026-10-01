// @vitest-environment jsdom
/**
 * Light / Dark (Phase A theme foundation).
 *
 * What is pinned here, and why each one:
 *
 *   - switching makes no request. The theme is an attribute and a local
 *     preference; a switch that fetched anything would be a switch that can
 *     fail offline, and this console is used offline.
 *   - the explicit choice persists, and the pre-paint script in index.html is
 *     what applies it - so a Dark console never flashes Light on load.
 *   - every text token is AA on every surface it sits on, in BOTH themes.
 *   - Dark is black and charcoal: no neutral carries more than a trace of
 *     hue, and none is green. The brief's words: "no green-tinted blacks".
 *   - the words are Light and Dark, never Day and Night.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProfileMenu } from './components/ProfileMenu'
import { THEME_KEY, currentTheme, ensureTheme, setTheme } from './theme'

const SRC = __dirname
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8')
const HTML = readFileSync(join(SRC, '..', 'index.html'), 'utf8')

// --- tokens, read from the stylesheet itself ----------------------------------

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} block`).toBeGreaterThan(-1)
  const body = CSS.slice(start + selector.length + 2, CSS.indexOf('\n}', start))
  const tokens: Record<string, string> = {}
  for (const decl of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const m = decl.match(/--([a-z0-9-]+)\s*:\s*([\s\S]+)/)
    if (m) tokens[m[1]] = m[2].trim().replace(/\s+/g, ' ')
  }
  return tokens
}

const LIGHT = block(':root')
const DARK = { ...LIGHT, ...block(":root[data-theme='dark']") }
const THEMES = { Light: LIGHT, Dark: DARK } as const

type Rgb = [number, number, number]

function rgb(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb
  const fn = value.match(/^rgb\((\d+)\s+(\d+)\s+(\d+)/)
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])]
  throw new Error(`not a colour: ${value}`)
}

function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: string | Rgb, b: string | Rgb): number {
  const toRgb = (v: string | Rgb) => (typeof v === 'string' ? rgb(v) : v)
  const [hi, lo] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** HSL saturation in percent, and the hue in degrees. */
function hsl([r, g, b]: Rgb): { s: number; h: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { s: 0, h: 0 }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return { s: s * 100, h: (h * 60 + 360) % 360 }
}

// --- switching ------------------------------------------------------------------

describe('switching the theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('style')
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('from the account menu makes no request at all, and never reloads', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open')
    const onSignOut = vi.fn()
    render(<ProfileMenu name="Regional Head" role="Regional head" onSignOut={onSignOut} />)

    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    // The menu learns of the change the way every other listener does: from
    // the attribute (a MutationObserver, before the next paint).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhr).not.toHaveBeenCalled()
    expect(onSignOut).not.toHaveBeenCalled()
  })

  it('persists the explicit choice, and survives storage being blocked', () => {
    setTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(currentTheme()).toBe('dark')

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => setTheme('light')).not.toThrow()
    expect(currentTheme()).toBe('light')
  })

  it('keeps Sign out in the menu, doing what it did', () => {
    const onSignOut = vi.fn()
    render(<ProfileMenu name="Regional Head" role="Regional head" onSignOut={onSignOut} />)
    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('opens from the keyboard, closes on Escape and gives focus back to the avatar', () => {
    render(<ProfileMenu name="Regional Head" role="Regional head" onSignOut={() => {}} />)
    const trigger = screen.getByRole('button', { name: /Account menu/ })
    trigger.focus()
    fireEvent.click(trigger) // Enter / Space on a <button> is a click
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    screen.getByRole('button', { name: 'Dark' }).focus()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('names the choice as a labelled group of two pressed/unpressed buttons', () => {
    render(<ProfileMenu name="Regional Head" role="Regional head" onSignOut={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Account menu/ }))
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(group.querySelectorAll('button[aria-pressed]')).toHaveLength(2)
    // The current one carries a cue that is not the shadow (lost on black):
    // a border-strong ring, 3:1 on every surface in both themes (below).
    expect(group.querySelector('button[aria-pressed="true"]')!.className).toContain('ring-outline')
    expect(group.querySelector('button[aria-pressed="false"]')!.className).not.toContain('ring-outline')
  })
})

// --- the pre-paint script -------------------------------------------------------

describe('index.html pre-paint script', () => {
  const script = HTML.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('style')
  })
  afterEach(() => vi.restoreAllMocks())

  it('runs in <head>, before any stylesheet or module', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    const at = head.indexOf('<script>')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(head.indexOf('rel="stylesheet"'))
    expect(at).toBeLessThan(HTML.indexOf('type="module"'))
    expect(script).toContain(`'${THEME_KEY}'`)
  })

  it('applies a stored Dark before the app exists', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    new Function(script)()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('defaults to Light: nothing stored, a value it does not know, or storage blocked', () => {
    new Function(script)()
    expect(document.documentElement.dataset.theme).toBe('light')

    localStorage.setItem(THEME_KEY, 'night')
    new Function(script)()
    expect(document.documentElement.dataset.theme).toBe('light')

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => new Function(script)()).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('round-trips with setTheme: what the menu stores is what the script reads', () => {
    setTheme('dark')
    document.documentElement.removeAttribute('data-theme')
    new Function(script)()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('has a fallback in the bundle for a load where the script did not run (a CSP without its hash)', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    ensureTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    // When the script did run, its answer stands.
    document.documentElement.dataset.theme = 'light'
    ensureTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(readFileSync(join(SRC, 'main.tsx'), 'utf8')).toMatch(/^ensureTheme\(\)/m)
  })
})

// --- the palette ----------------------------------------------------------------

describe('palette', () => {
  it('gives every token a Dark value of its own, so nothing Light leaks into Dark', () => {
    const dark = block(":root[data-theme='dark']")
    const missing = Object.keys(LIGHT).filter((name) => !(name in dark))
    expect(missing).toEqual([])
  })

  it('keeps Light exactly as the console was before themes existed', () => {
    // Spot values from the pre-theme @theme block; the screenshot diff in
    // .runtime/redesign/phase-a/manager covers the rest.
    expect(LIGHT).toMatchObject({
      bg: '#EEF3ED', surface: '#FDFDFB', 'surface-soft': '#E4EDE4', text: '#101820',
      'text-muted': '#4C5A51', 'text-faint': '#5E6D64', border: '#D3DED2', primary: '#14382E',
      shell: '#062621', 'shell-accent': '#34D399', route: '#2563EB', danger: '#A9271D',
    })
  })

  it('uses the brief values for Dark', () => {
    expect(DARK).toMatchObject({
      bg: '#070808', surface: '#0E1110', 'surface-raised': '#151918', 'surface-soft': '#1B201E',
      border: '#2A302D', text: '#F5F6F2', 'text-muted': '#AAB2AD', primary: '#39D8A0',
      'primary-hover': '#19B97F', danger: '#FF5D67', warning: '#E6AE4A', info: '#62A8FF',
    })
  })

  const SURFACES = ['bg', 'surface', 'surface-raised', 'surface-soft']

  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: text, muted and faint are AA (4.5:1) on every surface`, () => {
      const failures: string[] = []
      for (const fg of ['text', 'text-muted', 'text-faint']) {
        for (const bg of SURFACES) {
          const ratio = contrast(t[fg], t[bg])
          if (ratio < 4.5) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`)
        }
      }
      expect(failures).toEqual([])
    })

    it(`${name}: status and link colours are AA on the cards they sit on`, () => {
      // Light's route is pinned above (Phase A) and is 4.3:1 on the soft
      // surface, so route-coloured text never sits on bg-soft in Light; it is
      // held to the canvas and the cards. Light success was retuned in phase
      // B3 (4.2 -> 5.1:1 on soft): a status pill and an evidence tile put it there.
      const on = SURFACES
      const exempt = name === 'Light' ? new Set(['route on surface-soft']) : new Set<string>()
      const failures: string[] = []
      for (const fg of ['primary', 'accent', 'success', 'warning', 'danger', 'route', 'info']) {
        for (const bg of on) {
          const ratio = contrast(t[fg], t[bg])
          if (ratio < 4.5 && !exempt.has(`${fg} on ${bg}`)) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`)
        }
      }
      expect(failures).toEqual([])
    })

    it(`${name}: a control outline is visible (3:1) on every surface`, () => {
      for (const bg of SURFACES) {
        expect(contrast(t['border-strong'], t[bg]), `border-strong on ${bg}`).toBeGreaterThanOrEqual(3)
      }
    })

    it(`${name}: whatever sits on a fill reads on it`, () => {
      expect(contrast(t['on-primary'], t.primary)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['on-primary'], t['primary-hover'])).toBeGreaterThanOrEqual(4.5)
      // The SOS badge carries white on danger-strong in both themes.
      expect(contrast('#FFFFFF', t['danger-strong'])).toBeGreaterThanOrEqual(4.5)
      // A chosen state's name on its fill (the sign-in map).
      expect(contrast(t['on-region-selected'], t['region-selected'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['on-region-all'], t['region-all'])).toBeGreaterThanOrEqual(4.5)
      // A photo credit: white on its chip, over the brightest sky (white).
      const chip = 0.6 // --image-credit-bg alpha, over #FFFFFF
      expect(t['image-credit-bg']).toBe('rgb(0 0 0 / 0.6)')
      expect(contrast(t['on-image'], [255 * (1 - chip), 255 * (1 - chip), 255 * (1 - chip)])).toBeGreaterThanOrEqual(4.5)
      for (const fg of ['on-shell', 'on-shell-soft', 'on-shell-body', 'on-shell-muted', 'on-shell-hint', 'on-shell-faint', 'on-shell-dim', 'on-shell-accent', 'on-shell-gold', 'shell-accent']) {
        expect(contrast(t[fg], t.shell), `${fg} on shell`).toBeGreaterThanOrEqual(4.5)
      }
      for (const fg of ['on-shell', 'on-shell-muted', 'shell-accent']) {
        expect(contrast(t[fg], t['shell-surface']), `${fg} on shell-surface`).toBeGreaterThanOrEqual(4.5)
      }
      // The active nav item: its label on the filled pill, and the idle labels beside it.
      expect(contrast(t['on-shell'], t['shell-active']), 'on-shell on shell-active').toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['on-shell-soft'], t.shell), 'idle nav label on shell').toBeGreaterThanOrEqual(4.5)
    })
  }

  it('Dark neutrals are black and charcoal: at most 12% saturation, and none of them green', () => {
    const neutrals = [
      'bg', 'surface', 'surface-raised', 'surface-soft', 'border', 'border-strong',
      'shell', 'shell-surface', 'shell-raised', 'shell-border', 'shell-ring', 'shell-active', 'region-fill',
      // DK-1: a chosen state is a neutral fill in Dark; the accent is its outline.
      'region-selected', 'region-all',
      'image-disc', 'scene-pine',
    ].map((name) => [name, DARK[name]] as const)
    // Every colour stop of the rail and the login panel, the modal backdrop,
    // and the scrims over the photographs ("a neutral black overlay").
    for (const name of ['shell-gradient', 'shell-panel', 'overlay', 'image-scrim', 'image-scrim-side', 'image-credit-bg']) {
      for (const stop of DARK[name].match(/#[0-9A-F]{6}|rgb\([^)]*\)/gi) ?? []) neutrals.push([`${name} ${stop}`, stop])
    }
    const failures: string[] = []
    for (const [name, value] of neutrals) {
      const colour = rgb(value)
      const { s, h } = hsl(colour)
      const chroma = Math.max(...colour) - Math.min(...colour)
      if (s > 12) failures.push(`${name} ${value}: ${s.toFixed(1)}% saturation`)
      // Green-dominant: hue in the greens with enough chroma to see.
      if (h >= 75 && h <= 195 && chroma > 8) failures.push(`${name} ${value}: green (hue ${h.toFixed(0)}, chroma ${chroma})`)
    }
    expect(failures).toEqual([])
    expect(DARK['region-edge']).toBe(DARK.accent)
  })

  it('no roadside-service pin is green: green is the accent, never a category', () => {
    for (const [name, value] of Object.entries(LIGHT).filter(([k]) => k.startsWith('poi-'))) {
      const colour = rgb(value)
      const { h } = hsl(colour)
      expect(h >= 75 && h <= 195 && Math.max(...colour) - Math.min(...colour) > 8, `${name} ${value}`).toBe(false)
      // The glyph on the pin is white.
      expect(contrast('#FFFFFF', value), name).toBeGreaterThanOrEqual(4.5)
      expect(DARK[name]).toBe(value)
    }
  })

  it('fleet markers and map pins come from tokens: every freshness hue reads on its chip, and no green but the accent in Dark (REG-1)', () => {
    for (const [name, t] of Object.entries(THEMES)) {
      for (const hue of ['marker-live', 'marker-stale', 'marker-no-contact']) {
        expect(contrast(t[hue], t['marker-bg']), `${name} ${hue}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(t['on-pin-destination'], t['pin-destination']), `${name} destination`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t['on-pin-pickup'], t['pin-pickup']), `${name} pickup`).toBeGreaterThanOrEqual(4.5)
    }
    const green = Object.entries(DARK).filter(([k, v]) => /^(marker|pin|on-pin|poi|map)-/.test(k) && /^(#|rgb\()/.test(v) && v !== DARK.accent).filter(([, v]) => {
      const colour = rgb(v)
      const { h } = hsl(colour)
      return h >= 75 && h <= 195 && Math.max(...colour) - Math.min(...colour) > 8
    })
    expect(green).toEqual([])
    expect(DARK['marker-live']).toBe(DARK.accent)
    // Nothing on the map is painted from a literal of its own.
    for (const file of ['components/FleetMap.tsx', 'components/PlacesLayer.tsx']) {
      const code = readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(code.match(/#[0-9a-f]{3,8}\b|rgba?\(|:\s*white\b/gi), file).toBeNull()
    }
  })

  it('Dark basemap paint is the neutral one from the probe, and Light is the identity', () => {
    const raster = (t: Record<string, string>) =>
      ['brightness-min', 'brightness-max', 'hue-rotate', 'saturation', 'contrast'].map((k) => Number(t[`map-raster-${k}`]))
    expect(raster(LIGHT)).toEqual([0, 1, 0, 0, 0])
    // The probe's paint with brightness-min at 0.8 rather than 1 (next test).
    expect(raster(DARK)).toEqual([0.8, 0.08, 180, -0.9, 0.1])
    expect(Number(LIGHT['map-route-opacity'])).toBe(0.7)
  })

  it('Dark: the planned route is at least 3:1 on every large area of the basemap', () => {
    // MapLibre's raster fragment shader (maplibre-gl 6.6), run on the OSM-carto
    // area fills a North-East map is made of. Inverted, forest is the lightest
    // of them. At the probe's paint the model gives #535752 for forest, the
    // grey measured in the earlier Dark Fleet capture; the route capture in
    // .runtime/redesign/phase-a/manager/route measures the new paint on screen.
    // Light is not asserted: its 0.7 route predates the theme and stays.
    const n = (k: string) => Number(DARK[`map-raster-${k}`])
    const angle = (n('hue-rotate') * Math.PI) / 180
    const [s, c] = [Math.sin(angle), Math.cos(angle)]
    const w = [(2 * c + 1) / 3, (-Math.sqrt(3) * s - c + 1) / 3, (Math.sqrt(3) * s - c + 1) / 3]
    const sat = n('saturation') > 0 ? 1 - 1 / (1.001 - n('saturation')) : -n('saturation')
    const con = n('contrast') > 0 ? 1 / (1 - n('contrast')) : 1 + n('contrast')
    const paint = (hex: string): Rgb => {
      const [r, g, b] = rgb(hex).map((v) => v / 255)
      const spun = [r * w[0] + g * w[1] + b * w[2], r * w[2] + g * w[0] + b * w[1], r * w[1] + g * w[2] + b * w[0]]
      const avg = (r + g + b) / 3
      return spun.map((v) => {
        const out = n('brightness-min') + (n('brightness-max') - n('brightness-min')) * ((v + (avg - v) * sat - 0.5) * con + 0.5)
        return Math.round(Math.min(1, Math.max(0, out)) * 255)
      }) as Rgb
    }
    const OSM_AREAS = {
      forest: '#ADD19E', water: '#AAD3DF', grass: '#CDEBB0', heath: '#D6D99F',
      farmland: '#EEF0D5', residential: '#E0DFDF', land: '#F2EFE9',
    }
    const route = rgb(DARK.route)
    const alpha = Number(DARK['map-route-opacity'])
    const failures: string[] = []
    for (const [area, fill] of Object.entries(OSM_AREAS)) {
      const ground = paint(fill)
      const line = route.map((v, i) => alpha * v + (1 - alpha) * ground[i]) as Rgb
      const ratio = contrast(line, ground)
      if (ratio < 3) failures.push(`${area} ${ground}: ${ratio.toFixed(2)}`)
    }
    expect(failures).toEqual([])
  })

  it('Dark: accent-soft and success-soft tint a status or an active mark, never a neutral surface', () => {
    // 37% and 33% saturated green in Dark: right behind a pill, a status line or
    // an active card, wrong as a panel. So every use - and every translucent
    // primary/ok fill, which lands in the same place - names its status colour
    // (text-primary / text-ok) or an active border beside it.
    const offenders: string[] = []
    let uses = 0
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/\bbg-(primary|ok)(-soft\b|\/\d)/.test(line)) return
        uses++
        if (!/\b(text|border)-(primary|ok)\b/.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}`)
      })
    }
    // Stylesheet rules: the one that paints the tint also sets the status
    // colour. The color-mix fallbacks stand in for a utility checked above.
    for (const [, selector, body] of CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/^\s*(:root|@theme|\.bg-)/.test(selector) || !/var\(--(accent|success)-soft\)/.test(body)) continue
      uses++
      if (!/(^|[;\s])color:\s*var\(--(primary|success|accent)\)/.test(body)) offenders.push(`index.css ${selector.trim()}`)
    }
    // Phase B3 folded the pill tones into one table in ui.tsx (TONE_CLASS),
    // so there are fewer lines to find; the guard only proves the scan runs.
    expect(uses, 'the check found the uses it guards').toBeGreaterThanOrEqual(8)
    expect(offenders).toEqual([])
  })

  it('gives every tinted bg-x/NN a readable fallback where color-mix is missing', () => {
    const used = new Set<string>()
    for (const file of sourceFiles(SRC)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bbg-((?:primary|accent|route|ok|warning|danger|info|aqua|navy)(?:-strong|-hover)?)\/(\d+)\b/g)) {
        used.add(`.bg-${m[1]}\\/${m[2]} {`)
      }
    }
    const start = CSS.indexOf('@supports not (color: color-mix(')
    const fallback = CSS.slice(start, CSS.indexOf('\n}', start))
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter((rule) => !fallback.includes(rule))).toEqual([])
  })
})

// --- wording ----------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('theme wording', () => {
  it('never offers Day or Night as a theme, and never "switch to day/night"', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles(SRC), join(SRC, '..', 'index.html')]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (
          /\b(day|night)[\s-]*(mode|theme)\b/i.test(line) ||
          /\bswitch to (day|night)\b/i.test(line) ||
          /(['"`>])\s*(Day|Night)\s*(['"`<])/.test(line)
        ) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`)
        }
      })
    }
    expect(offenders, 'the theme words are Light and Dark').toEqual([])
  })

  it('does show Light and Dark, so the check is not vacuous', () => {
    const menu = readFileSync(join(SRC, 'components', 'ProfileMenu.tsx'), 'utf8')
    expect(menu).toContain("label: 'Light'")
    expect(menu).toContain("label: 'Dark'")
    expect(readFileSync(join(SRC, 'theme.ts'), 'utf8')).toContain("export type Theme = 'light' | 'dark'")
  })
})
