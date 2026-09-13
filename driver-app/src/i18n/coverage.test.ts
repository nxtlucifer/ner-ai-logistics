/**
 * Every English phrase the app hands to `t()` / `tx()` (and every literal
 * `label=` / `title=` / `detail=` / `placeholder=` a localised primitive
 * renders) must have all four translations in phrases.ts. English fallback is
 * a visible state, so a missing entry fails here rather than on a judge's
 * phone in Hindi. Typed catalogue keys (appLanguage.ts) are checked by their
 * own test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PHRASES } from './phrases'

const ROOT = join(__dirname, '..', '..')
const SQ = String.raw`'((?:[^'\\]|\\.)*)'`
const FILES: string[] = []
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/i18n[\\/]/.test(p)) FILES.push(p)
  }
}
walk(join(ROOT, 'src'))
FILES.push(join(ROOT, 'App.tsx'))

function phrasesUsed(): Set<string> {
  const keys = new Set<string>()
  const add = (k: string) => keys.add(k.replace(/\\'/g, "'"))
  for (const f of FILES) {
    const s = readFileSync(f, 'utf-8')
    for (const m of s.matchAll(new RegExp(String.raw`\b(?:t|tx|tr)\(\s*` + SQ + String.raw`\s*[\),]`, 'g'))) add(m[1])
    for (const m of s.matchAll(new RegExp(String.raw`\b(?:t|tx|tr)\(\s*[^()]*?\?\s*` + SQ + String.raw`\s*:\s*` + SQ, 'g'))) { add(m[1]); add(m[2]) }
    for (const m of s.matchAll(/\b(?:label|title|detail|hint|placeholder|heading|summary|empty|addLabel)="([^"]{2,})"/g)) add(m[1])
    for (const m of s.matchAll(new RegExp(String.raw`(?:headline|label|title|detail):\s*` + SQ, 'g'))) add(m[1])
  }
  return keys
}

describe('phrase coverage', () => {
  it('has hi/gu/as/bn for every phrase the screens use', () => {
    const missing = [...phrasesUsed()]
      .filter((k) => /[A-Za-z]{2}/.test(k) && !/^[A-Z0-9_ ]+$/.test(k) && !/^[a-z_]+$/.test(k) && !k.startsWith('/'))
      .filter((k) => !['Gemini', 'OpenRouter', 'RASTA AI', 'NER LOGISTICS', 'GPS', 'SOS'].includes(k))
      .filter((k) => !PHRASES[k] || (['hi', 'gu', 'as', 'bn'] as const).some((l) => !PHRASES[k][l]))
    expect(missing, `untranslated: ${missing.join(' | ')}`).toEqual([])
  })
})
