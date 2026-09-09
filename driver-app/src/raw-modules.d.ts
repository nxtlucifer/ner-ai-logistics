/**
 * Vite's `?raw` import, used by `assistant.test.ts` to read a module's own
 * source and assert what it imports.
 *
 * Declared here rather than pulling in `@types/node` for `fs` and `__dirname`:
 * the assertion needs the file's TEXT, not a filesystem, and Metro never sees
 * this file because nothing in the app imports a `?raw` module.
 */
declare module '*?raw' {
  const content: string
  export default content
}

/**
 * Stylesheet side-effect imports.
 *
 * `maplibre-gl/dist/maplibre-gl.css` carries the styling for the map's own
 * controls and popups - without it the zoom buttons and the attribution render
 * unstyled. Metro handles the import; TypeScript needs to be told it exists.
 */
declare module '*.css'
