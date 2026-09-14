/**
 * Picking a trip endpoint: an address, a coordinate, and the link between them.
 *
 * THE DEFECT THIS REPLACES
 *
 * Planning a trip meant typing an address into one box and a latitude and a
 * longitude into two others, pre-filled with a depot's numbers. Nothing tied
 * them together. The default coordinates were correct exactly once - for the
 * depot - and every trip planned after changing only the address text shipped a
 * route to the wrong place, confidently, with the right words on the screen.
 *
 * So a coordinate here always has a PROVENANCE, and the provenance is shown:
 *
 *   GOOGLE  the manager picked a suggestion; address and coordinate came back
 *           from the same lookup and cannot disagree
 *   MAP     the manager dropped a pin; the address is their own words for it
 *   MANUAL  the manager typed numbers, under Advanced, having chosen to
 *
 * and `null` - no coordinate established - is a state the planner refuses to
 * submit rather than filling in.
 *
 * WHY EDITING THE TEXT CLEARS THE COORDINATE
 *
 * For every source. The address text and the routed point must never diverge
 * silently: once a location is confirmed, editing the words drops the
 * coordinate and the manager reconfirms it (a suggestion, the pin, a link).
 * The last dropped pin is remembered so "Choose on map" reopens where it was.
 *
 * GOOGLE'S RESULTS ARE NOT PUT ON THIS MAP
 *
 * Places results may only be displayed on a Google map. The picker below is
 * MapLibre over OpenStreetMap, and it never renders a Google suggestion - it
 * only ever shows a pin the manager placed themselves, which is their own
 * input. The two sources stay separate, which is also why the confirmed-value
 * strip names which one produced the number on screen.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, Marker } from 'maplibre-gl'

import { ApiError, api, type AddressSuggestion } from '../api/client'
import { parseGoogleMapsUrl } from '../utils/googleMapsUrl'
import { NER_CENTRE, NER_ZOOM, OSM_STYLE } from './FleetMap'

export type CoordinateSource = 'GOOGLE' | 'MAP' | 'GOOGLE_MAPS_LINK' | 'MANUAL'

export interface EndpointValue {
  address: string
  /** Kept as strings: a half-typed "26." is a legitimate editing state. */
  lat: string
  lon: string
  /** Null means no coordinate has been established. Not a default. */
  source: CoordinateSource | null
  /** Provider attribution, where the provider requires one. */
  attribution: string | null
}

export const EMPTY_ENDPOINT: EndpointValue = {
  address: '',
  lat: '',
  lon: '',
  source: null,
  attribution: null,
}

/** Debounce. Long enough that a typist does not bill a request per keystroke. */
/** A Google Maps host in the address box: full links, share links, ?q= links. */
const MAPS_LINK = /^(https?:\/\/)?(([a-z0-9-]+\.)*google\.[a-z]{2,}(\.[a-z]{2,})?\/(maps\b|\?)|maps\.app\.goo\.gl\/|goo\.gl\/|g\.co\/)/i

const DEBOUNCE_MS = 700 // a pause, not a keystroke: the open geocoder is not an autocomplete service

/** Google's own minimum for this feature, and a cost floor. */
const MIN_QUERY = 3

/**
 * A session token, as Google's billing expects.
 *
 * One token spans the keystrokes of a single search and the details call that
 * ends it; a new one starts when the manager begins a new search. Generated
 * client-side because only the client knows where a session begins and ends.
 * `crypto.randomUUID` is in every browser this app supports.
 */
function newSessionToken(): string {
  return crypto.randomUUID()
}

type SearchState =
  | { kind: 'IDLE' }
  | { kind: 'LOADING' }
  | { kind: 'RESULTS'; suggestions: AddressSuggestion[]; provider: string | null }
  | { kind: 'EMPTY' }
  /** No provider configured on the server. A setup step, not a failure. */
  | { kind: 'UNCONFIGURED' }
  /** Configured and refusing: quota, a disabled API, a rejected key. */
  | { kind: 'PROVIDER_ERROR'; detail: string }

