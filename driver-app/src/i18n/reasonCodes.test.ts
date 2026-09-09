/**
 * Reason-code rendering: the fallbacks, and what is allowed to be spoken.
 *
 * The interesting tests are the degenerate ones. Rendering a known code in a
 * known language is table lookup; what matters is that a phone running an
 * older build than the backend still shows a driver something, and that the
 * voice layer stays quiet about things it does not understand.
 */

import { describe, expect, it } from 'vitest'

import {
  LANGUAGES,
  LANGUAGE_NAMES,
  MAX_SPOKEN_ALERTS,
  isKnownReasonCode,
  shouldSpeak,
  speechFor,
  spokenCodes,
  translateReasonCode,
} from './reasonCodes'

describe('translation', () => {
  it('renders a known code in each language', () => {
    for (const language of LANGUAGES) {
      const text = translateReasonCode('ROAD_DECLARED_CLOSED', language)
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toBe('ROAD_DECLARED_CLOSED')
    }
  })

  it('gives a different string per language', () => {
    const rendered = LANGUAGES.map((l) =>
      translateReasonCode('ROAD_DECLARED_CLOSED', l),
    )
    expect(new Set(rendered).size).toBe(LANGUAGES.length)
  })

  it('falls back to the code itself for something it has never heard of', () => {
    // A newer backend, or a rolled-back app. Ugly on screen, and better than a
    // blank space where a warning should be - a dispatcher on a support call
    // can act on the code.
    expect(translateReasonCode('SOMETHING_NEW_FROM_THE_FUTURE', 'hi')).toBe(
      'SOMETHING_NEW_FROM_THE_FUTURE',
    )
  })

  it('never throws, whatever it is handed', () => {
    for (const input of ['', '   ', 'lower_case', '💥', 'a'.repeat(500)]) {
      expect(() => translateReasonCode(input, 'as')).not.toThrow()
    }
  })

  it('knows what it knows', () => {
    expect(isKnownReasonCode('HEAVY_RAIN_ON_ROUTE')).toBe(true)
    expect(isKnownReasonCode('NOT_A_REAL_CODE')).toBe(false)
  })

  it('names each language in its own script', () => {
    // A picker that lists "Assamese" in English is a picker for people who
    // already read English.
    expect(LANGUAGE_NAMES.hi).toBe('हिन्दी')
    expect(LANGUAGE_NAMES.as).toBe('অসমীয়া')
  })
})

describe('voice', () => {
  it('speaks the alerts a driver must hear', () => {
    expect(shouldSpeak('ROAD_DECLARED_CLOSED')).toBe(true)
    expect(shouldSpeak('VEHICLE_OFF_PLANNED_ROUTE')).toBe(true)
    expect(shouldSpeak('SELECTED_ROUTE_DETERIORATED')).toBe(true)
  })

  it('stays quiet about narration', () => {
    // Reading "no landslide history available" aloud would bury the warnings
    // that matter, and a driver who learns to tune the voice out has lost the
    // feature entirely.
    expect(shouldSpeak('NO_LANDSLIDE_HISTORY_AVAILABLE')).toBe(false)
    expect(shouldSpeak('MONSOON_SEASON')).toBe(false)
    expect(shouldSpeak('DISTANCE_NOT_ESTIMATED')).toBe(false)
  })

  it('stays silent about codes it does not recognise', () => {
    // A build that spoke whatever it did not understand would narrate a
    // backend's internal vocabulary at someone driving.
    expect(shouldSpeak('UNKNOWN_FUTURE_CODE')).toBe(false)
  })

  it('filters a mixed list down to what is worth saying', () => {
    const spoken = spokenCodes([
      'MONSOON_SEASON',
      'ROAD_DECLARED_CLOSED',
      'DISTANCE_NOT_ESTIMATED',
      'VEHICLE_OFF_PLANNED_ROUTE',
    ])
    expect(spoken).toEqual(['ROAD_DECLARED_CLOSED', 'VEHICLE_OFF_PLANNED_ROUTE'])
  })

  it('keeps the backend ordering rather than inventing a severity ranking', () => {
    const order = ['VEHICLE_OFF_PLANNED_ROUTE', 'ROAD_DECLARED_CLOSED']
    expect(spokenCodes(order)).toEqual(order)
  })

  it('caps how much is read at once', () => {
    // A driver cannot hold six warnings, and the ones after the third are
    // heard while they are still thinking about the first. Anything cut is
    // still on screen.
    const many = [
      'ROAD_DECLARED_CLOSED',
      'VEHICLE_OFF_PLANNED_ROUTE',
      'SELECTED_ROUTE_DETERIORATED',
      'HEAVY_RAIN_ON_ROUTE',
      'HIGH_WIND_GUSTS',
    ]
    const line = speechFor(many, 'en')
    expect(line).not.toBeNull()
    expect(line!.split('. ')).toHaveLength(MAX_SPOKEN_ALERTS)
  })

  it('says nothing when there is nothing worth saying', () => {
    expect(speechFor(['MONSOON_SEASON', 'DISTANCE_NOT_ESTIMATED'], 'en')).toBeNull()
    expect(speechFor([], 'hi')).toBeNull()
  })

  it('speaks in the requested language', () => {
    const hindi = speechFor(['ROAD_DECLARED_CLOSED'], 'hi')
    const english = speechFor(['ROAD_DECLARED_CLOSED'], 'en')
    expect(hindi).not.toBe(english)
    expect(hindi).toBe('यह सड़क बंद है')
  })
})
