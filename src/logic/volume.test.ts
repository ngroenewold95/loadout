import { describe, it, expect } from 'vitest'
import {
  calendarDays,
  calendarGrid,
  muscleWeeks,
  OTHER,
  periodOverPeriod,
  weeklyVolume,
  type VolumeRow,
} from './volume.ts'

const row = (localDate: string, volumeKg: number | null): VolumeRow => ({ localDate, volumeKg })

// A Wednesday, so the Monday boundary is doing visible work in every case.
const TODAY = '2026-08-26'

describe('weeklyVolume', () => {
  it('buckets sessions into Monday weeks, oldest first', () => {
    const weeks = weeklyVolume(
      [
        row('2026-08-24', 1000), // Monday of this week
        row('2026-08-26', 500), // Wednesday of this week
        row('2026-08-20', 800), // the week before
      ],
      TODAY,
      3,
    )

    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-08-10', '2026-08-17', '2026-08-24'])
    expect(weeks.map((w) => w.volumeKg)).toEqual([0, 800, 1500])
    expect(weeks.map((w) => w.sessions)).toEqual([0, 1, 2])
  })

  /**
   * The point of seeding the buckets. A fortnight off is a fact about training
   * and has to draw as zero, or the line runs straight over it.
   */
  it('keeps a week with no training as a zero rather than a gap', () => {
    const weeks = weeklyVolume([row('2026-08-26', 900)], TODAY, 4)
    expect(weeks).toHaveLength(4)
    expect(weeks.slice(0, 3).every((w) => w.volumeKg === 0 && w.sessions === 0)).toBe(true)
  })

  it('ignores a session older than the window instead of folding it into the first week', () => {
    const weeks = weeklyVolume([row('2025-01-01', 5000), row('2026-08-26', 100)], TODAY, 2)
    expect(weeks.map((w) => w.volumeKg)).toEqual([0, 100])
  })

  /** A session whose sets were all deleted comes back with a null volume. */
  it('treats a null volume as zero', () => {
    const weeks = weeklyVolume([row('2026-08-26', null)], TODAY, 1)
    expect(weeks[0]).toMatchObject({ volumeKg: 0, sessions: 1 })
  })
})

describe('periodOverPeriod', () => {
  it('compares the last four weeks with the four before them', () => {
    const comparison = periodOverPeriod(
      [
        row('2026-08-26', 1000), // in the current 28 days
        row('2026-08-01', 500), // also current: 26 days back
        row('2026-07-20', 1000), // previous period
        row('2026-05-01', 9999), // older than both, ignored
      ],
      TODAY,
    )

    expect(comparison.currentKg).toBe(1500)
    expect(comparison.previousKg).toBe(1000)
    expect(comparison.changePct).toBe(50)
  })

  it('has no percentage to report before there is a period to compare with', () => {
    const comparison = periodOverPeriod([row('2026-08-26', 1000)], TODAY)
    expect(comparison.previousKg).toBe(0)
    expect(comparison.changePct).toBeNull()
  })
})

describe('calendarDays', () => {
  const day = (localDate: string, volumeKg: number, setCount = 2, sessionId = 1) => ({
    localDate,
    volumeKg,
    setCount,
    sessionId,
  })

  it('runs from a Monday to today, with untrained days present and empty', () => {
    const days = calendarDays([day('2026-08-24', 900)], TODAY, 2)

    // Two weeks back to Monday the 17th, up to Wednesday the 26th.
    expect(days[0].localDate).toBe('2026-08-17')
    expect(days.at(-1)?.localDate).toBe(TODAY)
    expect(days).toHaveLength(10)

    const trained = days.filter((d) => d.sets > 0)
    expect(trained.map((d) => d.localDate)).toEqual(['2026-08-24'])
    expect(days.find((d) => d.localDate === '2026-08-25')).toMatchObject({
      volumeKg: 0,
      sets: 0,
      sessionId: null,
    })
  })

  it('adds up two workouts on the same day', () => {
    const days = calendarDays(
      [day('2026-08-24', 900, 2, 10), day('2026-08-24', 100, 3, 11)],
      TODAY,
      1,
    )
    const monday = days.find((d) => d.localDate === '2026-08-24')
    expect(monday).toMatchObject({ volumeKg: 1000, sets: 5, sessionId: 11 })
  })

  it('ignores a session older than the window', () => {
    const days = calendarDays([day('2025-01-01', 5000)], TODAY, 1)
    expect(days.every((d) => d.sets === 0)).toBe(true)
  })
})

describe('calendarGrid', () => {
  it('cuts the run into columns of seven, padding the short last week', () => {
    const grid = calendarGrid(calendarDays([], TODAY, 2))
    expect(grid).toHaveLength(2)
    expect(grid.every((week) => week.length === 7)).toBe(true)
    // Today is a Wednesday, so the last column has four days and three nulls.
    expect(grid[1].filter(Boolean)).toHaveLength(3)
  })
})

describe('muscleWeeks', () => {
  const set = (localDate: string, muscle: string | null, sets: number) => ({
    localDate,
    muscle,
    sets,
  })

  it('adds each group up within its Monday week', () => {
    const weeks = muscleWeeks(
      [
        set('2026-08-24', 'legs', 4),
        set('2026-08-26', 'legs', 2),
        set('2026-08-26', 'chest', 3),
        set('2026-08-20', 'back', 5),
      ],
      TODAY,
      2,
    )

    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-08-17', '2026-08-24'])
    expect(weeks[0].total).toBe(5)
    expect(weeks[1].sets.get('legs')).toBe(6)
    expect(weeks[1].sets.get('chest')).toBe(3)
    expect(weeks[1].total).toBe(9)
  })

  /** Four of the 87 exercises are deliberately unclassified. */
  it('files an unclassified exercise under other rather than dropping it', () => {
    const weeks = muscleWeeks([set(TODAY, null, 3)], TODAY, 1)
    expect(weeks[0].sets.get(OTHER)).toBe(3)
    expect(weeks[0].total).toBe(3)
  })

  it('keeps a week with no training as an empty week', () => {
    const weeks = muscleWeeks([set(TODAY, 'legs', 2)], TODAY, 3)
    expect(weeks).toHaveLength(3)
    expect(weeks.slice(0, 2).every((w) => w.total === 0)).toBe(true)
  })
})
