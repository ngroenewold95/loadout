import { describe, it, expect } from 'vitest'
import { daysAgo, daysBetween, relativeDay, startOfWeek } from './dates.ts'

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-08-13', '2026-08-13')).toBe(0)
    expect(daysBetween('2026-08-12', '2026-08-13')).toBe(1)
    expect(daysBetween('2026-07-22', '2026-08-13')).toBe(22)
  })

  it('crosses month and year boundaries', () => {
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1)
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2) // leap year
  })

  it('is exact across a daylight-saving change', () => {
    // The reason both sides are parsed as UTC midnight. A local-time
    // construction loses or gains an hour here, and rounding then reports 8 or
    // 10 days for a nine-day gap depending on which way the clocks went.
    expect(daysBetween('2026-03-04', '2026-03-13')).toBe(9)
    expect(daysBetween('2026-10-30', '2026-11-08')).toBe(9)
  })

  it('returns 0 rather than NaN for a malformed date', () => {
    expect(daysBetween('not-a-date', '2026-08-13')).toBe(0)
  })
})

describe('relativeDay', () => {
  it('names the recent days', () => {
    expect(relativeDay('2026-08-13', '2026-08-13')).toBe('today')
    expect(relativeDay('2026-08-12', '2026-08-13')).toBe('yesterday')
    expect(relativeDay('2026-07-27', '2026-08-13')).toBe('17 days ago')
  })

  it('switches to months, then years', () => {
    expect(relativeDay('2026-06-13', '2026-08-13')).toBe('2 months ago')
    expect(relativeDay('2024-08-13', '2026-08-13')).toBe('2 years ago')
    // Exactly a year is the seam, and a wider months branch renders it
    // "12 months ago". That is what this assertion is here to hold down.
    expect(relativeDay('2025-08-13', '2026-08-13')).toBe('1 year ago')
    expect(relativeDay('2025-03-13', '2026-08-13')).toBe('1 year ago')
  })

  it('treats a future date as today', () => {
    // A session dated ahead of the clock is a device-clock problem. Saying
    // "in 3 days" about something already logged would be worse than saying
    // nothing useful.
    expect(relativeDay('2026-08-20', '2026-08-13')).toBe('today')
  })
})

describe('daysAgo', () => {
  it('walks back across month and year ends', () => {
    expect(daysAgo('2026-08-15', 0)).toBe('2026-08-15')
    expect(daysAgo('2026-08-15', 27)).toBe('2026-07-19')
    expect(daysAgo('2026-01-01', 1)).toBe('2025-12-31')
  })

  it('leaves an unparseable date alone', () => {
    // A bad boundary can then only widen a query, never silently shift it.
    expect(daysAgo('not-a-date', 7)).toBe('not-a-date')
  })
})

describe('startOfWeek', () => {
  it('finds the Monday, including from the Monday itself', () => {
    // 2026-08-15 is a Saturday, 2026-08-10 the Monday before it.
    expect(startOfWeek('2026-08-15')).toBe('2026-08-10')
    expect(startOfWeek('2026-08-10')).toBe('2026-08-10')
  })

  /** Sunday is the end of its week here, not the start of the next one. */
  it('treats Sunday as six days in', () => {
    expect(startOfWeek('2026-08-16')).toBe('2026-08-10')
  })
})
