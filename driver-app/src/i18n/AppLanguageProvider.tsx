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
  STORAGE_KEY,
  t as translateKey,
  type AppLanguage,
  type TranslationKey,
} from './appLanguage'
import { matchLanguage, setResolvedLanguage } from './language'

export interface AppLanguageContextValue {
  language: AppLanguage
  setLanguage: (next: AppLanguage) => Promise<void>
  t: (key: TranslationKey) => string
}

const AppLanguageContext = createContext<AppLanguageContextValue>({
  language: 'en',
  setLanguage: async () => {},
  t: (key: TranslationKey) => translateKey('en', key),
})

export function AppLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en')

  useEffect(() => {
    let alive = true
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
    <AppLanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </AppLanguageContext.Provider>
  )
}

export function useAppLanguage(): AppLanguageContextValue {
  return useContext(AppLanguageContext)
}
