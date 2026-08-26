import { describe, it, expect } from 'vitest'
import { GUIDANCE_BY_EXERCISE } from './exerciseGuidance.ts'
import { MUSCLE_BY_EXERCISE } from './exerciseMuscles.ts'
import { PLAN } from './plan.ts'

const entries = Object.entries(GUIDANCE_BY_EXERCISE)

describe('GUIDANCE_BY_EXERCISE', () => {
  it('covers every exercise in the current programme', () => {
    // The 21 programme lifts are the ones read under a bar, so they are the
    // ones that must never render "no guidance yet".
    const planned = PLAN.flatMap((day) => day.exercises.map((e) => e.exercise))
    const missing = planned.filter((name) => !(name in GUIDANCE_BY_EXERCISE))
    expect(missing).toEqual([])
  })

  it('uses names the exercise table also knows', () => {
    // A key is matched against `exercises.name` by the seeder, so a typo here
    // would update zero rows and fail silently. `MUSCLE_BY_EXERCISE` was
    // verified against the database, which makes it a usable stand-in.
    const unknown = entries.map(([name]) => name).filter((name) => !(name in MUSCLE_BY_EXERCISE))
    expect(unknown).toEqual([])
  })

  it('holds real lines, not placeholders', () => {
    for (const [name, text] of entries) {
      const lines = text.split('\n')
      expect(lines.length, `${name} has one line`).toBeGreaterThan(1)
      expect(
        lines.every((line) => line.trim().length > 0),
        `${name} has a blank line`,
      ).toBe(true)
    }
  })
})
