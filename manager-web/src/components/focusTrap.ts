/**
 * Keep Tab inside a dialog. The map picker has carried this since it was
 * written; the profile drawer and the assign dialog relied on a `focusin`
 * listener instead, which pulls focus back only after it has landed on
 * something - so a Tab off the last control parked on the document for one
 * press with nothing visible. Wrapping at the edges is the fix, once.
 *
 * `summary` is included: a closed <details> exposes it as a tab stop and it
 * is the drawer's last control.
 */
import type { KeyboardEvent } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** Call from the dialog root's onKeyDown. Returns true when it handled a Tab. */
export function wrapTab(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.key !== 'Tab') return false
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' &&
      // Inside a closed <details> only the summary is reachable; the browser
      // skips the rest, so the wrap must too or it aims at an unreachable stop.
      (element.tagName === 'SUMMARY' || !element.closest('details:not([open])')),
  )
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return false
  const active = document.activeElement
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault()
    last.focus()
    return true
  }
  if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}
