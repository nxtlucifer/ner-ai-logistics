/**
 * Localise a visible English string, with an EXPLICIT English fallback.
 *
 * `t(lang, key)` in appLanguage.ts is the typed table for the screens that
 * were built with keys. Everything else on screen was English literals, and
 * the honest way to put them under localisation without inventing a key
 * per sentence is to key on the English itself: `tx(lang, 'No active trip')`.
 * A phrase with a translation renders it; a phrase without one renders the
 * English it was given - by design, visibly, never a blank or a code.
 *
 * LOCALE STATUS - do not overclaim:
 *   en  VERIFIED   the source language
 *   hi/gu/as/bn  DRAFT   every phrase drafted (phrases.ts), NOT reviewed by a native speaker
 *   ta/te/kn/ml/mr/pa/or/ur/ne  DRAFT   core keys only (moreLanguages.ts)
 *   brx/doi/ks/kok/mai/mni/sa/sat/sd  FALLBACK_ENGLISH
 * The reason-code catalogue and the safety guide (reasonCodes.json,
 * safety/guide.json) exist in en/hi/as only; gu/bn read those in English.
 */

import { APP_LANGUAGES, type AppLanguage, type LocaleStatus } from './appLanguage'
import { useAppLanguage } from './AppLanguageProvider'
import { PHRASES } from './phrases'

export { PHRASES }
export type { LocaleStatus }

export const LOCALE_STATUS = Object.fromEntries(APP_LANGUAGES.map((o) => [o.code, o.status])) as Record<AppLanguage, LocaleStatus>

export function tx(lang: AppLanguage, en: string): string {
  if (lang === 'en') return en
  return PHRASES[en]?.[lang] ?? en
}

/** `const t = useT(); t('No active trip')` - the app language, English fallback. */
export function useT(): (en: string) => string {
  const { language } = useAppLanguage()
  return (en) => tx(language, en)
}
