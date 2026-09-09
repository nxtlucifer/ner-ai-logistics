/**
 * The one place the app decides where unsent GPS lives between launches.
 *
 * `LocationTracker` deliberately knows nothing about platform storage - it
 * takes a `QueueStore` and is happy without one. That flexibility is also how
 * DRV-001 happened: `useLocationTracking` never passed a store, so every build
 * ran on `MemoryQueueStore` and threw away the queue whenever Android reclaimed
 * the process. A driver crossing a dead zone on NH-27 lost the whole gap.
 *
 * AsyncStorage is used directly because it already IS the `KeyValueStore`
 * shape - `getItem`/`setItem`/`removeItem`, all promise-returning - so there is
 * no adapter to get wrong, and it is backed by SQLite on Android and by
 * localStorage on web, which keeps the Expo Web build honest about persistence
 * rather than quietly degrading.
 *
 * Not used for the auth refresh token: that stays in expo-secure-store. This
 * store holds positions, which are not a credential.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

import { PersistentQueueStore, type QueueStore } from './queueStore'

/**
 * The queue store the running app should use.
 *
 * A function rather than a module-level constant so tests can construct one
 * per case, and so importing this module has no side effect on storage.
 */
export function createQueueStore(): QueueStore {
  return new PersistentQueueStore(AsyncStorage)
}
