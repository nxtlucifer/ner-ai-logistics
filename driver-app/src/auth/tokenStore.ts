/**
 * Refresh-token storage for the driver app.
 *
 * Native (Android/iOS)
 *   expo-secure-store, which is Keystore on Android and Keychain on iOS.
 *   NEVER AsyncStorage: that is unencrypted plaintext on the device, readable
 *   by anyone with a rooted phone or a backup - and a driver's phone is exactly
 *   the device most likely to be lost or shared around a depot.
 *
 * Web (Expo web, used for development only)
 *   Nothing is STORED: the refresh token is held in this module's memory only,
 *   the same lifetime as the access token beside it. The session does not
 *   survive a reload - the driver signs in again - but it does survive the
 *   access token's 15-minute expiry. Before E2E-D1 web kept nothing, so a
 *   driver was signed out 15 minutes after sign-in, mid-trip: GPS and the
 *   heartbeat stopped and the emergency stop control was out of reach.
 *
 *   The backend's HttpOnly refresh cookie is deliberately NOT used here. Both
 *   apps talk to the same API host in development, so a shared cookie jar let
 *   the driver app adopt the manager's session (the 403 from /api/driver/me
 *   caught it, but it should not have been possible). The driver app therefore
 *   sends credentials: 'omit' and supplies its token explicitly.
 *
 *   localStorage is not an option either: it outlives the tab, and anything
 *   JavaScript can read, an XSS payload can read. Module memory is no more
 *   exposed than the access token already held in memory, and dies with it.
 *
 * The access token is never persisted anywhere. It lives in memory in
 * AuthProvider and dies with the process, which is the point of a 15-minute
 * token.
 */

import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const REFRESH_KEY = 'ner_driver_refresh'

/** True when the platform gives us encrypted storage worth using. */
export const hasSecureStorage = Platform.OS !== 'web'

/** Web only: the refresh token for this tab's life, never written anywhere. */
let inMemory: string | null = null

export async function saveRefreshToken(token: string): Promise<void> {
  // On web there is deliberately nowhere safe to STORE this - see the module
  // docstring. NOT because the HttpOnly cookie covers it: this client sends
  // `credentials: 'omit'` precisely so it never touches that cookie. It is
  // held in memory, so the session ends at reload and not before.
  if (!hasSecureStorage) {
    inMemory = token
    return
  }
  try {
    await SecureStore.setItemAsync(REFRESH_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    })
  } catch {
    // A device without a usable keystore must not crash the app. The session
    // simply will not survive a restart, which is a degradation, not a fault.
  }
}

export async function loadRefreshToken(): Promise<string | null> {
  if (!hasSecureStorage) return inMemory
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY)
  } catch {
    return null
  }
}

export async function clearRefreshToken(): Promise<void> {
  if (!hasSecureStorage) {
    inMemory = null
    return
  }
  try {
    await SecureStore.deleteItemAsync(REFRESH_KEY)
  } catch {
    // Nothing useful to do; the token is server-revoked on logout regardless.
  }
}
