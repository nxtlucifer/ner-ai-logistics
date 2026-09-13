/**
 * Where a fix came from, as far as the platform lets us tell.
 *
 * Android's fused provider blends satellites, Wi-Fi and cell and does not
 * name the source per fix; what it does report honestly is the accuracy.
 * A satellite fix is a few metres; Wi-Fi and cell are tens to hundreds.
 * So GPS means "GPS-grade" - within GPS_GRADE_ACCURACY_M - and NETWORK is
 * everything coarser. The metres are always shown next to the word, so the
 * word never claims more than the number. GPS is never network.
 *
 * Expo-free on purpose: the tracker and its tests import this without a
 * native module in the way.
 */

export type LocationSource = 'GPS' | 'NETWORK'

/** ponytail: calibration knob. Consumer phones report 3-20 m on a satellite
 *  fix; anything past this is Wi-Fi/cell-assisted. Tune on the fleet's phones. */
export const GPS_GRADE_ACCURACY_M = 40

export function sourceOf(accuracyM: number | null): LocationSource {
  return accuracyM !== null && accuracyM <= GPS_GRADE_ACCURACY_M ? 'GPS' : 'NETWORK'
}
