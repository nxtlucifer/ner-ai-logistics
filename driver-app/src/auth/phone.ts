/**
 * Indian phone normalization and validation.
 *
 * Accepts formats:
 *   - 9430000777
 *   - +919430000777
 *   - 91 9430000777
 *   - 94300 00777
 *   - " 9430000777 "
 *   - 09430000777
 *
 * Normalizes to canonical 10-digit Indian mobile number.
 */

export interface PhoneValidationResult {
  isValid: boolean
  normalized: string
  error?: string
}

export function normalizeAndValidatePhone(input: string): PhoneValidationResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { isValid: false, normalized: '', error: 'Mobile number is required' }
  }

  // Disallow alphabetic characters
  if (/[a-zA-Z]/.test(trimmed)) {
    return { isValid: false, normalized: '', error: 'Mobile number cannot contain letters' }
  }

  // Extract digits
  let digits = trimmed.replace(/\D/g, '')

  // Strip +91 or 91 country code prefix if 12 digits
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2)
  }

  // Strip leading trunk zero (11 digits)
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1)
  }

  if (digits.length < 10) {
    return { isValid: false, normalized: digits, error: 'Mobile number must be 10 digits' }
  }

  if (digits.length > 10) {
    return { isValid: false, normalized: digits, error: 'Mobile number cannot exceed 10 digits' }
  }

  // Validate Indian mobile prefix (starts with 6, 7, 8, or 9)
  if (!/^[6-9]/.test(digits)) {
    return {
      isValid: false,
      normalized: digits,
      error: 'Enter a valid Indian mobile number starting with 6, 7, 8 or 9',
    }
  }

  return { isValid: true, normalized: digits }
}
