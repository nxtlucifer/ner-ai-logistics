import { describe, expect, it } from 'vitest'
import { routeCameraKey, splitRoute, regionBounds } from './routeDisplay'

describe('assigned corridor display', () => {
  it('distinguishes a replacement corridor with identical ends and point count', () => {
    expect(routeCameraKey('same-id', [[26, 91], [26.5, 92], [27, 93]]))
      .not.toBe(routeCameraKey('same-id', [[26, 91], [26.6, 91.5], [27, 93]]))
    expect(routeCameraKey('same-id', [[26, 91], [27, 93]]))
      .toBe(routeCameraKey('same-id', [[26, 91], [27, 93]]))
  })
  it('uses the visible native viewport, including all four edges', () => {
    expect(regionBounds({ latitude: 26, longitude: 92, latitudeDelta: 2, longitudeDelta: 4 }))
      .toEqual({ south: 25, north: 27, west: 90, east: 94 })
  })
  it('joins completed and remaining segments on the assigned road without a gap', () => {
    const points = [[26, 91], [26, 92], [26, 93]] as const
    const { completed, remaining } = splitRoute(points, 0.25)
    expect(completed[0]).toEqual(points[0])
    expect(completed.at(-1)).toEqual([26, 91.5])
    expect(remaining[0]).toEqual(completed.at(-1))
    expect(remaining.at(-1)).toEqual(points.at(-1))
  })
  it.each([null, undefined, NaN, -0.1, 1.1])('keeps an honest preview for unusable progress %s', (fraction) => {
    const points = [[26, 91], [27, 92]] as const
    expect(splitRoute(points, fraction)).toEqual({ completed: [], remaining: points })
  })
})
