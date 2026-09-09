/**
 * Hosted Supabase Edge Function: SSRF-Protected Google Maps Link Resolver.
 *
 * Resolves short links (maps.app.goo.gl, goo.gl) and full Google Maps URLs
 * into canonical latitude and longitude coordinates.
 *
 * SSRF Protections:
 * 1. Allowed domains only: *.google.com, *.goo.gl, maps.app.goo.gl, goo.gl
 * 2. Scheme enforcement: https: or http: only
 * 3. Prohibited targets: loopback (127.0.0.1, localhost), RFC 1918 private ranges,
 *    link-local (169.254.169.254 metadata endpoint), IPv6 loopback (::1)
 * 4. Max 5 redirects with manual redirect inspection (validating each hop)
 * 5. 5-second overall timeout
 */

export interface ResolveMapLinkDeps {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  timeoutMs?: number
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const ALLOWED_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
])

export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (ALLOWED_HOSTS.has(host)) return true
  if (host.endsWith('.google.com') || host.endsWith('.goo.gl')) {
    return true
  }
  return false
}

export function isPrivateOrProhibitedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim()
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h === '169.254.169.254'
  ) {
    return true
  }

  // Check IPv4 private subnets
  const ipMatch = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipMatch) {
    const octet1 = parseInt(ipMatch[1], 10)
    const octet2 = parseInt(ipMatch[2], 10)
    if (octet1 === 10) return true // 10.0.0.0/8
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true // 172.16.0.0/12
    if (octet1 === 192 && octet2 === 168) return true // 192.168.0.0/16
    if (octet1 === 169 && octet2 === 254) return true // 169.254.0.0/16 link-local
    if (octet1 === 127) return true // 127.0.0.0/8 loopback
    if (octet1 >= 224) return true // Multicast / reserved
  }

  return false
}

export function extractCoordinatesFromUrl(urlStr: string): {
  lat: number
  lon: number
  label?: string
} | null {
  try {
    const url = new URL(urlStr)
    const href = url.href
    const params = url.searchParams

    // 1. Check query parameter `q` or `query`
    const qParam = params.get('q') || params.get('query')
    if (qParam) {
      const match = qParam.match(/([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)/)
      if (match) {
        const lat = parseFloat(match[1])
        const lon = parseFloat(match[2])
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          const labelMatch = qParam.match(/\(([^)]+)\)/)
          return { lat, lon, label: labelMatch ? labelMatch[1] : undefined }
        }
      }
    }

    // 2. Check destination / daddr / ll
    const dest = params.get('destination') || params.get('daddr') || params.get('ll')
    if (dest) {
      const match = dest.match(/([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)/)
      if (match) {
        const lat = parseFloat(match[1])
        const lon = parseFloat(match[2])
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          return { lat, lon }
        }
      }
    }

    // 3. Check @lat,lon in path
    const atMatch = href.match(/@([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/)
    if (atMatch) {
      const lat = parseFloat(atMatch[1])
      const lon = parseFloat(atMatch[2])
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        let label: string | undefined
        const placeMatch = url.pathname.match(/\/place\/([^/@]+)/)
        if (placeMatch) {
          try {
            label = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
          } catch {
            label = placeMatch[1]
          }
        }
        return { lat, lon, label }
      }
    }
  } catch {
    // ignore parse error
  }
  return null
}

export async function handleResolveMapLink(
  req: Request,
  deps: ResolveMapLinkDeps = { fetch: globalThis.fetch, timeoutMs: 5000 },
): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  let body: any = null
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const rawUrl = String(body?.url ?? '').trim()
  if (!rawUrl) {
    return new Response(
      JSON.stringify({ error: 'url parameter is required' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(rawUrl)
  } catch {
    try {
      targetUrl = new URL(`https://${rawUrl}`)
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }
  }

  // Scheme verification
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return new Response(
      JSON.stringify({ error: 'Only HTTP and HTTPS URLs are permitted' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  // Initial SSRF Check
  if (isPrivateOrProhibitedHost(targetUrl.hostname) || !isAllowedHost(targetUrl.hostname)) {
    return new Response(
      JSON.stringify({ error: 'Only official Google Maps links are allowed' }),
      { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  // 1. Direct coordinate check
  const direct = extractCoordinatesFromUrl(targetUrl.href)
  if (direct) {
    return new Response(
      JSON.stringify({
        latitude: direct.lat,
        longitude: direct.lon,
        label: direct.label ?? null,
        normalized_url: targetUrl.href,
        resolved_via: 'DIRECT_PARSE',
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }

  // 2. Follow redirects up to 5 hops with SSRF validation on every hop
  let currentUrl = targetUrl.href
  const maxHops = 5
  let hops = 0

  while (hops < maxHops) {
    hops++
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5000)

    try {
      const resp = await deps.fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual', // Do not automatically follow, check each hop
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      })
      clearTimeout(timer)

      // Check if redirect response (301, 302, 303, 307, 308)
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location')
        if (!location) {
          break
        }

        let nextUrl: URL
        try {
          nextUrl = new URL(location, currentUrl)
        } catch {
          break
        }

        // Validate each hop
        if (
          isPrivateOrProhibitedHost(nextUrl.hostname) ||
          !isAllowedHost(nextUrl.hostname)
        ) {
          return new Response(
            JSON.stringify({ error: 'Redirected to an untrusted domain' }),
            { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
          )
        }

        currentUrl = nextUrl.href

        // Check if coordinates extracted at this hop
        const hopCoords = extractCoordinatesFromUrl(currentUrl)
        if (hopCoords) {
          return new Response(
            JSON.stringify({
              latitude: hopCoords.lat,
              longitude: hopCoords.lon,
              label: hopCoords.label ?? null,
              normalized_url: currentUrl,
              resolved_via: `REDIRECT_HOP_${hops}`,
            }),
            { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
          )
        }
      } else {
        // Final landing page reached
        const finalCoords = extractCoordinatesFromUrl(resp.url || currentUrl)
        if (finalCoords) {
          return new Response(
            JSON.stringify({
              latitude: finalCoords.lat,
              longitude: finalCoords.lon,
              label: finalCoords.label ?? null,
              normalized_url: resp.url || currentUrl,
              resolved_via: 'FINAL_LANDING_PAGE',
            }),
            { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
          )
        }
        break
      }
    } catch (err: any) {
      clearTimeout(timer)
      return new Response(
        JSON.stringify({
          error:
            err?.name === 'AbortError'
              ? 'Request to resolve link timed out'
              : 'Failed to reach link destination',
        }),
        { status: 504, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }
  }

  // If coordinates could not be extracted
  return new Response(
    JSON.stringify({
      error: 'Could not extract latitude and longitude from this Google Maps link.',
      last_url: currentUrl,
    }),
    { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
}
