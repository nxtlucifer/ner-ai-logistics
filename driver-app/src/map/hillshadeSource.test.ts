/**
 * Relief shading must not vanish because a credential is missing.
 *
 * THE DEFECT THIS FIXES
 *
 * `HILLSHADE_URL` was `null` without `EXPO_PUBLIC_MAPTILER_KEY`, so a build
 * made without the key simply had no terrain — no toggle, no message, no
 * way to tell the feature apart from a broken one. A capability that
 * silently disappears with an unset environment variable is worse than one
 * that is absent by design, because nobody can tell which they are looking
 * at.
 *
 * OpenTopoMap is the keyless fallback. Verified 20 September 2026:
 * CC-BY-SA 3.0, no key, embedding in applications permitted with
 * attribution, and tiles served for z8/z9/z10 over 26°N 92°E.
 *
 * Neither source produces a route decision. The gradients the policy reads
 * come from the backend's DEM; this is ground the driver can see.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { HILLSHADE_ATTRIBUTION, HILLSHADE_SOURCE, HILLSHADE_URL } from './scene'

const SCENE = readFileSync(join(__dirname, 'scene.ts'), 'utf8')

describe('the relief source', () => {
  it('always resolves to a usable tile URL', () => {
    // The property that matters: never null, whatever the environment.
    expect(typeof HILLSHADE_URL).toBe('string')
    expect(HILLSHADE_URL).toMatch(/^https:\/\//)
    expect(HILLSHADE_URL).toMatch(/\{z\}.*\{x\}.*\{y\}/)
  })

  it('names which source is in use', () => {
    expect(['maptiler', 'opentopomap']).toContain(HILLSHADE_SOURCE)
  })

  it('attributes whichever source it chose', () => {
    if (HILLSHADE_SOURCE === 'maptiler') {
      expect(HILLSHADE_ATTRIBUTION).toMatch(/MapTiler/)
    } else {
      // CC-BY-SA makes attribution a licence condition, not a courtesy.
      expect(HILLSHADE_ATTRIBUTION).toMatch(/OpenTopoMap/)
      expect(HILLSHADE_ATTRIBUTION).toMatch(/CC-BY-SA/)
    }
  })

  it('never puts a key in the fallback URL', () => {
    if (HILLSHADE_SOURCE === 'opentopomap') {
      expect(HILLSHADE_URL).not.toMatch(/key=/)
    }
  })

  it('declares both branches in source, so neither can be dropped silently', () => {
    expect(SCENE).toMatch(/api\.maptiler\.com/)
    expect(SCENE).toMatch(/opentopomap\.org/)
  })

  it('keeps the risk engine off these tiles', () => {
    // A hillshade is a picture. The elevation the deterministic policy
    // reads comes from the backend, and this comment-plus-test is what
    // stops someone wiring a tile server into a safety decision.
    expect(SCENE).toMatch(/Copernicus\/SRTM through the backend/)
  })
})
