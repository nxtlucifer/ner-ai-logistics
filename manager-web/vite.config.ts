import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
  },
  // @ts-expect-error vitest's own options: it types them against the vite it
  // bundles (7), which does not augment this project's vite 8.
  test: {
    // A third of the logical CPUs, not vitest's all-but-one. Each worker is a
    // jsdom rendering whole pages; 23 of them on this 24-thread, 16 GB box ran
    // the suite in 58-80 s with 0.2 s tests stretched to 3-5 s (and past the
    // 5 s timeout). 8 workers: 30 s, none over 2.5 s.
    maxWorkers: '33%',
  },
})