export interface AddressPickerProps {
  label: string
  name: string
  value: EndpointValue
  onChange: (next: EndpointValue) => void
  placeholder?: string
}

export default function AddressPicker({
  label,
  name,
  value,
  onChange,
  placeholder,
}: AddressPickerProps) {
  const listId = useId()
  const [search, setSearch] = useState<SearchState>({ kind: 'IDLE' })
  const [highlighted, setHighlighted] = useState(-1)
  // A geocoder that hangs must not leave the manager staring at "Searching…":
  // after eight seconds the copy points at the paths that do not need it.
  const [slowSearch, setSlowSearch] = useState(false)
  useEffect(() => {
    setSlowSearch(false)
    if (search.kind !== 'LOADING') return
    const t = setTimeout(() => setSlowSearch(true), 8_000)
    return () => clearTimeout(t)
  }, [search.kind])
  const [pickingOnMap, setPickingOnMap] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const session = useRef(newSessionToken())
  // Monotonic request id. A slow response for "guw" must not overwrite the
  // results for "guwahati" typed after it - the classic autocomplete race, and
  // the reason abort alone is not enough: an aborted request can still resolve.
  const issued = useRef(0)
  const inFlight = useRef<AbortController | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPending = useCallback(() => {
    // Invalidate before aborting: providers may resolve even after cancellation,
    // and details requests do not expose an AbortSignal in the API client.
    ++issued.current
    inFlight.current?.abort()
    inFlight.current = null
    if (debounce.current !== null) clearTimeout(debounce.current)
    debounce.current = null
  }, [])

  const dismissSearch = useCallback(() => {
    cancelPending()
    setSearch({ kind: 'IDLE' })
    setHighlighted(-1)
  }, [cancelPending])

  const changeEndpoint = (next: EndpointValue) => {
    dismissSearch()
    onChange(next)
  }

  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [resolvingLink, setResolvingLink] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  const handleResolveLink = useCallback(
    async (urlToResolve: string) => {
      const trimmed = urlToResolve.trim()
      if (!trimmed) return

      setLinkError(null)
      setResolvingLink(true)

      // 1. Direct local parse
      const direct = parseGoogleMapsUrl(trimmed)
      if (direct) {
        changeEndpoint({
          address: direct.label
            ? direct.label
            : `Google Maps Pin (${direct.lat.toFixed(5)}, ${direct.lon.toFixed(5)})`,
          lat: String(direct.lat),
          lon: String(direct.lon),
          source: 'GOOGLE_MAPS_LINK',
          attribution: 'Google Maps',
        })
        setResolvingLink(false)
        setLinkInputOpen(false)
        setLinkText('')
        return
      }

      // 2. Resolve via hosted SSRF-protected edge function
      try {
        const resolved = await api.resolveMapLink(trimmed)
        changeEndpoint({
          address: resolved.label
            ? resolved.label
            : `Google Maps Pin (${resolved.latitude.toFixed(5)}, ${resolved.longitude.toFixed(5)})`,
          lat: String(resolved.latitude),
          lon: String(resolved.longitude),
          source: 'GOOGLE_MAPS_LINK',
          attribution: resolved.attribution ?? 'Google Maps',
        })
        setResolvingLink(false)
        setLinkInputOpen(false)
        setLinkText('')
      } catch (err: any) {
        setResolvingLink(false)
        setLinkError(
          err?.message ||
            'Could not extract coordinates from this link. Verify the URL or pick on map.',
        )
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onChange, dismissSearch],
  )

  const query = value.address.trim()
  // The last pin the manager dropped, so re-opening the map after an edit
  // starts where they were instead of at the region centre.
  const lastPin = useRef<[number, number] | null>(null)
  const hasCoordinate =
    value.lat.trim() !== '' && value.lon.trim() !== '' &&
    Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lon)) &&
    Math.abs(Number(value.lat)) <= 90 && Math.abs(Number(value.lon)) <= 180

  // The parent may swap/reset endpoints without an input event. Invalidate at
  // commit, before a delayed details response can write the old endpoint back.
  useLayoutEffect(() => {
    dismissSearch()
    return cancelPending
  }, [value.address, value.lat, value.lon, value.source, value.attribution, dismissSearch, cancelPending])

  useEffect(() => {
    cancelPending()
    const id = issued.current
    if (query.length < MIN_QUERY || pickingOnMap) return
    // A pasted Maps link is not an address to search for.
    if (value.source === null && MAPS_LINK.test(query)) {
      setSearch({ kind: 'IDLE' })
      void handleResolveLink(query)
      return
    }
    // A confirmed selection is not a search term. Without this, choosing a
    // suggestion immediately re-searches for its own full address and reopens
    // the list under the manager's cursor.
    if (value.source === 'GOOGLE') {
      setSearch({ kind: 'IDLE' })
      return
    }

    debounce.current = setTimeout(() => {
      debounce.current = null
      const controller = new AbortController()
      inFlight.current = controller
      setSearch({ kind: 'LOADING' })

      api
        .addressSuggestions(query, session.current, controller.signal)
        .then((result) => {
          if (id !== issued.current) return // A newer keystroke won.
          if (!result.available) return setSearch({ kind: 'UNCONFIGURED' })
          if (result.error)
            return setSearch({ kind: 'PROVIDER_ERROR', detail: result.error })
          setSearch(
            result.suggestions.length === 0
              ? { kind: 'EMPTY' }
              : { kind: 'RESULTS', suggestions: result.suggestions, provider: result.provider },
          )
        })
        .catch((error: unknown) => {
          if (id !== issued.current) return
          if (error instanceof DOMException && error.name === 'AbortError') return
          setSearch({
            kind: 'PROVIDER_ERROR',
            detail:
              error instanceof ApiError
                ? error.message
                : 'Address search could not be reached.',
          })
        })
    }, DEBOUNCE_MS)

    return cancelPending
  }, [query, value.source, pickingOnMap, cancelPending, handleResolveLink])

  const choose = useCallback(
    async (suggestion: AddressSuggestion) => {
      cancelPending()
      const id = issued.current
      const selectedSession = session.current
      // A details request terminates the search session even if the manager
      // starts editing again before its response arrives.
      session.current = newSessionToken()
      setSearch({ kind: 'LOADING' })
      setHighlighted(-1)
      try {
        const resolved = await api.resolveAddress(
          suggestion.place_id,
          selectedSession,
        )
        if (id !== issued.current) return
        onChange({
          address: resolved.address,
          lat: String(resolved.lat),
          lon: String(resolved.lon),
          source: 'GOOGLE',
          attribution: resolved.attribution,
        })
        setSearch({ kind: 'IDLE' })
        setHighlighted(-1)
      } catch (error) {
        if (id !== issued.current) return
        setSearch({
          kind: 'PROVIDER_ERROR',
          detail:
            error instanceof ApiError
              ? error.message
              : 'That address could not be resolved.',
        })
      }
    },
    [onChange, cancelPending],
  )

  const suggestions =
    search.kind === 'RESULTS' ? search.suggestions : ([] as AddressSuggestion[])

  return (
    <div className="space-y-1">
      <label className="block">
        <span className="text-xs font-medium text-ink">
          {label}
          <span className="ml-0.5 text-danger">*</span>
        </span>
        <input
          name={name}
          value={value.address}
          placeholder={placeholder ?? 'Search address or paste Maps link'}
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          onChange={(e) =>
            // Editing the text after ANY confirmed location invalidates the
            // coordinate: the words and the point must never diverge silently.
            // The manager reconfirms (suggestion, pin, link) to make it valid again.
            changeEndpoint(
              value.source !== null
                ? { ...EMPTY_ENDPOINT, address: e.target.value }
                : { ...value, address: e.target.value },
            )
          }
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              dismissSearch()
              return
            }
            if (suggestions.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlighted((i) => (i + 1) % suggestions.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlighted(
                (i) => (i - 1 + suggestions.length) % suggestions.length,
              )
            } else if (e.key === 'Enter' && highlighted >= 0 && suggestions[highlighted]) {
              e.preventDefault()
              void choose(suggestions[highlighted])
            }
          }}
          className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-route focus:ring-1 focus:ring-route"
        />
      </label>

      {search.kind === 'LOADING' ? (
        <p className="text-xs text-muted">
          {slowSearch ? 'Address search is taking longer than usual — Choose on map or paste a Maps link works too.' : 'Searching…'}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="max-h-56 overflow-y-auto rounded-[var(--radius-control)] border border-outline bg-surface"
        >
          {suggestions.map((s, i) => (
            <li key={s.place_id}>
              <button
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={i === highlighted}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => void choose(s)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  i === highlighted ? 'bg-soft' : ''
                }`}
              >
                <span className="block text-ink">{s.primary_text}</span>
                {s.secondary_text ? (
                  <span className="block text-xs text-muted">
                    {s.secondary_text}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
          <li className="border-t border-line px-3 py-1 text-[11px] text-muted">
            {search.kind === 'RESULTS' && search.provider === 'NOMINATIM' ? '© OpenStreetMap contributors · India, Nepal, Bhutan, Bangladesh, Myanmar' : 'Powered by Google'}
          </li>
        </ul>
      ) : null}

      {search.kind === 'EMPTY' ? (
        <p className="text-xs text-muted">
          No matching address. Try fewer words, or choose the point on the map.
        </p>
      ) : null}

      {search.kind === 'UNCONFIGURED' ? (
        <p className="text-xs text-warning">
          Address search is not configured on this server, so there are no
          suggestions to show. Use <strong>Choose on map</strong> below — it
          gives the same coordinate.
        </p>
      ) : null}

      {search.kind === 'PROVIDER_ERROR' ? (
        <p className="text-xs text-warning">
          Address search is unavailable right now. Use{' '}
          <strong>Choose on map</strong>, or try again.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => {
            dismissSearch()
            setPickingOnMap(true)
          }}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-soft"
        >
          Choose on map
        </button>
        <button
          type="button"
          onClick={() => {
            dismissSearch()
            setLinkInputOpen((v) => !v)
          }}
          aria-expanded={linkInputOpen}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            linkInputOpen
              ? 'border-route bg-route-soft text-route'
              : 'border-line bg-surface text-ink hover:bg-soft'
          }`}
          data-testid={`${name}-paste-link-button`}
        >
          Paste Google Maps link
        </button>
        <button
          type="button"
          onClick={() => {
            dismissSearch()
            setAdvancedOpen((v) => !v)
          }}
          aria-expanded={advancedOpen}
          className="rounded-md px-2 py-1.5 text-xs text-muted hover:text-ink"
        >
          {advancedOpen ? 'Hide advanced' : 'Advanced'}
        </button>
      </div>

      {linkInputOpen ? (
        <div
          className="space-y-2 rounded-md border border-route/25 bg-route-soft p-3"
          data-testid={`${name}-link-panel`}
        >
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-route">
              Paste Google Maps URL or Short Link
            </span>
            <div className="mt-1 flex gap-2">
              <input
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="e.g. https://maps.app.goo.gl/... or https://maps.google.com/?q=..."
                className="flex-1 rounded-[var(--radius-control)] border border-outline bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:border-route focus:ring-1 focus:ring-route"
                data-testid={`${name}-link-input`}
              />
              <button
                type="button"
                disabled={resolvingLink || !linkText.trim()}
                onClick={() => void handleResolveLink(linkText)}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                data-testid={`${name}-resolve-link-button`}
              >
                {resolvingLink ? 'Resolving…' : 'Use Location'}
              </button>
            </div>
          </label>
          {linkError ? (
            <p className="text-xs text-danger">{linkError}</p>
          ) : (
            <p className="text-[11px] text-muted">
              Supports standard map links, short links (maps.app.goo.gl, goo.gl), and coordinates with labels.
            </p>
          )}
        </div>
      ) : null}

      {/* The confirmed value. Present exactly when a coordinate is established,
          absent otherwise - so an unset endpoint looks unset rather than
          looking like a default somebody meant. */}
      {value.source !== null && hasCoordinate ? (
        <p className="text-xs text-ok" data-testid={`${name}-confirmed`}>
          <span className="font-semibold">✓ {value.address.trim() || 'Location set'}</span>
          <span className="ml-1 text-muted">
            · {SOURCE_LABEL[value.source]} · {Number(value.lat).toFixed(5)}, {Number(value.lon).toFixed(5)}
            {value.attribution ? ` (${value.attribution})` : ''}
          </span>
        </p>
      ) : value.source !== null ? (
        <p className="text-xs text-warning">
          Coordinates are incomplete or out of range. Enter latitude from −90 to
          90 and longitude from −180 to 180, or choose the point on the map.
        </p>
      ) : (
        <p className="text-xs text-muted">
          No location set yet. Pick a suggestion or choose the point on the map.
        </p>
      )}

      {advancedOpen ? (
        <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-control)] border border-outline bg-surface/60 p-2">
          <label className="block">
            <span className="text-[11px] font-medium text-muted">
              Latitude
            </span>
            <input
              name={`${name}_lat`}
              value={value.lat}
              onChange={(e) =>
                changeEndpoint({
                  ...value,
                  lat: e.target.value,
                  source: 'MANUAL',
                  attribution: null,
                })
              }
              className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-muted">
              Longitude
            </span>
            <input
              name={`${name}_lon`}
              value={value.lon}
              onChange={(e) =>
                changeEndpoint({
                  ...value,
                  lon: e.target.value,
                  source: 'MANUAL',
                  attribution: null,
                })
              }
              className="mt-1 w-full rounded-[var(--radius-control)] border border-outline bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <p className="col-span-2 text-[11px] text-muted">
            Typed coordinates are not checked against the address above. They go
            to the router exactly as entered.
          </p>
        </div>
      ) : null}

      {pickingOnMap ? (
        <MapPointPicker
          title={label}
          initial={value.source !== null && value.source !== 'GOOGLE' && hasCoordinate ? [Number(value.lon), Number(value.lat)] : lastPin.current}
          onCancel={() => setPickingOnMap(false)}
          onConfirm={([lon, lat]) => {
            lastPin.current = [lon, lat]
            changeEndpoint({
              ...value,
              lat: String(lat),
              lon: String(lon),
              source: 'MAP',
              attribution: '© OpenStreetMap contributors',
            })
            setPickingOnMap(false)
          }}
        />
      ) : null}
    </div>
  )
}

