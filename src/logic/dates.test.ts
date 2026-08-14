import { describe, it, expect } from 'vitest'
import { daysBetween, relativeDay } from './dates.ts'

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
