/**
 * Shared UI primitives.
 *
 * The async-state components exist so every data surface renders the same four
 * states. A screen that only handles "loaded" quietly shows an empty table when
 * the request actually failed, which is how a manager comes to believe they
 * have no trucks.
 */

import { Component, type MouseEvent, type ReactNode } from 'react'
import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react'

import { ApiError, NetworkError } from '../api/client'

// --- Page header ----------------------------------------------------------

/**
 * The header band every signed-in page inherits from the dashboard
 * (manager_03, audit 4 "System rules"): a 24px bold title, one 14px muted
 * line under it, and the page's actions on the right.
 */
export function PageHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold leading-tight text-ink">{title}</h1>
        {meta ? <p className="mt-1 max-w-4xl text-sm leading-5 text-muted">{meta}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

// --- Buttons --------------------------------------------------------------

interface ButtonProps {
  children: ReactNode
  /** The event, for a caller that must know which button opened something. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'danger'
  /** `sm` is the 36px outlined size of a card header or a table row. */
  size?: 'md' | 'sm'
  disabled?: boolean
  busy?: boolean
  /** Extra classes, appended last so a caller can override size or width. */
  className?: string
  /**
   * Native tooltip. Used to carry WHY a control is disabled - a greyed button
   * with no explanation is only marginally better than one that throws.
   */
  title?: string
  /** An element that states the reason in words (a row's attention cell). */
  describedBy?: string
  /** The name, when the visible content is an icon or a shortened word. */
  ariaLabel?: string
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  className = '',
  title,
  describedBy,
  ariaLabel,
}: ButtonProps) {
  // Terrain: the primary action is green, never blue. Blue in this product
  // means "route" or "focus" and nothing else. A shut control keeps its own
  // colour at half strength (audit 16.3 #12) rather than turning into a pale
  // tile nobody reads as a button.
  const styles = {
    primary:
      'bg-primary text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover active:bg-primary-hover disabled:opacity-50 disabled:shadow-none disabled:hover:bg-primary',
    secondary:
      'border border-line bg-surface text-ink shadow-[var(--shadow-card)] hover:bg-soft hover:border-outline active:bg-soft disabled:opacity-50 disabled:shadow-none disabled:hover:bg-surface',
    danger:
      'border border-danger/30 bg-surface text-danger hover:bg-danger-soft disabled:opacity-50 disabled:hover:bg-surface',
  }[variant]
  const sizing = size === 'sm' ? 'min-h-9 px-3 py-1.5 text-[13px]' : 'min-h-11 px-4 py-2 text-sm'

  return (
    <button
      type={type}
      onClick={onClick}
      // `busy` disables too - this is the double-submit guard. Without it a
      // second click during an in-flight assignment creates a duplicate request.
      disabled={disabled || busy}
      // Shut, not merely busy: a busy control is still the one being acted on.
      aria-disabled={disabled || undefined}
      aria-busy={busy}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-semibold transition-colors duration-150 disabled:cursor-not-allowed ${sizing} ${styles} ${className}`}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  )
}

/** A <Link> dressed as the primary button - for an action that is a navigation. */
export const LINK_BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-[var(--shadow-card)] hover:bg-primary-hover'

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

// --- Form fields ----------------------------------------------------------

interface FieldProps {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  placeholder?: string
  hint?: string
  error?: string
  autoComplete?: string
  /** Leading glyph inside the box. Decorative — the label still names it. */
  icon?: ReactNode
  /** Trailing control inside the box (a password reveal, say). */
  trailing?: ReactNode
  /** The sign-in size (manager_02): 15px label, 50px box, 20px glyph. */
  large?: boolean
}

export function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
  hint,
  error,
  autoComplete,
  icon,
  trailing,
  large = false,
}: FieldProps) {
  return (
    <label className="block">
      <span className={large ? 'text-[15px] font-semibold text-ink' : 'text-xs font-medium text-ink'}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      <span className={`relative block ${large ? 'mt-2' : 'mt-1'}`}>
        {icon ? (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute top-1/2 flex -translate-y-1/2 text-muted ${large ? 'left-4' : 'left-3'}`}
          >
            {icon}
          </span>
        ) : null}
        <input
          name={name}
          type={type}
          value={value}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
          // Inputs carry `border-outline`, not `border-line`: a box you may type
          // into needs more weight than a rule dividing two cards, and on the
          // warm canvas the lighter line all but disappeared. Focus is route
          // blue — Terrain reserves blue for route and focus.
          className={`w-full rounded-[var(--radius-control)] border bg-surface text-sm text-ink transition-colors placeholder:text-muted focus:ring-1 ${
            large ? 'h-[50px] text-[15px]' : 'py-2'
          } ${icon ? (large ? 'pl-12' : 'pl-10') : 'pl-3'} ${trailing ? (large ? 'pr-12' : 'pr-11') : 'pr-3'} ${
            error
              ? 'border-danger focus:border-danger focus:ring-danger'
              : 'border-outline focus:border-route focus:ring-route'
          }`}
        />
        {trailing ? (
          <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2">{trailing}</span>
        ) : null}
      </span>
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  )
}

