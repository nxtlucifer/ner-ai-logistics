/**
 * Categorized authentication errors for Driver App.
 *
 * Exposes user-safe titles and explanations without leaking raw Supabase errors,
 * JWT tokens, database table names, or internal email aliases.
 */

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'NO_DRIVER_PROFILE'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'SERVER'
  | 'UNKNOWN'

export interface UserFacingError {
  code: AuthErrorCode
  title: string
  detail: string
}

export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly title: string
  readonly detail: string

  constructor(code: AuthErrorCode, title: string, detail: string) {
    super(detail)
    this.name = 'AuthError'
    this.code = code
    this.title = title
    this.detail = detail
  }
}

export function categorizeAuthError(error: unknown): UserFacingError {
  if (error instanceof AuthError) {
    return { code: error.code, title: error.title, detail: error.detail }
  }

  // The FastAPI client already knows WHAT failed. Status first, so that a
  // backend whose database is away (503) is never reported as a wrong
  // password, and a wrong password is never reported as "no connection".
  // Duck-typed on `name`/`status` rather than imported: ../api/client imports
  // this module's AuthError through supabaseApi, and a cycle here would drag
  // expo-constants into every test that touches a login error.
  const status = error instanceof Error && error.name === 'ApiError' ? (error as { status?: number }).status ?? 0 : 0
  if (status) {
    if (status === 401) {
      return {
        code: 'INVALID_CREDENTIALS',
        title: 'Incorrect details',
        detail: 'Phone number or password is incorrect.',
      }
    }
    if (status === 429) {
      return {
        code: 'SERVER',
        title: 'Too many attempts',
        detail: 'Wait a minute, then try again.',
      }
    }
    if (status >= 500) {
      return {
        code: 'SERVER',
        title: 'Service offline',
        detail: 'The service is reachable but not working right now. Try again shortly.',
      }
    }
  }
  if (error instanceof Error && error.name === 'NetworkError') {
    // `timedOut` is set by the client when ITS timer fired. Do not test the
    // message: React Native rejects an aborted fetch with "Network request
    // failed", identical to a real failure, so the old `/abort/i` check
    // never matched and every slow server was blamed on the driver's Wi-Fi.
    // TWO signals, because neither alone covers both runtimes.
    //
    // `timedOut` is set by the client when its own timer fired, and is the
    // only reliable signal on React Native: RN rejects an aborted fetch
    // with "Network request failed", word for word identical to a real
    // failure, so the message test below silently never matched on a
    // phone - which is how a 23 s cold start came to be reported to the
    // driver as a broken Wi-Fi connection.
    //
    // The message test still earns its place on web, where an abort
    // surfaces as a DOMException whose text does say so, and where a
    // NetworkError may be constructed without the flag.
    const timedOut =
      (error as { timedOut?: boolean }).timedOut === true ||
      /abort/i.test(error.message)
    return timedOut
      ? {
          code: 'TIMEOUT',
          title: 'Server is waking up',
          detail:
            'Your connection is fine. The service was idle and is starting — this can take up to a minute. Try again.',
        }
      : {
          code: 'NETWORK',
          title: 'No connection',
          detail: 'Unable to reach the service. Check your internet or Wi-Fi.',
        }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  // 1. Invalid credentials
  if (
    message.includes('invalid login credentials') ||
    message.includes('invalid_grant') ||
    message.includes('invalid password') ||
    message.includes('user not found') ||
    message.includes('email not confirmed') ||
    message.includes('incorrect details')
  ) {
    return {
      code: 'INVALID_CREDENTIALS',
      title: 'Incorrect details',
      detail: 'Phone number or password is incorrect.',
    }
  }

  // 2. Account disabled
  if (
    message.includes('account inactive') ||
    message.includes('account_disabled') ||
    message.includes('inactive') ||
    message.includes('disabled') ||
    message.includes('suspended') ||
    message.includes('deactivated')
  ) {
    return {
      code: 'ACCOUNT_DISABLED',
      title: 'Account inactive',
      detail: 'This driver account is inactive. Contact your manager.',
    }
  }

  // 3. No driver profile assigned
  if (
    message.includes('no driver profile') ||
    message.includes('not a driver') ||
    message.includes('profile missing') ||
    message.includes('pgrst116') // PostgREST single row not found
  ) {
    return {
      code: 'NO_DRIVER_PROFILE',
      title: 'Profile missing',
      detail: 'Your login exists, but no driver profile is assigned.',
    }
  }

  // 4. Request timeout
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('aborterror')
  ) {
    return {
      code: 'TIMEOUT',
      title: 'Request timed out',
      detail: 'Login is taking too long. Please try again.',
    }
  }

  // 5. Network connection failure
  if (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('cannot reach') ||
    message.includes('connection') ||
    message.includes('unreachable')
  ) {
    return {
      code: 'NETWORK',
      title: 'No connection',
      detail: 'Unable to reach the service. Check your internet connection.',
    }
  }

  // 6. Server failure / 500+
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('internal server error') ||
    message.includes('server problem')
  ) {
    return {
      code: 'SERVER',
      title: 'Service unavailable',
      detail: 'Service temporarily unavailable. Please try again.',
    }
  }

  // Default fallback: safe, non-revealing error
  return {
    code: 'UNKNOWN',
    title: 'Sign in failed',
    detail: 'Phone number or password is incorrect.',
  }
}
