// @vitest-environment jsdom
/**
 * The approval panel is a dialog, so opening it must take the keyboard (and a
 * screen reader) to it. It opens far down a long review page; a manager who
 * pressed "Review & approve route" and heard nothing change would be left
 * tabbing through the evidence to find where the decision is.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { RouteRiskSummary } from '../api/client'
import { RouteApprovalDialog } from './RouteApprovalDialog'

afterEach(cleanup)

const risk = { unavailable: ['landslide'] } as unknown as RouteRiskSummary

describe('RouteApprovalDialog', () => {
  it('moves focus into the dialog when it opens', () => {
    render(<RouteApprovalDialog risk={risk} reasons={['Live landslide reports are not available.']} busy={false} error={null} onCancel={() => {}} onApprove={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Manager Decision' })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})
