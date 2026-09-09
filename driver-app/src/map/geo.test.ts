/**
 * The lon/lat inversion, and the states a map has to survive.
 *
 * The real coordinates here are the ends of the demo corridor as PostGIS
 * actually holds it: `POINT(91.736153 26.144276)` outside Guwahati to
 * `POINT(94.203682 26.75091)` outside Jorhat. WKT prints lon-lat; the API
 * hands the app lat-lon. Using the genuine pair means a test that passes here
 * is a test of the corridor the driver is actually sent down.
 */

import { describe, expect, it } from 'vitest'

import {
  boundsOf,
  distanceMetres,
  isValidLatLon,
  lngLatOf,
  padBounds,
  toLngLat,
  validGeometry,
  type LatLon,
} from './geo'

/** Guwahati end of TRP-MTO9WQ6E, as the API sends it: [lat, lon]. */
const GUWAHATI: LatLon = [26.144276, 91.736153]
/** Jorhat end, same order. */
const JORHAT: LatLon = [26.75091, 94.203682]

describe('isValidLatLon', () => {
  it('accepts a real NER position', () => {
    expect(isValidLatLon(GUWAHATI)).toBe(true)
  })

  it('REJECTS the same position with lat and lon swapped', () => {
    // 91.736 is not a latitude. This is the whole point of the range check:
    // for this deployment an inversion is caught rather than drawn.
    expect(isValidLatLon([91.736153, 26.144276])).toBe(false)
  })

  it('rejects NaN, null, short arrays and non-numbers', () => {
    expect(isValidLatLon([NaN, 91.7])).toBe(false)
    expect(isValidLatLon([26.1, Infinity])).toBe(false)
    expect(isValidLatLon(null)).toBe(false)
    expect(isValidLatLon([26.1])).toBe(false)
    expect(isValidLatLon(['26.1', '91.7'])).toBe(false)
    expect(isValidLatLon({ lat: 26.1, lon: 91.7 })).toBe(false)
  })
})

describe('validGeometry', () => {
  it('drops bad vertices instead of blanking a usable route', () => {
    const mixed = [GUWAHATI, [999, 0], JORHAT, [NaN, NaN]]
    expect(validGeometry(mixed)).toEqual([GUWAHATI, JORHAT])
  })

  it('returns empty for null, undefined and an all-bad route', () => {
    // The caller renders "geometry unusable" from this, which is a different
    // screen from "still loading" - an empty basemap must never stand in for
    // either.
    expect(validGeometry(null)).toEqual([])
    expect(validGeometry(undefined)).toEqual([])
    expect(validGeometry([])).toEqual([])
    expect(validGeometry([[999, 999]])).toEqual([])
  })
})

describe('toLngLat', () => {
  it('swaps for MapLibre and GeoJSON', () => {
    expect(toLngLat([GUWAHATI, JORHAT])).toEqual([
      [91.736153, 26.144276],
      [94.203682, 26.75091],
    ])
  })

  it('round-trips back to the original order', () => {
    const there = toLngLat([GUWAHATI])
    const back = there.map(([lon, lat]) => [lat, lon] as LatLon)
    expect(back).toEqual([GUWAHATI])
  })

  it('lngLatOf matches toLngLat for a single point', () => {
    expect(lngLatOf(GUWAHATI)).toEqual(toLngLat([GUWAHATI])[0])
  })
})

describe('boundsOf', () => {
  it('boxes the corridor', () => {
    expect(boundsOf([GUWAHATI, JORHAT])).toEqual({
      minLat: 26.144276,
      maxLat: 26.75091,
      minLon: 91.736153,
      maxLon: 94.203682,
    })
  })

  it('is null with nothing to box', () => {
    expect(boundsOf([])).toBeNull()
  })
})

describe('padBounds', () => {
  it('gives a single point a real extent rather than a zero-size box', () => {
    // A zero-span box is what makes "fit to route" zoom to maximum or divide
    // by zero, so a one-stop trip must still frame sensibly.
    const padded = padBounds(boundsOf([GUWAHATI])!)
    expect(padded.maxLat - padded.minLat).toBeGreaterThan(0.01)
    expect(padded.maxLon - padded.minLon).toBeGreaterThan(0.01)
  })

  it('keeps the route inside the frame it returns', () => {
    const padded = padBounds(boundsOf([GUWAHATI, JORHAT])!)
    expect(padded.minLat).toBeLessThan(GUWAHATI[0])
    expect(padded.maxLat).toBeGreaterThan(JORHAT[0])
    expect(padded.minLon).toBeLessThan(GUWAHATI[1])
    expect(padded.maxLon).toBeGreaterThan(JORHAT[1])
  })
})

describe('distanceMetres', () => {
  it('measures the corridor ends within a few percent of the road distance', () => {
    // Straight-line, so it must come out well UNDER the 305.39 km the routing
    // provider gave for the road. About 247 km great-circle.
    const straight = distanceMetres(GUWAHATI, JORHAT)
    expect(straight).toBeGreaterThan(240_000)
    expect(straight).toBeLessThan(260_000)
    expect(straight).toBeLessThan(305_390)
  })

  it('is zero for a point against itself, and symmetric', () => {
    expect(distanceMetres(GUWAHATI, GUWAHATI)).toBe(0)
    expect(distanceMetres(GUWAHATI, JORHAT)).toBeCloseTo(
      distanceMetres(JORHAT, GUWAHATI),
      6,
    )
  })
})
