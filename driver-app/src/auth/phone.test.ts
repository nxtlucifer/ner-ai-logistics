import { describe, expect, it } from 'vitest'
import { normalizeAndValidatePhone } from './phone'

describe('normalizeAndValidatePhone', () => {
  it('accepts standard 10-digit Indian mobile number', () => {
    const res = normalizeAndValidatePhone('9430000777')
    expect(res.isValid).toBe(true)
    expect(res.normalized).toBe('9430000777')
  })

  it('normalizes +91 country code prefix', () => {
    const res = normalizeAndValidatePhone('+919430000777')
    expect(res.isValid).toBe(true)
    expect(res.normalized).toBe('9430000777')
  })

  it('normalizes 91 prefix with space', () => {
    const res = normalizeAndValidatePhone('91 9430000777')
    expect(res.isValid).toBe(true)
    expect(res.normalized).toBe('9430000777')
  })

  it('normalizes formatted number with spaces', () => {
    const res = normalizeAndValidatePhone('94300 00777')
    expect(res.isValid).toBe(true)
    expect(res.normalized).toBe('9430000777')
  })

  it('trims accidental surrounding whitespace', () => {
    const res = normalizeAndValidatePhone('  9430000777  ')
    expect(res.isValid).toBe(true)
    expect(res.normalized).toBe('9430000777')
  })

  it('normalizes leading trunk zero', () => {
    const res = normalizeAndValidatePhone('09430000777')
    expect(res.isValid).toBe(true)
    expect(res.normalized).toBe('9430000777')
  })

  it('rejects short numbers', () => {
    const res = normalizeAndValidatePhone('94300')
    expect(res.isValid).toBe(false)
    expect(res.error).toBe('Mobile number must be 10 digits')
  })

  it('rejects numbers that are too long', () => {
    const res = normalizeAndValidatePhone('94300007771234')
    expect(res.isValid).toBe(false)
    expect(res.error).toBe('Mobile number cannot exceed 10 digits')
  })

  it('rejects letters and symbols', () => {
    const res = normalizeAndValidatePhone('94300abc77')
    expect(res.isValid).toBe(false)
    expect(res.error).toBe('Mobile number cannot contain letters')
  })

  it('rejects numbers not starting with valid Indian mobile prefix (6-9)', () => {
    const res = normalizeAndValidatePhone('1234567890')
    expect(res.isValid).toBe(false)
    expect(res.error).toContain('Enter a valid Indian mobile number starting with 6, 7, 8 or 9')
  })

  it('rejects blank or empty string', () => {
    const res = normalizeAndValidatePhone('')
    expect(res.isValid).toBe(false)
    expect(res.error).toBe('Mobile number is required')
  })
})
