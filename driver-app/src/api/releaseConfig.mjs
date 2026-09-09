/**
 * Release configuration validation, shared by the runtime guard and the
 * pre-bundle build gate.
 *
 * PLAIN JAVASCRIPT ON PURPOSE, with types in releaseConfig.d.ts.
 *
 * NOT because TypeScript would have failed. An earlier note here claimed the
 * previous .mts gate would crash on EAS because the SDK-57 Android image ships
 * Node 22.23.1; that was wrong. Node enables type stripping BY DEFAULT from
 * v22.18.0, so 22.23.1 would have run it unflagged and the gate would have
 * worked.
 *
 * The reason to ship JavaScript is narrower and honest: it removes a dependency
 * on the runtime's TypeScript support from a check whose entire job is to fail
 * reliably. A gate that stops working when a build image's Node is pinned back
 * to 22.17, or when someone passes --no-experimental-strip-types, is a gate
 * that silently stops gating. This file also runs on Hermes, and the rules stay
 * in one place rather than a copy that drifts.
 *
 * Dependency-free too: no react-native, no expo-*, nothing with a native side.
 *
 * WHY A SEPARATE BUILD GATE EXISTS AT ALL
 *
 * A runtime check cannot un-inline a secret. Expo inlines every `EXPO_PUBLIC_`
 * variable into the bundle at build time, so by the moment `configurationProblem()`
 * runs on a phone the key is already sitting in a readable APK. The runtime
 * check is for honest failure; the build gate is the one that actually prevents
 * the leak.
 */

/**
 * base64url decode, written out rather than relying on `atob`.
 *
 * Hermes and Node both happen to provide `atob`, but a security check that
 * silently changes behaviour with the runtime is not a security check. Twelve
 * lines here removes that variable entirely.
 */
function base64UrlDecode(segment) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let bits = 0
  let acc = 0
  let out = ''
  for (const ch of segment) {
    if (ch === '=') break
    const v = alphabet.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((acc >> bits) & 0xff)
    }
  }
  return out
}

/**
 * Classify an API key.
 *
 * DECODING IS CLASSIFICATION, NOT AUTHENTICATION. Nothing here verifies a
 * signature and nothing here trusts the token; the payload is read only to
 * decide whether this key is one we are willing to embed in a public bundle.
 *
 * The previous version tested the raw string for `service_role`. A legacy
 * service-role key is a JWT, so that substring lives inside base64 and never
 * appears literally - the check passed a fully privileged key. It also accepted
 * arbitrary text, because it only ever looked for things to reject and had no
 * notion of what a valid key looks like. Both are fixed by classifying
 * positively and defaulting to `unknown`.
 */
export function classifyKey(key) {
  if (key.startsWith('sb_publishable_')) return { kind: 'publishable' }
  if (key.startsWith('sb_secret_')) return { kind: 'secret' }

  const parts = key.split('.')
  if (parts.length === 3 && parts.every((p) => p.length > 0)) {
    const json = base64UrlDecode(parts[1])
    if (json !== null) {
      try {
        const payload = JSON.parse(json)
        const role = typeof payload.role === 'string' ? payload.role : undefined
        if (role === 'anon') return { kind: 'legacy-anon', role }
        if (role !== undefined) return { kind: 'legacy-elevated', role }
      } catch {
        /* falls through to unknown */
      }
    }
  }
  return { kind: 'unknown' }
}

/** Hostnames a phone on mobile data can never reach. */
function isUnreachableHost(rawHostname) {
  // WHATWG URL keeps IPv6 literals in brackets: new URL('https://[::1]').hostname
  // === '[::1]'. The previous regex tested the bracketed form against a bare
  // `::1` and therefore accepted IPv6 loopback.
  const host = rawHostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  // Unique-local and link-local IPv6.
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true
  // IPv4-mapped IPv6. WHATWG URL normalises `::ffff:127.0.0.1` to its hex form
  // `::ffff:7f00:1`, so both spellings have to be recognised or the dotted one
  // is the only case the check ever sees.
  let v4 = host
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host)
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (dotted) {
    v4 = dotted[1]
  } else if (hex) {
    const high = parseInt(hex[1], 16)
    const low = parseInt(hex[2], 16)
    v4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }

  const octets = v4.split('.')
  if (octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o))) {
    const [a, b] = octets.map(Number)
    if (a === 0 || a === 127) return true                 // this-host, loopback
    if (a === 10) return true                             // RFC1918
    if (a === 192 && b === 168) return true               // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true      // RFC1918 - the vc3 case
    if (a === 169 && b === 254) return true               // link-local
    if (a === 100 && b >= 64 && b <= 127) return true     // CGNAT
  }
  return false
}