// --- Status ---------------------------------------------------------------

/**
 * ON_TRIP is route blue, not green.
 *
 * Under the Terrain palette `primary` and `ok` are the same green, so the old
 * `ON_TRIP: primary-soft` rendered a moving truck identically to an idle
 * available one — the single most consequential pair on the fleet page to be
 * unable to tell apart at a glance. Blue is the correct answer rather than
 * merely a free one: a truck ON_TRIP is a truck on a route, and route is
 * exactly what blue means everywhere else in this product.
 */
/** The product's colour rule for a state: green = action / success, blue =
 *  route, amber = caution, red = emergency / danger, grey = unknown or over.
 *  Nothing unknown is ever green: UNKNOWN is not SAFE. */
export type PillTone = 'success' | 'route' | 'warning' | 'danger' | 'neutral' | 'muted'

const TONE_CLASS: Record<PillTone, string> = {
  success: 'bg-ok-soft text-ok border-ok/30',
  route: 'bg-route-soft text-route border-route/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  neutral: 'bg-soft text-ink border-line',
  muted: 'bg-soft text-muted border-line',
}

const STATUS_TONE: Record<string, PillTone> = {
  AVAILABLE: 'success',
  // A trip under way is a truck on a road; an assignment says `tone="success"`.
  ACTIVE: 'route',
  ON_TRIP: 'route',
  MAINTENANCE: 'warning',
  PENDING_VERIFICATION: 'warning',
  OFF_DUTY: 'neutral',
  ENDED: 'muted',
  BREAKDOWN: 'danger',
  SUSPENDED: 'danger',
  RETIRED: 'muted',
  REJECTED: 'danger',
  ROUTE_SELECTED: 'success',
  NO_ROUTE_SELECTED: 'warning',
  // Trip lifecycle.
  DRAFT: 'neutral',
  ASSIGNED: 'neutral',
  VERIFICATION_PENDING: 'warning',
  MANAGER_REVIEW: 'warning',
  DELAYED: 'warning',
  // The sentinel's SOS state: an incident trip must never read like a draft.
  INCIDENT: 'danger',
  DELIVERED: 'success',
  CLOSED: 'muted',
  CANCELLED: 'muted',
  // Route eligibility (the server's words) and the truck check.
  ELIGIBLE: 'success',
  REQUIRES_REVIEW: 'warning',
  NOT_ASSESSED: 'muted',
  UNKNOWN: 'muted',
  VERIFIED: 'success',
  NEEDS_REVIEW: 'warning',
  AWAITING_DRIVER: 'neutral',
  // Route option states (RouteCandidateCards). One per card, in words.
  SELECTED: 'route',
  SELECTABLE: 'success',
  REVIEW_REQUIRED: 'warning',
  BLOCKED: 'danger',
  NOT_CHECKED: 'muted',
  STALE: 'warning',
}

