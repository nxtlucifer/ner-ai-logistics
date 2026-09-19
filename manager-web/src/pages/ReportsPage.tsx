/**
 * Reports, built from the rows this caller may already read.
 *
 * WHY THERE IS NO REPORTING ENDPOINT
 *
 * There does not need to be one. `/api/trips` is already scoped by
 * `app/core/scope.py`, so a report assembled from its pages cannot contain a
 * row the caller could not have opened in the Trips table. Adding a second
 * data path for reporting would mean a second place for the scope rule to be
 * got wrong, and the first sign of that would be a district manager's PDF
 * containing another district's work.
 *
 * WHAT IS COUNTED
 *
 * Trips, by status and by direction. Nothing else: the project has no
 * ground truth for utilisation, cost per kilometre or on-time performance,
 * and a report that invents them is worse than a short one - somebody will
 * put it in front of a ministry.
 *
 * The CSV and the print view reuse `tripExport.ts`, so a report and an
 * export of the same filter cannot disagree about what a row says.
 */

import { useCallback, useState, type ReactNode } from 'react'
import { Archive, Ban, Download, FilePen, FileText, PackageCheck, Printer, Route, TriangleAlert, type LucideIcon } from 'lucide-react'

import { api, type Dashboard, type Trip } from '../api/client'
import { useResource } from '../hooks/useResource'
import { KpiCard, type KpiTone } from '../components/KpiCard'
import { ErrorState, LoadingState, Panel } from '../components/ui'
import { ActionButton, PageHeader, Quiet, TD, TH, TR } from '../components/pageKit'
import { ALL_LIMIT } from './TripListControls'
import { attention, downloadCsv, exportRow, NOT_RECORDED, printReport, reportHtml } from './tripExport'

/** Statuses grouped the way a report reads them. */
const GROUPS: [string, string[]][] = [
  ['Under way', ['ASSIGNED', 'VERIFICATION_PENDING', 'MANAGER_REVIEW', 'ACTIVE']],
  ['Needing attention', ['DELAYED', 'INCIDENT']],
  ['Delivered', ['DELIVERED']],
  ['Closed', ['CLOSED']],
  ['Cancelled', ['CANCELLED']],
  ['Draft', ['DRAFT']],
]

/** How each group's card reads: its glyph, its tone when above zero, and what it counts. */
const LOOK: Record<string, { icon: LucideIcon; tone: KpiTone; hint: string }> = {
  'Under way': { icon: Route, tone: 'plain', hint: 'Assigned, being checked, in review or active' },
  'Needing attention': { icon: TriangleAlert, tone: 'danger', hint: 'Delayed or incident' },
  Delivered: { icon: PackageCheck, tone: 'plain', hint: 'Delivered, not yet closed' },
  Closed: { icon: Archive, tone: 'plain', hint: 'Closed and released' },
  Cancelled: { icon: Ban, tone: 'plain', hint: 'Cancelled before delivery' },
  Draft: { icon: FilePen, tone: 'plain', hint: 'Planned, not dispatched' },
}

/** As the Trips export names a row it has no name for: the id's first eight. */
const idFragment = (id: string | null | undefined): string => (id ? id.slice(0, 8) : NOT_RECORDED)

export function summarise(trips: Trip[]): { label: string; count: number }[] {
  return GROUPS.map(([label, statuses]) => ({
    label,
    count: trips.filter((t) => statuses.includes(t.status)).length,
  }))
}

