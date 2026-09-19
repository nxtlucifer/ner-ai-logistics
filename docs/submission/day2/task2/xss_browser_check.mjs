// Day 2 Task 2 - stored-XSS check in the real Manager Web against the isolated
// clone (backend :8020, Vite :5175). The payloads were stored through the API by
// security_probe.py (driver name, truck make, client name, addresses). This
// renders the pages that show them, records every alert() call, counts live
// `img[onerror]` / `svg[onload]` nodes in the DOM, and screenshots the proof.
//
//   node docs/submission/day2/task2/xss_browser_check.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, sleep } from '../../../../.runtime/rehearsal/cdp.mjs'
import { attach, bySelector } from '../../../../.runtime/rehearsal/human.mjs'

const ROOT = 'D:/Projects/ner-ai-logistics'
const URL = 'http://localhost:5175'
const OUT = `${ROOT}/docs/submission/day2/task2/evidence`
mkdirSync(OUT, { recursive: true })
const C = JSON.parse(readFileSync(`${ROOT}/.runtime/demo-credentials.private.json`, 'utf8'))
const results = []
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok, note: String(note).slice(0, 300) }); console.log(ok ? 'PASS' : 'FAIL', name, note ? '- ' + note : '') }

rmSync(join(tmpdir(), 'cdp-profile-9402'), { recursive: true, force: true })
const M = await launch({ width: 1280, height: 820, mobile: false, port: 9402 })
const m = attach(M)
// Any alert/confirm/prompt that fires is the vulnerability; count them instead of blocking on a dialog.
await M.onNewDocument(`window.__alerts = []; for (const k of ['alert','confirm','prompt']) window[k] = (x) => { window.__alerts.push(String(x)); return null }`)
const shot = async (name) => { await sleep(700); await M.shot(`${OUT}/${name}.png`); console.log('shot', name) }
const audit = () => M.eval(`
  const live = document.querySelectorAll('img[onerror], svg[onload], script[src="x"], [onload], [onerror]').length
  const text = document.body.innerText
  return { alerts: window.__alerts.length, live, shows: text.includes('<img src=x onerror=alert(1)>'), showsSvg: text.includes('<svg onload=alert(1)>') }
`)

await M.goto(`${URL}/`)
await m.waitText(/Sign in/)
await m.fill(bySelector('input[name=identifier]'), C.manager.email)
await m.fill(bySelector('input[name=password]'), C.manager.password)
await m.clickText('Sign in')
check('login: manager session', !!(await m.waitText(/Fleet/, 15000)))
await sleep(1500)

// Drivers page: the driver named "<img src=x onerror=alert(1)> SECxxxxxx".
await M.goto(`${URL}/drivers`); await m.waitText(/Drivers/, 10000); await sleep(2500)
await m.fill(bySelector('input[placeholder="Search name or licence"]'), 'onerror')
await sleep(2500)
let a = await audit()
check('drivers page: payload shown as text, no live handler, no alert', a.shows && a.live === 0 && a.alerts === 0, JSON.stringify(a))
await shot('03_xss_test')

// Trips page: the trip whose client name / addresses carry the payloads.
await M.goto(`${URL}/trips`); await m.waitText(/Trips/, 10000); await sleep(2500)
const box = await M.eval(`const i = [...document.querySelectorAll('input')].find(e => /search/i.test(e.placeholder || '')); return i ? i.placeholder : null`)
if (box) { await m.fill(bySelector(`input[placeholder="${box}"]`), 'XSS-'); await sleep(2500) }
a = await audit()
check('trips page: payload shown as text, no live handler, no alert', (a.shows || a.showsSvg) && a.live === 0 && a.alerts === 0, JSON.stringify(a))
await shot('03b_xss_trips')

// Trucks page: make = payload.
await M.goto(`${URL}/trucks`); await m.waitText(/Trucks/, 10000); await sleep(2500)
a = await audit()
check('trucks page: no live handler, no alert', a.live === 0 && a.alerts === 0, JSON.stringify(a))

writeFileSync(`${OUT}/xss_browser_results.json`, JSON.stringify(results, null, 1))
await M.close()
console.log(results.every((r) => r.ok) ? 'ALL PASS' : 'FAILURES')
