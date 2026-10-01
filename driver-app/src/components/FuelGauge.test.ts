/**
 * The dial only produces the marks a real gauge has.
 *
 * The old field accepted any whole number 0-100, so a driver looking at a
 * needle between a half and three-quarters typed 60 and the system stored
 * it as though it had been measured. These assert the two properties that
 * stop that returning: a fixed set of marks, and a needle whose angle is a
 * function of the level rather than of a free-typed number.
 */

import { describe, expect, it } from 'vitest'

import { FUEL_LEVELS, needleAngle } from './fuelLevels'

describe('the marks on the dial', () => {
  it('offers exactly what a truck gauge shows', () => {
    expect(FUEL_LEVELS.map((l) => l.pct)).toEqual([0, 25, 50, 75, 100])
    expect(FUEL_LEVELS.map((l) => l.mark)).toEqual(['E', '¼', '½', '¾', 'F'])
  })

  it('names every mark, so a screen reader is not reading symbols', () => {
    expect(FUEL_LEVELS.every((l) => l.label.length > 2)).toBe(true)
  })
})

describe('the needle', () => {
  it('sweeps a half circle from empty to full', () => {
    expect(needleAngle(0)).toBe(-90)
    expect(needleAngle(50)).toBe(0)
    expect(needleAngle(100)).toBe(90)
  })

  it('places every mark at its own angle', () => {
    const angles = FUEL_LEVELS.map((l) => needleAngle(l.pct))
    expect(new Set(angles).size).toBe(FUEL_LEVELS.length)
    // Monotonic: a fuller tank never points further left.
    expect([...angles].sort((a, b) => a - b)).toEqual(angles)
  })

  it('cannot be swung past the ends by a bad stored value', () => {
    // Older rows hold free-typed percentages, and one of them being 140
    // must not draw a needle pointing into the dashboard.
    expect(needleAngle(140)).toBe(90)
    expect(needleAngle(-20)).toBe(-90)
  })
})
