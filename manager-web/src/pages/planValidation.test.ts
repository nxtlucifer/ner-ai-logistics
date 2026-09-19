import { describe, expect, it } from 'vitest'

import type { Assignment, Driver, Trip, Truck } from '../api/client'
import { EMPTY_ENDPOINT, type EndpointValue } from '../components/AddressPicker'
import { pairedTruckId, straightLineKm, validatePlan, type PlanInput } from './planValidation'

const driver: Driver = {
  id: 'd1', user_id: 'u1', full_name: 'Demo Driver', phone: '9000000000', photo_url: null,
  licence_number: 'AS01 2024', licence_expiry: '2030-01-01', status: 'AVAILABLE', login_is_active: true, created_at: '',
}
const truck: Truck = {
  id: 't1', registration_number: 'AS86QQ7606', truck_type: null, make: null, model: null,
  max_capacity_kg: '16000', current_load_kg: '0', status: 'AVAILABLE', baseline_mileage_kmpl: null, created_at: '',
}
const other: Truck = { ...truck, id: 't2', registration_number: 'AS01ZZ0001' }
const paired: Assignment = {
  id: 'a1', driver_id: 'd1', truck_id: 't1', status: 'ACTIVE', assigned_at: '', verified_at: null, mismatch_flagged: false, ended_at: null,
}
const pin = (lat: string, lon: string, source: EndpointValue['source'] = 'MAP'): EndpointValue => ({ address: 'Somewhere', lat, lon, source, attribution: null })

const good: PlanInput = {
  client: 'Brahmaputra Traders', weight: '1000',
  pickup: pin('26.1445', '91.7362'), destination: pin('25.5788', '91.8933', 'GOOGLE'),
  driverId: 'd1', truckId: 't1', drivers: [driver], trucks: [truck, other], assignments: [paired],
  openTrips: [],
  referencesReady: true, submitting: false, today: new Date('2026-09-14'),
}

/** An open trip holding this driver and truck. */
const holding = (status: Trip['status'], over: Partial<Trip> = {}): Trip => ({
  id: 'x1', trip_code: 'TRP-HELD', shipment_id: 's1', truck_id: 't1', driver_id: 'd1',
  status, selected_route_id: null, dispatched_at: null, started_at: null, delivered_at: null,
  planned_eta: null, current_eta: null, delay_minutes: null, created_at: '', ...over,
})

