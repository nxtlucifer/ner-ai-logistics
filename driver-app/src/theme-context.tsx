/** Theme provider + the style factory every screen uses.
 *
 * `makeStyles` takes a builder whose parameter is named COLORS at each call
 * site, so a screen converts by changing two lines - the 500-odd `COLORS.x`
 * references inside its stylesheet keep working untouched.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, useColorScheme } from 'react-native'

import { DAY, NIGHT, type Palette } from './theme'

export type ThemeMode = 'day' | 'night'

const ThemeContext = createContext<{
  mode: ThemeMode
  colors: Palette
  toggle: () => void
}>({ mode: 'night', colors: NIGHT, toggle: () => {} })

export function ThemeProvider({ children, fixed }: { children: ReactNode; fixed?: ThemeMode }) {
  const system = useColorScheme()
  // System appearance is the INITIAL preference only; the manual toggle wins
  // afterwards. Persistence is deliberately not added here - it would mean a
  // storage dependency in the render path for a one-tap preference.
  const [chosen, setMode] = useState<ThemeMode>(system === 'light' ? 'day' : 'night')
  // `fixed` pins a subtree: the login page is always DAY, whatever the phone
  // or the previous session chose, so the brand reads the same on every device.
  const mode = fixed ?? chosen
  const value = useMemo(
    () => ({
      mode,
      colors: mode === 'day' ? DAY : NIGHT,
      toggle: () => setMode((m) => (m === 'day' ? 'night' : 'day')),
    }),
    [mode],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Defaults to night with no provider, so tests that render a screen bare
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
