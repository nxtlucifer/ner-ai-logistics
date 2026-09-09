/**
 * The one props contract both map implementations honour.
 *
 * `DriverRouteMap.web.tsx` and `DriverRouteMap.native.tsx` are resolved by
 * Metro's platform extensions, so the native map library is never reachable
 * from a web bundle and MapLibre is never reachable from a native one. Neither
 * file is imported directly anywhere - screens import `./map/DriverRouteMap`
 * and get whichever one the platform resolves.
 *
 * The map owns its own camera and its own controls, because "recenter" and
 * "orientation" are platform gestures and a shared abstraction over them would
 * be a worse version of each. It does NOT own permission, freshness or trip
 * state: those are decisions with consequences beyond the map, and they are
 * made by the screen above it and passed down as facts.
 */

import type { OfflineStop, Place } from '../api/client'
import type { LatLon } from './geo'

/**
 * How much a position marker may be trusted.
 *
 * `LIVE` is a fix the device just took. `LAST_KNOWN` is one it took earlier -
 * drawn differently and labelled with its age, never as a live truck. `null`
 * means no fix at all, and NOTHING is drawn: an invented marker at the depot
 * or at the route start is the one failure this app is built to avoid.
 */
export type PositionKind = 'LIVE' | 'LAST_KNOWN'

export interface DriverRouteMapProps {
  /** Authoritative selected route id; used with geometry for camera identity. */
  routeId?: string | null
  /** Server-projected progress, supplied only while current and on route. */
  progressFraction?: number | null
  /** The authorised corridor, already validated by `validGeometry`. */
  points: readonly LatLon[]
  /** The distinct backup corridor. Drawn only when `showBackup`. */
  backupPoints: readonly LatLon[]
  /**
   * Whether to draw the backup.
   *
   * Default off. The handoff is explicit that alternatives are drawn only when
   * they are being compared on purpose - two lines on a driver's screen with
   * no way to tell which one they are meant to be on is worse than one.
   */
  showBackup: boolean
  stops: readonly OfflineStop[]
  /** A real fix, or null. Never a placeholder. */
  position: LatLon | null
  positionKind: PositionKind | null
  /** Reported GPS accuracy in metres, when the platform gives one. */
  accuracyM: number | null
  /** Age of the device fix, explicitly shown for last-known positions. */
  positionAgeSeconds?: number | null
  /**
   * Roadside services to pin, from the current search. Empty by default.
   *
   * The map does not fetch these and does not know where they came from - it
   * draws what the screen hands it, so the marker layer and the results list
   * are the same array and cannot disagree.
   */
  places?: readonly Place[]
  /** `provider_id` of the pin drawn as selected, if any. */
  selectedPlaceId?: string | null
  /** Tapping a pin selects it; the screen opens the details panel. */
  onSelectPlace?: (place: Place) => void
  /**
   * The map's current visible bounds, reported when the driver stops moving it.
   *
   * "Search this area" needs the area actually on screen; deriving it from the
   * route would search where the driver used to be looking rather than where
   * they are looking now.
   */
  onViewportChange?: (box: {
    south: number
    west: number
    north: number
    east: number
  }) => void
  /** Camera control signals from screen floating buttons. */
  cameraTrigger?: number
  cameraMode?: 'FIT_ROUTE' | 'RECENTER' | null
  /** Test seam: lets a test assert what was drawn without a GL context. */
  testID?: string
}
