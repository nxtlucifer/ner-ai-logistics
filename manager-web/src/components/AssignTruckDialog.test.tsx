/**
 * The one dialog every "Assign truck" entry point opens. What matters is the
 * verdict before the click: a pairing the server will refuse is never offered
 * as a live button, and a pairing that ends another is said in words.
 */

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api, type Assignment, type Driver, type Trip, type Truck } from '../api/client'
import AssignTruckDialog, { assignmentBlocker } from './AssignTruckDialog'

const driver = (o: Partial<Driver> = {}): Driver => ({
  id: 'd1', user_id: 'u1', full_name: 'Probe Driver', phone: '9000000000', photo_url: null,
  licence_number: 'AS-1', licence_expiry: '2030-01-01', status: 'AVAILABLE', login_is_active: true, created_at: '', ...o,
})
const truck = (o: Partial<Truck> = {}): Truck => ({
  id: 't1', registration_number: 'AS06QQ1107', truck_type: null, make: null, model: null,
  max_capacity_kg: '16000', current_load_kg: '0', status: 'AVAILABLE', baseline_mileage_kmpl: null, created_at: '', ...o,
})
const pairing = (driver_id: string, truck_id: string): Assignment => ({
  id: `a-${driver_id}-${truck_id}`, driver_id, truck_id, status: 'ACTIVE', assigned_at: '', verified_at: null, mismatch_flagged: false, ended_at: null,
})
const trip = (driver_id: string, truck_id: string): Trip => ({
  id: 'tr1', trip_code: 'TRP-LIVE', shipment_id: 's', truck_id, driver_id, status: 'ACTIVE', selected_route_id: 'r',
  dispatched_at: null, started_at: null, delivered_at: null, planned_eta: null, current_eta: null, delay_minutes: null, created_at: '',
})

describe('assignmentBlocker', () => {
  const bipul = driver({ id: 'd2', full_name: 'Bipul Das' })
  it('refuses the pairing the server would refuse, in words', () => {
    expect(assignmentBlocker({ driver: null, truck: truck(), assignments: [], trips: [], drivers: [] })).toMatch(/choose a driver/i)
    expect(assignmentBlocker({ driver: driver({ login_is_active: false }), truck: truck(), assignments: [], trips: [], drivers: [] })).toMatch(/login is inactive/i)
    expect(assignmentBlocker({ driver: driver({ licence_expiry: '2020-01-01' }), truck: truck(), assignments: [], trips: [], drivers: [] })).toMatch(/licence has expired/i)
    expect(assignmentBlocker({ driver: driver(), truck: truck({ status: 'MAINTENANCE' }), assignments: [], trips: [], drivers: [] })).toMatch(/not operational/i)
    expect(assignmentBlocker({ driver: driver(), truck: truck(), assignments: [pairing('d1', 't1')], trips: [], drivers: [] })).toMatch(/already paired/i)
    // A driver mid-trip keeps their truck; a truck mid-trip keeps its driver.
    expect(assignmentBlocker({ driver: driver(), truck: truck({ id: 't2' }), assignments: [pairing('d1', 't1')], trips: [trip('d1', 't1')], drivers: [] })).toMatch(/on TRP-LIVE/)
    expect(assignmentBlocker({ driver: driver(), truck: truck(), assignments: [pairing('d2', 't1')], trips: [trip('d2', 't1')], drivers: [bipul] })).toMatch(/on TRP-LIVE with Bipul Das/)
  })
  it('allows taking a free truck from an idle driver - the server ends that pairing', () => {
    expect(assignmentBlocker({ driver: driver(), truck: truck(), assignments: [pairing('d2', 't1')], trips: [], drivers: [bipul] })).toBeNull()
  })
})

describe('AssignTruckDialog', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [driver(), driver({ id: 'd2', full_name: 'Bipul Das' })], next_cursor: null })
    vi.spyOn(api, 'listTrucks').mockResolvedValue({ items: [truck(), truck({ id: 't2', registration_number: 'AS01AB1234' })], next_cursor: null })
    vi.spyOn(api, 'listAssignments').mockResolvedValue([pairing('d2', 't2')])
    vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('preselects the driver, states the verdict, and assigns through the server once', async () => {
    const user = userEvent.setup()
    const create = vi.spyOn(api, 'createAssignment').mockResolvedValue(pairing('d1', 't1'))
    const onChanged = vi.fn(); const onClose = vi.fn()
    render(<AssignTruckDialog driverId="d1" onClose={onClose} onChanged={onChanged} />)

    const truckSelect = await screen.findByLabelText('Truck')
    expect((screen.getByLabelText('Driver') as HTMLSelectElement).value).toBe('d1')
    expect(screen.getByTestId('assign-blocker').textContent).toMatch(/choose a truck/i)
    const submit = () => screen.getByRole('button', { name: /assign truck|change pairing/i }) as HTMLButtonElement
    expect(submit().disabled).toBe(true)

    await user.selectOptions(truckSelect, 't1')
    expect(screen.getByTestId('assign-summary').textContent).toMatch(/Probe Driver.*AS06QQ1107/)
    expect(submit().disabled).toBe(false)
    // Two presses in the same tick: the mutation's in-flight guard makes the
    // second a no-op, so a nervous double-click is one server call.
    fireEvent.click(submit())
    fireEvent.click(submit())
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith('d1', 't1')
    expect(onClose).toHaveBeenCalled()
  })

  it('says whose truck is being taken and offers "Change pairing"', async () => {
    const user = userEvent.setup()
    render(<AssignTruckDialog truckId="t2" onClose={() => {}} onChanged={() => {}} />)
    await user.selectOptions(await screen.findByLabelText('Driver'), 'd1')
    expect(screen.getByTestId('assign-summary').textContent).toMatch(/takes AS01AB1234 from Bipul Das/)
    expect(screen.getByRole('button', { name: /change pairing/i })).toBeDefined()
  })

  it('surfaces the server refusal instead of pretending', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'createAssignment').mockRejectedValue(
      new ApiError(409, { error: { code: 'ASSIGNMENT_CONFLICT', message: 'That driver or truck was assigned by another request. Please retry.', details: {}, request_id: 'x' } }, 'x'),
    )
    render(<AssignTruckDialog driverId="d1" truckId="t1" onClose={() => {}} onChanged={() => {}} />)
    await user.click(await screen.findByRole('button', { name: /assign truck/i }))
    expect(await screen.findByText(/assigned by another request/i)).toBeDefined()
  })
})