describe('validatePlan', () => {
  it('passes a complete, paired, in-capacity plan', () => {
    expect(validatePlan(good).blocker).toBeNull()
  })

  it.each<[string, Partial<PlanInput>, RegExp]>([
    ['blank client', { client: '   ' }, /client name/],
    ['zero cargo', { weight: '0' }, /positive number/],
    ['negative cargo', { weight: '-5' }, /positive number/],
    ['non-number cargo', { weight: 'ten' }, /positive number/],
    ['cargo above capacity', { weight: '16001' }, /exceeds AS86QQ7606's capacity/],
    ['pickup typed but unresolved', { pickup: { ...EMPTY_ENDPOINT, address: 'Guwahati' } }, /Select a pickup location/],
    ['destination typed but unresolved', { destination: { ...EMPTY_ENDPOINT, address: 'Shillong' } }, /Select a destination location/],
    ['pickup equals destination', { destination: pin('26.1445', '91.7362') }, /same point/],
    ['invalid latitude', { pickup: pin('91', '91.7') }, /Pickup coordinates/],
    ['invalid longitude', { destination: pin('25.5', '181', 'MANUAL') }, /Destination coordinates/],
    ['no driver', { driverId: '' }, /Select a driver/],
    ['driver login disabled', { drivers: [{ ...driver, login_is_active: false }] }, /login is inactive/],
    ['driver suspended', { drivers: [{ ...driver, status: 'SUSPENDED' }] }, /suspended/],
    ['driver busy', { drivers: [{ ...driver, status: 'ON_TRIP' }] }, /already on a trip/],
    ['licence expired', { drivers: [{ ...driver, licence_expiry: '2026-09-13' }] }, /licence expired/],
    ['no truck', { truckId: '' }, /Select a truck/],
    ['truck busy', { trucks: [{ ...truck, status: 'ON_TRIP' }, other] }, /on trip, not available/],
    ['driver has no assignment', { assignments: [] }, /no truck assigned/],
    ['driver paired with another truck', { truckId: 't2' }, /paired with AS86QQ7606, not AS01ZZ0001/],
    ['references still loading', { referencesReady: false }, /Loading drivers/],
    ['request in flight', { submitting: true }, /Creating the draft/],
  ])('blocks: %s', (_name, patch, reason) => {
    const result = validatePlan({ ...good, ...patch })
    expect(result.blocker).toMatch(reason)
  })

  it('ignores an ended assignment when pairing', () => {
    expect(pairedTruckId([{ ...paired, status: 'ENDED' }], 'd1')).toBeNull()
    expect(pairedTruckId([{ ...paired, status: 'PENDING_VERIFICATION' }], 'd1')).toBe('t1')
  })

  it('reports every failing check, not just the first', () => {
    const result = validatePlan({ ...good, client: '', weight: '', driverId: '' })
    expect(result.client.valid).toBe(false)
    expect(result.cargo.valid).toBe(false)
    expect(result.driver.valid).toBe(false)
    expect(result.blocker).toMatch(/client name/)
  })
})

describe('where a trip may go is decided by the server', () => {
  // Owner decision 29 Sep 2026: India-wide trips with one end in the
  // North-East. The old client rectangle refused Guwahati to Delhi; the
  // server now decides on real boundaries and its refusal is shown in words.
  it.each<[string, [string, string], [string, string]]>([
    ['Guwahati to Delhi (NER outbound)', ['26.1445', '91.7362'], ['28.6139', '77.2090']],
    ['Nagaland to Ahmedabad (the TRP-08726C5F shape)', ['25.9623701', '94.5856111'], ['23.0687402', '72.6734956']],
    ['Siliguri to Shillong (NER inbound)', ['26.7271', '88.3953'], ['25.5788', '91.8933']],
    // Outside India: still not the client's call. The server answers 422
    // OUTSIDE_SUPPORTED_COUNTRY and the planner shows that answer.
    ['Dhaka to Guwahati', ['23.8103', '90.4125'], ['26.1445', '91.7362']],
  ])('does not block %s', (_name, [plat, plon], [dlat, dlon]) => {
    const out = validatePlan({ ...good, pickup: pin(plat, plon, 'GOOGLE'), destination: pin(dlat, dlon, 'GOOGLE') })
    expect(out.blocker).toBeNull()
    expect(Object.keys(out)).not.toContain('region')
  })

  it('still measures the corridor it shows while planning', () => {
    expect(Math.round(straightLineKm({ lat: 26.1445, lon: 91.7362 }, { lat: 25.5788, lon: 91.8933 }))).toBe(65)
    expect(Math.round(straightLineKm({ lat: 25.9623701, lon: 94.5856111 }, { lat: 23.0687402, lon: 72.6734956 }))).toBe(2237)
  })
})

describe('endpoint labels', () => {
  it('refuses a confirmed point that has no address words (Advanced coordinates without a name)', () => {
    const out = validatePlan({ ...good, pickup: { ...pin('26.1445', '91.7362', 'MANUAL'), address: '' } })
    expect(out.pickup.valid).toBe(false)
    expect(out.blocker).toMatch(/Name the pickup location/)
  })
})

/**
 * One driver and one truck can be on ONE open job.
 *
 * The screenshot that prompted this had the same pair on several open DRAFT
 * rows with another trip already ASSIGNED to them. A driver's own status says
 * AVAILABLE the whole time - the occupancy lives in the trips, not the driver.
 */
describe('a resource already promised to an open trip', () => {
  it('refuses the driver and names the trip holding them', () => {
    const r = validatePlan({ ...good, openTrips: [holding('DRAFT')] })
    expect(r.driver.valid).toBe(false)
    expect(r.driver.reason).toMatch(/already committed to TRP-HELD \(DRAFT\)/)
    expect(r.blocker).toMatch(/TRP-HELD/)
  })

  it('refuses the truck even when another driver is chosen', () => {
    const second: Driver = { ...driver, id: 'd2', full_name: 'Second Driver' }
    const r = validatePlan({
      ...good,
      driverId: 'd2',
      drivers: [driver, second],
      assignments: [{ ...paired, id: 'a2', driver_id: 'd2' }],
      openTrips: [holding('ACTIVE', { driver_id: 'd1' })],
    })
    expect(r.truck.valid).toBe(false)
    expect(r.truck.reason).toMatch(/already committed to TRP-HELD/)
  })

  it.each<[Trip['status']]>([['DRAFT'], ['ASSIGNED'], ['VERIFICATION_PENDING'], ['ACTIVE'], ['DELAYED'], ['DELIVERED']])(
    '%s still holds the pair',
    (status) => {
      expect(validatePlan({ ...good, openTrips: [holding(status)] }).blocker).toMatch(/TRP-HELD/)
    },
  )

  it.each<[Trip['status']]>([['CLOSED'], ['CANCELLED']])('%s releases the pair', (status) => {
    expect(validatePlan({ ...good, openTrips: [holding(status)] }).blocker).toBeNull()
  })

  it('leaves an unrelated open trip alone', () => {
    const elsewhere = holding('ACTIVE', { id: 'x2', trip_code: 'TRP-OTHER', driver_id: 'd9', truck_id: 't9' })
    expect(validatePlan({ ...good, openTrips: [elsewhere] }).blocker).toBeNull()
  })
})
