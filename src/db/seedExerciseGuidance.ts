/**
 * Fill in `exercises.guidance` from the table in `logic/exerciseGuidance.ts`.
 *
 * Same shape as `seedMuscles.ts` and for the same reasons: written against the
 * portable `Db` so it runs at import on the laptop and from the app after
 * cutover, one transaction and one batch rather than N bridge crossings, and
 * **only fills blanks**, so a correction made by hand survives a re-run. That
 * is what makes it safe to call unconditionally on every launch.
 */
import type { Db } from './driver.ts'
import { GUIDANCE_BY_EXERCISE } from '../logic/exerciseGuidance.ts'

export interface GuidanceSeedResult {
  /** Live exercises carrying guidance once this has run - a total, not a delta. */
  withGuidance: number
  /** Live exercises the table says nothing about. Most of the 87, by design. */
  unwritten: string[]
}

export async function seedExerciseGuidance(db: Db): Promise<GuidanceSeedResult> {
  const entries = Object.entries(GUIDANCE_BY_EXERCISE)

  const withGuidance = await db.transaction(async (tx) => {
    await tx.batch(
      entries.map(([name, guidance]) => ({
        sql: `UPDATE exercises SET guidance = ?, updated_at = ?
               WHERE name = ? AND guidance IS NULL AND deleted_at IS NULL`,
        params: [guidance, Date.now(), name],
      })),
    )
    const row = await tx.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM exercises WHERE guidance IS NOT NULL AND deleted_at IS NULL',
    )
    return row?.n ?? 0
  })

  // Reported rather than thrown, and unlike the muscle seeder this list is
  // expected to be long: only the 21 programme lifts are authored, and every
  // other exercise renders "no guidance yet" on purpose.
  const live = await db.query<{ name: string }>(
    'SELECT name FROM exercises WHERE deleted_at IS NULL',
  )
  const unwritten = live
    .map((r) => r.name)
    .filter((name) => !(name in GUIDANCE_BY_EXERCISE))
    .sort()

  return { withGuidance, unwritten }
}