export default function ReportsPage() {
  const overview = useResource<Dashboard>(() => api.dashboard(), [], 'dashboard')
  const [rows, setRows] = useState<Trip[] | null>(null)
  // Who drove what, for the export's Driver and Truck columns: the same two
  // lists, and the same fallback, as the Trips export (REPORT-1). A blank
  // cell read as "no driver" on a trip that had one.
  const [names, setNames] = useState<{ drivers: Map<string, string>; trucks: Map<string, string> }>(() => ({
    drivers: new Map(),
    trucks: new Map(),
  }))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  /** Every page of the caller's own scope, to the same ceiling the Trips
   *  export uses. The server decides what "own scope" means. */
  const gather = useCallback(async (): Promise<Trip[]> => {
    const items: Trip[] = []
    let cursor: string | undefined
    do {
      const page = await api.listTrips({ limit: 100, cursor })
      items.push(...page.items)
      cursor = page.next_cursor ?? undefined
    } while (cursor && items.length < ALL_LIMIT)
    return items
  }, [])

  const run = useCallback(async () => {
    setBusy(true)
    setNote(null)
    try {
      const [all, drivers, trucks] = await Promise.all([
        gather(),
        api.listDrivers({ limit: 100 }),
        api.listTrucks({ limit: 100 }),
      ])
      setNames({
        drivers: new Map(drivers.items.map((d) => [d.id, d.full_name])),
        trucks: new Map(trucks.items.map((t) => [t.id, t.registration_number])),
      })
      setRows(all)
      setNote(
        all.length >= ALL_LIMIT
          ? `Showing the first ${ALL_LIMIT} trips in your scope. Narrow the period in Trips for a smaller set.`
          : `${all.length} trips in your scope.`,
      )
    } catch (error) {
      setNote(`Could not build the report: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [gather])

  const header = (meta: string, actions?: ReactNode, blocker?: string | null) => (
    <PageHeader
      title="Reports"
      meta={meta}
      actions={actions}
      note={blocker ? <span data-testid="export-blocker" role="status">{blocker}</span> : null}
    />
  )
  if (overview.error) return <div className="flex flex-col gap-[14px]">{header('Counted from rows you may read.')}<ErrorState error={overview.error} onRetry={overview.reload} /></div>
  if (!overview.data) return <div className="flex flex-col gap-[14px]">{header('Counted from rows you may read.')}<LoadingState label="Loading" /></div>

  const d = overview.data
  const exported = (rows ?? []).map((t) =>
    exportRow(t, {
      driver: names.drivers.get(t.driver_id) ?? idFragment(t.driver_id),
      truck: names.trucks.get(t.truck_id) ?? idFragment(t.truck_id),
      attention: attention(t).text,
    }),
  )
  // Said on the buttons and under them: a greyed control with no reason
  // reads as broken.
  const exportBlocked = !rows
    ? 'Build the report first — Export CSV and Print / PDF use its rows.'
    : rows.length === 0
      ? 'Nothing to export — no trips in your scope.'
      : null
  const failed = note?.startsWith('Could not build') ?? false
  const noteLine = (className: string) =>
    note ? (
      <p data-testid="report-note" role={failed ? 'alert' : undefined} className={`text-sm ${failed ? 'font-semibold text-danger' : 'text-muted'} ${className}`}>
        {note}
      </p>
    ) : null

  return (
    <div className="flex flex-col gap-[14px]">
      {header(
        `${d.scope_label} · counted from rows you may read, at the moment you build it.`,
        <>
          <ActionButton variant="primary" icon={FileText} onClick={() => void run()} busy={busy}>
            {busy ? 'Building…' : rows ? 'Rebuild' : 'Build report'}
          </ActionButton>
          <ActionButton
            icon={Download}
            disabled={exportBlocked !== null}
            title={exportBlocked ?? undefined}
            onClick={() =>
              downloadCsv(exported, `rasta-report-${new Date().toISOString().slice(0, 10)}.csv`)
            }
          >
            Export CSV
          </ActionButton>
          <ActionButton
            icon={Printer}
            disabled={exportBlocked !== null}
            title={exportBlocked ?? undefined}
            onClick={() =>
              printReport(
                reportHtml(exported, {
                  title: `RASTA AI · ${d.scope_label}`,
                  // The scope IS the filter here, and saying so on the
                  // page stops a district report being read as regional.
                  filters: `Scope: ${d.scope_label}`,
                  generated: new Date().toLocaleString(),
                  note: note ?? undefined,
                }),
              )
            }
          >
            Print / PDF
          </ActionButton>
        </>,
        exportBlocked,
      )}

      {!rows ? (
        <Panel title="Trip Report" subtitle="Built from the trips you can already open in the Trips table — the same scope, the same rows.">
          <Quiet icon={FileText} title={busy ? 'Building the report…' : 'No report built yet'}>
            Build report counts every trip in your scope by status. Nothing here is estimated: every figure is a count.
          </Quiet>
          {noteLine('pb-2 text-center')}
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-base font-bold text-ink">Trips by Status</h2>
            {noteLine('')}
          </div>
          {/* Counts of the rows just gathered - every card is a count, none a rate. */}
          <div className="grid gap-[13px] sm:grid-cols-2 xl:grid-cols-3">
            {summarise(rows).map((s) => (
              <KpiCard key={s.label} label={s.label} value={s.count} icon={LOOK[s.label].icon} tone={LOOK[s.label].tone} hint={LOOK[s.label].hint} />
            ))}
          </div>
        </>
      )}

      {rows && (d.states.length > 0 || d.districts.length > 0) ? (
        <div className={`grid gap-[13px] ${d.states.length > 0 && d.districts.length > 0 ? 'lg:grid-cols-2' : ''}`}>
          {/* Not the cards' words: the dashboard counts a delayed or incident
              trip as under way too (dashboard.py UNDER_WAY), and a trip in
              each state it touches. The headers say so rather than reuse
              "Under way" for a different number. */}
          {d.states.length > 0 ? (
            <Panel title="By State" subtitle="From the dashboard read when this page opened · under way here includes delayed and incident trips · a trip between two states is counted in each">
              <div className="relative -mx-4 overflow-x-auto px-4">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className={TH}>State</th>
                      <th className={TH}>Under way, incl. delayed</th>
                      <th className={TH}>Delayed or incident</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.states.map((s) => (
                      <tr key={s.state_id} className={TR}>
                        <td className={`${TD} font-medium text-ink`}>{s.name}</td>
                        <td className={`${TD} tnum text-ink`}>{s.trips_under_way}</td>
                        <td className={`${TD} tnum ${s.trips_needing_attention > 0 ? 'font-semibold text-danger' : 'text-ink'}`}>{s.trips_needing_attention}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          {d.districts.length > 0 ? (
            <Panel title="By District" subtitle="Trips under way (delayed or incident included) arriving in and leaving each district">
              <div className="relative -mx-4 overflow-x-auto px-4">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className={TH}>District</th>
                      <th className={TH}>Incoming</th>
                      <th className={TH}>Outgoing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.districts.map((row) => (
                      <tr key={row.district_id} className={TR}>
                        <td className={`${TD} font-medium text-ink`}>{row.name}</td>
                        <td className={`${TD} tnum text-ink`}>{row.incoming}</td>
                        <td className={`${TD} tnum text-ink`}>{row.outgoing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
