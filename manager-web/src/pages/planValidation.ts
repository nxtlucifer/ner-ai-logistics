/**
 * Everything "Create draft trip" needs before it may be pressed, in one place.
 *
 * Client-side only - the server re-checks all of it (capacity, licence, login,
 * truck state, and at dispatch the driver/truck assignment). This exists so the
 * button is disabled with ONE stated reason instead of failing after a click.
 * Text in an address box is not a location: an endpoint counts only with a
 * coordinate AND a provenance (search result, map pin, Maps link, typed).
 */
import type { Assignment, Driver, Truck } from '../api/client'
import type { EndpointValue } from '../components/AddressPicker'

export interface Check {
  valid: boolean
  reason: string | null
}

export interface PlanInput {
  client: string
  weight: string
  pickup: EndpointValue
  destination: EndpointValue
  driverId: string
  truckId: string
  drivers: Driver[]
  trucks: Truck[]
  assignments: Assignment[]
  referencesReady: boolean
  submitting: boolean
  today?: Date
}

export interface PlanValidation {
  readiness: Check
  client: Check
  cargo: Check
  pickup: Check
  destination: Check
  driver: Check
  truck: Check
  assignment: Check
  capacity: Check
  /** The first failing reason in workflow order, or null when the draft may be created. */
  blocker: string | null
}

const ok: Check = { valid: true, reason: null }
const fail = (reason: string): Check => ({ valid: false, reason })

const SOURCES = new Set(['GOOGLE', 'MAP', 'GOOGLE_MAPS_LINK', 'MANUAL'])

export function endpointPoint(e: EndpointValue): { lat: number; lon: number } | null {
  if (e.source === null || !SOURCES.has(e.source)) return null
  if (e.lat.trim() === '' || e.lon.trim() === '') return null
  const lat = Number(e.lat)
  const lon = Number(e.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
  return { lat, lon }
}

function endpointCheck(e: EndpointValue, label: string): Check {
  if (e.source === null) return fail(`Select a ${label} location — pick a suggestion, drop a pin, or paste a Maps link.`)
  if (endpointPoint(e) === null) return fail(`${label[0].toUpperCase()}${label.slice(1)} coordinates are incomplete or out of range.`)
  return ok
}

/** A live driver/truck pairing the server will accept at dispatch. */
export function pairedTruckId(assignments: Assignment[], driverId: string): string | null {
  const live = assignments.find(
    (a) => a.driver_id === driverId && (a.status === 'ACTIVE' || a.status === 'PENDING_VERIFICATION'),
  )
  return live?.truck_id ?? null
}

export function validatePlan(input: PlanInput): PlanValidation {
  const today = input.today ?? new Date()
  const readiness = !input.referencesReady
    ? fail('Loading drivers and trucks…')
    : input.submitting
      ? fail('Creating the draft…')
      : ok
  const client = input.client.trim() ? ok : fail('Enter the client name.')
  const kg = Number(input.weight)
  const cargo =
    input.weight.trim() === '' || !Number.isFinite(kg) || kg <= 0
      ? fail('Enter the cargo weight in kg — a positive number.')
      : ok

  const pickup = endpointCheck(input.pickup, 'pickup')
  let destination = endpointCheck(input.destination, 'destination')
  const p = endpointPoint(input.pickup)
  const d = endpointPoint(input.destination)
  if (pickup.valid && destination.valid && p && d && Math.abs(p.lat - d.lat) < 1e-4 && Math.abs(p.lon - d.lon) < 1e-4) {
    destination = fail('Pickup and destination are the same point.')
  }

  const driverRow = input.drivers.find((x) => x.id === input.driverId) ?? null
  const driver = !input.driverId
    ? fail('Select a driver.')
    : !driverRow
      ? fail('That driver is no longer listed.')
      : !driverRow.login_is_active
        ? fail(`${driverRow.full_name}'s login is inactive — they could not start the trip.`)
        : driverRow.status === 'SUSPENDED'
          ? fail(`${driverRow.full_name} is suspended.`)
          : driverRow.status === 'ON_TRIP'
            ? fail(`${driverRow.full_name} is already on a trip.`)
            : new Date(driverRow.licence_expiry) < new Date(today.toDateString())
              ? fail(`${driverRow.full_name}'s licence expired on ${driverRow.licence_expiry}.`)
              : ok

  const truckRow = input.trucks.find((x) => x.id === input.truckId) ?? null
  const truck = !input.truckId
    ? fail('Select a truck.')
    : !truckRow
      ? fail('That truck is no longer listed.')
      : truckRow.status !== 'AVAILABLE'
        ? fail(`${truckRow.registration_number} is ${truckRow.status.toLowerCase().replaceAll('_', ' ')}, not available.`)
        : ok

  let assignment: Check = ok
  if (driverRow && truckRow) {
    const paired = pairedTruckId(input.assignments, driverRow.id)
    if (paired === null) {
      assignment = fail(`${driverRow.full_name} has no truck assigned. Assign one from the driver's profile first.`)
    } else if (paired !== truckRow.id) {
      const reg = input.trucks.find((x) => x.id === paired)?.registration_number ?? 'another truck'
      assignment = fail(`${driverRow.full_name} is paired with ${reg}, not ${truckRow.registration_number}.`)
    }
  } else if (!driverRow || !truckRow) {
    assignment = fail('Select a driver and their assigned truck.')
  }

  const capacity =
    cargo.valid && truckRow && kg > Number(truckRow.max_capacity_kg)
      ? fail(`Cargo exceeds ${truckRow.registration_number}'s capacity of ${Number(truckRow.max_capacity_kg).toLocaleString()} kg.`)
      : ok

  const ordered = [readiness, client, cargo, pickup, destination, driver, truck, assignment, capacity]
  const blocker = ordered.find((c) => !c.valid)?.reason ?? null
  return { readiness, client, cargo, pickup, destination, driver, truck, assignment, capacity, blocker }
}
