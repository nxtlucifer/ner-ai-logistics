/** Words for the manager shell's server codes. */

/** A server code in words (AUD-11): its translation where there is one, else
 *  "ON_TRIP" -> "On trip". Never the raw enum on screen. */
export function codeWords(t: (en: string) => string, code: string): string {
  const said = t(code)
  return said !== code ? said : code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ')
}

/** As manager-web's Diagnostics (SystemPage providerOk): HEALTHY or STATIC,
 *  and not stale. DEGRADED, UNKNOWN (never called) and the rest are not (AUD-08). */
export function providerHealthy(p: { state: string; freshness: string }): boolean {
  return (p.state === 'HEALTHY' || p.state === 'STATIC') && p.freshness !== 'STALE' && p.freshness !== 'EXPIRED'
}

/** The data providers by the names people know them by (RC-DRV-10): never
 *  "OPEN_METEO_ELEVATION" on screen. An id not listed here reads in words. */
const PROVIDER_NAMES: Record<string, string> = {
  EXPO_PUSH: 'Expo push',
  GLOFAS: 'GloFAS river flow',
  GOOGLE_GEMINI: 'Google Gemini',
  MET_NORWAY: 'MET Norway',
  NASA_GLC: 'NASA landslide catalogue',
  NDMA_SACHET: 'NDMA SACHET',
  NOMINATIM: 'Nominatim',
  OPENROUTER: 'OpenRouter',
  OPENTOPODATA: 'OpenTopoData',
  OPEN_METEO: 'Open-Meteo',
  OPEN_METEO_ELEVATION: 'Open-Meteo elevation',
  OSRM: 'OSRM',
  OVERPASS: 'Overpass',
}

export function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' ')
}

/** A provider's state and freshness, said once when they are the same word
 *  ("Unknown", not "Unknown · Unknown"). */
export function providerState(t: (en: string) => string, p: { state: string; freshness: string }): string {
  const state = codeWords(t, p.state)
  const fresh = codeWords(t, p.freshness)
  return state === fresh ? state : `${state} · ${fresh}`
}
