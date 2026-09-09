/**
 * Breaking an observed GPS track where nothing was observed.
 *
 * THE DEFECT THIS FILE EXISTS TO FIX
 *
 * The fleet map drew every fix of a trip as one unbroken LineString. Two
 * consecutive fixes 98.8 km apart, 21.5 seconds apart (a simulator restart,
 * measured on TRP-DEMO1560 on 2026-09-06), therefore rendered as a long,
 * confident, nearly straight line across the Guwahati-Nagaon corridor. It looks
 * exactly like a road the truck drove. Nobody drove it, and no road there is
 * straight.
 *
 * Sparse fixes are not evidence of the road travelled. So the track is split
 * into runs that were actually sampled, and the map draws the runs - never a
 * connector across the hole between them.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not repair, snap, interpolate or drop anything. Every raw observation
 * survives, in order, in exactly one segment. Hiding an off-route excursion by
 * snapping it to the planned corridor would be the same lie in the other
 * direction.
 *
 * THRESHOLDS
 *
 * Mirrored from `backend/app/domain/telemetry_policy.py`, which owns them and
 * explains how they were derived. They are duplicated here rather than fetched
 * because this is a rendering decision about a payload that does not carry
 * them; if that file's numbers change, change these and the test that pins
 * them.
 */

import type { Position } from '../api/client'

/** `LOCATION_STALE_SECONDS`. Past this the server stops calling a trip merely
 *  stale and reports it out of contact - so a line across the hole would assert
 *  a path during a window the system itself says it had no idea about. */
export const TRACK_GAP_SECONDS = 600

/** `IMPLAUSIBLE_SPEED_KMPH`. The same number ingestion flags a fix with. Above
 *  it the pair cannot both be true, and joining them draws the difference. */
export const TRACK_MAX_SPEED_KMPH = 200

/** Why a break was inserted. Rendered in the legend, and asserted by tests. */
export type BreakReason = 'TIME_GAP' | 'IMPLAUSIBLE_SPEED' | 'OUT_OF_ORDER'

export interface TrackSegment {
  /** Oldest-first, at least one point. */
  points: Position[]
  /** What separated this segment from the previous one. Null on the first. */
  brokenBy: BreakReason | null
}

const R = 6_371_000

/** Great-circle metres. Same haversine as the driver app's `geo.ts`. */
function metresBetween(a: Position, b: Position): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.location.lat - a.location.lat)
  const dLon = rad(b.location.lon - a.location.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.location.lat)) *
      Math.cos(rad(b.location.lat)) *
      Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Split a track into the runs that were actually sampled.
 *
 * `points` may arrive in any order and is not mutated. It is sorted oldest
 * first by `recorded_at` - the device clock, which is what says where the truck
 * was when - so a batch that uploaded out of order draws in travel order rather
 * than as a zig-zag.
 *
 * Duplicates (identical timestamp) are a break, not a merge: two fixes claiming
 * the same instant cannot be ordered, and picking one would be a guess.
 */
export function splitTrack(points: readonly Position[]): TrackSegment[] {
  const ordered = [...points].sort(
    (a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at),
  )
  const segments: TrackSegment[] = []
  let current: TrackSegment | null = null

  for (let i = 0; i < ordered.length; i += 1) {
    const point = ordered[i]
    const previous = i > 0 ? ordered[i - 1] : null
    let reason: BreakReason | null = null

    if (previous) {
      const seconds =
        (Date.parse(point.recorded_at) - Date.parse(previous.recorded_at)) / 1000
      if (!(seconds > 0)) {
        reason = 'OUT_OF_ORDER'
      } else if (seconds > TRACK_GAP_SECONDS) {
        reason = 'TIME_GAP'
      } else {
        const kmph = (metresBetween(previous, point) / seconds) * 3.6
        if (kmph > TRACK_MAX_SPEED_KMPH) reason = 'IMPLAUSIBLE_SPEED'
      }
    }

    if (!current || reason) {
      current = { points: [point], brokenBy: reason }
      segments.push(current)
    } else {
      current.points.push(point)
    }
  }

  return segments
}

/** Segments with enough points to be a line. */
export function drawableSegments(segments: TrackSegment[]): TrackSegment[] {
  return segments.filter((s) => s.points.length >= 2)
}

/** A run of exactly one fix is a place the truck was seen, not a path. */
export function isolatedFixes(segments: TrackSegment[]): Position[] {
  return segments.filter((s) => s.points.length === 1).map((s) => s.points[0])
}
