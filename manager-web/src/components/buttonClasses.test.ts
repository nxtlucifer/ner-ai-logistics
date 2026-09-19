/**
 * No component may paint itself with a class nobody defined.
 *
 * THE DEFECT THIS CATCHES
 *
 * Two separate instances of one bug, found by looking at the rendered page
 * rather than by any test:
 *
 *   `className="btn-secondary"`  - three call sites, no such class anywhere.
 *       Two were the Overview's primary actions. The third was the "Call
 *       driver" link on an URGENT emergency notification, which is the one
 *       control on that screen that must never be missed.
 *
 *   `text-faint`                 - two call sites, no `--color-faint` token,
 *       so the explanatory line under each number rendered at the inherited
 *       colour instead of the quiet one.
 *
 * Neither failed anything. An undefined class is silently valid HTML, and
 * Tailwind emits no utility for a token that was never declared, so there is
 * no build error either. The only signal is the pixels.
 *
 * So the guard is: every colour-ish utility a component writes must resolve
 * to a declared `--color-*` token, or be a Tailwind built-in this project
 * has deliberately allowed. A new unknown word fails here, loudly.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8')

/** Every `--color-<name>` the stylesheet declares. */
const DECLARED = new Set(
  [...CSS.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
)

/**
 * Tailwind built-ins and bare modifiers this console legitimately uses after
 * a `text-`/`bg-`/`border-`/`ring-` prefix. Adding a word here should be a
 * deliberate act, which is the point: the list is the review surface.
 */
const BUILT_IN = new Set([
  // colours
  'white', 'black', 'transparent', 'current', 'inherit',
  // type scale and weight, which share the `text-` prefix
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl',
  'left', 'right', 'center', 'justify', 'start', 'end', 'wrap', 'nowrap',
  'balance', 'pretty', 'ellipsis', 'clip',
  // border/ring shorthands
  't', 'r', 'b', 'l', 'x', 'y', 'none', 'solid', 'dashed', 'dotted',
  'collapse', 'separate', 'inset', 'offset',
  // background keywords
  'cover', 'contain', 'fixed', 'local', 'scroll', 'repeat', 'no-repeat',
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

/** `text-danger`, `bg-primary-soft`, `border-line`, `ring-route` … */
const UTILITY = /\b(?:text|bg|border|ring|fill|stroke|decoration|outline)-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g

/** CSS property names that appear inside MapLibre style objects, not classes. */
const CSS_PROPERTY = new Set([
  'radius', 'width', 'color', 'offset', 'opacity', 'style',
  // the export writes a real stylesheet into its HTML
  'align', 'transform', 'decoration', 'spacing', 'shadow', 'image', 'size',
])

function looksLikeAToken(word: string): boolean {
  // Arbitrary values and numeric scales are Tailwind's, not ours:
  //   text-[11px]   border-2   outline-offset-2
  if (/^\d/.test(word) || word.includes('[') || /-\d+$/.test(word)) return false
  // Directional and axis modifiers: border-t-2, border-l-4, border-t-transparent.
  if (/^[trblxyse]-/.test(word)) return false
  // `stroke-width`, `border-radius` and friends, read out of a style object.
  if (CSS_PROPERTY.has(word)) return false
  return !BUILT_IN.has(word)
}

describe('colour utilities', () => {
  it('resolve to a token the stylesheet actually declares', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(UTILITY)) {
          const word = match[1]
          if (!looksLikeAToken(word)) continue
          // `bg-primary-soft` may resolve as itself or as the base token
          // with a Tailwind modifier appended; accept either.
          const base = word.split('/')[0]
          if (DECLARED.has(base)) continue
          if (DECLARED.has(base.replace(/-(hover|soft|strong|line|surface)$/, ''))) continue
          offenders.push(
            `${file.slice(SRC.length + 1)}:${index + 1}  ${match[0]}`,
          )
        }
      })
    }
    expect(
      offenders,
      'declare the token in index.css @theme, or use an existing one',
    ).toEqual([])
  })

  it('never names a btn-* class, because none is defined', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (/\bbtn-(primary|secondary|danger|ghost)\b/.test(line)) {
            offenders.push(`${file.slice(SRC.length + 1)}:${index + 1}`)
          }
        })
    }
    expect(offenders, 'use <Button> or LINK_BUTTON instead').toEqual([])
  })
})
