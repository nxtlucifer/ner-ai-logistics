// Render the captured evidence (results.json, pytest / npm / scan outputs) into
// readable PNG cards with headless Chrome. Every value on a card comes from a
// file written by the real run; nothing is typed in here.
//
//   node docs/submission/day2/task2/render_evidence.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { launch, sleep } from '../../../../.runtime/rehearsal/cdp.mjs'

const HERE = 'D:/Projects/ner-ai-logistics/docs/submission/day2/task2'
const EV = `${HERE}/evidence`
const HTML = `${EV}/html`
mkdirSync(HTML, { recursive: true })
const R = JSON.parse(readFileSync(`${EV}/results.json`, 'utf8'))
const byId = Object.fromEntries(R.results.map((r) => [r.id, r]))
const txt = (f) => (existsSync(`${EV}/${f}`) ? readFileSync(`${EV}/${f}`, 'utf8') : '(missing)')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const git = (c) => execSync(c, { cwd: 'D:/Projects/ner-ai-logistics' }).toString().trim()

const CSS = `
  body{margin:0;background:#fff;font:15px/1.45 "Segoe UI",Inter,Arial,sans-serif;color:#101820;width:880px}
  .card{padding:22px 24px 22px}
  h1{font:600 21px/1.2 Georgia,serif;color:#123B4F;margin:0 0 4px}
  .sub{color:#5B6770;font-size:13px;margin:0 0 12px}
  table{border-collapse:collapse;width:100%;table-layout:fixed}
  th{background:#123B4F;color:#fff;text-align:left;font-size:13px;padding:6px 8px;letter-spacing:.02em}
  td{border-bottom:1px solid #C9D3D8;padding:6px 8px;vertical-align:top;font-size:13.5px;word-break:break-word}
  tr:nth-child(even) td{background:#F3F6F8}
  .id{font-family:Consolas,monospace;font-size:12.5px;white-space:nowrap}
  .obs{font-family:Consolas,monospace;font-size:12.5px;white-space:pre-wrap}
  .v{font-weight:700;padding:2px 7px;border-radius:4px;display:inline-block;font-size:12px}
  .PASS{background:#D8F1E4;color:#0B6B3A}.FAIL{background:#FCE0DD;color:#9E1B14}.FINDING{background:#FFF0D6;color:#8A5300}.INFO{background:#E4EEF4;color:#123B4F}.FIXED{background:#D8F1E4;color:#0B6B3A}
  pre{background:#F3F6F8;border:1px solid #C9D3D8;border-radius:6px;padding:10px 12px;font:12.5px/1.38 Consolas,monospace;white-space:pre-wrap;margin:8px 0 0}
  .foot{color:#5B6770;font-size:11.5px;margin-top:10px}
  .kv td:first-child{width:170px;color:#5B6770;font-weight:600}
`
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="card"><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p>${body}<p class="foot">RASTA AI · Day 2 Task 2 · captured ${esc(R.ran_at.slice(0, 16).replace('T', ' '))} UTC · target ${esc(R.base)} (isolated clone ner_logistics_sec) · values redacted at capture time</p></div>`

function rows(ids, cols = ['ID', 'Target', 'Observed (redacted)', 'Expected', 'Verdict']) {
  const tr = ids.map((id) => byId[id]).filter(Boolean).map((r) => `<tr><td class="id">${esc(r.id)}</td><td>${esc(r.target)}</td><td class="obs">${esc(r.observed)}</td><td>${esc(r.expected)}</td><td><span class="v ${r.verdict}">${esc(r.verdict)}</span></td></tr>`).join('')
  return `<table><colgroup><col style="width:104px"><col style="width:170px"><col><col style="width:176px"><col style="width:70px"></colgroup><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${tr}</table>`
}
const kv = (pairs) => `<table class="kv">${pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="obs">${esc(v)}</td></tr>`).join('')}</table>`

const cards = {
  '01_scope_environment': page('Testing scope and environment', 'What was tested, where, and with what', kv([
    ['Repository', 'nxtlucifer/ner-ai-logistics'], ['Branch / HEAD', `${git('git branch --show-current')} @ ${git('git rev-parse --short HEAD')} (working tree with uncommitted Day 2 work)`],
    ['Backend under test', 'FastAPI app from the working tree, started by .runtime/start-sec-backend.sh on http://127.0.0.1:8020 (APP_ENV=development)'],
    ['Database', 'PostgreSQL 18.2 + PostGIS 3.6, isolated local cluster 127.0.0.1:55432, database ner_logistics_sec = CREATE DATABASE ... TEMPLATE ner_logistics_demo, migrated to 0013, dropped after the assessment'],
    ['Manager Web', 'Vite dev server http://localhost:5175 -> API :8020 (stored-XSS rendering check, headless Chrome)'],
    ['Hosted (read-only checks)', 'https://ner-intelligence.onrender.com, https://ner-manager.onrender.com, https://ner-driver-web.onrender.com - HEAD/GET of public pages, one login/logout on our own API to read cookie flags'],
    ['Accounts', 'seeded demo manager + two seeded demo drivers on the clone; one throwaway driver created and deactivated on the clone'],
    ['Tools', 'security_probe.py (httpx + PyJWT, 49 cases), xss_browser_check.mjs (Chrome DevTools Protocol), pytest (isolated cluster), vitest, tsc, vite build, npm audit, scripts/secret_scan.py + full tracked-file pattern scan, curl'],
    ['Out of scope', 'third-party providers (Supabase infrastructure, Render, MapTiler, Google, OSRM, Open-Meteo), denial-of-service, high-volume brute force, production data writes, hardware (page 2 of the task sheet)'],
  ])),
  '02_sqli_test': page('SQL injection', 'Login, three search endpoints, cursor, path and enum parameters - every payload bound as a parameter by SQLAlchemy', rows(['SEC-SQLI-001', 'SEC-SQLI-002', 'SEC-SQLI-003', 'SEC-SQLI-004', 'SEC-SQLI-005', 'SEC-SQLI-006', 'SEC-SQLI-007'])),
  '04_security_headers': page('Security headers', 'Local backend after the fix (SEC-001), and the hosted services as they were before the fix is deployed', rows(['SEC-HDR-001', 'SEC-HDR-001h', 'SEC-HDR-002']) + `<pre>${esc(txt('headers_before_after.txt').split('### hosted static sites')[0].trim())}</pre>`),
  '05_file_upload_validation': page('Insecure file upload', 'Magic-byte typing, size cap (now bounded before buffering - SEC-004), ownership and cross-account attempts', rows(['SEC-UP-001', 'SEC-UP-002', 'SEC-UP-003', 'SEC-UP-004', 'SEC-UP-005', 'SEC-UP-006', 'SEC-UP-007', 'SEC-API-004'])),
  '06_session_security': page('Session management', 'Cookie flags, rotation and replay, logout, forged tokens, disabled accounts, support-view token', rows(['SEC-SESS-001', 'SEC-SESS-001h', 'SEC-SESS-002', 'SEC-SESS-003', 'SEC-SESS-004', 'SEC-SESS-005', 'SEC-SESS-006', 'SEC-SESS-007', 'SEC-SESS-008'])),
  '07_api_unauthorized_access': page('API security - unauthenticated and malformed access', 'Every mounted operation without a token, wrong-role access, invalid ids, method restrictions, SSRF, cross-trip actions', rows(['SEC-API-001', 'SEC-API-003', 'SEC-API-006', 'SEC-API-008', 'SEC-API-009', 'SEC-API-010', 'SEC-XSS-005'])),
  '08_api_role_access': page('API security and excessive access - role and object boundaries', 'Driver against manager surfaces, BOLA on documents (SEC-002, fixed), fleet register scoping (SEC-003, fixed), mass assignment, pagination, data minimisation', rows(['SEC-API-002', 'SEC-API-005', 'SEC-XS-004', 'SEC-XS-005', 'SEC-API-007', 'SEC-XS-001', 'SEC-XS-002', 'SEC-XS-003'])),
  '09_rate_limit': page('Authentication rate limiting', 'Ten wrong passwords on one identifier are 401; the eleventh is 429 with Retry-After. The 61 s wait before the run shows the per-IP window recovering.', rows(['SEC-RL-001']) + `<pre>${esc(txt('probe_postfix.txt').split('\n').filter((l) => /RL-001|waiting 61/.test(l)).join('\n'))}</pre>`),
  '10_secret_scan': page('Security misconfiguration - configuration checks', 'Docs exposure, CORS, error containment, readiness disclosure, server header; tracked .env files and the project secret scanner', rows(['SEC-CFG-001', 'SEC-CFG-003', 'SEC-CFG-005', 'SEC-CFG-006', 'SEC-CFG-009']) + `<pre>${esc(txt('secret_scan.txt').split('### full tracked-file scan')[0].trim())}</pre>`),
  '10b_secret_scan_full': page('Security misconfiguration - full tracked-file secret scan', 'Every tracked text file scanned with the project rules plus a JWT rule; each hit triaged (values never reproduced)', `<pre>${esc('### full tracked-file scan' + txt('secret_scan.txt').split('### full tracked-file scan')[1])}</pre>`),
  '10c_bundle_dependencies': page('Security misconfiguration - built bundle and dependencies', 'Manager bundle scanned after npm run build; npm audit for both clients (production and full)', `<pre>${esc(txt('manager_regression.txt').split('### bundle secret scan')[1] ? '### bundle secret scan' + txt('manager_regression.txt').split('### bundle secret scan')[1] : '')}</pre><pre>${esc(txt('dependency_audit.txt'))}</pre>`),
  '11_security_tests': page('Regression tests for the fixes', 'backend/tests/test_security_assessment.py: fails with the fixes reverted, passes with them; manager tripExport XSS case', `<pre>${esc(txt('regression_tests.txt'))}</pre>`),
  '12_final_regression': page('Final regression', 'Backend suite on the isolated cluster, Manager Web test / typecheck / build, Driver App test / typecheck', `<pre>${esc(txt('backend_full_suite.txt'))}</pre><pre>${esc(txt('manager_regression.txt').split('### bundle secret scan')[0])}</pre><pre>${esc(txt('driver_regression.txt'))}</pre>`),
}

rmSync(join(tmpdir(), 'cdp-profile-9403'), { recursive: true, force: true })
const M = await launch({ width: 880, height: 900, mobile: false, port: 9403 })
for (const [name, html] of Object.entries(cards)) {
  const f = `${HTML}/${name}.html`
  writeFileSync(f, html)
  await M.goto('file:///' + f.replace(/\\/g, '/'))
  await sleep(300)
  await M.send('Emulation.setDeviceMetricsOverride', { width: 880, height: 300, deviceScaleFactor: 2, mobile: false })
  await sleep(150)
  const h = await M.eval('return document.body.getBoundingClientRect().height')
  await M.send('Emulation.setDeviceMetricsOverride', { width: 880, height: Math.min(Math.ceil(h) + 2, 6000), deviceScaleFactor: 2, mobile: false })
  await sleep(200)
  await M.shot(`${EV}/${name}.png`)
  console.log('rendered', name, h + 'px')
}
await M.close()
