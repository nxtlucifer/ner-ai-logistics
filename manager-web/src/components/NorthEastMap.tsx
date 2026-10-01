/**
 * The eight North-Eastern states, as a SCHEMATIC.
 *
 * WHY A SCHEMATIC AND NOT A REAL BOUNDARY
 *
 * This repository holds no licensed state-boundary geometry, and inventing
 * one would be a map that looks authoritative and is not — the same class of
 * claim as printing a district count nobody verified. These outlines are hand
 * traced from approximate border points (shared borders are drawn once, so
 * neighbours meet) and assert nothing beyond the arrangement. Every caller
 * renders the "Schematic" caption below it.
 *
 * It is decoration with one job: showing WHICH scope a person has picked.
 * It is `aria-hidden`, and the selection is announced in text beside it, so a
 * screen reader is never asked to read a picture. There is no district
 * geometry, so nothing is pinned: a chosen district is named in a callout
 * hung from its STATE's label, which claims no more than the state.
 */

/** viewBox units: x = (lon - 87.6) * 101, y = (29.6 - lat) * 101. */
const STATES: {
  name: string
  d: string
  label: [number, number]
  /** The label sits on the canvas beside the shape, not on the fill. */
  outside?: true
  /** Where a district callout hangs from the label. Default: centred under
   *  it. `below` with an edge: from `x` (Tripura, whose centred callout
   *  would cover Mizoram's name). `right`: beside the label, from `x`,
   *  centred on `y` (Assam and Sikkim, where anything under the label
   *  covers the neighbour's name). */
  tip?: { side: 'below'; x: number; align: 'left' | 'right' } | { side: 'right'; x: number; y: number }
}[] = [
  {
    name: 'Sikkim',
    d: 'M42,242 L50,172 L101,149 L126,167 L131,202 L116,227 L96,252 L61,258 Z',
    label: [86, 290],
    outside: true,
    tip: { side: 'right', x: 135, y: 281 },
  },
  {
    name: 'Arunachal Pradesh',
    d: 'M439,268 L485,270 L535,266 L586,256 L636,234 L677,212 L727,200 L768,184 L803,174 L843,200 L818,237 L793,258 L773,273 L778,301 L818,291 L858,268 L894,242 L944,237 L965,202 L939,167 L985,136 L960,91 L909,45 L858,18 L798,30 L737,35 L697,50 L667,86 L626,116 L576,141 L525,165 L475,180 L439,167 L409,170 L399,187 L409,217 L434,247 Z',
    label: [760, 112],
  },
  {
    name: 'Assam',
    d: 'M439,268 L485,270 L535,266 L586,256 L636,234 L677,212 L727,200 L768,184 L803,174 L843,200 L818,237 L793,258 L773,273 L737,288 L702,298 L672,308 L646,323 L631,348 L618,372 L606,389 L591,409 L586,439 L566,460 L556,480 L550,505 L547,525 L525,520 L510,535 L490,530 L473,540 L460,520 L444,513 L460,500 L470,480 L485,462 L505,434 L525,409 L520,379 L490,359 L465,369 L439,359 L414,354 L379,364 L338,369 L293,366 L258,369 L232,374 L227,389 L212,364 L217,333 L227,293 L273,283 L333,278 L394,281 Z',
    label: [330, 326],
    // Level with the label's top, not its middle: on the Overview's small
    // map a callout centred on the label reached down over "Nagaland" (SCHEM-1).
    tip: { side: 'right', x: 380, y: 290 },
  },
  {
    name: 'Meghalaya',
    d: 'M485,462 L505,434 L525,409 L520,379 L490,359 L465,369 L439,359 L414,354 L379,364 L338,369 L293,366 L258,369 L232,374 L227,389 L227,424 L252,444 L303,446 L354,446 L404,449 L444,446 Z',
    label: [362, 414],
  },
  {
    name: 'Nagaland',
    d: 'M773,273 L737,288 L702,298 L672,308 L646,323 L631,348 L618,372 L606,389 L591,409 L586,439 L606,424 L641,409 L677,414 L702,404 L727,412 L752,389 L773,364 L763,333 L778,301 Z',
    label: [690, 374],
  },
  {
    name: 'Manipur',
    d: 'M586,439 L566,460 L556,480 L550,505 L547,525 L566,545 L591,569 L626,561 L656,576 L672,550 L692,520 L712,480 L722,444 L727,412 L702,404 L677,414 L641,409 L606,424 Z',
    label: [636, 500],
  },
  {
    name: 'Mizoram',
    d: 'M473,540 L490,530 L510,535 L525,520 L547,525 L566,545 L591,569 L581,606 L571,646 L561,687 L550,737 L530,763 L505,773 L500,758 L485,717 L475,677 L475,636 L470,594 L470,566 Z',
    label: [526, 652],
  },
  {
    name: 'Tripura',
    d: 'M473,540 L470,566 L470,594 L460,611 L444,626 L429,656 L404,672 L379,646 L359,606 L374,576 L384,556 L419,545 L444,513 L460,520 Z',
    label: [414, 612],
    tip: { side: 'below', x: 452, align: 'right' },
  },
]

/** The drawing's extent, trimmed to the outlines (x 42-985, y 18-773). */
const VIEW = { x: 24, y: 6, w: 976, h: 790 }
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
  const underY = picked ? picked.label[1] + (picked.name === 'Arunachal Pradesh' ? 31 : 0) + 12 : 0
  const place = !picked
    ? { box: pct(468, 694), shift: 'mt-[5px] -translate-x-full', notch: null }
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
                // `style`, not the fill attribute: an attribute cannot hold var().
                style={{
                  fill: on ? fill : highlight === 'account' ? 'url(#ner-hatch)' : 'var(--region-fill)',
                  stroke: 'var(--bg)',
                  transition: 'fill 220ms ease',
                }}
                strokeWidth="5"
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
              fontSize="27"
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
                  <tspan x={state.label[0]} dy="31">
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
