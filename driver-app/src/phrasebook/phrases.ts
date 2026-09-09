/**
 * Reading the offline phrasebook.
 *
 * A pairing, not a translation. `phrasePair` returns the SAME phrase in the
 * driver's language and in the language of whoever they are talking to, so
 * the screen can show both at once and the driver knows what they are
 * holding out. Nothing here translates anything: every string was written
 * into `phrases.json` ahead of time.
 *
 * WHY THE LANGUAGE TYPE IS NOT `Language`
 *
 * The app UI ships en/hi/as. The phrasebook also carries bn, because a
 * phrasebook target costs nothing but a string - there is no provider behind
 * it and no claim being made. Keeping the types separate means adding a
 * phrasebook language can never silently imply the interface has been
 * translated into it.
 */

import catalogue from './phrases.json'

export type PhraseLanguage = 'en' | 'hi' | 'as' | 'bn'

export interface PhraseLanguageOption {
  code: PhraseLanguage
  /** The language's name in its own script. */
  name: string
}

interface RawPhrase {
  id: string
  en: string
  hi: string
  as: string
  bn: string
}

interface RawCategory extends Omit<RawPhrase, 'id'> {
  id: string
  phrases: RawPhrase[]
}

interface RawBook {
  version: string
  revised: string
  languages: PhraseLanguageOption[]
  categories: RawCategory[]
}

const book = catalogue as unknown as RawBook

export const VERSION: string = book.version
export const REVISED: string = book.revised
export const LANGUAGES: PhraseLanguageOption[] = book.languages

const FALLBACK: PhraseLanguage = 'en'

function say(bag: Record<PhraseLanguage, string>, lang: PhraseLanguage): string {
  return bag[lang] ?? bag[FALLBACK]
}

/** One phrase, shown in both languages at once. */
export interface PhrasePair {
  id: string
  /** What the driver means. */
  mine: string
  /** What the other person reads. */
  theirs: string
}

export interface PhraseCategory {
  id: string
  title: string
  phrases: PhrasePair[]
}

/**
 * The whole book, paired.
 *
 * `from` is the driver's language, `to` is the listener's. Passing the same
 * value for both is allowed and produces identical halves - which is the
 * correct behaviour, not a bug to guard against: it is what a driver sees
 * before they have picked anyone to talk to.
 */
export function phrasebook(from: PhraseLanguage, to: PhraseLanguage): PhraseCategory[] {
  return book.categories.map((category) => ({
    id: category.id,
    title: say(category, from),
    phrases: category.phrases.map((phrase) => ({
      id: phrase.id,
      mine: say(phrase, from),
      theirs: say(phrase, to),
    })),
  }))
}

/** Every phrase id in the book, for coverage checks. */
export function phraseIds(): string[] {
  return book.categories.flatMap((c) => c.phrases.map((p) => p.id))
}
