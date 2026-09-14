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
  position: { lat: number; lon: number; recorded_at: string; accuracy_m?: number | null } | null
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

export const managerApi = {
  listTrips: (status?: string) => request<Page<MgrTrip>>(`/api/trips?page_size=100${status ? `&trip_status=${status}` : ''}`),
  getTrip: (id: string) => request<MgrTripDetail>(`/api/trips/${id}`),
  routes: (tripId: string) => request<MgrRoute[]>(`/api/trips/${tripId}/routes`),
  risk: (tripId: string, routeId: string) => request<MgrRisk>(`/api/trips/${tripId}/routes/${routeId}/risk`),
  reroute: (tripId: string) => request<MgrReroute>(`/api/trips/${tripId}/reroute`),
  dispatch: (tripId: string) => request<MgrTrip>(`/api/trips/${tripId}/dispatch`, { method: 'POST', body: {} }),
  acceptReroute: (tripId: string, fromRouteId: string, toRouteId: string) =>
    request<unknown>(`/api/trips/${tripId}/reroute/accept`, { method: 'POST', body: { from_route_id: fromRouteId, to_route_id: toRouteId } }),
  listDrivers: () => request<Page<MgrDriver>>('/api/drivers?page_size=100'),
  listTrucks: () => request<Page<MgrTruck>>('/api/trucks?page_size=100'),
  activeFleet: () => request<{ trips: FleetTrip[] }>('/api/fleet/active'),
  providers: () => request<{ providers: ProviderRow[] }>('/api/system/providers'),
  ready: () => request<{ status: string }>('/ready'),
}

