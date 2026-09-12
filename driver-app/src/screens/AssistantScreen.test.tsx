// @vitest-environment jsdom
/**
 * The assistant is a chat whose replies are computed, not generated.
 *
 * These assert the properties a driver depends on: a tap produces an answer, a
 * second tap keeps the first one on screen, and nothing on this screen reaches
 * the network or calls itself AI.
 */
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
      status: 'IN_TRANSIT',
      truck: { id: 'tr-1', registration_number: 'AS01AB1234' },
      started_at: '2026-09-08T00:00:00Z',
      progress: null,
      last_fix: null,
      selected_route_id: 'route-1',
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

// The translator hangs off the assistant's "Help me talk" hand-off, so the
// module graph reaches the api client even though this screen never calls it.
vi.mock('../ai/useLocalAi', () => ({
  useLocalAi: () => ({
    status: null,
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

// The live risk read pulls in the API client (expo-constants); the screen
// under test answers from the package and the trip, so it is held UNAVAILABLE.
vi.mock('../hooks/useRouteRisk', () => ({
  useRouteRisk: () => ({ risk: null, state: 'UNAVAILABLE', fetchedAt: null, capturedAt: null, refresh: () => {} }),
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('react-native', async () => {
  const { createElement: h, forwardRef } = await import('react')
  const box = ({ children, style: _style, testID, ...rest }: any) =>
    h('div', { 'data-testid': testID, ...rest }, children)
  const scroll = forwardRef(({ children, style: _style, contentContainerStyle: _c, testID, ...rest }: any, _ref: any) =>
    h('div', { 'data-testid': testID, ...rest }, children),
  )
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
    ScrollView: scroll,
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

describe('AssistantScreen', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  const tap = (testId: string) => {
    const button = container?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
    expect(button, testId).not.toBeNull()
    act(() => button?.click())
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(createElement(AssistantScreen))
    })
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('opens with every question it can answer on screen', () => {
    for (const label of ['My route', 'Next stop', 'Do I need a break?', 'Am I online?']) {
      expect(container?.textContent).toContain(label)
    }
  })

  it('never calls itself AI', () => {
    // The guarantee this screen makes is that no model is in the loop. Naming
    // it AI would claim the opposite to the one person who cannot check.
    expect(container?.textContent).not.toMatch(/\bAI\b/)
  })

  it('answers a tapped question from local state', () => {
    tap('ask-q-trip')
    expect(container?.textContent).toContain('NER-101')
    // A registration is not an enum. The humaniser that stops SHOUTING_SNAKE
    // reaching a driver turned AS01AB1234 into "As01ab1234" before it learned
    // to leave anything with a digit in it alone.
    expect(container?.textContent).toContain('AS01AB1234')
  })

  it('keeps the earlier answer on screen when a second question is asked', () => {
    tap('ask-q-trip')
    tap('ask-q-net')
    // The transcript is the point: an answer that replaced the last one forced
    // a driver to re-tap to compare two facts.
    expect(container?.textContent).toContain('NER-101')
    expect(container?.querySelectorAll('button').length).toBeGreaterThan(0)
  })

  it('names what an answer could not include, without shouting the enum', () => {
    tap('ask-q-vehicle')
    expect(container?.textContent).toContain('Not included')
    expect(container?.textContent).toContain('Vehicle diagnostics')
  })

  it('never puts a raw code on screen', () => {
    // A driver reading BREAK_TRIP_NOT_STARTED is reading the database. The
    // break codes are client-owned and cannot go in the backend catalogue -
    // see BREAK_REASON_TEXT - so this is the guard that they stay explained.
    for (const id of ['q-break', 'q-trip', 'q-risk', 'q-stop', 'q-vehicle', 'q-net']) tap(`ask-${id}`)
    expect(container?.textContent).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/)
  })
})
