// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
})

vi.mock('../trip/TripProvider', () => ({
  useTrip: () => ({
    trip: {
      id: 'trip-1',
      trip_code: 'NER-101',
      started_at: '2026-09-08T00:00:00Z',
      stops: [
        { id: 's1', sequence: 1, name: 'Guwahati Depot' },
        { id: 's2', sequence: 2, name: 'Jorhat Hub' },
      ],
    },
    loadedAt: Date.now(),
    phase: 'ready',
    tracking: { uploadState: 'idle' },
    isStale: false,
  }),
}))

vi.mock('../ai/useLocalAi', () => ({
  useLocalAi: () => ({
    status: { available: true, model: 'gemini-2.5-flash', languages: {} },
    state: { kind: 'IDLE' },
    ask: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
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

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(null),
  },
}))

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
    Linking: { openURL: vi.fn() },
    Platform: { OS: 'android' },
    StyleSheet: { create: (v: unknown) => v },
  }
})

import AssistantScreen from './AssistantScreen'

describe('AssistantScreen Component', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('renders all 4 top sub-modes: Ask AI, Translate, Route Risk, Weather / Safety', () => {
    act(() => {
      root?.render(createElement(AssistantScreen))
    })
    expect(container?.textContent).toContain('Ask AI')
    expect(container?.textContent).toContain('Translate')
    expect(container?.textContent).toContain('Route Risk')
    expect(container?.textContent).toContain('Weather / Safety')
  })

  it('switches to Translate sub-mode when tab clicked', () => {
    act(() => {
      root?.render(createElement(AssistantScreen))
    })
    const translateBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="submode-translate"]',
    )
    expect(translateBtn).not.toBeNull()
    act(() => {
      translateBtn?.click()
    })
    expect(container?.textContent).toContain('Driver Translator')
    expect(container?.textContent).toContain('Quick Driver Phrases')
  })

  it('switches to Route Risk sub-mode when tab clicked', () => {
    act(() => {
      root?.render(createElement(AssistantScreen))
    })
    const riskBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="submode-risk"]',
    )
    expect(riskBtn).not.toBeNull()
    act(() => {
      riskBtn?.click()
    })
    expect(container?.textContent).toContain('Route Risk & Corridor Intelligence')
    expect(container?.textContent).toContain('SAFETY MANDATE')
  })

  it('switches to Weather / Safety sub-mode with emergency numbers when clicked', () => {
    act(() => {
      root?.render(createElement(AssistantScreen))
    })
    const safetyBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="submode-safety"]',
    )
    expect(safetyBtn).not.toBeNull()
    act(() => {
      safetyBtn?.click()
    })
    expect(container?.textContent).toContain('Fatigue & Rest Break Status')
    expect(container?.textContent).toContain('Emergency Highway Contacts')
    expect(container?.textContent).toContain('112')
    expect(container?.textContent).toContain('108')
    expect(container?.textContent).toContain('1033')
  })
})
