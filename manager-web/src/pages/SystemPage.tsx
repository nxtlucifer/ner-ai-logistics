/**
 * Diagnostics: what the console can do right now, and why.
 *
 * Two levels, on purpose. The top level is CAPABILITIES (routing, weather,
 * terrain, warnings, flood, landslide history, geocoding, AI assistant) with
 * five honest states - a throttled provider whose fallback answers is
 * "fallback active", not a broken system. Provider rows sit underneath,
 * expandable, for whoever needs the detail. Every value is read live from
 * /ready and /api/system/providers; the intelligence counts come from the
 * backend's own inventory, never from prose typed here.
 */

import { ChevronDown } from 'lucide-react'

import { API_BASE_URL, api, type ProviderHealthRow } from '../api/client'
import { LoadingState, Panel } from '../components/ui'
import { InlineError, PageHeader, Pill, type PillTone } from '../components/pageKit'
import { useResource } from '../hooks/useResource'

export type CapabilityState = 'HEALTHY' | 'DEGRADED' | 'FALLBACK_ACTIVE' | 'UNKNOWN' | 'UNAVAILABLE'

const STATE_LABEL: Record<CapabilityState, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  FALLBACK_ACTIVE: 'Available via fallback',
  UNKNOWN: 'Not called yet',
  UNAVAILABLE: 'Unavailable',
}

// Green = working, amber = working with a caveat, red = not working,
// neutral = not known yet. Never green for "not called yet".
const STATE_TONE: Record<CapabilityState, PillTone> = {
  HEALTHY: 'ok',
  DEGRADED: 'warning',
  FALLBACK_ACTIVE: 'warning',
  UNKNOWN: 'neutral',
  UNAVAILABLE: 'danger',
}

/** A capability is a primary provider plus optional fallbacks, in order. */
export const CAPABILITIES: { name: string; providers: string[]; note: string }[] = [
  { name: 'Routing', providers: ['OSRM'], note: 'roads, alternatives, turn steps' },
  { name: 'Weather', providers: ['OPEN_METEO', 'MET_NORWAY'], note: 'current + forecast along the road' },
  { name: 'Terrain', providers: ['OPEN_METEO_ELEVATION', 'OPENTOPODATA'], note: 'elevation profile, steep stretches' },
  { name: 'Official warnings', providers: ['NDMA_SACHET'], note: 'CAP alerts placed by district' },
  { name: 'Flood context', providers: ['GLOFAS'], note: 'river discharge vs 30-day mean' },
  { name: 'Landslide history', providers: ['NASA_GLC'], note: 'static inventory 2007–2017' },
  { name: 'Geocoding', providers: ['NOMINATIM'], note: 'address search, district lookup' },
  { name: 'AI assistant', providers: ['GOOGLE_GEMINI', 'OPENROUTER'], note: 'wording only — never a decision' },
]

function providerOk(row: ProviderHealthRow | undefined): boolean {
  return !!row && (row.state === 'HEALTHY' || row.state === 'STATIC') && row.freshness !== 'STALE' && row.freshness !== 'EXPIRED'
}

/**
 * Fold provider rows into one capability state.
 * primary ok -> HEALTHY · primary down but a fallback ok -> FALLBACK_ACTIVE ·
 * nothing called yet -> UNKNOWN · everything failing -> UNAVAILABLE ·
 * primary ok but aging/failing partner -> DEGRADED.
 */
export function capabilityState(rows: ProviderHealthRow[], providers: string[]): { state: CapabilityState; detail: string } {
  const found = providers.map((p) => rows.find((r) => r.provider === p))
  const known = found.filter((r): r is ProviderHealthRow => !!r)
  if (known.length === 0 || known.every((r) => r.state === 'UNKNOWN' || r.state === 'NOT_CONFIGURED')) {
    const configured = known.some((r) => r.state === 'UNKNOWN')
    return { state: configured ? 'UNKNOWN' : 'UNAVAILABLE', detail: known.map(word).join(' · ') || 'no provider registered' }
  }
  const [primary, ...fallbacks] = found
  if (providerOk(primary)) {
    const aging = primary!.freshness === 'AGING'
    return { state: aging ? 'DEGRADED' : 'HEALTHY', detail: known.map(word).join(' · ') }
  }
  if (fallbacks.some(providerOk)) return { state: 'FALLBACK_ACTIVE', detail: known.map(word).join(' · ') }
  if (known.some((r) => r.state === 'UNKNOWN')) return { state: 'UNKNOWN', detail: known.map(word).join(' · ') }
  return { state: 'UNAVAILABLE', detail: known.map(word).join(' · ') }
}

