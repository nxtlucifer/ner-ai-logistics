// Renders brand/mark.svg into every raster the two apps need. No PIL, no npm:
// headless Chrome via the rehearsal CDP helper. `node brand/render.mjs`
import { readFileSync } from 'node:fs'
import { launch, sleep } from '../.runtime/rehearsal/cdp.mjs'
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:')
const svg = readFileSync(`${ROOT}/brand/mark.svg`, 'utf8')
const page = (body, bg = 'transparent') => 'data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:${bg}">${body}</body></html>`)
const jobs = [
  // [file, size, body, background]
  ['driver-app/assets/icon.png', 1024, `<div style="width:512px;height:512px">${svg.replace('width="64" height="64"', 'width="512" height="512"')}</div>`, '#101820'],
  // Adaptive: the safe zone is the inner 66%, so the mark sits inside a navy field with padding.
  ['driver-app/assets/android-icon-foreground.png', 1024, `<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center">${svg.replace('width="64" height="64"', 'width="340" height="340"').replace('<rect width="64" height="64" rx="14" fill="#101820"/>', '')}</div>`, 'transparent'],
  ['driver-app/assets/android-icon-background.png', 1024, '', '#101820'],
  ['driver-app/assets/android-icon-monochrome.png', 1024, `<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center">${svg.replace('width="64" height="64"', 'width="340" height="340"').replace('<rect width="64" height="64" rx="14" fill="#101820"/>', '').replace(/#2563EB|#34D399/g, '#FFFFFF').replace('stroke="#101820"', 'stroke="none"')}</div>`, 'transparent'],
  ['driver-app/assets/splash-icon.png', 1024, `<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center">${svg.replace('width="64" height="64"', 'width="200" height="200"')}</div>`, 'transparent'],
  ['driver-app/assets/favicon.png', 64, svg.replace('width="64" height="64"', 'width="32" height="32"'), 'transparent'],
  ['driver-app/assets/brand-mark.png', 256, svg.replace('width="64" height="64"', 'width="128" height="128"'), 'transparent'],
]
for (const [file, size, body, bg] of jobs) {
  const B = await launch({ width: size / 2, height: size / 2, mobile: false, port: 9351 })  // DSF 2 -> size px
  try { await B.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }); await B.goto(page(body, bg)); await sleep(600); await B.shot(`${ROOT}/${file}`); console.log('wrote', file) } finally { await B.close() }
}
