# Hosted Intelligence Plane — architecture, state, and how to finish it

**Prepared:** 2026-09-08. Everything marked DONE was verified by a command run
in this session. The one thing that is not done is named exactly, in §5.

---

## 1. The architecture

Supabase stays authoritative for operational state. The 976-test Python engine
is deployed separately as a stateless intelligence service. Neither one is a
laptop.

```
Manager Web ──┐
              ├──► Supabase   auth · users · drivers · trucks · trips ·
Driver APK  ──┘    (hosted)   assignments · lifecycle · GPS · authorization ·
              │               RLS/RPC · Edge Functions
              │
              └──► FastAPI    routing · accessibility · risk · weather and
                   (hosted)   landslide evidence · fuel · recommendation ·
                              navigation + offline packages
```

The split is deliberate and it is reversible: the intelligence service holds no
state of its own. If it is down, the clients report accessibility as
`UNASSESSED` and **every other workflow keeps working** — planning, dispatch,
the driver lifecycle, GPS, tracking, delivery. That property is what makes
hosting the engine a smaller risk than porting it.

### Why the engine was not ported to Edge Functions

It is a deterministic weighted rule with published constants and 976 tests
around it. Reimplementing that in TypeScript under a deadline would produce a
second, untested copy of the one component whose correctness the whole
submission rests on, and the two would drift. Hosting the tested one is less
work and less risk.

## 2. Authentication across the split — DONE

Clients authenticate against Supabase and hold a Supabase session. The
intelligence service therefore had to learn to verify Supabase tokens; it
previously only verified its own.

`backend/app/auth/verifier.py` gains `SupabaseJWTVerifier`, selected by
`AUTH_PROVIDER=supabase`. The interface it plugs into was designed for this
from the start — the file's own docstring said "adopting Supabase Auth later
means adding one class here and changing one line in the factory", and that is
what happened. No route, service or existing test changed.

Properties, each covered by a test in `backend/tests/test_supabase_verifier.py`
(17 tests, all passing):

| Property | Why it matters |
| --- | --- |
| ES256/RS256 verified against the project JWKS | The project uses asymmetric keys, so no shared secret is deployed anywhere |
| Algorithm pinned, never read from the token | `alg: none` and HS256-signed-with-the-public-key both refused — the second is forged by hand in the test, because PyJWT's own encoder refuses to build it |
| `iss` verified | Without it, a token from *any* Supabase project verifies here |
| `aud` verified | Supabase issues tokens for more than one audience |
| `exp`/`iat`/`sub` required | A token with no expiry cannot pass as one that never expires |
| Unknown `kid` → 401 | Ordinary key rotation must not look like an outage, and a made-up `kid` must not let anyone force 5xx |
| JWKS unreachable → **5xx, not 401** | A valid session must never be told it expired because we cannot reach Supabase — that sends the driver to a login screen that also cannot work |
| Role is **not** taken from the token | Supabase says `authenticated` for everyone. `deps.get_current_user` reads the real role from our `users` table on every request, so a demotion takes effect immediately rather than at token expiry |

`users.id` **is** `auth.users.id` — both clients look their row up with
`.eq('id', session.user.id)` — so `sub` maps straight through with no mapping
table and the verifier stays a pure function.

**Verified at runtime**, not only by unit tests. With `AUTH_PROVIDER=supabase`:

| Request | Result |
| --- | --- |
| `GET /health` | `200 {"status":"ok"}` |
| `GET /api/driver/me` no token | `401 UNAUTHENTICATED` |
| `GET /api/driver/me` garbage token | `401` — not a 500 |
| `GET /api/driver/me` **locally-issued FastAPI token** | `401` — proof the verifier actually switched |

## 3. The fabricated risk fixture — DELETED

`manager-web/src/api/supabaseManagerApi.ts` previously computed accessibility
from the route's *kind*:

```js
const score = isPrimary ? 14 : isFuel ? 38 : 68
```

and returned invented evidence to support it — `'1.2 mm/h light rain'`,
`'Winds 15 km/h'`, `observations_used: 5` — together with
`inputs: { weather: 'AVAILABLE', landslide: 'AVAILABLE', … }`, which asserts
that providers were consulted when none were. All of it shipped in the
production bundle.

