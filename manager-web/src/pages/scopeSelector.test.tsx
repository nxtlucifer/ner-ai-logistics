/**
 * The scope step is navigation. It is never authority.
 *
 * WHAT THIS DEFENDS
 *
 * A login screen that asks "which state?" before it asks who you are
 * invites exactly one bug: treating the answer as a claim the server
 * should honour. It must not be. The choice is sent as a hint, the server
 * compares it against the account, and a mismatch is refused the same way
 * a wrong password is — same message, no hint about which half was wrong.
 *
 * And the district list is the other trap. There is no verified district
 * directory yet, so the picker must say so rather than showing an empty
 * dropdown or, worse, the pytest fixtures that once reached a dashboard.
 *
 * The redesign (manager_01 / manager_02) moved every control; the second
 * half of this file pins that the sign-in still does what it did.
 */

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, NetworkError, api, type RegionRow } from '../api/client'
import LoginPage, { scopeSummary } from './LoginPage'

const auth = vi.hoisted(() => ({ login: vi.fn(), deniedReason: null as string | null }))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ login: auth.login, deniedReason: auth.deniedReason }),
  ManagerAccountRequiredError: class extends Error {},
}))

const REGIONS: RegionRow[] = [
  { id: 's-assam', name: 'Assam', slug: 'assam', districts: [] },
  { id: 's-megh', name: 'Meghalaya', slug: 'meghalaya', districts: [] },
]

const KAMRUP = {
  id: 'd1',
  name: 'Kamrup Metropolitan',
  disputed_or_recently_changed: false,
}

