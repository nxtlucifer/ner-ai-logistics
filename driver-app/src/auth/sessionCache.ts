/**
 * The last identity and trip the server returned, for a cold launch with no
 * signal (FE-01). Without them an OS kill in a dead zone lands the driver on
 * the login screen and the stored route package is unreachable.
 *
 * AsyncStorage is plaintext, so NOTHING secret goes here - never a token. The
 * refresh token stays in the keystore (tokenStore.ts), the access token in
 * memory. Web keeps no stored session to resume, so nothing is cached there.
 * Cleared on logout and whenever the server refuses the session.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

import type { CurrentTrip } from '../api/client'
import { hasSecureStorage } from './tokenStore'

const IDENTITY_KEY = 'ner.session.identity.v1'
const TRIP_KEY = 'ner.session.trip.v1'

export interface CachedTrip {
  trip: CurrentTrip | null
  /** When the server returned it (device clock) - shown as "last sync". */
  at: number
}

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  if (hasSecureStorage) AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {})
}

export const readCachedIdentity = <T>() => read<T>(IDENTITY_KEY)
export const cacheIdentity = (identity: unknown) => write(IDENTITY_KEY, identity)
export const readCachedTrip = () => read<CachedTrip>(TRIP_KEY)
export const cacheTrip = (trip: CurrentTrip | null, at: number) => write(TRIP_KEY, { trip, at } satisfies CachedTrip)

export function clearSessionCache(): void {
  AsyncStorage.multiRemove([IDENTITY_KEY, TRIP_KEY]).catch(() => {})
}
