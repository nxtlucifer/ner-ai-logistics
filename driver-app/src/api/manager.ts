/**
 * The manager's slice of the API, for the manager shell on the phone. Same
 * transport (`request`), same paths and shapes as manager-web/src/api/client.ts
 * (docs/API_CONTRACTS.md), only the fields the phone renders. The backend
 * remains the authority: a hidden button is never authorisation.
 */

import { request } from './client'

export interface Page<T> {
  items: T[]
  next_cursor?: string | null
}

export interface MgrDriver {
  id: string
  full_name: string
  phone: string
  photo_url: string | null
  status: 'AVAILABLE' | 'ON_TRIP' | 'OFF_DUTY' | 'SUSPENDED'
  login_is_active: boolean
}

export interface MgrTruck {
  id: string
  registration_number: string
  photo_url?: string | null
  truck_type: string | null
  status: string
}

export interface MgrTrip {
  id: string
  trip_code: string
  truck_id: string
  driver_id: string
  status: string
  selected_route_id: string | null
  dispatched_at: string | null
  started_at: string | null
  delivered_at: string | null
}

export interface MgrStop {
  sequence: number
  kind: string
  status: string
  name: string | null
}

export interface MgrTripDetail extends MgrTrip {
  stops: MgrStop[]
  shipment: { reference_code: string; client_name: string }
}

export interface MgrRoute {
  id: string
  kind: string
  state: string
  distance_km: string | null
  estimated_duration_min: number | null
  geometry: [number, number][]
  is_current: boolean
}

export interface MgrRisk {
  score: number
  band: string
  inputs: Record<string, string>
  unavailable: string[]
  reason_codes: string[]
  decision: string | null
  decision_reason_codes: string[]
}

export interface MgrReroute {
  outcome: 'NO_ACTION' | 'ALERT_ONLY' | 'PROPOSE'
  selected_route_id: string | null
  proposed_route_id: string | null
  reason_codes: string[]
}

export interface FleetTrip {
  trip_id: string
  trip_code: string
  trip_status: string
  driver_name: string
  registration_number: string
  /** The server's shape (schemas/domain.py ActiveFleetPosition): the point
   *  is nested under `location`. Typed flat, the phone's Map tab read
   *  undefined coordinates and Leaflet threw, blanking the manager shell. */
  position: { location: { lat: number; lon: number }; recorded_at: string; accuracy_m?: number | null } | null
  freshness: string
  stops_done: number
  stops_total: number
}

export interface ProviderRow {
  provider: string
  product: string
  state: string
  freshness: string
  last_error: string | null
}

/** At most this many pages are walked: a thousand rows is past anything the
 *  phone's manager shell can show usefully. ManagerRoot's CutShort names the
 *  1,000; change both together. */
const MAX_PAGES = 10

/**
 * Every row of a list, following the server's cursor (AUD-02). The API reads
 * `limit` (at most 100; 25 when absent) - it never read the `page_size` this
 * used to send, so the regional list silently lost every trip past the 25th.
 * `next_cursor` stays set when the walk stopped short, so a caller can say so.
 */
export async function allPages<T>(path: string): Promise<Page<T>> {
  const at = (cursor?: string | null) =>
    request<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
  let page = await at()
  const items = [...page.items]
  for (let n = 1; n < MAX_PAGES && page.next_cursor; n++) {
    page = await at(page.next_cursor)
    items.push(...page.items)
  }
  return { ...page, items }
}

export const managerApi = {
  listTrips: (status?: string) => allPages<MgrTrip>(`/api/trips${status ? `?trip_status=${status}` : ''}`),
  getTrip: (id: string) => request<MgrTripDetail>(`/api/trips/${id}`),
  routes: (tripId: string) => request<MgrRoute[]>(`/api/trips/${tripId}/routes`),
  risk: (tripId: string, routeId: string) => request<MgrRisk>(`/api/trips/${tripId}/routes/${routeId}/risk`),
  reroute: (tripId: string) => request<MgrReroute>(`/api/trips/${tripId}/reroute`),
  dispatch: (tripId: string) => request<MgrTrip>(`/api/trips/${tripId}/dispatch`, { method: 'POST', body: {} }),
  acceptReroute: (tripId: string, fromRouteId: string, toRouteId: string) =>
    request<unknown>(`/api/trips/${tripId}/reroute/accept`, { method: 'POST', body: { from_route_id: fromRouteId, to_route_id: toRouteId } }),
  listDrivers: () => allPages<MgrDriver>('/api/drivers'),
  listTrucks: () => allPages<MgrTruck>('/api/trucks'),
  activeFleet: () => request<{ trips: FleetTrip[] }>('/api/fleet/active'),
  providers: () => request<{ providers: ProviderRow[] }>('/api/system/providers'),
  ready: () => request<{ status: string }>('/ready'),
}

