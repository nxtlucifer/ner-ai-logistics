/** Theme provider + the style factory every screen uses.
 *
 * `makeStyles` takes a builder whose parameter is named COLORS at each call
 * site, so a screen's stylesheet reads `COLORS.surface`, `COLORS.textMuted`
 * and so on, and is rebuilt once per palette - never per render.
 *
 * PERSISTENCE. The driver's explicit Light/Dark choice is stored under
 * `rasta:theme` as 'light' or 'dark' - the key the redesign audit (s9)
 * assigns to both apps. With nothing stored, the first-use rule is
 * unchanged: Expo web follows the system, native starts Light because
 * app.json pins userInterfaceStyle.
 *
 * NO FLASH. Nothing renders until the stored choice has been read. Rendering
 * the system theme first and correcting it a moment later is exactly the
 * flash this avoids; the read is a single local lookup, so the hold is one
 * frame at most, and it happens under whatever was already on screen.
 *
 * What is on screen before that: on web, public/index.html paints the same
 * choice's ground before the bundle loads. On native, the launch window is
 * the splash on a white background (the app ships no expo-splash-screen and
 * app.json pins Light), so a stored Dark opens white, then Dark. There is
 * never a Light APP frame. Accepted for Phase A: a dark splash would change
 * every Light launch too, and the native project is generated at build time.
 *
 * Switching is local state + one local write. It makes no network request
 * and remounts nothing: stylesheets are rebuilt from the other palette and
 * every consumer re-renders in place.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { PALETTES, type Palette, type ThemeMode } from './theme'

export type { ThemeMode }

export const THEME_STORAGE_KEY = 'rasta:theme'

const ThemeContext = createContext<{
  mode: ThemeMode
  colors: Palette
  toggle: () => void
}>({ mode: 'dark', colors: PALETTES.dark, toggle: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [mode, setMode] = useState<ThemeMode>(system === 'light' ? 'light' : 'dark')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (alive && (stored === 'light' || stored === 'dark')) setMode(stored)
      })
      // Unreadable storage is not an error a driver can act on: first-use rule.
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const value = useMemo(
    () => ({
      mode,
      colors: PALETTES[mode],
      toggle: () => {
        const next: ThemeMode = mode === 'light' ? 'dark' : 'light'
        setMode(next)
        AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {})
      },
    }),
    [mode],
  )
  if (!ready) return null
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Defaults to Dark with no provider, so tests that render a screen bare
 *  keep working rather than throwing. */
export const useTheme = () => useContext(ThemeContext)

export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  build: (colors: Palette) => T,
) {
  const cache = new Map<Palette, T>()
  return function useStyles(): T {
    const { colors } = useTheme()
    let sheet = cache.get(colors)
    if (!sheet) {
      sheet = StyleSheet.create(build(colors))
      cache.set(colors, sheet)
    }
    return sheet
  }
}
