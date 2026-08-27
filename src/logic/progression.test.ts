/**
 * The export mapper, and specifically the assisted split.
 *
 * `mapExport` had no tests of its own until this stage: it was proved by the
 * import reconciling to an exact total volume against five years of real rows,
 * which is a stronger check but a slower one and says nothing about a single
 * rule. The split is a rule, so it gets one here as well.
 */
import { describe, it, expect } from 'vitest'
import { COLUMNS, mapExport, splitAssistedName, type RawRow } from './progression.ts'

/** One export row, with only the columns any of these cases care about. */
function row(
  exercise: string,
  weight: string,
  reps = '8',
  time = '10:00:00',
  date = '2026-08-13',
): RawRow {
  return {
    line: 1,
    record: {
      [COLUMNS.date]: date,
      [COLUMNS.time]: time,
      [COLUMNS.setTimestamp]: '09:30:00',
      [COLUMNS.exercise]: exercise,
      [COLUMNS.setOrder]: '1',
      [COLUMNS.weight]: weight,
      [COLUMNS.weightUnit]: weight ? 'lb' : '',
      [COLUMNS.reps]: reps,
      [COLUMNS.sessionDuration]: '3600',
    },
  }
}

describe('splitAssistedName', () => {
  it('splits one name into two exercises by whether the set carried weight', () => {
    expect(splitAssistedName('Chest Dip', true)).toBe('Assisted Chest Dip')
    expect(splitAssistedName('Chest Dip', false)).toBe('Chest Dip')
  })

  it('merges weighted Chinup into the Assisted Chinup the export already has', () => {
    // Measured before this was written: the two never appear in the same
    // session, and the weights and reps are the same movement.
    expect(splitAssistedName('Chinup', true)).toBe('Assisted Chinup')
  })

  it('does not prefix a name that already says Assisted', () => {
    expect(splitAssistedName('Assisted Pullup', true)).toBe('Assisted Pullup')
  })

  it('leaves everything else alone, weighted or not', () => {
    expect(splitAssistedName('Trap Bar Deadlift', true)).toBe('Trap Bar Deadlift')
    expect(splitAssistedName('Plank', false)).toBe('Plank')
  })
})

describe('mapExport, assisted split', () => {
  const mapped = mapExport([
    row('Chest Dip', '100'),
    row('Chest Dip', ''),
    row('Trap Bar Deadlift', '355'),
  ])

  const exercise = (name: string) => mapped.exercises.find((e) => e.name === name)

  it('creates both exercises, not one', () => {
    expect(exercise('Assisted Chest Dip')).toBeDefined()
    expect(exercise('Chest Dip')).toBeDefined()
  })

  /**
   * The whole point of the split. Before it, the weighted rows made `Chest Dip`
   * infer `weight_reps`, so the weight field was required and `LOG SET` sat
   * disabled on a bodyweight day until a number was typed.
   */
  it('leaves the plain name as bodyweight and the assisted one as weight_reps', () => {
    expect(exercise('Chest Dip')?.trackingType).toBe('bodyweight')
    expect(exercise('Assisted Chest Dip')?.trackingType).toBe('weight_reps')
  })

  it('reads the load mode off the rows, so only the assisted half inverts', () => {
    expect(exercise('Assisted Chest Dip')?.loadMode).toBe('assistance')
    expect(exercise('Chest Dip')?.loadMode).toBe('total')
    expect(exercise('Trap Bar Deadlift')?.loadMode).toBe('total')
  })

  it('files each set under the exercise it belongs to', () => {
    const names = mapped.sets.map((s) => s.exerciseName).sort()
    expect(names).toEqual(['Assisted Chest Dip', 'Chest Dip', 'Trap Bar Deadlift'])
  })

  /**
   * Per-set `load_mode` is unchanged by the split, which is what keeps the
   * import's total-volume reconciliation exact: the rows move between
   * exercises, and no row changes what it means.
   */
  it('keeps the per-set load mode exactly as it was', () => {
    const bySet = new Map(mapped.sets.map((s) => [s.exerciseName, s.loadMode]))
    expect(bySet.get('Assisted Chest Dip')).toBe('assistance')
    expect(bySet.get('Chest Dip')).toBe('total')
    expect(bySet.get('Trap Bar Deadlift')).toBe('total')
  })
})
