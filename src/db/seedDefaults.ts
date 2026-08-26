/**
 * The settings row and the plate inventory, if they are not there already.
 *
 * Both tables have existed since migration 0003 and have been **empty ever
 * since**, which is why `platesFor` has had no caller: a solver with no
 * inventory can only ever report a shortfall.
 *
 * A seeder rather than a migration, deliberately. A migration runs once per
 * database, so a device re-pushed from an older import lineage would arrive
 * without these and there would be no second chance to add them; this runs on
 * every launch and inserts only what is missing.
 *
 * **The counts are generous on purpose.** The 2.5 / 5 / 10 / 25 / 35 / 45 lb
 * denominations are measured off the reference app's own calculator, but the
 * count of 8 measured with them describes a home rack, and the gym being
 * trained in is commercial: the history has a 730 lb leg press needing 7 x 45
 * per side, which an inventory of 8 cannot reach. Twenty of each makes the
 * inventory effectively unlimited while keeping the denominations honest, so
 * the dashed shortfall chip still appears for a weight no combination of real
 * plates can make. Per-gym inventory is the follow-up if a home rack ever
 * becomes the constraint.
 */
import type { Db } from './driver.ts'
import { toKg } from '../logic/units.ts'

/** Measured off the reference app: there is no 20 lb plate. */
const PLATES_LB = [2.5, 5, 10, 25, 35, 45]

/** Total across both sides. The solver halves it. */
const COUNT_EACH = 20

/** Progression's own `equipmentWeight`, from the app backup. */
const DEFAULT_BAR_LB = 45

/** Progression's own `step`, and the one the entry bar already uses. */
const DEFAULT_INCREMENT_LB = 5

export interface DefaultsSeedResult {
  settings: boolean
  plates: number
}

export async function seedDefaults(db: Db): Promise<DefaultsSeedResult> {
  const now = Date.now()

  return db.transaction(async (tx) => {
    // `WHERE NOT EXISTS` rather than an upsert: an existing row is the user's
    // settings and must not be reset to the defaults on every launch.
    const { changes } = await tx.exec(
      `INSERT INTO app_settings
         (id, default_bar_weight_kg, weight_increment_kg, created_at, updated_at)
       SELECT 1, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE id = 1)`,
      [toKg(DEFAULT_BAR_LB, 'lb'), toKg(DEFAULT_INCREMENT_LB, 'lb'), now, now],
    )

    const existing = await tx.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM plate_inventory WHERE deleted_at IS NULL',
    )
    if ((existing?.n ?? 0) === 0) {
      await tx.batch(
        PLATES_LB.map((lb) => ({
          sql: `INSERT INTO plate_inventory (weight_kg, count, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
          params: [toKg(lb, 'lb'), COUNT_EACH, now, now],
        })),
      )
      return { settings: changes > 0, plates: PLATES_LB.length }
    }

    return { settings: changes > 0, plates: existing?.n ?? 0 }
  })
}
