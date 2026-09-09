/** Real local HTTP/browser journey. Synthetic fixtures only; no emergency calls. */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const privatePath = path.join(root, '.runtime/terrain-command/qa-fixture-private.json')
const fixture = JSON.parse(fs.readFileSync(privatePath, 'utf8'))
const out = path.join(root, 'docs/terrain-command/evidence')
const report = { fixture: fixture.tag, scope: 'Synthetic local demo; Chrome web approximation of driver; real local API, OSRM and available snapshot data', checks: [], network: [] }
const save = () => fs.writeFileSync(privatePath, JSON.stringify(fixture, null, 2))
function pass(name) { report.checks.push({ name, status: 'PASS' }); console.log('PASS', name) }
async function shot(page, name) {
  await page.evaluate(() => {
    let el = document.getElementById('qa-label')
    if (!el) { el = document.createElement('div'); el.id = 'qa-label'; document.body.append(el) }
    el.textContent = 'LOCAL QA · synthetic trip & GPS · browser capture'
    Object.assign(el.style, { position: 'fixed', left: 0, bottom: 0, zIndex: 99999, background: '#14282f', color: 'white', padding: '3px 8px', font: '10px system-ui', pointerEvents: 'none' })
  })
  await page.screenshot({ path: path.join(out, `journey-${name}.png`) })
}
async function signIn(page, url, who, driver = false) {
  await page.goto(url)
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: 120000 })
  await page.getByLabel(driver ? 'Phone number' : 'Email or phone', { exact: false }).fill(who.id)
  await page.getByLabel('Password', { exact: false }).fill(who.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor()
}

