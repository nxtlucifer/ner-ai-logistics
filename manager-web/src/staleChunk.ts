/**
 * A tab left open across a redeploy asks for lazy chunks by their OLD hashes.
 * Those files are gone, and the host's SPA rewrite (render.yaml: /* to
 * /index.html) answers with HTML, which the browser refuses as a module - so
 * the map never opens. Vite reports that as `vite:preloadError`; one reload
 * fetches the new index.html and with it the new hashes.
 *
 * At most once a minute: a chunk that is broken in the NEW build must show
 * its error, not reload the tab forever.
 *
 * Never while offline: the same event fires for a chunk the network could not
 * fetch, and a reload then lands on the browser's offline page and throws away
 * the planner the manager was filling in. The caller shows the error instead.
 *
 * Never for a load nobody asked for: a prefetch on hover or keyboard focus
 * goes through the same helper, and tabbing past a button must not reload the
 * page. Such loads run inside `quietly`, and a load somebody did ask for runs
 * inside `asked`, which wins while it is out.
 */

import { getConnectivity } from './api/connectivity'

const KEY = 'ner:chunk-reload-at'
const ONCE_PER_MS = 60_000

let quiet = 0
let loud = 0

/** Runs a background load whose failure must never reload the tab. The helper
 *  raises the event before the promise rejects, so the load is still counted. */
export function quietly<T>(load: () => Promise<T>): Promise<T> {
  quiet += 1
  return load().finally(() => {
    quiet -= 1
  })
}

/** Runs a load somebody asked for (a click, a page that shows a map). It
 *  overrides `quietly`: a click often shares the in-flight fetch of the
 *  prefetch its own hover or focus started, both fail in one task, and the
 *  click must still rescue a stale tab. */
export function asked<T>(load: () => Promise<T>): Promise<T> {
  loud += 1
  return load().finally(() => {
    loud -= 1
  })
}

type Host = Pick<Window, 'addEventListener' | 'sessionStorage' | 'location' | 'navigator'>

export function reloadOnStaleChunk(win: Host = window): void {
  win.addEventListener('vite:preloadError', () => {
    if ((quiet > 0 && loud === 0) || win.navigator?.onLine === false || !getConnectivity().online) return
    try {
      if (Date.now() - Number(win.sessionStorage.getItem(KEY) ?? 0) < ONCE_PER_MS) return
      win.sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      // No storage, no way to keep it to once: let the error show instead.
      return
    }
    win.location.reload()
  })
}
