// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
})

const mockAsk = vi.fn()
const mockCancel = vi.fn()
const mockReset = vi.fn()

let mockAiState: any = { kind: 'IDLE' }
let mockAiStatus: any = {
  available: true,
  provider: 'GOOGLE_GEMINI',
  model: 'gemini-2.5-flash',
  detail: null,
  languages: {},
}

vi.mock('../ai/useLocalAi', () => ({
  useLocalAi: () => ({
    status: mockAiStatus,
    state: mockAiState,
    ask: mockAsk,
    cancel: mockCancel,
    reset: mockReset,
  }),
}))

vi.mock('expo-speech', () => ({
  speak: vi.fn(),
  stop: vi.fn(),
  getAvailableVoicesAsync: vi.fn().mockResolvedValue([]),
}))

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn().mockResolvedValue(true),
}))

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({
    children,
    style: _style,
    ...rest
  }: {
    children?: import('react').ReactNode
    style?: unknown
    [k: string]: unknown
  }) => h('div', rest, children)

  const input = ({
    value,
    onChangeText,
    placeholder,
    maxLength,
    style: _style,
    ...rest
  }: any) =>
    h('input', {
      value,
      placeholder,
      maxLength,
      onChange: (e: { target: { value: string } }) => onChangeText?.(e.target.value),
      ...rest,
    })

  const pressable = ({
    children,
    style: _style,
    onPress,
    ...rest
  }: any) => h('button', { onClick: onPress, ...rest }, children)

  return {
    View: box,
    ScrollView: box,
    Pressable: pressable,
    Text: box,
    TextInput: input,
    ActivityIndicator: () => h('span', null, 'Loading...'),
    Platform: { OS: 'android' },
    StyleSheet: { create: (v: unknown) => v },
  }
})

import TranslateBox from './TranslateBox'

describe('TranslateBox Component', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    mockAsk.mockClear()
    mockCancel.mockClear()
    mockReset.mockClear()
    mockAiState = { kind: 'IDLE' }
    mockAiStatus = {
      available: true,
      provider: 'GOOGLE_GEMINI',
      model: 'gemini-2.5-flash',
      detail: null,
      languages: {},
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    container = null
    root = null
  })

  it('renders title, mode badge, and 12 languages', () => {
    act(() => {
      root?.render(createElement(TranslateBox))
    })
    expect(container?.textContent).toContain('Driver Translator')
    expect(container?.textContent).toContain('ONLINE TRANSLATION')
    expect(container?.textContent).toContain('Hindi')
    expect(container?.textContent).toContain('Assamese')
    expect(container?.textContent).toContain('Gujarati')
    expect(container?.textContent).toContain('Tamil')
  })

  it('renders all 8 quick driver phrases', () => {
    act(() => {
      root?.render(createElement(TranslateBox))
    })
    expect(container?.textContent).toContain('Where is the loading gate?')
    expect(container?.textContent).toContain('Please show the delivery receipt.')
    expect(container?.textContent).toContain('Road ahead is blocked?')
    expect(container?.textContent).toContain('Where is the nearest fuel station?')
    expect(container?.textContent).toContain('I need mechanical help.')
    expect(container?.textContent).toContain('I need medical help.')
    expect(container?.textContent).toContain('Please call my manager.')
    expect(container?.textContent).toContain('How far is the checkpoint?')
  })

  it('shows offline warning banner and verified offline phrases when AI is unavailable', () => {
    mockAiStatus = {
      available: false,
      provider: null,
      model: null,
      detail: 'No connection',
      languages: {},
    }
    act(() => {
      root?.render(createElement(TranslateBox))
    })
    expect(container?.textContent).toContain('LOCAL PHRASEBOOK')
    expect(container?.textContent).toContain(
      'Online translation unavailable. Showing the local phrasebook.',
    )
  })

  it('renders answer when aiState has answered', () => {
    mockAiState = {
      kind: 'ANSWER',
      question: 'Where is the loading gate?',
      answer: {
        answer: 'ল’ডিং গেট ক’ত আছে?',
        generated: true,
        model: 'gemini-2.5-flash',
        facts_as_of: null,
        severity: 'INFO',
        source_mode: 'LIVE_DATA',
        actions: [],
        disclaimer: null,
      },
    }
    act(() => {
      root?.render(createElement(TranslateBox))
    })
    expect(container?.textContent).toContain('SHOW THIS TO THE OTHER PERSON')
    expect(container?.textContent).toContain('ল’ডিং গেট ক’ত আছে?')
    expect(container?.textContent).toContain('ONLINE TRANSLATION')
  })
})
