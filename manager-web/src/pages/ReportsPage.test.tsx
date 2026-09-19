// @vitest-environment jsdom
/**
 * Export and print are greyed until there is a report to export, and they say
 * so: a disabled control with no reason reads as broken.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api, type Driver, type Trip, type Truck } from '../api/client'
import ReportsPage from './ReportsPage'

beforeEach(() => {
  vi.spyOn(api, 'listDrivers').mockResolvedValue({ items: [{ id: 'drv-tenzing-1', full_name: 'Tenzing Bhutia' } as Driver], next_cursor: null })
  vi.spyOn(api, 'listTrucks').mockResolvedValue({ items: [{ id: 'trk-1003', registration_number: 'AS01AB1003' } as Truck], next_cursor: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// REPORT-1: the export names the driver and the truck and says what needs
// attention, exactly as the Trips export does, instead of three blank columns.
it('writes Driver, Truck and Attention into the exported CSV', async () => {
  vi.spyOn(api, 'dashboard').mockResolvedValue({ scope_label: 'North East', states: [], districts: [] } as never)
  vi.spyOn(api, 'listTrips').mockResolvedValue({
    items: [{ id: 't1', trip_code: 'TRP-AFC3D6D6', status: 'ACTIVE', driver_id: 'drv-tenzing-1', truck_id: 'trk-1003', selected_route_id: 'r' } as Trip],
    next_cursor: null,
  })
  let csv: Blob | null = null
  URL.createObjectURL = vi.fn((blob: Blob) => {
    csv = blob
    return 'blob:report'
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  render(<ReportsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Build report' }))
  const button = (await screen.findByRole('button', { name: 'Export CSV' })) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
  const [header, row] = (await (csv as unknown as Blob).text()).trim().split(/\r?\n/)
  expect(header).toContain('Driver,Truck')
  expect(row).toContain('Tenzing Bhutia,AS01AB1003')
  expect(row).toContain('On the road')
})

it('says why Export CSV and Print / PDF wait for the report, and opens them once it is built', async () => {
  vi.spyOn(api, 'dashboard').mockResolvedValue({ scope_label: 'North East', states: [], districts: [] } as never)
  vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [{ id: 't1', trip_code: 'TRP-1', status: 'ACTIVE' } as Trip], next_cursor: null })
  render(<ReportsPage />)

  const csv = (await screen.findByRole('button', { name: 'Export CSV' })) as HTMLButtonElement
  const print = screen.getByRole('button', { name: 'Print / PDF' }) as HTMLButtonElement
  for (const button of [csv, print]) {
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/^Build the report first/)
  }
  expect(screen.getByTestId('export-blocker').textContent).toMatch(/^Build the report first/)

  fireEvent.click(screen.getByRole('button', { name: 'Build report' }))
  await waitFor(() => expect(csv.disabled).toBe(false))
  expect(print.disabled).toBe(false)
  expect(csv.title).toBe('')
  expect(screen.queryByTestId('export-blocker')).toBeNull()
})

it('turns the built rows into six counts, and nothing that is not a count', async () => {
  vi.spyOn(api, 'dashboard').mockResolvedValue({ scope_label: 'Assam · state', states: [], districts: [] } as never)
  vi.spyOn(api, 'listTrips').mockResolvedValue({
    items: ['ACTIVE', 'ASSIGNED', 'DELAYED', 'CLOSED', 'CANCELLED', 'CANCELLED'].map((status, i) => ({ id: `t${i}`, trip_code: `TRP-${i}`, status }) as Trip),
    next_cursor: null,
  })
  render(<ReportsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Build report' }))
  await waitFor(() => expect(screen.getAllByTestId('kpi-card')).toHaveLength(6))
  expect(screen.getAllByTestId('kpi-card').map((c) => c.textContent?.match(/^\D+?(\d+)/)?.slice(0, 2).join('|'))).toEqual([
    'Under way2|2', 'Needing attention1|1', 'Delivered0|0', 'Closed1|1', 'Cancelled2|2', 'Draft0|0',
  ])
  expect(screen.getByTestId('report-note').textContent).toBe('6 trips in your scope.')
  expect(document.body.textContent).not.toMatch(/%|trend|on-time/i)
})

it('never gives the by-state figures the words of the cards, because they count differently', async () => {
  // The dashboard's per-state "under way" includes delayed and incident trips,
  // and counts a trip in both states it touches.
  vi.spyOn(api, 'dashboard').mockResolvedValue({
    scope_label: 'North-East', districts: [],
    states: [{ state_id: 's1', name: 'Assam', districts_configured: 3, trips_under_way: 3, trips_needing_attention: 1 }],
  } as never)
  vi.spyOn(api, 'listTrips').mockResolvedValue({ items: [], next_cursor: null })
  render(<ReportsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Build report' }))
  const headers = (await screen.findAllByRole('columnheader')).map((h) => h.textContent)
  expect(headers).toEqual(['State', 'Under way, incl. delayed', 'Delayed or incident'])
  expect(screen.getByText(/a trip between two states is counted in each/)).toBeDefined()
})
