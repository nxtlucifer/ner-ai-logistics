/**
 * The navigation canvas contract, as source assertions.
 *
 * MapScreen cannot be mounted in this suite - it pulls MapLibre/Leaflet, the
 * location stack and a live trip context, none of which exist under jsdom
 * here. What these tests protect is the specific pair of regressions that put
 * a blank panel and an invented ETA on the driver's navigation screen, and
 * both are visible in the source:
 *
 *   1. a `selectedRouteId === null` early return that unmounted the map
 *   2. a duration computed from a hard-coded 55 km/h
 *
 * Asserting on the source is unusual and deliberate. A snapshot would not have
 * caught either one, and a mounted-component test for this screen is a
 * multi-day harness. If someone reintroduces either pattern, this fails.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAW = readFileSync(join(__dirname, 'MapScreen.tsx'), 'utf8')

/**
 * Comments stripped before asserting. The comments explaining these very
 * regressions quote the removed strings verbatim, which would fail the checks
 * that the strings are gone - the note about a bug is not the bug.
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('navigation canvas', () => {
  it('never swaps the map out just because no route is selected', () => {
    // The placeholder that used to fire on a null route.
    expect(SRC).not.toContain('title="Waiting for a route"')
    // The early return itself: a `selectedRouteId === null` branch that
    // returns a MapPlaceholder rather than falling through to the map.
    const earlyReturn =
      /if \(selectedRouteId === null\) \{\s*return \(\s*<MapPlaceholder/
    expect(SRC).not.toMatch(earlyReturn)
  })

  it('mounts the basemap for the empty-geometry case', () => {
    // The branch that renders with points={[]} is what a routeless trip now
    // falls through to, so the map shell stays mounted.
    expect(SRC).toContain('points={[]}')
    expect(SRC).toContain('<DriverRouteMap')
  })

  it('does not fabricate a duration from an assumed speed', () => {
    // The exact shape of the old lie: distance / 55, scaled by 1.09.
    expect(SRC).not.toContain('distanceKm / 55')
    expect(SRC).not.toContain('* 1.09')
    // Duration must come from the server's own figure.
    expect(SRC).toContain('remaining_at_planned_pace_min')
  })

  it('does not invent an instruction when no maneuver is available', () => {
    for (const invented of [
      'Follow planned corridor',
      'Guidance active',
      "'Route Loaded'",
    ]) {
      expect(SRC).not.toContain(invented)
    }
    expect(SRC).toContain('Guidance unavailable')
  })

  it('keeps the AI card and ETA bar in flow so they cannot cover the tab bar', () => {
    // The old sheet was `position:'absolute'; bottom:0`, which sat on top of
    // the app's bottom navigation. Both bottom surfaces must stay flex siblings.
    for (const key of ['aiCard: {', 'etaBar: {']) {
      expect(SRC.indexOf(key)).toBeGreaterThan(-1)
      const block = SRC.slice(SRC.indexOf(key))
      const body = block.slice(0, block.indexOf('},'))
      expect(body).not.toContain("position: 'absolute'")
      expect(body).not.toContain('bottom: 0')
    }
  })

  it('gives the map area a flex box of its own', () => {
    expect(SRC).toContain('mapArea:')
    expect(SRC).toContain('<View style={styles.mapArea}>')
  })
})
