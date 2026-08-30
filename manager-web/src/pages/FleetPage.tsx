/**
 * Fleet operations: where every truck on the road is, right now.
 *
 * Polling, not WebSockets. There is no authenticated realtime transport in this
 * codebase, and building one to avoid a ten-second poll would be a subsystem
 * with its own auth, reconnection and backpressure problems - for a dashboard
 * where correct polling is indistinguishable to the operator. One loop feeds
 * the map, the list, the counts and the filters (see useFleetPoll).
 *
 * TWO RULES THIS SCREEN KEEPS
 *
 * Freshness is the SERVER'S. LIVE / STALE / NO CONTACT / NO LOCATION and the
 * threshold behind them arrive with the data. Nothing here recomputes them,
 * because a client that decided for itself what "live" meant would eventually
 * disagree with the system a dispatcher is acting on.
 *
 * Nothing is invented. A truck that has never reported is listed and counted
 * but not plotted; there is no ETA, because routing does not exist yet; and
 * every field in the detail panel is a value the API returned.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  api,
  type Driver,
  type FleetTrip,
  type Freshness,
  type Position,
  type TripDetail,
  type Truck,
} from '../api/client'
const FleetMap = lazy(() => import('../components/FleetMap'))
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusPill,
} from '../components/ui'
import { useFleetPoll } from '../hooks/useFleetPoll'

const FRESHNESS_ORDER: Freshness[] = [
  'LIVE',
  'STALE',
  'NO_CONTACT',
  'NO_LOCATION',
]

const FRESHNESS_STYLE: Record<Freshness, { label: string; className: string }> = {
  LIVE: { label: 'LIVE', className: 'border-emerald-700 bg-emerald-950 text-emerald-300' },
  STALE: { label: 'STALE', className: 'border-amber-800 bg-amber-950 text-amber-300' },
  NO_CONTACT: { label: 'NO CONTACT', className: 'border-red-800 bg-red-950 text-red-300' },
  NO_LOCATION: { label: 'NO LOCATION', className: 'border-slate-700 bg-slate-800 text-slate-400' },
}

function age(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

function FreshnessPill({ freshness }: { freshness: Freshness }) {
  const style = FRESHNESS_STYLE[freshness] ?? FRESHNESS_STYLE.NO_LOCATION
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${style.className}`}
    >
      {style.label}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-800 py-2 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-right text-xs font-medium text-slate-200">{value}</span>
    </div>
  )
}

/**
 * Everything known about one selected trip.
 *
 * Fetched on SELECTION, not on every poll: the driver's phone number and the
 * truck's details are not something to pull into a list that refreshes every
 * ten seconds, and the track is bounded history that only matters for the trip
 * being looked at.
 */
interface Selection {
  trip: TripDetail | null
  driver: Driver | null
  truck: Truck | null
  track: Position[]
  trackTruncated: boolean
  isLoading: boolean
  error: unknown
}

const EMPTY_SELECTION: Selection = {
  trip: null,
  driver: null,
  truck: null,
  track: [],
  trackTruncated: false,
  isLoading: false,
  error: null,
}

function useSelectionDetail(row: FleetTrip | null): Selection {
  const [state, setState] = useState<Selection>(EMPTY_SELECTION)
  const requestId = useRef(0)

  // Keyed on the IDENTIFIERS, never on `row` itself. Every poll parses fresh
  // JSON, so an unchanged trip still arrives as a NEW object each tick; an
  // effect keyed on that object re-runs all four reads every ten seconds,
  // drops the panel back to "Loading trip details…" and blanks the map
  // breadcrumb underneath whoever is reading them. These three strings change
  // only when the selection does, which is the trigger this fetch actually
  // wants - and what the comment above already claimed it had.
  const tripId = row?.trip_id ?? null
  const driverId = row?.driver_id ?? null
  const truckId = row?.truck_id ?? null

  useEffect(() => {
    if (!tripId || !driverId || !truckId) {
      setState(EMPTY_SELECTION)
      return
    }
    const id = ++requestId.current
    setState({ ...EMPTY_SELECTION, isLoading: true })

    void (async () => {
      try {
        // In parallel: four small reads, none of them polled.
        const [trip, driver, truck, track] = await Promise.all([
          api.getTrip(tripId),
          api.getDriver(driverId),
          api.getTruck(truckId),
          api.tripTrack(tripId, 200),
        ])
        // Guards a slow earlier selection resolving after a newer one.
        if (id !== requestId.current) return
        setState({
          trip,
          driver,
          truck,
          track: track.points,
          trackTruncated: track.truncated,
          isLoading: false,
          error: null,
        })
      } catch (error) {
        if (id !== requestId.current) return
        setState({ ...EMPTY_SELECTION, error })
      }
    })()
  }, [tripId, driverId, truckId])

  return state
}

