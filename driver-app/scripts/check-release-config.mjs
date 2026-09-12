/**
 * Pre-bundle release gate. Run BEFORE Metro, fail the build, print no secrets.
 *
 * Plain JavaScript, importing plain JavaScript - a robustness choice, not a fix
 * for a proven failure. Node strips types by default from v22.18.0 and the EAS
 * SDK-57 image ships 22.23.1, so the previous TypeScript gate would in fact
 * have run there; an earlier comment claiming otherwise was wrong. Shipping JS
 * simply means this check cannot stop working because of a pinned Node or a
 * --no-experimental-strip-types flag.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE RUNTIME CHECK
 *
 * `configurationProblem()` runs on the phone. By then Expo has already inlined
 * every `EXPO_PUBLIC_` variable into the bundle, so a secret key is sitting in
 * a readable APK and no runtime code can take it back. The runtime check makes
 * a bad build fail honestly; only this gate can stop the bad build existing.
 *
 * It imports the SAME rules the app uses - releaseConfig.ts is pure and has no
 * native imports precisely so this can run it under plain Node. Duplicating the
 * rules here would guarantee the two drift.
 *
 * Run:  npm run check:release
 * Or wire into EAS as an eas-build-pre-install / prebuildCommand hook.
 */

import {
  intelligenceOriginProblem,
  releaseConfigProblem,
} from '../src/api/releaseConfig.mjs'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
const expectedRef = process.env.EXPO_PUBLIC_SUPABASE_PROJECT_REF || undefined

// A legacy LAN endpoint left in the profile is the exact failure that shipped
// in vc3, so it is refused here too rather than only in the Supabase rules.
const legacyApiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? ''

const problems = []

// ONE TRANSPORT (12 Sep): the demo profiles talk REST to the hosted FastAPI
// (EXPO_PUBLIC_BACKEND=local). Then the rule is the opposite of the Supabase
// one: the API base MUST be set, and it must be a public https origin or a
// private LAN / loopback http address (the lan-demo profile), never a public
// http host. The Supabase checks below do not apply to that transport.
if (process.env.EXPO_PUBLIC_BACKEND === 'local') {
  let ok = false
  try {
    const u = new URL(legacyApiBase)
    const privateHttp = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)
    ok = u.protocol === 'https:' || (u.protocol === 'http:' && privateHttp)
  } catch {}
  if (!ok) {
    console.error('Release configuration REJECTED: EXPO_PUBLIC_BACKEND=local needs EXPO_PUBLIC_API_BASE_URL as a public https origin or a private-LAN http address. (value not printed)')
    process.exit(1)
  }
  console.log(`Release configuration OK -> REST transport, ${new URL(legacyApiBase).hostname}`)
  process.exit(0)
}

const supabaseProblem = releaseConfigProblem({ url, key, expectedRef })
if (supabaseProblem) problems.push(supabaseProblem)

if (legacyApiBase) {
  problems.push(
    `EXPO_PUBLIC_API_BASE_URL is still set. A release must not carry a fallback to the laptop backend; remove it from the build profile. (value not printed)`,
  )
}

// The hosted intelligence plane. Unlike the variable above this one is ALLOWED
// in a release - it is a public https origin, not a laptop - but only if it is
// actually hosted.
//
// Unset is deliberately not an error. A build with no intelligence origin is a
// build that reports route accessibility as UNASSESSED, which is honest and
// shippable. What is refused is an origin that only resolves on somebody's
// desk: that produces an APK which appears to work in the room where it was
// built and fails everywhere else, which is worse than one that never claimed
// to assess anything.
const intelligenceBase = process.env.EXPO_PUBLIC_INTELLIGENCE_BASE_URL ?? ''
const intelligenceProblem = intelligenceOriginProblem(intelligenceBase)
if (intelligenceBase && intelligenceProblem) {
  problems.push(
    `EXPO_PUBLIC_INTELLIGENCE_BASE_URL ${intelligenceProblem}. The hosted intelligence plane must be a public https origin. (value not printed)`,
  )
}

if (problems.length > 0) {
  // Never echo the key. This output lands in CI logs.
  console.error('\nRelease configuration REJECTED:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error(
    '\nNothing was bundled. Fix the build profile and re-run.\n' +
      'Reminder: EXPO_PUBLIC_* values are inlined into the APK and are readable.\n',
  )
  process.exit(1)
}

// Report identity, not credentials: the project ref is public configuration and
// is exactly what someone reading a build log needs to confirm.
console.log(`Release configuration OK -> ${new URL(url).hostname}`)

// Say which intelligence plane this build will use, or that it will use none.
// A build log that is silent about this is one where "the risk panel said
// Unassessed" later has to be diagnosed from scratch.
console.log(
  intelligenceBase
    ? `Intelligence plane      -> ${new URL(intelligenceBase).hostname}`
    : 'Intelligence plane      -> NONE. Route accessibility will report UNASSESSED.',
)
