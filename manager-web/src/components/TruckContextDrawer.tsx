import AuthImage, { initials } from './AuthImage'
import type { Driver, FleetTrip, Freshness, TripDetail, Truck } from '../api/client'

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

  const freshnessStyle = FRESHNESS_BADGE[trip.freshness] ?? FRESHNESS_BADGE.NO_LOCATION

  // Solid surface, not 90% + backdrop-blur. Terrain rules out heavy glass blur,
  // and here it was also costing legibility for nothing: this drawer sits over a
  // moving map, so every truck marker that passed under it swam behind the
  // driver name and the fix timestamp.
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-panel)] space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
            {trip.driver_name
              ? trip.driver_name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
              : 'TR'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <AuthImage src={driver?.photo_url} alt={`${trip.driver_name} photo`} fallback={initials(trip.driver_name)} className="h-8 w-8 rounded-full" />
              <AuthImage src={truck?.photo_url} alt={`${trip.registration_number} photo`} className="h-8 w-10 rounded-md" label="reference" />
              <h2 className="text-sm font-bold text-ink">{trip.driver_name}</h2>
            </div>
            {/* Location freshness in words, with its age - never a bare
                STALE pill beside an ACTIVE trip, which read as a
                contradiction. Trip status has its own row in the panel. */}
            <div className={`mt-0.5 text-[11px] font-semibold ${freshnessStyle.className}`} data-testid="driver-location">
              {freshnessStyle.label}
              {trip.position ? ` · reported ${ageWords(trip.position.age_seconds)}` : ''}
            </div>
            <div className="text-xs text-muted">
              {trip.registration_number} · Trip {trip.trip_code}
            </div>
            {/* Where the position comes from, said plainly. This build has ONE
                source - the driver app. No phone telemetry means the manager
                is on dispatcher check-ins by phone; nothing is invented. */}
            <div className="text-[11px] text-muted" data-testid="position-source">
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
            className="rounded-md p-1.5 text-muted hover:bg-soft hover:text-ink"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* Cargo and Payload Capacity Meter */}
      <div className="rounded-lg border border-line bg-canvas/50 p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted">Active Cargo Load</span>
          <span className="font-bold text-ink">
            {loadTonnes ? `${loadTonnes} T` : 'Unavailable'} / {capacityTonnes ? `${capacityTonnes} T Capacity` : 'Capacity unavailable'}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-soft">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${loadPercentage ?? 0}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>Client: {detail?.shipment?.client_name ?? 'Unavailable'}</span>
          <span>Load Utilization: {loadPercentage !== null ? `${loadPercentage} of 100` : 'Unavailable'}</span>
        </div>
      </div>

      {/* Telemetry Grid */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg border border-line bg-canvas/30 p-2">
          <div className="text-[10px] uppercase text-muted">Speed</div>
          <div className="mt-1 text-sm font-extrabold text-ink">
            {speedKmph !== null ? `${speedKmph} km/h` : 'Unavailable'}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-canvas/30 p-2">
          <div className="text-[10px] uppercase text-muted">GPS Accuracy</div>
          <div className="mt-1 text-sm font-extrabold text-ink">
            {trip.position?.accuracy_m ? `±${Math.round(trip.position.accuracy_m)}m` : 'Unavailable'}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-canvas/30 p-2">
          <div className="text-[10px] uppercase text-muted">Trip Progress</div>
          <div className="mt-1 text-sm font-extrabold text-ink">
            {trip.stops_done}/{trip.stops_total} Stops
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 pt-1">
        {driver?.phone ? (
          <a
            href={`tel:${driver.phone}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-soft"
          >
            <span>📞</span> Call Driver
          </a>
        ) : null}
        {onFocusMap ? (
          <button
            type="button"
            onClick={onFocusMap}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-soft"
          >
            <span>🎯</span> Center on Map
          </button>
        ) : null}
        {onSelectRouteTab ? (
          <button
            type="button"
            onClick={onSelectRouteTab}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            <span>🛣️</span> Route options
          </button>
        ) : null}
      </div>
    </div>
  )
}
