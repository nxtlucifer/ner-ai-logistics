import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ Keyboard: { addListener: () => ({ remove: () => {} }) }, Platform: { OS: 'web' } }))

import { softKeyboardLikely } from './useKeyboardOpen'

describe('softKeyboardLikely (web)', () => {
  it('needs both a focused field and a viewport a keyboard shorter', () => {
    expect(softKeyboardLikely(true, 640, 340)).toBe(true)
    expect(softKeyboardLikely(false, 640, 340)).toBe(false) // a window made shorter, nothing typed
    expect(softKeyboardLikely(true, 640, 600)).toBe(false) // typing on a desktop, or a URL bar hiding
  })
})
