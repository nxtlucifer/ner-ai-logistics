import { describe, expect, it } from 'vitest'
import {
  findOfflinePhrases,
  LANGUAGE_CODES,
  QUICK_DRIVER_PHRASES,
  sanitizeInput,
  SUPPORTED_LANGUAGES,
  VERIFIED_QUICK_TRANSLATIONS,
} from './offlineTranslator'

describe('offlineTranslator', () => {
  it('supports all 12 regional/national languages', () => {
    expect(LANGUAGE_CODES.length).toBe(12)
    const expected = ['en', 'hi', 'gu', 'as', 'bn', 'mr', 'pa', 'or', 'ta', 'te', 'ml', 'kn']
    for (const code of expected) {
      expect(SUPPORTED_LANGUAGES[code]).toBeDefined()
      expect(SUPPORTED_LANGUAGES[code].name).toBeTruthy()
      expect(SUPPORTED_LANGUAGES[code].nativeName).toBeTruthy()
      expect(SUPPORTED_LANGUAGES[code].voiceLocale).toMatch(/^[a-z]{2}-IN$/)
    }
  })

  it('provides 8 verified driver quick phrases in all 12 languages', () => {
    expect(QUICK_DRIVER_PHRASES.length).toBe(8)
    for (const phrase of QUICK_DRIVER_PHRASES) {
      const trans = VERIFIED_QUICK_TRANSLATIONS[phrase]
      expect(trans).toBeDefined()
      for (const code of LANGUAGE_CODES) {
        expect(trans[code]).toBeTruthy()
      }
    }
  })

  it('sanitizes inputs by stripping HTML and enforcing max length', () => {
    expect(sanitizeInput('<script>alert("hack")</script>Hello <b>World</b>')).toBe(
      'alert("hack")Hello World',
    )
    const long = 'a'.repeat(2000)
    expect(sanitizeInput(long, 1500).length).toBe(1500)
    expect(sanitizeInput('')).toBe('')
    expect(sanitizeInput('   ')).toBe('')
  })

  it('finds offline matching phrases by query and target language', () => {
    const fuelMatches = findOfflinePhrases('fuel', 'hi')
    expect(fuelMatches.length).toBeGreaterThan(0)
    expect(fuelMatches.some((m) => m.english.includes('fuel'))).toBe(true)
    const fuelHi = fuelMatches.find((m) => m.english.includes('fuel'))!
    expect(fuelHi.translation).toContain('पेट्रोल')

    const gateMatches = findOfflinePhrases('loading gate', 'as')
    expect(gateMatches.length).toBeGreaterThan(0)
    expect(gateMatches[0].translation).toContain('ল’ডিং গেট')
  })

  it('returns default operational phrases when query is empty', () => {
    const defaultPhrases = findOfflinePhrases('', 'hi')
    expect(defaultPhrases.length).toBeGreaterThanOrEqual(8)
  })
})
