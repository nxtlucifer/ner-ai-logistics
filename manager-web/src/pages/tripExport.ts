/**
 * Exporting a trip list: CSV and a printable report.
 *
 * NO EXPORT LIBRARY. The stack has neither an XLSX writer nor a PDF writer,
 * and adding one to emit a table would be a dependency and a supply-chain
 * risk for something the platform already does. So:
 *
 *   CSV  - a Blob and a download link. Named "Export CSV", never ".xlsx",
 *          because a CSV with a spreadsheet extension is a lie that Excel
 *          itself complains about. Excel opens CSV.
 *   PDF  - a print-ready page and the browser's own print dialog, where
 *          "Save as PDF" produces a real PDF with selectable text. A
 *          screenshot would not be readable or searchable.
 *
 * WHAT IS EXPORTED is whatever the caller passes, and the caller passes the
 * rows the filters produced - not the page on screen. The button says which.
 * Nothing sensitive travels: no documents, no licence numbers, no
 * coordinates, no phone numbers.
 */

import type { Trip } from '../api/client'

export interface ExportRow {
  trip_code: string
  client: string
  origin: string
  destination: string
  driver: string
  truck: string
  status: string
  route: string
  attention: string
  created: string
  started: string
  finished: string
}

export const EXPORT_COLUMNS: [keyof ExportRow, string][] = [
  ['trip_code', 'Trip'],
  ['client', 'Client'],
  ['origin', 'Origin'],
  ['destination', 'Destination'],
  ['driver', 'Driver'],
  ['truck', 'Truck'],
  ['status', 'Status'],
  ['route', 'Route'],
  ['attention', 'Attention'],
  ['created', 'Created'],
  ['started', 'Started'],
  ['finished', 'Delivered / closed'],
]

const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : ''

/**
 * A field the system HAS but this record does not.
 *
 * An empty cell in an operational export reads as a broken export. "Not
 * recorded" says the row is complete and the value genuinely is not there -
 * which is a different fact, and the only honest one when an old trip predates
 * a field. Timestamps stay blank: "not started" is obvious from the status
 * column, and a column of "Not recorded" would drown the real gaps.
 */
export const NOT_RECORDED = 'Not recorded'
const stored = (value: string | null | undefined): string =>
  value && value.trim() ? value.trim() : NOT_RECORDED

/** One trip as the row a spreadsheet or a report shows. */
export function exportRow(
  trip: Trip,
  lookup: { driver?: string; truck?: string; client?: string; origin?: string; destination?: string; attention?: string },
): ExportRow {
  return {
    trip_code: trip.trip_code,
    // The trip row carries these; the lookup only overrides them.
    client: stored(lookup.client ?? trip.client_name),
    origin: stored(lookup.origin ?? trip.origin),
    destination: stored(lookup.destination ?? trip.destination),
    driver: lookup.driver ?? '',
    truck: lookup.truck ?? '',
    status: trip.status,
    route: trip.selected_route_id ? 'Selected' : 'Not selected',
    attention: lookup.attention ?? '',
    created: when(trip.created_at),
    started: when(trip.started_at),
    finished: when(trip.delivered_at),
  }
}

/**
 * RFC 4180 quoting. A client name with a comma, a quote or a newline in it
 * must not move the columns of every row after it.
 */
export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function toCsv(rows: ExportRow[]): string {
  const head = EXPORT_COLUMNS.map(([, label]) => csvCell(label)).join(',')
  const body = rows.map((r) => EXPORT_COLUMNS.map(([key]) => csvCell(r[key] ?? '')).join(','))
  // CRLF and a UTF-8 BOM: Excel reads a bare LF file as one column, and
  // without the BOM it renders "Guwahati" fine but mangles Hindi client names.
  return '﻿' + [head, ...body].join('\r\n') + '\r\n'
}

export function downloadCsv(rows: ExportRow[], filename: string): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick: revoking synchronously races the download in
  // Firefox and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** The printable report. Plain HTML and a print stylesheet - no library. */
export function reportHtml(
  rows: ExportRow[],
  meta: { title: string; filters: string; generated: string; note?: string },
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font: 11px/1.4 "Segoe UI", Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .meta { color: #555; font-size: 10.5px; margin-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
  .foot { margin-top: 10px; color: #666; font-size: 9.5px; }
</style></head><body>
<h1>RASTA AI — ${escapeHtml(meta.title)}</h1>
<div class="meta">Generated ${escapeHtml(meta.generated)} · ${escapeHtml(meta.filters)} · ${rows.length} row${rows.length === 1 ? '' : 's'}</div>
<table><thead><tr>${EXPORT_COLUMNS.map(([, l]) => `<th>${escapeHtml(l)}</th>`).join('')}</tr></thead>
<tbody>${rows
    .map((r) => `<tr>${EXPORT_COLUMNS.map(([k]) => `<td>${escapeHtml(r[k] ?? '')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>
<div class="foot">${escapeHtml(meta.note ?? 'Operational record. Times are this browser’s local time. No driver documents, licence numbers or positions are included.')}</div>
</body></html>`
}

/**
 * Open the report and raise the print dialog, where the browser's own
 * "Save as PDF" writes the file. Returns false when the window was blocked,
 * so the caller can say so instead of looking like nothing happened.
 */
export function printReport(html: string, open = window.open): boolean {
  const w = open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  // After layout, or Chrome prints a blank first page.
  setTimeout(() => w.print(), 300)
  return true
}
