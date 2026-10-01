/**
 * A notification in words: its headline and the line under it, built from its
 * kind and payload (see NotificationsPage for why the sentence is built in the
 * browser). Shared by the inbox and the Overview's activity card, and kept out
 * of the page so the Overview does not pull the whole inbox into the shell.
 */

import type { Notification } from '../api/client'

/** One row's headline, from its kind and payload. */
export function headline(n: Notification): string {
  const p = n.payload ?? {}
  const trip = p.trip_code ?? 'a trip'
  switch (n.kind) {
    case 'INCOMING_TRIP':
      return `Incoming: ${trip} is on its way to your district`
    case 'TRIP_DISPATCHED':
      return `Dispatched: ${trip} has left`
    case 'ROUTE_CHANGED':
      return `Route changed on ${trip}`
    case 'TRIP_DELAYED':
      return `${trip} is delayed`
    case 'TRIP_ARRIVED':
      return `${trip} has arrived`
    case 'TRIP_DELIVERED':
      return `${trip} is delivered`
    case 'DRIVER_EMERGENCY_STOP':
      return `${p.driver_name ?? 'A driver'} has asked to stop ${trip}`
    case 'EMERGENCY_RESOLVED':
      return `The stop request on ${trip} has been answered`
    case 'ROUTE_APPROVED':
      return `A route was approved for ${trip}`
    case 'DRIVER_BREAK_STARTED':
      return `${p.driver_name ?? 'A driver'} is on a ${p.planned_minutes ?? '?'} min break on ${trip}`
    case 'DRIVER_BREAK_ENDED':
      return `${p.driver_name ?? 'The driver'} is back on the road on ${trip}`
    case 'DRIVER_BREAK_OVERDUE':
      return `${p.driver_name ?? 'A driver'}'s break on ${trip} has run past ${p.planned_minutes ?? '?'} min`
    default:
      return trip
  }
}

/** The line under the headline: the detail that decides what to do next. */
export function detail(n: Notification): string {
  const p = n.payload ?? {}
  if (n.kind === 'DRIVER_EMERGENCY_STOP') {
    return p.reason ? `"${p.reason}"` : 'No reason recorded.'
  }
  if (n.kind === 'DRIVER_BREAK_STARTED') {
    const at = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '?')
    const place = p.lat != null && p.lon != null ? ` · at ${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}` : ' · place not known'
    return `${p.reason ?? 'No reason'} · from ${at(p.started_at)}, due back ${at(p.expected_end_at)}${place}`
  }
  if (n.kind === 'DRIVER_BREAK_ENDED') {
    const mins = Math.round(Number(p.actual_seconds ?? 0) / 60)
    return `${p.reason ?? 'Break'} · ${mins} min of ${p.planned_minutes ?? '?'} planned${String(p.overdue) === 'true' ? ' · overran' : ''}`
  }
  if (n.kind === 'DRIVER_BREAK_OVERDUE') {
    return `${p.reason ?? 'Break'} · not resumed yet. Consider calling the driver.`
  }
  const bits = [
    p.driver_name,
    p.truck,
    p.origin && p.destination ? `${p.origin} → ${p.destination}` : null,
  ].filter(Boolean)
  return bits.join(' · ')
}
