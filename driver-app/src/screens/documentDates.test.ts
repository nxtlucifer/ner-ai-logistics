import { describe, expect, it } from 'vitest'

import { autoFormat, checkDates, isCalendarDate } from './documentDates'

describe('autoFormat', () => {
  it('inserts the separators a numeric keypad cannot type', () => {
    expect(autoFormat('2024')).toBe('2024')
    expect(autoFormat('202401')).toBe('2024-01')
    expect(autoFormat('20240131')).toBe('2024-01-31')
  })

  it('is idempotent, so re-rendering the value does not corrupt it', () => {
    expect(autoFormat(autoFormat('20240131'))).toBe('2024-01-31')
  })

  it('ignores anything that is not a digit and stops at eight', () => {
    expect(autoFormat('2024-01-31')).toBe('2024-01-31')
    expect(autoFormat('abc2024xx0131zz')).toBe('2024-01-31')
    expect(autoFormat('202401319999')).toBe('2024-01-31')
  })

  it('lets a driver delete backwards', () => {
    // Deleting the last digit must not immediately re-add a hyphen and
    // trap the cursor.
    expect(autoFormat('2024-01-3')).toBe('2024-01-3')
    expect(autoFormat('2024-01-')).toBe('2024-01')
  })
})

describe('isCalendarDate', () => {
  it('accepts a real date', () => {
    expect(isCalendarDate('2024-01-31')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true) // a leap year
  })

  it('rejects a date the calendar does not have', () => {
    // `new Date('2024-02-31')` silently becomes 2 March. A licence must not
    // be recorded as expiring on a day that does not exist.
    expect(isCalendarDate('2024-02-31')).toBe(false)
    expect(isCalendarDate('2023-02-29')).toBe(false)
    expect(isCalendarDate('2024-13-01')).toBe(false)
    expect(isCalendarDate('2024-00-10')).toBe(false)
  })

  it('rejects the wrong shape', () => {
    expect(isCalendarDate('31-01-2024')).toBe(false)
    expect(isCalendarDate('2024-1-1')).toBe(false)
    expect(isCalendarDate('hello')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })

  it('rejects years nobody meant to type', () => {
    expect(isCalendarDate('0024-01-31')).toBe(false)
    expect(isCalendarDate('9024-01-31')).toBe(false)
  })
})

describe('checkDates', () => {
  it('says nothing when both are blank, because both are optional', () => {
    expect(checkDates('', '')).toEqual({})
  })

  it('catches a half-typed date before it reaches the server', () => {
    expect(checkDates('2024-01', '')).toHaveProperty('issued')
  })

  it('refuses an expiry before the issue date', () => {
    const problems = checkDates('2028-01-31', '2024-01-31')
    expect(problems.expires).toMatch(/before the issue date/i)
  })

  it('allows the same day for both', () => {
    expect(checkDates('2024-01-31', '2024-01-31')).toEqual({})
  })

  it('does not invent an ordering complaint when one date is malformed', () => {
    // Two messages about one typo is noise; fix the format first.
    const problems = checkDates('31-01-2024', '2020-01-01')
    expect(problems.issued).toBeDefined()
    expect(problems.expires).toBeUndefined()
  })
})
