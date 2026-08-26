/**
 * Every seeder that runs on launch, in one place.
 *
 * Nothing seeded on device before this existed: the fill-blanks seeders were
 * called only from `scripts/import.ts` and `devSeed.ts`, which is fine while a
 * re-import is possible and useless the moment it is not. Cutover is one-way,
 * so metadata the app needs has to be able to arrive without one.
 *
 * Every seeder here must be **blanks-only and idempotent**, which is what makes
 * calling this unconditionally on every launch safe. A seeder that overwrites
 * belongs somewhere else.
 *
 * **`seedPlanTemplates` is deliberately not called from here, and must never
 * be.** It replaces templates by name, so running it on launch would silently
 * undo every edit made in the template editor. `PROJECT.md` records that the
 * DB owns the templates once they are seeded; this is where that decision is
 * kept honest.
 */
import type { Db } from './driver.ts'
import { seedExerciseMuscles } from './seedMuscles.ts'
import { seedExerciseGuidance } from './seedExerciseGuidance.ts'
import { seedExerciseEquipment } from './seedExerciseEquipment.ts'
import { seedDefaults } from './seedDefaults.ts'

export interface SeedReport {
  /** Live exercises carrying a muscle group. */
  withGroup: number
  /** Live exercises carrying authored guidance. */
  withGuidance: number
  /** Live exercises whose loading is known, so plate chips can be drawn. */
  withLoading: number
  /** Live exercises carrying a bar, carriage or machine base weight. */
  withBase: number
  /** Plate denominations in the inventory. */
  plates: number
  /** Live exercise names no muscle mapping knows about - a rename, or a new lift. */
  unmapped: string[]
}

export async function runSeeders(db: Db): Promise<SeedReport> {
  const muscles = await seedExerciseMuscles(db)
  const guidance = await seedExerciseGuidance(db)
  const equipment = await seedExerciseEquipment(db)
  const defaults = await seedDefaults(db)

  return {
    withGroup: muscles.withGroup,
    withGuidance: guidance.withGuidance,
    withLoading: equipment.withLoading,
    withBase: equipment.withBase,
    plates: defaults.plates,
    unmapped: muscles.unmapped,
  }
}
