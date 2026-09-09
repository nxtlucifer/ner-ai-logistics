/**
 * The driver app's icon set, drawn from Views.
 *
 * WHY NOT AN ICON LIBRARY: there isn't one. `@expo/vector-icons` and
 * `react-native-svg` are both absent from this project and neither resolves
 * transitively, and adding a native module days before a demo to draw a
 * loudspeaker is a bad trade.
 *
 * WHY NOT EMOJI, WHICH IS WHAT THIS REPLACES: the bottom navigation shipped
 * with 🧭 📋 🛡️ 🤖 and the map controls with 🗺️ 🧭 🔊 🔇. Emoji are rendered by
 * whichever font the device happens to ship, so the app's primary navigation
 * changed appearance across Android versions, sat at whatever baseline the
 * font chose, and could not take the app's own colours - an active tab could
 * not tint its icon, because the glyph carries its own palette. The mute
 * toggle was the clearest failure: 🔇 and 🔊 differ by a small stroke that
 * several system fonts draw almost identically, so the control gave a driver
 * no reliable read on whether guidance was on.
 *
 * Everything here is geometry: rectangles, circles, rotated squares, and
 * triangles built from the border trick. No font, no asset, no native
 * dependency, identical on every device, and `color` actually applies.
 *
 * Each icon fills a `size` box and centres itself, so callers can drop one
 * into a 48dp control without measuring anything.
 */

import { View, type ViewStyle } from 'react-native'

export interface IconProps {
  /** Edge of the square box the icon draws inside. */
  size?: number
  color: string
}

function box(size: number): ViewStyle {
  return { width: size, height: size, alignItems: 'center', justifyContent: 'center' }
}

/**
 * A solid triangle pointing up.
 *
 * The border trick: a zero-sized element whose left and right borders are
 * transparent and whose bottom border is coloured renders as a triangle. It is
 * the one shape React Native cannot express directly and the one every icon
 * here needs.
 */
function Triangle({
  w,
  h,
  color,
  style,
}: {
  w: number
  h: number
  color: string
  style?: ViewStyle
}) {
  return (
    <View
      style={[
        {
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderBottomWidth: h,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        },
        style,
      ]}
    />
  )
}

/** Navigate: a course arrow, tilted the way a heading marker sits. */
export function NavigateIcon({ size = 22, color }: IconProps) {
  return (
    <View style={box(size)}>
      <Triangle
        w={size * 0.72}
        h={size * 0.86}
        color={color}
        style={{ transform: [{ rotate: '32deg' }] }}
      />
    </View>
  )
}

/** Trip: a clipboard - a sheet with a clip at the head and two written lines. */
export function TripIcon({ size = 22, color }: IconProps) {
  const w = size * 0.72
  const h = size * 0.88
  return (
    <View style={box(size)}>
      <View
        style={{
          width: w,
          height: h,
          borderWidth: 1.8,
          borderColor: color,
          borderRadius: 3,
          paddingTop: h * 0.28,
          alignItems: 'center',
          gap: 2.5,
        }}
      >
        <View style={{ width: w * 0.52, height: 1.8, backgroundColor: color }} />
        <View style={{ width: w * 0.52, height: 1.8, backgroundColor: color }} />
      </View>
      <View
        style={{
          position: 'absolute',
          top: (size - h) / 2 - 2,
          width: w * 0.46,
          height: 5,
          borderRadius: 1.5,
          backgroundColor: color,
        }}
      />
    </View>
  )
}

/** Safety: a shield - square shoulders, tapered point. */
export function SafetyIcon({ size = 22, color }: IconProps) {
  const w = size * 0.72
  const shoulder = size * 0.4
  return (
    <View style={box(size)}>
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            width: w,
            height: shoulder,
            backgroundColor: color,
            borderTopLeftRadius: 3.5,
            borderTopRightRadius: 3.5,
          }}
        />
        {/* Point drawn with borderTop rather than a rotated triangle: rotation
            pivots about the centre and left the shield reading as a blob. */}
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: w / 2,
            borderRightWidth: w / 2,
            borderTopWidth: size * 0.42,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }}
        />
      </View>
    </View>
  )
}

