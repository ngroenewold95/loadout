import { describe, it, expect } from 'vitest'
import {
  entryShape,
  formatDuration,
  formatTarget,
  type Parsed,
  parseReps,
  parseWeight,
  scrubSteps,
  SCRUB_PX_PER_STEP,
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

describe('scrubSteps', () => {
  it('truncates rather than rounds, so a resting thumb cannot twitch the value', () => {
    expect(scrubSteps(SCRUB_PX_PER_STEP - 1).steps).toBe(0)
    expect(scrubSteps(-(SCRUB_PX_PER_STEP - 1)).steps).toBe(0)
    expect(scrubSteps(SCRUB_PX_PER_STEP).steps).toBe(1)
    expect(scrubSteps(-SCRUB_PX_PER_STEP).steps).toBe(-1)
  })

  /**
   * The reason `remainderPx` exists. A finger covering 200 px in five frames
   * must move exactly as far as one covering it in a single frame; dropping the
   * leftover each frame would lose up to a step per frame.
   */
  it('carries the remainder, so a slow drag travels as far as a fast one', () => {
    const travel = 200
    const oneGo = scrubSteps(travel)

    let carry = 0
    let total = 0
    for (let i = 0; i < 5; i++) {
      carry += travel / 5
      const { steps, remainderPx } = scrubSteps(carry)
      total += steps
      carry = remainderPx
    }

    expect(oneGo.steps).toBe(5)
    expect(total).toBe(oneGo.steps)
  })

  it('measures against the drag Progression was measured at', () => {
    // 246 px moved 2 steps and 500 px moved 5, on the reference app.
    expect(scrubSteps(246).steps).toBe(6)
    expect(scrubSteps(246, 123).steps).toBe(2)
    expect(scrubSteps(500, 100).steps).toBe(5)
  })

  it('refuses to divide by a nonsense step size', () => {
    expect(scrubSteps(100, 0)).toEqual({ steps: 0, remainderPx: 0 })
    expect(scrubSteps(Number.NaN)).toEqual({ steps: 0, remainderPx: 0 })
  })
})

/** Unwrap a parse that is expected to have produced an actual value. */
function value<T>(parsed: Parsed<T>): T {
  if (!parsed.ok || parsed.value == null) throw new Error('expected a parsed value')
  return parsed.value
}

describe('parseWeight', () => {
  it('separates a cleared field from garbage', () => {
    // Both would collapse to null in a naive parser, and the second would then
    // log a set with no weight every time a thumb slipped.
    expect(parseWeight('', 'lb')).toEqual({ ok: true, value: null })
    expect(parseWeight('   ', 'lb')).toEqual({ ok: true, value: null })
    expect(parseWeight('-', 'lb')).toEqual({ ok: false })
    expect(parseWeight('1.2.3', 'lb')).toEqual({ ok: false })
    expect(parseWeight('-5', 'lb')).toEqual({ ok: false })
  })

  it('lands on the same stored value as stepping there would', () => {
    // Typed and stepped must be byte-identical in the database, or a later
    // `WHERE weight_kg = ?` sees two different 205 lb.
    const typed = value(parseWeight('205', 'lb'))
    const stepped = stepWeight(toKg(200, 'lb'), WEIGHT_STEPS.lb[0], 'lb')
    expect(weightsEqual(typed, stepped)).toBe(true)
  })

  it('accepts the comma the numeric keypad offers, and quarter pounds', () => {
    expect(formatWeight(value(parseWeight('2,5', 'kg')), 'kg')).toBe('2.5')
    expect(formatWeight(value(parseWeight('37.25', 'lb')), 'lb')).toBe('37.25')
  })
})

describe('parseReps', () => {
  it('takes whole reps of at least 1, matching the schema CHECK', () => {
    expect(parseReps('8')).toEqual({ ok: true, value: 8 })
    // History arrives as "8.00"; the same two-step applies to typed input.
    expect(parseReps('8.00')).toEqual({ ok: true, value: 8 })
    expect(parseReps('')).toEqual({ ok: true, value: null })
    expect(parseReps('8.5')).toEqual({ ok: false })
    expect(parseReps('0')).toEqual({ ok: false })
    expect(parseReps('-3')).toEqual({ ok: false })
    expect(parseReps('abc')).toEqual({ ok: false })
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
