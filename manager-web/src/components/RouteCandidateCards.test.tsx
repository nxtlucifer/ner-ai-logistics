// @vitest-environment jsdom
/**
 * E2E-R2: a road re-planned mid-trip starts where the truck was. It is not
 * FASTEST or SHORTEST against a road from the pickup, and its card says why.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import type { TripRoute } from '../api/client'
import { RouteCandidateCards, type Candidate } from './RouteCandidateCards'

afterEach(cleanup)

const road = (over: Partial<TripRoute>): Candidate => ({
  route: {
    id: 'r',
    kind: 'PRIMARY',
    state: 'PROPOSED',
    distance_km: '97.21',
    estimated_duration_min: 72,
    routing_provider: 'osrm',
    created_at: '2026-09-28T08:35:00Z',
    geometry: [[26.18, 91.75], [25.57, 91.88]],
    is_current: false,
    ...over,
  },
  assessed: null,
  authorization: null,
})

const draw = (candidates: Candidate[]) =>
  render(
    <RouteCandidateCards
      candidates={candidates}
      recommendedRouteId={null}
      inTransit
      rerouting
      choosingId={null}
      previewId={null}
      onPreview={() => {}}
      onChoose={() => {}}
      approvingId={null}
      onApproving={() => {}}
      onApprove={() => {}}
    />,
  )

it('chips no FASTEST or SHORTEST across different starts, and says the backup starts elsewhere', () => {
  draw([
    road({ id: 'full', is_current: true, state: 'SELECTED' }),
    road({ id: 'backup', kind: 'EMERGENCY_BACKUP', distance_km: '75.05', estimated_duration_min: 60, geometry: [[26.03, 91.87], [25.57, 91.88]] }),
  ])
  expect(screen.queryByText('FASTEST')).toBeNull()
  expect(screen.queryByText('SHORTEST')).toBeNull()
  expect(screen.getAllByTestId('starts-elsewhere')).toHaveLength(1)
  expect(screen.getByTestId('route-card-backup').textContent).toContain('not compared')
})

it('still names the fastest and the shortest of roads from the same start', () => {
  draw([
    road({ id: 'a', distance_km: '97.21', estimated_duration_min: 72 }),
    road({ id: 'b', kind: 'FUEL_EFFICIENT', distance_km: '105.5', estimated_duration_min: 70, geometry: [[26.181, 91.751], [25.57, 91.88]] }),
  ])
  expect(screen.getByTestId('route-card-b').textContent).toContain('FASTEST')
  expect(screen.getByTestId('route-card-a').textContent).toContain('SHORTEST')
  expect(screen.queryByTestId('starts-elsewhere')).toBeNull()
})
