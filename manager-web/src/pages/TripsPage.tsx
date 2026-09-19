/**
 * Planning and dispatching trips.
 *
 * Dispatch is deliberate steps, not one button that does everything:
 *
 *     shipment + trip (DRAFT)   what moves, who moves it   -> Create draft trip
 *        |
 *     route planned, conditions checked, ROUTE SELECTED     -> Trip review panel
 *        |
 *     ASSIGNED                  the driver may now start it -> Dispatch
 *
 * "Create draft trip" is disabled until every local prerequisite holds, with
 * ONE stated reason (see planValidation.ts); the server re-checks all of it.
 * Dispatch is disabled until a route is selected for the trip: a draft is not
 * dispatchable merely because it exists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, type Assignment, type Driver, type Trip, type TripDetail, type TripQuery, type Truck, unavailableReason } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusPill,
} from '../components/ui'
import { useMutation, useResource } from '../hooks/useResource'
import TripRouteReview from '../components/TripRouteReview'
import AddressPicker, {
  EMPTY_ENDPOINT,
  type EndpointValue,
} from '../components/AddressPicker'
import { endpointPoint, heldBy, pairedTruckId, straightLineKm, validatePlan } from './planValidation'
import JourneyHistory from '../components/JourneyHistory'
import {
  ALL_LIMIT,
  EMPTY_FILTERS,
  TripListControls,
  activeFilterCount,
  describeFilters,
  type PageSize,
  type TripFilters,
} from './TripListControls'
import { downloadCsv, exportRow, printReport, reportHtml } from './tripExport'

/** A driver accepting, starting or delivering must show here without a
 *  reload. Five seconds is the bounded-polling fallback the sync rule allows. */
const TRIPS_POLL_MS = 5_000

const NO_ROUTE_REASON = 'Select a route in the trip review first — a draft is not dispatchable without one.'

export type JourneyAction = '' | 'ADD_STOP' | 'CHANGE_DESTINATION' | 'RETURN_TO_DEPOT' | 'HOLD' | 'STOP_TRIP'

/** What a manager may change, and in which trip states the server allows it.
 *  Nothing here is offered for a state the backend would refuse. */
export const JOURNEY_ACTIONS: { value: Exclude<JourneyAction, ''>; label: string; hint: string; states: string[] }[] = [
  { value: 'ADD_STOP', label: 'Add a stop', hint: 'A new stop on the way. Served stops keep their place.', states: ['ACTIVE', 'DELAYED'] },
  { value: 'CHANGE_DESTINATION', label: 'Change destination', hint: 'The cargo goes somewhere else; the pending delivery is skipped.', states: ['ACTIVE', 'DELAYED'] },
  { value: 'RETURN_TO_DEPOT', label: 'Return to depot', hint: 'Back to where the cargo was loaded.', states: ['ACTIVE', 'DELAYED'] },
  { value: 'HOLD', label: 'Hold driver', hint: 'The truck waits for instruction. This is not a cancellation.', states: ['ACTIVE', 'DELAYED'] },
  { value: 'STOP_TRIP', label: 'Stop / cancel trip', hint: 'Ends the job. With cargo onboard, say what happens to it.', states: ['DRAFT', 'ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED'] },
]

/** Open work first, history after: a dispatcher scans for what needs a hand. */
const STATUS_RANK: Record<string, number> = { DRAFT: 0, ASSIGNED: 1, VERIFICATION_PENDING: 1, ACTIVE: 2, DELAYED: 2, DELIVERED: 3, CLOSED: 4, CANCELLED: 5 }
const openFirst = (a: Trip, b: Trip) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)

/** What a manager should look at for a trip in this state, in one phrase. */
function attention(trip: Trip): { text: string; tone: string } {
  switch (trip.status) {
    case 'DRAFT':
      return trip.selected_route_id
        ? { text: 'Ready to dispatch', tone: 'text-ok' }
        : { text: 'Needs a route', tone: 'text-warning' }
    case 'ASSIGNED':
      return { text: 'Awaiting driver', tone: 'text-muted' }
    case 'VERIFICATION_PENDING':
      return { text: 'Truck check pending', tone: 'text-warning' }
    case 'ACTIVE':
      return { text: 'On the road', tone: 'text-route' }
    case 'DELAYED':
      return { text: 'Delayed', tone: 'text-warning' }
    case 'DELIVERED':
      return { text: 'Close to release the truck', tone: 'text-muted' }
    default:
      return { text: '—', tone: 'text-muted' }
  }
}

