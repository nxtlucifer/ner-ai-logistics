/**
 * The eight North-Eastern states, drawn from real boundaries.
 *
 * The outlines are the Survey of India OVSF/1M/7 state boundaries, as the
 * supplied vector `geo/RASTA_NER_8_STATES_SoI.svg`, turned into
 * `northEastStates.ts` by `geo/build_ner_map.py` (simplified below a fifth of
 * a pixel, never redrawn or moved). It is bundled, so the public sign-in page
 * draws at once with no request; the backend stays the authority on scope.
 *
 * It is decoration with one job: showing WHICH scope a person has picked.
 * It is `aria-hidden`, and the selection is announced in text beside it, so a
 * screen reader is never asked to read a picture. No district geometry is
 * drawn, so nothing is pinned: a chosen district is named in a callout hung
 * from its STATE's label, which claims no more than the state.
 */

import { NER_STATES, NER_VIEW } from './northEastStates'

/** Where each label's callout hangs. Default: centred under the label.
 *  `below` with an edge: from `x`, extending left or right. `right`: beside
 *  the label, from `x`, centred on `y` - for Assam, whose label sits above
 *  Meghalaya's, and Sikkim, whose label is on the open canvas below it. */
type Tip = { side: 'below'; x: number; align: 'left' | 'right' } | { side: 'right'; x: number; y: number }
const PLACEMENT: Record<string, { outside?: true; tip?: Tip; label?: [number, number] }> = {
  // Too small to carry its name: the label sits on the open canvas just
  // below it (the label moves, never the shape).
  Sikkim: { outside: true, label: [165, 318], tip: { side: 'right', x: 205, y: 310 } },
  Assam: { tip: { side: 'right', x: 445, y: 381 } },
  // Hangs left, over the open ground west of Tripura, clear of Mizoram.
  Tripura: { tip: { side: 'below', x: 525, align: 'right' } },
}
const STATES = NER_STATES.map((s) => ({ ...s, ...PLACEMENT[s.name] }))

const VIEW = NER_VIEW
const pct = (x: number, y: number) => ({
  left: `${((x - VIEW.x) / VIEW.w) * 100}%`,
  top: `${((y - VIEW.y) / VIEW.h) * 100}%`,
})
/**
 * `all`     every state is in scope (North-East).
 * `account` the account decides at sign-in (My own console): hatched, because
 *           the console does not know which yet.
 * a name    that one state (State, or District within it).
 * null      nothing chosen yet.
 */
export type MapHighlight = 'all' | 'account' | string | null

