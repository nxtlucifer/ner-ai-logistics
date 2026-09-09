// @vitest-environment jsdom
/**
 * The provenance label on an AI answer.
 *
 * This exists because the label used to be unconditional. Every answer said
 * "Written by AI - check anything important", including the deterministic
 * offline assistant, which is bundled text a person reviewed. That is wrong in
 * both directions at once: it claims the assistant is online when it is not,
 * and it tells a driver to distrust the single answer on the screen that was
 * actually vetted.
 *
 * It was not a rare path either. When a provider's free-tier quota is spent,
 * every answer comes back `generated: false`, so the false label was on 100%
 * of what the driver saw.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
})

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children, style: _style, testID, ...rest }: any) =>
    h('div', { 'data-testid': testID, ...rest }, children)
  const pressable = ({ children, style: _style, onPress, testID, ...rest }: any) =>
    h('button', { onClick: onPress, 'data-testid': testID, ...rest }, children)
  const input = ({ onChangeText, style: _style, testID, ...rest }: any) =>
    h('input', {
      onChange: (e: any) => onChangeText?.(e.target.value),
      'data-testid': testID,
      ...rest,
    })
  return {
    View: box,
    ScrollView: box,
    Pressable: pressable,
    Text: box,
    TextInput: input,
    ActivityIndicator: () => h('span', null, 'Loading...'),
    StyleSheet: { create: (o: any) => o, absoluteFill: {} },
    Platform: { OS: 'web', select: (o: any) => o.web ?? o.default },
  }
})

import AiPanel from './AiPanel'
import type { AiMode, LocalAi } from './useLocalAi'
import type { AiAnswer } from '../api/client'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function answer(overrides: Partial<AiAnswer>): AiAnswer {
  return {
    answer: 'Keep to the left lane on the descent.',
    generated: true,
    model: null,
    facts_as_of: null,
    ...overrides,
  }
}

function panelWith(a: AiAnswer) {
  const ai: LocalAi = {
    status: { available: true, model: null, detail: null, languages: {} },
    state: { kind: 'ANSWER', answer: a, question: 'q' },
    ask: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
  } as unknown as LocalAi

  return act(() =>
    root.render(
      createElement(AiPanel, {
        ai,
        mode: 'assistant' as AiMode,
        lead: 'Ask about the road ahead',
        placeholder: 'Ask a question',
        fallbackName: 'safety guide below',
      }),
    ),
  )
}

describe('AI answer provenance', () => {
  it('labels a model-written answer as written by AI', async () => {
    await panelWith(answer({ generated: true }))
    expect(host.textContent).toContain('Written by AI')
    expect(host.textContent).not.toContain('Offline guidance')
  })

  it('never calls offline guidance model-written', async () => {
    await panelWith(
      answer({
        generated: false,
        answer:
          'Live weather data is currently unavailable. General heavy-rain precautions apply.',
        disclaimer: 'Gemini free-tier quota exhausted. Offline assistant is active.',
      }),
    )
    // The claim that must never appear over reviewed, bundled text.
    expect(host.textContent).not.toContain('Written by AI')
    expect(host.textContent).toContain('Offline guidance')
  })

  it('says why it fell back, so offline reads as a condition not a choice', async () => {
    await panelWith(
      answer({
        generated: false,
        disclaimer: 'Gemini request timed out. Showing offline assistant response.',
      }),
    )
    expect(host.textContent).toContain('timed out')
  })

  it('shows the answer itself either way', async () => {
    await panelWith(answer({ generated: false, answer: 'Call 112 immediately.' }))
    expect(host.textContent).toContain('Call 112 immediately.')
  })
})
