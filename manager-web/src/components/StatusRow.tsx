/**
 * One dependency status row.
 *
 * `state` maps to visual treatment only. The label and detail always come from
 * real API data - there is no fallback copy that could imply a healthy system
 * when nothing has been observed.
 */

export type RowState = 'ok' | 'bad' | 'pending' | 'unknown'

interface StatusRowProps {
  label: string
  value: string
  state: RowState
  detail?: string | null
}

const DOT: Record<RowState, string> = {
  ok: 'bg-emerald-500',
  bad: 'bg-red-500',
  pending: 'bg-amber-400 animate-pulse',
  unknown: 'bg-slate-400',
}

const TEXT: Record<RowState, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-red-700 dark:text-red-400',
  pending: 'text-amber-700 dark:text-amber-400',
  unknown: 'text-slate-600 dark:text-slate-400',
}

export function StatusRow({ label, value, state, detail }: StatusRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 py-4 last:border-b-0 dark:border-slate-800">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </div>
        {detail ? (
          <div className="mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-500">
            {detail}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[state]}`}
          aria-hidden="true"
        />
        <span className={`text-sm font-semibold tabular-nums ${TEXT[state]}`}>
          {value}
        </span>
      </div>
    </div>
  )
}
