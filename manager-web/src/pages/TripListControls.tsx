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
 * derived from status + whether a route is selected, which the server does not
 * index. It narrows the page you are looking at, not the whole set, so it is
 * disabled while "All" is not loaded and the export label changes with it.
 */

import { useId } from 'react'

import type { Driver, Truck } from '../api/client'
import { Button } from '../components/ui'

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
  'Truck check pending',
  'On the road',
  'Delayed',
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

const FIELD = 'rounded-[10px] border border-line bg-surface px-2 py-1.5 text-xs text-ink'

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

  return (
    <div className="space-y-2" data-testid="trip-list-controls">
      {/* Two lists, not a status that happens to mean "finished". A closed
          trip has no dispatch and no cancel, so it does not belong beside one
          that does. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-[10px] border border-line p-0.5" role="tablist" aria-label="Trip list">
          {(['OPEN', 'HISTORY'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={p.filters.scope === scope}
              className={`min-h-9 rounded-[8px] px-3 text-xs font-semibold ${p.filters.scope === scope ? 'bg-primary text-white' : 'text-muted'}`}
              onClick={() => set({ scope, status: '' })}
            >
              {scope === 'OPEN' ? 'Open trips' : 'History'}
            </button>
          ))}
        </div>

        <label className="sr-only" htmlFor={`${id}-search`}>Search trips</label>
        <input
          id={`${id}-search`}
          className={`${FIELD} min-w-[13rem] flex-1`}
          placeholder="Search trip code or client"
          value={p.filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />

        <label className="sr-only" htmlFor={`${id}-status`}>Filter by status</label>
        <select id={`${id}-status`} className={FIELD} value={p.filters.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.filter((s) => (p.filters.scope === 'HISTORY') === ['DELIVERED', 'CLOSED', 'CANCELLED'].includes(s)).map((s) => (
            <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`${id}-attention`}>Filter by attention</label>
        <select id={`${id}-attention`} className={FIELD} value={p.filters.attention} onChange={(e) => set({ attention: e.target.value })}>
          <option value="">All attention</option>
          {ATTENTION_FILTERS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        {p.drivers.length > 0 ? (
          <>
            <label className="sr-only" htmlFor={`${id}-driver`}>Filter by driver</label>
            <select id={`${id}-driver`} className={FIELD} value={p.filters.driverId} onChange={(e) => set({ driverId: e.target.value })}>
              <option value="">All drivers</option>
              {p.drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </>
        ) : null}

        {p.trucks.length > 0 ? (
          <>
            <label className="sr-only" htmlFor={`${id}-truck`}>Filter by truck</label>
            <select id={`${id}-truck`} className={FIELD} value={p.filters.truckId} onChange={(e) => set({ truckId: e.target.value })}>
              <option value="">All trucks</option>
              {p.trucks.map((t) => <option key={t.id} value={t.id}>{t.registration_number}</option>)}
            </select>
          </>
        ) : null}

        {count > 0 ? (
          <Button variant="secondary" className="min-h-9 px-2 py-1 text-xs" onClick={() => p.onFilters({ ...EMPTY_FILTERS, scope: p.filters.scope })}>
            Clear filters ({count})
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="tnum" data-testid="trip-count">
          {p.busy
            ? 'Loading…'
            : p.total === null
              ? `${p.shown} shown`
              : `${p.shown} shown of ${p.total} matching${pages ? ` · page ${p.page} of ${pages}` : ''}`}
          {p.filters.attention ? ' · attention filter narrows this page only' : ''}
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1" htmlFor={`${id}-size`}>
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
          <Button variant="secondary" className="min-h-9 px-2 py-1 text-xs" disabled={!p.canPrevious || p.busy} onClick={p.onPrevious}>Previous</Button>
          <Button variant="secondary" className="min-h-9 px-2 py-1 text-xs" disabled={!p.canNext || p.busy} onClick={p.onNext}>Next</Button>
          {/* Says WHAT it writes, so nobody has to guess whether the file is
              the page or the search. */}
          <Button variant="secondary" className="min-h-9 px-2 py-1 text-xs" busy={p.exporting} disabled={p.exporting || p.shown === 0} onClick={p.onExportCsv}>Export CSV</Button>
          <Button variant="secondary" className="min-h-9 px-2 py-1 text-xs" busy={p.exporting} disabled={p.exporting || p.shown === 0} onClick={p.onExportPdf}>Export PDF</Button>
        </div>
      </div>
      {p.exportNote ? <p className="text-[11px] text-muted" data-testid="export-note">{p.exportNote}</p> : null}
    </div>
  )
}
