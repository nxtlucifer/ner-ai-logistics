/**
 * One headline figure, in the dashboard's card (manager_03): a 64px tinted
 * icon tile, the label, the figure, the definition under it, and a caption
 * figure that opens its own rows.
 *
 * No trend and no sparkline. Nothing here keeps history, so a "+12%" would
 * be invented. The figure is the status.
 *
 * Two links, never nested: the figure opens the rows it counts, the caption
 * opens the rows IT counts. A card that wrapped both in one link would make
 * the caption unreachable.
 */

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

export type KpiTone = 'plain' | 'warning' | 'danger'

// The tile carries the tone at rest; a number only turns colour when there
// is something to look at. A permanently red zero teaches people to stop
// seeing red.
const TILE: Record<KpiTone, string> = {
  plain: 'bg-primary-soft text-primary',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
}
const LIVE: Record<KpiTone, string> = { plain: 'text-ink', warning: 'text-warning', danger: 'text-danger' }

const coloured = (tone: KpiTone, value: number | string) =>
  typeof value === 'number' && value > 0 ? LIVE[tone] : 'text-ink'

export interface KpiCaption {
  /** The caption's own figure, shown in the words: "2 awaiting a route". */
  value: number
  text: string
  to?: string
  tone?: KpiTone
  /** What the caption figure counts, as a sub-line. */
  hint?: string
}

export function KpiCard({
  label,
  value,
  suffix,
  of,
  icon: Icon,
  tone = 'plain',
  to,
  hint,
  caption,
  footnote,
}: {
  label: string
  /** A count, or an em dash where there is nothing to measure. Never a zero standing in for an absence. */
  value: number | string
  /** Unit after the figure (%). */
  suffix?: string
  /** "of N", when the figure is part of a whole. */
  of?: number
  icon: LucideIcon
  tone?: KpiTone
  /** Where the figure's rows are. */
  to?: string
  /** What the figure counts, in words. */
  hint?: string
  caption?: KpiCaption | null
  /** Free text under the figure when there is no caption figure. */
  footnote?: ReactNode
}) {
  const figure = (
    <>
      <span className="block text-sm font-semibold leading-tight text-ink">{label}</span>
      <span className="mt-0.5 flex items-baseline gap-1.5">
        {/* tnum: these refresh on a poll; proportional digits would twitch. */}
        <span className={`tnum font-display text-[28px] font-bold leading-none ${coloured(tone, value)}`}>
          {value}
          {suffix ? <span className="text-[18px] font-semibold">{suffix}</span> : null}
        </span>
        {of !== undefined ? <span className="tnum text-sm text-muted">of {of}</span> : null}
      </span>
    </>
  )
  return (
    <div
      data-testid="kpi-card"
      className="flex min-w-0 items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-2.5 shadow-[var(--shadow-card)]"
    >
      <span aria-hidden="true" className={`grid size-16 shrink-0 place-items-center rounded-[10px] ${TILE[tone]}`}>
        <Icon className="size-7" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        {to ? (
          <Link to={to} className="-m-1 block rounded-[var(--radius-control)] p-1 hover:bg-soft">
            {figure}
          </Link>
        ) : (
          <div>{figure}</div>
        )}
        {hint ? <p className="text-[11.5px] leading-[14px] text-faint">{hint}</p> : null}
        {caption ? (
          <p className="mt-0.5 text-[13px] leading-4">
            {caption.to ? (
              <Link
                to={caption.to}
                className={`-my-1 inline-block py-1 font-semibold underline-offset-2 hover:underline ${coloured(caption.tone ?? 'plain', caption.value)}`}
              >
                <span className="tnum">{caption.value}</span> {caption.text}
              </Link>
            ) : (
              <span className={`font-semibold ${coloured(caption.tone ?? 'plain', caption.value)}`}>
                <span className="tnum">{caption.value}</span> {caption.text}
              </span>
            )}
            {caption.hint ? <span className="block text-[11.5px] leading-[14px] text-faint">{caption.hint}</span> : null}
          </p>
        ) : null}
        {footnote ? <p className="mt-1 text-[13px] leading-4 text-muted">{footnote}</p> : null}
      </div>
    </div>
  )
}
