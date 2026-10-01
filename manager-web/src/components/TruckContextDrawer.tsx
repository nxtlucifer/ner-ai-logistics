import { Crosshair, Phone, Route, X } from 'lucide-react'

import AuthImage, { initials } from './AuthImage'
import { actionClass } from './pageKit'
import type { Driver, FleetTrip, Freshness, TripDetail, Truck } from '../api/client'
import { awaitingReroute, REROUTE_ASKED } from '../pages/tripExport'

export interface TruckContextDrawerProps {
  trip: FleetTrip | null
  detail: TripDetail | null
  driver: Driver | null
  truck: Truck | null
  onClose?: () => void
  onFocusMap?: () => void
  onSelectRouteTab?: () => void
}

const FRESHNESS_BADGE: Record<Freshness, { label: string; className: string }> = {
  LIVE: { label: 'Driver location: LIVE', className: 'text-ok' },
  STALE: { label: 'Driver location: STALE', className: 'text-warning' },
  NO_CONTACT: { label: 'Driver location: NO CONTACT', className: 'text-danger' },
  NO_LOCATION: { label: 'Driver location: NONE REPORTED', className: 'text-muted' },
}

/** "12 s ago" / "5 min ago" / "3 h ago" - the age the server measured. */
function ageWords(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

/** One figure on a sunken tile: the details card is the card, so no border of its own. */
function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] bg-soft px-2.5 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-ink">{children}</div>
    </div>
  )
}

