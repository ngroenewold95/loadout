import { describe, it, expect } from 'vitest'
import type { PerformedSet } from '../db/repo.ts'
import { shareText } from './shareText.ts'

let nextId = 1

/** A performed set, with only the fields the text reads spelled out. */
const set = (over: Partial<PerformedSet> = {}): PerformedSet => ({
  id: nextId++,
  sessionId: 1,
  exerciseId: 1,
  exerciseName: 'Romanian Deadlift',
  primaryMuscle: 'legs',
  orderIndex: 0,
  setIndex: 0,
  performedAtUtc: null,
  weightKg: 161.0254,
  enteredValue: 355,
  enteredUnit: 'lb',
  loadMode: 'total',
  reps: 8,
  durationS: null,
  distanceM: null,
  baseWeightKg: null,
  setType: 'working',
  notes: null,
  ...over,
})

// Local time deliberately, not UTC: the stamp is what the phone's clock said.
const STARTED = Date.parse('2026-08-25T17:05:00')
const session = {
  name: 'Day B - RDL',
  startedAtUtc: STARTED,
  endedAtUtc: STARTED + 3_600_000,
}

describe('shareText', () => {
  it('reads as a workout someone could paste into a message', () => {
    const text = shareText(
      session,
      [
        set({ reps: 8 }),
        set({ reps: 5 }),
        set({ exerciseId: 2, exerciseName: 'Machine Leg Curl', weightKg: 117.9340, reps: 8 }),
      ],
      'lb',
    )

    expect(text).toBe(
      [
        'Day B - RDL',
        '25 Aug 5:05 PM',
        '',
        '1:00:00',
        '3 sets',
        '21 reps',
        '6,695 lb',
        '',
        'Romanian Deadlift',
        '1. 355 lb × 8 reps',
        '2. 355 lb × 5 reps',
        '',
        'Machine Leg Curl',
        '1. 260 lb × 8 reps',
      ].join('\n'),
    )
  })

  /**
   * The rule the whole file exists to keep. An Assisted Chinup at 20 lb is a
   * harder set than one at 115, so its weight must never reach the volume line
   * - while its reps are reps like any other.
   */
  it('keeps assistance out of the volume and in the reps', () => {
    const text = shareText(
      session,
      [
        set({ weightKg: 100, reps: 10 }),
        set({
          exerciseId: 3,
          exerciseName: 'Assisted Chinup',
          loadMode: 'assistance',
          weightKg: 9.0718,
          reps: 6,
        }),
      ],
      'lb',
    )

    expect(text).toContain('16 reps')
    expect(text).toContain('2,204.5 lb')
    expect(text).toContain('1. 20 lb × 6 reps')
  })

  it('describes bodyweight, duration and distance sets without inventing a weight', () => {
    const text = shareText(
      session,
      [
        set({ exerciseName: 'Chest Dip', weightKg: null, reps: 12 }),
        set({
          exerciseId: 4,
          exerciseName: 'Plank',
          weightKg: null,
          reps: null,
          durationS: 90,
        }),
        set({
          exerciseId: 5,
          exerciseName: 'Treadmill',
          weightKg: null,
          reps: null,
          distanceM: 1200,
        }),
      ],
      'lb',
    )

    expect(text).toContain('1. 12 reps')
    expect(text).toContain('1. 1:30')
    expect(text).toContain('1. 1200 m')
    expect(text).toContain('0 lb')
  })

  it('times a session that is still running against now', () => {
    const text = shareText(
      { name: null, startedAtUtc: Date.now() - 65_000, endedAtUtc: null },
      [set()],
      'lb',
    )
    expect(text.startsWith('Workout\n')).toBe(true)
    expect(text).toContain('1:05')
  })
})
