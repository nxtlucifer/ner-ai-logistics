/** Manager layout gate: viewport sizes x browser zoom, checked for real overflow.
 *
 * Browser zoom is emulated the way it actually behaves: zooming to 150% on a
 * 1440 px window leaves the page 960 CSS px of layout width. So each cell sets
 * the viewport to width/zoom and asserts the DOCUMENT does not scroll
 * sideways. Shrinking the whole interface is not a fix, and this gate would not
 * notice one - it measures reflow, not apparent size.
 *
 * Elements that scroll sideways INSIDE their own box (wide tables, the map) are
 * legitimate and excluded; only overflow that escapes to the document fails.
 */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'docs/terrain-command/evidence')
fs.mkdirSync(out, { recursive: true })

const credentials = (name) => {
  const lines = fs.readFileSync(path.join(root, '.runtime', name), 'utf8').split(/\r?\n/).filter((s) => s.trim())
  return { id: lines[0].trim(), password: lines[1].trim() }
}

const SIZES = [
  { name: '1366x768', width: 1366, height: 768, zooms: [1, 1.25, 1.5, 2] },
  { name: '1440x900', width: 1440, height: 900, zooms: [1, 1.25, 1.5, 2] },
  { name: 'tablet-834', width: 834, height: 1112, zooms: [1] },
  { name: 'mobile-390', width: 390, height: 844, zooms: [1] },
]
const PAGES = [
  { name: 'fleet', url: 'http://localhost:5173/fleet', ready: 'Loading the fleet…' },
  { name: 'dispatch', url: 'http://localhost:5173/trips', ready: 'Loading drivers and trucks…' },
  { name: 'review', url: 'http://localhost:5173/review', ready: 'Loading trips…' },
]
const shotCells = new Set(['dispatch@1366x768@2', 'dispatch@1440x900@1', 'fleet@1440x900@1.5', 'fleet@mobile-390@1'])

/** Anything that pushes the DOCUMENT wider than the viewport. Own-scroller
 * descendants are skipped: their overflow is contained by design. */
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const contained = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const ov = getComputedStyle(n).overflowX
        if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') return true
      }
      return false
    }
    const offenders = []
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.right <= vw + 1) continue
      if (contained(el)) continue
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 70),
        right: Math.round(r.right),
        text: (el.textContent || '').trim().slice(0, 40),
      })
      if (offenders.length >= 5) break
    }
    return { viewport: vw, documentScrollWidth: doc.scrollWidth, offenders }
  })
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const report = { generated: new Date().toISOString(), scope: 'Local manager web, Chrome headless, layout-reflow emulation of browser zoom', cells: [] }
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const mc = credentials('manager-login.txt')
    await page.goto('http://localhost:5173')
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: 120000 })
    await page.getByLabel('Email or phone').fill(mc.id)
    await page.getByLabel('Password').fill(mc.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor()

    for (const size of SIZES) {
      for (const zoom of size.zooms) {
        const width = Math.round(size.width / zoom)
        const height = Math.round(size.height / zoom)
        await page.setViewportSize({ width, height })
        for (const target of PAGES) {
          await page.goto(target.url)
          await page.getByText(target.ready, { exact: true }).waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {})
          await page.waitForTimeout(1200)
          const measured = await overflow(page)
          const id = `${target.name}@${size.name}@${zoom}`
          const cell = {
            page: target.name,
            size: size.name,
            zoom: `${Math.round(zoom * 100)}%`,
            layoutWidth: width,
            documentScrollWidth: measured.documentScrollWidth,
            status: measured.offenders.length === 0 && measured.documentScrollWidth <= width + 1 ? 'PASS' : 'FAIL',
            offenders: measured.offenders,
          }
          report.cells.push(cell)
          console.log(cell.status, id, `doc=${measured.documentScrollWidth} <= ${width}`, cell.offenders.length ? JSON.stringify(cell.offenders) : '')
          if (shotCells.has(id)) {
            await page.evaluate((text) => {
              let el = document.getElementById('vp-label')
              if (!el) { el = document.createElement('div'); el.id = 'vp-label'; document.body.append(el) }
              el.textContent = text
              Object.assign(el.style, { position: 'fixed', left: 0, bottom: 0, zIndex: 99999, background: '#14282f', color: '#fff', padding: '3px 8px', font: '11px system-ui', pointerEvents: 'none' })
            }, `LOCAL DEMO · ${id} · layout ${width}px`)
            await page.screenshot({ path: path.join(out, `viewport-${id.replace(/[@.]/g, '-')}.png`), fullPage: false })
          }
        }
      }
    }
    report.status = report.cells.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL'
    console.log('MATRIX', report.status, `${report.cells.filter((c) => c.status === 'PASS').length}/${report.cells.length} cells`)
  } catch (error) {
    report.status = 'ERROR'
    report.failure = error.message
    console.error(error.message)
    process.exitCode = 1
  } finally {
    fs.writeFileSync(path.join(out, 'viewport-matrix.json'), JSON.stringify(report, null, 2))
    await browser.close()
  }
})()