export function TruckContextDrawer({
  trip,
  detail,
  driver,
  truck,
  onClose,
  onFocusMap,
  onSelectRouteTab,
}: TruckContextDrawerProps) {
  if (!trip) return null

  const weightKg = detail?.shipment?.total_weight_kg
    ? Number(detail.shipment.total_weight_kg)
    : null
  const maxCapacityKg = truck?.max_capacity_kg
    ? Number(truck.max_capacity_kg)
    : null
  const loadPercentage = weightKg !== null && maxCapacityKg !== null && maxCapacityKg > 0
    ? Math.min(100, Math.round((weightKg / maxCapacityKg) * 100))
    : null
  const loadTonnes = weightKg !== null ? (weightKg / 1000).toFixed(1) : null
  const capacityTonnes = maxCapacityKg !== null ? (maxCapacityKg / 1000).toFixed(1) : null

  const speedKmph = trip.position?.speed_kmph !== null && trip.position?.speed_kmph !== undefined
    ? Math.round(trip.position.speed_kmph)
    : null

  // A driver's reroute request (E2E-R2): the live row's answer when the
  // snapshot carries the field, else the trip read's.
  const proposal = trip.proposed_reroute !== undefined ? trip.proposed_reroute : detail?.proposed_reroute
  const rerouteAsked = awaitingReroute(trip.trip_status, proposal) ? proposal ?? null : null
  const proposedKm = rerouteAsked ? Number(rerouteAsked.distance_km) : NaN

  const freshnessStyle = FRESHNESS_BADGE[trip.freshness] ?? FRESHNESS_BADGE.NO_LOCATION
  // A speed is only current while the position is (DATA-1): a 9-day-old
  // "46 km/h" beside "NO CONTACT" read as the truck moving now.
  const telemetry = (value: string | null) =>
    value === null || trip.freshness === 'NO_CONTACT' || trip.freshness === 'NO_LOCATION' ? (
      'Unavailable'
    ) : trip.freshness === 'LIVE' ? (
      value
    ) : (
      <>
        {value}
        <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-warning">
          Last known{trip.position ? ` · ${ageWords(trip.position.age_seconds)}` : ''}
        </span>
      </>
    )

  // Flat, inside the Fleet details card: one surface, divided by a rule, never a
  // card in a card. Solid, not glass: this sits beside a moving map.
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <AuthImage src={driver?.photo_url} alt={`${trip.driver_name} photo`} fallback={trip.driver_name ? initials(trip.driver_name) : 'TR'} className="h-11 w-11 rounded-full" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-ink">{trip.driver_name}</h2>
              <AuthImage src={truck?.photo_url} alt={`${trip.registration_number} photo`} className="h-8 w-11 rounded-md" label="reference" />
            </div>
            {/* Location freshness in words, with its age - never a bare
                STALE pill beside an ACTIVE trip, which read as a
                contradiction. Trip status has its own row in the panel. */}
            <div className={`mt-0.5 text-xs font-semibold ${freshnessStyle.className}`} data-testid="driver-location">
              {freshnessStyle.label}
              {trip.position ? ` · reported ${ageWords(trip.position.age_seconds)}` : ''}
            </div>
            <div className="text-[13px] text-muted">
              {trip.registration_number} · Trip {trip.trip_code}
            </div>
            {/* Where the position comes from, said plainly. This build has ONE
                source - the driver app. No phone telemetry means the manager
                is on dispatcher check-ins by phone; nothing is invented. */}
            <div className="text-xs text-muted" data-testid="position-source">
              {trip.freshness === 'NO_LOCATION' || trip.freshness === 'NO_CONTACT'
                ? 'Driver app: not reporting · Tracking: dispatcher check-in by phone call · Route intelligence still runs server-side'
                : 'Position source: driver app GPS'}
            </div>
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close truck context drawer"
            className="grid size-9 shrink-0 place-items-center rounded-[6px] border border-line text-muted hover:bg-soft hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/* Cargo and payload capacity */}
      <div className="space-y-2 rounded-[8px] bg-soft p-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs">
          <span className="font-medium text-muted">Active Cargo Load</span>
          <span className="font-bold text-ink">
            {loadTonnes ? `${loadTonnes} T` : 'Unavailable'} / {capacityTonnes ? `${capacityTonnes} T Capacity` : 'Capacity unavailable'}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${loadPercentage ?? 0}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted">
          <span>Client: {detail?.shipment?.client_name ?? 'Unavailable'}</span>
          <span>Load Utilization: {loadPercentage !== null ? `${loadPercentage} of 100` : 'Unavailable'}</span>
        </div>
      </div>

      {/* Telemetry */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Tile label="Speed">{telemetry(speedKmph !== null ? `${speedKmph} km/h` : null)}</Tile>
        <Tile label="GPS Accuracy">{telemetry(trip.position?.accuracy_m ? `±${Math.round(trip.position.accuracy_m)}m` : null)}</Tile>
        <Tile label="Trip Progress">{trip.stops_done}/{trip.stops_total} Stops</Tile>
      </div>

      {rerouteAsked ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft/40 p-2" data-testid="reroute-asked">
          <p id={`reroute-asked-detail-${trip.trip_id}`} className="text-xs font-semibold text-warning">{REROUTE_ASKED}</p>
          <p className="mt-0.5 text-xs text-ink">
            Proposed {new Date(rerouteAsked.proposed_at).toLocaleString()}
            {rerouteAsked.distance_km !== null && Number.isFinite(proposedKm) ? ` · ${proposedKm.toLocaleString()} km from where the truck was` : ''}.
            {' '}It is one of the Route options; nothing changes until it is accepted.
          </p>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {driver?.phone ? (
          <a href={`tel:${driver.phone}`} className={actionClass()}>
            <Phone className="size-4" aria-hidden="true" /> Call Driver
          </a>
        ) : null}
        {onFocusMap ? (
          <button type="button" onClick={onFocusMap} className={actionClass()}>
            <Crosshair className="size-4" aria-hidden="true" /> Center on Map
          </button>
        ) : null}
        {onSelectRouteTab ? (
          <button
            type="button"
            onClick={onSelectRouteTab}
            aria-describedby={rerouteAsked ? `reroute-asked-detail-${trip.trip_id}` : undefined}
            className={actionClass('primary')}
          >
            <Route className="size-4" aria-hidden="true" /> Route options
          </button>
        ) : null}
      </div>
    </div>
  )
}
