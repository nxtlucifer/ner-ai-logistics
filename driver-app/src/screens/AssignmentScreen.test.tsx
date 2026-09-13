// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true })
  return { assignment: vi.fn(), verify: vi.fn() }
})
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react')
  const box = ({ children }: { children?: import('react').ReactNode }) => h('div', null, children)
  return { View: box, ScrollView: box, Pressable: box, Text: box, SafeAreaView: box, RefreshControl: () => null,
    Image: () => h('img'), StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 } }
})
vi.mock('../api/client', () => ({ api: { myAssignment: () => state.assignment(), verifyAssignment: (...a: unknown[]) => state.verify(...a) } }))
vi.mock('../files/pick', () => ({ pickPhoto: vi.fn(), upload: vi.fn() }))
vi.mock('../files/useAuthImage', () => ({ useAuthImage: (u: string | null) => u }))
vi.mock('../i18n/tx', () => ({ useT: () => (en: string) => en }))
vi.mock('../theme', () => ({ TOUCH_TARGET: 48 }))
vi.mock('../theme-context', () => ({ makeStyles: () => () => ({}), useTheme: () => ({ colors: {} }) }))
vi.mock('../components/ui', async () => {
  const { createElement: h } = await import('react')
  return {
    Banner: () => null, Loading: () => null, errorMessage: () => ({ title: 'x', detail: 'y' }),
    Button: ({ label, disabled }: { label: string; disabled?: boolean }) => h('button', { disabled: !!disabled }, label),
    Row: ({ label, value }: { label: string; value: unknown }) => h('div', null, `${label}: ${String(value)}`),
    Field: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) =>
      h('input', { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChangeText(e.target.value) }),
  }
})
import AssignmentScreen from './AssignmentScreen'

let root: Root
let host: HTMLDivElement
const base = { id: 'a1', status: 'PENDING_VERIFICATION', assigned_at: '', verified_at: null, mismatch_flagged: false,
  truck: { id: 't1', registration_number: 'AS86QQ7606' }, verification_photo_url: null, verification_source: null }

async function render(assignment: object) {
  state.assignment.mockResolvedValue(assignment)
  await act(async () => root.render(createElement(AssignmentScreen)))
  await act(async () => { await Promise.resolve() })
}
function confirmButton(): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((b) => b.textContent === 'Confirm this truck') as HTMLButtonElement
}
async function typePlate(v: string) {
  const input = host.querySelector('input[aria-label="Registration on the truck"]') as HTMLInputElement
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => { host = document.createElement('div'); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()) })

describe('the truck check', () => {
  it('offers no Confirm until a photo is on the assignment - even with the plate typed', async () => {
    await render(base)
    expect(host.textContent).toContain('Take a photo of the truck before you verify.')
    await typePlate('AS86QQ7606')
    expect(confirmButton().disabled).toBe(true)
  })

  it('needs the plate as well as the photo', async () => {
    await render({ ...base, verification_photo_url: '/api/files/f1' })
    expect(host.textContent).toContain('Photo uploaded')
    expect(confirmButton().disabled).toBe(true)
    await typePlate('AS86QQ7606')
    expect(confirmButton().disabled).toBe(false)
  })
})
