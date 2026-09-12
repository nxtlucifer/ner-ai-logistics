/**
 * Planning and dispatching trips.
 *
 * Dispatch is three deliberate steps, not one button that does everything:
 *
 *     shipment          what the customer asked to be moved
 *        |
 *        v
 *     trip (DRAFT)      which truck and driver will move it
 *        |
 *        v
 *     ASSIGNED          the driver may now start it
 *
 * They are separate because they fail for different reasons and a manager needs
 * to know which one failed. Creating the trip re-checks capacity; dispatching
 * re-checks the licence, the truck's condition, the driver/truck assignment and
 * that the driver's login still works, because all of those can change between
 * planning and dispatch. The last one matters most: a trip dispatched to a
 * driver who cannot sign in can never be started, and holds a truck while it
 * cannot be.
 *
 * The form creates the shipment and the trip together, since a shipment with no
 * trip is not useful here, but each call's error is surfaced on its own.
 */

import { useRef, useState } from 'react'

import { api, type Trip, unavailableReason } from '../api/client'
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

/** A driver accepting, starting or delivering must show here without a
 *  reload. Five seconds is the bounded-polling fallback the sync rule allows. */
const TRIPS_POLL_MS = 5_000
import TripRouteReview from '../components/TripRouteReview'
import AddressPicker, {
  EMPTY_ENDPOINT,
  type EndpointValue,
} from '../components/AddressPicker'

/** Guwahati. A sensible starting point for a region the operators work in. */
/**
 * Parse a confirmed endpoint.
 *
 * THERE ARE NO DEFAULT COORDINATES ANY MORE. A depot's latitude pre-filled into
 * every trip is right once and silently wrong afterwards, and this form's whole
 * failure mode was a manager changing the address and shipping the default. An
 * endpoint with no `source` has not been located, and that is refused here
 * rather than substituted.
 *
 * The range check stays for the Advanced path, which is now the only way a
 * coordinate can be typed. It catches a transposed lat/lon rather than folding
 * an out-of-range latitude over the pole into a plausible-looking point.
 */
function parseEndpoint(
  input: EndpointValue,
  label: string,
): { value?: { lat: number; lon: number }; error?: string } {
  if (input.source === null) {
    return {
      error: `${label} has no location yet. Pick a suggestion, or choose the point on the map.`,
    }
  }
  const lat = Number(input.lat)
  const lon = Number(input.lon)
  if (input.lat.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: `${label} latitude must be between -90 and 90.` }
  }
  if (input.lon.trim() === '' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { error: `${label} longitude must be between -180 and 180.` }
  }
  return { value: { lat, lon } }
}

