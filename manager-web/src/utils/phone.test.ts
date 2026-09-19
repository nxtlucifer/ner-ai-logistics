import { describe, expect, it } from 'vitest'

import { maskPhone, maskPhonesIn } from './phone'

describe('phone masking (E2E-R1)', () => {
  it('keeps only the last two digits', () => {
    expect(maskPhone('+919435012345')).toBe('+' + '•'.repeat(10) + '45')
  })

  it('masks exactly the given numbers inside a server sentence, and nothing else', () => {
    const line = '1. Attempt voice contact with driver at +919435012345 on 2026-09-28 14:52'
    const masked = maskPhonesIn(line, ['+919435012345', null])
    expect(masked).toBe(`1. Attempt voice contact with driver at +${'•'.repeat(10)}45 on 2026-09-28 14:52`)
    expect(masked).not.toContain('9435012345')
  })
})
