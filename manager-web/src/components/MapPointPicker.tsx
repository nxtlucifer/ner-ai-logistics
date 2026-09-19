/**
 * The map half of AddressPicker, in its own module so it can be loaded on
 * demand: it is the only part of the planner that needs MapLibre.
 */

import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, Marker } from 'maplibre-gl'

import { wrapTab } from './focusTrap'
import { NER_CENTRE, NER_ZOOM, themedStyle } from './mapSetup'
import { cssToken } from '../theme'

/**
 * Drop a pin and read its coordinate.
 *
 * Deliberately a separate map instance rather than a mode on the fleet map: the
 * fleet map is a live operational view that must not change meaning when
 * somebody opens a planning form, and clicking it already selects a truck.
 */
export default function MapPointPicker({
  title,
  initial,
  onCancel,
  onConfirm,
}: {
  title: string
  initial: [number, number] | null
  onCancel: () => void
  onConfirm: (point: [number, number]) => void
}) {
  const container = useRef<HTMLDivElement | null>(null)
  const dialog = useRef<HTMLDivElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const [point, setPoint] = useState<[number, number] | null>(initial)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) {
        closeButton.current?.focus()
      }
    }
    document.addEventListener('focusin', keepFocusInside)
    return () => {
      document.removeEventListener('focusin', keepFocusInside)
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus()
      }
    }
  }, [])

  useEffect(() => {
    if (!container.current) return
    const map = new MapLibreMap({
      container: container.current,
      // Painted for the theme it opens in. The picker is modal, so the theme
      // cannot change underneath it.
      style: themedStyle(),
      center: initial ?? NER_CENTRE,
      zoom: initial ? 12 : NER_ZOOM,
      attributionControl: { compact: true },
    })
    // The pin is the manager's own mark: the accent, read from the theme (map
    // paint cannot read a CSS variable). The picker is modal, so it cannot change.
    const marker = new Marker({ color: cssToken('accent') || undefined, draggable: true })
    if (initial) marker.setLngLat(initial).addTo(map)

    map.on('click', (event) => {
      const next: [number, number] = [event.lngLat.lng, event.lngLat.lat]
      marker.setLngLat(next).addTo(map)
      setPoint(next)
    })
    // Dragging is how a pin gets nudged onto the actual gate rather than the
    // road outside it, so the value follows the drag rather than the click.
    marker.on('dragend', () => {
      const at = marker.getLngLat()
      setPoint([at.lng, at.lat])
    })

    return () => {
      marker.remove()
      map.remove()
    }
    // Mount-only: re-creating the map would drop the manager's pan and pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`Choose ${title} on the map`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        } else {
          wrapTab(event)
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-float)]">
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <h2 className="text-base font-bold text-ink">
            Choose {title.toLowerCase()}
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onCancel}
            className="min-h-9 rounded-[var(--radius-control)] px-3 text-sm font-medium text-muted hover:bg-soft hover:text-ink"
          >
            Close
          </button>
        </div>
        <div ref={container} className="mx-5 h-[55vh] min-h-[280px] overflow-hidden rounded-[8px] border border-line" />
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <p className="tnum text-[13px] text-muted">
            {point
              ? `${point[1].toFixed(5)}, ${point[0].toFixed(5)} — drag the pin to adjust.`
              : 'Click the map to place the pin.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-9 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={point === null}
              title={point === null ? 'Click the map to place the pin first' : 'Use this pin as the location'}
              onClick={() => point && onConfirm(point)}
              aria-disabled={point === null || undefined}
              className="min-h-9 rounded-[var(--radius-control)] bg-primary px-3 text-[13px] font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
            >
              Use this point
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
