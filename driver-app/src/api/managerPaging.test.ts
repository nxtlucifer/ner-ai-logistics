/**
 * The manager shell's lists read every row (AUD-02, CERT-DRV-09).
 *
 * The API pages with `limit` (at most 100, 25 when absent) and a cursor. The
 * shell used to send `page_size`, which no route reads, so a regional manager
 * with 26 trips saw 25 - the oldest open trip silently missing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ request }))

const { managerApi } = await import('./manager')

afterEach(() => request.mockReset())

describe('manager lists', () => {
  it('asks with `limit`, never `page_size`, and follows the cursor to the end', async () => {
    request
      .mockResolvedValueOnce({ items: [{ id: 'a' }], next_cursor: 'c1' })
      .mockResolvedValueOnce({ items: [{ id: 'b' }], next_cursor: null })
    const page = await managerApi.listTrips()
    expect(page.items.map((t) => t.id)).toEqual(['a', 'b'])
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/trips?limit=100', '/api/trips?limit=100&cursor=c1'])
  })

  it('keeps a status filter and pages drivers and trucks the same way', async () => {
    request.mockResolvedValue({ items: [], next_cursor: null })
    await managerApi.listTrips('ACTIVE')
    await managerApi.listDrivers()
    await managerApi.listTrucks()
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/trips?trip_status=ACTIVE&limit=100',
      '/api/drivers?limit=100',
      '/api/trucks?limit=100',
    ])
  })

  it('stops after ten pages and leaves the cursor set, so the caller can say the list is partial', async () => {
    request.mockResolvedValue({ items: [{ id: 'x' }], next_cursor: 'more' })
    const page = await managerApi.listDrivers()
    expect(request).toHaveBeenCalledTimes(10)
    expect(page.items).toHaveLength(10)
    expect(page.next_cursor).toBe('more')
  })
})
