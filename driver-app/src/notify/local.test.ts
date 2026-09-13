import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-notifications', () => ({ setNotificationHandler: () => {}, getPermissionsAsync: async () => ({ granted: true }), requestPermissionsAsync: async () => ({ granted: true }), scheduleNotificationAsync: vi.fn() }))
vi.mock('react-native', () => ({ AppState: { currentState: 'active' }, Platform: { OS: 'android' } }))

import { COOLDOWN_MS, shouldFire } from './local'

describe('background notification dedupe', () => {
  it('fires once per key, then stays silent for the cooldown, then fires again', () => {
    const sent = new Map<string, number>()
    expect(shouldFire('danger:route-a:seg-3', 1_000, sent)).toBe(true)
    expect(shouldFire('danger:route-a:seg-3', 11_000, sent)).toBe(false) // the next poll
    expect(shouldFire('danger:route-a:seg-4', 11_000, sent)).toBe(true) // a new segment is a new key
    expect(shouldFire('danger:route-a:seg-3', 1_000 + COOLDOWN_MS, sent)).toBe(true)
  })
})
