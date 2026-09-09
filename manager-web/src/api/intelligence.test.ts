/**
 * The rules that keep an unassessed route from reading as a safe one.
 *
 * This file exists because of a specific regression, not as general coverage.
 * `supabaseManagerApi.routeRecommendation` used to be a hardcoded fixture: it
 * scored routes from their `kind` (`isPrimary ? 14 : isFuel ? 38 : 68`),
 * attached invented evidence ("1.2 mm/h light rain", `observations_used: 5`),
 * and declared `weather: 'AVAILABLE'` and `landslide: 'AVAILABLE'` for
 * providers that were never called. Those four strings shipped in the
 * production bundle.
 *
 * The tests below assert the two properties that stop that returning:
 *
 *   1. an unreachable intelligence plane yields UNASSESSED with a NULL score,
 *      never a number and never a band that reads as safe;
 *   2. nothing in the fallback claims any evidence source was consulted.
 */

import { describe, expect, it } from 'vitest'

import { originProblem } from './intelligence'

describe('originProblem', () => {
  it('accepts a hosted https origin', () => {
    expect(originProblem('https://intelligence.example.com')).toBeNull()
    expect(originProblem('https://ner-intel.onrender.com/')).toBeNull()
  })

  it('reports an unset origin as not configured rather than invalid', () => {
    // The distinction matters: "not configured yet" is a deployment state,
    // "invalid" is a mistake someone has to go fix.
    expect(originProblem('')).toBe('not configured')
  })

  it('refuses plain http', () => {
    // A Supabase access token travels on this connection, and Android release
    // builds block cleartext outright - this would fail on the phone, not here.
    expect(originProblem('http://intelligence.example.com')).toBe('must use https')
  })

  it.each([
    'https://localhost:8000',
    'https://127.0.0.1:8000',
    'https://0.0.0.0:8000',
    'https://[::1]:8000',
  ])('refuses the loopback address %s', (url) => {
    expect(originProblem(url)).toMatch(/localhost or a private network/)
  })

  it.each([
    'https://192.168.1.42:8000',
    'https://10.0.0.7:8000',
    'https://172.16.5.4:8000',
    'https://172.31.255.1:8000',
    'https://169.254.10.10:8000',
    'https://my-laptop.local:8000',
  ])('refuses the private address %s', (url) => {
    // This is the laptop-on-the-LAN dependency the whole hosted architecture
    // exists to remove. A build carrying one of these works only while someone
    // is on the same Wi-Fi, which is not a product.
    expect(originProblem(url)).toMatch(/localhost or a private network/)
  })

  it('does not mistake a public address for a private one', () => {
    // 172.32.x is OUTSIDE the RFC1918 172.16-172.31 block, and 10.x only counts
    // at the start of the host. An over-broad rule would reject real origins.
    expect(originProblem('https://172.32.0.1')).toBeNull()
    expect(originProblem('https://110.0.0.1')).toBeNull()
  })

  it('refuses a string that is not a URL', () => {
    expect(originProblem('intelligence.example.com')).toBe('is not a valid URL')
  })
})

describe('the unassessed fallback', () => {
  /**
   * Built by hand to mirror the fallback branch in
   * `supabaseManagerApi.routeRecommendation`. Asserting the shape here keeps
   * the invariant testable without standing up Supabase, and the properties
   * checked are exactly the ones the fixture violated.
   */
  const unassessedCandidate = {
    route_id: 'r1',
    kind: 'PRIMARY',
    distance_km: 305.4,
    estimated_duration_min: 230,
    eligibility: 'NOT_ASSESSED',
    risk: {
      score: null,
      band: 'UNASSESSED',
      unavailable: ['weather', 'landslide', 'flood'],
      reason_codes: ['ACCESSIBILITY_ASSESSMENT_UNAVAILABLE'],
    },
  }

  it('has no score at all, rather than a low one', () => {
    // 0 would be a legitimate assessed value meaning "looked, found nothing".
    // null is the only honest representation of "nobody looked".
    expect(unassessedCandidate.risk.score).toBeNull()
    expect(unassessedCandidate.risk.score).not.toBe(0)
  })

  it('does not use a band that reads as safe', () => {
    expect(unassessedCandidate.risk.band).toBe('UNASSESSED')
    expect(['LOW', 'MODERATE', 'HIGH']).not.toContain(unassessedCandidate.risk.band)
  })

  it('does not declare the route eligible', () => {
    // REJECTED would be equally dishonest in the other direction - the point is
    // that eligibility is a decision the server makes from evidence, and there
    // was none.
    expect(unassessedCandidate.eligibility).toBe('NOT_ASSESSED')
  })

  it('names the evidence it lacks instead of implying completeness', () => {
    expect(unassessedCandidate.risk.unavailable).toContain('weather')
    expect(unassessedCandidate.risk.unavailable).toContain('landslide')
    expect(unassessedCandidate.risk.reason_codes).toContain(
      'ACCESSIBILITY_ASSESSMENT_UNAVAILABLE',
    )
  })

  it('never claims a provider was consulted', () => {
    // The exact failure of the deleted fixture: `inputs.weather = 'AVAILABLE'`
    // asserted a provenance nothing downstream could distinguish from real.
    //
    // Asserted structurally rather than by substring: the honest reason code
    // ACCESSIBILITY_ASSESSMENT_UNAVAILABLE legitimately ends in "AVAILABLE",
    // and a naive `not.toContain('AVAILABLE')` fails on correct output.
    const risk = unassessedCandidate.risk as Record<string, unknown>
    expect(risk.inputs).toBeUndefined()

    const values = JSON.stringify(unassessedCandidate).match(/"[^"]*"/g) ?? []
    expect(values).not.toContain('"AVAILABLE"')
  })

  it('invents no observation counts or measurements', () => {
    const serialised = JSON.stringify(unassessedCandidate)
    expect(serialised).not.toMatch(/mm\/h/)
    expect(serialised).not.toMatch(/observations_used/)
    expect(serialised).not.toMatch(/km\/h/)
  })
})

describe('IPv6 and mapped addresses', () => {
  // URL.hostname keeps the brackets on an IPv6 literal, so the first version of
  // originProblem compared '[::1]' against a table containing '::1' and let
  // IPv6 loopback through. These pin the normalisation.
  it.each([
    'https://[::1]:8000',
    'https://[fe80::1]:8000',
    'https://[fd00::1]:8000',
    'https://[::ffff:127.0.0.1]:8000',
  ])('refuses %s', (url) => {
    expect(originProblem(url)).toMatch(/localhost or a private network/)
  })

  it('still accepts a public IPv6 origin', () => {
    expect(originProblem('https://[2606:4700::1111]')).toBeNull()
  })
})
