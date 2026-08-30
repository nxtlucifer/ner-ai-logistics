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
 * re-checks the licence, the truck's condition and the driver/truck assignment,
 * because all of those can change between planning and dispatch.
 *
 * The form creates the shipment and the trip together, since a shipment with no
 * trip is not useful here, but each call's error is surfaced on its own.
 */

import { useState } from 'react'

import { api, type Trip } from '../api/client'
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

/** Guwahati. A sensible starting point for a region the operators work in. */
const DEFAULT_PICKUP = { lat: '26.1445', lon: '91.7362' }
/** Jorhat. */
const DEFAULT_DESTINATION = { lat: '26.7509', lon: '94.2037' }

interface CoordinateInput {
  lat: string
  lon: string
}

/**
 * Parse a typed coordinate.
 *
 * Rejected here as well as at the server because PostGIS would WRAP an
 * out-of-range latitude over the pole into a plausible-looking point rather
 * than refusing it. A manager who transposes lat and lon should be told, not
 * shown a truck in the Arctic.
 */
function parseCoordinate(
  input: CoordinateInput,
  label: string,
): { value?: { lat: number; lon: number }; error?: string } {
  const lat = Number(input.lat)
  const lon = Number(input.lon)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: `${label} latitude must be between -90 and 90.` }
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { error: `${label} longitude must be between -180 and 180.` }
  }
  return { value: { lat, lon } }
}

export default function TripsPage() {
  const { can } = useAuth()

  const trips = useResource(() => api.listTrips({ limit: 50 }), [])
  const drivers = useResource(() => api.listDrivers({ limit: 100 }), [])
  const trucks = useResource(() => api.listTrucks({ limit: 100 }), [])

  const [client, setClient] = useState('')
  const [weight, setWeight] = useState('1000')
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickup, setPickup] = useState<CoordinateInput>(DEFAULT_PICKUP)
  const [destinationAddress, setDestinationAddress] = useState('')
  const [destination, setDestination] = useState<CoordinateInput>(
    DEFAULT_DESTINATION,
  )
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

  const create = useMutation(async () => {
    const pickupPoint = parseCoordinate(pickup, 'Pickup')
    if (pickupPoint.error) throw new Error(pickupPoint.error)
    const destinationPoint = parseCoordinate(destination, 'Destination')
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
    const stamp = Date.now().toString(36).toUpperCase()
    return api.planTrip({
      shipment: {
        reference_code: `SHP-${stamp}`,
        client_name: client.trim(),
        pickup_address: pickupAddress.trim(),
        pickup: pickupPoint.value!,
        destination_address: destinationAddress.trim(),
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
    setClient('')
    setPickupAddress('')
    setDestinationAddress('')
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
    client.trim() && pickupAddress.trim() && destinationAddress.trim() &&
    weight.trim() && driverId && truckId

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Trips</h1>
        <p className="text-xs text-slate-500">
          A trip is created as a draft and only becomes the driver's to start
          when it is dispatched — which re-checks the licence, the truck and the
          assignment at that moment.
        </p>
      </div>

      {canCreate ? (
        <Card title="Plan a trip">
          {!referencesReady ? (
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
                <Field
                  label="Pickup address"
                  name="pickup_address"
                  value={pickupAddress}
                  onChange={setPickupAddress}
                  required
                  placeholder="Depot, Guwahati"
                />
                <Field
                  label="Destination address"
                  name="destination_address"
                  value={destinationAddress}
                  onChange={setDestinationAddress}
                  required
                  placeholder="Yard, Jorhat"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field
                    label="Pickup lat"
                    name="pickup_lat"
                    value={pickup.lat}
                    onChange={(v) => setPickup((p) => ({ ...p, lat: v }))}
                  />
                  <Field
                    label="Pickup lon"
                    name="pickup_lon"
                    value={pickup.lon}
                    onChange={(v) => setPickup((p) => ({ ...p, lon: v }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field
                    label="Destination lat"
                    name="dest_lat"
                    value={destination.lat}
                    onChange={(v) => setDestination((p) => ({ ...p, lat: v }))}
                  />
                  <Field
                    label="Destination lon"
                    name="dest_lon"
                    value={destination.lon}
                    onChange={(v) => setDestination((p) => ({ ...p, lon: v }))}
                  />
                </div>

                <label className="block">
                  <span className="text-xs font-medium text-slate-300">
                    Driver<span className="ml-0.5 text-red-400">*</span>
                  </span>
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
                  >
                    <option value="">Select a driver…</option>
                    {drivers.data?.items.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.full_name} — {d.licence_number}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-slate-300">
                    Truck<span className="ml-0.5 text-red-400">*</span>
                  </span>
                  <select
                    value={truckId}
                    onChange={(e) => setTruckId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-600 focus:outline-none"
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
                <div className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-xs text-red-200">
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
              <thead className="text-xs uppercase tracking-wide text-slate-500">
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
                  <tr key={trip.id} className="border-t border-slate-800">
                    <td className="py-3 font-medium text-slate-200">
                      {trip.trip_code}
                    </td>
                    <td className="py-3 text-slate-300">
                      {driverName(trip.driver_id)}
                    </td>
                    <td className="py-3 text-slate-300">
                      {truckReg(trip.truck_id)}
                    </td>
                    <td className="py-3">
                      <StatusPill status={trip.status} />
                    </td>
                    <td className="py-3 text-right">
                      {/* Only actions legal from the current state are shown.
                          A control that is present is one the server will
                          accept. */}
                      <div className="flex justify-end gap-2">
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
                            disabled={actingOn !== null && actingOn !== trip.id}
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
                            disabled={actingOn !== null && actingOn !== trip.id}
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
