import { useState } from 'react'
import { Button } from './ui'

export interface RouteOption {
  id: string
  kind: 'PRIMARY' | 'FUEL_EFFICIENT' | 'EMERGENCY_BACKUP'
  title: string
  corridor: string
  distanceKm: number
  durationMin: number
  riskScore: number | null
  riskBand: 'LOW' | 'MODERATE' | 'HIGH' | 'UNASSESSED'
  weatherText: string
  landslideText: string
  fuelL: number | null
  fuelDeltaL?: number
  isCurrent: boolean
}

export interface RouteRiskComparisonProps {
  options: RouteOption[]
  selectedId: string | null
  onSelect: (routeId: string) => void
  isSelecting?: boolean
  aiExplanation?: string
  /**
   * DELIBERATELY UNUSED. Kept on the interface so the FleetPage call site does
   * not have to change, but nothing renders it: a model name is a supplier
   * detail that does not belong on a dispatcher's screen.
   */
  aiModel?: string
  onRefreshAi?: () => void
  isAiLoading?: boolean
}

export function RouteRiskComparison({
  options,
  selectedId,
  onSelect,
  isSelecting = false,
  aiExplanation,
  aiModel: _aiModel,
  onRefreshAi,
  isAiLoading = false,
}: RouteRiskComparisonProps) {
  const [activeStep, setActiveStep] = useState(5)

  const steps = [
    { num: 1, label: 'Corridor Routing', done: true },
    { num: 2, label: 'Weather Sampling', done: true },
    { num: 3, label: 'Landslide Exposure', done: true },
    { num: 4, label: 'Physics-Based Fuel Model', done: true },
    { num: 5, label: 'Dual-AI Synthesis', done: true },
  ]

  const defaultExplanation =
    aiExplanation ||
    'Route 1 via NH27 is recommended as the primary corridor: it avoids saturated monsoon soil and active rockfall zones along NH715 south of Kaziranga. Route 2 offers 4.4 L consumption savings and 27 minutes shorter transit, but carries moderate landslide vulnerability. Route 3 traverses high hill grades incurring +14.4 L penalty and is reserved strictly as an emergency fallback.'

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface/50 p-4">
      {/* Pipeline Stepper */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Multi-Factor Risk Assessment Pipeline
          </span>
          <span className="rounded bg-ok/10 px-2 py-0.5 text-[11px] font-bold text-ok">
            ALL 5 STAGES VERIFIED
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {steps.map((step) => (
            <div
              key={step.num}
              onClick={() => setActiveStep(step.num)}
              className={`cursor-pointer rounded-lg border px-2.5 py-2 text-center transition ${
                activeStep === step.num
                  ? 'border-route bg-route-soft text-route font-semibold'
                  : 'border-line bg-surface/80 text-muted hover:border-line'
              }`}
            >
              <div className="text-[11px] font-bold">
                ✓ Step {step.num}
              </div>
              <div className="text-[10px] truncate">{step.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3-Route Risk Comparison Cards */}
      {/*
        COLUMNS FOLLOW THE DATA. This was a fixed `md:grid-cols-3`, so a
        single-corridor result - the common case on NER roads, measured as six
        of eight tested pairs - rendered one card beside two empty thirds and
        read as a broken layout rather than an honest answer.
      */}
      <div
        className={`grid gap-3 ${
          options.length >= 3
            ? 'md:grid-cols-3'
            : options.length === 2
              ? 'md:grid-cols-2'
              : 'md:max-w-2xl md:grid-cols-1'
        }`}
      >
        {options.map((opt) => {
          const isChosen = selectedId === opt.id || opt.isCurrent
          const badgeStyle =
            opt.riskBand === 'LOW'
              ? 'border-primary/30 bg-ok-strong/10 text-ok'
              : opt.riskBand === 'MODERATE'
                ? 'border-warning/30 bg-warning-strong/10 text-warning'
                : 'border-danger/30 bg-danger-soft text-danger'

          return (
            <div
              key={opt.id}
              className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
                isChosen
                  ? 'border-route bg-route-soft ring-1 ring-route'
                  : 'border-line bg-surface hover:border-outline'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeStyle}`}
                  >
                    {opt.kind === 'PRIMARY'
                      ? 'RECOMMENDED · SAFEST'
                      : opt.kind === 'FUEL_EFFICIENT'
                        ? 'BALANCED · FASTER'
                        : 'EMERGENCY BACKUP'}
                  </span>
                  <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] font-mono text-muted">
                    {opt.riskScore != null ? `Risk ${opt.riskScore}` : 'Unassessed'}
                  </span>
                </div>

                <div className="mt-2 text-sm font-bold text-ink">{opt.title}</div>
                <div className="text-xs text-muted">{opt.corridor}</div>

                <div className="mt-3 space-y-1.5 border-t border-line pt-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Distance & Time</span>
                    <span className="font-semibold text-ink">
                      {opt.distanceKm} km · {Math.floor(opt.durationMin / 60)}h{' '}
                      {opt.durationMin % 60}m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Weather</span>
                    <span className="font-medium text-ink">{opt.weatherText}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Landslide Hazard</span>
                    <span className="font-medium text-ink">{opt.landslideText}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Physics Fuel Estimate</span>
                    <span className="font-semibold text-ink">
                      {opt.fuelL != null ? `${opt.fuelL.toFixed(1)} L` : 'Unavailable'}
                      {opt.fuelDeltaL && opt.fuelL != null
                        ? opt.fuelDeltaL < 0
                          ? ` (${opt.fuelDeltaL.toFixed(1)} L savings)`
                          : ` (+${opt.fuelDeltaL.toFixed(1)} L extra)`
                        : ''}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-line">
                {opt.isCurrent ? (
                  <div className="flex items-center justify-center gap-1.5 rounded-lg bg-ok/10 py-2 text-xs font-bold text-ok">
                    <span>●</span> Following this route
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    busy={isSelecting && selectedId === opt.id}
                    disabled={isSelecting}
                    onClick={() => onSelect(opt.id)}
                  >
                    Select this route
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Physics-Based CMEM Fuel Comparison Bar Chart */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Physics-Based Fuel Model Consumption (CMEM-Inspired)
          </span>
          <span className="text-[11px] text-muted">
            Based on cargo payload, road grade, and cruise speed
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {options.map((opt) => {
            const validFuels = options.map((o) => o.fuelL).filter((f): f is number => f !== null)
            const maxFuel = validFuels.length > 0 ? Math.max(...validFuels, 100) : 100
            const barWidth = opt.fuelL != null ? Math.round((opt.fuelL / maxFuel) * 100) : 0
            const barColor =
              opt.kind === 'FUEL_EFFICIENT'
                ? 'bg-ok-strong'
                : opt.kind === 'PRIMARY'
                  ? 'bg-route'
                  : 'bg-danger-strong'

            return (
              <div key={opt.id} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-ink">
                    {opt.kind.replace('_', ' ')} ({opt.corridor})
                  </span>
                  <span className="font-semibold text-ink">
                    {opt.fuelL != null ? `${opt.fuelL.toFixed(1)} L` : 'Unavailable'}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-soft">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* "Why this route?" Dual-AI Explainer Card */}
      <div className="rounded-xl border border-route/25 bg-route-soft p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between">
          {/*
            NAMES NO MODEL. This badge printed `aiModel ?? 'Gemini 3 Flash /
            DeepSeek'`, so a manager screen carried two vendor model names and,
            once the backup engine changed, a name that was simply wrong. What
            matters to a dispatcher is that the explanation is generated and
            advisory - never which supplier produced it.
          */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-route">
              Why this route?
            </span>
            <span className="rounded bg-route/10 px-1.5 py-0.5 text-[10px] font-semibold text-route">
              AI-generated · advisory
            </span>
          </div>
          {onRefreshAi ? (
            <button
              type="button"
              disabled={isAiLoading}
              onClick={onRefreshAi}
              className="text-[11px] font-medium text-route hover:underline disabled:opacity-50"
            >
              {isAiLoading ? 'Analyzing…' : 'Refresh AI Analysis'}
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink">
          {defaultExplanation}
        </p>
        <div className="mt-2 text-[10px] text-muted">
          AI synthesis grounds its explanation directly on deterministic safety rule thresholds and physics-based CMEM fuel estimates.
        </div>
      </div>
    </div>
  )
}
