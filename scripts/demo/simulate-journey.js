/**
 * Simulate the Assam journey for a live demonstration.
 *
 * WHAT THIS IS
 *
 * A dedicated Chrome window whose GEOLOCATION is simulated, and nothing else.
 * Coordinates are read from the route the backend currently has approved for
 * the demo driver, then handed to Chrome's own geolocation. From there the
 * app's ordinary `watchPosition`, its uploader, the backend's ingestion, the
 * permission checks, the freshness rules and the route policy all run exactly
 * as they always do.
 *
 * Nothing is stubbed. No API response is faked, no application state is written
 * from outside, and the app is not told it is being demonstrated. If guidance
 * pauses during a demo, that is the product telling the truth.
 *
 * WHY NOT REAL GPS
 *
 * Real device location in Gujarat is real location in Gujarat. Feeding it to a
 * trip whose approved route runs Guwahati to Jorhat produces an off-route hold,
 * which is correct behaviour and a poor demonstration. The two are therefore
 * separate choices, and this one is labelled on screen for as long as it runs.
 *
 * TIME IS ACCELERATED, AND SAYS SO
 *
 * A 305 km corridor at road speed is a five-hour demonstration. The replay
 * advances along the route at a multiple of real time; the multiplier is shown
 * in the banner so nobody mistakes it for a measured journey.
 *
 * CONTROLS   space = pause / resume     s = stop replay, leave browser open
 *            q     = stop and close
 */

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const RUNTIME = path.join(ROOT, '.runtime')
const LOCK = path.join(RUNTIME, 'demo-replay.lock')

const DRIVER_ORIGINS = ['http://127.0.0.1:8081', 'http://localhost:8081']
const ORIGIN = DRIVER_ORIGINS[0]
const API = 'http://127.0.0.1:8000'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
/**
 * Ground speed in km/h. A real speed, not a multiplier.
 *
 * This was `--speed 60` meaning "60x real time" over an unstated 60 km/h
 * baseline, which is two guesses stacked on each other and nobody could say
 * what the truck was doing. `--kmh 50` is 50 km/h, and the banner says so.
 *
 * A 305 km corridor at 50 km/h really does take six hours, which is honest and
 * slow. Raise it for a short demonstration (`--kmh 400`) or start near a turn
 * with `--from`.
 */
const KMH = Number(flag('kmh', flag('speed', '50')))
/** Seconds between position updates. */
const TICK_S = Number(flag('tick', '2'))
/** Start this fraction along the route (0-1), so a demo can begin near a turn. */
const START_AT = Number(flag('from', '0'))
/** Which credential file to drive as. */
const DRIVER_FILE = flag('driver', null)
/** Optional: save one screenshot once the journey is under way, then keep going. */
const SHOT = flag('shot', null)

const line = (s = '') => process.stdout.write(s + '\n')

function readCreds(file) {
  const p = path.join(RUNTIME, file)
  if (!fs.existsSync(p)) throw new Error(`Missing credential file: ${p}`)
  const l = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((x) => x.trim())
  return { id: l[0].trim(), pw: l[1].trim() }
}

async function driverToken(c) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: c.id, password: c.pw }),
  })
  if (!r.ok) throw new Error(`Driver sign-in failed (${r.status}). Is the backend running?`)
  return (await r.json()).access_token
}

async function fetchRoute(tok) {
  const t = await fetch(`${API}/api/driver/me/trip`, { headers: { Authorization: `Bearer ${tok}` } })
  if (!t.ok) throw new Error(`Could not read the driver's trip (${t.status}).`)
  const trip = await t.json()

  const n = await fetch(`${API}/api/driver/me/trip/navigation`, { headers: { Authorization: `Bearer ${tok}` } })
  if (!n.ok) throw new Error(`Could not read the navigation package (${n.status}).`)
  const nav = await n.json()
  return { trip, nav }
}

/** Metres between two WGS84 points. */
function metres(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Cumulative distance to each vertex, so the replay can move by metres. */
function cumulative(geo) {
  const out = [0]
  for (let i = 1; i < geo.length; i++) out.push(out[i - 1] + metres(geo[i - 1], geo[i]))
  return out
}

// --- one replay at a time -------------------------------------------------
//
// Two replays publishing positions for the same driver would fight: each
// overwrites the other's last fix, progress jumps back and forth, and the
// demonstration looks broken for a reason nobody can see.

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true } catch { return false }
}

