// @vitest-environment jsdom
/**
 * States: every figure is a count of the listed rows, "pending" is never a 0,
 * and a state opens its districts from the keyboard as well as by a click.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import StatesPage from './StatesPage'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('counts only the listed rows and opens a state through its button', async () => {
  vi.spyOn(api, 'listStates').mockResolvedValue([
    { id: 's1', name: 'Assam', slug: 'assam', source_name: 'MDoNER', district_count: 3 },
    { id: 's2', name: 'Sikkim', slug: 'sikkim', source_name: 'MDoNER', district_count: 0 },
  ])
  const districts = vi.spyOn(api, 'listDistricts').mockResolvedValue([
    { id: 'd1', state_id: 's1', name: 'Kamrup Metropolitan', slug: 'k', source_name: 'demo list', source_status: 'DEMO', disputed_or_recently_changed: false },
  ])
  render(<MemoryRouter><StatesPage /></MemoryRouter>)

  const cards = await screen.findAllByTestId('kpi-card')
  expect(cards.map((c) => c.textContent)).toEqual([
    expect.stringMatching(/^States2/),
    // "On file", not "verified": the count includes demo rows, labelled as such below.
    expect.stringMatching(/^Districts on file3/),
    expect.stringMatching(/^Lists pending1/),
  ])
  // The absence of a list is said in words, not as a zero.
  const table = screen.getByRole('table')
  expect(within(table).getByText('Official district list pending')).toBeDefined()

  const assam = screen.getByRole('button', { name: 'Assam' })
  expect(assam.getAttribute('aria-expanded')).toBe('false')
  // It controls the district panel only while that panel exists.
  expect(assam.getAttribute('aria-controls')).toBeNull()
  fireEvent.click(assam)
  expect(assam.getAttribute('aria-expanded')).toBe('true')
  expect(document.getElementById(assam.getAttribute('aria-controls') ?? '')).not.toBeNull()
  expect(await screen.findByText('Kamrup Metropolitan')).toBeDefined()
  expect(districts).toHaveBeenCalledWith('s1')
  fireEvent.click(assam)
  expect(assam.getAttribute('aria-expanded')).toBe('false')
})
