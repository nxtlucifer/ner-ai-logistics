// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return { openURL: vi.fn(async () => {}) }
})

const mockLogin = vi.fn()

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    login: mockLogin,
    driver: null,
    isInitialising: false,
    logout: vi.fn(),
  }),
}))

type Props = {
  children?: import('react').ReactNode
  accessibilityLabel?: string
  accessibilityRole?: string
  testID?: string
  [k: string]: unknown
}

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  // Only the props a test reads reach the DOM: the name, the role and the id.
  const box = ({ children, accessibilityLabel, accessibilityRole, testID }: Props) =>
    h('div', { 'aria-label': accessibilityLabel, 'data-role': accessibilityRole, 'data-testid': testID }, children)
  const pressable = ({ children, onPress, disabled, accessibilityLabel, accessibilityRole, testID, ...rest }: Props & { onPress?: () => void; disabled?: boolean }) =>
    h(
      'button',
      {
        onClick: disabled ? undefined : onPress,
        disabled,
        'aria-disabled': rest['aria-disabled'] ? 'true' : undefined,
        'aria-label': accessibilityLabel,
        'data-role': accessibilityRole,
        'data-testid': testID,
      },
      children,
    )
  const input = (props: { value?: string; onChangeText?: (t: string) => void; placeholder?: string; maxLength?: number; secureTextEntry?: boolean; accessibilityLabel?: string }) =>
    h('input', {
      value: props.value,
      placeholder: props.placeholder,
      maxLength: props.maxLength,
      type: props.secureTextEntry ? 'password' : 'text',
      'aria-label': props.accessibilityLabel,
      onChange: (e: { target: { value: string } }) => props.onChangeText?.(e.target.value),
    })
  return {
    View: box,
    Image: () => null,
    // Marked, so a test can tell what scrolls away from what stays put.
    ScrollView: ({ children }: Props) => h('div', { 'data-scroll': 'true' }, children),
    KeyboardAvoidingView: box,
    Pressable: pressable,
    Text: box,
    TextInput: input,
    ActivityIndicator: () => h('span', null, 'Loading...'),
    // Honours `visible`, so the language sheet is absent from the tree until
    // it is opened. A Modal mock that always renders its children would let a
    // closed sheet satisfy a query for on-screen text.
    Modal: ({ visible, children }: { visible?: boolean; children?: import('react').ReactNode }) =>
      visible ? h('div', null, children) : null,
    Linking: { openURL: state.openURL },
    Platform: { OS: 'android' },
    StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
    useWindowDimensions: () => ({ width: 360, height: 640 }),
  }
})

vi.mock('react-native-safe-area-context', async () => {
  const { createElement: h } = await import('react')
  return { SafeAreaView: ({ children }: Props) => h('div', null, children) }
})

vi.mock('../components/ui', async () => {
  const { createElement: h } = await import('react')
  return {
    Banner: ({ title, detail }: { title: string; detail: string }) =>
      h('div', { 'data-testid': 'banner' }, `${title}: ${detail}`),
  }
})

import LoginScreen from './LoginScreen'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  mockLogin.mockReset()
  state.openURL.mockClear()
  host = document.createElement('div')
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
})

async function render() {
  await act(async () => root.render(createElement(LoginScreen)))
}

