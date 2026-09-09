// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
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

vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({
    children,
    style: _style,
    ...rest
  }: {
    children?: import('react').ReactNode
    style?: unknown
    [k: string]: unknown
  }) => h('div', rest, children)
  const input = (props: { value?: string; onChangeText?: (t: string) => void; placeholder?: string }) =>
    h('input', {
      value: props.value,
      placeholder: props.placeholder,
      onChange: (e: { target: { value: string } }) => props.onChangeText?.(e.target.value),
    })
  return {
    View: box,
    ScrollView: box,
    KeyboardAvoidingView: box,
    Pressable: box,
    Text: box,
    TextInput: input,
    ActivityIndicator: () => h('span', null, 'Loading...'),
    Platform: { OS: 'android' },
    StyleSheet: { create: (v: unknown) => v },
  }
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
  host = document.createElement('div')
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
})

async function render() {
  await act(async () => root.render(createElement(LoginScreen)))
}

describe('LoginScreen UI and behavior', () => {
  it('renders branding and driver title', async () => {
    await render()
    expect(host.textContent).toContain('NER LOGISTICS')
    expect(host.textContent).toContain('DRIVER')
    // The support line the design brief specifies. It replaced two stacked
    // lines ("Safe routes. Connected fleet." plus "Sign in to continue your
    // journey") that said the same thing twice and pushed the phone field down
    // a 390pt screen. Still asserted, because a login with no explanation of
    // what it gates is the defect this line exists to prevent.
    expect(host.textContent).toContain(
      'Secure access to your assigned vehicle and trips.',
    )
    expect(host.textContent).toContain('Mobile number')
    expect(host.textContent).toContain('Password')
  })

  it('omits connection/server details in production mode', async () => {
    await render()
    expect(host.textContent).not.toContain('Server: http')
    expect(host.textContent).not.toContain('Server: https')
    expect(host.textContent).not.toContain('Hide connection details')
  })
})
