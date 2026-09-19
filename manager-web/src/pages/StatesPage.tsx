/**
 * The eight states, and what is actually configured under each.
 *
 * WHY THE COUNTS ARE THE POINT
 *
 * A district list is a government notification, not a fact about software,
 * and this project has not been able to verify one. So this page shows what
 * IS configured and says plainly when that is nothing - rather than an empty
 * table that reads as a broken screen, or a plausible list that would be
 * indistinguishable from a gazette.
 *
 * Regional roles only. A state manager does not need a map of eight states
 * to do their job, and a district manager certainly does not.
 */

import { useState } from 'react'
import { ChevronDown, Hourglass, Map as MapIcon, MapPin, MapPinned } from 'lucide-react'

import { api, type DistrictRow, type StateRow } from '../api/client'
import { useResource } from '../hooks/useResource'
import { KpiCard } from '../components/KpiCard'
import { ErrorState, LoadingState, Panel } from '../components/ui'
import { InlineError, PageHeader, Quiet, STACK, TH } from '../components/pageKit'

export default function StatesPage() {
  const states = useResource(() => api.listStates(), [], 'org:states')
  const [openState, setOpenState] = useState<StateRow | null>(null)
  const districts = useResource<DistrictRow[]>(
    () => (openState ? api.listDistricts(openState.id) : Promise.resolve([])),
    [openState?.id ?? ''],
    openState ? `org:districts:${openState.id}` : undefined,
  )

  const header = (
    <PageHeader
      title="States and Districts"
      meta="The region as the system knows it. A district is only counted where its source can be named."
    />
  )
  if (states.error) return <div className="flex flex-col gap-[14px]">{header}<ErrorState error={states.error} onRetry={states.reload} /></div>
  if (!states.data) return <div className="flex flex-col gap-[14px]">{header}<LoadingState label="Loading states" /></div>

  const configured = states.data.reduce((n, s) => n + s.district_count, 0)
  const pending = states.data.filter((s) => s.district_count === 0).length
  const toggle = (s: StateRow) => setOpenState(openState?.id === s.id ? null : s)

  return (
    <div className="flex flex-col gap-[14px]">
      {header}

      {/* Every figure is a count of the rows below - nothing measured elsewhere.
          "On file", not "verified": the server counts verified AND demo rows
          (OPERATIONAL_SOURCES), and a demo row is labelled as one below. */}
      <div className="grid gap-[13px] sm:grid-cols-3">
        <KpiCard label="States" icon={MapIcon} value={states.data.length} hint="In the North Eastern Region list" />
        <KpiCard label="Districts on file" icon={MapPinned} value={configured} hint="Verified or demo; each row names its source" />
        <KpiCard label="Lists pending" icon={Hourglass} tone="warning" value={pending} hint="States with no district directory on file yet" />
      </div>

      <Panel
        title="North Eastern Region"
        subtitle={`${states.data.length} states · ${configured} districts on file · choose a state to see its districts`}
      >
        <div className="relative -mx-4 overflow-x-auto px-4">
          {/* Stacked on a phone like the other directory tables: the source is a
              long sentence, and a sideways-scrolling row hid it. */}
          <table className={STACK.table}>
            <thead className={STACK.head}>
              <tr>
                <th className={TH}>State</th>
                <th className={TH}>Districts on file</th>
                <th className={`${TH} min-w-[18rem]`}>Source</th>
              </tr>
            </thead>
            <tbody className={STACK.body}>
              {states.data.map((s) => {
                const open = openState?.id === s.id
                return (
                  <tr
                    key={s.id}
                    aria-selected={open}
                    onClick={() => toggle(s)}
                    className={`${STACK.row} cursor-pointer ${open ? 'bg-soft' : 'hover:bg-soft'}`}
                  >
                    <td className={STACK.cell} data-label="State">
                      {/* The row answers a click; the button is the same action for a keyboard. */}
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={open ? 'state-districts' : undefined}
                        onClick={(e) => { e.stopPropagation(); toggle(s) }}
                        className="-mx-1 inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-1 text-left font-semibold text-ink max-md:whitespace-normal"
                      >
                        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                        {s.name}
                      </button>
                    </td>
                    <td className={STACK.cell} data-label="Districts on file">
                      {s.district_count > 0 ? (
                        <span className="tnum font-semibold text-ink">{s.district_count}</span>
                      ) : (
                        // Not "0". Zero reads as a measurement; this is an
                        // absence of one.
                        <span className="whitespace-nowrap text-warning max-md:whitespace-normal">Official district list pending</span>
                      )}
                    </td>
                    <td className={`${STACK.cellWide} text-xs text-muted`} data-label="Source">{s.source_name}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {openState ? (
        <div id="state-districts">
          <Panel title={`${openState.name} · Districts`} subtitle="Each with the source it is counted from">
            {districts.error ? (
              <InlineError what="Districts could not be loaded" error={districts.error} onRetry={districts.reload} />
            ) : !districts.data ? (
              <LoadingState label="Loading districts" />
            ) : districts.data.length === 0 ? (
              <Quiet icon={MapPin} title="No verified district directory has been loaded for this state yet">
                A district list is a government notification, and none has been verified for this deployment. Trips and managers still work; they simply carry no district, and nothing is counted that cannot be sourced.
              </Quiet>
            ) : (
              <ul className="flex flex-col">
                {districts.data.map((d) => (
                  <li
                    key={d.id}
                    className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-2 text-sm first:border-t-0"
                  >
                    <span className="font-medium text-ink">{d.name}</span>
                    <span className="text-[13px] text-muted">
                      {d.disputed_or_recently_changed ? (
                        <span className="text-warning">Recently changed or disputed · </span>
                      ) : null}
                      {d.source_status === 'DEMO' ? 'Demo · ' : ''}
                      {d.source_name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  )
}
