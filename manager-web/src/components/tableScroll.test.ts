/**
 * Every table can be scrolled to its last column.
 *
 * THE DEFECT THIS CLOSES
 *
 * Six tables — Managers, both Overview tables, both Reports tables and
 * States — were rendered without a horizontal scroll container. At 320px
 * the Managers page pushed the document 258px wider than the viewport:
 * the whole console scrolled sideways, the sidebar slid away with it, and
 * the columns past the fold were unreachable because the page, not the
 * table, was what moved. The other five did the same thing more quietly.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST
 *
 * Rendering each page needs its auth context, its resources and jsdom
 * layout that reports every width as zero — so a render test would pass
 * while the real page overflowed. The rule is structural: a `<table>`
 * belongs inside something that can scroll. That is checkable by reading
 * the file, and it holds for a table added tomorrow on a page that does
 * not exist yet.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sources(full)
    return entry.endsWith('.tsx') && !entry.includes('.test.') ? [full] : []
  })
}

/** Ancestry by indentation.
 *
 *  Looking only at the immediately preceding line was wrong: Trips opens
 *  its scroll container nine lines above the table, with an error banner
 *  in between, and the check called a correctly wrapped table a defect.
 *  JSX in this codebase is indented consistently, so the enclosing
 *  elements are the nearest preceding lines with strictly less
 *  indentation — walk up three of those and see if any of them scrolls. */
function unwrappedTables(source: string): number[] {
  const lines = source.split(String.fromCharCode(10))
  const indentOf = (line: string) => line.length - line.trimStart().length
  const bad: number[] = []

  lines.forEach((line, index) => {
    if (!line.includes('<table')) return
    let depth = indentOf(line)
    let ancestorsChecked = 0
    for (let i = index - 1; i >= 0 && ancestorsChecked < 3; i--) {
      const candidate = lines[i]
      if (!candidate.trim()) continue
      if (indentOf(candidate) >= depth) continue
      ancestorsChecked += 1
      depth = indentOf(candidate)
      if (/overflow-x-auto|overflow-auto|overflow-x-scroll/.test(candidate)) return
    }
    bad.push(index + 1)
  })
  return bad
}

describe('every table sits in a horizontal scroll container', () => {
  const files = sources(ROOT).filter((f) => readFileSync(f, 'utf8').includes('<table'))

  it('finds the tables at all (so a rename cannot make this vacuous)', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))('%s', (_name, file) => {
    const offending = unwrappedTables(readFileSync(file, 'utf8'))
    expect(
      offending,
      `table(s) at line ${offending.join(', ')} have no scrollable parent — ` +
        'wrap them in <div className="overflow-x-auto"> or the page itself ' +
        'scrolls sideways on a phone',
    ).toEqual([])
  })
})
