import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { networkSecurityXml } = require('../plugins/withDemoNetworkSecurity')

it('permits HTTP only on the explicitly configured LAN IP', () => {
  const xml = networkSecurityXml('http://192.168.1.6:8000', true)
  expect(xml).toContain('<base-config cleartextTrafficPermitted="false"')
  expect(xml).toContain('<domain includeSubdomains="false">192.168.1.6</domain>')
  expect(xml.match(/cleartextTrafficPermitted="true"/g)).toHaveLength(1)
})
it('HTTPS and an unset backend create no HTTP exception', () => {
  for (const url of ['', 'https://api.example.invalid']) expect(networkSecurityXml(url)).not.toContain('cleartextTrafficPermitted="true"')
})
it.each(['http://example.com', 'http://8.8.8.8:8000', 'http://192.168.1.6.example.com', 'ftp://192.168.1.6', `http://user:${randomUUID()}@192.168.1.6`])('refuses a non-LAN or credential-bearing API URL: %s', (url) => {
  expect(() => networkSecurityXml(url)).toThrow()
})

it('permits the phone loopback that adb reverse forwards over USB', () => {
  expect(networkSecurityXml('http://127.0.0.1:8010', true)).toContain('<domain includeSubdomains="false">127.0.0.1</domain>')
})

/* SEC-007: the lan-demo cleartext exemption must never reach a release. The
 * resolved config per EAS profile (eas.json env, following `extends`) is what a
 * build gets, so these read it the way `expo config` and `eas build` do. */
const eas = require('../eas.json').build as Record<string, { extends?: string; env?: Record<string, string> }>
const appJson = require('../app.json')
const appConfig = require('../app.config.js')
const envOf = (name: string): Record<string, string> => ({ ...(eas[name].extends ? envOf(eas[name].extends!) : {}), ...(eas[name].env ?? {}) })
const KEYS = ['NER_BUILD_PROFILE', 'EAS_BUILD_PROFILE', 'EXPO_PUBLIC_API_BASE_URL']
function resolved(env: Record<string, string>) {
  const saved = KEYS.map((k) => [k, process.env[k]] as const)
  for (const k of KEYS) delete process.env[k]
  for (const k of KEYS) if (env[k] !== undefined) process.env[k] = env[k]
  try {
    const cfg = appConfig({ config: structuredClone(appJson.expo) })
    const [, args] = cfg.plugins.find((p: unknown) => Array.isArray(p) && String(p[0]).includes('withDemoNetworkSecurity'))
    const xml: string = networkSecurityXml(args.base, args.lanDemo)
    return { name: cfg.name as string, pkg: cfg.android.package as string, cleartextHosts: [...xml.matchAll(/<domain[^>]*>([^<]+)</g)].map((m) => m[1]) }
  } finally {
    for (const [k, v] of saved) if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
}

it('every EAS profile names itself, so a build cannot be mistaken for another', () => {
  for (const name of Object.keys(eas)) expect(envOf(name).NER_BUILD_PROFILE).toBe(name)
})

it.each(['preview', 'production', 'remote-demo'])('%s: no cleartext host, the release name and package', (profile) => {
  const r = resolved(envOf(profile))
  expect(r.cleartextHosts).toEqual([])
  expect(r.name).toBe('RASTA AI')
  expect(r.pkg).toBe('com.nxtlucifer.nerlogistics.driver.preview')
})

it('lan-demo: one private cleartext host, and its own name and package', () => {
  const r = resolved(envOf('lan-demo'))
  expect(r.cleartextHosts).toEqual(['192.168.1.6'])
  expect(r.name).toBe('RASTA AI LAN DEMO')
  expect(r.pkg).toBe('com.nxtlucifer.nerlogistics.driver.preview.landemo')
})

it.each(['preview', 'production', 'remote-demo'])('%s with a stray LAN http base is refused, never given a cleartext host', (profile) => {
  expect(() => resolved({ ...envOf(profile), EXPO_PUBLIC_API_BASE_URL: 'http://192.168.1.6:8010' })).toThrow(/lan-demo/)
})

it('an EAS builder running another profile cannot borrow the lan-demo marker', () => {
  expect(() => resolved({ ...envOf('lan-demo'), EAS_BUILD_PROFILE: 'production' })).toThrow(/lan-demo/)
})

it('an unnamed local build with a LAN http base gets no cleartext host (fails closed)', () => {
  const r = resolved({ EXPO_PUBLIC_API_BASE_URL: 'http://192.168.1.6:8010' })
  expect(r.cleartextHosts).toEqual([])
  expect(r.name).toBe('RASTA AI')
})

it('without the lan-demo flag, even a private LAN IP gets no cleartext exception', () => {
  expect(networkSecurityXml('http://192.168.1.6:8000')).not.toContain('cleartextTrafficPermitted="true"')
})

it('the EAS release gate lets a LAN http base through only in lan-demo', async () => {
  const { spawnSync } = await import('node:child_process')
  const gate = (env: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(EXPO_PUBLIC_|NER_|EAS_)/.test(k)))
    return spawnSync(process.execPath, ['scripts/check-release-config.mjs'], { cwd: new URL('..', import.meta.url), env: { ...clean, ...env } as NodeJS.ProcessEnv, encoding: 'utf8' })
  }
  const lan = { EXPO_PUBLIC_BACKEND: 'local', EXPO_PUBLIC_API_BASE_URL: 'http://192.168.1.6:8010' }
  const ok = gate(envOf('lan-demo'))
  expect(ok.status).toBe(0)
  expect(ok.stdout).toContain('LAN DEMO build')
  for (const profile of ['preview', 'production', 'remote-demo']) expect(gate({ ...envOf(profile), ...lan }).status).toBe(1)
  expect(gate({ ...envOf('lan-demo'), EAS_BUILD_PROFILE: 'production' }).status).toBe(1)
  expect(gate(envOf('remote-demo')).status).toBe(0)
})
