// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { StatusPill } from './ui'

const toneOf = (status: string) => {
  const { container } = render(<StatusPill status={status} />)
  const cls = container.firstElementChild!.className
  cleanup()
  return ['ok', 'route', 'warning', 'danger'].find((t) => cls.includes(`text-${t}`)) ?? 'neutral'
}

describe('StatusPill tone', () => {
  afterEach(cleanup)

  it('reads every server trip status in the product colour rule', () => {
    // red = emergency: the sentinel's SOS state never looks like a draft.
    expect(toneOf('INCIDENT')).toBe('danger')
    expect(toneOf('MANAGER_REVIEW')).toBe('warning')
    expect(toneOf('DELAYED')).toBe('warning')
    expect(toneOf('ACTIVE')).toBe('route')
    expect(toneOf('DELIVERED')).toBe('ok')
  })

  it('never paints an unknown or unassessed state green', () => {
    for (const s of ['UNKNOWN', 'NOT_ASSESSED', 'NOT_CHECKED', 'SOMETHING_NEW']) expect(toneOf(s)).not.toBe('ok')
  })
})
