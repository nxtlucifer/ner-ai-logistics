import { useState, type FormEvent } from 'react'

import { ApiError, NetworkError } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field } from '../components/ui'

/**
 * Manager sign-in.
 *
 * A split panel rather than a centred form: the left side is the only place in
 * the console that gets to say what the product IS, and this is the one screen
 * a judge or a new dispatcher sees before anything else. It carries no
 * interactive elements, so it costs nothing operationally.
 *
 * The brand panel is hidden below 900px rather than stacked. Stacking it pushes
 * the password field under the fold on a laptop in a meeting room, and the
 * panel is decoration - the form is the screen.
 */
export default function LoginPage() {
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSubmitting) return // double-submit guard
    setIsSubmitting(true)
    setError(null)
    try {
      await login(identifier.trim(), password)
    } catch (err) {
      // The backend deliberately returns one message for unknown-user and
      // wrong-password, so this cannot be made more specific - and must not be.
      if (err instanceof NetworkError) {
        // NOT "is it running on port 8000?". That named the dev transport on a
        // build that talks to hosted Supabase, so it was both a leak of
        // infrastructure detail and, in production, simply untrue.
        setError('Cannot reach the service. Check your connection and try again.')
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Sign in failed. Please try again.')
      }
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_minmax(420px,0.95fr)]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-navy px-14 py-16 lg:flex lg:flex-col lg:justify-between">
        {/* Charcoal is lit from the upper left rather than left flat. A single
            #101820 plane at this size reads as an unfinished placeholder; the
            wash gives the panel a light source without becoming a gradient
            anybody would name as one. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 8% 0%, rgb(52 211 153 / 0.10) 0%, transparent 55%), linear-gradient(160deg, #16212A 0%, #101820 55%, #0B1116 100%)',
          }}
        />

        <BrandMark />

        <div className="relative max-w-md">
          <p className="eyebrow text-[#34D399]">
            People · Goods · A stronger Northeast
          </p>
          <h2 className="mt-5 font-display text-[36px] font-bold leading-[1.12] tracking-tight text-[#F5F8F6]">
            Terrain-aware logistics for the North East.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[#B4C2BA]">
            Plan corridors against live weather and landslide evidence, dispatch
            with an audited route authorisation, and follow every truck through
            the hills in real time.
          </p>

          <ul className="mt-9 space-y-3.5">
            {[
              'Accessibility intelligence on every corridor',
              'Manager-authorised route selection',
              'Live fleet tracking with honest GPS freshness',
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <CheckIcon />
                <span className="text-[14px] leading-snug text-[#C7D4CC]">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="eyebrow relative text-[#7E8F86]">SIH26002 · MDoNER</p>

        {/* Terrain motif. Pure decoration, aria-hidden, no animation. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 600 200"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-56 w-full text-[#34D399] opacity-[0.13]"
        >
          <path
            d="M0 200 L120 96 L190 140 L286 44 L372 122 L452 74 L536 132 L600 92 L600 200 Z"
            fill="currentColor"
          />
          <path
            d="M0 200 L96 142 L176 176 L268 118 L360 168 L446 130 L540 174 L600 148 L600 200 Z"
            fill="currentColor"
            opacity="0.55"
          />
        </svg>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="lg:hidden">
            <BrandMark compact />
          </div>

          <p className="eyebrow mt-8 text-[11px] text-primary lg:mt-0">
            Manager sign in
          </p>
          <h1 className="mt-2.5 font-display text-[29px] font-bold leading-tight tracking-tight text-ink">
            Welcome back
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            Sign in to dispatch trips and monitor your fleet.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
            <Field
              label="Email or phone"
              name="identifier"
              value={identifier}
              onChange={setIdentifier}
              required
              autoComplete="username"
              placeholder="manager@fleet.example"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              value={password}
              onChange={setPassword}
              required
              autoComplete="current-password"
            />

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2.5 rounded-[10px] border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] leading-snug text-danger"
              >
                <AlertIcon />
                <span>{error}</span>
              </p>
            ) : null}

            <Button
              type="submit"
              busy={isSubmitting}
              disabled={!identifier || !password}
              className="!mt-6 h-12 w-full justify-center text-[15px]"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          {/* A SERVER COMMAND IS NOT SIGN-IN CONTENT. This used to print
              `python scripts/create_user.py` under the form - an instruction
              nobody signing in can run, on the one screen where they are already
              unsure whether they got their own password wrong. What a person
              stuck here can actually do is ask someone; that is what it says
              now. */}
          <p className="mt-7 border-t border-line pt-6 text-[12.5px] leading-relaxed text-muted">
            No account yet? Ask your administrator to create one. Driver accounts
            are created from the Drivers page.
          </p>
        </div>
      </main>
    </div>
  )
}

/**
 * The mark renders on both the charcoal panel and the white form column, so
 * every colour here is chosen twice.
 *
 * The eyebrow is the case that matters: `--color-aqua` (#34D399) is 9.2:1 on
 * the charcoal shell and 1.9:1 on white. It was previously hard-coded to the
 * dark-only value in both places, which left "TERRAIN INTELLIGENCE" as pale
 * mint on white at 9.5px on the narrow layout — invisible in a meeting room
 * projector, and the one line naming the product.
 */
function BrandMark({ compact = false }: { compact?: boolean }) {
  const onDark = !compact
  return (
    <div className="relative flex items-center gap-3">
      <span
        className="grid place-items-center rounded-[11px]"
        style={{
          width: 38,
          height: 38,
          background: '#101820',
          border: onDark ? '1px solid #2C3B44' : 'none',
        }}
      >
        <img src="/brand-mark.svg" alt="" width={38} height={38} style={{ display: 'block', borderRadius: 10 }} />
      </span>
      <span className="leading-tight">
        <span
          className={`block font-display text-[15px] font-bold tracking-tight ${
            onDark ? 'text-[#F5F8F6]' : 'text-ink'
          }`}
        >
          RASTA AI
        </span>
        <span
          className={`eyebrow mt-1 block text-[9.5px] ${
            onDark ? 'text-aqua' : 'text-primary'
          }`}
        >
          NER Logistics
        </span>
      </span>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      aria-hidden="true"
      className="mt-[3px] shrink-0"
    >
      <circle cx="10" cy="10" r="9" fill="#34D399" opacity="0.16" />
      <path
        d="M6 10.3 L8.8 13 L14 7.6"
        fill="none"
        stroke="#34D399"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      className="mt-[1px] shrink-0"
    >
      <path
        d="M10 2.6 L18.4 17.4 H1.6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.95" fill="currentColor" />
    </svg>
  )
}