export function StatusPill({ status, tone, label }: { status: string; tone?: PillTone; label?: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${TONE_CLASS[tone ?? STATUS_TONE[status] ?? 'neutral']}`}
    >
      {label ?? status.replaceAll('_', ' ')}
    </span>
  )
}

// --- Tables ---------------------------------------------------------------

/** The dashboard's table (audit 4): inside a card, a muted uppercase header
 *  row, 48px rows divided by a rule, the row action on the right. */
export const TABLE = 'w-full border-collapse text-left text-sm'
export const TABLE_TH = 'whitespace-nowrap pb-2 text-xs font-medium uppercase tracking-wide text-muted'
export const TABLE_ROW = 'border-t border-line'
export const TABLE_TD = 'h-12 py-1.5 align-middle'

// --- Async states ---------------------------------------------------------

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-12 text-sm text-muted"
    >
      <Spinner />
      {label}
    </div>
  )
}

/** Nothing to show, said plainly: an icon disc, a 16px title, one 14px line. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: LucideIcon
  /** Anything more the empty state explains, under the line. */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-soft text-muted">
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted">{description}</p>
      ) : null}
      {children}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/**
 * Turns an exception into something a manager can act on.
 *
 * Never renders a raw exception: backend 5xx bodies are deliberately generic,
 * and a stack trace would be both useless here and a disclosure risk.
 */
export function ErrorState({
  error,
  onRetry,
  centered = false,
}: {
  error: unknown
  onRetry?: () => void
  /** The whole card failed: centre it like an empty state. */
  centered?: boolean
}) {
  let title = 'Something went wrong'
  let detail = 'An unexpected error occurred.'
  let retryable = true

  if (error instanceof NetworkError && error.timedOut) {
    title = 'The backend took too long'
    detail = error.message + ' Try again in a moment.'
  } else if (error instanceof NetworkError) {
    title = 'Cannot reach the backend'
    detail = 'The API is not responding. Check the connection and that the backend is up.'
  } else if (error instanceof ApiError) {
    detail = error.message
    retryable = error.isRetryable
    if (error.status === 403) {
      title = 'Not permitted'
      retryable = false
    } else if (error.status === 404) {
      title = 'Not found'
      retryable = false
    } else if (error.status === 409) {
      title = 'Conflict'
      retryable = false
    } else if (error.status === 503) {
      title = 'Service unavailable'
    }
  }

  // No bordered box: a failure inside a card is words beside a danger disc,
  // not a second card (audit 4, "never a card inside a card").
  return (
    <div
      role="alert"
      className={centered ? 'flex flex-col items-center px-4 py-8 text-center' : 'flex items-start gap-3'}
    >
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-[18px]" strokeWidth={1.75} />
      </span>
      <div className={`min-w-0 ${centered ? 'mt-2' : 'pt-0.5'}`}>
        <p className="text-sm font-semibold text-danger">{title}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-muted">{detail}</p>
        {onRetry && retryable ? (
          <div className="mt-2.5">
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Around every lazily loaded map. A map chunk that never arrived (offline, a
 * flaky link) or a MapLibre that cannot start (no WebGL: an old GPU, a remote
 * desktop) takes down the map and says why, not the whole console with the
 * lists and half-filled forms around it.
 *
 * The words come from the error: a missing chunk is the connection and asking
 * again can work; anything else fails the same way every time. `instead` names
 * what the caller offers in place of the map. With `onError` the caller shows
 * the message itself (the address picker closes its dialog); without it the
 * message stands where the map was.
 */
export class MapLoadBoundary extends Component<
  { instead?: string; onError?: (message: string) => void; children: ReactNode },
  { failed: boolean; caught?: unknown }
> {
  state: { failed: boolean; caught?: unknown } = { failed: false }
  static getDerivedStateFromError(caught: unknown) {
    return { failed: true, caught }
  }
  componentDidCatch(caught: unknown) {
    this.props.onError?.(this.message(caught))
  }
  message(caught: unknown): string {
    // The loader's own words, or those of the error it wraps.
    const said = `${String(caught)} ${String((caught as { cause?: unknown } | null)?.cause)}`
    if (/dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to fetch/.test(said)) {
      // Only a caller with onError (the picker) makes a fresh lazy load; a
      // page's module-level lazy keeps its rejection until the page reloads.
      return `Map could not load — check the connection${this.props.onError ? '' : ', then reload the page'}.`
    }
    return `Map could not start in this browser${this.props.instead ? ` — ${this.props.instead}` : ''}.`
  }
  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.onError) return null
    return (
      <p role="alert" className="rounded-xl border border-line bg-surface/60 px-4 py-6 text-center text-xs text-warning">
        {this.message(this.state.caught)}
      </p>
    )
  }
}

/**
 * The dashboard's card (manager_03): a bold title with an optional muted
 * line under it and one action on the right, then the body. No rule under
 * the header - the reference separates by space, not by lines. The caller
 * sizes it (`className`); the body grows to fill.
 */
export function Panel({
  title,
  subtitle,
  action,
  large = false,
  className = '',
  testId,
  children,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
  /** The map card's 20px title; the smaller cards use 16px. */
  large?: boolean
  className?: string
  testId?: string
  children: ReactNode
}) {
  return (
    <section
      data-testid={testId}
      className={`flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)] ${className}`}
    >
      <header className="mb-2.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className={`font-bold leading-tight text-ink ${large ? 'text-xl' : 'text-base'}`}>{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

/** The reference's outlined "View all →" button, for a navigation. */
export const VIEW_ALL =
  'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[6px] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:border-outline hover:bg-soft'

/**
 * A page card in the dashboard's geometry: radius 12, one soft shadow, a
 * 16px bold title with an optional muted line, the card's action on the
 * right, and no rule under the header (the reference separates by space).
 */
export function Card({
  title,
  subtitle,
  action,
  className = '',
  testId,
  children,
}: {
  title?: string
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
  testId?: string
  children: ReactNode
}) {
  return (
    <section
      data-testid={testId}
      className={`min-w-0 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)] ${className}`}
    >
      {title || action ? (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
          {title ? (
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight text-ink">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{subtitle}</p> : null}
            </div>
          ) : (
            <span />
          )}
          {action}
        </header>
      ) : null}
      <div className={title || action ? 'px-5 pb-5 pt-3' : 'px-5 py-4'}>{children}</div>
    </section>
  )
}
