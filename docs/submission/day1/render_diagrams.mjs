// Render every ```mermaid block of the Day 1 document to a PNG (for DOCX/PDF)
// with headless Chrome + mermaid from cdnjs. Output: diagrams/diagram-N.png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { launch, sleep } from '../../../.runtime/rehearsal/cdp.mjs'

const DIR = 'D:/Projects/ner-ai-logistics/docs/submission/day1'
const md = readFileSync(`${DIR}/RASTA_AI_SIH2026_DAY1_TASK1_SYSTEM_DESIGN.md`, 'utf8')
const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1])
mkdirSync(`${DIR}/diagrams`, { recursive: true })
console.log('mermaid blocks:', blocks.length)

const P = await launch({ width: 1800, height: 1400, mobile: false, port: 9398 })
try {
  for (let i = 0; i < blocks.length; i += 1) {
    const html = `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>body{margin:0;background:#fff;font-family:Segoe UI,Arial,sans-serif} #d{display:inline-block;padding:16px}</style>
</head><body><div id="d"><pre class="mermaid">${blocks[i].replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></div>
<script>mermaid.initialize({ startOnLoad: true, theme: 'neutral', themeVariables: { fontSize: '26px', fontFamily: 'Segoe UI, Arial, sans-serif' }, flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis', nodeSpacing: 28, rankSpacing: 44, padding: 10, subGraphTitleMargin: { top: 18, bottom: 10 } } });</script>
</body></html>`
    const file = `${DIR}/diagrams/diagram-${i + 1}.html`
    writeFileSync(file, html)
    await P.goto('file:///' + file.replace(/\\/g, '/'))
    let rect = null
    for (let t = 0; t < 40 && !rect; t += 1) {
      await sleep(500)
      rect = await P.eval(`const s = document.querySelector('svg'); if (!s) return null; const r = document.getElementById('d').getBoundingClientRect(); return r.width > 50 && r.height > 50 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null`)
    }
    if (!rect) { console.log('diagram', i + 1, 'did not render'); continue }
    // Make the viewport as big as the drawing so the clip is not cut.
    await P.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(rect.w + 40), height: Math.ceil(rect.h + 40), deviceScaleFactor: 2, mobile: false })
    await sleep(500)
    const r2 = await P.eval(`const r = document.getElementById('d').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }`)
    const shot = await P.send('Page.captureScreenshot', { format: 'png', clip: { x: r2.x, y: r2.y, width: r2.w, height: r2.h, scale: 2 } })
    writeFileSync(`${DIR}/diagrams/diagram-${i + 1}.png`, Buffer.from(shot.data, 'base64'))
    console.log('diagram', i + 1, Math.round(r2.w), 'x', Math.round(r2.h))
  }
} finally { await P.close() }