const inputs = () => [...host.querySelectorAll('input')] as HTMLInputElement[]
const button = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
const submit = () => host.querySelector('[data-testid="login-submit"]') as HTMLButtonElement

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('LoginScreen UI and behavior', () => {
  it('lets a manager type a full e-mail: the 16-char phone cap lifts on "@"', async () => {
    // Found on the phone (14 Sep): maxLength={16} silently truncated the
    // manager e-mail to 16 characters and every manager login "failed".
    await render()
    expect(inputs()[0].maxLength).toBe(16)
    await type(inputs()[0], 'dispatch.manager@fleet.example')
    expect(inputs()[0].maxLength).toBe(120)
  })

  it('renders the centred brand stack and the two labelled fields, and no extra heading', async () => {
    await render()
    expect(host.textContent).toContain('RASTA AI')
    expect(host.textContent).toContain('NER LOGISTICS')
    expect(host.textContent).toContain('Mobile number')
    expect(host.textContent).toContain('Password')
    // driver_01 has no DRIVER / Welcome back block over the card.
    expect(host.textContent).not.toContain('DRIVER')
    expect(host.textContent).not.toContain('Welcome back')
  })

  it('explains what the sign-in gates instead of offering a reset it does not have', async () => {
    await render()
    expect(host.textContent).toContain('Need access? Contact your fleet manager')
    expect(host.textContent).not.toMatch(/forgot/i)
  })

  it('shows a fixed +91 label and a placeholder with no number in it', async () => {
    await render()
    const phone = inputs()[0]
    expect(phone.placeholder).toBe('10-digit mobile number')
    // No real or demo number, even as a placeholder.
    expect(phone.placeholder).not.toMatch(/\d{3}/)
    expect(host.textContent).toContain('+91')
    // Not a country picker: nothing pressable carries it.
    expect([...host.querySelectorAll('button')].some((b) => b.textContent?.includes('+91'))).toBe(false)
    await type(phone, 'dispatch.manager@fleet.example')
    expect(host.textContent).not.toContain('+91')
  })

  it('the eye shows and hides the password, and says which it will do', async () => {
    await render()
    expect(inputs()[1].type).toBe('password')
    await act(async () => button('Show password')!.click())
    expect(inputs()[1].type).toBe('text')
    expect(button('Hide password')).not.toBeNull()
    await act(async () => button('Hide password')!.click())
    expect(inputs()[1].type).toBe('password')
  })

  it('keeps Sign In disabled until both fields are complete, then signs in once', async () => {
    let finish!: () => void
    mockLogin.mockImplementation(() => new Promise<void>((done) => { finish = done }))
    await render()
    expect(submit().disabled).toBe(true)
    expect(submit().getAttribute('aria-disabled')).toBe('true')
    await type(inputs()[0], '98765 43210')
    expect(submit().disabled).toBe(true)
    await type(inputs()[1], '  secret  ')
    expect(submit().disabled).toBe(false)
    expect(submit().getAttribute('aria-disabled')).toBeNull()

    await act(async () => submit().click())
    expect(mockLogin).toHaveBeenCalledWith('9876543210', 'secret')
    // In flight: the double-submit guard holds the button.
    expect(submit().disabled).toBe(true)
    expect(host.textContent).toContain('Signing in…')
    await act(async () => finish())
    expect(mockLogin).toHaveBeenCalledTimes(1)
  })

  it('a failed sign-in shows the banner and clears the password', async () => {
    mockLogin.mockRejectedValue(Object.assign(new Error('nope'), { name: 'ApiError', status: 401 }))
    await render()
    await type(inputs()[0], '9876543210')
    await type(inputs()[1], 'wrong')
    await act(async () => submit().click())
    expect(host.querySelector('[data-testid="banner"]')).not.toBeNull()
    expect(inputs()[1].value).toBe('')
  })

  it('the language pill opens the real language sheet', async () => {
    await render()
    expect(host.textContent).not.toContain('All languages')
    await act(async () => button('Language: English. Opens language chooser')!.click())
    expect(host.textContent).toContain('All languages')
  })

  it('the trust row is three statements with no figures, read as one group', async () => {
    await render()
    const group = host.querySelector('[aria-label="Safer Deliveries. Smarter Logistics. Stronger India"]')
    expect(group).not.toBeNull()
    expect(group!.textContent).not.toMatch(/\d/)
    expect(group!.querySelectorAll('button')).toHaveLength(0)
  })

  it('shows no credit control or credit text on the photo; the language pill stays outside the scroll', async () => {
    await render()
    // Company showcase (1 Oct 2026): the photo's attribution lives under
    // More -> Legal & attributions, not on the sign-in screen.
    expect(button('Photo credits')).toBeFalsy()
    expect(button('Language: English. Opens language chooser')!.closest('[data-scroll]')).toBeNull()
    expect(host.querySelector('input')!.closest('[data-scroll]')).not.toBeNull()
    expect(host.textContent).not.toContain('JANENDER SINGH')
  })

  it('omits connection/server details in production mode', async () => {
    await render()
    expect(host.textContent).not.toContain('Server: http')
    expect(host.textContent).not.toContain('Server: https')
    expect(host.textContent).not.toContain('Hide connection details')
  })
})
