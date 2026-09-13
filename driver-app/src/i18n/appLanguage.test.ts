import { describe, expect, it } from 'vitest'
import {
  APP_LANGUAGES,
  APP_LANGUAGE_CODES,
  isAppLanguage,
  speechLocale,
  t,
  TRANSLATIONS,
} from './appLanguage'

describe('appLanguage i18n system', () => {
  it('offers the 22 scheduled languages plus English, A-Z, each with an honest status', () => {
    expect(APP_LANGUAGES.length).toBe(23)
    expect(APP_LANGUAGE_CODES).toEqual(APP_LANGUAGES.map((o) => o.code))
    const labels = APP_LANGUAGES.map((o) => o.label)
    expect(labels).toEqual([...labels].sort())
    expect(APP_LANGUAGES.filter((o) => o.status === 'VERIFIED').map((o) => o.code)).toEqual(['en'])
    expect(APP_LANGUAGES.filter((o) => o.rtl).map((o) => o.code).sort()).toEqual(['ks', 'sd', 'ur'])
    expect(speechLocale('hi')).toBe('hi-IN')
    expect(speechLocale('ne')).toBe('ne-NP')
  })

  it('validates language codes correctly', () => {
    expect(isAppLanguage('en')).toBe(true)
    expect(isAppLanguage('hi')).toBe(true)
    expect(isAppLanguage('gu')).toBe(true)
    expect(isAppLanguage('as')).toBe(true)
    expect(isAppLanguage('bn')).toBe(true)
    expect(isAppLanguage('fr')).toBe(false)
    expect(isAppLanguage(null)).toBe(false)
  })

  it('translates navigation tabs accurately across all 5 languages', () => {
    expect(t('en', 'nav_navigate')).toBe('Navigate')
    expect(t('hi', 'nav_navigate')).toBe('नेविगेट')
    expect(t('gu', 'nav_navigate')).toBe('નેવિગેટ')
    expect(t('as', 'nav_navigate')).toBe('নেভিগেট')
    expect(t('bn', 'nav_navigate')).toBe('নেভিগেট')
  })

  it('translates buttons and login prompts across all 5 languages', () => {
    for (const lang of APP_LANGUAGE_CODES) {
      expect(t(lang, 'login_title')).toBeTruthy()
      expect(t(lang, 'login_phone_label')).toBeTruthy()
      expect(t(lang, 'login_submit')).toBeTruthy()
      expect(t(lang, 'btn_sign_out')).toBeTruthy()
      expect(t(lang, 'btn_start_trip')).toBeTruthy()
      expect(t(lang, 'safety_police')).toBeTruthy()
      expect(t(lang, 'safety_ambulance')).toBeTruthy()
      expect(t(lang, 'safety_highway')).toBeTruthy()
    }
  })

  it('falls back to English when key is missing or language is unknown', () => {
    // @ts-expect-error test fallback
    // The string is incidental; the fallback is the subject. `login_title` now
    // carries the login headline, which is what the screen actually renders.
    expect(t('fr', 'login_title')).toBe('Welcome back')
  })

  it('full drafts carry every key; every language renders something for every key', () => {
    const enKeys = Object.keys(TRANSLATIONS.en) as Array<keyof typeof TRANSLATIONS.en>
    for (const lang of ['hi', 'gu', 'as', 'bn'] as const) {
      for (const key of enKeys) expect(TRANSLATIONS[lang][key], `${lang}.${key}`).toBeTruthy()
    }
    for (const lang of APP_LANGUAGE_CODES) {
      for (const key of enKeys) expect(t(lang, key), `${lang}.${key}`).toBeTruthy()
      const dict = TRANSLATIONS[lang]
      const status = APP_LANGUAGES.find((o) => o.code === lang)?.status
      // A language listed as English fallback must not quietly carry a draft, and vice versa.
      expect(Object.keys(dict).length > 0, lang).toBe(status !== 'FALLBACK_ENGLISH')
    }
  })
})
