export interface FleetKpiBarProps {
  totalTrips: number
  activeDrivers: number
  fleetUtilizationRatio: number
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
 * The operational headline, in one compact strip.
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
  fleetUtilizationRatio,
  needsAttention,
}: FleetKpiBarProps) {
  const utilScore = clampPercent(fleetUtilizationRatio)

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <Kpi label="Active trips" value={totalTrips} caption="dispatched" />
      <Kpi
        label="Active drivers"
        value={activeDrivers}
        caption={activeDrivers > 0 ? 'transmitting GPS' : 'none transmitting'}
        tone={activeDrivers > 0 ? 'ok' : 'muted'}
      />
      <Kpi label="Utilisation" value={utilScore} suffix="%" caption="of active fleet" />
      <Kpi
        label="Attention"
        value={needsAttention}
        caption={needsAttention > 0 ? 'stale or no contact' : 'all trucks reporting'}
        tone={needsAttention > 0 ? 'warning' : 'ok'}
      />
    </div>
  )
}

type Tone = 'ink' | 'ok' | 'warning' | 'danger' | 'muted'

const TONE_CLASS: Record<Tone, string> = {
  ink: 'text-ink',
  ok: 'text-ok',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted',
}

function Kpi({
  label,
  value,
  suffix,
  caption,
  tone = 'ink',
}: {
  label: string
  value: number
  suffix?: string
  caption: string
  tone?: Tone
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        {/* tnum: these numbers refresh on a poll. Proportional digits make the
            whole strip twitch sideways on every update. */}
        <span className={`tnum font-display text-[26px] font-bold leading-none ${TONE_CLASS[tone]}`}>
          {value}
          {suffix ? <span className="text-[17px] font-semibold">{suffix}</span> : null}
        </span>
        <span className="truncate text-[11.5px] text-muted">{caption}</span>
      </div>
    </div>
  )
}

function clampPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  return Math.min(100, Math.max(0, Math.round(ratio * 100)))
}