export default function FleetPage() {
  const fleet = useFleetPoll()
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Freshness | 'ALL'>('ALL')
  const [search, setSearch] = useState('')

  const trips = useMemo(() => fleet.snapshot?.trips ?? [], [fleet.snapshot])

  // Selection survives a refresh: the row is re-resolved from the newest
  // snapshot by id, so the panel updates in place rather than closing.
  const selectedRow = useMemo(
    () => trips.find((t) => t.trip_id === selectedTripId) ?? null,
    [trips, selectedTripId],
  )
  const detail = useSelectionDetail(selectedRow)

  // No effect clears a stale selection. A trip that finishes leaves the active
  // fleet, `selectedRow` resolves to null, and every consumer - panel, map
  // track, detail fetch - already derives from that. Nulling the id as well
  // would only add a render pass.

  const counts = useMemo(() => {
    const out: Record<Freshness, number> = {
      LIVE: 0,
      STALE: 0,
      NO_CONTACT: 0,
      NO_LOCATION: 0,
    }
    for (const trip of trips) out[trip.freshness] += 1
    return out
  }, [trips])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return trips.filter((trip) => {
      if (filter !== 'ALL' && trip.freshness !== filter) return false
      if (!needle) return true
      return (
        trip.registration_number.toLowerCase().includes(needle) ||
        trip.driver_name.toLowerCase().includes(needle) ||
        trip.trip_code.toLowerCase().includes(needle)
      )
    })
  }, [trips, filter, search])

  const select = useCallback((tripId: string) => {
    setSelectedTripId((current) => (current === tripId ? null : tripId))
  }, [])

  const stops = detail.trip?.stops ?? []
  const origin = stops.find((s) => s.kind === 'PICKUP') ?? stops[0]
  const destination =
    [...stops].reverse().find((s) => s.kind === 'DROPOFF') ?? stops[stops.length - 1]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Fleet</h1>
        <p className="text-xs text-slate-500">
          Trips on the road, with the last position each truck reported.
          {fleet.snapshot
            ? ` A position counts as live for ${fleet.snapshot.fresh_seconds} seconds after the server receives it.`
            : ''}
        </p>
      </div>

      {/* A failed poll is shown alongside the last good reading, never instead
          of it - one blip must not hide the fleet. */}
      {fleet.isStale ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-2 text-xs text-amber-300">
          <span>
            Could not refresh just now — showing the last successful reading.
            Retrying automatically.
          </span>
          <Button variant="secondary" onClick={fleet.refresh}>
            Retry now
          </Button>
        </div>
      ) : null}

      {fleet.isInitialising ? (
        <Card>
          <LoadingState label="Loading the fleet…" />
        </Card>
      ) : fleet.error && !fleet.snapshot ? (
        <Card>
          <ErrorState error={fleet.error} onRetry={fleet.refresh} />
        </Card>
      ) : (
        <>
          {/* Counts derived from the same snapshot the map and list use, so
              they cannot disagree with what is on screen. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <button
              type="button"
              aria-label="Show all active trips"
              aria-pressed={filter === 'ALL'}
              onClick={() => setFilter('ALL')}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                filter === 'ALL'
                  ? 'border-slate-500 bg-slate-800'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <div className="text-2xl font-bold text-slate-100">{trips.length}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Active trips
              </div>
            </button>
            {FRESHNESS_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                aria-label={`Filter by ${FRESHNESS_STYLE[key].label}`}
                aria-pressed={filter === key}
                onClick={() => setFilter((f) => (f === key ? 'ALL' : key))}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  filter === key
                    ? 'border-slate-500 bg-slate-800'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <div className="text-2xl font-bold text-slate-100">
                  {counts[key]}
                </div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {FRESHNESS_STYLE[key].label}
                </div>
              </button>
            ))}
          </div>

          <Suspense
            fallback={
              <div className="flex h-[460px] items-center justify-center rounded-xl border border-slate-800 bg-slate-900/60">
                <LoadingState label="Loading map…" />
              </div>
            }
          >
            <FleetMap
              trips={visible}
              selectedTripId={selectedTripId}
              onSelect={select}
              track={detail.track}
            />
          </Suspense>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card
                title="On the road"
                action={
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search registration, driver or trip"
                    className="w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
                  />
                }
              >
                {trips.length === 0 ? (
                  <EmptyState
                    title="No trips on the road"
                    description="Dispatch a trip on the Trips page, then start it from the driver app to see it here."
                  />
                ) : visible.length === 0 ? (
                  <EmptyState
                    title="Nothing matches"
                    description="No active trip matches this filter or search."
                    action={
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setFilter('ALL')
                          setSearch('')
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="pb-2 font-medium">Trip</th>
                          <th className="pb-2 font-medium">Driver / truck</th>
                          <th className="pb-2 font-medium">Contact</th>
                          <th className="pb-2 font-medium">Progress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((trip) => (
                          <tr
                            key={trip.trip_id}
                            onClick={() => select(trip.trip_id)}
                            aria-selected={trip.trip_id === selectedTripId}
                            className={`cursor-pointer border-t border-slate-800 align-top transition ${
                              trip.trip_id === selectedTripId
                                ? 'bg-slate-800/70'
                                : 'hover:bg-slate-900'
                            }`}
                          >
                            <td className="py-3">
                              <div className="font-medium text-slate-200">
                                {trip.trip_code}
                              </div>
                              <div className="mt-1">
                                <StatusPill status={trip.trip_status} />
                              </div>
                            </td>
                            <td className="py-3">
                              <div className="text-slate-300">{trip.driver_name}</div>
                              <div className="text-[11px] text-slate-500">
                                {trip.registration_number}
                              </div>
                            </td>
                            <td className="py-3">
                              <FreshnessPill freshness={trip.freshness} />
                              <div className="mt-1 text-[11px] text-slate-500">
                                {trip.position
                                  ? age(trip.position.age_seconds)
                                  : 'never reported'}
                              </div>
                            </td>
                            <td className="py-3 text-xs text-slate-400">
                              {trip.stops_done}/{trip.stops_total} stops
                              {trip.next_stop_name ? (
                                <div className="text-[11px] text-slate-500">
                                  next: {trip.next_stop_name}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            <Card title={selectedRow ? selectedRow.trip_code : 'Details'}>
              {!selectedRow ? (
                <EmptyState
                  title="No truck selected"
                  description="Choose a marker on the map or a row in the list."
                />
              ) : detail.isLoading ? (
                <LoadingState label="Loading trip details…" />
              ) : detail.error ? (
                <ErrorState error={detail.error} />
              ) : (
                <div className="space-y-4">
                  <div>
                    <FreshnessPill freshness={selectedRow.freshness} />
                    <div className="mt-3">
                      <Detail
                        label="Trip status"
                        value={<StatusPill status={selectedRow.trip_status} />}
                      />
                      <Detail
                        label="Started"
                        value={
                          selectedRow.started_at
                            ? new Date(selectedRow.started_at).toLocaleString()
                            : 'not started'
                        }
                      />
                      <Detail
                        label="Progress"
                        value={`${selectedRow.stops_done}/${selectedRow.stops_total} stops`}
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Driver
                    </h3>
                    <Detail label="Name" value={selectedRow.driver_name} />
                    {/* Rendered only when the API actually returned it - the
                        endpoint is permission-gated, so absence is a real
                        answer rather than a blank to fill in. */}
                    {detail.driver?.phone ? (
                      <Detail label="Phone" value={detail.driver.phone} />
                    ) : null}
                    {detail.driver ? (
                      <Detail
                        label="Driver status"
                        value={<StatusPill status={detail.driver.status} />}
                      />
                    ) : null}
                  </div>

                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Truck
                    </h3>
                    <Detail
                      label="Registration"
                      value={selectedRow.registration_number}
                    />
                    {detail.truck &&
                    (detail.truck.make || detail.truck.model || detail.truck.truck_type) ? (
                      <Detail
                        label="Type"
                        value={
                          [detail.truck.make, detail.truck.model]
                            .filter(Boolean)
                            .join(' ') || detail.truck.truck_type
                        }
                      />
                    ) : null}
                    {detail.truck ? (
                      <Detail
                        label="Capacity"
                        value={`${Number(detail.truck.max_capacity_kg).toLocaleString()} kg`}
                      />
                    ) : null}
                  </div>

                  {detail.trip ? (
                    <div>
                      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Cargo
                      </h3>
                      <Detail label="Client" value={detail.trip.shipment.client_name} />
                      <Detail
                        label="Reference"
                        value={detail.trip.shipment.reference_code}
                      />
                      <Detail
                        label="Load"
                        value={`${Number(detail.trip.shipment.total_weight_kg).toLocaleString()} kg`}
                      />
                      <Detail label="Priority" value={detail.trip.shipment.priority} />
                      {origin?.address ? (
                        <Detail label="Origin" value={origin.address} />
                      ) : null}
                      {destination?.address ? (
                        <Detail label="Destination" value={destination.address} />
                      ) : null}
                    </div>
                  ) : null}

                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Last position
                    </h3>
                    {selectedRow.position ? (
                      <>
                        <Detail
                          label="Reported"
                          value={age(selectedRow.position.age_seconds)}
                        />
                        <Detail
                          label="Coordinates"
                          value={
                            <span className="font-mono">
                              {selectedRow.position.location.lat.toFixed(5)},{' '}
                              {selectedRow.position.location.lon.toFixed(5)}
                            </span>
                          }
                        />
                        {selectedRow.position.speed_kmph !== null ? (
                          <Detail
                            label="Speed"
                            value={`${Math.round(selectedRow.position.speed_kmph)} km/h`}
                          />
                        ) : null}
                        {selectedRow.position.accuracy_m !== null ? (
                          <Detail
                            label="GPS accuracy"
                            value={`±${Math.round(selectedRow.position.accuracy_m)} m`}
                          />
                        ) : null}
                        {/* Reported by Android and surfaced, never used to
                            auto-reject a fix or to accuse anyone.
                            docs/SECURITY.md section 8. */}
                        {selectedRow.position.is_mock_location ? (
                          <Detail
                            label="Signal"
                            value={
                              <span className="text-amber-400">
                                mock location reported
                              </span>
                            }
                          />
                        ) : null}
                      </>
                    ) : (
                      <p className="py-2 text-xs text-slate-500">
                        This truck has not reported a position yet, so it is not
                        placed on the map.
                      </p>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Observed trip track
                    </h3>
                    {/* NOT "route". Routing does not exist until P7; this is
                        only where the truck has actually been observed. */}
                    <p className="text-xs text-slate-500">
                      {detail.track.length === 0
                        ? 'No positions recorded yet.'
                        : `${detail.track.length} observed position${
                            detail.track.length === 1 ? '' : 's'
                          } drawn on the map.`}
                      {detail.trackTruncated
                        ? ' Older positions exist but are not shown.'
                        : ''}
                    </p>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
