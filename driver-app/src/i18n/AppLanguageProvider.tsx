/**
 * AppLanguageProvider - React context for Driver App UI Language.
 *
 * Provides:
 * - Current UI Language ('en' | 'hi' | 'gu' | 'as' | 'bn')
 * - setLanguage (persisting to AsyncStorage @ner_driver_app_language)
 * - t(key) translation function
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  isAppLanguage,
  isRtl,
  STORAGE_KEY,
  t as translateKey,
  type AppLanguage,
  type TranslationKey,
} from './appLanguage'
import { matchLanguage, setResolvedLanguage } from './language'

const RECENT_KEY = `${STORAGE_KEY}:recent`
const RECENT_MAX = 3

export interface AppLanguageContextValue {
  language: AppLanguage
  setLanguage: (next: AppLanguage) => Promise<void>
  t: (key: TranslationKey) => string
  /** Last picks, newest first, for the chooser's "Recently used". */
  recent: AppLanguage[]
  /** Right-to-left script (Urdu, Sindhi, Kashmiri). Text only; the map is never mirrored. */
  rtl: boolean
}

const AppLanguageContext = createContext<AppLanguageContextValue>({
  language: 'en',
  setLanguage: async () => {},
  t: (key: TranslationKey) => translateKey('en', key),
  recent: [],
  rtl: false,
})

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en')
  const [recent, setRecent] = useState<AppLanguage[]>([])

  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => {
        if (!alive || !raw) return
        const list = (JSON.parse(raw) as string[]).filter(isAppLanguage)
        setRecent(list.slice(0, RECENT_MAX))
      })
      .catch(() => {})
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!alive) return
        if (stored && isAppLanguage(stored)) {
          setLanguageState(stored)
        } else {
          // Detect device language
          try {
            const detected = matchLanguage(Intl.DateTimeFormat().resolvedOptions().locale)
            if (isAppLanguage(detected)) {
              setLanguageState(detected)
            }
          } catch {
            // fallback stays 'en'
          }
        }
      })
      .catch(() => {
        // storage read error, default to 'en'
      })

    return () => {
      alive = false
    }
  }, [])

  const setLanguage = useCallback(async (next: AppLanguage) => {
    setLanguageState(next)
    setRecent((prev) => {
      const list = [next, ...prev.filter((c) => c !== next)].slice(0, RECENT_MAX)
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(list)).catch(() => {})
      return list
    })
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next)
    } catch {
      // safe fallback
    }
  }, [])

  // Mirror for the non-React readers (see language.ts). Set synchronously
  // during render so a screen mounting in the same commit reads the new value.
  setResolvedLanguage(language)

  const t = useCallback(
    (key: TranslationKey) => translateKey(language, key),
    [language],
  )

  return (
    <AppLanguageContext.Provider value={{ language, setLanguage, t, recent, rtl: isRtl(language) }}>
      {children}
    </AppLanguageContext.Provider>
  )
}

export function useAppLanguage(): AppLanguageContextValue {
  return useContext(AppLanguageContext)
}
