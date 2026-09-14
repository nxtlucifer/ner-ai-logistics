import { describe, expect, it } from 'vitest'

import type { Assignment, Driver, Truck } from '../api/client'
import { EMPTY_ENDPOINT, type EndpointValue } from '../components/AddressPicker'
import { pairedTruckId, validatePlan, type PlanInput } from './planValidation'

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
  referencesReady: true, submitting: false, today: new Date('2026-09-14'),
}

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