const SOURCE_LABEL: Record<CoordinateSource, string> = {
  GOOGLE: 'From address search',
  MAP: 'Pinned on map',
  GOOGLE_MAPS_LINK: 'From Google Maps link',
  MANUAL: 'Typed by hand',
}

/**
 * Drop a pin and read its coordinate.
 *
 * Deliberately a separate map instance rather than a mode on the fleet map: the
 * fleet map is a live operational view that must not change meaning when
 * somebody opens a planning form, and clicking it already selects a truck.
 */
function MapPointPicker({
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
      style: OSM_STYLE,
      center: initial ?? NER_CENTRE,
      zoom: initial ? 12 : NER_ZOOM,
      attributionControl: { compact: true },
    })
    const marker = new Marker({ color: '#34d399', draggable: true })
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
        } else if (event.key === 'Tab') {
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">
            Choose {title.toLowerCase()}
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-sm text-muted hover:text-ink"
          >
            Close
          </button>
        </div>
        <div ref={container} className="h-[55vh] min-h-[280px] w-full" />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          <p className="text-xs text-muted">
            {point
              ? `${point[1].toFixed(5)}, ${point[0].toFixed(5)} — drag the pin to adjust.`
              : 'Click the map to place the pin.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-soft"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={point === null}
              title={point === null ? 'Click the map to place the pin first' : 'Use this pin as the location'}
              onClick={() => point && onConfirm(point)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Use this point
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
