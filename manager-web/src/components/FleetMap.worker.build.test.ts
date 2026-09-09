/**
 * The MapLibre worker must survive a PRODUCTION build.
 *
 * This is a build-graph test, not a component test, because the failure it
 * guards is invisible to every component test and to `npm run dev`.
 *
 * MapLibre derives its worker URL at runtime from its own `import.meta.url`:
 *
 *     new URL('./maplibre-gl-worker.mjs', import.meta.url)
 *
 * No bundler can see a string built at runtime, so nothing is emitted. The
 * request then resolves to a path that does not exist, an SPA fallback answers
 * it with index.html, and the browser rejects it for a module worker. MapLibre
 * ends up with no worker, so every GeoJSON source stays unparsed - while raster
 * tiles and DOM markers keep working, leaving a map that looks healthy with the
 * planned route and observed GPS track silently missing.
 *
 * FleetMap fixes this by importing the worker through Vite's worker pipeline
 * and handing the emitted URL to `setWorkerUrl`. This test asserts the build
 * actually honours that, by reading the emitted asset graph rather than the
 * filesystem, so it needs no prior `npm run build`.
 *
 * Deliberately NOT asserted: the hashed filename. The contract is "a worker
 * chunk is emitted and the app references that same chunk", which survives a
 * content change; a pinned hash would fail on every unrelated edit.
 */

import { describe, expect, it } from 'vitest'
import { build, type Rollup } from 'vite'

const WORKER = /maplibre-gl-worker[^/]*\.js$/

describe('production build', () => {
  it('emits the MapLibre worker and references it from the app', async () => {
    // write:false keeps this off disk, so it cannot pass by finding a stale
    // dist/ from an earlier build.
    const result = (await build({
      logLevel: 'silent',
      build: { write: false },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[]

    const output = (Array.isArray(result) ? result : [result]).flatMap(
      (r) => r.output,
    )

    const worker = output.find((o) => WORKER.test(o.fileName))
    expect(
      worker,
      'no maplibre worker chunk was emitted - GeoJSON sources will never ' +
        'parse in production and the route and GPS track will not render',
    ).toBeDefined()

    // Emitted is not enough: the app has to point at the emitted file. If the
    // reference and the artefact drift apart the worker 404s exactly as before.
    const referenced = output.some(
      (o) =>
        o.type === 'chunk' &&
        !WORKER.test(o.fileName) &&
        o.code.includes(worker!.fileName),
    )
    expect(
      referenced,
      `worker ${worker!.fileName} was emitted but no application chunk ` +
        'references it',
    ).toBe(true)
  }, 120_000)
})