It is gone, and it was **not** kept as a fallback. When the plane is
unreachable the routes are still listed — a manager needs to see what corridors
exist — but every candidate comes back:

```
score: null            band: 'UNASSESSED'      eligibility: 'NOT_ASSESSED'
recommended_route_id: null                     comparable: false
reason_codes: ['ACCESSIBILITY_ASSESSMENT_UNAVAILABLE']
```

`null` rather than `0` is the point: zero is a legitimate assessed value
meaning "we looked and found nothing wrong". Null means nobody looked. The
manager UI already modelled both (`riskScore: number | null`,
`riskBand: … | 'UNASSESSED'`), so nothing downstream needed changing.

`rerouteAssessment` used to return a constant `NO_ACTION` with
`CONDITIONS_WITHIN_NORMAL_LIMITS` — an assertion that conditions were checked
and found acceptable. There is no honest unassessed value in that contract, so
an unreachable plane now propagates as an error for the caller to render.
Silence there would read as safety.

**Verified against the rebuilt production bundle:**

| String | Before | After |
| --- | --- | --- |
| `1.2 mm/h light rain` | present | **gone** |
| `8.2 mm/h rain on corridor` | present | **gone** |
| `Winds 15 km/h` | present | **gone** |
| `explainable-route-recommendation-v2` | present | **gone** |
| `PRIMARY_RECOMMENDED_LOW_RISK` | present | **gone** |
| `CONDITIONS_WITHIN_NORMAL_LIMITS` | present | **gone** |
| `ACCESSIBILITY_ASSESSMENT_UNAVAILABLE` | — | present |
| `UNASSESSED` / `NOT_ASSESSED` | — | present |

## 4. The driver's missing corridor — FIXED

`offlinePackage` (geometry + stops) and `navigationPackage` (maneuvers) both
threw `NotMigratedError` in the APK build, and `CurrentTrip` deliberately does
not carry geometry. A freshly installed APK therefore had **no geometry source
at all** — the navigation screen had no route line, and the cached-package
fallback a new install does not have.

Both now call the intelligence plane. Failure is still not swallowed:
`useRouteGeometry` catches it and falls back to the stored package for this same
trip *and* route, or renders an honest error. An empty package returned from
here would be indistinguishable from a trip that has no route.

### The release gate

`EXPO_PUBLIC_API_BASE_URL` means "the laptop on the LAN" and the build gate
already refuses it — that fallback shipped in vc3. The hosted plane needed a
variable that is *allowed* in a release, so it got its own,
`EXPO_PUBLIC_INTELLIGENCE_BASE_URL`, held to a stricter rule than the legacy one
ever was.

The rule lives in `releaseConfig.mjs` and is shared by the build gate and the
runtime, because a rule restated in two places is a rule that drifts. It reuses
the existing `isUnreachableHost`, which already encodes the vc3 lesson along
with IPv6 brackets, IPv4-mapped addresses and CGNAT.

**Verified by running the gate:**

| Build profile | Result |
| --- | --- |
| no intelligence origin | **passes** — logs `Intelligence plane -> NONE. Route accessibility will report UNASSESSED.` |
| `https://192.168.1.50:8000` | **rejected** — private network |
| `http://api.example.com` | **rejected** — must use https |
| `https://ner-intel.onrender.com` | **passes** — logs the hostname |

Unset is deliberately not an error: a build with no plane reports `UNASSESSED`,
which is honest and shippable. What is refused is an origin that resolves only
on somebody's desk — that produces an APK which appears to work in the room
where it was built and fails everywhere else.

## 5. What is NOT done: the deployment itself

**The intelligence service is not deployed anywhere.** This is the one
outstanding blocker and it is an access problem, not a code problem.

Exact blocker, as observed:

- No deployment descriptor existed for the backend (now added — see below).
- **No hosting CLI is installed and no credentials are present**: `flyctl`,
  `fly`, `render`, `railway`, `heroku`, `gcloud` and `aws` are all absent from
  this machine.
