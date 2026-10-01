/**
 * Every readable colour, measured against every ground it can land on - and
 * Dark held to "black, not green".
 *
 * WHY THIS IS A TEST AND NOT A COMMENT
 *
 * The palettes were retuned several times, and each time a value was chosen
 * by eye against ONE background. That is how `dim` once ended up at 3.7:1 on
 * a raised chip while reading fine on the canvas, and how the old night
 * palette ended up as a forest-green room (hue 168, saturation 68%) that its
 * own comment called "not charcoal". A comment claiming a ratio or a
 * neutrality cannot fail when someone nudges a hex; this can.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DARK, LIGHT, type Palette } from './theme'
import { MAP_COLOURS, leafletDarkCss } from './map/scene'

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** `hex` at `alpha` over the opaque `ground`, as the screen composites it. */
function over(hex: string, alpha: number, ground: string): string {
  const [a, b] = [rgb(hex), rgb(ground)]
  return '#' + a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')
}

/** HSL saturation and lightness, 0-100. */
function hsl(hex: string): { s: number; l: number } {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
  return { s: s * 100, l: l * 100 }
}

/** Green is the dominant channel by more than a rounding step. This is what
 *  makes a dark surface read as "forest" rather than "black". */
function greenTinted(hex: string): boolean {
  const [r, g, b] = rgb(hex)
  return g - Math.max(r, b) > 4 && g - Math.min(r, b) > 10
}

/** Tokens a screen renders as TEXT or as an icon carrying meaning. */
const READABLE = [
  'text',
  'textMuted',
  'textFaint',
  'textDim',
  'brand',
  'info',
  'success',
  'warning',
  'danger',
  'accent',
] as const

/** Surfaces any of the above can be placed on. */
const GROUNDS = ['bg', 'surface', 'surfaceRaised', 'surfaceSunken', 'surfaceSoft'] as const

