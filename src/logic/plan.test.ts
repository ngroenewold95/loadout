import { describe, it, expect } from 'vitest'
import { PLAN, REST_S, shouldIncreaseLoad } from './plan.ts'

describe('plan shape', () => {
  it('is the two-day A/B rotation, 2 sets throughout', () => {
    expect(PLAN.map((d) => d.name)).toEqual(['Day A - Trap Bar', 'Day B - RDL'])
    for (const day of PLAN) {
      for (const ex of day.exercises) {
        expect(ex.sets).toBe(2)
        expect(ex.repMax).toBeGreaterThanOrEqual(ex.repMin)
        expect(REST_S[ex.rest]).toBeGreaterThan(0)
      }
    }
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
