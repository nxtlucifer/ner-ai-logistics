/** Local visual evidence. Uses the real API and existing synthetic credentials.
 * No credentials, tokens or request bodies are written to evidence.
 * Browser screenshots are explicitly labelled local demo; no trip mutations.
 */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const stage = process.argv[2] || 'before'
const out = path.join(root, 'docs/terrain-command/evidence')
fs.mkdirSync(out, { recursive: true })
const issues = []
function credentials(name) {
  const lines = fs.readFileSync(path.join(root, '.runtime', name), 'utf8').split(/\r?\n/).filter(s => s.trim())
  return { id: lines[0].trim(), password: lines[1].trim() }
}
async function label(page) {
  await page.evaluate(() => {
    if (document.getElementById('terrain-evidence-label')) return
    const el = document.createElement('div')
    el.id = 'terrain-evidence-label'
    el.textContent = 'LOCAL DEMO · synthetic accounts · browser capture'
    Object.assign(el.style, {position:'fixed',bottom:'0',left:'0',zIndex:'99999',background:'#14282f',color:'#fff',padding:'3px 8px',font:'11px system-ui',pointerEvents:'none'})
    document.body.append(el)
  })
}
async function shot(page, name) {
  await label(page)
  await page.screenshot({ path: path.join(out, `${stage}-${name}.png`) })
  console.log('CAPTURE', name, await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth,height:innerHeight})))
}
function observe(page, app) {
  page.on('pageerror', e => issues.push({app,kind:'pageerror',message:e.message}))
  page.on('response', r => { if (r.status() >= 400) issues.push({app,kind:'http',status:r.status(),path:new URL(r.url()).pathname}) })
}
;(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true})
 try {
  const manager = await browser.newPage({viewport:{width:1440,height:900}})
  observe(manager,'manager')
  await manager.goto('http://localhost:5173', {waitUntil:'networkidle'})
  await shot(manager,'manager-login')
  const mc=credentials('manager-login.txt')
  await manager.getByLabel('Email or phone').fill(mc.id)
  await manager.getByLabel('Password').fill(mc.password)
  await manager.getByRole('button',{name:'Sign in',exact:true}).click()
  await manager.getByRole('heading',{name:'Fleet',exact:true}).waitFor()
  await manager.getByText('Loading the fleet…').waitFor({state:'hidden'})
  await manager.locator('.maplibregl-canvas').waitFor()
  await manager.waitForTimeout(1500)
  await shot(manager,'manager-fleet')
  const rows=manager.getByRole('button').filter({hasText:/TRP-/})
  if(await rows.count()) {
    await rows.first().click()
    await manager.getByText('Loading trip details…').waitFor({state:'hidden'})
    await shot(manager,'manager-detail')
  }
  await manager.getByRole('link',{name:'Trips',exact:true}).click()
  await manager.getByText('Loading drivers and trucks…').waitFor({state:'hidden'})
  await manager.waitForTimeout(700)
  await shot(manager,'manager-dispatch')
  fs.writeFileSync(path.join(root,`.runtime/terrain-command/${stage}-manager-text.txt`),await manager.locator('body').innerText())
  const driver = await browser.newPage({viewport:{width:390,height:844}})
  observe(driver,'driver')
  await driver.goto('http://localhost:8081', {waitUntil:'domcontentloaded',timeout:180000})
  await driver.getByRole('button',{name:'Sign in',exact:true}).waitFor({timeout:180000})
  await shot(driver,'driver-login')
  const dc=credentials('demo-account-login.txt')
  await driver.locator('input').nth(0).fill(dc.id)
  await driver.locator('input').nth(1).fill(dc.password)
  await driver.getByRole('button',{name:'Sign in',exact:true}).click()
  await driver.getByRole('button',{name:'Sign out',exact:true}).waitFor()
  await driver.getByText('Loading your trip…',{exact:true}).waitFor({state:'hidden'})
  await shot(driver,'driver-home')
  fs.writeFileSync(path.join(root,`.runtime/terrain-command/${stage}-driver-text.txt`),await driver.locator('body').innerText())
  const resume=driver.getByRole('button',{name:/Resume navigation|Open map/})
  if (await resume.count()) {
   await resume.first().click()
   await driver.getByTestId('driver-route-map').waitFor()
   await driver.locator('.leaflet-tile-loaded').first().waitFor()
   await driver.waitForTimeout(1200)
   await shot(driver,'driver-map')
   await driver.getByRole('button',{name:'Back to trip'}).click()
  }
  for(const [name,selector] of [['assistant','Assistant'],['safety','Safety'],['translator','Talk']]) {
   const tab=driver.getByRole('tab',{name:selector,exact:true})
   if(await tab.count()) {
    await tab.click()
    // The model probe is a real request with a 15s ceiling. Screenshotting before
    // it settles captures a loading state, not the screen's actual honest answer.
    await driver.getByText('Checking for the local model…', {exact:true}).waitFor({state:'hidden',timeout:30000}).catch(()=>{})
    await shot(driver,`driver-${name}`)
   }
  }
  console.log('BROWSER_ERRORS',JSON.stringify(issues))
 } finally { await browser.close(); fs.writeFileSync(path.join(out,`${stage}-browser-issues.json`),JSON.stringify(issues,null,2)) }
})().catch(e=>{console.error(e.message);process.exitCode=1})
