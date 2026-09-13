import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __DEV__: false,
  },
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    // Metro selects this platform suffix. Vite needs the same choice to
    // resolve screen imports even when a test substitutes the map renderer.
    alias: {
      '../map/DriverRouteMap': fileURLToPath(new URL('./src/map/DriverRouteMap.web.tsx', import.meta.url)),
      '@expo/vector-icons': fileURLToPath(new URL('./src/test/vectorIconsStub.tsx', import.meta.url)),
    },
  },
})
