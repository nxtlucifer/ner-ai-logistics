import { describe, expect, it } from 'vitest'

import { labelsToHide, type LabelBox } from './markerLabels'

const box = (id: string, priority: number, left: number, top: number, width = 100, height = 20): LabelBox => ({
  id, priority, left, top, right: left + width, bottom: top + height,
})

describe('labelsToHide', () => {
  it('keeps the LIVE label where a NO CONTACT one would cover it (MAP-1)', () => {
    const noContact = box('rina', 1, 100, 100)
    const live = box('tenzing', 3, 140, 110)
    expect([...labelsToHide([noContact, live])]).toEqual(['rina'])
  })

  it('drops only what overlaps: apart, or merely touching, every label shows', () => {
    expect(labelsToHide([box('a', 1, 0, 0), box('b', 1, 100, 0), box('c', 1, 0, 20)]).size).toBe(0)
  })

  it('places in priority order, so a dropped label does not block a later one', () => {
    // b is dropped under a; c overlaps only b, so c shows.
    const hidden = labelsToHide([box('a', 3, 0, 0), box('b', 2, 50, 10), box('c', 1, 140, 25)])
    expect([...hidden]).toEqual(['b'])
  })
})
