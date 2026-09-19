/**
 * The export must say what it wrote and write what it said.
 *
 * A comma in a client name silently moving every column after it is the
 * classic CSV defect, and a "PDF" that is really a screenshot is the classic
 * dishonest one. Both are checked here.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { EXPORT_COLUMNS, NOT_RECORDED, csvCell, exportRow, printReport, reportHtml, toCsv } from './tripExport'
import { activeFilterCount, describeFilters, EMPTY_FILTERS } from './TripListControls'
import type { Trip } from '../api/client'

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 't1', trip_code: 'TRP-ALPHA', shipment_id: 's1', truck_id: 'k1', driver_id: 'd1',
  client_name: 'Brahmaputra Traders', origin: 'Guwahati Depot', destination: 'Shillong Depot',
  status: 'DELIVERED', selected_route_id: 'r1', dispatched_at: null,
  started_at: '2026-09-18T04:30:00Z', delivered_at: '2026-09-18T09:00:00Z',
  planned_eta: null, current_eta: null, delay_minutes: null,
  created_at: '2026-09-18T04:00:00Z', ...over,
})

describe('what the row says about the trip', () => {
  it('takes client, origin and destination from the trip itself', () => {
    // The defect: 107 exported rows had Trip, Driver, Truck and Status and a
    // blank Client, Origin and Destination, because the caller had no lookup
    // for them and the list row did not carry them.
    const row = exportRow(trip(), { driver: 'D', truck: 'T' })
    expect(row.client).toBe('Brahmaputra Traders')
    expect(row.origin).toBe('Guwahati Depot')
    expect(row.destination).toBe('Shillong Depot')
  })

  it('says "Not recorded" for a field the record genuinely lacks, never a blank', () => {
    const row = exportRow(trip({ client_name: null, origin: null, destination: '  ' }), {})
    expect(row.client).toBe(NOT_RECORDED)
    expect(row.origin).toBe(NOT_RECORDED)
    expect(row.destination).toBe(NOT_RECORDED)
    // A timestamp stays blank: "not started" is already in the status column.
    expect(exportRow(trip({ started_at: null }), {}).started).toBe('')
  })
})

describe('CSV', () => {
  it('quotes a cell that would otherwise move the columns', () => {
    expect(csvCell('Brahmaputra Traders')).toBe('Brahmaputra Traders')
    expect(csvCell('Traders, Guwahati')).toBe('"Traders, Guwahati"')
    expect(csvCell('He said "go"')).toBe('"He said ""go"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('writes one header and one row per trip, in the stated columns', () => {
    const rows = [exportRow(trip(), { driver: 'RASTA Demo Driver', truck: 'AS86QQ7606', client: 'Traders, Guwahati', attention: 'Close to release the truck' })]
    const csv = toCsv(rows)
    const lines = csv.replace('﻿', '').trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0].split(',')).toHaveLength(EXPORT_COLUMNS.length)
    expect(lines[1]).toContain('TRP-ALPHA')
    expect(lines[1]).toContain('"Traders, Guwahati"')
    expect(lines[1]).toContain('AS86QQ7606')
    // Excel reads a bare LF file as a single column and mangles non-ASCII
    // without the BOM.
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('\r\n')
  })

  it('carries nothing sensitive', () => {
    const csv = toCsv([exportRow(trip(), { driver: 'RASTA Demo Driver', truck: 'AS86QQ7606' })])
    // Word-ish, because "Shillong" contains "lon" and a place name is not a
    // coordinate. What must never appear: credentials, documents, positions.
    expect(csv).not.toMatch(/licen[cs]e|password|document|latitude|longitude/i)
    expect(csv).not.toMatch(/\d{10}/, )            // a phone number
    expect(csv).not.toMatch(/\d{1,3}\.\d{4,}/)    // a coordinate
  })
})

describe('the printable report', () => {
  it('names the filters and the row count, and escapes the data', () => {
    const html = reportHtml(
      [exportRow(trip(), { client: '<script>alert(1)</script>', driver: 'D', truck: 'T' })],
      { title: 'Trip list', filters: 'History · driver D', generated: '18/09/2026, 15:00' },
    )
    expect(html).toContain('RASTA AI')
    expect(html).toContain('History · driver D')
    expect(html).toContain('1 row')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('reports a blocked pop-up instead of looking like nothing happened', () => {
    expect(printReport('<html></html>', () => null)).toBe(false)
    const w = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() }
    expect(printReport('<html></html>', () => w as unknown as Window)).toBe(true)
    expect(w.document.write).toHaveBeenCalled()
  })
})

describe('filters', () => {
  it('counts only the filters that narrow anything', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTERS, search: '   ' })).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTERS, search: 'TRP', status: 'ACTIVE' })).toBe(2)
  })

  it('describes them in words for the report header and the export note', () => {
    const names = { driver: () => 'RASTA Demo Driver', truck: () => 'AS86QQ7606' }
    expect(describeFilters(EMPTY_FILTERS, names)).toBe('Open trips')
    expect(
      describeFilters({ ...EMPTY_FILTERS, scope: 'HISTORY', status: 'DELIVERED', driverId: 'd1' }, names),
    ).toBe('History · status DELIVERED · driver RASTA Demo Driver')
  })
})
