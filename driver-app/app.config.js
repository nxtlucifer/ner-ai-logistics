/**
 * Build-time config that must not live in `app.json`: the demo backend base
 * URL, injected from `EXPO_PUBLIC_API_BASE_URL` for the network-security
 * plugin. The map needs no key: it is Leaflet over OpenStreetMap inside a
 * WebView (see `src/map/DriverRouteMap.native.tsx`).
 *
 * SEC-007: the cleartext lan-demo build is a different app on the phone - its
 * own name and package - so it can never be mistaken for, or installed over, a
 * release. See `buildVariant` in the plugin for who may use plain HTTP.
 */
const { buildVariant } = require('./plugins/withDemoNetworkSecurity')

module.exports = ({ config }) => {
  const { base, lanDemo } = buildVariant(process.env)

  return {
    ...config,
    ...(lanDemo && {
      name: `${config.name} LAN DEMO`,
      android: { ...config.android, package: `${config.android.package}.landemo` },
    }),
    plugins: [
      ...(config.plugins ?? []),
      ['./plugins/withDemoNetworkSecurity', { base, lanDemo }],
    ],
  }
}
