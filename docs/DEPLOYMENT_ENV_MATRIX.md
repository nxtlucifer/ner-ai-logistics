# DEPLOYMENT ENVIRONMENT MATRIX

Every variable the three deployables read, where its production value lives, and
whether it is a secret.

**No actual secret value appears in this file, and none should ever be added to
it.** Variables marked SECRET are set in a dashboard, never in the repository.

Names below were read from source, not assumed. Two in particular are easy to
get wrong:

- The intelligence origin is **`..._BASE_URL`**, not `..._API_ORIGIN`.
- The health check path is **`/health`**, not `/api/health` — the system router
  is mounted at the root while application routers sit under `/api`.

---

## 0. Canonical hosts

One production URL per deployable. Two live manager URLs means two places
`VITE_INTELLIGENCE_BASE_URL` can be wrong, and the driver APK can only be built
against one of them.

| Deployable | `CANONICAL_HOST` | Descriptor | Notes |
| :--- | :--- | :--- | :--- |
| **Manager web** | **`CANONICAL_MANAGER_HOST = vercel`** | `manager-web/vercel.json` | Set the Vercel project **Root Directory** to `manager-web`. `manager-web/netlify.toml` is kept as a documented fallback and is **not** a second production target. |
| Hosted intelligence plane | `render` | `render.yaml` | Blueprint deploy. Health check `/health`, not `/ready`. |
| Data / auth | `supabase` | `supabase/` | System of record. |
| Driver APK | `eas` | `driver-app/eas.json` | Built **after** the Render URL exists. |

Changing the canonical manager host means editing `vercel.json`, `netlify.toml`
and this table in one commit. A descriptor that disagrees with this table is a
bug.

---

## 1. Hosted intelligence plane (FastAPI, Render)

Set in the Render dashboard. `render.yaml` declares them; the four
marked `sync: false` are deliberately left empty in the file.

| Variable | Required | Secret | Source | Example format | Production value location |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `APP_ENV` | yes | no | `render.yaml` | `production` | committed in `render.yaml` |
| `AUTH_PROVIDER` | yes | no | `render.yaml` | `supabase` | committed |
| `SUPABASE_URL` | yes | no | `render.yaml` | `https://<ref>.supabase.co` | committed (a public identifier) |
| `DATABASE_PROVIDER` | yes | no | `render.yaml` | `supabase` | committed |
| `DB_POOL_SIZE` | yes | no | `render.yaml` | `3` | committed |
| `DB_MAX_OVERFLOW` | yes | no | `render.yaml` | `2` | committed |
| `DB_REQUIRE_SSL` | yes | no | `render.yaml` | `true` | committed |
| `DATABASE_URL` | **yes** | **SECRET** | dashboard | `postgresql+psycopg://<user>:<pw>@<pooler-host>:5432/postgres` | Render dashboard |
| `SECRET_KEY` | **yes** | **SECRET** | dashboard | 32+ random bytes, hex or base64 | Render dashboard |
| `CORS_ORIGINS` | **yes** | no (but per-env) | dashboard | `https://manager.example` | Render dashboard |
| `GEMINI_API_KEY` | no | **SECRET** | dashboard | — | **leave unset** — see note |
| `PORT` | auto | no | platform | `10000` | supplied by Render |

**Sizing:** `DB_POOL_SIZE=3` / `DB_MAX_OVERFLOW=2` is deliberate. Supabase's
session pooler allows ~15 clients per project **across every connected
service**; a bigger pool here starves the rest of the project rather than making
this one faster. Use the **session pooler** connection string, not the direct
one.

**`SECRET_KEY` is not optional in production.** The settings model refuses to
start if it is still the `.env.example` placeholder while `APP_ENV=production` —
that is a deliberate fail-fast, not a bug to work around.

**Why `GEMINI_API_KEY` should stay unset here:** the driver assistant calls the
`gemini-ai` Supabase Edge Function, which already holds that key server-side.
Setting it in a second place doubles the exposure surface for no capability. The
core routing and accessibility product does not use an LLM at all — that
separation is the point, and it should stay visible in the configuration.

---

## 2. Manager web (Vite, static build)

Vite inlines every `VITE_` variable into the bundle at build time. **Everything
here is public.** A secret in this table would be a leak, which is why none is.

| Variable | Required | Secret | Source | Example format | Production value location |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `VITE_BACKEND` | yes | no | host dashboard | `supabase` | **Vercel env var** |
| `VITE_SUPABASE_URL` | yes | no | host dashboard | `https://<ref>.supabase.co` | **Vercel env var** |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | no | host dashboard | `sb_publishable_…` or legacy anon JWT | **Vercel env var** (anon key is public by design) |
| `VITE_SUPABASE_ANON_KEY` | yes | no | host dashboard | legacy anon JWT | **Vercel env var** |
| `VITE_API_BASE_URL` | dev only | no | `.env` | `http://localhost:8000` | **not used in production** — `VITE_BACKEND=supabase` selects the hosted transport |
| **`VITE_INTELLIGENCE_BASE_URL`** | **for accessibility** | no | host dashboard | `https://<service>.onrender.com` | **MISSING — add after Render deploy** |

