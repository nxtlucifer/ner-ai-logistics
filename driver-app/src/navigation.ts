/**
 * Which tabs exist, and in what order.
 *
 * Separate from `App.tsx` because `App.tsx` imports react-native and this
 * build has no renderer in its test setup, so anything worth asserting has to
 * live somewhere importable on its own.
 *
 * HISTORICAL NOTE (DRV-002)
 *
 * This module briefly carried a `KEEPS_RUNNING` list pinning `trip` as
 * never-unmountable, because `useLocationTracking` lived inside `TripScreen`
 * and unmounting it stopped the GPS watch. That was a mitigation, not a fix.
 * The tracker now lives in `src/trip/TripProvider.tsx`, above the navigation,
 * so no tab is special any more and every screen is free to unmount. The list
 * and its tests were deleted with the problem they described.
 */

export type Tab = 'navigate' | 'trip' | 'safety' | 'ai'

/** Left to right, as rendered in the bottom navigation bar. */
export const TABS: readonly Tab[] = [
  'navigate',
  'trip',
  'safety',
  'ai',
] as const

export const TAB_LABELS: Record<Tab, string> = {
  navigate: 'Navigate',
  trip: 'Trip',
  safety: 'Safety',
  ai: 'AI Assistant',
}

/*
 * TAB_ICONS was a Record<Tab, string> of emoji - 🧭 📋 🛡️ 🤖 - rendered inside a
 * <Text> in the tab bar. It is gone rather than merely unused: an emoji glyph
 * is drawn by whatever font the device ships and carries its own palette, so
 * the primary navigation changed shape between Android versions and an active
 * tab could not tint its own icon. The tab bar now draws them from geometry
 * instead; see `TabIcon` in App.tsx and src/components/icons.tsx.
 */

