/**
 * The Google Maps Android key, and only that, comes from the environment.
 *
 * `app.json` is static and tracked; a Maps key is neither. Expo merges this
 * file over it, so everything else still lives in `app.json` where it is
 * readable, and the one value that must not be committed is injected at build
 * time from `GOOGLE_MAPS_ANDROID_API_KEY`.
 *
 * ABSENT IS A SUPPORTED STATE, NOT A BUILD FAILURE. `react-native-maps` on
 * Android is Google's SDK, and with no key it renders a blank grey rectangle
 * with an authorisation error only visible in logcat - the app looks broken
 * rather than unconfigured. So the key's absence is passed through to the app
 * (`extra.googleMapsConfigured`), which draws an honest panel saying which
 * credential is missing. See `src/map/DriverRouteMap.native.tsx`.
 */

module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_ANDROID_API_KEY

  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? ''

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ['./plugins/withDemoNetworkSecurity', { base }],
    ],
    android: {
      ...config.android,
      ...(key ? { config: { googleMaps: { apiKey: key } } } : {}),
    },
    extra: {
      ...config.extra,
      googleMapsConfigured: Boolean(key),
    },
  }
}
