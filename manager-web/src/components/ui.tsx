/**
 * Shared UI primitives.
 *
 * The async-state components exist so every data surface renders the same four
 * states. A screen that only handles "loaded" quietly shows an empty table when
 * the request actually failed, which is how a manager comes to believe they
 * have no trucks.
 */

import type { ReactNode } from 'react'

import { ApiError, NetworkError } from '../api/client'

// --- Buttons --------------------------------------------------------------

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  busy?: boolean
  /** Extra classes, appended last so a caller can override size or width. */
  className?: string
  /**
   * Native tooltip. Used to carry WHY a control is disabled - a greyed button
   * with no explanation is only marginally better than one that throws.
   */
  title?: string
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  busy = false,
  className = '',
  title,
}: ButtonProps) {
  // Terrain: the primary action is green, never blue. Blue in this product
  // means "route" or "focus" and nothing else.
  const styles = {
    primary:
      'bg-primary text-white shadow-[var(--shadow-card)] hover:bg-primary-hover active:bg-primary-hover disabled:bg-soft disabled:text-muted disabled:shadow-none',
    secondary:
      'border border-line bg-surface text-ink shadow-[var(--shadow-card)] hover:bg-soft hover:border-outline active:bg-soft disabled:opacity-40 disabled:shadow-none',
    danger:
      'border border-danger/30 text-danger hover:bg-danger-soft disabled:opacity-40',
  }[variant]

  return (
    <button
      type={type}
      onClick={onClick}
      // `busy` disables too - this is the double-submit guard. Without it a
      // second click during an in-flight assignment creates a duplicate request.
      disabled={disabled || busy}
      aria-busy={busy}
      title={title}
      className={`inline-flex items-center justify-center gap-2 min-h-11 rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  )
}

/** A <Link> dressed as the primary button - for an action that is a navigation. */
export const LINK_BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-card)] hover:bg-primary-hover'

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
}: FieldProps) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
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
        className={`mt-1 w-full rounded-[var(--radius-control)] border bg-surface px-3 py-2 text-sm text-ink transition-colors placeholder:text-muted focus:ring-1 ${
          error
            ? 'border-danger focus:border-danger focus:ring-danger'
            : 'border-outline focus:border-route focus:ring-route'
        }`}
      />
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
const STATUS_TONE: Record<string, string> = {
  AVAILABLE: 'bg-ok-soft text-ok border-ok/30',
  ACTIVE: 'bg-ok-soft text-ok border-ok/30',
  ON_TRIP: 'bg-route-soft text-route border-route/30',
  MAINTENANCE: 'bg-warning-soft text-warning border-warning/30',
  PENDING_VERIFICATION: 'bg-warning-soft text-warning border-warning/30',
  OFF_DUTY: 'bg-soft text-ink border-line',
  ENDED: 'bg-soft text-muted border-line',
  BREAKDOWN: 'bg-danger-soft text-danger border-danger/30',
  SUSPENDED: 'bg-danger-soft text-danger border-danger/30',
  RETIRED: 'bg-soft text-muted border-line',
  REJECTED: 'bg-danger-soft text-danger border-danger/30',
  ROUTE_SELECTED: 'bg-ok-soft text-ok border-ok/30',
  NO_ROUTE_SELECTED: 'bg-warning-soft text-warning border-warning/30',
  // Route option states (RouteCandidateCards). One per card, in words.
  SELECTED: 'bg-route-soft text-route border-route/30',
  SELECTABLE: 'bg-ok-soft text-ok border-ok/30',
  REVIEW_REQUIRED: 'bg-warning-soft text-warning border-warning/30',
  BLOCKED: 'bg-danger-soft text-danger border-danger/30',
  NOT_CHECKED: 'bg-soft text-muted border-line',
  STALE: 'bg-warning-soft text-warning border-warning/30',
}

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'bg-soft text-ink border-line'
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${tone}`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  )
}

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

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-xs text-muted">{description}</p>
      ) : null}
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
}: {
  error: unknown
  onRetry?: () => void
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

  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger-soft/50 px-4 py-3"
    >
      <p className="text-sm font-semibold text-danger">{title}</p>
      <p className="mt-1 text-xs text-danger/80">{detail}</p>
      {onRetry && retryable ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function Card({
  title,
  action,
  children,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      {title || action ? (
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          {title ? (
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
          ) : (
            <span />
          )}
          {action}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}
