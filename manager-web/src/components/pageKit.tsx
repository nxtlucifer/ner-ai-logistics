/**
 * The dashboard system (manager_03) for the directory pages: Drivers, Trucks,
 * States, Managers, Reports, Notifications, Diagnostics and their dialogs.
 *
 * Composed here, not in ui.tsx, because ui.tsx belongs to another lane in this
 * phase. Each piece is a candidate to promote there: the page header, the 36px
 * action button, the table header row, the quiet state and the boxless error.
 *
 * Nothing here knows which theme is on; every colour is a token.
 */

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { describeError, Spinner } from './ui'

/** The page header band every signed-in page inherits (audit 4): a 24px bold
 *  title, a 14px muted line, and the actions on the right. */
export function PageHeader({ title, meta, actions, note }: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  /** A line under the actions, for the reason a header action is shut. */
  note?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-4xl flex-1 basis-[22rem]">
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-ink">{title}</h1>
        {meta ? <p data-testid="page-meta" className="mt-1 text-sm leading-5 text-muted">{meta}</p> : null}
      </div>
      {actions ? (
        <div className="ml-auto flex w-full min-w-0 max-w-full flex-col items-end gap-1.5 sm:w-auto">
          {/* Full width on a phone, so a full-width search meets the gutter instead of floating inset. */}
          <div data-testid="page-actions" className="flex max-w-full flex-wrap items-center justify-end gap-2 max-sm:w-full">{actions}</div>
          {note ? <p className="text-right text-[13px] text-muted">{note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

type Variant = 'primary' | 'outline' | 'danger'

// Outlined is the default: the reference's header and row actions are 36px
// outlined buttons, with one primary where there is an obvious next step.
const TONE: Record<Variant, string> = {
  primary: 'border border-transparent bg-primary text-on-primary enabled:hover:bg-primary-hover',
  outline: 'border border-line bg-surface text-ink enabled:hover:border-outline enabled:hover:bg-soft',
  danger: 'border border-danger bg-surface text-danger enabled:hover:bg-danger-soft',
}

// nowrap: a table sizes a column by its narrowest content, and a label that
// could wrap there would overflow its cell once the row lays it out whole.
export const ACTION_BASE =
  'inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-[13px] font-semibold transition-colors'

// A link or a label has no disabled state, so its hover needs no `enabled:`.
const LINK_TONE: Record<Variant, string> = {
  primary: 'border border-transparent bg-primary text-on-primary hover:bg-primary-hover',
  outline: 'border border-line bg-surface text-ink hover:border-outline hover:bg-soft',
  danger: 'border border-danger bg-surface text-danger hover:bg-danger-soft',
}

/** The class of an `<a>` or `<label>` that should look like an ActionButton. */
export const actionClass = (variant: Variant = 'outline') => `${ACTION_BASE} ${LINK_TONE[variant]}`

/**
 * A 36px action. A shut one keeps its colour at half strength and says so to
 * assistive technology (`disabled` is the guard, `aria-disabled` the word);
 * the caller shows the reason as text beside it, not only in a tooltip.
 */
export function ActionButton({
  children,
  onClick,
  type = 'button',
  variant = 'outline',
  disabled = false,
  busy = false,
  title,
  icon: Icon,
  className = '',
  ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: Variant
  disabled?: boolean
  busy?: boolean
  title?: string
  icon?: LucideIcon
  className?: string
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      // `busy` shuts it too: the double-submit guard. Busy keeps full strength
      // with a spinner, so it reads as working rather than refused.
      disabled={disabled || busy}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      title={title}
      className={`${ACTION_BASE} ${TONE[variant]} disabled:cursor-not-allowed aria-disabled:opacity-50 ${className}`}
    >
      {busy ? <Spinner /> : Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

/** A search box sized to sit among the header actions (36px, as they are).
 *  `!`: index.css gives every input an unlayered 44px min-height, and an
 *  unlayered rule beats a layered utility however specific the utility is. */
export function SearchInput({ value, onChange, placeholder, label }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="h-9! min-h-9! w-full min-w-0 rounded-[6px] border border-outline bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-route focus:ring-1 focus:ring-route sm:w-60"
    />
  )
}

/** The dashboard table: 13px uppercase muted header row, 48px rows, a rule between.
 *  A header may wrap under pressure (bottom-aligned) rather than push the row
 *  actions out of the card. */
export const TH = 'pb-2.5 align-bottom text-[13px] font-medium uppercase tracking-[0.04em] text-muted'
export const TR = 'h-12 border-t border-line align-middle'
export const TD = 'py-2'

/**
 * A table with row actions, on a phone. Below 768px a row cannot fit, and a
 * row scrolled sideways hides its actions (brief: no off-screen primary
 * control). So there each row becomes a small card: the header row goes to
 * screen readers only, the cells flow into two columns, each labelled from its
 * `data-label`, and the actions take the last line. Nothing is dropped; from
 * 768px up it is the ordinary table.
 *
 * `pr-0!`: index.css pads every cell right with an unlayered rule.
 */
export const PHONE_LABEL =
  'max-md:before:mb-0.5 max-md:before:block max-md:before:text-[11px] max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-[0.04em] max-md:before:text-muted max-md:before:content-[attr(data-label)]'
export const STACK = {
  table: 'w-full text-left text-sm max-md:block',
  head: 'max-md:sr-only',
  body: 'max-md:block',
  row: `${TR} max-md:grid max-md:h-auto max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-3 max-md:py-3`,
  /** A data cell: give it `data-label` (the column's name) for its phone label. */
  cell: `${TD} min-w-0 max-md:py-0 max-md:pr-0! ${PHONE_LABEL}`,
  /** The same, across both phone columns (a long value such as an email). */
  cellWide: `${TD} min-w-0 max-md:col-span-2 max-md:py-0 max-md:pr-0! ${PHONE_LABEL}`,
  /** The row's name cell: first, full width, no label. */
  lead: `${TD} max-md:col-span-2 max-md:py-0 max-md:pr-0!`,
  /** The actions: right-aligned in the table, wrapping rather than overflowing; the last line on a phone. */
  actions: `${TD} pr-0! text-right max-md:col-span-2 max-md:py-0 max-md:text-left`,
  actionRow: 'flex flex-wrap items-center justify-end gap-2 max-md:justify-start',
}

/** A card's quiet state (audit 4 system rules): an icon disc, a 16px title, a 14px line. */
export function Quiet({ icon: Icon, title, children, action }: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-8 text-center">
      <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-soft text-muted">
        <Icon className="size-5" />
      </span>
      <p className="mt-2.5 text-base font-semibold text-ink">{title}</p>
      {children ? <p className="mt-1 max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/** The same words ErrorState chooses, for use where a box would be a card in a card. */
export { describeError }

/** A failed read or write inside a card: the words and a retry, no box. */
export function InlineError({ error, onRetry, what, compact = false }: {
  error: unknown
  onRetry?: () => void
  /** "Drivers could not be loaded" instead of the generic title. */
  what?: string
  compact?: boolean
}) {
  const { title, detail, retryable } = describeError(error)
  return (
    <div role="alert" className={compact ? 'mt-2 text-left' : 'flex flex-col items-center px-2 py-8 text-center'}>
      <p className="text-sm font-semibold text-danger">{what ?? title}</p>
      <p className={`mt-0.5 text-[13px] text-muted ${compact ? '' : 'max-w-md'}`}>{what ? `${title}. ${detail}` : detail}</p>
      {onRetry && retryable ? (
        <ActionButton className="mt-3" onClick={onRetry}>
          Try again
        </ActionButton>
      ) : null}
    </div>
  )
}

export type PillTone = 'ok' | 'route' | 'warning' | 'danger' | 'neutral'

// Green = action/success, blue = route, amber = caution, red = danger,
// neutral = unknown. One line each, so the tint and its ink travel together.
const PILL: Record<PillTone, string> = {
  ok: 'border-ok/30 bg-ok-soft text-ok',
  route: 'border-route/30 bg-route-soft text-route',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
  neutral: 'border-line bg-soft text-muted',
}

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PILL[tone]}`}>
      {children}
    </span>
  )
}
