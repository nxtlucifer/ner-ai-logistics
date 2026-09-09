/**
 * What the driver's screen says when a figure is missing.
 *
 * The backend takes care to send `null` rather than `0` when something cannot
 * be computed. Every bit of that care is undone by a formatter that renders
 * `null` as "0.0 km" - so these tests are less about formatting than about the
 * one thing the app must not do, which is invent a measurement.
 */

import { describe, expect, it } from 'vitest'

import {
  NOT_WORKED_OUT,
  UNKNOWN,
  formatDistanceKm,
  formatMinutes,
  formatOffRoute,
  offRouteDetail,
} from './progressFormat'

describe('formatDistanceKm', () => {
  it('renders a real distance', () => {
    expect(formatDistanceKm(134.27)).toBe('134.3 km')
  })

  it('renders a MEASURED zero as a number', () => {
    // A truck that has genuinely arrived should say so.
    expect(formatDistanceKm(0)).toBe('0.0 km')
  })

  it('renders an ABSENT distance as a word', () => {
    // "0 km left" at the start of a shift is a lie the app would be telling by
    // itself, on a screen the driver has no way to check.
    expect(formatDistanceKm(null)).toBe(UNKNOWN)
    expect(formatDistanceKm(undefined)).toBe(UNKNOWN)
  })

  it('refuses NaN and Infinity rather than rendering them', () => {
    // JSON can genuinely carry these; Python emits them for NaN/inf.
    expect(formatDistanceKm(Number.NaN)).toBe(UNKNOWN)
    expect(formatDistanceKm(Number.POSITIVE_INFINITY)).toBe(UNKNOWN)
  })
})

describe('formatMinutes', () => {
  it('rounds to whole minutes', () => {
    expect(formatMinutes(117.4)).toBe('117 min')
    expect(formatMinutes(0)).toBe('0 min')
  })

  it('says it cannot be worked out rather than showing zero', () => {
    // No provider duration means no pace, and no pace means no answer - not a
    // guess from an invented default speed.
    expect(formatMinutes(null)).toBe(NOT_WORKED_OUT)
    expect(formatMinutes(Number.NaN)).toBe(NOT_WORKED_OUT)
  })
})

describe('formatOffRoute', () => {
  it('uses metres below a kilometre', () => {
    expect(formatOffRoute(53.3)).toBe('53 m')
    expect(formatOffRoute(999)).toBe('999 m')
  })

  it('switches to kilometres above it', () => {
    // "1300 m" is a number a driver has to convert while driving.
    expect(formatOffRoute(1000)).toBe('1.0 km')
    expect(formatOffRoute(5332.6)).toBe('5.3 km')
  })

  it('is a word when absent', () => {
    expect(formatOffRoute(null)).toBe(UNKNOWN)
  })
})

describe('offRouteDetail', () => {
  it('names the distance when there is one', () => {
    expect(offRouteDetail(5332.6)).toBe('About 5.3 km from the planned road.')
  })

  it('still says something useful with no distance', () => {
    // Never an empty string: a warning box with no words in it reads as a
    // rendering bug and teaches a driver to ignore the box.
    const text = offRouteDetail(null)
    expect(text).not.toBeNull()
    expect(text!.length).toBeGreaterThan(0)
    expect(text).not.toContain('null')
    expect(text).not.toContain(UNKNOWN)
  })
})

describe('nothing here promises an arrival time', () => {
  it('never produces a clock time or the word arrival', () => {
    const outputs = [
      formatDistanceKm(134.27),
      formatDistanceKm(null),
      formatMinutes(117.4),
      formatMinutes(null),
      formatOffRoute(5332.6),
      offRouteDetail(5332.6),
      offRouteDetail(null),
    ].join(' | ').toLowerCase()

    for (const forbidden of ['eta', 'arriv', 'due at', ':']) {
      expect(outputs).not.toContain(forbidden)
    }
  })
})
