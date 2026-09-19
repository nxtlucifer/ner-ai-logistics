/**
 * The roadside-services toggles. One category at a time: four at once is
 * hundreds of pins over a corridor a dispatcher is trying to read, and the
 * question is always "where is the nearest X".
 *
 * Its own module, with no MapLibre import, so a page can put the chips in its
 * map card header without pulling the map library into the entry chunk
 * (FleetMap.worker.build.test.ts).
 */

import type { PlaceCategory } from '../api/client'

/** What the snapshot holds. Order is operational: fuel first, because it
 *  is the one a truck runs out of. */
export const PLACE_CATEGORIES: { value: PlaceCategory; label: string; glyph: string }[] = [
  { value: 'FUEL', label: 'Fuel', glyph: '⛽' },
  { value: 'EMERGENCY', label: 'Hospital, police, fire', glyph: '✚' },
  { value: 'TYRES', label: 'Tyres and repair', glyph: '⛭' },
  { value: 'REST', label: 'Rest areas', glyph: '⏸' },
  { value: 'HOTEL', label: 'Hotels', glyph: '⌂' },
]

export function PoiChips({
  value,
  onChange,
  className = '',
}: {
  value: PlaceCategory | null
  onChange: (next: PlaceCategory | null) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} role="group" aria-label="Roadside services">
      {PLACE_CATEGORIES.map((c) => (
        <button
          key={c.value}
          type="button"
          aria-pressed={value === c.value}
          onClick={() => onChange(value === c.value ? null : c.value)}
          // px-2.5: all five fit beside the card title at 1366 wide, so the map does not drop a row.
          className={`min-h-8 rounded-full border px-2.5 text-[12px] font-semibold transition-colors ${
            value === c.value
              ? 'border-primary bg-primary text-on-primary'
              : 'border-line bg-surface text-ink hover:bg-soft'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