> ### `.env.production` DOES NOT REACH THE HOSTED BUILD
>
> `manager-web/.env.production` is matched by `.gitignore` (`.env.*`), so it is
> not in the repository and a Vercel or Netlify build never sees it. It is a
> **local** production-profile build file only.
>
> Every `VITE_` value above must therefore be entered as an **environment
> variable in the host dashboard**. An earlier revision of this table said the
> production location was "repo"; that was wrong, and acting on it produces the
> failure below.
>
> **The failure used to be silent. It is not any more.**
>
> `manager-web/src/api/supabaseClient.ts` fell back to the hardcoded project URL
> and to the literal key `'anon-placeholder'`, so it never threw: the manager
> built, deployed and rendered, and every Supabase call returned 401. The
> reported symptom was "login is broken", several layers from the cause. Worse,
> the `if (!SUPABASE_URL) throw` that appeared to guard this was **unreachable
> dead code** - the hardcoded URL fallback meant it could never be falsy.
>
> Both fallbacks are gone. `getSupabase()` now throws and names the missing
> variable, and says the values belong in the hosting dashboard. Pinned by
> `supabaseClient.test.ts` (5 tests), including one asserting the placeholder key
> is never substituted.
>
> It throws **lazily, not at build time**, on purpose: the manager also supports
> a local FastAPI transport where Supabase is unused, and failing the build would
> forbid that valid configuration. `getSupabase()` is only reached on the
> Supabase path, so the check fires exactly where it applies.
>
> Still true: **treat a deployed manager as unverified until a real login
> succeeds against it.** The build cannot prove the dashboard values are right.

**Missing-value behaviour, verified in source:** `intelligence.ts` computes
`originProblem(RAW_BASE)` at module load. If it is unset or not a public HTTPS
origin, `intelligenceConfigured` is false, `BASE` is `''`, and every call throws
`IntelligenceUnavailableError` *before any fetch*. `routeRecommendation` catches
it and returns `UNASSESSED` with a null score.

There is **no localhost fallback**: `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`
and empty are all rejected outright, so a copied dev profile fails the build
rather than silently pointing production at a laptop.

---

## 3. Driver app (Expo / EAS, `driver-app/eas.json`)

Expo inlines every `EXPO_PUBLIC_` variable into the APK. **Everything here is
readable from the installed app.**

| Variable | Required | Secret | Source | Example format | Production value location |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `EXPO_PUBLIC_BACKEND` | yes | no | `eas.json` | `supabase` | repo |
| `EXPO_PUBLIC_SUPABASE_URL` | yes | no | `eas.json` | `https://<ref>.supabase.co` | repo |
| `EXPO_PUBLIC_SUPABASE_PROJECT_REF` | yes | no | `eas.json` | 20-char project ref | repo |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | no | `eas.json` | anon key only | repo |
| **`EXPO_PUBLIC_INTELLIGENCE_BASE_URL`** | **for navigation** | no | `eas.json` | `https://<service>.onrender.com` | **MISSING — add before VC10** |

**This is the blocking gap for VC10.** A fresh install has no cached
`OfflinePackage`, so the only source of route geometry and maneuvers is
`GET /api/driver/me/trip/navigation` on the intelligence plane. Without this
variable the driver has nowhere to fetch it from, and the navigation screen can
only show a base map and an honest "route unavailable" state.

**Do not build VC10 until this line exists.**

The pre-bundle gate (`driver-app/scripts/check-release-config.mjs`) already
refuses localhost, RFC1918, CGNAT, IPv6 loopback and non-HTTPS origins, and
exits non-zero — verified, not assumed.

---

## 4. What must never appear in any of the above

| Material | Correct location |
| :--- | :--- |
| Supabase **service role** key (`sb_secret_…` or a `service_role` JWT) | nowhere in this project — no component needs it |
| Database password | Render dashboard only, inside `DATABASE_URL` |
| `SECRET_KEY` | Render dashboard only |
| `GEMINI_API_KEY` / OpenRouter key | Supabase Edge Function secrets only |
| Google Maps server key | build environment only, never `EXPO_PUBLIC_` |

A secret scan over all 360 changed and untracked files found **zero** real
credentials; the eleven credential-shaped matches were placeholders, test
fixtures (`db.unreachable.invalid`, a fake `host.supabase.com`) and one
PowerShell `$pw` interpolation reading a gitignored file.

---

## 5. Post-deployment wiring order

```
Render deploy succeeds
        ↓
GET https://<service>.onrender.com/health   -> {"status":"ok"}
GET https://<service>.onrender.com/ready    -> {"status":"ready"}
        ↓
Vercel dashboard -> manager-web project -> Environment Variables
   VITE_INTELLIGENCE_BASE_URL=https://<service>.onrender.com
   (NOT manager-web/.env.production - that file is gitignored and
    never reaches the hosted build)
        ↓
redeploy on Vercel      (the origin is inlined at build time)
        ↓
driver-app/eas.json     both profiles
   EXPO_PUBLIC_INTELLIGENCE_BASE_URL=https://<service>.onrender.com
        ↓
eas build               -> VC10
```

Both origins must be the **same** hosted HTTPS URL. Neither client accepts
anything else.
