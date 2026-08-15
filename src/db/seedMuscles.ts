/**
 * Fill in `exercises.primary_muscle` from the table in `logic/exerciseMuscles.ts`.
 *
 * Written against the portable `Db` rather than better-sqlite3, so the same
 * code can run at import on the laptop and from the app after cutover, when a
 * re-import is no longer possible. Runs as one transaction and one batch: 87
 * separate UPDATE statements would be 87 bridge crossings on device.
 *
 * **Only fills blanks.** Rows that already carry a value are left alone, so a
 * correction made by hand, or later in the exercise editor, survives a re-run.
 * That is what makes this safe to call unconditionally on every launch.
 */
import type { Db } from './driver.ts'
import { MUSCLE_BY_EXERCISE } from '../logic/exerciseMuscles.ts'

export interface MuscleSeedResult {
  /**
   * Live exercises that carry a group once this has run - a total, not a delta.
   * Deliberately so: the useful question after seeding is "how many will render
   * a real circle", and that answer is the same whether this was the first run
   * or the fifth.
   */
  withGroup: number
  /** Live exercises the table says nothing about - a rename, or a new lift. */
  unmapped: string[]
}

export async function seedExerciseMuscles(db: Db): Promise<MuscleSeedResult> {
  const assignments = Object.entries(MUSCLE_BY_EXERCISE).filter(
    // A deliberate `null` is not an assignment; leaving the column empty is
    // what makes the identity mark stay blank rather than claim a group.
    (entry): entry is [string, NonNullable<(typeof entry)[1]>] => entry[1] !== null,
  )

  const withGroup = await db.transaction(async (tx) => {
    await tx.batch(
      assignments.map(([name, muscle]) => ({
        sql: `UPDATE exercises SET primary_muscle = ?, updated_at = ?
               WHERE name = ? AND primary_muscle IS NULL AND deleted_at IS NULL`,
        params: [muscle, Date.now(), name],
      })),
    )
    const row = await tx.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM exercises WHERE primary_muscle IS NOT NULL AND deleted_at IS NULL',
    )
    return row?.n ?? 0
  })

  // Reported rather than thrown: an unmapped exercise is a `?` badge, which is
  // a cosmetic gap, not a reason to fail an import that reconciles.
  const live = await db.query<{ name: string }>(
    'SELECT name FROM exercises WHERE deleted_at IS NULL',
  )
  const unmapped = live
    .map((r) => r.name)
    .filter((name) => !(name in MUSCLE_BY_EXERCISE))
    .sort()

  return { withGroup, unmapped }
}
