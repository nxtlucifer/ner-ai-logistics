// @vitest-environment jsdom
/**
 * The server's geography refusals read as sentences, on every page (P1R-19).
 *
 * Where a trip may go is decided on the server (inside India, one end in the
 * North-East, a domestic road that stays inside India). ErrorState and
 * InlineError share describeError, so the planner, the route panel and any
 * inline failure say the same words for the same code.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ApiError } from '../api/client'
import { InlineError, describeError as fromPageKit } from './pageKit'
import { ErrorState, describeError } from './ui'

afterEach(cleanup)

const refusal = (status: number, code: string, details: Record<string, unknown> = {}) =>
  new ApiError(status, { error: { code, message: `raw ${code}`, details } }, 'fallback')

describe('describeError', () => {
  it.each([
    [refusal(422, 'OUTSIDE_SUPPORTED_COUNTRY', { field: 'pickup' }), 'Outside the supported country', /^The pickup is outside India/, false],
    [refusal(422, 'OUTSIDE_SUPPORTED_COUNTRY', { field: 'destination' }), 'Outside the supported country', /^The destination is outside India/, false],
    [refusal(422, 'OUTSIDE_SUPPORTED_COUNTRY'), 'Outside the supported country', /^This place is outside India/, false],
    [refusal(422, 'NOT_NER_CONNECTED', { scope_type: 'INDIA_EXTERNAL' }), 'Not connected to the North-East', /start or end in one of the eight North-East states/, false],
    [refusal(422, 'BORDER_AMBIGUOUS', { field: 'destination' }), 'Too close to the border to confirm', /^The destination is too close to the international border/, false],
    [refusal(503, 'GEOGRAPHY_UNAVAILABLE'), 'Geography check unavailable', /country boundary data is not loaded/, true],
    [refusal(422, 'ROUTE_CROSSES_COUNTRY_BOUNDARY'), 'Route leaves India', /crosses an international boundary/, false],
    [refusal(422, 'HOLD_AND_REVIEW'), 'Held for review', /held for a manager's review/, false],
  ])('%#: %s reads as "%s"', (error, title, detail, retryable) => {
    const words = describeError(error)
    expect(words.title).toBe(title)
    expect(words.detail).toMatch(detail)
    expect(words.detail).not.toContain('raw ')
    expect(words.retryable).toBe(retryable)
  })

  it("keeps the server's own message for every other code", () => {
    expect(describeError(refusal(422, 'NO_VIABLE_ROUTE'))).toEqual({ title: 'Something went wrong', detail: 'raw NO_VIABLE_ROUTE', retryable: false })
    expect(describeError(refusal(503, 'ROUTING_UNAVAILABLE'))).toEqual({ title: 'Service unavailable', detail: 'raw ROUTING_UNAVAILABLE', retryable: true })
    expect(describeError(refusal(409, 'SHIPMENT_EXISTS')).title).toBe('Conflict')
  })

  it('is one function behind both error components', () => {
    expect(fromPageKit).toBe(describeError)
    const error = refusal(422, 'NOT_NER_CONNECTED')
    const { unmount } = render(<ErrorState error={error} />)
    expect(screen.getByRole('alert').textContent).toContain('Not connected to the North-East')
    unmount()
    render(<InlineError error={error} />)
    expect(screen.getByRole('alert').textContent).toContain('Not connected to the North-East')
  })
})
