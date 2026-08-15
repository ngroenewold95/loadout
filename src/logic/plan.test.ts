import { describe, it, expect } from 'vitest'
import { PLAN, REST_S, earnedIncreases, shouldIncreaseLoad } from './plan.ts'

describe('plan shape', () => {
  it('is the two-day A/B rotation, 2 sets throughout', () => {
    expect(PLAN.map((d) => d.name)).toEqual(['Day A - Trap Bar', 'Day B - RDL'])
    for (const day of PLAN) {
      for (const ex of day.exercises) {
        expect(ex.sets).toBe(2)
        expect(ex.repMax).toBeGreaterThanOrEqual(ex.repMin)
        expect(ex.restS).toBeGreaterThan(0)
      }
    }
  })

  /**
   * Measured off the app's own backup on 2026-08-13, so this test is what
   * catches `plan.ts` drifting away from the programme again. Day A carries no
   * rests in the app and is deliberately not asserted here.
   */
  it('matches the app on Day B, order and rests included', () => {
    const dayB = PLAN[1]
    expect(dayB.exercises.map((e) => e.exercise)).toEqual([
      'Romanian Deadlift',
      'Machine Leg Curl',
      'Machine Single-Leg Extension',
      'Machine Calf Raise (Seated)',
      'Machine Chest Press',
      'Machine Row',
      'Machine Lateral Raise',
      'Cable Face Pull',
      'Machine Preacher Curl',
      'Cable Pushdown (with Bar Handle)',
      'Cable Crunch',
    ])
    expect(dayB.exercises.map((e) => e.restS)).toEqual([
      240, 180, 180, 120, 180, 180, 120, 90, 90, 90, 90,
    ])
  })

  it('names each exercise once per day', () => {
    for (const day of PLAN) {
      const names = day.exercises.map((e) => e.exercise)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('keeps the standing and seated calf raises apart', () => {
    const all = PLAN.flatMap((d) => d.exercises.map((e) => e.exercise))
    expect(all).toContain('Machine Calf Raise')
    expect(all).toContain('Machine Calf Raise (Seated)')
  })

  /** The bands still seed Day A and any newly created exercise. */
  it('rests heavy compounds longer than isolation work', () => {
    expect(REST_S.compound).toBeGreaterThan(REST_S.machine)
    expect(REST_S.machine).toBeGreaterThan(REST_S.isolation)
  })
})

describe('shouldIncreaseLoad', () => {
  it('fires only when both sets hit the top of the range', () => {
    expect(shouldIncreaseLoad([8, 8], 2, 8)).toBe(true)
    expect(shouldIncreaseLoad([8, 7], 2, 8)).toBe(false)
    expect(shouldIncreaseLoad([7, 7], 2, 8)).toBe(false)
  })

  it('does not fire before the prescribed sets are done', () => {
    expect(shouldIncreaseLoad([8], 2, 8)).toBe(false)
    expect(shouldIncreaseLoad([], 2, 8)).toBe(false)
  })

  it('counts overshoot as a hit', () => {
    expect(shouldIncreaseLoad([9, 10], 2, 8)).toBe(true)
  })

  /** An extra set is not a reason to withhold the increase already earned. */
  it('judges on the prescribed sets, ignoring extras', () => {
    expect(shouldIncreaseLoad([8, 8, 5], 2, 8)).toBe(true)
  })
})

describe('earnedIncreases', () => {
  const planned = [
    { exerciseId: 1, targetSets: 2, targetRepMax: 8 },
    { exerciseId: 2, targetSets: 2, targetRepMax: 8 },
    /** Added to a workout by hand, so it carries no rep goal to have met. */
    { exerciseId: 3, targetSets: null, targetRepMax: null },
  ]

  const on = (localDate: string, ...reps: (number | null)[]) => [
    { localDate, sets: reps.map((r) => ({ reps: r })) },
  ]
  const session = (...reps: (number | null)[]) => on('2026-08-10', ...reps)

  it('names the exercises that hit the top of the range last time', () => {
    const recent = new Map([
      [1, session(8, 8)],
      [2, session(8, 6)],
      [3, session(12, 12)],
    ])
    expect(earnedIncreases(planned, recent)).toEqual([1])
  })

  it('judges on the most recent session only', () => {
    // The older session earned it; the last one did not, and that is the answer.
    const recent = new Map([[1, [...session(6, 6), ...session(8, 8)]]])
    expect(earnedIncreases(planned, recent)).toEqual([])
  })

  it('earns nothing from an exercise with no history', () => {
    expect(earnedIncreases(planned, new Map())).toEqual([])
    expect(
      earnedIncreases(planned, new Map([[1, [{ localDate: '2026-08-10', sets: [] }]]])),
    ).toEqual([])
  })

  /**
   * The window is what keeps this about current training. An exercise dropped
   * from the programme a year ago must not keep announcing what it earned.
   */
  it('ignores a session older than the window', () => {
    const recent = new Map([
      [1, on('2026-08-10', 8, 8)],
      [2, on('2025-08-10', 8, 8)],
    ])
    expect(earnedIncreases(planned, recent, { since: '2026-07-19' })).toEqual([1])
    // The boundary date itself is inside the window, not outside it.
    expect(earnedIncreases(planned, recent, { since: '2026-08-10' })).toEqual([1])
    expect(earnedIncreases(planned, recent, { since: '2026-08-11' })).toEqual([])
    // Without a window, age is not considered at all.
    expect(earnedIncreases(planned, recent)).toEqual([1, 2])
  })

  /** A set logged without reps is not a set that hit the top of the range. */
  it('treats a missing rep count as zero', () => {
    expect(earnedIncreases(planned, new Map([[1, session(8, null)]]))).toEqual([])
  })
})
