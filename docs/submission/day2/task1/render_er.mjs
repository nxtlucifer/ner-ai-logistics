// Render the ```mermaid block of docs/DAY2_TASK1_ER_DIAGRAM.md to er-diagram.png
// (headless Chrome + mermaid from jsdelivr). Same approach as day1/render_diagrams.mjs.
import { readFileSync, writeFileSync } from 'node:fs'
import { launch, sleep } from '../../../../.runtime/rehearsal/cdp.mjs'

const ROOT = 'D:/Projects/ner-ai-logistics'
const OUT = `${ROOT}/docs/submission/day2/task1`
const md = readFileSync(`${ROOT}/docs/DAY2_TASK1_ER_DIAGRAM.md`, 'utf8')
const block = md.match(/```mermaid\r?\n([\s\S]*?)```/)[1]

const P = await launch({ width: 2400, height: 1800, mobile: false, port: 9398 })
try {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>body{margin:0;background:#fff;font-family:Segoe UI,Arial,sans-serif} #d{display:inline-block;padding:20px}</style>
</head><body><div id="d"><pre class="mermaid">${block.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div>
<script>mermaid.initialize({ startOnLoad: true, theme: 'neutral', themeVariables: { fontSize: '18px', fontFamily: 'Segoe UI, Arial, sans-serif' }, er: { useMaxWidth: false, layoutDirection: 'TB', minEntityWidth: 200, entityPadding: 14 } });</script>
</body></html>`
  const file = `${OUT}/er-diagram.html`
  writeFileSync(file, html)
  await P.goto('file:///' + file)
  let rect = null
  for (let t = 0; t < 60 && !rect; t += 1) {
    await sleep(500)
    rect = await P.eval(`const s = document.querySelector('svg'); if (!s) return null; const r = document.getElementById('d').getBoundingClientRect(); return r.width > 50 && r.height > 50 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null`)
  }
  if (!rect) throw new Error('diagram did not render')
  await P.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(rect.w + 40), height: Math.ceil(rect.h + 40), deviceScaleFactor: 2, mobile: false })
  await sleep(600)
  // The SVG's own box, not the container's: mermaid's ER layout can overflow the
  // inline-block, and a clip on the container cut the last two entities off.
  // Re-fit the SVG to what it actually drew: mermaid sizes the viewBox before a
  // wrapped attribute row can push the last entities past it.
  await P.eval(`const s = document.querySelector('svg'); const b = s.getBBox(); const w = Math.ceil(b.x + b.width + 20), h = Math.ceil(b.y + b.height + 20); s.setAttribute('viewBox', '0 0 ' + w + ' ' + h); s.setAttribute('width', w); s.setAttribute('height', h); s.style.maxWidth = 'none'; return [w, h]`)
  await sleep(300)
  const r2 = await P.eval(`const s = document.querySelector('svg'); const b = s.getBBox(); const r = s.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.max(r.width, b.width + b.x + 40), h: Math.max(r.height, b.height + b.y + 40) }`)
  await P.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(r2.x + r2.w + 40), height: Math.ceil(r2.y + r2.h + 40), deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const shot = await P.send('Page.captureScreenshot', { format: 'png', clip: { x: r2.x, y: r2.y, width: r2.w, height: r2.h, scale: 1.5 }, captureBeyondViewport: true })
  writeFileSync(`${OUT}/er-diagram.png`, Buffer.from(shot.data, 'base64'))
  const svg = await P.eval(`return document.querySelector('svg').outerHTML`)
  writeFileSync(`${OUT}/er-diagram.svg`, svg)
  console.log('er-diagram', Math.round(r2.w), 'x', Math.round(r2.h))
} finally { await P.close() }
