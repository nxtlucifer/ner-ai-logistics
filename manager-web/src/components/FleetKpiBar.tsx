import { AlertTriangle, Gauge, Radio, Route } from 'lucide-react'

import { KpiCard } from './KpiCard'

export interface FleetKpiBarProps {
  totalTrips: number
  activeDrivers: number
  /**
   * Trucks on a job as a percentage of the fleet, or **null** when the
   * caller has no denominator.
   *
   * This replaced `fleetUtilizationRatio`, which divided the snapshot's
   * active trips by the snapshot's own length. `/api/fleet/active` returns
   * only active trips, so that ratio was 1 whenever anything moved and 0
   * otherwise — a card that could not report anything else.
   */
  fleetUtilizationPercent: number | null
  /** The denominator, for the caption. Null for a scoped manager. */
  fleetSize: number | null
  /**
   * Trucks whose position is stale or absent. Derived from the same freshness
   * counts the map and the list use, so it cannot disagree with what is on
   * screen.
   *
   * This slot used to be an on-time rate that FleetPage hardcoded to `0.978`.
   * A fabricated 97.8% presented as a live operational metric is exactly the
   * thing the rest of this codebase refuses to do with weather and GPS, and it
   * had a permanent "SLA HIGH" badge next to it. There is no on-time source
   * yet, so the slot now carries something real.
   */
  needsAttention: number
}

/**
 * The operational headline: four of the dashboard's KPI cards (manager_03),
 * the same component the Overview uses, each labelled by its definition so
 * "Active drivers" here and "Drivers online" there cannot be read as one
 * figure (audit 4 #7).
 *
 * COMPACT IS THE REQUIREMENT, not a preference. This is a map-first console;
 * every row of chrome above the map is a row of terrain a dispatcher cannot
 * see. The previous version spent four lines per card - a badge, a number, a
 * unit and a caption - and pushed the GIS canvas down by about 40px for
 * information that fits on two.
 *
 * IT ALSO CLAIMED THINGS IT DID NOT KNOW. Each card carried a hardcoded status
 * pill: "SLA HIGH", "ONLINE", "LIVE OPS", "CAPACITY". None was computed. "SLA
 * HIGH" rendered over an on-time rate of 12%, and "ONLINE" rendered next to
 * zero active drivers. A badge that always says the same thing is decoration
 * wearing the costume of a status indicator, which is worse than no badge -
 * so they are gone. The number is the status.
 *
 * The only qualitative signals left - the driver and attention tones - are
 * derived from the values they sit next to.
 */
export function FleetKpiBar({
  totalTrips,
  activeDrivers,
  fleetUtilizationPercent,
  fleetSize,
  needsAttention,
}: FleetKpiBarProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Active trips" icon={Route} value={totalTrips} hint="Active or delayed" footnote="dispatched, on the live feed" />
      <KpiCard
        label="Active drivers"
        icon={Radio}
        value={activeDrivers}
        hint="Live or stale position"
        footnote={activeDrivers > 0 ? 'transmitting GPS' : 'none transmitting'}
      />
      {/* An em dash, not a zero. "0% utilisation" is a measurement; this
          is the absence of one, and a district manager has no fleet-wide
          denominator to measure against. */}
      <KpiCard
        label="Utilisation"
        icon={Gauge}
        value={fleetUtilizationPercent === null ? '—' : fleetUtilizationPercent}
        suffix={fleetUtilizationPercent === null ? undefined : '%'}
        hint="Trucks on a trip"
        footnote={
          fleetUtilizationPercent === null
            ? 'needs a fleet-wide view'
            : fleetSize === null
              ? 'of the fleet'
              : `${totalTrips} of ${fleetSize} trucks`
        }
      />
      <KpiCard
        label="Attention"
        icon={AlertTriangle}
        tone="warning"
        value={needsAttention}
        hint="Stale, no contact or unplaced"
        footnote={needsAttention > 0 ? 'stale or no contact' : 'all trucks reporting'}
      />
    </div>
  )
}