beforeEach(() => {
  localStorage.clear()
  auth.login.mockReset()
  auth.deniedReason = null
  vi.spyOn(api, 'listRegions').mockResolvedValue(REGIONS)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const open = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )

const stateSelect = () => screen.getByRole('combobox', { name: 'State' }) as HTMLSelectElement
const districtSelect = () => screen.getByRole('combobox', { name: 'District' }) as HTMLSelectElement

describe('the scope step', () => {
  it('comes first, before any credential is asked for', async () => {
    open()
    expect(await screen.findByTestId('scope-step')).toBeTruthy()
    expect(screen.getByText(/select your operational region/i)).toBeTruthy()
    // The password field must not be the first thing on screen.
    expect(screen.getByRole('radiogroup', { name: /operating scope/i })).toBeTruthy()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })

  it('offers the four scopes and nothing invented', async () => {
    open()
    await screen.findByTestId('scope-step')
    for (const label of ['North-East', 'A state', 'A district', 'My own console']) {
      expect(screen.getByRole('radio', { name: label })).toBeTruthy()
    }
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('opens a fresh device on North-East, never on the hatched own console', async () => {
    // "My own console" used to be pre-selected, so a fresh device opened on
    // two dead dropdowns and a hatched map (audit 2, "gets wrong" #3). The
    // whole region is what manager_01 draws; it is still only a hint.
    open()
    await screen.findByTestId('scope-step')
    const checked = () => screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)
    expect(checked().map((r) => r.getAttribute('value'))).toEqual(['NORTH_EAST'])
    expect(stateSelect().selectedOptions[0].textContent).toBe('All eight states')
    expect(districtSelect().selectedOptions[0].textContent).toBe('All districts')
    expect((screen.getByRole('button', { name: /continue/i }) as HTMLButtonElement).disabled).toBe(false)

    // A device that kept "My own console" (an empty workspace) opens on it.
    cleanup()
    localStorage.setItem('rasta:workspace', JSON.stringify({ workspace: '', state: '', district: '' }))
    open()
    await screen.findByTestId('scope-step')
    expect(checked().map((r) => r.getAttribute('value'))).toEqual([''])
  })

  it('asks for a state only once a scope needs one', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByTestId('scope-step')
    // The reference's two dropdowns are always drawn; they only ask when the
    // scope needs them, and until then say what the scope already covers.
    await user.click(screen.getByText('My own console'))
    expect(stateSelect().disabled).toBe(true)
    expect(stateSelect().selectedOptions[0].textContent).toBe('Set by your account')
    await user.click(screen.getByText('North-East'))
    expect(stateSelect().disabled).toBe(true)
    expect(stateSelect().selectedOptions[0].textContent).toBe('All eight states')

    await user.click(screen.getByText('A state'))
    await waitFor(() => expect(stateSelect().disabled).toBe(false))
    expect(districtSelect().disabled).toBe(true)
    expect(districtSelect().selectedOptions[0].textContent).toBe('The whole state')
  })

  it('says the district directory is pending, rather than showing nothing', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('A district'))
    await waitFor(() => expect(stateSelect().disabled).toBe(false))

    await user.selectOptions(stateSelect(), 's-assam')

    await waitFor(() =>
      expect(screen.getByText(/official district directory pending/i)).toBeTruthy(),
    )
    expect(
      screen.getByText(/no verified district directory has been loaded/i),
    ).toBeTruthy()
  })

  it('marks a district whose boundary recently changed', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listRegions').mockResolvedValue([
      { ...REGIONS[0], districts: [KAMRUP, { id: 'd2', name: 'Bajali', disputed_or_recently_changed: true }] },
      REGIONS[1],
    ])
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('A district'))
    await waitFor(() => expect(stateSelect().disabled).toBe(false))
    await user.selectOptions(stateSelect(), 's-assam')

    const names = [...districtSelect().options].map((o) => o.textContent)
    expect(names).toContain('Bajali (recently changed)')
    expect(names).toContain('Kamrup Metropolitan')
  })

  it('never lists a district the server did not send', async () => {
    // The fixtures that once reached a state manager's dashboard —
    // "Api List", "Closed A", "Dash Att" — are filtered server-side by
    // provenance. The picker renders only what arrives.
    const user = userEvent.setup()
    vi.spyOn(api, 'listRegions').mockResolvedValue([
      { ...REGIONS[0], districts: [KAMRUP] },
      REGIONS[1],
    ])
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('A district'))
    await waitFor(() => expect(stateSelect().disabled).toBe(false))
    await user.selectOptions(stateSelect(), 's-assam')

    await waitFor(() => expect(screen.getByText('Kamrup Metropolitan')).toBeTruthy())
    for (const fixture of ['Api List', 'Closed A', 'Dash Att', 'Create Ok']) {
      expect(screen.queryByText(fixture)).toBeNull()
    }
  })

  it('populates the state picker from the ONE call it can make before a token exists', async () => {
    // The defect this closes: the picker called `/api/org/states`, which
    // requires TRIP_READ, so "A state" opened a dropdown that was empty
    // every single time. A control that cannot work is worse than none.
    const user = userEvent.setup()
    const states = vi.spyOn(api, 'listStates')
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('A state'))

    await waitFor(() =>
      expect([...stateSelect().querySelectorAll('option')].map((o) => o.textContent)).toContain('Assam'),
    )
    expect(states).not.toHaveBeenCalled()
  })

  it('says loading while it loads, and a failure is not the same as loading (D5)', async () => {
    const user = userEvent.setup()
    let fail: (e: Error) => void = () => {}
    const call = vi
      .spyOn(api, 'listRegions')
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue(REGIONS)
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('A state'))
    expect(stateSelect().selectedOptions[0].textContent).toBe('Loading states…')
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => fail(new Error('down')))
    expect(stateSelect().selectedOptions[0].textContent).toBe('State list unavailable')
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/i)
    // The figures stay a dash rather than a zero.
    expect(screen.getByText('States').previousElementSibling?.textContent).toBe('—')

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(stateSelect().disabled).toBe(false))
    expect(call).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('States').previousElementSibling?.textContent).toBe('2')
  })

  it('says the list failed whatever the scope, since the figures come from it too', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listRegions').mockRejectedValueOnce(new Error('down')).mockResolvedValue(REGIONS)
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('North-East'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be loaded/i)
    expect(screen.getByText('States').previousElementSibling?.textContent).toBe('—')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('States').previousElementSibling?.textContent).toBe('2'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('highlights every scope on the map: all eight, the account, or the chosen state', async () => {
    const user = userEvent.setup()
    const { container } = open()
    await screen.findByTestId('scope-step')
    const filled = (token = /^var\(--region-(selected|all)\)$/) =>
      [...container.querySelectorAll('svg path')].filter((p) => token.test((p as SVGElement).style.fill)).length
    const caption = () => screen.getByText(/^Schematic\./).textContent

    // A fresh device: the whole region, in the all-states fill (quieter in Dark).
    expect(filled(/^var\(--region-all\)$/)).toBe(8)
    expect(caption()).toContain('North-East · all eight states')

    await user.click(screen.getByText('My own console'))
    expect(caption()).toContain('Highlighted: Your account decides.')
    expect(container.querySelectorAll('svg path[style*="ner-hatch"]')).toHaveLength(8)
    expect(filled()).toBe(0)

    await user.click(screen.getByText('A state'))
    await waitFor(() => expect(stateSelect().disabled).toBe(false))
    await user.selectOptions(stateSelect(), 's-megh')
    expect(filled()).toBe(1)
    expect(caption()).toContain('Highlighted: Meghalaya.')
  })

  it('names a district beside its state and never pins it: there is no district geometry', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listRegions').mockResolvedValue([{ ...REGIONS[0], districts: [KAMRUP] }, REGIONS[1]])
    const { container } = open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('A district'))
    await waitFor(() => expect(stateSelect().disabled).toBe(false))
    await user.selectOptions(stateSelect(), 's-assam')
    // The map's drawing (the wordmark's mountain line is an svg too).
    const map = [...container.querySelectorAll('svg')].find((s) => s.getAttribute('viewBox')?.startsWith('24 6'))!.parentElement!
    // A state alone is named by its own label; no callout repeats it.
    expect(map.querySelector(':scope > span')).toBeNull()

    await user.selectOptions(districtSelect(), 'd1')
    expect(map.querySelector(':scope > span')?.textContent).toBe('Assam · Kamrup Metropolitan')
    // The only paths are the eight states and the chosen one's outline: no pin shape.
    expect(map.querySelectorAll('svg path:not([data-edge])')).toHaveLength(8)
    expect(map.querySelectorAll('svg path[data-edge]')).toHaveLength(1)
    expect(map.querySelector('svg circle')).toBeNull()
  })

  it('moves to credentials on Continue, and can go back', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText('North-East'))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.queryByTestId('scope-step')).toBeNull())
    // Focus follows to the new step's heading rather than falling to <body>.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Welcome Back' }))
    // And the chosen scope stays visible, with a way back to it.
    await user.click(screen.getByRole('button', { name: /change region, currently north-east/i }))
    expect(await screen.findByTestId('scope-step')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: /select your operational region/i }))
    expect((screen.getByRole('radio', { name: 'North-East' }) as HTMLInputElement).checked).toBe(true)
  })

  it('skips straight to credentials when the scope was remembered', async () => {
    localStorage.setItem('rasta:workspace', JSON.stringify({ workspace: 'STATE', state: 's-assam', district: '' }))
    open()
    expect(screen.queryByTestId('scope-step')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Change region, currently Assam' })).toBeTruthy()
  })
})

