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
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  busy = false,
}: ButtonProps) {
  const styles = {
    primary:
      'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-500',
    secondary:
      'border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40',
    danger:
      'border border-red-800 text-red-300 hover:bg-red-950 disabled:opacity-40',
  }[variant]

  return (
    <button
      type={type}
      onClick={onClick}
      // `busy` disables too - this is the double-submit guard. Without it a
      // second click during an in-flight assignment creates a duplicate request.
      disabled={disabled || busy}
      aria-busy={busy}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${styles}`}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  )
}

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
      <span className="text-xs font-medium text-slate-300">
        {label}
        {required ? <span className="ml-0.5 text-red-400">*</span> : null}
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
        className={`mt-1 w-full rounded-md border bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:ring-1 ${
          error
            ? 'border-red-700 focus:border-red-500 focus:ring-red-500'
            : 'border-slate-700 focus:border-emerald-600 focus:ring-emerald-600'
        }`}
      />
      {error ? (
        <span className="mt-1 block text-xs text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  )
}

// --- Status ---------------------------------------------------------------

const STATUS_TONE: Record<string, string> = {
  AVAILABLE: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  ACTIVE: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  ON_TRIP: 'bg-sky-950 text-sky-300 border-sky-800',
  MAINTENANCE: 'bg-amber-950 text-amber-300 border-amber-800',
  PENDING_VERIFICATION: 'bg-amber-950 text-amber-300 border-amber-800',
  OFF_DUTY: 'bg-slate-800 text-slate-300 border-slate-700',
  ENDED: 'bg-slate-800 text-slate-400 border-slate-700',
  BREAKDOWN: 'bg-red-950 text-red-300 border-red-800',
  SUSPENDED: 'bg-red-950 text-red-300 border-red-800',
  RETIRED: 'bg-slate-800 text-slate-500 border-slate-700',
  REJECTED: 'bg-red-950 text-red-300 border-red-800',
}

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'bg-slate-800 text-slate-300 border-slate-700'
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
      className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"
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
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{description}</p>
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

  if (error instanceof NetworkError) {
    title = 'Cannot reach the backend'
    detail =
      'The API is not responding. Check that the backend is running on port 8000.'
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
      className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3"
    >
      <p className="text-sm font-semibold text-red-300">{title}</p>
      <p className="mt-1 text-xs text-red-200/80">{detail}</p>
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
    <section className="rounded-xl border border-slate-800 bg-slate-900/60">
      {title || action ? (
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
          {title ? (
            <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
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
