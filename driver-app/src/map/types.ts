/**
 * The one props contract both map implementations honour.
 *
 * `DriverRouteMap.web.tsx` and `DriverRouteMap.native.tsx` are resolved by
 * Metro's platform extensions: Leaflet in the DOM on web, Leaflet inside a
 * WebView on the phone. What both draw is built once in `scene.ts`. Neither
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
  /** GPS-grade or network-grade, by reported accuracy (tracking/source.ts). */
  positionSource?: 'GPS' | 'NETWORK' | null
  /** Reported GPS accuracy in metres, when the platform gives one. */
  accuracyM: number | null
  /** Age of the device fix, explicitly shown for last-known positions. */
  positionAgeSeconds?: number | null
  /** Course over ground from the fix, degrees clockwise from north; null or
   *  negative when the platform reported none (a stationary phone has none). */
  headingDeg?: number | null
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
  /**
   * DEM segments for the selected route, from the risk payload. The map
   * paints only HILLY (amber) and STEEP (red) stretches over the blue route -
   * caution and danger in the palette's own words. Flat stays blue: the
   * absence of a hazard is not something to colour.
   */
  terrainSegments?: readonly { start_m: number; end_m: number; terrain_class: string }[]
  /**
   * Recorded landslide positions within the corridor buffer, from the
   * inventory. Only precisely-placed events reach here - a marker on a 50 km
   * guess would be a marker on a guess.
   */
  hazards?: readonly { latitude: number; longitude: number; year: number | null; name: string | null }[]
  /**
   * RASTA fleet traffic per stretch of the route, from the risk payload.
   * Known states are painted as a thin secondary stroke INSIDE the blue
   * route (green normal, amber slow, red congested); UNKNOWN paints nothing,
   * because "no fleet has driven this" is not a colour.
   */
  trafficSegments?: readonly { start_m: number; end_m: number; state: string; observed_kmph: number | null; baseline_kmph: number | null; vehicle_count: number; newest_age_seconds: number | null }[]
  /**
   * MapTiler hillshade over the OSM base - visual terrain context only,
   * never evidence. Drawn only when a key is configured; a dead tile server
   * removes the shading and leaves the map exactly as it was.
   */
  hillshade?: boolean
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
  /** Whether the camera is following the truck right now; the screen's state chip reads it. */
  onFollowChange?: (following: boolean) => void
  /** Test seam: lets a test assert what was drawn without a GL context. */
  testID?: string
}
