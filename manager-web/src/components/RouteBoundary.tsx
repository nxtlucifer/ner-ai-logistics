/**
 * A page that cannot load must not take the console down with it (LAZY-1).
 *
 * Every page but the two landing screens is a lazy chunk. A chunk that did not
 * arrive (the network dropped as the manager clicked Reports) used to reject
 * through <Suspense> to the root: React unmounted everything, #root went
 * empty, and nothing came back when the network did. The rail, the topbar and
 * the SOS badge now stay; only the page area says what happened.
 *
 * "Try again" on a chunk that did not arrive loads the page again, because a
 * browser keeps a failed module import for the life of the document: asking
 * for the same chunk again fails at once without touching the network
 * (measured in Chrome 153). Nothing is lost by it - the page the manager left
 * had already unmounted - and it is not done while the browser is offline,
 * where a reload would land on the browser's own error page. A page that
 * failed while rendering is simply rendered again.
 */

import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Button } from './ui'

const CHUNK = /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to fetch/i

function isChunkError(caught: unknown): boolean {
  return CHUNK.test(`${String(caught)} ${String((caught as { cause?: unknown } | null)?.cause)}`)
}

interface State {
  failed: boolean
  caught?: unknown
  /** Try again was pressed while the browser was still offline. */
  stillOffline?: boolean
}

/** Around the page area only. Keyed on the path by the shell, so opening
 *  another page always starts clean. `reload` is injectable for tests. */
export class RouteBoundary extends Component<{ children: ReactNode; reload?: () => void }, State> {
  state: State = { failed: false }
  static getDerivedStateFromError(caught: unknown): State {
    return { failed: true, caught }
  }
  retry = () => {
    if (!isChunkError(this.state.caught)) {
      this.setState({ failed: false, caught: undefined })
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState({ stillOffline: true })
      return
    }
    ;(this.props.reload ?? (() => window.location.reload()))()
  }
  render() {
    if (!this.state.failed) return this.props.children
    const chunk = isChunkError(this.state.caught)
    return (
      <div role="alert" className="flex flex-col items-center px-4 py-12 text-center">
        <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-danger-soft text-danger">
          <AlertTriangle className="size-5" strokeWidth={1.75} />
        </span>
        <p className="mt-3 text-base font-semibold text-ink">
          {chunk ? 'This screen could not be loaded' : 'This screen failed'}
        </p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted">
          {chunk
            ? 'Its code did not arrive, most likely because the connection dropped. The rest of the console still works.'
            : 'Something went wrong while showing it. The rest of the console still works.'}
        </p>
        {this.state.stillOffline ? (
          <p className="mt-2 text-sm font-semibold text-warning">Still offline. Try again once the connection is back.</p>
        ) : null}
        <div className="mt-4">
          <Button variant="secondary" onClick={this.retry}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
}
