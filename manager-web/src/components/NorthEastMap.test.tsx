// @vitest-environment jsdom
/**
 * The sign-in / Overview map is the real North-East: the eight states from the
 * Survey of India boundaries, never stretched, and drawn without a request.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NorthEastMap } from './NorthEastMap'
import { NER_STATES, NER_VIEW } from './northEastStates'

afterEach(cleanup)

const EIGHT = ['Arunachal Pradesh', 'Assam', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Tripura']
const shapes = (c: HTMLElement) => [...c.querySelectorAll('path[data-state]')] as SVGPathElement[]
const lit = (c: HTMLElement) => shapes(c).filter((p) => /--region-(selected|all)/.test(p.style.fill)).map((p) => p.dataset.state)

describe('NorthEastMap', () => {
  it('draws exactly the eight states, each once, named, from the boundary data', () => {
    const { container } = render(<NorthEastMap highlight="all" />)
    expect(shapes(container).map((p) => p.dataset.state).sort()).toEqual(EIGHT)
    expect(NER_STATES.map((s) => s.name).sort()).toEqual(EIGHT)
    const labels = [...container.querySelectorAll('text')].map((t) => t.textContent)
    expect(labels).toEqual(expect.arrayContaining(['ArunachalPradesh', 'Assam', 'Sikkim', 'Tripura']))
    // Real outlines carry hundreds of points; the hand-traced ones had ~20.
    for (const s of NER_STATES) expect((s.d.match(/L/g) ?? []).length).toBeGreaterThan(150)
    // The retired schematic's Sikkim began here.
    expect(container.innerHTML).not.toContain('M42,242')
  })

  it('keeps the proportions: one viewBox, never stretched', () => {
    const { container } = render(<NorthEastMap highlight={null} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(svg.getAttribute('viewBox')).toBe(`${NER_VIEW.x} ${NER_VIEW.y} ${NER_VIEW.w} ${NER_VIEW.h}`)
    // Sikkim stays small and west; Assam stays long east-west; Arunachal north of Assam.
    const box = (name: string) => {
      const xs: number[] = [], ys: number[] = []
      for (const [, x, y] of NER_STATES.find((s) => s.name === name)!.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) { xs.push(+x); ys.push(+y) }
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
    }
    const sik = box('Sikkim'), asm = box('Assam'), aru = box('Arunachal Pradesh'), miz = box('Mizoram')
    expect(sik.x1).toBeLessThan(asm.x0)
    expect((sik.x1 - sik.x0) * (sik.y1 - sik.y0)).toBeLessThan(((asm.x1 - asm.x0) * (asm.y1 - asm.y0)) / 10)
    expect(asm.x1 - asm.x0).toBeGreaterThan(1.5 * (asm.y1 - asm.y0))
    expect(aru.y0).toBeLessThan(asm.y0)
    expect(miz.y1).toBeGreaterThan(asm.y1)
  })

  it('North-East lights all eight; a state lights only itself; nothing chosen lights none', () => {
    const { container, rerender } = render(<NorthEastMap highlight="all" />)
    expect(lit(container)).toHaveLength(8)
    rerender(<NorthEastMap highlight="Meghalaya" />)
    expect(lit(container)).toEqual(['Meghalaya'])
    rerender(<NorthEastMap highlight={null} />)
    expect(lit(container)).toEqual([])
  })

  it('is decoration for assistive tech, and asks the network for nothing', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { container } = render(<NorthEastMap highlight="Assam" callout="Kamrup Metro" />)
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
