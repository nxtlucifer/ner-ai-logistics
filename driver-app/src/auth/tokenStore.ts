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
 *   Nothing is stored, and the session does not survive a reload - the driver
 *   signs in again.
 *
 *   The backend's HttpOnly refresh cookie is deliberately NOT used here. Both
 *   apps talk to the same API host in development, so a shared cookie jar let
 *   the driver app adopt the manager's session (the 403 from /api/driver/me
 *   caught it, but it should not have been possible). The driver app therefore
 *   sends credentials: 'omit' and supplies its token explicitly.
 *
 *   localStorage is not an option either: anything JavaScript can read, an XSS
 *   payload can read.
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

export async function saveRefreshToken(token: string): Promise<void> {
  if (!hasSecureStorage) return // the HttpOnly cookie is doing this job
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
  if (!hasSecureStorage) return null
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY)
  } catch {
    return null
  }
}

export async function clearRefreshToken(): Promise<void> {
  if (!hasSecureStorage) return
  try {
    await SecureStore.deleteItemAsync(REFRESH_KEY)
  } catch {
    // Nothing useful to do; the token is server-revoked on logout regardless.
  }
}
