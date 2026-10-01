/**
 * The credits the app shows are the credits the attribution document
 * records, for exactly the photos the app ships. A photo swapped in
 * assets/redesign, or an author or licence edited in one place only, fails
 * here rather than in front of the photographer.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LICENCE_URL, PHOTOS } from './photoCredits'

const APP = join(__dirname, '..', '..')
const DOC = readFileSync(join(APP, '..', 'docs', 'REDESIGN_IMAGE_ATTRIBUTION.md'), 'utf8')
const ROWS = DOC.split('\n').filter((line) => line.startsWith('| ') && line.includes('commons.wikimedia.org'))

describe('driver photo credits', () => {
  it('cover every file in assets/redesign, and only those', () => {
    const shipped = readdirSync(join(APP, 'assets', 'redesign')).filter((f) => f.endsWith('.webp')).sort()
    expect(Object.values(PHOTOS).map((p) => p.file).sort()).toEqual(shipped)
  })

  it.each(Object.entries(PHOTOS))('%s matches its row in REDESIGN_IMAGE_ATTRIBUTION.md', (_key, photo) => {
    const row = ROWS.find((line) => line.includes(`driver-app/assets/redesign/${photo.file}`))
    expect(row, `${photo.file} has no attribution row`).toBeDefined()
    const cells = row!.split('|').map((c) => c.trim())
    // | Subject | Author | Licence | [page](url) | ...
    expect(cells[2]).toBe(photo.author)
    expect(cells[3]).toBe(photo.licence)
    expect(cells[4]).toContain(`(${photo.page})`)
  })

  it('links every licence to its Creative Commons deed', () => {
    for (const photo of Object.values(PHOTOS)) {
      expect(LICENCE_URL[photo.licence]).toMatch(/^https:\/\/creativecommons\.org\/licenses\/by(-sa)?\/\d\.0\/$/)
    }
  })
})
