/**
 * Is the soft keyboard up? While it is, the floating tab bar steps aside and
 * the Assistant's composer folds to its input row: on a 640 dp phone a 300 dp
 * keyboard, a 200 dp composer and the bar left no room for the conversation
 * (B3D-R03).
 *
 * Native reads the Keyboard events. The web has none (react-native-web's
 * Keyboard is a stub), so there it is inferred: a text field has focus AND the
 * viewport is at least 120 px shorter than the tallest seen at this width,
 * which is what a soft keyboard does and a desktop window does not.
 */
import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

export const KEYBOARD_MIN_PX = 120

export function softKeyboardLikely(typing: boolean, tallest: number, height: number): boolean {
  return typing && tallest - height >= KEYBOARD_MIN_PX
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'web') {
      const shown = Keyboard.addListener('keyboardDidShow', () => setOpen(true))
      const hidden = Keyboard.addListener('keyboardDidHide', () => setOpen(false))
      return () => {
        shown.remove()
        hidden.remove()
      }
    }
    if (typeof window === 'undefined') return
    let width = 0
    let tallest = 0
    const update = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      // A new width is a rotation: the old tallest belongs to the other one.
      if (window.innerWidth !== width) {
        width = window.innerWidth
        tallest = 0
      }
      tallest = Math.max(tallest, height)
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      setOpen(softKeyboardLikely(typing, tallest, height))
    }
    // After the focus has moved: during focusout the old field is still active.
    const later = () => setTimeout(update, 0)
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    document.addEventListener('focusin', later)
    document.addEventListener('focusout', later)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      document.removeEventListener('focusin', later)
      document.removeEventListener('focusout', later)
    }
  }, [])
  return open
}
