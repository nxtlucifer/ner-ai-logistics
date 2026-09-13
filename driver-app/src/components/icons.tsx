/**
 * The driver app's icon set: ONE family, Feather (via @expo/vector-icons),
 * 2px stroke on a 24-grid - the same grammar as the Lucide set the manager
 * console uses, so a shield or a truck looks the same in both products.
 *
 * WHY A FONT AND NOT THE VIEW-DRAWN SHAPES THIS REPLACES: eight geometric
 * icons built from borders and rotated squares covered the bottom navigation
 * and the map controls and nothing else. Every new surface (More rows, the
 * truck check, route decisions, empty states) would have meant drawing more
 * geometry by hand, each one slightly different in weight. The font ships
 * with Expo, takes `color` like any Text, and is identical on every device.
 *
 * WHY NOT EMOJI: rendered by whichever font the device ships, at its own
 * baseline, in its own colours. A tinted active tab is impossible with one.
 *
 * The named exports keep the old call sites; `Icon` is the general form.
 */

import { Feather } from '@expo/vector-icons'
import type { ComponentProps } from 'react'

export type IconName = ComponentProps<typeof Feather>['name']

export interface IconProps {
  /** Glyph size in points; the box is square. */
  size?: number
  color: string
}

export function Icon({ name, size = 22, color }: IconProps & { name: IconName }) {
  return <Feather name={name} size={size} color={color} />
}

/* Bottom navigation ------------------------------------------------------ */
export const TripIcon = (p: IconProps) => <Icon name="truck" {...p} />
export const NavigateIcon = (p: IconProps) => <Icon name="navigation" {...p} />
export const SafetyIcon = (p: IconProps) => <Icon name="shield" {...p} />
export const MoreIcon = (p: IconProps) => <Icon name="grid" {...p} />
export const AiIcon = (p: IconProps) => <Icon name="message-circle" {...p} />

/* Map controls ----------------------------------------------------------- */
export const RecenterIcon = (p: IconProps) => <Icon name="crosshair" {...p} />
export const FitRouteIcon = (p: IconProps) => <Icon name="map" {...p} />
export const AudioIcon = ({ muted = false, ...p }: IconProps & { muted?: boolean }) => (
  <Icon name={muted ? 'volume-x' : 'volume-2'} {...p} />
)

/* Route decisions and status - icon + label + colour, never colour alone. */
export const STATUS_ICON: Record<string, IconName> = {
  CONTINUE: 'check-circle',
  CAUTION: 'alert-triangle',
  HOLD: 'pause-circle',
  HOLD_AND_REVIEW: 'pause-circle',
  REROUTE: 'git-branch',
  REROUTE_RECOMMENDED: 'git-branch',
  UNKNOWN: 'help-circle',
  OFFLINE: 'cloud-off',
  STALE: 'clock',
}
