/**
 * Backend and database health.
 *
 * Carried forward from the foundation phase. Every value is read live from
 * /health and /ready - there is no hardcoded status here.
 */

import { API_BASE_URL, api } from '../api/client'
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

export default function SystemPage() {
  const ready = useResource(() => api.ready(), [])

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

      <p className="text-xs leading-relaxed text-muted">
        SIH26002 — AI-Based Smart Logistics and Accessibility Intelligence Platform
        for the North Eastern Region. Live GPS tracking, trip execution and route
        planning are implemented. A planned route is drawn as a dashed line
        beneath the solid observed GPS track, so the two are never confused.
        Route risk — scored from distance, duration and current weather along the
        corridor by a deterministic rule, not a model — is shown on Fleet, and a
        lower-risk alternative is proposed there with its cost in minutes and
        kilometres. A person accepts or rejects it: <strong>automatic</strong>{' '}
        rerouting is not built, and nothing here changes a route on its own.
        Landslide risk is not built — the historical inventory it needs is a bulk
        GIS download and the live sources surveyed publish no road-reopening feed,
        so the engine would have nothing honest to score. ETA, fuel AI and road
        incidents are not built. There is no arrival estimate anywhere: a
        provider's duration is not an ETA, and nothing on these screens computes
        one.
      </p>
    </div>
  )
}
