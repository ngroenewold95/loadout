/**
 * Write the programme in `logic/plan.ts` into the templates tables.
 *
 * Written against the portable `Db` rather than better-sqlite3 so the same code
 * can back a "reset templates to the plan" action in the editor later. It runs
 * as one transaction: a half-seeded template is worse than none.
 *
 * REPLACES templates by name. Anything the user has added by hand under a
 * different name is left alone, because after cutover the database - not this
 * file - owns the templates.
 */
import type { Db } from './driver.ts'
import { PLAN, REST_S, NEW_EXERCISES } from '../logic/plan.ts'

export interface SeedResult {
  templates: string[]
  createdExercises: string[]
  /** Plan entries with no matching exercise row. Should always be empty: a
   *  miss means a name in plan.ts drifted from the database. */
  missing: string[]
}

export async function seedPlanTemplates(db: Db): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    const now = Date.now()
    const createdExercises: string[] = []

    // Exercises the plan introduces. Created before the lookup below so they
    // resolve like any other.
    for (const ex of NEW_EXERCISES) {
      const existing = await tx.queryOne<{ id: number }>(
        'SELECT id FROM exercises WHERE name = ? AND deleted_at IS NULL',
        [ex.name],
      )
      if (existing) continue
      await tx.exec(
        `INSERT INTO exercises (name, tracking_type, default_load_mode, default_rest_s, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ex.name, ex.trackingType, ex.loadMode, REST_S.isolation, now, now],
      )
      createdExercises.push(ex.name)
    }

    // One lookup for every name in the plan - not one per exercise.
    const names = [...new Set(PLAN.flatMap((d) => d.exercises.map((e) => e.exercise)))]
    const rows = await tx.query<{ id: number; name: string }>(
      `SELECT id, name FROM exercises
        WHERE deleted_at IS NULL AND name IN (${names.map(() => '?').join(', ')})`,
      names,
    )
    const idByName = new Map(rows.map((r) => [r.name, r.id]))
    const missing = names.filter((n) => !idByName.has(n))
    if (missing.length > 0) {
      throw new Error(
        `plan references unknown exercise(s): ${missing.join(', ')} - ` +
          `fix the name in src/logic/plan.ts or add it to NEW_EXERCISES`,
      )
    }

    const templates: string[] = []
    for (const [order, day] of PLAN.entries()) {
      // Replace any previous version of this template outright. Soft delete
      // keeps the old rows recoverable and frees the name for the live-only
      // unique index.
      const previous = await tx.queryOne<{ id: number }>(
        'SELECT id FROM templates WHERE name = ? AND deleted_at IS NULL',
        [day.name],
      )
      if (previous) {
        await tx.batch([
          {
            sql: 'UPDATE template_exercises SET deleted_at = ?, updated_at = ? WHERE template_id = ? AND deleted_at IS NULL',
            params: [now, now, previous.id],
          },
          {
            sql: 'UPDATE templates SET deleted_at = ?, updated_at = ? WHERE id = ?',
            params: [now, now, previous.id],
          },
        ])
      }

      const { lastInsertId: templateId } = await tx.exec(
        'INSERT INTO templates (name, order_index, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [day.name, order, day.notes ?? null, now, now],
      )

      await tx.batch(
        day.exercises.map((e, i) => ({
          sql: `INSERT INTO template_exercises
                  (template_id, exercise_id, order_index, target_sets,
                   target_rep_min, target_rep_max, rest_s, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            templateId,
            idByName.get(e.exercise)!,
            i,
            e.sets,
            e.repMin,
            e.repMax,
            e.restS,
            e.notes ?? null,
            now,
            now,
          ],
        })),
      )
      templates.push(day.name)
    }

    return { templates, createdExercises, missing }
  })
}
