// @vitest-environment jsdom
/**
 * A draft reserves its truck: the planner will not plan it again, so the
 * Trucks page must not show it free. The pairing itself may still change until
 * a trip commits the driver to the truck (server COMMITS_DRIVER_TO_TRUCK), so
 * for a draft those actions stay open and say what holds the truck.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type Trip } from '../api/client'
import TrucksPage from './TrucksPage'

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ can: () => true }) }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function mockFleet(status: string) {
  vi.spyOn(api, 'listTrucks').mockResolvedValue({
    items: [{ id: 't1', registration_number: 'AS01AB1003', truck_type: null, make: null, model: null, max_capacity_kg: '16000', current_load_kg: '0', status: 'AVAILABLE', baseline_mileage_kmpl: null, created_at: '' }],
    next_cursor: null,
  })
  vi.spyOn(api, 'listAssignments').mockResolvedValue([
    { id: 'a1', driver_id: 'd1', truck_id: 't1', status: 'ACTIVE', assigned_at: '', verified_at: null, mismatch_flagged: false, ended_at: null },
  ])
  vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [{ id: 'd1', full_name: 'Tenzing' }] as never, next_cursor: null })
  return vi.spyOn(api, 'listTrips').mockResolvedValue({
    items: [{ id: 'x', trip_code: 'TRP-2D7425D0', status, driver_id: 'd1', truck_id: 't1' } as Trip],
    next_cursor: null,
  })
}

it('shows a truck held by a draft as reserved; retire is shut, the pairing stays changeable and says why', async () => {
  const listTrips = mockFleet('DRAFT')
  render(<MemoryRouter><TrucksPage /></MemoryRouter>)

  expect((await screen.findByText(/Reserved by TRP-2D7425D0/)).textContent).toMatch(/· draft/)
  // The planner's own list: every open trip, not the newest 50 of any kind.
  expect(listTrips).toHaveBeenCalledWith({ open_only: true, limit: 100 })
  const retire = screen.getByRole('button', { name: 'Retire' }) as HTMLButtonElement
  expect(retire.disabled).toBe(true)
  expect(retire.title).toMatch(/^Reserved by TRP-2D7425D0 — /)
  for (const name of ['Change driver', 'End assignment']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.title).toMatch(/ · draft TRP-2D7425D0 holds this truck$/)
  }
})

it('shuts the pairing actions once a trip commits the driver to the truck', async () => {
  mockFleet('ACTIVE')
  render(<MemoryRouter><TrucksPage /></MemoryRouter>)
  await screen.findByText(/TRP-2D7425D0/)
  for (const name of ['Change driver', 'End assignment']) {
    const button = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/^On TRP-2D7425D0 — /)
  }
})

it('says a reference photo is uploading, and says so when it fails (audit 11.3 D6)', async () => {
  mockFleet('DRAFT')
  let fail: (e: Error) => void = () => {}
  const upload = vi.spyOn(api, 'uploadTruckPhoto').mockImplementation(() => new Promise((_, reject) => { fail = reject }))
  render(<MemoryRouter><TrucksPage /></MemoryRouter>)

  const input = (await screen.findByLabelText('Upload a reference photo for AS01AB1003')) as HTMLInputElement
  const file = new File(['x'], 'plate.jpg', { type: 'image/jpeg' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(upload).toHaveBeenCalledWith('t1', file)
  expect(await screen.findByText('Uploading…')).toBeDefined()
  expect(input.disabled).toBe(true)

  fail(new Error('Upload refused'))
  expect((await screen.findByRole('alert')).textContent).toMatch(/The photo was not saved/)
  expect(screen.queryByText('Uploading…')).toBeNull()
})
