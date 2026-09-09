import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { networkSecurityXml } = require('../plugins/withDemoNetworkSecurity')

it('permits HTTP only on the explicitly configured LAN IP', () => {
  const xml = networkSecurityXml('http://192.168.1.6:8000')
  expect(xml).toContain('<base-config cleartextTrafficPermitted="false"')
  expect(xml).toContain('<domain includeSubdomains="false">192.168.1.6</domain>')
  expect(xml.match(/cleartextTrafficPermitted="true"/g)).toHaveLength(1)
})
it('HTTPS and an unset backend create no HTTP exception', () => {
  for (const url of ['', 'https://api.example.invalid']) expect(networkSecurityXml(url)).not.toContain('cleartextTrafficPermitted="true"')
})
it.each(['http://example.com', 'http://127.0.0.1:8000', 'http://192.168.1.6.example.com', 'ftp://192.168.1.6', `http://user:${randomUUID()}@192.168.1.6`])('refuses a non-LAN or credential-bearing API URL: %s', (url) => {
  expect(() => networkSecurityXml(url)).toThrow()
})
