import { describe, expect, it, vi } from 'vitest'
import {
  handleResolveMapLink,
  isAllowedHost,
  isPrivateOrProhibitedHost,
  type ResolveMapLinkDeps,
} from '../../../supabase/functions/resolve-map-link/handler'

describe('resolve-map-link Edge Function SSRF & resolution', () => {
  it('blocks private IPs, localhost, and metadata IP', () => {
    expect(isPrivateOrProhibitedHost('localhost')).toBe(true)
    expect(isPrivateOrProhibitedHost('127.0.0.1')).toBe(true)
    expect(isPrivateOrProhibitedHost('169.254.169.254')).toBe(true)
    expect(isPrivateOrProhibitedHost('10.0.1.5')).toBe(true)
    expect(isPrivateOrProhibitedHost('192.168.1.1')).toBe(true)
    expect(isPrivateOrProhibitedHost('172.20.0.1')).toBe(true)
    expect(isPrivateOrProhibitedHost('maps.google.com')).toBe(false)
  })

  it('allows only official Google Maps domains', () => {
    expect(isAllowedHost('google.com')).toBe(true)
    expect(isAllowedHost('www.google.com')).toBe(true)
    expect(isAllowedHost('maps.google.com')).toBe(true)
    expect(isAllowedHost('maps.app.goo.gl')).toBe(true)
    expect(isAllowedHost('goo.gl')).toBe(true)
    expect(isAllowedHost('evil-google.com')).toBe(false)
    expect(isAllowedHost('169.254.169.254')).toBe(false)
  })

  it('rejects forbidden SSRF requests with HTTP 403', async () => {
    const deps: ResolveMapLinkDeps = { fetch: vi.fn() }
    const forbiddenUrls = [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:8000/secret',
      'https://attacker.com/steal',
      'file:///etc/passwd',
    ]
    for (const url of forbiddenUrls) {
      const req = new Request('https://fn.local/resolve-map-link', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      const res = await handleResolveMapLink(req, deps)
      expect([400, 403]).toContain(res.status)
    }
  })

  it('directly parses standard Google Maps links without network hops', async () => {
    const deps: ResolveMapLinkDeps = { fetch: vi.fn() }
    const req = new Request('https://fn.local/resolve-map-link', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://maps.google.com/?q=26.1445,91.7362+(Depot)' }),
    })
    const res = await handleResolveMapLink(req, deps)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.latitude).toBeCloseTo(26.1445)
    expect(data.longitude).toBeCloseTo(91.7362)
    expect(data.label).toBe('Depot')
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('follows redirect on short links and stops on SSRF hop', async () => {
    const deps: ResolveMapLinkDeps = {
      fetch: vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({ location: 'http://169.254.169.254/secret' }),
      }),
    }
    const req = new Request('https://fn.local/resolve-map-link', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://maps.app.goo.gl/short123' }),
    })
    const res = await handleResolveMapLink(req, deps)
    expect(res.status).toBe(403)
  })

  it('follows redirect to valid destination with coordinates', async () => {
    const deps: ResolveMapLinkDeps = {
      fetch: vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({
          location: 'https://www.google.com/maps/place/Guwahati/@26.1823,91.7512,15z',
        }),
      }),
    }
    const req = new Request('https://fn.local/resolve-map-link', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://maps.app.goo.gl/guwahati123' }),
    })
    const res = await handleResolveMapLink(req, deps)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.latitude).toBeCloseTo(26.1823)
    expect(data.longitude).toBeCloseTo(91.7512)
    expect(data.label).toBe('Guwahati')
  })
})
