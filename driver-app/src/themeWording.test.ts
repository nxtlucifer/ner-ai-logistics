/**
 * `all problems.txt` item 4: the driver reads **Light / Dark**, never
 * Day / Night.
 *
 * THE MISS THIS CATCHES
 *
 * `MoreScreen` was changed and shipped, and the item was marked done. The
 * header toggle in `App.tsx` — the control a driver actually taps, because
 * it is on every screen — still said "Day" / "Night", with an accessibility
 * label to match. A grep of the screens directory would not have found it;
 * the phone did, on the first launch of the physical matrix.
 *
 * The internal mode is `'light' | 'dark'` too (Phase A, 27 Sep 2026): it
 * is also the value persisted under `rasta:theme`, so the stored word and the
 * shown word are the same word.
 * What the first check guards is the WORDING that reaches a screen.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const APP_ROOT = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'android' || name === 'ios') return []
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

/** A string literal that reaches the screen: inside t()/tr()/tx() or JSX. */
const USER_FACING = [
  /\b(?:t|tr|tx)\(\s*'([^']+)'/g,
  /accessibilityLabel=\{?\s*'([^']+)'/g,
  /accessibilityLabel=\{[^}]*?'([^']+)'/g,
  /label=\{?\s*'([^']+)'/g,
]

describe('theme wording', () => {
  it('never shows the driver Day or Night as a theme name', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(APP_ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of USER_FACING) {
        for (const match of text.matchAll(new RegExp(pattern))) {
          const phrase = match[1]
          // "Good night" and a literal time of day are fine; a THEME name is not.
          if (/\b(day|night)\b/i.test(phrase) && /theme|mode/i.test(phrase)) {
            offenders.push(`${file.slice(APP_ROOT.length + 1)}: "${phrase}"`)
          }
          if (/^(Day|Night)$/.test(phrase)) {
            offenders.push(`${file.slice(APP_ROOT.length + 1)}: "${phrase}"`)
          }
        }
      }
    }
    expect(offenders, 'use Light / Dark — all problems.txt item 4').toEqual([])
  })

  it('does show Light and Dark, so the check is not vacuous', () => {
    // The quick switch left the shell header for the heroes (Phase B3): it is
    // scenic.tsx's ThemeChip now, on Trip, Navigate and Safety.
    const chip = readFileSync(join(APP_ROOT, 'src', 'components', 'scenic.tsx'), 'utf8')
    expect(chip).toContain("'Light'")
    expect(chip).toContain("'Dark'")
    const more = readFileSync(join(APP_ROOT, 'src', 'screens', 'MoreScreen.tsx'), 'utf8')
    expect(more).toMatch(/'Light'|Light —|Light —/)
  })

  it('names the modes light and dark inside the code as well', () => {
    const ctx = readFileSync(join(APP_ROOT, 'src', 'theme.ts'), 'utf8')
    expect(ctx).toContain("export type ThemeMode = 'light' | 'dark'")
    for (const file of sourceFiles(APP_ROOT)) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/mode\s*===\s*'(day|night)'|ThemeMode\s*=\s*'day'/)
    }
  })

  it('does not pin the login to one theme', () => {
    // The login used to be wrapped in <ThemeProvider fixed="day">, so a driver
    // who chose Dark got a Light page every time they signed out.
    const app = readFileSync(join(APP_ROOT, 'App.tsx'), 'utf8')
    expect(app).not.toMatch(/fixed=/)
    expect(app.match(/<ThemeProvider\b/g) ?? []).toHaveLength(1)
  })
})