/**
 * AI: a speech bubble with a tail.
 *
 * Two earlier attempts failed at tab size and are worth recording. A four-point
 * spark built from rotated squares lost its points at 21px and read as a plain
 * diamond. A processor die with eight legs mispositioned them into a diagonal
 * smear - too many absolutely-positioned parts for an icon this small.
 *
 * A bubble is three Views, has no small features to lose, and says
 * "ask something" - which is what the tab does.
 */
export function AiIcon({ size = 22, color }: IconProps) {
  const w = size * 0.82
  const h = size * 0.66
  return (
    <View style={box(size)}>
      <View style={{ alignItems: 'flex-start' }}>
        <View
          style={{
            width: w,
            height: h,
            borderWidth: 1.9,
            borderColor: color,
            borderRadius: 4.5,
          }}
        />
        {/* Tail: a small down-pointing triangle tucked under the left edge. */}
        <View
          style={{
            marginLeft: w * 0.2,
            marginTop: -1,
            width: 0,
            height: 0,
            borderLeftWidth: size * 0.09,
            borderRightWidth: size * 0.09,
            borderTopWidth: size * 0.16,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }}
        />
      </View>
    </View>
  )
}

/** Recenter: a crosshair over the vehicle's own position. */
export function RecenterIcon({ size = 22, color }: IconProps) {
  const ring = size * 0.56
  const tick = size * 0.16
  const arm: ViewStyle = { position: 'absolute', backgroundColor: color }
  return (
    <View style={box(size)}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: 1.9,
          borderColor: color,
        }}
      />
      <View style={{ position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
      <View style={[arm, { width: 1.9, height: tick, top: 0 }]} />
      <View style={[arm, { width: 1.9, height: tick, bottom: 0 }]} />
      <View style={[arm, { height: 1.9, width: tick, left: 0 }]} />
      <View style={[arm, { height: 1.9, width: tick, right: 0 }]} />
    </View>
  )
}

/** Fit route: four corner brackets pulling outward. */
export function FitRouteIcon({ size = 22, color }: IconProps) {
  const c = size * 0.3
  const t = 1.9
  const corner = (extra: ViewStyle): ViewStyle => ({
    position: 'absolute',
    width: c,
    height: c,
    borderColor: color,
    ...extra,
  })
  return (
    <View style={box(size)}>
      <View style={corner({ top: 1, left: 1, borderTopWidth: t, borderLeftWidth: t, borderTopLeftRadius: 3 })} />
      <View style={corner({ top: 1, right: 1, borderTopWidth: t, borderRightWidth: t, borderTopRightRadius: 3 })} />
      <View style={corner({ bottom: 1, left: 1, borderBottomWidth: t, borderLeftWidth: t, borderBottomLeftRadius: 3 })} />
      <View
        style={corner({ bottom: 1, right: 1, borderBottomWidth: t, borderRightWidth: t, borderBottomRightRadius: 3 })}
      />
    </View>
  )
}

/**
 * Audio. A speaker box with a cone, and for the muted state a bar struck
 * through it so the two differ by an unmistakable stroke rather than by a
 * detail inside a glyph.
 *
 * The cone is a LEFT-pointing border triangle (flat edge on the right, apex
 * against the box), not a rotated up-triangle. Rotating pivots about the
 * centre and left the shape reading as a small flag.
 */
export function AudioIcon({ size = 22, color, muted = false }: IconProps & { muted?: boolean }) {
  const coneH = size * 0.62
  const boxH = size * 0.3
  return (
    <View style={box(size)}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: size * 0.17,
            height: boxH,
            backgroundColor: color,
            borderTopLeftRadius: 1.5,
            borderBottomLeftRadius: 1.5,
          }}
        />
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: coneH / 2,
            borderBottomWidth: coneH / 2,
            borderRightWidth: size * 0.24,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderRightColor: color,
          }}
        />
        {!muted ? (
          <View
            style={{
              marginLeft: size * 0.1,
              width: size * 0.2,
              height: size * 0.2,
              borderWidth: 2,
              borderColor: color,
              borderRadius: size * 0.1,
              borderLeftColor: 'transparent',
              borderBottomColor: 'transparent',
              transform: [{ rotate: '-45deg' }],
            }}
          />
        ) : null}
      </View>
      {muted ? (
        <View
          style={{
            position: 'absolute',
            width: size * 0.92,
            height: 2.2,
            borderRadius: 1.1,
            backgroundColor: color,
            transform: [{ rotate: '-45deg' }],
          }}
        />
      ) : null}
    </View>
  )
}
