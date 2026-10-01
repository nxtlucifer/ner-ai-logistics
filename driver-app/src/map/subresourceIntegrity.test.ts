/**
 * SEC-008: the driver's map WebView loaded Leaflet from a CDN with nothing
 * checking what came back.
 *
 * A version pin is not integrity. `leaflet@1.9.4` asks unpkg for a name and
 * trusts it to answer honestly; a compromised or substituted response would
 * then run inside the WebView that draws the route a driver is following.
 *
 * The digests below were computed from the bytes actually served on
 * 20 September 2026:
 *
 *   leaflet.js   147,552 bytes  sha384-cxOPjt7s…
 *   leaflet.css   14,806 bytes  sha384-sHL9NAb7…
 *
 * This test exists because SRI fails silently in the other direction too:
 * bump the version and forget the hash, and the browser refuses the script,
 * and the map simply stops working for every driver. So it checks that a
 * pinned version always travels with a pinned digest.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(__dirname, 'DriverRouteMap.native.tsx'), 'utf8')

/** Every external stylesheet or script the WebView document loads. */
const EXTERNAL = [...SOURCE.matchAll(/<(link|script)\b[^>]*?(?:href|src)="(https:\/\/[^"]+)"[^>]*>/g)]

describe('the map WebView', () => {
  it('loads something external at all, or this test is vacuous', () => {
    expect(EXTERNAL.length).toBeGreaterThan(0)
  })

  it('pins an integrity digest on every external asset', () => {
    const naked = EXTERNAL.filter(([tag]) => !/\bintegrity="sha(256|384|512)-/.test(tag)).map(
      ([, , url]) => url,
    )
    expect(naked, 'add integrity="sha384-…" crossorigin="anonymous"').toEqual([])
  })

  it('sets crossorigin, without which the digest is not enforced', () => {
    // A browser silently ignores `integrity` on a request it made without
    // CORS — the attribute is present, the check never runs, and the whole
    // mitigation is decoration.
    const missing = EXTERNAL.filter(([tag]) => !/\bcrossorigin=/.test(tag)).map(([, , u]) => u)
    expect(missing).toEqual([])
  })

  it('pins an exact version, so the digest can be stable', () => {
    for (const [, , url] of EXTERNAL) {
      expect(url, `${url} has no exact version`).toMatch(/@\d+\.\d+\.\d+\//)
    }
  })

  it('still degrades to a reported failure if the script is refused', () => {
    // SRI turning a tampered CDN into a blank screen would trade one
    // problem for another. The existing guard reports it instead.
    expect(SOURCE).toContain("if(!window.L)")
    expect(SOURCE).toContain("tileerror")
  })
})
