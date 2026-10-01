import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight,
  Building2,
  ChevronDown,
  Compass,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  Landmark,
  Leaf,
  Lock,
  MapPin,
  Mountain,
  Route as RouteIcon,
  ShieldCheck,
  Truck,
  User,
  Users,
} from 'lucide-react'

import {
  ApiError,
  NetworkError,
  api,
  type RegionRow,
  type Workspace,
} from '../api/client'
import { ManagerAccountRequiredError, useAuth } from '../auth/AuthProvider'
import { Field, Spinner } from '../components/ui'
import { NorthEastMap, type MapHighlight } from '../components/NorthEastMap'
import { ScenicImage } from '../components/ScenicImage'
import { PHOTOS } from '../imageCredits'

/**
 * Manager sign-in, in two screens.
 *
 * STEP 1 is its own full-width page (manager_01) — scope before identity, with
 * the region drawn beside the picker so the choice is visible rather than a
 * word in a dropdown. STEP 2 is the photo split (manager_02): the left side is
 * the only place in the console that gets to say what the product IS.
 *
 * The scope is a HINT. It tells the console what to open first; the account
 * decides what may be seen, and a mismatched state is refused exactly like a
 * wrong password so the form cannot be used to discover which state an
 * address manages.
 *
 * Nothing here is a mockup control without a function: no SSO, no "forgot
 * password" (there is no reset flow), no numbers the server did not send.
 */
//: Only the CHOICE is remembered - never an identifier, never a password.
//: A shared laptop in a district office should open on the right console
//: without also offering the last person's account.
const REMEMBER_KEY = 'rasta:workspace'

function remembered(field: 'workspace' | 'state' | 'district'): string {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY)
    return raw ? (JSON.parse(raw)[field] ?? '') : ''
  } catch {
    // A private window, or storage the browser has blocked. Not an error:
    // the picker simply starts empty.
    return ''
  }
}

/** The scope a device opens on. A fresh device opens on North-East - the
 *  whole region, as manager_01 draws it - not on "My own console", which used
 *  to leave two dead dropdowns and a hatched map (audit 2, "gets wrong" #3).
 *  It is still only a hint: a state or district account must pick its own
 *  scope, and the credentials step shows the choice with a way back.
 *
 *  localStorage holds whatever was last written there - by an older build,
 *  or by anyone with the console open. Only a value that is actually a
 *  workspace comes back; anything else (including "My own console", stored
 *  as an empty workspace) is the account's own console. */
function rememberedWorkspace(): Workspace | '' {
  let kept = false
  try {
    kept = localStorage.getItem(REMEMBER_KEY) !== null
  } catch {
    // Blocked storage: nothing was kept.
  }
  if (!kept) return 'NORTH_EAST'
  const raw = remembered('workspace')
  return (['NORTH_EAST', 'STATE', 'DISTRICT'] as string[]).includes(raw)
    ? (raw as Workspace)
    : ''
}

function remember(workspace: string, state: string, district: string): void {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ workspace, state, district }))
  } catch {
    // Ignored for the same reason.
  }
}

function forget(): void {
  try {
    localStorage.removeItem(REMEMBER_KEY)
  } catch {
    // Ignored for the same reason.
  }
}

/** A thing with a name and an id. Both a region and one of its districts
 *  are this shape, which is all `scopeSummary` ever needed of them. */
interface Named {
  id: string
  name: string
}

/** The chosen scope in one short phrase, for the "change" affordance. */
export function scopeSummary(
  workspace: Workspace | '',
  states: Named[],
  districts: Named[],
  stateId: string,
  districtId: string,
): string {
  if (workspace === 'NORTH_EAST') return 'North-East'
  if (workspace === 'DISTRICT') {
    const d = districts.find((x) => x.id === districtId)
    if (d) return d.name
  }
  if (workspace === 'STATE' || workspace === 'DISTRICT') {
    const st = states.find((x) => x.id === stateId)
    if (st) return st.name
  }
  return 'My own console'
}

/** The four scopes the server checks at login, in the segmented control. */
const SCOPES = [
  ['NORTH_EAST', 'North-East'],
  ['STATE', 'A state'],
  ['DISTRICT', 'A district'],
  ['', 'My own console'],
] as const

/** The shared left edge of manager_01: 75px at 1600 (4.7%). */
const GUTTER = 'px-[clamp(20px,4.7vw,96px)]'

type RegionsState = 'loading' | 'ready' | 'error'

/** Both steps' H1. Focus moves here when Continue or Change swaps the screen. */
const STEP_TITLE = 'signin-step-title'

/** The forest primary of both steps. While it cannot act it stays forest at
 *  half strength with aria-disabled (audit 15 #12); `disabled` is the guard. */
