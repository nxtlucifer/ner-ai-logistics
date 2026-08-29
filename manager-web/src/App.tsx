/**
 * Manager web - development build shell.
 *
 * This is deliberately NOT a dashboard. No truck, driver, trip or map exists yet
 * (see docs/DEVELOPMENT_ROADMAP.md). Everything rendered here is real state read
 * from the backend, because a mock dashboard at this stage would make it
 * impossible to tell working software from a picture of working software.
 */

import { StatusRow, type RowState } from './components/StatusRow'
import { API_BASE_URL } from './api/client'
import {
  useSystemStatus,
  type BackendStatus,
  type DatabaseStatus,
} from './hooks/useSystemStatus'

function backendLabel(s: BackendStatus): { text: string; state: RowState } {
  switch (s) {
    case 'online':
      return { text: 'Online', state: 'ok' }
    case 'offline':
      return { text: 'Offline', state: 'bad' }
    case 'checking':
      return { text: 'Checking…', state: 'pending' }
  }
}

function dbLabel(s: DatabaseStatus): { text: string; state: RowState } {
  switch (s) {
    case 'ready':
      return { text: 'Ready', state: 'ok' }
    case 'not_ready':
      return { text: 'Not Ready', state: 'bad' }
    case 'checking':
      return { text: 'Checking…', state: 'pending' }
    case 'unknown':
      // The backend is unreachable, so we have not observed the database at all.
      // Saying "Not Ready" would assert something we do not know.
      return { text: 'Unknown', state: 'unknown' }
  }
}

const PROVIDER_LABEL: Record<string, string> = {
  supabase: 'Supabase',
  local: 'Local (WSL2)',
}

export default function App() {
  const status = useSystemStatus()
  const backend = backendLabel(status.backend)
  const database = dbLabel(status.database)
  const postgis = dbLabel(status.postgis)

  // Reported by the backend, never assumed. When the backend is unreachable the
  // provider is genuinely unknown, so it renders as such rather than guessing.
  const providerValue = status.provider
    ? (PROVIDER_LABEL[status.provider] ?? status.provider)
    : status.backend === 'checking'
      ? 'Checking…'
      : 'Unknown'
  const providerState: RowState = status.provider
    ? 'ok'
    : status.backend === 'checking'
      ? 'pending'
      : 'unknown'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">
            NER Fleet Intelligence
          </h1>
          <p className="mt-2 inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Development Build
          </p>
          <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Foundation phase. No fleet features are implemented yet — every value
            below is read live from the backend.
          </p>
        </header>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white px-6 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <StatusRow
            label="Backend status"
            value={backend.text}
            state={backend.state}
            detail={API_BASE_URL}
          />
          <StatusRow
            label="Database provider"
            value={providerValue}
            state={providerState}
            detail={
              status.provider === 'supabase'
                ? 'Primary — Supabase PostgreSQL + PostGIS'
                : status.provider === 'local'
                  ? 'Optional local fallback — WSL2 PostgreSQL'
                  : null
            }
          />
          <StatusRow
            label="Database status"
            value={database.text}
            state={database.state}
            detail={status.databaseDetail}
          />
          <StatusRow
            label="PostGIS extension"
            value={postgis.text}
            state={postgis.state}
            detail={status.postgisDetail}
          />
        </section>

        {status.error ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            <span className="font-semibold">Connection error:</span>{' '}
            {status.error}
            <p className="mt-2 text-xs opacity-80">
              Start the backend with <code>python run.py</code> in{' '}
              <code>backend/</code>, and make sure the database keepalive is
              running (<code>scripts\db-start.ps1</code>).
            </p>
          </div>
        ) : null}

        <footer className="mt-6 flex items-center justify-between text-xs text-slate-500 dark:text-slate-500">
          <span>
            {status.lastCheckedAt
              ? `Last checked ${status.lastCheckedAt.toLocaleTimeString()}`
              : 'Not yet checked'}
          </span>
          <button
            type="button"
            onClick={status.refresh}
            disabled={status.isRefreshing}
            className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {status.isRefreshing ? 'Checking…' : 'Refresh'}
          </button>
        </footer>

        <p className="mt-10 text-xs leading-relaxed text-slate-400 dark:text-slate-600">
          SIH26002 — AI-Based Smart Logistics and Accessibility Intelligence
          Platform for the North Eastern Region. Auto-refreshes every 10 seconds.
        </p>
      </div>
    </div>
  )
}