function word(row: ProviderHealthRow): string {
  const name = row.provider.replace(/_/g, ' ')
  if (row.state === 'STATIC') return `${name}: static dataset`
  if (row.state === 'UNKNOWN') return `${name}: not called yet`
  if (row.state === 'NOT_CONFIGURED') return `${name}: not configured`
  if (row.state === 'RATE_LIMITED') return `${name}: rate limited`
  if (row.state === 'FAILED') return `${name}: failing`
  return `${name}: healthy${row.freshness === 'AGING' ? ' (aging)' : row.freshness === 'STALE' || row.freshness === 'EXPIRED' ? ` (${row.freshness.toLowerCase()})` : ''}`
}

/** One line of a status list: the thing, what it is, and its state as a pill. */
function Row({ label, value, tone, detail }: { label: string; value: string; tone: PillTone; detail?: string | null }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-sm font-semibold text-ink">{label}</div>
        {detail ? <div className="mt-0.5 text-[13px] text-muted">{detail}</div> : null}
      </div>
      <Pill tone={tone}>{value}</Pill>
    </div>
  )
}

function ago(epoch: number | null): string {
  if (epoch === null) return 'never'
  const s = Math.max(0, Date.now() / 1000 - epoch)
  if (s < 90) return `${Math.round(s)} s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

const OK: PillTone = 'ok'
const BAD: PillTone = 'danger'
const DIM: PillTone = 'neutral'

/** One provider row: state + freshness in words, last success, last error CATEGORY. Never a key. */
function ProviderRow({ row }: { row: ProviderHealthRow }) {
  const tone: PillTone = row.state === 'HEALTHY' || row.state === 'STATIC'
    ? (row.freshness === 'STALE' || row.freshness === 'EXPIRED' ? BAD : row.freshness === 'AGING' ? 'warning' : OK)
    : row.state === 'RATE_LIMITED' ? 'warning' : row.state === 'UNKNOWN' || row.state === 'NOT_CONFIGURED' ? DIM : BAD
  const value = row.state === 'STATIC'
    ? `Static dataset${row.detail.vintage ? ` · ${String(row.detail.vintage)}` : ''}`
    : row.state === 'UNKNOWN'
      ? 'Not called yet'
      : `${row.state === 'HEALTHY' ? 'Healthy' : row.state === 'RATE_LIMITED' ? 'Rate limited' : row.state === 'NOT_CONFIGURED' ? 'Not configured' : 'Failed'} · ${row.freshness.toLowerCase()}`
  const detail = [
    row.product,
    row.last_success_at !== null ? `updated ${ago(row.last_success_at)}` : null,
    row.last_error ? `last error: ${row.last_error.replace(/_/g, ' ')} (${ago(row.last_error_at)})` : null,
  ].filter(Boolean).join(' · ')
  return <Row label={row.provider.replace(/_/g, ' ')} value={value} tone={tone} detail={detail} />
}

export default function SystemPage() {
  const ready = useResource(() => api.ready(), [])
  const providers = useResource(() => api.systemProviders(), [])
  const rows = providers.data?.providers ?? []
  const counts = providers.data?.intelligence.counts ?? {}
  const experimental = counts.TRUE_LOCAL_ML_EXPERIMENTAL ?? 0

  return (
    <div className="flex flex-col gap-[14px]">
      <PageHeader
        title="Diagnostics"
        meta="What the console can do right now. A throttled provider whose fallback answers is not an outage: the capability says so, and the provider rows underneath say why."
      />

      <div className="grid items-start gap-[13px] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel title="System" subtitle="The backend this console talks to, and its database">
          {ready.status === 'loading' ? (
            <LoadingState label="Checking backend…" />
          ) : ready.status === 'error' ? (
            <>
              <Row label="Backend" value="Offline" tone={BAD} detail={API_BASE_URL} />
              <InlineError compact error={ready.error} onRetry={ready.reload} />
            </>
          ) : ready.data ? (
            <>
              <Row label="Backend" value="Online" tone={OK} detail={API_BASE_URL} />
              <Row label="Database" value={ready.data.checks.database.ok ? 'Ready' : 'Not ready'} tone={ready.data.checks.database.ok ? OK : BAD} detail={`${ready.data.provider === 'supabase' ? 'Supabase PostgreSQL + PostGIS' : 'Local PostgreSQL'} · ${ready.data.checks.database.detail ?? ''}`} />
              <Row label="PostGIS" value={ready.data.checks.postgis.ok ? 'Ready' : 'Not ready'} tone={ready.data.checks.postgis.ok ? OK : BAD} detail={ready.data.checks.postgis.detail} />
            </>
          ) : null}
        </Panel>

        <Panel className="xl:row-span-2" title="Capabilities" subtitle="Each one's primary provider, then its fallbacks">
          {providers.status === 'loading' ? (
            <LoadingState label="Reading provider health…" />
          ) : providers.status === 'error' ? (
            <InlineError error={providers.error} onRetry={providers.reload} />
          ) : providers.data ? (
            CAPABILITIES.map((cap) => {
              const { state, detail } = capabilityState(rows, cap.providers)
              return <Row key={cap.name} label={cap.name} value={STATE_LABEL[state]} tone={STATE_TONE[state]} detail={`${cap.note} · ${detail}`} />
            })
          ) : null}
          <p className="mt-2 border-t border-line pt-3 text-[13px] text-muted">
            An input that is missing, throttled or stale is reported UNKNOWN on the route and is never scored as safe. Routing and navigation continue.
          </p>
        </Panel>

        {providers.data ? (
          <Panel title="Intelligence Inventory">
            <p className="mb-1 text-[13px] text-muted">
              Counted from the code by the backend, not typed here. Every route decision is a deterministic policy over the evidence; the online models only word answers.
            </p>
            {([
              ['Deterministic route policy', 'ACTIVE', OK],
              ['Production local ML', String(counts.TRUE_LOCAL_ML ?? 0), DIM],
              ['Experimental local ML', `${experimental}${experimental > 0 ? ' · not deployed' : ''}`, experimental > 0 ? 'warning' : DIM],
              ['Deterministic engines', String(counts.DETERMINISTIC_INTELLIGENCE ?? 0), OK],
              ['Geometric algorithms', String(counts.GEOMETRIC_ALGORITHM ?? 0), OK],
              ['Offline knowledge systems', String(counts.OFFLINE_KNOWLEDGE_SYSTEM ?? 0), OK],
              ['Online AI providers', String(counts.ONLINE_LLM ?? 0), OK],
              ['Provider model outputs', String(counts.PROVIDER_MODEL_OUTPUT ?? 0), OK],
            ] as [string, string, PillTone][]).map(([label, value, tone]) => (
              <Row key={label} label={label} value={value} tone={tone} />
            ))}
            {experimental > 0 ? (
              <p className="mt-2 border-t border-line pt-3 text-[13px] text-muted">
                The experimental landslide model is trained and validated on held-out data (research registry in the repository) but is kept outside routing by the safety-validation gate until its false-positive rate is acceptable. It controls nothing here.
              </p>
            ) : null}
          </Panel>
        ) : null}
      </div>

      {providers.data ? (
        <details className="group rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--radius-card)] px-4 py-3 text-base font-bold text-ink [&::-webkit-details-marker]:hidden">
            <span>Provider Details ({rows.length})</span>
            <ChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="px-4 pb-2">
            {rows.map((row) => <ProviderRow key={row.provider} row={row} />)}
          </div>
        </details>
      ) : null}

      {/* The hackathon brief's code is for demo and certification builds only. */}
      <p className="text-[13px] leading-relaxed text-muted">
        {import.meta.env.MODE === 'production' ? '' : 'SIH26002 — '}RASTA AI. Route risk is a deterministic rule over eleven evidence factors (weather, terrain, historical landslide exposure, flood context, official warnings, fleet traffic and more). Rerouting proposes; a person authorises. No probability of any hazard is shown on a route.
      </p>
    </div>
  )
}
