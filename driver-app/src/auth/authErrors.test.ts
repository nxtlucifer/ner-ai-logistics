import { describe, expect, it, vi } from 'vitest'

// The real client pulls in react-native; only the two error classes matter here.
vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    code: string
    constructor(status: number, body: { error?: { code?: string; message?: string } } | null, fallback: string) {
      super(body?.error?.message ?? fallback)
      this.name = 'ApiError'
      this.status = status
      this.code = body?.error?.code ?? 'UNKNOWN'
    }
  },
  NetworkError: class NetworkError extends Error {
    constructor(cause: unknown) {
      super(cause instanceof Error ? `Cannot reach the server: ${cause.message}` : 'Cannot reach the server')
      this.name = 'NetworkError'
    }
  },
}))

import { categorizeAuthError, AuthError } from './authErrors'
import { ApiError, NetworkError } from '../api/client'

describe('categorizeAuthError', () => {
  it('handles explicit AuthError instance', () => {
    const err = new AuthError('ACCOUNT_DISABLED', 'Account inactive', 'Contact manager')
    const res = categorizeAuthError(err)
    expect(res.code).toBe('ACCOUNT_DISABLED')
    expect(res.title).toBe('Account inactive')
    expect(res.detail).toBe('Contact manager')
  })

  it('categorizes invalid login credentials', () => {
    const res = categorizeAuthError(new Error('Invalid login credentials'))
    expect(res.code).toBe('INVALID_CREDENTIALS')
    expect(res.title).toBe('Incorrect details')
    expect(res.detail).toBe('Phone number or password is incorrect.')
  })

  it('categorizes invalid_grant from GoTrue', () => {
    const res = categorizeAuthError(new Error('invalid_grant: Invalid login credentials'))
    expect(res.code).toBe('INVALID_CREDENTIALS')
  })

  it('categorizes inactive or disabled accounts', () => {
    const res = categorizeAuthError(new Error('Driver account is inactive'))
    expect(res.code).toBe('ACCOUNT_DISABLED')
    expect(res.title).toBe('Account inactive')
    expect(res.detail).toBe('This driver account is inactive. Contact your manager.')
  })

  it('categorizes missing driver profile', () => {
    const res = categorizeAuthError(new Error('No driver profile is assigned'))
    expect(res.code).toBe('NO_DRIVER_PROFILE')
    expect(res.title).toBe('Profile missing')
    expect(res.detail).toBe('Your login exists, but no driver profile is assigned.')
  })

  it('categorizes network failure', () => {
    const res = categorizeAuthError(new Error('Network request failed'))
    expect(res.code).toBe('NETWORK')
    expect(res.title).toBe('No connection')
    expect(res.detail).toContain('Unable to reach the service')
  })

  it('categorizes timeout error', () => {
    const res = categorizeAuthError(new Error('Request timed out'))
    expect(res.code).toBe('TIMEOUT')
    expect(res.title).toBe('Request timed out')
  })

  it('categorizes server 500+ error', () => {
    const res = categorizeAuthError(new Error('Internal server error 500'))
    expect(res.code).toBe('SERVER')
    expect(res.title).toBe('Service unavailable')
  })

  it('never exposes raw Supabase details in unknown fallback', () => {
    const res = categorizeAuthError(new Error('Internal exception at auth.users WHERE id = 123'))
    expect(res.title).toBe('Sign in failed')
    expect(res.detail).toBe('Phone number or password is incorrect.')
    expect(res.detail).not.toContain('auth.users')
    expect(res.detail).not.toContain('123')
  })
})

describe('categorizeAuthError on the FastAPI client', () => {
  it('tells a wrong password, a dead backend and no network apart by status', () => {
    expect(categorizeAuthError(new ApiError(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid credentials.' } }, 'x')).code).toBe('INVALID_CREDENTIALS')
    expect(categorizeAuthError(new ApiError(503, { error: { code: 'DATABASE_UNAVAILABLE', message: 'A database error occurred.' } }, 'x')).title).toBe('Service offline')
    expect(categorizeAuthError(new NetworkError(new TypeError('Failed to fetch'))).code).toBe('NETWORK')
    expect(categorizeAuthError(new NetworkError(new DOMException('The operation was aborted', 'AbortError'))).code).toBe('TIMEOUT')
  })
})
