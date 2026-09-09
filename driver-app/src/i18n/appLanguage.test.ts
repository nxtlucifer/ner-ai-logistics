import { describe, expect, it } from 'vitest'
import {
  APP_LANGUAGES,
  APP_LANGUAGE_CODES,
  isAppLanguage,
  t,
  TRANSLATIONS,
} from './appLanguage'

describe('appLanguage i18n system', () => {
  it('supports English, Hindi, Gujarati, Assamese, and Bengali', () => {
    expect(APP_LANGUAGE_CODES).toEqual(['en', 'hi', 'gu', 'as', 'bn'])
    expect(APP_LANGUAGES.length).toBe(5)
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

  it('ensures every key present in English exists in all other languages', () => {
    const enKeys = Object.keys(TRANSLATIONS.en) as Array<keyof typeof TRANSLATIONS.en>
    for (const lang of APP_LANGUAGE_CODES) {
      const dict = TRANSLATIONS[lang]
      for (const key of enKeys) {
        expect(dict[key]).toBeTruthy()
      }
    }
  })
})
