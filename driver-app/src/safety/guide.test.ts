/**
 * Safety-guide invariants.
 *
 * This file exists because `guide.json` is content, and content is edited by
 * people in a hurry. Every assertion here is a property that, if it broke,
 * would break quietly - the panel would still render, and it would render
 * something worse than useless at a roadside.
 *
 * The load-bearing one is `answers when to call`. Everything else is hygiene.
 */

import { describe, expect, it } from 'vitest'

import catalogue from './guide.json'
import { LANGUAGES, type Language } from '../i18n/reasonCodes'
import {
  disclaimer,
  emergencyBanner,
  emergencyNumbers,
  emergencySteps,
  topicById,
  topicsFor,
} from './guide'

/** Devanagari and Assamese render 112 in their own numerals. */
const EMERGENCY_NUMBER = /112|১১২|११२/

/**
 * Drug names, not the word "medicine".
 *
 * The guide is allowed - and required - to SAY "do not take any medicine
 * unless a doctor has already prescribed it to you". What it must never do is
 * name a drug, because naming one is recommending it. Checked in every
 * language and in both scripts where a transliteration is plausible.
 */
const DRUG_NAMES = [
  'aspirin',
  'disprin',
  'paracetamol',
  'crocin',
  'ibuprofen',
  'combiflam',
  'nitroglycerin',
  'sorbitrate',
  'antibiotic',
  'एस्पिरिन',
  'पैरासिटामोल',
  'क्रोसिन',
  'এস্পিৰিন',
  'পেৰাচিটামল',
]

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(allStrings)
  if (value && typeof value === 'object') {
    return Object.entries(value)
      // The $comment block explains the rules; it is not shipped text.
      .filter(([key]) => key !== '$comment')
      .flatMap(([, v]) => allStrings(v))
  }
  return []
}

describe('safety guide catalogue', () => {
  it('answers "when do I call for help" for every single topic', () => {
    // THE invariant. A topic is either an emergency outright, or it carries
    // the red flags that make it one. A topic that is neither tells a driver
    // what to do and never tells them when to stop and call, which is the
    // failure this guide exists to prevent.
    for (const topic of topicsFor('en')) {
      const answered = topic.emergency || topic.escalate.length > 0
      expect(answered, `${topic.id} answers neither`).toBe(true)
    }
  })

  it('does not give escalation red flags to topics that are already emergencies', () => {
    // Not pedantry: the screen shows `escalate` under a "call now if" heading.
    // On a topic that already says CALL NOW, a second conditional list reads
    // as though the first one were optional.
    for (const topic of topicsFor('en')) {
      if (topic.emergency) expect(topic.escalate, topic.id).toHaveLength(0)
    }
  })

  it('is complete in every language the app ships', () => {
    for (const lang of LANGUAGES) {
      const topics = topicsFor(lang)
      expect(topics.length, lang).toBe(catalogue.topics.length)
      for (const topic of topics) {
        expect(topic.title.trim(), `${topic.id}/${lang} title`).not.toBe('')
        expect(topic.recognise.length, `${topic.id}/${lang} recognise`).toBeGreaterThan(0)
        expect(topic.do.length, `${topic.id}/${lang} do`).toBeGreaterThan(0)
        expect(topic.avoid.length, `${topic.id}/${lang} avoid`).toBeGreaterThan(0)
      }
    }
  })

  it('never falls back to English for a language it claims to support', () => {
    // Completeness above would pass if `hi` silently resolved to the English
    // text. This pins that the strings actually differ.
    for (const lang of LANGUAGES.filter((l) => l !== 'en')) {
      for (const topic of topicsFor(lang)) {
        const english = topicById(topic.id, 'en')!
        expect(topic.title, `${topic.id}/${lang} is untranslated`).not.toBe(english.title)
      }
    }
  })

  it('tells the driver to call the emergency number, in every language', () => {
    for (const lang of LANGUAGES) {
      const steps = emergencySteps(lang).join(' ')
      expect(steps, `${lang} escalation steps`).toMatch(EMERGENCY_NUMBER)
      expect(emergencyBanner(lang).trim(), lang).not.toBe('')
      expect(disclaimer(lang).trim(), lang).not.toBe('')
    }
  })

  it('lists 112 first among the emergency numbers', () => {
    // 112 is the unified national number (MHA ERSS). A driver reading this
    // panel under stress takes the first one.
    for (const lang of LANGUAGES) {
      const numbers = emergencyNumbers(lang)
      expect(numbers[0].number).toBe('112')
      for (const entry of numbers) expect(entry.label.trim(), lang).not.toBe('')
    }
  })

  it('recommends no medicine by name, anywhere, in any language', () => {
    const haystack = allStrings(catalogue).join(' ').toLowerCase()
    for (const drug of DRUG_NAMES) {
      expect(haystack, `guide names a drug: ${drug}`).not.toContain(drug.toLowerCase())
    }
  })

  it('hedges the two topics that name a condition rather than an observation', () => {
    // Most topics describe something the driver can SEE - bleeding, someone
    // unconscious, a burn. Two do not: heart attack and stroke are clinical
    // conditions, and titling them flatly would be this app diagnosing. They
    // are titled "Suspected ...", and that is checked rather than trusted.
    //
    // An earlier version of this test banned the phrase "you have" outright
    // and failed on "press with the cleanest cloth you have" - a reminder
    // that a prose-shaped rule catches prose, not meaning. This checks the
    // specific structural promise instead.
    for (const id of ['HEART_ATTACK', 'STROKE']) {
      expect(topicById(id, 'en')!.title, id).toMatch(/^Suspected /)
    }
  })

  it('never claims to diagnose, in any language', () => {
    const haystack = allStrings(catalogue).join(' ').toLowerCase()
    for (const word of ['diagnos', 'निदान', 'ৰোগ নিৰ্ণয়']) {
      // The disclaimer is the one place these may appear, and only to deny
      // them ("not a diagnosis"). It is excluded from the topic content by
      // construction: this checks the TOPICS.
      const topicText = allStrings(catalogue.topics).join(' ').toLowerCase()
      expect(topicText, `topic text claims to ${word}`).not.toContain(word)
      expect(haystack.length).toBeGreaterThan(0)
    }
  })

  it('cites a source for its emergency number and its stroke guidance', () => {
    const ids = catalogue.sources.map((s) => s.id)
    expect(ids).toContain('mha-erss')
    expect(ids).toContain('nhs-stroke')
    for (const source of catalogue.sources) {
      expect(source.url).toMatch(/^https:\/\//)
      expect(source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('puts emergency topics before the rest', () => {
    const emergencyFlags = topicsFor('en').map((t) => t.emergency)
    const firstNonEmergency = emergencyFlags.indexOf(false)
    expect(emergencyFlags.slice(firstNonEmergency)).not.toContain(true)
  })

  it('has unique topic ids', () => {
    const ids = catalogue.topics.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
