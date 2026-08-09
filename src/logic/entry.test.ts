import { describe, it, expect } from 'vitest'
import {
  entryShape,
  formatDuration,
  formatTarget,
  stepDuration,
  stepReps,
  stepWeight,
  WEIGHT_STEPS,
} from './entry.ts'
import { formatWeight, toKg, weightsEqual } from './units.ts'

describe('entryShape', () => {
  it('makes weight optional for bodyweight work', () => {
    // Chinup and Chest Dip appear both weighted and unweighted in one history.
    expect(entryShape('bodyweight')).toMatchObject({ weight: 'optional', reps: true })
    expect(entryShape('weight_reps')).toMatchObject({ weight: 'required', reps: true })
  })

  it('drops reps entirely for timed and distance work', () => {
    expect(entryShape('duration')).toMatchObject({ reps: false, duration: true })
    expect(entryShape('distance_time')).toMatchObject({
      reps: false,
      duration: true,
      distance: true,
    })
  })
})

describe('stepWeight', () => {
  it('lands exactly on pound values through the kg round trip', () => {
    let kg = toKg(200, 'lb')
    kg = stepWeight(kg, WEIGHT_STEPS.lb[0], 'lb')
    expect(formatWeight(kg, 'lb')).toBe('205')
    kg = stepWeight(kg, -WEIGHT_STEPS.lb[1], 'lb')
    expect(formatWeight(kg, 'lb')).toBe('202.5')
  })

  it('does not drift when stepped repeatedly', () => {
    let kg = toKg(45, 'lb')
    for (let i = 0; i < 40; i++) kg = stepWeight(kg, 5, 'lb')
    for (let i = 0; i < 40; i++) kg = stepWeight(kg, -5, 'lb')
    expect(weightsEqual(kg, toKg(45, 'lb'))).toBe(true)
  })

  /** 37.25 lb is a real logged value, so the grid must be quarter pounds. */
  it('preserves a quarter-pound value', () => {
    const kg = stepWeight(toKg(37.25, 'lb'), 0, 'lb')
    expect(formatWeight(kg, 'lb')).toBe('37.25')
  })

  it('starts from zero and never goes negative', () => {
    expect(formatWeight(stepWeight(null, 5, 'lb'), 'lb')).toBe('5')
    expect(formatWeight(stepWeight(toKg(2.5, 'lb'), -5, 'lb'), 'lb')).toBe('0')
  })
})

describe('stepReps and stepDuration', () => {
  it('keeps reps at or above 1 - the schema rejects 0', () => {
    expect(stepReps(8, 1)).toBe(9)
    expect(stepReps(1, -1)).toBe(1)
    expect(stepReps(null, -1)).toBe(1)
    expect(stepReps(null, 1)).toBe(1)
  })

  it('clamps duration at zero', () => {
    expect(stepDuration(60, 15)).toBe(75)
    expect(stepDuration(10, -30)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('writes M:SS, and H:MM:SS past an hour', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3675)).toBe('1:01:15')
  })
})

describe('formatTarget', () => {
  it('writes a range, and collapses a fixed target', () => {
    expect(formatTarget(2, 5, 8)).toBe('2 × 5-8')
    expect(formatTarget(2, 10, 10)).toBe('2 × 10')
    expect(formatTarget(2, null, null)).toBe('2 sets')
    expect(formatTarget(null, null, null)).toBeNull()
  })
})
