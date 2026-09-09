/**
 * The type side of the platform split.
 *
 * There is no `DriverRouteMap.tsx`. Metro resolves `./map/DriverRouteMap` to
 * `.web.tsx` or `.native.tsx` by platform extension, which is what keeps
 * `react-native-maps` out of the web bundle and MapLibre out of the native
 * one. TypeScript does not follow platform extensions, so this declaration is
 * what makes the bare import type-check - both implementations satisfy it,
 * which is the contract being asserted.
 */

import type { DriverRouteMapProps } from './types'

declare const DriverRouteMap: (props: DriverRouteMapProps) => JSX.Element
export default DriverRouteMap
