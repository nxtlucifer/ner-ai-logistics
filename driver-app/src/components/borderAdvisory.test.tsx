// @vitest-environment jsdom
/**
 * The driver's wording for the geography codes (backend contract, 29 Sep
 * 2026) and the border-advisory banner. Owner decision 2: border status is
 * server data, UNKNOWN never reads as clear, and nothing here names a country.
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true }))

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = (p: { children?: ReactNode; accessibilityRole?: string }) => h('div', { 'data-role': p.accessibilityRole }, p.children)
  return { View: box, Text: box, StyleSheet: { create: (v: unknown) => v }, Platform: { OS: 'web' }, useColorScheme: () => 'light' }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }))
vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number
    code: string
    constructor(status: number, body: { error?: { code?: string; message?: string } } | null, fallback: string) {
      super(body?.error?.message ?? fallback)
      this.status = status
      this.code = body?.error?.code ?? 'UNKNOWN'
    }
  }
  class NetworkError extends Error {}
  return { ApiError, NetworkError }
})

import { ApiError } from '../api/client'
import { ThemeProvider } from '../theme-context'
import { BorderAdvisoryBanner, borderAdvisoryCopy } from './borderAdvisory'
import { CODE_MESSAGES, errorMessage } from './ui'

const apiError = (status: number, code: string, message = 'server words') =>
  new ApiError(status, { error: { code, message } } as never, 'fallback')

describe('errorMessage: geography and hold codes', () => {
  it('maps each code by code, not by status, to calm driver wording', () => {
    expect(errorMessage(apiError(422, 'OUTSIDE_SUPPORTED_COUNTRY'))).toEqual({
      title: 'Outside the supported country',
      detail: 'This location is outside the currently supported country.',
    })
    expect(errorMessage(apiError(422, 'BORDER_AMBIGUOUS')).title).toBe('Location not confirmed yet')
    expect(errorMessage(apiError(503, 'GEOGRAPHY_UNAVAILABLE')).title).toBe('Location check unavailable')
    expect(errorMessage(apiError(409, 'HOLD_AND_REVIEW')).title).toBe('Route on hold')
  })

  it('is calm: no alarm words, and no country is named', () => {
    const words = Object.values(CODE_MESSAGES).map((m) => `${m.title} ${m.detail}`).join(' ')
    expect(words).not.toMatch(/danger|illegal|hostile|forbidden|emergency|!/i)
    expect(words).not.toMatch(/India|Bangladesh|Myanmar|Bhutan|Nepal|China/)
  })

  it('leaves every other code to the status rules, unchanged', () => {
    expect(errorMessage(apiError(422, 'VALIDATION_ERROR', 'bad field'))).toEqual({ title: 'Check your entries', detail: 'bad field' })
    expect(errorMessage(apiError(503, 'SOMETHING_ELSE', 'down'))).toEqual({ title: 'Server problem', detail: 'down' })
  })
})

describe('borderAdvisoryCopy', () => {
  it('says nothing when the server sent nothing, or NORMAL', () => {
    expect(borderAdvisoryCopy(undefined)).toBeNull()
    expect(borderAdvisoryCopy(null)).toBeNull()
    expect(borderAdvisoryCopy({ status: 'NORMAL', message: 'ignored' })).toBeNull()
  })

  it('uses the server message and source for ADVISORY and RESTRICTED, with a fallback', () => {
    expect(borderAdvisoryCopy({ status: 'ADVISORY', message: ' Checkpost queue at km 12 ', source: 'District order 4/2026' })).toEqual({
      title: 'Border advisory', detail: 'Checkpost queue at km 12', source: 'District order 4/2026',
    })
    expect(borderAdvisoryCopy({ status: 'RESTRICTED' })).toEqual({
      title: 'Border restriction',
      detail: 'Official border restrictions apply on this road. Follow dispatch instructions.',
      source: null,
    })
  })

  it('never turns UNKNOWN (or an unrecognised status) into clear, whatever the message says', () => {
    for (const status of ['UNKNOWN', 'SOMETHING_NEW']) {
      const copy = borderAdvisoryCopy({ status, message: 'All clear' })!
      expect(copy.title).toBe('Border status not confirmed')
      expect(copy.detail).toBe('There is no current official border status for this road. This does not mean it is clear.')
    }
  })
})

describe('BorderAdvisoryBanner', () => {
  let root: Root
  let host: HTMLDivElement
  beforeEach(() => {
    host = document.createElement('div')
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
  })
  const render = (node: ReactNode) => act(async () => root.render(createElement(ThemeProvider, null, node)))

  it('renders nothing without server data', async () => {
    await render(createElement(BorderAdvisoryBanner, { advisory: undefined }))
    expect(host.textContent).toBe('')
  })

  it('renders the server words and the source as one calm banner', async () => {
    await render(createElement(BorderAdvisoryBanner, { advisory: { status: 'ADVISORY', message: 'Checkpost queue', source: 'District order' } }))
    expect(host.querySelectorAll('[data-role="alert"]')).toHaveLength(1)
    expect(host.textContent).toBe('Border advisoryCheckpost queue · Source: District order')
  })
})
