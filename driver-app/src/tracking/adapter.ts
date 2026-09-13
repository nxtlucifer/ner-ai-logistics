/**
 * The boundary between the tracking engine and the device.
 *
 * This is the ONLY module that imports `expo-location`. Everything above it -
 * the cadence rule, the bounded queue, the backoff, the permission state
 * machine - is ordinary TypeScript that runs anywhere, which is what makes it
 * testable without a simulator, a DOM or a native module.
 *
 * The interface is deliberately narrow: three calls, no Expo types leaking
 * through. A test substitutes an adapter that hands over whatever fixes the
 * case needs; nothing else about the engine changes, so the logic under test is
 * the real logic and only the sensor is stood in for.
 */

import * as Location from 'expo-location'
import { Platform } from 'react-native'

export type PermissionOutcome = 'granted' | 'denied' | 'unavailable'

export { GPS_GRADE_ACCURACY_M, sourceOf, type LocationSource } from './source'

/** One position, already reduced to what the engine cares about. */
export interface Sample {
  lat: number
  lon: number
  /** Milliseconds since the epoch, from the device clock. */
  timestamp: number
  altitudeM: number | null
  /** Metres per second, as the platform reports it. */
  speedMs: number | null
  headingDeg: number | null
  accuracyM: number | null
  isMock: boolean
}

export interface WatchOptions {
  /** Android honours this natively; the engine enforces it on every platform. */
  intervalSeconds: number
}

export interface Subscription {
  remove(): void
}

export interface LocationAdapter {
  /** Whether location services are switched on at all. */
  hasServicesEnabled(): Promise<boolean>
  requestPermission(): Promise<PermissionOutcome>
  /**
   * The platform's cached last fix, or null. Shown AS last-known (aged by its
   * own timestamp) until a fresh fix arrives - never uploaded as new
   * telemetry, never drawn as live.
   */
  lastKnown?(): Promise<Sample | null>
  watch(
    options: WatchOptions,
    onSample: (sample: Sample) => void,
    onError: (message: string) => void,
  ): Promise<Subscription>
}

function toSample(raw: Location.LocationObject): Sample {
  const { coords, timestamp } = raw
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    timestamp,
    altitudeM: coords.altitude ?? null,
    speedMs: coords.speed ?? null,
    headingDeg: coords.heading ?? null,
    accuracyM: coords.accuracy ?? null,
    // Android only; absent elsewhere.
    isMock: Boolean(
      (raw as Location.LocationObject & { mocked?: boolean }).mocked,
    ),
  }
}

/**
 * Compass heading, degrees clockwise from true north, for the map marker
 * while the truck is not moving (a GPS course needs motion). Not on web.
 * Returns the unsubscribe. Emits null when the platform has no compass.
 */
export function watchCompass(onHeading: (deg: number | null) => void): () => void {
  if (Platform.OS === 'web') return () => {}
  let sub: Location.LocationSubscription | null = null
  let alive = true
  Location.watchHeadingAsync((h) => {
    if (alive) onHeading(h.trueHeading >= 0 ? h.trueHeading : h.magHeading >= 0 ? h.magHeading : null)
  })
    .then((s) => { if (alive) sub = s; else s.remove() })
    .catch(() => onHeading(null))
  return () => { alive = false; sub?.remove() }
}

export const expoLocationAdapter: LocationAdapter = {
  async hasServicesEnabled() {
    return Location.hasServicesEnabledAsync()
  },

  async requestPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync()
    return status === 'granted' ? 'granted' : 'denied'
  },

  async lastKnown() {
    if (Platform.OS === 'web') return null
    try {
      const raw = await Location.getLastKnownPositionAsync({ maxAge: 6 * 60 * 60 * 1000 })
      return raw ? toSample(raw) : null
    } catch {
      return null
    }
  },

  async watch(options, onSample, onError) {
    return Location.watchPositionAsync(
      {
        // High = the fused provider prefers satellites and falls back to
        // Wi-Fi/cell by itself when it has none. Balanced asked for
        // block-level accuracy, which on Android rarely lights the GPS at all.
        accuracy: Location.Accuracy.High,
        // ANDROID ONLY in SDK 57. Passed so Android can avoid waking the radio,
        // but never relied on: on iOS and web the callback fires as fast as the
        // platform delivers, so the engine applies the cadence itself.
        timeInterval: options.intervalSeconds * 1000,
        distanceInterval: 0,
      },
      (raw) => onSample(toSample(raw)),
      // Third argument, SDK 57: errors raised AFTER the watch starts - location
      // switched off mid-trip, permission revoked from settings. Without it
      // those are silent and the screen keeps claiming tracking is active.
      (message) => onError(message || 'Location stopped unexpectedly.'),
    )
  },
}