export default function TripsPage() {
  const { can } = useAuth()

  const trips = useResource(() => api.listTrips({ limit: 50 }), [], 'trips:50', TRIPS_POLL_MS)
  const drivers = useResource(() => api.listDrivers({ limit: 100 }), [], 'drivers:100')
  const trucks = useResource(() => api.listTrucks({ limit: 100 }), [], 'trucks:100')

  const [reviewTrip, setReviewTrip] = useState<Trip | null>(null)
  const draftAttempt = useRef<{ intent: string; stamp: string } | null>(null)
  const [client, setClient] = useState('')
  const [weight, setWeight] = useState('1000')
  const [pickup, setPickup] = useState<EndpointValue>(EMPTY_ENDPOINT)
  const [destination, setDestination] = useState<EndpointValue>(EMPTY_ENDPOINT)
  const [driverId, setDriverId] = useState('')
  const [truckId, setTruckId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  // Which trip an action is running against. Without this, every row's
  // button shows a spinner while one row acts, because the mutation hook's
  // `isSubmitting` is per-hook and the hooks are shared across the table.
  const [actingOn, setActingOn] = useState<string | null>(null)

  const dispatchTrip = useMutation((id: string) => api.dispatchTrip(id))
  const cancelTrip = useMutation((id: string) => api.cancelTrip(id))
  const closeTrip = useMutation((id: string) => api.closeTrip(id))
  // Guarded state transitions with no hosted implementation yet. Disabled with
  // the reason rather than throwing on click - and deliberately NOT wired as an
  // ad-hoc `trips.status` write, which would bypass the transition guards.
  const cancelBlocked = unavailableReason('cancelTrip')
  const closeBlocked = unavailableReason('closeTrip')

  const create = useMutation(async () => {
    const pickupPoint = parseEndpoint(pickup, 'Pickup')
    if (pickupPoint.error) throw new Error(pickupPoint.error)
    const destinationPoint = parseEndpoint(destination, 'Destination')
    if (destinationPoint.error) throw new Error(destinationPoint.error)

    // ONE request, because this is ONE transaction.
    //
    // This was two calls - create the shipment, then the trip referencing it.
    // Those cannot be atomic across a network: the shipment committed, the
    // capacity gate then refused the trip, and a cargo record nothing pointed
    // at was stranded in the database. Worse on retry, because the stamp below
    // is regenerated per attempt, so every correction left another one behind -
    // and an overloaded truck is the failure this very form advertises, so
    // managers hit it routinely rather than exceptionally.
    // Retry the same intent with the same server idempotency identifiers.
    // A lost response may already have committed the draft.
    const intent = JSON.stringify([client.trim(), pickup, destination, weight.trim(), truckId, driverId])
    if (draftAttempt.current?.intent !== intent) draftAttempt.current = { intent, stamp: crypto.randomUUID().slice(0, 18).toUpperCase() }
    const stamp = draftAttempt.current.stamp
    return api.planTrip({
      shipment: {
        reference_code: `SHP-${stamp}`,
        client_name: client.trim(),
        pickup_address: pickup.address.trim(),
        pickup: pickupPoint.value!,
        destination_address: destination.address.trim(),
        destination: destinationPoint.value!,
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

  const driverName = (id: string) =>
    drivers.data?.items.find((d) => d.id === id)?.full_name ?? id.slice(0, 8)
  const truckReg = (id: string) =>
    trucks.data?.items.find((t) => t.id === id)?.registration_number ??
    id.slice(0, 8)

  async function handleCreate() {
    setFormError(null)
    const result = await create.submit()
    if (result.error) {
      if (result.error instanceof Error && !('status' in result.error)) {
        setFormError(result.error.message)
      }
      return
    }
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
      if ((await action()).data) trips.reload()
    } finally {
      setActingOn(null)
    }
  }

  const canCreate = can('trip:create')
  // Only one row action runs at a time (`actingOn` enforces it), so the three
  // mutations cannot hold errors simultaneously in practice; the ordering here
  // simply picks whichever one most recently refused.
  const actionError = dispatchTrip.error ?? cancelTrip.error ?? closeTrip.error
  const referencesReady =
    drivers.status === 'success' && trucks.status === 'success'
  const formComplete =
    client.trim() && pickup.address.trim() && destination.address.trim() &&
    weight.trim() && driverId && truckId

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Dispatch workspace</h1>
        <p className="text-xs text-muted">
          Plan the load, review the road, then dispatch. Your driver receives the trip after dispatch.
        </p>
      </div>

      <div className="dispatch-grid">
      {canCreate ? (
        <Card title="Plan a trip">
          {drivers.status === 'error' || trucks.status === 'error' ? (
            <ErrorState error={drivers.error ?? trucks.error} onRetry={() => { drivers.reload(); trucks.reload() }} />
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
                />
                <Field
                  label="Cargo weight (kg)"
                  name="weight"
                  value={weight}
                  onChange={setWeight}
                  required
                  hint="Checked against the truck's capacity — an overloaded truck is refused."
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
                        provenance of that coordinate. Swapping only the text
                        would leave each address pointing at the other's pin,
                        which is the exact class of bug this form had. */}
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
                </div>

                <label className="block">
                  <span className="text-xs font-medium text-ink">
                    Driver<span className="ml-0.5 text-danger">*</span>
                  </span>
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink focus:border-route focus:ring-1 focus:ring-route"
                  >
                    <option value="">Select a driver…</option>
                    {/*
                      Disabled rather than hidden, and labelled with the reason.
                      A driver who silently vanished from this list would send a
                      manager to look for a record that still exists; the point
                      is to say why they cannot be picked. This is convenience
                      only - the server re-checks and returns
                      DRIVER_LOGIN_INACTIVE, which is what actually enforces it.
                    */}
                    {drivers.data?.items.map((d) => (
                      <option
                        key={d.id}
                        value={d.id}
                        disabled={!d.login_is_active}
                      >
                        {d.full_name} — {d.licence_number}
                        {d.login_is_active ? '' : ' (login inactive)'}
                      </option>
                    ))}
                  </select>
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
                    {trucks.data?.items.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.registration_number} —{' '}
                        {Number(t.max_capacity_kg).toLocaleString()} kg
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {formError ? (
                <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft/50 px-4 py-3 text-xs text-danger">
                  {formError}
                </div>
              ) : create.error ? (
                <div className="mt-3">
                  <ErrorState error={create.error} />
                </div>
              ) : null}

              <div className="mt-4">
                <Button
                  onClick={handleCreate}
                  busy={create.isSubmitting}
                  disabled={!formComplete}
                >
                  {create.isSubmitting ? 'Creating…' : 'Create draft trip'}
                </Button>
              </div>
            </>
          )}
        </Card>
      ) : null}

      <div className="dispatch-review">{reviewTrip ? <TripRouteReview key={reviewTrip.id} trip={reviewTrip} onChanged={trips.reload} /> : <Card title="Trip review"><EmptyState title="Every journey starts with a plan" description="Create a draft on the left, or choose Review route from the trips below. Review the actual route and its conditions here before dispatch." /></Card>}</div>
      </div>
      <Card title="Trips">
        {trips.status === 'loading' ? (
          <LoadingState label="Loading trips…" />
        ) : trips.status === 'error' ? (
          <ErrorState error={trips.error} onRetry={trips.reload} />
        ) : trips.data && trips.data.items.length === 0 ? (
          <EmptyState
            title="No trips yet"
            description="Plan one above to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            {/* Every row action can be legitimately refused - a trip someone
                else already closed, a driver whose assignment was ended, a
                transition the lifecycle forbids. All three must surface. Only
                dispatch did, so a refused Cancel or Close stopped its spinner,
                changed nothing, and told the manager nothing - which during a
                demo is indistinguishable from a dead button. */}
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
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {trips.data?.items.map((trip) => (
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
                    <td className="py-3">
                      <StatusPill status={trip.status} />
                    </td>
                    <td className="py-3 text-right">
                      {/* Only actions legal from the current state are shown.
                          A control that is present is one the server will
                          accept. */}
                      <div className="flex flex-wrap justify-end gap-2">
                        {can('route:read') ? <Button variant="secondary" onClick={() => { setReviewTrip(trip); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Review route</Button> : null}
                        {trip.status === 'DRAFT' && can('trip:dispatch') ? (
                          <Button
                            variant="secondary"
                            busy={
                              actingOn === trip.id && dispatchTrip.isSubmitting
                            }
                            disabled={actingOn !== null && actingOn !== trip.id}
                            onClick={() =>
                              void run(trip.id, () => dispatchTrip.submit(trip.id))
                            }
                          >
                            Dispatch
                          </Button>
                        ) : null}
                        {trip.status === 'DELIVERED' && can('trip:close') ? (
                          <Button
                            variant="secondary"
                            busy={actingOn === trip.id && closeTrip.isSubmitting}
                            disabled={
                              closeBlocked !== null ||
                              (actingOn !== null && actingOn !== trip.id)
                            }
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
                            variant="danger"
                            busy={actingOn === trip.id && cancelTrip.isSubmitting}
                            disabled={
                              cancelBlocked !== null ||
                              (actingOn !== null && actingOn !== trip.id)
                            }
                            title={cancelBlocked ?? undefined}
                            onClick={() => {
                              if (!window.confirm(`Cancel ${trip.trip_code}?`)) return
                              void run(trip.id, () => cancelTrip.submit(trip.id))
                            }}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
