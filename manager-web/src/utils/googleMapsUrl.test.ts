import { describe, expect, it } from 'vitest'
import {
  isGoogleMapsUrl,
  isShortGoogleMapsUrl,
  isValidCoordinates,
  parseGoogleMapsUrl,
} from './googleMapsUrl'

describe('googleMapsUrl parser', () => {
  it('validates coordinate bounds accurately', () => {
    expect(isValidCoordinates(26.14, 91.73)).toBe(true)
    expect(isValidCoordinates(90, 180)).toBe(true)
    expect(isValidCoordinates(-90, -180)).toBe(true)
    expect(isValidCoordinates(90.1, 10)).toBe(false)
    expect(isValidCoordinates(10, 180.5)).toBe(false)
    expect(isValidCoordinates(NaN, 10)).toBe(false)
  })

  it('detects Google Maps URLs and short links', () => {
    expect(isGoogleMapsUrl('https://maps.google.com/?q=26,91')).toBe(true)
    expect(isGoogleMapsUrl('https://www.google.com/maps/@26,91,15z')).toBe(true)
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/abcdef123')).toBe(true)
    expect(isGoogleMapsUrl('https://evil-google.com/maps')).toBe(false)
    expect(isGoogleMapsUrl('https://example.com')).toBe(false)

    expect(isShortGoogleMapsUrl('https://maps.app.goo.gl/abcdef123')).toBe(true)
    expect(isShortGoogleMapsUrl('https://goo.gl/maps/xyz')).toBe(true)
    expect(isShortGoogleMapsUrl('https://maps.google.com/?q=26,91')).toBe(false)
  })

  it('parses @lat,lon from path URL', () => {
    const url = 'https://www.google.com/maps/@26.144512,91.736233,15z'
    const result = parseGoogleMapsUrl(url)
    expect(result).not.toBeNull()
    expect(result?.lat).toBeCloseTo(26.144512)
    expect(result?.lon).toBeCloseTo(91.736233)
  })

  it('parses /place/<name>/@lat,lon with decoded label', () => {
    const url = 'https://www.google.com/maps/place/Guwahati+Tea+Warehouse/@26.1823,91.7512,17z/data=...'
    const result = parseGoogleMapsUrl(url)
    expect(result).not.toBeNull()
    expect(result?.lat).toBeCloseTo(26.1823)
    expect(result?.lon).toBeCloseTo(91.7512)
    expect(result?.label).toBe('Guwahati Tea Warehouse')
  })

  it('parses ?q=lat,lon with optional label', () => {
    const url = 'https://maps.google.com/?q=26.1234,91.5678+(Main+Depot)'
    const result = parseGoogleMapsUrl(url)
    expect(result).not.toBeNull()
    expect(result?.lat).toBeCloseTo(26.1234)
    expect(result?.lon).toBeCloseTo(91.5678)
    expect(result?.label).toBe('Main Depot')
  })

  it('parses ?query=lat,lon', () => {
    const url = 'https://www.google.com/maps/search/?api=1&query=26.2000,92.1000'
    const result = parseGoogleMapsUrl(url)
    expect(result).not.toBeNull()
    expect(result?.lat).toBeCloseTo(26.2)
    expect(result?.lon).toBeCloseTo(92.1)
  })

  it('parses destination=lat,lon and ll=lat,lon', () => {
    const destUrl = 'https://www.google.com/maps/dir/?api=1&destination=26.333,92.444'
    const destResult = parseGoogleMapsUrl(destUrl)
    expect(destResult?.lat).toBeCloseTo(26.333)
    expect(destResult?.lon).toBeCloseTo(92.444)

    const llUrl = 'https://maps.google.com/?ll=26.555,92.666'
    const llResult = parseGoogleMapsUrl(llUrl)
    expect(llResult?.lat).toBeCloseTo(26.555)
    expect(llResult?.lon).toBeCloseTo(92.666)
  })

  it('returns null for short URLs so caller can route to edge resolver', () => {
    expect(parseGoogleMapsUrl('https://maps.app.goo.gl/xyz123')).toBeNull()
  })

  it('returns null for invalid or malicious URLs', () => {
    expect(parseGoogleMapsUrl('')).toBeNull()
    expect(parseGoogleMapsUrl('javascript:alert(1)')).toBeNull()
    expect(parseGoogleMapsUrl('https://attacker.com/@26,91')).toBeNull()
    expect(parseGoogleMapsUrl('https://maps.google.com/@999,999')).toBeNull()
  })
})
