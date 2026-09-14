import { describe, expect, it } from 'vitest'

import { SpeedFilter, settledPosition, type SpeedSample } from './speed'

const LAT = 24.03, LON = 73.05
const M_LAT = 1 / 111_320 // degrees per metre

/** Fixes every `everyS` seconds moving north at `ms` m/s, with `jitterM` of deterministic wander. */
function stream(n: number, o: { ms?: number | null; accuracyM?: number | null; jitterM?: number; everyS?: number; platform?: number | null }): SpeedSample[] {
  const { ms = 0, accuracyM = 15, jitterM = 0, everyS = 5 } = o
  const platform = 'platform' in o ? o.platform : ms
  return Array.from({ length: n }, (_, i) => {
    const wander = jitterM * Math.sin(i * 2.4) // bounded, sign-changing, never accumulates
    return {
      lat: LAT + ((ms ?? 0) * everyS * i + wander) * M_LAT,
      lon: LON + jitterM * Math.cos(i * 1.7) * M_LAT,
      accuracyM,
      speedMs: platform === undefined ? null : platform,
      at: 1_000_000 + i * everyS * 1000,
    }
  })
}
const run = (fixes: SpeedSample[], f = new SpeedFilter()) => fixes.map((s) => f.next(s))

describe('stationary', () => {
  it('indoor noisy GPS: 0.3 m/s Doppler noise and 8 m wander read 0, never 1', () => {
    const out = run(stream(40, { platform: 0.3, jitterM: 8, accuracyM: 15 }))
    expect(new Set(out)).toEqual(new Set([0]))
  })
  it('outdoor ±5 m and network ±50 m both read 0', () => {
    expect(new Set(run(stream(30, { accuracyM: 5, jitterM: 3, platform: 0.1 })))).toEqual(new Set([0]))
    expect(new Set(run(stream(30, { accuracyM: 50, jitterM: 25, platform: 0.6 })))).toEqual(new Set([0]))
  })
  it('a single 40 m wander with ±15 m accuracy is one fix of evidence, not motion', () => {
    const fixes = stream(10, { accuracyM: 15 })
    fixes[5] = { ...fixes[5], lat: LAT + 40 * M_LAT }
    expect(run(fixes)).toEqual(Array(10).fill(0))
  })
  it('network→GPS transition (50 m jump, accuracy 50→15) stays 0', () => {
    const fixes = [...stream(4, { accuracyM: 50 }), ...stream(6, { accuracyM: 15 }).map((s, i) => ({ ...s, lat: LAT + 45 * M_LAT, at: s.at + 20_000 * (i + 1) }))]
    expect(run(fixes)).toEqual(Array(10).fill(0))
  })
})

describe('moving', () => {
  it('walking at 1.4 m/s reads ~5 km/h after two fixes of evidence', () => {
    const out = run(stream(8, { ms: 1.4, accuracyM: 10 }))
    expect(out).toEqual([0, 5, 5, 5, 5, 5, 5, 5])
  })
  it('a slow truck at 8 km/h with NO platform speed is still moving (derived from displacement)', () => {
    const out = run(stream(12, { ms: 2.2, platform: null, accuracyM: 10 }))
    expect(out.slice(-4).every((v) => v === 8)).toBe(true)
  })
  it('normal driving reads the platform speed, and a stop reads 0 at once - never 1 from 0.2 m/s of noise', () => {
    const f = new SpeedFilter()
    const drive = run(stream(6, { ms: 14, accuracyM: 8 }), f)
    expect(drive.at(-1)).toBe(50)
    const last = stream(6, { ms: 14, accuracyM: 8 }).at(-1)!
    const parked = Array.from({ length: 5 }, (_, i) => ({ ...last, speedMs: 0.2, at: last.at + (i + 1) * 5000 }))
    expect(run(parked, f)).toEqual([0, 0, 0, 0, 0])
    expect(f.moving).toBe(false)
  })
})

describe('untrustworthy', () => {
  it('bad or missing accuracy is "--" and changes nothing', () => {
    const f = new SpeedFilter()
    expect(f.next({ lat: LAT, lon: LON, accuracyM: 400, speedMs: 20, at: 1 })).toBeNull()
    expect(f.next({ lat: LAT, lon: LON, accuracyM: null, speedMs: 20, at: 2 })).toBeNull()
    expect(f.moving).toBe(false)
  })
  it('a teleport (500 m in 5 s) is "--" for that fix', () => {
    const fixes = stream(4, { accuracyM: 10 })
    fixes[3] = { ...fixes[3], lat: LAT + 500 * M_LAT }
    expect(run(fixes)).toEqual([0, 0, 0, null])
  })
  it('negative and NaN platform speeds are treated as no reading', () => {
    expect(new Set(run(stream(10, { platform: -1, jitterM: 4 })))).toEqual(new Set([0]))
    expect(new Set(run(stream(10, { platform: NaN, jitterM: 4 })))).toEqual(new Set([0]))
  })
})

describe('settledPosition', () => {
  it('holds the pin while stationary, follows while moving, and reuses the array when nothing changed', () => {
    const rest = settledPosition(null, { lat: 26.1, lon: 91.7, speedKmh: 0 })
    expect(rest).toEqual([26.1, 91.7])
    // Stationary wander of a few metres: the same pin, the same object.
    expect(settledPosition(rest, { lat: 26.10003, lon: 91.70002, speedKmh: 0 })).toBe(rest)
    // Identical coordinates while moving: still the same object.
    expect(settledPosition(rest, { lat: 26.1, lon: 91.7, speedKmh: 40 })).toBe(rest)
    // Real movement: a new pin.
    expect(settledPosition(rest, { lat: 26.2, lon: 91.8, speedKmh: 40 })).toEqual([26.2, 91.8])
    // A speed the filter could not judge (null) follows the fix rather than freezing it.
    expect(settledPosition(rest, { lat: 26.3, lon: 91.9, speedKmh: null })).toEqual([26.3, 91.9])
    expect(settledPosition(rest, null)).toBeNull()
  })
})
