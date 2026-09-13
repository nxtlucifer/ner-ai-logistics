/**
 * The speed a driver is shown, from the stream of fixes.
 *
 * What this replaces: `Math.round(speedMs * 3.6)`. A receiver sitting on a
 * table reports 0.2-0.4 m/s of Doppler noise and coordinates that wander a few
 * metres per fix, so a phone in a room read "1 km/h". Speed is now a STATE:
 * STATIONARY shows 0, MOVING shows a smoothed value, and switching between
 * them takes consecutive evidence in the new direction - so a parked truck
 * does not flicker 0-1-0-2-0.
 *
 * Evidence for "moving", per fix:
 *   - displacement from the anchor is larger than the positional uncertainty
 *     of BOTH fixes (the two accuracy radii added), or
 *   - the platform reports a speed no receiver produces from noise.
 * The anchor is where the phone came to rest while stationary, and the last
 * fix that carried evidence while moving - so a slow truck keeps counting the
 * metres it covers across several fixes instead of being judged one fix at a
 * time.
 *
 * A fix whose accuracy is missing or worse than `maxAccuracyM` cannot tell 0
 * from 5 km/h; it yields null ("--") and changes no state. So does a fix that
 * implies a speed no truck reaches - a teleport, not a measurement.
 */

import { distanceMetres } from '../map/geo'

export interface SpeedSample {
  lat: number
  lon: number
  accuracyM: number | null
  /** Metres per second as the platform reports it; null/NaN/negative = none. */
  speedMs: number | null
  /** Milliseconds, device clock. */
  at: number
}

// ponytail: fixed knobs, tuned on one OPPO indoors and one drive; make them
// server config beside the tracking cadence if a fleet needs different ones.
export const SPEED = {
  /** Worse than this and a fix cannot support a speed at all. */
  maxAccuracyM: 100,
  /** 1 m/s = 3.6 km/h; Doppler noise on a still receiver stays under 0.5 m/s. */
  credibleMs: 1.0,
  /** Consecutive fixes with evidence before STATIONARY becomes MOVING. */
  toMoving: 2,
  /** Consecutive fixes without evidence before MOVING becomes STATIONARY. */
  toStationary: 3,
  /** Weight of the newest reading in a speed derived from positions (no platform speed). */
  alpha: 0.5,
  /** A fix implying more than this is a jump, not a movement. */
  teleportKmh: 200,
}

const metresBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => distanceMetres([a.lat, a.lon], [b.lat, b.lon])

export class SpeedFilter {
  private anchor: SpeedSample | null = null
  private prev: SpeedSample | null = null
  private streak = 0
  private ema: number | null = null
  private _moving = false

  /** True while the filter has decided the phone is in motion. */
  get moving(): boolean {
    return this._moving
  }

  /** Displayed km/h for this fix: 0 at rest, smoothed in motion, null when the fix cannot say. */
  next(s: SpeedSample): number | null {
    if (s.accuracyM == null || !(s.accuracyM <= SPEED.maxAccuracyM)) return null
    const platform = s.speedMs != null && Number.isFinite(s.speedMs) && s.speedMs >= 0 ? s.speedMs : null
    let derived: number | null = null
    if (this.prev && s.at > this.prev.at) {
      derived = metresBetween(this.prev, s) / ((s.at - this.prev.at) / 1000)
      if (derived * 3.6 > SPEED.teleportKmh) {
        this.prev = s
        return null
      }
    }
    const anchor = this.anchor ?? (this.anchor = s)
    const evidence =
      metresBetween(anchor, s) > (anchor.accuracyM ?? 0) + s.accuracyM ||
      (platform != null && platform >= SPEED.credibleMs)

    if (this._moving) {
      if (evidence) {
        this.streak = 0
        this.anchor = s
      } else if (++this.streak >= SPEED.toStationary) {
        this._moving = false
        this.streak = 0
        this.ema = null
        this.anchor = s
      }
    } else if (evidence) {
      if (++this.streak >= SPEED.toMoving) {
        this._moving = true
        this.streak = 0
        this.anchor = s
      }
    } else {
      this.streak = 0
      // A tighter fix is a better estimate of the resting place.
      if (s.accuracyM < (anchor.accuracyM ?? Infinity)) this.anchor = s
    }
    this.prev = s

    if (!this._moving) return 0
    // The receiver's own speed is already filtered; only a speed derived from
    // two positions needs smoothing. Below the credible floor it is noise: 0.
    if (platform != null) {
      this.ema = platform
      return platform < SPEED.credibleMs ? 0 : Math.round(platform * 3.6)
    }
    if (derived == null) return this.ema == null ? null : Math.round(this.ema * 3.6)
    this.ema = this.ema == null ? derived : SPEED.alpha * derived + (1 - SPEED.alpha) * this.ema
    return Math.round(this.ema * 3.6)
  }
}
