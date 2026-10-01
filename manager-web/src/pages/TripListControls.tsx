/**
 * Finding a trip, and taking the list away with you.
 *
 * WHAT THIS REPLACES: a table of "the newest 50", filtered in the browser. A
 * trip older than those 50 - a long run, last week's delivery - could not be
 * reached, searched or exported at all. Every control here is applied by the
 * SERVER (`search`, `trip_status`, `driver_id`, `truck_id`, `open_only`,
 * `limit`, `cursor`), so the answer covers the whole fleet and not a window
 * of it.
 *
 * Attention is the one filter applied in the browser, and it says so: it is
 * derived from status + whether a route is selected (and whether a driver's
 * reroute request is waiting), which the server does not index. It narrows the page you are looking at, not the whole set, so it is
 * disabled while "All" is not loaded and the export label changes with it.
 */

import { useId, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Download, Printer, Search } from 'lucide-react'

import type { Driver, Truck } from '../api/client'
import { Button } from '../components/ui'
import { REROUTE_ASKED } from './tripExport'

export type PageSize = 20 | 50 | 100 | 'ALL'
export const PAGE_SIZES: PageSize[] = [20, 50, 100, 'ALL']
/** One request may return at most 100 rows (the API's own cap), and "All"
 *  walks pages until this many. A console that tries to draw an unbounded
 *  table freezes the tab; saying the ceiling is better than hitting it. */
export const ALL_LIMIT = 1000

export const STATUSES = [
  'DRAFT', 'ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED', 'DELIVERED', 'CLOSED', 'CANCELLED',
] as const

export const ATTENTION_FILTERS = [
  'Needs a route',
  'Ready to dispatch',
  'Awaiting driver',
  'Accepted — awaiting start',
  'Truck check pending',
  'On the road',
  REROUTE_ASKED,
  'Delayed',
  'Incident open',
  'Close to release the truck',
] as const

export interface TripFilters {
  search: string
  status: string
  attention: string
  driverId: string
  truckId: string
  /** 'OPEN' | 'HISTORY'. Two lists, because a closed trip has no actions. */
  scope: 'OPEN' | 'HISTORY'
}

export const EMPTY_FILTERS: TripFilters = {
  search: '', status: '', attention: '', driverId: '', truckId: '', scope: 'OPEN',
}

export function activeFilterCount(f: TripFilters): number {
  return [f.search.trim(), f.status, f.attention, f.driverId, f.truckId].filter(Boolean).length
}

/** The filters in words, for the report header and the export label. */
export function describeFilters(
  f: TripFilters,
  names: { driver: (id: string) => string; truck: (id: string) => string },
): string {
  const parts = [f.scope === 'OPEN' ? 'Open trips' : 'History']
  if (f.search.trim()) parts.push(`search "${f.search.trim()}"`)
  if (f.status) parts.push(`status ${f.status}`)
  if (f.attention) parts.push(`attention ${f.attention}`)
  if (f.driverId) parts.push(`driver ${names.driver(f.driverId)}`)
  if (f.truckId) parts.push(`truck ${names.truck(f.truckId)}`)
  return parts.join(' · ')
}

/** A filter control: the console's 44px field, outlined so it reads as one you may change. */
const FIELD = 'rounded-[var(--radius-control)] border border-outline bg-surface px-3 text-[13px] text-ink focus:border-route'
const SCOPES = [
  ['OPEN', 'Open Trips', 'Everything still being worked'],
  ['HISTORY', 'Trip History', 'Closed and cancelled — read-only'],
] as const

export interface TripListControlsProps {
  filters: TripFilters
  onFilters: (next: TripFilters) => void
  drivers: Driver[]
  trucks: Truck[]
  pageSize: PageSize
  onPageSize: (size: PageSize) => void
  /** 1-based, of however many the total implies. */
  page: number
  total: number | null
  /** Rows on screen now - what "Export current page" would write. */
  shown: number
  canPrevious: boolean
  canNext: boolean
  onPrevious: () => void
  onNext: () => void
  busy: boolean
  onExportCsv: () => void
  onExportPdf: () => void
  exporting: boolean
  exportNote: string | null
}