describe('the credentials step', () => {
  async function reachCredentials(scope: string, state?: string, district?: string) {
    const user = userEvent.setup()
    vi.spyOn(api, 'listRegions').mockResolvedValue([{ ...REGIONS[0], districts: [KAMRUP] }, REGIONS[1]])
    open()
    await screen.findByTestId('scope-step')
    await user.click(screen.getByText(scope))
    if (state) {
      await waitFor(() => expect(stateSelect().disabled).toBe(false))
      await user.selectOptions(stateSelect(), state)
    }
    if (district) await user.selectOptions(districtSelect(), district)
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(screen.queryByTestId('scope-step')).toBeNull())
    return user
  }

  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(/email or phone/i), '  manager@example.test ')
    await user.type(screen.getByLabelText(/^password/i), 'pw')
  }

  it('hands the chosen scope to login exactly as before: workspace, state and district', async () => {
    auth.login.mockResolvedValue(undefined)
    const user = await reachCredentials('A district', 's-assam', 'd1')
    await fill(user)
    await user.click(screen.getByRole('button', { name: /log in/i }))
    expect(auth.login).toHaveBeenCalledWith('manager@example.test', 'pw', {
      workspace: 'DISTRICT',
      stateId: 's-assam',
      districtId: 'd1',
    })
    // Remembered for tomorrow morning - the choice, never the account.
    expect(JSON.parse(localStorage.getItem('rasta:workspace')!)).toEqual({
      workspace: 'DISTRICT',
      state: 's-assam',
      district: 'd1',
    })
  })

  it('sends no state or district for North-East, and forgets the region when asked to', async () => {
    auth.login.mockResolvedValue(undefined)
    const user = await reachCredentials('North-East')
    await fill(user)
    await user.click(screen.getByLabelText(/remember this region/i))
    await user.click(screen.getByRole('button', { name: /log in/i }))
    expect(auth.login).toHaveBeenCalledWith('manager@example.test', 'pw', {
      workspace: 'NORTH_EAST',
      stateId: undefined,
      districtId: undefined,
    })
    expect(localStorage.getItem('rasta:workspace')).toBeNull()
  })

  it('keeps Log In disabled until both fields are filled, and says so to assistive tech', async () => {
    const user = await reachCredentials('My own console')
    const button = screen.getByRole('button', { name: /log in/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await user.type(screen.getByLabelText(/email or phone/i), 'a@b.test')
    expect(button.disabled).toBe(true)
    await user.type(screen.getByLabelText(/^password/i), 'x')
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('false')
  })

  it('guards a double submit and says it is signing in', async () => {
    let finish: () => void = () => {}
    auth.login.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const user = await reachCredentials('My own console')
    await fill(user)
    const button = screen.getByRole('button', { name: /log in/i }) as HTMLButtonElement
    await user.click(button)
    expect(button.textContent).toContain('Signing in…')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.disabled).toBe(true)
    fireEvent.submit(button.closest('form')!)
    expect(auth.login).toHaveBeenCalledTimes(1)
    await act(async () => finish())
  })

  it('says the server is waking once a sign-in has waited four seconds', async () => {
    let finish: () => void = () => {}
    auth.login.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const user = await reachCredentials('My own console')
    await fill(user)
    const button = screen.getByRole('button', { name: /log in/i })
    vi.useFakeTimers()
    try {
      fireEvent.submit(button.closest('form')!)
      expect(button.textContent).toContain('Signing in…')
      act(() => vi.advanceTimersByTime(3999))
      expect(button.textContent).toContain('Signing in…')
      act(() => vi.advanceTimersByTime(1))
      expect(button.textContent).toContain('Waking secure server…')
      await act(async () => finish())
    } finally {
      vi.useRealTimers()
    }
    expect(button.textContent).toContain('Log In')
  })

  it.each([
    [new NetworkError(new TypeError('fetch failed')), 'Cannot reach the service. Check your connection and try again.'],
    [new ApiError(401, { error: { message: 'Invalid credentials.' } } as never, 'x'), 'Invalid credentials.'],
    [new Error('boom'), 'Sign in failed. Please try again.'],
  ])('shows the error and clears the password (%s)', async (error, message) => {
    auth.login.mockRejectedValue(error)
    const user = await reachCredentials('My own console')
    await fill(user)
    await user.click(screen.getByRole('button', { name: /log in/i }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect((screen.getByLabelText(/^password/i) as HTMLInputElement).value).toBe('')
  })

  it('says the region is checked too when a sign-in with a scope is refused', async () => {
    // A state or district account that keeps the North-East default is
    // refused like a wrong password; the same line shows for every refusal.
    auth.login.mockRejectedValue(new ApiError(401, { error: { message: 'Invalid credentials.' } } as never, 'x'))
    const user = await reachCredentials('North-East')
    await fill(user)
    await user.click(screen.getByRole('button', { name: /log in/i }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Invalid credentials. The region is checked too: your account must cover North-East.',
    )
  })

  it("says why a driver's restored session was refused", async () => {
    auth.deniedReason = 'This console is for managers. Drivers sign in on the phone app.'
    localStorage.setItem('rasta:workspace', JSON.stringify({ workspace: 'NORTH_EAST', state: '', district: '' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe(auth.deniedReason)
  })

  it('offers no control the product cannot back: no SSO, no password reset', async () => {
    await reachCredentials('My own console')
    expect(screen.queryByText(/sso|single sign|forgot/i)).toBeNull()
    expect(screen.getByText(/ask your administrator for an account/i).closest('a')).toBeNull()
  })

  it('opens the image credits from the footer and gives focus back when closed', async () => {
    const user = await reachCredentials('My own console')
    const trigger = screen.getByRole('button', { name: 'Image credits' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Image credits' })
    expect(dialog.textContent).toContain('JANENDER SINGH')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('scopeSummary', () => {
  it('names the chosen scope', () => {
    expect(scopeSummary('NORTH_EAST', REGIONS, [], '', '')).toBe('North-East')
    expect(scopeSummary('STATE', REGIONS, [], 's-assam', '')).toBe('Assam')
    expect(scopeSummary('', REGIONS, [], '', '')).toBe('My own console')
  })

  it('falls back to the state when no district is chosen yet', () => {
    expect(scopeSummary('DISTRICT', REGIONS, [], 's-megh', '')).toBe('Meghalaya')
  })
})
