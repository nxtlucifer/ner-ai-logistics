/**
 * The release Content-Security-Policy allows exactly three inline things, by
 * hash: the theme bootstrap <script> and the font <link onload> handler in
 * index.html, and the print report's <style> (the report is written into an
 * about:blank window, which inherits the console's CSP). Change any of them
 * and its hash changes: update the host's Content-Security-Policy header in
 * the same change, or the browser refuses it (the theme flashes, the fonts
 * stay on the print sheet, the report prints unstyled).
 *
 * Derived and verified in a browser under the enforced policy:
 * .runtime/production/fix1/manager/csp/ (headers.json, csp_browser_run.json).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { reportHtml } from './pages/tripExport'

const sha = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

export const CSP_SCRIPT_HASHES = ["'sha256-1ze4e7nqjWdu4+OP5sDxplZhiBs3zQSpHtH4voUP/8k='"]
export const CSP_HANDLER_HASHES = ["'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='"]
export const CSP_REPORT_STYLE_HASH = "'sha256-R/y7pZVjL46qC0l0q1ZlqCUve89HwF5U0JLLHqdSMI8='"

describe('the inline code the CSP allows by hash', () => {
  const index = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')

  it('index.html: the theme bootstrap script, on one line so CRLF and LF checkouts hash alike', () => {
    const bodies = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(bodies.map(sha)).toEqual(CSP_SCRIPT_HASHES)
    for (const body of bodies) expect(body).not.toMatch(/[\r\n]/)
  })

  it('index.html: the font stylesheet onload handler, and no other handler', () => {
    expect([...index.matchAll(/\son[a-z]+="([^"]*)"/g)].map((m) => sha(m[1]))).toEqual(CSP_HANDLER_HASHES)
  })

  it("the print report's <style>", () => {
    const html = reportHtml([], { title: 't', filters: 'f', generated: 'g' })
    expect(sha(html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')))).toBe(CSP_REPORT_STYLE_HASH)
  })
})
