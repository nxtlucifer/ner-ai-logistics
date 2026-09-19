/**
 * Which language to speak to this driver in.
 *
 * NO NEW DEPENDENCY. `Intl` ships with Hermes, so the device locale is
 * readable without `expo-localization` and without a native module that would
 * then have to be verified on hardware nobody has tonight.
 *
 * WHY IT FALLS BACK RATHER THAN ASKING
 *
 * A driver opening the app for the first time on a hill road should not meet a
 * language picker before they can see their trip. The device already knows
 * what language its owner reads; using it is the answer that requires nothing
 * of them. An explicit override belongs in settings later, and `resolve` takes
 * one so that screen has something to call.
 *
 * ENGLISH IS THE FALLBACK, NOT THE DEFAULT
 *
 * The difference matters. A phone set to Bengali gets English because this
 * build has no Bengali, not because English was preferred - and the moment
 * `as` or `hi` is present it wins. Adding a language is a catalogue change,
 * not a code change.
 */

import { useAppLanguage } from './AppLanguageProvider'
import { isAppLanguage, type AppLanguage } from './appLanguage'
import { LANGUAGES, type Language } from './reasonCodes'

const FALLBACK: Language = 'en'

/**
 * Map a BCP 47 tag to a language this build actually has.
 *
 * Only the primary subtag is considered: `hi-IN`, `hi-Latn` and `hi` are all
 * Hindi as far as this catalogue is concerned, and pretending to distinguish
 * regional variants there would imply translations that do not exist.
 */
export function matchLanguage(tag: string | null | undefined): Language {
  if (!tag) return FALLBACK
  const primary = tag.toLowerCase().split(/[-_]/)[0]
  return (LANGUAGES as readonly string[]).includes(primary)
    ? (primary as Language)
    : FALLBACK
}

/**
 * The device's language, or English.
 *
 * Wrapped in try/catch because `Intl` is not guaranteed on every JS engine a
 * React Native build might use, and a missing internationalisation API must
 * not be the reason a driver cannot see their trip.
 */
export function deviceLanguage(): Language {
  try {
    return matchLanguage(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    return FALLBACK
  }
}

/**
 * The language to render in: an explicit choice if one has been made,
 * otherwise the device's.
 *
 * `override` is what a settings screen will pass. It is honoured even when it
 * names a language the device is not set to, because a driver who picked
 * Assamese meant it.
 */
export function resolveLanguage(override?: string | null): Language {
  if (override) return matchLanguage(override)
  return appLanguage ? matchLanguage(appLanguage) : deviceLanguage()
}

/**
 * ONE language state. The app's chosen language (AppLanguageProvider) is
 * mirrored here so the catalogues that are read outside React - reason codes,
 * the safety guide, the phrasebook, Route AI - follow the same choice as the
 * labels. Before it was the DEVICE locale, so a driver who picked Hindi got
 * Hindi buttons around an English safety guide.
 */
let appLanguage: string | null = null
export function setResolvedLanguage(tag: string | null): void {
  appLanguage = tag ?? deviceLanguage()
}

/**
 * The chosen app language, for code that runs OUTSIDE a component.
 *
 * A notification raised from an effect has no hook to call, and that is
 * exactly how two push messages ended up permanently English while every
 * label around them translated. This returns the same value
 * `useAppLanguage()` would, or `'en'` before the provider has mounted.
 */
export function currentAppLanguage(): AppLanguage {
  return isAppLanguage(appLanguage) ? appLanguage : 'en'
}

/**
 * The language the SAFETY GUIDE should be read in.
 *
 * WHY THIS IS NOT `resolveLanguage()`
 *
 * `resolveLanguage` reads the DEVICE locale. A driver who picks Assamese in
 * the app on a phone the shop set to English was still shown English
 * first-aid guidance, because nothing connected the choice they made to the
 * catalogue. That is the bug: the setting appeared to work - every label
 * changed - while the one screen where language matters most ignored it.
 *
 * WHY IT STILL FALLS BACK
 *
 * The reviewed guide exists in three languages. The app offers twenty-two,
 * honestly labelled DRAFT or FALLBACK_ENGLISH, because a machine-translated
 * instruction about a head injury is worse than one in a language the
 * reader has to work at. So a driver who picks Tamil gets English guidance
 * and `guidanceIsTranslated()` says so on screen - it is not left to be
 * discovered.
 */
export function useGuidanceLanguage(): Language {
  const { language } = useAppLanguage()
  return matchLanguage(language)
}

/** Whether the reviewed guide exists in the driver's chosen language. */
export function guidanceIsTranslated(chosen: string): boolean {
  return (LANGUAGES as readonly string[]).includes(chosen)
}