const CTA =
  'inline-flex w-full items-center justify-center gap-2.5 rounded-[var(--radius-control)] bg-primary text-[19px] font-medium text-on-primary shadow-[var(--shadow-card)] transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:hover:bg-primary aria-disabled:opacity-50 aria-disabled:shadow-none'

export default function LoginPage() {
  const { login, deniedReason } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  // The workspace picker. A HINT the server checks against the account -
  // picking "North-East" grants nothing, and picking the wrong state is
  // refused exactly like a wrong password so the form cannot be used to
  // discover which state an address manages.
  //
  // Remembered between visits because a district manager signs into the
  // same console every morning. Only the CHOICE is remembered; never an
  // identifier and never a password.
  const [workspace, setWorkspace] = useState<Workspace | ''>(rememberedWorkspace)
  const [stateId, setStateId] = useState(() => remembered('state'))
  const [districtId, setDistrictId] = useState(() => remembered('district'))
  const [regions, setRegions] = useState<RegionRow[]>([])
  /** Loading and failure are different things to say (audit D5). */
  const [regionsState, setRegionsState] = useState<RegionsState>('loading')
  const [regionsAttempt, setRegionsAttempt] = useState(0)
  /**
   * Which half of the sign-in is on screen.
   *
   * `scope` first, `credentials` second. A returning user whose choice was
   * remembered lands straight on credentials, because making someone
   * re-pick the same district every morning is not a feature.
   */
  const [step, setStep] = useState<'scope' | 'credentials'>(() =>
    remembered('workspace') ? 'credentials' : 'scope',
  )
  // Continue and Change swap the whole screen. Focus follows to the new
  // heading, so a keyboard or screen-reader user is not left on <body>.
  // Not on first paint: nothing has moved yet.
  const stepMoved = useRef(false)
  useEffect(() => {
    if (stepMoved.current) document.getElementById(STEP_TITLE)?.focus()
  }, [step])
  const goTo = (next: 'scope' | 'credentials') => {
    stepMoved.current = true
    setStep(next)
  }
  /** Whether to keep the scope on this device. Never the identifier, never
   *  the password — so the box says what it really does. */
  const [keepScope, setKeepScope] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  /**
   * True once a sign-in has been waiting long enough that the backend is
   * almost certainly asleep rather than slow. A warm login answers in well
   * under a second; four seconds means Render is starting the service, and
   * saying so is better than a button that looks stuck for half a minute.
   */
  const [waking, setWaking] = useState(false)
  useEffect(() => {
    if (!isSubmitting) {
      setWaking(false)
      return
    }
    const id = setTimeout(() => setWaking(true), 4000)
    return () => clearTimeout(id)
  }, [isSubmitting])
  // A driver's session restored on reload is refused by the provider; say so.
  const [error, setError] = useState<string | null>(deniedReason)

  // ONE public call, and never blocking the form: a failure leaves the
  // selects empty, says so, and the account still decides. `/api/org/states`
  // cannot be used — it requires a token this screen does not have yet.
  useEffect(() => {
    let alive = true
    setRegionsState('loading')
    api.listRegions().then(
      (rows) => {
        if (!alive) return
        setRegions(rows)
        setRegionsState('ready')
      },
      () => {
        if (!alive) return
        setRegions([])
        setRegionsState('error')
      },
    )
    return () => {
      alive = false
    }
  }, [regionsAttempt])

  const districts = regions.find((r) => r.id === stateId)?.districts ?? []

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSubmitting) return // double-submit guard
    setIsSubmitting(true)
    setError(null)
    try {
      await login(identifier.trim(), password, {
        workspace,
        stateId: workspace === 'STATE' || workspace === 'DISTRICT' ? stateId : undefined,
        districtId: workspace === 'DISTRICT' ? districtId : undefined,
      })
      if (keepScope) remember(workspace, stateId, districtId)
      else forget()
    } catch (err) {
      // The backend deliberately returns one message for unknown-user and
      // wrong-password, so this cannot be made more specific - and must not be.
      if (err instanceof NetworkError) {
        setError('Cannot reach the service. Check your connection and try again.')
      } else if (err instanceof ApiError && err.status === 401 && workspace) {
        // A scope the account does not cover is refused exactly like a wrong
        // password. A fresh device opens on North-East, so say - for every
        // refusal, revealing nothing - that the region is checked too.
        const scope = scopeSummary(workspace, regions, districts, stateId, districtId)
        setError(`${err.message} The region is checked too: your account must cover ${scope}.`)
      } else if (err instanceof ManagerAccountRequiredError || err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Sign in failed. Please try again.')
      }
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === 'scope') {
    return (
      <ScopeScreen
        regions={regions}
        regionsState={regionsState}
        onRetryRegions={() => setRegionsAttempt((n) => n + 1)}
        districts={districts}
        workspace={workspace}
        stateId={stateId}
        districtId={districtId}
        onWorkspace={(value) => {
          setWorkspace(value)
          setStateId('')
          setDistrictId('')
        }}
        onState={(value) => {
          setStateId(value)
          setDistrictId('')
        }}
        onDistrict={setDistrictId}
        onContinue={() => goTo('credentials')}
      />
    )
  }

  const summary = scopeSummary(workspace, regions, districts, stateId, districtId)
  const incomplete = !identifier || !password

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[60.7fr_39.3fr]">
      {/* The brand row is the step's banner (A11Y-5): here on a phone, in the
          photo panel from lg up, so exactly one is shown at any width. */}
      <header className="px-5 pt-8 sm:px-10 lg:hidden">
        <BrandMark />
      </header>
      {/* Form panel: cream in Light, the black canvas in Dark. First in the
          DOM, so the form's controls come before the photo panel's credits
          control in the Tab order; the grid places the photo on the left. */}
      <main className="relative isolate flex min-h-screen flex-col overflow-hidden px-5 pt-8 sm:px-10 lg:col-start-2 lg:row-start-1 lg:pl-[12.4%] lg:pr-[7.6%] lg:pt-[42px] short:pt-[32px]">
        <p className="text-right text-[13.5px] leading-[1.6] text-muted">
          New here?
          <br />
          <span className="font-medium text-ink">Ask your administrator for an account</span>
        </p>

        <div className="w-full max-w-[503px] lg:mt-[50px] short:mt-5">
          <h1
            id={STEP_TITLE}
            tabIndex={-1}
            className="w-fit font-display text-[clamp(30px,2.5vw,40px)] font-bold leading-[1.15] tracking-tight text-ink"
          >
            Welcome Back
          </h1>
          <p className="mt-3.5 text-[clamp(16px,1.2vw,19px)] leading-[1.5] text-muted">
            Log in to manage operations, monitor the fleet and keep the region moving.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 short:mt-3" noValidate>
            <div className="flex items-center justify-between gap-3 rounded-full border border-line bg-surface py-1.5 pl-3.5 pr-1.5">
              <span className="flex min-w-0 items-center gap-2 text-[13.5px] text-muted">
                <MapPin className="size-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate">
                  Opening <span className="font-semibold text-ink">{summary}</span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => goTo('scope')}
                aria-label={`Change region, currently ${summary}`}
                className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold text-accent hover:bg-soft"
              >
                Change
              </button>
            </div>

            <div className="mt-5 space-y-5 short:mt-4 short:space-y-4">
              <Field
                label="Email or phone"
                name="identifier"
                value={identifier}
                onChange={setIdentifier}
                required
                large
                autoComplete="username"
                placeholder="Enter your email or phone"
                icon={<User className="size-5" strokeWidth={1.6} />}
              />
              <Field
                label="Password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={setPassword}
                required
                large
                autoComplete="current-password"
                placeholder="Enter your password"
                icon={<Lock className="size-5" strokeWidth={1.6} />}
                trailing={
                  // A person typing a one-time temporary password read off a
                  // phone call needs to see it. Off by default.
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="grid size-10 place-items-center rounded-[6px] text-muted hover:bg-soft hover:text-ink"
                  >
                    {showPassword ? (
                      <EyeOff className="size-5" strokeWidth={1.6} aria-hidden="true" />
                    ) : (
                      <Eye className="size-5" strokeWidth={1.6} aria-hidden="true" />
                    )}
                  </button>
                }
              />
            </div>

            {/* NOT "remember me". Nothing about the account is kept — only
                which console to open, which is what the words say. */}
            <label className="mt-5 flex items-center gap-3 text-[15px] text-ink">
              <input
                type="checkbox"
                name="keep-scope"
                checked={keepScope}
                onChange={(e) => setKeepScope(e.target.checked)}
                className="size-[22px] shrink-0 accent-primary"
                style={{ minHeight: 22 }}
              />
              Remember this region on this device
            </label>

            {error ? (
              <p
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-[10px] border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] leading-snug text-danger"
              >
                <AlertIcon />
                <span>{error}</span>
              </p>
            ) : null}

            {/* Half strength while a field is empty; busy keeps full strength
                with a spinner, and `disabled` is still the double-submit guard. */}
            <button
              type="submit"
              disabled={incomplete || isSubmitting}
              aria-disabled={incomplete}
              aria-busy={isSubmitting}
              className={`mt-5 h-14 short:mt-4 ${CTA}`}
            >
              {isSubmitting ? <Spinner /> : null}
              {!isSubmitting ? (
                <>
                  Log In <ArrowRight className="size-5" aria-hidden="true" />
                </>
              ) : waking ? (
                'Waking secure server…'
              ) : (
                'Signing in…'
              )}
            </button>
          </form>

          {/* The slot the reference gives to "Continue with SSO". There is no
              SSO provider, so it says the one true thing about accounts. */}
          <p className="mt-5 border-t border-line pt-4 text-[13.5px] leading-relaxed text-muted short:mt-4 short:pt-3">
            Driver accounts are created from the Drivers page, not here.
          </p>
        </div>

        <div className="relative z-10 mt-auto pb-4 pt-10 text-center short:pb-3 short:pt-3">
          <p className="font-display text-[15px] leading-relaxed text-ink">
            &ldquo;Better Access.
            <br />
            Brighter Futures.&rdquo;
          </p>
          <span aria-hidden="true" className="mx-auto mt-3 block h-[3px] w-8 rounded bg-brand-gold" />
          {/* The hackathon brief this build answers. Demo, certification and
              development builds say so; a production build does not. The
              photo's credits are its own (i) control, not a footer link. */}
          {import.meta.env.MODE === 'production' ? null : (
            <p className="mt-6 text-[11.5px] tracking-[0.12em] text-muted short:mt-3">SIH26002 · MDoNER</p>
          )}
        </div>
        <PineRidge className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[21%] min-h-[140px] w-full short:h-[14%] short:min-h-[104px]" />
      </main>

      <BrandPanel />
    </div>
  )
}