- A repository-wide search for an existing hosted origin
  (`onrender.com`, `fly.dev`, `railway.app`, `run.app`, …) returns nothing.

Creating a hosting account, authorising it and pushing a deployment are actions
that need the account owner. Nothing was invented to paper over this: with no
plane configured, both clients report `UNASSESSED`, and neither build carries a
localhost or LAN fallback — the gate makes that impossible for the APK, and the
manager's `originProblem` makes it impossible for the website.

### To finish it

`backend/Dockerfile` and `backend/render.yaml` are committed and ready. Render
is used only because it deploys a Dockerfile straight from a repository with no
local CLI, which is precisely the blocker; nothing in the image is
Render-specific and it runs unchanged on Fly, Railway or Cloud Run.

1. Push the repository to GitHub.
2. Render → New → Blueprint → point at `backend/render.yaml`.
3. Set the four dashboard-only values: `DATABASE_URL`, `SECRET_KEY`,
   `CORS_ORIGINS` (the manager web origin), and `GEMINI_API_KEY` only if this
   service is also to serve the AI endpoints — today the driver's assistant goes
   to the `gemini-ai` Edge Function, which already holds that key server-side.
4. Put the resulting https URL in **both** places:
   - `manager-web/.env.production` → `VITE_INTELLIGENCE_BASE_URL`
   - `driver-app/eas.json` (both profiles) → `EXPO_PUBLIC_INTELLIGENCE_BASE_URL`
5. Rebuild both clients. A copy-paste error fails the build rather than the
   demo — both sides refuse anything that is not a public https origin.

`healthCheckPath` is `/health`, not `/ready`: the system router is mounted at
the root while application routers are under `/api`, and `/ready` opens a
database connection, so a brief Supabase hiccup would make the platform kill a
process that was fine.

## 6. Verified state after these changes

| Suite | Before | After |
| --- | --- | --- |
| Backend | 959 passed, 5 skipped | **976 passed, 5 skipped** (+17 verifier) |
| Manager | 124 passed | **150 passed** (+26 origin/honesty) |
| Driver | 490 passed | **510 passed** (+2 package contract, +18 release-gate origin rules) |
| Typechecks | clean | clean (both, forced rebuild) |
| Manager production build | succeeds | succeeds |

No test was deleted or weakened. Two existing driver tests were updated rather
than removed: they asserted `offlinePackage`/`navigationPackage` throw
`NotMigratedError`, and those operations now reach the hosted plane. The
invariant they protect — that these refuse rather than return a plausible empty
package — is asserted more explicitly than before, and the "never falls back to
the laptop backend" test now covers both kinds of non-Supabase operation.

## 7. Still open

Not touched by this work, and still true:

- **Route switching is not atomic.** `selectRoute` and `acceptReroute` issue two
  and three independent client-side writes with no transaction, and
  `selectRoute` never demotes the previously selected route, so two
  `trip_routes` rows can both read `SELECTED`. Should become `select_route` and
  `accept_reroute` RPCs, matching the `plan_trip` / `dispatch_trip` pattern the
  project already uses correctly. See
  [CROSS_CLIENT_CONTRACT_MATRIX.md](CROSS_CLIENT_CONTRACT_MATRIX.md) §2.
- **Six manager controls still throw** `NotMigratedError`: cancel/close trip,
  create/deactivate driver, create/retire truck, end assignment, revoke
  authorization.
- **`reviewAuthorization` returns `null` unconditionally**, which makes "no
  authorization" and "not implemented" render identically — against the policy
  the driver's own API file states in its header.
- **Five evidence factors are permanently unavailable**: flood, road quality,
  truck restrictions, historical incidents, elevation. Honest, but it means
  multi-factor accessibility today rests on weather + landslide + exposure, and
  the demo narration must say so.
- **No `SIMULATED` / `SOURCE_BACKED_SNAPSHOT` / `FIXTURE` evidence mode exists**,
  so a simulated demo hazard event has no vocabulary to label itself with.
- **No physical device certification.** No APK has been built or run on a phone
  in this session.