function takeLock() {
  if (fs.existsSync(LOCK)) {
    let held = null
    try { held = JSON.parse(fs.readFileSync(LOCK, 'utf8')) } catch { /* unreadable = stale */ }
    if (held && held.pid && isAlive(held.pid)) {
      throw new Error(
        [
          `Another journey replay is already running (pid ${held.pid}).`,
          '  Stop that one first. If you are certain it is dead, delete:',
          `  ${LOCK}`,
        ].join('\n'),
      )
    }
    // Stale lock from a crashed run - take it over.
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
}

function releaseLock() {
  try { fs.unlinkSync(LOCK) } catch {}
}

const BANNER_ID = '__ner_sim_banner'

/**
 * The on-screen label, injected by this harness and NOT by the application.
 *
 * Deliberately outside the React root so the app cannot be made to render a
 * "simulation" state it does not really have, and so nobody watching can
 * mistake a demo for a real journey. Re-applied after navigation.
 */
async function showBanner(page, kmh) {
  await page.evaluate(
    ({ id, kmh }) => {
      const existing = document.getElementById(id)
      if (existing) existing.remove()
      const el = document.createElement('div')
      el.id = id
      el.textContent = `SIMULATED GPS - browser test - driving at ${kmh} km/h`
      Object.assign(el.style, {
        position: 'fixed',
        left: '0',
        right: '0',
        bottom: '0',
        zIndex: '2147483647',
        background: '#B45309',
        color: '#FFFFFF',
        font: '600 13px system-ui, sans-serif',
        letterSpacing: '0.04em',
        textAlign: 'center',
        padding: '6px 10px',
        pointerEvents: 'none',
      })
      document.body.appendChild(el)
    },
    { id: BANNER_ID, kmh },
  )
}

;(async () => {
  takeLock()

  // The owner's demo account by default, falling back to the original LS9
  // driver. Named explicitly with --driver when there is a reason to.
  const credFile =
    DRIVER_FILE ||
    (fs.existsSync(path.join(RUNTIME, 'demo-account-login.txt'))
      ? 'demo-account-login.txt'
      : 'driver-login.txt')
  const creds = readCreds(credFile)
  const tok = await driverToken(creds)
  let { trip, nav } = await fetchRoute(tok)

  if (!nav.geometry || nav.geometry.length < 2)
    throw new Error('The approved route has no geometry to replay.')

  let geo = nav.geometry
  let cum = cumulative(geo)
  let routeId = nav.route_id

  line('')
  line('  Simulated Assam journey')
  line(`    signed in as   : ${credFile}`)
  line(`    trip           : ${trip.trip_code} (${trip.status})`)
  line(`    route          : ${routeId}`)
  line(`    geometry       : ${geo.length} points, ${(cum[cum.length - 1] / 1000).toFixed(1)} km`)
  line(`    guidance       : ${nav.available ? `${nav.maneuvers.length} maneuvers` : `unavailable (${nav.reason_codes.join(', ')})`}`)
  line(`    speed          : ${KMH} km/h, updated every ${TICK_S}s`)
  line('')

  const browser = await chromium.launch({ channel: 'chrome', headless: false })
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: geo[0][0], longitude: geo[0][1] },
    viewport: null,
  })
  for (const o of DRIVER_ORIGINS) await context.grantPermissions(['geolocation'], { origin: o })

  // No demonstration places a real call. The attempt is recorded and blocked;
  // the app's own "Last dialler request" line still shows that it asked.
  await context.addInitScript(() => {
    window.__telIntents = []
    const realOpen = window.open.bind(window)
    window.open = (url, ...rest) => {
      if (typeof url === 'string' && url.startsWith('tel:')) {
        window.__telIntents.push(url)
        console.warn('[demo] dialler intent blocked:', url)
        return null
      }
      return realOpen(url, ...rest)
    }
  })

  const page = await context.newPage()
  page.setDefaultTimeout(180000)
  line('  opening the driver app (Expo builds its bundle on first load)...')
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForTimeout(5000)

  // Sign in only if the app is showing the sign-in screen.
  const phone = await page.$('input[type="tel"]')
  if (phone) {
    await page.fill('input[type="tel"]', creds.id)
    await page.fill('input[type="password"]', creds.pw)
    await page.getByText('Sign in', { exact: true }).click()
    await page.waitForTimeout(6000)
  }
  const resume = page.getByText('Resume navigation', { exact: true })
  if (await resume.count()) {
    await resume.click()
    await page.waitForTimeout(8000)
  }

  await showBanner(page, KMH)
  page.on('framenavigated', () => showBanner(page, KMH).catch(() => {}))

  // --- replay ------------------------------------------------------------
  // Declared before the keyboard handler and the wait loop below, both of which
  // read them.
  let paused = false
  let stopped = false

  const total = cum[cum.length - 1]
  let travelled = Math.max(0, Math.min(1, START_AT)) * total

  const metresPerTick = (KMH * 1000 * TICK_S) / 3600

  function positionAt(d) {
    if (d <= 0) return geo[0]
    if (d >= total) return geo[geo.length - 1]
    let i = 0
    while (i + 1 < cum.length && cum[i + 1] < d) i++
    const span = cum[i + 1] - cum[i]
    const t = span <= 0 ? 0 : (d - cum[i]) / span
    return [geo[i][0] + t * (geo[i + 1][0] - geo[i][0]), geo[i][1] + t * (geo[i + 1][1] - geo[i][1])]
  }

  line('  controls:  [space] pause/resume   [s] stop replay, keep browser   [q] quit')
  line('')

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', async (buf) => {
      const k = buf.toString()
      if (k === ' ') {
        paused = !paused
        line(paused ? '  || paused' : '  >  resumed')
      } else if (k === 's') {
        stopped = true
        line('  [] replay stopped. The browser stays open - drive it by hand.')
      } else if (k === 'q' || k === '') {
        stopped = true
        line('  quitting...')
        releaseLock()
        await browser.close().catch(() => {})
        process.exit(0)
      }
    })
  }


  // A truck does not move before its driver takes the job.
  //
  // Tracking is expected only while the trip is ACTIVE, which is two deliberate
  // human actions away: Accept, then Start. Publishing positions before that
  // would be simulating a journey nobody has begun - and it would hide the two
  // steps that are worth showing. So the replay waits, and says what it is
  // waiting for.
  if (trip.status !== 'ACTIVE') {
    line(`  Trip is ${trip.status}. Waiting for the driver to Accept and Start it...`)
    line('  (do that in the browser window that just opened)')
    let announced = ''
    while (!stopped) {
      await page.waitForTimeout(3000)
      try {
        const now = await fetchRoute(tok)
        trip = now.trip
        if (trip.status === 'ACTIVE') {
          line('  Trip is ACTIVE - starting the drive.')
          break
        }
        const note = trip.driver_accepted_at ? 'accepted, waiting for Start trip' : 'waiting for Accept trip'
        if (note !== announced) {
          line(`  ${note}...`)
          announced = note
        }
      } catch {
        // Backend blip; keep waiting.
      }
    }
  }

  if (SHOT) {
    // One frame for a teammate who is not at the laptop. The replay keeps
    // running afterwards - this does not turn the demo into a screenshot.
    setTimeout(() => {
      page
        .screenshot({ path: SHOT })
        .then(() => line(`
  saved ${SHOT}`))
        .catch(() => {})
    }, 25000)
  }

  let sinceRouteCheck = 0
  while (!stopped) {
    await page.waitForTimeout(TICK_S * 1000)
    if (stopped) break
    if (paused) continue

    travelled = Math.min(total, travelled + metresPerTick)
    const [lat, lon] = positionAt(travelled)
    await context.setGeolocation({ latitude: lat, longitude: lon })

    process.stdout.write(
      `\r  ${(travelled / 1000).toFixed(1)} / ${(total / 1000).toFixed(1)} km   ` +
        `${lat.toFixed(5)}, ${lon.toFixed(5)}      `,
    )

    if (travelled >= total) {
      line('')
      line('  arrived at the destination. Replay finished; the browser stays open.')
      break
    }

    // The approved route can change under a running demo - a manager accepting
    // a reroute is a thing this product does. Replaying the OLD line onto a NEW
    // route would put the truck off-route and look like a defect, so the replay
    // reloads onto whatever is now approved.
    sinceRouteCheck += TICK_S
    if (sinceRouteCheck >= 10) {
      sinceRouteCheck = 0
      try {
        const fresh = await fetchRoute(tok)
        if (fresh.nav.route_id && fresh.nav.route_id !== routeId) {
          line('')
          line(`  route changed (${routeId} -> ${fresh.nav.route_id}); reloading the replay onto it.`)
          const fraction = travelled / total
          geo = fresh.nav.geometry
          cum = cumulative(geo)
          routeId = fresh.nav.route_id
          travelled = fraction * cum[cum.length - 1]
        }
      } catch {
        // Backend blip. Keep replaying; the app will show its own held state.
      }
    }
  }

  line('')
  line('  Replay ended. The browser window is still open for you to use.')
  line('  Press Ctrl+C here when you are finished with it.')
  releaseLock()

  // Hold the process so the browser stays open for the demonstration.
  await new Promise(() => {})
})().catch((e) => {
  releaseLock()
  console.error('\n  FAILED: ' + e.message + '\n')
  process.exit(1)
})
