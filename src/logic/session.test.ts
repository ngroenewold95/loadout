import { describe, it, expect } from 'vitest'
import { isComplete, nextIncompleteIndex, sessionTotals } from './session.ts'

const plan = (targets: (number | null)[]) =>
  targets.map((targetSets, i) => ({ exerciseId: i + 1, targetSets }))

/** `n` sets of exercise `id`. */
const setsFor = (...pairs: [id: number, n: number][]) =>
  pairs.flatMap(([exerciseId, n]) => Array.from({ length: n }, () => ({ exerciseId })))

describe('isComplete', () => {
  it('counts up to the target', () => {
    expect(isComplete({ exerciseId: 1, targetSets: 2 }, 1)).toBe(false)
    expect(isComplete({ exerciseId: 1, targetSets: 2 }, 2)).toBe(true)
    // Extra sets do not un-complete it.
    expect(isComplete({ exerciseId: 1, targetSets: 2 }, 3)).toBe(true)
  })

  it('is never complete without a target', () => {
    // Nothing decided how many sets there should be, so nothing may declare it
    // finished. See the comment on the function.
    expect(isComplete({ exerciseId: 1, targetSets: null }, 99)).toBe(false)
  })
})

describe('nextIncompleteIndex', () => {
  it('moves to the next exercise when it still needs sets', () => {
    const planned = plan([2, 2, 2])
    expect(nextIncompleteIndex(planned, setsFor([1, 2]), 0)).toBe(1)
  })

  it('skips exercises that are already complete', () => {
    const planned = plan([2, 2, 2])
    // 1 and 2 are done; only 3 needs work.
    expect(nextIncompleteIndex(planned, setsFor([1, 2], [2, 2]), 0)).toBe(2)
  })

  it('wraps rather than trapping you at the end', () => {
    const planned = plan([2, 2, 2])
    // The failure this exists to prevent: exercise 2 was left short, and
    // finishing the last exercise must go back to it, not stop.
    const sets = setsFor([1, 2], [2, 1], [3, 2])
    expect(nextIncompleteIndex(planned, sets, 2)).toBe(1)
  })

  it('returns null when everything is complete', () => {
    const planned = plan([2, 2])
    // Which is the signal to show the summary.
    expect(nextIncompleteIndex(planned, setsFor([1, 2], [2, 2]), 1)).toBeNull()
  })

  it('never returns the exercise it started from', () => {
    const planned = plan([2, 2])
    // Exercise 1 is short, but it is where we are, so the answer is the other
    // one. The caller only asks after the current exercise became complete.
    expect(nextIncompleteIndex(planned, setsFor([1, 0], [2, 0]), 0)).toBe(1)
    expect(nextIncompleteIndex(plan([2]), [], 0)).toBeNull()
  })

  it('handles an empty template', () => {
    expect(nextIncompleteIndex([], [], 0)).toBeNull()
  })
})

describe('sessionTotals', () => {
  const set = (over: Partial<Parameters<typeof sessionTotals>[0][number]> = {}) => ({
    exerciseId: 1,
    weightKg: 100,
    reps: 5,
    loadMode: 'total',
    ...over,
  })

  it('counts sets, distinct exercises and volume', () => {
    const totals = sessionTotals([set(), set(), set({ exerciseId: 2, reps: 10 })])
    expect(totals.sets).toBe(3)
    expect(totals.exercises).toBe(2)
    expect(totals.volumeKg).toBe(100 * 5 + 100 * 5 + 100 * 10)
  })

  it('excludes assistance from volume but still counts the set', () => {
    // A higher assistance number is an EASIER set, so adding it to volume would
    // make progress read as decline. The set is still work that was done.
    const totals = sessionTotals([set(), set({ loadMode: 'assistance', weightKg: 50 })])
    expect(totals.sets).toBe(2)
    expect(totals.volumeKg).toBe(500)
  })

  it('ignores sets with nothing to multiply', () => {
    const totals = sessionTotals([
      set({ weightKg: null }),
      set({ reps: null }),
      set({ weightKg: null, reps: null, exerciseId: 3 }),
    ])
    expect(totals.sets).toBe(3)
    expect(totals.volumeKg).toBe(0)
  })

  it('is zero for an empty session', () => {
    expect(sessionTotals([])).toEqual({ sets: 0, exercises: 0, volumeKg: 0 })
  })
})
