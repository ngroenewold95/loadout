/**
 * Fill in `exercises.modality`, `loading` and `default_base_weight_kg` from
 * `logic/exerciseEquipment.ts`.
 *
 * Same fill-blanks shape as `seedMuscles.ts`, with one difference: the three
 * columns are **three separate statements per exercise** rather than one
 * UPDATE. A row that already carries a hand-set modality would otherwise block
 * its loading from being filled, and the base weight most of all: the import
 * derives a base for about 30 exercises out of the free text in `Set Comment`,
 * and those are measurements this table must not overwrite or be blocked by.
 *
 * Bases are authored in pounds and converted here. A plate is a display-unit
 * object - a 45 is 45 lb, not 20.4117 kg - and `PROJECT.md` records what
 * accumulating quantised kg costs: a 170 lb bar came out one 2.5 lb plate short.
 */
import type { Db } from './driver.ts'
import { EQUIPMENT_BY_EXERCISE } from '../logic/exerciseEquipment.ts'
import { toKg } from '../logic/units.ts'

export interface EquipmentSeedResult {
  /** Live exercises whose loading is known once this has run - a total. */
  withLoading: number
  /** Live exercises carrying a base weight. */
  withBase: number
}

export async function seedExerciseEquipment(db: Db): Promise<EquipmentSeedResult> {
  const entries = Object.entries(EQUIPMENT_BY_EXERCISE)
  const now = Date.now()

  return db.transaction(async (tx) => {
    const statements = entries.flatMap(([name, kit]) => {
      const writes: { sql: string; params: (string | number)[] }[] = []
      if (kit.modality) {
        writes.push({
          sql: `UPDATE exercises SET modality = ?, updated_at = ?
                 WHERE name = ? AND modality IS NULL AND deleted_at IS NULL`,
          params: [kit.modality, now, name],
        })
      }
      if (kit.loading) {
        writes.push({
          sql: `UPDATE exercises SET loading = ?, updated_at = ?
                 WHERE name = ? AND loading IS NULL AND deleted_at IS NULL`,
          params: [kit.loading, now, name],
        })
      }
      if (kit.baseLb != null) {
        writes.push({
          sql: `UPDATE exercises SET default_base_weight_kg = ?, updated_at = ?
                 WHERE name = ? AND default_base_weight_kg IS NULL AND deleted_at IS NULL`,
          params: [toKg(kit.baseLb, 'lb'), now, name],
        })
      }
      return writes
    })

    await tx.batch(statements)

    const row = await tx.queryOne<{ loading: number; base: number }>(
      `SELECT SUM(CASE WHEN loading IS NOT NULL THEN 1 ELSE 0 END) AS loading,
              SUM(CASE WHEN default_base_weight_kg IS NOT NULL THEN 1 ELSE 0 END) AS base
         FROM exercises WHERE deleted_at IS NULL`,
    )
    return { withLoading: row?.loading ?? 0, withBase: row?.base ?? 0 }
  })
}
