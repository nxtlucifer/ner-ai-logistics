/**
 * Backend and database health.
 *
 * Carried forward from the foundation phase. Every value is read live from
 * /health and /ready - there is no hardcoded status here.
 */

import { API_BASE_URL, api, type ProviderHealthRow } from '../api/client'
import { Card, ErrorState, LoadingState } from '../components/ui'
import { useResource } from '../hooks/useResource'

type RowState = 'ok' | 'bad' | 'unknown'

const DOT: Record<RowState, string> = {
  ok: 'bg-ok-strong',
  bad: 'bg-danger-strong',
  unknown: 'bg-muted',
}

const TEXT: Record<RowState, string> = {
  ok: 'text-ok',
  bad: 'text-danger',
  unknown: 'text-muted',
}

function Row({
  label,
  value,
  state,
  detail,
}: {
  label: string
  value: string
  state: RowState
  detail?: string | null
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{label}</div>
        {detail ? (
          <div className="mt-1 truncate font-mono text-xs text-muted">
            {detail}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[state]}`} />
        <span className={`text-sm font-semibold ${TEXT[state]}`}>{value}</span>
      </div>
    </div>
  )
}

const PROVIDER_LABEL: Record<string, string> = {
  supabase: 'Supabase',
  local: 'Local (WSL2)',
}

const FRESH_TONE: Record<ProviderHealthRow['freshness'], RowState> = {
  FRESH: 'ok', STATIC: 'ok', AGING: 'unknown', STALE: 'bad', EXPIRED: 'bad', UNKNOWN: 'unknown',
}

function ago(epoch: number | null): string {
  if (epoch === null) return 'never'
  const s = Math.max(0, Date.now() / 1000 - epoch)
  if (s < 90) return `${Math.round(s)} s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** One provider row: state + freshness in words, last success, last error CATEGORY. Never a key. */
function ProviderRow({ row }: { row: ProviderHealthRow }) {
  const state: RowState = row.state === 'HEALTHY' || row.state === 'STATIC' ? FRESH_TONE[row.freshness] : row.state === 'UNKNOWN' || row.state === 'NOT_CONFIGURED' ? 'unknown' : 'bad'
  const value = row.state === 'STATIC'
    ? `Static dataset${row.detail.vintage ? ` · ${String(row.detail.vintage)}` : ''}`
    : row.state === 'UNKNOWN'
      ? 'Not called yet'
      : `${row.state === 'HEALTHY' ? 'Healthy' : row.state === 'RATE_LIMITED' ? 'Rate limited' : row.state === 'NOT_CONFIGURED' ? 'Not configured' : 'Failed'} · ${row.freshness.toLowerCase()}`
  const detail = [
    row.product,
    row.evidence_type.replace(/_/g, ' ').toLowerCase(),
    row.last_success_at !== null ? `updated ${ago(row.last_success_at)}` : null,
    row.last_error ? `last error: ${row.last_error.replace(/_/g, ' ')} (${ago(row.last_error_at)})` : null,
  ].filter(Boolean).join(' · ')
  return <Row label={row.provider.replace(/_/g, ' ')} value={value} state={state} detail={detail} />
}

export default function SystemPage() {
  const ready = useResource(() => api.ready(), [])
  const providers = useResource(() => api.systemProviders(), [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">System</h1>
        <p className="text-xs text-muted">
          Live backend and database health. Nothing on this page is hardcoded.
        </p>
      </div>

      <Card>
        {ready.status === 'loading' ? (
          <LoadingState label="Checking backend…" />
        ) : ready.status === 'error' ? (
          <>
            <Row
              label="Backend"
              value="Offline"
              state="bad"
              detail={API_BASE_URL}
            />
            <div className="mt-4">
              <ErrorState error={ready.error} onRetry={ready.reload} />
            </div>
          </>
        ) : ready.data ? (
          <>
            <Row label="Backend" value="Online" state="ok" detail={API_BASE_URL} />
            <Row
              label="Database provider"
              value={PROVIDER_LABEL[ready.data.provider] ?? ready.data.provider}
              state="ok"
              detail={
                ready.data.provider === 'supabase'
                  ? 'Primary — Supabase PostgreSQL + PostGIS'
                  : 'Optional local fallback — WSL2 PostgreSQL'
              }
            />
            <Row
              label="Database"
              value={ready.data.checks.database.ok ? 'Ready' : 'Not Ready'}
              state={ready.data.checks.database.ok ? 'ok' : 'bad'}
              detail={ready.data.checks.database.detail}
            />
            <Row
              label="PostGIS extension"
              value={ready.data.checks.postgis.ok ? 'Ready' : 'Not Ready'}
              state={ready.data.checks.postgis.ok ? 'ok' : 'bad'}
              detail={ready.data.checks.postgis.detail}
            />
          </>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-sm font-bold text-ink">Data sources</h2>
        <p className="mb-2 text-xs text-muted">
          What each external source last did, judged against its own refresh cadence. A source that is
          down makes one evidence channel UNKNOWN — routing and navigation continue.
        </p>
        {providers.status === 'loading' ? (
          <LoadingState label="Reading provider health…" />
        ) : providers.status === 'error' ? (
          <ErrorState error={providers.error} onRetry={providers.reload} />
        ) : providers.data ? (
          providers.data.providers.map((row) => <ProviderRow key={row.provider} row={row} />)
        ) : null}
      </Card>

      {providers.data ? (
        <Card>
          <h2 className="text-sm font-bold text-ink">Intelligence components</h2>
          <p className="mb-2 text-xs text-muted">
            Counted from the code, not the pitch. No trained model runs here: every decision is a
            published rule, and the online models only word answers.
          </p>
          {[
            ['Local trained ML', providers.data.intelligence.counts.TRUE_LOCAL_ML],
            ['Local language models', providers.data.intelligence.counts.LOCAL_LLM],
            ['Deterministic engines', providers.data.intelligence.counts.DETERMINISTIC_INTELLIGENCE],
            ['Geometric algorithms', providers.data.intelligence.counts.GEOMETRIC_ALGORITHM],
            ['Statistical models', providers.data.intelligence.counts.STATISTICAL_MODEL],
            ['Offline knowledge systems', providers.data.intelligence.counts.OFFLINE_KNOWLEDGE_SYSTEM],
            ['Online AI providers', providers.data.intelligence.counts.ONLINE_LLM],
            ['Provider model outputs', providers.data.intelligence.counts.PROVIDER_MODEL_OUTPUT],
          ].map(([label, n]) => (
            <Row key={String(label)} label={String(label)} value={String(n)} state={n === 0 ? 'unknown' : 'ok'} />
          ))}
        </Card>
      ) : null}

      <p className="text-xs leading-relaxed text-muted">
        SIH26002 — RASTA AI. Route risk is a deterministic rule over eleven evidence
        factors (Open-Meteo/MET Norway weather, Copernicus DEM terrain, the NASA
        landslide inventory as historical exposure, GloFAS discharge as flood context,
        NDMA SACHET official warnings, fleet traffic). An input that is missing or
        stale is reported UNKNOWN and is never scored as safe. Rerouting proposes; a
        person authorises. No probability of any hazard is computed anywhere: no
        model has been validated on a held-out set, so none is claimed.
      </p>
    </div>
  )
}