describe.each([
  ['Light', LIGHT],
  ['Dark', DARK],
])('%s palette', (_name, palette: Palette) => {
  it.each(READABLE)('%s clears AA on every surface', (token) => {
    for (const ground of GROUNDS) {
      const ratio = contrast(palette[token], palette[ground])
      expect(ratio, `${token} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the label on a primary button is readable, pressed or not', () => {
    // The one pair where inverting is the whole point: mint needs a dark
    // label, dark forest needs a white one, and getting it backwards
    // produces a button whose text is invisible rather than merely dull.
    expect(contrast(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.onPrimary, palette.primaryHover)).toBeGreaterThanOrEqual(4.5)
  })

  it('status backgrounds carry their own status colour', () => {
    // A warning chip is `warning` text on `warningSoft`. Checked separately
    // because those grounds are not in GROUNDS - nothing else sits on them.
    for (const [ink, ground] of [
      ['success', 'successSoft'],
      ['warning', 'warningSoft'],
      ['danger', 'dangerSoft'],
      ['info', 'infoSoft'],
    ] as const) {
      const ratio = contrast(palette[ink], palette[ground])
      expect(ratio, `${ink} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('white is readable on the fills that carry it', () => {
    // dangerStrong: SOS and the emergency call chip. route: the maneuver card.
    expect(contrast(palette.onFill, palette.dangerStrong)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.onFill, palette.route)).toBeGreaterThanOrEqual(4.5)
  })

  it('the quiet text steps keep one order: textMuted, then textDim, then textFaint', () => {
    // Same key, same emphasis in both themes. Dark once had textDim quieter
    // than textFaint while Light had it louder.
    const on = (token: keyof Palette) => contrast(palette[token], palette.bg)
    expect(on('textMuted')).toBeGreaterThan(on('textDim'))
    expect(on('textDim')).toBeGreaterThan(on('textFaint'))
  })

  it('text over the login ridges clears AA, except one recorded eyebrow', () => {
    // A composite ground the flat checks above never see: the hero draws
    // borderStrong ridges at 45% over bg (LoginScreen `hero`, opacity .45),
    // under the language control, the brand block, 'DRIVER' and the heading.
    const ridge = over(palette.borderStrong, 0.45, palette.bg)
    for (const token of ['text', 'textMuted', 'brand'] as const) {
      const ratio = contrast(palette[token], ridge)
      expect(ratio, `${token} on the ridge is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
    // KNOWN ISSUE, not fixed in Phase A: the 'DRIVER' eyebrow is textFaint,
    // 3.99:1 in Light (as shipped before the redesign) and 3.82:1 in Dark by
    // this composite (3.87:1 measured on screen). Fixing it moves a Light
    // pixel or compresses Dark's text steps; the Phase B photo hero replaces
    // the ridges. Held here so it cannot get worse.
    expect(contrast(palette.textFaint, ridge)).toBeGreaterThanOrEqual(3.8)
  })
})

describe('the two palettes stay interchangeable', () => {
  it('have exactly the same keys', () => {
    // The contract that lets a stylesheet be rebuilt for either palette
    // without touching a call site. A key present in one and not the other
    // renders as `undefined` - which React Native silently ignores.
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort())
  })

  it('are actually different', () => {
    expect(LIGHT.bg).not.toBe(DARK.bg)
  })
})

/** Keys added by the Phase B1 redesign (photos, the frosted card, the
 *  floating tab bar). They had no pre-rename value to keep. */
const PHASE_B1_KEYS: (keyof Palette)[] = [
  'imageScrim', 'imageDim', 'imageTopVeil', 'imageCaption', 'onPhoto', 'onPhotoAccent', 'glass', 'glassWell', 'glassBorder',
  'overlay', 'discNeutral', 'shell', 'shellBorder', 'shellActive', 'onShell', 'onShellMuted', 'shellAccent',
  // Second B1 iteration: the disabled CTA, the hero veil and ink, the action disc.
  'primaryDisabled', 'heroVeil', 'onHero', 'discAction',
  // Phase B2: the ink on the route and emergency fills, once a raw '#FFFFFF'.
  'onFill',
  // REG-6: the splash card's shadow, once a raw '#000' in App.tsx.
  'shadow',
]

describe('the rename moved no Light colour', () => {
  // The Light palette as it shipped before the Phase A rename, under its OLD
  // keys, and the published key map. Every old value must arrive unchanged
  // under its new name - that is what "Light screenshots unchanged" means at
  // the token level.
  const DAY_BEFORE: Record<string, string> = {
    bg: '#EEF3ED', sunken: '#E4EDE4', card: '#FDFDFB', raised: '#F2F7F2', border: '#D3DED2',
    borderStrong: '#B6C7B8', soft: '#E4EDE4', disabled: '#DCE6DB', text: '#101820', muted: '#4C5A51',
    faint: '#5E6D64', dim: '#5A685F', accent: '#14382E', accentPressed: '#0C2A21', onAccent: '#FFFFFF',
    aqua: '#0F5C46', route: '#2563EB', routeOn: '#1D4ED8', routeBg: '#EAF0FE', ok: '#076C4D',
    okBg: '#DFEFE4', okBorder: '#8FD3B8', warn: '#8A4B09', warnBg: '#F7EBD8', warnBorder: '#E4B778',
    bad: '#A9271D', badBg: '#F9DDDC', badBorder: '#EBA9A2', badStrong: '#DC2626',
  }
  const KEY_MAP: Record<string, (keyof Palette)[]> = {
    bg: ['bg'], card: ['surface'], raised: ['surfaceRaised'], soft: ['surfaceSoft'], sunken: ['surfaceSunken'],
    border: ['border'], borderStrong: ['borderStrong'], disabled: ['disabled'], text: ['text'],
    muted: ['textMuted'], faint: ['textFaint'], dim: ['textDim'], aqua: ['brand'],
    accent: ['primary', 'accent'], accentPressed: ['primaryHover'], onAccent: ['onPrimary'],
    route: ['route'], routeOn: ['info'], routeBg: ['infoSoft'],
    ok: ['success'], okBg: ['successSoft'], okBorder: ['successBorder'],
    warn: ['warning'], warnBg: ['warningSoft'], warnBorder: ['warningBorder'],
    bad: ['danger'], badBg: ['dangerSoft'], badBorder: ['dangerBorder'], badStrong: ['dangerStrong'],
  }

  it('maps every old key, and every new key comes from one', () => {
    expect(Object.keys(KEY_MAP).sort()).toEqual(Object.keys(DAY_BEFORE).sort())
    const renamed = Object.keys(LIGHT).filter((key) => !PHASE_B1_KEYS.includes(key as keyof Palette))
    expect(Object.values(KEY_MAP).flat().sort()).toEqual(renamed.sort())
  })

  it.each(Object.entries(KEY_MAP))('%s keeps its Light value', (old, next) => {
    for (const key of next) expect(LIGHT[key], `${old} -> ${key}`).toBe(DAY_BEFORE[old])
  })
})

describe('Dark is black, not green', () => {
  /** Every large neutral surface, the disabled fill, and the lines between them. */
  const NEUTRAL = [
    'bg', 'surface', 'surfaceRaised', 'surfaceSoft', 'surfaceSunken',
    'border', 'borderStrong', 'disabled',
    // The floating tab bar is forest in Light and must be charcoal here.
    'shell', 'shellBorder', 'shellActive', 'discNeutral', 'discAction',
  ] as const
  /** The only keys allowed to be green: action, active state, success, brand
   *  (the active tab's label and the login's decorative accent included). */
  const GREEN_BY_MEANING = new Set([
    'primary', 'primaryHover', 'accent', 'success', 'successBorder', 'brand', 'shellAccent', 'onPhotoAccent',
    // The Sign In fill while it cannot be used: a grey-mint, still the CTA.
    'primaryDisabled',
  ])

  // successSoft is not a neutral by meaning, but it paints large surfaces
  // (row discs, the GPS chip, the 'I Am Safe' button), so it is held to the
  // same saturation bar.
  it.each([...NEUTRAL, 'successSoft'] as const)('%s is a neutral (HSL saturation <= 12%%)', (key) => {
    const { s } = hsl(DARK[key])
    expect(s, `${key} ${DARK[key]} saturation ${s.toFixed(1)}%`).toBeLessThanOrEqual(12)
    expect(greenTinted(DARK[key]), `${key} ${DARK[key]} is green-tinted`).toBe(false)
  })

  it('the grounds are black or near-black', () => {
    for (const key of ['bg', 'surface', 'surfaceRaised', 'surfaceSoft', 'surfaceSunken'] as const) {
      expect(hsl(DARK[key]).l, `${key} ${DARK[key]}`).toBeLessThanOrEqual(12)
    }
  })

  it('soft status grounds are not green slabs', () => {
    // successSoft is the trap: a "success" banner is a large surface, and
    // #0B3329 (the old night value) is a dark-green panel, not a black one.
    for (const key of ['successSoft', 'warningSoft', 'dangerSoft', 'infoSoft'] as const) {
      expect(greenTinted(DARK[key]), `${key} ${DARK[key]} is green-tinted`).toBe(false)
    }
  })

  it('green appears only in the keys whose meaning is green', () => {
    const green = Object.entries(DARK).filter(([, hex]) => greenTinted(hex)).map(([key]) => key)
    expect(green.filter((key) => !GREEN_BY_MEANING.has(key))).toEqual([])
  })

  /** A style block's backgroundColor token, e.g. `tabs: { ... backgroundColor: COLORS.surface ... }`. */
  function backgroundToken(source: string, block: string): string {
    const match = new RegExp(`\\b${block}:\\s*\\{([^{}]*)\\}`).exec(source)
    const token = match && /backgroundColor:\s*COLORS\.(\w+)/.exec(match[1])
    if (!token) throw new Error(`no backgroundColor for ${block}`)
    return token[1]
  }

  it.each([
    // No shell header since Phase B3 (every screen has a hero); the Trip
    // hero's avatar disc is the shell's one remaining surface.
    ['App.tsx', ['root', 'flex', 'avatar']],
    [join('src', 'components', 'scenic.tsx'), ['bar', 'tabActive', 'row', 'sheet']],
    [join('src', 'manager', 'ManagerRoot.tsx'), ['root', 'tabs', 'chips', 'evidence']],
  ])('the %s shell and tab bar paint only neutrals', (file, blocks) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8')
    for (const block of blocks) {
      const token = backgroundToken(source, block)
      expect(NEUTRAL as readonly string[], `${file} ${block} uses COLORS.${token}`).toContain(token)
    }
  })

  it('terrain strokes stand off the edge under them in both themes', () => {
    // Light: the white route casing. Dark: terrainCasing, because the black
    // route casing left the steep red at 3.05:1.
    for (const mode of ['light', 'dark'] as const) {
      const edge = MAP_COLOURS[mode].terrainCasing
      for (const hue of [MAP_COLOURS[mode].steep, MAP_COLOURS[mode].hilly]) {
        expect(contrast(hue, edge), `${mode} ${hue} on ${edge}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('the map chrome has no green neutral in Dark', () => {
    const { route: _route, traffic: _traffic, category: _category, gpsLive: _gpsLive, ...chrome } = MAP_COLOURS.dark
    for (const [key, hex] of Object.entries(chrome)) {
      expect(greenTinted(hex), `map ${key} ${hex}`).toBe(false)
    }
  })

  it('the map draws no green data hue in Dark: a green meaning there is the accent (REG-5)', () => {
    const { traffic, category, ...flat } = MAP_COLOURS.dark
    const hues = { ...flat, ...Object.fromEntries(Object.entries(traffic).map(([k, v]) => ['traffic ' + k, v])), ...Object.fromEntries(Object.entries(category).map(([k, v]) => ['pin ' + k, v])) }
    const green = Object.entries(hues).filter(([, hex]) => greenTinted(hex) && hex !== DARK.success)
    expect(green).toEqual([])
    // The two green meanings, the live fix and flowing traffic, are the accent.
    expect([MAP_COLOURS.dark.gpsLive, traffic.NORMAL]).toEqual([DARK.success, DARK.success])
  })

  it('Leaflet chrome CSS in Dark is neutral, and only the tiles are filtered', () => {
    const css = leafletDarkCss('.scope')
    const hexes = css.match(/#[0-9A-Fa-f]{6}/g) ?? []
    expect(hexes.length).toBeGreaterThan(0)
    for (const hex of hexes) expect(greenTinted(hex), `leaflet css ${hex}`).toBe(false)
    const filtered = css.split(' .scope').join('\n.scope').split('\n').filter((rule) => rule.includes('filter:'))
    expect(filtered).toHaveLength(1)
    expect(filtered[0]).toMatch(/^\.scope \.leaflet-tile-pane\{filter:invert\(1\)/)
  })
})

/** `rgba(r,g,b,a)` -> channels and alpha. */
function rgba(value: string): { hex: string; alpha: number } {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value.replace(/\s/g, ''))
  if (!m) throw new Error(`not rgba: ${value}`)
  const hex = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')
  return { hex, alpha: Number(m[4]) }
}
const layer = (token: string, ground: string) => {
  const { hex, alpha } = rgba(token)
  return over(hex, alpha, ground)
}

describe('photos, the frosted card and the floating bar (Phase B1)', () => {
  it.each([
    ['Light', LIGHT],
    ['Dark', DARK],
  ])('%s: the tab bar reads, resting and active', (_name, p: Palette) => {
    for (const [ink, ground] of [
      ['onShell', 'shell'], ['onShellMuted', 'shell'], ['shellAccent', 'shellActive'], ['onShell', 'shellActive'],
    ] as const) {
      const ratio = contrast(p[ink], p[ground])
      expect(ratio, `${ink} on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['Light', LIGHT],
    ['Dark', DARK],
  ])('%s: card text holds AA over the darkest and the lightest photo', (_name, p: Palette) => {
    // The card is translucent, so its ground depends on the photo under it.
    // Checked against pure black and pure white under the veil the theme
    // draws: every real pixel lies between the two.
    for (const photo of ['#000000', '#FFFFFF']) {
      const card = layer(p.glass, layer(p.imageDim, photo))
      const well = layer(p.glassWell, card)
      for (const [ink, ground] of [
        ['text', card], ['textMuted', card], ['text', well], ['textMuted', well],
      ] as const) {
        const ratio = contrast(p[ink], ground)
        expect(ratio, `${ink} on ${ground} over ${photo} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each([
    ['Light', LIGHT],
    ['Dark', DARK],
  ])('%s: light text on a scrimmed photo and on a credit plate clears AA over a white sky', (_name, p: Palette) => {
    const white = '#FFFFFF'
    const scrimmed = layer(p.imageScrim, layer(p.imageDim, white))
    expect(contrast(p.onPhoto, scrimmed)).toBeGreaterThanOrEqual(4.5)
    // onPhotoAccent colours icons only: the non-text bar (WCAG 1.4.11) is 3:1.
    expect(contrast(p.onPhotoAccent, scrimmed)).toBeGreaterThanOrEqual(3)
    expect(contrast(p.onPhoto, layer(p.imageCaption, white))).toBeGreaterThanOrEqual(4.5)
  })

  it('Dark: the login wordmark on a white sky under the veil', () => {
    // Light draws the wordmark in dark ink on the bright sky, as driver_01
    // does; Dark veils the photo, so its light ink must clear the veiled sky.
    const sky = layer(DARK.imageTopVeil, layer(DARK.imageDim, '#FFFFFF'))
    expect(contrast(DARK.text, sky)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(DARK.brand, sky)).toBeGreaterThanOrEqual(4.5)
  })

  it('Dark photo layers are neutral black, never a green veil', () => {
    for (const key of ['imageScrim', 'imageDim', 'imageTopVeil', 'imageCaption', 'overlay', 'heroVeil'] as const) {
      const { hex } = rgba(DARK[key])
      expect(hex, `${key} ${DARK[key]}`).toBe('#000000')
    }
  })

  it('row discs keep their ink readable in every tone', () => {
    for (const p of [LIGHT, DARK]) {
      expect(contrast(p.text, p.discNeutral)).toBeGreaterThanOrEqual(4.5)
      // The action disc's icon: the non-text bar.
      expect(contrast(p.success, p.discAction)).toBeGreaterThanOrEqual(3)
    }
  })

  it.each([
    ['Light', LIGHT],
    ['Dark', DARK],
  ])('%s: the one toned disc is at least as visible on its card as a neutral one', (_name, p: Palette) => {
    // Dark successSoft sat at 1.06:1 on the card, fainter than the neutral
    // discs, so the row meant to stand out read as having no disc.
    expect(contrast(p.discAction, p.surface)).toBeGreaterThanOrEqual(contrast(p.discNeutral, p.surface) - 0.02)
  })

  it.each([
    ['Light', LIGHT],
    ['Dark', DARK],
  ])('%s: the active tab is marked by a shape at 3:1, not by hue alone', (_name, p: Palette) => {
    // The pill itself is under 3:1 against the bar (Light 2.4, Dark 1.2), so
    // FloatingTabBar draws a shellAccent bar in it (WCAG 1.4.1 / 1.4.11).
    expect(contrast(p.shellAccent, p.shellActive)).toBeGreaterThanOrEqual(3)
    expect(contrast(p.shellAccent, p.shell)).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['Light', LIGHT],
    ['Dark', DARK],
  ])('%s: the hero title and subtitle hold AA on the veil over any photo', (_name, p: Palette) => {
    // ScreenHero keeps the whole title block under the full-strength veil
    // (px stops, see the comment there), so the dense end is the ground.
    for (const photo of ['#000000', '#FFFFFF']) {
      const ground = layer(p.heroVeil, layer(p.imageDim, photo))
      const ratio = contrast(p.onHero, ground)
      expect(ratio, `onHero on the veil over ${photo} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