export function NorthEastMap({
  highlight,
  callout,
  className = '',
}: {
  highlight: MapHighlight
  /** Text under the chosen state's label (or, for `all` / `account`, in the
   *  open ground between Tripura and Mizoram, hanging left so that at any
   *  size it covers no state). */
  callout?: string | null
  className?: string
}) {
  const picked = STATES.find((s) => s.name === highlight) ?? null
  // Every state at once has its own token (--region-all); in Dark both are a
  // neutral fill and the choice is the accent outline drawn below.
  const fill = highlight === 'all' ? 'var(--region-all)' : 'var(--region-selected)'
  const ink = highlight === 'all' ? 'var(--on-region-all)' : 'var(--on-region-selected)'
  const tip = picked?.tip
  // Under the label's baseline (Arunachal's is two lines) or beside it, so
  // the callout reads as attached to the name, with a notch pointing at it.
  const underY = picked ? picked.label[1] + (picked.name === 'Arunachal Pradesh' ? 26 : 0) + 12 : 0
  const place = !picked
    ? { box: pct(430, 600), shift: 'mt-[5px] -translate-x-full', notch: null }
    : tip?.side === 'right'
      ? { box: pct(tip.x, tip.y), shift: 'ml-[7px] -translate-y-1/2', notch: { at: pct(tip.x, tip.y), shift: 'ml-[7px]' } }
      : {
          box: pct(tip?.x ?? picked.label[0], underY),
          shift: `mt-[5px] ${!tip ? '-translate-x-1/2' : tip.align === 'right' ? '-translate-x-full' : ''}`,
          notch: { at: pct(picked.label[0], underY), shift: 'mt-[5px]' },
        }
  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
        className="block h-auto w-full"
        // Never stretched: the geography keeps its proportions in any box.
        preserveAspectRatio="xMidYMid meet"
        data-testid="ner-map"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          {/* Relief: fractal noise lit from the north-west, laid over each
              fill. Shaded hills rather than a flat plane, in either theme -
              it only modulates whatever fill the token gives. */}
          <filter id="ner-relief" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="4" seed="11" result="noise" />
            <feDiffuseLighting in="noise" surfaceScale="3" result="lit">
              <feDistantLight azimuth="235" elevation="32" />
            </feDiffuseLighting>
            <feComposite in="lit" in2="SourceAlpha" operator="in" result="relief" />
            <feBlend in="relief" in2="SourceGraphic" mode="soft-light" />
          </filter>
          <pattern id="ner-hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="14" height="14" style={{ fill: 'var(--region-fill)' }} />
            <rect width="4" height="14" style={{ fill: 'var(--region-selected)' }} opacity="0.45" />
          </pattern>
        </defs>
        <g filter="url(#ner-relief)">
          {STATES.map((state) => {
            const on = highlight === 'all' || highlight === state.name
            return (
              <path
                key={state.name}
                d={state.d}
                data-state={state.name}
                // `style`, not the fill attribute: an attribute cannot hold var().
                style={{
                  fill: on ? fill : highlight === 'account' ? 'url(#ner-hatch)' : 'var(--region-fill)',
                  stroke: 'var(--bg)',
                  transition: 'fill 220ms ease',
                }}
                strokeWidth="3"
                strokeLinejoin="round"
              />
            )
          })}
        </g>
        {/* The choice's outline, over the fills so a neighbour's gap stroke
            does not cut it. Transparent in Light; the accent in Dark (DK-1). */}
        {STATES.filter((state) => highlight === 'all' || highlight === state.name).map((state) => (
          <path
            key={state.name}
            data-edge=""
            d={state.d}
            style={{ fill: 'none', stroke: 'var(--region-edge)' }}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
        ))}
        {STATES.map((state) => {
          const on = (highlight === 'all' || highlight === state.name) && !state.outside
          return (
            <text
              key={state.name}
              x={state.label[0]}
              y={state.label[1]}
              textAnchor="middle"
              fontSize="24"
              fontWeight="600"
              // A halo in the colour underneath, so the part of a label that
              // runs past a narrow state's edge still reads.
              style={{
                fill: on ? ink : 'var(--region-label)',
                stroke: state.outside ? 'none' : on ? fill : highlight === 'account' ? 'var(--region-fill)' : 'none',
                strokeWidth: 6,
                paintOrder: 'stroke',
                strokeLinejoin: 'round',
                transition: 'fill 220ms ease',
              }}
            >
              {state.name === 'Arunachal Pradesh' ? (
                <>
                  <tspan x={state.label[0]} dy="0">
                    Arunachal
                  </tspan>
                  <tspan x={state.label[0]} dy="26">
                    Pradesh
                  </tspan>
                </>
              ) : (
                state.name
              )}
            </text>
          )
        })}
      </svg>
      {/* From sm up: on a phone the drawing is too small to carry it, and
          the caption beside the map already names the highlight. */}
      {callout ? (
        <>
          <span
            aria-hidden="true"
            style={place.box}
            className={`absolute hidden whitespace-nowrap sm:block ${place.shift} rounded-[6px] bg-surface-raised px-3 py-1.5 text-[14px] font-semibold text-ink shadow-[var(--shadow-panel)]`}
          >
            {callout}
          </span>
          {place.notch ? (
            <span
              aria-hidden="true"
              style={place.notch.at}
              className={`absolute hidden size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-surface-raised sm:block ${place.notch.shift}`}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default NorthEastMap
