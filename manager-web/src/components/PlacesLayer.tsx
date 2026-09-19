/**
 * Roadside services on the fleet map, as a layer the operator turns on.
 *
 * WHY IT FETCHES BY VIEWPORT AND NOT ONCE
 *
 * The server refuses a box larger than five degrees — deliberately, so no
 * query can ask for the whole region. So the layer asks for what is on
 * screen, and asks again when the operator stops moving the map. Debounced,
 * because a pan is a hundred `moveend`-adjacent events and none of the
 * intermediate ones is a question anybody asked.
 *
 * WHAT IT REFUSES TO SAY
 *
 * Nothing here is a "safe stop", a "guaranteed" anything, or an ETA. A
 * mapped hospital is a hospital on a map. The popup gives the category, the
 * name where one exists, and how old the snapshot is — and stops there.
 */

import { useEffect, useRef, useState } from 'react'
import { Marker, Popup, type Map as MapLibreMap } from 'maplibre-gl'

import { api, type MapPlace, type PlaceCategory } from '../api/client'

import { PLACE_CATEGORIES } from './PoiChips'

// Re-exported: callers and tests have always imported it from here.
export { PLACE_CATEGORIES }

// Theme tokens (index.css --poi-*): fixed data hues, none of them green.
const CATEGORY_COLOUR: Record<string, string> = {
  FUEL: 'var(--poi-fuel)',
  EMERGENCY: 'var(--poi-emergency)',
  TYRES: 'var(--poi-tyres)',
  REST: 'var(--poi-rest)',
  HOTEL: 'var(--poi-hotel)',
}

/** The widest box the server searches, per side (MAX_BBOX_DEGREES in
 *  backend/app/domain/places.py). A wider view is refused with a 422, so the
 *  layer does not ask; it says the server's own words instead. */
const MAX_BBOX_DEGREES = 5
const TOO_WIDE = 'Zoom in to search this area - the map view is too wide.'

export interface PlacesLayerState {
  category: PlaceCategory | null
  places: MapPlace[]
  /** The snapshot's own words about itself. Rendered, never summarised. */
  attribution: string | null
  retrievedAt: string | null
  truncated: boolean
  /** Set when the area was refused or the lookup failed. Shown as-is. */
  notice: string | null
  loading: boolean
}

export const EMPTY_PLACES: PlacesLayerState = {
  category: null,
  places: [],
  attribution: null,
  retrievedAt: null,
  truncated: false,
  notice: null,
  loading: false,
}

/**
 * Keep a set of markers in sync with a category and the current viewport.
 *
 * Returns the layer state so the page can render the source line and any
 * notice next to the toggles rather than inside the map.
 */
export function usePlacesLayer(
  map: MapLibreMap | null,
  category: PlaceCategory | null,
): PlacesLayerState {
  const [state, setState] = useState<PlacesLayerState>(EMPTY_PLACES)
  const markers = useRef<Marker[]>([])

  // Markers are imperative; clearing them is the one thing that must always
  // happen, including on unmount and on every category change.
  const clear = () => {
    markers.current.forEach((m) => m.remove())
    markers.current = []
  }

  useEffect(() => {
    if (!map || !category) {
      clear()
      setState(EMPTY_PLACES)
      return
    }

    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = { current: null as AbortController | null }

    const load = async () => {
      const bounds = map.getBounds()
      controller.current?.abort()
      // Rounded first: the span checked is the span the server would see.
      const box = {
        south: Number(bounds.getSouth().toFixed(4)),
        west: Number(bounds.getWest().toFixed(4)),
        north: Number(bounds.getNorth().toFixed(4)),
        east: Number(bounds.getEast().toFixed(4)),
      }
      if (box.north - box.south > MAX_BBOX_DEGREES || box.east - box.west > MAX_BBOX_DEGREES) {
        clear()
        setState({ ...EMPTY_PLACES, category, notice: TOO_WIDE })
        return
      }
      const ac = new AbortController()
      controller.current = ac
      setState((s) => ({ ...s, category, loading: true }))
      try {
        const answer = await api.placesInArea(category, box, ac.signal)
        if (!live) return
        clear()
        for (const place of answer.places) {
          const dot = document.createElement('span')
          dot.style.cssText =
            `display:grid;place-items:center;width:20px;height:20px;border-radius:50%;` +
            `background:${CATEGORY_COLOUR[place.category] ?? 'var(--poi-tyres)'};color:var(--pin-edge);` +
            `font-size:11px;line-height:1;border:2px solid var(--pin-edge);box-shadow:0 1px 3px var(--pin-shadow)`
          dot.textContent =
            PLACE_CATEGORIES.find((c) => c.value === place.category)?.glyph ?? '•'
          const popup = new Popup({ offset: 14, closeButton: false }).setText(
            // Name where the data has one; the category where it does not.
            // Never an invented label, and never a claim about the place.
            place.name?.trim() || labelFor(place.category),
          )
          markers.current.push(
            new Marker({ element: dot }).setLngLat([place.lon, place.lat]).setPopup(popup).addTo(map),
          )
        }
        setState({
          category,
          places: answer.places,
          attribution: answer.source?.attribution ?? null,
          retrievedAt: answer.source?.retrieved_at ?? null,
          truncated: answer.truncated,
          notice: answer.error,
          loading: false,
        })
      } catch (error) {
        if (!live || ac.signal.aborted) return
        clear()
        setState({
          ...EMPTY_PLACES,
          category,
          // The server's own words. It says "zoom in" for a box that is too
          // wide, which is a next step rather than an error code.
          notice:
            error instanceof Error && error.message
              ? error.message
              : 'Services could not be loaded for this area.',
        })
      }
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 400)
    }

    void load()
    map.on('moveend', schedule)
    return () => {
      live = false
      if (timer) clearTimeout(timer)
      controller.current?.abort()
      map.off('moveend', schedule)
      clear()
    }
  }, [map, category])

  return state
}

export function labelFor(category: string): string {
  return PLACE_CATEGORIES.find((c) => c.value === category)?.label ?? category
}
