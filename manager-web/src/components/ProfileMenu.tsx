/**
 * The account menu behind the topbar avatar: the theme, legal & attributions,
 * and signing out.
 *
 * A disclosure rather than an ARIA menu - a handful of ordinary buttons,
 * reached with Tab, which is what a keyboard expects of a panel this small.
 * Escape closes it and puts focus back on the avatar; a click outside or
 * tabbing away closes it too.
 *
 * Switching the theme is `setTheme`: an attribute on <html> and a local
 * preference. No request, no reload.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Info, LogOut, Moon, Sun } from 'lucide-react'

import { setTheme, useTheme, type Theme } from '../theme'
import { ImageCreditsDialog } from './ScenicImage'

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

export function ProfileMenu({
  name,
  role,
  onSignOut,
}: {
  name: string
  role: string
  /** Awaited, so the button can say it is working (audit 11.3 D8). */
  onSignOut: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [credits, setCredits] = useState(false)
  const theme = useTheme()
  const wrapper = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const initial = (name || '?').trim().charAt(0).toUpperCase()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Keep the panel on screen. It hangs from the avatar's right edge, which on
  // a phone - where the avatar wraps to the left of the bar - would put most
  // of it past the left edge. Measured before paint, so it never jumps.
  // ponytail: measured on open only; a resize while open is not followed.
  useLayoutEffect(() => {
    const el = panel.current
    if (!open || !el) return
    const { left, right } = el.getBoundingClientRect()
    const shift = left < 8 ? 8 - left : right > window.innerWidth - 8 ? window.innerWidth - 8 - right : 0
    el.style.translate = shift ? `${shift}px 0` : ''
  }, [open])

  return (
    <div
      ref={wrapper}
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-3 rounded-[var(--radius-control)] py-1 pl-1 pr-2 text-left hover:bg-soft"
      >
        <span aria-hidden="true" className="topbar-avatar">{initial}</span>
        <span className="topbar-who hidden sm:block">
          <b>{name}</b>
          {/* "Regional Head / Regional head" said one thing twice. */}
          {role.toLowerCase() !== name.trim().toLowerCase() ? <span>{role}</span> : null}
        </span>
        <span className="sr-only">Account menu</span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </button>

      {open ? (
        <div
          ref={panel}
          id={panelId}
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded-[var(--radius-card)] border border-line bg-surface-raised p-2 shadow-[var(--shadow-float)]"
        >
          <div role="group" aria-labelledby={`${panelId}-theme`}>
            <p id={`${panelId}-theme`} className="eyebrow px-2 pt-1 text-muted">
              Theme
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-soft p-1">
              {THEMES.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                  // The ring is the state cue: 3:1 on the track in both themes,
                  // where the shadow disappears on black.
                  className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] text-sm font-semibold ${
                    theme === value
                      ? 'bg-surface-raised text-ink shadow-[var(--shadow-card)] ring-1 ring-outline'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="my-2 border-t border-line" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setCredits(true)
            }}
            className="flex min-h-10 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-ink hover:bg-soft"
          >
            <Info className="size-4" aria-hidden="true" />
            Legal &amp; attributions
          </button>
          <button
            type="button"
            disabled={signingOut}
            aria-busy={signingOut}
            onClick={async () => {
              setSigningOut(true)
              try {
                await onSignOut()
              } finally {
                setSigningOut(false)
              }
            }}
            className="flex min-h-10 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-ink hover:bg-soft disabled:cursor-wait disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden="true" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
      {credits ? (
        <ImageCreditsDialog
          onClose={() => {
            setCredits(false)
            trigger.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}
