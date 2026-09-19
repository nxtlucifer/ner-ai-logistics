// @vitest-environment jsdom
/**
 * The inbox renders a sentence from a structured row.
 *
 * The server deliberately stores `kind` plus a payload and never a written
 * sentence, so the wording lives here. These tests are what stops that
 * wording drifting into something a manager cannot act on - "Notification"
 * with no trip code, or an emergency that does not say what is wrong.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, type Emergency, type Notification } from '../api/client'
import { EmergencyContext } from '../hooks/useEmergencies'
import NotificationsPage from './NotificationsPage'
import { detail, headline } from './notificationText'

const row = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  trip_id: 't1',
  kind: 'TRIP_DISPATCHED',
  severity: 'INFO',
  payload: { trip_code: 'TRP-ALPHA' },
  is_read: false,
  created_at: new Date().toISOString(),
  read_at: null,
  ...over,
})

describe('headline', () => {
  it('names the trip in every kind it knows', () => {
    const kinds: Notification['kind'][] = [
      'TRIP_DISPATCHED',
      'INCOMING_TRIP',
      'ROUTE_CHANGED',
      'TRIP_DELAYED',
      'TRIP_ARRIVED',
      'TRIP_DELIVERED',
      'EMERGENCY_RESOLVED',
      'ROUTE_APPROVED',
    ]
    for (const kind of kinds) {
      expect(headline(row({ kind })), kind).toContain('TRP-ALPHA')
    }
  })

  it('tells the destination district a truck is COMING, not that one left', () => {
    // The two sides of a corridor need different sentences: only one of them
    // has to make room today.
    expect(headline(row({ kind: 'INCOMING_TRIP' }))).toMatch(/on its way/i)
    expect(headline(row({ kind: 'TRIP_DISPATCHED' }))).toMatch(/has left/i)
  })

  it('names the driver when one is asking for help', () => {
    const h = headline(
      row({
        kind: 'DRIVER_EMERGENCY_STOP',
        severity: 'URGENT',
        payload: { trip_code: 'TRP-ALPHA', driver_name: 'Bipul Das' },
      }),
    )
    expect(h).toContain('Bipul Das')
    expect(h).toContain('TRP-ALPHA')
  })

  it('does not print "undefined" when the payload is thin', () => {
    expect(headline(row({ payload: {} }))).not.toMatch(/undefined|null/)
  })
})

describe('detail', () => {
  it('leads with the reason for an emergency, because that is the decision', () => {
    expect(
      detail(
        row({
          kind: 'DRIVER_EMERGENCY_STOP',
          payload: { reason: 'Rock fall across the road' },
        }),
      ),
    ).toContain('Rock fall across the road')
  })

  it('says so plainly when an emergency carries no reason', () => {
    expect(detail(row({ kind: 'DRIVER_EMERGENCY_STOP', payload: {} }))).toMatch(
      /no reason recorded/i,
    )
  })

  it('shows the corridor when both ends are known', () => {
    expect(
      detail(row({ payload: { origin: 'Guwahati', destination: 'Shillong' } })),
    ).toContain('Guwahati → Shillong')
  })

  it('omits half a corridor rather than printing an arrow to nowhere', () => {
    expect(detail(row({ payload: { origin: 'Guwahati' } }))).not.toContain('→')
  })
})

describe('the inbox page', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('filters with the same query as before, and says unread in words rather than by fading', async () => {
    const list = vi.spyOn(api, 'listNotifications').mockImplementation(async (q) =>
      q?.unread_only ? [row({ id: 'n1' })] : [row({ id: 'n1' }), row({ id: 'n2', is_read: true, kind: 'TRIP_DELIVERED' })])
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>)

    expect(await screen.findByText('Dispatched: TRP-ALPHA has left')).toBeDefined()
    expect(list).toHaveBeenLastCalledWith({ unread_only: true, limit: 50 })
    expect(screen.getAllByText('Unread').filter((e) => e.tagName === 'SPAN')).toHaveLength(1)
    const all = screen.getByRole('button', { name: 'All' })
    expect(all.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(all)
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ unread_only: false, limit: 50 }))
    expect(await screen.findByText('TRP-ALPHA is delivered')).toBeDefined()
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    // The read row carries no Unread pill and is not dimmed.
    expect(screen.getAllByText('Unread').filter((e) => e.tagName === 'SPAN')).toHaveLength(1)
    expect(document.querySelector('li.opacity-70')).toBeNull()
  })

  // AUD2-04: the SOS list, not the notice's severity, says whether a driver
  // still needs an answer.
  it('stops calling a resolved stop request urgent, and demotes its Call button', async () => {
    const sos = row({ id: 'n9', kind: 'DRIVER_EMERGENCY_STOP', severity: 'URGENT', trip_id: 't1', payload: { trip_code: 'TRP-ALPHA', driver_name: 'Tenzing Bhutia', driver_phone: '+919435000003' } })
    vi.spyOn(api, 'listNotifications').mockResolvedValue([sos])
    const draw = (open: Emergency[]) =>
      render(
        <EmergencyContext.Provider value={{ emergencies: open, loaded: true, unavailable: false, reload: async () => {} }}>
          <MemoryRouter><NotificationsPage /></MemoryRouter>
        </EmergencyContext.Provider>,
      )

    draw([])
    await screen.findByText(/no SOS is open on this trip now/)
    expect(screen.queryByText(/needs an answer now/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Call Tenzing Bhutia' }).className).not.toContain('bg-primary')

    cleanup()
    draw([{ id: 'e1', trip_id: 't1' } as Emergency])
    await screen.findByText(/needs an answer now/)
    expect(screen.getByRole('link', { name: 'Call Tenzing Bhutia' }).className).toContain('bg-primary')
  })

  it('shuts Mark all read with the reason when nothing is unread', async () => {
    vi.spyOn(api, 'listNotifications').mockResolvedValue([])
    const mark = vi.spyOn(api, 'markNotificationsRead')
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>)
    expect(await screen.findByText('Nothing unread')).toBeDefined()
    const button = screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(/nothing left to mark read/)).toBeDefined()
    expect(mark).not.toHaveBeenCalled()
  })
})
