/**
 * Google Maps URL parser and coordinate extractor for Fleet Manager.
 *
 * Supports formats:
 * - @lat,lng (@26.144512,91.736233,15z)
 * - /place/<name>/@lat,lng,...
 * - ?q=lat,lng or ?q=lat,lng+(Label)
 * - ?query=lat,lng
 * - destination=lat,lng
 * - ll=lat,lng
 * - Short URL detection (maps.app.goo.gl, goo.gl)
 *
 * Invariant: Validates -90 <= lat <= 90, -180 <= lng <= 180.
 */

export interface ParsedMapLocation {
  lat: number
  lon: number
  label?: string
  normalizedUrl: string
}

export function isValidCoordinates(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  )
}

export function isShortGoogleMapsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim())
    const host = parsed.hostname.toLowerCase()
    return host === 'maps.app.goo.gl' || host === 'goo.gl'
  } catch {
    return false
  }
}

export function isGoogleMapsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim())
    const host = parsed.hostname.toLowerCase()
    return (
      host === 'google.com' ||
      host === 'www.google.com' ||
      host === 'maps.google.com' ||
      host === 'maps.app.goo.gl' ||
      host === 'goo.gl' ||
      host.endsWith('.google.com') ||
      host.endsWith('.goo.gl')
    )
  } catch {
    return false
  }
}

/**
 * Parse Google Maps URL directly on client.
 * Returns ParsedMapLocation if coordinates found, or null if short link / no coords.
 */
export function parseGoogleMapsUrl(rawUrl: string): ParsedMapLocation | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    // If user pasted without protocol, try https://
    try {
      parsed = new URL(`https://${trimmed}`)
    } catch {
      return null
    }
  }

  const host = parsed.hostname.toLowerCase()
  if (!isGoogleMapsUrl(parsed.href)) {
    return null
  }

  // If short URL, caller should resolve via edge function
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') {
    return null
  }

  const fullHref = parsed.href
  const searchParams = parsed.searchParams

  // 1. Check query parameter `q` or `query`
  const qParam = searchParams.get('q') || searchParams.get('query')
  if (qParam) {
    // Match lat,lon optionally with label like (Depot)
    const match = qParam.match(/([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)/)
    if (match) {
      const lat = parseFloat(match[1])
      const lon = parseFloat(match[2])
      if (isValidCoordinates(lat, lon)) {
        // Extract label from parenthesis if present
        const labelMatch = qParam.match(/\(([^)]+)\)/)
        return {
          lat,
          lon,
          label: labelMatch ? labelMatch[1] : undefined,
          normalizedUrl: fullHref,
        }
      }
    }
  }

  // 2. Check query parameter `destination` or `daddr`
  const destParam = searchParams.get('destination') || searchParams.get('daddr')
  if (destParam) {
    const match = destParam.match(/([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)/)
    if (match) {
      const lat = parseFloat(match[1])
      const lon = parseFloat(match[2])
      if (isValidCoordinates(lat, lon)) {
        return { lat, lon, normalizedUrl: fullHref }
      }
    }
  }

  // 3. Check query parameter `ll`
  const llParam = searchParams.get('ll')
  if (llParam) {
    const match = llParam.match(/([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)/)
    if (match) {
      const lat = parseFloat(match[1])
      const lon = parseFloat(match[2])
      if (isValidCoordinates(lat, lon)) {
        return { lat, lon, normalizedUrl: fullHref }
      }
    }
  }

  // 4. Check path coordinates: `@lat,lon` (e.g. /@26.144512,91.736233,15z or in /place/)
  const atMatch = fullHref.match(/@([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/)
  if (atMatch) {
    const lat = parseFloat(atMatch[1])
    const lon = parseFloat(atMatch[2])
    if (isValidCoordinates(lat, lon)) {
      // Try to extract place name from path /maps/place/<name>/@...
      let label: string | undefined
      const placeMatch = parsed.pathname.match(/\/place\/([^/@]+)/)
      if (placeMatch) {
        try {
          label = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
        } catch {
          label = placeMatch[1]
        }
      }
      return {
        lat,
        lon,
        label,
        normalizedUrl: fullHref,
      }
    }
  }

  return null
}