/* -------------------------------------------------------------------------
   STEP 1 — the region (manager_01).
   ------------------------------------------------------------------------- */

function ScopeScreen({
  regions,
  regionsState,
  onRetryRegions,
  districts,
  workspace,
  stateId,
  districtId,
  onWorkspace,
  onState,
  onDistrict,
  onContinue,
}: {
  regions: RegionRow[]
  regionsState: RegionsState
  onRetryRegions: () => void
  districts: RegionRow['districts']
  workspace: Workspace | ''
  stateId: string
  districtId: string
  onWorkspace: (value: Workspace | '') => void
  onState: (value: string) => void
  onDistrict: (value: string) => void
  onContinue: () => void
}) {
  const loaded = regionsState === 'ready' && regions.length > 0
  // Every district the directory holds, VERIFIED_OFFICIAL or DEMO alike
  // (geography.py): "on file", never "verified" (TRUTH-1), as on States.
  const districtsOnFile = regions.reduce((n, r) => n + r.districts.length, 0)
  const pendingStates = regions.filter((r) => r.districts.length === 0).length
  const stateName = regions.find((r) => r.id === stateId)?.name ?? null
  const districtName = districts.find((d) => d.id === districtId)?.name ?? null
  const needsState = workspace === 'STATE' || workspace === 'DISTRICT'

  const highlight: MapHighlight =
    workspace === 'NORTH_EAST' ? 'all' : workspace === '' ? 'account' : stateName
  // What the caption names as highlighted.
  const described =
    workspace === 'NORTH_EAST'
      ? 'North-East · all eight states'
      : workspace === ''
        ? 'Your account decides'
        : stateName
          ? [stateName, workspace === 'DISTRICT' ? districtName : null].filter(Boolean).join(' · ')
          : null
  // The callout on the map only when it adds to the state's own label: a
  // district (hung from its state's name - there is no district geometry),
  // or the whole region / the account. Never the state's name twice.
  const callout = workspace === 'STATE' || (workspace === 'DISTRICT' && !districtName) ? null : described

  // What the State select says when it is not asking - the old tile hints.
  const statePlaceholder = !needsState
    ? workspace === 'NORTH_EAST'
      ? 'All eight states'
      : 'Set by your account'
    : regionsState === 'loading'
      ? 'Loading states…'
      : regionsState === 'error'
        ? 'State list unavailable'
        : 'Choose a state'
  const districtPlaceholder =
    workspace === 'NORTH_EAST'
      ? 'All districts'
      : workspace === ''
        ? 'Set by your account'
        : workspace === 'STATE'
          ? 'The whole state'
          : !stateId
            ? 'Choose a state first'
            : districts.length === 0
              ? 'Official district directory pending'
              : 'Choose a district'

  const STATS = [
    { Icon: Leaf, value: loaded ? String(regions.length) : '—', label: 'States' },
    {
      Icon: Users,
      value: loaded ? String(districtsOnFile) : '—',
      label:
        loaded && pendingStates > 0
          ? `Districts on file · ${pendingStates} state${pendingStates === 1 ? '' : 's'} pending`
          : 'Districts on file',
    },
    { Icon: Mountain, value: 'Terrain-aware', label: 'Gradient and hazard evidence' },
    { Icon: ShieldCheck, value: 'Audited', label: 'A manager authorises every dispatch' },
  ]

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-canvas">
      <header className={`flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pt-4 short:pt-3 ${GUTTER}`}>
        <div className="flex items-center gap-x-10">
          <BrandMark />
          <span aria-hidden="true" className="hidden h-14 w-px bg-line xl:block" />
          <p className="hidden items-center gap-4 text-[15px] text-muted xl:flex">
            <span>Smarter Logistics</span>
            <span aria-hidden="true" className="text-outline">
              |
            </span>
            <span>Safer Routes</span>
            <span aria-hidden="true" className="text-outline">
              |
            </span>
            <span>Stronger Communities</span>
          </p>
        </div>
        <div className="flex items-center gap-8 xl:-mr-[clamp(0px,2.5vw,40px)]">
          <p className="flex items-center gap-4 text-[13px] leading-snug">
            <Compass className="size-10 shrink-0 text-ink" strokeWidth={1.3} aria-hidden="true" />
            <span>
              <span className="block text-[14px] font-semibold text-ink">North East India</span>
              <span className="block text-muted">Eight states, one corridor network</span>
            </span>
          </p>
          <span aria-hidden="true" className="hidden h-12 w-px bg-line sm:block" />
          <Crosshair className="hidden size-11 text-ink sm:block" strokeWidth={1.1} aria-hidden="true" />
        </div>
      </header>

      {/* The step's one main landmark, under the brand row's banner (A11Y-5). */}
      <main
        className={`grid w-full flex-1 grid-cols-1 gap-x-6 gap-y-10 pb-4 pt-8 lg:grid-cols-[minmax(0,min(586px,36.6vw))_minmax(0,1fr)] lg:pt-[54px] short:pt-2 ${GUTTER}`}
      >
        <section data-testid="scope-step" className="min-w-0">
          <p className="text-[13px] font-medium uppercase tracking-[0.35em] text-muted">Step 1 of 2</p>
          <h1
            id={STEP_TITLE}
            tabIndex={-1}
            className="mt-3 w-fit font-display text-[clamp(28px,2.25vw,36px)] font-bold leading-[1.15] tracking-tight text-ink short:mt-2 short:text-[30px]"
          >
            Select Your Operational Region
          </h1>
          <p className="mt-3 max-w-[48ch] text-[clamp(15px,1.12vw,18px)] leading-[1.5] text-muted short:mt-2 short:text-[15px]">
            Choose your operating scope to open the right console. Your account decides what you may
            actually see.
          </p>

          <div className="relative mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-panel)] sm:px-6 sm:pt-5 short:mt-4 short:py-4">
            <div
              role="radiogroup"
              aria-label="Operating scope"
              className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-soft p-1 sm:grid-cols-4"
            >
              {SCOPES.map(([value, title]) => {
                const on = workspace === value
                return (
                  <label
                    key={value || 'own'}
                    className={`flex min-h-11 cursor-pointer short:min-h-10 items-center justify-center rounded-[6px] px-1 text-center text-[clamp(12px,0.9vw,14px)] font-semibold leading-tight transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)] ${
                      on ? 'bg-surface-raised text-ink shadow-[var(--shadow-card)] ring-1 ring-outline' : 'text-muted hover:text-ink'
                    }`}
                  >
                    <input
                      type="radio"
                      name="scope"
                      value={value}
                      checked={on}
                      onChange={() => onWorkspace(value)}
                      className="sr-only"
                    />
                    {title}
                  </label>
                )
              })}
            </div>

            <label htmlFor="scope-state" className="mt-4 short:mt-3 block text-[15px] font-semibold text-ink">
              State
            </label>
            <SelectBox icon={<MapPin className="size-5" strokeWidth={1.6} />}>
              <select
                id="scope-state"
                name="state"
                value={needsState ? stateId : ''}
                onChange={(e) => onState(e.target.value)}
                disabled={!needsState || regionsState !== 'ready'}
                className={SELECT}
              >
                <option value="">{statePlaceholder}</option>
                {needsState
                  ? regions.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))
                  : null}
              </select>
            </SelectBox>
            {/* Whatever the scope: the figures below come from the same list. */}
            {regionsState === 'error' ? (
              <p role="alert" className="mt-1.5 flex items-center gap-2 text-[12.5px] leading-snug text-danger">
                The state list could not be loaded.
                <button type="button" onClick={onRetryRegions} className="font-semibold underline underline-offset-2">
                  Try again
                </button>
              </p>
            ) : null}

            <label htmlFor="scope-district" className="mt-3.5 short:mt-2.5 block text-[15px] font-semibold text-ink">
              District
            </label>
            <SelectBox icon={<Building2 className="size-5" strokeWidth={1.6} />}>
              <select
                id="scope-district"
                name="district"
                value={workspace === 'DISTRICT' ? districtId : ''}
                onChange={(e) => onDistrict(e.target.value)}
                disabled={workspace !== 'DISTRICT' || !stateId || districts.length === 0}
                className={SELECT}
              >
                <option value="">{districtPlaceholder}</option>
                {workspace === 'DISTRICT'
                  ? districts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.disputed_or_recently_changed ? ' (recently changed)' : ''}
                      </option>
                    ))
                  : null}
              </select>
            </SelectBox>
            {workspace === 'DISTRICT' && stateId && districts.length === 0 ? (
              // Never a fabricated list, and never a silent empty dropdown.
              <p className="mt-1.5 text-[12px] leading-snug text-warning">
                No verified district directory has been loaded for this state yet. Sign in to your own
                console and your account&rsquo;s district will be used.
              </p>
            ) : null}

            <button
              type="button"
              onClick={onContinue}
              className={`mt-5 h-[53px] short:mt-4 short:h-12 ${CTA}`}
            >
              Continue <ArrowRight className="size-5" aria-hidden="true" />
            </button>

            {/* The reference sets this under the card; inside it, it reads on
                the card in both themes whatever the photo is doing below. */}
            <span aria-hidden="true" className="mx-auto mt-4 block h-[2px] w-8 bg-brand-gold short:hidden" />
            <p className="mt-2 short:hidden text-center text-[11.5px] font-medium uppercase tracking-[0.3em] text-muted">
              &ldquo;From the hills to new horizons&rdquo;
            </p>
          </div>
        </section>

        {/* The map is the middle column (manager_01). Its box grows with the
            viewport's height, centred in the space the card leaves, and from
            1280 up the capability card hangs off its east edge, so the two
            stay together at any width; below that the card follows the map
            (hung off a 1024 map, it covered Nagaland's name). */}
        <div className="relative min-w-0 lg:-mt-[74px] xl:pr-[134px] short:-mt-[40px]">
          <div className="relative mx-auto w-full max-w-[640px] pt-10 lg:mx-0 lg:w-[84%] lg:max-w-[75vh] lg:pt-4 xl:mx-auto xl:w-full">
            <p className="absolute left-0 top-0 z-10 max-w-[240px] text-[11.5px] leading-snug text-faint lg:top-[38px]">
              North-East state boundaries shown for operational selection.
              {described ? ` Highlighted: ${described}.` : ''}
            </p>
            <NorthEastMap highlight={highlight} callout={callout} />
            <ol className="relative z-10 ml-auto mt-6 w-max rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 shadow-[var(--shadow-panel)] xl:absolute xl:left-[calc(100%-110px)] xl:top-[36%] xl:mt-0">
              {JOURNEY.map(({ Icon, label }, i) => (
                <li key={label} className="flex min-h-[41px] items-center gap-3.5 whitespace-nowrap text-[14px]">
                  <Icon className="size-5 shrink-0 text-ink" strokeWidth={1.6} aria-hidden="true" />
                  <span className={i === 0 ? 'font-semibold text-ink' : 'text-ink'}>{label}</span>
                  {i === 0 ? <span className="sr-only">(current step)</span> : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </main>

      {/* The figures the reference fills with "120+ Districts". Two are counts
          the server just sent (a dash until it has); two are capabilities,
          which is what you write when there is no number you can stand behind. */}
      {/* Click-through, so the photo's credits control under it stays pressable. */}
      <footer className={`pointer-events-none relative pb-5 pt-2 ${GUTTER}`}>
        <ul className="grid max-w-[700px] grid-cols-2 gap-y-5 sm:flex sm:gap-y-0">
          {STATS.map(({ Icon, value, label }, i) => (
            <li
              key={label}
              className={`min-w-0 pr-5 sm:max-w-[176px] ${i > 0 ? 'sm:border-l sm:border-on-image/30 sm:pl-5' : ''}`}
            >
              <Icon className="size-[30px] text-on-image short:size-6" strokeWidth={1.3} aria-hidden="true" />
              {/* Wraps on a phone: at 320 "Terrain-aware" ran into "Audited" (AUD-10). */}
              <p className="mt-2 text-[20px] font-semibold leading-tight text-on-image sm:whitespace-nowrap">{value}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-on-image-muted">{label}</p>
            </li>
          ))}
        </ul>
        <span aria-hidden="true" className="mt-3.5 block h-[2px] w-12 bg-brand-gold short:mt-2.5" />
        <div className="mt-3 short:mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pr-2 sm:pr-[260px]">
          <p className="text-[12px] font-medium uppercase tracking-[0.4em] text-on-image-muted">A more connected India</p>
        </div>
        <p
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[92px] right-[clamp(20px,2.4vw,40px)] hidden -rotate-[22deg] font-script text-[44px] leading-[0.95] text-on-image xl:block"
        >
          <span className="block">Mountains</span>
          <span className="block pl-8">Move</span>
          <span className="block pl-14">Markets</span>
          <span className="ml-28 mt-1 block h-[2px] w-16 bg-brand-gold" />
        </p>
      </footer>

      {/* The foundation (manager_01): a North-East valley rising from the
          foot of the page and dissolving into the canvas through mist. The
          scrim token darkens its foot for the white figures - forest in
          Light, neutral black in Dark. The hero only from lg up:
          on a phone it is below the fold, so it is not preloaded there. */}
      <ScenicImage
        photo={PHOTOS.mawkdok}
        priority
        media="(min-width: 1024px)"
        // Up to a 1440 laptop the 1280 file (PERF-3): 125 KB rather than
        // 178, drawn at most 12% larger than it is, under the scrim. On a
        // phone the slot is the screen's width: "1280px" there made a DPR-3
        // phone take the 235 KB 1920 file for a photo below the fold
        // (RPERF-1); 390 x 3 now picks the 1280 file.
        sizes="(max-width: 1023px) 100vw, (max-width: 1440px) 1280px, 100vw"
        position="50% 64%"
        className="absolute inset-x-0 bottom-0 -z-10 h-[max(620px,57vh)] lg:h-[max(440px,57vh)]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[35%] lg:h-1/2"
          style={{ background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg) 12%, transparent 100%)' }}
        />
      </ScenicImage>
    </div>
  )
}

/** What a manager does after picking a region. The first is where they are. */
const JOURNEY = [
  { Icon: MapPin, label: 'Select Your Scope' },
  { Icon: Database, label: 'Access Regional Data' },
  { Icon: Truck, label: 'Manage Fleet Operations' },
  { Icon: RouteIcon, label: 'Review Routes & Reports' },
]

const SELECT =
  'h-[52px] short:h-11 w-full appearance-none rounded-[var(--radius-control)] border border-outline bg-surface-raised pl-12 pr-11 text-[16px] font-medium text-ink transition-colors focus:border-route focus:ring-1 focus:ring-route disabled:cursor-not-allowed disabled:bg-soft disabled:font-normal disabled:text-muted'

/** A native select dressed as the reference's icon dropdown. */
function SelectBox({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="relative mt-2 block">
      <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 flex -translate-y-1/2 text-ink">
        {icon}
      </span>
      {children}
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-ink"
        strokeWidth={1.8}
      />
    </span>
  )
}

/* -------------------------------------------------------------------------
   STEP 2 — the photo panel beside the credentials (manager_02).
   ------------------------------------------------------------------------- */

const CAPABILITIES = [
  [Truck, 'Live Fleet Monitoring', 'Every truck, with honest GPS freshness'],
  [RouteIcon, 'Route Intelligence', 'Corridors assessed before dispatch'],
  [Mountain, 'Terrain Awareness', 'Gradient, weather and landslide evidence'],
  [Landmark, 'Auditable Decisions', 'A named manager authorises every route'],
] as const

function BrandPanel() {
  return (
    <ScenicImage
      photo={PHOTOS.cherrapunji}
      priority
      media="(min-width: 1024px)"
      sizes="61vw"
      position="0% 55%"
      scrim="side"
      className="relative hidden lg:col-start-1 lg:row-start-1 lg:block"
    >
      <div className="relative flex h-full min-h-screen flex-col px-[6%] pb-[30px] pt-[35px] text-on-image short:pb-[22px] short:pt-[26px]">
        <header className="flex items-start justify-between gap-6">
          <BrandMark onPhoto />
          <div className="pt-3 text-right text-[14px] leading-[1.6]">
            {/* Full white: this corner is the photo's sky, and 82% white on
                it measured under 4.5:1 in Light. */}
            <p className="font-medium text-on-image">North East India</p>
            <p className="text-on-image">Eight states, one corridor network</p>
            <span aria-hidden="true" className="ml-auto mt-3.5 block h-[3px] w-[52px] rounded bg-brand-gold" />
          </div>
        </header>

        <div className="mt-[52px] max-w-[440px] short:mt-8">
          <span aria-hidden="true" className="block h-[3px] w-[46px] rounded bg-brand-gold" />
          <h2 className="mt-6 font-display text-[clamp(34px,2.9vw,46px)] font-bold leading-[1.12] tracking-tight text-on-image">
            Smarter Logistics
            <br />
            for the <span className="text-on-shell-gold">North East.</span>
          </h2>
          {/* Full white too: at 1366 its line end reaches the thinner scrim
              over the sky, where 82% white measured 4.1:1 in Light. */}
          <p className="mt-4 max-w-[380px] text-[clamp(16px,1.25vw,20px)] leading-[1.45] text-on-image">
            Real-time intelligence. Safer routes. Stronger communities.
          </p>

          <ul className="mt-7 space-y-[10px] short:mt-5 short:space-y-1.5">
            {CAPABILITIES.map(([Icon, title, hint]) => (
              <li key={title} className="flex min-h-[62px] items-center gap-6 short:min-h-[52px]">
                <span className="grid size-[62px] shrink-0 place-items-center rounded-full bg-image-disc short:size-[52px]">
                  <Icon className="size-6 text-on-image" strokeWidth={1.7} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold text-on-image">{title}</span>
                  <span className="mt-0.5 block text-[14px] leading-snug text-on-image-muted">{hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* w-fit: the lines turn about their own centre, not the panel's, so
            the rule under them keeps its distance at every width. */}
        <div className="mt-auto pt-6" aria-hidden="true">
          <p className="w-fit -rotate-[8deg] font-script text-[38px] leading-[0.95] text-on-image short:text-[32px]">
            <span className="block">People</span>
            <span className="block pl-3">Places</span>
            <span className="block pl-6">Possibilities</span>
          </p>
          <span className="mt-7 block h-[3px] w-[46px] rounded bg-brand-gold short:mt-5" />
        </div>
      </div>
    </ScenicImage>
  )
}

/**
 * The existing shield, with the wordmark stacked beside it and the
 * references' mountain line-art as decoration above the name (audit 16.3 #2).
 * It renders on the cream canvas and on a photograph, so colour is chosen
 * twice.
 */
function BrandMark({ onPhoto = false }: { onPhoto?: boolean }) {
  return (
    <div className="flex items-center gap-3.5">
      <img src="/brand-mark.svg" alt="" width={50} height={50} className="block size-[50px] shrink-0 rounded-[12px]" />
      <span className="leading-none">
        <svg viewBox="0 0 80 20" className="mb-1 block h-[18px] w-[72px] text-brand-gold" aria-hidden="true" focusable="false">
          <path
            d="M2 19 L20 5 L28 12 L40 1 L52 12 L60 6 L78 19"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path d="M34 7 L40 12 L46 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className={`block font-display font-bold tracking-[0.04em] ${onPhoto ? 'text-[clamp(26px,2.1vw,34px)] text-on-image' : 'text-[clamp(24px,1.9vw,30px)] text-ink'}`}
        >
          RASTA AI
        </span>
        <span
          className={`mt-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] ${onPhoto ? 'text-on-image-muted' : 'text-ink'}`}
        >
          Manager console
        </span>
      </span>
    </div>
  )
}

/** The misty ridges and pines under the form (manager_02, bottom right). */
function PineRidge({ className }: { className?: string }) {
  const pine = (x: number, h: number) => {
    const base = 200
    const tiers = 6
    let d = `M${x},${base - h} `
    for (let i = 1; i <= tiers; i++) {
      const y = base - h + (h * 0.86 * i) / tiers
      const w = h * 0.07 + h * 0.2 * (i / tiers)
      d += `L${x + w},${y} L${x + w * 0.45},${y - h * 0.02} `
    }
    for (let i = tiers; i >= 1; i--) {
      const y = base - h + (h * 0.86 * i) / tiers
      const w = h * 0.07 + h * 0.2 * (i / tiers)
      d += `L${x - w * 0.45},${y - h * 0.02} L${x - w},${y} `
    }
    return `${d}Z M${x - 2},${base - h * 0.14} h4 V${base} h-4 Z`
  }
  const trees = [
    [18, 190], [52, 150], [84, 175], [116, 118], [146, 92],
    [540, 96], [566, 132], [598, 168], [626, 124],
  ] as const
  return (
    <svg viewBox="0 0 640 200" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden="true" focusable="false">
      <path
        d="M0,120 Q60,92 120,110 T250,96 Q320,70 390,100 T520,88 Q590,74 640,96 L640,200 L0,200 Z"
        style={{ fill: 'var(--surface-soft)' }}
      />
      <path
        d="M0,160 Q90,132 180,152 T360,144 Q450,126 540,150 T640,140 L640,200 L0,200 Z"
        style={{ fill: 'var(--region-fill)' }}
        opacity="0.55"
      />
      {trees.map(([x, h]) => (
        <path key={x} d={pine(x, h)} style={{ fill: 'var(--scene-pine)' }} />
      ))}
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
