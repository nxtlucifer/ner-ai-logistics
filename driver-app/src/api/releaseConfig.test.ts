/**
 * Regression tests for release configuration.
 *
 * The first three describes are the three defects reported against the earlier
 * validator, each reproduced before being fixed:
 *
 *   1. a synthetic legacy service_role JWT was ACCEPTED - the check searched the
 *      raw string for "service_role", which lives inside base64 and never
 *      appears literally in a JWT;
 *   2. arbitrary text was ACCEPTED - the check only looked for things to reject
 *      and had no idea what a valid key looks like;
 *   3. https://[::1] was ACCEPTED - WHATWG URL reports IPv6 hostnames in
 *      brackets, and the regex tested a bare `::1`.
 *
 * Every key below is synthetic and unsigned. No real credential appears here.
 */

import { describe, expect, it } from 'vitest'

import { classifyKey, releaseConfigProblem, intelligenceOriginProblem } from './releaseConfig.mjs'

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A structurally valid, cryptographically meaningless JWT. */
const jwt = (payload: unknown) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`

const OK_URL = 'https://znaveeefzgfxsblsobdb.supabase.co'
const PUBLISHABLE = 'sb_publishable_synthetic0000'
const ANON_JWT = jwt({ iss: 'supabase', ref: 'znaveeefzgfxsblsobdb', role: 'anon' })
const SERVICE_JWT = jwt({ iss: 'supabase', ref: 'znaveeefzgfxsblsobdb', role: 'service_role' })

describe('defect 1: legacy service_role JWT', () => {
  it('is classified by its decoded role, not by substring search', () => {
    expect(SERVICE_JWT).not.toContain('service_role') // it is inside base64
    expect(classifyKey(SERVICE_JWT)).toEqual({ kind: 'legacy-elevated', role: 'service_role' })
  })

  it('is REJECTED as release configuration', () => {
    expect(releaseConfigProblem({ url: OK_URL, key: SERVICE_JWT })).toMatch(/role "service_role".*never be embedded/)
  })

  it.each(['supabase_admin', 'postgres', 'authenticated', 'dashboard_user'])(
    'rejects any other elevated role: %s',
    (role) => {
      expect(releaseConfigProblem({ url: OK_URL, key: jwt({ role }) })).toMatch(/never be embedded/)
    },
  )

  it('does not leak the key into the message', () => {
    const msg = releaseConfigProblem({ url: OK_URL, key: SERVICE_JWT }) ?? ''
    expect(msg).not.toContain(SERVICE_JWT)
  })
})

describe('defect 2: arbitrary text accepted as a key', () => {
  it.each([
    'hello',
    'not-a-key',
    '',
    'eyJhbGciOiJIUzI1NiJ9',            // one segment only
    'a.b',                              // two segments
    'a.!!!not-base64!!!.c',
    jwt({ iss: 'supabase' }),           // JWT with no role claim
  ])('rejects %j', (key) => {
    expect(releaseConfigProblem({ url: OK_URL, key })).not.toBeNull()
  })

  it('accepts only the two legitimate key shapes', () => {
    expect(releaseConfigProblem({ url: OK_URL, key: PUBLISHABLE })).toBeNull()
    expect(releaseConfigProblem({ url: OK_URL, key: ANON_JWT })).toBeNull()
  })
})

describe('defect 3: IPv6 loopback accepted', () => {
  it.each([
    'https://[::1]',
    'https://[0:0:0:0:0:0:0:1]',
    'https://[::ffff:127.0.0.1]',
    'https://[fe80::1]',
    'https://[fd00::1]',
  ])('rejects %s', (url) => {
    expect(releaseConfigProblem({ url, key: PUBLISHABLE })).toMatch(/local or private address/)
  })
})

describe('unreachable IPv4 ranges', () => {
  it.each([
    'https://172.24.85.80',   // the exact vc3 mistake
    'https://192.168.1.10',
    'https://10.0.2.2',
    'https://127.0.0.1',
    'https://0.0.0.0',
    'https://169.254.1.1',    // link-local
    'https://100.64.0.1',     // CGNAT
    'https://localhost',
  ])('rejects %s', (url) => {
    expect(releaseConfigProblem({ url, key: PUBLISHABLE })).toMatch(/local or private address/)
  })

  it('names the address, not the scheme, for the http LAN case', () => {
    // "must be HTTPS" would send someone off to get a certificate for a LAN IP.
    expect(releaseConfigProblem({ url: 'http://172.24.85.80:8000', key: PUBLISHABLE }))
      .toMatch(/local or private address/)
  })
})

describe('approved origin', () => {
  it('rejects a public host that is not a Supabase project', () => {
    expect(releaseConfigProblem({ url: 'https://example.com', key: PUBLISHABLE }))
      .toMatch(/not a Supabase project origin/)
  })

  it('rejects a different project than the build was approved for', () => {
    expect(releaseConfigProblem({
      url: 'https://xhapouexwacixuvvgdde.supabase.co',
      key: PUBLISHABLE,
      expectedRef: 'znaveeefzgfxsblsobdb',
    })).toMatch(/approved for project znaveeefzgfxsblsobdb/)
  })

  it('accepts the approved project', () => {
    expect(releaseConfigProblem({ url: OK_URL, key: PUBLISHABLE, expectedRef: 'znaveeefzgfxsblsobdb' })).toBeNull()
  })

  it('rejects plain HTTP on a real Supabase origin', () => {
    expect(releaseConfigProblem({ url: 'http://znaveeefzgfxsblsobdb.supabase.co', key: PUBLISHABLE }))
      .toMatch(/HTTPS/)
  })
})

describe('secret keys', () => {
  it('rejects sb_secret_', () => {
    expect(releaseConfigProblem({ url: OK_URL, key: 'sb_secret_synthetic' })).toMatch(/secret key/)
  })
})

describe('intelligenceOriginProblem', () => {
  // The hosted intelligence plane is ALLOWED in a release, unlike
  // EXPO_PUBLIC_API_BASE_URL - but only when it is genuinely hosted. These pin
  // the difference, because getting it wrong reintroduces the vc3 failure by a
  // new name: an APK that works only on the network it was built on.
  it('accepts a public https origin', () => {
    expect(intelligenceOriginProblem('https://ner-intel.onrender.com')).toBeNull()
    expect(intelligenceOriginProblem('https://api.example.com/')).toBeNull()
  })

  it('treats unset as a supported state, not a mistake', () => {
    // A build with no plane reports UNASSESSED, which is honest and shippable.
    for (const empty of ['', '   ', null, undefined]) {
      expect(intelligenceOriginProblem(empty)).toBe('not configured')
    }
  })

  it('refuses cleartext', () => {
    expect(intelligenceOriginProblem('http://api.example.com')).toBe('must use https')
  })

  it.each([
    'https://localhost:8000',
    'https://127.0.0.1:8000',
    'https://127.5.5.5:8000',
    'https://0.0.0.0:8000',
    'https://192.168.1.50:8000',
    'https://10.1.2.3:8000',
    'https://172.20.0.5:8000',
    'https://169.254.1.1:8000',
    'https://100.64.0.1:8000',
    'https://[::1]:8000',
    'https://[fe80::1]:8000',
    'https://[fd00::1]:8000',
    'https://[::ffff:127.0.0.1]:8000',
  ])('refuses the unreachable origin %s', (url) => {
    expect(intelligenceOriginProblem(url)).toMatch(/localhost, a private network or a CGNAT/)
  })

  it('does not over-reject a public address that merely looks private', () => {
    // 172.32 is outside RFC1918; 100.128 is outside CGNAT. An over-broad rule
    // would refuse a real deployment and be debugged as a hosting problem.
    expect(intelligenceOriginProblem('https://172.32.0.1')).toBeNull()
    expect(intelligenceOriginProblem('https://100.128.0.1')).toBeNull()
  })

  it('never echoes the origin in its message', () => {
    // Same rule as the key: this string is printed into CI logs.
    const problem = intelligenceOriginProblem('http://secret-host.internal:9000')
    expect(problem).not.toContain('secret-host')
  })
})