export function TripListControls(p: TripListControlsProps) {
  const id = useId()
  const count = activeFilterCount(p.filters)
  const set = (patch: Partial<TripFilters>) => p.onFilters({ ...p.filters, ...patch })
  const pages = p.total !== null && p.pageSize !== 'ALL' ? Math.max(1, Math.ceil(p.total / p.pageSize)) : null
  const scope = SCOPES.find(([key]) => key === p.filters.scope) ?? SCOPES[0]
  const choose = (next: TripFilters['scope']) => set({ scope: next, status: '' })
  // The tablist's own keys (WAI-ARIA tabs): one Tab stop, arrows move and select.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const target = e.key === 'Home' ? 'OPEN' : e.key === 'End' ? 'HISTORY' : p.filters.scope === 'OPEN' ? 'HISTORY' : 'OPEN'
    choose(target)
    document.getElementById(`${id}-tab-${target}`)?.focus()
  }
  const noRows = p.shown === 0 ? 'No trips to export' : undefined

  return (
    <div className="space-y-3" data-testid="trip-list-controls">
      {/* Two lists, not a status that happens to mean "finished". A closed
          trip has no dispatch and no cancel, so it does not belong beside one
          that does. The tabs are the card's title, as on the Overview. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="sr-only">Trip list</h2>
          <div className="flex gap-5" role="tablist" aria-label="Trip list">
            {SCOPES.map(([key, label]) => (
              <button
                key={key}
                id={`${id}-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={p.filters.scope === key}
                tabIndex={p.filters.scope === key ? 0 : -1}
                onKeyDown={onTabKey}
                className={`-mb-px border-b-2 pb-0.5 font-display text-base font-bold leading-tight ${
                  p.filters.scope === key ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
                onClick={() => choose(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[13px] leading-[18px] text-muted">{scope[2]}</p>
        </div>
        {/* Says WHAT it writes, so nobody has to guess whether the file is
            the page or the search. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" busy={p.exporting} disabled={p.exporting || p.shown === 0} title={noRows} onClick={p.onExportCsv}>
            {p.exporting ? null : <Download className="size-4" aria-hidden="true" />}Export CSV
          </Button>
          <Button variant="secondary" size="sm" busy={p.exporting} disabled={p.exporting || p.shown === 0} title={noRows} onClick={p.onExportPdf}>
            {p.exporting ? null : <Printer className="size-4" aria-hidden="true" />}Export PDF
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${id}-search`}>Search trips</label>
        <span className="relative min-w-[13rem] flex-[2_1_16rem]">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            id={`${id}-search`}
            className={`${FIELD} w-full pl-9 placeholder:text-muted`}
            placeholder="Search trip code or client"
            value={p.filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </span>

        <label className="sr-only" htmlFor={`${id}-status`}>Filter by status</label>
        <select id={`${id}-status`} className={`${FIELD} flex-1`} value={p.filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.filter((s) => (p.filters.scope === 'HISTORY') === ['DELIVERED', 'CLOSED', 'CANCELLED'].includes(s)).map((s) => (
            <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`${id}-attention`}>Filter by attention</label>
        <select id={`${id}-attention`} className={`${FIELD} flex-1`} value={p.filters.attention} onChange={(e) => set({ attention: e.target.value })}>
          <option value="">All attention</option>
          {ATTENTION_FILTERS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        {p.drivers.length > 0 ? (
          <>
            <label className="sr-only" htmlFor={`${id}-driver`}>Filter by driver</label>
            <select id={`${id}-driver`} className={`${FIELD} flex-1`} value={p.filters.driverId} onChange={(e) => set({ driverId: e.target.value })}>
              <option value="">All drivers</option>
              {p.drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </>
        ) : null}

        {p.trucks.length > 0 ? (
          <>
            <label className="sr-only" htmlFor={`${id}-truck`}>Filter by truck</label>
            <select id={`${id}-truck`} className={`${FIELD} flex-1`} value={p.filters.truckId} onChange={(e) => set({ truckId: e.target.value })}>
              <option value="">All trucks</option>
              {p.trucks.map((t) => <option key={t.id} value={t.id}>{t.registration_number}</option>)}
            </select>
          </>
        ) : null}

        {count > 0 ? (
          <Button variant="secondary" onClick={() => p.onFilters({ ...EMPTY_FILTERS, scope: p.filters.scope })}>
            Clear filters ({count})
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
        <span className="tnum" data-testid="trip-count">
          {p.busy
            ? 'Loading…'
            : p.total === null
              ? `${p.shown} shown`
              : `${p.shown} shown of ${p.total} matching${pages ? ` · page ${p.page} of ${pages}` : ''}`}
          {p.filters.attention ? ' · attention filter narrows this page only' : ''}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2" htmlFor={`${id}-size`}>
            <span>Rows per page</span>
            <select
              id={`${id}-size`}
              className={FIELD}
              value={String(p.pageSize)}
              onChange={(e) => p.onPageSize(e.target.value === 'ALL' ? 'ALL' : (Number(e.target.value) as PageSize))}
            >
              {PAGE_SIZES.map((s) => <option key={String(s)} value={String(s)}>{s === 'ALL' ? `All (max ${ALL_LIMIT})` : s}</option>)}
            </select>
          </label>
          <Button variant="secondary" className="px-3" disabled={!p.canPrevious || p.busy} title={p.busy ? 'Loading this page' : !p.canPrevious ? 'Already on the first page' : undefined} onClick={p.onPrevious}>
            <ChevronLeft className="size-4" aria-hidden="true" />Previous
          </Button>
          <Button variant="secondary" className="px-3" disabled={!p.canNext || p.busy} title={p.busy ? 'Loading this page' : !p.canNext ? 'This is the last page' : undefined} onClick={p.onNext}>
            Next<ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {p.exportNote ? <p className="text-[13px] text-muted" role="status" data-testid="export-note">{p.exportNote}</p> : null}
    </div>
  )
}
