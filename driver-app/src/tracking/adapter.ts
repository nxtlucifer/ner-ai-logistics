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

export type PermissionOutcome = 'granted' | 'denied' | 'unavailable'

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

export const expoLocationAdapter: LocationAdapter = {
  async hasServicesEnabled() {
    return Location.hasServicesEnabledAsync()
  },

  async requestPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync()
    return status === 'granted' ? 'granted' : 'denied'
  },

  async watch(options, onSample, onError) {
    return Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
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