/**
 * The single rule set. Returns a human-readable problem, or null.
 *
 * NEVER INCLUDES THE KEY IN ITS OUTPUT. This string is printed by the build
 * gate and can end up in CI logs; a message that echoes the credential to
 * explain why the credential is wrong would be its own leak.
 */
export function releaseConfigProblem(cfg) {
  if (!cfg.url) return 'EXPO_PUBLIC_SUPABASE_URL is not set.'
  if (!cfg.key) return 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.'

  let url
  try {
    url = new URL(cfg.url)
  } catch {
    return 'EXPO_PUBLIC_SUPABASE_URL is not a valid URL.'
  }

  // Unreachable-address check first: for `http://172.24.85.80:8000` both this
  // and the HTTPS rule fire, but "must be HTTPS" would send someone off to get
  // a certificate for a LAN IP - the wrong fix for the failure this project had.
  if (isUnreachableHost(url.hostname))
    return `${url.hostname} is a local or private address; a phone on mobile data cannot reach it.`
  if (url.protocol !== 'https:')
    return `Supabase must be reached over HTTPS, not ${url.protocol}`

  // Approved origin. A release must point at a Supabase project, not at any
  // host that happens to be public.
  const ref = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(url.hostname)?.[1]
  if (!ref)
    return `${url.hostname} is not a Supabase project origin (<ref>.supabase.co).`
  if (cfg.expectedRef && ref !== cfg.expectedRef)
    return `Build is approved for project ${cfg.expectedRef}, but the URL points at ${ref}.`

  const { kind, role } = classifyKey(cfg.key)
  switch (kind) {
    case 'publishable':
      return null
    case 'legacy-anon':
      return null
    case 'secret':
      return 'A secret key (sb_secret_...) must never be embedded in the app.'
    case 'legacy-elevated':
      return `The API key is a legacy JWT with role "${role}", not "anon". An elevated key must never be embedded in the app.`
    default:
      return 'The API key is not a recognised Supabase key (expected sb_publishable_... or a legacy anon JWT).'
  }
}

/**
 * Whether this origin may be used as the hosted intelligence plane.
 *
 * Reuses `isUnreachableHost` rather than restating the address rules, because
 * that function already encodes the vc3 lesson - a 172.16-31 LAN address in a
 * release profile - along with IPv6 brackets, IPv4-mapped forms and CGNAT.
 * A second copy of those rules would be a second thing to get wrong.
 *
 * Stricter than the legacy backend URL ever was, on two counts:
 *
 *   - https only. A Supabase access token travels on this connection, and
 *     Android release builds block cleartext anyway, so http would fail on the
 *     phone rather than in review.
 *   - no reachable-only-from-here hosts. The whole point of the hosted plane is
 *     that the APK works with no laptop on the network.
 *
 * Returns a human-readable problem, or null when the origin is usable. An empty
 * value returns 'not configured', which is a supported state: the app then
 * reports that route intelligence was not assessed, rather than inventing it.
 */
export function intelligenceOriginProblem(raw) {
  const value = (raw ?? '').trim()
  if (!value) return 'not configured'

  let url
  try {
    url = new URL(value)
  } catch {
    return 'is not a valid URL'
  }
  if (url.protocol !== 'https:') return 'must use https'
  if (isUnreachableHost(url.hostname)) {
    return 'must not point at localhost, a private network or a CGNAT address'
  }
  return null
}
