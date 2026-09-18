/**
 * The timeline must read as what happened, in the words a manager would use.
 *
 * The defect this closes: an ACCEPTED event carries the instruction it
 * acknowledges, so the driver's own acknowledgement was titled "Stop added …
 * awaiting driver acknowledgement" - the line contradicting itself.
 */
import { describe, expect, it } from 'vitest'

import { historyLines } from './JourneyHistory'
import type { TripEvent } from '../api/client'

const ev = (over: Partial<TripEvent>): TripEvent => ({
  id: 1, kind: 'CREATED', description: null, occurred_at: '2026-09-18T11:20:00Z',
  actor_name: 'Demo Manager', instruction: null, reason: null, acknowledged: false, ...over,
})

describe('historyLines', () => {
  it('names a manager instruction and whether the cab has seen it', () => {
    const [waiting] = historyLines([ev({ kind: 'ROUTE_CHANGED', instruction: 'ADD_STOP', reason: 'Weighbridge check' })])
    expect(waiting.title).toBe('Stop added')
    expect(waiting.ack).toBe('WAITING')
    expect(waiting.detail).toBe('Weighbridge check')

    const [done] = historyLines([ev({ kind: 'ROUTE_CHANGED', instruction: 'ADD_STOP', acknowledged: true })])
    expect(done.ack).toBe('DONE')
  })

  it('titles the driver acknowledgement as one, never as the instruction', () => {
    const [line] = historyLines([ev({ kind: 'ACCEPTED', instruction: 'ADD_STOP', description: 'Driver acknowledged: ADD_STOP' })])
    expect(line.title).toBe('Driver acknowledged')
    expect(line.ack).toBeNull()
  })

  it('uses plain words for the enum, and falls back rather than crashing', () => {
    expect(historyLines([ev({ kind: 'STOP_COMPLETED' })])[0].title).toBe('Stop completed')
    expect(historyLines([ev({ kind: 'SOMETHING_NEW' })])[0].title).toBe('SOMETHING NEW')
  })
})
