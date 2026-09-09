/**
 * Reading the offline safety guide.
 *
 * The catalogue is `guide.json`, shipped inside the app. There is no network
 * call here and no model in the loop, for the same reason `reasonCodes.ts`
 * has neither: the moment this content matters, the phone is most likely in a
 * valley with no signal.
 *
 * THE FALLBACK CHAIN IS THE SAME AS reasonCodes
 *
 * requested language, then English. A missing translation must degrade to a
 * language the driver may not prefer, never to a blank panel where first-aid
 * steps should be. `guide.test.ts` asserts the catalogue is complete in all
 * three languages so the fallback stays a safety net rather than a habit.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * It does not decide anything. There is no symptom matcher, no triage
 * function, no "which topic does this driver need" logic - the driver picks
 * the topic. A function here that guessed would be a diagnosis, and this
 * product does not make one. See the comment block in `guide.json`.
 */

import catalogue from './guide.json'
import type { Language } from '../i18n/reasonCodes'

const FALLBACK: Language = 'en'

/** One topic's content in a single language. */
export interface TopicText {
  title: string
  /** What the driver is looking at. Never phrased as a diagnosis. */
  recognise: string[]
  do: string[]
  avoid: string[]
}

/** A topic resolved into one language, ready to render. */
export interface Topic extends TopicText {
  id: string
  /**
   * `true` means call emergency services now, without the driver having to
   * judge anything. The screen renders `emergencySteps()` above the content.
   */
  emergency: boolean
  /**
   * Red flags that turn a non-emergency topic into an emergency. Empty for
   * topics that are already `emergency`, and non-empty for every topic that
   * is not - enforced by `guide.test.ts`, because a topic that answers
   * neither leaves a driver with no idea when to stop reading and call.
   */
  escalate: string[]
}

export interface EmergencyNumber {
  number: string
  label: string
}

interface Localised {
  en: string
  hi: string
  as: string
}

interface RawTopic {
  id: string
  emergency: boolean
  escalate: string[]
  en: TopicText
  hi: TopicText
  as: TopicText
}

interface RawGuide {
  version: string
  revised: string
  disclaimer: Localised
  emergency: {
    banner: Localised
    steps: { en: string[]; hi: string[]; as: string[] }
  }
  numbers: ({ number: string } & Localised)[]
  sources: { id: string; name: string; url: string; retrieved: string }[]
  topics: RawTopic[]
}

const guide = catalogue as unknown as RawGuide

/** Catalogue identity, shown on screen so a stale build is visible. */
export const VERSION: string = guide.version
export const REVISED: string = guide.revised
export const SOURCES = guide.sources

function pick<T>(bag: { en: T; hi: T; as: T }, lang: Language): T {
  return bag[lang] ?? bag[FALLBACK]
}

/** The standing disclaimer. Shown on the screen, not buried in a file. */
export function disclaimer(lang: Language): string {
  return pick(guide.disclaimer, lang)
}

export function emergencyBanner(lang: Language): string {
  return pick(guide.emergency.banner, lang)
}

/**
 * The escalation steps, held in ONE place and rendered for every emergency
 * topic. Copying them per topic would let one drift, and the one that drifts
 * is the one being read at the roadside.
 */
export function emergencySteps(lang: Language): string[] {
  return pick(guide.emergency.steps, lang)
}

export function emergencyNumbers(lang: Language): EmergencyNumber[] {
  return guide.numbers.map((n) => ({ number: n.number, label: pick(n, lang) }))
}

/**
 * Every topic, in the requested language.
 *
 * Emergency topics come first. A driver scrolling this list one-handed at the
 * roadside should reach "severe bleeding" before "sprain", and alphabetical
 * or file order gives no such guarantee. Order within each group is the
 * catalogue's, which is roughly most-urgent-first by hand.
 */
export function topicsFor(lang: Language): Topic[] {
  const resolved = guide.topics.map((topic) => {
    const text = (topic[lang] ?? topic[FALLBACK]) as TopicText
    return {
      id: topic.id,
      emergency: topic.emergency,
      escalate: topic.escalate,
      ...text,
    }
  })
  // Stable partition rather than a comparator: two topics that are both
  // emergencies must keep their catalogue order, which is curated.
  return [...resolved.filter((t) => t.emergency), ...resolved.filter((t) => !t.emergency)]
}

export function topicById(id: string, lang: Language): Topic | undefined {
  return topicsFor(lang).find((t) => t.id === id)
}