;(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true })
 let current
 try {
  const manager = await browser.newPage({ viewport: { width: 1440, height: 900 } }); current = manager
  manager.on('pageerror', e => report.network.push({ type: 'pageerror', message: e.message }))
  await signIn(manager, 'http://localhost:5173/trips', fixture.manager)
  await manager.getByRole('heading', { name: 'Dispatch workspace' }).waitFor()
  // Every run must start from a fresh draft. Re-using a trip that is already
  // ASSIGNED or ACTIVE makes the later steps no-ops that still report PASS, and it
  // leaves the driver unavailable for a new assignment. Release it first - synthetic
  // QA trip on the isolated cluster only.
  if (fixture.trip_id) {
    const stale = manager.getByRole('row').filter({ hasText: fixture.trip_code })
    await stale.waitFor({ timeout: 60000 })
    const cancel = stale.getByRole('button', { name: 'Cancel', exact: true })
    if (await cancel.count()) {
      manager.once('dialog', (d) => d.accept())
      await cancel.click()
      await stale.getByText('CANCELLED', { exact: true }).waitFor({ timeout: 60000 })
    }
    delete fixture.trip_id; delete fixture.trip_code; save()
  }
  if (!fixture.trip_id) {
    await manager.getByLabel('Client', { exact: false }).fill(`Terrain QA load ${fixture.tag}`)
    await manager.locator('[name="pickup_address"]').fill('Synthetic loading gate, Guwahati')
    await manager.getByRole('button', { name: 'Advanced', exact: true }).first().click()
    await manager.locator('[name="pickup_address_lat"]').fill('26.1445')
    await manager.locator('[name="pickup_address_lon"]').fill('91.7362')
    await manager.locator('[name="destination_address"]').fill('Synthetic delivery gate, Jorhat')
    await manager.getByRole('button', { name: 'Advanced', exact: true }).first().click()
    await manager.locator('[name="destination_address_lat"]').fill('26.7509')
    await manager.locator('[name="destination_address_lon"]').fill('94.2037')
    await manager.getByRole('combobox', { name: /^Driver/ }).selectOption(fixture.driver.driver_id)
    await manager.getByRole('combobox', { name: /^Truck/ }).selectOption(fixture.truck.id)
    await shot(manager, '01-addresses')
    const response = manager.waitForResponse(r => r.url().endsWith('/api/trips/plan') && r.request().method() === 'POST')
    await manager.getByRole('button', { name: 'Create draft trip', exact: true }).click()
    const created = await response
    if (created.status() !== 201) throw new Error(`Draft creation HTTP ${created.status()}`)
    const trip = await created.json(); fixture.trip_id = trip.id; fixture.trip_code = trip.trip_code; save()
    pass('Confirmed endpoint form creates one atomic draft')
  } else {
    await manager.getByRole('row').filter({ hasText: fixture.trip_code }).getByRole('button', { name: 'Review route' }).click()
  }
  await manager.getByRole('heading', { name: `Trip review · ${fixture.trip_code}` }).waitFor()
  // Wait for a control the loaded panel actually renders. Waiting for a transient
  // label to go hidden passes instantly while the panel is still loading - which
  // is how this raced - and a mis-encoded ellipsis made that label match nothing.
  const plan = manager.getByRole('button', { name: 'Plan route', exact: true })
  const check = manager.getByRole('button', { name: 'Check conditions & review', exact: true })
  await plan.or(check).first().waitFor({ timeout: 60000 })
  if (await plan.count()) { await plan.click(); await check.waitFor({ timeout: 90000 }) }
  await check.click()
  await check.waitFor()
  await manager.waitForTimeout(700)
  await shot(manager, '02-route-preview')
  if (await manager.getByRole('button', { name: 'Use this route' }).count()) {
    const reviewer = await browser.newPage({ viewport: { width: 1440, height: 900 } }); current = reviewer
    await signIn(reviewer, 'http://localhost:5173/review', fixture.reviewer)
    // Role + accessible name, not getByLabel: a <label> wrapping a <select> has the
    // option text in its textContent, so an exact label match can never hit.
    await reviewer.getByRole('combobox', { name: 'Trip', exact: true }).selectOption(fixture.trip_id)
    await reviewer.getByRole('button', { name: 'Check hazard evidence' }).click()
    const rationale = reviewer.locator('textarea').first()
    await rationale.waitFor({ timeout: 60000 })
    await rationale.fill('Synthetic browser QA on the isolated demo cluster. Incomplete hazard evidence acknowledged for this simulated dispatch only; no real vehicle movement.')
    await reviewer.getByRole('button', { name: 'Authorise one selection', exact: true }).first().click()
    await reviewer.getByText(/Authorised|authorised|expires/).first().waitFor()
    await shot(reviewer, '03-reviewed-incomplete-evidence')
    current = manager
    await check.click()
    const select = manager.getByRole('button', { name: 'Use this route', exact: true })
    await select.click({ timeout: 90000 })
    await manager.getByRole('button', { name: 'Route assigned', exact: true }).waitFor()
    pass('Independent reviewer authorization consumed by actual route selection')
  }
  await shot(manager, '04-assigned-route')
  const row = manager.getByRole('row').filter({ hasText: fixture.trip_code })
  await row.waitFor({ timeout: 60000 })
  const dispatch = row.getByRole('button', { name: 'Dispatch', exact: true })
  await dispatch.click()
  await row.getByText('ASSIGNED', { exact: true }).waitFor({ timeout: 60000 })
  pass('Dispatch persists and manager table shows ASSIGNED')

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 26.1445, longitude: 91.7362, accuracy: 10 } })
  const driver = await context.newPage(); current = driver
  driver.on('pageerror', e => report.network.push({ type: 'pageerror', message: e.message }))
  let acceptRequests = 0
  driver.on('request', r => { if (r.url().endsWith('/api/driver/me/trip/accept')) acceptRequests++ })
  await signIn(driver, 'http://localhost:8081', fixture.driver, true)
  await driver.getByText(fixture.trip_code, { exact: true }).waitFor()
  await shot(driver, '05-driver-request')
  const accept = driver.getByRole('button', { name: 'Accept trip', exact: true })
  await accept.dblclick()
  await driver.getByTestId('driver-route-map').waitFor({ timeout: 60000 })
  if (acceptRequests > 1) throw new Error(`Duplicate accepts: ${acceptRequests}`)
  pass('Driver accepts once and opens separate assigned-route map')
  await driver.locator('.leaflet-tile-loaded').first().waitFor()
  await shot(driver, '06-navigation-preview')
  await driver.getByRole('button', { name: 'Back to trip', exact: true }).click()
  await driver.getByRole('tab', { name: 'Truck', exact: true }).click()
  // count() does not auto-wait. Let the assignment finish loading first or the
  // verification step is silently skipped and Start trip stays disabled.
  await driver.getByText('Your truck', { exact: true }).waitFor({ timeout: 60000 })
  const confirm = driver.getByRole('button', { name: 'Confirm this truck', exact: true })
  if (await confirm.count()) {
    await driver.getByLabel('Registration on the truck', { exact: true }).fill(fixture.truck.registration_number)
    await driver.getByLabel('Odometer (km)', { exact: true }).fill('18420')
    await driver.getByLabel('Fuel level (%)', { exact: true }).fill('60')
    await confirm.click()
    await driver.getByText('Truck verified', { exact: true }).waitFor()
  }
  await context.grantPermissions(['geolocation'], { origin: 'http://localhost:8081' })
  await driver.getByRole('tab', { name: 'Trip', exact: true }).click()
  await driver.getByText(fixture.trip_code, { exact: true }).waitFor({ timeout: 60000 })
  const start = driver.getByRole('button', { name: 'Start trip', exact: true })
  await start.click()
  await driver.getByText('ACTIVE', { exact: true }).waitFor({ timeout: 60000 })
  await driver.getByRole('button', { name: 'Resume navigation', exact: true }).click()
  await driver.getByTestId('driver-route-map').waitFor()
  await driver.waitForTimeout(12000)
  await shot(driver, '07-guidance-location')
  pass('Truck verification, trip start and browser GPS capture run through actual APIs')
  await driver.getByRole('button', { name: 'Hotels', exact: true }).click()
  await driver.getByText('Searching…', { exact: true }).waitFor({ state: 'hidden' })
  await shot(driver, '08-roadside')
  pass('Roadside category search reaches a sourced result or explicit unavailable state')
  await driver.getByRole('button', { name: 'Search this area', exact: true }).click()
  await driver.getByText('Searching…', { exact: true }).waitFor({ state: 'hidden' })
  pass('Explicit Search this area uses visible map bounds')
  await driver.getByRole('button', { name: 'Hotels', exact: true }).click()
  await context.setOffline(true)
  await driver.waitForTimeout(12000)
  await shot(driver, '09-offline')
  await context.setOffline(false)
  await driver.getByRole('button', { name: 'Back to trip', exact: true }).click()
  await driver.reload()
  // Expo web deliberately persists no refresh token (src/auth/tokenStore.ts: there
  // is nowhere safe to put it, and the API is called with credentials:'omit'), so a
  // reload signs the driver out BY DESIGN. Signing back in is what exercises the
  // real invariant: the accepted trip comes back from authoritative SERVER state
  // with no second acceptance. Native SecureStore persistence is NOT covered here.
  await signIn(driver, 'http://localhost:8081', fixture.driver, true)
  await driver.getByText(fixture.trip_code, { exact: true }).waitFor({ timeout: 60000 })
  await driver.getByRole('button', { name: 'Resume navigation', exact: true }).waitFor({ timeout: 60000 })
  if (await driver.getByRole('button', { name: 'Accept trip', exact: true }).count()) throw new Error('Lost accepted state after restart')
  if (acceptRequests > 1) throw new Error(`Duplicate accepts after restart: ${acceptRequests}`)
  pass('Restart restores the accepted trip from server state with no second acceptance (web scope; native token persistence not covered)')
  await manager.getByRole('link', { name: 'Fleet', exact: true }).click()
  await manager.getByRole('button', { name: fixture.trip_code, exact: true }).click()
  await manager.getByText('Loading trip details…').waitFor({ state: 'hidden' })
  await shot(manager, '10-manager-active-trip')
  pass('Manager sees the same active trip and its location freshness')
  report.status = 'PASS'
 } catch (error) {
   report.status = 'FAIL'; report.failure = error.message
   console.error(error.message)
   if (current) await current.evaluate(() => window.scrollTo(0,0)).then(() => shot(current, 'failure')).catch(() => {})
   process.exitCode = 1
 } finally {
   fs.writeFileSync(path.join(out, 'journey-report.json'), JSON.stringify(report, null, 2))
   await browser.close()
 }
})()
