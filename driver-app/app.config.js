/**
 * Build-time config that must not live in `app.json`: the demo backend base
 * URL, injected from `EXPO_PUBLIC_API_BASE_URL` for the network-security
 * plugin. The map needs no key: it is Leaflet over OpenStreetMap inside a
 * WebView (see `src/map/DriverRouteMap.native.tsx`).
 */

module.exports = ({ config }) => {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? ''

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['./plugins/withDemoNetworkSecurity', { base }],
    ],
  }
}
