/**
 * Light / Dark.
 *
 * The theme is one attribute, `data-theme` on <html>, and the stylesheet does
 * everything else (index.css). index.html sets the attribute from the stored
 * choice before the first paint, so nothing flashes; switching sets it again,
 * so nothing is fetched and nothing reloads.
 *
 * Light until somebody chooses: the console never followed the OS, and the
 * explicit choice is what persists.
 */

import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

/** Also read by the pre-paint script in index.html - keep the two in step. */
export const THEME_KEY = 'rasta:theme'

const root = () => document.documentElement

export const currentTheme = (): Theme => (root().dataset.theme === 'dark' ? 'dark' : 'light')

/** The stored choice; Light when there is none, it is unknown, or storage is blocked. The head script's rule. */
function storedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/**
 * What the head script in index.html does, for a load where it did not run -
 * a future `script-src` CSP without its hash. Later than the first paint, but
 * a stored Dark still applies instead of silently not.
 */
export function ensureTheme(): void {
  if (root().dataset.theme) return
  const theme = storedTheme()
  root().dataset.theme = theme
  root().style.colorScheme = theme
}

/** Apply and remember an explicit choice. */
export function setTheme(theme: Theme): void {
  root().dataset.theme = theme
  root().style.colorScheme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Storage blocked (private mode, policy): the choice holds for this page.
  }
}

/** Calls back whenever the theme changes, whoever changed it. */
export function onThemeChange(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(root(), { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

export const useTheme = (): Theme => useSyncExternalStore(onThemeChange, currentTheme)

/** A token's current value, for the consumer that cannot read a CSS variable: map paint. */
export const cssToken = (name: string): string =>
  getComputedStyle(root()).getPropertyValue(`--${name}`).trim()