export default function TripsPage() {
  const { can } = useAuth()

  // FILTERS AND PAGING ARE THE SERVER'S. This used to read the newest 50 and
  // narrow them in the browser, so a trip older than those 50 could not be
  // reached, searched or exported at all.
  const [filters, setFilters] = useState<TripFilters>(EMPTY_FILTERS)
  const [pageSize, setPageSize] = useState<PageSize>(20)
  // A cursor per page already visited, so Previous is an exact walk back
  // rather than a guess. Index 0 is the first page, which has no cursor.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [page, setPage] = useState(0)

  const query = useMemo<TripQuery>(() => ({
    limit: pageSize === 'ALL' ? 100 : pageSize,
    trip_status: filters.status || undefined,
    driver_id: filters.driverId || undefined,
    truck_id: filters.truckId || undefined,
    search: filters.search.trim() || undefined,
    open_only: filters.scope === 'OPEN',
  }), [pageSize, filters.status, filters.driverId, filters.truckId, filters.search, filters.scope])

  const cursor = cursors[page]
  const key = `trips:${JSON.stringify(query)}:${cursor ?? ''}`
  const trips = useResource(
    async () => {
      const first = await api.listTrips({ ...query, cursor })
      if (pageSize !== 'ALL') return first
      // "All" walks the server's pages to a stated ceiling rather than
      // pretending one request can return everything.
      const items = [...first.items]
      let next = first.next_cursor
      while (next && items.length < ALL_LIMIT) {
        const more = await api.listTrips({ ...query, cursor: next })
        items.push(...more.items)
        next = more.next_cursor
      }
      return { ...first, items: items.slice(0, ALL_LIMIT), next_cursor: null }
    },
    [key],
    key,
    TRIPS_POLL_MS,
  )

  // A filter change starts the walk again: a cursor belongs to the query it
  // came from, and reusing one across queries silently skips rows.
  const applyFilters = useCallback((next: TripFilters) => {
    setFilters(next); setCursors([undefined]); setPage(0)
  }, [])
  const applyPageSize = useCallback((size: PageSize) => {
    setPageSize(size); setCursors([undefined]); setPage(0)
  }, [])
  useEffect(() => {
    // The page we are on stopped existing (rows were filtered out under us).
    if (page > 0 && trips.data && trips.data.items.length === 0) setPage(0)
  }, [trips.data, page])
  // A reviewer holds trip:read only: the planner's reference lists are not
  // requested for them (a 403 is not an error a reviewer should ever see).
  const drivers = useResource(() => (can('driver:read') ? api.listDrivers({ limit: 100 }) : Promise.resolve({ items: [] as Driver[], next_cursor: null })), [], can('driver:read') ? 'drivers:100' : undefined)
  const trucks = useResource(() => (can('truck:read') ? api.listTrucks({ limit: 100 }) : Promise.resolve({ items: [] as Truck[], next_cursor: null })), [], can('truck:read') ? 'trucks:100' : undefined)
  const assignments = useResource(() => (can('assignment:read') ? api.listAssignments({ activeOnly: true }) : Promise.resolve([] as Assignment[])), [], can('assignment:read') ? 'assignments:active' : undefined)

  const driverName = (id: string) =>
    drivers.data?.items.find((d) => d.id === id)?.full_name ?? id.slice(0, 8)
  const truckReg = (id: string) =>
    trucks.data?.items.find((t) => t.id === id)?.registration_number ??
    id.slice(0, 8)

  // Every open trip in the fleet, for the planner's eligibility - NOT the page
  // the list happens to be showing. A driver reserved by a draft on page three
  // is just as unavailable as one on page one.
  const openTrips = useResource(
    () => api.listTrips({ open_only: true, limit: 100 }),
    [],
    'trips:open:100',
    TRIPS_POLL_MS,
  )
  const heldTrip = useCallback(
    (who: { driverId?: string; truckId?: string }) => heldBy(openTrips.data?.items, who),
    [openTrips.data],
  )

  const [reviewTrip, setReviewTrip] = useState<Trip | null>(null)
  const draftAttempt = useRef<{ intent: string; stamp: string } | null>(null)
  const [client, setClient] = useState('')
  const [weight, setWeight] = useState('1000')
  const [pickup, setPickup] = useState<EndpointValue>(EMPTY_ENDPOINT)
  const [destination, setDestination] = useState<EndpointValue>(EMPTY_ENDPOINT)
  const [driverId, setDriverId] = useState('')
  const [truckId, setTruckId] = useState('')
  // Which trip an action is running against. Without this, every row's
  // button shows a spinner while one row acts, because the mutation hook's
  // `isSubmitting` is per-hook and the hooks are shared across the table.
  const [actingOn, setActingOn] = useState<string | null>(null)

  const dispatchTrip = useMutation((id: string) => api.dispatchTrip(id))
  const cancelTrip = useMutation((id: string, body?: Parameters<typeof api.cancelTrip>[1]) => api.cancelTrip(id, body))
  // A started trip is stopped through a dialog, not a confirm box: once cargo
  // is on the truck the server requires a reason and a cargo disposition, and
  // the manager should see that before pressing anything.
  const [stopping, setStopping] = useState<{ trip: Trip; detail: TripDetail | null; failed: boolean } | null>(null)
  const [stopReason, setStopReason] = useState('')
  const [stopDisposition, setStopDisposition] = useState('')
  const [stopDestination, setStopDestination] = useState<EndpointValue>(EMPTY_ENDPOINT)
  // ONE entry point for everything a manager does to a moving trip, instead of
  // five buttons in the row. The chosen action decides which server call runs;
  // every one of them is a capability the backend already enforces.
  const [journeyAction, setJourneyAction] = useState<JourneyAction>('')
  const [stopPlacement, setStopPlacement] = useState<'NEXT' | 'BEFORE_FINAL'>('NEXT')
  const [newStop, setNewStop] = useState<EndpointValue>(EMPTY_ENDPOINT)
  const addStop = useMutation((id: string, body: Parameters<typeof api.addStop>[1]) => api.addStop(id, body))
  const addStopBlocked = unavailableReason('addStop')
  const cargoLoaded = stopping?.detail?.stops[0]?.status === 'COMPLETED'
  const stopDestinationPoint = endpointPoint(stopDestination)
  const newStopPoint = endpointPoint(newStop)
  const reasonRequired = cargoLoaded || journeyAction !== '' && journeyAction !== 'STOP_TRIP'
  const stopBlocker =
    journeyAction === ''
      ? 'Choose what to change.'
      : reasonRequired && stopReason.trim().length < 10
        ? 'Give a reason of at least 10 characters — it is shown to the driver and kept in the audit trail.'
        : journeyAction === 'ADD_STOP' && (!newStopPoint || !newStop.address.trim())
          ? 'Confirm the new stop location.'
          : journeyAction === 'ADD_STOP' && addStopBlocked !== null
            ? addStopBlocked
            : journeyAction === 'STOP_TRIP' && cargoLoaded && !stopDisposition
              ? 'Say what happens to the cargo.'
              : journeyAction === 'CHANGE_DESTINATION' && (!stopDestinationPoint || !stopDestination.address.trim())
                ? 'Confirm the new destination.'
                : null
  function openStop(trip: Trip) {
    setStopping({ trip, detail: null, failed: false })
    setStopReason(''); setStopDisposition(''); setStopDestination(EMPTY_ENDPOINT)
    setJourneyAction(''); setStopPlacement('NEXT'); setNewStop(EMPTY_ENDPOINT)
    api.getTrip(trip.id).then(
      (detail) => setStopping((s) => (s && s.trip.id === trip.id ? { ...s, detail } : s)),
      () => setStopping((s) => (s && s.trip.id === trip.id ? { ...s, failed: true } : s)),
    )
  }
  async function submitStop() {
    if (!stopping || stopBlocker) return
    const trip = stopping.trip
    if (journeyAction === 'ADD_STOP') {
      if (!newStopPoint) return
      const { data } = await run(trip.id, () =>
        addStop.submit(trip.id, {
          location: newStopPoint,
          address: newStop.address.trim(),
          placement: stopPlacement,
          reason: stopReason.trim(),
        }),
      )
      if (data) setStopping(null)
      return
    }
    const disposition =
      journeyAction === 'HOLD' ? 'HOLD_FOR_INSTRUCTION'
      : journeyAction === 'RETURN_TO_DEPOT' ? 'RETURN_TO_DEPOT'
      : journeyAction === 'CHANGE_DESTINATION' ? 'NEW_DESTINATION'
      : stopDisposition
    const body: Parameters<typeof api.cancelTrip>[1] = { reason: stopReason.trim() || undefined }
    if (disposition) body.disposition = disposition
    if (disposition === 'NEW_DESTINATION' && stopDestinationPoint) {
      body.destination = stopDestinationPoint
      body.destination_address = stopDestination.address.trim()
    }
    const { data } = await run(trip.id, () => cancelTrip.submit(trip.id, body))
    if (data) setStopping(null)
  }
  // Attention is derived from status + route, which the server does not
  // index, so it narrows THIS page and the controls say exactly that.
  const visibleTrips = useMemo(
    () =>
      [...(trips.data?.items ?? [])]
        .filter((t) => !filters.attention || attention(t).text === filters.attention)
        .sort(openFirst),
    [trips.data, filters.attention],
  )

  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  /**
   * The rows an export writes: EVERY row the filters match, fetched from the
   * server, not the page on screen. The note says so before and after, so
   * "Export CSV" can never quietly mean "export these twenty".
   */
  const exportRows = useCallback(async () => {
    const items: Trip[] = []
    let next: string | undefined
    do {
      const page = await api.listTrips({ ...query, limit: 100, cursor: next })
      items.push(...page.items)
      next = page.next_cursor ?? undefined
    } while (next && items.length < ALL_LIMIT)
    const capped = items.length >= ALL_LIMIT
    const rows = items
      .filter((t) => !filters.attention || attention(t).text === filters.attention)
      .map((t) =>
        exportRow(t, {
          driver: driverName(t.driver_id),
          truck: truckReg(t.truck_id),
          attention: attention(t).text,
        }),
      )
    return { rows, capped }
  }, [query, filters.attention])

  async function runExport(kind: 'CSV' | 'PDF') {
    if (exporting) return
    setExporting(true)
    setExportNote(null)
    try {
      const { rows, capped } = await exportRows()
      const described = describeFilters(filters, { driver: driverName, truck: truckReg })
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      if (kind === 'CSV') {
        downloadCsv(rows, `rasta-trips-${stamp}.csv`)
        setExportNote(
          `Exported ${rows.length} row${rows.length === 1 ? '' : 's'} (${described}) as CSV — opens in Excel.` +
            (capped ? ` Capped at ${ALL_LIMIT}; narrow the filters for a complete set.` : ''),
        )
      } else {
        const opened = printReport(
          reportHtml(rows, { title: 'Trip list', filters: described, generated: new Date().toLocaleString() }),
        )
        setExportNote(
          opened
            ? `Report opened for ${rows.length} row${rows.length === 1 ? '' : 's'} (${described}). Choose "Save as PDF" in the print dialog.`
            : 'The report window was blocked by the browser. Allow pop-ups for this site and try again.',
        )
      }
    } catch (error) {
      setExportNote(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExporting(false)
    }
  }

  const closeTrip = useMutation((id: string) => api.closeTrip(id))
  const cancelBlocked = unavailableReason('cancelTrip')
  const closeBlocked = unavailableReason('closeTrip')

  const create = useMutation(async () => {
    // ONE request, because this is ONE transaction: the server creates the
    // shipment and the trip together or neither. Retry the same intent with
    // the same idempotency identifiers - a lost response may already have
    // committed the draft.
    const intent = JSON.stringify([client.trim(), pickup, destination, weight.trim(), truckId, driverId])
    if (draftAttempt.current?.intent !== intent) draftAttempt.current = { intent, stamp: crypto.randomUUID().slice(0, 18).toUpperCase() }
    const stamp = draftAttempt.current.stamp
    return api.planTrip({
      shipment: {
        reference_code: `SHP-${stamp}`,
        client_name: client.trim(),
        pickup_address: pickup.address.trim(),
        pickup: endpointPoint(pickup)!,
        destination_address: destination.address.trim(),
        destination: endpointPoint(destination)!,
        cargo_items: [
          {
            cargo_type: 'GENERAL',
            cargo_name: 'Consignment',
            weight_kg: weight.trim(),
            quantity: 1,
          },
        ],
      },
      trip: {
        trip_code: `TRP-${stamp}`,
        truck_id: truckId,
        driver_id: driverId,
      },
    })
  })

  const referencesReady =
    drivers.status === 'success' && trucks.status === 'success' && assignments.status === 'success'
  // The corridor the route will be judged against, from the two confirmed
  // points. Shown while planning so a 2,000 km journey is visible before a
  // route is ever requested.
  const pickupPoint = endpointPoint(pickup)
  const destinationPoint = endpointPoint(destination)
  const corridorKm = pickupPoint && destinationPoint ? straightLineKm(pickupPoint, destinationPoint) : null
  const validation = validatePlan({
    client, weight, pickup, destination, driverId, truckId,
    drivers: drivers.data?.items ?? [],
    trucks: trucks.data?.items ?? [],
    assignments: assignments.data ?? [],
    openTrips: openTrips.data?.items ?? [],
    referencesReady,
    submitting: create.isSubmitting,
  })

  async function handleCreate() {
    if (validation.blocker) return
    const result = await create.submit()
    if (!result.data) return
    setReviewTrip(result.data)
    draftAttempt.current = null
    setClient('')
    setPickup(EMPTY_ENDPOINT)
    setDestination(EMPTY_ENDPOINT)
    trips.reload()
  }

  async function run(
    tripId: string,
    action: () => Promise<{ data?: Trip; error?: unknown }>,
  ) {
    setActingOn(tripId)
    try {
      const outcome = await action()
      if (outcome.data) trips.reload()
      return outcome
    } finally {
      setActingOn(null)
    }
  }

  const canCreate = can('trip:create')
  // While the stop dialog is open it owns the cancel error; showing it twice
  // (behind the overlay as well) reads as two failures.
  const actionError = dispatchTrip.error ?? (stopping ? null : cancelTrip.error) ?? closeTrip.error
  const pairedFor = (id: string) => pairedTruckId(assignments.data ?? [], id)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Dispatch workspace</h1>
        <p className="text-xs text-muted">
          Plan the load, review the road, select the route, then dispatch. Your driver receives the trip after dispatch.
        </p>
      </div>

      <div className="dispatch-grid">
      {canCreate ? (
        <Card title="Plan a trip">
          {drivers.status === 'error' || trucks.status === 'error' || assignments.status === 'error' ? (
            <ErrorState error={drivers.error ?? trucks.error ?? assignments.error} onRetry={() => { drivers.reload(); trucks.reload(); assignments.reload() }} />
          ) : !referencesReady ? (
            <LoadingState label="Loading drivers and trucks…" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Client"
                  name="client"
                  value={client}
                  onChange={setClient}
                  required
                  placeholder="Brahmaputra Traders"
                  error={client && !validation.client.valid ? validation.client.reason ?? undefined : undefined}
                />
                <Field
                  label="Cargo weight (kg)"
                  name="weight"
                  value={weight}
                  onChange={setWeight}
                  required
                  hint="Checked against the truck's capacity — an overloaded truck is refused."
                  error={!validation.cargo.valid ? validation.cargo.reason ?? undefined : !validation.capacity.valid ? validation.capacity.reason ?? undefined : undefined}
                />
                {/* Pickup and destination span both columns: an address
                    with a suggestion list under it does not belong in a
                    half-width cell next to a weight box. */}
                <div className="sm:col-span-2 space-y-3">
                  <AddressPicker
                    label="Pickup address"
                    name="pickup_address"
                    value={pickup}
                    onChange={setPickup}
                    placeholder="Depot, Guwahati"
                  />
                  <div className="flex justify-center">
                    {/* Swaps the WHOLE endpoint - address, coordinate and the
                        provenance of that coordinate. */}
                    <button
                      type="button"
                      onClick={() => {
                        const was = pickup
                        setPickup(destination)
                        setDestination(was)
                      }}
                      className="rounded-md border border-line px-3 py-1 text-xs text-ink hover:bg-soft"
                    >
                      Swap pickup and destination
                    </button>
                  </div>
                  <AddressPicker
                    label="Destination address"
                    name="destination_address"
                    value={destination}
                    onChange={setDestination}
                    placeholder="Yard, Jorhat"
                  />
                  {pickup.source !== null && destination.source !== null && !validation.destination.valid ? (
                    <p className="text-xs text-danger">{validation.destination.reason}</p>
                  ) : null}
                  {corridorKm !== null ? (
                    <p className="tnum text-xs text-muted" data-testid="corridor-hint">
                      Straight-line distance between the confirmed points: {Math.round(corridorKm).toLocaleString()} km.
                    </p>
                  ) : null}
                  {!validation.region.valid ? (
                    <p className="text-xs text-danger" data-testid="region-blocker">{validation.region.reason}</p>
                  ) : null}
                </div>

                <label className="block">
                  <span className="text-xs font-medium text-ink">
                    Driver<span className="ml-0.5 text-danger">*</span>
                  </span>
                  <select
                    value={driverId}
                    onChange={(e) => {
                      // Picking a driver picks their truck: dispatch needs the
                      // live driver-truck assignment, so the pair is shown here,
                      // not discovered at dispatch.
                      const id = e.target.value
                      setDriverId(id)
                      setTruckId(id ? pairedFor(id) ?? '' : '')
                    }}
                    className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink focus:border-route focus:ring-1 focus:ring-route"
                  >
                    <option value="">Select a driver…</option>
                    {/* Disabled rather than hidden, and labelled with the reason.
                        Convenience only - the server re-checks and returns
                        DRIVER_LOGIN_INACTIVE, which is what actually enforces it. */}
                    {drivers.data?.items.map((d) => {
                      const paired = pairedFor(d.id)
                      // Already promised to an open trip? Say which one. The
                      // server refuses it (DRIVER_RESERVED_BY_TRIP); offering a
                      // row that walks into that refusal is the defect.
                      const held = heldTrip({ driverId: d.id })
                      const blocked = !d.login_is_active || held !== null
                      return (
                        <option key={d.id} value={d.id} disabled={blocked}>
                          {d.full_name} — {paired ? `truck ${truckReg(paired)}` : 'no truck assigned'}
                          {!d.login_is_active ? ' (login inactive)' : held ? ` (reserved by ${held.trip_code})` : ''}
                        </option>
                      )
                    })}
                  </select>
                  {driverId && !validation.driver.valid ? (
                    <span className="mt-1 block text-xs text-danger">{validation.driver.reason}</span>
                  ) : driverId && !validation.assignment.valid ? (
                    <span className="mt-1 block text-xs text-warning">{validation.assignment.reason}</span>
                  ) : null}
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-ink">
                    Truck<span className="ml-0.5 text-danger">*</span>
                  </span>
                  <select
                    value={truckId}
                    onChange={(e) => setTruckId(e.target.value)}
                    className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink focus:border-route focus:ring-1 focus:ring-route"
                  >
                    <option value="">Select a truck…</option>
                    {trucks.data?.items.map((t) => {
                      const pairedTruck = driverId ? pairedFor(driverId) : null
                      const unpaired = pairedTruck !== null && pairedTruck !== t.id
                      const held = heldTrip({ truckId: t.id })
                      return (
                        <option key={t.id} value={t.id} disabled={unpaired || held !== null || t.status !== 'AVAILABLE'}>
                          {t.registration_number} — {Number(t.max_capacity_kg).toLocaleString()} kg
                          {t.status !== 'AVAILABLE'
                            ? ` (${t.status.toLowerCase().replaceAll('_', ' ')})`
                            : held
                              ? ` (reserved by ${held.trip_code})`
                              : unpaired
                                ? ' (not this driver’s truck)'
                                : ''}
                        </option>
                      )
                    })}
                  </select>
                  {truckId && !validation.truck.valid ? (
                    <span className="mt-1 block text-xs text-danger">{validation.truck.reason}</span>
                  ) : (
                    <span className="mt-1 block text-xs text-muted">Filled from the live pairing.</span>
                  )}
                </label>
              </div>

              {create.error ? (
                <div className="mt-3">
                  <ErrorState error={create.error} />
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleCreate}
                  busy={create.isSubmitting}
                  disabled={validation.blocker !== null}
                  title={validation.blocker ?? undefined}
                >
                  {create.isSubmitting ? 'Creating…' : 'Create draft trip'}
                </Button>
                {validation.blocker && !create.isSubmitting ? (
                  <p className="text-xs text-muted" data-testid="plan-blocker" role="status">
                    {validation.blocker}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </Card>
      ) : null}

      <div className="dispatch-review">{reviewTrip ? <TripRouteReview key={reviewTrip.id} trip={reviewTrip} onChanged={trips.reload} /> : <Card title="Trip review"><EmptyState title="Every journey starts with a plan" description="Create a draft on the left, or choose Review route from the trips below. Plan the road, check its conditions and select the route here before dispatch." /></Card>}</div>
      </div>
      <Card
        title={filters.scope === 'OPEN' ? 'Open trips' : 'Trip history'}
        action={<span className="text-xs text-muted">{filters.scope === 'OPEN' ? 'Everything still being worked' : 'Delivered, closed and cancelled — read-only'}</span>}
      >
        <div className="mb-3">
          <TripListControls
            filters={filters}
            onFilters={applyFilters}
            drivers={drivers.data?.items ?? []}
            trucks={trucks.data?.items ?? []}
            pageSize={pageSize}
            onPageSize={applyPageSize}
            page={page + 1}
            total={trips.data?.total ?? null}
            shown={visibleTrips.length}
            canPrevious={page > 0}
            canNext={Boolean(trips.data?.next_cursor)}
            onPrevious={() => setPage((n) => Math.max(0, n - 1))}
            onNext={() => {
              const next = trips.data?.next_cursor
              if (!next) return
              setCursors((all) => (all[page + 1] === next ? all : [...all.slice(0, page + 1), next]))
              setPage((n) => n + 1)
            }}
            busy={trips.status === 'loading'}
            onExportCsv={() => void runExport('CSV')}
            onExportPdf={() => void runExport('PDF')}
            exporting={exporting}
            exportNote={exportNote}
          />
        </div>
        {trips.status === 'loading' ? (
          <LoadingState label="Loading trips…" />
        ) : trips.status === 'error' ? (
          <ErrorState error={trips.error} onRetry={trips.reload} />
        ) : visibleTrips.length === 0 ? (
          <EmptyState
            title={activeFilterCount(filters) > 0 ? 'No trip matches these filters' : filters.scope === 'OPEN' ? 'No open trips' : 'No trips in history yet'}
            description={activeFilterCount(filters) > 0 ? 'Clear the filters to see the rest of the fleet.' : filters.scope === 'OPEN' ? 'Plan one above to get started.' : 'Delivered and closed trips appear here.'}
          />
        ) : (
          <div className="overflow-x-auto">
            {/* Every row action can be legitimately refused - a trip someone
                else already closed, a driver whose assignment was ended, a
                transition the lifecycle forbids. All must surface. */}
            {actionError ? (
              <div className="mb-3">
                <ErrorState error={actionError} />
              </div>
            ) : null}
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-medium">Trip</th>
                  <th className="pb-2 font-medium">Driver</th>
                  <th className="pb-2 font-medium">Truck</th>
                  <th className="pb-2 font-medium">Route</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Attention</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {visibleTrips.map((trip) => {
                  const note = attention(trip)
                  const open = trip.status === 'DRAFT' ? 'Review route' : ['ASSIGNED', 'VERIFICATION_PENDING', 'ACTIVE', 'DELAYED'].includes(trip.status) ? 'Open' : 'View'
                  const busyElsewhere = actingOn !== null && actingOn !== trip.id
                  return (
                  <tr key={trip.id} className="border-t border-line">
                    <td className="py-3 font-medium text-ink">
                      {trip.trip_code}
                    </td>
                    <td className="py-3 text-ink">
                      {driverName(trip.driver_id)}
                    </td>
                    <td className="py-3 text-ink">
                      {truckReg(trip.truck_id)}
                    </td>
                    <td className="py-3 text-xs">
                      {trip.selected_route_id ? <span className="text-ok">Selected</span> : <span className="text-warning">Not selected</span>}
                    </td>
                    <td className="py-3">
                      <StatusPill status={trip.status} />
                    </td>
                    <td className={`py-3 text-xs ${note.tone}`}>{note.text}</td>
                    <td className="py-3 text-right">
                      {/* One dominant action per state. A control that is
                          present and enabled is one the server will accept. */}
                      <div className="flex flex-wrap justify-end gap-2">
                        {can('route:read') ? <Button variant="secondary" onClick={() => { setReviewTrip(trip); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{open}</Button> : null}
                        {trip.status === 'DRAFT' && can('trip:dispatch') ? (
                          <Button
                            busy={actingOn === trip.id && dispatchTrip.isSubmitting}
                            disabled={busyElsewhere || !trip.selected_route_id}
                            title={trip.selected_route_id ? undefined : NO_ROUTE_REASON}
                            onClick={() =>
                              void run(trip.id, () => dispatchTrip.submit(trip.id))
                            }
                          >
                            Dispatch
                          </Button>
                        ) : null}
                        {trip.status === 'DELIVERED' && can('trip:close') ? (
                          <Button
                            busy={actingOn === trip.id && closeTrip.isSubmitting}
                            disabled={closeBlocked !== null || busyElsewhere}
                            title={closeBlocked ?? undefined}
                            onClick={() =>
                              void run(trip.id, () => closeTrip.submit(trip.id))
                            }
                          >
                            Close
                          </Button>
                        ) : null}
                        {['DRAFT', 'ASSIGNED', 'ACTIVE', 'DELAYED'].includes(
                          trip.status,
                        ) && can('trip:cancel') ? (
                          <Button
                            variant={trip.status === 'ACTIVE' || trip.status === 'DELAYED' ? 'secondary' : 'danger'}
                            className="min-h-9 px-2 py-1 text-xs"
                            busy={actingOn === trip.id && cancelTrip.isSubmitting}
                            disabled={cancelBlocked !== null || busyElsewhere}
                            title={cancelBlocked ?? undefined}
                            onClick={() => {
                              // A started trip may have cargo on board: the
                              // dialog asks what happens to it. A draft or an
                              // undispatched job just ends.
                              // Everything a manager does to a moving trip goes
                              // through one dialog; a draft just ends.
                              if (trip.status === 'ACTIVE' || trip.status === 'DELAYED') { openStop(trip); return }
                              if (!window.confirm(`Cancel ${trip.trip_code}?`)) return
                              void run(trip.id, () => cancelTrip.submit(trip.id))
                            }}
                          >
                            {trip.status === 'ACTIVE' || trip.status === 'DELAYED' ? 'Change journey' : 'Cancel'}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {stopping ? (
        <div role="dialog" aria-modal="true" aria-label={`Change journey ${stopping.trip.trip_code}`} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-canvas/80 p-4">
          <div className="my-auto w-full max-w-lg space-y-3 rounded-xl border border-line bg-surface p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-ink">Change journey · {stopping.trip.trip_code}</h2>
            {/* The one fact that changes what is required. Stated in words, from the server. */}
            <p className="text-xs text-muted" data-testid="stop-cargo-state">
              {stopping.detail === null && !stopping.failed
                ? 'Checking whether the cargo has been picked up…'
                : cargoLoaded
                  ? `Cargo is on the truck — pickup completed${stopping.detail?.stops[0]?.actual_departure_at ? ` at ${new Date(stopping.detail.stops[0].actual_departure_at).toLocaleTimeString()}` : ''}. A reason and a cargo disposition are required; nothing changes for the driver silently.`
                  : stopping.failed
                    ? 'Could not read the pickup state. The server will still refuse a bare cancellation if cargo is on board.'
                    : 'Pickup not completed yet. The trip can be cancelled; the driver is told and released.'}
            </p>
            {/* One chooser, not five buttons in the table row. Only actions the
                server actually supports are offered. */}
            <fieldset className="space-y-1" data-testid="journey-actions">
              <legend className="text-xs font-medium text-ink">What are you changing?</legend>
              {JOURNEY_ACTIONS.filter((a) => a.states.includes(stopping.trip.status)).map((a) => (
                <label key={a.value} className="flex items-start gap-2 text-[12.5px] text-ink">
                  <input
                    type="radio"
                    name="journey_action"
                    className="mt-0.5"
                    checked={journeyAction === a.value}
                    onChange={() => setJourneyAction(a.value)}
                  />
                  <span><span className="font-semibold">{a.label}</span><span className="block text-[11.5px] text-muted">{a.hint}</span></span>
                </label>
              ))}
              {/* Changing the ROAD is a different decision: it needs the hazard
                  evidence, so it happens where that evidence is shown. */}
              <p className="pt-1 text-[11.5px] text-muted">
                To change the <strong>road</strong> rather than the journey, use Fleet → the trip → Route: plan alternatives, check conditions and approve one there, where the evidence is.
              </p>
            </fieldset>
            <Field label="Reason" name="stop_reason" value={stopReason} onChange={setStopReason} required={reasonRequired} hint="Shown to the driver and kept in the audit trail." />
            {journeyAction === 'ADD_STOP' ? (
              <>
                <AddressPicker label="New stop" name="new_stop" value={newStop} onChange={setNewStop} placeholder="Search address or paste Maps link" />
                <label className="block">
                  <span className="text-xs font-medium text-ink">Where in the journey</span>
                  <select value={stopPlacement} onChange={(e) => setStopPlacement(e.target.value as 'NEXT' | 'BEFORE_FINAL')} className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink" aria-label="Stop placement">
                    <option value="NEXT">Next — before anything else still to do</option>
                    <option value="BEFORE_FINAL">Before the final delivery</option>
                  </select>
                </label>
                <p className="text-[11px] text-muted">Stops the driver has already served are not renumbered, and the truck keeps its current road until you approve a route for the new plan.</p>
              </>
            ) : null}
            {journeyAction === 'STOP_TRIP' && (cargoLoaded || stopping.failed) ? (
              <label className="block">
                <span className="text-xs font-medium text-ink">What happens to the cargo<span className="ml-0.5 text-danger">*</span></span>
                <select value={stopDisposition} onChange={(e) => setStopDisposition(e.target.value)} className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink" aria-label="Cargo disposition">
                  <option value="">Choose…</option>
                  <option value="RETURN_TO_DEPOT">Return to depot — back to the pickup point</option>
                  <option value="NEW_DESTINATION">New destination — confirm a point below</option>
                  <option value="HOLD_FOR_INSTRUCTION">Hold for instruction — driver waits, trip reads DELAYED</option>
                  <option value="COMPLETE_CURRENT_LEG">Complete current leg — no change on the road, decision recorded</option>
                  <option value="CARGO_UNLOADED">Cargo already unloaded — close the trip as cancelled</option>
                </select>
              </label>
            ) : null}
            {journeyAction === 'CHANGE_DESTINATION' ? (
              <AddressPicker label="New destination" name="stop_destination" value={stopDestination} onChange={setStopDestination} placeholder="Search address or paste Maps link" />
            ) : null}
            {journeyAction === 'CHANGE_DESTINATION' || journeyAction === 'RETURN_TO_DEPOT' ? (
              <p className="text-[11px] text-muted">The driver keeps the current road until you select a route for the new destination in Fleet → Route options.</p>
            ) : null}
            {cancelTrip.error ? <ErrorState error={cancelTrip.error} /> : null}
            {addStop.error ? <ErrorState error={addStop.error} /> : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {stopBlocker ? <span className="mr-auto text-xs text-warning" role="status" data-testid="stop-blocker">{stopBlocker}</span> : null}
              <Button variant="secondary" onClick={() => setStopping(null)}>Close</Button>
              <Button
                variant={journeyAction === 'STOP_TRIP' ? 'danger' : 'primary'}
                busy={cancelTrip.isSubmitting || addStop.isSubmitting}
                disabled={stopBlocker !== null || cancelTrip.isSubmitting || addStop.isSubmitting}
                title={stopBlocker ?? undefined}
                onClick={() => void submitStop()}
              >
                {journeyAction === 'ADD_STOP' ? 'Add stop'
                  : journeyAction === 'STOP_TRIP' ? (cargoLoaded && stopDisposition && stopDisposition !== 'CARGO_UNLOADED' ? 'Apply' : 'Stop trip')
                  : 'Apply'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
